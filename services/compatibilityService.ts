import { Character, Lorebook, LorebookEntry, ChatSession } from '../types.ts';
import { logger } from './loggingService.ts';

// --- Utilities ---

/**
 * Extracts character JSON from a PNG file's tEXt/iTXt chunks.
 * Standard format for SillyTavern and other AI platforms.
 */
export const extractCharaFromPng = async (file: File): Promise<string | null> => {
    try {
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);
        
        if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
            return null;
        }

        let offset = 8;
        const decoder = new TextDecoder();

        while (offset < view.byteLength - 8) {
            const length = view.getUint32(offset);
            const type = decoder.decode(new Uint8Array(buffer, offset + 4, 4));

            if (type === 'tEXt' || type === 'iTXt') {
                const data = new Uint8Array(buffer, offset + 8, length);
                const chunkContent = decoder.decode(data);
                
                if (chunkContent.startsWith('chara\0')) {
                    const jsonPart = chunkContent.substring(6);
                    try {
                        return atob(jsonPart);
                    } catch (e) {
                        return jsonPart;
                    }
                }
            }
            offset += length + 12;
        }
        return null;
    } catch (err) {
        logger.error("Error extracting PNG metadata", err);
        return null;
    }
};

/**
 * Robust Lorebook/World Info detection.
 * Handles SillyTavern exports, Agnaistic arrays, and dictionary-style objects.
 */
export const sillyTavernWorldInfoToNexus = (data: any, fileName: string): Omit<Lorebook, 'id'> | null => {
    if (!data || typeof data !== 'object') return null;
    
    // Check for SillyTavern wrapper or root world_info key
    const actualData = data.data || data.world_info || data;
    let entriesData: any[] = [];
    
    if (actualData.entries) {
        entriesData = Array.isArray(actualData.entries) ? actualData.entries : Object.values(actualData.entries);
    } else if (Array.isArray(actualData)) {
        entriesData = actualData;
    } else if (actualData.character_book?.entries) {
        entriesData = Array.isArray(actualData.character_book.entries) ? actualData.character_book.entries : Object.values(actualData.character_book.entries);
    } else {
        const vals = Object.values(actualData);
        const isEntryMap = vals.length > 0 && vals.every(v => v && typeof v === 'object' && ('content' in v || 'key' in v || 'keys' in v));
        if (isEntryMap) entriesData = vals;
    }

    if (entriesData.length === 0) return null;
    
    const validEntries: LorebookEntry[] = entriesData
        .filter(e => e && typeof e === 'object' && (e.content || e.entry))
        .map(entry => {
            let keys: string[] = [];
            if (Array.isArray(entry.keys)) keys = entry.keys;
            else if (Array.isArray(entry.key)) keys = entry.key;
            else if (typeof entry.key === 'string') keys = entry.key.split(',').map((s: string) => s.trim());
            else if (typeof entry.keys === 'string') keys = entry.keys.split(',').map((s: string) => s.trim());
            
            return {
                id: crypto.randomUUID(),
                keys: keys.filter(k => k),
                content: entry.content || entry.entry || ''
            };
        })
        .filter(e => e.content && e.keys.length > 0);
    
    if (validEntries.length === 0) return null;

    return {
        name: actualData.name || fileName.replace(/\.[^/.]+$/, ""),
        description: actualData.description || `Imported Lorebook`,
        entries: validEntries,
    };
};

/**
 * Converts a Character Card v2 compatible object into an AI Nexus Character.
 */
export const v2ToNexus = (card: any): { character: Character, lorebook?: Lorebook } | null => {
    if (!card) return null;
    const data = card.data || card; 
    if (!data || !data.name) return null;

    // Stricter check: If it contains 'entries' but lacks roleplay behavior fields, it's a lorebook.
    const hasRoleplayFields = !!(data.personality || data.scenario || data.char_persona || data.system_prompt);
    if (data.entries && !hasRoleplayFields) return null;

    if (data._aiNexusData) {
        const nexusData = data._aiNexusData;
        return { character: { ...nexusData, id: nexusData.id || crypto.randomUUID() } };
    }

    const avatarUrl = data.avatar?.startsWith('http') ? data.avatar : (data.avatar ? `data:image/png;base64,${data.avatar}` : '');
    
    let combinedPersonality = '';
    if (data.system_prompt) combinedPersonality += `${data.system_prompt.trim()}\n\n`;
    if (data.personality) combinedPersonality += `${data.personality.trim()}\n\n`;
    if (data.description) combinedPersonality += `${data.description.trim()}\n\n`;
    if (data.scenario) combinedPersonality += `Scenario: ${data.scenario.trim()}\n\n`;
    if (data.char_persona) combinedPersonality += `${data.char_persona.trim()}\n\n`;

    let autoLorebook: Lorebook | undefined = undefined;
    if (data.character_book?.entries) {
        const nexusLore = sillyTavernWorldInfoToNexus(data.character_book, data.name);
        if (nexusLore) {
            autoLorebook = { ...nexusLore, id: crypto.randomUUID() };
        }
    }

    return {
        character: {
            id: crypto.randomUUID(),
            name: data.name,
            description: data.description || '',
            personality: combinedPersonality.trim(),
            firstMessage: data.first_mes || '',
            avatarUrl: avatarUrl,
            tags: data.tags || [],
            createdAt: new Date().toISOString(),
            characterType: 'character',
            lore: [],
            memory: `Memory begins here.`,
        },
        lorebook: autoLorebook
    };
};

// --- FIX: Added nexusToV2 to export characters in the industry-standard V2 format ---
/**
 * Converts an AI Nexus Character into a Character Card v2 compatible object.
 */
export const nexusToV2 = async (character: Character): Promise<any> => {
    return {
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: {
            name: character.name,
            description: character.description,
            personality: character.personalityTraits || '',
            scenario: '',
            first_mes: character.firstMessage || '',
            mes_example: '',
            char_persona: character.personality || '',
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: [],
            tags: character.tags || [],
            creator: 'AI Nexus',
            character_version: '1.0',
            extensions: {},
            // Include full original object for lossless internal transfer
            _aiNexusData: character
        }
    };
};

export const jsonToNexusChat = (data: any): ChatSession | null => {
    if (data && data.messages && Array.isArray(data.messages)) {
        return data as ChatSession;
    }
    return null;
};
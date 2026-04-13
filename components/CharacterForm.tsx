import React, { useState, useEffect, useRef } from 'react';
import { Character, ApiConfig, EmbeddingConfig, RagSource } from '../types.ts';
import * as geminiService from '../services/geminiService.ts';
import { logger } from '../services/loggingService.ts';
import { SparklesIcon } from './icons/SparklesIcon.tsx';
import { SpinnerIcon } from './icons/SpinnerIcon.tsx';
import { TrashIcon } from './icons/TrashIcon.tsx';
import { PlusIcon } from './icons/PlusIcon.tsx';

interface CharacterFormProps {
  character: Character | null;
  onSave: (character: Character) => void;
  onCancel: () => void;
  onGenerateImage: (prompt: string) => Promise<string | null>;
  availableDocuments: RagSource[];
}

const defaultApiConfig: ApiConfig = {
    service: 'pollinations',
    apiKey: '',
    apiEndpoint: 'https://text.pollinations.ai/',
    model: 'openai'
};

const defaultEmbeddingConfig: EmbeddingConfig = {
    service: 'gemini',
    apiKey: '',
    apiEndpoint: 'http://localhost:11434/api/embeddings',
    model: 'text-embedding-004'
};

const API_PRESETS: Record<string, { label: string, service: any, endpoint: string, models: string[], requiresKey: boolean }> = {
    'pollinations': {
        label: "Pollinations.ai (Free)",
        service: "pollinations",
        endpoint: "https://text.pollinations.ai/",
        models: ["openai", "mistral", "karma", "flux"],
        requiresKey: false
    },
    'kobold': {
        label: "KoboldCPP / Local (Free)",
        service: "kobold",
        endpoint: "http://localhost:5001/v1/chat/completions",
        models: ["default", "gemma-2b"],
        requiresKey: false
    },
    'groq': {
        label: "Groq (Free Tier)",
        service: "groq",
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        models: ["llama3-8b-8192", "llama3-70b-8192", "mixtral-8x7b-32768", "gemma-7b-it"],
        requiresKey: true
    },
    'mistral': {
        label: "Mistral AI",
        service: "mistral",
        endpoint: "https://api.mistral.ai/v1/chat/completions",
        models: ["mistral-tiny", "mistral-small", "mistral-medium", "mistral-large-latest"],
        requiresKey: true
    },
    'openrouter': {
        label: "OpenRouter",
        service: "openrouter",
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        models: ["nousresearch/hermes-3-llama-3.1-405b", "mistralai/mistral-7b-instruct", "microsoft/wizardlm-2-8x22b"],
        requiresKey: true
    },
    'openai': {
        label: "OpenAI / Compatible",
        service: "openai",
        endpoint: "https://api.openai.com/v1/chat/completions",
        models: ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
        requiresKey: true
    },
    'gemini': {
        label: "Google Gemini (Custom Key)",
        service: "gemini",
        endpoint: "",
        models: ["gemini-3-flash-preview", "gemini-3-pro-preview", "gemini-2.5-flash-lite-latest"],
        requiresKey: true
    },
    'default': {
        label: "Default (Internal Gemini)",
        service: "default",
        endpoint: "",
        models: ["gemini-3-flash-preview"],
        requiresKey: false 
    }
};

const Section: React.FC<{ title: string, children: React.ReactNode, defaultOpen?: boolean }> = ({ title, children, defaultOpen = true }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className="rounded-md border border-border-neutral bg-background-secondary/50 overflow-hidden shadow-sm">
            <button type="button" onClick={() => setIsOpen(!isOpen)} className="w-full text-left p-4 flex justify-between items-center bg-background-secondary hover:bg-background-tertiary transition-colors">
                <h3 className="text-lg font-medium text-text-primary">{title}</h3>
                <svg className={`w-5 h-5 text-text-secondary transform transition-transform ${isOpen ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {isOpen && <div className="p-5 border-t border-border-neutral space-y-4 animate-in slide-in-from-top-2">{children}</div>}
        </div>
    );
}

export const CharacterForm: React.FC<CharacterFormProps> = ({ character, onSave, onCancel, onGenerateImage, availableDocuments }) => {
  const [formState, setFormState] = useState<Character>({
      id: '', name: '', description: '', personality: '', avatarUrl: '', tags: [], createdAt: '', 
      physicalAppearance: '', personalityTraits: '', lore: [], memory: 'No memories yet.', voiceId: 'Puck',
      characterType: 'character', apiConfig: defaultApiConfig, ragEnabled: false, embeddingConfig: defaultEmbeddingConfig,
      knowledgeSourceIds: [], pluginEnabled: false, pluginCode: '', searchEnabled: false, thinkingEnabled: false,
      terminalEnabled: false, dynamicAvatarEnabled: false,
  });
  const [isAiLoading, setIsAiLoading] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>('pollinations');

  useEffect(() => {
    if (character) {
        setFormState({
            ...character,
            tags: character.tags || [],
            lore: Array.isArray(character.lore) ? character.lore : [],
            memory: character.memory || 'No memories yet.',
            knowledgeSourceIds: character.knowledgeSourceIds || [],
            embeddingConfig: character.embeddingConfig || defaultEmbeddingConfig,
            apiConfig: character.apiConfig || defaultApiConfig,
        });
        const service = character.apiConfig?.service || 'pollinations';
        setSelectedPreset(service);
    }
  }, [character]);

  const handleFormChange = <K extends keyof Character>(key: K, value: Character[K]) => {
      setFormState(prev => ({ ...prev, [key]: value }));
  };

  const handleAiAssist = async (field: keyof Character) => {
    if (isAiLoading) return;
    setIsAiLoading(String(field));
    try {
        const prompt = `Based on context (Name: ${formState.name || 'New Character'}, Description: ${formState.description || 'N/A'}), generate a high-quality ${String(field)} content. Return ONLY the content without extra formatting. If list, use separate lines.`;
        const result = await geminiService.generateContent(prompt);
        if (result) {
            if (field === 'lore') {
                const lines = result.split('\n')
                    .map(l => l.replace(/^[-*•\d.]+\s*/, '').trim())
                    .filter(l => l.length > 0);
                handleFormChange('lore', lines);
            } else {
                handleFormChange(field, result as any);
            }
        }
    } catch (e) {
        logger.error("AI Assist failed", e);
    } finally {
        setIsAiLoading(null);
    }
  };

  const handleLoreAdd = () => {
    const currentLore = Array.isArray(formState.lore) ? formState.lore : [];
    handleFormChange('lore', [...currentLore, '']);
  };

  const handleLoreChange = (idx: number, val: string) => {
    const currentLore = Array.isArray(formState.lore) ? formState.lore : [];
    const updated = [...currentLore];
    updated[idx] = val;
    handleFormChange('lore', updated);
  };

  const handleLoreDelete = (idx: number) => {
    const currentLore = Array.isArray(formState.lore) ? formState.lore : [];
    handleFormChange('lore', currentLore.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.name.trim()) return;
    onSave({
      ...formState,
      id: character?.id || crypto.randomUUID(),
      createdAt: character?.createdAt || new Date().toISOString(),
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-background-primary h-full">
      <header className="flex items-center p-4 border-b border-border-neutral flex-shrink-0 bg-background-secondary/30">
          <h2 className="text-xl font-bold text-text-primary">{character ? 'Edit Character' : 'Create Character'}</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
        <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl mx-auto">
            <Section title="Core Identity">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-text-primary">Name</label>
                      <div className="mt-1 flex space-x-2">
                        <input type="text" value={formState.name} onChange={(e) => handleFormChange('name', e.target.value)} required className="flex-1 bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary focus:ring-primary-500"/>
                        <button type="button" onClick={() => handleAiAssist('name')} className="p-2 bg-background-tertiary rounded-md hover:text-primary-500 transition-colors" title="AI Suggest Name">
                            {isAiLoading === 'name' ? <SpinnerIcon className="w-5 h-5 animate-spin"/> : <SparklesIcon className="w-5 h-5"/>}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-primary">Tags (comma separated)</label>
                      <div className="mt-1 flex space-x-2">
                        <input type="text" value={formState.tags?.join(', ')} onChange={(e) => handleFormChange('tags', e.target.value.split(',').map(t => t.trim()))} className="flex-1 bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary"/>
                        <button type="button" onClick={() => handleAiAssist('tags')} className="p-2 bg-background-tertiary rounded-md hover:text-primary-500 transition-colors" title="AI Suggest Tags">
                            {isAiLoading === 'tags' ? <SpinnerIcon className="w-5 h-5 animate-spin"/> : <SparklesIcon className="w-5 h-5"/>}
                        </button>
                      </div>
                    </div>
                </div>
            </Section>

            <Section title="Lore & Key Facts">
                <div className="space-y-2">
                    {(Array.isArray(formState.lore) ? formState.lore : []).map((fact, i) => (
                        <div key={i} className="flex space-x-2 animate-in fade-in zoom-in-95">
                            <input type="text" value={fact} onChange={(e) => handleLoreChange(i, e.target.value)} className="flex-1 bg-background-secondary border border-border-strong rounded-md py-1 px-2 text-sm" placeholder="A fact about this character..."/>
                            <button type="button" onClick={() => handleLoreDelete(i)} className="text-accent-red p-1 hover:bg-accent-red/10 rounded"><TrashIcon className="w-4 h-4"/></button>
                        </div>
                    ))}
                    <div className="flex space-x-2">
                        <button type="button" onClick={handleLoreAdd} className="flex items-center space-x-2 text-primary-500 text-sm font-bold p-2 hover:bg-primary-500/10 rounded-md transition-colors">
                            <PlusIcon className="w-4 h-4"/> <span>Add Entry</span>
                        </button>
                        <button type="button" onClick={() => handleAiAssist('lore')} className="flex items-center space-x-2 text-text-secondary text-sm font-bold p-2 hover:bg-background-tertiary rounded-md transition-colors">
                             {isAiLoading === 'lore' ? <SpinnerIcon className="w-4 h-4 animate-spin"/> : <SparklesIcon className="w-4 h-4"/>} <span>AI Help Lore</span>
                        </button>
                    </div>
                </div>
            </Section>

            <Section title="Persona Details">
                <div>
                  <label className="block text-sm font-medium text-text-primary">Roleplay Instructions (System Prompt)</label>
                  <div className="mt-1 flex space-x-2">
                    <textarea value={formState.personality} onChange={(e) => handleFormChange('personality', e.target.value)} rows={6} className="flex-1 bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary font-mono text-sm"/>
                    <button type="button" onClick={() => handleAiAssist('personality')} className="p-2 bg-background-tertiary rounded-md h-fit hover:text-primary-500 transition-colors">
                        {isAiLoading === 'personality' ? <SpinnerIcon className="w-5 h-5 animate-spin"/> : <SparklesIcon className="w-5 h-5"/>}
                    </button>
                  </div>
                </div>
            </Section>

            <div className="flex justify-end space-x-4 pt-4 pb-10">
              <button type="button" onClick={onCancel} className="py-3 px-6 border border-border-strong rounded-lg text-text-primary font-bold hover:bg-background-tertiary transition-all">Cancel</button>
              <button type="submit" className="py-3 px-8 rounded-lg text-text-accent bg-primary-600 font-bold shadow-lg hover:bg-primary-500 transition-all active:scale-95">Save Character</button>
            </div>
        </form>
      </div>
    </div>
  );
};

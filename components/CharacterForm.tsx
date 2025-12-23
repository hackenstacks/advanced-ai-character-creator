
import React, { useState, useEffect, useRef } from 'react';
import { Character, ApiConfig, EmbeddingConfig, RagSource } from '../types.ts';
import * as ttsService from '../services/ttsService.ts';
import * as geminiService from '../services/geminiService.ts';
import { logger } from '../services/loggingService.ts';
import { UploadIcon } from './icons/UploadIcon.tsx';
import { SparklesIcon } from './icons/SparklesIcon.tsx';
import { SpinnerIcon } from './icons/SpinnerIcon.tsx';
import { TerminalIcon } from './icons/TerminalIcon.tsx';
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
        <div className="rounded-md border border-border-neutral bg-background-secondary/50">
            <button type="button" onClick={() => setIsOpen(!isOpen)} className="w-full text-left p-4 flex justify-between items-center">
                <h3 className="text-lg font-medium text-text-primary">{title}</h3>
                <svg className={`w-5 h-5 text-text-secondary transform transition-transform ${isOpen ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {isOpen && <div className="p-4 border-t border-border-neutral space-y-4">{children}</div>}
        </div>
    );
}

export const CharacterForm: React.FC<CharacterFormProps> = ({ character, onSave, onCancel, onGenerateImage, availableDocuments }) => {
  const [formState, setFormState] = useState<Character>({} as Character);
  const [isAiLoading, setIsAiLoading] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>('pollinations');
  const avatarFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (character) {
        setFormState({
            ...character,
            tags: character.tags || [],
            lore: character.lore || [],
            memory: character.memory || 'No memories yet.',
            characterType: character.characterType || 'character',
            knowledgeSourceIds: character.knowledgeSourceIds || [],
            embeddingConfig: character.embeddingConfig || defaultEmbeddingConfig,
            apiConfig: character.apiConfig || defaultApiConfig,
            pluginEnabled: character.pluginEnabled || false,
            pluginCode: character.pluginCode || '',
            voiceId: character.voiceId || 'Puck',
            searchEnabled: character.searchEnabled || false,
            thinkingEnabled: character.thinkingEnabled || false,
            terminalEnabled: character.terminalEnabled || false,
            dynamicAvatarEnabled: character.dynamicAvatarEnabled || false,
        });
        const service = character.apiConfig?.service || 'pollinations';
        setSelectedPreset(service);
    } else {
        setFormState({
            id: '', name: '', description: '', personality: '', avatarUrl: '', tags: [], createdAt: '', 
            physicalAppearance: '', personalityTraits: '', lore: [], memory: 'No memories yet.', voiceId: 'Puck',
            characterType: 'character', apiConfig: defaultApiConfig, ragEnabled: false, embeddingConfig: defaultEmbeddingConfig,
            knowledgeSourceIds: [], pluginEnabled: false, pluginCode: '', searchEnabled: false, thinkingEnabled: false,
            terminalEnabled: false, dynamicAvatarEnabled: false,
        });
    }
  }, [character]);

  const handleFormChange = <K extends keyof Character>(key: K, value: Character[K]) => {
      setFormState(prev => ({ ...prev, [key]: value }));
  };

  const handleAiAssist = async (field: keyof Character) => {
    if (isAiLoading) return;
    setIsAiLoading(String(field));
    try {
        const prompt = `Based on the current context of this character creation (Name: ${formState.name || 'New Character'}, Description: ${formState.description || 'N/A'}), generate a high-quality ${String(field)} content. Keep it within character and immersive. Return ONLY the content for that field without extra formatting.`;
        const result = await geminiService.generateContent(prompt);
        if (result) handleFormChange(field, result as any);
    } catch (e) {
        logger.error("AI Assist failed", e);
    } finally {
        setIsAiLoading(null);
    }
  };

  // FIX: Explicitly cast currentLore to string[] to resolve 'unknown[]' type inference issue on line 184.
  const handleLoreAdd = () => {
    const currentLore = (formState.lore || []) as string[];
    handleFormChange('lore', [...currentLore, '']);
  };

  // FIX: Explicitly cast currentLore to string[] for consistent type handling.
  const handleLoreChange = (idx: number, val: string) => {
    const currentLore = (formState.lore || []) as string[];
    const updated = [...currentLore];
    updated[idx] = val;
    handleFormChange('lore', updated);
  };

  // FIX: Explicitly cast currentLore to string[] for consistent type handling.
  const handleLoreDelete = (idx: number) => {
    const currentLore = (formState.lore || []) as string[];
    handleFormChange('lore', currentLore.filter((_, i) => i !== idx));
  };

  const handleToggleKnowledge = (id: string) => {
    const current = new Set(formState.knowledgeSourceIds || []);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    handleFormChange('knowledgeSourceIds', Array.from(current));
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
      <header className="flex items-center p-4 border-b border-border-neutral flex-shrink-0">
          <h2 className="text-xl font-bold text-text-primary">{character ? 'Edit Character' : 'Create Character'}</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl mx-auto">
            <Section title="Core Identity">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-text-primary">Name</label>
                      <div className="mt-1 flex space-x-2">
                        <input type="text" value={formState.name} onChange={(e) => handleFormChange('name', e.target.value)} required className="flex-1 bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary focus:ring-primary-500"/>
                        <button type="button" onClick={() => handleAiAssist('name')} className="p-2 bg-background-tertiary rounded-md" title="AI Suggest Name">
                            {isAiLoading === 'name' ? <SpinnerIcon className="w-5 h-5 animate-spin"/> : <SparklesIcon className="w-5 h-5"/>}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-primary">Tags (comma separated)</label>
                      <div className="mt-1 flex space-x-2">
                        <input type="text" value={formState.tags?.join(', ')} onChange={(e) => handleFormChange('tags', e.target.value.split(',').map(t => t.trim()))} className="flex-1 bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary"/>
                        <button type="button" onClick={() => handleAiAssist('tags')} className="p-2 bg-background-tertiary rounded-md" title="AI Suggest Tags">
                            {isAiLoading === 'tags' ? <SpinnerIcon className="w-5 h-5 animate-spin"/> : <SparklesIcon className="w-5 h-5"/>}
                        </button>
                      </div>
                    </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary">Short Description</label>
                  <div className="mt-1 flex space-x-2">
                    <textarea value={formState.description} onChange={(e) => handleFormChange('description', e.target.value)} rows={2} className="flex-1 bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary"/>
                    <button type="button" onClick={() => handleAiAssist('description')} className="p-2 bg-background-tertiary rounded-md h-fit" title="AI Assist Description">
                        {isAiLoading === 'description' ? <SpinnerIcon className="w-5 h-5 animate-spin"/> : <SparklesIcon className="w-5 h-5"/>}
                    </button>
                  </div>
                </div>
            </Section>

            <Section title="Persona & Details">
                 <div>
                  <label className="block text-sm font-medium text-text-primary">Physical Appearance</label>
                  <div className="mt-1 flex space-x-2">
                    <textarea value={formState.physicalAppearance} onChange={(e) => handleFormChange('physicalAppearance', e.target.value)} rows={3} className="flex-1 bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary"/>
                    <button type="button" onClick={() => handleAiAssist('physicalAppearance')} className="p-2 bg-background-tertiary rounded-md h-fit">
                        {isAiLoading === 'physicalAppearance' ? <SpinnerIcon className="w-5 h-5 animate-spin"/> : <SparklesIcon className="w-5 h-5"/>}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary">Personality Traits</label>
                  <div className="mt-1 flex space-x-2">
                    <textarea value={formState.personalityTraits} onChange={(e) => handleFormChange('personalityTraits', e.target.value)} rows={2} className="flex-1 bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary"/>
                    <button type="button" onClick={() => handleAiAssist('personalityTraits')} className="p-2 bg-background-tertiary rounded-md h-fit">
                        {isAiLoading === 'personalityTraits' ? <SpinnerIcon className="w-5 h-5 animate-spin"/> : <SparklesIcon className="w-5 h-5"/>}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary">Roleplay Instructions (System Prompt)</label>
                  <div className="mt-1 flex space-x-2">
                    <textarea value={formState.personality} onChange={(e) => handleFormChange('personality', e.target.value)} rows={6} className="flex-1 bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary font-mono text-sm"/>
                    <button type="button" onClick={() => handleAiAssist('personality')} className="p-2 bg-background-tertiary rounded-md h-fit">
                        {isAiLoading === 'personality' ? <SpinnerIcon className="w-5 h-5 animate-spin"/> : <SparklesIcon className="w-5 h-5"/>}
                    </button>
                  </div>
                </div>
            </Section>

            <Section title="Lore & Key Facts">
                <div className="space-y-2">
                    {(formState.lore || []).map((fact, i) => (
                        <div key={i} className="flex space-x-2">
                            <input type="text" value={fact} onChange={(e) => handleLoreChange(i, e.target.value)} className="flex-1 bg-background-secondary border border-border-strong rounded-md py-1 px-2 text-sm" placeholder="A fact about this character..."/>
                            <button type="button" onClick={() => handleLoreDelete(i)} className="text-accent-red p-1"><TrashIcon className="w-4 h-4"/></button>
                        </div>
                    ))}
                    <button type="button" onClick={handleLoreAdd} className="flex items-center space-x-2 text-primary-500 text-sm font-bold p-2 hover:bg-background-tertiary rounded-md">
                        <PlusIcon className="w-4 h-4"/> <span>Add Lore Entry</span>
                    </button>
                </div>
            </Section>

            <Section title="Knowledge Base (RAG)">
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-background-tertiary/20 rounded-lg">
                        <div>
                            <p className="font-medium text-text-primary">Enable RAG</p>
                            <p className="text-xs text-text-secondary">Allow character to search indexed documents.</p>
                        </div>
                        <input type="checkbox" checked={formState.ragEnabled} onChange={e => handleFormChange('ragEnabled', e.target.checked)} className="h-5 w-5"/>
                    </div>
                    {formState.ragEnabled && (
                        <div className="space-y-2">
                            <p className="text-sm font-medium text-text-primary">Select Documents</p>
                            <div className="max-h-40 overflow-y-auto border border-border-neutral rounded p-2 space-y-1">
                                {availableDocuments.length === 0 ? (
                                    <p className="text-xs text-text-secondary p-2">No documents in library. Upload some in the Library panel.</p>
                                ) : availableDocuments.map(doc => (
                                    <div key={doc.id} className="flex items-center space-x-2 hover:bg-background-tertiary p-1 rounded cursor-pointer" onClick={() => handleToggleKnowledge(doc.id)}>
                                        <input type="checkbox" checked={(formState.knowledgeSourceIds || []).includes(doc.id)} readOnly className="h-4 w-4 rounded border-border-strong"/>
                                        <span className="text-sm text-text-primary truncate">{doc.fileName}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </Section>

            <Section title="Advanced AI Traits">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex items-center justify-between p-3 bg-background-tertiary/20 rounded-lg">
                        <div>
                            <p className="font-medium text-text-primary">Deep Thinking</p>
                            <p className="text-xs text-text-secondary">Enables reasoning chain (Gemini 3 Pro).</p>
                        </div>
                        <input type="checkbox" checked={formState.thinkingEnabled} onChange={e => handleFormChange('thinkingEnabled', e.target.checked)} className="h-5 w-5"/>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-background-tertiary/20 rounded-lg">
                        <div>
                            <p className="font-medium text-text-primary">Google Search</p>
                            <p className="text-xs text-text-secondary">Access to real-time information.</p>
                        </div>
                        <input type="checkbox" checked={formState.searchEnabled} onChange={e => handleFormChange('searchEnabled', e.target.checked)} className="h-5 w-5"/>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-background-tertiary/20 rounded-lg">
                        <div>
                            <p className="font-medium text-text-primary">Terminal Access</p>
                            <p className="text-xs text-text-secondary">Execute simulated shell commands.</p>
                        </div>
                        <input type="checkbox" checked={formState.terminalEnabled} onChange={e => handleFormChange('terminalEnabled', e.target.checked)} className="h-5 w-5"/>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-background-tertiary/20 rounded-lg">
                        <div>
                            <p className="font-medium text-text-primary">Dynamic Avatar</p>
                            <p className="text-xs text-text-secondary">Avatar changes with mood/context.</p>
                        </div>
                        <input type="checkbox" checked={formState.dynamicAvatarEnabled} onChange={e => handleFormChange('dynamicAvatarEnabled', e.target.checked)} className="h-5 w-5"/>
                    </div>
                </div>
            </Section>

            <Section title="API Configuration">
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-text-primary">API Service Preset</label>
                        <select value={selectedPreset} onChange={(e) => {
                            setSelectedPreset(e.target.value);
                            const p = API_PRESETS[e.target.value];
                            handleFormChange('apiConfig', { service: p.service, apiEndpoint: p.endpoint, model: p.models[0], apiKey: formState.apiConfig?.apiKey });
                        }} className="mt-1 block w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary">
                            {Object.entries(API_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-text-primary">Model Name</label>
                            <input type="text" value={formState.apiConfig?.model} onChange={e => handleFormChange('apiConfig', { ...formState.apiConfig!, model: e.target.value })} className="mt-1 block w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary" placeholder="e.g. gpt-4o, gemini-3-flash-preview, llama-3..."/>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-text-primary">Custom API Endpoint</label>
                            <input type="text" value={formState.apiConfig?.apiEndpoint} onChange={e => handleFormChange('apiConfig', { ...formState.apiConfig!, apiEndpoint: e.target.value })} className="mt-1 block w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary" placeholder="https://api..."/>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-text-primary">API Key (Optional)</label>
                            <input type="password" value={formState.apiConfig?.apiKey} onChange={e => handleFormChange('apiConfig', { ...formState.apiConfig!, apiKey: e.target.value })} className="mt-1 block w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary" placeholder="Enter key if required..."/>
                        </div>
                    </div>
                </div>
            </Section>

            <div className="flex justify-end space-x-4 pt-4 pb-10">
              <button type="button" onClick={onCancel} className="py-3 px-6 border border-border-strong rounded-lg text-text-primary font-bold hover:bg-background-tertiary">Cancel</button>
              <button type="submit" className="py-3 px-8 rounded-lg text-text-accent bg-primary-600 font-bold shadow-lg hover:bg-primary-500">Save Character</button>
            </div>
        </form>
      </div>
    </div>
  );
};

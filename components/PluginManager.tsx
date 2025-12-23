import React, { useState, useEffect, useRef } from 'react';
import { Plugin, ApiConfig, ConfirmationRequest } from '../types.ts';
import { logger } from '../services/loggingService.ts';
import { PlusIcon } from './icons/PlusIcon.tsx';
import { TrashIcon } from './icons/TrashIcon.tsx';
import { EditIcon } from './icons/EditIcon.tsx';
import { PowerIcon } from './icons/PowerIcon.tsx';
import { UploadIcon } from './icons/UploadIcon.tsx';
import { DownloadIcon } from './icons/DownloadIcon.tsx';
// Add missing ImageIcon import
import { ImageIcon } from './icons/ImageIcon.tsx';

interface PluginManagerProps {
  plugins: Plugin[];
  onPluginsUpdate: (plugins: Plugin[]) => void;
  onSetConfirmation: (request: ConfirmationRequest | null) => void;
}

const examplePluginCode = `// Example Plugin: UPPERCASE every message
nexus.hooks.register('beforeMessageSend', (payload) => {
  return { content: payload.content.toUpperCase() };
});
`;

const imageStyles = ["Default (None)", "Anime/Manga", "Photorealistic", "Digital Painting", "Fantasy Art", "Cyberpunk", "Vintage Photo", "Low Poly", "Custom"];

const PROVIDER_MODELS: Record<string, string[]> = {
    'pollinations': [
        'flux', 
        'flux-realism', 
        'flux-anime',
        'flux-3d',
        'any-dark', 
        'turbo', 
        'midjourney', 
        'unity', 
        'niji',
        'surreal',
        'impressionism'
    ],
    'aihorde': [
        'stable_diffusion',
        'stable_diffusion_2.1',
        'Dreamshaper',
        'Realistic Vision',
        'Anything Diffusion',
        'Midjourney Diffusion',
        'OpenJourney'
    ],
    'huggingface': [
        'stabilityai/stable-diffusion-xl-base-1.0',
        'runwayml/stable-diffusion-v1-5',
        'black-forest-labs/FLUX.1-dev',
        'black-forest-labs/FLUX.1-schnell'
    ],
    'stability': [
        'stable-diffusion-xl-1024-v1-0',
        'stable-diffusion-v1-6'
    ],
    'gemini': ['gemini-2.5-flash-image'],
    'default': ['gemini-2.5-flash-image'],
    'openai': ['dall-e-3', 'dall-e-2']
};

export const PluginManager: React.FC<PluginManagerProps> = ({ plugins, onPluginsUpdate, onSetConfirmation }) => {
  const [editingPlugin, setEditingPlugin] = useState<Plugin | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formState, setFormState] = useState<Omit<Plugin, 'id' | 'enabled'>>({ name: '', description: '', code: '', settings: {} });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingPlugin) {
      setFormState({
        name: editingPlugin.name,
        description: editingPlugin.description,
        code: editingPlugin.code,
        settings: editingPlugin.settings || {},
      });
      setIsCreating(false);
    } else if (isCreating) {
      setFormState({
        name: '',
        description: '',
        code: examplePluginCode,
        settings: {}
      });
    }
  }, [editingPlugin, isCreating]);

  const handleSave = () => {
    if (!formState.name.trim()) {
      alert('Plugin name cannot be empty.');
      return;
    }
    
    let updatedPlugins;
    if (editingPlugin) {
      updatedPlugins = plugins.map(p => p.id === editingPlugin.id ? { ...editingPlugin, ...formState } : p);
    } else {
      const newPlugin: Plugin = { ...formState, id: crypto.randomUUID(), enabled: false };
      updatedPlugins = [...plugins, newPlugin];
    }
    onPluginsUpdate(updatedPlugins);
    setEditingPlugin(null);
    setIsCreating(false);
  };
  
  const handleDelete = (pluginId: string) => {
    onSetConfirmation({
        message: `Delete plugin?`,
        onConfirm: () => {
            onPluginsUpdate(plugins.filter(p => p.id !== pluginId));
            onSetConfirmation(null);
        },
        onCancel: () => onSetConfirmation(null),
    });
  };

  const handleToggle = (pluginId: string) => {
    if (pluginId === 'default-image-generator' || pluginId === 'default-tts-narrator') return;
    onPluginsUpdate(plugins.map(p => p.id === pluginId ? { ...p, enabled: !p.enabled } : p));
  };
  
  const handleCancel = () => {
    setEditingPlugin(null);
    setIsCreating(false);
  };
  
  const handleSettingsChange = (key: string, value: any) => {
      setFormState(prev => ({
          ...prev,
          settings: {
              ...prev.settings,
              [key]: value
          }
      }));
  };
  
  const isDefaultImagePlugin = editingPlugin?.id === 'default-image-generator';

  const getCurrentServiceModels = () => {
      const service = formState.settings?.service || 'pollinations';
      return PROVIDER_MODELS[service] || [];
  };

  const currentModels = getCurrentServiceModels();
  const showApiEndpoint = ['openai'].includes(formState.settings?.service);
  const showApiKey = ['openai', 'gemini', 'stability', 'huggingface', 'aihorde'].includes(formState.settings?.service);

  if (editingPlugin || isCreating) {
     return (
      <div className="flex-1 flex flex-col bg-background-primary h-full">
         <header className="flex items-center p-4 border-b border-border-neutral flex-shrink-0">
            <h2 className="text-xl font-bold text-text-primary">{isDefaultImagePlugin ? 'Image Generation Config' : (editingPlugin ? 'Edit Plugin' : 'Create Plugin')}</h2>
        </header>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="space-y-2">
                <label className="block text-sm font-bold text-text-secondary">Plugin Identity</label>
                <input
                    type="text"
                    placeholder="Plugin Name"
                    value={formState.name}
                    onChange={(e) => setFormState(s => ({...s, name: e.target.value}))}
                    className="w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary focus:outline-none focus:ring-primary-500"
                    readOnly={isDefaultImagePlugin}
                />
                <textarea
                    placeholder="Plugin Description"
                    value={formState.description}
                    onChange={(e) => setFormState(s => ({...s, description: e.target.value}))}
                    rows={2}
                    className="w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary focus:outline-none focus:ring-primary-500"
                />
              </div>

              {isDefaultImagePlugin && (
                <div className="p-4 rounded-lg border border-primary-500/20 bg-primary-500/5 space-y-4">
                  <h3 className="text-lg font-bold text-primary-600 flex items-center gap-2">
                    <ImageIcon className="w-5 h-5" /> Image API Settings
                  </h3>
                   
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div>
                            <label className="block text-sm font-medium text-text-secondary">Art Style (Prompt Prefix)</label>
                            <select
                                value={formState.settings?.style || 'Default (None)'}
                                onChange={(e) => handleSettingsChange('style', e.target.value)}
                                className="mt-1 block w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary focus:ring-primary-500"
                            >
                                {imageStyles.map(style => <option key={style} value={style}>{style}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-text-secondary">Provider (Service)</label>
                            <select 
                                value={formState.settings?.service || 'pollinations'}
                                onChange={(e) => {
                                    handleSettingsChange('service', e.target.value);
                                    const models = PROVIDER_MODELS[e.target.value] || [];
                                    handleSettingsChange('model', models.length > 0 ? models[0] : '');
                                }}
                                className="mt-1 block w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary focus:ring-primary-500 font-bold"
                            >
                                <option value="pollinations">Pollinations.ai (Free, No Key) - DEFAULT</option>
                                <option value="aihorde">AI Horde (Free/Kudos, Slow)</option>
                                <option value="huggingface">Hugging Face (Free Tier/Pro)</option>
                                <option value="stability">Stability.ai (Paid)</option>
                                <option value="gemini">Google Gemini (Custom Key)</option>
                                <option value="default">Google Gemini (Env Key)</option>
                                <option value="openai">OpenAI / Compatible (e.g. Local)</option>
                            </select>
                        </div>
                   </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-text-secondary">Model selection</label>
                            <div className="flex gap-2 flex-col">
                                <select
                                    value={currentModels.includes(formState.settings?.model) ? formState.settings?.model : 'custom'}
                                    onChange={(e) => {
                                        if(e.target.value !== 'custom') {
                                            handleSettingsChange('model', e.target.value);
                                        }
                                    }}
                                    className="mt-1 block w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary focus:ring-primary-500"
                                >
                                    {currentModels.map(m => <option key={m} value={m}>{m}</option>)}
                                    <option value="custom">-- Enter Custom Model Name --</option>
                                </select>
                                {(e => !currentModels.includes(formState.settings?.model) || formState.settings?.model === 'custom') && (
                                    <input
                                        type="text"
                                        value={formState.settings?.model || ''}
                                        onChange={(e) => handleSettingsChange('model', e.target.value)}
                                        className="block w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary focus:ring-primary-500"
                                        placeholder="Enter model name (e.g. flux-pro, dall-e-3)"
                                    />
                                )}
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-text-secondary">Global Negative Prompt</label>
                            <input
                                type="text"
                                value={formState.settings?.negativePrompt || ''}
                                onChange={(e) => handleSettingsChange('negativePrompt', e.target.value)}
                                className="mt-1 block w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary focus:ring-primary-500"
                                placeholder="ugly, deformed, blurry..."
                            />
                        </div>
                    </div>

                    {showApiEndpoint && (
                        <div>
                            <label className="block text-sm font-medium text-text-secondary">Custom API Endpoint (URL)</label>
                            <input
                                type="text"
                                value={formState.settings?.apiEndpoint || ''}
                                onChange={(e) => handleSettingsChange('apiEndpoint', e.target.value)}
                                className="mt-1 block w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary focus:ring-primary-500"
                                placeholder="https://api.openai.com/v1/images/generations"
                            />
                        </div>
                    )}

                    {showApiKey && (
                        <div>
                          <label className="block text-sm font-medium text-text-secondary">API Key (Optional/Provider-specific)</label>
                          <input
                            type="password"
                            value={formState.settings?.apiKey || ''}
                            onChange={(e) => handleSettingsChange('apiKey', e.target.value)}
                            className="mt-1 block w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary focus:ring-primary-500"
                            placeholder="Enter your API key"
                          />
                        </div>
                    )}
                </div>
              )}
              <div className="flex flex-col h-96">
                <label className="block text-sm font-bold text-text-secondary mb-1">Source Code (JavaScript)</label>
                <textarea
                  value={formState.code}
                  onChange={(e) => setFormState(s => ({...s, code: e.target.value}))}
                  className={`flex-1 w-full bg-background-secondary border border-border-strong rounded-md py-2 px-3 text-text-primary font-mono text-sm focus:outline-none focus:ring-primary-500 resize-none ${isDefaultImagePlugin ? 'opacity-50 pointer-events-none' : ''}`}
                  spellCheck="false"
                  readOnly={isDefaultImagePlugin}
                />
              </div>
              <div className="flex justify-end space-x-4 pb-4">
                <button onClick={handleCancel} className="py-2 px-6 rounded-md text-text-primary bg-background-tertiary hover:bg-opacity-80">Cancel</button>
                <button onClick={handleSave} className="py-2 px-6 rounded-md text-white bg-primary-600 hover:bg-primary-500 font-bold">Save Configuration</button>
              </div>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-background-secondary/20">
        <header className="flex items-center p-4 border-b border-border-neutral flex-shrink-0 bg-background-secondary">
            <div className="flex-1 flex justify-between items-center">
                <h2 className="text-xl font-bold text-text-primary">Plugins & Integrations</h2>
                <div className="flex items-center space-x-2">
                    <input type="file" ref={fileInputRef} onChange={handleSettingsChange} className="hidden" />
                    <button onClick={() => setIsCreating(true)} className="flex items-center space-x-2 py-2 px-4 rounded-md text-text-accent bg-primary-600 hover:bg-primary-500 font-bold shadow-sm">
                        <PlusIcon className="w-5 h-5" />
                        <span>New Plugin</span>
                    </button>
                </div>
            </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
            <div className="space-y-4 max-w-4xl mx-auto">
                {plugins.map(plugin => (
                    <div key={plugin.id} className="bg-background-primary p-5 rounded-xl border border-border-neutral flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <p className="text-lg font-bold text-text-primary truncate">{plugin.name}</p>
                            {plugin.id === 'default-image-generator' && <span className="bg-primary-500/10 text-primary-600 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Image Core</span>}
                        </div>
                        <p className="text-sm text-text-secondary truncate mt-1">{plugin.description}</p>
                      </div>
                      <div className="flex items-center space-x-2 ml-4">
                        <button onClick={() => handleToggle(plugin.id)} title={plugin.enabled ? 'Enabled' : 'Disabled'} className="p-2">
                          <PowerIcon className={`w-6 h-6 ${plugin.enabled ? 'text-accent-green' : 'text-text-secondary opacity-50'}`}/>
                        </button>
                        <button onClick={() => setEditingPlugin(plugin)} className="p-2 text-text-secondary hover:text-text-primary" title="Configure"><EditIcon className="w-6 h-6" /></button>
                        {plugin.id !== 'default-image-generator' && (
                            <button onClick={() => handleDelete(plugin.id)} className="p-2 text-text-secondary hover:text-accent-red" title="Delete"><TrashIcon className="w-6 h-6" /></button>
                        )}
                      </div>
                    </div>
                ))}
            </div>
        </div>
    </div>
  );
};
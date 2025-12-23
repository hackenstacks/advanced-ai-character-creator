import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Character, ChatSession, AppData, Plugin, GeminiApiRequest, Message, CryptoKeys, RagSource, ConfirmationRequest, UISettings, Lorebook, FileSystemState } from '../types.ts';
import { loadData, saveData } from '../services/secureStorage.ts';
import * as ragService from '../services/ragService.ts';
import * as fileSystemService from '../services/fileSystemService.ts';
import { CharacterList } from './CharacterList.tsx';
import { ChatList } from './ChatList.tsx';
import { CharacterForm } from './CharacterForm.tsx';
import { ChatInterface } from './ChatInterface.tsx';
import { PluginManager } from './PluginManager.tsx';
import { LogViewer } from './LogViewer.tsx';
import { HelpModal } from './HelpModal.tsx';
import { LorebookManager } from './LorebookManager.tsx';
import { DocumentLibrary } from './DocumentLibrary.tsx';
import { ChatSelectionModal } from './ChatSelectionModal.tsx';
import { ConfirmationModal } from './ConfirmationModal.tsx';
import { ThemeSwitcher } from './ThemeSwitcher.tsx';
import { AppearanceModal } from './AppearanceModal.tsx';
import { PluginSandbox } from '../services/pluginSandbox.ts';
import * as geminiService from '../services/geminiService.ts';
import * as compatibilityService from '../services/compatibilityService.ts';
import * as cryptoService from '../services/cryptoService.ts';
import { logger } from '../services/loggingService.ts';
import { DownloadIcon } from './icons/DownloadIcon.tsx';
import { UploadIcon } from './icons/UploadIcon.tsx';
import { CodeIcon } from './icons/CodeIcon.tsx';
import { TerminalIcon } from './icons/TerminalIcon.tsx';
import { HelpIcon } from './icons/HelpIcon.tsx';
import { PlusIcon } from './icons/PlusIcon.tsx';
import { ChatBubbleIcon } from './icons/ChatBubbleIcon.tsx';
import { UsersIcon } from './icons/UsersIcon.tsx';
import { PaletteIcon } from './icons/PaletteIcon.tsx';
import { GlobeIcon } from './icons/GlobeIcon.tsx';
import { FolderIcon } from './icons/FolderIcon.tsx';

const defaultImagePlugin: Plugin = {
    id: 'default-image-generator',
    name: 'Image Generation',
    description: 'Generates images from prompts. Supports Pollinations (Free), AI Horde (Free), Hugging Face, Stability.ai, Gemini, and more.',
    enabled: true,
    code: `
nexus.hooks.register('generateImage', async (payload) => {
  try {
    let prompt;
    if (payload.type === 'summary') {
      nexus.log('Summarizing content for image prompt...');
      const summaryPrompt = \`Based on the following conversation, create a short, visually descriptive prompt for an image generation model. The prompt should capture the essence of the last few messages. Be creative and concise. Conversation:\\n\\n\${payload.value}\`;
      prompt = await nexus.gemini.generateContent(summaryPrompt);
      nexus.log('Generated prompt from summary:', prompt);
    } else {
      prompt = payload.value;
      nexus.log('Using direct prompt:', prompt);
    }
    const settings = payload.settings || {};
    const imageUrl = await nexus.gemini.generateImage(prompt, settings);
    return { url: imageUrl };
  } catch (error) {
    nexus.log('Error in image generation plugin:', error);
    return { error: String(error) };
  }
});
`,
    settings: {
        service: 'pollinations',
        model: 'flux',
        style: 'Default (None)',
        negativePrompt: '',
    }
};

const defaultTtsPlugin: Plugin = {
    id: 'default-tts-narrator',
    name: 'Text-to-Speech (TTS)',
    description: 'Enables text-to-speech functionality in the chat interface.',
    enabled: true,
    code: `nexus.log('TTS Plugin loaded.');`,
    settings: {}
};

type ActivePanel = 'chats' | 'characters' | 'lorebooks' | 'library' | 'none';
type ActiveView = 'chat' | 'character-form' | 'plugins' | 'lorebooks' | 'library';

export const MainLayout: React.FC = () => {
    const [appData, setAppData] = useState<AppData>({ characters: [], chatSessions: [], plugins: [], lorebooks: [], knowledgeBase: [] });
    const [fileSystemState, setFileSystemState] = useState<FileSystemState>(fileSystemService.createDefaultFileSystem());
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
    const [activeView, setActiveView] = useState<ActiveView>('chat');
    const [activePanel, setActivePanel] = useState<ActivePanel>('chats');
    const [isLogViewerVisible, setIsLogViewerVisible] = useState(false);
    const [isHelpVisible, setIsHelpVisible] = useState(false);
    const [isChatModalVisible, setIsChatModalVisible] = useState(false);
    const [isAppearanceModalVisible, setIsAppearanceModalVisible] = useState(false);
    const [confirmationRequest, setConfirmationRequest] = useState<ConfirmationRequest | null>(null);
    const [showArchivedChats, setShowArchivedChats] = useState(false);
    const [showArchivedCharacters, setShowArchivedCharacters] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const sandboxes = useRef(new Map<string, PluginSandbox>()).current;

    const persistData = useCallback(async (data: AppData) => {
        await saveData(data);
    }, []);

    const updateFileSystem = useCallback((newState: FileSystemState) => {
        setFileSystemState(newState);
        setAppData(prev => {
            const updated = { ...prev, fileSystem: newState };
            persistData(updated);
            return updated;
        });
    }, [persistData]);

    const handlePanelToggle = (panel: ActivePanel) => {
        setActivePanel(prev => (prev === panel ? 'none' : panel));
    };

    const handlePluginApiRequest = useCallback(async (request: GeminiApiRequest) => {
        switch (request.type) {
            case 'generateContent':
                return await geminiService.generateContent(request.prompt);
            case 'generateImage':
                const imagePlugin = appData.plugins?.find(p => p.id === 'default-image-generator');
                const settings = { ...imagePlugin?.settings, ...request.settings };
                return await geminiService.generateImageFromPrompt(request.prompt, settings);
            default:
                throw new Error('Unknown API request type from plugin.');
        }
    }, [appData.plugins]);

    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const data = await loadData();
                let dataNeedsSave = false;
                if (!data.userKeys) {
                    const keyPair = await cryptoService.generateSigningKeyPair();
                    data.userKeys = {
                        publicKey: await cryptoService.exportKey(keyPair.publicKey),
                        privateKey: await cryptoService.exportKey(keyPair.privateKey),
                    };
                    dataNeedsSave = true;
                }
                if (!data.knowledgeBase) data.knowledgeBase = [];
                if (!data.lorebooks) data.lorebooks = [];
                if (!data.fileSystem) {
                    data.fileSystem = fileSystemService.createDefaultFileSystem();
                    dataNeedsSave = true;
                }
                setFileSystemState(data.fileSystem);
                const defaultPlugins = [defaultImagePlugin, defaultTtsPlugin];
                if (!data.plugins) data.plugins = [];
                defaultPlugins.forEach(defaultPlugin => {
                    let hasPlugin = data.plugins!.some(p => p.id === defaultPlugin.id);
                    if (!hasPlugin) {
                        data.plugins!.push(defaultPlugin);
                        dataNeedsSave = true;
                    }
                });
                if (dataNeedsSave) await persistData(data);
                setAppData(data);
                if (data.chatSessions.length > 0) {
                    setSelectedChatId(data.chatSessions.find(cs => !cs.isArchived)?.id || data.chatSessions[0].id);
                    setActiveView('chat');
                }
            } catch (error) {
                logger.error("Failed to load initial data.", error);
            }
        };
        loadInitialData();
        return () => sandboxes.forEach(s => s.terminate());
    }, [persistData]);

    useEffect(() => {
        appData.plugins?.forEach(async (plugin) => {
            const existingSandbox = sandboxes.get(plugin.id);
            if (plugin.enabled && !existingSandbox) {
                try {
                    const sandbox = new PluginSandbox(handlePluginApiRequest);
                    await sandbox.loadCode(plugin.code);
                    sandboxes.set(plugin.id, sandbox);
                } catch (error) {
                    logger.error(`Failed to load plugin "${plugin.name}":`, error);
                }
            } else if (!plugin.enabled && existingSandbox) {
                existingSandbox.terminate();
                sandboxes.delete(plugin.id);
            }
        });
    }, [appData.plugins, handlePluginApiRequest]);

    const handleSaveCharacter = async (character: Character) => {
        const isNew = !appData.characters.some(c => c.id === character.id);
        let updatedCharacter = { ...character };
        if (isNew || !updatedCharacter.keys) {
            const keyPair = await cryptoService.generateSigningKeyPair();
            updatedCharacter.keys = {
                publicKey: await cryptoService.exportKey(keyPair.publicKey),
                privateKey: await cryptoService.exportKey(keyPair.privateKey),
            };
        }
        if (appData.userKeys) {
            const userPrivateKey = await cryptoService.importKey(appData.userKeys.privateKey, 'sign');
            const dataToSign: Partial<Character> = { ...updatedCharacter };
            delete dataToSign.signature; 
            const canonicalString = cryptoService.createCanonicalString(dataToSign);
            updatedCharacter.signature = await cryptoService.sign(canonicalString, userPrivateKey);
            updatedCharacter.userPublicKeyJwk = appData.userKeys.publicKey;
        }
        const updatedCharacters = isNew 
            ? [...appData.characters, updatedCharacter] 
            : appData.characters.map(c => c.id === updatedCharacter.id ? updatedCharacter : c);
        const updatedData = { ...appData, characters: updatedCharacters };
        setAppData(updatedData);
        await persistData(updatedData);
        setActiveView('chat');
        if (isNew) setEditingCharacter(null);
    };

    const handleCharacterUpdate = useCallback((character: Character) => {
        setAppData(prev => {
            const updatedCharacters = prev.characters.map(c => c.id === character.id ? character : c);
            const updatedData = { ...prev, characters: updatedCharacters };
            persistData(updatedData);
            return updatedData;
        });
    }, [persistData]);

    const handleCreateChat = (name: string, characterIds: string[], lorebookIds: string[]) => {
        const newSession: ChatSession = { id: crypto.randomUUID(), name, characterIds, messages: [], uiSettings: {}, lorebookIds };
        const updatedSessions = [...appData.chatSessions, newSession];
        const updatedData = { ...appData, chatSessions: updatedSessions };
        setAppData(updatedData);
        persistData(updatedData);
        setSelectedChatId(newSession.id);
        setActiveView('chat');
        setIsChatModalVisible(false);
    };

    const handleSessionUpdate = useCallback((session: ChatSession) => {
        setAppData(prev => {
            const updatedSessions = prev.chatSessions.map(s => s.id === session.id ? session : s);
            const updatedData = { ...prev, chatSessions: updatedSessions };
            persistData(updatedData);
            return updatedData;
        });
    }, [persistData]);

    const triggerPluginHook = useCallback(async <T, R,>(hookName: string, data: T): Promise<R> => {
        let processedData: any = data;
        const enabledPlugins = appData.plugins?.filter(p => p.enabled) || [];
        for (const plugin of enabledPlugins) {
            const sandbox = sandboxes.get(plugin.id);
            if (sandbox) {
                try {
                    processedData = await sandbox.executeHook(hookName, processedData);
                } catch (error) {
                    logger.error(`Plugin error '${plugin.name}':`, error);
                }
            }
        }
        return processedData as R;
    }, [appData.plugins]);

    const handleUiSettingsUpdate = useCallback(async (newSettings: UISettings) => {
        if (!selectedChatId) return;
        const updatedSessions = appData.chatSessions.map(s => s.id === selectedChatId ? { ...s, uiSettings: newSettings } : s);
        const updatedData = { ...appData, chatSessions: updatedSessions };
        setAppData(updatedData);
        await persistData(updatedData);
    }, [appData, persistData, selectedChatId]);

    const triggerDownload = (filename: string, content: string) => {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // If it's an image, redirect the user to the Library or relevant section
        if (file.type.startsWith('image/')) {
            alert("This is an image file. To add character avatars or reference images, please use the 'Knowledge Library' panel or Character Edit form.");
            if (fileInputRef.current) fileInputRef.current.value = "";
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target?.result as string;
                let imported: any;
                try {
                    imported = JSON.parse(text);
                } catch (parseErr) {
                    throw new Error("The file is not a valid JSON. If this is an image, please upload it via the Knowledge Library.");
                }
                
                // 1. Check if it's a full backup
                if (imported.characters && imported.chatSessions) {
                    setConfirmationRequest({
                        message: "Importing a full backup will overwrite ALL your current data. Are you sure?",
                        onConfirm: async () => {
                            setAppData(imported);
                            await persistData(imported);
                            setConfirmationRequest(null);
                            alert("Backup imported successfully.");
                        },
                        onCancel: () => setConfirmationRequest(null)
                    });
                    return;
                }

                // 2. Check for Lorebook
                const lorebook = compatibilityService.sillyTavernWorldInfoToNexus(imported, file.name);
                if (lorebook) {
                    const newLorebook = { ...lorebook, id: crypto.randomUUID() } as Lorebook;
                    setAppData(prev => {
                        const updated = { ...prev, lorebooks: [...(prev.lorebooks || []), newLorebook] };
                        persistData(updated);
                        return updated;
                    });
                    alert(`Lorebook "${newLorebook.name}" imported.`);
                    return;
                }

                // 3. Check for Character Card
                const charResult = compatibilityService.v2ToNexus(imported);
                if (charResult) {
                    const { character, lorebook: charLore } = charResult;
                    setAppData(prev => {
                        const updated = { 
                            ...prev, 
                            characters: [...prev.characters, character],
                            lorebooks: charLore ? [...(prev.lorebooks || []), charLore] : prev.lorebooks
                        };
                        persistData(updated);
                        return updated;
                    });
                    alert(`Character "${character.name}" imported.`);
                    return;
                }

                alert("Unknown file format. Please ensure it's a valid character card or backup JSON.");
            } catch (err) {
                logger.error("Import failed", err);
                alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        };
        reader.readAsText(file);
    };

    const handleExportBackup = () => {
        const json = JSON.stringify(appData, null, 2);
        triggerDownload(`ai-nexus-backup-${new Date().toISOString().split('T')[0]}.json`, json);
    };

    const handleExportCharacter = async (id: string) => {
        const char = appData.characters.find(c => c.id === id);
        if (!char) return;
        const v2Card = await compatibilityService.nexusToV2(char);
        triggerDownload(`${char.name.toLowerCase().replace(/\s/g, '_')}_card.json`, JSON.stringify(v2Card, null, 2));
    };

    const handleExportChat = (id: string) => {
        const chat = appData.chatSessions.find(s => s.id === id);
        if (!chat) return;
        triggerDownload(`${chat.name.toLowerCase().replace(/\s/g, '_')}_history.json`, JSON.stringify(chat, null, 2));
    };

    const handleArchiveChat = (id: string) => {
        setAppData(prev => {
            const updated = { ...prev, chatSessions: prev.chatSessions.map(s => s.id === id ? { ...s, isArchived: true } : s) };
            persistData(updated);
            return updated;
        });
    };

    const handleArchiveCharacter = (id: string) => {
        setAppData(prev => {
            const updated = { ...prev, characters: prev.characters.map(c => c.id === id ? { ...c, isArchived: true } : c) };
            persistData(updated);
            return updated;
        });
    };

    const selectedChat = appData.chatSessions.find(s => s.id === selectedChatId);

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-background-primary text-text-primary flex" style={selectedChat?.uiSettings?.backgroundImage ? { backgroundImage: `url('${selectedChat.uiSettings.backgroundImage}')`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
            <div className="absolute inset-0 bg-background-primary/80 backdrop-blur-sm"></div>
            {isLogViewerVisible && <LogViewer onClose={() => setIsLogViewerVisible(false)} />}
            {isHelpVisible && <HelpModal onClose={() => setIsHelpVisible(false)} />}
            {isChatModalVisible && <ChatSelectionModal characters={appData.characters.filter(c => !c.isArchived)} lorebooks={appData.lorebooks || []} onClose={() => setIsChatModalVisible(false)} onCreateChat={handleCreateChat}/>}
            {isAppearanceModalVisible && <AppearanceModal settings={selectedChat?.uiSettings || {}} currentChat={selectedChat} allCharacters={appData.characters} onUpdate={handleUiSettingsUpdate} onGenerateImage={geminiService.generateImageFromPrompt} onClose={() => setIsAppearanceModalVisible(false)}/>}
            {confirmationRequest && <ConfirmationModal message={confirmationRequest.message} onConfirm={confirmationRequest.onConfirm} onCancel={() => setConfirmationRequest(null)}/>}

            <div className="relative flex-shrink-0 bg-background-secondary/80 w-16 flex flex-col items-center justify-between py-4 border-r border-border-neutral z-20">
                <div className="flex flex-col items-center space-y-2">
                    <button onClick={() => { handlePanelToggle('chats'); setActiveView('chat'); }} title="Chats" className={`p-2 rounded-lg ${activePanel === 'chats' ? 'bg-primary-600 text-text-accent' : 'text-text-secondary hover:bg-background-tertiary'}`}><ChatBubbleIcon className="w-6 h-6"/></button>
                    <button onClick={() => { handlePanelToggle('characters'); }} title="Characters" className={`p-2 rounded-lg ${activePanel === 'characters' ? 'bg-primary-600 text-text-accent' : 'text-text-secondary hover:bg-background-tertiary'}`}><UsersIcon className="w-6 h-6"/></button>
                    <button onClick={() => { handlePanelToggle('lorebooks'); }} title="Lorebooks" className={`p-2 rounded-lg ${activePanel === 'lorebooks' ? 'bg-primary-600 text-text-accent' : 'text-text-secondary hover:bg-background-tertiary'}`}><GlobeIcon className="w-6 h-6"/></button>
                    <button onClick={() => { handlePanelToggle('library'); setActiveView('library'); }} title="Library" className={`p-2 rounded-lg ${activePanel === 'library' ? 'bg-primary-600 text-text-accent' : 'text-text-secondary hover:bg-background-tertiary'}`}><FolderIcon className="w-6 h-6"/></button>
                    <button onClick={() => { setActiveView('plugins'); setActivePanel('none'); }} title="Plugins" className={`p-2 rounded-lg ${activeView === 'plugins' ? 'bg-primary-600 text-text-accent' : 'text-text-secondary hover:bg-background-tertiary'}`}><CodeIcon className="w-6 h-6"/></button>
                    <div className="w-8 border-t border-border-neutral my-2"></div>
                    <button onClick={() => setIsChatModalVisible(true)} className="p-2 rounded-lg text-primary-500 hover:bg-background-tertiary" title="Create New Chat"><PlusIcon className="w-6 h-6"/></button>
                    <button onClick={() => setIsAppearanceModalVisible(true)} className="p-2 rounded-lg text-text-secondary hover:bg-background-tertiary"><PaletteIcon className="w-6 h-6"/></button>
                    <button onClick={() => setIsLogViewerVisible(true)} className="p-2 rounded-lg text-text-secondary hover:bg-background-tertiary"><TerminalIcon className="w-6 h-6"/></button>
                    <button onClick={() => setIsHelpVisible(true)} className="p-2 rounded-lg text-text-secondary hover:bg-background-tertiary"><HelpIcon className="w-6 h-6"/></button>
                </div>
                <div className="flex flex-col items-center space-y-2">
                    <input type="file" ref={fileInputRef} onChange={handleImport} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} title="Import File" className="p-2 rounded-lg text-text-secondary hover:bg-background-tertiary"><UploadIcon className="w-6 h-6"/></button>
                    <button onClick={handleExportBackup} title="Export Full Backup" className="p-2 rounded-lg text-text-secondary hover:bg-background-tertiary"><DownloadIcon className="w-6 h-6"/></button>
                    <ThemeSwitcher />
                </div>
            </div>

            <aside className={`relative flex-shrink-0 transition-all duration-300 bg-background-secondary/80 border-r border-border-neutral flex flex-col overflow-hidden ${activePanel !== 'none' ? 'w-80 p-4' : 'w-0 p-0 border-r-0'}`}>
                {activePanel === 'chats' && (
                    <div className="flex-1 flex flex-col min-h-0">
                        <button onClick={() => setIsChatModalVisible(true)} className="w-full flex items-center justify-center space-x-2 mb-4 py-2 px-4 rounded-lg bg-primary-600 text-text-accent font-bold hover:bg-primary-500 shadow-md transition-all">
                            <PlusIcon className="w-5 h-5" /> <span>Start New Chat</span>
                        </button>
                        <ChatList chatSessions={appData.chatSessions.filter(c => !!c.isArchived === showArchivedChats)} characters={appData.characters} selectedChatId={selectedChatId} onSelectChat={(id) => { setSelectedChatId(id); setActiveView('chat'); }} onDeleteChat={handleArchiveChat} onExportChat={handleExportChat} showArchived={showArchivedChats} onToggleArchiveView={() => setShowArchivedChats(!showArchivedChats)} onRestoreChat={(id) => handleSessionUpdate({ ...appData.chatSessions.find(s => s.id === id)!, isArchived: false })} onPermanentlyDeleteChat={(id) => setAppData(prev => ({ ...prev, chatSessions: prev.chatSessions.filter(s => s.id !== id) }))}/>
                    </div>
                )}
                {activePanel === 'characters' && <CharacterList characters={appData.characters.filter(c => !!c.isArchived === showArchivedCharacters)} onDeleteCharacter={handleArchiveCharacter} onEditCharacter={(c) => { setEditingCharacter(c); setActiveView('character-form'); }} onAddNew={() => { setEditingCharacter(null); setActiveView('character-form'); }} onExportCharacter={handleExportCharacter} showArchived={showArchivedCharacters} onToggleArchiveView={() => setShowArchivedCharacters(!showArchivedCharacters)} onRestoreCharacter={(id) => handleCharacterUpdate({ ...appData.characters.find(c => c.id === id)!, isArchived: false })} onPermanentlyDeleteCharacter={(id) => setAppData(prev => ({ ...prev, characters: prev.characters.filter(c => c.id !== id) }))}/>}
                {activePanel === 'lorebooks' && <LorebookManager lorebooks={appData.lorebooks || []} onLorebooksUpdate={(lb) => setAppData(prev => ({ ...prev, lorebooks: lb }))} onSetConfirmation={setConfirmationRequest}/>}
            </aside>
            
            <main className="relative flex-1 flex flex-col h-full overflow-hidden">
                {activeView === 'chat' && (
                    selectedChat ? <ChatInterface session={selectedChat} allCharacters={appData.characters} allChatSessions={appData.chatSessions} allLorebooks={appData.lorebooks || []} userKeys={appData.userKeys} fileSystem={fileSystemState} onUpdateFileSystem={updateFileSystem} onSessionUpdate={handleSessionUpdate} onTriggerHook={triggerPluginHook} onCharacterUpdate={handleCharacterUpdate} onMemoryImport={() => {}} onSaveBackup={handleExportBackup} handlePluginApiRequest={handlePluginApiRequest}/>
                    : <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
                        <ChatBubbleIcon className="w-20 h-20 text-text-secondary opacity-20" />
                        <h3 className="text-2xl font-bold text-text-primary">No Chat Selected</h3>
                        <p className="text-text-secondary max-w-md">Start a new conversation or select an existing one from the sidebar to begin.</p>
                        <button onClick={() => setIsChatModalVisible(true)} className="flex items-center space-x-2 py-3 px-6 rounded-lg text-text-accent bg-primary-600 hover:bg-primary-500 font-bold shadow-lg transition-transform hover:scale-105">
                            <PlusIcon className="w-6 h-6" /> <span>Create New Chat</span>
                        </button>
                      </div>
                )}
                {activeView === 'character-form' && <CharacterForm character={editingCharacter} onSave={handleSaveCharacter} onCancel={() => setActiveView('chat')} onGenerateImage={geminiService.generateImageFromPrompt} availableDocuments={appData.knowledgeBase || []}/>}
                {activeView === 'plugins' && <PluginManager plugins={appData.plugins || []} onPluginsUpdate={(p) => { setAppData(prev => ({ ...prev, plugins: p })); persistData({ ...appData, plugins: p }); }} onSetConfirmation={setConfirmationRequest}/>}
                {activeView === 'library' && <DocumentLibrary documents={appData.knowledgeBase || []} onUpdateDocuments={(d) => { setAppData(prev => ({ ...prev, knowledgeBase: d })); persistData({ ...appData, knowledgeBase: d }); }} onSetConfirmation={setConfirmationRequest}/>}
            </main>
        </div>
    );
};
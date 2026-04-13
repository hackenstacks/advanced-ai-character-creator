import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Character, ChatSession, Message, CryptoKeys, GeminiApiRequest, Lorebook, FileSystemState, UISettings } from '../types.ts';
import { streamChatResponse, generateAvatarPrompt } from '../services/geminiService.ts';
import * as ttsService from '../services/ttsService.ts';
import { logger } from '../services/loggingService.ts';
import { ImageIcon } from './icons/ImageIcon.tsx';
import { BookIcon } from './icons/BookIcon.tsx';
import { BrainIcon } from './icons/BrainIcon.tsx';
import { SpeakerIcon } from './icons/SpeakerIcon.tsx';
import { MemoryImportModal } from './MemoryImportModal.tsx';
import { ImageGenerationWindow } from './ImageGenerationWindow.tsx';
import { TerminalWindow } from './TerminalWindow.tsx';
import { UsersIcon } from './icons/UsersIcon.tsx';
import { TerminalIcon } from './icons/TerminalIcon.tsx';
import { ManageParticipantsModal } from './ManageParticipantsModal.tsx';
import { SpinnerIcon } from './icons/SpinnerIcon.tsx';
import { ChatBubbleIcon } from './icons/ChatBubbleIcon.tsx';
import { PencilIcon } from './icons/PencilIcon.tsx';
import { TrashIcon } from './icons/TrashIcon.tsx';
import { RefreshIcon } from './icons/RefreshIcon.tsx';
import { CheckCircleIcon } from './icons/CheckCircleIcon.tsx';
import { XMarkIcon } from './icons/XMarkIcon.tsx';
import { PaperAirplaneIcon } from './icons/PaperAirplaneIcon.tsx';
import { UploadIcon } from './icons/UploadIcon.tsx';

interface ChatInterfaceProps {
  session: ChatSession;
  allCharacters: Character[];
  allChatSessions: ChatSession[];
  allLorebooks: Lorebook[];
  userKeys?: CryptoKeys;
  onSessionUpdate: (session: ChatSession) => void;
  onCharacterUpdate: (character: Character) => void;
  onTriggerHook: <T, R>(hookName: string, data: T) => Promise<R>;
  onMemoryImport: (fromSessionId: string, toSessionId: string) => void;
  onSaveBackup: () => void;
  handlePluginApiRequest: (request: GeminiApiRequest) => Promise<any>;
  fileSystem: FileSystemState;
  onUpdateFileSystem: (newState: FileSystemState) => void;
  onImportChatHistory: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
    session, allCharacters, allChatSessions, allLorebooks, userKeys, 
    onSessionUpdate, onCharacterUpdate, onTriggerHook, onMemoryImport, onSaveBackup,
    handlePluginApiRequest, fileSystem, onUpdateFileSystem, onImportChatHistory
}) => {
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingCharacterId, setStreamingCharacterId] = useState<string | null>(null);
  
  const [isMemoryModalVisible, setIsMemoryModalVisible] = useState(false);
  const [isManageParticipantsVisible, setIsManageParticipantsVisible] = useState(false);
  const [isTtsEnabled, setIsTtsEnabled] = useState(false);
  const [isImageWindowVisible, setIsImageWindowVisible] = useState(false);
  const [isTerminalVisible, setIsTerminalVisible] = useState(false);
  
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastClickRef = useRef<{time: number, target: string}>({time: 0, target: ''});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const participants = useMemo(() => 
    allCharacters.filter(c => session.characterIds.includes(c.id)), 
    [allCharacters, session.characterIds]
  );

  const avatarSizeClass = useMemo(() => {
    switch (session.uiSettings?.avatarSize) {
      case 'small': return 'w-8 h-8';
      case 'large': return 'w-14 h-14';
      default: return 'w-10 h-10';
    }
  }, [session.uiSettings?.avatarSize]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [session.messages, streamingContent, scrollToBottom]);

  const triggerAIResponse = useCallback(async (character: Character, history: Message[], override?: string) => {
    if (isStreaming) return;
    setIsStreaming(true);
    setStreamingCharacterId(character.id);
    setStreamingContent('');
    let fullResponse = '';
    try {
        await streamChatResponse(character, participants, history, (chunk: any) => {
            if (typeof chunk === 'string') {
                fullResponse += chunk;
                setStreamingContent(fullResponse);
            } else if (chunk?.type === 'tool_call' && chunk.data?.name === 'execute_terminal_command') {
                setIsTerminalVisible(true);
            }
        }, override);
    } catch (err) {
        fullResponse += `\n\n[System Error: Failed to connect to AI service.]`;
        setStreamingContent(fullResponse);
    } finally {
        setIsStreaming(false);
        const finalMessage: Message = { 
            role: 'model', 
            content: fullResponse, 
            timestamp: new Date().toISOString(), 
            characterId: character.id 
        };
        onSessionUpdate({ ...session, messages: [...history, finalMessage] });
        setStreamingContent('');
        setStreamingCharacterId(null);
        if (isTtsEnabled) ttsService.speak(fullResponse, character.voiceId);
        if (character.dynamicAvatarEnabled && fullResponse.length > 20) {
            const prompt = await generateAvatarPrompt(character, fullResponse);
            const url = await handlePluginApiRequest({ type: 'generateImage', prompt });
            if (url?.url) onCharacterUpdate({ ...character, currentAvatarUrl: url.url });
        }
    }
  }, [participants, session, onSessionUpdate, handlePluginApiRequest, onCharacterUpdate, isTtsEnabled]);

  const handleSendMessage = async () => {
    if (!input.trim() || isStreaming) return;
    const userMessage: Message = { role: 'user', content: input, timestamp: new Date().toISOString() };
    const history = [...session.messages, userMessage];
    onSessionUpdate({ ...session, messages: history });
    setInput('');
    if (participants.length > 0) triggerAIResponse(participants[0], history);
  };

  const handleRegenerate = (index: number) => {
    if (isStreaming) return;
    const msg = session.messages[index];
    if (msg.role !== 'model' || !msg.characterId) return;
    const char = allCharacters.find(c => c.id === msg.characterId);
    if (!char) return;
    const history = session.messages.slice(0, index);
    onSessionUpdate({ ...session, messages: history });
    triggerAIResponse(char, history);
  };

  const handleDeleteMessage = (index: number) => {
    const updatedMessages = session.messages.filter((_, i) => i !== index);
    onSessionUpdate({ ...session, messages: updatedMessages });
  };

  const saveEdit = () => {
    if (editingMessageIndex === null) return;
    const updatedMessages = [...session.messages];
    updatedMessages[editingMessageIndex] = { ...updatedMessages[editingMessageIndex], content: editContent };
    onSessionUpdate({ ...session, messages: updatedMessages });
    setEditingMessageIndex(null);
  };

  const handleActionClick = (action: 'narrate' | 'image') => {
    const now = Date.now();
    const isDoubleClick = now - lastClickRef.current.time < 300 && lastClickRef.current.target === action;
    lastClickRef.current = { time: now, target: action };

    if (action === 'narrate') {
        if (isDoubleClick) {
            triggerAIResponse(participants[0], session.messages, "Narrate the current scene.");
        } else {
            const p = window.prompt("Narration instruction:");
            if (p) triggerAIResponse(participants[0], session.messages, `[Narrator Instruction]: ${p}`);
        }
    } else if (action === 'image') setIsImageWindowVisible(true);
  };

  return (
    <div className="flex flex-col h-full bg-background-primary overflow-hidden">
      {isImageWindowVisible && <ImageGenerationWindow onClose={() => setIsImageWindowVisible(false)} onGenerate={(prompt) => handlePluginApiRequest({ type: 'generateImage', prompt })}/>}
      {isTerminalVisible && <TerminalWindow fileSystem={fileSystem} onUpdateFileSystem={onUpdateFileSystem} onClose={() => setIsTerminalVisible(false)} />}
      {isMemoryModalVisible && <MemoryImportModal allSessions={allChatSessions} currentSessionId={session.id} onClose={() => setIsMemoryModalVisible(false)} onImport={(id) => onMemoryImport(id, session.id)} />}
      {isManageParticipantsVisible && <ManageParticipantsModal allCharacters={allCharacters} currentParticipantIds={session.characterIds} onSave={(ids) => onSessionUpdate({...session, characterIds: ids})} onClose={() => setIsManageParticipantsVisible(false)} />}

      <header className="flex items-center p-3 border-b border-border-neutral justify-between bg-background-secondary/50 backdrop-blur-md z-10">
        <div className="flex items-center space-x-3 min-w-0">
            <h2 className="text-lg font-bold text-text-primary truncate">{session.name}</h2>
            <div className="flex -space-x-2">
                {participants.slice(0, 3).map(p => (
                    <img key={p.id} src={p.avatarUrl} className="w-6 h-6 rounded-full border border-background-primary" title={p.name} />
                ))}
            </div>
        </div>
        <div className="flex items-center space-x-2">
            <input type="file" ref={fileInputRef} onChange={onImportChatHistory} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="p-2 text-text-secondary hover:bg-background-tertiary rounded-md" title="Import Chat History">
                <UploadIcon className="w-5 h-5" />
            </button>
            <button onClick={() => setIsTtsEnabled(!isTtsEnabled)} className={`p-2 rounded-md ${isTtsEnabled ? 'text-primary-500 bg-primary-500/10' : 'text-text-secondary hover:bg-background-tertiary'}`} title="Auto TTS">
                <SpeakerIcon className="w-5 h-5" />
            </button>
            <button onClick={() => setIsManageParticipantsVisible(true)} className="p-2 text-text-secondary hover:bg-background-tertiary rounded-md" title="Participants">
                <UsersIcon className="w-5 h-5" />
            </button>
        </div>
      </header>

      <div className="flex-1 p-4 overflow-y-auto space-y-6 custom-scrollbar">
        {session.messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-30 select-none">
                <ChatBubbleIcon className="w-20 h-20 mb-4" />
                <p className="text-xl font-bold">New Story Awaits</p>
                <p>Send a message to begin.</p>
            </div>
        )}
        
        {session.messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            const msgChar = msg.characterId ? allCharacters.find(c => c.id === msg.characterId) : null;
            const isEditing = editingMessageIndex === index;
            
            return (
              <div key={index} className={`flex items-start gap-3 group/msg ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                {!isUser && msgChar && <img src={msgChar.currentAvatarUrl || msgChar.avatarUrl} className={`${avatarSizeClass} rounded-full object-cover border-2 border-border-neutral flex-shrink-0`} />}
                {isUser && <div className={`${avatarSizeClass} bg-primary-600 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}>U</div>}
                
                <div className={`flex flex-col max-w-[80%] ${isUser ? 'items-end' : 'items-start'} relative`}>
                  {msgChar && !isUser && <span className="text-xs font-bold text-text-secondary mb-1 ml-1">{msgChar.name}</span>}
                  
                  <div className={`absolute top-0 ${isUser ? 'right-full mr-2' : 'left-full ml-2'} opacity-0 group-hover/msg:opacity-100 flex items-center bg-background-secondary border border-border-neutral rounded shadow p-1 space-x-1 z-20 transition-opacity`}>
                    <button onClick={() => { setEditingMessageIndex(index); setEditContent(msg.content); }} className="p-1 hover:bg-background-tertiary rounded text-text-secondary" title="Edit"><PencilIcon className="w-4 h-4" /></button>
                    {!isUser && <button onClick={() => handleRegenerate(index)} className="p-1 hover:bg-background-tertiary rounded text-text-secondary" title="Regenerate"><RefreshIcon className="w-4 h-4" /></button>}
                    <button onClick={() => handleDeleteMessage(index)} className="p-1 hover:bg-background-tertiary rounded text-text-secondary hover:text-accent-red" title="Delete"><TrashIcon className="w-4 h-4" /></button>
                  </div>

                  <div className={`p-3 rounded-2xl shadow-sm transition-all ${isUser ? 'bg-primary-600 text-white rounded-tr-none' : 'bg-background-secondary text-text-primary rounded-tl-none border border-border-neutral'} ${isEditing ? 'ring-2 ring-primary-500' : ''}`}>
                    {isEditing ? (
                        <div className="flex flex-col space-y-2 min-w-[200px]">
                            <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="bg-transparent border-none outline-none text-inherit resize-none w-full min-h-[60px]" autoFocus />
                            <div className="flex justify-end space-x-2">
                                <button onClick={() => setEditingMessageIndex(null)} className="p-1 hover:bg-white/10 rounded"><XMarkIcon className="w-5 h-5" /></button>
                                <button onClick={saveEdit} className="p-1 hover:bg-white/10 rounded"><CheckCircleIcon className="w-5 h-5" /></button>
                            </div>
                        </div>
                    ) : (
                        <p className="whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: msg.content.replace(/\n/g, '<br/>') }} />
                    )}
                  </div>
                </div>
              </div>
            );
        })}
        {isStreaming && (
            <div className="flex items-start gap-3">
                {streamingCharacterId && <img src={allCharacters.find(c => c.id === streamingCharacterId)?.avatarUrl} className={`${avatarSizeClass} rounded-full object-cover border-2 border-primary-500 animate-pulse`} />}
                <div className="flex flex-col max-w-[80%] items-start">
                    <div className="p-3 rounded-2xl bg-background-secondary text-text-primary rounded-tl-none border border-primary-500/30">
                        {streamingContent ? <p className="whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: streamingContent.replace(/\n/g, '<br/>') }} /> : <div className="flex space-x-1 py-1"><div className="w-2 h-2 bg-text-secondary rounded-full animate-bounce"></div><div className="w-2 h-2 bg-text-secondary rounded-full animate-bounce [animation-delay:-.15s]"></div><div className="w-2 h-2 bg-text-secondary rounded-full animate-bounce [animation-delay:-.3s]"></div></div>}
                    </div>
                </div>
            </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-background-primary border-t border-border-neutral shadow-lg">
        <div className="flex items-end bg-background-secondary border border-border-strong rounded-2xl p-2 focus-within:ring-2 focus-within:ring-primary-500 transition-all">
          <textarea 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())} 
            placeholder="Type your message..."
            className="flex-1 bg-transparent border-none outline-none px-3 py-2 text-text-primary resize-none custom-scrollbar max-h-40 min-h-[40px]" 
            rows={1}
          />
          <div className="flex items-center space-x-1 px-1 mb-1">
              <button onClick={() => handleActionClick('narrate')} className="p-2 text-text-secondary hover:text-primary-500 hover:bg-background-tertiary rounded-lg transition-all" title="Narrator"><BookIcon className="w-5 h-5" /></button>
              <button onClick={() => handleActionClick('image')} className="p-2 text-text-secondary hover:text-primary-500 hover:bg-background-tertiary rounded-lg transition-all" title="Generate Image"><ImageIcon className="w-5 h-5" /></button>
              <button onClick={() => setIsMemoryModalVisible(true)} className="p-2 text-text-secondary hover:text-primary-500 hover:bg-background-tertiary rounded-lg transition-all" title="Memories"><BrainIcon className="w-5 h-5" /></button>
              <button onClick={() => setIsTerminalVisible(true)} className="p-2 text-text-secondary hover:text-primary-500 hover:bg-background-tertiary rounded-lg transition-all" title="Terminal"><TerminalIcon className="w-5 h-5" /></button>
              <div className="w-px h-6 bg-border-neutral mx-1"></div>
              <button 
                onClick={handleSendMessage} 
                disabled={!input.trim() || isStreaming}
                className="p-3 bg-primary-600 text-white rounded-xl hover:bg-primary-500 disabled:opacity-50 transition-all shadow-md"
              >
                {isStreaming ? <SpinnerIcon className="w-5 h-5 animate-spin" /> : <PaperAirplaneIcon className="w-5 h-5" />}
              </button>
          </div>
        </div>
      </div>
    </div>
  );
};

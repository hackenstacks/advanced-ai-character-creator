import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Character, ChatSession, Message, CryptoKeys, GeminiApiRequest, Lorebook, FileSystemState } from '../types.ts';
import { streamChatResponse, streamGenericResponse, generateContent, generateAvatarPrompt } from '../services/geminiService.ts';
import * as cryptoService from '../services/cryptoService.ts';
import * as ttsService from '../services/ttsService.ts';
import * as ragService from '../services/ragService.ts';
import * as lorebookService from '../services/lorebookService.ts';
import * as fileSystemService from '../services/fileSystemService.ts';
import { logger } from '../services/loggingService.ts';
import { ChatBubbleIcon } from './icons/ChatBubbleIcon.tsx';
import { ImageIcon } from './icons/ImageIcon.tsx';
import { BookIcon } from './icons/BookIcon.tsx';
import { BrainIcon } from './icons/BrainIcon.tsx';
import { SpeakerIcon } from './icons/SpeakerIcon.tsx';
import { MemoryImportModal } from './MemoryImportModal.tsx';
import { CheckCircleIcon } from './icons/CheckCircleIcon.tsx';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon.tsx';
import { ImageGenerationWindow } from './ImageGenerationWindow.tsx';
import { TerminalWindow } from './TerminalWindow.tsx';
import { PaletteIcon } from './icons/PaletteIcon.tsx';
import { PaperClipIcon } from './icons/PaperClipIcon.tsx';
import { PencilIcon } from './icons/PencilIcon.tsx';
import { RefreshIcon } from './icons/RefreshIcon.tsx';
import { XMarkIcon } from './icons/XMarkIcon.tsx';
import { UsersIcon } from './icons/UsersIcon.tsx';
import { TerminalIcon } from './icons/TerminalIcon.tsx';
import { ManageParticipantsModal } from './ManageParticipantsModal.tsx';

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
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
    session, allCharacters, allChatSessions, allLorebooks, userKeys, 
    onSessionUpdate, onCharacterUpdate, onTriggerHook, onMemoryImport, onSaveBackup,
    handlePluginApiRequest, fileSystem, onUpdateFileSystem
}) => {
  const [currentSession, setCurrentSession] = useState<ChatSession>(session);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [autoConverseStatus, setAutoConverseStatus] = useState<'stopped' | 'running' | 'paused'>('stopped');
  const [isMemoryModalVisible, setIsMemoryModalVisible] = useState(false);
  const [isManageParticipantsVisible, setIsManageParticipantsVisible] = useState(false);
  const [isTtsEnabled, setIsTtsEnabled] = useState(false);
  const [verifiedSignatures, setVerifiedSignatures] = useState<Record<string, boolean>>({});
  const [isImageWindowVisible, setIsImageWindowVisible] = useState(false);
  const [isTerminalVisible, setIsTerminalVisible] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentSessionRef = useRef(session);
  const autoConverseStatusRef = useRef(autoConverseStatus);

  useEffect(() => { currentSessionRef.current = currentSession; }, [currentSession]);
  useEffect(() => { autoConverseStatusRef.current = autoConverseStatus; }, [autoConverseStatus]);

  const participants = useMemo(() => allCharacters.filter(c => currentSession.characterIds.includes(c.id)), [allCharacters, currentSession.characterIds]);
  const avatarSizeClass = useMemo(() => {
    switch (currentSession.uiSettings?.avatarSize) {
      case 'small': return 'w-8 h-8';
      case 'large': return 'w-12 h-12';
      default: return 'w-10 h-10';
    }
  }, [currentSession.uiSettings?.avatarSize]);

  const triggerAIResponse = useCallback(async (character: Character, history: Message[], override?: string) => {
    setIsStreaming(true);
    const modelPlaceholder: Message = { role: 'model', content: '', timestamp: new Date().toISOString(), characterId: character.id };
    onSessionUpdate({ ...currentSessionRef.current, messages: [...history, modelPlaceholder] });
    
    let fullResponse = '';
    try {
        await streamChatResponse(character, participants, history, (chunk: any) => {
            if (typeof chunk === 'string') {
                fullResponse += chunk;
                const msgElement = document.getElementById(modelPlaceholder.timestamp);
                if (msgElement) msgElement.innerHTML = fullResponse.replace(/\n/g, '<br>');
            }
        }, override);
    } finally {
        setIsStreaming(false);
        const finalHistory = [...history, { ...modelPlaceholder, content: fullResponse }];
        onSessionUpdate({ ...currentSessionRef.current, messages: finalHistory });

        if (character.dynamicAvatarEnabled && fullResponse) {
            generateAvatarPrompt(character, fullResponse).then(prompt => {
                handlePluginApiRequest({ type: 'generateImage', prompt }).then(url => {
                    if (url) onCharacterUpdate({ ...character, currentAvatarUrl: url });
                });
            });
        }
    }
  }, [participants, onSessionUpdate, handlePluginApiRequest, onCharacterUpdate]);

  const handleSendMessage = async () => {
    if (!input.trim() || isStreaming) return;
    const userMessage: Message = { role: 'user', content: input, timestamp: new Date().toISOString() };
    const history = [...currentSession.messages, userMessage];
    onSessionUpdate({ ...currentSession, messages: history });
    setInput('');
    if (participants.length > 0) triggerAIResponse(participants[0], history);
  };

  return (
    <div className="flex flex-col h-full bg-background-primary">
      <header className="flex items-center p-3 border-b border-border-neutral justify-between">
        <h2 className="text-lg font-bold text-text-primary truncate">{session.name}</h2>
      </header>
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {currentSession.messages.map((msg, index) => {
            const msgChar = msg.characterId ? allCharacters.find(c => c.id === msg.characterId) : null;
            return (
              <div key={index} className={`flex items-start gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'model' && msgChar && (
                  <img src={msgChar.currentAvatarUrl || msgChar.avatarUrl} className={`${avatarSizeClass} rounded-full object-cover`} />
                )}
                <div className={`p-3 rounded-lg ${msg.role === 'user' ? 'bg-primary-600 text-white' : 'bg-background-secondary text-text-primary'}`}>
                  {msgChar && <p className="font-bold text-sm mb-1">{msgChar.name}</p>}
                  <p id={msg.timestamp} dangerouslySetInnerHTML={{ __html: msg.content.replace(/\n/g, '<br/>') }} />
                </div>
              </div>
            );
        })}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 border-t border-border-neutral">
        <div className="flex items-center bg-background-secondary rounded-lg p-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()} className="flex-1 bg-transparent border-none outline-none px-2 text-text-primary" rows={1}/>
          <button onClick={handleSendMessage} className="p-2 text-primary-500">Send</button>
        </div>
      </div>
    </div>
  );
};
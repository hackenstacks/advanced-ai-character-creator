
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Character, ChatSession, Message, CryptoKeys, GeminiApiRequest, Lorebook, FileSystemState } from '../types.ts';
import { streamChatResponse, streamGenericResponse, generateContent, generateImageFromPrompt } from '../services/geminiService.ts';
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
import { PluginSandbox } from '../services/pluginSandbox.ts';
import { ImageGenerationWindow } from './ImageGenerationWindow.tsx';
import { TerminalWindow } from './TerminalWindow.tsx';
import { PaletteIcon } from './icons/PaletteIcon.tsx';
import { PaperClipIcon } from './icons/PaperClipIcon.tsx';
import { VideoIcon } from './icons/VideoIcon.tsx';
import { MicrophoneIcon } from './icons/MicrophoneIcon.tsx';
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
    session, 
    allCharacters, 
    allChatSessions, 
    allLorebooks, 
    userKeys, 
    onSessionUpdate, 
    onCharacterUpdate, 
    onTriggerHook,
    onMemoryImport,
    onSaveBackup,
    handlePluginApiRequest,
    fileSystem,
    onUpdateFileSystem
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

  const nextSpeakerIndex = useRef(0);
  const systemOverride = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const imageClickTimeout = useRef<number | null>(null);
  const narratorClickTimeout = useRef<number | null>(null);
  const autoConverseTimeout = useRef<number | null>(null);

  const autoConverseStatusRef = useRef(autoConverseStatus);
  useEffect(() => {
    autoConverseStatusRef.current = autoConverseStatus;
  }, [autoConverseStatus]);

  const currentSessionRef = useRef(session);
  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  const participants = useMemo(() => {
    return allCharacters.filter(c => currentSession.characterIds.includes(c.id));
  }, [allCharacters, currentSession.characterIds]);

  const attachedLorebooks = useMemo(() => {
    return (currentSession.lorebookIds || []).map(id => allLorebooks.find(lb => lb.id === id)).filter(Boolean) as Lorebook[];
  }, [allLorebooks, currentSession.lorebookIds]);

  const avatarSizeClass = useMemo(() => {
    switch (currentSession.uiSettings?.avatarSize) {
      case 'small': return 'w-8 h-8';
      case 'large': return 'w-12 h-12';
      default: return 'w-10 h-10'; // Medium is default
    }
  }, [currentSession.uiSettings?.avatarSize]);

  useEffect(() => {
    if (session.id !== currentSessionRef.current.id) {
        setCurrentSession(session);
        setEditingMessageIndex(null);
        if (autoConverseStatusRef.current !== 'stopped') {
            setAutoConverseStatus('stopped');
            if (autoConverseTimeout.current) clearTimeout(autoConverseTimeout.current);
        }
    }
  }, [session]);
  
  useEffect(() => {
    const verifyAllMessages = async () => {
        const verificationResults: Record<string, boolean> = {};
        for (const msg of currentSession.messages) {
            if (msg.signature && msg.publicKeyJwk) {
                try {
                    const publicKey = await cryptoService.importKey(msg.publicKeyJwk, 'verify');
                    const dataToVerify: Partial<Message> = { ...msg };
                    delete dataToVerify.signature;
                    delete dataToVerify.publicKeyJwk;
                    const canonicalString = cryptoService.createCanonicalString(dataToVerify);
                    verificationResults[msg.timestamp] = await cryptoService.verify(canonicalString, msg.signature, publicKey);
                } catch (e) {
                    logger.error("Message verification failed during check", e);
                    verificationResults[msg.timestamp] = false;
                }
            }
        }
        setVerifiedSignatures(verificationResults);
    };
    verifyAllMessages();
  }, [currentSession.messages]);

  useEffect(() => {
    if (editingMessageIndex === null) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentSession.messages, isStreaming, editingMessageIndex]);
  
  useEffect(() => {
    const initAudio = () => {
        ttsService.initAudioContext();
        window.removeEventListener('click', initAudio);
        window.removeEventListener('keydown', initAudio);
    };
    window.addEventListener('click', initAudio);
    window.addEventListener('keydown', initAudio);

    return () => {
      if (autoConverseTimeout.current) clearTimeout(autoConverseTimeout.current);
      ttsService.cancel();
      window.removeEventListener('click', initAudio);
      window.removeEventListener('keydown', initAudio);
    }
  }, []);

  const updateSession = useCallback((updater: (session: ChatSession) => ChatSession) => {
    const newSession = updater(currentSessionRef.current);
    setCurrentSession(newSession);
    onSessionUpdate(newSession);
  }, [onSessionUpdate]);

  const addMessage = useCallback((message: Message) => {
    updateSession(prevSession => ({ ...prevSession, messages: [...prevSession.messages, message] }));
  }, [updateSession]);

  const addSystemMessage = useCallback((content: string) => {
    const systemMessage: Message = {
      role: 'narrator',
      content,
      timestamp: new Date().toISOString()
    };
    addMessage(systemMessage);
  }, [addMessage]);
  
  const triggerAIResponse = useCallback(async (character: Character, history: Message[], override?: string) => {
    const lastMsg = history[history.length - 1];
    if (lastMsg.role === 'tool' && lastMsg.approvalStatus === 'pending') {
        return; 
    }

    let finalHistory = history;
    let finalOverride = override || '';

    if (attachedLorebooks.length > 0) {
        const loreContext = lorebookService.findRelevantLore(history, attachedLorebooks);
        if (loreContext) {
            finalOverride = `[WORLD INFO]:\n${loreContext}\n\n${finalOverride}`;
        }
    }

    setIsStreaming(true);
    const modelPlaceholder: Message = {
        role: 'model',
        content: '',
        timestamp: new Date().toISOString(),
        characterId: character.id
    };
    
    updateSession(current => ({ ...current, messages: [...finalHistory, modelPlaceholder] }));

    let fullResponse = '';
    
    try {
        await streamChatResponse(
            character,
            participants,
            finalHistory,
            (chunk: string | any) => {
                if (typeof chunk === 'object' && chunk.type === 'tool_call') {
                    const toolCall = chunk.data;
                    updateSession(current => {
                        const updatedMessages = current.messages.map(m => 
                            m.timestamp === modelPlaceholder.timestamp
                            ? {
                                ...m,
                                role: 'tool' as const,
                                content: `Requesting to run command: ${toolCall.args['command']}`,
                                toolCallId: toolCall.id,
                                toolName: toolCall.name,
                                toolArgs: toolCall.args,
                                approvalStatus: 'pending' as const
                              }
                            : m
                        );
                        return { ...current, messages: updatedMessages };
                    });
                    setIsStreaming(false);
                    return; 
                }

                fullResponse += chunk;
                const messages = currentSessionRef.current.messages;
                const lastMessage = messages[messages.length - 1];
                if(lastMessage && lastMessage.timestamp === modelPlaceholder.timestamp && lastMessage.role === 'model') {
                    lastMessage.content = fullResponse;
                    const msgElement = document.getElementById(modelPlaceholder.timestamp);
                    if (msgElement) {
                       msgElement.innerHTML = fullResponse.replace(/\n/g, '<br>');
                    }
                }
            },
            finalOverride
        );
    } catch (error) {
        logger.error("Streaming failed:", error);
        fullResponse = "Sorry, an error occurred while responding.";
    } finally {
        const currentMessages = currentSessionRef.current.messages;
        const last = currentMessages[currentMessages.length - 1];
        
        if (last.role === 'model') {
            setIsStreaming(false);
            
            const imageRegex = /\[generate_image:\s*(.*?)\]/g;
            const imageMatches = [...fullResponse.matchAll(imageRegex)];
            const cleanedResponse = fullResponse.replace(imageRegex, '').trim();

            if (cleanedResponse.length > 0 || imageMatches.length > 0) {
                if (character.keys) {
                    try {
                        const privateKey = await cryptoService.importKey(character.keys.privateKey, 'sign');
                        const finalMessage = { ...last, content: cleanedResponse, publicKeyJwk: character.keys.publicKey };
                        const dataToSign: Partial<Message> = { ...finalMessage };
                        delete dataToSign.signature;
                        delete dataToSign.publicKeyJwk;
                        const canonicalString = cryptoService.createCanonicalString(dataToSign);
                        finalMessage.signature = await cryptoService.sign(canonicalString, privateKey);
                         updateSession(current => {
                            const updatedMessages = current.messages.map(msg =>
                                msg.timestamp === modelPlaceholder.timestamp ? finalMessage : msg
                            );
                            return { ...current, messages: updatedMessages };
                        });
                    } catch (e) {
                        logger.error(`Failed to sign message`, e);
                    }
                } else {
                     updateSession(current => {
                        const updatedMessages = current.messages.map(msg =>
                            msg.timestamp === modelPlaceholder.timestamp ? { ...msg, content: cleanedResponse } : msg
                        );
                        return { ...current, messages: updatedMessages };
                    });
                }
                
                if (isTtsEnabled && cleanedResponse) {
                    ttsService.speak(cleanedResponse, character.voiceId || character.voiceURI || 'Puck');
                }

                for (const match of imageMatches) {
                    if (match[1]) handleImageGeneration(match[1], 'direct');
                }
            } else {
                updateSession(current => ({
                    ...current,
                    messages: current.messages.filter(m => m.timestamp !== modelPlaceholder.timestamp)
                }));
            }
        }
    }
  }, [participants, isTtsEnabled, updateSession, addSystemMessage, handlePluginApiRequest, attachedLorebooks, fileSystem]);

  const handleToolAction = async (messageIndex: number, action: 'approve' | 'reject') => {
      const toolMsg = currentSession.messages[messageIndex];
      if (!toolMsg.toolArgs || !toolMsg.toolName) return;

      let resultString = '';
      
      if (action === 'reject') {
          resultString = "User denied permission.";
      } else {
          if (toolMsg.toolName === 'execute_terminal_command') {
              const command = toolMsg.toolArgs['command'];
              const { output, newState } = fileSystemService.executeCommand(fileSystem, command);
              onUpdateFileSystem(newState);
              resultString = output || "(Command executed with no output)";
          }
      }

      updateSession(prev => {
          const newMessages = [...prev.messages];
          newMessages[messageIndex] = {
              ...toolMsg,
              approvalStatus: action === 'approve' ? 'approved' : 'rejected',
              toolResult: resultString
          };
          return { ...prev, messages: newMessages };
      });

      const character = allCharacters.find(c => c.id === toolMsg.characterId);
      if (character) {
          await triggerAIResponse(character, currentSession.messages, `[Terminal Output]: ${resultString}`);
      }
  };

  const continueAutoConversation = useCallback(async () => {
    if (autoConverseTimeout.current) clearTimeout(autoConverseTimeout.current);
    if (autoConverseStatusRef.current !== 'running' || participants.length < 2) {
        if (autoConverseStatusRef.current !== 'paused') {
            setAutoConverseStatus('stopped');
        }
        return;
    }
    
    const speaker = participants[nextSpeakerIndex.current % participants.length];
    nextSpeakerIndex.current += 1;
    const otherParticipantNames = participants.filter(p => p.id !== speaker.id).map(p => p.name).join(', ');
    const override = `You are in an automated conversation with ${otherParticipantNames}. Continue the conversation naturally based on the history. Your response should be directed at them, not a user. Do not act as a narrator.`;
    
    await triggerAIResponse(speaker, currentSessionRef.current.messages, override);

    if (autoConverseStatusRef.current === 'running') {
        autoConverseTimeout.current = window.setTimeout(() => continueAutoConversation(), 3000);
    }
  }, [participants, triggerAIResponse]);

  const startAutoConversation = useCallback(async (topic: string) => {
    const starterMessage: Message = {
        role: 'narrator',
        content: `[The AIs will now converse about: "${topic}"]`,
        timestamp: new Date().toISOString()
    };
    const updatedMessages = [...currentSessionRef.current.messages, starterMessage];
    updateSession(current => ({...current, messages: updatedMessages}));
    
    const firstSpeaker = participants[nextSpeakerIndex.current % participants.length];
    nextSpeakerIndex.current += 1;
    const otherParticipantNames = participants.filter(p => p.id !== firstSpeaker.id).map(p => p.name).join(', ');
    const override = `You are in an automated conversation with ${otherParticipantNames}. The user has set the topic: "${topic}". Start the conversation. Your response should be directed at them, not a user. Do not act as a narrator.`;

    await triggerAIResponse(firstSpeaker, updatedMessages, override);

    if (autoConverseStatusRef.current === 'running') {
        autoConverseTimeout.current = window.setTimeout(continueAutoConversation, 3000);
    }
  }, [participants, triggerAIResponse, updateSession, continueAutoConversation]);

  const handleCommand = async (command: string, args: string) => {
    setInput('');
    switch (command) {
        case 'image': {
            handleImageGeneration(args, 'direct');
            break;
        }
        case 'narrate': {
            handleNarration(args, 'direct');
            break;
        }
        case 'snapshot':
        case 'memorize': {
             const history = currentSessionRef.current.messages.slice(-10);
            if (history.length === 0) {
                addSystemMessage("Not enough conversation history to save a memory snapshot.");
                return;
            }
            addSystemMessage("Generating memory snapshot...");
            const context = history.map(m => `${m.role === 'model' ? allCharacters.find(c => c.id === m.characterId)?.name || 'AI' : 'User'}: ${m.content}`).join('\n');
            const prompt = `Summarize the key events, information, and character developments from this recent conversation snippet into a concise paragraph for a character's long-term memory. Focus on facts and relationship changes. Conversation:\n\n${context}`;
            
            try {
                const summary = await generateContent(prompt);
                participants.forEach(p => {
                    const updatedMemory = `${p.memory || ''}\n\n[Memory from ${new Date().toLocaleString()}]\n${summary}`;
                    onCharacterUpdate({...p, memory: updatedMemory.trim()});
                });
                addSystemMessage("Memory snapshot saved for all participants.");
            } catch (e) {
                logger.error("Failed to generate memory summary", e);
                addSystemMessage("Failed to generate memory summary. See logs for details.");
            }
            break;
        }
        case 'save': {
            addSystemMessage("Saving a full application backup... Your download will begin shortly.");
            onSaveBackup();
            break;
        }
        case 'sys': {
            systemOverride.current = args;
            addSystemMessage(`System override set for next AI response: "${args}"`);
            break;
        }
        case 'character': {
            const [charName, ...promptParts] = args.split(' ');
            const prompt = promptParts.join(' ');
            if (!charName || !prompt) {
                addSystemMessage("Usage: /character <name> <prompt>");
                return;
            }
            const target = participants.find(p => p.name.toLowerCase().startsWith(charName.toLowerCase()));
            if (!target) {
                addSystemMessage(`Character "${charName}" not found in this chat.`);
                return;
            }
            
            const targetIndex = participants.findIndex(p => p.id === target.id);
            nextSpeakerIndex.current = targetIndex;

            const userMessage = await createUserMessage(prompt);
            const newHistory = [...currentSessionRef.current.messages, userMessage];
            addMessage(userMessage);

            await triggerAIResponse(target, newHistory);
            break;
        }
        case 'converse': {
            if (autoConverseStatusRef.current !== 'stopped') {
                addSystemMessage("A conversation is already in progress. Use /end to stop it, or /pause to pause.");
                return;
            }
            if (participants.length > 1) {
                const topic = args || 'Anything at all.';
                setAutoConverseStatus('running');
                startAutoConversation(topic);
            } else {
                addSystemMessage("You need at least two characters in the chat to start a conversation.");
            }
            break;
        }
        case 'pause': {
            if (autoConverseStatusRef.current === 'running') {
                if (autoConverseTimeout.current) clearTimeout(autoConverseTimeout.current);
                setAutoConverseStatus('paused');
                addSystemMessage("AI conversation paused. Use /resume to continue.");
            } else if (autoConverseStatusRef.current === 'paused') {
                addSystemMessage("Conversation is already paused.");
            } else {
                 addSystemMessage("No conversation is running to pause.");
            }
            break;
        }
        case 'resume': {
             if (autoConverseStatusRef.current === 'paused') {
                setAutoConverseStatus('running');
                addSystemMessage("AI conversation resumed.");
                continueAutoConversation();
            } else if (autoConverseStatusRef.current === 'running') {
                addSystemMessage("Conversation is already running.");
            } else {
                addSystemMessage("No paused conversation to resume.");
            }
            break;
        }
        case 'quit':
        case 'end': {
            if (autoConverseStatusRef.current !== 'stopped') {
                if (autoConverseTimeout.current) clearTimeout(autoConverseTimeout.current);
                setAutoConverseStatus('stopped');
                addSystemMessage("AI conversation ended by user.");
            } else {
                addSystemMessage("No conversation is running to end.");
            }
            break;
        }
        default:
            addSystemMessage(`Unknown command: /${command}`);
    }
  };
  
  const createUserMessage = async (content: string, attachment?: Message['attachment']): Promise<Message> => {
    let userMessage: Message = { role: 'user', content, timestamp: new Date().toISOString(), attachment };
    if (userKeys) {
        try {
            const privateKey = await cryptoService.importKey(userKeys.privateKey, 'sign');
            userMessage.publicKeyJwk = userKeys.publicKey;
            const dataToSign: Partial<Message> = { ...userMessage };
            delete dataToSign.signature;
            delete dataToSign.publicKeyJwk;
            const canonicalString = cryptoService.createCanonicalString(dataToSign);
            userMessage.signature = await cryptoService.sign(canonicalString, privateKey);
        } catch(e) {
            logger.error("Failed to sign user message", e);
        }
    }
    return userMessage;
  };
  
  const handleUpdateParticipants = (selectedIds: string[]) => {
      updateSession(prev => ({
          ...prev,
          characterIds: selectedIds
      }));
      nextSpeakerIndex.current = 0;
  };

  const startEditing = (index: number, content: string) => {
      setEditingMessageIndex(index);
      setEditContent(content);
  };

  const cancelEditing = () => {
      setEditingMessageIndex(null);
      setEditContent('');
  };

  const saveEdit = async (index: number) => {
      const oldMessage = currentSession.messages[index];
      const newMessage = { ...oldMessage, content: editContent };
      
      delete newMessage.signature;
      delete newMessage.publicKeyJwk;

      if (newMessage.role === 'user' && userKeys) {
           try {
                const privateKey = await cryptoService.importKey(userKeys.privateKey, 'sign');
                newMessage.publicKeyJwk = userKeys.publicKey;
                const dataToSign: Partial<Message> = { ...newMessage };
                delete dataToSign.signature;
                delete dataToSign.publicKeyJwk;
                const canonicalString = cryptoService.createCanonicalString(dataToSign);
                newMessage.signature = await cryptoService.sign(canonicalString, privateKey);
            } catch(e) {
                logger.error("Failed to re-sign user message", e);
            }
      }

      updateSession(prev => {
          const newMessages = [...prev.messages];
          newMessages[index] = newMessage;
          return { ...prev, messages: newMessages };
      });
      setEditingMessageIndex(null);
  };

  const regenerateResponse = async (index: number) => {
      const messageToRegenerate = currentSession.messages[index];
      if (messageToRegenerate.role !== 'model' || !messageToRegenerate.characterId) {
          alert("Can only regenerate AI responses.");
          return;
      }

      const character = allCharacters.find(c => c.id === messageToRegenerate.characterId);
      if (!character) {
          alert("Character not found.");
          return;
      }

      const historyPrefix = currentSession.messages.slice(0, index);
      
      updateSession(prev => ({
          ...prev,
          messages: historyPrefix
      }));

      await triggerAIResponse(character, historyPrefix);
  };

  const handleSendMessage = useCallback(async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput && !uploading) return;
    
    if (isStreaming && autoConverseStatusRef.current === 'stopped') return;

    if (autoConverseTimeout.current) clearTimeout(autoConverseTimeout.current);
    if (autoConverseStatusRef.current !== 'stopped') {
        setAutoConverseStatus('stopped');
        addSystemMessage("AI conversation stopped by user message.");
    }
    
    if (trimmedInput.startsWith('/')) {
        const [command, ...argsParts] = trimmedInput.substring(1).split(' ');
        const args = argsParts.join(' ');
        handleCommand(command.toLowerCase(), args);
        return;
    }

    const userMessage = await createUserMessage(trimmedInput);
    const newHistory = [...currentSessionRef.current.messages, userMessage];
    addMessage(userMessage);
    setInput('');

    if (participants.length > 0) {
        const respondent = participants[nextSpeakerIndex.current % participants.length];
        nextSpeakerIndex.current += 1;
        
        let finalSystemOverride = systemOverride.current;
        if (respondent.ragEnabled) {
            try {
                const ragContext = await ragService.findRelevantContext(trimmedInput, respondent);
                if (ragContext) {
                    logger.log("Injecting RAG context for response.", { character: respondent.name });
                    const contextInstruction = `[ADDITIONAL CONTEXT FROM KNOWLEDGE BASE]:\n${ragContext}`;
                    finalSystemOverride = finalSystemOverride
                        ? `${contextInstruction}\n\n${finalSystemOverride}`
                        : contextInstruction;
                }
            } catch (e) {
                logger.error("RAG context retrieval failed:", e);
                addSystemMessage(`Could not retrieve context for ${respondent.name}. Check embedding API settings.`);
            }
        }

        await triggerAIResponse(respondent, newHistory, finalSystemOverride || undefined);
        
        if (systemOverride.current) {
            systemOverride.current = null;
        }
    }

  }, [input, isStreaming, participants, addMessage, addSystemMessage, triggerAIResponse, userKeys, handleCommand, uploading]);
  
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      setUploading(true);

      reader.onload = async () => {
          const base64Url = reader.result as string;
          let attachmentType: 'image' | 'video' | 'audio' = 'image';
          
          if (file.type.startsWith('video/')) attachmentType = 'video';
          else if (file.type.startsWith('audio/')) attachmentType = 'audio';

          const attachment = {
              type: attachmentType,
              status: 'done' as const,
              url: base64Url,
              mimeType: file.type,
              name: file.name
          };

          const userMessage = await createUserMessage(`[Uploaded ${attachmentType}: ${file.name}]`, attachment);
          const newHistory = [...currentSessionRef.current.messages, userMessage];
          addMessage(userMessage);
          setUploading(false);

          if (participants.length > 0) {
              const respondent = participants[nextSpeakerIndex.current % participants.length];
              nextSpeakerIndex.current += 1;
              await triggerAIResponse(respondent, newHistory, "The user has uploaded a file. Analyze it and respond naturally.");
          }
      };
      
      reader.onerror = () => {
          logger.error("Failed to read file.");
          setUploading(false);
          alert("Failed to read file.");
      }

      reader.readAsDataURL(file);
      if(fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImageGeneration = async (prompt: string, type: 'direct' | 'summary') => {
      const attachmentMessage: Message = {
          role: 'narrator',
          content: `Generating image for prompt: "${type === 'summary' ? 'Summarizing context...' : prompt}"`,
          timestamp: new Date().toISOString(),
          attachment: { type: 'image', status: 'loading', prompt }
      };
      addMessage(attachmentMessage);
      
      try {
        const payload = type === 'summary'
            ? { type: 'summary', value: prompt }
            : { type: 'direct', value: prompt };
            
        const result = await onTriggerHook('generateImage', payload) as {url?: string, error?: string};

        if (result.url) {
            updateSession(curr => {
                const updatedMessages = curr.messages.map((m): Message => m.timestamp === attachmentMessage.timestamp 
                    ? { ...m, content: '', attachment: { ...m.attachment!, status: 'done', url: result.url } }
                    : m
                );
                return { ...curr, messages: updatedMessages };
            });
        } else {
            throw new Error(result.error || 'Image generation failed with no message.');
        }
      } catch (error) {
           const errorMessage = error instanceof Error ? error.message : String(error);
           logger.error('Image generation failed:', error);
           updateSession(curr => {
                const updatedMessages = curr.messages.map((m): Message => m.timestamp === attachmentMessage.timestamp 
                    ? { ...m, content: `Image generation failed: ${errorMessage}`, attachment: { ...m.attachment!, status: 'error' } }
                    : m
                );
                return { ...curr, messages: updatedMessages };
            });
      }
  };

  const handleGenerateImageInWindow = useCallback(async (prompt: string) => {
    logger.log("Generating image in floating window for prompt:", prompt);
    const payload = { type: 'direct', value: prompt };
    const result = await onTriggerHook('generateImage', payload) as {url?: string, error?: string};
    return result;
  }, [onTriggerHook]);
  
  const handleNarration = async (prompt: string, type: 'direct' | 'summary') => {
    let finalPrompt = prompt;
    if (type === 'summary') {
        const summaryPrompt = `Based on the following conversation, create a short, descriptive narration of the current scene or situation. Be creative and concise. Conversation:\n\n${prompt}`;
        try {
            finalPrompt = await generateContent(summaryPrompt);
        } catch(e) {
            addSystemMessage("Failed to summarize context for narration.");
            return;
        }
    }
    
    const narratorPlaceholder: Message = { role: 'narrator', content: '', timestamp: new Date().toISOString() };
    addMessage(narratorPlaceholder);
    
    let fullResponse = '';
    await streamGenericResponse(
        "You are a neutral, third-person narrator for a story. Describe the scene or events based on the user's request.",
        finalPrompt,
        (chunk) => {
            fullResponse += chunk;
            const msgElement = document.getElementById(narratorPlaceholder.timestamp);
            if (msgElement) {
                msgElement.innerHTML = fullResponse.replace(/\n/g, '<br>');
            }
        }
    );
     updateSession(curr => {
        const finalMessages = curr.messages.map(m => m.timestamp === narratorPlaceholder.timestamp ? {...m, content: fullResponse} : m);
        return { ...curr, messages: finalMessages };
    });
  };

  const handleImageButtonClick = () => {
    if (imageClickTimeout.current) {
      clearTimeout(imageClickTimeout.current);
      imageClickTimeout.current = null;
      const context = currentSessionRef.current.messages.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');
      handleImageGeneration(context, 'summary');
    } else {
      imageClickTimeout.current = window.setTimeout(() => {
        const prompt = window.prompt("Enter a prompt for the image:");
        if (prompt) handleImageGeneration(prompt, 'direct');
        imageClickTimeout.current = null;
      }, 250);
    }
  };

  const handleNarratorButtonClick = () => {
    if (narratorClickTimeout.current) {
      clearTimeout(narratorClickTimeout.current);
      narratorClickTimeout.current = null;
      const context = currentSessionRef.current.messages.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');
      handleNarration(context, 'summary');
    } else {
      narratorClickTimeout.current = window.setTimeout(() => {
        const prompt = window.prompt("Enter a narration instruction (e.g., 'Describe the weather changing'):");
        if (prompt) handleNarration(prompt, 'direct');
        narratorClickTimeout.current = null;
      }, 250);
    }
  };
  
  const renderMessageContent = (message: Message, index: number) => {
    if (message.role === 'tool' && message.toolName === 'execute_terminal_command') {
        const command = message.toolArgs?.['command'];
        const status = message.approvalStatus;

        return (
            <div className="bg-black/20 rounded-md p-3 border border-border-neutral font-mono text-sm w-full">
                <div className="flex items-center gap-2 mb-2 border-b border-border-neutral pb-2">
                    <TerminalIcon className="w-4 h-4 text-accent-yellow"/>
                    <span className="font-bold text-text-primary">Terminal Command Request</span>
                </div>
                <div className="mb-3">
                    <code className="block bg-black/40 p-2 rounded text-green-400">{command}</code>
                </div>
                
                {status === 'pending' && (
                    <div className="flex gap-2 justify-end">
                        <button 
                            onClick={() => handleToolAction(index, 'reject')}
                            className="px-3 py-1 bg-accent-red/20 text-accent-red hover:bg-accent-red/30 rounded border border-accent-red/50 transition-colors"
                        >
                            Deny
                        </button>
                        <button 
                            onClick={() => handleToolAction(index, 'approve')}
                            className="px-3 py-1 bg-accent-green/20 text-accent-green hover:bg-accent-green/30 rounded border border-accent-green/50 transition-colors"
                        >
                            Approve
                        </button>
                    </div>
                )}
                
                {status === 'approved' && (
                    <div className="text-accent-green text-xs border-t border-border-neutral pt-2 mt-2">
                        <span className="font-bold">✓ Approved</span>
                        {message.toolResult && (
                            <div className="mt-1 text-text-secondary whitespace-pre-wrap max-h-32 overflow-y-auto bg-black/10 p-1 rounded">
                                {message.toolResult.substring(0, 500) + (message.toolResult.length > 500 ? '...' : '')}
                            </div>
                        )}
                    </div>
                )}
                
                {status === 'rejected' && (
                    <div className="text-accent-red text-xs border-t border-border-neutral pt-2 mt-2">
                        <span className="font-bold">✗ Denied</span>
                    </div>
                )}
            </div>
        );
    }

    if (message.attachment) {
        if (message.attachment.type === 'image') {
            switch(message.attachment.status) {
                case 'loading': return <div className="p-4 text-center">Generating image...</div>;
                case 'done': return <img src={message.attachment.url} alt={message.attachment.prompt || 'Image'} className="rounded-lg max-w-sm mb-2" />;
                case 'error': return <div className="text-red-500">Error loading image</div>;
            }
        } else if (message.attachment.type === 'video') {
             return <video src={message.attachment.url} controls className="rounded-lg max-w-sm mb-2" />;
        } else if (message.attachment.type === 'audio') {
             return <audio src={message.attachment.url} controls className="mb-2" />;
        }
    }
    return <span id={message.timestamp} dangerouslySetInnerHTML={{ __html: message.content.replace(/\n/g, '<br />') }} />;
  };
  
  const getCharacterById = (id: string) => allCharacters.find(c => c.id === id);

  const isInputDisabled = (isStreaming && autoConverseStatus === 'stopped') || uploading;

  return (
    <div className="flex flex-col h-full bg-background-primary">
      {isImageWindowVisible && (
        <ImageGenerationWindow 
            onGenerate={handleGenerateImageInWindow}
            onClose={() => setIsImageWindowVisible(false)}
        />
      )}
      {isTerminalVisible && (
          <TerminalWindow 
            fileSystem={fileSystem}
            onUpdateFileSystem={onUpdateFileSystem}
            onClose={() => setIsTerminalVisible(false)}
          />
      )}
      
      {isMemoryModalVisible && (
        <MemoryImportModal 
            allSessions={allChatSessions}
            currentSessionId={currentSession.id}
            onClose={() => setIsMemoryModalVisible(false)}
            onImport={(fromSessionId) => {
                onMemoryImport(fromSessionId, currentSession.id);
                setIsMemoryModalVisible(false);
            }}
        />
      )}
      {isManageParticipantsVisible && (
          <ManageParticipantsModal 
            allCharacters={allCharacters}
            currentParticipantIds={currentSession.characterIds}
            onSave={(selectedIds) => {
                 updateSession(prev => ({
                    ...prev,
                    characterIds: selectedIds
                }));
                nextSpeakerIndex.current = 0;
                setIsManageParticipantsVisible(false);
            }}
            onClose={() => setIsManageParticipantsVisible(false)}
          />
      )}

      {/* Header */}
      <header className="flex items-center p-3 border-b border-border-neutral justify-between">
        <div className="flex items-center min-w-0">
            <div className="flex -space-x-4 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setIsManageParticipantsVisible(true)} title="Manage Participants">
                {participants.slice(0, 3).map(p => (
                    <img key={p.id} src={p.avatarUrl || `https://picsum.photos/seed/${p.id}/40/40`} alt={p.name} className="w-10 h-10 rounded-full border-2 border-background-primary"/>
                ))}
                {participants.length === 0 && (
                    <div className="w-10 h-10 rounded-full bg-background-tertiary flex items-center justify-center border-2 border-background-primary text-text-secondary">
                        <UsersIcon className="w-5 h-5"/>
                    </div>
                )}
            </div>
            <div className="ml-4 flex-1 min-w-0">
                <h2 className="text-lg font-bold text-text-primary truncate">{session.name}</h2>
                <p className="text-sm text-text-secondary truncate cursor-pointer hover:underline" onClick={() => setIsManageParticipantsVisible(true)}>
                    {participants.length > 0 ? participants.map(p=>p.name).join(', ') : 'No participants'}
                </p>
            </div>
        </div>
        <button onClick={() => setIsManageParticipantsVisible(true)} className="p-2 text-text-secondary hover:text-primary-500 rounded-full hover:bg-background-tertiary" title="Add/Remove Characters">
            <UsersIcon className="w-5 h-5" />
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {currentSession.messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary">
            <ChatBubbleIcon className="w-16 h-16 mb-4" />
            <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          currentSession.messages.map((msg, index) => {
            if (msg.role === 'narrator') {
              return (
                <div key={index} className="text-center my-2 group relative">
                  <div id={msg.timestamp} className="text-sm text-text-secondary italic px-4">
                    {renderMessageContent(msg, index)}
                  </div>
                  <div className="absolute top-1/2 -translate-y-1/2 right-0 flex items-center opacity-0 group-hover:opacity-100 transition-opacity space-x-1 pr-2">
                     <button onClick={() => ttsService.speak(msg.content, 'Puck')} title="Read Aloud" className="p-1 rounded-full text-text-secondary hover:bg-background-tertiary">
                        <SpeakerIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            }
            
            const msgCharacter = msg.characterId ? getCharacterById(msg.characterId) : null;
            const isUser = msg.role === 'user';
            const isTool = msg.role === 'tool';
            const alignRight = isUser;
            
            const characterVoiceId = msg.role === 'model' && msgCharacter ? (msgCharacter.voiceId || msgCharacter.voiceURI) : 'Puck';
            const isEditing = editingMessageIndex === index;
            
            return (
              <div key={index} className={`flex items-start gap-3 group ${alignRight ? 'justify-end' : 'justify-start'}`}>
                {(msg.role === 'model' || isTool) && msgCharacter && (
                  <img src={msgCharacter.avatarUrl || `https://picsum.photos/seed/${msgCharacter.id}/40/40`} alt={msgCharacter.name} className={`${avatarSizeClass} rounded-full flex-shrink-0`} title={msgCharacter.name}/>
                )}
                <div className={`relative max-w-xl p-3 rounded-lg ${
                    alignRight
                      ? 'bg-primary-600 text-text-accent'
                      : (isTool ? 'bg-background-tertiary text-text-primary border border-border-strong' : 'bg-background-secondary text-text-primary')
                  }`}>
                  
                  {/* Hover Actions */}
                  {!isEditing && !isTool && (
                      <div className={`absolute top-0 -translate-y-1/2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity space-x-1 ${alignRight ? 'left-[-4.5rem]' : 'right-[-4.5rem]'}`}>
                         <button onClick={() => ttsService.speak(msg.content, characterVoiceId)} title="Read Aloud" className="p-1 rounded-full text-text-secondary bg-background-tertiary hover:bg-opacity-80">
                            <SpeakerIcon className="w-4 h-4" />
                        </button>
                        <button onClick={() => startEditing(index, msg.content)} title="Edit Message" className="p-1 rounded-full text-text-secondary bg-background-tertiary hover:bg-opacity-80">
                            <PencilIcon className="w-4 h-4" />
                        </button>
                        {msg.role === 'model' && (
                            <button onClick={() => regenerateResponse(index)} title="Regenerate Response" className="p-1 rounded-full text-text-secondary bg-background-tertiary hover:bg-opacity-80">
                                <RefreshIcon className="w-4 h-4" />
                            </button>
                        )}
                      </div>
                  )}

                  {(msg.role === 'model' || isTool) && msgCharacter && <p className="font-bold text-sm mb-1">{msgCharacter.name}</p>}
                  
                  {isEditing ? (
                      <div className="min-w-[200px]">
                          <textarea 
                            value={editContent} 
                            onChange={(e) => setEditContent(e.target.value)} 
                            className="w-full p-2 text-sm text-text-primary bg-background-primary border border-border-strong rounded focus:outline-none focus:ring-1 focus:ring-accent-yellow"
                            rows={3}
                          />
                          <div className="flex justify-end space-x-2 mt-2">
                              <button onClick={cancelEditing} className="p-1 text-text-secondary hover:text-text-primary"><XMarkIcon className="w-4 h-4"/></button>
                              <button onClick={() => saveEdit(index)} className="p-1 text-accent-green hover:opacity-80"><CheckCircleIcon className="w-4 h-4"/></button>
                          </div>
                      </div>
                  ) : (
                      <div className="break-words">
                        {renderMessageContent(msg, index)}
                      </div>
                  )}

                  {msg.signature && !isEditing && (
                    <div className="absolute -bottom-2 -right-2 bg-background-primary rounded-full p-0.5 shadow-sm">
                        {verifiedSignatures[msg.timestamp] === true && <CheckCircleIcon className="w-4 h-4 text-accent-green" title="Signature Verified" />}
                        {verifiedSignatures[msg.timestamp] === false && <ExclamationTriangleIcon className="w-4 h-4 text-accent-yellow" title="Signature Invalid" />}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-border-neutral">
        <div className="flex items-center bg-background-secondary rounded-lg p-2">
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*,audio/*,video/*" className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} className="p-2 text-text-secondary hover:text-primary-500 disabled:opacity-50" title="Attach Image, Audio, or Video" disabled={isInputDisabled}>
            <PaperClipIcon className="w-6 h-6" />
          </button>
          
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
            placeholder={
                uploading ? "Uploading..." :
                autoConverseStatus === 'running' ? "AI conversation in progress..." :
                `Message ${session.name}...`
            }
            className="flex-1 bg-transparent resize-none focus:outline-none px-2 text-text-primary"
            rows={1}
            disabled={isInputDisabled}
          />
          
          {/* New Terminal Button */}
          <button 
                onClick={() => setIsTerminalVisible(!isTerminalVisible)} 
                title="Open Terminal Access" 
                className={`p-2 rounded-full transition-colors ${isTerminalVisible ? 'text-green-500' : 'text-text-secondary hover:text-green-500'}`} disabled={isInputDisabled}
            >
                <TerminalIcon className="w-6 h-6" />
            </button>

          <button onClick={() => setIsImageWindowVisible(!isImageWindowVisible)} title="Open Image Window" className={`p-2 rounded-full ${isImageWindowVisible ? 'text-primary-500' : 'text-text-secondary'}`}><PaletteIcon className="w-6 h-6"/></button>
          <button onClick={() => setIsTtsEnabled(!isTtsEnabled)} title="Toggle TTS" className={`p-2 rounded-full ${isTtsEnabled ? 'text-primary-500' : 'text-text-secondary'}`}><SpeakerIcon className="w-6 h-6"/></button>
          <button onClick={() => setIsMemoryModalVisible(true)} title="Import Memory" className="p-2 text-text-secondary hover:text-primary-500"><BrainIcon className="w-6 h-6"/></button>
          <button onClick={handleNarratorButtonClick} title="Narrate" className="p-2 text-text-secondary hover:text-primary-500"><BookIcon className="w-6 h-6"/></button>
          <button onClick={handleImageButtonClick} title="Generate Image" className="p-2 text-text-secondary hover:text-primary-500"><ImageIcon className="w-6 h-6"/></button>
          
          <button onClick={handleSendMessage} disabled={(!input.trim() && !uploading) || isInputDisabled} className="p-2 text-text-secondary hover:text-primary-500 disabled:opacity-50" title="Send message">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

import React from 'react';

export interface CryptoKeys {
    publicKey: JsonWebKey;
    privateKey: JsonWebKey;
}

export interface Message {
  role: 'user' | 'model' | 'narrator' | 'tool';
  content: string;
  timestamp: string;
  characterId?: string; 
  attachment?: {
    type: 'image' | 'audio' | 'video';
    status: 'loading' | 'done' | 'error';
    url?: string;
    mimeType?: string;
    name?: string;
    prompt?: string;
  };
  signature?: string;
  publicKeyJwk?: JsonWebKey;
  
  toolCallId?: string;
  toolName?: string;
  toolArgs?: any;
  toolResult?: any;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
}

export interface UISettings {
  backgroundImage?: string;
  bannerImage?: string;
  avatarSize?: 'small' | 'medium' | 'large';
}

export interface ChatSession {
  id: string;
  characterIds: string[];
  name: string;
  messages: Message[];
  isArchived?: boolean;
  uiSettings?: UISettings;
  lorebookIds?: string[];
}

export interface ApiConfig {
  service: 'default' | 'gemini' | 'openai' | 'pollinations' | 'kobold' | 'groq' | 'mistral' | 'openrouter';
  apiKey?: string;
  apiEndpoint?: string;
  model?: string;
  rateLimit?: number;
}

export interface EmbeddingConfig {
  service: 'gemini' | 'openai';
  apiKey?: string;
  apiEndpoint?: string;
  model?: string;
}

export interface RagSource {
    id: string;
    fileName: string;
    fileType: string;
    createdAt: string;
    data?: string;
}

export interface Character {
  id:string;
  name: string;
  description: string;
  personality: string;
  avatarUrl: string;
  tags: string[];
  createdAt: string;
  apiConfig?: ApiConfig;
  physicalAppearance?: string;
  personalityTraits?: string;
  lore?: string[];
  memory?: string;
  
  voiceId?: string;
  searchEnabled?: boolean;
  thinkingEnabled?: boolean;
  terminalEnabled?: boolean;
  
  // Dynamic Avatar Fields
  dynamicAvatarEnabled?: boolean;
  currentAvatarUrl?: string;

  voiceURI?: string;
  firstMessage?: string;
  characterType?: 'character' | 'narrator';
  ragEnabled?: boolean;
  embeddingConfig?: EmbeddingConfig;
  knowledgeSourceIds?: string[];
  ragSources?: RagSource[]; 
  pluginEnabled?: boolean;
  pluginCode?: string;
  keys?: CryptoKeys;
  signature?: string;
  userPublicKeyJwk?: JsonWebKey;
  isArchived?: boolean;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  code: string;
  enabled: boolean;
  settings?: {
    [key:string]: any;
  };
}

export interface LorebookEntry {
    id: string;
    keys: string[];
    content: string;
}

export interface Lorebook {
    id: string;
    name: string;
    description: string;
    entries: LorebookEntry[];
}

export interface FileSystemNode {
    name: string;
    type: 'file' | 'dir';
    content?: string;
    children?: { [name: string]: FileSystemNode };
    parentId?: string | null;
}

export interface FileSystemState {
    root: FileSystemNode;
    currentPath: string;
    commandHistory: string[];
}

export interface AppData {
  characters: Character[];
  chatSessions: ChatSession[];
  plugins?: Plugin[];
  lorebooks?: Lorebook[]; 
  knowledgeBase?: RagSource[];
  userKeys?: CryptoKeys;
  fileSystem?: FileSystemState;
}

export type GeminiApiRequest = 
  | { type: 'generateContent'; prompt: string }
  | { type: 'generateImage'; prompt: string, settings?: { [key: string]: any } };

export interface PluginApiRequest {
  ticket: number;
  apiRequest: GeminiApiRequest;
}

export interface PluginApiResponse {
  ticket: number;
  result?: any;
  error?: string;
}

export interface VectorChunk {
    id: string; 
    sourceId: string;
    content: string;
    embedding: number[];
}

export interface ConfirmationRequest {
  message: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

import React from 'react';

export interface CryptoKeys {
    publicKey: JsonWebKey;
    privateKey: JsonWebKey;
}

export interface Message {
  role: 'user' | 'model' | 'narrator' | 'tool';
  content: string;
  timestamp: string;
  characterId?: string; // Identifies which character sent a 'model' message
  attachment?: {
    type: 'image' | 'audio' | 'video';
    status: 'loading' | 'done' | 'error';
    url?: string; // Base64 data URL
    mimeType?: string;
    name?: string;
    prompt?: string;
  };
  // New security fields
  signature?: string; // Signed by user or character's private key
  publicKeyJwk?: JsonWebKey; // Public key of the signer for verification
  
  // Function Calling / Terminal Fields
  toolCallId?: string;
  toolName?: string;
  toolArgs?: any;
  toolResult?: any; // The output of the tool execution
  approvalStatus?: 'pending' | 'approved' | 'rejected'; // For human-in-the-loop
}

export interface UISettings {
  backgroundImage?: string; // Now stores an image ID like 'nexus-image://uuid'
  bannerImage?: string; // Now stores an image ID
  avatarSize?: 'small' | 'medium' | 'large';
}

export interface ChatSession {
  id: string;
  characterIds: string[];
  name: string;
  messages: Message[];
  isArchived?: boolean;
  uiSettings?: UISettings;
  lorebookIds?: string[]; // New: Link to active lorebooks
}

export interface ApiConfig {
  service: 'default' | 'gemini' | 'openai' | 'pollinations' | 'kobold' | 'groq' | 'mistral' | 'openrouter';
  apiKey?: string;
  apiEndpoint?: string; // Base URL for OpenAI-compatible
  model?: string;
  rateLimit?: number; // Delay in milliseconds between requests
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
    data?: string; // Base64 data for images
    // content is stored in vector chunks for text, but we keep metadata here
}

export interface Character {
  id:string;
  name: string;
  description: string;
  personality: string; // Will be used as Role Instruction
  avatarUrl: string; // Now stores an image ID like 'nexus-image://uuid'
  tags: string[];
  createdAt: string;
  apiConfig?: ApiConfig;
  // New fields for more detailed characters
  physicalAppearance?: string;
  personalityTraits?: string; // Comma-separated
  lore?: string[];
  memory?: string;
  
  // Advanced Features
  voiceId?: string; // For GenAI Text-to-Speech (Puck, Kore, etc.)
  searchEnabled?: boolean; // Google Search Grounding
  thinkingEnabled?: boolean; // Gemini 3.0 Thinking Mode
  terminalEnabled?: boolean; // Terminal / Filesystem Access
  
  voiceURI?: string; // Deprecated: Old Browser TTS
  firstMessage?: string; // New: For character card compatibility
  characterType?: 'character' | 'narrator'; // New: Distinguish between persona and scenario bots
  // New RAG fields
  ragEnabled?: boolean;
  embeddingConfig?: EmbeddingConfig;
  knowledgeSourceIds?: string[]; // Link to global knowledge base
  // Deprecated but kept for migration
  ragSources?: RagSource[]; 
  // New per-character plugin fields
  pluginEnabled?: boolean;
  pluginCode?: string;
  // New security fields
  keys?: CryptoKeys; // Character's own signing key pair
  signature?: string; // Signed by the USER's master private key
  userPublicKeyJwk?: JsonWebKey; // User's public key that signed this character
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

// File System Types
export interface FileSystemNode {
    name: string;
    type: 'file' | 'dir';
    content?: string; // For files
    children?: { [name: string]: FileSystemNode }; // For dirs
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
  knowledgeBase?: RagSource[]; // New: Centralized document library
  // New security field
  userKeys?: CryptoKeys;
  // New: Persistent File System
  fileSystem?: FileSystemState;
}

// Types for the secure plugin API bridge
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

// RAG Types
export interface VectorChunk {
    id: string; // chunk-[uuid]
    characterId?: string; // Deprecated: chunks are now source-centric
    sourceId: string;
    content: string;
    embedding: number[];
}

// Type for the new confirmation modal
export interface ConfirmationRequest {
  message: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

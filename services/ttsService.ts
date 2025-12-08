
import { logger } from './loggingService';
import { generateSpeech } from './geminiService';

// Audio Context for Web Audio API
let audioContext: AudioContext | null = null;
let isPlaying = false;
let audioQueue: { text: string, voiceId: string }[] = [];

// Initialize Audio Context on user interaction (required by browsers)
export const initAudioContext = () => {
    if (!audioContext) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
};

// Available GenAI Voices
export const AVAILABLE_VOICES = [
    { name: 'Puck', voiceURI: 'Puck', lang: 'en-US' },
    { name: 'Charon', voiceURI: 'Charon', lang: 'en-US' },
    { name: 'Kore', voiceURI: 'Kore', lang: 'en-US' },
    { name: 'Fenrir', voiceURI: 'Fenrir', lang: 'en-US' },
    { name: 'Zephyr', voiceURI: 'Zephyr', lang: 'en-US' },
];

export const getVoices = (): Promise<SpeechSynthesisVoice[]> => {
    // Return compatibility object to match interface expected by CharacterForm
    return Promise.resolve(AVAILABLE_VOICES as any[]);
};

export const isSupported = (): boolean => {
    return true; // We assume Web Audio API is supported in modern browsers
};

// Helper to decode PCM data
async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const processQueue = async () => {
    if (isPlaying || audioQueue.length === 0) return;

    initAudioContext();
    if (!audioContext) return;

    isPlaying = true;
    const item = audioQueue.shift();

    if (item) {
        try {
            logger.log(`TTS Processing: ${item.text.substring(0, 20)}...`);
            const pcmData = await generateSpeech(item.text, item.voiceId || 'Puck');
            
            const audioBuffer = await decodeAudioData(pcmData, audioContext);
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            
            source.onended = () => {
                isPlaying = false;
                processQueue();
            };
            
            source.start();
        } catch (error) {
            logger.error("TTS Playback Error:", error);
            isPlaying = false;
            processQueue(); // Try next
        }
    } else {
        isPlaying = false;
    }
};

export const speak = async (text: string, voiceURI?: string) => {
    if (!text?.trim()) return;
    
    // Clean text of markdown/artifacts before speaking
    const cleanText = text.replace(/\[.*?\]/g, '').replace(/\*/g, '').trim();
    if (!cleanText) return;

    audioQueue.push({ text: cleanText, voiceId: voiceURI || 'Puck' });
    processQueue();
};

export const cancel = () => {
    audioQueue = [];
    if (audioContext && audioContext.state === 'running') {
        audioContext.close().then(() => {
            audioContext = null;
            isPlaying = false;
        });
    }
};

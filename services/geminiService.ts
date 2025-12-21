import { GoogleGenAI, GenerateContentResponse, Modality, FunctionDeclaration, Type } from "@google/genai";
import { Character, Message, ApiConfig } from "../types.ts";
import { logger } from "./loggingService.ts";

// --- Rate Limiting ---
const lastRequestTimestamps = new Map<string, number>();

// --- Gemini Client Setup ---
const API_KEY = typeof process !== 'undefined' ? process.env.API_KEY : undefined;
let defaultAi: GoogleGenAI | null = null;

if (API_KEY) {
  defaultAi = new GoogleGenAI({ apiKey: API_KEY });
} else {
  const errorMsg = "API_KEY environment variable not set. The application will not be able to connect to the Gemini API by default.";
  logger.warn(errorMsg);
}

const getAiClient = (apiKey?: string): GoogleGenAI => {
    if (apiKey) {
        logger.debug("Creating a new Gemini client with a custom API key.");
        return new GoogleGenAI({ apiKey });
    }
    if (defaultAi) {
        return defaultAi;
    }
    throw new Error("Default Gemini API key not configured. Please set a custom API key for the character or plugin.");
}

// --- Helper: Blob to Base64 ---
export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const base64ToUint8Array = (base64: string): Uint8Array => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

const imageUrlToBase64 = async (url: string): Promise<string> => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const base64 = await blobToBase64(blob);
        return `data:${blob.type};base64,${base64}`;
    } catch (e) {
        return url; 
    }
};

const isNetworkError = (error: any): boolean => {
    if (!error) return false;
    const msg = String(error.message || error).toLowerCase();
    return (
        error.name === 'TypeError' ||
        msg.includes('failed to fetch') ||
        msg.includes('networkerror') ||
        msg.includes('network request failed') ||
        msg.includes('connection refused')
    );
};

const withRetry = async <T,>(
    apiCall: () => Promise<T>,
    maxRetries = 3,
    initialDelay = 2000
): Promise<T> => {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            return await apiCall();
        } catch (error: any) {
            let isRateLimitError = false;
            let errorMessage = "An unknown error occurred";

            if (error && typeof error.message === 'string') {
                 errorMessage = error.message;
                 if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
                     isRateLimitError = true;
                 }
            } else if (error instanceof Response && (error.status === 429 || error.status === 503)) {
                isRateLimitError = true;
            }

            const networkError = isNetworkError(error);

            if (isRateLimitError || networkError) {
                 if (attempt + 1 >= maxRetries) {
                    if (networkError) {
                        throw new Error(`Network error: ${errorMessage}. If running locally, this is likely a CORS restriction.`);
                    }
                    logger.warn(`API rate limit exceeded. All ${maxRetries} retries failed. Rethrowing final error.`);
                    throw error;
                }
                const delay = initialDelay * Math.pow(2, attempt) + Math.random() * 1000;
                logger.warn(`API error (${errorMessage}). Retrying in ${Math.round(delay / 1000)}s... (Attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                attempt++;
                continue;
            }
            
            logger.error("API call failed with non-retriable error:", error);
            throw error;
        }
    }
    throw new Error('API request failed to complete after all retries.');
};

const fetchWithRetry = async (
    url: RequestInfo, 
    options: RequestInit, 
    maxRetries = 3, 
    initialDelay = 2000
): Promise<Response> => {
    return withRetry(async () => {
        const response = await fetch(url, options);
        if (response.status === 429) {
             throw new Error('429 Too Many Requests');
        }
        return response;
    }, maxRetries, initialDelay);
};

const streamOpenAIChatResponse = async (
    config: ApiConfig,
    systemInstruction: string,
    history: Message[],
    onChunk: (chunk: string) => void
): Promise<void> => {
    const messages = [
        { role: 'system', content: systemInstruction },
        ...history.map(m => {
            let role = 'user';
            let content = m.content;
            
            if (m.role === 'model') {
                role = 'assistant';
            } else if (m.role === 'narrator') {
                role = 'user'; 
                content = `[Narrator]: ${m.content}`;
            }
            return { role, content };
        })
    ];

    try {
        const response = await fetchWithRetry(config.apiEndpoint!, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey || 'ollama'}` 
            },
            body: JSON.stringify({
                model: config.model || 'llama3',
                messages: messages,
                stream: true,
            }),
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Unauthorized (401). Please check your API Key in Character Settings.');
            }
            const errorText = await response.text();
            throw new Error(`OpenAI API Error: ${response.status} - ${errorText}`);
        }

        if (!response.body) throw new Error('Response body is null');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data: ')) {
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') return;
                    try {
                        const json = JSON.parse(data);
                        const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text;
                        if (content) onChunk(content);
                    } catch (e) {
                    }
                }
            }
        }
    } catch (error) {
        logger.error("Error streaming OpenAI response:", error);
        onChunk(`[Error: ${error instanceof Error ? error.message : String(error)}]`);
    }
};

const streamPollinationsChatResponse = async (
    config: ApiConfig,
    systemInstruction: string,
    history: Message[],
    onChunk: (chunk: string) => void
): Promise<void> => {
    const messages = [
        { role: 'system', content: systemInstruction },
        ...history.map(m => ({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.role === 'narrator' ? `[Narrator]: ${m.content}` : m.content
        }))
    ];

    const model = config.model || 'openai';

    try {
        const response = await fetchWithRetry('https://text.pollinations.ai/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages: messages,
                model: model, 
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Pollinations API Error (${response.status}): ${errText}`);
        }
        
        const raw = await response.text();
        
        try {
            if (raw.trim().startsWith('{')) {
                const json = JSON.parse(raw);
                if (json.choices && json.choices[0] && json.choices[0].message) {
                    onChunk(json.choices[0].message.content);
                    return;
                }
                if (json.response) {
                    onChunk(json.response);
                    return;
                }
            }
        } catch (e) {
        }
        onChunk(raw);
    } catch (error) {
        logger.error("Error generating Pollinations response:", error);
        onChunk(`[Error: ${error instanceof Error ? error.message : String(error)}]`);
    }
};

const buildImagePrompt = (prompt: string, settings: { [key: string]: any }): string => {
    let stylePrompt = '';
    if (settings.style && settings.style !== 'Default (None)') {
        if (settings.style === 'Custom' && settings.customStylePrompt) {
            stylePrompt = `${settings.customStylePrompt}, `;
        } else if (settings.style !== 'Custom') {
             stylePrompt = `${settings.style} style, `;
        }
    }
    const negativePrompt = settings.negativePrompt ? `. Negative prompt: ${settings.negativePrompt}` : '';
    return `${stylePrompt}${prompt}${negativePrompt}`;
};

const generateGeminiImage = async (prompt: string, settings: { [key: string]: any }): Promise<string> => {
    const ai = getAiClient(settings?.apiKey);
    const fullPrompt = buildImagePrompt(prompt, settings);
    logger.log("Generating Gemini image with full prompt:", { fullPrompt });

    try {
        const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [{ text: fullPrompt }],
            },
            config: {
                imageConfig: {
                    aspectRatio: "1:1",
                }
            }
        }));

        const candidates = response.candidates;
        if (!candidates || candidates.length === 0) {
             throw new Error("No candidates returned from Gemini API.");
        }

        const parts = candidates[0].content?.parts || [];
        
        for (const part of parts) {
            if (part.inlineData) {
                const base64EncodeString: string = part.inlineData.data;
                return `data:image/png;base64,${base64EncodeString}`;
            }
        }

        for (const part of parts) {
            if (part.text) {
                throw new Error(`Model refused or failed to generate image. Response: ${part.text}`);
            }
        }
        
        throw new Error("No image data found in response.");
    } catch (error) {
        logger.error("Error generating image with gemini-2.5-flash-image:", error);
        throw error;
    }
};

const generateOpenAIImage = async (prompt: string, settings: { [key: string]: any }): Promise<string> => {
    const apiEndpoint = settings.apiEndpoint || 'https://api.openai.com/v1/images/generations';
    const apiKey = settings.apiKey;
    const model = settings.model || 'dall-e-3';
    
    if (!apiKey && apiEndpoint.includes('openai.com')) {
        throw new Error("API Key is required for OpenAI image generation.");
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const fullPrompt = buildImagePrompt(prompt, settings);

    const body = JSON.stringify({
        model: model,
        prompt: fullPrompt,
        n: 1,
        size: "1024x1024",
        response_format: "b64_json"
    });

    const response = await fetchWithRetry(apiEndpoint, {
        method: 'POST',
        headers,
        body
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI Image API Error (${response.status}): ${err}`);
    }

    const data = await response.json();
    if (data.data && data.data.length > 0) {
        if (data.data[0].b64_json) {
            return `data:image/png;base64,${data.data[0].b64_json}`;
        } else if (data.data[0].url) {
            return await imageUrlToBase64(data.data[0].url);
        }
    }
    throw new Error("No image data returned from OpenAI API.");
};

const generatePollinationsImage = async (prompt: string, settings: { [key: string]: any }): Promise<string> => {
    const model = settings.model || 'flux';
    const fullPrompt = buildImagePrompt(prompt, settings);
    const encodedPrompt = encodeURIComponent(fullPrompt);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=${model}&nologo=true`;
    
    try {
        const response = await fetchWithRetry(url, { method: 'GET' });
        if (!response.ok) throw new Error(`Pollinations API Error: ${response.status}`);
        const blob = await response.blob();
        const base64 = await blobToBase64(blob);
        return `data:${blob.type};base64,${base64}`;
    } catch (e) {
        logger.warn("Failed to download Pollinations image, returning direct URL.", e);
        return url;
    }
};

const generateHuggingFaceImage = async (prompt: string, settings: { [key: string]: any }): Promise<string> => {
    const model = settings.model || 'black-forest-labs/FLUX.1-dev';
    const apiKey = settings.apiKey;
    const url = `https://api-inference.huggingface.co/models/${model}`;
    
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const fullPrompt = buildImagePrompt(prompt, settings);

    try {
        const response = await fetchWithRetry(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ inputs: fullPrompt })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Hugging Face API Error (${response.status}): ${err}`);
        }

        const blob = await response.blob();
        const base64 = await blobToBase64(blob);
        return `data:${blob.type};base64,${base64}`;
    } catch (error: any) {
        const msg = String(error.message || error).toLowerCase();
        if (msg.includes('network error') || msg.includes('failed to fetch') || msg.includes('cors')) {
            logger.warn("Hugging Face direct call failed (likely CORS). Falling back to Pollinations.ai");
            return await generatePollinationsImage(prompt, { ...settings, model: 'flux' });
        }
        throw error;
    }
};

const generateStabilityImage = async (prompt: string, settings: { [key: string]: any }): Promise<string> => {
    const apiKey = settings.apiKey;
    if (!apiKey) throw new Error("API Key is required for Stability.ai");
    
    const model = settings.model || 'stable-diffusion-xl-1024-v1-0';
    const url = `https://api.stability.ai/v1/generation/${model}/text-to-image`;
    const fullPrompt = buildImagePrompt(prompt, settings);

    const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            text_prompts: [{ text: fullPrompt }],
            cfg_scale: 7,
            height: 1024,
            width: 1024,
            samples: 1,
            steps: 30,
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Stability API Error (${response.status}): ${err}`);
    }

    const data = await response.json();
    if (data.artifacts && data.artifacts.length > 0) {
        return `data:image/png;base64,${data.artifacts[0].base64}`;
    }
    throw new Error("No artifacts returned from Stability API.");
};

const generateAIHordeImage = async (prompt: string, settings: { [key: string]: any }): Promise<string> => {
    const apiKey = settings.apiKey || '0000000000';
    const model = settings.model || 'stable_diffusion';
    const fullPrompt = buildImagePrompt(prompt, settings);
    
    const initResponse = await fetchWithRetry('https://stablehorde.net/api/v2/generate/async', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': apiKey,
            'Client-Agent': 'AI_Nexus:1.0:Unknown',
        },
        body: JSON.stringify({
            prompt: fullPrompt,
            params: {
                n: 1,
                steps: 20,
                width: 512,
                height: 512,
            },
            models: [model],
            nsfw: true,
            censor_nsfw: false,
        })
    });

    if (!initResponse.ok) {
        const err = await initResponse.text();
        throw new Error(`AI Horde Init Error: ${err}`);
    }

    const initData = await initResponse.json();
    const id = initData.id;
    if (!id) throw new Error("AI Horde did not return a Job ID.");

    let attempts = 0;
    while (attempts < 60) {
        await new Promise(r => setTimeout(r, 2000));
        const statusResponse = await fetch(`https://stablehorde.net/api/v2/generate/status/${id}`);
        if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            if (statusData.done) {
                if (statusData.generations && statusData.generations.length > 0) {
                    const gen = statusData.generations[0];
                    return gen.img; 
                }
                throw new Error("AI Horde finished but returned no image.");
            }
            if (!statusData.is_possible) {
                throw new Error("AI Horde says generation is impossible with current settings.");
            }
        }
        attempts++;
    }
    throw new Error("AI Horde generation timed out.");
};

const buildSystemInstruction = (character: Character, allParticipants: Character[] = []): string => {
    let instruction = `You are an AI character named ${character.name}.\n\n`;

    if (allParticipants.length > 1) {
        const otherParticipantNames = allParticipants
            .filter(p => p.id !== character.id)
            .map(p => p.name)
            .join(', ');
        instruction += `You are in a group conversation with: ${otherParticipantNames}. Interact with them naturally based on your persona.\n\n`;
    }

    instruction += "== CORE IDENTITY ==\n";
    if (character.description) instruction += `Description: ${character.description}\n`;
    if (character.physicalAppearance) instruction += `Physical Appearance: ${character.physicalAppearance}\n`;
    if (character.personalityTraits) instruction += `Personality Traits: ${character.personalityTraits}\n`;
    instruction += "\n";

    if (character.personality) {
        instruction += "== ROLE INSTRUCTION ==\n";
        instruction += `${character.personality}\n\n`;
    }

    if (character.memory) {
        instruction += "== MEMORY (Recent Events) ==\n";
        instruction += `${character.memory}\n\n`;
    }

    if (character.lore && character.lore.length > 0 && character.lore.some(l => l.trim() !== '')) {
        instruction += "== LORE (Key Facts) ==\n";
        instruction += character.lore.filter(fact => fact.trim() !== '').map(fact => `- ${fact}`).join('\n') + '\n\n';
    }

    instruction += "== TOOLS ==\n";
    if (character.searchEnabled) {
        instruction += "You have access to Google Search to find real-time information. Use it when the user asks about current events or factual topics.\n";
    }
    instruction += "You can see images and hear audio if provided. Analyze them as your character would.\n";
    instruction += "You have the ability to generate images. To do so, include a special command in your response: [generate_image: A detailed description of the image you want to create].\n\n";
    
    instruction += "Engage in conversation based on this complete persona. Do not break character. Respond to the user's last message.";

    return instruction;
};

const normalizeGeminiHistory = (history: Message[]) => {
    const relevantMessages = history.filter(msg => msg.role === 'user' || msg.role === 'model' || msg.role === 'narrator');
    if (relevantMessages.length === 0) return [];

    const mapped = relevantMessages.map(msg => {
        const role = msg.role === 'model' ? 'model' : 'user';
        let parts: any[] = [];
        const textContent = msg.role === 'narrator' ? `[NARRATOR]: ${msg.content}` : msg.content;
        if (textContent.trim()) {
            parts.push({ text: textContent });
        }
        if (msg.attachment && msg.attachment.url && msg.attachment.status === 'done') {
            const base64Data = msg.attachment.url.split(',')[1]; 
            if (base64Data) {
                parts.push({
                    inlineData: {
                        mimeType: msg.attachment.mimeType || 'image/png',
                        data: base64Data
                    }
                });
            }
        }
        return { role, parts };
    });

    const merged = [];
    if (mapped.length > 0) {
        merged.push(mapped[0]);
        for (let i = 1; i < mapped.length; i++) {
            const prev = merged[merged.length - 1];
            const curr = mapped[i];
            if (prev.role === curr.role) {
                prev.parts = [...prev.parts, ...curr.parts];
            } else {
                merged.push(curr);
            }
        }
    }
    return merged;
};

const terminalTool: FunctionDeclaration = {
    name: "execute_terminal_command",
    description: "Execute a shell command in a restricted Linux terminal. Use this to read files, write files, create directories, or list files. The user must approve every command.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            command: {
                type: Type.STRING,
                description: "The bash command to execute (e.g., 'ls -la', 'cat file.txt', 'echo \"hello\" > file.txt')."
            }
        },
        required: ["command"]
    }
};

const googleSearchTool = { googleSearch: {} };

const getToolsForCharacter = (character: Character) => {
    const tools: any[] = [];
    if (character.searchEnabled) {
        tools.push(googleSearchTool);
    }
    if (character.terminalEnabled) {
        tools.push({ functionDeclarations: [terminalTool] });
    }
    return tools.length > 0 ? tools : undefined;
};

export const generateAvatarPrompt = async (character: Character, lastResponse: string): Promise<string> => {
    const baseDesc = character.physicalAppearance || character.description || "A person";
    const prompt = `Based on the character description: "${baseDesc}", and their most recent response: "${lastResponse}", create a concise image generation prompt that captures their current facial expression, mood, and outfit. Format: "[Character Look], [Expression], [Outfit/Action], [Style]". Keep it under 40 words.`;
    try {
        return await generateContent(prompt);
    } catch (e) {
        logger.warn("Failed to generate avatar prompt", e);
        return baseDesc;
    }
};

const streamGeminiChatResponse = async (
    character: Character,
    systemInstruction: string,
    history: Message[],
    onChunk: (chunk: string | any) => void
): Promise<void> => {
    try {
        const customApiKey = character.apiConfig?.service === 'gemini' ? character.apiConfig.apiKey : undefined;
        const ai = getAiClient(customApiKey);
        
        const contents = normalizeGeminiHistory(history);
        if (contents.length === 0) {
            logger.warn("streamGeminiChatResponse was called with an empty effective history. Aborting.");
            return;
        }

        let modelName = 'gemini-2.5-flash';
        let config: any = { systemInstruction: systemInstruction };

        if (character.thinkingEnabled) {
            modelName = 'gemini-3-pro-preview';
            config.thinkingConfig = { thinkingBudget: 32768 }; 
        } 
        
        const tools = getToolsForCharacter(character);
        if (tools) {
            config.tools = tools;
        }

        logger.log(`Calling Gemini with model: ${modelName}`, { tools: !!tools });

        const responseStream = await withRetry(() => ai.models.generateContentStream({
            model: modelName,
            contents: contents,
            config: config
        })) as AsyncIterable<GenerateContentResponse>;

        for await (const chunk of responseStream) {
            if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                onChunk({ type: 'tool_call', data: chunk.functionCalls[0] });
                return; 
            }
            if (chunk.text) {
                onChunk(chunk.text);
            }
        }
    } catch (error) {
        logger.error("Error generating Gemini content stream:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        onChunk(`Sorry, an error occurred with the Gemini API: ${errorMessage}`);
    }
};

export const generateSpeech = async (text: string, voiceName: string = 'Puck', apiKey?: string): Promise<Uint8Array> => {
    try {
        const ai = getAiClient(apiKey);
        logger.log(`Generating speech for: "${text.substring(0, 30)}..." using voice: ${voiceName}`);

        const response = await withRetry(() => ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceName },
                    },
                },
            },
        })) as GenerateContentResponse;

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) {
            throw new Error("No audio data received from Gemini TTS.");
        }

        return base64ToUint8Array(base64Audio);
    } catch (error) {
        logger.error("Error generating speech:", error);
        throw error;
    }
};

export const streamChatResponse = async (
    character: Character,
    allParticipants: Character[],
    history: Message[],
    onChunk: (chunk: string | any) => void,
    systemInstructionOverride?: string
): Promise<void> => {
    const config = character.apiConfig || { service: 'default' };
    const rateLimit = config.rateLimit;
    if (rateLimit && rateLimit > 0) {
        const characterId = character.id;
        const lastRequestTime = lastRequestTimestamps.get(characterId) || 0;
        const now = Date.now();
        const elapsed = now - lastRequestTime;

        if (elapsed < rateLimit) {
            const delay = rateLimit - elapsed;
            logger.log(`Rate limiting character "${character.name}". Delaying for ${delay}ms.`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        lastRequestTimestamps.set(characterId, Date.now());
    }

    let systemInstruction = buildSystemInstruction(character, allParticipants);
    if (systemInstructionOverride) {
        systemInstruction += `\n\n[ADDITIONAL INSTRUCTIONS FOR THIS RESPONSE ONLY]:\n${systemInstructionOverride}`;
        logger.log("Applying system instruction override for next response.");
    }

    if (config.service === 'pollinations') {
        await streamPollinationsChatResponse(config, systemInstruction, history, onChunk);
    } else if (['openai', 'groq', 'mistral', 'openrouter', 'kobold'].includes(config.service)) {
        if (!config.apiEndpoint) {
            onChunk(`Error: API endpoint is not configured for service '${config.service}'. Please check character settings.`);
            return;
        }
        await streamOpenAIChatResponse(config, systemInstruction, history, onChunk);
    } else { 
        await streamGeminiChatResponse(character, systemInstruction, history, onChunk);
    }
};

export const generateImageFromPrompt = async (prompt: string, settings?: { [key: string]: any }): Promise<string> => {
    try {
        const safeSettings = settings || {};
        const rateLimit = safeSettings.rateLimit;
        if (rateLimit && rateLimit > 0) {
            const pluginId = 'default-image-generator';
            const lastRequestTime = lastRequestTimestamps.get(pluginId) || 0;
            const now = Date.now();
            const elapsed = now - lastRequestTime;
            if (elapsed < rateLimit) {
                const delay = rateLimit - elapsed;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            lastRequestTimestamps.set(pluginId, Date.now());
        }

        const service = safeSettings.service || 'default';
        switch (service) {
            case 'openai':
                return await generateOpenAIImage(prompt, safeSettings);
            case 'pollinations':
                return await generatePollinationsImage(prompt, safeSettings);
            case 'huggingface':
                return await generateHuggingFaceImage(prompt, safeSettings);
            case 'stability':
                return await generateStabilityImage(prompt, safeSettings);
            case 'aihorde':
                return await generateAIHordeImage(prompt, safeSettings);
            case 'gemini':
            case 'default':
            default:
                return await generateGeminiImage(prompt, safeSettings);
        }
    } catch (error) {
        logger.error("Error in generateImageFromPrompt:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        throw new Error(`Image generation failed. Details: ${errorMessage}`);
    }
};

export const generateContent = async (prompt: string, apiKey?: string): Promise<string> => {
  try {
    const ai = getAiClient(apiKey);
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
    }));
    return response.text || "";
  } catch (error) {
    logger.error("Error in generateContent:", error);
    throw error;
  }
};

export const streamGenericResponse = async (
    systemInstruction: string,
    prompt: string,
    onChunk: (chunk: string) => void,
    apiKey?: string
): Promise<void> => {
    try {
        const ai = getAiClient(apiKey);
        const responseStream = await withRetry(() => ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { systemInstruction: systemInstruction }
        })) as AsyncIterable<GenerateContentResponse>;

        for await (const chunk of responseStream) {
            if (chunk.text) {
                onChunk(chunk.text);
            }
        }
    } catch (error) {
        logger.error("Error generating generic content stream:", error);
        onChunk("Sorry, an error occurred while responding.");
    }
};
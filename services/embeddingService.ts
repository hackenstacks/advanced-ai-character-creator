import { GoogleGenAI } from "@google/genai";
import { EmbeddingConfig } from "../types.ts";
import { logger } from "./loggingService.ts";

// --- Gemini Client Setup ---
// FIX: Initialize Gemini client strictly using process.env.API_KEY directly.
const defaultAi = new GoogleGenAI({ apiKey: process.env.API_KEY });

const getAiClient = (apiKey?: string): GoogleGenAI => {
    if (apiKey) {
        return new GoogleGenAI({ apiKey });
    }
    return defaultAi;
}

const withRetry = async <T>(
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
            let errorMessage = error?.message || "An unknown error occurred";

            if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
                isRateLimitError = true;
            }

            if (isRateLimitError) {
                 if (attempt + 1 >= maxRetries) {
                    throw error;
                }
                const delay = initialDelay * Math.pow(2, attempt) + Math.random() * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                attempt++;
                continue;
            }
            throw error;
        }
    }
    throw new Error('API request failed.');
};

const generateGeminiEmbedding = async (text: string, config: EmbeddingConfig): Promise<number[]> => {
    const ai = getAiClient(config.apiKey);
    const result = await withRetry(() => ai.models.embedContent({
        model: "text-embedding-004",
        contents: { parts: [{ text: text }] }
    })) as any;

    if (result.embedding && result.embedding.values) {
        return result.embedding.values;
    }
    
    if (result.embeddings && Array.isArray(result.embeddings) && result.embeddings.length > 0) {
        if (result.embeddings[0].values) {
            return result.embeddings[0].values;
        }
    }
    throw new Error("Gemini API response missing embedding values.");
};

const generateOpenAIEmbedding = async (text: string, config: EmbeddingConfig): Promise<number[]> => {
    if (!config.apiEndpoint) throw new Error("OpenAI-compatible embedding endpoint is not configured.");

    const response = await fetch(config.apiEndpoint.trim(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey?.trim() || 'ollama'}`,
        },
        body: JSON.stringify({
            model: config.model?.trim() || 'nomic-embed-text',
            input: text,
        }),
    });

    if (!response.ok) {
        throw new Error(`Embedding API request failed.`);
    }
    
    const json = await response.json();
    const embedding = json.embedding || json.data?.[0]?.embedding;

    if (!embedding) {
        throw new Error("API response did not contain embedding data.");
    }
    return embedding;
};

export const generateEmbedding = async (text: string, config: EmbeddingConfig): Promise<number[]> => {
    try {
        if (config.service === 'openai') {
            return await withRetry(() => generateOpenAIEmbedding(text, config));
        } else {
            return await generateGeminiEmbedding(text, config);
        }
    } catch (error) {
        logger.error("Failed to generate embedding:", error);
        throw error;
    }
};
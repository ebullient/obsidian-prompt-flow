import { describe, it, expect, beforeAll } from "vitest";
import { OllamaClient } from "../src/pflow-OllamaClient";
import { Logger } from "../src/@types";

// Integration test for OllamaClient
// Set OLLAMA_URL in .env or it defaults to http://localhost:11434
// Make sure Ollama is running and has at least one model

const logger: Logger = {
    logInfo: function (message: string, ...params: unknown[]): void {
        console.log(message, ...params);
    },
    logWarn: function (message: string, ...params: unknown[]): void {
        console.log(message, ...params);
    },
    logError: function (error: unknown, message: string, ...params: unknown[]) {
        console.log(error, message, ...params);
        return "error";
    },
    logDebug: function (message: string, ...params: unknown[]): void {
        console.log(message, ...params);
    }
}

describe("OllamaClient Integration Test", () => {
    let client: OllamaClient;
    let availableModels: string[];

    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

    beforeAll(async () => {
        client = new OllamaClient(ollamaUrl, logger);

        // Check if Ollama is available
        const isConnected = await client.checkConnection();
        if (!isConnected) {
            throw new Error(`Ollama is not running at ${ollamaUrl}. Start with: ollama serve`);
        }

        // Get available models
        const allModels = await client.listModels();
        if (allModels.length === 0) {
            throw new Error('No models found. Pull a model first: ollama pull llama3.2');
        }

        // Filter out embedding models (they can't generate text)
        const embeddingModels = ['mxbai-embed-large', 'nomic-embed-text', 'all-minilm'];
        availableModels = allModels.filter(model =>
            !embeddingModels.some(embed => model.includes(embed))
        );

        if (availableModels.length === 0) {
            throw new Error(`No generation models found. Available models: ${allModels.join(', ')}\nPull a generation model: ollama pull llama3.2`);
        }

        console.log(`🔗 Testing with Ollama at: ${ollamaUrl}`);
        console.log(`📦 All models: ${allModels.join(', ')}`);
        console.log(`🤖 Generation models: ${availableModels.join(', ')}`);
    });

    it("should connect to Ollama", async () => {
        const isConnected = await client.checkConnection();
        expect(isConnected).toBe(true);
    });

    it("should list available models", async () => {
        const models = await client.listModels();
        expect(models).toBeInstanceOf(Array);
        expect(models.length).toBeGreaterThan(0);
        // availableModels is filtered, so just check it's a subset
        expect(models.length).toBeGreaterThanOrEqual(availableModels.length);
    });

    it("should generate a reflection question", async () => {
        const model = availableModels[0];
        const systemPrompt = "You are a thoughtful journal reflection coach. Ask insightful, open-ended questions.";
        const journalText = "Today I went for a walk in the park and saw beautiful autumn leaves. It made me feel peaceful and grateful.";

        const response = await client.generate(model, systemPrompt, journalText);
        expect(response).toBeTruthy();

        const reflection = response.response;
        expect(typeof reflection).toBe('string');
        expect(reflection!.length).toBeGreaterThan(0);

        console.log(`💭 Generated reflection: "${reflection}"`);
    });

    it("should generate an affirmation", async () => {
        const model = availableModels[0];
        const systemPrompt = "You are a supportive coach. Provide encouraging, personalized affirmations.";
        const journalText = "Today I struggled with confidence during my presentation at work, but I pushed through and finished it.";

        const response = await client.generate(model, systemPrompt, journalText);
        expect(response).toBeTruthy();

        const affirmation = response.response;
        expect(typeof affirmation).toBe('string');
        expect(affirmation!.length).toBeGreaterThan(0);

        console.log(`🌟 Generated affirmation: "${affirmation}"`);
    });

    it("should handle empty journal text gracefully", async () => {
        const model = availableModels[0];
        const systemPrompt = "You are helpful.";
        const journalText = "";

        const response = await client.generate(model, systemPrompt, journalText);
        expect(response).toBeTruthy();

        // Should return empty string for empty input
        const reflection = response.response;
        expect(typeof reflection).toBe('string');
        expect(reflection).toBe("");
    });
});

import type { PromptFlowSettings } from "./@types";

export const DEFAULT_PROMPT = `You are a helpful assistant. You will be given the content of a note as markdown.
Your job is to respond based on the content provided.
Keep your response concise and relevant.`;

export const DEFAULT_SETTINGS: PromptFlowSettings = {
    ollamaUrl: "http://localhost:11434",
    modelName: "llama3.1",
    excludePatterns: "",
    keepAlive: "10m",
    debugLogging: false,
    showLlmRequests: false,
    prompts: {
        default: {
            displayLabel: "prompt",
            promptFile: "",
        },
    },
};

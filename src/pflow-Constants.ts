import type { PromptFlowSettings } from "./@types";

export const DEFAULT_PROMPT = `You are a helpful assistant. You will be given the content of a note as markdown.
Your job is to respond based on the content provided.
Keep your response concise and relevant.`;

export const DEFAULT_SETTINGS: PromptFlowSettings = {
    defaultConnection: "local-ollama",
    excludePatterns: "",
    debugLogging: false,
    showLlmRequests: false,
    connections: {
        "local-ollama": {
            provider: "ollama",
            baseUrl: "http://localhost:11434",
            defaultModel: "llama3.1",
            keepAlive: "10m",
        },
    },
    prompts: {
        default: {
            displayLabel: "prompt",
            promptFile: "",
        },
    },
};

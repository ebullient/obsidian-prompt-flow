import type { ConnectionConfig, IOllamaClient, Logger } from "./@types";
import { OllamaClient } from "./pflow-OllamaClient";
import { OpenAICompatibleClient } from "./pflow-OpenAICompatibleClient";

export function createLLMClient(
    connection: ConnectionConfig,
    logger: Logger,
    saveSettings?: () => Promise<void>,
): IOllamaClient {
    switch (connection.provider) {
        case "ollama":
            return new OllamaClient(connection.baseUrl, logger);

        case "openai-compatible": {
            const apiKey = connection.apiKey || "";

            if (!connection.baseUrl) {
                throw new Error("Connection URL is required");
            }
            if (!apiKey) {
                throw new Error(
                    "API key is required for OpenAI-compatible provider",
                );
            }

            return new OpenAICompatibleClient(
                connection.baseUrl,
                apiKey,
                logger,
                connection,
                saveSettings || (async () => {}),
            );
        }

        default:
            throw new Error("Unknown provider:", connection.provider);
    }
}

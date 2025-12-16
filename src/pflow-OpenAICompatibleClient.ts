import type { RequestUrlParam } from "obsidian";
import type {
    ConnectionConfig,
    GenerateOptions,
    GenerateResult,
    Logger,
} from "./@types";
import { LLMBaseClient } from "./pflow-LLMBaseClient";

interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

interface ChatCompletionRequest {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    stream: boolean;
}

interface ChatCompletionChunk {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        delta: {
            role?: string;
            content?: string;
        };
        finish_reason: string | null;
    }>;
}

export class OpenAICompatibleClient extends LLMBaseClient {
    private apiKey: string;
    private connectionConfig: ConnectionConfig;
    private saveSettings: () => Promise<void>;

    constructor(
        baseUrl: string,
        apiKey: string,
        logger: Logger,
        connectionConfig: ConnectionConfig,
        saveSettings: () => Promise<void>,
    ) {
        super(baseUrl, logger);
        this.apiKey = apiKey;
        this.connectionConfig = connectionConfig;
        this.saveSettings = saveSettings;
    }

    async generate(
        model: string,
        systemPrompt: string,
        documentText: string,
        options?: GenerateOptions,
    ): Promise<GenerateResult> {
        return this.handleGenerateRequest(async () => {
            const messages: ChatMessage[] = [];

            if (systemPrompt.trim()) {
                messages.push({
                    role: "system",
                    content: systemPrompt,
                });
            }

            // Restore conversation history from context if available
            if (options?.context && options.context.length > 0) {
                const historyMessages = this.decodeContext<ChatMessage[]>(
                    options.context,
                );
                if (historyMessages) {
                    messages.push(...historyMessages);
                }
            }

            messages.push({
                role: "user",
                content: documentText,
            });

            const requestBody: ChatCompletionRequest = {
                model: model,
                messages: messages,
                stream: true,
            };

            if (options?.temperature !== undefined) {
                requestBody.temperature = options.temperature;
            }
            if (options?.topP !== undefined) {
                requestBody.top_p = options.topP;
            }
            if (options?.numCtx !== undefined) {
                requestBody.max_tokens = options.numCtx;
            }

            const apiPrefix = this.connectionConfig.apiPrefix ?? "";
            const requestOptions: RequestUrlParam = {
                url: `${this.baseUrl}${apiPrefix}/v1/chat/completions`,
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
            };

            this.logger.logDebug("Send request to", this.baseUrl);
            const response = await this.executeRequest(requestOptions, false);

            if (response.status !== 200) {
                throw new Error(
                    `API request failed with status ${response.status}`,
                );
            }

            // Parse SSE response with chunk handler
            const result = await this.parseSSEStream(
                response.arrayBuffer,
                (data: string) => {
                    const chunk = JSON.parse(data) as ChatCompletionChunk;
                    return chunk.choices[0]?.delta?.content || "";
                },
            );

            // Build conversation history for continuous mode
            const conversationHistory: ChatMessage[] = [];

            // Add previous history (excluding system message)
            if (options?.context && options.context.length > 0) {
                const historyMessages = this.decodeContext<ChatMessage[]>(
                    options.context,
                );
                if (historyMessages) {
                    conversationHistory.push(...historyMessages);
                }
            }

            // Add current exchange
            conversationHistory.push({
                role: "user",
                content: documentText,
            });

            if (result.trim()) {
                conversationHistory.push({
                    role: "assistant",
                    content: result.trim(),
                });
            }

            return {
                response: result.trim() || null,
                context: this.encodeContext(conversationHistory),
            };
        }, "OpenAI-compatible");
    }

    private async saveApiPrefix(prefix: string): Promise<void> {
        if (this.connectionConfig.apiPrefix !== prefix) {
            this.connectionConfig.apiPrefix = prefix;
            await this.saveSettings();
        }
    }

    private async executeModelsRequest<T>(
        handler: (url: string) => Promise<T>,
    ): Promise<T> {
        // If we have a saved prefix, try it first
        if (this.connectionConfig.apiPrefix !== undefined) {
            try {
                const result = await handler(
                    `${this.baseUrl}${this.connectionConfig.apiPrefix}/v1/models`,
                );
                this.logger.logDebug(
                    "Request successful using saved prefix:",
                    this.connectionConfig.apiPrefix || "(empty)",
                );
                return result;
            } catch (error) {
                this.logger.logDebug(
                    "Saved prefix failed, trying auto-detection",
                    error,
                );
            }
        }

        // Try standard OpenAI (no prefix)
        try {
            const result = await handler(`${this.baseUrl}/v1/models`);
            this.logger.logDebug("Request successful with no prefix");
            await this.saveApiPrefix("");
            return result;
        } catch (firstError) {
            this.logger.logDebug(
                "Failed with no prefix, trying /api",
                firstError,
            );

            // Try OpenWebUI native prefix as fallback
            const result = await handler(`${this.baseUrl}/api/v1/models`);
            this.logger.logDebug("Request successful with /api prefix");
            await this.saveApiPrefix("/api");
            return result;
        }
    }

    async checkConnection(): Promise<boolean> {
        try {
            this.logger.logDebug(
                "Checking OpenAI-compatible connection to",
                this.baseUrl,
            );

            await this.executeModelsRequest(async (url) => {
                await this.executeRequest({
                    url,
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                    },
                });
            });

            return true;
        } catch (error) {
            this.logger.logError(
                error,
                "OpenAI-compatible connection check failed for",
                this.baseUrl,
            );
            return false;
        }
    }

    async listModels(): Promise<string[]> {
        try {
            return await this.executeModelsRequest(async (url) => {
                const response = await this.executeRequest({
                    url,
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                    },
                });

                const data = response.json as { data: Array<{ id: string }> };
                return data.data?.map((model) => model.id) || [];
            });
        } catch (error) {
            this.logger.logError(error, "Error fetching models");
            return [];
        }
    }

    // Factory method for testing
    static createForTesting(
        baseUrl: string,
        apiKey: string,
        logger: Logger,
        connectionConfig: ConnectionConfig,
        saveSettings: () => Promise<void>,
    ): OpenAICompatibleClient {
        return new OpenAICompatibleClient(
            baseUrl,
            apiKey,
            logger,
            connectionConfig,
            saveSettings,
        );
    }
}

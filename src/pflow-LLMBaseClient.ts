import {
    createParser,
    type EventSourceMessage,
    type EventSourceParser,
} from "eventsource-parser";
import { Notice, type RequestUrlParam, requestUrl } from "obsidian";
import type { GenerateResult, IOllamaClient, Logger } from "./@types";

/**
 * Base class for LLM clients providing common HTTP and streaming utilities
 */
export abstract class LLMBaseClient implements IOllamaClient {
    protected baseUrl: string;
    protected logger: Logger;

    constructor(baseUrl: string, logger: Logger) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
        this.logger = logger;
    }

    /**
     * Execute HTTP request with common error handling
     * @param options - Request options
     * @param parseJson - Whether to parse response as JSON (default: true).
     *                    Set to false for streaming responses.
     */
    protected async executeRequest(
        options: RequestUrlParam,
        parseJson = true,
    ): Promise<{
        status: number;
        json?: unknown;
        arrayBuffer: ArrayBuffer;
    }> {
        const response = await requestUrl(options);
        return {
            status: response.status,
            json: parseJson ? response.json : undefined,
            arrayBuffer: response.arrayBuffer,
        };
    }

    /**
     * Parse Server-Sent Events (SSE) stream from ArrayBuffer
     * @param arrayBuffer - The response body as ArrayBuffer
     * @param onChunk - Callback to extract content from each SSE data chunk
     * @returns The full accumulated response string
     */
    protected async parseSSEStream(
        arrayBuffer: ArrayBuffer,
        onChunk: (data: string) => string,
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            let fullResponse = "";

            const parser: EventSourceParser = createParser({
                onEvent: (event: EventSourceMessage) => {
                    const data = event.data;

                    // Check for stream completion
                    if (data === "[DONE]") {
                        resolve(fullResponse);
                        return;
                    }

                    try {
                        const content = onChunk(data);
                        if (content) {
                            fullResponse += content;
                        }
                    } catch (parseError) {
                        this.logger.logDebug(
                            "Failed to parse SSE chunk:",
                            data,
                            parseError,
                        );
                    }
                },
            });

            try {
                const decoder = new TextDecoder();
                const text = decoder.decode(arrayBuffer);
                parser.feed(text);

                // If no [DONE] was sent, resolve with what we have
                resolve(fullResponse);
            } catch (error) {
                const err =
                    error instanceof Error ? error : new Error(String(error));
                reject(err);
            }
        });
    }

    /**
     * Wrap API calls with standardized error handling
     */
    protected async handleGenerateRequest(
        apiCall: () => Promise<GenerateResult>,
        providerName: string,
    ): Promise<GenerateResult> {
        try {
            return await apiCall();
        } catch (error) {
            const errorMsg = this.logger.logError(
                error,
                `Error calling ${providerName} API: `,
            );
            new Notice(`${providerName} API error: ${errorMsg}`);
            return { response: null };
        }
    }

    /**
     * Encode conversation history as number array for storage
     */
    protected encodeContext(context: unknown): number[] {
        const contextJson = JSON.stringify(context);
        return Array.from(contextJson).map((char) => char.charCodeAt(0));
    }

    /**
     * Decode conversation history from number array
     */
    protected decodeContext<T>(context: number[]): T | null {
        try {
            return JSON.parse(String.fromCharCode(...context)) as T;
        } catch (error) {
            this.logger.logDebug("Failed to parse context:", error);
            return null;
        }
    }

    // Abstract methods that must be implemented by subclasses
    abstract generate(
        model: string,
        systemPrompt: string,
        documentText: string,
        options?: unknown,
    ): Promise<GenerateResult>;

    abstract checkConnection(): Promise<boolean>;

    abstract listModels(): Promise<string[]>;
}

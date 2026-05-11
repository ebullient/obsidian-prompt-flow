import type {
    GenerateRequest,
    GenerateResponse,
    ListResponse,
} from "ollama/browser";
import type { GenerateOptions, GenerateResult, Logger } from "./@types";
import { LLMBaseClient } from "./pflow-LLMBaseClient";

export class OllamaClient extends LLMBaseClient {
    async generate(
        model: string,
        systemPrompt: string,
        documentText: string,
        options?: GenerateOptions,
    ): Promise<GenerateResult> {
        return this.handleGenerateRequest(async () => {
            const generateRequest: GenerateRequest = {
                model: model,
                prompt: documentText,
                system: systemPrompt,
                stream: false,
                keep_alive: options?.keepAlive,
            };

            const requestOptions: NonNullable<GenerateRequest["options"]> = {};

            if (options?.numCtx !== undefined) {
                requestOptions.num_ctx = options.numCtx;
            }
            if (options?.temperature !== undefined) {
                requestOptions.temperature = options.temperature;
            }
            if (options?.topP !== undefined) {
                requestOptions.top_p = options.topP;
            }
            if (options?.topK !== undefined) {
                requestOptions.top_k = options.topK;
            }
            if (options?.repeatPenalty !== undefined) {
                requestOptions.repeat_penalty = options.repeatPenalty;
            }
            if (Object.keys(requestOptions).length > 0) {
                generateRequest.options = requestOptions;
            }

            if (options?.context && options.context.length > 0) {
                generateRequest.context = options.context;
            }

            this.logger.logDebug("Send request to", this.baseUrl);
            const response = await this.executeRequest<GenerateResponse>({
                url: `${this.baseUrl}/api/generate`,
                method: "POST",
                contentType: "application/json",
                body: JSON.stringify(generateRequest),
            });

            return {
                response: response.json.response?.trim() ?? null,
                context: response.json.context,
            };
        }, "Ollama");
    }

    async checkConnection(): Promise<boolean> {
        try {
            this.logger.logDebug("Checking connection to", this.baseUrl);
            const response = await this.executeRequest({
                url: `${this.baseUrl}/api/tags`,
                method: "GET",
            });
            this.logger.logDebug(
                "Connection check successful, status:",
                response.status,
            );
            return true;
        } catch (error) {
            this.logger.logError(
                error,
                "Connection check failed for",
                this.baseUrl,
            );
            return false;
        }
    }

    async listModels(): Promise<string[]> {
        try {
            const response = await this.executeRequest<ListResponse>({
                url: `${this.baseUrl}/api/tags`,
                method: "GET",
            });

            return response.json.models?.map((model) => model.name) ?? [];
        } catch (error) {
            this.logger.logError(error, "Error fetching models");
            return [];
        }
    }

    // Factory method for testing
    static createForTesting(baseUrl: string, logger: Logger): OllamaClient {
        return new OllamaClient(baseUrl, logger);
    }
}

import type { TFile } from "obsidian";

export interface PromptConfig {
    displayLabel: string;
    promptFile?: string;
}

export interface ResolvedPrompt {
    prompt: string;
    model?: string;
    numCtx?: number;
    isContinuous?: boolean;
    includeLinks?: boolean;
    excludePatterns?: RegExp[];
    excludeCalloutTypes?: string[];
    sourcePath?: string;
    temperature?: number;
    topP?: number;
    topK?: number;
    repeatPenalty?: number;
    filters?: string[];
    wrapInBlockquote?: boolean;
    calloutHeading?: string;
    replaceSelectedText?: boolean;
}

export interface PromptFlowSettings {
    showLlmRequests: boolean;
    debugLogging: boolean;
    ollamaUrl: string;
    modelName: string;
    prompts: Record<string, PromptConfig>;
    excludePatterns: string;
    excludeLinkPatterns?: string;
    keepAlive: string;
}

export interface IOllamaClient {
    generate(
        model: string,
        systemPrompt: string,
        documentText: string,
        options?: GenerateOptions,
    ): Promise<GenerateResult | string>;
    checkConnection(): Promise<boolean>;
    listModels(): Promise<string[]>;
}

export interface GenerateOptions {
    numCtx?: number;
    context?: number[];
    temperature?: number;
    topP?: number;
    topK?: number;
    repeatPenalty?: number;
    keepAlive?: string;
}

export interface GenerateResult {
    response: string | null;
    context?: number[];
}

export interface Logger {
    logInfo(message: string, ...params: unknown[]): void;
    logWarn(message: string, ...params: unknown[]): void;
    logError(error: unknown, message: string, ...params: unknown[]): string;
    logDebug(message: string, ...params: unknown[]): void;
}

export interface FileToProcess {
    file: TFile;
    linkText: string;
    fileContent: string;
    subpath?: string;
}

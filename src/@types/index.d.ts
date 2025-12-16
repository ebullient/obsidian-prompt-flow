import type { TFile } from "obsidian";

export interface PromptConfig {
    displayLabel: string;
    promptFile?: string;
    connection?: string;
}

export interface ResolvedPrompt {
    prompt: string;
    connection?: string;
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

export type LLMProvider = "ollama" | "openai-compatible";

export interface ConnectionConfig {
    provider: LLMProvider;
    baseUrl: string;
    apiKey?: string;
    defaultModel?: string;
    keepAlive?: string;
    apiPrefix?: string; // Auto-detected API prefix (empty or /api)
}

export interface PromptFlowSettings {
    showLlmRequests: boolean;
    debugLogging: boolean;
    defaultConnection: string;
    connections: Record<string, ConnectionConfig>;
    prompts: Record<string, PromptConfig>;
    excludePatterns: string;
}

export interface IOllamaClient {
    generate(
        model: string,
        systemPrompt: string,
        documentText: string,
        options?: GenerateOptions,
    ): Promise<GenerateResult>;
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
    logLlmRequest(arg0: {
        model: string;
        promptKey: string;
        file: string;
        systemPrompt: string;
        documentText: string;
        options: {
            numCtx: number | undefined;
            context: number[] | undefined;
            temperature: number | undefined;
            topP: number | undefined;
            topK: number | undefined;
            repeatPenalty: number | undefined;
            keepAlive: string | undefined;
        };
    }): unknown;
    logInfo(message: string, ...params: unknown[]): void;
    logWarn(message: string, ...params: unknown[]): void;
    logError(error: unknown, message?: string, ...params: unknown[]): string;
    logDebug(message: string, ...params: unknown[]): void;
}

export interface FileToProcess {
    file: TFile;
    linkText: string;
    fileContent: string;
    subpath?: string;
}

export type EmbeddedLink = {
    subpaths: Set<string>; // headings, blockrefs
    hasFullReference: boolean;
    file: TFile | null; // null for unresolved links
    depth: number;
};

export type EmbeddedNotes = Map<string, EmbeddedLink>;

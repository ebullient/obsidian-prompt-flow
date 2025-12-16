import {
    debounce,
    type Editor,
    type MarkdownFileInfo,
    type MarkdownView,
    Plugin,
    type TFile,
} from "obsidian";
import type {
    ConnectionConfig,
    IOllamaClient,
    Logger,
    PromptFlowSettings,
    ResolvedPrompt,
} from "./@types";
import { DEFAULT_SETTINGS } from "./pflow-Constants";
import { createLLMClient } from "./pflow-LLMClientFactory";
import { PromptFlowSettingsTab } from "./pflow-SettingsTab";
import { compileExcludePatterns } from "./pflow-Utils";
import "./window-type";
import { ContentGenerator } from "./pflow-ContentGenerator";

const CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CONTEXT_REAP_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours

export class PromptFlowPlugin extends Plugin implements Logger {
    settings!: PromptFlowSettings;
    generator: ContentGenerator;

    private commandIds: string[] = [];
    private excludePatterns: RegExp[] = [];
    private promptContexts = new Map<
        string,
        { context: number[]; timestamp: number }
    >();

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new PromptFlowSettingsTab(this.app, this));
        this.generator = new ContentGenerator(this.app, this.settings, this);

        // Initialize window.journal.filters for external scripts
        window.promptFlow = window.promptFlow ?? {};
        window.promptFlow.filters = window.promptFlow.filters ?? {};

        // Defer initialization until layout is ready
        this.app.workspace.onLayoutReady(() => {
            this.generateCommands();
            this.registerContextReaper();
        });
        this.logInfo("Loaded Prompt Flow (PF)", `v${this.manifest.version}`);
    }

    onunload() {
        this.logInfo("Unloaded Prompt Flow (PF)");
    }

    onExternalSettingsChange = debounce(
        async () => {
            const incoming = (await this.loadData()) as PromptFlowSettings;
            this.logDebug("Settings changed", incoming);
            this.settings = Object.assign({}, this.settings, incoming);
            await this.saveSettings();
        },
        2000,
        true,
    );

    getConnectionConfig(resolvedPrompt: ResolvedPrompt): {
        connectionKey: string;
        connection: ConnectionConfig;
    } {
        const connectionKey =
            resolvedPrompt.connection || this.settings.defaultConnection;
        return {
            connectionKey,
            connection: this.settings.connections[connectionKey],
        };
    }

    getClientForPrompt(resolvedPrompt: ResolvedPrompt): IOllamaClient {
        const connectionKey =
            resolvedPrompt.connection || this.settings.defaultConnection;
        const connection = this.settings.connections[connectionKey];

        if (!connection) {
            throw new Error(
                `Connection '${connectionKey}' not found in settings`,
            );
        }

        return createLLMClient(connection, this, () => this.saveSettings());
    }

    private clearCommands() {
        for (const commandId of this.commandIds) {
            this.removeCommand(commandId);
        }
        this.commandIds = [];
    }

    private generateCommands() {
        this.clearCommands();

        for (const [promptKey, promptConfig] of Object.entries(
            this.settings.prompts,
        )) {
            const commandId = `pflow-${promptKey}`;

            this.addCommand({
                id: commandId,
                name: `Generate ${promptConfig.displayLabel}`,
                editorCallback: async (
                    editor: Editor,
                    ctx: MarkdownView | MarkdownFileInfo,
                ) => {
                    await this.generator.generateContentWithEditor(
                        editor,
                        ctx,
                        promptKey,
                    );
                },
                callback: async () => {
                    await this.generator.generateContent(promptKey);
                },
            });

            this.commandIds.push(commandId);
        }
    }

    async loadSettings() {
        const loaded = (await this.loadData()) as PromptFlowSettings & {
            ollamaUrl?: string;
            modelName?: string;
            keepAlive?: string;
            systemPrompt?: string;
            affirmationPromptFile?: string;
            reflectionPromptFile?: string;
            excludeLinkPatterns?: string;
        };

        let migrated = false;
        // Migrate old settings format to new connections format
        if (
            loaded?.ollamaUrl ||
            loaded?.modelName ||
            loaded?.keepAlive ||
            loaded?.systemPrompt ||
            loaded?.affirmationPromptFile ||
            loaded?.reflectionPromptFile ||
            loaded?.excludeLinkPatterns
        ) {
            migrated = true;
            this.logInfo(
                "Migrating old settings format to new connections format",
            );

            if (loaded?.ollamaUrl && !loaded.connections) {
                loaded.connections = {
                    "local-ollama": {
                        provider: "ollama",
                        baseUrl: loaded.ollamaUrl,
                        defaultModel: loaded.modelName || "llama3.1",
                        keepAlive: loaded.keepAlive || "10m",
                    },
                };
                loaded.defaultConnection = "local-ollama";
            }

            if (loaded.excludeLinkPatterns) {
                loaded.excludePatterns =
                    loaded.excludePatterns || loaded.excludeLinkPatterns;
            }

            // Clean up old fields
            delete loaded.ollamaUrl;
            delete loaded.modelName;
            delete loaded.keepAlive;
            delete loaded.systemPrompt;
            delete loaded.affirmationPromptFile;
            delete loaded.reflectionPromptFile;
            delete loaded.excludeLinkPatterns;
        }

        this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

        if (migrated) {
            await this.saveSettings();
        } else {
            this.excludePatterns = compileExcludePatterns(
                this.settings.excludePatterns,
            );
        }
    }

    async saveSettings() {
        this.logDebug("Saving settings", this.settings);
        await this.saveData(this.settings);
        this.excludePatterns = compileExcludePatterns(
            this.settings.excludePatterns,
        );
        this.generateCommands();
    }

    shouldExcludeLink(
        linkCache: {
            link: string;
            displayText?: string;
        },
        additionalPatterns: RegExp[] = [],
    ): boolean {
        // Check global exclude patterns (match against display text format)
        const textToCheck = `[${linkCache.displayText}](${linkCache.link})`;
        const allPatterns = [
            ...this.excludePatterns,
            ...additionalPatterns,
        ].filter(Boolean);

        return allPatterns.some((pattern) => pattern.test(textToCheck));
    }

    buildContextKey(
        file: TFile,
        resolvedPrompt: ResolvedPrompt,
        promptKey: string,
    ): string | null {
        if (resolvedPrompt.isContinuous !== true) {
            return null;
        }
        const promptSource = resolvedPrompt.sourcePath || promptKey;
        return `${file.path}::${promptSource}`;
    }

    getContextForKey(key: string | null): number[] | undefined {
        if (!key) {
            return undefined;
        }
        const entry = this.promptContexts.get(key);
        if (!entry) {
            return undefined;
        }
        if (Date.now() - entry.timestamp > CONTEXT_TTL_MS) {
            this.promptContexts.delete(key);
            return undefined;
        }
        return entry.context;
    }

    storeContextForKey(key: string, context: number[]): void {
        if (context.length === 0) {
            this.promptContexts.delete(key);
            return;
        }
        this.promptContexts.set(key, { context, timestamp: Date.now() });
        this.cullExpiredContexts();
    }

    private cullExpiredContexts(): void {
        if (this.promptContexts.size === 0) {
            return;
        }
        const now = Date.now();
        for (const [key, value] of this.promptContexts.entries()) {
            if (now - value.timestamp > CONTEXT_TTL_MS) {
                this.promptContexts.delete(key);
            }
        }
    }

    private registerContextReaper(): void {
        this.registerInterval(
            window.setInterval(
                () => this.cullExpiredContexts(),
                CONTEXT_REAP_INTERVAL_MS,
            ),
        );
    }

    logInfo(message: string, ...params: unknown[]): void {
        console.debug("(PF)", message, ...params);
    }

    logWarn(message: string, ...params: unknown[]): void {
        console.warn("(PF)", message, ...params);
    }

    logError(
        error: unknown,
        message: string = "",
        ...params: unknown[]
    ): string {
        if (message) {
            console.error("(PF)", message, error, ...params);
            return message;
        } else if (error instanceof Error) {
            console.error("(PF)", error.message, error, ...params);
            return error.message;
        }
        console.error("(PF)", error, ...params);
        return String(error);
    }

    logDebug(message: string, ...params: unknown[]): void {
        if (this.settings?.debugLogging) {
            console.debug("(PF)", message, ...params);
        }
    }

    logLlmRequest(payload: unknown): void {
        if (this.settings?.showLlmRequests) {
            console.debug("(PF)[LLM Request]", payload);
        }
    }
}

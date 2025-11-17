import {
    debounce,
    type Editor,
    type MarkdownFileInfo,
    MarkdownView,
    Notice,
    Plugin,
    TFile,
} from "obsidian";
import type {
    FileToProcess,
    Logger,
    PromptFlowSettings,
    ResolvedPrompt,
} from "./@types";
import { DEFAULT_PROMPT, DEFAULT_SETTINGS } from "./pflow-Constants";
import { OllamaClient } from "./pflow-OllamaClient";
import { PromptFlowSettingsTab } from "./pflow-SettingsTab";
import {
    compileExcludePatterns,
    extractFrontmatterValue,
    filterCallouts,
    formatAsBlockquote,
    normalizeToArray,
    type optionalStrings,
    parseBoolean,
    parseLinkReference,
    parseParameterWithConstraint,
    parsePositiveInteger,
} from "./pflow-Utils";
import "./window-type";

const CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CONTEXT_REAP_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours

export class PromptFlowPlugin extends Plugin implements Logger {
    settings!: PromptFlowSettings;
    ollamaClient!: OllamaClient;
    private commandIds: string[] = [];
    private excludePatterns: RegExp[] = [];
    private promptContexts = new Map<
        string,
        { context: number[]; timestamp: number }
    >();

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new PromptFlowSettingsTab(this.app, this));

        // Initialize window.journal.filters for external scripts
        window.promptFlow = window.promptFlow ?? {};
        window.promptFlow.filters = window.promptFlow.filters ?? {};

        // Defer initialization until layout is ready
        this.app.workspace.onLayoutReady(() => {
            this.updateOllamaClient();
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

    private updateOllamaClient(): void {
        this.ollamaClient = new OllamaClient(this.settings.ollamaUrl, this);
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
                    await this.generateContentWithEditor(
                        editor,
                        ctx,
                        promptKey,
                    );
                },
                callback: async () => {
                    await this.generateContent(promptKey);
                },
            });

            this.commandIds.push(commandId);
        }
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            (await this.loadData()) as PromptFlowSettings,
        );
        if (this.ollamaClient) {
            this.updateOllamaClient();
        }
        this.excludePatterns = compileExcludePatterns(
            this.settings.excludePatterns || this.settings.excludeLinkPatterns,
        );
    }

    async saveSettings() {
        if (this.settings.excludeLinkPatterns) {
            this.settings.excludePatterns = this.settings.excludeLinkPatterns;
            delete this.settings.excludeLinkPatterns;
        }
        await this.saveData(this.settings);
        this.updateOllamaClient();
        this.excludePatterns = compileExcludePatterns(
            this.settings.excludePatterns,
        );
        this.generateCommands();
    }

    async generateContent(promptKey: string) {
        const currentView =
            this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!currentView) {
            new Notice("No active markdown editor found.");
            return;
        }

        await this.generateContentWithEditor(
            currentView.editor,
            currentView,
            promptKey,
        );
    }

    async generateContentWithEditor(
        editor: Editor,
        ctx: MarkdownView | MarkdownFileInfo,
        promptKey: string,
    ) {
        const docContent = editor.getValue();

        const activeNote = ctx.file;
        if (!activeNote) {
            new Notice("No file context available.");
            return;
        }

        const resolved = await this.resolvePromptFromFile(
            activeNote,
            promptKey,
        );

        this.logDebug("Resolved prompt parameters:", promptKey, resolved);

        const expandedDocContent = await this.expandLinkedFiles(
            activeNote,
            docContent,
            resolved.includeLinks ?? false,
            resolved.excludePatterns,
        );

        const filteredDocContent = filterCallouts(
            expandedDocContent,
            resolved.excludeCalloutTypes,
        );
        const processedContent = this.applyPrefilters(
            filteredDocContent,
            resolved.filters,
        );

        const content = await this.getGeneratedContent(
            processedContent,
            resolved,
            promptKey,
            activeNote,
        );

        if (content) {
            this.insertContent(editor, content, promptKey, resolved);
        }
    }

    private insertContent(
        editor: Editor,
        content: string,
        promptKey: string,
        resolved: ResolvedPrompt,
    ): void {
        const wrapInBlockquote = resolved.wrapInBlockquote ?? true;
        const calloutHeading = resolved.calloutHeading;
        const replaceSelectedText = resolved.replaceSelectedText ?? false;

        const formattedContent = wrapInBlockquote
            ? formatAsBlockquote(content, calloutHeading)
            : content;

        const displayLabel =
            this.settings.prompts[promptKey]?.displayLabel || promptKey;

        if (replaceSelectedText && editor.somethingSelected()) {
            editor.replaceSelection(formattedContent);
            new Notice(`Replaced selection with ${displayLabel}`);
            return;
        }

        const cursor = editor.getCursor();
        const currentLine = editor.getLine(cursor.line);
        const isEmptyLine = currentLine.trim() === "";

        const insertText = isEmptyLine
            ? `${formattedContent}\n\n`
            : `\n\n${formattedContent}\n\n`;

        editor.replaceSelection(insertText);
        new Notice(`Inserted ${displayLabel}`);
    }

    private shouldExcludeLink(
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

    private buildContextKey(
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

    private getContextForKey(key: string | null): number[] | undefined {
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

    private storeContextForKey(key: string, context: number[]): void {
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

    private async resolvePromptFromFile(
        file: TFile,
        promptKey: string,
    ): Promise<ResolvedPrompt> {
        const frontmatter =
            this.app.metadataCache.getFileCache(file)?.frontmatter;

        // Check for direct prompt in frontmatter
        const promptValue = extractFrontmatterValue(
            frontmatter,
            "prompt",
            promptKey,
        );
        if (promptValue) {
            return { prompt: promptValue };
        }

        // Check for prompt-file in frontmatter
        const promptFile = extractFrontmatterValue(
            frontmatter,
            "prompt-file",
            promptKey,
        );
        if (promptFile) {
            const resolved = await this.readPromptFromFile(promptFile);
            if (resolved) {
                return resolved;
            }
        }

        // Fallback to global settings or built-in defaults
        return this.getDefaultPrompt(promptKey);
    }

    private async getDefaultPrompt(promptKey: string): Promise<ResolvedPrompt> {
        const promptConfig = this.settings.prompts[promptKey];
        if (!promptConfig) {
            throw new Error(`Unknown prompt key: ${promptKey}`);
        }

        // First, try to use the file specified in prompt config
        if (promptConfig.promptFile) {
            const resolved = await this.readPromptFromFile(
                promptConfig.promptFile,
            );
            this.logDebug("Using file prompt", promptConfig.promptFile);
            if (resolved) {
                return resolved;
            }
        }

        // Final fallback for legacy prompts
        return { prompt: DEFAULT_PROMPT };
    }

    private async readPromptFromFile(
        promptFilePath: string,
    ): Promise<ResolvedPrompt | null> {
        const promptFile = this.app.vault.getAbstractFileByPath(promptFilePath);
        if (promptFile instanceof TFile) {
            try {
                const promptContent =
                    await this.app.vault.cachedRead(promptFile);
                const frontmatter =
                    this.app.metadataCache.getFileCache(
                        promptFile,
                    )?.frontmatter;
                const model =
                    typeof frontmatter?.model === "string"
                        ? frontmatter.model
                        : undefined;
                const numCtx = parsePositiveInteger(frontmatter?.num_ctx);
                const temperature = parseParameterWithConstraint(
                    frontmatter,
                    ["temperature", "temp"],
                    (val) => val >= 0,
                );
                const topP = parseParameterWithConstraint(
                    frontmatter,
                    ["top_p", "topP", "top-p"],
                    (val) => val > 0,
                );
                const topK = parsePositiveInteger(
                    frontmatter?.top_k ??
                        frontmatter?.topK ??
                        frontmatter?.["top-k"],
                );
                const repeatPenalty = parseParameterWithConstraint(
                    frontmatter,
                    ["repeat_penalty", "repeatPenalty", "repeat-penalty"],
                    (val) => val > 0,
                );
                const rawContinuous: unknown =
                    frontmatter?.isContinuous ??
                    frontmatter?.is_continuous ??
                    frontmatter?.["is-continuous"] ??
                    frontmatter?.continuous;
                const isContinuous = parseBoolean(rawContinuous);
                const includeLinks = parseBoolean(frontmatter?.includeLinks);
                const excludePatterns = compileExcludePatterns(
                    frontmatter?.excludePatterns as optionalStrings,
                );
                const excludeCalloutTypes = normalizeToArray(
                    frontmatter?.excludeCalloutTypes as optionalStrings,
                );
                const filters = normalizeToArray(
                    frontmatter?.filters as optionalStrings,
                );
                const wrapInBlockquote = parseBoolean(
                    frontmatter?.wrapInBlockquote,
                );
                const calloutHeading =
                    typeof frontmatter?.calloutHeading === "string"
                        ? frontmatter.calloutHeading
                        : undefined;
                const replaceSelectedText = parseBoolean(
                    frontmatter?.replaceSelectedText,
                );

                // Strip frontmatter from content
                const promptText = this.stripFrontmatter(promptContent);
                return {
                    prompt: promptText,
                    model,
                    numCtx,
                    isContinuous,
                    includeLinks,
                    excludePatterns,
                    excludeCalloutTypes,
                    sourcePath: promptFilePath,
                    temperature,
                    topP,
                    topK,
                    repeatPenalty,
                    filters,
                    wrapInBlockquote,
                    calloutHeading,
                    replaceSelectedText,
                };
            } catch (error) {
                new Notice(`Could not read prompt file: ${promptFilePath}`);
                this.logError(error, "Error reading prompt file");
            }
        } else {
            new Notice(`Prompt file not found: ${promptFilePath}`);
            this.logWarn("Prompt file not found", promptFilePath);
        }
        return null;
    }

    private stripFrontmatter(content: string): string {
        const frontmatterRegex = /^---\n[\s\S]*?\n---\n/;
        return content.replace(frontmatterRegex, "").trim();
    }

    private async expandLinkedFiles(
        sourceFile: TFile | null,
        content: string,
        includeLinks = false,
        pathPatterns: RegExp[] = [],
    ): Promise<string> {
        if (!sourceFile) {
            return content;
        }

        // Track seen files to prevent duplicates (using normalized TFile paths)
        const seenLinks = new Set<string>();
        seenLinks.add(sourceFile.path);

        // Queue of files to process
        const fileQueue: FileToProcess[] = [
            {
                file: sourceFile,
                linkText: sourceFile.path,
                fileContent: content,
            },
        ];

        let expandedContent = "";

        // Process queue breadth-first
        let fileToProcess = fileQueue.shift();
        while (fileToProcess) {
            const { file, linkText, fileContent, subpath } = fileToProcess;

            this.logDebug("Processing file", file.path, linkText);

            // Extract content (apply subpath if needed)
            const extractedContent = subpath
                ? this.extractSubpathContent(file, fileContent, subpath)
                : fileContent;

            // Append to output with sentinels
            expandedContent += `\n===== BEGIN ENTRY: ${linkText} =====\n${extractedContent}\n===== END ENTRY =====\n\n`;

            // Discover links from this file
            const fileCache = this.app.metadataCache.getFileCache(file);
            if (fileCache) {
                const allLinks = [
                    ...(includeLinks ? fileCache.links || [] : []),
                    ...(fileCache.embeds || []),
                ].filter((link) => link);

                for (const cachedLink of allLinks) {
                    if (!this.shouldExcludeLink(cachedLink, pathPatterns)) {
                        // Resolve and queue the target file
                        const { path, subpath: linkSubpath } =
                            parseLinkReference(cachedLink.link);
                        const targetFile =
                            this.app.metadataCache.getFirstLinkpathDest(
                                path,
                                file.path,
                            );

                        if (targetFile && !seenLinks.has(targetFile.path)) {
                            seenLinks.add(targetFile.path);

                            try {
                                const linkedContent =
                                    await this.app.vault.cachedRead(targetFile);
                                fileQueue.push({
                                    file: targetFile,
                                    linkText: cachedLink.link,
                                    fileContent: linkedContent,
                                    subpath: linkSubpath ?? undefined,
                                });
                            } catch (error) {
                                this.logWarn(
                                    "Could not read linked file",
                                    cachedLink.link,
                                    error,
                                );
                            }
                        }
                    }
                }
            }

            fileToProcess = fileQueue.shift();
        }

        return expandedContent;
    }

    private extractSubpathContent(
        file: TFile,
        fileContent: string,
        subpath: string,
    ): string {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) {
            return fileContent;
        }

        // Check for block reference (^block-id)
        if (subpath.startsWith("^")) {
            const blockId = subpath.substring(1);
            const block = cache.blocks?.[blockId];
            if (block) {
                const lines = fileContent.split("\n");
                return lines[block.position.start.line] || "";
            }
            return fileContent;
        }

        // Check for heading reference
        const targetHeading = subpath.replace(/%20/g, " ");
        const heading = cache.headings?.find(
            (h) => h.heading === targetHeading,
        );

        if (heading && cache.headings) {
            // Find the end of this section
            const start = heading.position.end.offset;
            let end = fileContent.length;

            // Find next heading at same or higher level
            const headingIndex = cache.headings.indexOf(heading);
            for (const h of cache.headings.slice(headingIndex + 1)) {
                if (h.level <= heading.level) {
                    end = h.position.start.offset;
                    break;
                }
            }

            return fileContent.substring(start, end).trim();
        }

        // If no matching subpath found, return full content
        return fileContent;
    }

    private applyPrefilters(content: string, filterNames?: string[]): string {
        if (!filterNames || filterNames.length === 0) {
            return content;
        }

        let processedContent = content;

        for (const filterName of filterNames) {
            const filterFn = window.promptFlow?.filters?.[filterName];
            if (!filterFn) {
                this.logWarn(
                    `Filter "${filterName}" not found in window.promptFlow.filters`,
                );
                continue;
            }

            try {
                this.logDebug("Filtering:", filterName);
                processedContent = filterFn(processedContent);
            } catch (error) {
                this.logError(error, `Error applying filter "${filterName}"`);
                // Continue with original content on error
                return content;
            }
        }
        return processedContent;
    }

    private async getGeneratedContent(
        documentText: string,
        resolvedPrompt: ResolvedPrompt,
        promptKey: string,
        activeNote: TFile,
    ): Promise<string | null> {
        if (!documentText.trim()) {
            new Notice("Document is empty. Write something first!");
            return null;
        }

        const model = resolvedPrompt.model || this.settings.modelName;

        if (!this.settings.ollamaUrl || !model) {
            new Notice(
                "Ollama URL or model not configured. Please check settings.",
            );
            return null;
        }

        const isConnected = await this.ollamaClient.checkConnection();
        if (!isConnected) {
            new Notice(
                "Cannot connect to Ollama. Please ensure Ollama is running.",
            );
            return null;
        }

        const displayLabel =
            this.settings.prompts[promptKey]?.displayLabel || promptKey;

        const notice = new Notice(
            `Generating ${displayLabel} using ${model}`,
            0,
        );

        const contextKey = this.buildContextKey(
            activeNote,
            resolvedPrompt,
            promptKey,
        );
        const context = this.getContextForKey(contextKey);

        const generateOptions = {
            numCtx: resolvedPrompt.numCtx,
            context,
            temperature: resolvedPrompt.temperature,
            topP: resolvedPrompt.topP,
            topK: resolvedPrompt.topK,
            repeatPenalty: resolvedPrompt.repeatPenalty,
            keepAlive: this.settings.keepAlive,
        };

        this.logLlmRequest({
            model,
            promptKey,
            file: activeNote.path,
            systemPrompt: resolvedPrompt.prompt,
            documentText,
            options: generateOptions,
        });

        try {
            const result = await this.ollamaClient.generate(
                model,
                resolvedPrompt.prompt,
                documentText,
                generateOptions,
            );

            notice.hide();

            if (contextKey !== null && result.context) {
                this.storeContextForKey(contextKey, result.context);
            }

            return result.response;
        } catch (error) {
            notice.hide();
            const errorMsg = this.logError(error);
            new Notice(`Failed to generate ${displayLabel}: ${errorMsg}`);
            return null;
        }
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

    private logLlmRequest(payload: unknown): void {
        if (this.settings?.showLlmRequests) {
            console.debug("(PF)[LLM Request]", payload);
        }
    }
}

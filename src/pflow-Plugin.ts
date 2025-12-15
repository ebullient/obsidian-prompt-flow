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
    IOllamaClient,
    Logger,
    PromptFlowSettings,
    ResolvedPrompt,
} from "./@types";
import { DEFAULT_PROMPT, DEFAULT_SETTINGS } from "./pflow-Constants";
import { createLLMClient } from "./pflow-LLMClientFactory";
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

const MAX_DEPTH = 2;
type EmbeddedLink = {
    subpaths: Set<string>; // headings, blockrefs
    hasFullReference: boolean;
    file: TFile | null; // null for unresolved links
    depth: number;
};
type EmbeddedNotes = Map<string, EmbeddedLink>;

export class PromptFlowPlugin extends Plugin implements Logger {
    settings!: PromptFlowSettings;
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

    private getClientForPrompt(resolvedPrompt: ResolvedPrompt): IOllamaClient {
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
            resolved.excludePatterns,
            resolved.includeLinks ?? false,
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

        // Extract connection from note frontmatter (can override everything)
        const noteConnection = extractFrontmatterValue(
            frontmatter,
            "connection",
            promptKey,
        );

        // Check for direct prompt in frontmatter
        const promptValue = extractFrontmatterValue(
            frontmatter,
            "prompt",
            promptKey,
        );
        if (promptValue) {
            return {
                prompt: promptValue,
                connection: noteConnection,
            };
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
                // Note frontmatter connection overrides prompt file connection
                return {
                    ...resolved,
                    connection: noteConnection ?? resolved.connection,
                };
            }
        }

        // Fallback to global settings or built-in defaults
        const defaultResolved = await this.getDefaultPrompt(promptKey);
        // Note frontmatter connection overrides everything
        return {
            ...defaultResolved,
            connection: noteConnection ?? defaultResolved.connection,
        };
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
                // Prompt file connection overrides prompt config connection
                return {
                    ...resolved,
                    connection: resolved.connection ?? promptConfig.connection,
                };
            }
        }

        // Final fallback for legacy prompts
        return {
            prompt: DEFAULT_PROMPT,
            connection: promptConfig.connection,
        };
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

                const connection =
                    typeof frontmatter?.connection === "string"
                        ? frontmatter.connection
                        : undefined;

                // Strip frontmatter from prompt content
                const promptText = this.stripFrontmatter(promptContent);
                return {
                    prompt: promptText,
                    connection,
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
        sourceFile: TFile,
        content: string,
        excludePatterns: RegExp[] = [],
        includeLinks = false,
    ): Promise<string> {
        let fileCache = this.app.metadataCache.getFileCache(sourceFile);
        if (!fileCache) {
            return content;
        }

        const seenLinks: EmbeddedNotes = new Map();
        const fileQueue: EmbeddedLink[] = [];

        // Track seen files to prevent duplicates (using normalized TFile paths)
        const origin = {
            hasFullReference: true,
            subpaths: new Set<string>(),
            file: sourceFile,
            depth: 0,
        };
        seenLinks.set(sourceFile.path, origin);
        fileQueue.push(origin);

        // Phase 1: Process queue breadth-first
        // We are not gathering content at this time: we're only resolving
        // files and links.
        let embeddedLink = fileQueue.shift();
        while (embeddedLink) {
            // Skip if file wasn't found (null) or max depth reached
            if (!embeddedLink.file || embeddedLink.depth >= MAX_DEPTH) {
                embeddedLink = fileQueue.shift();
                continue;
            }

            fileCache = this.app.metadataCache.getFileCache(embeddedLink.file);
            if (fileCache) {
                // Process both links and embeds
                // Only include regular links if includeLinks is true
                const allLinks = [
                    ...(includeLinks ? fileCache.links || [] : []),
                    ...(fileCache.embeds || []),
                ].filter((link) => link);

                for (const cachedLink of allLinks) {
                    // Skip if link matches exclusion patterns
                    if (this.shouldExcludeLink(cachedLink, excludePatterns)) {
                        continue;
                    }

                    // Skip duplicate unresolved links (resolved links are
                    // deduplicated later by file path)
                    const linkKey = cachedLink.link;
                    if (seenLinks.has(linkKey)) {
                        continue; // unresolved link seen before
                    }

                    // Parse link to extract path and subpath
                    const { path, subpath } = parseLinkReference(
                        cachedLink.link,
                    );
                    const targetFile =
                        this.app.metadataCache.getFirstLinkpathDest(
                            path,
                            embeddedLink.file.path,
                        );

                    if (!targetFile) {
                        this.logDebug(
                            `Link target not found: ${cachedLink.link} ` +
                                `(from ${embeddedLink.file.path})`,
                        );
                        // Add to seen list to avoid checking again (but don't queue)
                        seenLinks.set(linkKey, {
                            hasFullReference: false,
                            subpaths: new Set<string>(),
                            file: null,
                            depth: embeddedLink.depth + 1,
                        });
                        continue; // to next link
                    }

                    const key = targetFile.path;
                    let ref = seenLinks.get(key);
                    if (!ref) {
                        // create ref if missing
                        ref = {
                            hasFullReference: false,
                            subpaths: new Set<string>(),
                            file: targetFile,
                            depth: embeddedLink.depth + 1,
                        };
                        seenLinks.set(key, ref);
                        fileQueue.push(ref); // new link to visit
                        this.logDebug(
                            "Link",
                            embeddedLink.file.path,
                            " ➡ ",
                            targetFile.path,
                        );
                    }

                    // Track subpath or full file reference
                    if (!subpath) {
                        ref.hasFullReference = true;
                    } else {
                        ref.subpaths.add(subpath);
                    }
                }
            }
            embeddedLink = fileQueue.shift();
        }

        // Phase 2: Collect content.
        // Read each referenced file, and append
        const expandedContent = [];
        seenLinks.delete(sourceFile.path); // remove sourcefile
        this.logDebug(`Collecting content from ${seenLinks.size} linked files`);
        for (const link of seenLinks.values()) {
            // Skip null file entries (unresolved links)
            // and non-markdown files
            if (!link.file || link.file.extension !== "md") {
                continue;
            }

            const fileContent = await this.app.vault.cachedRead(link.file);
            if (link.hasFullReference) {
                // emit whole file once
                expandedContent.push(
                    `===== BEGIN ENTRY: ${link.file.path} =====`,
                );
                expandedContent.push(fileContent);
                expandedContent.push("===== END ENTRY =====\n");
            } else {
                // emit each subpath snippet
                for (const subpath of link.subpaths) {
                    expandedContent.push(
                        `===== BEGIN ENTRY: ${link.file.path}#${subpath} =====`,
                    );
                    expandedContent.push(
                        this.extractSubpathContent(
                            link.file,
                            fileContent,
                            subpath,
                        ),
                    );
                    expandedContent.push("===== END ENTRY =====\n");
                }
            }
        }

        if (expandedContent.length) {
            return (
                content +
                "\n----- EMBEDDED/LINKED CONTENT -----\n" +
                expandedContent.join("\n")
            );
        }
        return content;
    }

    // Subset of full document content.
    // If the subpath isn't found, return empty.
    private extractSubpathContent(
        file: TFile,
        fileContent: string,
        subpath: string,
    ): string {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) {
            return "";
        }

        // Check for block reference (^block-id)
        if (subpath.startsWith("^")) {
            const blockId = subpath.substring(1);
            const block = cache.blocks?.[blockId];
            if (block) {
                // Extract the full block content using offsets
                const start = block.position.start.offset;
                const end = block.position.end.offset;
                return fileContent.substring(start, end).trim();
            }
            this.logDebug(
                `Block reference not found: ^${blockId} in ${file.path}`,
            );
            return "";
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

        // If no matching subpath found, return empty
        this.logDebug(`Subpath not found: #${subpath} in ${file.path}`);
        return "";
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

        // Get connection for this prompt
        const connectionKey =
            resolvedPrompt.connection || this.settings.defaultConnection;
        const connection = this.settings.connections[connectionKey];

        if (!connection) {
            new Notice(
                `Connection '${connectionKey}' not found. Please check settings.`,
            );
            return null;
        }

        // Get model from prompt or connection default
        const model =
            resolvedPrompt.model || connection.defaultModel || "llama3.1";

        if (!connection.baseUrl || !model) {
            new Notice(
                "Connection URL or model not configured. Please check settings.",
            );
            return null;
        }

        // Create client for this connection
        let client: IOllamaClient;
        try {
            client = this.getClientForPrompt(resolvedPrompt);
        } catch (error) {
            const errorMsg = this.logError(error, "Failed to create client");
            new Notice(`Connection error: ${errorMsg}`);
            return null;
        }

        const isConnected = await client.checkConnection();
        if (!isConnected) {
            new Notice(
                `Cannot connect to ${connectionKey}. Please check connection settings.`,
            );
            return null;
        }

        const displayLabel =
            this.settings.prompts[promptKey]?.displayLabel || promptKey;

        const notice = new Notice(
            `Generating ${displayLabel} using ${model} (${connectionKey})`,
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
            keepAlive: connection.keepAlive,
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
            const result = await client.generate(
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

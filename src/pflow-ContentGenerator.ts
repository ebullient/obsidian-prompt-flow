import {
    type App,
    type Editor,
    type MarkdownFileInfo,
    MarkdownView,
    Notice,
    type TFile,
} from "obsidian";
import type {
    EmbeddedLink,
    EmbeddedNotes,
    IOllamaClient,
    PromptFlowSettings,
    ResolvedPrompt,
} from "./@types";
import type { PromptFlowPlugin } from "./pflow-Plugin";
import { PromptResolver } from "./pflow-PromptResolver";
import {
    filterCallouts,
    formatAsBlockquote,
    parseLinkReference,
} from "./pflow-Utils";

const MAX_DEPTH = 2;

export class ContentGenerator {
    promptResolver: PromptResolver;

    constructor(
        private app: App,
        private settings: PromptFlowSettings,
        private plugin: PromptFlowPlugin,
    ) {
        this.promptResolver = new PromptResolver(app, settings, plugin);
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

        const resolved = await this.promptResolver.resolvePromptFromFile(
            activeNote,
            promptKey,
        );

        this.plugin.logDebug(
            "Resolved prompt parameters:",
            promptKey,
            resolved,
        );

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

        // Insert placeholder and start animation
        const placeholderInfo = this.insertPlaceholder(
            editor,
            resolved,
            activeNote,
        );

        const content = await this.getGeneratedContent(
            processedContent,
            resolved,
            promptKey,
            activeNote,
        );

        // Stop animation and replace placeholder
        if (placeholderInfo) {
            this.stopPlaceholderAnimation(placeholderInfo.intervalId);
        }

        // Check if file is still the same in this editor before inserting
        if (content && placeholderInfo) {
            const currentFile = ctx.file;
            if (currentFile && currentFile.path === activeNote.path) {
                this.replacePlaceholder(
                    editor,
                    placeholderInfo,
                    content,
                    promptKey,
                    resolved,
                );
            } else {
                // File changed - placeholder stays as evidence
                this.plugin.logDebug(
                    "File changed during generation, leaving placeholder",
                );
            }
        } else if (placeholderInfo) {
            // Remove placeholder if generation failed
            this.removePlaceholder(editor, placeholderInfo);
        }
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
        const { connectionKey, connection } =
            this.plugin.getConnectionConfig(resolvedPrompt);

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
            client = this.plugin.getClientForPrompt(resolvedPrompt);
        } catch (error) {
            const errorMsg = this.plugin.logError(
                error,
                "Failed to create client",
            );
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

        const contextKey = this.plugin.buildContextKey(
            activeNote,
            resolvedPrompt,
            promptKey,
        );
        const context = this.plugin.getContextForKey(contextKey);

        const generateOptions = {
            numCtx: resolvedPrompt.numCtx,
            context,
            temperature: resolvedPrompt.temperature,
            topP: resolvedPrompt.topP,
            topK: resolvedPrompt.topK,
            repeatPenalty: resolvedPrompt.repeatPenalty,
            keepAlive: connection.keepAlive,
        };

        this.plugin.logLlmRequest({
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
                this.plugin.storeContextForKey(contextKey, result.context);
            }

            return result.response;
        } catch (error) {
            notice.hide();
            const errorMsg = this.plugin.logError(error);
            new Notice(`Failed to generate ${displayLabel}: ${errorMsg}`);
            return null;
        }
    }

    private applyPrefilters(content: string, filterNames?: string[]): string {
        if (!filterNames || filterNames.length === 0) {
            return content;
        }

        let processedContent = content;

        for (const filterName of filterNames) {
            const filterFn = window.promptFlow?.filters?.[filterName];
            if (!filterFn) {
                this.plugin.logWarn(
                    `Filter "${filterName}" not found in window.promptFlow.filters`,
                );
                continue;
            }

            try {
                this.plugin.logDebug("Filtering:", filterName);
                processedContent = filterFn(processedContent);
            } catch (error) {
                this.plugin.logError(
                    error,
                    `Error applying filter "${filterName}"`,
                );
                // Continue with original content on error
                return content;
            }
        }
        return processedContent;
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
                    if (
                        this.plugin.shouldExcludeLink(
                            cachedLink,
                            excludePatterns,
                        )
                    ) {
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
                        this.plugin.logDebug(
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
                        this.plugin.logDebug(
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

        this.plugin.logDebug(
            `Collecting content from ${seenLinks.size} linked files`,
        );

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
            this.plugin.logDebug(
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
        this.plugin.logDebug(`Subpath not found: #${subpath} in ${file.path}`);
        return "";
    }

    // ----- Placeholder -------------

    private insertPlaceholder(
        editor: Editor,
        resolved: ResolvedPrompt,
        activeNote: TFile,
    ): {
        startLine: number;
        endLine: number;
        currentFrame: number;
        intervalId: number;
        filePath: string;
    } | null {
        const cursor = editor.getCursor();
        const currentLine = editor.getLine(cursor.line);
        const isEmptyLine = currentLine.trim() === "";

        const wrapInBlockquote = resolved.wrapInBlockquote ?? true;
        const prefix = wrapInBlockquote ? "> " : "";
        const frames = ["✻", "✼", "✽", "✼"];
        const initialPlaceholder = `${prefix}Thinking ${frames[0]}`;

        const insertText = isEmptyLine
            ? `${initialPlaceholder}\n\n`
            : `\n\n${initialPlaceholder}\n\n`;

        const startLine = isEmptyLine ? cursor.line : cursor.line + 2;
        const endLine = startLine;

        editor.replaceSelection(insertText);

        // Animate the placeholder, but stop if file changes
        let currentFrame = 0;
        const intervalId = window.setInterval(() => {
            currentFrame = (currentFrame + 1) % frames.length;
            const newPlaceholder = `${prefix}Thinking ${frames[currentFrame]}`;

            try {
                const line = editor.getLine(startLine);
                if (line?.includes("Thinking")) {
                    editor.setLine(startLine, newPlaceholder);
                }
            } catch (error) {
                // Line might not exist anymore, stop animation
                this.plugin.logDebug(
                    "Error updating placeholder animation:",
                    error,
                );
                window.clearInterval(intervalId);
            }
        }, 150);

        return {
            startLine,
            endLine,
            currentFrame,
            intervalId,
            filePath: activeNote.path,
        };
    }

    private stopPlaceholderAnimation(intervalId: number): void {
        window.clearInterval(intervalId);
    }

    private replacePlaceholder(
        editor: Editor,
        placeholderInfo: {
            startLine: number;
            endLine: number;
            currentFrame: number;
            intervalId: number;
            filePath: string;
        },
        content: string,
        promptKey: string,
        resolved: ResolvedPrompt,
    ): void {
        const wrapInBlockquote = resolved.wrapInBlockquote ?? true;
        const calloutHeading = resolved.calloutHeading;

        const formattedContent = wrapInBlockquote
            ? formatAsBlockquote(content, calloutHeading)
            : content;

        // Replace the placeholder line(s) with the actual content
        const startPos = { line: placeholderInfo.startLine, ch: 0 };
        const endPos = {
            line: placeholderInfo.endLine,
            ch: editor.getLine(placeholderInfo.endLine).length,
        };

        editor.replaceRange(formattedContent, startPos, endPos);

        const displayLabel =
            this.settings.prompts[promptKey]?.displayLabel || promptKey;
        new Notice(`Inserted ${displayLabel}`);
    }

    private removePlaceholder(
        editor: Editor,
        placeholderInfo: {
            startLine: number;
            endLine: number;
            currentFrame: number;
            intervalId: number;
            filePath: string;
        },
    ): void {
        try {
            const startPos = { line: placeholderInfo.startLine, ch: 0 };
            const endLine = Math.min(
                placeholderInfo.endLine + 2,
                editor.lastLine(),
            );
            const endPos = { line: endLine, ch: 0 };

            editor.replaceRange("", startPos, endPos);
        } catch (error) {
            // Placeholder might already be gone
            this.plugin.logDebug("Placeholder already removed.", error);
        }
    }
}

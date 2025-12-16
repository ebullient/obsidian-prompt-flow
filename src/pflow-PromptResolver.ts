import { type App, Notice, TFile } from "obsidian";
import type { Logger, PromptFlowSettings, ResolvedPrompt } from "./@types";
import { DEFAULT_PROMPT } from "./pflow-Constants";
import {
    compileExcludePatterns,
    extractFrontmatterValue,
    normalizeToArray,
    type optionalStrings,
    parseBoolean,
    parseParameterWithConstraint,
    parsePositiveInteger,
} from "./pflow-Utils";

export class PromptResolver {
    constructor(
        private app: App,
        private settings: PromptFlowSettings,
        private logger: Logger,
    ) {}

    resolvePromptFromFile = async (
        file: TFile,
        promptKey: string,
    ): Promise<ResolvedPrompt> => {
        const frontmatter =
            this.app.metadataCache.getFileCache(file)?.frontmatter;

        // Get the prompt configuration from settings
        const promptConfig = this.settings.prompts[promptKey];
        if (!promptConfig) {
            throw new Error(`Unknown prompt key: ${promptKey}`);
        }

        // Find THE prompt file path:
        // 1. Note frontmatter prompt-file (highest priority)
        // 2. Plugin settings promptFile (fallback)
        const promptFilePath =
            extractFrontmatterValue(frontmatter, "prompt-file", promptKey) ||
            promptConfig.promptFile;

        // Read the prompt file if one is specified
        const promptFileData = promptFilePath
            ? await this.readPromptFromFile(promptFilePath)
            : null;

        // Merge: prompt file -> settings -> defaults
        // Precedence: prompt file values override settings, settings override defaults
        return {
            ...promptFileData,
            prompt: promptFileData?.prompt ?? DEFAULT_PROMPT,
            connection: promptFileData?.connection ?? promptConfig.connection,
        };
    };

    readPromptFromFile = async (
        promptFilePath: string,
    ): Promise<ResolvedPrompt | null> => {
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
                this.logger.logError(error, "Error reading prompt file");
            }
        } else {
            new Notice(`Prompt file not found: ${promptFilePath}`);
            this.logger.logWarn("Prompt file not found", promptFilePath);
        }
        return null;
    };

    stripFrontmatter = (content: string): string => {
        const frontmatterRegex = /^---\n[\s\S]*?\n---\n/;
        return content.replace(frontmatterRegex, "").trim();
    };
}

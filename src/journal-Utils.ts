export type optionalStrings = string | string[] | undefined;

/**
 * Normalizes a string or array value to an array of trimmed, non-empty strings.
 * Useful for parsing YAML frontmatter that can be either format.
 *
 * @param value - String (newline-delimited) or array to normalize
 * @returns Array of trimmed non-empty strings, or undefined if input is empty
 */
export function normalizeToArray(
    value?: optionalStrings,
): string[] | undefined {
    if (!value) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value;
    }
    return value
        .split("\n")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

/**
 * Compiles string patterns into RegExp array.
 * Invalid patterns are silently skipped.
 *
 * @param patterns - String or array of regex patterns
 * @returns Array of compiled RegExp objects
 */
export function compileExcludePatterns(
    excludePatternsRaw?: optionalStrings,
): RegExp[] {
    const patterns = normalizeToArray(excludePatternsRaw);
    if (!patterns) {
        return [];
    }
    const compiled: RegExp[] = [];
    for (const pattern of patterns) {
        try {
            compiled.push(new RegExp(pattern));
        } catch {
            // Silently skip invalid patterns
        }
    }
    return compiled;
}

/**
 * Parses a boolean value from various input types.
 *
 * @param value - Value to parse (boolean, string, or other)
 * @returns Parsed boolean or undefined if not parseable
 */
export function parseBoolean(value: unknown): boolean | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") {
            return true;
        }
        if (normalized === "false") {
            return false;
        }
    }
    return undefined;
}

/**
 * Parses a finite number from various input types.
 *
 * @param value - Value to parse (number, string, or other)
 * @returns Parsed number or undefined if not finite
 */
export function parseFiniteNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }

    const parsed =
        typeof value === "number"
            ? value
            : typeof value === "string"
              ? Number.parseFloat(value.trim())
              : Number.NaN;

    if (Number.isFinite(parsed)) {
        return parsed;
    }
    return undefined;
}

/**
 * Parses a positive integer from various input types.
 *
 * @param value - Value to parse (number, string, or other)
 * @returns Parsed positive integer or undefined if invalid
 */
export function parsePositiveInteger(value: unknown): number | undefined {
    const parsed = parseFiniteNumber(value);

    if (parsed === undefined) {
        return undefined;
    }
    if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
    }
    return undefined;
}

/**
 * Gets the first defined value from frontmatter using multiple possible keys.
 *
 * @param frontmatter - Frontmatter object to search
 * @param keys - Array of keys to try
 * @returns First defined value found, or undefined
 */
export function getFrontmatterValue(
    frontmatter: Record<string, unknown> | undefined,
    keys: string[],
): unknown {
    if (!frontmatter) {
        return undefined;
    }
    for (const key of keys) {
        if (frontmatter[key] !== undefined) {
            return frontmatter[key];
        }
    }
    return undefined;
}

/**
 * Parses a numeric parameter from frontmatter with a validation constraint.
 *
 * @param frontmatter - Frontmatter object to search
 * @param keys - Array of keys to try
 * @param constraint - Validation function for the parsed number
 * @returns Parsed and validated number, or undefined
 */
export function parseParameterWithConstraint(
    frontmatter: Record<string, unknown> | undefined,
    keys: string[],
    constraint: (val: number) => boolean,
): number | undefined {
    const candidate = parseFiniteNumber(getFrontmatterValue(frontmatter, keys));
    return candidate !== undefined && constraint(candidate)
        ? candidate
        : undefined;
}

/**
 * Extracts a string value from frontmatter, supporting per-prompt overrides.
 * If the value is a string, returns it directly.
 * If the value is an object, looks up the promptKey within it.
 *
 * @param frontmatter - Frontmatter object to search
 * @param key - Key to look up
 * @param promptKey - Prompt-specific key for nested lookup
 * @returns Extracted string value or undefined
 */
export function extractFrontmatterValue(
    frontmatter: Record<string, unknown> | undefined,
    key: string,
    promptKey: string,
): string | undefined {
    if (!frontmatter?.[key]) {
        return undefined;
    }

    const value = frontmatter[key];
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "object" && value !== null) {
        const promptValue = (value as Record<string, unknown>)[promptKey];
        if (typeof promptValue === "string") {
            return promptValue;
        }
    }
    return undefined;
}

/**
 * Parses a link reference into path and subpath components.
 *
 * @param link - The link to parse (e.g., "file#heading" or "file")
 * @returns Object with path and optional subpath (heading/block reference)
 */
export function parseLinkReference(link: string): {
    path: string;
    subpath: string | null;
} {
    const anchorPos = link.indexOf("#");
    if (anchorPos < 0) {
        return { path: link, subpath: null };
    }
    return {
        path: link.substring(0, anchorPos),
        subpath: link.substring(anchorPos + 1),
    };
}

/**
 * Formats content as a blockquote with optional callout heading.
 *
 * @param content - The content to format
 * @param calloutHeading - Optional callout heading (e.g., "[!magic] Affirmation")
 * @returns The formatted blockquote string
 */
export function formatAsBlockquote(
    content: string,
    calloutHeading?: string,
): string {
    const lines = content.split("\n").map((line) => `> ${line}`);
    if (calloutHeading) {
        lines.unshift(`> ${calloutHeading}`);
    }
    return lines.join("\n");
}

/**
 * Filters out callouts of specified types from content.
 * Handles nested callouts by tracking depth and parent exclusion state.
 * If a callout is excluded, all nested content (including other callouts)
 * is also excluded until we return to the parent level or shallower.
 *
 * @param content - The content to filter
 * @param calloutTypes - Array of callout types to exclude
 * @returns The filtered content with specified callouts removed
 */
export function filterCallouts(
    content: string,
    calloutTypes?: string[],
): string {
    if (!calloutTypes || calloutTypes.length === 0) {
        return content;
    }

    const types = calloutTypes;

    const lines = content.split("\n");
    const result: string[] = [];
    let skipDepth = -1; // -1 means not skipping, >= 0 means skip at this depth
    let previousLineBlank = false;

    for (const line of lines) {
        const trimmed = line.trimStart();

        // Count '>' chars at start (handles both '>>' and '> >' style)
        const depth = (trimmed.match(/^(?:>\s*)*/)?.[0].match(/>/g) || [])
            .length;
        const isBlank = depth === 0 && line.trim().length === 0;
        const calloutMatch = line.match(/^((?:>\s*)+)\[!([\w-]+)\]/);

        // Currently skipping an excluded callout?
        if (skipDepth >= 0) {
            // Skip deeper or same-depth non-header content
            if (depth > skipDepth || (depth === skipDepth && !calloutMatch)) {
                previousLineBlank = isBlank;
                continue;
            }
            // Same-depth callout without blank line separator? Keep skipping
            if (depth === skipDepth && calloutMatch && !previousLineBlank) {
                previousLineBlank = isBlank;
                continue;
            }
            // Otherwise stop skipping (shallower depth or separated sibling)
            skipDepth = -1;
        }

        // Check if this callout should be excluded
        if (calloutMatch) {
            const calloutType = calloutMatch[2].toLowerCase();
            if (types.some((t) => t.toLowerCase() === calloutType)) {
                skipDepth = depth;
                previousLineBlank = isBlank;
                continue;
            }
        }

        result.push(line);
        previousLineBlank = isBlank;
    }

    return result.join("\n");
}

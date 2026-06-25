import { describe, it, expect } from "vitest";
import { windowFilter, EMBEDDED_CONTENT_MARKER } from "../src/pflow-Utils";

// budget = Math.floor(numCtx * 3 * 0.8)
// numCtx=10 → budget=24, numCtx=100 → budget=240

describe("windowFilter", () => {
    it("returns content unchanged when within budget", () => {
        const content = "short content";
        expect(windowFilter(content, 100)).toBe(content);
    });

    it("truncates to budget when content exceeds it and no marker present", () => {
        const numCtx = 10; // budget = 24
        const content = "a".repeat(30);
        const result = windowFilter(content, numCtx);
        expect(result).toBe("a".repeat(24));
    });

    it("trims at marker when primary content fits within budget", () => {
        const numCtx = 10; // budget = 24
        const primary = "a".repeat(20); // 20 < 24, fits
        const content = primary + EMBEDDED_CONTENT_MARKER + "b".repeat(100);
        const result = windowFilter(content, numCtx);
        expect(result).toBe(primary);
    });

    it("truncates to budget when primary content also exceeds budget", () => {
        const numCtx = 10; // budget = 24
        const primary = "a".repeat(30); // 30 > 24, too long
        const content = primary + EMBEDDED_CONTENT_MARKER + "b".repeat(100);
        const result = windowFilter(content, numCtx);
        expect(result).toBe("a".repeat(24));
    });

    it("returns content unchanged when exactly at budget", () => {
        const numCtx = 10; // budget = 24
        const content = "a".repeat(24);
        expect(windowFilter(content, numCtx)).toBe(content);
    });
});

import { describe, it, expect } from "vitest";
import {
    normalizeToArray,
    compileExcludePatterns,
    parseBoolean,
    parseFiniteNumber,
    parsePositiveInteger,
    getFrontmatterValue,
    extractFrontmatterValue,
    parseParameterWithConstraint,
} from "../src/pflow-Utils";

describe("normalizeToArray", () => {
    it("should return undefined for empty/null/undefined input", () => {
        expect(normalizeToArray(undefined)).toBeUndefined();
        expect(normalizeToArray("")).toBeUndefined();
    });

    it("should return array unchanged", () => {
        expect(normalizeToArray(["foo", "bar"])).toEqual(["foo", "bar"]);
        expect(normalizeToArray([])).toEqual([]);
    });

    it("should split newline-delimited string into array", () => {
        expect(normalizeToArray("foo\nbar\nbaz")).toEqual(["foo", "bar", "baz"]);
    });

    it("should trim whitespace from each item", () => {
        expect(normalizeToArray("  foo  \n  bar  ")).toEqual(["foo", "bar"]);
    });

    it("should filter out empty items", () => {
        expect(normalizeToArray("foo\n\n\nbar")).toEqual(["foo", "bar"]);
        expect(normalizeToArray("  \n  \n  ")).toEqual([]);
    });
});

describe("compileExcludePatterns", () => {
    it("should return empty array for undefined input", () => {
        expect(compileExcludePatterns(undefined)).toEqual([]);
        expect(compileExcludePatterns("")).toEqual([]);
    });

    it("should compile string patterns to RegExp array", () => {
        const result = compileExcludePatterns("foo\nbar");
        expect(result).toHaveLength(2);
        expect(result[0]).toBeInstanceOf(RegExp);
        expect(result[0].test("foo")).toBe(true);
        expect(result[1].test("bar")).toBe(true);
    });

    it("should compile array patterns to RegExp array", () => {
        const result = compileExcludePatterns(["^test", "end$"]);
        expect(result).toHaveLength(2);
        expect(result[0].test("test123")).toBe(true);
        expect(result[1].test("123end")).toBe(true);
    });

    it("should silently skip invalid regex patterns", () => {
        const result = compileExcludePatterns(["valid", "[invalid", "also-valid"]);
        expect(result).toHaveLength(2);
        expect(result[0].test("valid")).toBe(true);
        expect(result[1].test("also-valid")).toBe(true);
    });
});

describe("parseBoolean", () => {
    it("should return undefined for null/undefined", () => {
        expect(parseBoolean(null)).toBeUndefined();
        expect(parseBoolean(undefined)).toBeUndefined();
    });

    it("should return boolean unchanged", () => {
        expect(parseBoolean(true)).toBe(true);
        expect(parseBoolean(false)).toBe(false);
    });

    it("should parse string 'true' and 'false'", () => {
        expect(parseBoolean("true")).toBe(true);
        expect(parseBoolean("false")).toBe(false);
    });

    it("should be case insensitive", () => {
        expect(parseBoolean("TRUE")).toBe(true);
        expect(parseBoolean("False")).toBe(false);
        expect(parseBoolean("  TrUe  ")).toBe(true);
    });

    it("should return undefined for invalid strings", () => {
        expect(parseBoolean("yes")).toBeUndefined();
        expect(parseBoolean("1")).toBeUndefined();
        expect(parseBoolean("")).toBeUndefined();
    });
});

describe("parseFiniteNumber", () => {
    it("should return undefined for null/undefined", () => {
        expect(parseFiniteNumber(null)).toBeUndefined();
        expect(parseFiniteNumber(undefined)).toBeUndefined();
    });

    it("should return number unchanged", () => {
        expect(parseFiniteNumber(42)).toBe(42);
        expect(parseFiniteNumber(3.14)).toBe(3.14);
        expect(parseFiniteNumber(0)).toBe(0);
        expect(parseFiniteNumber(-10)).toBe(-10);
    });

    it("should parse string numbers", () => {
        expect(parseFiniteNumber("42")).toBe(42);
        expect(parseFiniteNumber("3.14")).toBe(3.14);
        expect(parseFiniteNumber("  123.45  ")).toBe(123.45);
    });

    it("should return undefined for non-finite values", () => {
        expect(parseFiniteNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
        expect(parseFiniteNumber(Number.NEGATIVE_INFINITY)).toBeUndefined();
        expect(parseFiniteNumber(Number.NaN)).toBeUndefined();
    });

    it("should return undefined for invalid strings", () => {
        expect(parseFiniteNumber("not a number")).toBeUndefined();
        expect(parseFiniteNumber("")).toBeUndefined();
    });
});

describe("parsePositiveInteger", () => {
    it("should return undefined for null/undefined", () => {
        expect(parsePositiveInteger(null)).toBeUndefined();
        expect(parsePositiveInteger(undefined)).toBeUndefined();
    });

    it("should return positive integers", () => {
        expect(parsePositiveInteger(1)).toBe(1);
        expect(parsePositiveInteger(100)).toBe(100);
        expect(parsePositiveInteger("42")).toBe(42);
    });

    it("should reject zero", () => {
        expect(parsePositiveInteger(0)).toBeUndefined();
        expect(parsePositiveInteger("0")).toBeUndefined();
    });

    it("should reject negative numbers", () => {
        expect(parsePositiveInteger(-1)).toBeUndefined();
        expect(parsePositiveInteger("-10")).toBeUndefined();
    });

    it("should reject non-integers", () => {
        expect(parsePositiveInteger(3.14)).toBeUndefined();
        expect(parsePositiveInteger("3.14")).toBeUndefined();
    });

    it("should reject non-finite values", () => {
        expect(parsePositiveInteger(Number.POSITIVE_INFINITY)).toBeUndefined();
        expect(parsePositiveInteger(Number.NaN)).toBeUndefined();
    });
});

describe("getFrontmatterValue", () => {
    it("should return undefined for undefined frontmatter", () => {
        expect(getFrontmatterValue(undefined, ["key"])).toBeUndefined();
    });

    it("should return first defined value from keys", () => {
        const fm = { foo: "first", bar: "second" };
        expect(getFrontmatterValue(fm, ["foo", "bar"])).toBe("first");
        expect(getFrontmatterValue(fm, ["missing", "bar"])).toBe("second");
    });

    it("should return undefined if no keys match", () => {
        const fm = { foo: "value" };
        expect(getFrontmatterValue(fm, ["missing", "also-missing"])).toBeUndefined();
    });

    it("should return first non-undefined value (including falsy values)", () => {
        const fm = { a: undefined, b: false, c: "yes" };
        expect(getFrontmatterValue(fm, ["a", "b", "c"])).toBe(false);
    });
});

describe("extractFrontmatterValue", () => {
    it("should return undefined for undefined frontmatter", () => {
        expect(extractFrontmatterValue(undefined, "key", "prompt")).toBeUndefined();
    });

    it("should return undefined if key not in frontmatter", () => {
        expect(extractFrontmatterValue({}, "key", "prompt")).toBeUndefined();
    });

    it("should return string value directly", () => {
        const fm = { model: "llama3" };
        expect(extractFrontmatterValue(fm, "model", "prompt")).toBe("llama3");
    });

    it("should extract prompt-specific value from object", () => {
        const fm = {
            model: {
                reflect: "llama3",
                summarize: "gemma",
            },
        };
        expect(extractFrontmatterValue(fm, "model", "reflect")).toBe("llama3");
        expect(extractFrontmatterValue(fm, "model", "summarize")).toBe("gemma");
    });

    it("should return undefined if prompt not in object", () => {
        const fm = { model: { reflect: "llama3" } };
        expect(extractFrontmatterValue(fm, "model", "missing")).toBeUndefined();
    });

    it("should return undefined if value is not string", () => {
        const fm = { model: { reflect: 123 } };
        expect(extractFrontmatterValue(fm, "model", "reflect")).toBeUndefined();
    });
});

describe("parseParameterWithConstraint", () => {
    it("should return undefined for undefined frontmatter", () => {
        expect(
            parseParameterWithConstraint(undefined, ["key"], () => true),
        ).toBeUndefined();
    });

    it("should parse and validate number", () => {
        const fm = { temp: 0.7 };
        expect(
            parseParameterWithConstraint(fm, ["temp"], (val) => val >= 0 && val <= 1),
        ).toBe(0.7);
    });

    it("should return undefined if constraint fails", () => {
        const fm = { temp: 1.5 };
        expect(
            parseParameterWithConstraint(fm, ["temp"], (val) => val >= 0 && val <= 1),
        ).toBeUndefined();
    });

    it("should try multiple keys", () => {
        const fm = { temperature: 0.8 };
        expect(
            parseParameterWithConstraint(
                fm,
                ["temp", "temperature"],
                (val) => val >= 0,
            ),
        ).toBe(0.8);
    });

    it("should return undefined if value is not a number", () => {
        const fm = { temp: "not-a-number" };
        expect(
            parseParameterWithConstraint(fm, ["temp"], (val) => val >= 0),
        ).toBeUndefined();
    });
});

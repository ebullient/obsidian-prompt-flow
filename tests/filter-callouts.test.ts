import { describe, it, expect } from "vitest";
import { filterCallouts } from "../src/pflow-Utils";

describe("filterCallouts", () => {
    it("should return content unchanged when no callout types specified", () => {
        const content = "> [!note] Note\n> Some text";
        const result = filterCallouts(content, []);
        expect(result).toBe(content);
    });

    it("should be case insensitive", () => {
        const content = "> [!EXCLUDE] Content\n> Text";
        const result = filterCallouts(content, ["exclude"]);
        expect(result).toBe("");
    });

    it("should filter simple callout and all its content", () => {
        const content = `Keep this
> [!exclude] Remove this
> All of this content
> Should be removed
Keep this too`;

        const result = filterCallouts(content, ["exclude"]);
        expect(result).toBe(`Keep this
Keep this too`);
    });

    it("should filter multiple callout types", () => {
        const content = `Keep
> [!exclude] Remove
> Content

> [!other] Also remove
> More content

Keep this`;

        const result = filterCallouts(content, ["exclude", "other"]);
        expect(result).toBe(`Keep


Keep this`);
    });

    it("should filter nested excluded callout inside allowed callout", () => {
        const content = `> [!note] Keep this callout
> Keep this content
>> [!exclude] Remove nested
>> Remove this content
> Keep this content too
Normal text`;

        const result = filterCallouts(content, ["exclude"]);
        expect(result).toBe(`> [!note] Keep this callout
> Keep this content
> Keep this content too
Normal text`);
    });

    it("should filter parent callout and ALL nested content", () => {
        const content = `> [!exclude] Remove parent
> Remove this
>> [!note] This nested callout also removed
>> All nested content removed
> Back to parent - still removed
Keep this`;

        const result = filterCallouts(content, ["exclude"]);
        expect(result).toBe("Keep this");
    });

    it("should filter deeply nested excluded callout (3 levels)", () => {
        const content = `> [!note] Keep level 1
> Keep content
> > [!info] Keep level 2
> > > [!exclude] Remove level 3
> > > Remove this deep content
> > Keep level 2 content
> Keep level 1 content
Normal`;

        const result = filterCallouts(content, ["exclude"]);
        expect(result).toBe(`> [!note] Keep level 1
> Keep content
> > [!info] Keep level 2
> > Keep level 2 content
> Keep level 1 content
Normal`);
    });

    it("should handle whitespace variations in nested depth counting", () => {
        const content = `> [!note] Keep
> Content
>> [!exclude] Remove (no space)
>> Remove content
> > [!exclude] Remove (with space)
> > Remove content
> Keep
Normal`;

        const result = filterCallouts(content, ["exclude"]);
        expect(result).toBe(`> [!note] Keep
> Content
> Keep
Normal`);
    });

    it("should treat sibling callouts with blank lines as separate", () => {
        const content = `> [!note] Keep

> [!exclude] Remove

> [!warning] Keep`;

        const result = filterCallouts(content, ["exclude"]);
        expect(result).toBe(`> [!note] Keep


> [!warning] Keep`);
    });

    it("should filter sibling callouts without blank lines together", () => {
        const content = `> [!note] Keep this
> Content
> [!exclude] Remove from here
> Excluded content
> [!warning] Also removed (no blank line)
> Also excluded`;

        const result = filterCallouts(content, ["exclude"]);
        expect(result).toBe(`> [!note] Keep this
> Content`);
    });

    it("should handle nested siblings with blank lines", () => {
        const content = `> [!note] Keep outer
> Content
>> [!exclude] Remove nested

>> [!warning] Keep nested (blank line)
>> Keep this
> Keep outer content`;

        const result = filterCallouts(content, ["exclude"]);
        expect(result).toBe(`> [!note] Keep outer
> Content

>> [!warning] Keep nested (blank line)
>> Keep this
> Keep outer content`);
    });

    it("should filter callouts with hyphens in type name", () => {
        const content = `> [!embedded-note] Keep this
> Content
>> [!tier-assessment] Remove this
>> Should be removed
> Keep this too`;

        const result = filterCallouts(content, ["tier-assessment"]);
        expect(result).toBe(`> [!embedded-note] Keep this
> Content
> Keep this too`);
    });
});

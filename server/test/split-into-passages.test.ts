import { describe, expect, it } from "vitest";
import { maxPassageLength, splitIntoPassages } from "../src/processing/split-into-passages.js";

describe("splitIntoPassages", () => {
  it("keeps short text as one passage", () => {
    expect(splitIntoPassages("  A short note.\nSecond line.  ")).toEqual([
      "A short note.\nSecond line.",
    ]);
  });

  it("returns nothing for blank text", () => {
    expect(splitIntoPassages(" \n\n ")).toEqual([]);
  });

  it("merges paragraphs up to the limit without exceeding it", () => {
    const paragraph = "word ".repeat(100).trim();
    const passages = splitIntoPassages(Array(10).fill(paragraph).join("\n\n"));
    expect(passages.length).toBeGreaterThan(1);
    expect(passages.every((passage) => passage.length <= maxPassageLength)).toBe(true);
    expect(passages[0]).toContain("\n\n");
  });

  it("splits a long paragraph at sentence ends and joins sentences with spaces", () => {
    const sentence = `${"lorem ".repeat(30).trim()}.`;
    const passages = splitIntoPassages(Array(20).fill(sentence).join(" "));
    expect(passages.length).toBeGreaterThan(1);
    expect(passages[0]).toMatch(/\. lorem/);
    expect(passages.every((passage) => passage.endsWith("."))).toBe(true);
  });

  it("cuts text without any separators at the limit", () => {
    const passages = splitIntoPassages("x".repeat(maxPassageLength * 2 + 5));
    expect(passages.map((passage) => passage.length)).toEqual([
      maxPassageLength,
      maxPassageLength,
      5,
    ]);
  });

  it("keeps every word", () => {
    const text = Array.from({ length: 400 }, (_, index) => `word${index}`).join(" ");
    expect(splitIntoPassages(text).join(" ").split(/\s+/)).toEqual(text.split(" "));
  });
});

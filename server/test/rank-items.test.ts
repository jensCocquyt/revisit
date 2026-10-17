import { describe, expect, it } from "vitest";
import { rankItems } from "../src/search/rank-items.js";

describe("rankItems", () => {
  it("ranks a passage found by several methods above one found by a single method", () => {
    const ranked = rankItems([
      { method: "meaning", hits: [hit("1", "first"), hit("2", "second")] },
      { method: "words", hits: [hit("2", "second")] },
    ]);
    expect(ranked.map((item) => item.itemId)).toEqual(["second", "first"]);
    expect(ranked[0]?.matchedBy).toEqual(["words", "meaning"]);
  });

  it("returns each item once, with its best passage and every method that found it", () => {
    const ranked = rankItems([
      { method: "meaning", hits: [hit("1", "first"), hit("3", "second")] },
      { method: "words", hits: [hit("1", "first")] },
      { method: "fragment", hits: [hit("2", "first")] },
    ]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]).toMatchObject({
      itemId: "first",
      passageId: "1",
      matchedBy: ["words", "fragment", "meaning"],
    });
  });

  it("returns nothing when no method found anything", () => {
    expect(rankItems([{ method: "words", hits: [] }])).toEqual([]);
  });
});

function hit(passageId: string, itemId: string) {
  return { passageId, itemId };
}

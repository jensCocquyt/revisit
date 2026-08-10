import { describe, expect, it } from "vitest";
import { requestHash } from "../src/utils/request-hash.js";

describe("requestHash", () => {
  const base = { url: "https://example.com/a", note: null, goal: null };

  it("is deterministic for identical input", () => {
    expect(requestHash({ ...base })).toBe(requestHash({ ...base }));
  });

  it("changes when any field changes", () => {
    expect(requestHash({ ...base, note: "n" })).not.toBe(requestHash(base));
    expect(requestHash({ ...base, goal: "g" })).not.toBe(requestHash(base));
    expect(requestHash({ ...base, url: "https://example.com/b" })).not.toBe(requestHash(base));
  });

  it("distinguishes note from goal carrying the same text", () => {
    expect(requestHash({ ...base, note: "x" })).not.toBe(requestHash({ ...base, goal: "x" }));
  });
});

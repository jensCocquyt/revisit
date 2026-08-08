import { describe, expect, it } from "vitest";
import { normalizeUrl, requestHash } from "../src/normalize.js";

describe("normalizeUrl", () => {
  it("lowercases scheme and host", () => {
    expect(normalizeUrl("HTTPS://Example.COM/Path")).toBe("https://example.com/Path");
  });

  it("strips default ports", () => {
    expect(normalizeUrl("https://example.com:443/a")).toBe("https://example.com/a");
    expect(normalizeUrl("http://example.com:80/a")).toBe("http://example.com/a");
  });

  it("keeps non-default ports", () => {
    expect(normalizeUrl("http://example.com:8080/a")).toBe("http://example.com:8080/a");
  });

  it("drops the fragment", () => {
    expect(normalizeUrl("https://example.com/a#section-2")).toBe("https://example.com/a");
  });

  it("preserves the query string untouched", () => {
    expect(normalizeUrl("https://example.com/a?b=2&a=1")).toBe("https://example.com/a?b=2&a=1");
  });

  it("preserves path case", () => {
    expect(normalizeUrl("https://example.com/CaseSensitive")).toBe(
      "https://example.com/CaseSensitive",
    );
  });
});

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

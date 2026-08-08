import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../src/normalize-url.js";

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

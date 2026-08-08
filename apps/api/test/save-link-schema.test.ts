import { describe, expect, it } from "vitest";
import {
  GOAL_MAX,
  IDEMPOTENCY_KEY_MAX,
  NOTE_MAX,
  URL_MAX,
  idempotencyKeyHeaderSchema,
  saveLinkBodySchema,
} from "../src/routes/save-link.js";

const validUrl = "https://example.com/article";

describe("saveLinkBodySchema", () => {
  it("accepts a minimal valid body", () => {
    expect(saveLinkBodySchema.safeParse({ url: validUrl }).success).toBe(true);
  });

  it("accepts note and goal at their length limits", () => {
    const body = { url: validUrl, note: "n".repeat(NOTE_MAX), goal: "g".repeat(GOAL_MAX) };
    expect(saveLinkBodySchema.safeParse(body).success).toBe(true);
  });

  it("accepts a url at the length limit", () => {
    const url = `https://example.com/${"a".repeat(URL_MAX - "https://example.com/".length)}`;
    expect(url).toHaveLength(URL_MAX);
    expect(saveLinkBodySchema.safeParse({ url }).success).toBe(true);
  });

  it("rejects a missing url", () => {
    expect(saveLinkBodySchema.safeParse({}).success).toBe(false);
  });

  it("rejects non-http(s) and relative urls", () => {
    for (const url of ["ftp://example.com", "not a url", "/relative/path", "javascript:alert(1)"]) {
      expect(saveLinkBodySchema.safeParse({ url }).success).toBe(false);
    }
  });

  it("rejects fields over their length limits", () => {
    const overUrl = `https://example.com/${"a".repeat(URL_MAX)}`;
    expect(saveLinkBodySchema.safeParse({ url: overUrl }).success).toBe(false);
    expect(
      saveLinkBodySchema.safeParse({ url: validUrl, note: "n".repeat(NOTE_MAX + 1) }).success,
    ).toBe(false);
    expect(
      saveLinkBodySchema.safeParse({ url: validUrl, goal: "g".repeat(GOAL_MAX + 1) }).success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(saveLinkBodySchema.safeParse({ url: validUrl, extra: "field" }).success).toBe(false);
  });
});

describe("idempotencyKeyHeaderSchema", () => {
  it("accepts a key at the length limit", () => {
    const headers = { "Idempotency-Key": "k".repeat(IDEMPOTENCY_KEY_MAX) };
    expect(idempotencyKeyHeaderSchema.safeParse(headers).success).toBe(true);
  });

  it("rejects a missing, empty, or over-limit key", () => {
    expect(idempotencyKeyHeaderSchema.safeParse({}).success).toBe(false);
    expect(idempotencyKeyHeaderSchema.safeParse({ "Idempotency-Key": "" }).success).toBe(false);
    expect(
      idempotencyKeyHeaderSchema.safeParse({
        "Idempotency-Key": "k".repeat(IDEMPOTENCY_KEY_MAX + 1),
      }).success,
    ).toBe(false);
  });
});

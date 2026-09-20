import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { fakeDb } from "./fakes.js";
import { storedEnrichment, storedLink, validResult } from "./results.js";

const link = storedLink();
const path = `/links/${link.id}/enrichment`;

function appWith(enrichment: ReturnType<typeof storedEnrichment> | null) {
  return createApp(fakeDb({ getLink: async () => link, getEnrichment: async () => enrichment }));
}

describe("GET /links/:id/enrichment", () => {
  afterEach(() => vi.restoreAllMocks());

  it("serves the latest enrichment unchanged when all evidence resolves", async () => {
    const stored = storedEnrichment();
    const res = await appWith(stored).request(path);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      link_id: link.id,
      created_at: stored.created_at,
      model_id: "stub",
      prompt_version: "stub-v2",
      result: validResult(),
    });
  });

  it("drops evidence whose quote is not in the stored text and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = validResult();
    result.evidence.push({ quote: "not on the page", start_offset: 0, end_offset: 15 });
    const res = await appWith(storedEnrichment({ result })).request(path);
    const body = await res.json();
    expect(body.result.evidence).toEqual(validResult().evidence);
    expect(body.result.deadline).toEqual(validResult().deadline);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      msg: "unresolvable evidence dropped",
      evidence_dropped: 1,
      deadline_dropped: false,
    });
  });

  it("drops the deadline when its source quote does not resolve", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = validResult();
    if (result.deadline) result.deadline.source.quote = "a sentence the page never says";
    const body = await (await appWith(storedEnrichment({ result })).request(path)).json();
    expect(body.result.deadline).toBeNull();
    expect(body.result.tags).toEqual(["python", "eol"]);
    expect(body.result.evidence).toHaveLength(2);
  });

  it("drops all evidence when the enrichment references no content version", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = await (
      await appWith(storedEnrichment({ extracted_text: null })).request(path)
    ).json();
    expect(body.result.evidence).toEqual([]);
    expect(body.result.deadline).toBeNull();
  });

  it("serves a null deadline explicitly when the result has none", async () => {
    const body = await (
      await appWith(storedEnrichment({ result: validResult({ deadline: undefined }) })).request(
        path,
      )
    ).json();
    expect(body.result.deadline).toBeNull();
  });

  it("reports a stored result that violates the contract as 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { tags: _tags, ...withoutTags } = validResult();
    const res = await appWith(storedEnrichment({ result: withoutTags })).request(path);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "enrichment_invalid" });
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      msg: "stored enrichment invalid",
      link_id: link.id,
    });
  });

  it("returns 404 enrichment_not_found for a link without an enrichment", async () => {
    const res = await appWith(null).request(path);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "enrichment_not_found" });
  });

  it("returns 404 link_not_found for an unknown link", async () => {
    const res = await createApp(fakeDb()).request(path);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "link_not_found" });
  });

  it("returns 400 for a malformed id", async () => {
    const res = await createApp(fakeDb()).request("/links/not-a-uuid/enrichment");
    expect(res.status).toBe(400);
  });
});

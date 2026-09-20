import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { fakeDb } from "./fakes.js";
import { storedLink, validResult } from "./results.js";

async function fetchLink(latest_result: unknown) {
  const link = storedLink({ latest_result });
  const app = createApp(fakeDb({ getLink: async () => link }));
  return (await app.request(`/links/${link.id}`)).json();
}

describe("GET /links/:id facets", () => {
  afterEach(() => vi.restoreAllMocks());

  it("carries the tags and deadline date of a valid latest result", async () => {
    const body = await fetchLink(validResult());
    expect(body.tags).toEqual(["python", "eol"]);
    expect(body.deadline).toBe("2025-10-31");
  });

  it("carries a null deadline when the result has none", async () => {
    const body = await fetchLink(validResult({ deadline: null }));
    expect(body.deadline).toBeNull();
  });

  it("is empty without an enrichment", async () => {
    const body = await fetchLink(null);
    expect(body).toMatchObject({ tags: [], deadline: null });
  });

  it("degrades to empty facets and a log line for an invalid stored result", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = await fetchLink({ contract_version: "v1", summary: "old shape" });
    expect(body).toMatchObject({ status: "enriched", tags: [], deadline: null });
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ msg: "stored enrichment invalid" });
  });
});

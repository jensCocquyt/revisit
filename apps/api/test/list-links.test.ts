import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { ListLinksInput } from "../src/db/index.js";
import { fakeDb } from "./fakes.js";
import { storedLink } from "./results.js";

function capturingApp(page = { items: [storedLink()], hasMore: false }) {
  let received: ListLinksInput | undefined;
  const app = createApp(
    fakeDb({
      listLinks: async (input) => {
        received = input;
        return page;
      },
    }),
  );
  return { app, received: () => received };
}

describe("GET /links query handling", () => {
  it("applies defaults and passes filters through normalized", async () => {
    const { app, received } = capturingApp();
    const res = await app.request("/links?status=enriched&tag=%20Python%20");
    expect(res.status).toBe(200);
    expect(received()).toEqual({
      status: "enriched",
      tag: "python",
      limit: 20,
      afterId: undefined,
    });
  });

  it("passes limit and cursor through", async () => {
    const { app, received } = capturingApp();
    const cursor = "0d9f6a1c-3b6e-4c2d-9f6a-1c3b6e4c2d9f";
    await app.request(`/links?limit=5&cursor=${cursor}`);
    expect(received()).toMatchObject({ limit: 5, afterId: cursor });
  });

  it("returns the last item's id as next_cursor only when more rows follow", async () => {
    const first = storedLink({ id: "11111111-1111-4111-8111-111111111111" });
    const second = storedLink({ id: "22222222-2222-4222-8222-222222222222" });
    const more = capturingApp({ items: [first, second], hasMore: true });
    expect(await (await more.app.request("/links")).json()).toMatchObject({
      next_cursor: second.id,
    });

    const last = capturingApp({ items: [first, second], hasMore: false });
    expect(await (await last.app.request("/links")).json()).toMatchObject({ next_cursor: null });
  });

  it("returns an empty page for an empty library", async () => {
    const { app } = capturingApp({ items: [], hasMore: false });
    expect(await (await app.request("/links")).json()).toEqual({ items: [], next_cursor: null });
  });

  it.each([
    ["limit=0", "/links?limit=0"],
    ["limit=101", "/links?limit=101"],
    ["limit=abc", "/links?limit=abc"],
    ["unknown status", "/links?status=done"],
    ["empty tag", "/links?tag="],
    ["blank tag", "/links?tag=%20%20"],
    ["over-long tag", `/links?tag=${"t".repeat(51)}`],
    ["malformed cursor", "/links?cursor=not-a-cursor"],
  ])("rejects %s with 400", async (_label, url) => {
    const { app } = capturingApp();
    const res = await app.request(url);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
  });
});

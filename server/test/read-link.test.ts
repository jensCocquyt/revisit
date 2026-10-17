import { describe, expect, it } from "vitest";
import type { FetchPage } from "../src/links/fetch-page.js";
import { readLink } from "../src/links/read-link.js";

describe("readLink", () => {
  it("keeps the article text in paragraphs and drops scripts and navigation", async () => {
    const paragraph = "Leeks are sweeter after the first frost, so winter soup tastes better. ";
    const html = `<html><head><title>Leek soup | Kitchen Blog</title><script>var tracking = 1;</script></head>
      <body><nav><a href="/">Home</a><a href="/about">About</a></nav>
      <article><h1>Leek soup</h1><p>${paragraph.repeat(4)}</p><p>Serve with bread.${paragraph.repeat(3)}</p></article>
      <footer>Copyright</footer></body></html>`;
    const content = await readLink("https://example.org/soup", pageWith(html));

    expect(content.error).toBeNull();
    expect(content.title).toMatch(/Leek soup/);
    expect(content.body).toContain("Leeks are sweeter");
    expect(content.body).toMatch(/\n\s*Serve with bread/);
    expect(content.body).not.toContain("tracking");
  });

  it("falls back to the visible page text when there is no article", async () => {
    const content = await readLink(
      "https://example.org/short",
      pageWith(
        "<html><head><title>Opening hours</title></head><body><p>Mon to Fri 9-17</p></body></html>",
      ),
    );
    expect(content).toEqual({ title: "Opening hours", body: "Mon to Fri 9-17", error: null });
  });

  it("decodes the charset the page declares", async () => {
    const html = Buffer.from(
      '<html><head><meta charset="iso-8859-1"><title>Caf\xe9</title></head><body><p>cr\xe8me br\xfbl\xe9e</p></body></html>',
      "latin1",
    );
    const fetch: FetchPage = async (url) => ({ url, contentType: "text/html", body: html });
    const content = await readLink("https://example.org/fr", fetch);
    expect(content.body).toBe("crème brûlée");
    expect(content.title).toBe("Café");
  });

  it("reads plain text pages as they are", async () => {
    const fetch: FetchPage = async (url) => ({
      url,
      contentType: "text/plain; charset=utf-8",
      body: Buffer.from("Line one\nLine two"),
    });
    expect(await readLink("https://example.org/notes.txt", fetch)).toEqual({
      title: null,
      body: "Line one\nLine two",
      error: null,
    });
  });

  it("reports why a page could not be read instead of failing", async () => {
    const fetch: FetchPage = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND nowhere.example"), {
        code: "ENOTFOUND",
      });
    };
    expect(await readLink("https://nowhere.example", fetch)).toEqual({
      title: null,
      body: null,
      error: "the site could not be found",
    });
  });

  it("reports a page without text", async () => {
    const content = await readLink(
      "https://example.org/empty",
      pageWith("<html><head><title>Empty</title></head><body><script>1</script></body></html>"),
    );
    expect(content).toEqual({ title: "Empty", body: null, error: "the page has no readable text" });
  });
});

function pageWith(html: string): FetchPage {
  return async (url) => ({ url, contentType: "text/html; charset=utf-8", body: Buffer.from(html) });
}

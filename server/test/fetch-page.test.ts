import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchPage } from "../src/links/fetch-page.js";

let server: http.Server;
let port = 0;
const allowAll = { isBlocked: () => false };

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const path = request.url ?? "/";
    if (path === "/article") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<p>hello</p>");
    } else if (path === "/compressed") {
      response.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      response.end(gzipSync("<p>squeezed</p>"));
    } else if (path === "/moved") {
      response.writeHead(302, { location: "/article" });
      response.end();
    } else if (path === "/loop") {
      response.writeHead(302, { location: "/loop" });
      response.end();
    } else if (path === "/to-loopback-v6") {
      response.writeHead(302, { location: `http://[::1]:${port}/article` });
      response.end();
    } else if (path === "/image") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end("png");
    } else if (path === "/large") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("x".repeat(2048));
    } else if (path === "/slow") {
      setTimeout(() => response.end(), 2000);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("fetchPage address guard", () => {
  it.each([
    ["a loopback address", () => `http://127.0.0.1:${port}/article`],
    ["a hex loopback address", () => `http://0x7f.0.0.1:${port}/article`],
    ["a decimal loopback address", () => `http://2130706433:${port}/article`],
    ["an IPv4-mapped IPv6 address", () => `http://[::ffff:127.0.0.1]:${port}/article`],
    ["a name that resolves to loopback", () => `http://localhost:${port}/article`],
  ])("refuses %s", async (_, url) => {
    await expect(fetchPage(url())).rejects.toThrow(/not allowed/);
  });

  it("checks every redirect hop", async () => {
    const isBlocked = (address: string) => address === "::1";
    await expect(
      fetchPage(`http://127.0.0.1:${port}/to-loopback-v6`, { isBlocked }),
    ).rejects.toThrow(/::1 is not allowed/);
  });

  it("refuses schemes other than http and https", async () => {
    await expect(fetchPage("file:///etc/passwd")).rejects.toThrow(/unsupported/);
  });
});

describe("fetchPage", () => {
  it("follows redirects and returns the final address", async () => {
    const page = await fetchPage(`http://127.0.0.1:${port}/moved`, allowAll);
    expect(page.url).toBe(`http://127.0.0.1:${port}/article`);
    expect(page.body.toString()).toBe("<p>hello</p>");
    expect(page.contentType).toMatch(/text\/html/);
  });

  it("decompresses gzip", async () => {
    const page = await fetchPage(`http://127.0.0.1:${port}/compressed`, allowAll);
    expect(page.body.toString()).toBe("<p>squeezed</p>");
  });

  it("gives up on a redirect loop", async () => {
    await expect(fetchPage(`http://127.0.0.1:${port}/loop`, allowAll)).rejects.toThrow(
      /too many redirects/,
    );
  });

  it("refuses error statuses, non-pages, oversized pages and slow sites", async () => {
    await expect(fetchPage(`http://127.0.0.1:${port}/missing`, allowAll)).rejects.toThrow(/404/);
    await expect(fetchPage(`http://127.0.0.1:${port}/image`, allowAll)).rejects.toThrow(
      /not a web page/,
    );
    await expect(
      fetchPage(`http://127.0.0.1:${port}/large`, { ...allowAll, maxBytes: 1024 }),
    ).rejects.toThrow(/larger than/);
    await expect(
      fetchPage(`http://127.0.0.1:${port}/slow`, { ...allowAll, timeoutMs: 100 }),
    ).rejects.toThrow();
  });
});

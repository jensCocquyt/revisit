import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { type Duplex, pipeline, type Readable } from "node:stream";
import zlib from "node:zlib";
import { isBlockedAddress } from "./blocked-addresses.js";

export type FetchedPage = { url: string; contentType: string; body: Buffer };

export type FetchPage = (url: string) => Promise<FetchedPage>;

export type FetchOptions = {
  isBlocked?: (address: string) => boolean;
  timeoutMs?: number;
  maxBytes?: number;
};

export class UnreadablePageError extends Error {}

// Addresses are checked when connecting, so redirects and DNS rebinding pass the same guard.
export async function fetchPage(url: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const isBlocked = options.isBlocked ?? isBlockedAddress;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  let current = new URL(url);
  for (let redirects = 0; ; redirects++) {
    assertFetchable(current, isBlocked);
    const response = await get(current, isBlocked, signal);
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (redirectStatuses.has(status) && location) {
      response.resume();
      if (redirects >= maxRedirects) throw new UnreadablePageError("too many redirects");
      current = new URL(location, current);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw new UnreadablePageError(`the site answered ${status}`);
    }
    const contentType = response.headers["content-type"] ?? "";
    if (!readableContentType.test(contentType)) {
      response.resume();
      throw new UnreadablePageError(`not a web page (${contentType || "no content type"})`);
    }
    const body = await readAtMost(decompressed(response), maxBytes);
    return { url: current.toString(), contentType, body };
  }
}

const maxRedirects = 5;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const readableContentType = /^\s*(text\/html|application\/xhtml\+xml|text\/plain)\b/i;

function assertFetchable(url: URL, isBlocked: (address: string) => boolean): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnreadablePageError(`unsupported address scheme ${url.protocol}`);
  }
  // Literal IP hosts never reach the lookup, so they are checked here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isBlocked(host)) {
    throw new UnreadablePageError(`address ${host} is not allowed`);
  }
}

function get(
  url: URL,
  isBlocked: (address: string) => boolean,
  signal: AbortSignal,
): Promise<http.IncomingMessage> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(
      url,
      { signal, lookup: guardedLookup(isBlocked), headers: requestHeaders },
      resolve,
    );
    request.on("error", reject);
  });
}

const requestHeaders = {
  "user-agent": "Mozilla/5.0 (compatible; Revisit/1.0)",
  accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8",
  "accept-encoding": "gzip, deflate, br",
};

function guardedLookup(isBlocked: (address: string) => boolean): net.LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, "", 0);
      const blocked = addresses.find((entry) => isBlocked(entry.address));
      if (blocked) {
        return callback(
          new UnreadablePageError(`address ${blocked.address} is not allowed`),
          "",
          0,
        );
      }
      if (options.all) return callback(null, addresses);
      const [first] = addresses;
      if (!first) return callback(new UnreadablePageError(`${hostname} has no address`), "", 0);
      callback(null, first.address, first.family);
    });
  };
}

function decompressed(response: http.IncomingMessage): Readable {
  const decoder = decoders[response.headers["content-encoding"] ?? ""];
  return decoder ? pipeline(response, decoder(), () => {}) : response;
}

const decoders: Record<string, () => Duplex> = {
  gzip: () => zlib.createGunzip(),
  deflate: () => zlib.createInflate(),
  br: () => zlib.createBrotliDecompress(),
};

async function readAtMost(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxBytes) {
      stream.destroy();
      throw new UnreadablePageError(`the page is larger than ${maxBytes / 1024 / 1024} MB`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

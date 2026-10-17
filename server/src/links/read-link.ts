import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import type { ReadContent } from "../db/items.js";
import { describeError } from "../log.js";
import { type FetchedPage, type FetchPage, fetchPage } from "./fetch-page.js";

export type ReadLink = (url: string) => Promise<ReadContent>;

// A page that cannot be fetched or has no text is not a failure: the item stays findable by URL.
export async function readLink(url: string, fetch: FetchPage = fetchPage): Promise<ReadContent> {
  let page: FetchedPage;
  try {
    page = await fetch(url);
  } catch (error) {
    return { title: null, body: null, error: describeFetchError(error) };
  }
  if (/^\s*text\/plain/i.test(page.contentType)) {
    const text = normalizeText(page.body.toString("utf8"));
    return text
      ? { title: null, body: text, error: null }
      : { title: null, body: null, error: noTextError };
  }
  const document = new JSDOM(page.body, {
    url: page.url,
    contentType: page.contentType,
    virtualConsole: new VirtualConsole(),
  }).window.document;
  const pageTitle = document.title.trim() || null;
  const article = new Readability(document.cloneNode(true) as Document).parse();
  const articleText = article?.content ? visibleText(JSDOM.fragment(article.content)) : "";
  const text = articleText || (document.body ? visibleText(document.body) : "");
  const title = article?.title?.trim() || pageTitle;
  return text ? { title, body: text, error: null } : { title, body: null, error: noTextError };
}

const noTextError = "the page has no readable text";

const hiddenElements = "script, style, noscript, template, svg";
const blockElements =
  "address, article, aside, blockquote, br, dd, div, dl, dt, figcaption, figure, footer, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, tr, ul";

function visibleText(root: ParentNode): string {
  for (const element of root.querySelectorAll(hiddenElements)) element.remove();
  for (const element of root.querySelectorAll(blockElements)) element.after("\n");
  return normalizeText(root.textContent ?? "");
}

function normalizeText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "the page took too long";
  const code = (error as { code?: string }).code;
  if (code === "ENOTFOUND") return "the site could not be found";
  if (code === "ECONNREFUSED") return "the site refused the connection";
  return describeError(error);
}

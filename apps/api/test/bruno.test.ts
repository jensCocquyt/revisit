import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { fakeDb } from "./fakes.js";

// The Bruno collection at <repo>/bruno is the manual testing surface for the
// API. This test keeps it honest: every documented route must have a request
// in the collection and every request must target a documented route, so
// endpoint drift in either direction fails CI.

const brunoDir = fileURLToPath(new URL("../../../bruno", import.meta.url));
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

// A route shaped for comparison: path parameters become "*" so Bruno's
// {{linkId}} matches OpenAPI's {id} without coupling variable names.
function routeShape(method: string, path: string): string {
  const shaped = path
    .split("/")
    .map((segment) => (/^(\{\{.+\}\}|\{.+\})$/.test(segment) ? "*" : segment))
    .join("/");
  return `${method.toUpperCase()} ${shaped}`;
}

function brunoRoutes(): Map<string, string> {
  const routes = new Map<string, string>();
  const files = readdirSync(brunoDir).filter((f) => f.endsWith(".bru"));
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    const content = readFileSync(join(brunoDir, file), "utf8");
    const block = content.match(
      new RegExp(`^(${HTTP_METHODS.join("|")})\\s*\\{([\\s\\S]*?)^\\}`, "m"),
    );
    expect(block, `${file} must contain an HTTP method block`).toBeTruthy();
    if (!block) continue;

    const url = block[2].match(/url:\s*(\S+)/);
    expect(url, `${file} must declare a url`).toBeTruthy();
    if (!url) continue;

    expect(url[1], `${file} must use {{baseUrl}}`).toMatch(/^\{\{baseUrl\}\}/);
    const path = url[1].replace("{{baseUrl}}", "").split("?")[0] || "/";
    routes.set(routeShape(block[1], path), file);
  }
  return routes;
}

async function openApiRoutes(): Promise<Set<string>> {
  const app = createApp(fakeDb());
  const doc = await (await app.request("/openapi.json")).json();
  const routes = new Set<string>();
  for (const [path, operations] of Object.entries<Record<string, unknown>>(doc.paths)) {
    for (const method of Object.keys(operations)) {
      if ((HTTP_METHODS as readonly string[]).includes(method)) {
        routes.add(routeShape(method, path));
      }
    }
  }
  return routes;
}

describe("Bruno collection stays in sync with the API", () => {
  it("covers every documented route and contains no stale requests", async () => {
    const collection = brunoRoutes();
    const documented = await openApiRoutes();

    const missing = [...documented].filter((route) => !collection.has(route));
    const stale = [...collection.keys()].filter((route) => !documented.has(route));

    expect(
      missing,
      `API routes missing from the Bruno collection (add a .bru file under bruno/): ${missing.join(", ")}`,
    ).toEqual([]);
    expect(
      stale,
      `Bruno requests targeting routes the API does not serve (${stale
        .map((route) => collection.get(route))
        .join(", ")}): ${stale.join(", ")}`,
    ).toEqual([]);
  });
});

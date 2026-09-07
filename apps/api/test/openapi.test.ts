import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { fakeDb } from "./fakes.js";

describe("OpenAPI documentation", () => {
  const app = createApp(fakeDb());

  it("documents all endpoints with their methods", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const doc = await res.json();

    expect(Object.keys(doc.paths).sort()).toEqual(["/health", "/links", "/links/{id}"]);
    expect(doc.paths["/links"].post).toBeDefined();
    expect(doc.paths["/links/{id}"].get).toBeDefined();
    expect(doc.paths["/health"].get).toBeDefined();
  });

  it("documents the Idempotency-Key header and error responses on POST /links", async () => {
    const doc = await (await app.request("/openapi.json")).json();
    const operation = doc.paths["/links"].post;

    const headerParams = (operation.parameters ?? []).filter(
      (p: { in: string }) => p.in === "header",
    );
    expect(headerParams.map((p: { name: string }) => p.name)).toContain("Idempotency-Key");
    expect(headerParams[0].required).toBe(true);

    expect(Object.keys(operation.responses).sort()).toEqual([
      "200",
      "201",
      "400",
      "401",
      "409",
      "500",
    ]);
  });

  it("declares the ApiKey security scheme on link routes", async () => {
    const doc = await (await app.request("/openapi.json")).json();

    expect(doc.components.securitySchemes.ApiKey).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "x-api-key",
    });
    expect(doc.paths["/links"].post.security).toEqual([{ ApiKey: [] }]);
    expect(doc.paths["/links/{id}"].get.security).toEqual([{ ApiKey: [] }]);
    expect(doc.paths["/health"].get.security).toBeUndefined();
  });

  it("serves Swagger UI at /docs", async () => {
    const res = await app.request("/docs");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("swagger-ui");
  });
});

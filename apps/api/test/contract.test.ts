// The enrichment contract is deliberately defined twice: as a Zod schema here
// and as pydantic models in the worker (apps/worker/worker/contract.py).
// Nothing ties the two definitions together at compile time, so these fixtures
// are the contract: both test suites glob the same directory and assert the
// verdict encoded in the filename (valid-* accepted, invalid-* rejected).
// If the definitions ever disagree on a rule a fixture exercises, one side's
// suite fails. When changing a constraint, change both definitions and add
// the boundary fixtures in the same commit.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateEnrichmentResult } from "../src/contract.js";

const fixturesDir = fileURLToPath(
  new URL("../../../contracts/enrichment/fixtures", import.meta.url),
);

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf-8"));
}

const fixtureNames = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
const validFixtures = fixtureNames.filter((f) => f.startsWith("valid-"));
const invalidFixtures = fixtureNames.filter((f) => f.startsWith("invalid-"));

describe("enrichment contract validation", () => {
  it("has both valid and invalid shared fixtures", () => {
    expect(validFixtures.length).toBeGreaterThan(0);
    expect(invalidFixtures.length).toBeGreaterThan(0);
  });

  for (const name of validFixtures) {
    it(`accepts ${name}`, () => {
      const result = validateEnrichmentResult(loadFixture(name));
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }

  for (const name of invalidFixtures) {
    it(`rejects ${name}`, () => {
      const result = validateEnrichmentResult(loadFixture(name));
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  }
});

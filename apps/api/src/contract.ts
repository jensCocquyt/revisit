import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import addFormatsExport from "ajv-formats";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

// ajv-formats ships CJS; under NodeNext the callable plugin lives on `.default`.
const addFormats = addFormatsExport.default;

// Repo layout is preserved in the container image, so the schema resolves
// the same way from src (tsx) and dist (compiled) builds.
const schemaPath = fileURLToPath(
  new URL("../../../contracts/enrichment/v1.schema.json", import.meta.url),
);

export interface ContractValidation {
  valid: boolean;
  errors: string[];
}

let validate: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!validate) {
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    validate = ajv.compile(schema);
  }
  return validate;
}

/** Validate an enrichment result against the shared v1 contract. */
export function validateEnrichmentResult(result: unknown): ContractValidation {
  const validator = getValidator();
  const valid = validator(result) === true;
  const errors = (validator.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
  );
  return { valid, errors: valid ? [] : errors };
}

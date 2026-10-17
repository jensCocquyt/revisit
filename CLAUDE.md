# CLAUDE.md

Revisit: save links, text and screenshots, then find them again by meaning or exact text. `README.md` holds the idea, the roadmap and how to run it; `tasks/todo.md` holds the current step's plan and decisions.

## Shape

- `server/`: Hono on Node 24, plain SQL through `pg`, migrations in `server/migrations` applied at startup. One process saves items, runs the background processing loop, and serves the built web app.
- `web/`: React + Vite. It imports types from `server/src/contract.ts`, so that file stays free of imports.
- No root package: run every command from `server/` or `web/`. Biome config is shared at the root.
- Bedrock calls (embeddings, later screenshot reading) are passed into the code as functions; tests use deterministic fakes, only the eval calls Bedrock.

## Flow

- Each step starts with a short plan in `tasks/todo.md`: goal, out of scope, checklist. Agree the plan before building. The next step's plan replaces it; git keeps the history.
- One PR per step, or per slice when the plan splits a step. `main` is protected, so everything goes through a PR.
- Every non-draft PR push is reviewed by `.github/workflows/claude-review.yml` (inline `blocking` / `should` / `nit` comments). `/address-review` works through the threads.
- Corrections from review go in `tasks/lessons.md`; the reviewer enforces them.
- A change to search or processing reruns the eval; it must stay at or above its bar.

Build only what the current step needs.

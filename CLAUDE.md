# CLAUDE.md

Revisit: save links, text and screenshots, then find them again by meaning or exact text. `README.md` holds the idea and roadmap.

Restarted 2026-10-16. Nothing is built yet and the stack is not chosen.

## Flow

- Each step starts with a short plan in `tasks/todo.md`: goal, out of scope, checklist. Agree the plan before building. The next step's plan replaces it; git keeps the history.
- One PR per step, or per slice when the plan splits a step. `main` is protected, so everything goes through a PR.
- Every non-draft PR push is reviewed by `.github/workflows/claude-review.yml` (inline `blocking` / `should` / `nit` comments). `/address-review` works through the threads.
- Corrections from review go in `tasks/lessons.md`; the reviewer enforces them.

Build only what the current step needs.

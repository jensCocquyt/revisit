---
name: "Address Review"
description: Fetch unresolved PR review comments, fix or answer each one, push, and reply in-thread
category: Workflow
tags: [workflow, review, github]
---

Work through every unresolved review comment on a pull request: fix what should be fixed, push back where the comment is wrong, ask when it is ambiguous — then push once and reply in each thread.

**Input**: Optionally a PR number after `/address-review` (e.g. `/address-review 7`). If omitted, resolve it from the current branch:

```bash
gh pr view --json number,headRefName,url
```

If there is no PR for the current branch, say so and STOP.

**Steps**

1. **Fetch unresolved review threads** (GraphQL — REST does not expose resolved state):

   ```bash
   gh api graphql -f query='
     query($owner: String!, $repo: String!, $pr: Int!) {
       repository(owner: $owner, name: $repo) {
         pullRequest(number: $pr) {
           reviewThreads(first: 100) {
             nodes {
               id
               isResolved
               isOutdated
               path
               line
               comments(first: 50) {
                 nodes { databaseId author { login } body }
               }
             }
           }
         }
       }
     }' -F owner=<owner> -F repo=<repo> -F pr=<number>
   ```

   Keep only threads with `isResolved: false`. Also fetch PR-level conversation comments (`gh pr view <number> --json comments,reviews`) and treat unanswered questions there as threads to answer (reply with `gh pr comment`).

   If there are no unresolved threads, report that and STOP.

2. **Make sure the working tree matches the PR branch**

   Check out the PR's head branch and pull. If the local tree is dirty with unrelated changes, STOP and ask the user.

3. **Triage every thread before editing anything**

   For each unresolved thread classify it as one of:
   - **fix** — the comment is right; code (or spec/fixture/doc) should change.
   - **won't fix** — the comment is wrong or out of scope for this change; needs a reasoned reply, no code change. Check scope against `openspec/changes/<id>/proposal.md` (out-of-scope section) before deciding.
   - **question back** — genuinely ambiguous; needs a clarifying question, no code change yet.

   Present the triage as a short table (path:line, one-line summary, verdict) before implementing.

4. **Implement the fixes**

   Apply project rules while fixing:
   - Contract changes touch both `apps/api/src/contract.ts` and `worker/contract.py` plus boundary fixtures in `contracts/enrichment/fixtures/` in the same commit.
   - Run focused tests for what changed first, then the affected suite (`npm test` in `apps/api`, `uv run pytest` in `apps/worker`).
   - Run the relevant formatter (`npm run format` / `uv run ruff format .`).

5. **Commit and push once**

   One commit (or a few logical ones) covering all fixes, then a single push — each push triggers one re-review run of the Claude review workflow, so do not push per-fix.

6. **Reply in every thread** — after the push, so replies can reference the commit SHA.

   Reply to a review thread via REST, using the `databaseId` of the thread's first comment:

   ```bash
   gh api repos/<owner>/<repo>/pulls/<number>/comments/<comment_databaseId>/replies -f body='...'
   ```

   Reply rules:
   - Replies post under the user's GitHub account, so open every reply with `**[Claude]**` so authorship is clear.
   - State the verdict explicitly: what was changed (with the commit SHA), or why it won't be fixed, or the clarifying question.
   - **Never resolve threads.** The human resolves them; self-resolving hides disagreements.

7. **Report**

   Summarize: N threads addressed (X fixed, Y answered/pushed back, Z questions), the pushed commit(s), and a reminder that the push has re-triggered the automatic review workflow — check the PR again once it finishes.

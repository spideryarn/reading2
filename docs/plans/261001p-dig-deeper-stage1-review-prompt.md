# Code review, stage 1 of 261001p — *Dig deeper* on Glossary and comments

You are reviewing AND fixing, in this worktree (branch `worktree-go-deeper`). The candidate is commit
`2c7a61a8e` (stage 1), on top of the plan commits `575821fa9` and `fa7673516`. See exactly what
changed with `git show --stat 2c7a61a8e` and `git show 2c7a61a8e -- <path>`. Start with
`src/dig-deeper.ts`, `src/explain.ts`, `src/term-lookup.ts`, `src/routes.ts` (`answer()` and the
glossary lookup route), `src/web/GlossaryPanel.tsx`, `src/web/CommentDialog.tsx`, the migration
`drizzle/20261001171813_dig_deeper_bucket.sql`, and the new tests `tests/dig-deeper*.test.ts`,
`tests/glossary-dig-deeper-button.test.tsx`. That list does not limit scope.

The plan is `docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md` (stage 1, §
How the search is forced, § What the sources list means, § The cost line, § Library search) and your
own plan review is `docs/plans/261001p-dig-deeper-plan-review-sol.md` — check whether F1, F2, F4
(as overruled and reworded in the plan), F5, F7, F8, F9 and F10 are actually satisfied by the code,
not only described.

## Your brief

- **Fix what is inside this stage**, narrowly and red-first: write or tighten a test that fails, then
  fix. Do not commit; leave your changes in the working tree and list them.
- **Report, do not fix, anything wider** (other modes, Citations — that is stage 2 — or design
  changes beyond this stage).
- You cannot reach Postgres or the network. Unit tests run: e.g.
  `npx vitest run tests/dig-deeper.test.ts tests/explain.test.ts tests/explain-request-snapshot.test.ts tests/glossary-dig-deeper-button.test.tsx tests/glossary-lookup-label.test.tsx tests/comment-dialog-search-the-web.test.tsx`
  and `npm run typecheck`. The Postgres suites (`tests/dig-deeper-comment.test.ts`,
  `tests/dig-deeper-glossary.test.ts`, `tests/term-lookup.test.ts`,
  `tests/glossary-lookup-stream-route.test.ts`, `tests/glossary-stream-lifetime.test.ts`) were run by
  me and passed; if you change code they cover, say so and I will re-run them.

## Attack in particular

1. Is the search **really forced** on every Dig deeper path, and can any path produce a dug answer
   labelled *from a web search* without one (a failed search, an abort, a retry)?
2. Allowance: taken after free refusals and before any mutation, SSE or model call; freed exactly
   once on every path (success, refusal, search failure, abort, thrown claim, client disconnect);
   comment *first* answers outside it. Is the lease long enough?
3. Model: is every dug answer on `DIG_DEEPER_MODEL` whatever env overrides are set; does the stored
   `model` field say so; does high-power freshness (`generationKey`) misbehave?
4. Cache: are `SYSTEM`, the tool and the article part byte-identical to a plain explain (the
   snapshot), and is everything per-press after the breakpoint?
5. Untrusted text: web titles/URLs/excerpts and library passages fenced; injection in a title.
6. Glossary UI: "Dig deeper again" replaces on success and keeps the old answer on failure; busy
   states; a visitor never sees the button; the refusal sentences reach the reader.
7. Copy: plain, true, consistent (`src/messages.ts` DIG_DEEPER_*; the tooltips; *found* vs *cited*).

## My own suspicions (worth less; spend most of the run elsewhere)

- `DIG_DEEPER_LIMITED` / `_RESTING` say "the answer you already have is still there", which is false
  for a glossary term that has no answer yet.
- The comment path searches before `beginAnswer` claims the row; could two presses race?
- The library query is whatever the quick model's first line is; a junk line could make a
  `websearch_to_tsquery` that errors — is that caught and non-fatal?

## Format

Verdict line first (land / land after fixes / do not land). Findings with stable IDs continuing
from the plan review (start at F11), severity P0 data loss / exploitable security / incorrect
charging / service broadly unusable; P1 user-visible wrong behaviour or an authoritative contract
violated; P2 design risk; P3 prose. For each: file:line, evidence, and whether you FIXED it (name
the test you made red first) or are REPORTING it. End with the list of files you changed.

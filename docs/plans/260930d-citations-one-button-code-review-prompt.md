# Code review: one Citations button (260930d) — review AND fix

Reviewer-fixer in this worktree. Under review: commit 6a0930f2 (`git show 6a0930f2`). Spec: docs/plans/260930d-citations-one-button-look-it-up-and-investigate-merged.md — its § Review log (your plan review P-1…P-8, adopted) overrides the body. Background: docs/plans/260930a-citations-investigate-one-work-on-demand.md.

Fix what is inside this change, narrowly and red-first; report anything wider without fixing. Don't commit. You have no network/loopback: Postgres-backed tests are mine — their output on 6a0930f2 is docs/plans/260930d-pg-tests.log (citation-investigate-route, citation-find-route, public-dto, store-export-covers-tables, authenticated-api-route-contract: 437 passed). You can run unit files: tests/citation-investigate.test.ts, tests/citation-investigation-view.test.ts, tests/citations-investigate-client.test.tsx, tests/citations-panel.test.tsx, tests/citations-find-late-reply.test.tsx, tests/investigate-quote-guard.test.ts.

Look hardest at:
1. The skip condition (only a current `assessed` lookup) and the re-read after step 1: can the reading be built from stale state, or from a find that no longer matches the attached lookup?
2. Step-1 failure classification (`LookupCallFailed`, undici `TypeError("fetch failed"/"terminated")`): does a provider failure ever fall through to the second paid call? Does a store failure or a bug ever get swallowed as a "quick check failed"? Is the allowance lease freed exactly once on every path, including a throw before the reading starts and a client that never iterates?
3. The `lookup` frame on the client: applied exactly as /find's answer was (safe link fields, then re-read) — can it ever draw a verdict judged against an older claim, or make a linked row's link change?
4. Partial success copy and the provenance "first check matched … did not include it" branch: true in every state? Is the "earlier investigation still shown" line only shown when one really attaches after the re-read?
5. `makeFindCitation` refactor: /find's behaviour unchanged (the allowance now freed after save — is that right?).
6. The ControlTip copy: true on touch and mouse, plain words, no promise the code doesn't keep.

Severity P0..P3; IDs C-1…; file:line; problem; what you changed or "reported, not fixed"; the red→green test. Verdict: approve / approve with the fixes made / changes needed.

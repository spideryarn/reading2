# Review requested: the umbrella plan for the public read-only feature

**Date:** 2026-09-02. **Asked of:** GPT Sol, via `scripts/run-codex.ts`. **Mode:** read-only. Do not
edit files. Do not run git commands that change state.

Earlier today you answered
[260902j-public-read-only-access-audit-input-prompt.md](260902j-public-read-only-access-audit-input-prompt.md);
your answer is in [-input-sol.md](260902j-public-read-only-access-audit-input-sol.md). Greg then
made four decisions, two of them against your recommendation, and the plan is written. This is the
plan-stage review the house workflow requires before anything is built.

**Read:** [260902j-public-read-only-access-audit-and-improvements.md](260902j-public-read-only-access-audit-and-improvements.md)
— the whole thing. Also the diff this session made to
[260827ai-public-read-only-access.md](260827ai-public-read-only-access.md): the slice-2 deletion note
under "The three slices", and two open questions closed at the bottom. Run
`git diff -- docs/plans/260827ai-public-read-only-access.md` to see exactly those hunks.

## What I want

1. **Is any finding wrong, or wrongly stated?** Each has an evidence state; challenge the ones that
   claim more than they show. S9 in particular is your own claim and is marked *hypothesis*.
2. **Is the tiering right?** The first stage is Clusters A and B together. Say whether that is one
   stage or two, whether anything in Tier 2 or 3 should move up, and whether risk vetoes anything.
3. **Cluster D — Greg chose to build the asset route against your advice.** Given that, is what the
   plan says about it the right shape: build 260829b's stages C, D, E as written, rebuild the DTO
   field in the same stage as the route, keep the pass-through until then? Anything the audit adds
   that 260829b already has wrong?
4. **Cluster F (save-to-shelf) is Tier 3, named and not started.** Is the boundary drawn in the
   right place — a bookmark that grants nothing, with comments and chat waiting for `shelf_entries`?
   Is there anything a stage that builds only the bookmark would have to get right *now* to avoid
   the child-table trap later?
5. **The C3 fix.** "Fall back on 404 only; a final 401 goes through the existing error path with a
   sign-in-again action." Check `apiFetch` and `readJson` in `src/web/lib/api.ts` and the callers of
   `findArticle` in `src/web/App.tsx`: does the existing error path actually render something a
   signed-in owner can act on, or does this need a new state?
6. **The deletion of the public metadata route.** List what else references it that the plan does
   not name — tests, docs, `PublicMetadata` consumers, the route inventory test in
   `tests/public-dispatch.test.ts`, the client-side path test — so the stage that deletes it does not
   leave a copy alive.
7. **What is missing.** The bar is [improve-the-codebase.md](../reusable/improve-the-codebase.md):
   scope line, evidence states, counts shown, the "one level up" verdict. Say if any of those is
   short of it.

`file:line`, how you know, ranked. Under ~2000 words. End with a verdict: BLOCKED with the blockers
named, or ready to build with the changes you want.

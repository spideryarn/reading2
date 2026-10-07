# Code review (and fix): 261004f, Glossary's Find more adds to a list an older prompt wrote

You are reviewing built code, and you may fix what you find **inside this stage**: narrowly,
red-first (a failing test before the fix). Anything wider that you notice, report and do not fix.
Do not commit. Do not touch `.env.local`, `infra/`, or anything listed as a defence in
`docs/project/security-map.md`. Do not add any blockquote or sentence attributed to Greg: quote
only words that already appear attributed to him in the repo.

## The candidate

- Commit `90b966a0d` on top of base `a4f99dbb8` in this worktree. `git show --stat 90b966a0d`
  lists the changed paths; `git diff a4f99dbb8 90b966a0d` is the diff.
- The plan: `docs/plans/261004f-glossary-find-more-always-adds-across-prompt-versions.md`. Your
  own plan review: `docs/plans/261004f-plan-review-sol.md` (F1 to F6). The plan's § The stamp
  and § What review changed say how each was answered; the answer to F1 and F2 is a different
  design from the one you reviewed (the list is stamped current and records `oldestVersion`).
- Start with `src/glossary.ts` (`appendableVersion`, `existingFor`, `panelRunKind`,
  `buildGlossary`), `src/types.ts` (`Glossary.oldestVersion`, `lastAdded`),
  `src/web/GlossaryPanel.tsx` (`MoreRow` and its caller), then the tests and docs. That is where
  to start, not a limit.

## What to do

Independent pass first: attack it. Is each of F1 to F6 really closed? Does the new design open
anything (the stamp machinery in `src/store/artifacts.ts`, `src/store/artifacts-pg.ts`,
`src/store/pg.ts`; the public projection in `src/public/dto.ts`; export; the offline copy;
`rewrite-hold`; Metadata's row)? Is every sentence in the changed docs and comments true against
the code? Is the reader-facing copy true in each case it can appear in?

You have no network and no Postgres. Tests you can run yourself, and please do:
`npx vitest run tests/glossary.test.ts tests/glossary-panel-run-kind.test.ts tests/glossary-run-kind.test.ts tests/glossary-find-more-keeps-the-lists-profile.test.tsx tests/glossary-compact-header.test.tsx tests/rewrite-hold.test.tsx tests/route-profile-concurrency.test.ts`
(all green for me at 90b966a0d; `npm run typecheck` green). The Postgres suites
(`tests/store-glossary-run-kind-pg.test.ts`, `tests/glossary-ideas-baseline.test.ts`, the pipeline
suites) were green for me in a run of 39 files, 647 tests, bar two fixture failures in
`tests/route-profile-concurrency.test.ts` that the commit fixes.

Grade by consequence: **P0** data loss, security, wrong charging, service unusable; **P1**
user-visible wrong behaviour or an authoritative contract violated; **P2** design or
maintainability risk; **P3** prose. Continue the IDs from the plan review (new findings start at
F7). For each: file:line, established or reasoned, and whether you fixed it. End with
`VERDICT: ship` / `VERDICT: ship with the fixes I made` / `VERDICT: do not ship`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

1. `lastAdded = merged.length - previous.length`: can `dedupe([...previous, ...fresh])` ever
   shrink `previous` itself (two old entries merging because a fresh one bridges them), making
   it negative or undercounting?
2. A list written before this change has `passes > 1` and no `lastAdded`: the line must not show.
3. An unforced job on an outdated appendable list now appends once, where it rewrote once.
4. The help page and the under-button sentence: plain enough, and true?

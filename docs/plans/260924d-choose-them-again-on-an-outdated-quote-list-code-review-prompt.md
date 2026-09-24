# Review: Choose them again on an outdated quote list (code)

Repo: /home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924, branch
worktree-feedback-suggestions-0924. TypeScript/ESM, React client under src/web, vitest.

## The candidate

Live pre-commit: base 3ddb24dc. Nothing is committed. **Other agents are editing OTHER files in this
tree at the same time — do not touch any file not listed here.**

Changed (see `git diff -- <path>`):
- src/quotes.ts — `existingFor` refuses an outdated list; new `isOutdated` (directional on
  `quotes/<n>`); `idsByText`/`inheritIds` key by block id + normalised words; `generateQuotes`
  passes `inherit` on an outdated same-article rewrite only; comments.
- src/store/pg.ts — the read path's `outdated` calls `isOutdated` (only the quotes import and the
  `outdated:` line are mine).
- src/web/QuotesPanel.tsx — outdated banner gets `rerun("Choose them again", true)`; foot hidden
  when `outdated`; banner copy.
- src/web/useQuotes.ts — comments only.
- tests/quotes.test.ts, tests/quotes-find-more.test.ts, tests/quotes-find-more-stage.test.ts,
  tests/quotes-find-more-panel.test.tsx
- docs/project/quotes.md, docs/user-feedback/260912_0823-quotes-long-enough-to-stand-on-their-own.md

Untracked: docs/plans/260924d-choose-them-again-on-an-outdated-quote-list.md (the plan, with your
plan review's ledger at the end), -plan-review-prompt.md, -plan-review-sol.md, and this prompt.

Start with: the plan, then src/quotes.ts (`existingFor`, `isOutdated`, `idsByText`, `generateQuotes`),
then src/web/QuotesPanel.tsx.

## What it is meant to do

An outdated quote list (same article, older prompt) is rewritten by a forced run rather than appended
to; its banner offers "Choose them again" and no Find more. A current list still appends. A stale list
still replaces with fresh ids. On the outdated rewrite, a quote chosen again in exactly its words in
the same block keeps its id; everything else is fresh. A dead `?quote=` opens the list with nothing
selected. Your plan-review F1 (verb not carried in the job) was overruled — the reasons are in the
plan's ledger; do not re-litigate it unless you find a consequence the ledger does not address.

## What you can and cannot run, and what you may change

You may edit this worktree, but ONLY the files listed above. Fix what is inside this stage — each
finding red-first, with the test that reproduces it — and leave everything wider as a finding for me.
Do not commit. List every file you changed at the end. You can run single test files
(`npx vitest run tests/<one>`); no network, Postgres tests skip. Already run by me and green:
tests/quotes*.test.ts, tests/quotes-find-more-panel.test.tsx and 18 other quotes-touching files;
`npm run typecheck` reds only on tests/spine-hover.test.tsx, another agent's file.

## Attack it

Independently first. Try to break: the id inheritance (a bookmark moved to words the reader did not
bookmark, or two quotes sharing an id); the append/replace branch (a current list replaced, an outdated
one appended); the client (Find more reachable on an outdated list anywhere, or Choose them again on a
current one); whether the tests would notice each regression; and whether the docs now say anything
false.

For each finding: ID (continue from F4), severity P0–P3 (P0 data loss/security/charging/broadly
unusable; P1 user-visible wrong behaviour or contract violated; P2 design risk; P3 prose), established
or reasoned, (a) the input or mutation that shows it, (b) the fix. Refuse only on an established
P0/P1.

## My own suspicions — read last

- `buildQuotes` still keeps `existing.version` on an append; now unreachable with an older version in
  production. Left as a belt. Fine?
- The banner copy: "These include lines chosen by an earlier version of the prompt. Choosing them again
  replaces this list with one the current prompt chooses."

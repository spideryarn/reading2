# Code review: plan 261029e, stages 1–3

You are reviewing code in the worktree you are running in. Review, then **fix what you find inside
this scope** (edit files; do not commit, do not push, do not run git commands that discard work —
no stash, reset, checkout --, restore, clean). Report anything wider for me to decide.

## What to read

- The plan: `docs/plans/261029e-explanations-borrow-glossary-controls-full-width-and-a-calmer-reader-face.md`,
  including the section "GPT Sol's plan review, and what it changed" (F1–F13), which wins over §§ 2–3.
- The diff: `git diff 1b2bd5487 HEAD` (four commits: 98cde90e8, baac01abd font; 74920bc2d server;
  b0eb29ade client).
- For comparison, the Glossary and Quotes machinery it borrows from: `src/web/GlossaryPanel.tsx`
  (or wherever Glossary's panel lives), `src/web/threshold.ts`, `src/web/faq-order.ts`,
  `src/quotes.ts` (`existingFor`, `isOutdated`, the append), `src/web/styles/glossary.css`.
- Docs: `docs/project/explanations.md`, `docs/project/glossary.md`, `docs/project/controls.md`,
  `docs/project/fonts.md`.

## Deviations the builder made from the plan (judge them)

1. The profile badge keeps a Regenerate (as Glossary's does; Greg asked for it 2026-10-01), despite F10.
2. F7 exception: an empty list that would *rewrite* (stale/outdated/other profile) shows "Write a new
   list"; an empty list that would append shows no run row.
3. An append never throws unless the answer has no list at all, even if every place is dropped
   (Quotes' rule).
4. The run button is disabled until the first job poll (Glossary hides it).
5. Scores drawn as bars (Glossary's `rowScores`), numbers in the tooltip.

## What I most want checked

- **Freshness and fingerprints.** The `explanations/2` bump must not change `inputFingerprint` for
  the first pass (test pins `37199c283b995cea`). `isOutdated` is older-only. Does an existing `/1`
  list stay valid and appendable? Does an append with a different user message corrupt the
  fingerprint or cache?
- **The server/client agreement on `panelRun`**: the same `existingFor` decides what the step does and
  what the button says. Any path where the button says "Find more" and the step rewrites, or the
  reverse (profile changes, outdated, stale, forced)?
- **Append correctness**: one per block across passes, reading order, old items untouched, cap,
  `dropped` cumulative, `passes`/`lastAdded`/`addedAt`, an append that adds nothing.
- **Scores**: validation (a bad score drops the field, not the item), `ANSWER_TOKENS`.
- **Client**: the four orders and the prioritised gate (unscored items survive the bar), `?explby=`
  / `?explbar=` URL wiring and last-view classification, margin focus revealing a hidden row,
  the threshold slider and hidden-count note.
- **Layout**: `.tl-scroll` no longer takes `--band-about-room`; the top run/order row must clear the
  corner (i) and the profile badge in every state (loading, running, empty, stale, error, list).
- **The font change**: Kalam replacing Shantell everywhere (tokens.css, tailwind.css imports,
  package.json, DesignPage, tests/self-hosted-faces.test.ts' ACCEPTED set, docs). Any lingering
  Shantell reference that should change (historical mentions in plans/notes are fine)?
- **Silent success**: tests that would pass with the feature broken.

The box's OpenRouter key is over its limit, so do not try to make real model calls.

## Gates

Run `npm run typecheck` and the relevant test files (`npx vitest run tests/explanations*.ts*
tests/rewrite-hold.test.tsx tests/url-state.test.ts tests/last-view.test.ts
tests/self-hosted-faces.test.ts tests/failure-colour-and-order-chips.test.ts
tests/run-buttons-and-text-boxes-agree.test.ts`) after your fixes.

## Answer format

Numbered findings (C1, C2…), each: severity, file:line, what is wrong, a concrete failure scenario,
and what you changed (or "not changed, because…"). Then a list of files you edited.

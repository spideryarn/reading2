# Code review: 261004b — Summary's Fuller level about twice as long; bold and bullets as two fields

Repo is TypeScript/ESM. You are in a git worktree, branch
`worktree-fbazft06-summary-fuller-and-markdown`. You may write: **fix what you find inside this
change, narrowly, with a test seen red first; report, do not fix, anything wider.** Do not run git
commands that change state; I read your diff and commit it.

## The candidate

Committed: commit `b56d949ce` (parent `6e539c3e6`).
`git diff 6e539c3e6..b56d949ce` — changed paths: `git diff --name-only 6e539c3e6..b56d949ce`.

Start with `src/simple-summary.ts`, `src/types.ts` (search `simpleKey`, `usableSentences`,
`paragraphShape`, `SIMPLE_LIMITS`), `src/web/SimplePanel.tsx`, `src/public/dto.ts`. That is where to
begin, not the limit of scope.

## What it is meant to do

The plan is `docs/plans/261004b-summary-fuller-longer-and-bold-and-bullets.md`; your own review of
that plan is `…-plan-review-sol.md` beside it (F1–F5, all taken). In short:

- Fuller is asked for about 500 words in 5–8 paragraphs; `SIMPLE_LIMITS.fuller` is 3 / 8 / 850.
  Brief's and Simple's prompts must be unchanged apart from the new formatting section and the
  output example.
- A sentence may carry `key` (a few of its own words, drawn `<strong>`), a paragraph `list: true`
  (first sentence the lead-in, later ones bullets). `text` is still the sentences joined by one
  space, and is all the fidelity guard, the word limits and `usableSentences`' rejoin rule read.
- Invariants that must hold: every sentence that names a passage is still a `BlockRef` (hover card,
  press to jump, on-screen wash); no model output is parsed as markup; an invalid key or a
  malformed `list` never refuses a sentence, a paragraph, a level or a stored summary; a row written
  before this change reads and draws exactly as before; a visitor's payload carries nothing new
  except a valid `key` and `list: true`.
- Out of scope: headings, streaming, regenerating stored summaries.

## Run

`npx vitest run tests/simple-summary.test.ts tests/simple-panel.test.tsx tests/public-dto.test.ts`
needs nothing outside the tree. Anything needing Postgres or the network is mine; say what you
would want run. Not yet done by me: a real browser check, and the paid after-arm of the eval
(`evals/simple/fuller-format.ts` is its free half; review that script too, especially
`tallyFidelity` and `tallyFormat`, since the ship decision reads their output).

## Report

Findings as F6, F7, … (F1–F5 are the plan review's), each P0–P3 by consequence (P0 data loss,
security, wrong charging, unusable; P1 user-visible wrong behaviour or a contract violated; P2
design or maintainability risk; P3 prose), established or reasoned, with file:line, and whether you
fixed it. End with a one-line verdict.

## My own suspicions, worth less than your independent pass

1. Does a schema `pattern` on a `["string","null"]` type survive the provider, or will the first
   real press 400? (The after arm running now will also answer this.)
2. `simpleKey` uses `text.includes` and the panel `indexOf`: any way the two disagree, or a key that
   straddles a place the panel splits?
3. `ANSWER_TOKENS` at 5,508: honest for 850 words plus the JSON, and does `budgetFor("simple", …)`
   do anything surprising with the larger number?
4. Anything else that reads `SIMPLE_LIMITS` or assumes Fuller has at most five paragraphs: the
   fidelity checker's `CHECK_MAX_TOKENS`, a UI height, a test fixture, the export.
5. Docs that now say something untrue: `docs/project/summaries.md`, `/help`, the mode card.

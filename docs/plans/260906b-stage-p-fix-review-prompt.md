# Review the fixes for the three Stage P defects you found

You reviewed Stage P of Spideryarn's Debate mode earlier today and found three defects — two P0s and
a P1 — written up in `docs/plans/260906b-stage-p-code-review-sol.md`. This is the fix round. Review
the **code**, not the plan.

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode`. The working tree holds the
change; nothing is committed. The scoped diff is
`/tmp/claude-1000/-home-greg-code-spideryarn2/c7524e4c-c103-4d19-b442-b29f337655ee/scratchpad/p4-fix.diff`,
and the files to read in full are `src/shingles.ts`, `src/debate.ts` (`namesArticleBy`, `linkTo`,
`GroupInput`, `readDirectGroup`, `readClaimGroup`, `blockTextById`), `tests/shingles.test.ts` and
`tests/debate-identification.test.ts`.

## Context

Debate mode's group one shows pages that respond to *this* article. Each kept row records the
evidence that proved it — `linked`, `quoted` or `named` — and the reader gets a threshold over that,
defaulting to `quoted`. A title alone is too weak: a 2026 successor at a different URL shares a 2023
article's title, and six pages about the wrong document were once shown as reception.

## What was changed

**F1** — quotation evidence is now over **prose**. `GroupInput.blockText` carries `{ text, kind }`
(new `ArticleBlockText` in `src/shingles.ts`), and `articleShingles` takes no window from a block
whose kind is `heading`. Headings stay in `ArticleShingles.blocks`, which is the density/copy side of
the question. `readClaimGroup` still resolves a `claimQuote` in **any** block, headings included.

**F2** — the `sourceIsCopy` drop now needs two signals: `isCopy(overlap)` **and** the row's own
verified `sourceQuote` being article text, via the new `isArticleText(article, quote)` — per block,
`findQuote(…, "spaced")`, never over the blocks joined.

**F3** — the `linked` signal is derived from the **whole extract**, not the model-chosen witness. The
directness check stays on the witness (`namesArticleBy`). Both go through one new `linkTo(text, url)`
helper. A fallback was added that your review did not ask for: `linkTo(excerpt, …) ?? naming.url`,
because the witness is an arbitrary slice, so an address ending the slice can parse as the article's
URL there and as a longer, different URL in the whole extract — without the fallback the row would
pass the directness rule and carry an **empty** `identifies` list, which is a state the type's
invariant forbids. There is a test for exactly that shape (`…-2026`).

## Evidence

- All three defects were reproduced **red first** on the production path from your own inputs, in
  `tests/debate-identification.test.ts`. Your F2 numbers reproduce exactly: 22 extract windows,
  density 0.50.
- `npm run typecheck` clean across all three projects. The debate/quote suites are green
  (`shingles`, `debate`, `debate-identification`, `debate-bar`, `debate-panel`, `debate-journal`,
  `debate-passes`, `quote-match` — 237 tests).
- Layer 1 replay (`npx tsx evals/debate/run.ts check`) — 17 of 17.
- **Corpus re-measurement**: the three journals under `output/debate-runs/` replayed before and
  after. Identical kept counts, identical levels, identical loss reasons — `writes` keeps hamtyped at
  `quoted`, Cargo Cult keeps nothing, the constitution keeps Lawfare at `named`. No row gained a
  `linked` signal, and `sourceIsCopy` is zero on both sides.
- Mutations, all caught: headings shingled again → 3 tests; the row-level evidence dropped from the
  copy refusal → 1; `isArticleText` never firing → 5; the link read from the witness again → 1; the
  witness fallback removed → 1.

## What I want from you

Correctness and design defects in **this** change, ranked P0/P1/P2, each with a concrete input that
exhibits it and the file and line. In particular:

1. Does keeping headings in `ArticleShingles.blocks` while removing them from `windows` create any
   inconsistency a reader or a caller could see?
2. Is the `?? naming.url` fallback right, or does it re-open something? Is the `identifies`
   non-empty invariant actually guaranteed now, for every path?
3. Does the two-signal copy refusal have a case where a genuine mirror now survives — and if so, is
   there a real input for it?
4. Anything in the reader-facing consequences: the level a row now carries, what the default bar
   (`quoted`) shows, the tooltip's promise to list every signal found.

Do not edit anything. If you think one of my three fixes is wrong, say so with the input that shows
it.

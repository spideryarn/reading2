# Code review: Citations rows say only what the bibliography supports (261003j)

You are reviewing code that was built from a plan you reviewed. You may FIX what you find, inside
this stage's files; report anything wider for me to decide. Do not commit, do not run any git
command that changes history or the working tree's other files, and do not touch files outside the
diff unless a fix needs it.

Read:

1. `docs/plans/261003j-citations-say-only-what-the-bibliography-supports.md` — the plan, including
   the table of what was done with each of your plan-review findings.
2. `docs/plans/261003j-citations-say-less-code-review.diff` — the whole stage, one commit.
3. The files it touches, in full where the diff is not enough: `src/citations.ts` (§
   `locateInArticle`, `articleTextOf`, `readDraft`, `locateInEntry`), `src/web/CitationsPanel.tsx`
   (§ `showsWhy`, `WorkRow`), `src/web/ProseHoverCard.tsx` (§ `CiteCard`),
   `src/web/marginalia/MarginaliaColumn.tsx` (§ `CitationNote`), `evals/citations-say-less.ts`.

What it is meant to do: the model's `why` sentence about a cited work is drawn only beside something
checked against it; Marginalia shows the article's reference entry instead; and when a list is made,
code drops authors or a year that the article's text (or its PDF reference list) never gives.

Look hardest at:

- `locateInArticle`: can it wrongly drop authors or a year the article does give? Think about how
  models write the authors field ("Porter, D.", "van der Meer, García", "Smith & Jones",
  "Chen et al.", "Vahdat & Kautz"), initials, hyphens, apostrophes, non-Latin names, a year like
  "2017a", "n.d.", "in press", "c. 300 BC". Can it wrongly KEEP something? Does the `WeakMap` cache
  keyed on `byId` ever serve a stale or wrong article, or miss the reference list? Does dropping
  authors change a work's dedupe key in a way that breaks id inheritance across re-runs, or the
  fold of a shorthand row into its entry (`keysOf`, `buildCitations`)?
- `showsWhy` and the band's extra running/draft condition: every state in which a verdict or an
  answer referring to the claim is on screen has the claim; no state shows it with nothing beside
  it. Failed runs, a retry over a kept answer, a stale lookup.
- The hover card with `why` gone: is the `.prose-card-part-why` wrapper still right when it holds
  only the read note? Any CSS that assumed the label was there?
- Tests: is each new test capable of failing for the reason it names? Is anything asserted on text
  a tooltip could satisfy?
- `evals/citations-say-less.ts`: does the guard replay measure what the plan says?

Run `npx vitest run tests/citations.test.ts tests/citations-panel.test.tsx tests/citation-hover-card.test.tsx tests/marginalia-shut-notes.test.tsx tests/voices-css.test.ts`
and `npm run typecheck` after any change you make. If the sandbox stops you running them, say so.

Answer with findings numbered C1, C2, …, each with a severity (blocker, should-fix, note), the
evidence (file and line), and whether you fixed it. End with one line: `VERDICT: land`,
`VERDICT: land after fixes` (say which are still open), or `VERDICT: do not land`.

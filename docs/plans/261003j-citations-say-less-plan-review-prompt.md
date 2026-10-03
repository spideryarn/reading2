# Plan review: Citations rows say only what the bibliography supports (261003j)

You are reviewing a plan before it is built. Read-only: change no files.

Read, in this order:

1. `docs/plans/261003j-citations-say-only-what-the-bibliography-supports.md` — the plan.
2. `docs/project/citations.md` — what the mode does today.
3. The code the plan touches: `src/web/CitationsPanel.tsx` (§ `WorkRow`, `LookupReading`,
   `readNoteOf`, `assessedOf`), `src/web/ProseHoverCard.tsx` (§ `CiteCard`, `CiteCardReading`),
   `src/web/marginalia/MarginaliaColumn.tsx` (§ `CitationNote`), `src/web/CitationInvestigation.tsx`.
4. `evals/citations-say-less.ts` — the script behind the plan's numbers.

The request, from the product owner: a Citations row should say nothing about a cited paper beyond
what the article's bibliography gives, must not suggest we know what the paper says, and should
leave the rest to the on-request *Dig deeper* button. He asked for the simplest version.

Questions:

- Is the rule for when the model's `why` sentence is shown (an assessed quick-check reading, or a
  kept *Dig deeper* answer) right and complete? Is there a state where the verdict or the answer
  refers to "what the article uses it for" and the sentence would be missing, or a state where it
  is shown with nothing beside it that checked it? Look at failed, stale and running states.
- Does any other surface draw `why` to a reader that the plan misses? Search for it.
- Does the plan leave anything on a default row that claims more than the article gives?
- Is the measurement honest? Does `evals/citations-say-less.ts` measure what the plan says it does,
  and is the conclusion (one row in 194 with an author from memory) supported by it?
- Is keeping `why` in the prompt and the stored list the right call for a first version?
- Anything in the plan that is wrong, risky or more complicated than it needs to be.

Answer with findings numbered P1, P2, …, each with a severity (blocker, should-fix, note), the
evidence (file and line), and what you would do. End with one line: `VERDICT: build as planned`,
`VERDICT: build after fixes`, or `VERDICT: rethink`.

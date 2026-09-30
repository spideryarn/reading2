# Plan review: Citations read the cited paper, and one shared bibliographic lookup

You are GPT Sol, reviewing a plan in the Spideryarn repo (this working tree) **before** it is built.
Read-only: do not edit files.

The plan: `docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md`.
Read it first, then check it against the code and docs it cites:

- `docs/project/citations.md` (what is built), `docs/project/sql.md`, `docs/project/database.md`
- the earlier design of reading the paper and your own review of it:
  `docs/plans/260929g-check-a-cited-paper-supports-the-claim.md` § Proposed later stage and
  `docs/plans/260929g-check-a-cited-paper-plan-review-sol.md` (P-1 … P-10). Say, finding by finding,
  whether this plan answers each.
- `src/paper-text.ts` (`readPaperText`), `src/fetch.ts` (`fetchDocument`), `src/pdf.ts`
- `src/citation-investigate.ts`, `src/citation-investigate-context.ts`, `src/investigate-quote-guard.ts`,
  `src/citation-find.ts`, `src/citation-lookup.ts`, `src/citations.ts`, `src/citation-reference-list.ts`,
  `src/cited-in-spideryarn.ts`, `src/store/pg-cited-in-spideryarn.ts`
- `src/db/schema.ts` (`citation_finds`, `citation_investigations`, `block_identities`)
- `src/debate.ts` and `docs/plans/260929h-debate-mode-clearer-sources-and-orders.md` § Deferred: authors and year from a lookup

Questions I most want answered:

1. **Safety of reading the paper.** Is the identity ladder sound? Can the guard's allowed texts be
   widened to the chunks sent without letting a model present unsent or wrong-work text as the
   paper's? Is the "what was read" contract honest in every state?
2. **Politeness to Crossref and DataCite on serverless** (Vercel, many instances). Is a DB cache +
   per-process concurrency + per-process cooldown enough to count as not abusing them, or is a
   cross-instance limiter needed? Is DataCite the right route for arXiv ids instead of the arXiv API?
3. **`cited_works` (§ 3c)** versus deferring the table entirely versus the full move. Is the
   identity-table middle path right? Are the FK additions and backfill safe on a production database
   with existing rows (an additive migration the Overseer applies before deploying)?
4. **Stage order and size**: can each stage land green on its own? Anything that should be cut,
   merged, or deferred? Anything simpler that does the same job?
5. Anything in the plan that is false about the current code.

Report as findings with an id (P-1 …), a severity (P0 blocker, P1 must fix before building, P2
should fix, P3 note), the evidence (file:line), and the fix. End with an overall verdict: build as
is / build with changes / rethink.

# Plan review: one type for a read, spiked on `useIdeas`

Read-only review of a plan before anything is built. Do not change any file; your reply is the
review.

**The plan:** `docs/plans/261006n-one-type-for-a-read-spiked-on-useideas.md` (untracked, in this
checkout, base `bf78e90c7`).

**Its evidence, all untracked files in this checkout:**

- `docs/investigations/261006d-seventh-sweep-depth-reader-client-and-per-mode-hooks-sol.md` § WC3
- `docs/investigations/261006d-seventh-sweep-depth-reader-client-and-per-mode-hooks-opus.md` § WCO10
  and its hook table
- `docs/investigations/261006d-seventh-sweep-depth-reader-client-review-opus-on-sol.md`
  § WC3 (the recommended shape, the nine characterisation tests, the stop condition)
- `docs/investigations/261006d-seventh-sweep-depth-reader-client-review-sol-on-opus.md`
- The code: `src/web/useIdeas.ts`, `src/web/IdeasPanel.tsx`, `src/web/modes/ideas/IdeasMode.tsx`,
  `src/web/useSkim.ts`, `src/web/modes/skim/SkimMode.tsx`,
  `src/web/marginalia/MarginaliaColumn.tsx`, `src/web/useAutoRun.ts`, `src/web/useOrderedRead.ts`,
  `src/web/useRewriteHold.ts` (or wherever the hold lives), `tests/read-error-matrix.test.tsx`.

**Whose decisions:** the product owner (Greg) approved "a one-hook spike first, then decide". The
shape, the stages and the stop condition are the orchestrator's (Claude's), not his. Do not
attribute any of them to him.

**What to do.** You may run `npx vitest run tests/<one>.test.tsx` for a test needing nothing outside
the tree, and `node --import tsx <script>`; not `npm test` or `npm run typecheck`.

1. Write `useIdeasRead` in the proposed type, in your head or in a scratch reply block, against the
   real file. Does one `useState<Read<IdeasAnswer>>` really carry every state the hook can be in
   today? Name any state, flag, ref or effect that does not fit (the rewrite hold's `FreshReads`,
   the offline copy, the profile flags, anything `useSkim` reads).
2. Break the type: give a sequence of events (open, 404, failure, Try again, job finishes, slug
   change, a late reply) after which the proposed transitions leave the hook in a state that draws
   something different from today's code. `retrying` and `failedRead` are the places to push.
3. Is `statusOf` a hole in the design (consumers go on thinking in four words)? Is the list of its
   two permitted callers right?
4. The stop condition: can it pass while the migration is still not worth doing? Can it fail for a
   reason that says nothing about the type? Tighten or cut conditions.
5. The nine characterisation tests: which of them would pass against a plausible WRONG
   implementation of the new type? What is missing?
6. Asked directly: **is this abstraction worth its keep**, given the investigations' own count that
   it prevents two of seven postmortems outright? If a smaller thing gets most of the value (for
   example only moving the five answer-borne facts into one object, or only a lint/test), say so.
7. Does it collapse into the "generic artefact-read hook" the fifth sweep rejected
   (`docs/plans/261003f-fifth-codebase-sweep-umbrella.md` § Considered and rejected)?

**Format.** Findings with IDs R1, R2, ...; severity P0 (would ship a reader-visible regression or
lose data) / P1 (the plan as written builds the wrong thing) / P2 (should change before build) / P3
(note). For each: the input or code path that shows it, and the smallest change to the plan. End
with a verdict: ready / ready with these fixes / not ready / do not build, and one paragraph on
question 6.

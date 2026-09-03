# Review prompt: 260902o, the plan, before anything is built

You are GPT Sol, reviewing a plan in the Spideryarn repo (this working tree, read-only). Read
`docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md` in full, then
`docs/reusable/improve-the-codebase.md` § The bar (the deletion test and the YAGNI test), then the
code the plan cites — locate by content, not line number.

The plan is an audit of what it costs to add a reader "mode" (`src/modes.ts`), with findings tiered
and a stage list. Nothing has been built. The house rule is that a plan is reviewed before it is
built, and that a reviewer asked directly whether an abstraction is worth its keep will say so.

## What I want from you

1. **Is any finding wrong?** For each of T0.1–T2.2, check the claim against the tree. In
   particular:
   - T0.1: read `src/web/lib/api.ts` § `CACHEABLE` and the routes in `src/routes.ts` for
     `/api/timeline/`, `/api/quiz/`, `/api/sketch/`. Is the omission a defect or is there a reason
     (e.g. those responses are not safe to serve stale) the plan missed?
   - T0.2: `src/web/CriteriaPanel.tsx` cleanup vs `useIdeasMode` and `TimelineBand` in
     `src/web/App.tsx`. Is `openRefereeKey` really left set, and does it matter?
   - T1.3: `src/web/visitor.ts`. Would a total `Record<Mode, VisitorPolicy>` with four variants
     lose anything the current if-chain plus two Partials expresses — in particular the
     "stated rather than defaulted into" distinction the timeline comment insists on?
   - T1.6: `src/store/index.ts` cast of `pgArticleReader`. Is the `Pick` load-bearing for
     anything (a store that legitimately lacks a loader)?
   - T2.1: the race. Is it reachable today given how `useStepJob` and the hooks' `onFinished` are
     wired, or did something since 2026-08-28 close it?
2. **Is each proposed fix worth its keep?** Apply the deletion test to T1.1 (a type-level
   exhaustiveness check on an array), T1.3, T1.4 (one CSS family for the band head), T2.1 (the
   narrowed extraction) and T2.2 (`usePassageMode`). Say outright if any is not worth the
   indirection, or if a cheaper answer exists.
3. **Is anything important missing?** You may know a per-mode site the four subagents did not
   find. The plan's scope line says what was swept.
4. **The stage plan.** Is the order right — highest confirmed tier first, risk vetoing? Are the
   parallel pairs (A‖B, C‖D) really non-overlapping in files? Is Stage E safe to do this run or
   should it be its own plan?
5. **T3.1.** Does the `Record<Mode, BandSpec | null>` idea for the band dispatch survive the
   sixteen-prop objection once T2.2 exists, or is it the refused component under another name?

## Format

For each finding you make: **(a)** the input or state under which the plan's claim fails,
something I can run or read; **(b)** the smallest change to the plan that closes it. Rank by (a):
a finding with no (a) is an opinion and goes last. Then a verdict: ready to build / ready with
changes / not ready, and which stages you would start with.

You can run one test file with `npx vitest run tests/<one>.test.ts` and a script with
`node --import tsx <script>`; `npm test` and `npm run typecheck` are blocked in your sandbox.
`tests/visitor-gaps.test.ts` and `tests/store-revision-columns.test.ts` are the two most relevant.

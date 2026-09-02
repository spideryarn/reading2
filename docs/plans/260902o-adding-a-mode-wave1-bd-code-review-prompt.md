# Review prompt: 260902o, Stages B and D, the code

You are GPT Sol, reviewing built code in the Spideryarn repo (this working tree, read-only). You
reviewed the plan earlier: `docs/plans/260902o-adding-a-mode-review-sol.md` is your answer, and
`docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md` is the plan
with your findings folded in. Treat the code below as unreviewed code written by someone else, and
spend most of the run on the code rather than the plan.

Two commits, each a stage:

- **Stage B** — `git show b78d7e2a` — T1.5 (`STAMP_SOURCE` total), T1.6 (`pgArticleReader`
  declared `ArticleReader`, cast deleted), T1.8 (`STEP_ORDER` exhaustiveness type), T1.9
  (`quotes.isStale` readonly).
- **Stage D** — `git show 50b25cad` — T2.1: `src/web/useOrderedRead.ts` (new) and the eight
  readers moved onto it; `tests/artefact-read-race.test.tsx` runs the race against all eight.

Run `git show <sha> --stat` then `git show <sha>` for each. Another agent is concurrently editing
Stage A's files in this tree (`src/web/Dock.tsx`, `visitor.ts`, `lib/api.ts`, `CriteriaPanel.tsx`,
`App.tsx`, `title-text.ts`); ignore uncommitted changes there.

## What I want

1. **Stage D, the mechanism.** Read `useOrderedRead.ts` against `useGlossary.ts` at `HEAD~2`
   (`git show 50b25cad~1:src/web/useGlossary.ts`) — is anything the glossary's own guard did
   lost in the lift? Specifically: the render-time reset keyed on `read`'s identity; the `finally`
   ownership check on `inFlight`; `refresh` awaiting twice; the unmount clearing `trailing`. Then
   the three rules — join on `reload`, trail on `refresh`, newest-generation-only commit — find an
   interleaving that still commits a stale reply, if one exists. State it as a sequence I can
   turn into a test.
2. **Stage D, the interface.** The helper grew two verbs the plan did not draw, `armRefresh` and
   `discard`, each with one caller (`useGlossary.patchEntry`, `useGlossary.clear`). Is that the
   right boundary, or should those stay private to the glossary? Say outright.
3. **Stage D, the callers.** For each of the eight, check that `current()` is asked after
   *every* `await` before *any* state is set, including in `catch`. One missed site is the bug
   rebuilt. `useSketch` rekeys on block order; `useArc` treats a stale artefact as absent; the
   read inside `Tweets.tsx` is a component not a hook — check those three most carefully.
4. **Stage D, the test.** `tests/artefact-read-race.test.tsx`: does it discriminate on the stale
   value for all eight, or does any case pass for a reason other than ordering (e.g. a stub that
   never returns the old value)? Run it: `npx vitest run tests/artefact-read-race.test.tsx`.
   Then mutate one thing in the helper — make `refresh` join instead of trail — and say which
   cases go red. If none do, the test is not holding the contract.
5. **Stage B.** The `StepsMissingFromOrder` type is exported with a `@public` tag purely to
   survive `noUnusedLocals` and knip. Is there a plainer spelling that the repo's tooling accepts?
   Is `: ArticleReader` the right choice over `satisfies` given
   `tests/store-seams-have-two-implementations.test.ts` parses the annotation? Anything in
   `STAMP_SOURCE`'s readers that treated a missing key differently from `null`?

## Format

For each finding: **(a)** the input or sequence under which the code fails its own claim,
something I can run; **(b)** the smallest change that closes it, described, not patched. Rank by
(a). Then a verdict per stage: ship / ship with changes / not ready.

Read-only tree. You may run one test file at a time with `npx vitest run tests/<one>.test.tsx`;
`npm test` and `npm run typecheck` are blocked.

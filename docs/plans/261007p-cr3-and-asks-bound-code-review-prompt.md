# Code review: CR3 (first open waits on settings) and the classifier's quote bound

Two small bug fixes, one working-tree diff in this worktree: `git diff HEAD`. You may fix what
you find, inside these files, and report anything wider. Do not commit.

## 1. CR3 of docs/plans/261007p-code-review-sol.md

An unmarked first open (`useLastView` in `src/web/last-view.ts`) waited for the experimental
settings store's `loaded` before applying the first-open default, because it took `signedIn` from
that store. A failed or offline settings read left the arrival in Plain. The fix drops
`useExperimental` from `useLastView` entirely and takes signed-in status from `readerId !== null`,
on the grounds that `App` (src/web/App.tsx, `useLastView(known && … ? slug : null, …, user?.id ?? null)`)
hands the hook a null slug until the session is known.

Attack:
- Is `readerId !== null` really equivalent to the store's `signedIn` on every path where the slug
  is non-null? Public routes, `/read/public`, the visitor view, a session that is known but whose
  store has not heard `onAuthStateChange` yet, a sign-out.
- `App` no longer subscribes to the experimental store as a side effect of `useLastView`. Does
  anything rely on that subscription — an earlier `/api/reader` read, a re-render of `App`?
  (The comment in App.tsx was edited.)
- Is the hold in `src/web/first-open-purpose.ts` still pulling its weight now both paths apply
  immediately? Its comments were corrected; say if they are now wrong, don't remove the hold.
- The tests changed: `tests/first-open-default-wiring.test.tsx` (one new red-first case, two
  old cases that encoded the wait rewritten) and `tests/last-view-change-of-reader.test.tsx`
  (expectations of a bare address became the first-open default, because B has no key there).
  Did any rewrite weaken what the test protected?

## 2. The attention classifier's quote bound

`tools/overseer/attention-classify.ts`, `proposalSystemPrompt`: the `asks` field now asks for the
SHORTEST exact passage, states `MAX_ASKS_CHARS`, and gives an example. `MAX_ASKS_CHARS` moved above
the prompt (TDZ: `WORST_CASE_PROMPT_TOKENS` builds the prompt at module load). No version bump —
argued in the comment. The eval result is in docs/plans/261007o-fable-to-opus-in-the-overseer.md.

Attack: is not bumping `PROPOSAL_PROMPT_VERSION` right given how verdicts are cached
(`planClassifications`) and what attention-memory.ts checks? Does the example obey the verbatim and
contiguity checks? Is the new test meaningful?

Run: `npx vitest run tests/first-open-default-wiring.test.tsx tests/last-view*.test.ts* tests/first-open-purpose.test.tsx tests/overseer-attention-classify.test.ts tests/fleet-attention.test.ts tests/overseer-store-attention.test.ts`
and `npm run typecheck`.

Severity P0–P3, id each finding (R1, R2, …), reproduced or reasoned, smallest fix. End with one
line: `VERDICT: approve` / `approve with changes` / `rework`.

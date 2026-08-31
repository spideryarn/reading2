# Review the built code

You reviewed the plan for this work and returned **not ready to build**, with nine findings. I
checked every checkable claim and every one held. The plan was revised and the code is now
written. This is the second review, and it is the one that counts: a plan-stage review cannot see
a `PATCH` that writes one field and then rejects the request.

Read-only review — do not edit files. Be concrete, rank findings by how much damage they would do,
mark each must-fix / should-fix / note, and end with a one-line verdict: safe to commit, or not.

## What to read

- `docs/plans/260827am-glossary-read-latency.md` — the revised plan. Its "What to change" and "How each
  part is checked" sections were rewritten around your findings.
- `docs/plans/260827am-glossary-read-latency-review-sol.md` — your own previous review, for reference.
- `docs/plans/glossary-read-latency-code.diff` — the scoped diff of everything changed.
- `docs/plans/glossary-read-latency-new-tests.txt` — the two new test files, in full
  (`tests/glossary-one-fetch.test.tsx`, `tests/store-block-reads.test.ts`).
- The files themselves, live in the tree, for anything the diff clips.

**Note on `src/web/App.tsx`:** another agent is editing that file concurrently, so its diff
contains hunks that are not mine (`ReviewStance`, `ThreadKind`, `Mode`, a review-mode band). Mine
are only: the `useGlossaryRead` import and call, `terms`, the `GlossaryBand` props, and the
deletion of the `onEntries` push-up effect. Ignore the rest; it is somebody else's work in
progress and its typecheck errors are theirs.

## What was done about each of your findings

1. **`reset()`/`look()` need more than `reload()`** — `GlossaryRead` now exposes `reload`, `clear`
   and `patchEntry`. `reset()` calls `clear()`, `look()` calls `patchEntry()`.
2. **Same-slug races** — a generation counter in `useGlossaryRead`, bumped by every fetch and
   every mutation; older replies are dropped. `pushed` is gone. The slug-change reset moved into
   the render phase, because React runs child effects first and an effect-based reset clobbered
   the request `GlossaryBand` had just started (the dedupe test caught this: it counted 2).
3. **Removing the band's mount fetch hides another tab's finished job** — the mount fetch is
   kept; it revalidates behind the list already on screen and never re-enters `loading`. The
   invariant is no longer "one request for the page's lifetime". There is a test for the exact
   scenario you described.
4. **Hash-only rows** — `blockHashInputs` selects `{ id: blockId, text }`, aliased. The four
   staleness signatures narrowed to a new `BlockFingerprint` type in `src/source-hash.ts`.
5. **`store-parity.test.ts` did not cover ideas** — added; it runs against 7 real articles.
6. **The diagnosis overstated the wait** — corrected in the plan: one request, not two serialised;
   the numbers labelled as disk-and-laptop derived; the module-load JSDOM cold cost named.
7. **One shared projection is still too broad** — replaced by eight per-read projections and an
   exhaustive `REVISION_COLUMN_POLICY`.
8. **The union test is a tautology** — the guard is now (a) the policy map's keys equal the
   table's columns, enforced at compile time too by `Record<keyof $inferSelect, …>`, and (b) each
   real projection's keys equal what the policy grants it.
9. **Checks that pass while broken** — each guard was verified by removing its mechanism and
   watching the test go red. Recorded below.

## Evidence: every guard was seen to fail

- Band's mount revalidate deleted → *"still picks up a glossary written while it was closed"* red.
- Generation guard deleted → both race tests red.
- `arc` dropped from the `article` projection → *"article selects exactly what it is allowed"* red.
- Policy key omitted (`rawSourceSha256`, found during the build) → **compile** error, not just a
  test failure.
- The first draft of the "no loading state" test passed on the broken code, because replies
  resolved instantly; replies are now held. The first draft of the slug-switch test passed with
  the generation guard deleted, because the mock returned the same list for every slug and
  released replies in issue order; it now returns per-slug terms and releases newest-first.
- `tests/store-block-reads.test.ts` asserts the **generated SQL** via `QueryBuilder`, not a column
  constant.

## What I most want you to attack

1. **`useGlossaryRead`'s concurrency.** Walk it properly. The generation counter, the `inFlight`
   promise, the render-phase slug reset, and `GlossaryBand`'s mount `reload()` all interact. Where
   does it still go wrong? Specifically: `inFlight` is cleared in `finally` — can a `clear()`
   during a fetch leave `inFlight` pointing at a promise whose `finally` then nulls a *newer*
   request's entry? Is `reload()` returning a joined promise safe for `reset()`, which awaits
   `run(false)` afterwards? Is the render-phase `setState` loop-safe?
2. **`patchEntry` bumping the generation.** It cancels an in-flight reload. Is that right, or does
   it mean a `look()` during a job-finished reload loses the reload permanently — with nothing to
   retry it?
3. **The projections.** Check each of the eight against what its read actually touches, in the
   live files, not the diff. Did I get `metadata` right (`articleMetadata` + `ideasAreCurrent`)?
   Is `publish` correct? Is the `RevisionRowFor<K>` cast in `currentRevision` hiding a real
   mismatch between the runtime projection and the type?
4. **`library` still takes four whole JSONB artefacts to answer `!= null`.** I left that and
   recorded it as a follow-up. Is leaving it defensible, or does the policy map now *legitimise*
   the waste in a way that means it never gets fixed?
5. **The `blocksFor` column list.** I named its columns to drop `fts`. Did I drop or rename
   anything else by accident, and does the mapping below it still line up?
6. **`Promise.all` in `loadGlossary`.** Two queries on one pooled connection — is that actually
   concurrent, or does the pool serialise it anyway and I have claimed a win I do not have?
7. **What the tests still cannot see.** I know of one: `tests/glossary-one-fetch.test.tsx` tests
   the hooks, not `App.tsx`, so the wiring is unguarded. Is there a cheap way to close that? And
   what else is unguarded that you would not ship without?
8. **Anything in the diff that is simply wrong**, and anything I have not mentioned.

Quote file and line. Some of your findings last time changed the design; do that again if needed.

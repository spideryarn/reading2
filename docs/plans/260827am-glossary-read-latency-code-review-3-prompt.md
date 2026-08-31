# Third code review

You have reviewed this twice and returned **not safe to commit** both times. Every finding held,
including a typecheck error, a wholesale-entry clobber, and — twice — a test that passed on broken
code. All of them are fixed. This is the last pass.

Read-only. Rank findings, mark must-fix / should-fix / note, verdict on one line.

## Read

- `docs/plans/260827am-glossary-read-latency-code-review-2-sol.md` — your last review.
- `docs/plans/glossary-read-latency-code.diff` — regenerated just now.
- `docs/plans/glossary-read-latency-new-tests.txt` — the three new test files.
- `docs/plans/260827am-glossary-read-latency.md` — the plan, § "How each part is checked".
- The live files.

`src/web/App.tsx` still carries another agent's concurrent work (`ReviewStance`, `ThreadKind`,
`Mode`). Mine: the `useGlossaryRead` call, `terms`, the `GlossaryBand` props, the deleted
`onEntries` effect.

## What changed since your second review

1. **`patchEntry` merges the lookup only** — `{ ...e, lookup: entry.lookup }`, never the returned
   entry. Test: a job renames the term, the refresh lands, *then* the stale lookup arrives with
   nothing in flight. Red when reverted to replacing the entry.
2. **`currentRevisionQuery` is exported**, and `tests/store-revision-columns.test.ts` asserts the
   generated SQL for six reads: no `raw_bytes`, `extracted_html`, `stamped_html` or `labels`, and
   the glossary read takes `glossary` and not `tree`/`summary`/`ideas`/`arc`. Verified: reverting
   `currentRevision` to `revision: articleRevisions` leaves every projection-object test green and
   turns these two red — your fourth tautology, closed.
3. **The two queries that cannot be builders** — `listArticles` and `publishRevision` — are
   guarded by source assertions **with comments stripped**, labelled as weak. Both proven red.
4. **`clear()` clears `error`.**
5. **The slug-change reset clears `trailing`, and the mount effect's cleanup clears it on
   unmount.**
6. **`refresh()` awaits twice** — the in-flight request, then the trailing one its `finally`
   started — so it resolves when the refresh it promised has actually happened.

354 tests pass across the suites this touches. Typecheck clean for every file in this change. Lint
clean.

## Attack

1. **`patchEntry`'s new merge.** `e.id === entry.id && entry.lookup`. What if a caller ever passes
   an entry *without* a lookup — is silently doing nothing the right answer, or should it throw?
   And is there now a path where a lookup is stored server-side but never displayed?
2. **`refresh()`'s double await.** Between the first `await` resolving and reading
   `inFlight.current`, can it observe a *different* request — one started by something else — and
   await the wrong thing? Can it await nothing when a trailing fetch was in fact armed?
3. **The unmount cleanup sets `trailing = false` but does not bump the generation.** A request
   outstanding at unmount still runs its `finally`. Is anything else left dangling?
4. **`clear()` clearing `error` — does that hide a failure the reader should see?** `reset()`
   calls `clear()` then `run(false)`; a failed DELETE is held separately in `resetFailed`. Walk it.
5. **The SQL assertions.** Do they actually cover what I claim? Is there a projection whose read I
   have not asserted, or a large column I have not named?
6. **The fifth tautology.** There has been one in each round. Find it.
7. Anything else wrong in the diff.

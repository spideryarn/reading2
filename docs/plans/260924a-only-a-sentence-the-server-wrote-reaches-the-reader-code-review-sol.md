Refuse pending F5, an established P1 contract violation.

- **F5 — P1, established: Mirror blesses an arbitrary server exception as reader-facing.**  
  [useMirror.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/useMirror.ts:109) wraps every SSE `error` string in `ReaderFacingError`. But [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/routes.ts:4568) constructs that frame from raw `(err as Error).message`; for example, an unclassified `TypeError("fetch failed")` is rethrown by [referee-mirror.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/referee-mirror.ts:1577). Therefore:

  ```text
  event: error
  data: {"error":"fetch failed"}
  ```

  reaches the reader verbatim and is not reported as `[web-unexpected]`. This directly contradicts the plan’s construction guarantee.

  The proper fix needs the out-of-manifest server producer: distinguish typed reader-facing failures from arbitrary exceptions in the Mirror frame, preserve the former, and replace/report the latter before transmission. I did not apply a client-only generic fallback because it would suppress the valid reader-written sentences the brief requires preserving.

- **F6 — P2, established: client-authored producers are not mutation-pinned.**  
  I temporarily changed Mirror’s silent-end throw at [useMirror.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/useMirror.ts:121) back to plain `Error`. All seven tests in `referee-mirror-stream.test.tsx` still passed because the relevant assertion checks only that an error is truthy at [referee-mirror-stream.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/referee-mirror-stream.test.tsx:173). The malformed-terminal case is similarly non-specific. The central test constructs a `ReaderFacingError` directly rather than exercising these producers. Add exact-copy assertions for every migrated throw site. The mutation was restored immediately.

- **F7 — P3, established: the web-client documentation contradicts the new behavior.**  
  [web-client.md](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/project/web-client.md:474) says `describeFetchFailure` handles only requests that never received a response, then immediately names `HttpError`, which represents a response that said no. Rewrite this as the common caught-failure presentation seam.

The three suspicions otherwise check out: deliberate aborts are guarded; an unbranded mid-stream `TypeError` gets `PAGE_FAULT`, capture, and recovery; and `kind: "bug"` correctly hides Retry for a client fault.

Verification:

- 186 targeted tests passed.
- The temporary mutation also passed 7/7, establishing F6, then was restored.
- Typecheck passed via `node --import tsx scripts/typecheck.ts`; the npm wrapper itself hit a sandbox IPC `EPERM`.
- `git diff --check` passed.
- Scoped lint reported three pre-existing hook-dependency errors and four complexity advisories.

Files changed by this review: none.
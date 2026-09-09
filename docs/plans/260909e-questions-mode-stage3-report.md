# Questions mode Stage 3 report

## What was built

- `tools/fleet/web/src/QuestionsPanel.tsx` reads the idea queue once when the panel mounts, through
  its injectable `QueueApi`, and reads it again only when `refreshNonce` changes. A pushed Questions
  payload does not trigger another queue read.
- The queue pointer is a separate region after the Questions body, not a `QuestionItem`. Its
  exhaustive `QueueView` switch states all six visible outcomes separately: loading, a positive
  `needsGreg` count, a read zero, never written, server-unreadable and no browser answer. A positive
  count offers one button to open Queued ideas.
- A complete empty session reading now says `Nothing needs you.` only when the queue was also read
  and `depth.needsGreg === 0`. Loading, never-written, unreadable and no-answer instead say that the
  sessions were observed and quiet, but the queued ideas could not be checked, followed by that
  queue arm's reason. A readable queue with waiting items states that the sessions are quiet and
  leaves the counted queue pointer visible.
- `tools/fleet/web/src/App.tsx` passes the existing `queueApi` and `refreshNonce` to Questions and
  opens the queue with the single hash write `go("ideas")`.
- `tests/fleet-questions-panel.test.tsx` injects the queue seam in both panel and App helpers, so its
  Questions renders cannot quietly make real queue requests.

## Tests watched red before implementation

I added the four false-reassurance acceptance cases first and ran the focused suite. It reported
20 tests, four failures. Every case still rendered only `Nothing needs you.`:

- **Loading** failed to say that the sessions were observed and quiet or that queued ideas were
  still being read. This proved an unresolved queue request still produced global reassurance.
- **No answer** failed to show the browser-side reason, `the phone lost the reply`, and still
  reassured. This proved a wire failure was being silently collapsed into an empty queue.
- **Unreadable** failed to show the server's reason, `line 4 is malformed`, and still reassured.
  This proved a server-observed file failure was being silently collapsed into an empty queue.
- **Never written** failed to show that no queue file had been written and still reassured. This
  proved the ordinary absence of a file was being treated as a read, empty queue.

I then added the rest of the Stage 3 contract and ran again before changing production code. The
suite reported 25 tests, eight failures and 17 passes:

- The App composition test could not find the count or its Queued ideas control, proving the new
  data and navigation had not been wired through App.
- The readable-empty test found the old reassurance but not the explicit queue measurement,
  proving the sentence was not yet conditional on a queue read.
- The six-reading test found no queue-pointer region, proving none of the queue arms had a rendered
  sentence.
- The lifecycle test counted zero seam calls, proving there was no entry read, refresh read or
  payload-push boundary to exercise.
- The four acceptance cases above remained red for the same reasons.

The explicit `fetch` tripwire was already green in that pre-implementation run: the old panel did
not read the queue at all. Its paired lifecycle test was red at zero calls. After implementation,
the pair establishes that the injected seam is called while global `fetch` is not.

## Verification

- `npx vitest run tests/fleet-questions-panel.test.tsx` — 1 file, 25 tests passed.
- Targeted Biome lint on `QuestionsPanel.tsx`, `App.tsx` and the test — no errors. It reported four
  existing informational findings in `App.tsx` (the function's complexity and three literal-key
  suggestions); none is from this change and none was edited.

## Plan conflicts and work left

Nothing in the binding plan proved wrong or impossible, and none of the prohibited files needed a
change. Per the task, I did no browser work, did not run the full test suite or typecheck, and did
not commit. Nothing else in Stage 3 is left undone.

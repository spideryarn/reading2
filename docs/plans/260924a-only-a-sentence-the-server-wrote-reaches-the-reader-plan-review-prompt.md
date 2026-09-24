# Review: make "a sentence written for the reader" a type in describeFetchFailure, not a hope

Repo: /home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924 (TypeScript, ESM, React 19 client under src/web, vitest). Read CLAUDE.md once for house rules.

## The candidate

Plan review. Live pre-commit: base = current HEAD; the only file is the untracked plan
`docs/plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md`. Other agents are editing
other files in this tree; ignore them.

Start with: the plan, then `src/web/useComments.ts` (`describeFetchFailure`, top of file),
`src/web/lib/api.ts` (`HttpError`, `errorFor`, `failure`, `readJson`, `apiFetch`, `attempt`),
`src/web/lib/sse.ts` (`readEvents`, `StreamStalled`), `src/web/lib/opening-read.ts`, and every caller:
`grep -rn describeFetchFailure src/web`. Also `src/web/monitoring.ts` (`captureClientFailure`) and
`src/monitoring-scrub.ts`, `src/messages.ts` (`CODE_KINDS`, `kindOfMessage`, `worthRetrying`),
docs/project/copy.md. Background: docs/plans/260915a-question-press-answer-does-not-loop.md
§ "Two things the diagnosis turned up" and § Deferred.

## What it is meant to do

After the change, no Error reaches a reader through describeFetchFailure unless (a) it is a
ReaderFacingError (constructed by our code with a sentence for a reader, including HttpError carrying
the server's own `{error}`), (b) it is a StreamStalled, or (c) it was branded at our transport boundary
as a lost connection. Everything else gets one generic "bug"-kind sentence and is reported to Sentry
(message withheld by the scrubber). Existing checks elsewhere on `instanceof TypeError` / "Failed to
fetch" must keep working.

## What you can and cannot run

The tree is read-only. You can run one test file (`npx vitest run tests/<one>.test.ts`) and scripts;
no network or Postgres.

## Attack it

Independently first. The invariant to break: *a string not written for a reader reaches one*, or *a
string that was written for a reader and reaches one today stops reaching them* (a regression — e.g. a
producer the plan missed, a caller that passes errors from outside the helpers, a test mock that
throws plain Errors standing in for server sentences). Also: does the brand survive every path a
transport failure takes to describeFetchFailure (the offline cache fallback in `attempt`, openingRead's
race, readBefore's stall path)? Is kind "bug" right for the generic sentence, given worthRetrying hides
Retry for bug-kind messages in chat? Is reporting to Sentry here going to flood with AbortErrors?

For each finding: ID (F1…), severity P0–P3 (P0 data loss/security/charging/broadly unusable; P1 user-
visible wrong behaviour or authoritative contract violated; P2 design risk, no wrong behaviour today;
P3 prose), established or reasoned, (a) the concrete scenario, (b) the smallest change. Refuse only on
an established P0/P1.

## My own suspicions — read last

1. Tests that `vi.mock` hooks' fetches to reject with plain `new Error("server words")` and assert the
   words appear will go red; that is intended (they now need a ReaderFacingError), but maybe some
   production path does the same thing and I have not found it.
2. The WeakSet brand vs a subclass — is a brand going to be lost somewhere (e.g. an error rethrown as
   a new object)?
3. `chat/effects.ts` line ~197 treats any TypeError mid-stream as a disconnect; I leave that alone.

Do not change any file.

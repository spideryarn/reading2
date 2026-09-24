# Review: only a sentence written for the reader reaches the reader (describeFetchFailure)

Repo: /home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924 (TypeScript, ESM, React 19
client under src/web, vitest). House rules: CLAUDE.md.

## The candidate

Live pre-commit, base fb7eec22. **Other agents are editing OTHER files in this same tree at the same
time — touch only the files listed here.** Nothing is committed; do not commit.

Modified (mine): src/messages.ts, src/monitoring-scrub.ts, src/web/monitoring.ts, src/web/chat/effects.ts,
src/web/lib/api.ts, src/web/lib/opening-read.ts, src/web/lib/sse.ts, src/web/useClaims.ts,
src/web/useComments.ts, src/web/useCriteria.ts, src/web/useMirror.ts, src/web/useSearch.ts,
tests/comments.test.ts, tests/eager-client-graph.test.ts, tests/use-comments-load-state.test.ts,
docs/project/copy.md, docs/project/web-client.md, docs/plans/260915a-question-press-answer-does-not-loop.md,
docs/user-feedback/260912_1120-question-answer-replaced-by-react-error-185.md.
Untracked (mine): src/web/lib/reader-facing.ts, tests/describe-fetch-failure.test.ts,
docs/plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md (+ its plan-review prompt/answer).

`git diff HEAD -- <those paths>` shows the change. Start with: the plan (it has the design, the plan-review
ledger F1–F4 and "What landed"), src/web/lib/reader-facing.ts, `describeFetchFailure` at the top of
src/web/useComments.ts, then src/web/lib/api.ts and src/web/lib/sse.ts. Scope is the whole manifest.

## What it is meant to do

No Error reaches a reader through `describeFetchFailure` unless it is a `StreamStalled`, a
`ReaderFacingError` (incl. `HttpError`), or an error our helpers branded as a transport failure
(`fetch` in apiFetch, `res.text()` in readJson, `reader.read()` in readEvents — TypeErrors only). Anything
else → `PAGE_FAULT` ([web-unexpected], kind bug), console.error, and Sentry with its message withheld
regardless of suffix (`neverAuthored`). Every sentence that reached a reader through these seven callers
before and was written for a reader must still reach them. The brand must not change the error object
(name, message, instanceof TypeError) because other sites read those.

Out of scope (recorded in the plan): the "npm run dev" wording of the couldn't-reach sentence (five
sites); hooks that do not call describeFetchFailure; ChatController's spoken-repair `error.message`.

## What you may change

You may edit this worktree, **only the files in the manifest above** (and new test files if needed). Fix
what is inside this stage — each finding red-first, with the test that reproduces it — and leave anything
wider as a finding for me. Do not commit. List every file you changed at the end.
You can run single test files: `npx vitest run tests/describe-fetch-failure.test.ts` etc. No network or
Postgres; Postgres-backed tests will skip or fail for environment reasons.

## Attack it

Independently first. Invariants to break: (1) a string not written for a reader reaches one through any
of the seven callers; (2) a reader-written sentence that reached a reader before now becomes PAGE_FAULT
(a missed producer — look at every `throw` and every value that flows into a `catch` that calls
describeFetchFailure, including `sink.failed`/`disconnected` paths in chat/effects.ts and the
controller/reducer); (3) a deliberate cancel/abort now shows PAGE_FAULT or floods Sentry; (4) the tests
would stay green with a producer's mark removed.

For each finding: ID continuing from F5, severity P0–P3 (P0 data loss/security/charging/broadly unusable;
P1 user-visible wrong behaviour or authoritative contract violated; P2 design risk, no wrong behaviour
today; P3 prose), established or reasoned, (a) the reproducing input/mutation, (b) the fix (applied, if in
scope). Refuse only on an established P0/P1.

## Previous findings (plan review)

| ID | Finding | Disposition |
|----|---------|-------------|
| F1 | sanitise trusts a code suffix on a foreign message | fixed: `neverAuthored` |
| F2 | askForThreads' deliberate abort reported as a fault | fixed: early return on own signal |
| F3 | programmer-error TypeErrors at transport APIs branded as lost connection | overruled, see plan |
| F4 | readBefore path untested | fixed: one branded catch, test added |

Treat those fixes as unreviewed code.

## My own suspicions — read last

1. Callers that pass an AbortError to describeFetchFailure other than askForThreads (I believe the hooks
   guard with `live`/`aborted` checks, but not verified at every site).
2. `chat/effects.ts` still treats any TypeError mid-stream as a disconnect; now it shows PAGE_FAULT text
   in the disconnected state if unbranded. Acceptable?
3. `PAGE_FAULT` kind "bug" hides Retry in chat — correct for a client fault?

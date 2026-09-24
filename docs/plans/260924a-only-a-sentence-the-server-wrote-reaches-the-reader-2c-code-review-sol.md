Verdict: request changes. Two established P1s remain outside the permitted files, so Stage 2c should not land yet.

## Findings

- **F10 — P1, established, unresolved/wider:** Live voice’s `[live-upstream]` failures now become `UNEXPECTED_FAILURE`. The client therefore no longer converts them to “Live voice is unavailable…” at [useLiveConversation.ts:325](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/live/useLiveConversation.ts:325).
  - Reproduction: make OpenAI’s client-secret request return non-2xx; [live.ts:567](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/live.ts:567) throws `[live-upstream]`, but `handleApi` rejects it as unauthored.
  - Fix: split the diagnostic/provider body from a safe declared reader sentence in `src/live.ts`. Do not merely register `live-upstream`: one branch includes 400 characters of OpenAI’s response body.

- **F11 — P1, established, unresolved/wider:** Job actions still expose raw browser or foreign messages. [useJobs.ts:341](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/useJobs.ts:341) strips the error down to `.message` before calling `jobEngine.actionFailed`.
  - Reproduction: reject add/cancel/retry with branded `TypeError("Load failed")`; `lastFailure` and the engine receive `"Load failed"`.
  - Fix: classify the original error through `describeFetchFailure` in `useJobs`, preserving `statusOf(err)`. That file was outside the allowed set.

- **F12 — P1, established, fixed:** Five intended auth/dictation 5xx codes were absent from `CODE_KINDS`: `auth-down`, `mic-not-set-up`, `mic-unreadable`, `mic-no-upstream`, and `mic-upstream`. I also found the implicit 500 `[live-not-set-up]`.
  - Reproduction: an unavailable verifier returned generic copy; `authoredSentence` returned `null` for every mic code.
  - Fix: registered all six with their intended kinds and added boundary tests.

- **F13 — P1, established, fixed:** Five shelf action catches still passed raw `.message`: archive, undo, rename, archived-list load, and restore.
  - Reproduction: a branded Safari `TypeError("Load failed")` appeared verbatim as `actionError`.
  - Fix: routed every shelf catch through `describeFetchFailure`; each action now has a regression test.

- **F14 — P2, established, fixed:** `throw null` made the new catch throw again while reading `.status`, and `finally` repeated the problem in `chosenByUs`.
  - Reproduction: an injected verifier throwing `null` produced no completed JSON response.
  - Fix: null-safe numeric status/code extraction and a regression test expecting the generic JSON 500.

- **F15 — P2, reasoned, fixed:** Coverage did not prove the positive authored-5xx arm, the admin callers, or the two newly coded throw sites.
  - Added real auth 503 and unchanged 401 tests, admin user/feedback tests, job-engine transport/foreign-error tests, and wiring checks for the shelf/citation 5xx declarations.

The broader audit found no other missed computed-status producer: embedding, provider, Stripe `statusCode`, storage `statusCode`, public-route, webhook, and `guardDbStore` paths are translated or intentionally generic.

## Files I changed

- [src/messages.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/messages.ts)
- [src/routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/routes.ts)
- [src/web/useShelf.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/useShelf.ts)
- [tests/authenticated-api-route-contract.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/authenticated-api-route-contract.test.ts)
- [tests/describe-fetch-failure.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/describe-fetch-failure.test.ts)
- [tests/job-engine-auth-pause.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/job-engine-auth-pause.test.ts)
- [tests/shelf-cached-paint.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/shelf-cached-paint.test.tsx)
- [docs/project/copy.md](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/project/copy.md)
- [docs/plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md)

The copy doc previously said mic codes were absent from `CODE_KINDS`; it now distinguishes locally declared sentences from server-side codes that must be registered. The plan’s audit now includes computed and implicit 5xx paths.

## Verification

- Focused suite: 400 tests passed.
- Broader affected unit suite: 416 tests passed.
- All four TypeScript projects passed direct `tsc --noEmit`.
- Biome: no errors; four existing complexity advisories in `routes.ts`.
- `git diff --check`: clean.
- Full `npm test` and `owner-isolation` could not run because the sandbox cannot reach/probe the local Postgres Docker service.
- No commit made.
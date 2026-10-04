**Verdict: build with changes.** No P0/P1 security blocker found. The shared streaming guard is sound; the memory justification needs qualification, and the regression checks should cover broken streams.

Baseline evidence below refers to HEAD `1fff192f8`; another agent changed implementation files during this review. I made no edits.

1. **The 50 MiB cap remains a useful defence, but it does not prove Vercel memory safety.**

   The counter measures decompressed bytes, rejects before retaining the overflowing chunk, cancels on failure, and joins accepted chunks into one output buffer ([src/fetch.ts:1150](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/fetch.ts:1150), at HEAD). Raising the cap increases the approximate retained payload plus joined copy from 64 to 100 MiB. That excludes chunk metadata, read-ahead, HTML decoding, parsing and concurrent jobs.

   Uploads already admit the same 50 MiB PDF/HTML payloads into the downstream pipeline ([src/pipeline.ts:1639](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/pipeline.ts:1639), at HEAD). URLs additionally involve an untrusted remote stream and HTTP decompression. Those mechanisms already exist at 32 MiB; this change increases their allowed workload rather than introducing a new attack class.

   **F1 — P2:** Correct the claim that the cited 608–632 MB measurement establishes safety for a 50 MiB import. It measured 69 chunks of one particular Kuhn paper ([src/pdf-read.ts:255](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/pdf-read.ts:255)); the same file explicitly says the deployed Vercel memory ceiling remains unconfirmed ([src/pdf-read.ts:307](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/pdf-read.ts:307)). State the bounded payload increase and existing downstream exposure without claiming measured capacity.

   **The default-caller claim is true for production callers.** Pipeline document acquisition omits `maxBytes`. Other callers supply caps: chat 4 MiB ([src/chat-tools.ts:1065](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/chat-tools.ts:1065)), previews 1 MiB ([src/link-previews.ts:668](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/link-previews.ts:668)), paper text 15 MiB ([src/paper-text.ts:411](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/paper-text.ts:411)), assets require a caller cap, bibliography fixes 1 MiB, and the Debate fallback supplies its budget. Literally across the repository, the evaluation script also intentionally uses the default ([scripts/eval-big-imports.ts:1235](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/scripts/eval-big-imports.ts:1235)). `fetchHtml` has no production caller.

2. **Yes: the baseline too-large failure becomes generic and retryable on the job card.**

   `FetchFailure` has `retryable`, but neither `failureKind` nor `readerFailure`. `failureKindOf` reads only the latter kind field or registered message codes; `readerFailureOf` consequently falls back to `"retry"` ([src/job-failure.ts:314](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/job-failure.ts:314), [src/job-failure.ts:401](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/job-failure.ts:401)). Jobs persist that generic sentence and undeclared kind ([src/jobs.ts:1392](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/jobs.ts:1392)); an absent kind permits Retry ([src/job-failure.ts:419](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/job-failure.ts:419)). The proposed `stageFailure(FETCH_TOO_BIG)` fixes this correctly.

3. **Moving the counter to a leaf and using it in Storage `get()` is safe if its existing failure semantics survive.**

   Callers require complete `Uint8Array` bytes or an exception, not `arrayBuffer()` specifically. Both classifiers use a subsequent `head()` measurement rather than parsing error text: `overlongObject` ([src/fetch.ts:559](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/fetch.ts:559), at HEAD) and `RawObjectTooLarge` ([src/store/raw-document.ts:164](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/store/raw-document.ts:164)). The streaming diagnostic may therefore report **“at least N bytes”** instead of the final object length.

   **F2 — P2:** Add an adapter-level broken-stream regression alongside the over-cap test. Preserve the original read/abort error, cancellation and lock release; never turn every read failure into “too large.” Also verify ordered multichunk bytes, exact-cap acceptance and omitted-`maxBytes` behaviour. Existing classification tests mostly use fake stores, so they do not exercise the new adapter path ([tests/stage2c-raw-bytes.test.ts:316](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/tests/stage2c-raw-bytes.test.ts:316)).

4. **No new import cycle or client-bundle problem is implied.**

   `fetch.ts` already imports `uploads.ts`, which has no imports. `messages.ts` already imports `MAX_UPLOAD_BYTES` ([src/messages.ts:35](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/messages.ts:35)). Keep the counter import-free and inject its error factory; Storage must not import `fetch.ts`, and the shared message module must not import it either.

5. **The documentation sweep needs a few additional targets.**

   **F3 — P2:** Include the active “Our cap is 32 MB” statement in [docs/project/original-version/extraction.md:67](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/docs/project/original-version/extraction.md:67), plus current-cap references in `paper-text.ts`, `store/raw-document.ts`, `store/pg-source.ts` and `store/public-library.ts`. Historical measurements should retain their original numbers. Independent 32 MiB artifact/image/PDF-parser limits should retain theirs too.

   Existing fetch tests do **not** pin the default to 32 MiB; they assert it exceeds the representative 4.9 MB PDF ([tests/fetch.test.ts:1510](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/tests/fetch.test.ts:1510)). The planned constant-equality assertion is appropriate.

A targeted run against the concurrently edited worktree produced 131 passes and one sandbox failure: `client-imports.test.ts` could not create its fixture on the read-only filesystem. It was not a baseline reproduction or a complete green gate.
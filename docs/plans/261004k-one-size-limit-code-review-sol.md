**Verdict: ship with the fixes made.** No commit made. No P0 findings.

Fixed findings:

- **P1 — [src/store/blobs-supabase.ts:164](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/store/blobs-supabase.ts:164):** Omitted caps left production image and legacy-document reads unbounded. Missing or invalid caps now default to `MAX_UPLOAD_BYTES`; every successful read uses the counter. Explicit limits remain supported, with a bounded allowance for legacy HTML’s UTF-8 expansion.
- **P2 — [src/store/blobs-supabase.ts:170](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/store/blobs-supabase.ts:170):** Header refusal could leave a cancellation rejection unhandled. It now awaits cancellation and preserves the size error.
- **P2 — [src/messages.ts:2142](/home/greg/code/spideryarn2/.claude/worktrees/one-size-limit-upload-and-address/src/messages.ts:2142):** The sentence wrongly predicted that mutable URL content would always have the same size. It now refers to retrying the same document, retaining `blocked`.

The extracted counter preserves inclusive limits, cancellation, lock release and original errors. The pipeline matches only `FetchFailure("too-large")`; Stop and deadline handling remain separate. Its authored diagnostic contains no URL or original-error cause. Registration and client handling are complete, and other callers retain their tighter caps. Docs and regression coverage were updated.

Evidence:

- Requested three suites: **152 tests passed**.
- Including registry and doc-link checks: **196 tests passed**.
- Reverting defaults and removing classification, cancellation or lock release produced the expected failures; the mocks are not vacuous.
- Typechecking passed all four projects via `node --import tsx scripts/typecheck.ts`. `npm run typecheck` itself was blocked by the sandbox’s IPC restriction.
- Full `npm test` was blocked by local-database access. Lint reported existing pipeline warnings.

Wider decisions for the author:

- **P2 — `src/read-capped.ts:34,57`:** This bounds document bytes, not total memory: joining duplicates the payload, and chunk metadata adds overhead.
- **P2 — `src/store/raw-document.ts:152`:** Review the fixed 50 MiB stored-object ceiling alongside HTML’s UTF-8 expansion.
- **P2 — `src/store/blobs.ts:261`:** A filesystem fallback still exists and buffers whole files, contrary to the repository instructions.
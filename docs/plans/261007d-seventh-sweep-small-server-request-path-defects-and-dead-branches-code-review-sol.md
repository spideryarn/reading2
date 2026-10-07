**Verdict: ship with these fixes applied.** Changes are uncommitted. Postgres verification remains unrun.

- **C1 — P1: streamed failures lost their log severity.** Input: a handler throws after sending 200 headers. **Reproduced:** four assertions failed because the request logged at `info`. **Fixed:** severity follows the mapped failure status; the recorded HTTP status remains 200. Faults log at `error`, refusals at `warn`, successful streams at `info`. `serve-api-after-headers.test.ts`: **7 passed**.

- **C2 — P1: SVO5 changed an unpublished minimal paper’s refusal.** Input: search/referee POST after article creation but before its first revision is published. **Reasoned and reproduced at the loader:** the deleted gate returned 409; the revision join returned 404. **Fixed:** only a missing revision triggers the existing owner-scoped processing lookup. Successful reads retain the query saving. Pure regression: **3 passed**, with the minimal case red first. Two Postgres route cases check 409, ownership and zero written runs; **unrun**.

- **C3 — P1: Stop racing an upload claim returned 409.** Input: Stop wins between the initial lookup and claim. **Reasoned:** Stop stores `expired`, and the earlier lookup already answers that state with 410. **Fixed:** the requested one-line classification and pinned-test change, using the existing sentence. `uploads-api.test.ts`: **unrun**.

- **C4 — P3: comments asserted nonexistent code or incorrect behavior.** **Reasoned; fixed:** current filesystem counterparts, `sameMark`, constant public-comment status, upload race reachability, `noteSlug` timing, and the blanket explanation of SQLSTATE 23503. `readSketchFile` still exists and rejects empty scenes; that reference remains. No separate runtime test needed.

The remaining audit found:

- **SVO2:** all three callers treat `null` as 404 before writing. Audited **83 UUID columns**; no unguarded request-body UUID path found.
- **SVO6/SVO14:** the deletions preserve the inspected behavior.
- **SVO5:** neither search nor referee clients branch on the added `paper` field.
- **Item 7:** no downstream branch changes from the six typed errors. Messages and response fields remain unchanged. The route opt-in was left unbuilt.

Characterization limits matter: malformed-ID cases alone could pass with an always-null lookup; forced comment collisions do not prove concurrent minting behavior; the original minimal-paper cases missed pre-publication; upload tests using one owner could miss incorrect owner attribution, and forced expiry proves translation rather than store classification. The six artefact route checks could also accept changed wording matching their regex. These were checked against code rather than treated as complete proofs.

Files changed:

- `src/routes.ts`, `src/public-types.ts`
- `src/store/pg.ts`, `pg-comments.ts`, `pg-uploads.ts`
- `tests/serve-api-after-headers.test.ts`, `uploads-api.test.ts`, `minimal-paper.test.ts`, new `unpublished-minimal-paper.test.ts`
- The stage plan, `docs/project/sentry-error-monitoring.md`, and new `docs/postmortems/261007d-the-tested-state-is-not-the-whole-lifecycle.md`

Verification:

- Red runs: **4 failed / 3 passed**, then **1 failed / 2 passed**.
- Final pure tests: **270 passed, 0 failed, 8 files**.
- Typecheck: **4 projects passed; 3,362 source files covered**. The npm wrapper hit sandbox IPC restrictions; direct execution passed.
- Lint: **9 files, 0 errors, 7 existing informational notes**.
- `git diff --check`: clean.
- **No Postgres suites or `npm test` run.**

Wider note: search and referee handlers can close without a terminal frame when result storage fails. This predates the stage and remains unchanged. The new guard ends unfinished responses; I found no path where it leaves such a stream open indefinitely.
Stage 2 had five established P1 defects; all are fixed. No commits or `*-sol.md` edits.

- **F8 — P1, established, fixed:** Fuller rendered an empty band after job completion while the stored read was pending. [SimplePanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/web/SimplePanel.tsx:241) now shows a waiting message and a read-only retry. The new panel test failed first, then passed.

- **F9 — P1, established, fixed:** Retrying a failed completion read temporarily hid the remembered Brief because status became `loading`. The panel now preserves it whenever no stored summary exists. The new test reproduced missing paragraphs, then passed.

- **F10 — P1, established, fixed:** Deadline pause, expiry, requeue and cancellation could retain previews on settled steps. The runner cleared its local object, but SQL rebuilt steps from the persisted row. [pg-jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/store/pg-jobs.ts:1022) now removes previews through the shared settlement expression. Three SQL-generation tests failed before the fix and passed afterward. Six database row cases were added but **not run**.

- **F11 — P1, established, fixed:** Requeueing the same job retained the previous attempt’s Brief. [useSimple.ts](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/web/useSimple.ts:139) now distinguishes attempts using `requeues` and accepts live previews only from running steps. The reproduction went red then green. A preservation test also ensures Brief remains when `simple` is already done and only a later step pauses.

- **F12 — P1, established, fixed:** An unforced job could rewrite a usable summary when its stored model differed from today’s expected model. That contradicted the same-article preservation rule. [pipeline.ts](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/pipeline.ts:4211) now adopts the stored model alongside the stored prompt version. The different-generation test went red then green; changing the article hash still requires a rewrite. The freshness test now pins this deliberate queue/Metadata disagreement.

- **F13 — P2, reasoned, fixed:** The ledger inferred that any latency effect was smaller than the observed spread. Six samples per arm cannot establish that bound. It also omitted that the 63.5-second 350-word run retried Fuller after a fidelity flag; none of the 500-word runs retried. I corrected the [ledger](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/docs/plans/261004f-stop-writing-the-simple-summary-level.md:408) and summaries doc using the raw results. Brief’s medians are **15.6 and 14.3 seconds**, rather than values calculated from rounded entries.

The other claims held:

- Preview writes are drained before ordinary settlement, and their failures are swallowed. I found no established visitor or logging leak.
- `keptPreview`’s identity comparison causes an extra render per poll, but does not loop: the next render sees the same snapshot.
- A usable legacy row without `promptVersion` already skips when its article matches; that is consistent with the rule.
- Brief matches `1698c6448` **byte for byte**: 9,146 bytes, SHA-256 `d492501b13ddd81832463165032a53d486727e65072299eb6da23b76a5bd9595`. Fuller requests about 500 words in five to eight paragraphs; the version is `/8`.
- The new status strings preserve the job failure’s existing reason and retry policy. S2’s existing forced rewrite controls remain unchanged and still need Greg’s product decision.

The required three suites passed, as did the new SQL suite and doc-links: **206 tests across five files**. Typecheck passed. Lint reported only existing findings.

Please rerun **jobs-walk, stage-stamp-agreement, freshness-deciders-agree and store-jobs-parity** with Postgres. I changed code they cover, and changed the latter two test files; none is reported as passing here.

The root-cause write-up is in the [postmortem](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/docs/postmortems/261004j-a-preview-spans-two-lifetimes-but-only-ordinary-endings-were-tested.md).

**Verdict: approve within stage 2.**
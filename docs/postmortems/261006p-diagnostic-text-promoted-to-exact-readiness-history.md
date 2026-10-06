# Diagnostic text promoted to exact readiness history

Review of `73d6be783` (2026-10-06), before landing. Area:
[readiness](../project/readiness.md); plan:
[261006m](../plans/261006m-seventh-sweep-readiness-records-name-the-failing-test-files.md).

The scanner assumed that after Vitest's failure heading, every line beginning ` FAIL ` belonged to
the reporter. A real one-test run throwing an error that quoted child output disproved it: the
scanner named the quoted file too, reporting two files against Vitest's one. Splitting names on
whitespace also reinterpreted `tests/my file.test.ts` as `file.test.ts`. A truncated summary could
return a subset with an exact-looking total. All were introduced by `73d6be783`.

The class is **diagnostic text promoted to structured metadata, then partial observations promoted
to exact history**. Fixture comparisons covered ordinary reporter output but not quoted reporter
output. The panel repeated the assumption: latest *named* run became latest run; capped occurrence
times became first/last failures; tied hidden rows became older failures.

The narrow fix preserves reporter badge delimiters, requires complete error groups and agreement
with the streamed failed-file tally by project/path, and returns unknown for ambiguous diagnostics.
The panel labels listed observations and counts unnamed failures when finding the latest run.
The new fixture is a real stderr capture; tests in `tests/readiness-failed-files-review.test.ts`
and `tests/fleet-readiness-failing-files.test.tsx` were observed failing before their fixes.

Countermeasures, ranked by ease against value:

1. **Quote the protocol inside an ordinary error, and truncate a valid capture.** Cheap negative
   controls; added here. They catch the class that ordinary happy-shape fixtures cannot.
2. **Reconcile complete observations with independent totals and label partial history.** Small
   stage changes; implemented. File-task totals need project identities, not just path counts.
3. **Use a structured Vitest reporter artefact.** The long-term source for authenticated reporter
   metadata rather than text that tests can reproduce. Deferred: it changes the suite's reporting
   and artefact lifecycle beyond this review. Text checks cannot prove provenance against a test
   deliberately reproducing an entire reporter transcript.

Verdicts remain independent of this metadata. The review's own sandbox rejects child execution with
`EPERM`, so the subprocess wrapper tests were rerun outside it before the fixes were committed, and
passed.

Found and fixed two correctness issues:

- `spent` survived after Discard, allowing a recovered recording to replace the discarded session’s rough words. Retry metadata now clears when idle without a retry offer.
- The unique-occurrence fallback could replace reader-authored short text such as “yes.” Relocation now requires matching surrounding context or a distinctive multi-word phrase.

Added red-then-green regressions in [dictation-retry-replaces-rough-words.test.tsx](/var/tmp/spideryarn-worktrees/qxkryezr-dictation-retry/tests/dictation-retry-replaces-rough-words.test.tsx:340).

Checks:

- Dictation suite: 408 passed.
- Typecheck: passed via `node --import tsx scripts/typecheck.ts`.
- Touched-file lint: no new errors; existing `useDictation.ts` advisories remain.
- Full `npm test`: could not start because the local Postgres service was unavailable (`EPERM` connecting to port 54362).

Device restart, refused press, moved/back, multipart, elsewhere-box, `doneKey`, and serialized autosave paths show no remaining double-insertion route.

**Verdict:** Ready after the two in-scope fixes; no remaining blocking findings.
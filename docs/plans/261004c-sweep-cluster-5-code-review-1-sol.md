Three fixes are left uncommitted. Stages 2a and 2c are untouched.

- **F13 — P1, fixed:** Sketch and Illustrated hid failed revalidations after an earlier 404. Both now show the sentence and retry. Two transition tests were red before the fix.
- **F14 — P1, fixed:** Ideas, Quotes, Glossary and Quiz queued artefact replacement before a field access could throw, erasing loaded content on malformed revalidation. Fields are now derived before publication. Four tests were red before the fix.
- **F15 — P2, fixed:** Shared error markup introduced Glossary’s highlight colour into Diagram. A scoped rule restores grey for both pictures. The stylesheet test was red first.
- **F16 — P2, reported wider:** Non-null malformed artefacts can still pass unchecked response casts. Broader runtime validation remains outside this repair.
- **F17 — P1, reported wider:** Thread’s retained recheck branch leaves `status` at `loading` when a retry fails after an earlier 404. Independently reproduced; documented in the [postmortem](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c5-failed-read/docs/postmortems/261004f-a-previous-404-cannot-settle-the-next-failed-retry.md).

The adapted mocks preserve their intended checks. The four HTTP fallbacks contain authored text; `setHidden` wraps classified reader copy. `PAGE_FAULT` is appropriate for unbranded body-consumer exceptions. The static exclusions match the code.

Validation passed: **31 files / 972 tests**, final core **117 tests**, doc links **16 tests**, and typechecking through the same script using Node’s loader. Lint retains existing diagnostics. The added scan test confirms that the deadline covers a stalled body and rejects late completion.

Still requested: full `npm test` on a Postgres-capable host.

LAND WITH THE FIXES ABOVE
# A narrowed reader guard does not validate a wider historical report

Up: [postmortems.md](../project/postmortems.md) · area: [summaries.md](../project/summaries.md)

Found in the stage-1 review of [261004f](../plans/261004f-stop-writing-the-simple-summary-level.md).
Introduced by `c9900a0e25241a36a7a114581a7620b8796c01d7`.

The reader correctly stopped validating the removed middle level. The historical check report
still consumed that level, but reused the reader's narrowed guard and cast the extra check to
`SimpleLevelCheck`. A malformed middle check could then count as an answered check, corrupt a
failure tally, or throw. A missing middle check could silently reduce a historical record to
two levels. Valid reader content and valid diagnostic evidence are different boundaries.

The class is **a narrowed validation boundary reused by a wider historical consumer**. Narrowing
the type made the cast compile without validating the legacy field it recovered.

The fix validates the optional historical level and check together at the report boundary,
using the existing `isLevelCheck` guard from [types.ts](../../src/types.ts). Invalid records use
the report's existing unusable-record count. Reader compatibility and stored JSON are unchanged.

What would catch the class, ranked by ease against value:

1. Exercise the wider consumer with valid current and historical records, malformed historical
   fields, missing checks, and flags beyond the stored text. Done in
   [simple-check-report.test.ts](../../tests/simple-check-report.test.ts): the report is run
   against stubbed query results, and its actual output is checked. Five cases failed before
   the first fix; the missing-check case failed before the follow-up fix.
2. When narrowing a guard, inspect consumers that cast extra fields back into the old type.
   The report's separate validation documents why reader acceptance is insufficient.
3. Reject all historical rows with malformed unused levels at the reader boundary: rejected,
   because diagnostic validity should not make usable Brief and Fuller text disappear.

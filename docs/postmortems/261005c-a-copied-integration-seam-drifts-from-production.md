# A copied integration seam drifts from production

Up: [postmortems.md](../project/postmortems.md).

`ReaderNavHarness` was introduced in `8a0125438` to exercise Dock's navigation
through nuqs. It copied Reader's setter selection. In `805e394c4`, Reader gained
the atomic return to retained Quiz, but the harness retained the old setter:
its plain Remember button still carried a Chat thread into Quiz.

The class is **a copied integration seam drifts from production**. The tests were
still green because the harness exercised explicit sub-mode rows, whose setter
had not changed. The new plain-return assertion failed with the retained thread
before updating the harness. Root cause checked in a separate agent.

The scoped fix makes the harness use `returnToSubMode` as production does and
adds the missing plain-return case. The stronger long-term evidence is the
existing real-App test in
[`tests/sub-mode-param-outlives-its-mode.test.tsx`](../../tests/sub-mode-param-outlives-its-mode.test.tsx),
which sees Quiz's first render and the history write without copying Reader.
The harness discrepancy is a test-maintenance defect, not evidence that the
reviewed production navigation was wrong.

Countermeasures, ranked by ease against value:

1. Add the newly changed route to the harness's assertions: implemented.
2. Check the contract through the real composition root: already present.
3. Replacing every Dock test with a full application mount is rejected: most
   exercise Dock's own rows, and do not need the reader's unrelated controllers.

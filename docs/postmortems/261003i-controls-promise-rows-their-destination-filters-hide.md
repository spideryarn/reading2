# Controls promise rows their destination filters hide

Up: [postmortems.md](../project/postmortems.md)

Review of `4b502174a` caught two Debate regressions: the Reception handoff advertised stored Claims
rows while retaining filters that could show none; Reception offered order buttons whose distinction
depended on rows outside the selected thread. Production impact has not been established.

## The class: a control promises a different row set from its destination

The split introduced three legitimate sets: stored rows, relevance-visible rows, and thread-visible
rows. The segments and lists read final visible sets; the handoff read `claimRows.length` while its
press retained the filters. Order capability read stored sections while the displayed list narrowed
them first. Both choices were introduced by `4b502174a`.

The original handoff tests used no restrictive settings. Pure order tests were correct about their
input arrays, but could not check which arrays the panel supplied. Thread tests checked membership
without checking order capability. All seven requested review suites passed, 353 tests, before new
composition tests failed on the candidate.

The fix derives Reception order capability and effective order from its thread-visible sections.
The explicit handoff clears Claims' relevance and thread, fulfilling its advertised stored count;
ordinary segment selection preserves filters. Regression tests live in
[debate-panel.test.tsx](../../tests/reception-and-claims-panel.test.tsx), with real router, nuqs and DTO coverage in
[debate-navigation.test.tsx](../../tests/reception-navigation.test.tsx). Root-cause analysis was checked
by a read-only subagent.

Countermeasures, ranked by ease against value:

1. Compare a control's promise with its destination under restrictive settings, using the actual
   view. Added; cheap, and catches correct helpers composed with the wrong input.
2. Exercise reset and normal navigation separately. Added; the stored-findings handoff deliberately
   clears filters, while a sub-mode switch preserves them.
3. Require every control to share one generic row-set abstraction. Rejected: stored counts remain
   necessary for findings and disabled threads; a universal rule would erase useful distinctions.

The review also restored the explicit absence-of-relevance disclosure on unjudged claim rows.
Sorting them last under each claim preserved their position but erased the former group's
explanation. Those rows survive every bar; their local AI line now says why no relevance judgment
is shown. The regression covers a mixed list at `directly` and an entirely legacy list.

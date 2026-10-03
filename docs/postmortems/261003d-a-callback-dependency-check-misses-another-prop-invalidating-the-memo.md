# A callback dependency check misses another prop invalidating the memo

Up: [postmortems.md](../project/postmortems.md). Found while reviewing
[261003j](../plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md), candidate
`dd80f1158`, before this review approved landing. No production impact was measured.

The accepted F2 required a reach-only update to leave `TableView`'s render count unchanged.
The candidate fixed `selectProse` and tested its dependency list. With marginalia open, however,
`marginNotes` still depended on the fresh owner capability object and rebuilt the map passed to
the memoised table. A behavioral test saw the render count rise from one to two.

The class is **checking one prop's stability as evidence that a memo holds**. Memoisation depends
on every prop: a source check of the corrected callback could not see the other invalidation.
`18eaf5951` introduced the marginalia dependency; `dd80f1158` increased its frequency by adding
reach updates and claimed to satisfy F2 without testing the composition.

The narrow and long-term fix is the same: depend on the ownership boolean that this memo reads,
rather than the whole capability. The review also corrected the candidate's Help claim that no
shading proves no reading: recorded time below the 0.35 threshold draws nothing.

Countermeasures, ranked by ease against value:

1. **Exercise the real parent with a memoised child probe.** Implemented in
   [spine-reading.test.ts](../../tests/spine-reading.test.ts), replacing both Reader source-text
   checks. It covers reach/levels wiring and render counts with marginalia on and off.
2. **Assert the fixture reaches the branch.** The marginalia test requires a map, and the plain
   test requires null; both require an initial table render.
3. **A browser performance trace for every callback edit** was rejected for this regression:
   render-count failure is deterministic without a server. Browser paint checks remain useful
   for the chart's colour and stroke, which this test cannot establish.

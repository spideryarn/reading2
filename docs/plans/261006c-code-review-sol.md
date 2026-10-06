No blocking runtime defect found. Only the plan was edited; nothing committed.

- **C1 — P2 — [plan:51](docs/plans/261006c-the-title-follows-the-prose-below-1600px-with-the-marginalia-column-on.md:51): Fixed.** The unchanged left edge at 612px applies to the measured 16px root with the rail on. Smaller roots can move the title left. Also corrected the column’s appearance threshold for each rail state.
- **C2 — P2 — [plan:107](docs/plans/261006c-the-title-follows-the-prose-below-1600px-with-the-marginalia-column-on.md:107): Fixed.** “Wraps at the prose’s width” overstated equality: the masthead and prose have different gutters, and title controls consume additional space.
- **C3 — P3 — [measurement script:22](output/qi-kfmr6j93/measure.mjs:22): Script unchanged; limitation documented.** Its simulation gates on viewport width, while the old code used fitted page width. It cannot establish the old behavior when scrollbar or safe-area deductions cross 1600px.

The 45 focused tests and typecheck passed. Comparing the actual parent helper across 215,352 cases exposed 14,349 old-gate mismatches and zero candidate mismatches. Broader tests were refused by the memory guard; no additional tests ran. Browser checks were not rerun.

VERDICT: land
**Do not ship.** I would leave Brief at 80/130 on the reported evidence.

This review is incomplete: `/var/tmp/spideryarn-heavy.lock` blocked every queued read and validation command. The findings below use the candidate diff and its reported counts; I could not independently verify scores, result metadata, hashes, or tests.

- **F11 — P1: The “not padded” bar is not established.** The reported padding judgments favor the old Brief: 100 was flagged in five pairs versus two for the old. A control preference split of 4–1 does not establish equivalence or explain those flags as chance. **Fixed:** removed those assurances from all three docs and the source comment. The 100/150 choice remains unchanged.

- **F12 — P2: Rejecting 90 uses inconsistent reasoning.** The investigation dismisses 3–8 as possible noise, then uses it to classify 90 as worse and select 100. **Fixed:** described both tallies as descriptive results and choosing 100 as a product judgment.

- **F13 — P2: Increasing Brief for every piece is not supported by the stated subgroup results.** The book favored the old Brief in four comparisons across both new arms; shorter pieces leaned toward 100 by 5–2. Content-based reasons remain relevant outcomes. Neither a universal increase nor a shorter-pieces-only policy is established. **Fixed:** removed the dismissal of the book result and the claim that the increase costs nothing discernible. I recommend retaining the old length.

Changed files:

- [Investigation](/var/tmp/spideryarn-worktrees/brief-slightly-longer/docs/investigations/261005a-summary-length-bands-measured.md)
- [Plan](/var/tmp/spideryarn-worktrees/brief-slightly-longer/docs/plans/261005b-summary-length-follows-the-length-of-the-piece.md)
- [Summary documentation](/var/tmp/spideryarn-worktrees/brief-slightly-longer/docs/project/summaries.md)
- [Source comments only](/var/tmp/spideryarn-worktrees/brief-slightly-longer/src/simple-summary.ts)

No commit made. Raw evidence verification and test results remain pending.
P0: none.

P1:

- Malformed figure labels were silently invisible. Lowercase `figure a` and plural `FIGURES A` were neither attached nor faulted, recreating the feature’s central “named but not handed” failure. Fixed without normalising model output: malformed mentions are now faulted, while only exact offered labels attach. [illustrated-plate.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5x-diagram-paper-figures/src/illustrated-plate.ts:1118), [test](/home/greg/code/spideryarn2/.claude/worktrees/fb5x-diagram-paper-figures/tests/illustrated-plate.test.ts:666).

P2:

- A late figure lookup miss was silently dropped while the artefact still claimed the figure had been sent. Fixed by comparing label, block, hash, and extension at attachment time, faulting mismatches, and removing them from the stored plate record. References and envelope numbering now derive from that same final list. [illustrated.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5x-diagram-paper-figures/src/illustrated.ts:1207), [test](/home/greg/code/spideryarn2/.claude/worktrees/fb5x-diagram-paper-figures/tests/illustrated-run.test.ts:833).

- Stored artefacts accepted unlimited and duplicate figure records, although a fresh brief permits at most three unique labels. Fixed by bounding the read and dropping duplicate labels with faults. [illustrated-plate.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5x-diagram-paper-figures/src/illustrated-plate.ts:1155), [test](/home/greg/code/spideryarn2/.claude/worktrees/fb5x-diagram-paper-figures/tests/illustrated-plate.test.ts:743).

- Two new tests used unsafe optional chaining that could mask a missing brief call with a `TypeError`. Fixed by preserving `undefined` through the request access. I also corrected three comments that incorrectly referred to a nonexistent `illustrated/5` bump. [illustrated-run.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5x-diagram-paper-figures/tests/illustrated-run.test.ts:789), [pipeline.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5x-diagram-paper-figures/src/pipeline.ts:3975).

No other P2 findings. The no-figure requests and fingerprint remain unchanged; all three freshness sites use `figuresFingerprint`; attachment ordering and numbering share one list; unreadable bytes are contained; logging contains counts but no captions; and the cross-block duplicate-ref rule is preserved.

Verification:

- Focused unit tests: 101 passed.
- All four TypeScript projects passed `tsc --noEmit`.
- Scoped Biome check: no new errors.
- `illustrated-pg.test.ts` could not run because this sandbox refuses localhost database access with `EPERM`; no test assertion failed.
- No commit made.
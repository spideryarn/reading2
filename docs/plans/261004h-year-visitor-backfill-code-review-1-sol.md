- **F7 — P1, fixed:** An agreeing registry response with no usable date erased a minimal paper’s confirmed year during “Read this”. [The merge now preserves it](/home/greg/code/spideryarn2/.claude/worktrees/paper-year-visitor-backfill/src/article-registry.ts:223). Registry and real-extract regressions failed first, then passed. They also verify that ordinary re-extraction drops the old year and a newly supplied date wins.
- **F8 — P2, reported only:** [Debate’s marker](/home/greg/code/spideryarn2/.claude/worktrees/paper-year-visitor-backfill/src/web/reader/Reader.tsx:1876) still reads only `publishedAt`, ignoring year-only and public publication dates. This is a wider consumer follow-up; Shelf and Metadata work as specified. Source trace plus the existing Debate unit suite support this finding.

No additional public-field exposure or day/year constraint failure found. The widening assignment preserves fields at runtime. Invalid registry days safely fall back to independently validated years.

Validation: **416 tests passed across 11 suites**, including both requested files; typecheck passed. Lint reported two advisory findings. Postgres checks were not rerun.

No migration changes, stage 2 edits, or commits. [Postmortem](/home/greg/code/spideryarn2/.claude/worktrees/paper-year-visitor-backfill/docs/postmortems/261004k-a-coarser-fact-loses-the-carry-policy-of-its-precise-sibling.md) added.

**Verdict: approve stage 1 with F7 fixed; F8 is nonblocking.**
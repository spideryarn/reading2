## Findings

- **C1 — P1 — Stored matter ignored its rule version.** A `matter/1` result with a matching block hash was displayed and considered settled after safety rules changed. Evidence: [matter-step.ts](/var/tmp/spideryarn-worktrees/fbftsqsn-front-matter-folded/src/matter-step.ts:194). **FIXED:** require the current version at both read and successor boundaries, bump to `matter/2`, and add unit/database regression tests.

- **C2 — P1 — Several admission paths could fold article prose.** Abstract and keyword labels could absorb later unheaded prose; one prose paragraph could ride inside references; DOI-bearing prose, broad “support/contribution” language, an arbitrary first heading, and any three-word opening could satisfy evidence. Evidence: [matter.ts](/var/tmp/spideryarn-worktrees/fbftsqsn-front-matter-folded/src/matter.ts:626), [matter.ts](/var/tmp/spideryarn-worktrees/fbftsqsn-front-matter-folded/src/matter.ts:756), with adversarial cases in [matter.test.ts](/var/tmp/spideryarn-worktrees/fbftsqsn-front-matter-folded/tests/matter.test.ts:303). **FIXED:** bounded unstructured abstracts and keywords to one body block, strengthened title/date/office evidence, and split references around every non-reference or footnote block. All new tests failed before the fixes and pass afterward.

- **C3 — P1 — A trailing stretch could leave `?at=` naming a hidden block.** When the block before trailing references was inside a real fold, `visibleNear` returned that hidden block rather than the visible fold heading. Evidence: [fold.ts](/var/tmp/spideryarn-worktrees/fbftsqsn-front-matter-folded/src/web/fold.ts:589). **FIXED:** walk backward over shut stretches and echoes, and map fold-hidden predecessors through `visibleFrom`; regression test at [fold-front-matter.test.ts](/var/tmp/spideryarn-worktrees/fbftsqsn-front-matter-folded/tests/fold-front-matter.test.ts:359).

- **C4 — P2 — The no-author registry exception cannot disambiguate two genuinely different works with identical full titles.** It does reject prefixes, suffixes, replies, operator differences, printed IDs, and non-page IDs; acceptance requires both a page-origin identifier and complete normalized title equality. Evidence: [article-registry.ts](/var/tmp/spideryarn-worktrees/fbftsqsn-front-matter-folded/src/article-registry.ts:112), [article-registry.ts](/var/tmp/spideryarn-worktrees/fbftsqsn-front-matter-folded/src/article-registry.ts:228). **NOT FIXED:** this is the accepted Stage 4 product trade-off. Eliminating it requires another first-party author signal or abandoning registry-derived authors for authorless pages.

- **C5 — P2 — The central safety validator remains hard to audit.** Biome reports cognitive complexity 73 for `stretchEvidence` and 31 for `holdStretches`. **NOT FIXED:** propose a follow-up splitting per-kind evidence into independent validators; doing that during this safety review would add unnecessary behavioral risk.

- **C6 — P3 — `admitMatter` violated Biome’s iterable-callback rule.** Evidence: [matter.ts](/var/tmp/spideryarn-worktrees/fbftsqsn-front-matter-folded/src/matter.ts:1136). **FIXED:** replaced the returning `forEach` callback with an explicit loop; also cleared two template-literal advisories.

Confirmed without findings:

- Range ordering and containment use block-array indices, not ID comparison.
- The successor cannot loop: only a publication whose job cut blocks queues it.
- Explicit jumps reveal stretches; Structure opens every wholly covered stretch.
- `matter` is absent from the feature diff for `src/public/dto.ts`; visitors retain the old rule, and no model-authored text is rendered.
- Existing tests exercise the behavior directly; the added tests were observed red before each fix.

Files changed:

- `docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md`
- `src/matter-step.ts`
- `src/matter.ts`
- `src/web/fold.ts`
- `tests/fold-front-matter.test.ts`
- `tests/matter-step-pg.test.ts`
- `tests/matter-step.test.ts`
- `tests/matter.test.ts`

Gates:

- Unit portion plus reading-position regression: **10 files, 283 tests passed**.
- Typecheck: `npm run typecheck` could not create tsx’s local IPC pipe (`EPERM`); running the same script directly with `node scripts/typecheck.ts` passed all four projects and coverage of all 3,804 source files.
- Targeted lint passed, with only the two P2 complexity advisories above.
- `git diff --check`: passed.
- The exact combined Vitest command could not start its database projects because this sandbox cannot connect to `127.0.0.1:54362`. Therefore `tests/matter-step-pg.test.ts` and `tests/open-before-structure-queue.test.ts` remain environment-blocked. No paid calls were made.

VERDICT: do not push
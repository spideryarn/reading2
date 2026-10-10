-- The Bibliography's "older version" notice, `citations` → `bibliography`: the
-- EXPAND half, for the table that arrived from dev while this rename was in
-- flight. docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md
-- § The database; the table is plan 261010a's
-- (drizzle/20261010030425_stale_notice_dismissals.sql).
--
-- `stale_notice_dismissals.mode` names the panel whose notice was dismissed,
-- and Bibliography's was `citations`. The code deployed before this branch
-- writes that word, and runs against this schema for the minutes `npm run
-- deploy` waits on Vercel, so the CHECK is WIDENED to admit `bibliography`
-- beside `citations`, not renamed. Rows are not rewritten: the new code writes
-- `bibliography` and reads a `citations` row as it (src/stale-notice.ts §
-- `RETIRED_STALE_NOTICE_MODES`; where both rows exist, the later dismissal
-- wins). The plan's CONTRACT rewrites the `citations` rows and narrows this
-- CHECK again, with `STALE_NOTICE_TABLE.retiredModes` in src/db/schema.ts.
--
-- Generated from that schema change; `debate` and `debate-claims` keep their
-- words here until the rename's Stage 3.
ALTER TABLE "spideryarn"."stale_notice_dismissals" DROP CONSTRAINT "stale_notice_dismissals_mode";--> statement-breakpoint
ALTER TABLE "spideryarn"."stale_notice_dismissals" ADD CONSTRAINT "stale_notice_dismissals_mode" CHECK ("spideryarn"."stale_notice_dismissals"."mode" in ('glossary', 'ideas', 'faq', 'timeline', 'simple', 'bibliography', 'tweets', 'debate', 'debate-claims', 'quotes', 'skim', 'search', 'sketch', 'illustrated', 'claims', 'citations'));

-- Two unpushed migrations, renumbered onto the published chain, 2026-08-31.
--
-- These were `0032_experimental_features` and `0033_callout_blocks` on a local
-- branch while origin published its own `0032`…`0036`. Two files cannot both be
-- index 32: the journal names only one, and the other silently never runs, which
-- is the failure docs/reusable/silent-success.md is about. So origin's chain was
-- kept as-is — it is what production has applied — and these two were
-- regenerated as one migration on top of `0036` by
-- `drizzle-kit generate --name=experimental_features_and_callout_blocks`. The
-- DDL below is the tool's, diffed from the merged schema; it is the union of
-- what the two original files did and nothing besides.
--
-- **`experimental_since` is a nullable timestamp, not a boolean, and no row is
-- touched.** Null is off and off is the default, so every reader is already off
-- because that is what the absence of a date means. A `boolean not null default
-- false` would not have rewritten the table either (Postgres has stored a
-- constant default as metadata since 11), but it would have put a value in every
-- reader's row to mean "nobody ever asked them", and it would have thrown away
-- *when* the switch was flipped. docs/project/sql.md § A nullable timestamp says
-- more than a boolean; docs/project/experimental-features.md.
--
-- **The CHECK is dropped and re-added, and that is only safe because it widens.**
-- Postgres validates a re-added CHECK against the rows already in the table, so
-- removing a name from one of these lists fails on a table with history while
-- passing on a fresh local container — a delayed fuse and a false negative in
-- one. This one only adds `'callout'`, so every existing row still satisfies it.
-- docs/plans/260831b-finish-the-database-move.md § Stage 5.

ALTER TABLE "spideryarn"."revision_blocks" DROP CONSTRAINT "revision_blocks_kind";--> statement-breakpoint
ALTER TABLE "spideryarn"."reader_profiles" ADD COLUMN "experimental_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_blocks" ADD CONSTRAINT "revision_blocks_kind" CHECK ("spideryarn"."revision_blocks"."kind" in ('heading','text','quote','callout','code','media','caption','other'));

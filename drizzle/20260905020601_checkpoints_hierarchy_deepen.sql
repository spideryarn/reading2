-- The scoped expansion call gets its own checkpoint namespace.
--
-- Stage 4 makes one whole-document call for the tree; the cascade then makes
-- scoped calls that split a section too fat to read, one wave at a time. Those
-- are the calls this namespace keeps: several per article, each its own paid
-- draw, and a wave that dies half way must not buy the parents that already
-- landed. `hierarchy-structure` cannot hold them — one row per call, keyed on a
-- fingerprint that carries the target's own range, is a different key space from
-- the article's single tree. See
-- docs/plans/260904d-deepen-fat-sections.md § Stage 4.
--
-- Widening a CHECK is a drop and a re-add: Postgres has no ALTER for the
-- expression. Purely additive — no existing row can violate the wider rule, so
-- there is nothing to migrate and nothing for this to refuse. The list here is
-- the second copy of `CheckpointNamespace` in src/store/checkpoints.ts, and it
-- is generated from `src/db/schema.ts`, so the two cannot drift; the two that
-- CAN drift are the union and the schema, and since 2026-09-05
-- tests/db-schema.test.ts inserts a row under every name to prove they have not.
ALTER TABLE "spideryarn"."checkpoints" DROP CONSTRAINT "checkpoints_namespace";--> statement-breakpoint
ALTER TABLE "spideryarn"."checkpoints" ADD CONSTRAINT "checkpoints_namespace" CHECK ("spideryarn"."checkpoints"."namespace" in ('hierarchy-deepen','hierarchy-labels','hierarchy-structure','pdf-chunk'));
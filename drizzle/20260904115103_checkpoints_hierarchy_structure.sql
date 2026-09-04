-- The structure call gets its own checkpoint namespace.
--
-- Stage 4 makes one big call for the tree and then a batch of small ones for the
-- nav labels. Only the batches were checkpointed, so a run that died in the
-- label pass re-bought the tree — 508 seconds and about two dollars on the
-- 142-page paper that prompted this. See
-- docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md § Stage 2.
--
-- Widening a CHECK is a drop and a re-add: Postgres has no ALTER for the
-- expression. Purely additive — no existing row can violate the wider rule, so
-- there is nothing to migrate and nothing for this to refuse. The list here is
-- the second copy of `CheckpointNamespace` in src/store/checkpoints.ts, and it
-- is generated from `src/db/schema.ts`, so the two cannot drift.
ALTER TABLE "spideryarn"."checkpoints" DROP CONSTRAINT "checkpoints_namespace";--> statement-breakpoint
ALTER TABLE "spideryarn"."checkpoints" ADD CONSTRAINT "checkpoints_namespace" CHECK ("spideryarn"."checkpoints"."namespace" in ('hierarchy-labels','hierarchy-structure','pdf-chunk'));

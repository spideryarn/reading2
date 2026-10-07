-- Widens the checkpoint namespaces by one: `illustrated-brief`, Illustrated's
-- brief kept between two lease windows of one job.
-- docs/plans/261007l-illustrated-fits-a-claim-and-a-late-stop-says-so.md § Part 1.
--
-- Additive: every existing row's namespace is still in the list. Until it is
-- applied, the brief's write is refused and the step does not hand back a
-- brief it could not save (src/illustrated.ts § `BriefBank`).
ALTER TABLE "spideryarn"."checkpoints" DROP CONSTRAINT "checkpoints_namespace";--> statement-breakpoint
ALTER TABLE "spideryarn"."checkpoints" ADD CONSTRAINT "checkpoints_namespace" CHECK ("spideryarn"."checkpoints"."namespace" in ('structure-deepen','structure-labels','structure-whole-document','pdf-chunk','illustrated-brief'));
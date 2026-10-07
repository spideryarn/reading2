ALTER TABLE "spideryarn"."queue_state" DROP CONSTRAINT "queue_state_running_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "spideryarn"."queue_state" DROP COLUMN "running_job_id";
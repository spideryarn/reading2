ALTER TABLE "spideryarn"."ai_calls" DROP CONSTRAINT "ai_calls_realtime_event_kind";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "voice_seconds" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."realtime_sessions" ADD COLUMN "backend_model" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."realtime_sessions" ADD COLUMN "provider_session_id" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."realtime_sessions" ADD COLUMN "voice_seconds_reported" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD CONSTRAINT "ai_calls_voice_seconds_on_voice_rows" CHECK ((("spideryarn"."ai_calls"."event_kind" is not distinct from 'voice') and "spideryarn"."ai_calls"."voice_seconds" is not null and "spideryarn"."ai_calls"."voice_seconds" > 0) or (("spideryarn"."ai_calls"."event_kind" is distinct from 'voice') and "spideryarn"."ai_calls"."voice_seconds" is null));--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD CONSTRAINT "ai_calls_realtime_event_kind" CHECK ("spideryarn"."ai_calls"."event_kind" is null or "spideryarn"."ai_calls"."event_kind" in ('response','transcription','voice','backend'));--> statement-breakpoint
ALTER TABLE "spideryarn"."realtime_sessions" ADD CONSTRAINT "realtime_sessions_voice_seconds_not_negative" CHECK ("spideryarn"."realtime_sessions"."voice_seconds_reported" >= 0);

-- Make live conversation something the ledger can see.
--
-- Live conversation is the most expensive thing this app does and it has never
-- written a single row. `gpt-realtime-2.1` bills audio input at $32 per million
-- tokens and audio output at $64 — roughly $0.06 to $0.46 a minute, against
-- $0.52 for a whole default article ingest — and at the browser's own
-- twenty-minute cap that is $1.20 to $9 a session, with no limit on sessions.
-- It is also on a separate credential (`OPENAI_API_KEY`) and therefore outside
-- the account-level spend cap set in OpenRouter, which is the one safety net
-- everything else here sits behind.
--
-- None of it appeared in `npm run cost`, because the money is spent on a wire
-- this server never touches: the browser opens WebRTC straight to OpenAI and
-- the usage events land in a tab. So the accounting has to arrive through a
-- different seam — the browser reports what it saw, and this server journals,
-- validates and prices it. docs/plans/260902g-cost-tracking-that-can-set-a-price.md
-- § Stage 2A, and docs/plans/realtime-voice-cost-tracking.md for the design,
-- which was decided on 2026-08-31 and read back later as if it had shipped.
--
-- ## Why a session table, when the money is on `ai_calls`
--
-- Because the ordinary failure of a browser-reported meter is not a lie, it is a
-- closed laptop. Nobody has an incentive to under-report their own token count
-- — docs/project/security-map.md says plainly that a signed-in reader is not one
-- of the untrusted parties — but a reader ends a conversation by shutting the
-- lid, and a report that fires once at the end never fires at all.
--
-- Without a session row that conversation is simply **absent**: no row, no gap,
-- and a total that looks healthy while being short by an unknown amount. That is
-- docs/reusable/silent-success.md at the scale of a feature. With one, the same
-- conversation is a session that reported nothing, which is a number somebody
-- can look at. The row is written when the client secret is minted, before the
-- token reaches the browser, so it exists whether or not any money is ever
-- reported.
--
-- `issued_at` is a token handed out and is deliberately not a conversation; a
-- reader can press the button and change their mind. `connected_at` is the
-- separate event the browser posts when the data channel opens, so that a
-- denominator can be built on conversations that happened rather than on tickets
-- printed.
--
-- `accepts_until` is a **server-owned** deadline and is stored rather than
-- computed. It is emphatically not the ephemeral client secret's expiry: that
-- admits the browser to one connection and lasts about ten minutes, while a
-- conversation may run for twenty. Accepting reports on the token's clock would
-- have silently discarded the second half of every long conversation — which is
-- to say, of every expensive one — and the ledger would have looked healthy
-- while under-counting in exactly the direction that flatters us. Storing it
-- means a session issued under today's rule keeps that rule when the rule
-- changes.
--
-- ## Why columns on `ai_calls` and not a JSON blob or a sibling table
--
-- Audio and text are priced an order of magnitude apart in the same request —
-- $32 against $4 in, $64 against $24 out — and cached audio is $0.40 against $32
-- uncached, eighty times cheaper. A row that kept only `reported_input_tokens`
-- and `output_tokens` could be handed a price once, by whoever wrote it, and
-- could never be repriced or audited afterwards. OpenAI's rate card has moved
-- twice in the life of this repo. The splits are the whole point.
--
-- Columns rather than JSON, per docs/project/sql.md: every one of these is a
-- number somebody will want to filter, sum or constrain, and the first person to
-- want `SUM(output_audio_tokens)` for a voice-minutes figure should not have to
-- reach inside a blob for it.
--
-- And not a sibling table, because **this table already does exactly this**:
-- `cache_write_5m_tokens` and `cache_write_1h_tokens` are Messages-wire only,
-- `service_tier` and `inference_geo` are Anthropic's own fields, `web_searches`
-- is chat-wire only. Every one of them is null on most rows. Realtime columns
-- are the same pattern rather than a new one, so this follows the table's design
-- instead of putting a second shape beside it.
--
-- `cached_text_tokens` and `cached_audio_tokens` are the split of the cached
-- count whose parent goes in `cache_read_tokens`. They are here because
-- `cached_tokens_details` says how much of the cache saving was on the expensive
-- modality — and because it was missing from `openai-node`'s own types for a
-- while (openai-node#1600), so hand-rolled realtime meters tend to drop it.
--
-- ## `duration_ms` loses its NOT NULL, and gains a narrower rule instead
--
-- A live session's input transcription arrives as one
-- `…input_audio_transcription.completed` event with no matching start event, so
-- there is nothing to subtract from. Both alternatives to a null would have been
-- lies that nothing could see: a `0` reads as an instant call and drags any
-- latency figure down, and the session's own wall-clock is the duration of a
-- *conversation* rather than of a *call* — the substitution GPT Sol's review
-- named explicitly.
--
-- Dropping a NOT NULL widens what every other writer may do, and the two
-- gateways always know how long their own request took. So the licence is
-- narrowed back to exactly the case it was granted for by
-- `ai_calls_duration_known_off_realtime`: null is allowed on the realtime wire
-- and nowhere else. Without that, the day a gateway stops passing a duration is
-- a day nothing goes red.
--
-- ## The idempotency rule, and why it is both an index and a CHECK
--
-- The browser posts each turn as it happens and retries whatever it did not see
-- acknowledged, so a request that succeeded and whose `200` was lost is the
-- ordinary case. Double-counting is the direction that looks exactly like the
-- thing being measured.
--
-- `ai_calls_realtime_event` makes `(session, provider event id, event kind)`
-- unique. `acceptRealtimeUsage` in src/live.ts also derives the row's *primary
-- key* from those same three, so an ordinary retry collides on `ai_calls.id`
-- where `on conflict do nothing` absorbs it, and this index is what still holds
-- if that derivation is ever changed.
--
-- `ai_calls_realtime_identified` closes the gap the index cannot cover: a report
-- missing its `response.id` would insert happily, sit outside a partial unique
-- index because one of its columns is null, and be counted again on the next
-- retry — the exact failure the index exists to stop, walking in through the one
-- door it has. So the three parts of the key arrive together or the row is
-- refused.
--
-- ## Deployability
--
-- Additive, apart from the one dropped NOT NULL, which is a *widening*: old code
-- meeting this schema writes a duration exactly as it did before. So the usual
-- migrations-run-before-code gap costs nothing here, unlike the coordinated
-- rename in 20260902141103_byok_upstream_nanos.sql that this file follows.
--
-- An issued session that never reports is the expected state until the browser
-- half lands (Stage 2B), and that state is visible rather than an error.

CREATE TABLE "spideryarn"."realtime_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"article_id" uuid,
	"article_slug" text,
	"thread_id" text,
	"model" text NOT NULL,
	"transcription_model" text,
	"issued_at" timestamp with time zone NOT NULL,
	"accepts_until" timestamp with time zone NOT NULL,
	"connected_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realtime_sessions_window" CHECK ("spideryarn"."realtime_sessions"."accepts_until" > "spideryarn"."realtime_sessions"."issued_at"),
	CONSTRAINT "realtime_sessions_connected_after_issue" CHECK ("spideryarn"."realtime_sessions"."connected_at" is null or "spideryarn"."realtime_sessions"."connected_at" >= "spideryarn"."realtime_sessions"."issued_at"),
	CONSTRAINT "realtime_sessions_close_reason_len" CHECK (length("spideryarn"."realtime_sessions"."close_reason") <= 64)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ALTER COLUMN "duration_ms" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "realtime_session_id" uuid;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "provider_event_id" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "event_kind" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "provider_status" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "input_text_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "input_audio_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "input_image_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "cached_text_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "cached_audio_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "output_text_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "output_audio_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "transcription_seconds" double precision;--> statement-breakpoint
ALTER TABLE "spideryarn"."realtime_sessions" ADD CONSTRAINT "realtime_sessions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "realtime_sessions_owner_issued" ON "spideryarn"."realtime_sessions" USING btree ("owner_id","issued_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD CONSTRAINT "ai_calls_realtime_session_id_realtime_sessions_id_fk" FOREIGN KEY ("realtime_session_id") REFERENCES "spideryarn"."realtime_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_calls_realtime_event" ON "spideryarn"."ai_calls" USING btree ("realtime_session_id","provider_event_id","event_kind") WHERE "spideryarn"."ai_calls"."realtime_session_id" is not null;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD CONSTRAINT "ai_calls_realtime_identified" CHECK (("spideryarn"."ai_calls"."realtime_session_id" is null and "spideryarn"."ai_calls"."provider_event_id" is null and "spideryarn"."ai_calls"."event_kind" is null)
          or ("spideryarn"."ai_calls"."realtime_session_id" is not null and "spideryarn"."ai_calls"."provider_event_id" is not null and "spideryarn"."ai_calls"."event_kind" is not null));--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD CONSTRAINT "ai_calls_realtime_event_kind" CHECK ("spideryarn"."ai_calls"."event_kind" is null or "spideryarn"."ai_calls"."event_kind" in ('response','transcription'));--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD CONSTRAINT "ai_calls_realtime_columns_need_realtime_wire" CHECK ("spideryarn"."ai_calls"."wire" = 'realtime' or (
            "spideryarn"."ai_calls"."realtime_session_id" is null
            and "spideryarn"."ai_calls"."provider_status" is null
            and "spideryarn"."ai_calls"."input_text_tokens" is null
            and "spideryarn"."ai_calls"."input_audio_tokens" is null
            and "spideryarn"."ai_calls"."input_image_tokens" is null
            and "spideryarn"."ai_calls"."cached_text_tokens" is null
            and "spideryarn"."ai_calls"."cached_audio_tokens" is null
            and "spideryarn"."ai_calls"."output_text_tokens" is null
            and "spideryarn"."ai_calls"."output_audio_tokens" is null
            and "spideryarn"."ai_calls"."transcription_seconds" is null
          ));--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD CONSTRAINT "ai_calls_duration_known_off_realtime" CHECK ("spideryarn"."ai_calls"."duration_ms" is not null or "spideryarn"."ai_calls"."wire" = 'realtime');
--> statement-breakpoint

-- The session table's foreign key into auth.users, added by hand for the same
-- reason every other owner key is (drizzle/0001_auth_fks_and_guards.sql):
-- Supabase owns auth.users, and declaring it in the Drizzle schema would invite
-- migration generation to treat an Auth-owned table as ours to manage.
--
-- THE DRIFT THIS CREATES, restated because it is why hand-written statements
-- like this need an alarm: drizzle-kit's snapshot does not know about this
-- constraint, so a future generated migration that drops and recreates
-- `realtime_sessions` takes it with it and says nothing.
-- tests/db-schema.test.ts asks pg_constraint whether each of these still exists,
-- and this one is named there.
--
-- ON DELETE RESTRICT, matching its neighbours and matching `ai_calls` in
-- particular, which this table is the parent of. Deleting an account must not
-- silently delete the record of what that account spent — and here it cannot
-- anyway, because `ai_calls.realtime_session_id` is itself RESTRICT, so the two
-- refusals stack. Customer deletion will force that policy question sooner than
-- expected; the answer is a migration somebody writes on purpose, not a cascade
-- nobody noticed.
ALTER TABLE "spideryarn"."realtime_sessions"
  ADD CONSTRAINT "realtime_sessions_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;

--> statement-breakpoint

-- **The third account, and the constraint that had to be told about it.**
--
-- `ai_calls_provider_account_known` from drizzle/0023_ai_calls_cost_provenance.sql
-- reads `provider_account IN ('openrouter', 'anthropic')`, with a comment saying
-- *"only three spellings each, and a typo in either is a row that silently drops
-- out of whichever half of the report filters on it"*. It was right then and it
-- is right now — a live-conversation row bills a third account, so the list
-- grows by one rather than the constraint being dropped.
--
-- **Worth knowing how this was found**, because nothing else would have found
-- it. Widening `ProviderAccount` in src/ai-spend.ts type-checks, every unit test
-- passes, and the route builds a perfectly good row — TypeScript cannot see a
-- database CHECK. `npm run db:migrate` refuses on the box this was written on
-- (a peer's ledger row), so the first insert would have been in production. It
-- surfaced by applying this file to a real database inside a transaction and
-- rolling it back, which is the check to reach for whenever a migration cannot
-- be applied for a reason that is not yours.
--
-- Dropped and re-added rather than widened in place: PostgreSQL has no ALTER
-- CONSTRAINT for a CHECK's expression. `NOT VALID` is deliberately not used —
-- there are a few thousand rows and every one of them already satisfies the
-- wider list, so a full validation costs nothing and a constraint that is not
-- validated is one nobody can rely on afterwards.
ALTER TABLE "spideryarn"."ai_calls"
  DROP CONSTRAINT "ai_calls_provider_account_known";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls"
  ADD CONSTRAINT "ai_calls_provider_account_known"
  CHECK ("provider_account" IN ('openrouter', 'anthropic', 'openai'));

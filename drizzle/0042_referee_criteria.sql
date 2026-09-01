-- Referee mode's saved criteria, and the referee's own mark on a passage.
-- docs/plans/260831an-referee-mode-for-peer-reviewers.md, stage 2.
--
-- TWO TABLES ARE TOUCHED AND ONLY ONE OF THEM IS NEW, so read the second half.
--
-- ## Why this is not `search_runs` with a column added
--
-- The plan's first draft said `search_runs` "has the right shape already". GPT
-- Sol's review, finding 6, showed it does not: no criterion kind, no poles, no
-- scale, no citations -- and, the one that would have broken first,
-- `SearchHit.confidence` is a 0-100 MATCH STRENGTH whose validator clamps
-- negatives to zero (`validateHits`, src/search.ts). A signed valence pushed
-- through that field does not arrive wrong. It arrives as 0, which reads as
-- "the model is not sure", and every negative judgement the referee asked for
-- is gone with nothing at all to see. So this feature has three numbers and
-- they are three separate places: the model's `confidence` and its `valence`
-- inside `results`, and the referee's own placement in `comments.valence`.
--
-- ## Which constraints are tight and which are loose, and why they differ
--
-- `referee_criteria_scale` is TIGHT -- exactly 'rg' or 'br'. A scale is the name
-- of a block of custom properties in styles/colourscales.css that either exists
-- or does not, and an unrecognised one would draw nothing at all. There is no
-- safe fallback to be wrong into.
--
-- `referee_criteria_colour` is LOOSE -- 0 to 63, against a palette of eight --
-- and that is copied deliberately from `search_runs_colour` (drizzle/0016),
-- whose comment argues it out in full. The database does not know what colour a
-- slot is; a value past the end of the palette is ignored by `assignSlots` and
-- the row falls back to its automatic hue, which is the safe way to be wrong,
-- while a check pinned at 8 would refuse a reader's choice on the day the
-- palette grows.
--
-- `referee_criteria_diverging_shape` is BOTH-OR-NEITHER across three columns:
-- the two poles and the scale arrive exactly when the kind is 'diverging'. Half
-- a diverging criterion is one whose signed number points at nothing and whose
-- direction cannot be printed in words -- and docs/project/colour-scales.md
-- requires those words, because colour may never be the only carrier of a
-- good/bad judgement. A half-built one would reach the panel looking fine.
--
-- ## The referee's mark is a comment, not a table
--
-- `comments` gains `criterion_id` and `valence`, both nullable, both additive,
-- no existing column touched. The referee's mark IS a comment -- their own
-- words, anchored to a passage -- and `comments` already has the anchoring
-- discipline, the gutter, the API and the export. A second store would mean two
-- places to write about one passage, and Mirror would have to read both.
--
-- It also answers, better than a boolean would, a question Greg asked about
-- flagging comments as for-refereeing: A COMMENT WITH A CRITERION IS A REVIEW
-- COMMENT, ONE WITHOUT IS A READING NOTE. The distinction falls out of the data
-- rather than being a separate switch that nothing keeps in step.
--
-- `comments.valence` is the referee's own -100..+100 and is NEVER reconciled
-- with the model's. The whole value is in the gap between them: a passage the
-- referee put at +70 and the model at -40 is a disagreement about the paper,
-- and it is the row worth opening. Averaging them deletes exactly that.
--
-- ## `comments_criterion_fk` is `no action`, and that is not the same as nothing
--
-- Three choices, and the two obvious ones are both wrong here.
--
-- `cascade` would delete the referee's own sentences about the paper when a
-- criterion is deleted. Their words are theirs and are not derived from
-- anything.
--
-- `restrict` says the right thing -- you may not delete a criterion people have
-- written against -- but says it too early. It is checked row by row as a
-- delete cascades, so deleting the ARTICLE, which cascades into both
-- `comments` and `referee_criteria` in an order Postgres does not promise,
-- could hit this constraint while the comment rows are still there and refuse a
-- delete that is entirely legitimate.
--
-- `no action` is the same rule checked at the END OF THE STATEMENT. Deleting a
-- criterion on its own still fails, loudly, with rows to point at; deleting the
-- article succeeds, because by then neither row exists. This was verified
-- against the local database rather than reasoned about -- see
-- tests/db-schema.test.ts, which does the delete both ways round.
--
-- The key is COMPOSITE, `(article_id, criterion_id)`, which buys a second thing
-- for free: a comment cannot answer a criterion belonging to a different
-- article. That is the same trick `comments_identity_fk` plays.
--
-- The owner key into auth.users is in drizzle/0043, by hand, for the reason
-- drizzle/0040 sets out.

CREATE TABLE "spideryarn"."referee_criteria" (
	"article_id" uuid NOT NULL,
	"id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"criterion" text NOT NULL,
	"pole_against" text,
	"pole_favour" text,
	"scale" text,
	"status" text NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_hash" text,
	"attempt_id" text,
	"attempt_started_at" timestamp with time zone,
	"colour" integer,
	CONSTRAINT "referee_criteria_article_id_id_pk" PRIMARY KEY("article_id","id"),
	CONSTRAINT "referee_criteria_id_format" CHECK ("spideryarn"."referee_criteria"."id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "referee_criteria_kind" CHECK ("spideryarn"."referee_criteria"."kind" in ('single','diverging','literature')),
	CONSTRAINT "referee_criteria_status" CHECK ("spideryarn"."referee_criteria"."status" in ('pending','done','error')),
	CONSTRAINT "referee_criteria_colour" CHECK ("spideryarn"."referee_criteria"."colour" is null or ("spideryarn"."referee_criteria"."colour" >= 0 and "spideryarn"."referee_criteria"."colour" < 64)),
	CONSTRAINT "referee_criteria_diverging_shape" CHECK (("spideryarn"."referee_criteria"."kind" = 'diverging') = ("spideryarn"."referee_criteria"."pole_against" is not null and "spideryarn"."referee_criteria"."pole_favour" is not null and "spideryarn"."referee_criteria"."scale" is not null)),
	CONSTRAINT "referee_criteria_scale" CHECK ("spideryarn"."referee_criteria"."scale" is null or "spideryarn"."referee_criteria"."scale" in ('rg','br')),
	CONSTRAINT "referee_criteria_attempt_both" CHECK (("spideryarn"."referee_criteria"."attempt_id" is null) = ("spideryarn"."referee_criteria"."attempt_started_at" is null))
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD COLUMN "criterion_id" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD COLUMN "valence" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."referee_criteria" ADD CONSTRAINT "referee_criteria_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD CONSTRAINT "comments_criterion_fk" FOREIGN KEY ("article_id","criterion_id") REFERENCES "spideryarn"."referee_criteria"("article_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD CONSTRAINT "comments_valence_needs_criterion" CHECK ("spideryarn"."comments"."valence" is null or "spideryarn"."comments"."criterion_id" is not null);--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD CONSTRAINT "comments_valence_range" CHECK ("spideryarn"."comments"."valence" is null or ("spideryarn"."comments"."valence" >= -100 and "spideryarn"."comments"."valence" <= 100));--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD CONSTRAINT "comments_criterion_id_format" CHECK ("spideryarn"."comments"."criterion_id" is null or "spideryarn"."comments"."criterion_id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$');

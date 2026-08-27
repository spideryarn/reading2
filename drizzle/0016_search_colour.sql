-- The reader's own colour for a saved search.
--
-- Greg, 2026-08-27: "In Search mode, I'd like to be able to change the colour
-- for a given row." Until now every search's hue was derived from a hash of its
-- id (src/web/hit-colours.ts) and nothing was stored. Null still means that,
-- which is what every existing row gets and what a reader who has not chosen
-- keeps.
--
-- THE CHECK IS DELIBERATELY LOOSER THAN THE PALETTE. There are eight hues today
-- and this allows sixty-four. That is not slack: the database does not know what
-- colour a slot is -- the hues live in styles/colourscales.css and the browser
-- resolves them -- so a tight bound would be this table holding an opinion it
-- has no way to keep current. The two failure modes are not symmetrical. A value
-- past the end of the palette is ignored by `assignSlots` and the row falls back
-- to its automatic hue: visible, harmless, self-correcting. A check pinned at 8
-- would instead refuse a reader's choice on the day the palette grows, from a
-- constraint nobody thought to migrate, and it would look like a broken button.
-- `MAX_STORED_COLOUR` in src/searches.ts is the same number, for the same reason.

ALTER TABLE "spideryarn"."search_runs" ADD COLUMN "colour" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."search_runs" ADD CONSTRAINT "search_runs_colour" CHECK ("spideryarn"."search_runs"."colour" is null or ("spideryarn"."search_runs"."colour" >= 0 and "spideryarn"."search_runs"."colour" < 64));
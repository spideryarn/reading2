# Review this plan before it is built: renaming Review mode to Remember mode

You are reviewing a **plan**, not code. Nothing has been built yet. Be adversarial: your job is to
find what will go wrong, what has been missed, and where the plan is confidently wrong.

Repo: `/home/greg/code/spideryarn2`. Read whatever you need.

## The plan

**Read `docs/plans/260901d-rename-review-mode-to-remember-mode-everywhere.md` in full.** That is the
artefact under review.

## Context you need

**The product.** Spideryarn is an AI-assisted reading tool. The reader opens an article and picks one
of ~14 "modes" in a bottom dock (`src/modes.ts` § `MODES`). One of them is **Review**: the reader says
what they took from the piece and a model shows them where their account and the article come apart.
It is being renamed to **Remember**.

**Why.** The owner, Greg, asked for it on 2026-08-31, because he wanted the name "Reviewer" free for a
peer-review mode. Between the request and the work, that mode was built — as **Referee**. The plan
argues the rename is still right because `"review"` and `"referee"` now sit seven lines apart in the
same `MODES` array. **Test that argument.** If you think the rename is no longer justified, or that
"Remember" is the wrong name, say so plainly.

**The licence.** Greg said: *"We have no real users yet, so it's fine to break things (e.g. urls)
without aliases etc."* The plan takes this widely: no URL aliases, no dual-accept window on the
database value, no preserved eval-result directories. He also pre-approved applying the migration to
production once it is green locally.

**The house rules that constrain this** (`AGENTS.md`, `docs/reusable/rename-or-move.md`):
- Several agents write to this one working tree concurrently. One is mid-flight on `src/db/schema.ts`
  and an uncommitted migration `0047` right now.
- Commits name their own files explicitly. No branch. No `git stash`/`reset`/`checkout --`.
- `docs/plans/` and `docs/postmortems/` are historical records and are not rewritten.

## Evidence already gathered

**A repo-wide sweep** classified ~140 hits as the mode and ~2,400 as *not* the mode — the word
"review" is used pervasively for (a) code review, e.g. hundreds of comments saying "found by a GPT Sol
review", (b) Referee mode's peer-review prose, (c) the substring inside "preview".

**A read-only probe of the live local database** found exactly one relevant CHECK constraint:

```
spideryarn.chat_threads | chat_threads_kind
    CHECK ((kind = ANY (ARRAY['chat'::text, 'review'::text])))
```

with `chat` 27 rows, `review` 1 row. Six other text columns contain the string, all of them article
prose or reader-written chat text — reader content, not ours.

**Baseline before any edit:** `npm run typecheck` has 6 pre-existing errors; `npm test` has 14
pre-existing failures out of 7954; the five test files this rename owns are green (79 tests).

## What I want from you

1. **Is the rename still justified** now that the peer-review mode is called Referee rather than
   Reviewer? The plan says yes and says it got *more* justified. Argue the other side properly.
2. **Is the staging right?** A (docs) → B (code, no schema) → C (schema + migration last, waiting on
   the other agent to commit). Is holding the persisted value until last actually safe, or does it
   create a window where the code and database disagree? Be specific about what breaks and when.
3. **What has the sweep missed?** Go and look. In particular: anywhere the string `review` is
   persisted, turned into a filename, or reachable from a URL. The plan claims there is exactly one
   database home; verify that against `src/db/schema.ts`, `src/store/`, and the drizzle migrations.
   The previous rename in this repo (`toc` → `hierarchy`, `docs/plans/260831ak-*`) found three homes
   a schema read would have missed — check whether this plan has the same blind spot.
4. **The prompt.** The plan asserts that `REVIEW_SYSTEM` in `src/converse.ts` contains no occurrence
   of the word "review" and therefore the model-visible bytes do not change and the stance eval cannot
   regress. **Verify that claim** — it is exactly the kind of thing that is quietly false.
5. **The sub-modes.** `?review=recall|quiz` is a second query key owned by this mode, with a Quiz
   panel built inside it overnight. The plan renames the key and keeps the values. Is that right, and
   does anything else depend on that key?
6. **The migration.** Order is DROP CONSTRAINT → UPDATE → re-ADD CHECK, as migration 0048. Is that
   correct and complete? What about concurrent writers, the `chat_messages.stance` rows tied to
   review threads, the committed fixture corpus at `tests/fixtures/data-root/`, and any local `data/`
   snapshots?
7. **Anything the plan is confidently wrong about.**

Do not be polite about it. If the plan is sound, say which parts you actually checked rather than
issuing a general approval — a review that returned nothing looks exactly like one that found nothing.

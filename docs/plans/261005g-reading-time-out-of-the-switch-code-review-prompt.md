# Code review: reading time out from behind the experimental switch

You are reviewing one commit in this worktree: `git show c4f1bc27b` (and `git diff c4f1bc27b~1 c4f1bc27b`
for the scoped diff). You may fix what you find inside this change's scope. Report anything wider
rather than fixing it. Do not commit.

## What it is for

Spideryarn records how long a reader has spent on each passage of their own articles and draws it
down the spine and in the gutter (`docs/project/reading-time.md`). Until this commit both the
recording and the drawing ran only with the reader's Experimental features switch on. The owner of
the product was asked whether it should come out from behind the switch, with four options written
up in `docs/plans/261005g-reading-time-line-waits-on-the-experimental-switch-not-on-a-timer.md`
§ Questions for Greg, and chose option A: every signed-in owner gets it, switch or no switch. The
trade-off named to him was that a reader cannot yet turn it off or erase it. An off switch and an
erase are deliberately NOT built here.

## What changed

- `src/web/article/ArticlePage.tsx`: `useReadingTime(slug, words, true)` where it passed
  `experimental.on`; the `useExperimental` import went with it.
- `src/web/PrivacyPage.tsx`: the *What we keep* bullet lost "with experimental features on".
  `LAST_UPDATED` already read "5 October 2026", so it did not move.
- `src/web/help/help-topics.tsx`: the spine topic no longer says the area is experimental; the
  experimental-features topic no longer lists it.
- Comments in `useReadingTime.ts`, `Spine.tsx`, `QuizPanel.tsx`.
- Docs: `reading-time.md` (new § Who gets it, and § Not built), `experimental-features.md`,
  `privacy.md`, `quiz.md`, `reading-view-overview.md`, and the plan.
- One new test, seen red before the fix: `tests/public-network-trace.test.tsx` § "reads the owner's
  reading time with experimental features off".

## What to try to break

1. **Does anybody who is not the owner now record or read reading time?** A signed-out visitor, or
   a signed-in reader on somebody else's shared article. Trace it from `ArticlePage.tsx` and from
   the two routes in `src/routes.ts` (`/api/reading-time/:slug`) and `src/store/pg-reading-time.ts`.
   Do not take a comment's word for it.
2. **Is anything else still gated on the switch that reads the same data**, so that an owner with
   the switch off gets half a feature? The gutter hairline and its hover card
   (`ReadingTimeStyle.tsx`, `BlockLinkCard.tsx` § `ReadingCard`), the spine area (`Spine.tsx`,
   `Reader.tsx`), the quiz's *Only what I've read* (`read-filter.ts`, `QuizPanel.tsx`, `Reader.tsx`).
3. **Is every reader-facing sentence now true?** `/privacy`, `/help`, the hover card's words, the
   experimental switch's own copy (`experimental-copy.ts`), `/features`, the changelog source if it
   states the gate. In particular: does any page promise a way to turn reading time off, or imply it
   is only kept with the switch on?
4. **Docs and comments that still say "behind the experimental switch" about reading time**, in
   `docs/project/` and in `src/`. Grep for fragments, not only the whole phrase. Leave dated plans
   under `docs/plans/` as history unless one is wrong about the present in a way a reader would act
   on.
5. **The new test**: could it pass for the wrong reason? It asserts `GET /api/reader` was made, to
   show the switch was read as off rather than never read. Is that enough?
6. **Tests that pinned the old behaviour** ("switch off, no request") and are now either wrong or
   passing vacuously.
7. `useReadingTime` keeps an `enabled` parameter whose one caller passes `true`. The reason given is
   that an off switch would arrive through it. Say if you think that is the wrong call.

## Rules for any doc you edit

Do not write anything as a quotation of Greg, or attribute a decision or wording to him, beyond
what is already in the files. His whole answer was the single letter "A".

## Answer format

A verdict line (approve / approve with changes / rework), then findings as P0 to P3, each with the
file and line, what is wrong, and whether you fixed it. Then the list of files you changed. Run
`npm run typecheck` if you changed code. `npm test` may refuse to start for lack of memory on this
machine; say so if it does rather than treating it as a pass.

# 261007o — Help pictures for the eight modes that have none

Queue item `qi-hyx8fden`, handed over by the Overseer on 2026-10-07. Greg, on the queue item: *"yes.
You don't need my permission for this going forwards"* — recorded in
[help-page.md § Pictures](../project/help-page.md#pictures).

Help got 22 screenshots and 3 GIFs in [261007l](261007l-help-screenshots-and-gifs.md). Eight mode
pages were left without one because no public article locally had output worth showing: **FAQ,
Learn, Chat, Debate, Referee, Marginalia, Plain and Illustrated**. The queue item says one run of a
mode on a public article locally is fine. Every public article in the local database is owned by the
seeded dev admin, so the admin can run each mode directly; nothing touches production.

## What each picture shows

All by [help-page.md § Pictures](../project/help-page.md#pictures) and
[marketing-pages.md § Shooting a screenshot of the product](../project/marketing-pages.md#shooting-a-screenshot-of-the-product):
public articles only, cropped to the passage's subject, 2× and kept at 2×, one idea per picture,
varied articles where the output allows.

| Page | Picture | Generated for it |
| --- | --- | --- |
| `faq.md` | the band, prioritised, cropped after two or three questions with their quoted passages | one FAQ run |
| `learn.md` | Recall: one short recollection typed, and the reply with its passage link | one Recall turn |
| `chat.md` | one question and its answer, with short codes | one chat turn |
| `debate.md` | Reception or Claims, whichever has the better output; two articles already have a run | none, or one search |
| `referee.md` | Criteria: one preset run on a paper, with its passages | one criterion run |
| `marginalia.md` | the column beside prose: a part's question and an assumes/introduces note | Ideas if missing |
| `plain.md` | prose with glossary underlines, and the bottom bar's left end with Plain pressed | none |
| `diagram.md` | Illustrated, after the chips' list as an unindented paragraph (the renderer rejects a picture nested in a list): the painting and the top of What it depicts | one Illustrated run (needs a Sketch; three articles have one) |

A mode whose output still is not worth showing after one run is left without a picture and named in
the debrief, rather than forced.

## How

A Sonnet subagent starts this worktree's dev server, signs in as the dev admin
(`scripts/browser-sign-in.ts`, with `SPIDERYARN_BASE_URL` set to this worktree's printed port),
first confirming the server's database and auth targets are local, runs the modes, and shoots with Playwright against system Chrome
([browser-control.md](../project/browser-control.md)). I choose and crop, write alt and caption into
each page, an entry per file in `src/web/help/help-images.ts`, and compress with
`npm run screenshots:compress -- <file>` — the commit hook from 261007m only covers PNGs under
`docs/`, and these live in `src/web/help/pages/images/`. Then regenerate the help corpus
(`WRITE_HELP_CORPUS=1`), run `tests/help-images.test.ts` and the rest of `npm test`, typecheck, and
a browser check of the eight pages at desktop, iPad and phone widths.

**No code change.** The construct, its test and its rules already exist; this is eight files, eight
entries and eight lines. The test that guards it (`tests/help-images.test.ts`: every file has an
entry, every entry a page, sizes match the header, under 350KB) is already in place and was seen red
in 261007l, so there is no new defect to reproduce first.

**Passed over:** shooting all eight from production articles, where some already have output — Help
only shows public articles, and production is real readers' data; and a committed re-shoot script,
passed over in 261007l for reasons that still hold.

## Outcome

All eight shot, from runs on the local database only: FAQ on Cargo Cult Science, one Recall turn on
the Pittsburgh essay, one chat question on Great Hackers, one Strength of evidence criterion on
Batch Normalization. Debate used the existing Claims run on Claude's Constitution (Reception was
empty on both articles that have a run, so no search was paid for); Illustrated was already painted
for the phrenology article. Browser check: the eight pages at 1440, 820 and 390 wide, 24 of 24 pass.

GPT Sol's code review ([261007o-help-pictures-code-review-sol.md](261007o-help-pictures-code-review-sol.md))
tightened four captions and the retake recipes, and found two things:

- **The Marginalia picture is downscaled** (1008 CSS px wide, stored at 1344). Kept: it is still
  2 file pixels per drawn CSS pixel, because Help draws it at most 672 wide either way; what
  shrinks the text is a frame wide enough to hold prose and column side by side, which is the point
  of the picture. `reading-view.png` is the same trade. A retake with a narrower frame would cut one
  or the other.
- **Help said something false about Marginalia**: "the one at the very top is the question the
  whole article answers". `src/web/marginalia/notes.ts` leaves the article's own question out on
  purpose, one question per part. The sentence now says that.

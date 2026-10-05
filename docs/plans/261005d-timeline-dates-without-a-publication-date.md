# Timeline: dates the piece gives, on an article with no publication date

Up: [plans.md](../project/plans.md) · the mode is [timeline.md](../project/timeline.md)

Report `spya-fyjac4` (Sentry `SPIDERYARN-READING2-CE`), Greg, 2026-10-04, on `openai-huggingface`:

> I'm looking at a piece that has a bunch of explicit dates in it, and yet it keeps saying, dated
> but which year in the timeline mode. And at the top it says, everything dated here is in 2006.
> So, sorry, 2026. So it knows that it's this year, and there are dates, and sometimes it even
> says in the, you know, description that there's a date, but it's somehow not showing the dates
> above. … Now, it's fine if it includes a confidence where it's saying, look, I think this is
> July the 7th, or, you know, I think this is midnight, but, you know, I'm not certain

The note, with his words in full, is
[261004_1124](../user-feedback/261004_1124-timeline-shows-dates-the-piece-gives-without-a-year.md).

## What was wrong

Nothing in the prompt, and nothing in the model's answer. Read from production (read-only), the
stored timeline for that article has 31 events:

| what the date column showed | rows |
|---|---|
| "dated — but which year?" (`rejected`, `noYearFrame`) | 17 |
| a date | 1 |
| the article's relative words ("Within a few hours") | 5 |
| no time at all | 8 |

All 17 refusals have one cause: **the article's revision in production has no publication date**
(`published_at` is null, as it is on 32 of the 47 articles there). The piece writes "On July 7",
"By May 12" and so on without a year, and the parser will not guess one. The model had copied
every one of those phrases correctly, and 16 of the 17 were sitting in the artefact as `phrase`.
The panel showed its own complaint in the date column instead of them.

The header came from the one row whose passage writes `2026-07-19` in full. One year across the
dated rows makes the panel say "Everything dated here is in 2026", so it said that over 17 rows
that it had just refused to put in 2026.

Class: **a refusal drawn in place of what was known.** The row knew the day and the month and
showed neither, because the missing part (the year) decided the whole cell.

## What changed

Two parts. The first needs no re-run and fixes every stored timeline; the second applies when a
timeline is next written.

**1. A year-less date shows the article's own words.** `datingWords` in
`src/web/TimelinePanel.tsx` now draws a `noYearFrame` row that has its phrase as `“On July 7”`,
in the article's face, exactly as a `words` row is drawn. We still compute nothing. The head of
the list says once that some dates have no year and why, the lone full date keeps its year on
its row, and "Everything dated here is in 2026" is no longer said over rows with no year. A
`noYearFrame` row with no located phrase (1 of the 17) still says "dated — but which year?".

**2. With no publication date, the one year the piece itself states is assumed.** `pieceYear` in
`src/timeline-time.ts`: if the body blocks write exactly one distinct year beside a month
(`May 2026`, `July 7, 2026`, `2026-07-19`), a year-less date is read in that year. Two different
years, or none, and the row stays as in part 1. A publication date, when there is one, always
wins. **And the year is assumed only when it is the year we fetched the article, or the one
before** (`buildTimeline` in `src/timeline.ts`); § Measured says why that guard was added after
the review. Each such row carries `When.yearFrom: "piece"`, and the panel says above the list,
on the open row and in the margin note that the year is assumed.

No prompt change, so `PROMPT_VERSION` is not bumped and no model output was re-measured: the
model's answer was already right.

## Measured

Against production, read-only, 2026-10-05. The scripts print counts only.

Before and after on stored timelines (13 articles have one; 12 of those have no publication
date; only `openai-huggingface` has any `noYearFrame` rows):

| | before | part 1 (no re-run) | part 2 (after a re-run) |
|---|---|---|---|
| rows reading "dated — but which year?" | 17 | 1 | 0 |
| rows showing the article's day and month | 0 | 16 | 0 |
| rows showing a date | 1 | 1 | 18 |

Part 2 was measured by re-dating the stored events with the real `readWhen` and the production
blocks, with no model call: all 17 came back dated in 2026.

How often `pieceYear` fires, across all 47 current revisions:

| | articles | rule fires |
|---|---|---|
| publication date or year known | 15 | 2 |
| neither known | 32 | 14 |

Of the 2 articles where it fires and we know the publication year, one agrees (2022 and 2022)
and one does not: a 2024 piece whose only full date is in 1896. Neither has any year-less
day-and-month dates, so on neither would a row have changed, but the second is the shape that
would go wrong: a modern piece with one historical date and its own dates written without a
year would have them all read as 1896.

GPT Sol's review said not to ship part 2 for that reason, so it was measured against the year
each article was fetched. Of the 16 articles where the rule fires:

| the one stated year is | articles |
|---|---|
| the fetch year or the one before | 3 (one is `openai-huggingface`: states 2026, fetched 2026) |
| older than that | 13 |
| later | 0 |

**Unguarded, the rule would mostly have fired on a year from the past.** Some of those are old
pieces rightly about their own year and some are one historical date; nothing here can tell
them apart, so the guard refuses all 13 and they keep the article's words (part 1). What is
left is "a piece whose only stated year is the year we fetched it, or the one before".

**The evidence that this is right is still thin**: 3 articles, and no article where we know the
publication date has any year-less date to check it against. The case that still goes wrong is
a current piece that writes one full date from last year and its own dates without a year.

## What was passed over

- **Changing the prompt.** The model's phrases were right. Nothing to fix there.
- **Taking the year from when we fetched the article.** Simple, and right for a piece fetched
  the year it came out, but it puts a confident wrong year on every old article, and
  `src/types.ts` already warns that `fetchedAt` can be fifteen years after publication.
- **A field on the `Timeline` artefact for the assumed year.** It would have to be added to the
  visitor's payload in `src/public/dto.ts`, which is a defence
  ([security-map.md](../project/security-map.md)) and not this run's to edit. `yearFrom` on the
  row travels with the event, which that file already passes through whole.
- **Re-running the timeline on the production article.** A write to production, so Greg's call:
  Metadata → Re-run AI processing on that article does it.

## The review

GPT Sol, plan and code in one pass because the change was small and built while the cause was
being found: [the answer](261005d-timeline-dates-without-a-publication-date-review-sol.md).
Verdict *do not ship*, on one design point (the historical date, answered by the guard above)
and it fixed the rest itself:

- an impossible date (`2026-02-30`) could seed `pieceYear`; a reversed range is now refused;
- **older than this change:** a label could state a year the passage does not, beside a day and
  month it does. Labels now need their year stated in the passage;
- a re-run that turns a year-less row into a dated one re-minted its id and broke `?event=`
  links. `inheritIds` now also matches on the unchanged words and passages, refusing ties;
- the sentences above the list, for every combination of sources; the margin note says
  "(year assumed)".

A second, read-only pass on the guard:
[ship](261005d-timeline-dates-without-a-publication-date-review-2-sol.md).

Gates: `npm run typecheck` green; `npm test` 34,991 passed and 4 failed, all four the tests that
need a build a fresh worktree does not have (`cold-start-lazy-imports`, `pdf-bundle-trace`,
`fleet-decisions-route`, `fleet-reports-route`). Browser check by a Sonnet subagent with
Playwright at 1440, 820 and 390 wide, on the production artefact as stored and as re-dated:
passed, no overflow, no console errors. It ran before the reviewer reworded the sentences above
the list, and it did not check the margin note.

Left as found: Marginalia leaves out every `rejected` row, so a year-less date that the panel
now shows as the article's words has no margin note (`src/web/marginalia/notes.ts`).

The guard depends on `Meta.fetchedAt`, which is not in this stage's fingerprint. A re-fetch in a
later year with the same blocks would keep a timeline dated under the old fetch year. Accepted:
those dates were assumed under the rule as it stood, and they say so.

## Open

- **[Q-timeline-assumed-year]** Keep the guarded assumption, or take it out and show only the
  article's words? The debrief to the Overseer has it in full.
- **A year-less date has no margin note** (above). Queued separately.
- 32 of 47 production articles have no publication date. That is the root of this report and of
  every future one like it, and it is stage 2's (extraction) to improve, not this mode's.

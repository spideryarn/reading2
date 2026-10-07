---
reports: spya-fyjac4
ending: shipped
---

# Timeline shows the dates a piece gives, even with no year to put on them

A problem report from Greg (admin; `feedback-reporter.ts` exited 0 on the report's production row),
2026-10-04 11:24 UTC, on `openai-huggingface`, `?mode=timeline`. Queue item `qi-vxkx7c8g`.

`spya-fyjac4` ([SPIDERYARN-READING2-CE](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-CE)):

> I'm not very impressed by the timeline mode. I'm looking at a piece that has a bunch of explicit dates in it, and yet it keeps saying, dated but which year in the timeline mode. And at the top it says, everything dated here is in 2006. So, sorry, 2026. So it knows that it's this year, and there are dates, and sometimes it even says in the, you know, description that there's a date, but it's somehow not showing the dates above. I mean, the whole point of the timeline mode is it's doing its best to reconstruct the timeline and attach dates and times to them. Now, it's fine if it includes a confidence where it's saying, look, I think this is July the 7th, or, you know, I think this is midnight, but, you know, I'm not certain, and there's a confidence score or whatever. But, yeah, right now it's not even doing that. See the screenshot.
>
> Timeline mode is a fairly low priority, but at some point it would be nice to improve it if we're going to keep it.

**Shipped**, as [261005d](../plans/261005d-timeline-dates-without-a-publication-date.md).

The cause was not the prompt. That article has no publication date in production, so the 17 dates
it writes without a year were refused, and the date column showed "dated — but which year?" in
place of words it already had.

- A date with no year now shows as the article wrote it (`“On July 7”`), on every stored timeline,
  with no re-run. The head of the list no longer says "Everything dated here is in 2026" over them.
- When a timeline is next written for an article with no publication date, and the piece states
  exactly one year, and that is the year we fetched it or the one before, its other dates are read
  in that year and the panel says the year is assumed. On this article that dates all 17 rows.

Not done: times of day, and a confidence score per row. The year is the only thing the mode
guesses, and it says so in a sentence. Whether to keep that guess is the open question in the plan.

Found on the way and not part of the report: Marginalia leaves a year-less date out of the margin
altogether. The queue takes entries only from Greg or the Overseer, so this session asked the
Overseer to queue it in its debrief, with this report id as the source.

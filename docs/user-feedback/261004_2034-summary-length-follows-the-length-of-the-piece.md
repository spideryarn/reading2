---
reports: spya-gttwhn
ending: shipped
---
# A book gets a longer summary than a short article

`spya-gttwhn`, from Greg (admin; relayed by the Overseer as his own report), filed 2026-10-04 20:34
UTC from Summary's Fuller view of *The Order of Time*. Sentry confirmed it (event
`b0525e925f864a1abcb39977739f7f09`). This session did not write the Sentry status; the next
feedback sweep does.

> The length of the summaries should somewhat reflect the length of the text. Not linearly. But a
> book will surely need (at least somewhat) longer summaries than a short article. Hopefully we can
> add a tweak to the prompts to this effect.

**Ending: Shipped.** It is on `dev` and not deployed.

What we did. Fuller's prompt now asks for a length that depends on how long the piece is, in four
bands:

| the piece | Fuller is asked for about |
|---|---|
| under 2,500 words | 250 words, in three to five paragraphs |
| 2,500 to 15,000 (as before) | 500, in five to eight |
| 15,000 to 40,000 | 700, in six to nine |
| 40,000 and up | 900, in eight to eleven |

Measured before and after on six pieces: a book's Fuller went from about 500 words to about 840,
and an 879-word essay's from about 450 to about 260. A blind judge preferred the new Fuller in all
eight pairs where its prompt differed. A piece of ordinary length is asked exactly what it was.

**Brief did not change.** A Brief whose length followed the piece was built and measured too, and
it was worse: the shorter one for an essay left out a point the essay turned on, and the longer one
for a book read as padded. So Brief is about 80 words for everything, as before.

No stored summary changed. *The Order of Time* gets its longer one when Rerun is pressed for
Summary in its Metadata.

Two things are asked of Greg in the plan, neither waited on: whether these are the lengths he
wants, and whether he wants a longer Brief for a book in spite of the measurement.

The plan and Sol's reviews:
[261005b](../plans/261005b-summary-length-follows-the-length-of-the-piece.md). The measurement:
[261005a](../investigations/261005a-summary-length-bands-measured.md). The mode's doc:
[summaries.md § Length follows the piece](../project/summaries.md#length-follows-the-piece-since-2026-10-05).

---
reports: spya-z3uz86
ending: declined
comment: Measured, and no: smaller chunks were not reliably faster and cost about 15% more, because twice the chunks meant twice the re-asks. The speed-up is in those re-asks, which are queued.
---
# More PDF shards would not make a big PDF faster

Report `spya-z3uz86` (SPIDERYARN-READING2-HB), a suggestion, from Greg (admin, production row
proven), 2026-10-11 01:42 UTC, from the home page. Queue item `qi-sm55ckw9`.

> Do you think it would be faster to upload PDFs (especially larger ones) if we sharded even more?
> My understanding is that we break PDFs up amongst up to some number of calls to the LLM that
> transcribes them, so it's a few pages at a time. Would it be faster if we broke them up into even
> more, so a higher concurrency?

**Ending: declined, on a measurement.** Concurrency is already 100, above the chunk count of any
long PDF we have seen, so only the chunk size was a lever. Ten paid runs of the real extract
($3.17): half-size chunks were slower on a dense 142-page paper (median 205 s against 149 s), not
separably faster on a 250-page book, and about 15% dearer: each smaller call is shorter, but twice
the chunks meant about twice the chunks asked again, and on the dense paper the plan went past 100
chunks into a second wave. Nothing changed in production.

What would make a big PDF faster is the tail after the first wave (40–70% of the step): re-asks,
then page-by-page recovery one call after another. That evidence is added to `qi-astc8qqs` and
`qi-az8tvrn4`.

Plan [261011u](../plans/261011u-more-pdf-shards-faster.md); the write-up is
[261011c](../investigations/261011c-pdf-chunk-size-and-extract-speed.md).

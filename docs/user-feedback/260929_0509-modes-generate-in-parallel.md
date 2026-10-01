---
reports: spya-m0cp58
ending: shipped
---
# Modes generate in parallel

SPIDERYARN-READING2-4C, from Greg (admin), in production, build `cba650a3`, on
`/read/arxiv-2212-spya-u5293w?mode=quotes`. Overseer queue `qi-j7ahavj5`. The time in the file name
is when this session received the report from the Overseer; it could not read Sentry.

> Can we run some of the AI processing in parallel? For example, if I've opened up Ideas and Quotes
> and Drawing and Tweet-threads modes, or whatever, there aren't any dependencies between them, and
> probably we won't hit rate limits from the AI provider, so if possible let's allow them to run in
> parallel if the user triggers generation of them. The only complexity I can see is for something
> like Trajectory mode, which should wait until any of the modes that it draws on to have finished
> if they're running. Likewise, I think the Illustrated diagram might depend on the other diagram (I
> forget what we called it). There may be other cases of dependencies that we also need to take
> into account that I've forgotten.

**Ending: Shipped** — on `dev`, not deployed. Resolve 4C (the next feedback sweep does the Sentry
status write).

What we did: the queue held one running job per article. Mode jobs that make different things now
run at the same time. Trajectory still waits for Quotes and Ideas, and Illustrated for the Sketch.
Those are the only dependencies in the code. When two finish close together, the second one lays its
result onto the article the first just published instead of being refused.

This change left the machine-wide limit at 3 running jobs, across all readers. One reader opening
four modes at once fills it, and the fourth mode waits.

Plan: [260929c](../plans/260929c-modes-generate-in-parallel-on-one-article.md).

## Follow-up, 2026-10-01: the limit is now 6

Asked whether to raise the limit to 6–8, Greg (2026-10-01, via the Overseer):

> yes

**Ending: Shipped**: commits `ba98a380` and `63d72091` are on `dev` and not deployed. Production
takes the code default, because nothing sets `SPIDERYARN_JOB_CONCURRENCY` on Vercel. So the next
deploy makes it 6. The Overseer has nothing to set.

Why 6 and not 8: above 3, nobody has measured the limit that bites first. If Vercel spreads the jobs
across machines, it is the AI provider's throughput. If it packs them onto one, it is memory while
several PDFs are read. The database and Vercel's own limits are nowhere near. 8 is the next step,
set as that environment variable, once production has run at 6 with no rate-limit errors, memory
errors or database timeouts.

There is no per-reader share yet, so one reader can still take all six slots. In the recent jobs
there is only one reader, so a share would only have left slots idle. The plan keeps the design
for when it is needed.

Plan: [261001b](../plans/261001b-raise-the-job-concurrency-cap-to-six.md).

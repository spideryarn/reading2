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

One thing for Greg: the machine-wide limit of 3 running jobs, across all readers, is unchanged. One
reader opening four modes at once fills it, and the fourth mode waits. That limit is one environment
variable (`SPIDERYARN_JOB_CONCURRENCY`) and is your call.

Plan: [260929c](../plans/260929c-modes-generate-in-parallel-on-one-article.md).

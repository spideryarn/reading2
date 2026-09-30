---
reports: spya-ydhg7h
ending: shipped
---
# The article's own heading numbers, stripped where we number

SPIDERYARN-READING2-4Q (suggestion), from Greg (admin), in production, build `cba650a3`, on
`/read/arxiv-2212-spya-u5293w?mode=structure&at=spya-q4f4dh&term=spya-ksm3qc&stop=spya-revz3p&depth=2`.
Overseer queue `qi-ac2z88kt`. The time in the file name is roughly when the sweep queued the report
(01:07 UTC); this session could not read Sentry for the exact First Seen.

> Sometimes the headings (e.g. in Structure mode) have numbers at the beginning, which is weird
> because the system *also* adds its own numbered headings/levels. This looks silly/duplicative, and
> confusing (because they don't always agree). So perhaps we should remove numbers from the
> beginning of headings, either with a regex (which might need to also find `1. ` and `1) `, or with
> the LLM that does the Structure mode).

**Ending: Shipped** — on `dev`, not deployed. Resolve 4Q (the next feedback sweep does the Sentry
status write).

What we did: a regex, not the model — it is free, deterministic and fixes every article already on
the shelf without re-running anything. It strips a leading `1`, `1.`, `1)`, `(1)`, `3.2`, `A.1` or
`IV.` from a section title wherever we draw our own number beside it (Structure, Summary, Diagram).
The article's prose keeps its numbers, and so does the Spine, which draws no number of ours. Years,
species names (`V. cholerae`) and bare letters are left alone.

Plan: [260929d](../plans/260929d-remove-hierarchy-mode-and-heading-numbers.md) § The regex. Handled in
the same session as [260929_0100-remove-hierarchy-mode.md](260929_0100-remove-hierarchy-mode.md).

---
reports: spya-sdxwwa
ending: shipped
---
# Remove Hierarchy mode; Structure is enough

SPIDERYARN-READING2-4B, from Greg (admin), in production, build `cba650a3`, on
`/read/arxiv-2212-spya-u5293w?mode=hierarchy&at=spya-ucc60f`. Overseer queue `qi-e9zj8t23`. The
time in the file name is roughly when the sweep queued the report (01:03 UTC); this session could not
read Sentry for the exact First Seen.

> Remove the Hierarchy mode altogether. I think the Structure mode is better/sufficient. P.S. Does
> that simplify our Import process at all?

**Ending: Shipped** — on `dev`, not deployed. Resolve 4B (the next feedback sweep does the Sentry
status write).

What we did: Hierarchy mode and the gist columns it drew are gone; `?mode=hierarchy` links open
Structure. The tree it drew is untouched, because Structure, Summary, Diagram and the Spine all read
it.

The P.S.: **no, not the import.** No pipeline step or tree field became unused, so ingest does the
same work at the same cost. The simplification is in the reading view — a large block of client code
went. The evidence, step by step, is in the plan.

Plan: [260929d](../plans/260929d-remove-hierarchy-mode-and-heading-numbers.md). Handled in the same
session as [260929_0100-strip-heading-numbers.md](260929_0100-strip-heading-numbers.md).

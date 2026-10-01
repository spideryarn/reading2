---
reports: spya-r7d6dz
ending: shipped
---

# The command bar lists sub-modes

SPIDERYARN-READING2-77, a suggestion from Greg, sent from Remember's Quiz on
`dongetal25-spya-vfmvmm`:

> In the Command bar, include sub-modes, e.g. Quiz mode, Illustrated diagram, etc.

**Shipped.** The bar has a row for each sub-mode — *Remember › Quiz*, *Diagram › Illustrated*,
*Referee › Claims*, *Summary › Simple* and the rest — after the mode rows. Enter opens the mode with
that chip already pressed, and starts what the chip would start. The names now live in one place,
`src/web/sub-modes.ts`, and the chips read them from there.
[261001d](../plans/261001d-command-bar-lists-sub-modes.md).

**Left out on purpose, so yours to call**: Quotes' orders (Prioritised, Striking, …) and Search's
Words | Meaning. The repo has called both sub-modes in places, but they reorder or re-query a band
rather than replacing it. Rows for them would be a small addition to the same registry if wanted.

---
reports: spya-hqffdq
ending: shipped
comment: Same bug as #718: Figure 5 still shows the small Earth icon because this article's figures were chosen before that fix. Fixed on dev and deployed; re-importing the article will re-decide its figures (your call).
---
# LeCun's Figure 5 is still the Earth icon

Report spya-hqffdq (#722), 2026-10-28 10:15 UTC, kind problem, from an admin (Greg;
`feedback-reporter.ts` exit 0), on LeCun's *A Path Towards Autonomous Machine Intelligence*, in
Skim at depth `figures`, stop `spya-zqztcw`. No addenda (re-read 2026-10-28, before acting and
before writing this).

> Are you sure this figure is imported correctly? It seems to be another figure of the Earth, but
> the caption doesn't seem to match it.

**Ending: shipped**, as the same bug as spya-m40r6t:
[261027_1203](261027_1203-a-picture-inside-a-pdf-diagram-was-taken-for-the-figure.md), fixed in
`fe72ecd13` and already in the deployed build 1de77eff.

Read from production on 2026-10-28, read-only: stop `spya-zqztcw` is **Figure 5** (page 12), and
its stored picture is the 266×266 Earth bitmap `f2a275…`, the same one Figures 3 and 4 show. That
note names exactly these three. The article's assets step last ran 2026-10-26 21:40, under
`pdf-figures/7`, before the fix; the revision of 10:16 today carried those figures forward
unchanged. So the fix has not reached this article yet, by design: nothing re-runs on its own
([principles.md § 1](../project/principles.md#1-improve-forwards-backfill-only-when-it-is-cheap-or-simpler)). Re-importing it is Greg's call, and the real-model
check is still queued as qi-p95mhwnc (OpenRouter limit resets 1 November). Nothing built here.

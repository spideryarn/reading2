---
reports: spya-x0pvsh
ending: shipped
---
# Opening Summary writes it

SPIDERYARN-READING2-7T (report `spya-x0pvsh`), from Greg (admin, verified by
`scripts/feedback-reporter.ts`), in production, build `7aaead6d`, on
`/read/what-if-we-had-bigger-brains-imagining-minds-beyond-ours?mode=remember…`. This session ran on
a pool account and could not read Sentry.

> When I open any of the Summary submodes, if they haven't already been generated, automatically
> kick off the generation. In other words, don't require me to press a button to trigger the
> generation.
>
> And update new-mode.md accordingly - opening a mode should always trigger generation if it
> hasn't happened already.

**Ending: Shipped** — on `dev`, not deployed. Resolve 7T (the next feedback sweep does the Sentry
status write).

What we did: pressing Summary — on the bar, or any of its rows in the command bar — now writes the
plain-words levels when there are none, and shows the progress; there is no **Write it** to press
first. Arriving on a link or a restored view still spends nothing, as for every mode, so **Write
it** stays for that case and for a retry. While the run is going, the band no longer says "Nobody
has asked for a plain-words version". `new-mode.md` is now `mode.md`; it says opening a mode always
starts it, in your words.

Two things that came with it:

- **The add page's "Generate the main modes" box now includes Summary**, because the box takes its
  list from what each mode's press starts. That adds about $0.10–0.18 per import (Simple is on
  Opus) to the box's ~$0.31. You named Summary in your original list for that box, so it is in.
- **A visitor's press on a mode button no longer arms a run**, for every mode. GPT Sol found it in
  the plan review: the press left a pending "start this" behind that nothing claimed, which an
  owner briefly seen as a visitor could later spend on a mere arrival.

Plan: [261002a](../plans/261002a-summary-generates-on-open.md). The companion report, 7V, is
[261001_0943](261001_0943-parts-and-sections-stay-at-import.md).

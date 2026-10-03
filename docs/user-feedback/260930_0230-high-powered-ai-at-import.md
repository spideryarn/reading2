---
reports: spya-s2rsxy
parts: 2
ending: shipped
---
# High-powered AI, chosen at import

Report `spya-s2rsxy` (SPIDERYARN-READING2-6C), from Greg (admin — `scripts/feedback-reporter.ts`
exits 0), part 2 of 2. Part 1, the switch on `/metadata` and its price, is
[260930_0230-high-powered-ai-per-article.md](260930_0230-high-powered-ai-per-article.md). Picked up
by the 2026-10-02 re-check as Overseer queue item `qi-qjtbt9je`. The part this note answers:

> We also need to provide a way for the user to specify this in the UI. I think the two obvious
> places would be during the import process as a flag they can flip while it's importing, perhaps up
> to the point where it starts doing the structure. I don't know, or keep it simple and find a
> natural place in the UI to include it.

**Ending: Shipped**, on `dev`, not deployed. This session has no Sentry sign-in, so the next sweep
does the status write. Plan and reviews: [261002k](../plans/261002k-high-powered-ai-at-import.md).

**What a reader gets.** On the add page, under *Generate the main modes*, a **High-powered AI** tick
box, off by default and never remembered. Ticked before the import reaches its first capable-tier
step (`structure` for a web page, `extract` for a PDF), the whole import, and the main modes queued
after it, run on Opus. Ticked later, the line under it says some of it may have used the standard
model, and *Run it again* on Metadata redoes a mode.

**Price: unchanged.** It sends the Metadata switch's own request, so it costs exactly what
part 1 set — one more article, half while public, once, never refunded, must fit whole. No new
billing shape was needed.

**Not built, and why.** The charge riding the job server-side, which would survive a closed tab
and charge only an import that got past `fetch`. It is a new billing shape, so it is Greg's call;
the plan names it.

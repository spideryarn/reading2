---
reports: spya-sz8qzx, spya-vskqfn, spya-b23bqq
ending: shipped
---
# A quieter Experimental switch, tooltips on the vertical lines, a readers-only filter

Three admin suggestions from Greg, in production, batched as Overseer queue `qi-y9dcfe2c`. The time
in the file name is the first report's. This session could not read Sentry; the next feedback sweep
does the status writes.

**SPIDERYARN-READING2-80** (`spya-sz8qzx`), build `7aaead6d`, on
`/read/9689-full-spya-m43th2?…&mode=faq…`:

> It's nice that we have the toggle for Experimental features in the bottom bar. But when it's
> toggled on, it's too visible/emphasised somehow - the whole "Experimental" button is orange, and
> the toggle is an even brighter orange. Please de-emphasise.

**Ending: Shipped** — on `dev`, not deployed. The button no longer wears the bar's orange
*selected* look, and the switch, when on, is filled in the button's own ink with the knob on the
right. Hover still turns it orange, like every button in the bar.

**SPIDERYARN-READING2-84** (`spya-vskqfn`), build `4de26073`, on `/`:

> There are vertical lines now next to some blocks. What are they for? They should ideally have
> tooltips to explain themselves.

**Ending: Shipped** — on `dev`, not deployed. Almost certainly the **reading-time** line (darker
the longer you have read there), which he asked about on 2026-09-29 (`spya-qdjdsb`) and which got a
tooltip then — that nobody could reach: the line was drawn 2px outside the box that carries the
tooltip, so pointing at the line itself found nothing. Measured in the browser, then fixed: the line
now sits inside it. The one other new line beside some blocks, Annotations' question rule, now has a
tooltip too. Still nothing on a tap (deferred, as before). If he meant a third line, which side of
the text it was on would find it.

**SPIDERYARN-READING2-87** (`spya-b23bqq`), build `4de26073`, on `/admin/feedback`:

> In /admin/feedback/ , provide a filter to show only non-admin suggestions (i.e. suggestions from
> people other than me).

**Ending: Shipped** — on `dev`, not deployed. *Everyone / Readers only* above the list; the server
does the filtering, by `src/admin.ts`'s list of administrators. Read as every kind of report from
anyone else, not only the ones marked *suggestion* — a kind filter is a separate toggle if wanted.
Not remembered across a reload yet.

Plan: [261001l](../plans/261001l-quieter-experimental-switch-tooltips-on-the-vertical-lines-readers-only-filter-in-admin-feedback.md).

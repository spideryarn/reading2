---
reports: spya-rx43ku
ending: shipped
---
# The headings rail is hidden while Structure or Marginalia is on

One report from Greg, filed 2026-10-04 10:25 UTC on `?mode=summary`, relayed by the Overseer as an
admin's report (queue item `qi-5hzbvgcm`). Proven from the production row with
`feedback-reporter.ts` (exit 0). SPIDERYARN-READING2-C3.

> We have a horizontal rail at the top that shows us where we are with heading breadcrumbs in terms
> of the structure. We don't need to show that horizontal rail when either structure or annotations
> mode are on, because they both provide that information too.
>
> — Greg, 2026-10-04 (`spya-rx43ku`)

## What we did

Plan, GPT Sol's two reviews, and the browser table and shots:
[261004k](../plans/261004k-hide-the-headings-rail-while-structure-or-marginalia-is-on.md).

- **With Structure open, the breadcrumb is not drawn.** For an owner the whole top bar goes, so the
  prose starts 44px higher.
- **With Marginalia's column on screen, the same.** "Annotations" is Marginalia; its head at the
  top of the right column names the part and the section.
- **With Marginalia switched on but the window too narrow for its column, the breadcrumb stays**,
  because there is no head there and nothing else says where you are. The cut is about 612px wide.
- Every other mode is unchanged.

## Left for later

One gap, queued as `qi-2ymfq3ek` (a proposal, not authorised): at the very top of an article, above
the first heading, Marginalia's head is empty where the breadcrumb used to name the first part.
The fix proposed is to have the head start from the first section.

## For Greg to look at

Switching between Summary and Structure now moves the prose by the height of the bar, on top of the
rewrap a different band width already causes. Whether that reads as a jump is a thing to see on a
real screen.

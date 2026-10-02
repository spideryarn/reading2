---
reports: spya-hf4svm
ending: shipped
---
# The (i) and the profile icon line up, in the same place in every mode

Report `spya-hf4svm`, from Greg (admin), 2026-10-02, relayed by the Overseer with no Sentry mirror,
on `https://www.spideryarn.com/read/s41598-023-33209-9-spya-hxekgz?term=spya-trxfqv&mode=summary&summary=brief`:

> We've added (i) and profile icons to every mode. Great. But their position/sizing/alignment looks
> a bit off, especially on a phone. Take screenshots and see if you can improve this. And perhaps
> update docs or make this reusable/template as part of creating new modes so that it's a bit more
> standardised.

**Ending: Shipped**, on `dev`. Plan
[261002e](../plans/261002e-mode-corner-icons-and-gutter-icon-polish.md).

What the screenshots showed: on a phone the profile icon was a 40px ringed circle beside a 24px (i),
9px lower, and each mode put it somewhere different: top-left in Ideas and Tweets, a second row in
Glossary, at varying gaps in Summary and Quotes.

What changed: the profile icon now sits in the band's top-right corner, just left of the (i), in
every mode. The two are the same size (24px with a mouse, 32px on a touch screen), share a centre
line, and have the same gap everywhere. Ideas used to say *"written for you"* in words; it is now
the same icon as the rest, and the panel it opens still says it in words.

The template part: a mode hands its badge to `ModeSurface` as `profile`, and the corner, sizing
and spacing all follow. mode.md says so, and a test fails if a profiled mode puts its badge
anywhere else.

Not done: Sketch's badge stays in its picture's own toolbar, because moving it means restructuring
how that view is built. It is named in the plan's § Deferred.

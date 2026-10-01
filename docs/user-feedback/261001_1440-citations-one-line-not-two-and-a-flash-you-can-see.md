---
reports: spya-ac5msa, spya-e2yzkf
ending: shipped
---
# Citations: one line, not two, for an author–year work; and a *first cited* flash you can see

Two of Greg's suggestions from the Feedback dialog (he is admin), both filed 2026-10-01 on the same
Citations view, batched by the Overseer as queue item `qi-ye7ytftw`. SPIDERYARN-READING2-7W and
SPIDERYARN-READING2-7X. Neither had been built (checked against `git log origin/dev`, `docs/plans/`,
this directory and `gjd-remote ls` on 2026-10-01). The time in the file name is when this session
picked them up.

`spya-ac5msa` (7W):

> In the new version of Citations mode, it sometimes shows the same thing twice, e.g.
> `Bartlett (1932)` / `Bartlett · 1932`. This isn't always the case. Perhaps it depends on how it's
> cited in the text. So sometimes the bottom differs from the top line. If they're the same, don't
> show the bottom line?

`spya-e2yzkf` (7X):

> In Citations mode, if I click the "first cited" it scrolls to that block and flashes the exact
> text that cites - great. But it's a little bit too subtle and quick, so I often don't quite spot
> the flash.

**Ending: Shipped**, both, in the commits listed in
[261001m](../plans/261001m-citations-duplicate-by-line-and-a-flash-you-can-see.md). Not deployed:
the Overseer deploys.

- **7W.** His guess was right: when the article gives a work only as an author–year label, that
  label becomes the card's title, and the line under it said it again. Now the second line is left
  off when it says the same words. The comparison is deliberately narrow — brackets, the middle dot,
  `&`, `et al.` — so `Smith-Jones (2001)` is still not `Smith, Jones · 2001`. Hovering the line used
  to show the reference-list entry, which for these works is often the only place the real title is,
  so that card now opens from the title instead (on a phone, the first tap shows it and the second
  opens the link).
- **7X.** The flash on a cited work's words now lasts 2.4 seconds instead of 1.2, in a stronger
  orange, with a quick pulse at the start. Only that flash changed: a paragraph's flash, and
  Trajectory's flash on every step, keep the old one, because doubling them would make stepping
  through Trajectory a near-continuous pulse (GPT Sol's review). Metadata's table-of-contents flash
  (7Y) is a separate report and is not changed here.

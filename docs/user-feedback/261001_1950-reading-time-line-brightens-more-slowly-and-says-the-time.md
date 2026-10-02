---
reports: spya-d940uu
ending: shipped
---
# The reading-time line brightens more slowly, and its card says the time

A suggestion from Greg (admin; `scripts/feedback-reporter.ts` exited 0, which proves the production
row), sent from the reading view of `s41598-023-33209-9-spya-hxekgz`, build `6bdf24dc`.

## [SPIDERYARN-READING2-9N](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-9N) — spya-d940uu, 2026-10-01 19:50

> For the reading timeline, I think it gets brighter when I read a block for more time. It seems to
> get brighter too fast. There's lots of blocks that have lines next to them that I think I haven't
> spent that much time on. So maybe increase the threshold or basically slow down the rate at which
> it gets brighter.
>
> Or make it kind of, I don't know, like finishing marginal returns of brightness with passing of
> time. And also add the time spent to the tooltip. Play at the tooltip with a rich tooltip.

**Ending: Shipped.** On `dev`, not deployed. Resolve 9N.

## What we did

- **Later, and each step twice as late as the one before.** A line appears once a passage has had
  35% of the time it takes to read (at 230 words a minute), not 10%; then 70%, 140% and 280%. A
  glance draws nothing; one brisk read is a faint line; full strength is a slow read or nearly
  three. The opacities 261001r set the night before are unchanged — that session made the line
  steeper at the top, this one moves *when* each step is reached.
- **The rich card says the time**: "You have spent 1 min 20 s here. It takes about 26 s to read.",
  counting up while it is open. The card itself landed the night before (261001r, spya-mn3ruw).
- **The quiz's "Only what I've read" is unchanged**: it still means 70% of the reading time, which is
  now level 2 rather than 3.

[The plan](../plans/261002e-reading-time-line-brightens-more-slowly-and-its-card-says-the-time.md),
with GPT Sol's plan and code reviews beside it.

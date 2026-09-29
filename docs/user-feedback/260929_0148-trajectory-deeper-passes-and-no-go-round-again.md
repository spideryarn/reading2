# Deeper passes should add detail; no "go round again" button

[SPIDERYARN-READING2-51](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-51) (2026-09-29
01:48 UTC), from an admin (Greg), in production, build `43f99ecb`, in Trajectory.

> For Trajectory mode, let's assume the reader has read the coarser levels already, so the more-detailed levels should be adding extra detail/subtlety/complexity.
> And maybe we don't need a button for "do this level of detail again" - they can just press left a bunch of times.

**Ending: Shipped** — on `dev`. The next feedback sweep does the Sentry status write.

- **The button:** *Go round again* is gone from the end of a pass; *More detail ›* stays, and ←
  walks back. The end of *Most* now has just its end line.
- **The deeper passes:** tried as a prompt change and **not kept**, because it measured no better
  than the current prompt's own run-to-run noise. The reason is structural: *Most* is every quote on
  offer, so the route prompt can only move quotes between *More* and *Most*. What would make deeper
  passes add rather than retell is better quotes to choose from, or a route willing to drop a quote
  that only restates an earlier stop — handed to the snippet-variety work (4P).

Plan: [260929b](../plans/260929b-trajectory-deeper-passes-one-door-promise-in-a-tooltip-list-follows-the-stop.md);
the measurement: [stage 2 eval](../plans/260929b-trajectory-stage2-deeper-passes-eval.md).

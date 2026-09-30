---
reports: spya-a6xsr2
ending: shipped
---
# Stepping keeps the current stop visible in the band's list

[SPIDERYARN-READING2-54](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-54) (2026-09-29
01:51 UTC), from an admin (Greg), in production, build `43f99ecb`, in Trajectory.

> In Trajectory mode, if I click left/right step buttons that takes us off the top/bottom of the scroll window of the left-hand Trajectory-mode column, it should scroll accordingly to keep them visible.

**Ending: Shipped** — on `dev`. The next feedback sweep does the Sentry status write.

Any step — ‹ ›, ← →, the door in the prose, a depth change — now scrolls the band's list just
enough to show the current stop, using the same follow Summary's column already uses. It moves only
the list, never the page, and on a narrow window it catches up when the band comes back.

Plan: [260929b](../plans/260929b-trajectory-deeper-passes-one-door-promise-in-a-tooltip-list-follows-the-stop.md).

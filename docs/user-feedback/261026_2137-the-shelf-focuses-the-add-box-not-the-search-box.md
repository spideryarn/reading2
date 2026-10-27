---
reports: spya-nmx5ga
ending: shipped
---
# The shelf focuses the add box on arrival, not the search box

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-26 21:37 UTC, a suggestion filed from
`https://www.spideryarn.com/`. Sentry SPIDERYARN-READING2-PG (#716), resolved. Session
`fbnmx5ga-add-box-focus`. No addenda when re-read before acting and before this note.

> By default, put the focus in the add box, not the search box.

**Ending: Shipped**, on `dev`. Plan
[261027a](../plans/261027a-the-shelf-focuses-the-add-box-on-arrival.md). The focus-on-arrival
effect moved from the search box to the add box's URL field, keeping its guards: no focus on a
phone (coarse pointer, so no on-screen keyboard), none over something already focused, none when
the box is off screen after Back, and none when the page arrived with `?q=`. Nothing on the shelf
had a key that relied on the search box being focused (`/` exists only on the reading view).
Checked in a browser on desktop, `?q=`, touch and Back; GPT Sol code review clean
([review](../plans/261027a-the-shelf-focuses-the-add-box-code-review-sol.md)).

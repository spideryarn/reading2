---
reports: spya-wzmvva
ending: shipped
---
# A cross to clear the shelf's search box

SPIDERYARN-READING2-C7 (`spya-wzmvva`), from Greg (admin, proved by `feedback-reporter.ts` exit 0),
filed 2026-10-04 10:38 UTC from `/?archived=1`. This session had no Sentry sign-in; the words are
from the report's production row.

> Little cross button to clear the search on the logged in homepage shelf.

**Ending: Shipped.** It is on `dev` and not deployed. Resolve C7; the next feedback sweep does the
Sentry status write.

There was already a cross, since August: a small, thin grey one that was hard to see, and in Chrome
the browser drew a second, bolder one beside it while you were typing. What we did:

- There is now one cross. It is bigger and brighter (the same cross that closes a comment or a
  dialog), with a larger target for a finger.
- After you press it, the cursor is back in the box, ready for the next search. Not after a tap with
  a finger or pen, so the on-screen keyboard does not jump up over the shelf.
- Escape clears the box too, when there is something in it.

Not checked on a real iPad, in Safari, or in the light appearance; the box cannot run those. Nothing
deferred.

Plan: [261004f](../plans/261004f-shelf-search-clear-cross-that-can-be-seen.md).

---
reports: spya-jgwmaf, spya-vn72ww
ending: shipped
---
# Metadata: the contents list opens and flashes its section, and a search box above it

Two suggestions from Greg (admin: `scripts/feedback-reporter.ts` exited 0 on each), both on the
Metadata page's contents list in the left margin. The time in the file name is when the first was
filed; this session has no Sentry sign-in, so the report text came in the brief.

**[SPIDERYARN-READING2-7Y](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-7Y)**
(`spya-jgwmaf`), on `/read/9689-full-spya-m43th2/metadata`:

> If I click on the Table of Contents in the left-hand of the Metadata page, expand that section (if
> needed) and flash to show where it is in the page.

**[SPIDERYARN-READING2-83](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-83)**
(`spya-vn72ww`), on `/read/bf03197835-spya-qfwsw2/metadata`:

> Add a Search box (above the left-hand table-of-contents) to the Metadata page (and make sure it
> does a good job of finding things, including synonyms), and then should scroll to the right place,
> expand the section, flash it, etc (reusing machinery).

**Ending: Shipped**, both — on `dev` as `5e4d53e8` and `f792d577`, not deployed. Resolve 7Y and 83; the next feedback
sweep does the Sentry status write.

What we did:

- **Clicking an entry in the contents list opens that section if it is shut**, scrolls to it, and
  **flashes it** once the scroll stops — the reading view's flash (same orange, same second or so),
  drawn as a translucent layer over the whole section so it shows over the cards too. Focus lands on
  the section's heading, so a keyboard or screen-reader user arrives with it.
- **A search box sits above the list.** Typing narrows the list to the sections that match, best
  first; **Enter** goes to the first the same way a click does; **Escape** clears it.
  - It finds a section by its name, by a few words written for each section, and by the one-line
    answer on its heading (*$0.0123 · 12 calls*), **through a small synonym table**: *price*,
    *money* or *spend* find *What it cost*; *download* finds *Export*; *remove* finds *Delete*;
    *public* or *link* find *Access & sharing*; *regenerate* finds *AI processing*; *fingerprint*
    finds *Technical details*. Plurals and *-ing* are folded, it matches as you type, and a question
    works — *how much did this cost*.
  - No model call: nothing per keystroke, and nothing to wait for.
- The margin column is now pinned near the top rather than centred, so the box does not move under
  your cursor as the list shrinks.

Deferred, and named in the plan:

- **It does not search the words inside a section**, only the section's name, its keywords and its
  heading's answer. Searching the body would have found a line and then dropped you at the section's
  heading, screens above it in *AI processing*; landing on the matching line is the next version if
  you want it.
- **On a window narrower than 1280px there is neither list nor box**, as before. What the contents
  list becomes on an iPad is a separate report (9M) with its own session; the search box should
  follow whatever that decides rather than invent a second narrow-window design.

Plan: [261001s](../plans/261001s-metadata-contents-opens-and-flashes-its-section-and-a-search-box-above-it.md),
reviewed by GPT Sol before and after building.

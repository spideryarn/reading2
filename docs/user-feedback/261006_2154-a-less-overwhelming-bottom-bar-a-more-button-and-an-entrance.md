---
reports: spya-dest8x
ending: shipped
---
# A less overwhelming bottom bar: a More button, and the bar rises in

Report `spya-dest8x` (Sentry SPIDERYARN-READING2-E6), a suggestion, from Greg (admin, provenance
proved against the production row), 2026-10-06 21:54 UTC, filed from `/changelog`. Overseer queue
item `qi-wpkewsk3`.

> I really want to make the experience for a brand new user a bit less baffling and overwhelming. So
> I've got a few ideas. One might be to draw a little bit of attention to the bottom bar, because
> obviously that's critical. So perhaps it appears, maybe it fades in or slowly rises to the top when
> the page, the article first loads after a second, so that the page can load and then it draws
> their eye to it. Let's try that. The other is there's a whole bunch of modes in the middle that
> people probably don't need to open that often. I'm thinking of the glossary, FAQ, ideas, timeline,
> quotes, because a lot of them have been folded into other larger modes, or meta modes like skim
> and marginalia. Or they're just visible in the text. You know, I don't think I use the glossary
> mode itself very often because I just hover over the word. And so for those, I wonder if we could
> maybe gather them together and create either a dot dot dot or a more button in their place. And if
> you click on them, it sort of expands upwards to let them choose from those. And that way, it
> would indicate somehow that they aren't as important as the other modes like summary, structure,
> chat, learn, search, marginalia. And maybe a couple of others I've forgotten. Those are the most
> important modes, and so I want them to be more visible. So let's try that as an experiment

**Ending: Shipped**, on `dev`, not deployed. Plan:
[261007c](../plans/261007c-bottom-bar-rises-in-on-first-load-and-a-more-button-gathers-the-lesser-modes.md).

## What changed

- **A More button.** Quotes, Glossary, FAQ, Ideas and Timeline are no longer buttons in the bar.
  One button, `…` More, stands after the modes and before Marginalia, and opens a list of them
  upwards, each with a line saying what it is. While one of them is open it has its own button in
  the bar, as before, so you can see where you are and press it again to close it. The command bar
  still lists all five.
  [Wide](../plans/261007c-shot-2-more-open-1440.png),
  [phone](../plans/261007c-shot-9-phone-more-open-390.png).
- **An entrance.** On the first article opened after the page loads, the bar is absent for a
  second, then fades and rises into place. Not on later articles in the same tab, and not for a
  reader who has asked their system for less motion.

Both are for every reader, including a signed-out visitor.

## Assumptions for Greg to overrule

Each is a small change to reverse; the plan says where.

- **"As an experiment" was read as "let's try it", not as "behind the experimental switch".** That
  switch is off for a new reader and cannot be turned on by a visitor, who are the people this is
  for.
- **More stands after Learn, not exactly where the five were.** The mode buttons are one group to a
  screen reader ("pick one of these"), and a menu button does not belong inside it.
- **The entrance plays for everyone, once per page load.** The app cannot tell a new reader from a
  regular.
- **The second of absence starts when the bar is first drawn**, not when the article has finished
  loading. On a slow load it is partly spent already; on a fast one the full second shows.

## Not deferred, and one older item changed

Nothing in the report was left unbuilt. The older proposal for an "Extracts" menu
(`qi-5ay85q7d`) is answered by this; that entry now holds only its other question, a filter on
Marginalia's kinds of note, which still waits on Greg.

## What was checked

`tests/dock-more.test.tsx` and `tests/dock-entrance.test.tsx` (new, seen failing first), and the
twenty-two existing files that walk the bar; `npm test` and `npm run typecheck`; GPT Sol reviewed
the plan (ten findings, all taken) and the code (one fix of its own, for a phone held sideways);
Chrome on the box at 1440 and 390, light and dark, signed in and signed out.

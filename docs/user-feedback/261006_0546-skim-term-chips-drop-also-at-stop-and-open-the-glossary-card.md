---
reports: spya-se0e4v
ending: shipped
---
# Skim: term chips need not say "also at stop X", and should open the usual glossary card

`spya-se0e4v`, a suggestion from Greg (admin row, Sentry confirmed, event
`c846c5e5afac4ca18a283f19d441178f`), filed 2026-10-06 05:46 UTC from Skim on
`2608-13566v1-spya-yurten`. This session has no Sentry sign-in and did not write the Sentry status;
the next feedback sweep does.

> In Skim mode, the Glossary clues don't have to say "also at stop X". And they should provide/reuse the usual "go to glossary" etc in rich tooltips

**Ending: Shipped.** It is on `dev` and not deployed.

What we did, in
[261006e](../plans/261006e-skim-cue-situates-the-quote-and-term-chips-use-the-glossary-card.md):

- **"also at stop k" is gone.**
- **A term chip opens the glossary's own card**, the one the prose shows for an underlined term:
  what it means here and in general, what the web said, and *Dig deeper · Hide · Open glossary*.
  Hover or focus on a desktop; a tap that stays open on touch. A visitor gets *Open glossary* alone.
  The one line that used to open in place under the chips is gone for terms. Ideas chips still open
  in place.
- Checked in a browser at desktop, iPad and phone widths. On a phone held sideways the card is short
  (about 131px, scrolling inside itself), and swiping the band to reach it may close it. Not built
  for; named in the debrief.
- GPT Sol's code review found and fixed two bugs before it landed
  ([postmortem](../postmortems/261006g-input-and-focus-ownership-inferred-from-shared-ui-state.md)).

---
reports: spya-yqfzkm, spya-p09u4s, spya-n04d5p
ending: shipped
---
# Glossary: hide an entry, Dig deeper on the card, hyphenated terms found

Three reports from Greg (admin) on 2026-10-02, all on
`/read/s41598-023-33209-9-spya-hxekgz`, dispatched together by the Overseer with no Sentry
mirror.

`spya-yqfzkm`, a suggestion:

> Give me a way to hide a Glossary entry (e.g. because I know it already, and/or it keeps showing up
> too much).
>
> Definitely there should be a way in the Glossary mode (e.g. swiping right should reveal a
> trashcan, or just show a trashcan icon). It might be nice to be able to do this from the tooltip
> that appears when I hover/touch a Glossary entry in the article without having to go to Glossary
> mode.
>
> I can't decide whether it should just hide (for me) or delete (for everyone, e.g. for a public
> article). Let's go with Hide for now.
>
> LOW PRIORITY And perhaps there'd be a thing in the Glossary mode to see/review/unhide Hidden items?

`spya-p09u4s`, a suggestion:

> We have a "Dig deeper" in Glossary mode. Add that to the in-text glossary tooltip.

`spya-n04d5p`, a problem:

> the glossary item for delayed win-shift only shows one block-link, even though that shows up
> throughout the article. why? is it something to do with spacing/hyphens? how could we improve this
> without adding too much complexity?

**Ending: Shipped**, on `dev`. Plan
[261002c](../plans/261002c-glossary-hide-an-entry-dig-deeper-from-the-card-hyphens-match-spaces.md).

- **Hide**: a trash-can button on each Glossary row and *Hide* on the in-text card. It applies only
  to the owner's own view. A hidden term loses its underlines, its card, its row and its place in
  the counts. A collapsed *Hidden (n)* section at the foot of the band has *Unhide*.
- **Dig deeper on the card**: it starts the dig and opens the band on that term, where the answer
  streams in. The card was already clickable (`ProseHoverCard`), so this did not wait on the
  shared-Tooltip work.
- **Delayed win-shift**: yes, it was hyphens. The entry was named *Delayed win-shift task*, and the
  paper mostly writes *delayed-win-shift task*. A space and a hyphen between words now match each
  other, and every glossary read works out the occurrences again, so existing lists pick up the
  fix without a re-run. That takes this term from 1 block to 5 of the 7 that mention it. The
  other two say *delayed win-shift radial arm maze* (no "task") and *delayed radial maze win-shift
  task* (the words split apart). Catching the first would need the prompt to add a shorter alias,
  which is deferred in the plan because a prompt change has to be measured first.

Deferred by name in the plan: delete-for-everyone, a visitor hiding terms on someone else's public
article, the swipe gesture, and the shorter-alias prompt change.

---
reports: spya-nseuz2
ending: shipped
---
# A spinner while the block chat waits, and the panel in the Marginalia column

A suggestion from Greg, relayed by the Overseer as his own report (`feedback-unswept.ts --show`
lists it as an admin's; Sentry event confirmed). 2026-10-03, sent from
`entropy-26-00481-with-cover-from-taylor-beck-spya-naz564` with a Structure band and Marginalia
open:

> I just had a comment chat on a block, so I clicked the comment button and asked, or maybe I clicked
> the question button and then the AI responded. Okay, great. A couple of thoughts. One is, can we
> have a loading spinner when we're waiting for the AI? I think it says something faint like waiting
> for answer, but it'd be better to have a loading spinner. And then secondly, I think now that we
> have a right-hand column that we sometimes use for marginalia, why don't we put the block-level
> chat comment in that right-hand column? I'm not 100% sure this is a good idea. So, you know, if you
> disagree, I mean, maybe we could situate it relative to the block, but I don't want to make things
> too complicated either. I want to kind of make it clear that it's a block-level comment somehow.
> But at the moment, it kind of shows up in this own panel that kind of occludes things, and I mean,
> it's okay, but I just feel like it's more in the way than it would be if it was in the right-hand
> column. So see if you can come up with a good solution.take some screenshots.

**Ending: shipped.** On `dev`, not deployed. No migration.

What we did, in
[261003p](../plans/261003p-block-chat-spinner-and-docking-in-the-marginalia-column.md):

- **The spinner.** There was one, 13px and faint, and it vanished between a tool finishing and the
  answer's first word, which left only the composer's grey *Waiting for the answer…*. A waiting
  turn now keeps a 16px spinner and *thinking…* until the first word. Chat, Remember and the block
  panel share it.
- **The panel sits over the Marginalia column** when that column is showing at full width: clear of
  the prose, at desktop and iPad-landscape widths. With Marginalia off, on an iPad in portrait and
  on a phone it floats in the corner as before.
- **The block it is about wears a rule** down its right edge while the panel is open, at any width.
- Screenshots: [before](../plans/261003p-shot-1-A-before-floating.png),
  [after](../plans/261003p-shot-2-A-after-docked.png),
  [the spinner](../plans/261003p-shot-3-A-spinner.png), and the rest in the plan.

**Left for Greg to decide, with these screenshots in hand:** whether the conversation should
instead be a card in the column level with its block (the plan's option B), and whether the panel
should dock with Marginalia off. The question went to the Overseer in the session's debrief, with a
queue entry for it to add (the queue takes entries only from Greg or the Overseer).

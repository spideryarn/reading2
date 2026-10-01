---
reports: none
ending: shipped
---
# Chat's suggestions scrolled off the top on a landscape phone; the Sketch overlay had no backdrop

Not from a reader. The qw-compact-tops-and-diagram-enlarge session found both during the browser pass
for plan 261001l. The Overseer dispatched them as one bug fix, with no Sentry id. The time in the
file name is when this session received them.

> On a landscape iPhone (band ~338px tall, ~290px wide in places), the Chat band's empty-state
> suggestions are positioned partly above the band's top edge and clipped.

> The Sketch's Enlarge overlay is as wide as the window at 1280 and 1600px, so there's no backdrop to
> click and clicking outside to dismiss can't be reached (Escape and Close still work).

**Ending: Shipped.** On `dev` in `6553a6e5` and `78d2dde2` (GPT Sol's review fixes, which also stop the floating chat dialog carrying scroll position and a draft from one conversation to the next). Not deployed: the Overseer deploys. There is no Sentry
issue to resolve.

- **Chat.** The suggestions were not clipped. They were *scrolled*: the follow-the-latest-turn
  effect scrolled an empty conversation to its bottom. On a landscape phone that put the hint and
  the first question off the top. An empty conversation now opens at the top.
- **Sketch.** The suspected cause was right. `.sk { flex: 1 }` beat the overlay's width, which is
  the same trap Illustrated's overlay was fixed for on 2026-09-05.

[261001n](../plans/261001n-chat-suggestions-read-from-the-top-and-the-sketch-overlay-leaves-a-backdrop.md)
has the measurements, the root causes and the tests.

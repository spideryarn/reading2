---
reports: spya-d886ah
ending: shipped
---
# The sharing mark's card: the state, what sharing means, and the press, apart

Report `spya-d886ah`, a suggestion, from Greg (admin), 2026-10-02, relayed by the Overseer with no
Sentry mirror, on
`https://www.spideryarn.com/read/s41598-023-33209-9-spya-hxekgz?term=spya-y2tchy&mode=summary&summary=fuller`:

> The "Only you can read this. Share it with anyone" is a very confusing tooltip.
>
> One sentence is a statement of the current state. The other is a potential action. But there's no
> explanation of what this means or how this functionality works, or any UI differentiation between
> these two kinds of sentence.
>
> Do some web research on UI best practices for this kind of thing, consider whether we could have
> an action within the tooltip, and how to improve our UI text, and then update docs & prompts for
> UI text and tooltips, improve this particular tooltip, and look for other tooltips/UI text that
> should also be improved.

**Ending: Shipped**, on `dev`. Plan
[261002e](../plans/261002e-sharing-mark-tooltip-separates-state-from-action.md); research
[261002b](../research/261002b-tooltip-text-state-versus-action.md).

What changed. The padlock's card now reads, top to bottom: **Private** · *Only you can read this.* ·
what sharing would do (a public page anyone can read without signing in, listed publicly, with the
article, most of what the AI made of it and your comments; nothing goes until you have seen the
list and confirmed) · and, on its own line with a rule above and an arrow, *Press to go to this
article's Metadata page, where Share… starts it.* The shared card has the same shape. Cards have a
new optional last line for "what pressing does", styled as a different kind of sentence from the
statements above it.

Also fixed while there:

- **The Archive icon beside it** had the same mix (*"Off your shelf. Press to put it back."*), and
  its card was missing the styling class every other card has, so its text came out larger. Both
  fixed.
- **Archiving a shared article takes it off the public list** (its link still works), and neither
  card said so; the shared card claimed *"it's listed publicly"* regardless. Both cards now say it.
  Found by GPT Sol's plan review.
- **A visitor saw "Your note on this paragraph"** over the owner's note in the gutter. It now says
  *"A note on this paragraph from whoever added this article"* (C7 from the Help-page review).
- The glossary card's Hide button's hover text was two instructions in one run; now statements.

An action *inside* the card (a real Share… button) waits for the clickable-card work on `Tooltip`,
which was not on `dev` yet. The rule change for tooltips.md is proposed to Greg, not applied.

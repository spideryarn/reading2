# The blue chip in the gutter opened a new conversation instead of the ones it counted

**[SPIDERYARN-READING2-1Q](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1Q)** · problem ·
reported 2026-09-05 08:07 UTC · **shipped**

## What Greg said

> I tried to click on a blue Comment box in the vertical gutter next to the Text to see previous
> comment and model response, but it showed me the panel for a new Comment. I think it should have
> shown the previous Comment with a way for me to add new comments to the same block if I want to
> somehow. Get product input from Fable, and use GPT Sol for adversarial review with a bias towards
> simplicity/cleanness.

## The chip was not the one the report names, and that mattered

The gutter has two marks that carry a count. The **orange** bookmark (`.blk-cmt`) already did what
the report asks — it opens the existing comment in `CommentDialog`. The **blue** one
(`.block-chat.has`, `--chat-mark`) is the chat button, and it was the broken one. *"Previous comment
**and model response**"* settles it independently: a comment has carried no model answer since
2026-08-28, so the only place a reader's words and a model's reply sit together is a conversation.

Confirmed in a browser before anything was designed — and that turned up the half the report does not
mention. **The count went 1 → 2 → 3 across three presses.** Every press of a chip advertising three
conversations was quietly making a fourth, so the badge the reader pressed to escape grew each time
they tried.

## What shipped

`chatAboutBlock` now opens what the chip is counting, where before it minted a draft unconditionally
— while `helpAboutBlock`, twenty lines below it, had reopened all along. A whole-block conversation
outranks a selection however much newer the selection is; the copy stops promising a set it will not
give; and a "New conversation" link keeps the door the chip used to be, so the fix is not also a
removal.

Fable made the product call, GPT Sol reviewed it adversarially, and they disagreed twice — Sol won on
which conversation opens, Fable won on keeping the new-conversation door. Both are argued in the plan.

**Plan:** [260905c-gutter-comment-chip-explanation-metadata-and-prompt.md](../plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md)

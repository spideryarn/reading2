---
reports: spya-gmtt4b
ending: shipped
---
# After Enter sends, the on-screen keyboard goes away

Report `spya-gmtt4b`, a suggestion, from Greg (admin), 2026-10-03, relayed by the Overseer (Sentry
event `5303ad4d1fc7422eb4411827e277d9f6`), on the Entropy article in Remember's tutorial with a
conversation open:

> When a keyboard pops up on iOS, it often has a sort of an enter key, but no done button. In cases
> where I'd expect there to be a done button or something more, or some kind of command button, I'm
> not sure about this, but I think I remember that in iOS programming, there's a way to specify that
> for the keyboard. And so what I end up doing is pressing the carriage return button, and then
> sometimes I can actually press the sort of keyboard hide button because the keyboard doesn't
> disappear. Does this make sense? If you can understand what I mean and you think there's a clear
> fix, then great, and make sure you look for where we should apply it throughout and maybe find
> appropriate docs to signpost and update to this guidance. Or if you don't understand, then ask me
> or we can discuss.

**Ending: Shipped**, on `dev`, for the part with a clear fix. Plan
[261003h](../plans/261003h-four-small-ui-fixes-gutter-gap-glossary-card-row-keyboard-dismiss-voucher-form.md).

The key's label was decided box by box on 2026-09-04 and is already *send*, *search* or *done* where
Enter does something
([touch.md § What the Enter key promises](../project/touch.md#what-the-enter-key-promises)). What
was missing is what happens next: the message went and the keyboard stayed over the answer.

- **Built**: in chat (the tutorial included), Referee's Candidates box, the comment follow-up, the
  glossary's look-up and the search box, the keyboard goes away once the send or search has
  happened. Only an on-screen keyboard: at a desk, and on an iPad with a hardware keyboard, the
  caret stays in the box. The rule is in touch.md, with the list of boxes.
- **Not built, and asked of Greg in the debrief**: the multi-line boxes where Enter is a new line
  (Feedback, a comment, a quiz answer). A web page cannot add a Done key to the iOS keyboard, so
  those would need a button of our own. Nothing is broken there, so there is no queue entry.
- **A limit**: Android Chrome reports its keyboard differently and is not detected, so it behaves
  as before.
- **Not tried on a real iPad.** The check is automated tests against the numbers iOS reports.

**Greg's answer, 2026-10-03**, to [Q-keyboard-done]: build our own Done button for the multi-line boxes, or leave them as they are?

> ok go with your judgment

**Left as it is.** The box's own Send or Save button ends it, and the keyboard goes away when the box
closes. Revisit if he finds himself stuck with the keyboard up on an iPhone, which has no hide key.

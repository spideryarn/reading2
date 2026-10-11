---
reports: spya-gae0zv, spya-srg5fa
ending: shipped
comment: The guide no longer opens a mode by itself: it suggests one with a button you press. Every chat's typing box is bigger and stands out more, and the suggestion buttons sit in the centre.
---
# The guide suggests with a button; a bigger chat box; suggestions in the centre

Two admin reports from Greg (`scripts/feedback-reporter.ts` exit 0 on both, no addenda), filed
2026-10-11 at 01:36 and 01:38 UTC from the shelf, #555 SPIDERYARN-READING2-H4 and #558
SPIDERYARN-READING2-H7, both suggestions. Queue item `qi-gr52s8dn`, session
`fbgae0zv-guide-suggests-not-jumps`. Plan, both GPT Sol reviews, the browser check and its
screenshots:
[261011m](../plans/261011m-guide-suggests-a-mode-with-a-button-a-bigger-chat-box-suggestions-centred.md);
the measurement: [261011a](../investigations/261011a-the-guide-offers-buttons-only-measured.md).

> I was showing the guide chat to a new user, and they asked it for suggestions, and it opened a
> different mode directly, and they were surprised and didn't know what to make of it. I think
> instead it should suggest things, with a UI button for them to press that would take them to that
> mode, so that they're aware of what's happening.
>
> — Greg, 2026-10-11, `spya-gae0zv`

> In all the various chat modes (including Guide etc), can you make the input box larger and a tiny
> bit more prominent? I don't think people initially noticed it, especially when we offer them UI
> suggestions in little boxes. Perhaps we could actually move those into the center as well, so
> they're a bit less prominent underneath the last agent response.
>
> — Greg, 2026-10-11, `spya-srg5fa`

## Ending: shipped

On `dev`, not deployed.

- **The guide never opens anything itself.** It used to press the first button in an answer that
  only moved the reader (plan 261007p), plus Glossary and Summary when they were already made
  (261008a). That machinery is deleted, not switched off. The guide now names the mode, says what
  pressing its button will do, and the reader presses it. On the guide eval, no answer claimed to
  have opened something; on the old prompt, 3 of 12 did. In the browser, a guide answer naming
  Structure left the page on Chat and drew *Open Structure*, which opened Structure when pressed.
- **The typing box, in every chat** (Chat, the guide, the chat list's new-conversation box, the
  block chat beside a paragraph): it rests at two rows instead of one, grows to 200px, uses 1rem
  text, and sits in a slightly raised strip so it stands out from the conversation above. A
  landscape phone keeps one row. Learn's tall box is unchanged.
- **Suggestions in the centre:** the guide's greeting starters, its next-step buttons and Explore's
  starters are now a centred column, each button only as wide as its words. Buttons inside an answer
  stay where the answer put them.

Nothing was deferred. Queue item `qi-bt4z2zaw` had proposed letting the spoken guide open modes
itself; that part went against this report, so it was dropped from the item.

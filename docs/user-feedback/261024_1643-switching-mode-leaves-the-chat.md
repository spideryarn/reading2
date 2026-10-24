---
reports: spya-mj4b56
ending: shipped
comment: On dev. Switching to another mode now closes the chat instead of floating it over the next mode. Back brings it back. Switching to Chat, or between sub-modes of the mode you are in, keeps it. Unsent words are kept.
---
# Switching mode leaves the chat

Report `spya-mj4b56` (#696), a suggestion from Greg (`feedback-reporter.ts` exit 0, no addenda when
re-read before this note), filed from Summary with Sources' Investigate open on
`arxiv-2308-08708-spya-xax6v4`. Session `fbmj4b56-chat-on-mode-switch`.

> If I'm in a chat mode of any kind and then switch mode, the chat appears suddenly separately as a
> kind of dialog box or panel somehow. I don't think that's helpful. If I switch modes, I've switched
> away from it.

**Shipped.** The open conversation is named in the address (`?thread=`), and a mode switch used to
change only the mode, so the conversation followed you into the next mode as the floating panel.
That was on purpose once ("leaving chat mode puts the panel back… for free"). Now any switch to
another mode — the Dock, a sub-mode row of another mode, Plain, Skim's stop cards, the boundary's
way back to Plain — clears it in the same history step. So Back brings the chat back.

What still keeps it:

- **A switch to Chat**, which draws that conversation in its band.
- **A sub-mode inside the mode you are in**, as the band's own toggles do.
- **Opening Marginalia**, which is a column beside the mode, not a mode.

What it gives up: Chat → another mode → Chat now lands on Chat's list, not the conversation, unless
you had left unsent words in it. An unsent chat about a passage also closes on a switch, but its
words are now kept by paragraph, so that paragraph's chat button brings them back.

The plan, with GPT Sol's plan and code reviews and the browser check:
[261024r-switching-mode-leaves-the-chat.md](../plans/261024r-switching-mode-leaves-the-chat.md).
The rule is written into [url-state.md](../project/url-state.md).

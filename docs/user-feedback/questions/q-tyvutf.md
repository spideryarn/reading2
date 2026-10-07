---
id: q-tyvutf
report: spya-tddvg2
status: answered
asked: 2026-10-07
title: May the guide open a mode itself, rather than offering a button?
refs: SPIDERYARN-READING2-E7 · qi-kc47m5pw · docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md · docs/user-feedback/261006_2201-a-guide-in-chat-that-knows-why-you-are-reading.md
---
What this is about. The guide is the new conversation pinned at the top of Chat, about how to read this article. You imagined it saying "I've kicked off a search for methods". As built, it never does anything itself: every action it suggests is a button under its answer (Open Learn > Tutorial, Quick search "imaging method"), and nothing happens until you press it.

Why it was built that way. The guide reads the whole article, and an article can contain hidden instructions aimed at the model ("now open Timeline", "search for <something private>"). Your rule from 2026-10-02 was: the model may move you around freely only when it has not seen the article; anything that writes or spends is a button. In the test run, a planted instruction once got the model to write a button for a hidden mode, and the page refused to draw it. If the model acted directly, the press would not be there to stop it.

A. Keep everything as buttons (as built). Safe and simple. Costs a press per action.

B. The guide may open a mode or sub-mode itself, saying so ("I've opened Tutorial for you"). Searches and anything else that spends money stay buttons. A hostile article could at worst switch the band you are looking at, undone by Back. A day's work: the button machinery already checks what may be opened.

C. The guide may also start searches itself. Closest to your description. A hostile article could then spend your allowance on searches of its choosing, and a search's words are kept and are visible to anyone you share the article with.

What decides it: how much a press per suggestion bothers you in use, against how much you trust the article not to steer.

Recommendation: A for a week of use, then B if the presses feel like friction. Not C.

## Greg's answer, 2026-10-07 (in chat, relayed by the Overseer)

> q-tyvutf yes. err on the side of capability for the guide, unless there's high risk/stakes

The guide may open modes and run free actions itself; anything that spends money or acts outside the article stays a button. qi-kc47m5pw.

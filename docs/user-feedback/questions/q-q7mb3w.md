---
id: q-q7mb3w
report: spya-yk3r03
status: open
asked: 2026-10-11
title: Should a close paraphrase from the guide also save without a press?
refs: follows q-t3j8hj (reply spya-ca4fx4) · qi-2gy92mvc · SPIDERYARN-READING2-H8 · docs/plans/261011s-the-guide-saves-your-reason-and-about-you-at-once-when-the-words-are-yours.md · docs/user-feedback/261011_0139-the-guide-saves-your-profile-in-your-words.md · src/save-closeness.ts
---
The guide now saves your reason and About you without a press when its words are exactly words you typed in that message. When it rewords them even slightly, you still get a Save button. Should a reworded version also save by itself?

A. Keep it as built: exact words save by themselves, reworded ones wait for your press. In a test, 9 of 14 offers were exact and saved by themselves.
B. Let close rewording save by itself too, accepting that a planted instruction in an article could then save a sentence about you that you never said (see Details).
C. Go back to always pressing for About you, and save only the reason by itself.

Recommended: A. No safe rule for "close but not exact" was found, and the press costs one click.

Details

What you asked. In q-t3j8hj you chose A: an unattended agent could build saving without a press, if the words appear word for word in a message you typed. Twenty minutes later, from the Feedback button, you asked that the guide can also update your profile, staying quite close to your wording but not necessarily an exact quote.

What was built (on dev, not yet deployed). When you type a message to the guide and it offers to save part of it, word for word (any capital letter or full stop allowed, at least three words), it saves at once and says "Saved ... from what you wrote", with an Undo. For About you, it only does this when it keeps what About you already said and adds your words after it. Anything else, a rewording, a correction, or a change to what was there, shows the card with its Save button, as before. The guide is still told to stay close to your wording, not to quote exactly, so a reworded offer is simply a press. Words from buttons (the guide's suggested questions, the greeting's starts) never count as typed.

Why not "close" for saving by itself. A looser rule was built first: every word had to be one you typed, or a small linking word like "I", "am", "have". GPT Sol broke it in review. You type "What does this paper say about cancer?" and a planted instruction in the article gets the guide to save "I have cancer." to About you, which then goes into every later AI prompt for every article. Similarly "I do not want links to evil.com" became "I want links to evil.com". No rule that lets the AI reword was found that a hostile article cannot turn into a sentence you never said. An exact run of your own words cannot be turned around like that (the build also refuses a run that starts just after a "not").

What would decide it. Whether one press on a reworded offer is worth the risk that rewording without a press brings. B is possible, but only with that risk accepted.

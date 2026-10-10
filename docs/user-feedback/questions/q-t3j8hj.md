---
id: q-t3j8hj
report: none
status: open
asked: 2026-10-10
title: May an unattended agent build 2B, the guide saving your words without a press?
refs: follows q-dqh7t6 (reply spya-t5bfct) · qi-wm5nsweg · docs/plans/261009q-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md · docs/project/security-map.md (the chipFor row) · src/web/GuideSaveOffer.tsx
---
You chose 2B on q-dqh7t6: when the guide offers to save your Why you're reading or About you, and the words are a quote of your own message, it saves them straight away with an Undo, instead of waiting for you to press Save. Nothing is built yet, because this loosens a security rule: today nothing a model proposes ever writes without your press. An agent working with nobody watching may not loosen a security rule on a reply alone, so the question is who may build it.

A. Yes: the Overseer may give this build to an unattended agent now, on two conditions: the words are saved only if they appear word for word in a message you typed in that conversation, and the security notes are updated in the same change. GPT Sol reviews the plan and the code. Gives up: you will not watch it being built.

B. No: build it only in a session you are watching.

C. Drop 2B and keep the press, as built.

Recommended: A. With the word-for-word check, the worst a planted instruction in an article could do is save words you yourself typed, and Undo puts the old ones back.

Details

Background. On 9 October the guide learned to offer to save two things you tell it: why you are reading this article, and something about yourself (About you, on your profile). It shows the words on a card under its answer, with a Save button and an Undo. Both are fed into later AI prompts, so what is saved there shapes every later answer.

Question q-dqh7t6 asked whether that save should stay a press. The recommendation was to keep the press, for two reasons: the press is the one moment you see the words before they go into every future prompt, and an article's own text could try to steer which words the guide offers. You replied 2B on 10 October: save without the press when the words are a quote of your own message.

The security rule. Our security notes (security-map.md, the row for chat buttons) say that anything a model proposes that writes, spends or leaves the article still needs your press, so a planted instruction can at worst move you around the article. 2B is the first exception. Our feedback rules say an unattended agent does not change such a rule even on your reply, which is why q-xh4y0s asked the same thing about a different build, and you answered A there.

What would decide it. Whether you are happy for the exception to be built and reviewed without you watching, given the word-for-word check. The work is queued as qi-wm5nsweg and held until you answer.

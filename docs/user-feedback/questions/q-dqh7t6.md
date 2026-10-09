---
id: q-dqh7t6
report: none
status: open
asked: 2026-10-09
title: May our security notes name the guide's new buttons, and should saving stay a press?
refs: q-w2740x · docs/plans/261009q-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md · docs/plans/261009u-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md · docs/project/security-map.md (the chipFor row) · qi-j45yc3ck
---
Two small calls left over from your answers to q-w2740x, both built and on dev. Answer like "1A 2A". Neither is urgent.

1. Our security notes list every place where something the AI wrote becomes a button. The guide now has two new ones: its offer to save your reason or About you, and its row of next-step buttons. The notes are a rule document, so I have not edited them.
A (recommended): add one sentence naming both, beside the chat buttons (wording under Details).
B: leave the notes as they are.

2. Saving your reason or About you when the guide offers it.
A (recommended): keep it as built: you press Save on the card (with an Undo).
B: save without the press when the words are a quote of your own message, with an Undo. This is the first time an AI suggestion would change your data without a press.

Details

What is built (on dev, not yet deployed):
- The offer to save (plan 261009q): when you tell the guide why you are reading, or something about yourself, it shows the words, as close to yours as it can, on a card under its answer with a Save button. Only your press saves, only over what the field held when it was offered, and Undo puts it back.
- The next steps (plan 261009u, your reports of 9 October): under its latest answer the guide shows up to three buttons, such as something to ask it next, a mode to open, a search whose words you can change first, or Share this article / Archive or put back, which take you to the Metadata page where you do those things. The guide never presses any of them.

1A, the sentence I would add to the chat-buttons row of the security notes: "Two more places in the guide where a model's words become a button, both pressed by the reader: the offer to save (src/web/GuideSaveOffer.tsx), saved only on the press, only over what the field held when offered, with an Undo; and the next steps (src/web/GuideNextSteps.tsx), at most three under the latest answer: words sent as the reader's own message, a mode or quick search through the same check as the chat buttons, or a move to Metadata's sharing card or Archive button. None presses itself." It costs nothing; it keeps the list of such places complete, which is what the notes are for. 1B leaves a reviewer to find them by reading the code.

2. This is the follow-up from part 1 of your reply. B would save one press, but that press is the one moment you see the words before they go into every future prompt, and an article's own text could steer which words the guide offers. B also needs a check that the words really are a quote of your own message. I would keep A.

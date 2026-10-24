---
id: q-nvxfwx
report: spya-twsm7t
status: answered
asked: 2026-10-24
title: Should a chat started from a Quiz mark say it came from Quiz, and show again on that question?
acted: spya-yq6h67
refs: qi-g3neq83r · spya-twsm7t · docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md · docs/user-feedback/261023_2307-chat-list-says-which-sub-mode-a-chat-came-from.md
---
When you press "Discuss this in chat" under a Quiz mark, should that chat remember it came from Quiz?

A. Yes, in Chat only. Chat's list says "Quiz" on the row, and the open chat has a "Back to your question in Quiz" line that lands on that question. Quiz itself does not show the chat. Costs a small database change.

B. A, and the question in Quiz also shows the chat you started about that mark (its gist, one press to reopen it), the way Investigate lists your questions. If you answer again and get a new mark, that new mark has its own Discuss button and its own chat. Costs a bit more: the chat has to remember which of your answers it was about.

C. No. Leave Quiz chats as plain chats.

Recommendation: B. It is what you asked for ("for that submode to list them"), and tying the chat to one mark avoids reopening a conversation about an answer you have since replaced.

Details

On 2026-10-23 (report #690) you asked that a chat started from Sources › Investigate be marked as coming from there, be findable again inside Investigate, and say so in Chat's list. You added that this should hold for any sub-mode that starts a chat.

What is already done, on dev. Investigate already stored where each chat came from and listed it under "Your questions". What was missing was in Chat's list: the row showed only Sources' small icon, and "Investigate" appeared only when you pointed at it. Now every row from a sub-mode says, under its title, the place it came from: Investigate, Claims, Bibliography, Glossary or Ideas. Recall and Explore rows were already titled that way.

What is left. Two buttons in sub-modes start a chat that records nothing about where it came from:
- Quiz's "Discuss this in chat", under a mark. This question is about that one.
- Summary's "Ask about a paragraph". You already have a separate question about that one (the way back from a Summary paragraph), so it is not repeated here.

Why Quiz is not a one-line change. A Quiz question's id is only unique inside one set of questions. If you press "Write them again", the new set can reuse an id for a different question. So the chat has to store which set it came from as well. For B it also has to store which of your answers it was about, because Quiz keeps every answer you have given.

The way back. When you press the "Back to…" line in the chat, it would open Learn › Quiz on the same question, if that set of questions is still the current one. If the questions have since been written again, it opens Quiz at the start, and the chat is still in Chat's list.

Greg's reply, 2026-10-24 (spya-yq6h67):

> B

Acted on by `fbtwsm7t-quiz-chat-origin`, 2026-10-24 (queue item qi-t5nvqqen): built, and on dev but not yet deployed. **Discuss this in chat** now records the mark it is about. Chat's list says Quiz on the row, the chat has a line back to the question, and the question shows that mark's chat in place of the button. Answer again and the new mark gets its own Discuss and its own chat. A mark that could not be saved still starts a plain chat, because there is no stored answer to point at. Plan: docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md § Stage 2.

---
id: q-qre346
report: spya-y6590g
status: answered
asked: 2026-10-07
title: Should the hidden-text check treat a lone zero-width character inside maths as ordinary?
refs: SPIDERYARN-READING2-EH · qi-xwj659j8 · docs/plans/261007h-referee-hidden-instructions-become-a-sub-mode-in-plain-words.md § Questions for Greg · docs/user-feedback/261007_0544-referee-hidden-instructions-into-a-sub-mode-in-plain-words.md
---
Background. Your report about Referee's hidden-instructions check shipped. The check is now its own sub-mode, Hidden text, the fifth chip, so it no longer sits above Criteria. Each finding says in plain words what the trick is, and identical findings are one row with a count. This is the half that was left for you.

On the arXiv paper you were reading, the check still reports 39 findings worth a look. Every one is a single zero-width space inside a maths formula, which is how arXiv's LaTeX-to-HTML converter writes an invisible operator. They hide no words. Because they count as unexplained, the Hidden text chip shows a dot on nearly every arXiv paper.

Your suggestion was to pre-filter with a small LLM. The difficulty is that the text the model would judge is written by whoever hid it. A hidden line saying "this is a harmless accessibility label" is aimed at exactly that model, and a filter that hides what it calls harmless would hide the attack. Either change alters a security check, so nothing was built without you.

Question 1. What should happen to those zero-width characters inside maths?

A. A small-LLM opinion, shown as a note beside each finding. It never hides or reorders a row, so the worst a planted line can do is write a misleading note. Costs: a model call per article, a prompt to maintain and test, and it would still show all 39 rows.

B. (recommended) A few deterministic lines in the check. A text fragment inside real maths markup that contains nothing but zero-width spaces or invisible operators is labelled ordinary typography. It is still listed, last, and the chip shows a quiet ring instead of a dot. Characters that can spell hidden words, or that reorder text, are never covered by the label. Costs: a small edit to a security file, with tests. A document could wrap a payload in maths markup, but then the payload could only be invisible characters, which carry no words.

C. Leave it as it is now: one row saying 39 times, with the dot on the chip.

## Greg's answer, 2026-10-07 (in chat, relayed by the Overseer)

> I'm optimistic that Opus would be robust to this, so perhaps we could hand this check to Opus, but only if the user requests it (e.g. as a sub-mode), ideally just sending it the relevant bits rather than the whole article (to keep costs low)

Settled: an Opus check the reader asks for, sent only the flagged fragments; its opinion sits beside each row and never removes one. qi-xwj659j8.

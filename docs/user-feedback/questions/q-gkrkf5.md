---
id: q-gkrkf5
report: spya-nkq6rj
status: answered
asked: 2026-10-28
title: Should Explanations of confusing passages be written for every new article, at about 10 to 15 cents each?
refs: docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md § What it would cost on every import, § What waits for 1 November · docs/user-feedback/261028_1024-explanations-of-confusing-passages-in-the-margin.md
acted: spya-m40cz2
---
Once the first real explanations have been read and look right (after 1 November, when the AI key works again), when should they be written?

A. For every new article, on import, as you suggested (recommended). Explanations are in the margin the first time you open an article. Roughly 10 to 15 cents per article at standard power, more for a long one: about a tenth more than an import costs today. An article that already exists gets them only when you open Explanations in the More menu (writing them for all 89 now would be about 11 dollars).

B. The first time you press the margin button on an article. Nothing is spent on articles you never read with the margin, but the notes arrive a little after you turn it on, not before.

C. Only when you open Explanations in the More menu, as now. Cheapest, but you said readers will rarely open that mode, so the margin would rarely have them.

Recommended: A, once one live run has been read. Until your answer and that run, it stays behind the experimental switch and runs only when the mode is opened (C).

Details

What you asked, this morning (28 Oct): a proactive explanation of passages a reader is likely to be confused by, "in much the same way that the glossary is proactive. There's just a little underlying waiting for me." You suggested a small model (Haiku) to find the confusing passages, a bigger one (perhaps Opus) to write short explanations, saying when it is unsure, an Ask in chat for more, web search allowed but marked, the reader's background taken into account, a mode of its own under More that the margin draws on, and running automatically on new articles.

What is built tonight (on dev, behind the experimental switch). An Explanations mode under More: a list of passages, each with the quoted words (a jump to the passage), a short explanation written for your profile, "Not sure" when the AI is unsure, "Draws on AI memory, unchecked" when it used anything not in the article, and Ask in chat. The margin shows the same as a shut line beside the passage. It is one AI call that both picks the passages and writes, not your two-model version: a reviewer argued, and I agreed, that the two-model version should earn its place by beating the one-call version on real articles, which I will compare after 1 November along with Sonnet against Opus. It follows the article's power setting: Sonnet normally, Opus under high-powered AI. Opus for everything would roughly double the cost (about 20 to 30 cents an article); I will bring that back to you with the comparison rather than ask blind.

Not built yet, deliberately. The underline in the article text itself: it has to share space with glossary underlines, citation marks and comments, and needs designing against real explanations, so it is the next stage. Web search inside the explanations: the short explanation uses the article and the AI's memory (labelled when it does), and Ask in chat already searches. If you would rather it searched for itself, say so; it costs more per article. Visitors to a shared article do not see them yet.

About the cost figure. It is an estimate: nothing can be measured until the key works. It is built from what comparable steps really cost in production over the last month (the glossary's median is 11 cents, quotes 12), because a pure token count misses the AI's thinking and came out at a third of that. Today's import, adding up those steps' medians, is about $1.15. Imports have run at 2 to 15 a week. The real figure will come from the ledger after the first runs, and I will update this if it is far off.

Does a reader's automatic-modes setting apply? Yes: with A it would join the list that the "make the modes on import" tick box already controls.

Greg replied, 2026-10-28 (spya-m40cz2): "A"

Recorded 2026-10-29. Nothing changes until the first live run after 1 November has been read: queue item qi-k738ybv4 does that run and then moves Explanations onto the import list (AUTO_MODE_STEPS), so readers who tick "make the modes on import" get them too.

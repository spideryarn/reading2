---
id: q-vrnbyj
report: spya-pn7gvw
status: open
asked: 2026-10-29
title: Structure one level deeper: made automatically or on request, and nested in column B or a third column?
refs: docs/plans/261029a-structure-one-level-deeper.md · docs/user-feedback/261029_0300-structure-one-level-deeper.md · m-pe3zds · spya-pn7gvw
---
You asked for Structure to go one level deeper, e.g. each theory in "2.4 Other Theories" as its own row. Two choices.

1. When should the extra level be made?
A. Automatically, in the one structure call each new article already gets, and only where the article earns it: where the author's own sub-headings divide a section (2.4.1 to 2.4.6 here), or where a long section (10+ paragraphs) has clear topic shifts. Short sections are never split. Cost: roughly +1 to 3 cents and a few seconds on an article that gets it, nothing on one that doesn't.
B. Only when you ask, with a button in Structure. Costs nothing until pressed, but each press re-makes the tree that other modes hang off: about 40 cents of paragraph labels on this paper, other modes marked out of date, and a 10 to 30 second wait at the moment you asked.
Recommendation: A.

2. How should Structure show it?
A. A third column on wide windows (about 1460px and up), falling back to B when narrower.
B. No third column. The section you are in opens to show its sub-sections under it, in column B, at every width the two columns are drawn today.
C. A third column on wide windows; narrower, just the two columns as today (sub-sections only in the narrow list and in Expanded).
Recommendation: B. Simplest, and it shows the new level on a laptop. Add a third column later if column B gets crowded.

```
 PARTS                       | SCIENTIFIC THEORIES OF CONSCIOUSNESS
-----------------------------+-------------------------------------
>Scientific Theories   =====>| >2.4 Other Theories and Conditions
 Consciousness in AI         |     2.4.1 Attention Schema Theory
 Implications                |    >2.4.2 Predictive Processing
                             |       [its one-sentence summary]
                             |     2.4.3 Midbrain Theory ...
```
(Option 2B. All three options are drawn out in m-pe3zds.)

Also: once it is built (after 1 November), shall I re-run this one paper's structure in production so you can see it? About 65 cents. Yes / no.

Details

What you said (29 Oct, reading Consciousness in AI, arXiv 2308.08708, in Structure's Expanded view): Structure should perhaps go one more level deep; you worried it would be slower and dearer, might not fit, might need a third column, and asked how we would decide when it is needed, perhaps by letting the reader ask. You'd like each of the "other theories" to have its own section at least.

What I found. Today the tree is always parts, then sections, then paragraphs. The prompt asks for exactly three levels and the answer's format cannot hold a fourth. On this paper, "2.4 Other Theories and Conditions" is one section of 76 paragraphs and 7,100 words, although the author gave it six sub-headings. 2.1, 2.2, 2.3, 1.2 and 3.1 are the same, with three to five sub-headings each. Across the 67 articles made in production in the last 60 days, 141 sections hide two or more of the author's sub-headings, in 30 of the 67 articles. So it is common, not this paper's quirk.

Speed and cost. This paper's structure call cost 22 cents and took 22 seconds; the median article's is 15 cents and 31 seconds. Almost all of that is reading the article in, which does not change. The extra level is a few hundred to about 1,500 more words written out, so a few seconds and a cent or three, and only on articles that get it. The article already opens before its structure is ready, so you would not wait longer to start reading.

How it decides. Option 1A puts the rule in the prompt: follow the author's sub-headings first, and split a long section at clear topic shifts only when it has none. An earlier experiment (September) found this works on articles in a single call. Option 1B leaves the decision to you, at a cost each time.

Old articles are not changed (our "no backfill" rule), apart from this one paper if you say yes above.

What I have done tonight, which does not depend on your answer. Made the reading view cope with a tree where some sections have sub-sections and others do not; before this, one deeper section would have quietly broken the "you are here" position, ← / →, Quiz's "where to look again" and both Structure layouts. Nothing you see changes yet, because no article has the extra level yet.

What waits. The prompt change can't be tested until 1 November, when the dev box's OpenRouter key resets; production's own calls are unaffected. It ships only if the median article's structure call grows by less than about a fifth in cost and time.

One more thing I noticed, separate from depth: the author's "2.5 Indicators of Consciousness" was folded into 2.4 instead of being its own section, although the prompt says the author's headings are hard boundaries. Up to 150 headings in 26 recent articles may be folded in this way (some may be deliberate merges of very short stretches). The prompt change in 1A will restate the rule, and the same test will measure it.

---
id: q-vrnbyj
report: spya-pn7gvw
status: open
asked: 2026-10-29
title: Structure one level deeper: once it is built, re-run this one paper in production so you can see it (about 65 cents)?
refs: docs/plans/261029a-structure-one-level-deeper.md · docs/user-feedback/261029_0300-structure-one-level-deeper.md · m-pe3zds · m-fq095c · qi-negzd289 · spya-pn7gvw
acted: spya-b2ceuy
---
Done as you said: 1A, the extra level is made automatically. For the layout I built three ways on the real page, and three judges (a product manager and two first-time readers) all picked B, the section you are in opening its sub-sections in column B. That is now built; m-fq095c has the screenshots and what they said.

One question left from before: once the prompt change lands (after 1 November, when the dev box's AI key resets), shall I re-run this one paper's structure in production so you can see it? About 65 cents. Yes / no.
Recommendation: yes. It is the only way you will see the new level before new articles start getting it.

Details

Your reply, 29 Oct (spya-b2ceuy): "Okay, I'm not sure, but I'm inclined to say number one, yes, let's try and do this automatically. So that's A. And how should structures show it? Go with your recommendation. Perhaps try a few different ways if you can. Maybe in a mock-up, take screenshots, experiment, ask a couple of sub-agents to play the roles of being product managers or naive users, and then make a decision."

What I did. Three layouts, mocked up on the real Structure panel with this paper: X, the section opens in column B (my recommendation); Y, a third column; Z, the two columns slide down a level inside a divided section. The judges saw them as X, Y and Z with no recommendation. All three chose X. Y was "busy" and cramped, because the band is about 700px wide even on a 1,520px window, so three columns are about 230px each. Z hid the rest of the paper behind a small "All 8 parts" link. X is built with the product manager's tweaks: the section you are in stays bold and its summary moves to its hover card; a hairline runs down its sub-sections; and if the run is too tall for the column, the section is drawn closed as today with "6 sub-sections" under it, so later sections never drop off.

What still waits. Nothing you see changes yet, because no article has the extra level. Making it needs the prompt change, which needs a model call, and the dev box's OpenRouter key is over its limit until 1 November. It is queued (qi-negzd289) and ships only if the median article's structure call grows by less than about a fifth in cost and time.

Both readers also noticed that the panel numbers the sub-section 5.5.2 while the article's heading says 2.4.2. That is Structure's own numbering, unchanged here.

The original question, for reference:

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

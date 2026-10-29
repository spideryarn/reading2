---
id: q-ejp09q
report: spya-fytjtf
status: open
asked: 2026-10-29
title: Which of these active-learning ideas should we build next, beyond Quiz in the margin?
refs: docs/plans/261029c-ideas-off-by-default-and-quiz-in-the-margin.md · docs/user-feedback/261029_0037-quiz-runs-with-the-margin-and-its-questions-sit-there.md · docs/research/261010a-reading-and-learning-evidence/digest.md · qi-nm7427wf
---
You asked for other ways to get the reader doing the work, to discuss separately. Quiz in the margin is built (on dev, not yet deployed). Here are five more, best value first. Pick any, in any order, or none.

A. Answer in the margin. Each Quiz question in the margin opens a one-line answer box in place, marked right there (a sentence or two back, with the passage linked). Today pressing a question jumps to the Learn band. Evidence: recalling and then seeing the text is the best-supported thing we do. Cost: a few days; about $0.08 per answer marked, only when someone answers. Gives up: a second answer box beside the band's, which the earlier plan avoided.

B. Say it back at the end of a section. Where a part ends, the margin invites "In a line, what did this section claim?" The reader types or dictates; a Recall-style reply says what they got and links what they missed. Evidence: self-explanation and summarising in your own words (supported indirectly, a modest effect). Cost: about a week; one short call per reply. Gives up: one more thing in the margin, which risks clutter.

C. Sure or not, before the mark. Before Quiz marks an answer, one tap: sure / not sure. The mark is unchanged; a quiet tally shows "sure and wrong" questions to look at again. Evidence: readers judge their own understanding poorly, and this is how calibration is trained. Cost: small, no model call. Already queued as qi-nm7427wf.

D. Questions waiting when you come back. The next day, the shelf (and the article's margin) says "4 questions waiting from yesterday's reading", made from the Quiz questions you skipped. It could include ones you missed only if we reverse the current privacy decision and store Quiz's hidden right/wrong verdict; today that verdict dies with the visit. No scheduler: it is worked out when you next open the app. Evidence: spacing, the strongest effect in the memory literature; whether it adds anything for our readers is untested. Cost: a few days; no new model call if it uses skipped questions or stores the verdict we already compute. Gives up: it nags, so it would need an off switch; storing the verdict would also keep a grade the app currently deliberately forgets.

E. Guess first on a glossary term. The term's card asks "What do you think it means here?" before it shows the gloss, as an option. Evidence: plausible from the memory literature, never tested on glosses. Cost: small. Gives up: one more press before an answer.

My recommendation: A, then D. A takes the friction out of Quiz in the margin, which is what you asked for; D is the cheapest way to get spacing without a scheduler. C is small and already queued, so it can ride along whenever. I would hold B and E until A has been used for a while.

Details

The report (spya-fytjtf, 2026-10-29, while reading "Consciousness in AI" with the margin open): you said active, test-driven learning is one of the most useful things we could do, asked that Quiz run by default when the margin opens and show its questions there, and asked for other ideas separately. This question is that separate part.

What was done for the first part (plan 261029c): when you have the margin on screen and the article has no quiz yet, Quiz writes one, once per article. That costs about $0.17 (median) to $0.24 (mean) per article, from production's ledger. Its questions now sit in the margin beside the passage each is about, and while the margin is on screen they are no longer also drawn in the prose. Pressing one opens Learn, Quiz at that question. Ideas no longer runs on import, which saves about $0.19 per article, so an article read with the margin costs about what it did before.

Where the evidence comes from: the reading-research library of 2026-10-10 (docs/research/261010a, its digest). The short version: making the reader produce something, then showing them the text, is the best-supported thing Spideryarn does, but it was measured on students and short texts, not experts reading papers, so every option above is "supported indirectly" at best. The digest's other product ideas (a reader study, a delayed re-offer, confidence ratings, guess-first) are where C, D and E come from; A and B are new, and follow from putting questions in the margin.

What would change the order: if you mostly read papers once and never come back, D is worth little and B moves up. If the margin already feels busy, A is the one to try, since it adds no new lines, only makes the existing ones answerable.

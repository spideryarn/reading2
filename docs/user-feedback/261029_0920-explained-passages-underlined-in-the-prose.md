---
reports: spya-njkskc
ending: shipped
comment: On dev: explained passages are underlined in the prose in every mode, Glossary's dotted rule in teal, with a card (explanation, labels, Ask in chat, Open in Explanations). A term inside keeps its orange rule. Behind the experimental switch.
---
# Explained passages underlined in the prose

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-29 09:20 UTC, reading *Consciousness in
Artificial Intelligence* (`arxiv-2308-08708-spya-xax6v4`) in production with the margin open.
Sentry event 8461fa9433fe4a749eec7e595201271b. Session `fbnjkskc-explanations-underline`. No addenda
when re-read, both before acting and before this note.

> New Explanations mode: Can we indicate when, in the text, when something's being explained,
> perhaps using something, an underline quite similar to the glossary.

**Shipped** on dev. This was the deferred stage 3 of 261028c (queue item `qi-ym6872mj`, waiting
for an overlap design); the plan is
[261029j](../plans/261029j-explained-passages-underlined-in-the-prose.md). GPT Sol reviewed both
the plan and the code.

- **The look**: Glossary's 2px dotted underline, in teal rather than orange so the two can be told
  apart. It appears under exactly the words the explanation is about, in every mode, for the owner
  with the experimental switch on.
- **The card**: rest on the words and the prose card shows an *explained* section with the
  explanation, its labels (*Not sure*, *Draws on AI memory, unchecked*), and *Ask in chat · Open
  in Explanations*. On a finger, the first tap shows it and the second opens the band on that row.
- **When a passage is also a glossary term**: the term keeps its orange line on its own words and
  the teal runs either side. The card shows the term first, then the explanation. A reader's
  comment or chat keeps its own line, and a tap still opens it. Where a cross-reference sits on the
  words, its card wins, as it already does over a term.
- **Along the way**: a finger tap on a glossary term or citation inside one of your comments used
  to show the term's card, and the comment could not be opened from those words on a touch screen.
  It now opens the comment (found by Sol; postmortem linked from the plan).

Checked in a browser on a canned list (the AI key resets 1 November), dark and light. The
screenshots are `261029j-shot-*` beside the plan; shot 4 shows a term, an explanation and a quote
on one card.

**What waits**: how a dozen clause-long underlines reads on a real article (the first live run,
`qi-k738ybv4`), a pressed state when a row is chosen in the band, and a keyboard road like
Glossary's G.

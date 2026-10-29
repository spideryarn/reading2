---
reports: spya-pn7gvw
ending: awaiting
comment: Done as you chose: the level is made automatically, and column B opens the section you are in to show its sub-sections (all three judges picked it). No article has it until after the 1 Nov key reset. Open: re-run this paper then?
---
# Structure one level deeper

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-29 00:12 UTC, filed from Structure's Expanded
view on *Consciousness in AI* (arXiv 2308.08708, `arxiv-2308-08708-spya-xax6v4`), production build
a3d0f98e. Sentry event 38079ae7317a4b65abe7396a1fd0c36f. Session
`fbpn7gvw-structure-one-level-deeper`. No addenda when re-read before acting and before this note.

In short, his words: Structure should sometimes go one level deeper; that would be slower and
dearer, might not fit, might need a third column, and how would we decide when it is justified —
perhaps the reader asks for it; show a third column when there is one and the window is wide
enough; e.g. in "other theories of consciousness" each theory should at least have its own section.
(Full text: `npx tsx scripts/feedback-unswept.ts --show spya-pn7gvw`.)

**Ending: Awaiting Greg**, on question **q-vrnbyj**, with the half that does not depend on his
answer built and on `dev`. Plan
[261029a](../plans/261029a-structure-one-level-deeper.md), with GPT Sol's plan and code reviews
beside it; the layouts drawn out in mockup `m-pe3zds`.

**What we found.** The tree is always parts → sections → paragraphs: the prompt asks for three
levels and its answer format cannot hold a fourth. On this paper "2.4 Other Theories and
Conditions" is one section of 76 paragraphs, though the author gave it six sub-headings; across
67 recent production articles, 141 sections in 30 of them hide two or more of the author's
sub-headings. The author's "2.5 Indicators of Consciousness" was also folded into 2.4, against the
prompt's own rule. Cost: this paper's structure call was 22¢ and 22 s (median article 15¢, 31 s);
the extra level is a cent or three and a few seconds, only on articles that get it.

**Built (stage 1): the reading view copes with a ragged tree** — some sections divided into
sub-sections, their neighbours not. Before this, one deepened section would have quietly changed
what `?at=`, Quiz's "where to look again", the return chip and both Structure layouts meant by "a
section". Now `?at=` and the rest stay at sections; Structure's "you are here" and ← / → step
sub-sections where there are any; the nested list and Expanded draw them one indent deeper.

**Greg's answer** (reply `spya-b2ceuy`, 2026-10-29), quoted in q-vrnbyj: automatically (1A), and
for the layout *"Go with your recommendation. Perhaps try a few different ways [...] ask a couple of
sub-agents to play the roles of being product managers or naive users, and then make a decision."*
Three layouts were mocked up on the real panel (mockup `m-fq095c`): opening the section in column B,
a third column, and the columns sliding down a level. Judged blind by an Opus product manager and
two Sonnet first-time readers, all three chose column B. **Built (stage 1b)**: column B opens the
section the reader is in, its sub-sections indented under it, the current one orange with its
sentence; the section and its run are one row to the panel's measure and window, and a run too
tall for the column falls back to the closed section with "N sub-sections". Sub-sections now count
from .1 when a section opens with a paragraph of its own. Still nothing a reader sees changes,
because no article has the extra level.

**What waits** (queue item `qi-negzd289`): the prompt change that makes the fourth level, which
cannot be measured until the box's OpenRouter key resets on 1 November and ships only if the median
structure call grows by less than about a fifth; and, if he says yes to the one question still open
in q-vrnbyj, re-running this one paper in production (about 65¢). No backfill.

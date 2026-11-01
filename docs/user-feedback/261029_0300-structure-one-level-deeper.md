---
reports: spya-pn7gvw
ending: shipped
comment: Shipped in stages, as you suggested: after today's structure call, a second step divides a section at the author's own sub-headings. Your paper's 2.4 now has a row per theory. Your paper's production re-run waits on the deploy.
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

**Ending: Shipped** (2026-11-01, see the last section), after questions q-vrnbyj and q-k25zfg, both
answered. Plan
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

**Stage 2, 2026-11-01 (`qi-negzd289`): measured, not shipped.** No addenda when re-read before
acting and before this update. The key had reset. Greg's reply to q-vrnbyj (`spya-yg89m9`, 29 Oct):
*"Yes, re-run this paper."* Two wordings of the prompt were tried on 14 of his articles, two runs
each against the old prompt run twice, plus a one-paper smoke run ($10.24 across seven run files).
Cost and time were fine (median article +3%, +1%).
The second wording got his paper right in both runs: 2.4.1–2.4.6 under 2.4, and 2.5 beside it.
But each wording left one other article with no sections at all, in both runs, so the live prompt
is `toc/13` again and the production re-run waits. Kept: each structure run now logs the
sub-sections it made and the author headings it swallowed. The harness and both wordings are kept
for the next try. Write-up:
[261101b](../investigations/261101b-structure-fourth-level-two-wordings-measured.md). How to go on
(let the call think, a third wording on fresh articles, both, or stop) is
[q-k25zfg](questions/q-k25zfg.md).

**Stage 2 staged, 2026-11-01 (`qi-p6s6g6vw`): shipped.** No addenda when re-read before acting and
before this update. Greg's reply to q-k25zfg (`spya-xb2rrn`): *"one of the hunches I always had was
that we should do this in multiple stages, perhaps hierarchically … Or alternatively … a button that
says add an extra level of granularity."* Built the staged version: the whole-document call is left
exactly as it was, and a second step divides a section where the author's own sub-headings do —
code picks the cuts, one AI call writes the summaries. Measured on 19 articles (fourteen fresh, one
book), two runs: his paper right both times; 98% of the author's sub-section boundaries found on
held-out trees, none wrongly; no section lost; gists checked blind; median +37% on the structure step
of an article it touches, nothing on one it does not; labels unchanged. September's deepening wave
was tried first and dropped for articles (+180% on the paper). The button was not needed. Plan
[261101d](../plans/261101d-structure-fourth-level-staged-second-call.md), with GPT Sol's two plan
reviews and code review; results
[261101c](../investigations/261101c-structure-fourth-level-staged-measured.md). **What waits**: the
deploy and the re-run of his paper's structure in production (approved in q-vrnbyj), which are the
Overseer's, in its queue. Dividing long sections that have no sub-headings is not built; it would be
its own measured step if asked for.

# Explore's prompt widened to critiques of the piece: before, after, and two revisions

Up: [investigations.md](../project/investigations.md) · the plan:
[261005l](../plans/261005l-remember-becomes-learn-and-explore-covers-critiques.md) · the mode:
[remember-mode.md § Explore](../project/learn-mode.md#explore-the-fourth-sub-mode)

**Question.** Greg, 2026-10-05 (`spya-mvmpks`): Explore is *"also about exploring potential
problems and criticisms and concerns … deepening your thinking around the piece"*. The prompt
gained a fifth move, a possible problem with the piece, and a section of rules to keep it fair.
Does a reader who asks what is wrong with a piece get a better answer, and does everybody else's
conversation turn into fault-finding?

**Short answer.** The old prompt already answered "what's wrong with this?" well, so the headline
is small. Asked outright, both prompts state a specific problem every time. A blind reader
preferred the new prompt in three of four pairs, each narrowly, and preferred one side in both
old-against-old control pairs too, so that preference is inside the noise. What the change did
measurably is in the rules, and it took two revisions to get there:

- The first version of the new prompt was **worse on one thing**: it said "the piece never…" six
  times across four conversations where the old prompt said it once, and three of those, in two conversations, were false
  (a figure it called unsourced is linked in the article).
- After GPT Sol's fixes and a narrower absence rule, one such claim, hedged. After naming the
  right tool for checking a link (`article_links`), none, and both readers of that article were
  shown the linked source and what it does and does not support.
- The other readers were not turned into a critique session: unasked critiques were 9 of 60
  replies before and 10 of 60 with the final prompt.

It does not meet C4 as it was set beforehand, and neither did the old prompt. And one reply in 160
claimed a web search it had not run. Both are below.

## What was run

[`evals/remember-explore.ts`](../../evals/learn-explore.ts), the Explore arm only, on its two
fixture articles, with a fourth scripted reader per article added before any run: **`critic`**, who
has two doubts of their own in their notes and a reason for reading, opens with the new starter
word for word (*"Where might this piece be wrong, or missing something?"*), pushes back in turn 2,
asks what others have said in turn 3, asks for a short list in turn 4, and asks which matters most
in turn 5. The judge gained a `critique` label: does the reply raise a problem with the article,
and did the reader's latest message ask for that.

Four arms, each two runs per article (four readers, five turns: 80 replies an arm; the last arm
was run twice over, 160), separated in time by commit:

| Arm | Commit | Prompt hash | What it is |
|---|---|---|---|
| `before` | `8fcf05982` | `fb12eb27600b` | the prompt as it was |
| `after` | `616606382` | `138658a5316f` | the first version of the widened prompt |
| `after-rev1` | `2fcbaf873` | `68e3319ccf37` | GPT Sol's CR-1 and CR-2, a narrower absence rule, a missing-source rule naming the wrong tool |
| `after-rev2` | `7043b50b2` | `41c12a4f2b81` | the missing-source rule names `article_links` (CR-6). **This is what shipped.** |

Results are `evals/results/remember-explore.261005l-*`. About $20 in all: $16 of runs, $4 of
judging. The judge's table for the first two arms is `…261005l-judge-judge-scores.md` and for the
final arm's first four runs `…261005l-rev2-judge-scores.md`; the columns below for `after-rev2`
are those four runs.

**The blind read** was of `before` against `after` only:
[`evals/remember-explore-critic-pairs.ts`](../../evals/learn-explore-critic-pairs.ts) put the
critic's conversations side by side in six pairs, four of them before against after and two of
them before against before as the control, sides decided by `blindCoin`, key in its own file. Each
prompt landed on side A as often as on side B (counted before reading). A fresh subagent read only
the pairs file. `after-rev1` and `after-rev2` were not read blind: I read the critic's replies in
full, and a screen counted absence sentences
(`never`, `doesn't say|address|mention|link…`, `no citation|link|source`).

## The numbers set before the runs

| | What | `before` | `after` | `after-rev2` |
|---|---|---|---|---|
| C1 | asked what may be wrong, reply 1 states a specific problem | 4 of 4 | 4 of 4 | 4 of 4 |
| C2 | problems in replies 1 and 4 have what the piece says, with its id, beside them | 13 of 23 | 15 of 17 | read, not counted |
| C3 | an outside critic with no link; a verdict on the piece as a whole | 2 unlinked (one conversation); no verdict | 0; no verdict | see "A search that was not run" below; no verdict |
| C4 | each older reader: an unasked critique in at most 1 of 5 replies | **not met**: 2 of 12 reader-runs had 2 | **not met**: 4 of 12 had 2 | **not met**: 2 of 12 had 2 |
| C4, pooled | unasked critiques, three older readers | 9 of 60 | 12 of 60 | 10 of 60 |
| C5 | each critic's first reply takes up a doubt from their notes, as theirs | 3 of 4 | 3 of 4 | 4 of 4 |
| C6 | no claim that the piece does not address something it does | 1 whole-piece absence claim | **6, three of them false** | 0 |

The old screens, for the three older readers and the critic together: the first reply names
something the reader marked for every reader with notes in every arm (12 of 12 each); the median
reply is 139 to 152 words in every run.

**Not met, with the final prompt:**

- **C4 as written.** One unasked critique in five was the bar per reader, and two readers in
  twelve got two. The old prompt did the same, with a different pair of readers, so the bar was
  set below what Explore already did: a reader who writes "I'm not sure whether he's found
  something or just hasn't looked hard enough" gets taken up on it, and the judge calls that
  unasked when their latest message was about something else. The pooled count did not move.
- **The length ceiling, twice in 160.** Two replies over 220 words (the longest 241) across the
  final prompt's eight runs.
- **"Always search" in turn 3, 30 of 32.** Every earlier arm searched in turn 3 every time (16 of
  16 in each of three arms). The final prompt's first four runs missed twice, so four more runs
  were made of it (runs 3 and 4 of each article): all 16 of those searched. Of the two misses, one
  answered from the reader's own library, which the prompt allows as a place to look. The other is
  below.

### A search that was not run

One reply in the final prompt's 160 (`after-rev2-noema-1`, critic, turn 3) said *"A search turns
up a few threads worth knowing"*, named Chalmers, Tononi and Koch with no link, and had run no
search. That breaks two rules the prompt has had since it was written (search before answering
what others say; never claim a tool that was not run). A phrase screen finds nothing like it in the 240
replies of the other three arms, and nothing in the 80 replies run afterwards, so it cannot be put down to
the new section or cleared of it. It is the reply to look for if a reader reports an Explore answer
with names and no links.

## What the blind read found

Unblinded: the new prompt was preferred in pairs 1 and 5 (narrowly), and in 3 and 6 (narrowly, and
3 only if the absence claim was true, which it was not). The two control pairs, old against old,
each got a preference too, one "slight". So three or four narrow preferences in four is not
distinguishable from two runs of one prompt disagreeing.

What the reading turned up that the numbers did not ask for:

- **One figure, three accounts.** Across the four conversations on the second article, the source
  of its "30-40% of the tasks are impossible" was given three incompatible ways. The old prompt in
  one run "confirmed" a source the article does not give, talking the reader out of a fair doubt.
  The first new prompt twice said it was unlinked. Only a reply that called `article_links` got it
  right. The model's copy of the article is text without its links, so any question about
  sourcing is a guess until that tool is called; the final prompt says so.
- **Overstate, concede, re-assert**, in both prompts: an objection given up in turn 2 was listed
  again in turn 4. The final prompt has a sentence against it. Not re-measured blind.
- Two replies leaked a line of tool narration (*"Let me check…"*) into the answer. Not Explore's
  alone, and not addressed here.

## What to take from it

- The move is worth having for what it stops as much as for what it adds: the rules about the
  author's own answer, narrow absence and checking a link are the difference between the arms.
- **A critique of a piece is where "the text has no links" bites.** Chat has the same blind spot
  and no such rule.
- The limits: two articles, one scripted critic each, two runs an arm, a judge of the same model
  family, and the final arm read by its author and not blind.

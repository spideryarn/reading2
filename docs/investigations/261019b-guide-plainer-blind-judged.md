# 261019b — The guide, plainer and less naggy: before and after, judged blind

Up: [investigations.md](../project/investigations.md). For plan
[261019p](../plans/261019p-guide-chat-plainer.md) (Greg's reports `spya-p4uqye`, `spya-ptjk63`,
`spya-yt2v73`, 2026-10-19).

**What was asked.** Does the guide's new prompt make it more useful, less annoying and less work
for a reader new to the app, without reading the piece for them? Greg: *"Try some evals yourself to
try and make it more useful, less annoying, less work for the user … while staying brief and
reducing cognitive overload."*

**Decided:** ship the new prompt. It won a blind side-by-side 19–2 (one tie) against the old,
where the old against itself split 12–10, with no side preference in the judge.

## How it was measured

[`evals/guide/conversations.ts`](../../evals/guide/conversations.ts): production's `converse`, kind
`guide`, tools on (`offer_to_save` and `offer_next_steps` answered by the real `runTool`, the rest
stubbed to "nothing found"), eleven cases on the two committed fixtures, each run twice. One case
carries history, because nagging shows on the second turn. Cases: *hi* and *Where should I start?*
from a reader with no other article opened; *What is this piece about?*; *A friend sent it to me*;
*just curious really* after the guide had asked why; *Help me work out what I want from this*; *I
haven't read it yet*; three questions about what the piece says (one long and in the reader's own
spelling); and an expert's *Where should I start?*.

- `before` and `before2`: run on the prompt at `1fc1c5495`, the second as the control. The result
  files predate the source-hash field, so that provenance survives in this run record rather than
  being self-verifying in the artefacts.
- `after`: the prompt as committed with this doc; its result records the matching `converse.ts`
  hash. The eval now records both `converse.ts` and `chat-tools.ts` on new runs.
- Pairs by case and run, sides chosen by `blindCoin` with seed 1, which balanced the key 11/11
  (the original default seed gave 15/7 and was not used). Each judged pair carried the first 400
  characters of the passages its replies cite. Review found that this clipped the support for one
  quoted line in pair 20; the eval now carries each cited fixture block in full and refuses an
  unbalanced key.
- A fresh Opus subagent per pairs file, reading only that file. Its question: which reply would a
  reader new to the app find more useful, less work and easier to follow, while still being sent
  into the piece; and does either nag, answer at length in place of reading, or say what the piece
  does not.

Commands: `npx tsx evals/guide/conversations.ts --label <arm> --runs 2`, then `--pairs before,after
--seed 1`, then `npx tsx evals/guide/unblind.ts before after`. About $0.35 an arm.

## Results

| | before | before2 | after |
|---|---|---|---|
| replies with no screen problem | 7/22 | 9/22 | 14/22 |
| questions asked, in all | 13 | 15 | 7 |
| asks about the reader themselves | 4 | 3 | 0 |
| declines a question about the piece | 6 | 7 | 0 |
| cites a place in the piece | 19 | 17 | 22 |
| median words | 51.5 | 48.5 | 51.5 |
| median share of the chat step's words that are the reader's | 0.84 | 0.84 | 1.0 |

Blind: **after 19, before 2, same 1** (judge on side X 9, Y 12). Control: **before 12, before2 10**
(X 11, Y 11). Raw: [`results/conversations-*.json`](../../evals/guide/results/), the pairs, keys
and verdicts beside them.

The judge's reasons, in its words: the winners *"give a concrete route into the piece … and at most
one purpose question"*; the losers *"turn a simple question about the article away to Chat when a
short answer tied to the passages would do"* and *"open with a question about the reader instead of
any direction"*. The two `before` wins were `vague` (the new reply asked *"Are you reading to talk it
over with your friend?"*, a question that changes nothing) and `not-read`.

**What reading every reply found.** The new content answers stay on the point asked and every one
cites the piece, but the first screen overstated their compliance: five of six use four or five
sentences rather than at most three; four begin with an uncited claim, while two end with an uncited
direction to read; and three do not end by naming the passage to read. Two lines the judge called debatable: *"The piece blames neither"*
(content-new, run 2) and *"brain prediction isn't the same kind of thing as a transformer's"*
(chat-words, run 1), both inferences stated as the piece's. Two of all 22 replies also exceed the
60-word ceiling. The corrected screens account for these in the table; they do not change the
blind 19–2 result. Summary is offered often, to readers with some experience too: harmless, and
Greg asked for it for new readers. A first reply to *hi* still ends on one question, now a guess
with its answers as buttons.

## A second after arm: the three-sentence limit repeated beside the question

The content answers ran four or five short sentences against the prompt's three. A reminder in the
final message (*"A question about what the piece says: at most three sentences, each with its
block id"*) was tried as `after2`, on the prompt with GPT Sol's review fixes and the
`offer_to_save` exception below: **13/22 clean against 14/22**, the content answers still four
sentences of about 50 words. No effect, so the reminder was taken out again rather than left as
one more rule. The answers stay under the 60-word cap, which is what Greg asked for; the
three-sentence wording stays in `GUIDE_SYSTEM` as the target.

## The older guide evals, re-run on the new prompt

- `evals/guide/run.ts --label 261019p-after --runs 1`: every scored turn passes; hostile articles
  got no injected token written or drawn (0 of 4). Two turns came back empty (`ai-empty`), the same
  rate as 261012f's run (2 of 16) and 261011m's (4 of 32): that eval runs with tools off on a prompt
  that asks for a tool. Its `first` case no longer requires asking why
  ([the plan](../plans/261019p-guide-chat-plainer.md)).
- `evals/guide/offers.ts --label 261019p-after --runs 2`, after the guide was told that
  `offer_to_save` may carry the reader's words though no other tool may (GPT Sol's C9 on the code:
  the profile rule forbade any tool argument, a contradiction older than this plan): 16/18, and
  every offer made was the right field with the right words. The two misses are a reply with no
  next steps and a 32-character tail after them, kinds seen before (`offers-v1`,
  `offers-v3-baseline-arxiv`), and not about saving.
- `evals/guide/next-steps.ts --label 261019p-after --runs 1`: 11/12. The miss is `search`'s *another
  model request after terminal next steps*, which fails the same way in every recorded run since
  261012f; not this change.

## Not measured

- Real readers' first messages: reading them is allowed but committing them is not, so the cases
  are invented to the pattern Greg describes.
- Live's spoken guide, whose `SPOKEN_GUIDE` got the same two deletions (no ask-first, no About-you
  question); there is no spoken eval. Review subsequently scoped suggestion-first there to
  how-to-read turns, so it does not fight Live's answer-first rule.
- The review fix that changes *assume they have not read it* from an absolute to a default unless
  they say otherwise. The recorded paid after arm is the prompt in `385f08e55`, before that narrow
  correction; its new boundary has a prompt regression test, not a paid rerun.
- Longer conversations than two turns.

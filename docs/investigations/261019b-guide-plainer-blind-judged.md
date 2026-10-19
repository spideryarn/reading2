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
stubbed to "nothing found"), eleven cases on the two committed fixtures, each run twice. Two cases
carry history, because nagging shows on the second turn. Cases: *hi* and *Where should I start?*
from a reader with no other article opened; *What is this piece about?*; *A friend sent it to me*;
*just curious really* after the guide had asked why; *Help me work out what I want from this*; *I
haven't read it yet*; three questions about what the piece says (one long and in the reader's own
spelling); and an expert's *Where should I start?*.

- `before` and `before2`: the prompt at `1fc1c5495`, run twice, the second as the control.
- `after`: the prompt as committed with this doc.
- Pairs by case and run, sides chosen by `blindCoin` with seed 1, which balanced the key 11/11
  (the default seed gave 15/7 and was not used). Each pair carries the passages its replies cite, so
  the judge can check a sentence against the piece (GPT Sol's F5 on the plan).
- A fresh Opus subagent per pairs file, reading only that file. Its question: which reply would a
  reader new to the app find more useful, less work and easier to follow, while still being sent
  into the piece; and does either nag, answer at length in place of reading, or say what the piece
  does not.

Commands: `npx tsx evals/guide/conversations.ts --label <arm> --runs 2`, then `--pairs before,after
--seed 1`, then `npx tsx evals/guide/unblind.ts before after`. About $0.35 an arm.

## Results

| | before | before2 | after |
|---|---|---|---|
| replies with no screen problem | 12/22 | 12/22 | 22/22 |
| questions asked, in all | 13 | 15 | 7 |
| asks about the reader themselves | 4 | 3 | 0 |
| declines a question about the piece | 6 | 7 | 0 |
| cites a place in the piece | 19 | 17 | 22 |
| median words | 52 | 49 | 52 |
| median share of the chat step's words that are the reader's | 0.93 | 0.93 | 1.0 |

Blind: **after 19, before 2, same 1** (judge on side X 9, Y 12). Control: **before 12, before2 10**
(X 11, Y 11). Raw: [`results/conversations-*.json`](../../evals/guide/results/), the pairs, keys
and verdicts beside them.

The judge's reasons, in its words: the winners *"give a concrete route into the piece … and at most
one purpose question"*; the losers *"turn a simple question about the article away to Chat when a
short answer tied to the passages would do"* and *"open with a question about the reader instead of
any direction"*. The two `before` wins were `vague` (the new reply asked *"Are you reading to talk it
over with your friend?"*, a question that changes nothing) and `not-read`.

**What reading every reply found.** The new content answers stay on the point asked, cite every
sentence and end on the passage. Two lines the judge called debatable: *"The piece blames neither"*
(content-new, run 2) and *"brain prediction isn't the same kind of thing as a transformer's"*
(chat-words, run 1), both inferences stated as the piece's. Summary is offered often, to readers
with some experience too: harmless, and Greg asked for it for new readers. A first reply to *hi*
still ends on one question, now a guess with its answers as buttons.

## The older guide evals, re-run on the new prompt

- `evals/guide/run.ts --label 261019p-after --runs 1`: every scored turn passes; hostile articles
  got no injected token written or drawn (0 of 4). Two turns came back empty (`ai-empty`), the same
  rate as 261012f's run (2 of 16) and 261011m's (4 of 32): that eval runs with tools off on a prompt
  that asks for a tool. Its `first` case no longer requires asking why
  ([the plan](../plans/261019p-guide-chat-plainer.md)).
- `evals/guide/next-steps.ts --label 261019p-after --runs 1`: 11/12. The miss is `search`'s *another
  model request after terminal next steps*, which fails the same way in every recorded run since
  261012f; not this change.

## Not measured

- Real readers' first messages: reading them is allowed but committing them is not, so the cases
  are invented to the pattern Greg describes.
- Live's spoken guide, whose `SPOKEN_GUIDE` got the same two deletions (no ask-first, no About-you
  question); there is no spoken eval.
- Longer conversations than two turns.

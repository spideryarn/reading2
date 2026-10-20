# Chat's length flexes when the reader asks for detail

For `spya-hdeye3` (#662, SPIDERYARN-READING2-MV), a suggestion from Greg (admin, verified by
`scripts/feedback-reporter.ts`, exit 0, no addenda), sent from Chat on
`arxiv-2603-13294-spya-muf4gv`. Overseer queue item `qi-fstzmdxa`.

> I think in our chat prompt, we have something about giving brief responses. That's probably right
> for the most part, but the user may sometimes want a really detailed response, in which case, I
> guess we need some flexibility in the system prompt that sort of allows it to flex a bit towards
> their needs or request.
>
> — Greg, 2026-10-20

## What is there today

Chat's length rule has two halves, both from
[260930g](260930g-briefer-chat-and-explain-answers.md) (Greg asked for "a little bit briefer"):

- In `SYSTEM`, under WHAT IT MUST NOT DO: *"Do not pad. One or two short paragraphs is usually
  right, and one is often enough. Most answers need fewer than 300 words. Go longer when they ask
  for more, such as a summary."*
- `lengthLine("chat")`, beside the reader's question in the final user message, below the cache
  breakpoint: *"Keep it brief, as WHAT IT MUST NOT DO says: most answers need fewer than 300 words,
  unless they ask for more."* It exists because chat ignored every wording of the rule in `SYSTEM`
  alone; that plan found the model treats the number as a target.

So the escape hatch is already written down. **The evidence it does not work is 260930g's own smoke
case**: a reader asking for a section-by-section summary got 768 words before the change and 344
after. "Unless they ask for more" is three words against a number the model aims at, sitting on the
line nearest the question, which begins "Keep it brief".

## The change

**One lever first, the one nearest the question.** 260930g found the model follows the line beside
the question and treats its number as a target; that line opens "Keep it brief" and gives the
exception three words. So the first arm changes only `lengthLine("chat")`:

> *Follow what they ask for in length, as WHAT IT MUST NOT DO says: when they explicitly ask for a
> detailed, in-depth or step-by-step answer, or the long version, give them all of it and the 300
> words do not apply. Otherwise most answers need fewer than 300 words, and a quick summary stays
> quick.*

and, because it names the exception, `SYSTEM`'s bullet loses the bare "such as a summary", which
made any summary a licence for length (GPT Sol, plan review F1):

> *Do not pad. One or two short paragraphs is usually right, and one is often enough. Most answers
> need fewer than 300 words. Go longer when they explicitly ask for detail or depth.*

If that arm does not meet the targets below, the second arm also rewrites the `SYSTEM` bullet in
full (*"Fit the length to what they asked…"*). Changing `SYSTEM` costs one cold cache write per
article after the deploy; that is small, but it is a reason not to do it unmeasured.

**Precedence, said once** (GPT Sol, F4): an explicit request in the reader's latest message wins,
for that answer; then a standing preference in About you; then the under-300 default. The sibling
session `fbaqnz99` (plan 261020o, not yet on `dev`) adds REMEMBERING HOW THEY WANT TO BE ANSWERED,
which makes a saved preference win over "this prompt's own guidance on length" in every answer. That
is right against the default, and wrong against a reader who saved "brief answers" and now asks for
the long version. I have asked that session to say so in its section; this change does not touch
it. Every arm here is run without the sibling's code (it is not merged into this worktree), so the
sibling is not an uncontrolled change between arms; testing the two together (saved brief, asked
for detail) is the sibling's eval or a follow-up once both are on `dev`.

**Not changed:** `explain.ts` (a comment's answer, a question on a selection) — its answer is to a
selection, not a typed request, and it has a hard "never more than three" paragraphs; Greg named
chat. Learn, Explore and the guide have their own deliberate LENGTH rules, and the anti-goal (Learn
holds back the answer) is the point of them. `max_tokens` is 6,000 for chat on the high-power model
(`chatCeiling`), about 4,000 words, so a long answer is not clipped; the eval records `truncated`.

**What else moves with it:** `tests/chat-length-line.test.ts` pins both strings, and is updated to
the new words. `chat-principles.ts` is now in the eval fingerprint's shared-source registry
(`evals/plain-words/source-fingerprint.ts`), since every chat prompt interpolates it (F7).

## How it is measured

A new harness, [`evals/chat-length/run.ts`](../../evals/chat-length/run.ts), calls production's
`converse` (`kind: "chat"`, tools on, `power: "high"`, the model chat answers on once plan 261020q
lands) on the three articles the plain-words harness uses, with five asks each:

| ask | the reader's message | what should happen |
|---|---|---|
| `ordinary` | *What does "X" mean here, and why does it matter to the argument?* | unchanged |
| `quick` | *Give me a quick summary of this piece, just the gist.* | stays short |
| `detailed` | *…a really detailed explanation… in depth, not a quick summary.* | fuller |
| `walkthrough` | *Walk me through the whole argument of this piece, section by section, in detail.* | fuller |
| `followup` | turn two, after the arm's own `ordinary` answer: *Can you go into much more detail on that? I'd like the long version.* | fuller |

Arms: `before` and `before-2` on the commit before the change (the second is the control), then
`after-line`, and `after-both` only if needed. 15 calls an arm. Each file records the source
fingerprint, an article-text hash, the model and the effort, and `pairs` refuses to pair arms that
differ in anything but the prompt (F7). A follow-up pair shows each side's whole thread (F5).

**Targets** (F2: word count is a diagnostic, not the goal — a padded answer can be long):

1. **Primary, blind** — a fresh subagent reading only the pairs file judges each pair: which better
   gives the reader what they asked for, grounded in the article (for the three asks for more: does
   it cover what a reader asking for depth needed, that the other leaves out?), and is either padded
   or repetitive? The after arm should win the asks for more clearly beyond the control
   (`before` vs `before-2`), with no padding flagged that the before arms do not also get.
2. **No regression on `ordinary` and `quick`** — mean words within the before arms' spread (or
   ±15% of their mean, whichever is wider), and the judge not preferring before on them beyond the
   control.
3. **Diagnostics**: words per ask, and no truncation.
4. **Read every after answer** to the asks for more, for padding, repetition, and whether it still
   cites and still points into the piece.

**Blocked on 2026-10-20**: the box's OpenRouter key was at its monthly limit ($500, nothing left),
so no arm could run. Told the Overseer; the code and the test wait for the measurement.

## Deferred

- A standing length preference in About you — sibling session `fbaqnz99`, plan 261020o.
- Explain (comments, selections): not asked for; revisit if Greg asks.

## Reviews

- **Plan, GPT Sol (read-only): "revise"**, eight findings, all checked and all right; the full answer
  is [261020t-plan-review-sol.md](261020t-plan-review-sol.md). F1, "summary" is not "long": the
  bare word went from both lines and a `quick` case was added. F2, a length multiple rewards
  padding: blind adequacy is now the primary target, words a diagnostic. F3, test the line nearest
  the question alone first: now the first arm. F4, precedence with the sibling's About-you rule:
  stated above, sent to that session, and the sibling's code kept out of every arm. F5, follow-up
  pairs need their thread: shown. F6, `Promise.all` could close the ledger with calls in flight:
  `allOrStop`. F7, prove only the prompt changed: article hash, model and effort recorded and
  checked, `chat-principles.ts` fingerprinted. F8, one transient failure stranded an arm: a rerun
  fills in what is missing.
- Code: (to come — GPT Sol, workspace-write.)

## Result

(To come.)

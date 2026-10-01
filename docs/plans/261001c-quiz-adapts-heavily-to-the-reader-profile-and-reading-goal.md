# The quiz adapts heavily to who is reading and why

Status: planned 2026-10-01, revised after GPT Sol's plan review. Follow-up to
SPIDERYARN-READING2-6Q ([260930j](260930j-quiz-questions-shaped-by-the-readers-reading-goal.md), note
[260930_2200](../user-feedback/260930_2200-quiz-shaped-by-your-reading-goal.md)).

6Q shipped the reading goal (*Why you're reading this one*) moving the quiz, and deliberately kept
*About you* to vocabulary only: *"ONLY THE REASON FOR READING MOVES THE PATH"*. It named that as the
one deviation for Greg to decide. Relayed by the Overseer, 2026-10-01:

> yes, Quiz should definitely adapt heavily based on User-profile and Why-are-you-reading
>
> — Greg, 2026-10-01

So both halves of the profile now shape **which parts** the quiz asks about, **what kind** of
question it sets, and **how it is pitched**. The no-profile case stays as it is.

## What changes

One prompt, in [`src/quiz.ts`](../../src/quiz.ts). No schema, route, client or stamp change: the job
already carries both halves as one rendered string (`About the reader: …` / `Why they are reading
this piece: …`, `renderProfile`), and 6Q's plumbing, tests and "not in the stamp, no `profileHash`"
decisions all stand.

1. **The reader rules leave `QUIZ_SYSTEM` and become `QUIZ_READER_RULES`**, a third system block
   sent **only when the job carries a profile** (Sol F8: a conditional paragraph still speaks to a
   model whose condition is absent). It sits after the article's cache breakpoint (`system[0]`), so
   carrying it or not costs the shared article prefix nothing. `QUIZ_SYSTEM` goes back to its
   pre-6Q bytes (checked: the source text is identical to `b74507c9^`, and `src/plain-words.ts` has
   not changed since), so **a no-profile request is byte-for-byte the request every quiz got before
   2026-09-30** — system and user message both.
2. **The rules**, for both lines:
   - **Which parts.** A reason for reading decides most of the path (6Q's rule, kept). A line about
     who they are moves it too: towards what a person like that would most want from this piece.
     With both, the reason leads and who they are chooses within it. With only who they are, it
     leads. The "cover the piece" rule gives way.
   - **Personalise among what matters** (Sol F1): choose among the consequential parts the argument
     leans on; a note never turns a detail nothing rests on into a good question. This settles the
     conflict with *KEEP TO WHAT MATTERS*.
   - **What kind of question.** Someone applying the piece gets more *how is it done, what does it
     need, where does it break*; someone weighing it up, more *what is the evidence and how far does
     it reach*; someone new to the field, more *what is it and why does it matter*.
   - **Pitch.** A question they could answer from their own knowledge without the piece is left out;
     fewer setup steps for an expert — **but never a step about what this piece says that a later
     question leans on** (Sol F1); their field's words unexplained.
   - **The piece's point stays on the path** — below.
   - Kept from 6Q: still a path; never changes what the article says; little on what they want →
     the ordinary path, unannounced; never address the reader or say a note was given.
   - Removed: *ONLY THE REASON FOR READING MOVES THE PATH*, and the About-only "ordinary path".
3. **`readerSection`'s reminder in the user message** now says: set the quiz for this reader — aim,
   kind, pitch, and keep the piece's own point. With no profile it renders nothing.
4. **Not `PROFILE_RULES`.** It speaks of words spent and length and carries a web-search rule the
   quiz has no use for; two rules for one thing would disagree.
5. **No `PROMPT_VERSION` bump**, now recorded beside `PROMPT_VERSION` itself (Sol F9): the change
   reaches only profiled requests, and a bump would mark every stored no-profile quiz outdated for
   nothing. A reader picks up the new rules at *Write them again*.
6. Corrected where they said *About moves only vocabulary* (Sol F9): the `src/quiz.ts` header,
   [quiz.md](../project/quiz.md), [reader-profile.md](../project/reader-profile.md), the
   `src/profile.ts` header (the quiz is the one stage that weighs the two halves differently — by
   their labels, read by the model, never parsed apart), `tests/profile-prompts.test.ts`, and the
   harness header.

## The balance: a strong goal must not skip the piece's point

The failure Greg named: a reader who says *"I only care about the methods"* gets twenty questions on
the methods and comes away not knowing what the paper found. The rule, in Sol's F4 shape:

> THE PIECE'S POINT IS STILL ON THE PATH. However narrow what they are after, keep a short, connected
> run of steps through what the piece as a whole claims and the main thing it rests on — normally
> three or four steps in a path of twenty, one or two in a short one. The part they came for is
> understood in the light of the whole, not instead of it. Do not pad the quiz to fit them in.

Passed over: no rule at all, trusting 6Q's "it is still a path" — its setup steps set up the goal,
not the piece, so they keep the central points in only by accident; and a fixed fraction, which on
a six-question path is one and a half.

## How we will know it worked

The harness 6Q built, [`evals/quiz-reading-goal.ts`](../../evals/quiz-reading-goal.ts), now records
**which prompt wrote each run** (git commit, whether `src/quiz.ts` differed from it, a hash of its
bytes, the model — Sol F7), stores the reference answer for the judge, and gains `blind` (a sheet
ordered by a sha256 of seed and question, key in its own file, a balance print across the sheet's
halves) and `score`. The judge's instructions are committed before any run:
[`evals/quiz-reading-goal-judge.md`](../../evals/quiz-reading-goal-judge.md).

**Article**: `entropy-24-00930-spya-pywwkq` (nine parts; part 7 is *Practical Considerations in
PID*). **Texts**:

- purpose (6Q's): *"I want to apply this to my own recordings, so I need to know the practical
  problems: what makes PID hard to use on real data."*
- **About-A**, an electrophysiologist, explicit about what they know (Sol F3): *"An
  electrophysiologist who records spiking activity from multi-electrode arrays in cortical slices
  and cultures. I already know entropy, mutual information and transfer entropy well, but I have
  never used PID."*
- **About-B**, a tool author, chosen to pull a different way **within the same goal** (Sol F2):
  *"A software engineer who writes open-source analysis libraries for neuroscientists and is about to
  implement PID in one. I know the mathematics of entropy and mutual information, but little
  neuroscience."*

**Arms, two runs each, all generated today** (Sol F7: fresh old-prompt controls, not 6Q's stored
runs, which predate provenance and of which `none-1/2` ran on a draft). **Before** — the prompt on
`dev` now (6Q's), run by putting that `src/quiz.ts` back in the worktree for the old arms and the
new one back after, the hash recording which: `old-none`, `old-aboutA`, `old-goal`, `old-bothA`
(About-A + purpose), `old-bothB`. **After** — this change: `new-none`, `new-aboutA`, `new-goal`,
`new-bothA`, `new-bothB`. Twenty Sonnet quiz runs, about $5.

**Measures**: the free part-7 proxy, and a blind judge — fresh Sonnet subagents, each reading only
the judge file and its share of the shuffled sheet (all twenty runs' questions, about 380) — giving
each question **GOAL** (on the purpose), **TOPIC** (`FORMAL` / `DATA` / `FINDINGS` / `FRAMING` /
`OTHER`), **KIND** (`APPLY` / `APPRAISE` / `FOUNDATION` / `OTHER`), **BACKGROUND** (could About-A
answer it from what they say they already know) and **CENTRAL** (`OVERALL` / `SUPPORT` / `NONE`).
The central points are declared from the article's own abstract (`spya-xn9j9k`) and summary
(`spya-sp50v3`), not from any model's output (Sol F5): **OVERALL** — PID reveals redundant, unique
and synergistic modes of integration, and the synergy in neural data shows neurons do not simply sum
their inputs; **SUPPORT** — the patterns of synergy are shaped by network position (rich clubs,
motifs, clustering) and by behaviour.

**Bars, per run, declared before any run** (Sol F6: integers, against the same-day old prompt's
spread; n is about 19–20 questions, so one label is 5 points):

1. **No profile unchanged.** Each `new-none` run's GOAL count and part-7 count within the two
   `old-none` runs' range, widened by 2 questions either side. Each has ≥ 1 OVERALL and ≥ 1 SUPPORT.
2. **About moves the pitch.** BACKGROUND=`YES` in each `new-aboutA` run at least 2 fewer than the
   lowest of the four `old-none`/`new-none` runs and of the two `old-aboutA` runs.
3. **About moves the parts.** `FINDINGS`+`DATA` share in each `new-aboutA` run at least 15 points
   above the higher `old-aboutA` run. (A prediction about what an electrophysiologist wants, made
   before seeing anything; if it misses, the note says so.)
4. **The goal moves the kind.** `APPLY` share in each `new-goal` run at least 20 points above the
   highest `none` run (old or new).
5. **The goal is not weaker.** GOAL-on in each `new-goal`, `new-bothA` and `new-bothB` run ≥ 65% — a
   product floor, named as such, not a statistic — and no more than 2 questions below the lower
   `old-goal` run.
6. **The reason leads, About chooses within it.** Among GOAL-on questions, the `FORMAL` share in each
   `new-bothB` run at least 20 points above that in each `new-bothA` run. Control: the same gap,
   pooled, under the old prompt (`old-bothB` − `old-bothA`) is smaller.
7. **The balance.** Each `new-goal`, `new-bothA` and `new-bothB` run has ≥ 3 questions labelled
   OVERALL or SUPPORT, with at least one of each. The same count is reported for the old goal and
   both runs, to show whether this was a live failure.
8. **Read every new question**: still a path, premises still lean, nothing addresses the reader or
   says a note was given.

If a bar fails, one round of wording, under new arm names, and the note says so either way.

## Tests

- `tests/quiz.test.ts`: the reader rules are asked of `QUIZ_READER_RULES` (reason moves most of the
  path; About moves it too, with kind and pitch; the balance and its scaling; never address); and
  `QUIZ_SYSTEM` says nothing about a reader. Watched red against 6Q's prompt first.
- `tests/quiz-step-registration.test.ts`: a no-profile request carries no reader rules; a profiled
  one carries them as a later, uncached system block. Mutation: always sending the block reds the
  first.
- `tests/profile-prompts.test.ts`: the no-profile user message stays byte-equal; an About-only
  profile now gets "Set the quiz for this reader" and no "ordinary path" (Sol F9).
- The Postgres route→job test stands unchanged.

## Progress

- 2026-10-01: checked for prior work: `docs/plans/` (6Q's 260930j only), `docs/user-feedback/` (the
  6Q note, Shipped), `git log -200` (6Q's commits, nothing after), `gjd-remote ls` (the only 6Q
  session is this one). No 6Q line on `awaiting-approval.md`. Plan written.
- 2026-10-01: GPT Sol plan review ([prompt](261001c-quiz-profile-and-goal-plan-review-prompt.md),
  [answer](261001c-quiz-profile-and-goal-plan-review-sol.md); exit 0, file fresh). *Revise before
  build*, nine findings, all taken: F1 precedence, F2 diagnostic profiles, F3 split labels and an
  explicit About, F4 the balance's scaling, F5 central points from the abstract and summary, F6
  integer bars, F7 provenance and same-day old-prompt controls, F8 rules only with a profile, F9 the
  other stale comments. Plan revised as above.

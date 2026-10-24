# 261024e — Chat's examples, not the reader's field by default: measured

Up: [investigations.md](../project/investigations.md). For plan
[261024v](../plans/261024v-chat-picks-the-clearest-example-not-the-reader-s-field.md), Greg's report
`spya-furs26`:

> It's nice how the chat seems to take into account my background in the examples that they
> choose, but perhaps we can make a minimal update so that they don't do that too much. There may
> be a simpler or better analogy that doesn't involve my specific background
>
> — Greg, 2026-10-24

**What was asked.** Can a minimal prompt change stop conversations building their examples and
analogies from the reader's stated job by default, while keeping one from their field where it is
the clearest, or where they ask for it?

**Decided: ship both parts.** A sentence on `CHAT_PRINCIPLES`' pitch bullet (src/chat-principles.ts)
*and* a two-line reminder beside the profile in conversation prompts (`withExampleReminder`,
src/converse.ts). The sentence alone moved the count a little and missed the bar set before the run.
With the reminder, examples forced from the reader's job fell from 9–11 per 27 replies to 0–1, and
blind preference went from a 13–12 control split to 22–3 and 16–9. Field examples stayed where they
fit: an anaesthetist still got clinical cases, a teacher who asked got the classroom, and Explore
still tried the piece on the reader's own project.

## How it was measured

[`evals/chat-principles/run.ts`](../../evals/chat-principles/run.ts), production's `converse`,
Opus 5.5, tools on and answered "nothing found". Nine `ex-*` cases, each a chat started from a
paragraph: the words `askAboutBlock` writes *and* the thread anchor production sends (the harness
sent no anchor before; GPT Sol's plan review, F3):

- `ex-own`: **Greg's own turn**, block `nczgb5` of *Consciousness in Artificial Intelligence*, his
  profile, the article exported read-only from production into `evals/chat-principles/articles/`.
- Five tempting cases, a profile far from the passage: a CTO on Seth's bias passage, a head chef on
  Nagel's "what it is like", an intensive-care nurse on computational functionalism, a family lawyer
  on reward hacking's impossible tasks, a dairy farmer who knows a little Python on Felleisen's
  expressive power.
- Three guards: `ex-anaesthetist` (the passage turns on anaesthesia, so their field is the clearest
  example), `ex-asks-field` (a teacher who asks for classroom terms), `ex-help` (a plumber's "?"
  press, whose prompt asks for an analogy).

Arms, three runs per case, 27 replies each: `ex-before` and `ex-before2` (control) at `2786da13e`;
`ex-after` (the principle sentence) at its commit; `ex-remind` and `ex-remind2` (sentence and
reminder) at `5622a8161`. Plus `ex-guard`, two runs of an Explore reader with a project
(`explore-own-case`) and three older cases (`expert-term`, `others-thought`, `expert-others`). About
$9 in all.

Two measures, each from a fresh Opus subagent that read only its own file:

- **A targeted blind count**, [`examples.ts`](../../evals/chat-principles/examples.ts): all replies
  of the arms shuffled together with no arm names, the passage and every passage the reply cites
  shown, so the article's own examples are not counted as the model's (Sol, F4). For each reply the
  counter itemises the examples it brings in, tags each `general` or `theirs`, and marks a `theirs`
  one `forced` only by naming the plainer example that would have done better. The tally refuses a
  line whose counts do not match its items.
- **Blind pairs** (`run.ts --pairs`), keys balanced 13/14, unblinded with
  [`tally.ts`](../../evals/chat-principles/tally.ts).

## Results

The controls showed the problem plainly before anything changed: the lawyer got a "junior associate
told to file tonight" analogy in all six control replies, the plumber's "?" got plumbing in five of
six, the chef got probe thermometers and sauce machines, the nurse got bedside monitors and
ventilators.

**First count**, three arms (the principle sentence alone):

| arm | examples / reply | theirs / examples | forced |
|---|---|---|---|
| ex-before | 1.5 | 38/41 | 17 |
| ex-before2 | 1.6 | 38/42 | 17 |
| ex-after | 1.6 | 33/44 | 11 |

Fewer forced in 3 of the 6 tempting cases (lawyer 3→0, chef, farmer), the CTO unchanged and the
nurse slightly worse. The bar set beforehand was at most half the lower control in at least 4 of 6,
so it failed. Pairs: 15–12 and 11–8 (8 ties) against a 13–12 control, inside the spread. Following
the plan, the next attempt moved the rule, not its wording.

**Second count**, all five arms in one fresh sheet:

| arm | examples / reply | theirs / examples | forced |
|---|---|---|---|
| ex-before | 1.7 | 42/46 | 9 |
| ex-before2 | 1.8 | 44/49 | 11 |
| ex-after | 2.0 | 42/54 | 7 |
| **ex-remind** | 1.6 | 24/43 | **1** |
| **ex-remind2** | 1.5 | 26/41 | **0** |

| pair | wins |
|---|---|
| ex-before vs ex-before2 (control) | 13–12, 2 ties |
| ex-before vs **ex-remind** | 3–**22**, 2 ties |
| ex-before2 vs **ex-remind2** | 9–**16**, 2 ties |

- **Against the bar set before the run:** forced 0–1 against a lower control of 9 (bar: at most 4);
  fewer forced than the control mean in 4 of 6 tempting cases (chef, nurse, lawyer, farmer; the CTO
  had 1 in one run against none, and Greg's own case had none in any arm); the guards hold. Examples
  per reply, 1.5–1.6 against the controls' 1.7–1.8, is **just under** the controls' range, which
  the rule said it should not be. Read, it is one fewer example in a few replies, not analogies
  dropped: `ex-help` has one in every reply of both arms.
- **The judges' problem notes say the same.** "Analogy built from the reader's job" is flagged 13
  times against the old prompt in one pair file and 0 against the reminder, and 11 against 1 (a
  pitch deck for the CTO) in the other.
- **The two counters disagree on scale.** The same control replies scored 17 forced in the first
  count and 9–11 in the second. Compare arms only within one count; that is why the second sheet
  holds all five.
- **Guards.** `explore-own-case` still turned the piece into questions about the reader's own
  overnight agents, as Explore's `THEIR OWN CASES` asks. `expert-term`, `others-thought` and
  `expert-others` kept their length against `bg-after2` (within about ±10 words, one reply 70 longer).

**What was not measured.** Three runs per case is small, and two of the cases (CTO, Greg's own) were
near zero before, so they cannot show a fall. Live's spoken prompts carry neither part. Prompts
outside conversation (summaries, glossary, quotes) share `profileSection` and were deliberately left
alone; nobody has reported the same thing there.

Results, sheets, keys, counts and verdicts are in `evals/chat-principles/results/` under `ex-*`,
`examples-*`, `pairs-ex-*`, `key-ex-*` and `verdicts-ex-*`.

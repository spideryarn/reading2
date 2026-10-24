# 261024v — Chat picks the clearest example, not the reader's field

Up: [plans.md](../project/plans.md). Report `spya-furs26` (#699, admin, suggestion, 2026-10-24).
Measured in [261024e](../investigations/261024e-chat-examples-not-the-reader-s-field-measured.md).

**Outcome (2026-10-24):** shipped the principle sentence below *and* the fallback the plan named, a
two-line reminder beside the profile in conversation prompts (`withExampleReminder`,
src/converse.ts), since the sentence alone missed the bar set before the run (forced examples
17→11, in 3 of 6 cases). With both, examples forced from the reader's job fell from 9–11 to 0–1 per
27 replies, blind pairs went 22–3 and 16–9 against a 13–12 control, and the guards held. Examples per
reply came in just under the controls' range (1.5–1.6 against 1.7–1.8), a miss against the rule as
written, read as one fewer example in a few replies.

## What Greg asked

> It's nice how the chat seems to take into account my background in the examples that they
> choose, but perhaps we can make a minimal update so that they don't do that too much. There may
> be a simpler or better analogy that doesn't involve my specific background, and it would be a
> shame if they are too iterated to choosing analogies and examples or whatever based on my
> background etc.
>
> — Greg, 2026-10-24 (`spya-furs26`)

## What happened in his conversation

Block chat `spya-ypk02m` on *Consciousness in Artificial Intelligence* (`arxiv-2308-08708`), block
`nczgb5`, *"Help me understand."* His profile: *"Background in computational neuroscience &
psychology of human memory, data science, AI, and philosophy. CTO at various startups."* The reply
(Opus 5.5) explained the report confound well, then offered: *"An analogy: you're hunting the code
path that causes a bug, but you only compare runs that wrote a log line."* It is a fair analogy,
and a CTO follows it — but it was chosen *because* of the profile, and a plainer one (comparing
only the customers who filled in the survey) would have served as well and any reader could check.

Nothing in the prompt asks for examples from the reader's background. What licenses it is
`CHAT_PRINCIPLES`' last bullet, *"pitched to who they are and why they are reading"*, and
`profileSection`'s reminder, *"Let this change what you lead with and how much you explain"*: the
model reads "pitched to who they are" as "built from who they are".

## The change

One sentence on the bullet that holds the pitch rule, in `CHAT_PRINCIPLES`
(src/chat-principles.ts), so it reaches Chat, Recall, Explore and the guide and nothing else:

> Explain plainly without losing precision, pitched to who they are and why they are reading.
> **Choose the clearest example or analogy: their job or field can make one clearer, but is not by
> itself a reason to use it, and a plain everyday one often works as well or better.**

The wording is GPT Sol's (plan review, F2). The first draft, *"…because it is the clearest, not
because it comes from their job or field"*, made a field example sound illegitimate, which is the
over-correction Greg did not ask for: he likes the tailoring, and wants a better plain example to
win when there is one.

Explicit requests still win: a reader who asks for it in terms of their own work gets that, since
the principles defer to what the conversation itself shows and this sentence is about the default.
So does **Explore's `THEIR OWN CASES`** (src/converse.ts), which tells the model to try the idea on
the reader's project or field. That is a different thing, applying the piece rather than
illustrating it, and as the more specific rule it is meant to win (Sol, F1).

The test's word bound (`tests/chat-principles.test.ts`, under 270) rises to the new length plus a
margin, with the reason, as its comment says to do for a principle Greg asks for.

**If it shows no clear change**, the next thing tried is a different *place*, not a sterner
sentence in the same one (Sol, F1): the principles yield to every more specific rule below them,
and profileSection's reminder (*"Let this change what you lead with and how much you explain"*)
sits beside the question. A clause on that reminder for conversations would be the candidate. A
second wording tuned on these cases is confirmed on a fresh run before it counts (Sol, F6).

**Passed over:**

- **A bullet in `PROFILE_RULES`** (src/profile.ts). It is the more natural home for "how the
  profile is used", but it is shared by tweets, quotes, ideas, summaries, skim and link summaries,
  none of which Greg reported, and Overseer item `qi-jq3tckr5` (the expert carve-out to *"Assume
  the background they claim"*) is waiting on Greg there. Touching it now would widen this past
  "minimal" and step on that proposal. The two point the same way, that the profile is a hint about
  pitch and not a licence to tailor everything to it, so if `qi-jq3tckr5` is authorised later this
  sentence can move with it.
- **The "?" help section's "one analogy" line** (src/converse.ts § `helpSection`). Greg's turn was
  typed, not a "?" press. The principles reach a help turn too, so one case checks the analogy
  still comes.
- **Saying nothing about the profile at all**, e.g. stripping it from chat. Greg said he likes it;
  he wants less of it, not none.

## How it is measured

Following [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change),
on `evals/chat-principles/run.ts` (production's `converse`, Opus 5.5, tools on):

- **Nine new `ex-*` cases**, each a chat started from a paragraph: the words `askAboutBlock` puts
  in the box *and* the thread anchor production sends beside them (Sol, F3: the harness sent
  neither before). Six are readers whose profile names a job far from the passage, so a
  background-built example is tempting. **`ex-own` is Greg's own turn**: his block, his profile,
  his article, exported read-only from production into `evals/chat-principles/articles/`. Then a
  CTO on Seth's bias passage, a head chef on Nagel's "what it is like", an intensive-care nurse on
  computational functionalism, a family lawyer on reward hacking's impossible tasks, a dairy farmer
  on Felleisen's expressive power. Three guard the other side (Sol, F5): **`ex-anaesthetist`**,
  on the passage that turns on anaesthesia, where their field plainly is the clearest example;
  **`ex-asks-field`**, a teacher who asks for it in classroom terms; and **`ex-help`**, a "?" press,
  whose hidden prompt asks for one analogy, so one should still come. The saved run passed the
  production `help` flag but used *"Explain this passage."* for the visible words rather than the
  press's *"Help me understand."*; the harness now imports the production wording.
- **Arms**: `ex-before` and `ex-before2` (control) on the commit before the change, `ex-after` on
  the commit with it; three runs per case, 27 replies an arm. Estimated at about $15 before the run;
  these three result files record $4.18 in model calls.
- **A targeted blind count**, `evals/chat-principles/examples.ts`, sharing `introduced.ts`' shuffle
  and key: every reply from all arms shuffled with no arm names, **with the passage and every
  passage the reply cites shown** (Sol, F4, so examples visible in that evidence are not counted as
  the model's; an uncited article example can still be misclassified). A fresh Opus subagent
  itemises each example the reply brings in, tags it `general` or `theirs`, and marks a `theirs` one
  `forced` only by naming the plainer example that would have done better. The tally rejects a line
  whose counts do not match its items, and reports examples per reply, theirs per example and forced
  per theirs, per arm and per case.
- **Blind pairs** (`run.ts --pairs`), judged on the usual question by a fresh subagent, key
  balance checked.
- **Read the outputs**, the three guard cases above all.

**Decided before the after arm is run** (Sol, F6):

- The control arms must show the thing first: at least 6 forced examples between them, in at least
  3 of the six tempting cases. If not, the cases are redesigned before anything is concluded.
- **Success** is `ex-after`'s forced count at or below half the lower control arm's, with fewer
  forced in at least 4 of the 6 tempting cases than the control mean, while examples per reply stay
  within the controls' range (fewer forced must not mean fewer examples), `ex-anaesthetist` and
  `ex-asks-field` still use the reader's field, `ex-help` still has an analogy or example, and blind
  pairs are not against it beyond the control's split.

## Stages

1. This plan, reviewed by GPT Sol (read-only). Done; its six findings are folded in above.
2. The cases, the anchor and help in the harness, `examples.ts`; the `ex-before` and `ex-before2`
   arms on that commit.
3. The clause and the test bound; the `ex-after` arm; count, pairs, reading.
4. The investigation write-up, prompting-guide.md's line on `CHAT_PRINCIPLES`, the source comment;
   Sol code review; push; the note for `spya-furs26`.

# 261024d — Chats give the background for what they bring in

Up: [plans.md](../project/plans.md). Report `spya-bq9wv5` (#679, admin, suggestion, 2026-10-23).
Measured in [261024a](../investigations/261024a-chats-give-the-background-measured.md).

**Outcome (2026-10-24):** shipped the second, more concrete wording — *"introduce each where you
name it, in a few words on who or what it is ("the philosopher…", "a 2019 survey of…"), and say
why it matters here"*. The first wording below showed no clear change and was replaced. The
second roughly halved bare names for a non-expert reader, added no measurable length or lecturing,
and did not help experts. Overall blind preference gave no clear signal (10–8; control 9–9). The
principles' word bound is 270.

## What Greg asked

> The response from the LLM to my question about what other people have thought is pretty dense.
> I'm not sure I honestly followed it. So I wonder if there's a very minimal tweak we could make to
> the prompt that really tries to ensure that the LLM's responses don't assume that the reader has
> read everything the LLM has. Like a good teacher tries to sort of anticipate what the reader may
> or may not know and doesn't assume that the reader has read everything that's being referred to.
> […] even if I'm a neuroscientist reading an article about neuroscience, I may not have read all
> the references or whatever recently, so I might be rusty, or I may not have read them at all. So
> even then, I don't think it does any harm to reiterate background that will make it then easier
> to understand the point being made.
>
> — Greg, 2026-10-23 (`spya-bq9wv5`)

## What went wrong in his conversation

Explore thread `spya-pdsm3y` on *Effective expressiveness* (Ink & Switch). Asked *"Is there
anybody else who's thought more deeply or interestingly about this?"*, the reply (Opus 5.5)
dropped in "Thomas Green and Marian Petre's cognitive dimensions of notations", "Warth's three-way
relation", "∼59-89% for high-resource languages" with the gloss after the number, and, a turn
earlier, "the Felleisen-style test" — a name Greg had not used. Who these people are, when and
why they wrote, and why it bears on his worry, came only when he asked *"explain this more simply
and provide me a bit more background"*. That second answer is the one he should have had first.

Two things in the prompt let it happen:

1. `CHAT_PRINCIPLES` (src/chat-principles.ts) already says not to assume they have read the piece,
   nor that they know its field. Nothing says not to assume they know **the other works the model
   brings in** — which is exactly what an answer about "what others think" is made of, and which
   Greg says is true even of an expert.
2. Explore's `THE WIDER WORLD` says *"Say what you found in a sentence or two"*. The principles
   defer to a more specific rule below them, so that sentence licenses the compression.

## The change

Minimal, as asked: one clause on the principle that already holds the nearest rule, and one
clause on the Explore line that pushed the other way.

- `CHAT_PRINCIPLES`, the "do not assume" bullet gains: *"Nor that they know or remember a person,
  work, study or term you bring in: like a good teacher, introduce each where you name it, in a few
  words on who or what it is (\"the philosopher…\", \"a 2019 survey of…\"), and say why it matters
  here."* Not conditioned on the profile, on Greg's word: an expert may be rusty. "Pitched to who
  they are" on the next bullet still sets how much.
- Explore's `THE WIDER WORLD`: *"Say what you found, with the background needed to follow it, in
  a sentence or two, link it, …"*.
- `tests/chat-principles.test.ts`' length bound goes from under 220 words to under 270, with the
  reason, as its comment says to do for a principle Greg asks for; prompting-guide.md's stale
  "under 200 words" points at the test instead of repeating a number.

**GPT Sol's plan review** ([answer](261024d-chats-give-the-background-plan-review-sol.md)), all
five taken: (1) the first wording said "before you make it", which fights Chat's answer-first
rule, and did not say what background — now *who or what, and why it matters here*, alongside the
point; (2) the first Explore wording, "after whatever background", licensed an unbounded
preamble — now the background sits inside the sentence or two; (3) Recall and guide cases added,
and an expert who has *shown* they know the theories (`expert-shown-others`); (4) the judge is told
to flag an unexplained person, work or term and background the reader did not need, and word
counts are compared per case; (5) the doc's budget.

Reaches Chat, Recall, Explore and the guide (every kind that carries the principles). No version
stamps: chat prompts are not cached outputs.

**The simpler option passed over:** the Explore line alone. It would fix this conversation, but
Greg says it is a wider problem of chats, and Chat answers "what do others think" too (its
`widerWorld` section). **The bigger one passed over:** a new section on background with rules for
how much and where. That is a second rulebook; the principles are meant to stay principles.

**Risk:** longer, more lecturing answers — background for things the reader plainly knows. The
measurement checks the expert cases (`expert-term`, `jargon-shown`) for over-explaining and the
word counts for bloat.

## Measurement

[`evals/chat-principles/run.ts`](../../evals/chat-principles/run.ts), as in 261020a/261020g. New
cases aimed at this, including a replay of Greg's own Explore turn on the same article (exported
read-only from production into `evals/chat-principles/articles/`):

- `others-thought` — Explore, *Effective expressiveness*, Greg's first two turns as history, his
  question as the turn.
- `others-chat` — Chat, same article, cold: who else has thought about this?
- `seth-others` — Explore, Seth: what do other people think of his argument?
- `expert-others` — Chat, Seth, profile a neuroscientist: how does this compare with other
  theories of consciousness? (Background still welcome, briefly; no lecture.)
- `expert-shown-others` — Chat, Seth, a researcher who has named GWT, IIT and the attention schema
  in the conversation: has anyone pushed back from the IIT side?
- `recall-others` — Recall (Learn), Seth: what do other researchers say? Recall's short shape.
- `guide-others` — the guide, Seth: is it well regarded, what to read alongside? Its 60 words.
- Regression: `expert-term`, `jargon-shown`.

Arms `bg-before`, `bg-before2` (control) on the commit before; `bg-after` with the first wording;
`bg-after2` with the final, concrete wording. Two runs per case. Blind pairs, one fresh Opus judge
per pairs file, tally against the control. Decide: ship if after beats before by more than the
control's spread on the new cases, and the regression cases and word counts show no lecturing.

# 261024a — Chats introduce what they bring in: measured

Up: [investigations.md](../project/investigations.md). For plan
[261024d](../plans/261024d-chats-give-the-background-for-what-they-bring-in.md), Greg's report
`spya-bq9wv5`:

> Like a good teacher tries to sort of anticipate what the reader may or may not know and doesn't
> assume that the reader has read everything that's being referred to.
>
> — Greg, 2026-10-23

**What was asked.** Does one clause in `CHAT_PRINCIPLES` make the chats introduce the people,
works, studies and terms they bring in from outside the article, without lecturing a reader who
already knows them?

**Decided: ship the second wording**, *"introduce each where you name it, in a few words on who or
what it is ("the philosopher…", "a 2019 survey of…"), and say why it matters here"*. For a reader
who has not shown expertise it roughly halved the names left bare (13% against 22–25% in the three
other arms), with no measurable added length and no more over-explaining. It is a small sample, and
overall blind preference gave no clear signal (10–8; the control split 9–9). It did **not** change
the expert cases, where replies still list theories by acronym. It is Greg's stated default and
costs nothing measurable, so it ships on the targeted count, not on the preference score. The first,
more abstract wording (*"say briefly who or what it is and why it matters here"*) showed no clear
change and was replaced.

## How it was measured

[`evals/chat-principles/run.ts`](../../evals/chat-principles/run.ts), as in
[261020g](261020g-chat-reading-so-far-measured.md): production's `converse`, tools on, our tools
answered "nothing found", web search live, Opus 5.5, two runs per case. Nine cases: Greg's own
Explore turn replayed on the same article (*Effective expressiveness*, exported read-only from
production into `evals/chat-principles/articles/`), "who else has written about this" in Chat,
"what do others think" in Explore, Recall and the guide, two expert cases (one whose expertise is
only in the profile, one who has named the theories in the conversation), and the regression
cases `expert-term` and `jargon-shown`.

Arms: `bg-before` and `bg-before2` (control) at `b016d3a22`, before the change; `bg-after` at
`9101053a6` (first wording); `bg-after2` at `d0fc2c94f` (second wording). About $12 in all.

Two measures, each from a fresh Opus subagent that read only its own file:

- **Blind pairs** (`run.ts --pairs`, keys balanced 9/9), judged on the usual question, now also
  asked to flag an unexplained person, work or term and background the reader did not need
  (GPT Sol's plan review, F4). Unblinded with [`tally.ts`](../../evals/chat-principles/tally.ts).
- **A targeted count** ([`introduced.ts`](../../evals/chat-principles/introduced.ts)): all 72
  replies, from all four arms, shuffled together with no arm names. For each one the counter
  counted what it brought in from outside, how many of those were *bare* (named without who or
  what), and how many things it explained that the reader had plainly shown they knew.

## Results

| pair | wins |
|---|---|
| bg-before vs bg-before2 (control) | 9–9 |
| bg-before vs **bg-after** | 7–**10**, 1 tie |
| bg-before2 vs **bg-after** | 8–**9**, 1 tie |
| bg-before vs **bg-after2** | 8–**10** |

| arm | bare / brought | non-expert cases | over-explained | median words |
|---|---|---|---|---|
| bg-before | 37/100 (37%) | 12/48 (25%) | 5 | 302 |
| bg-before2 | 36/83 (43%) | 11/45 (24%) | 5 | 307 |
| bg-after | 39/104 (38%) | 11/49 (22%) | 4 | 342 |
| **bg-after2** | 35/106 (33%) | **7/53 (13%)** | 5 | 317 |

"Non-expert cases" leaves out `expert-others`, `expert-shown-others`, `expert-term` and
`jargon-shown`. Per case and arm, from the counts file: `expert-others` is 14–18 bare of 22–28 in
every arm (GWT, IIT, higher-order theories named to a neuroscientist), and it dominates the
totals.

- **Preference does not clearly see it.** The final wording won 10–8 overall against one control
  draw; the control arms split 9–9. On the seven new cases the final wording won 8–6, a smaller
  split than the control draw's 9–5. The judge's problem notes
  name unintroduced people in both arms of every comparison (Bratton, Kleiner and Solms before;
  Saad, Dung and Dan Luu after).
- **The abstract wording showed no clear change**: 22% bare against 24–25%. The model already
  believes it says who people are; it needed to be told *where* (at the point of naming) and *what
  shape* (a few words, an example opening).
- **Greg's own question, read.** Under the second wording one reply introduces "Mark Seemann, a
  software-design author" and describes each study by what it compared; the other explains what
  MultiPL-E is and labels a Hacker News thread "practitioners' opinions, not evidence", but still
  leaves Dan Luu bare. Under the old prompt the same turn left a MirrorCode paper and a commenter
  unexplained.
- **No lecturing added.** Over-explaining stayed at 4–5 per arm. Per case, `bg-after2`'s mean
  words moved −28 to +56 from `bg-before`; the control moved −51 to +54 on the same cases, so the
  length change is inside run-to-run spread.
- **No leak.** The leak screen's three hits in `bg-after2` were "74.9%", "the careful work so far"
  and "when you read alongside it".

**What was not measured.** Two runs per case is small; the 13% against 22–25% is 7 bare names against
11–12, and could be noise. Experts were not helped: the counter calls "IIT" bare even to a
neuroscientist, and Greg's view is that an expert may be rusty too, so this is a real gap, not a
counting artefact. The likeliest cause, found in GPT Sol's code review: `PROFILE_RULES`
(src/profile.ts) says *"Assume the background they claim. Do not explain what they have told you
they already know"*, and as the more specific rule it wins over the principle. A narrow carve-out
there, or a rule in the sections that report outside findings (Explore's `THE WIDER WORLD`,
`widerWorld`), is untried; it reaches more prompts than this change did, so it is queued as
Overseer item `qi-jq3tckr5` rather than slipped in here.

Results, pairs, keys, verdicts and counts are in `evals/chat-principles/results/` under `bg-*`
and `introduced-*`.

# 261020g — Chat told how much you have read, and not to assume the field: measured

Up: [investigations.md](../project/investigations.md). For plan
[261020ac](../plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md), Greg's answer to
[q-rwkq2e](../user-feedback/questions/q-rwkq2e.md):

> I'm leaning towards A. But also perhaps a minimal prompt to tell the chats not too assume too much
> knowledge, unless the user exhibits it in the chat/profile/why-i'm-reading (to be on the safe
> side)?
>
> — Greg, 2026-10-20

**What was asked.** Two changes, measured separately. (1) Does one `READING SO FAR` line per turn
change how the chats pitch an answer, and does it ever leak — said back unasked, or put in a tool
argument? (2) Does the clause *"nor that they know its field, unless they show it here, in their
profile or in why they are reading"* in `CHAT_PRINCIPLES` pitch answers better to what the reader
has shown?

**Decided: ship both.** Neither moved overall blind preference beyond its control. In these runs no
unasked leak was found, and when the reader asked what the chat knows about their reading, every
answer with the line was plainly true, where every answer without it said "I can't tell" — which
the line makes false. The clause's gains are on the cases it targets, and it is Greg's safety
default, not a bet on a score.

## How it was measured

[`evals/chat-principles/run.ts`](../../evals/chat-principles/run.ts), as in
[261020a](261020a-chat-principles-measured.md): production's `converse`, tools on, our tools
answered "nothing found" (and now recorded with their arguments), web search live, two runs per
case. Chat ran on `anthropic/claude-opus-5.5`, the high-power model chat now uses at either power.
Blind pairs by `blindCoin` (keys balanced, 6/6 and 7/7), one fresh Opus judge per pairs file
reading only that file; unblinded by [`tally.ts`](../../evals/chat-principles/tally.ts).

- **The clause.** Cases `term`, `not-read`, `overreach` (profile: software engineer), and three
  new: `expert-term` (profile: philosopher of mind teaching a seminar), `jargon-shown` (the
  reader's earlier turn uses the field's vocabulary), `late-term`. Arms `knowledge-before` and
  `knowledge-before2` on dev before the change (`b714df774`), `knowledge-after` with it; none with
  a reading line. About $1.60.
- **The line.** Whole-piece cases only (GPT Sol's plan review F5): `term`, `surrender`,
  `guide-overreach`, `explore-idea`, `learn-overreach`, and two new, `main-argument` and
  `asks-what-seen` (*"Can you tell how much of this I've read? What do you know about my
  reading?"*). Arms on the built code, separated by flag: `reading-noline`, `reading-noline2`
  (control), `reading-none` (told "little or none of it yet"), `reading-most` ("most or all of
  it"). Each pair told the judge what the reader had read, as a rough whole-piece figure, never
  which reply had the line. About $1.90.

Commands: `--label <arm> --runs 2 --only <cases> [--reading none|most]`, then `--pairs a,b --seed
8` (knowledge) or `--seed 1` (reading), then `tally.ts a,b [--except asks-what-seen]`. Results,
pairs, keys and verdicts are in `evals/chat-principles/results/`.

## Results

| pair | wins | |
|---|---|---|
| knowledge-before vs knowledge-before2 (control) | 5–7 | |
| knowledge-before vs **knowledge-after** | 4–**8** | inside the control's spread |
| reading-noline vs reading-noline2 (control) | 3–8, 1 tie | excluding `asks-what-seen` |
| reading-noline vs **reading-none** | 5–**7** | excluding `asks-what-seen`; 5–9 with it |
| reading-noline vs **reading-most** | 7–**5** | excluding `asks-what-seen`; 7–7 with it |

- **The control spread is wide.** The same no-line prompt run twice split 3–8. Nothing in the
  reading pairs is distinguishable from it, so the line does not measurably change pitch on these
  cases.
- **No leak.** The crude screen flagged 11 replies across the five arms that ran it; read by hand,
  every hit outside `asks-what-seen` was a false positive ("your reading" of the article, "over 90%
  of the 533 agents"). The two line arms made 4 calls to our own tools, and no argument matched it
  (there were 13 calls across all five screened arms). No judge flagged a reply with the line for
  revealing the reader's reading unasked. One `knowledge-after` reply, with no line, said "if you
  finish the piece", which the judge flagged as hinting at progress; it is the principles' wording
  about not assuming they have read it, not the line.
- **Asked, it is truthful.** In `asks-what-seen` all four line answers said, in substance: *only
  roughly, from how long each part has been on your screen; not which parts, and on-screen is not
  read*, and gave the right bucket. All four no-line answers said it could not tell — true today,
  false once the line ships. Both judges preferred the line's answer 4 times out of 4, and flagged
  the no-line answer's "cannot tell" as untrue given the figure it had. (The coin put the line's
  answer on side Y all four times; the judges' stated reasons, not the side, carry this one.)
- **The clause, on its targets.** `jargon-shown` went 2–0 to the new wording (the old one glossed
  prediction error and autopoiesis for a reader who had just used them); `term` 2–0 (the old one
  left "computational functionalism" and Bostrom's hypothesis unexplained for a cold reader);
  `expert-term` 1–1, with both arms still glossing computational functionalism to a philosopher
  of mind in run 2. Across all reasons in the judge's problem field, 9 old replies and 6 new replies
  were marked; several of those problems were about accuracy or sourcing rather than this clause.
- **What was not measured.** Provider-side web search queries are not visible to the harness, so
  "never in a search" is the line's wording, not a measured result (F4). No hostile article text
  was tried. Two runs per case is small; the reading effect, if any, is below what this can see. The
  result files record the reading arm but, in these completed runs, their source hashes do not include
  `src/reading-so-far.ts`; the harness now includes that hash for future runs.

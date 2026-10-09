# Judging brief (plan 261009a, blind)

The caller names one article `SLUG` and a judge name `JUDGE`.

You are judging outputs from a reading app that helps people read an article deeply. Read the file
`evals/results/digest-2026-10-09/judging/SLUG.md`. It has the article (each block tagged with an id
like `spya-xxxxxx`), then four LINEUPs (summary-fuller, ideas, chat-q1, chat-q2). Each lineup states
its TASK and shows five OUTPUTS labelled V, W, X, Y, Z, written by different systems in a random
order. You do not know which system wrote which, and must not guess; judge only the text. **Do not
open any other file under evals/** — in particular not `key.json`, nor anything outside `judging/`.

For every output in every lineup, check it against the article itself — open the cited blocks — and
score, each 1–5 (5 best):

- **accuracy**: no claims the article does not support, no misreadings, no wrong citations. A single
  real misreading of the argument should cost at least 2 points.
- **coverage**: gets what matters most for the task; nothing important missing.
- **nuance**: keeps the author's qualifications, distinctions and hedges; does not flatten or
  overstate.
- **usefulness**: how much it would help a careful reader who wants to understand (and, for chat,
  get a straight, well-argued answer to the question asked).

Then **overall**, 1–10: your all-things-considered judgement of quality for this task (not a sum).
Ties are allowed and expected where outputs are genuinely as good as each other. An output that is
"(no answer …)" scores 1 on everything. Length is not quality: do not reward length for itself.

Per lineup, also give a **rank** (best first; ties as a nested list, e.g. `["X", ["V","Z"], "W", "Y"]`)
and one or two sentences on what separates the best from the rest.

Your answer is JSON and only JSON, in this shape:

```
{"judge": "JUDGE", "slug": "SLUG", "lineups": {
  "summary-fuller": {
    "scores": {"V": {"accuracy": 4, "coverage": 4, "nuance": 3, "usefulness": 4, "overall": 7,
                     "note": "one line: the most important fault or strength, with a block id"},
               "W": {…}, "X": {…}, "Y": {…}, "Z": {…}},
    "rank": ["X", ["V", "Z"], "W", "Y"],
    "separates": "…"},
  "ideas": {…}, "chat-q1": {…}, "chat-q2": {…}}}
```

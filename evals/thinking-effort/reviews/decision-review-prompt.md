# Review: the per-mode effort decision from the thinking-effort eval (plan 261001p)

Read-only: do not change any file. You may run commands that need no network, e.g.
`npx tsx evals/thinking-effort/tally.ts --results evals/results/thinking-effort-261001 --mode sketch`
(free; it unblinds and recomputes from the files on disk).

**Candidate (committed):** `6c2afaf0e` on branch `worktree-thinking-effort-eval`. The write-up is
`docs/investigations/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md`; the
plan with the rule fixed before the results (and three notes written mid-run, each dated) is
`docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md`. You
reviewed the plan twice and the harness once (`evals/thinking-effort/reviews/`).

**The evidence:**
- Draws: `evals/results/thinking-effort-261001/runs.{sketch,ideas,illustrated}.jsonl`, plus
  `outage-402/` (three 402 rows from an account credit outage, re-run) and
  `evals/results/thinking-effort-261001-illustrated-validity-v{1,2}/` (4 stopped validity draws).
- Verdicts, keys and tallies:
  - `judging/sketch/`.
  - `judging/illustrated-low/` (the base-vs-low round).
  - `judging/illustrated/` (the base-vs-medium round).
  - Ideas was not judged; the validity gate decided it.
- Hierarchy's smoke: `evals/results/structure-whole-document/2026-10-01-17-*`.

**The decision:**
- Sketch `high` → `low`.
- Illustrated stays implicit `high`.
- Ideas stays `high`.
- Hierarchy stays `low`.

**Check, independently:**
1. **Every number in the write-up** against the files: mean U per judge, the per-article tables,
   costs, thinking, latency, invalid counts, the per-article saving arithmetic (~6¢, ~5%), and the
   spend (~$22.30).
2. **Whether each mode's outcome follows from the rule as fixed**, and where it does not, whether
   the departure is justified and honestly reported. There are three places to look hardest:
   - **(a) The validity gate.** It was reworded mid-run, from "every candidate draw validated" to
     "no more invalid draws than base", after base itself failed. Then came the Opus-arbitrated
     32-draw test for Illustrated `low`, stopped after 4 draws once the quality verdict made it moot.
   - **(b) Sketch.** Sol's mean U is 1.56, just above the 1.5 possible-loss line, and Sol puts both
     base draws above both low draws on 4 of 8 articles. Is adopting `low` defensible under the rule
     and Greg's stated leaning, or is this a close call that the rule says to keep at `high`?
     (The plan says a *possible* loss still adopts for Sketch, Illustrated and Ideas, because of
     Greg's leanings. Check that sentence exists and was there before the results.)
   - **(c) Setting aside the standardising rule** ("Sketch and Illustrated end on the higher of the
     levels each passes"). Read literally, it would hold Sketch at `high`. The write-up gives two
     reasons for setting it aside: Greg's words "if it makes them cheaper", and that Illustrated
     shares no cache at any effort (`src/models.ts` § `ArticleStage`). Is that a legitimate reading
     of Greg's instruction, or a post-hoc escape from my own rule? If it is the latter, say what I
     should do instead: ship nothing, or ship it flagged as Greg's call.
3. **Illustrated `medium`**: Sol 1.56, Opus 1.06 against a 1.1 line. Is "keep `high`" right?
4. **Anything the write-up claims that the evidence does not support**, and anything material it
   leaves out.

**Severity:** P0 = the decision is wrong or a number is materially false; P1 = fix before
shipping; P2 = worth changing; P3 = nit. Give every finding an ID (D1, D2, …), with evidence
(file:line or the command you ran). End with a verdict on each mode: ship as decided / ship
differently (say how) / do not ship.

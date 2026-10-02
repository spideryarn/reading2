# Plan review: 261001s — a quality-and-cost eval of *Dig deeper* answer models

You are reviewing a **plan**, read-only. Candidate (live, uncommitted, in the worktree you are in):
`docs/plans/261001s-dig-deeper-answer-model-eval.md` (untracked file). Base: the worktree's HEAD.
Nothing is built yet.

## What it is for

Greg wants to choose which model writes *Dig deeper* answers (today Opus 5.5, picked without
measurement) by trading quality against cost. The plan is an eval that freezes each example's search
step, runs twelve answer arms on byte-identical prompts, has a three-family judge panel score them
blind, and reports quality, cost per press (first and repeat) and latency. Greg's words and the
Overseer's brief are quoted at the top of the plan.

## Read first (does not limit scope)

- The plan.
- `src/dig-deeper.ts` (the search step, `findingsPart`), `src/explain.ts` (`buildExplainMessages`,
  `explainStream`, `DIG`), `src/term-lookup.ts` (glossary press), `src/routes.ts` ~1640–1830 (comment
  press), `src/citation-investigate.ts` (`investigateRequest`, `makeInvestigateCitation`,
  `digFirst`), `src/stream-run.ts` (`runStream`), `src/ai-call.ts` (`AI_JOB_ROUTE.eval`,
  `wireEffort`, `CHAT_REASONING`).
- `docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md` (what was measured).
- `evals/README.md` (conventions; `evals/plain-words/answers.ts` for a judged eval here),
  `docs/project/prompting-guide.md` § Measuring a prompt change, `evals/declared-spend.ts`.

## The questions

1. **Does the comparison measure what it claims?** Is holding the search fixed and stripping the
   web tool the right call, or does it bias the result (for or against Opus, or any arm)? Is anything
   else varying between arms that should not — reasoning effort, token ceiling, provider routing,
   cache state, the check arm's extra information?
2. **Is the judging sound?** Twelve answers side by side per call, three judges who are also arms,
   the `opus-b` control, the shuffle, the gold notes, the 1–5 criteria. What would make a judge's
   number mean less than it seems? Would you change the design (pairs, fewer arms per call, a
   different panel)?
3. **Is the cost measurement right?** First press vs repeat press, the cache, what is shared across
   arms, `usage.cost` as the source, the eval route lacking production's Anthropic `order` pin.
4. **Is the Luna + Opus check designed sensibly**, and is its cost and latency counted honestly?
5. **Spend**: is the estimate plausible, and is the cap enforced in the right place?
6. **Silent success**: where could this eval report a confident number while measuring nothing —
   a judge reply missing labels, a truncated answer, a cache that never warmed, a shuffle key that
   is off by one, a model id that resolved to something else? Which of those does the stage-2 test
   list not cover?
7. Anything the plan should drop, shrink or reframe.

**My own suspicions, worth less — spend most of the run elsewhere:** the 8,000-token ceiling differs
from production's 4,000; side-by-side scoring of twelve may compress scores; Kimi K3 as a judge has
no cache discount and is slow; the frozen inputs include third-party page excerpts committed to the
repo.

## Severity and IDs

P0 data loss / incorrect charging / broadly unusable · P1 user-visible wrong behaviour or a
violated authoritative contract (here: **a number the report would print that is wrong or
meaningless**) · P2 design risk · P3 prose. Refuse only on an established P0/P1. Number findings
F1, F2, … Each: severity, the claim, the evidence (file:line or plan section), and the fix you
would make. End with a verdict: build as planned / build after fixes / rethink.

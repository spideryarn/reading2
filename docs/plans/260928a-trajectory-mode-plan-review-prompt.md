# Plan review — Trajectory mode (plan 260928a)

You are reviewing a **plan**, read-only. Do not change any file.

## The candidate

Commit `fb96e2ad` on branch `worktree-trajectory-mode` (repo root is your cwd). Read, in order:

1. `docs/project/trajectory.md` — the vision doc; Greg's dictated brief is quoted verbatim in it. Read his words closely: they are the requirement.
2. `docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md` — the plan under review.

Then the precedents the plan says it copies, as far as you need to check its claims:
`docs/plans/260916d-faq-mode.md` (the most recent artefact-backed mode, and its commits `b31d8b87`, `0e947eb4`),
`src/faq.ts`, `src/ideas.ts` (profile plumbing), `src/profile.ts`, `docs/project/mode.md` (the checklist),
`docs/project/keyboard.md` and `src/web/keynav.ts` (who owns ← / →), `docs/project/granularity-zoom.md § The tree`,
`docs/project/quotes.md`, `src/step-order.ts`, `docs/project/vision.md`. Scope is not limited to these.

## What to do

An independent attack on the plan first. In particular:

- Does v1 as planned actually deliver Greg's core idea (skim at three increasing depths, non-paper order, prev/next, a granularity control, ← / →, personalised when a profile exists)? What is missing or wrong?
- **The reuse decision** (plan § Reuse): A (a thin new artefact that is only an ordering over block ranges) vs B (an ordering over existing Quotes) vs C (no model call). Is A the right v1 given Greg's "one reusable set of highlights" wish? Is there a better option the plan did not consider?
- The data shape: a single ordered array with a per-stop `depth` so that depths nest. Sound? Failure modes in the validation rules (demote/promote, overlap, span, caps)?
- The keyboard claim: ← / → are owned globally by keynav.ts for stride. Is claiming them in Trajectory mode feasible and safe as described?
- Anything in mode.md's checklist the stages would miss; any claim about the precedents that is false in the code.
- Is "not streamed" acceptable against the repo's rule "stream any model call a person is waiting on"? (AGENTS.md; FAQ and Ideas are not streamed either — check.)
- A simpler v1 that gets most of the value?

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an ID (F1, F2, …), a severity, the evidence (file:line), and a concrete recommendation. End with a verdict: approve / approve with changes / rethink.

## My own suspicions (worth less; spend most of the run elsewhere)

- The size targets (5 / 12 / 30, scaled by ⌈n/8⌉ etc.) are guesses.
- Whether a stop should be a hierarchy node rather than a free block range.
- Whether the segmented depth control should instead be a slider (Greg said "a slider").

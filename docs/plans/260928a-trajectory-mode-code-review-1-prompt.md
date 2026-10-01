# Code review 1 — Trajectory stage 1 (the server step)

You are the reviewer **and the fixer** for this stage. The house rule (docs/reusable/codex-cli-as-subagent.md § The house workflow): fix what is inside this stage, narrowly and red-first, and **report, do not fix**, anything wider you notice. Do not commit. Do not touch any database or the network.

## The candidate

Commit `868ae017` on the current branch. It is the stage; `4591e525`, which follows it, is only a merge of other people's work. Use `git show 868ae017 --stat` for the file list, and start with:

- `src/trajectory.ts` (new) and `tests/trajectory.test.ts` (new);
- `src/pipeline.ts`, `src/step-order.ts`, `src/models.ts`, `src/routes.ts`, `src/store/pg.ts`, `src/store/artifacts.ts`, `src/types.ts`;
- `drizzle/20260928012645_trajectory.sql`.

This list does not limit your scope.

The spec is `docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md`, §§ What v1 is › The step (server), and Stages item 1. The real runs are in `docs/plans/260928a-trajectory-mode-stage1-real-runs.md`. The precedent this copies is FAQ (`src/faq.ts`, commit `b31d8b87`), with `illustrated` as the precedent for a step that reads another step's artefact.

## What to attack

An independent pass first:

- validation correctness against the plan's rules;
- the growth rule;
- the stamp and freshness: `sourceHash`/quotes hash, `profileHash` and the stricter rule, and whether the GET route and the stage agree on "outdated";
- whether the refusal without Quotes and the `precededBy: ["quotes"]` path are sound server-side;
- `FORCE_ONLY_WHEN_NAMED`;
- the cost category and the gateway path;
- the export;
- the migration (it uses `ADD COLUMN IF NOT EXISTS` — check the CHECK constraint literal matches `STEP_ORDER`);
- prompt injection surface: quotes are article text inside the prompt;
- anything in docs/project/mode.md § The artefact that was missed.

You can run pure test files yourself, e.g. `npx vitest run tests/trajectory.test.ts`. Anything touching Postgres will not work in your sandbox. The Postgres-backed results, run by me after the commit: `tests/trajectory.test.ts tests/db-step-constraint.test.ts tests/doc-links.test.ts tests/fixture-ids.test.ts` gave 4 files and 46 tests passed, and `npm run typecheck` exited 0.

## One fix I am asking for, in-stage

The real runs dropped 1–5 stops per article as `sameBlock`, because two quotes in one paragraph were both offered and the model picked both. Offer the model **one quote per block**, the highest-priority one (ties → the earlier in the Quotes list), and count the collapsed ones on the artefact. The stop's passage is the block either way, and the other quote in that block is still marked in the prose by Quotes. Keep the `sameBlock` validation as the backstop. Red first, then bump `PROMPT_VERSION` only if the prompt text changes.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0/P1. Give every finding an ID, starting at **F11** (F1–F10 were the plan review).

## Output

For each finding: the ID, the severity, the evidence (file:line), and either **fixed** (what you changed, and the test that went red then green) or **reported** (why it is wider than this stage). End with a verdict and the list of files you changed.

## My suspicions (worth less; spend most of the run elsewhere)

- `sectionPathOf` rebuilds a block index per call.
- The growth rule counts offered quotes, not distinct blocks.

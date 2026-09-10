# Stage 2 code review: 260910e work reports — decisions schema 2

You are the stage reviewer **and fixer**, in the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/work-reports`. Fix what you find inside this stage,
narrowly and red-first; report, do not fix, anything wider.

## What to review

The Stage 2 commit is `HEAD` of branch `worktree-work-reports` at the time you start — its subject begins
"Work reports stage 2". Scope it with `git show --stat <that commit>`. Its files: `tools/overseer/decisions.ts`,
`scripts/overseer-decisions.ts`, `tools/fleet/decisions-view.ts`, `tools/fleet/routes-decisions.ts`,
`tools/fleet/wire.ts` (decision types only), `tools/fleet/web/src/decisions-client.ts`,
`tools/fleet/web/src/DecisionsPanel.tsx`, the decisions tests, `tests/overseer-decisions-schema2.test.ts`,
and `tests/fixtures/decisions-v1-frozen/`.

The spec: the plan `docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md` (design
section "Decisions: extend the one record…" and "Ranking", and the Stage 2 status paragraph listing what
the builder decided) and the brief `docs/plans/260910e-work-reports-stage2-task.md`. Your plan review is
`docs/plans/260910e-work-reports-plan-review-sol.md`: check WR-P1, WR-P2 and WR-P8 are met in code.

**Another GPT Sol run is reviewing Stage 1 in this same worktree right now**, and may edit
`tools/overseer/reports.ts`, `report-artefacts.ts`, `report-identity.ts`, `daemon.ts`, `notes.ts`,
`scripts/overseer.ts` and the reports tests. Do not edit those; a failure in them is not yours. Edit only
the Stage 2 files above.

## Evidence

The orchestrator ran `npx vitest run tests/overseer-decisions.test.ts tests/overseer-decisions-cli.test.ts
tests/overseer-decisions-schema2.test.ts tests/fleet-decisions-view.test.ts tests/fleet-decisions-client.test.ts
tests/fleet-decisions-panel.test.tsx tests/fleet-decisions-route.test.ts tests/fleet-artefact-ref.test.ts
tests/fixture-ids.test.ts tests/fleet-imports.test.ts` ⇒ 10 files, 279 passed, exit 0; and `npm run
typecheck` ⇒ exit 0. (`fleet-decisions-route` needs `npm run build:fleet` first.) Run them yourself.

**One test was never seen red**: the frozen old event parser refusing a schema-2 line
(`tests/fixtures/decisions-v1-frozen/event-parser.ts` and its test). Its first version passed for the wrong
reason. Break it on purpose and confirm it goes red for the right reason.

## Questions, in order

1. **Gate 1.** Can any path — the CLI, a hand-written line, the drain's future `by: "daemon"` — make a
   decision look reviewed or reversed by anyone but Greg, or make a session's decision appear as the
   Overseer's or Greg's, in the fold, the CLI output, the route, or the panel? Is `gregAsked:
   asked-answered` ever rendered like review?
2. **Old readers.** Does an old event reader really surface a schema-2 line as an unreadable line, and an
   old browser really refuse the schema-2 payload? Are the frozen copies faithful to `git show
   <parent>:…`?
3. **Schema-1 compatibility.** Does every existing schema-1 line still fold exactly as before (same
   records, same problems, same review state), apart from `author: legacy-unrecorded` and the
   `not-recorded` fields?
4. **The new `appendEvents` round-trip guard.** Is it correct, and can it refuse a legitimate write — for
   example the existing `seed`, or a retry?
5. **Ranking and search**: the order in the plan; not-recorded never above a known high; the CLI and
   browser searches agreeing.
6. **Untrusted text in the panel**: every new field rendered as text; links only from `artefactHref`.

**The finding I would least like to be wrong about**: that nothing a session writes can change who a
decision is shown as having been decided by, or whether it shows as reviewed.

## Format

Findings with an ID (`WR-S2-1`…), severity (P0 wrong data or gate 1 broken; P1 must fix before landing;
P2 should fix; P3 optional), file:line, what is wrong, and — if you fixed it — the red test you added
first and the fix. Then wider things you noticed and did not fix. Then a one-paragraph verdict. Run the
Stage 2 test files and the typecheck after your fixes and paste the summary lines.

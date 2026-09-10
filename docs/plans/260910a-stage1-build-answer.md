Stage 1 is implemented and left uncommitted. Nothing in this stage’s scope remains unimplemented.

Changed files:

- [tools/fleet/wire.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/wire.ts:3696)
- [tools/fleet/routes-admission.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/routes-admission.ts:1)
- [tools/fleet/admission-wiring.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/admission-wiring.ts:1)
- [tools/fleet/server.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/server.ts:36)
- [tests/fleet-admission-explain.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/fleet-admission-explain.test.ts:1)
- [tests/fleet-admission-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/fleet-admission-route.test.ts:1)

The concurrent plan edits, Stage 2 task document, and `.git-msg-plan.txt` visible in `git status` were not mine.

Verification:

- Focused admission suite: 28/28 passed.
- Fleet import and compile guards: 25/25 passed.
- Direct typecheck script: all four TypeScript projects passed; all 1,908 sources covered.
- Scoped Biome lint and `git diff --check`: passed.
- `npm run typecheck` itself exited 1 before compilation because the sandbox denied tsx’s `/tmp/tsx-1000/14.pipe` IPC socket. Running the identical script through `node --import tsx scripts/typecheck.ts` exited 0.
- Full `npm test` was not run, as requested.
- Port 8787 was not touched.

Red-first record, one per final test:

1. Low memory: `explainAdmission not implemented`.
2. Broken `/proc/meminfo`: `explainAdmission not implemented`.
3. Missing reserve: `admissionPayload not implemented`.
4. Empty reserve: `admissionPayload not implemented`.
5. Garbage reserve: `admissionPayload not implemented`.
6. Bad worker file: `admissionPayload not implemented`.
7. Reader order: returned the reserve error before the worker error; the final test now pins `workers → memory → reserve`.
8. `would-reduce`: `explainAdmission not implemented`.
9. `would-admit`: `explainAdmission not implemented`.
10. Unknown policy version: `explainAdmission not implemented`.
11. Review request: initially unimplemented; mutation then failed with `a vitest-only machine input was read`.
12. Browser request: same intended mutation failure.
13. Environment preservation: naïve resolution deleted `VITEST_MAX_WORKERS`; expected `"7"`, received `undefined`.
14. Successive forecasts: naïve resolution produced nominal workers 7 then 3.
15. Honest labels/caveat/time: initially unimplemented; then lacked `computedAtMs`; then recorded `clock` before the three reads.
16. No-query parsing: `parseAdmissionRequest not implemented`.
17. Unknown-kind parsing: `parseAdmissionRequest not implemented`.
18. Review/browser parsing: `parseAdmissionRequest not implemented`.
19. Ignored cost: `parseAdmissionRequest not implemented`.
20. Junk URL/NaN: threw `parseAdmissionRequest not implemented`.
21. Exact route: `admissionRoute not implemented`.
22. Suffix 404: `admissionRoute not implemented`.
23. Unrelated route: `admissionRoute not implemented`.
24. Route 500 arm: `admissionRoute not implemented`.
25. Production composition: `admissionRoute not implemented`.
26. Worker-file wiring: first lacked the machine-default marker; ignoring the configured file later produced nominal 8 instead of 3.
27. Server mount: initially absent; commenting it out later made the comment-stripped guard fail as intended.
28. Single composition: expected one `makeAdmission(` call, found zero.

No census, journal, repeating task, pushed `FleetState` field, or client code was added.
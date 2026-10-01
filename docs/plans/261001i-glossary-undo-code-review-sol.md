1. **P2** — [Metadata.tsx:1507](/home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/web/Metadata.tsx:1507): the verdict is a current-state prediction, not a guarantee. `POST /api/jobs` resolves and freezes the profile when pressed, while the glossary reads its source when the queued job runs. A purpose/profile change or preceding publication can therefore change the outcome. I qualified both notes with “With things as they are now.” Binding jobs to the predicted snapshot would be a wider protocol change.

2. **P2** — [Metadata.tsx:1509](/home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/web/Metadata.tsx:1509): “keeps every one already there” was too strong. Append deduplication can refine an incumbent entry’s name and prose while preserving its ID. I shortened the UI copy and corrected the same claim in [glossary.md:1160](/home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/docs/project/glossary.md:1160) and the plan.

3. **P3** — [metadata-reset-section.test.tsx:750](/home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/tests/metadata-reset-section.test.tsx:750): the refusal test passed before the latch existed. I extended it to prove refusal releases the latch and that a subsequent same-tick double press posts once. I also isolated the Postgres cases and added the missing purpose-only profile case at [store-glossary-run-kind-pg.test.ts:128](/home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/tests/store-glossary-run-kind-pg.test.ts:128).

No further issue found with label-dependent behavior or the reset latch. `pressing` and `about` do not key on visible text; `aria-describedby` follows the selected note. Refusal releases `starting` and `inFlight`; success releases them when the returned job appears; unmount discards the local latch.

Checks:

- Four unit files: 142 tests passed; final reset test rerun: 27 passed.
- Focused Postgres command: exit 1 before tests because sandbox access to local Postgres port `54362` was denied.
- `npm run typecheck`: exit 1 before checking because `tsx` could not open its IPC pipe (`EPERM`). Running the same script as `node --import tsx scripts/typecheck.ts` exited 0 with all projects covered.
- Changed-file lint and `git diff --check`: clean.

**Verdict: not ready** — the required Postgres gate and exact typecheck command have not completed successfully in this environment.
1. Medium — [tests/converse-stop.test.ts:138](/var/tmp/spideryarn-worktrees/fbht4hf4-chat-defaults-to-opus/tests/converse-stop.test.ts:138): a stopped standard-power chat still expected `effort: "default"`. Fixed to expect Opus’s `high`.

2. Medium — [waiting-and-cost.md:29](/var/tmp/spideryarn-worktrees/fbht4hf4-chat-defaults-to-opus/src/web/help/pages/waiting-and-cost.md:29): Help implied the High-powered AI switch controlled Chat. Fixed, and regenerated [help-corpus.generated.json:150](/var/tmp/spideryarn-worktrees/fbht4hf4-chat-defaults-to-opus/src/help-corpus.generated.json:150).

3. Low — [authenticated-api-route-contract.test.ts:2983](/var/tmp/spideryarn-worktrees/fbht4hf4-chat-defaults-to-opus/tests/authenticated-api-route-contract.test.ts:2983): `/api/models` correctly reported Chat as Opus, but lacked a direct contract assertion. Fixed. No client text expects Sonnet.

4. Low — [high-power-models.test.ts:4](/var/tmp/spideryarn-worktrees/fbht4hf4-chat-defaults-to-opus/tests/high-power-models.test.ts:4): test wording incorrectly described raw `modelFor` tier resolution as the model actually sent. Fixed and added coverage for every `ALWAYS_HIGH_POWER` task. The raw `modelFor("chat", "standard")` Sonnet result remains intentionally valid; `powerFor` makes an actual chat turn Opus.

Verification:

- Relevant sweep: 100 files; 98 passed. One real stale assertion above was fixed. Nine failures in `chat-empty-answer-log.test.ts` were sandbox `tsx` IPC `EPERM` failures before chat code ran.
- Clean rerun: 11 files, 689 passed, 1 skipped.
- Final changed-model rerun: 5 files, 585 passed.
- Full typecheck logic passed all four projects; 3,861 source files covered. `npm run typecheck`’s `tsx` launcher itself hit the same sandbox IPC restriction, so `node scripts/typecheck.ts` ran the identical checker successfully.
- Full all-project Vitest could not start because no local database was available; no database was started or changed.
- `git diff --check` passes.

VERDICT: SHIP WITH FIXES APPLIED
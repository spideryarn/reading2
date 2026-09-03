1. **Should-fix — [scripts/gjd-remote-envpolicy.ts:pushEnvPlan](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote-envpolicy.ts:1173): reviewed names can still reach the model.** `proposalReason()` counts only undecided keys, but `deps.propose(names, why)` sends every name whenever one new key exists. Saved decisions still prevent pre-ticking, but this breaks “no model is asked about a decided key.” Pass only undecided, unblocked names unless `--propose` explicitly requests all.

2. **Should-fix — [scripts/gjd-remote.ts:sendEnvPayload](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote.ts:2784): failure cleanup is still broken.** The successful path runs the `finally`, but `stageAndSend()` calls `die()`, and [die()](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote.ts:234) calls `process.exit(1)`, which bypasses JavaScript `finally` blocks. An SCP/SSH failure can therefore leave the staged secrets behind. Make the inner transport throw/return an error, clean up in `finally`, then call `die()` outside it.

3. **Low — [tests/gjd-remote-envpolicy.test.ts:pushEnvPlan](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/tests/gjd-remote-envpolicy.test.ts:1143): the sentinel test is now non-vacuous, but not CLI-to-SSH end-to-end.** Five real values enter `.env.local`; the real gateway/ledger path is exercised with HTTP stubbed, and the expected sinks are checked. Actual `pushEnvByChecklist`, `sendEnvPayload`, SCP/SSH errors, and failed staging cleanup remain uncovered. Add injected transport tests for successful and failed sends.

The policy representation itself is right: old files migrate as `reviewed = approved`; `approved ⊆ reviewed` is enforced; removed keys retain their decision and regain it when re-added. A model reply cannot override a rejected key. `--all`, interactive “select all,” or manually adding it to `approved` can select it, but those are explicit human overrides; `--propose` alone cannot.

The CLI glue sends only `plan.payload`; callbacks cannot make it send anything else.

No finding is severe enough to stop hellozenno’s run: the remaining exposure is a 0600/0700 local temporary copy only if transport fails, and the model issue sends names, never values.

**go**
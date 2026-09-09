Implemented all six findings. No commit made.

| Finding | Result | Red → green |
|---|---|---|
| 1 | Reproduced | Present-tense limit text remained beside an expired window. Now both backend states say “When this reading was taken…”. |
| 2 | Reproduced | `pass: null` produced zero parsed samples but still rendered `0% used`. `codexAttempt` now selects exclusively through `parseSample`. |
| 3 | Reproduced | Both nullable spend-control state and an individual limit rendered calm `0%` headroom. Web and CLI now fail closed. |
| 4 | Reproduced | Deferred test resolved request 2 then request 1: `expected "unknown", received "value"`. Superseded responses are now discarded. |
| 5 | Reproduced | A future reading displayed `24% used` and two reset credits. It now renders only unavailable headroom. |
| 6 | Reproduced by mutation | Restoring the old Claude-only case produced `expected false to be true`. The Babel test now guards the real dispatch. |

Finding 2’s required whitelist mutation produced:

```text
Expected: "7 days"
Received: "Codex subscriptionGeneral headroomUnknownthis history record predates Codex usage collection"
```

After restoring `codex` to `parseSample`, the same route→parser→DOM test passed.

Changed:

- [usage-history-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/usage-history-client.ts)
- [UsageHistory.tsx](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/UsageHistory.tsx)
- [UsagePanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/UsagePanel.tsx)
- [overseer.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/scripts/overseer.ts)
- [fleet-codex-usage-card.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tests/fleet-codex-usage-card.test.tsx)
- [overseer-cli-codex-usage.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tests/overseer-cli-codex-usage.test.ts)

Tests added for every finding; the existing reached-limit assertion was updated for the intentionally snapshot-qualified wording. No suggested fix was rejected.

Verification:

- Relevant and integration suites: 485/485 passed.
- Final focused suites: 22/22 DOM tests and 6/6 CLI tests.
- Scoped lint: clean.
- `git diff --check`: clean.
- No schema/history-record changes, forbidden imports, network access, or live reading.

Per instruction, I did not run `npm test` or `npm run typecheck`; those remain for your external pass.
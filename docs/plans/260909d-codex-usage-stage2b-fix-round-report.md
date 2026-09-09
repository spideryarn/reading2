Applied all seven findings. All reproduced; none were disputed or left unchanged.

Per finding:

1. **Reproduced — backend limit states discarded.**  
   Red: healthy fields were absent, while spend-control reached, an individual limit, and omitted reached-state/individual-limit fields still returned `kind: "value"`.  
   Green: `CodexUsageBucket` now carries `spendControlReached` and the complete `individualLimit`; the general `codex` bucket fails closed for reached, unavailable, or unmodelled states.

2. **Reproduced — implausible reset accepted.**  
   Red: `100_000_000_000` produced `5138-11-16T09:46:40.000Z`.  
   Green: the window becomes unknown. `buildWindow` already establishes a positive `windowMinutes` before calling `resetInstantMs`, so the new call order is sound.

3. **Reproduced — spawn-time freshness.**  
   Red: expected `08:00:02`, received `08:00:00`.  
   Green: collection uses reply time unless `nowMs` is explicitly pinned, and the expired test window is withheld.

4. **Reproduced — raw duplicate comparison.**  
   Red: omitted `limitName` versus explicit `null` returned `unknown`.  
   Green: normalized buckets compare equal; the existing genuine-disagreement test still passes.

5. **Reproduced — percentages above 100 discarded.**  
   Red: `101` became an unknown window.  
   Green: `101` and `rate_limit_reached` are both preserved.

6. **Reproduced — split UTF-8 corrupted.**  
   Red: splitting `é` between chunks made the reading unknown.  
   Green: `StringDecoder` preserves the character and the reading.

7. **Reproduced — premature id-2 accepted.**  
   Red: the collector settled after only the initialize write.  
   Green: it ignores id 2 until the rate-limit request has actually been sent.

One existing test changed: “keeps an unfamiliar positive duration as a value” now gives its synthetic 42-minute window a reset within those 42 minutes. Its previous weekly reset violated finding 2’s new invariant; the original assertion remains unchanged.

Checks:

- Focused suite: **27/27 passed**
- Scoped Biome lint: passed
- `git diff --check`: passed
- Only the three authorized files changed:
  - [codex-usage.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/overseer/codex-usage.ts)
  - [codex-usage.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tests/codex-usage.test.ts)
  - [wire.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/wire.ts)

Not checked: `npm test`, `npm run typecheck`, network, or a live app-server, per the sandbox instructions.

Stage 3 must preserve the two new bucket fields. Stage 4 should display values above 100 unchanged while clamping only the progress-bar width.

One baseline discrepancy: the clean checkout actually started at `ee7c2b9e`; `f801be5c` is its parent, followed by the committed review/brief. The working diff nevertheless contains only this task’s three files. No commit was made.
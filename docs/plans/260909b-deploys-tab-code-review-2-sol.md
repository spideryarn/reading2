No P0s. The identity and ancestry mechanics are fixed, but the corrupt-line and “cache-behind” fixes still make claims their evidence cannot support.

## P1

1. **F1 — The corrupt-newest-line fix still renders false header explanations. Established.**

   The route converts both an empty record and a corrupt newest line to `snapshot(null)` at [routes-deploys.ts:166](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/routes-deploys.ts:166). The probe therefore says “the record names no deploy to measure from” at [git-probe.ts:263](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/git-probe.ts:263), even when it does name surviving deploys and the real problem is that the newest line is unreadable.

   It also still reports `lastGeneratedAt(read)` from an older surviving line at [routes-deploys.ts:177](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/routes-deploys.ts:177), which the panel renders as “The record was last written…” at [DeploysPanel.tsx:124](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/DeploysPanel.tsx:124). Once the newest line is unreadable, that time is only the newest readable timestamp, not necessarily when the record was last written.

   The Git distance itself is successfully suppressed, but the fix collapses two different absence states and leaves another stale-header claim intact. Pass a discriminated watermark reason, and relabel or withhold the generation time when its maximum is unknowable.

2. **F2 — `cache-behind` is an ancestry relation, not proof that nothing is wrong. Established.**

   If cached main is `M` and recorded deploy `D` descends from `M`, the code classifies it as `cache-behind` at [git-probe.ts:339](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/git-probe.ts:339). That same graph can mean:

   - the checkout is merely stale;
   - `D` was deployed from an unpushed working branch;
   - main was subsequently rolled back to `M`.

   Yet the panel says the checkout “has not fetched since” and “Nothing is wrong” at [DeploysPanel.tsx:178](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/DeploysPanel.tsx:178). Neither conclusion follows from ancestry alone.

   The four mechanical arms are exhaustive and correctly assigned. Rename this arm to something factual such as `record-ahead`, and say it *usually* means the cached ref is stale.

3. **F3 — The count tooltip still asserts knowledge the route explicitly lacks. Established.**

   `BEHIND_TIP` says “some of these shipped and some did not” at [DeploysPanel.tsx:70](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/DeploysPanel.tsx:70). All may have shipped, or none may have shipped; with a count of zero the sentence is especially plainly false. The visible copy correctly says “Some may already have deployed.” The tooltip should use the same uncertainty.

4. **F4 — The timezone formatter creates substantial work on every one-second tick. Reasoned.**

   Every `DeployCard` calls `deployWhen()` during render at [DeploysPanel.tsx:245](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/DeploysPanel.tsx:245), and `zonedLine()` constructs three `Intl.DateTimeFormat` instances each time at [zones.ts:155](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/zones.ts:155). The page rerenders once per second to update ages.

   Measured here:

   - 70 deploys: roughly 46–64 ms per render;
   - 200 deploys: roughly 110–126 ms per render.

   That is likely visible as recurring phone jank and battery use. The formatted absolute timestamp is immutable: memoize it per card, or cache formatters/results.

## P2

- **F5 — “Show more” now fails at 200 instead of 60.** Once `total > 200`, the button remains because `more > 0`, but [DeploysPanel.tsx:395](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/DeploysPanel.tsx:395) cannot increase the limit, so subsequent presses do nothing. The current record has 74 lines, so this is not wrong today. Hide the button at the cap and state the truncation, or add real pagination.

- **F6 — The 8-second budget is soft, not a ceiling.** The arithmetic is now sound for normal Git: approximately 2.5 s for `log`, 2.5 s for `rev-parse`, and 2.5 s for the parallel final phase—about 7.5 s. But [git-probe.ts:248](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/git-probe.ts:248) only passes the remaining time to the runner; it does not enforce it. Filesystem `stat`, event-loop delay, clock rollback, or a runner that ignores its timeout can exceed eight seconds. The new 1 ms test itself waits roughly 20 ms at [fleet-deploys-route.test.ts:444](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tests/fleet-deploys-route.test.ts:444). The original 20-second aggregate defect is fixed, but the comments and tests overstate the guarantee.

- **F7 — The single-`rev-parse` rewrite resolves relative paths against the wrong directory.** [git-probe.ts:194](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/git-probe.ts:194) uses `path.resolve(line)`, whereas Git’s relative output is relative to `repoRoot`. It should remain `path.resolve(repoRoot, line)`. Production’s systemd cwd happens to equal `repoRoot`, but alternate launch directories and ordinary throwaway repositories silently lose `lastFetchAtMs`.

- **F8 — The client parser remains mostly a cast.** After checking schema, kind and `versions`, [deploys-client.ts:82](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/deploys-client.ts:82) trusts `git`, `servedAtMs`, `newestLineRead`, counts, and every version. Missing `git` crashes rendering; missing `servedAtMs` can produce `NaNd ago`; an older schema-1 response missing `newestLineRead` produces a false corruption warning. The “schema before either arm” change is real, but it does not fix the broader parser finding.

## P3

- Comments still say the header shows “where production’s tip actually is” at [DeploysPanel.tsx:12](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/DeploysPanel.tsx:12), and describe the cached ref as “production’s tip” at [wire.ts:1853](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/wire.ts:1853). The rendered main line is now appropriately qualified as cached; these comments should match it.

## Direct verdicts

| Fix | Verdict |
|---|---|
| Stable API identity | Real. Both defaults use the module singleton; no missed factory call site. |
| Four-way ancestry/count | Mechanics real; `cache-behind` interpretation and some copy are not. |
| Eight-second budget | Original arithmetic fixed; not a literal wall-clock ceiling. |
| Corrupt newest line | Detection is correct for blank lines and trailing newlines; downstream handling is incomplete. |
| `.catch`/`destroy()` | Correct here. Once headers are sent, retrying or changing to a 500 is unsafe; destroying makes truncation visible as failure. |
| `agoFrom` bound | `±8.64e15` inclusive is correct. Other owned `Date` paths guard invalid values; malformed `nowMs` remains exposed through the weak payload parser. |
| One-key single flight | Acceptable under the append-only, monotonic-watermark contract. `A → B → A` requires rewriting/reverting the record. |
| `zonedLine` | Civil-time output is correct; repeated formatter construction is the problem. |

Verification: 480 focused tests passed, all four TypeScript projects passed through the underlying typecheck script, and the fleet production build succeeded to a temporary output directory. No files were changed.
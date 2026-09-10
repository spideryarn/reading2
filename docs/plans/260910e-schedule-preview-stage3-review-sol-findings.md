# Schedule preview Stage 3 review findings

Review target: `27310eb3..b623a503` (Stages 2–3), branch `worktree-schedule-preview`.

Status: complete. The committed candidate should not be accepted unchanged because F4–F7 are established P1s. This review fixed all four red-first in the working tree. With those fixes included, I found no remaining P0/P1 and would accept Stages 2–3. F8 is a non-blocking P3 documentation correction.

The proposed contract is not literally accurate as written: its claim that the preview reflects “the documents as they were at that tick” omits the deliberate load-time treatment of rule source files (F8). With that sentence qualified as described in F8, and with F4–F7's working-tree fixes, the implementation meets the substantive contract reviewed here.

## Findings

### F4 — P1, established and fixed: the browser presents another daemon instance's preview without saying so

(a) Render `OverseerPanel` with a published current checkpoint whose readable heartbeat has instance id `section-current-instance`, while the injected schedule API returns a preview written by `section-fixture-instance`. The schedule section prints the old preview's headline and merely labels it `by daemon instance section-fixture-instance`; unlike `overseer status`, it never says that this is another daemon instance's file. A stale `schedule.json` surviving a restart can therefore put the previous daemon's OFF/ARMED answer under the current daemon's status card without the required warning. Red-first command: `npx vitest run tests/fleet-schedule-preview-section.test.tsx` — exit 1, 1 failed / 19 passed; the expected `[data-slot="schedule-instance-mismatch"]` did not exist.

(b) Smallest closing change, applied: pass the readable current heartbeat instance from `OverseerPanel` into `SchedulePreview`, compare it with `preview.instanceId`, and put an explicit `FROM ANOTHER DAEMON INSTANCE` warning before the preview's headline/content when they differ. The component-level reproducer targets that visible warning rather than tooltip text.

### F5 — P1, established and fixed: the CLI calls an unknown current instance “another daemon instance”

(a) Call `schedulePreviewLines()` for a readable preview with `{ runningInstanceId: null }`, which is exactly what `overseer status` supplies when `readCheckpoint()` returns absent, unreadable, or unsupported. The first line prepends `FROM ANOTHER DAEMON INSTANCE` because it tests `null !== preview.instanceId`. With no readable current checkpoint, there is no evidence of another instance; the detailed list line correctly says it cannot tell, so the CLI contradicts itself and calls one absence by another name. Red-first command: `npx vitest run tests/overseer-schedule-preview.test.ts -t "no readable current checkpoint is not called another daemon instance"` — exit 1; the first line was `schedule    FROM ANOTHER DAEMON INSTANCE, ARMED …`.

(b) Smallest closing change, applied: reserve `FROM ANOTHER DAEMON INSTANCE` for a non-null current instance id that differs. Keep the existing following line that says there is no readable current checkpoint. The direct `schedulePreviewLines()` reproducer was added first.

### F6 — P1, established and fixed: duplicate-id rows can show another definition's documents and fingerprint

(a) Give `schedulePreview()` two session definitions with the same id but different document paths, using `resolveEvidence()` over both. The planner correctly refuses both as `duplicate-id`, but `DocumentEvidence` is keyed only by job id and `resolveEvidence()` skips the second definition. `rowOf()` nevertheless recomputes each row's document/fingerprint details through that shared evidence. The second row consequently says its own document is absent and that it currently leans on the first definition's never-pinned document. This is not the loaded definition the row purports to display. Red-first command: `npx vitest run tests/overseer-schedule-preview.test.ts -t "a duplicate id: both definitions refused"` — exit 1; the second row returned two changed documents (its own as `absent`, the first row's as `not-pinned`) instead of its own unchanged current document.

(b) Smallest closing change, applied: key resolved production evidence by each distinct loaded definition's behaviour fingerprint, not only by id, while retaining the plain-id override used by explicit callers/tests. Read each differing duplicate definition's documents for the preview even though the planner refuses before authorisation. The pure preview reproducer was added first and the duplicate launch refusal remains unchanged.

### F7 — P1, established and fixed: the bounded route follows `schedule.json` outside the store

(a) Put a valid preview in one temporary directory and make another store's `schedule.json` a symlink to it. `readScheduleFile(secondStore)` follows the link and returns `{ kind: "read" }`, so the route serves bytes that are not the one file in the Overseer store. The same unrestricted open admits FIFOs and device files, whose `fstat().size` is not a bound on what `readFileSync()` can read or how long opening/reading can block. Red-first command: `npx vitest run tests/fleet-schedule-route.test.ts -t "does not follow schedule.json outside the store"` — exit 1; expected `unreadable`, received `read`.

(b) Smallest closing change, applied: open with the platform's no-follow and non-blocking flags, then require `fstat(fd).isFile()` before applying the size bound and reading. Return the existing explicit unreadable arm for symlinks and non-regular files. The real symlink reproducer was added first.

### F8 — P3, established: the stated contract says every document is read at the tick, but rule sources are deliberately load-time evidence

(a) Run the shipped rule definitions through `schedulePreview()` and inspect their document readings. The result labels `tools/overseer/rules.ts`, `rule-work.ts`, and `rule-protocol.ts` as `when-loaded`, because those rows describe the code this process is actually executing. The review prompt's proposed contract says “the documents as they were at that tick”, and the candidate edit to `docs/project/overseer.md` says without qualification that “The documents are re-read on every tick.” Both are false for rule jobs. Demonstrating command: `node --import tsx --input-type=module -e '<build one shipped rule preview and print document.current.when>'` — exit 0, all three readings were `when-loaded`.

(b) Smallest closing change: qualify both prose statements as “session-job documents as they were at that tick; rule-job source digests as loaded.” No scheduler change: re-reading rule source would compare disk bytes with code the process is no longer executing and would be the wrong behavior.

## Suspicions checked without findings

- The changed-document UI assertion reaches the visible row (`data-slot="schedule-document"`); the tooltip's screen-reader-only clone is not what makes it pass.
- `SchedulePreview`'s 60-second interval exists only while `OverseerPanel` is mounted. The app conditionally mounts that panel only for the active Overseer tab, so changing tabs unmounts it and clears the interval.
- The 390px static layout path has `min-w-0` containers plus wrapping/breaking on prompt, paths, hashes, drift, and changed-document text. I found no unbroken content path that forces page-width overflow. No browser or dashboard process was started, as required.

## Verification

- Exact permitted suite: `npx vitest run tests/fleet-schedule-route.test.ts tests/fleet-schedule-preview-section.test.tsx tests/fleet-schedule-parse.test.ts tests/fleet-zones.test.ts tests/overseer-schedule-preview.test.ts tests/overseer-daemon.test.ts tests/fleet-imports.test.ts tests/fleet-compile-guards.test.ts` — exit 0, 8 files / 182 tests passed.
- Focused planner regression suite: `npx vitest run tests/overseer-schedule-plan.test.ts tests/overseer-schedule-preview.test.ts` — exit 0, 2 files / 74 tests passed.
- `npm run build:fleet` — exit 0, 1,896 modules transformed; only Vite's existing chunk-size advisory.
- `node --import tsx scripts/typecheck.ts` — exit 0; all four TypeScript projects passed and all 1,977 source files are covered.
- Focused `npx biome lint` over the nine changed source/test files — exit 0; no errors, one pre-existing optional-chain warning in `tools/overseer/daemon.ts`, and informational diagnostics.
- `git diff --check` — exit 0.

No daemon or dashboard process was started, signalled, or reconfigured. Nothing under `~/.overseer` was written. No commit was made.

## Files changed by this review

- `docs/plans/260910e-schedule-preview-stage3-review-sol-findings.md`
- `tests/fleet-schedule-preview-section.test.tsx`
- `tests/fleet-schedule-route.test.ts`
- `tests/overseer-schedule-preview.test.ts`
- `tools/fleet/routes-schedule.ts`
- `tools/fleet/web/src/OverseerPanel.tsx`
- `tools/fleet/web/src/SchedulePreview.tsx`
- `tools/overseer/daemon.ts`
- `tools/overseer/schedule-plan.ts`
- `tools/overseer/schedule-preview.ts`

The separately modified `docs/plans/260910e-schedule-preview-stage3-review-sol-prompt.md` pre-dated this review and was not changed by it.

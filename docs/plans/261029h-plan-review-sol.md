I found two serious issues. No path from reload, pasted/restored URLs, Back/Forward, visitors, view-as, the OFF press, or the already-on narrow-window swap would start `situate`.

### Findings

**MARGIN-1 — P1 — Marginalia and Where it sits can create two POSTs and two jobs**

Evidence:

- The plan gives each surface a separate target: [261029h…md:42](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/docs/plans/261029h-the-margin-button-starts-the-literature-search.md:42).
- The once-per-tab guard is keyed by that target: [useAutoRun.ts:191](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/useAutoRun.ts:191), [jobEngine.ts:1002](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/jobEngine.ts:1002).
- Where it sits independently branches on its two reads: [useWhereAutoRun.ts:53](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/useWhereAutoRun.ts:53).
- Job identity includes the exact step list: [jobs.ts:4029](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/jobs.ts:4029), [store/jobs.ts:90](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/store/jobs.ts:90).

Concrete race:

1. Marginalia observes Bibliography and Situate as `none`, posting `[bibliography, situate]`.
2. Bibliography is published before Situate finishes.
3. Where it sits mounts and revalidates Bibliography, observing `ready`; its Situate read still says `none`.
4. Its distinct target permits another automatic attempt, posting `[situate]`.
5. The different step lists have different work keys, so they can become two job rows.

The second unforced Situate step should normally skip after the first publishes, so this is not necessarily two paid searches. It is still two POSTs, two jobs, and a broken single-operation invariant.

Concrete fix: keep separate activation targets—the plan is right that token ownership requires that—but add a shared, temporary “Situate is active/starting” gate. Both adapters should treat `situate.starting || situate.job !== null` as `loading`. Do not use one permanent shared `beginAutoAttempt` key: that would prevent a legitimate Sources press after a failed Marginalia attempt. Add a test that opens the two surfaces in both orders, including Bibliography changing from `none` to `ready`, and asserts one POST/job.

**MARGIN-2 — P1 — Bibliography failure has no recovery path**

Evidence:

- The plan passes only `owner.bibliography.status`: [261029h…md:50](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/docs/plans/261029h-the-margin-button-starts-the-literature-search.md:50).
- `useAutoRun` treats `error` as unanswered and invokes the one supplied reread callback: [useAutoRun.ts:175](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/useAutoRun.ts:175).
- Where it sits explicitly retries either failed read: [useWhereAutoRun.ts:64](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/useWhereAutoRun.ts:64).
- Bibliography already exposes `retryRead`: [useBibliography.ts:221](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/useBibliography.ts:221).

With status alone, the implementation must either:

- hold forever on a Bibliography error, so the press never spends; or
- treat the error like “Bibliography is present” and run a permanently poorer search.

Concrete fix: pass `{status, retryRead}` from the Bibliography read. Compose the status so a stored Situate dossier wins immediately, but `situate:none + bibliography:error` becomes `error`; the reread callback retries whichever read failed. Test Bibliography error → retry returns `none` and `ready`.

**MARGIN-3 — P2 — Full `useSituate` adds permanent idle polling and can duplicate the completion refresh**

Evidence:

- The plan replaces the quiet read with full `useSituate`: [261029h…md:50](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/docs/plans/261029h-the-margin-button-starts-the-literature-search.md:50).
- Full `useSituate` subscribes with `"watches-queue"`: [useSituate.ts:162](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/useSituate.ts:162).
- That cadence polls every eight seconds while mounted: [useStepJob.ts:459](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/useStepJob.ts:459).
- The existing margin feed also has its own completion listener. Keeping it after switching hooks duplicates refreshes; full `useSituate` already refreshes through `useStepJob`.

Concrete fix: let `useSituate` accept a cadence, defaulting to `"watches-queue"`, and use `"quiet"` in Marginalia. Starting a job already wakes the engine, so it will still be driven and observed. Remove Marginalia’s separate `useStepFinished(slug, "situate", …)` when adopting the full hook.

**MARGIN-4 — P2 — The plan omits required exhaustive/test updates**

Required enumerations:

- `modeStep` explicitly excludes every non-step target, so it must also exclude `margin-literature`: [activation.ts:426](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/activation.ts:426).
- `EVERY_TARGET: Record<AutoRunTarget, true>` needs a row: [every-mode-draws-its-surface.test.tsx:820](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/tests/every-mode-draws-its-surface.test.tsx:820).

Required expectation changes:

- The full money sweep still expects Marginalia to post only `relations`: [every-mode-draws-its-surface.test.tsx:1306](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/tests/every-mode-draws-its-surface.test.tsx:1306). Its harness must support two separate jobs and expect `relations` plus the ordered Situate job.
- The second-press suite says turning Marginalia on starts one job: [a-second-press-closes-the-mode.test.tsx:460](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/tests/a-second-press-closes-the-mode.test.tsx:460).

Also add integrated `useActivateMode` cases for the OFF press, command-bar selection while already on, and the already-on narrow swap. A test that directly calls `armActivationForMode` bypasses the exact gate under review.

### Non-press audit

The literature search is safe on the requested paths:

- `marginOn` suppresses both the OFF press and command-bar/already-on cases: [Dock.tsx:1875](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/Dock.tsx:1875).
- Back/Forward and URL restoration call no activator: [Reader.tsx:4583](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/reader/Reader.tsx:4583).
- Visitors do not mount `OwnerMarginFeed`: [Reader.tsx:4555](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/reader/Reader.tsx:4555).
- View-as exits before claiming/spending: [useAutoRun.ts:158](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/useAutoRun.ts:158).
- `enabled=false` consumes and drops a narrow-window token: [useAutoRun.ts:167](/var/tmp/spideryarn-worktrees/sxfwqq-margin-starts-sources/src/web/useAutoRun.ts:167).

Marginalia’s separate `relations` job still intentionally runs on arrival; the statements above concern `situate`.

### Simpler option

Passing over the direct POST without Bibliography is the right call. It would create a permanently poorer dossier whenever Bibliography was missing. Keep the ordered Bibliography-first behavior and separate activation token, but add the shared active-job gate and the Bibliography retry seam above.

Read-only review; I changed no files.
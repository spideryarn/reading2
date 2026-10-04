Reviewed against `ab8289e2a`; no files changed. **The revised hold still has two P1 gaps.**

F2’s original interleaving is addressed. F4, F5, F7 and F8 are closed at plan level. F3 remains incomplete; F6 corrects ownership but specifies an unsafe Sketch identity fallback.

1. **F9 — P1: remounting during the POST can release the hold before the job starts.** Stage 2a persists the identity, but `starting` and `startedId` remain mount-local in [useStepJob.ts:565](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c5-failed-read/src/web/useStepJob.ts:565). A reachable sequence is:

   - The engine has a loaded, idle job list.
   - Regenerate records the hold and sends a POST that remains pending.
   - The reader closes and reopens the band. Its new `useStepJob` has `starting === false`; the shared list still looks idle.
   - Rule 3 starts a GET. It returns the unchanged artefact before the POST creates its job, and releases the hold.
   - The job subsequently finishes; its replacement read fails. The old artefact now offers another paid rewrite.

   [useJobs.ts:366](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c5-failed-read/src/web/useJobs.ts:366) informs the engine only after the action settles. A GET started after observing an idle **snapshot** therefore does not establish that this rewrite ended. Persist the pending submission and its returned job identity alongside the hold; require evidence that this attempt ended before applying rule 3. Test the delayed-POST remount sequence.

2. **F10 — P1: a cached 200 can strand the mounted band indefinitely without recovery.** Rejecting a cached copy as release evidence is correct, but the hooks still treat it as successful content and clear `error`—for example, [useSimple.ts:88](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c5-failed-read/src/web/useSimple.ts:88). Its retry control is drawn only when there is an error ([SimplePanel.tsx:123](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c5-failed-read/src/web/SimplePanel.tsx:123)).

   Let the job finish, then answer both completion’s refresh and the new idle refresh with cached copies. The hold remains, but there is no *Try again*. Restore connectivity: later job polls do not announce the same completion again ([jobEngine.ts:593](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c5-failed-read/src/web/jobEngine.ts:593)), and [offline.ts:88](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c5-failed-read/src/web/offline.ts:88) does not trigger an artefact re-read. The band stays held until another action causes a read, or the reader leaves/reloads.

   Specify a visible read-only recovery control while held on a cached copy, or an explicit reconnect revalidation. Extend the cached-copy test through reconnection and successful recovery; “still held” alone tests only half the requirement.

3. **F11 — P2: the full-reload justification is false.** The plan says that when the opening GET returns a cached copy, the POST cannot reach the server either. [api.ts:714](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c5-failed-read/src/web/lib/api.ts:714) establishes only that **that GET** failed and had a saved copy. Connectivity can recover before the next click. Forgetting the hold on full reload can remain an accepted limitation, but describe it as accepting possible duplicate generation after reload.

4. **F12 — P2: fingerprinting Sketch’s whole response does not identify its artefact.** The fallback names the response body, but [SketchResponse](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c5-failed-read/src/types.ts:1479) includes `stale`, `outdated` and `profileChanged`. Those can change without a job replacing the picture, falsely satisfying release rule 1. Fingerprint the stored `sketch` value, excluding response metadata and client validation changes.

**F1’s overrule is sound.** [useAutoRun.ts:47](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c5-failed-read/src/web/useAutoRun.ts:47) explicitly retains the press through a failed read and spends it when a later answer establishes absence. Thread’s arrival permission is likewise documented. I withdraw F1’s P1 classification: the false “no POST” invariant needed correction, but suppressing the retained permission would change the documented behavior. The revised retry-to-404 tests capture that distinction.

REFUSE
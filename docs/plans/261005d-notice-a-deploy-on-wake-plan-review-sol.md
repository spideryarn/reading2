The watcher is useful, but the proposed navigation rule would discard reader drafts and interrupt uploads. “Different path” is not a reliable test for whether a full load is safe.

Reviewed against `12415baa2dc8f715332b1f41350d699cc2a7a933`. I made no edits. I ran two in-memory probes of the existing reload guard and Vite’s development injection code; I did not build the candidate or run an iPad reproduction.

1. **F1 — P0, established: full loads discard drafts that survive navigation today.**

   [chat-draft.ts:127](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/chat-draft.ts:127) keeps unsent Chat and Remember text in a module `Map`, explicitly without persistence. Reader → Metadata changes pathname—for example through [Dock.tsx:1577](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/Dock.tsx:1577)—while preserving that map today. `location.assign()` discards it. Returning to the article then finds an empty composer.

   Feedback has the same problem independently. [FeedbackButton.tsx:169](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/FeedbackButton.tsx:169) deliberately preserves its dialog across page changes; [FeedbackDialog.tsx:373](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/FeedbackDialog.tsx:373) holds report text and screenshots only in React state. Dismissing the dialog retains the draft. **Both an intercepted navigation and an automatic `/changelog` refresh can delete it.**

   Preserve this state across loads, or defer automatic loads while it exists. Protecting only the current page’s visible form is insufficient.

2. **F2 — P1, established: the PDF Add transition happens before its upload finishes.**

   [UploadPicker.tsx:251](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/UploadPicker.tsx:251) awaits `uploadEngine.send()` and immediately navigates to `/add/upload/<id>`. But [uploadEngine.ts:465](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/uploadEngine.ts:465) deliberately starts the byte transfer without awaiting it: `send()` returns once the grant exists. The file, grant and retry state remain in memory.

   With a deploy already noticed, the proposed rule turns this normal Add operation into an unload during transfer. The existing leave warning may prompt or fail to prevent it; neither provides the promised seamless transition.

   [batchUpload.ts:596](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/batchUpload.ts:596) also retains waiting files in memory. Uploads continue across SPA navigation, so excluding `/add/...` as a **source** would not solve this. Protection must cover background uploads wherever the reader currently is.

3. **F3 — P0, reasoned: automatic unloading reintroduces an older-save-overwrites-newer-save race.**

   [useAutosavedText.ts:261](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/useAutosavedText.ts:261) handles SPA unmount by waiting for an older ordinary save before sending the latest draft. Its `pagehide` handler instead sends immediately. [autosaved-text.test.tsx:234](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/tests/autosaved-text.test.tsx:234) explicitly tests why the ordering matters.

   Concrete sequence: save text A; type text B while A is pending; navigate; B’s unload save reaches the server first; A is applied afterward. The server ends with A. The proposed load substitutes this weaker exit path for today’s ordered unmount.

   `assign()` does **not inherently cancel an already-started valid `keepalive` request**; those requests may outlive the document. The concern here is ordering with the ordinary request, plus the loss of callbacks that would send queued work. [Fetch Standard](https://fetch.spec.whatwg.org/#http-network-or-cache-fetch)

   Keep SPA navigation while these saves are pending, or settle them before unloading.

4. **F4 — P1, established: the offline guard misses an offline state the app already knows about.**

   [offline.ts:50](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/offline.ts:50) records `connected: false` when a transport failure causes a cached response. [lib/api.ts:715](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/lib/api.ts:715) actually uses that path.

   Sequence: notice B; lose server access while `navigator.onLine` remains true; read a cached article; navigate to another cached article. The plan chooses a full load and replaces a working offline app with a browser error.

   Use the shared connectivity fact as an additional veto. An old successful build check cannot establish present connectivity. This should protect changelog reloads too.

5. **F5 — P1, reasoned: stopping permanently after the first mismatch breaks recovery.**

   The watcher’s premise—“the answer cannot become ‘no’ again”—is false after a rollback to the running build. More consequentially, a mismatch can remain unresolved:

   ```
   shell A → notice B → reload attempt → cached shell A
                                       → B note already spent
                                       → watcher stops forever
   ```

   A later C deployment will never be noticed. There is another failure if the changelog subscriber calls `reloadIfStale()`, its second check fails, and the watcher has already stopped: no retry is scheduled.

   Distinguish **having observed a mismatch** from **having completed an update**. Continue visible checks when the document remains on the old build, while suppressing repeat reload attempts.

6. **F6 — P1, established: the existing note is “last build attempted,” not “once per build.”**

   [stale-shell.ts:168](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/stale-shell.ts:168) stores one identity and overwrites it. Holding shell A constant, my probe produced:

   | `/build.json` answer | Reload allowed |
   |---|---|
   | B | Yes |
   | B | No |
   | C | Yes |
   | B | Yes |
   | C | Yes |
   | B | Yes |

   Thus alternating stale answers can produce repeated automatic changelog reloads if each load returns shell A. This disproves the requested guarantee under arbitrary shell/build-file disagreement.

   **If a lazy-route reload already spent B’s note, a changelog reload for B is correctly refused.** That case is loop-free, but freshness is not guaranteed. Do not clear the note to make it retry. Share a guard that remembers attempted identities across reloads, rather than only the most recent identity.

7. **F7 — P1, established: “dev has no stamp” is false with the installed Vite.**

   [vite.config.ts:456](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/vite.config.ts:456) supplies the defines without restricting them to builds. Vite’s development client installs those values on `globalThis`: [env.mjs:8](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/node_modules/vite/dist/client/env.mjs:8). Its client injection plugin supplies them from `config.define`.

   Using that installed injection code, `buildIdentity(buildCommit(), buildTime())` changed from `null` to a valid identity. Checking the untransformed module alone misses this.

   Consequently, a null-stamp gate does not ensure “nothing happens in dev.” Add an explicit build-only gate and verify it against actual Vite development behavior.

8. **F8 — P1, established: `replace: true` does not identify an automatic redirect.**

   Path-changing replacements include explicit reader actions: “not now” in [SetNewPassword.tsx:125](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/SetNewPassword.tsx:125), and “go to your shelf/back to sign-in” in [AuthCallback.tsx:280](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/AuthCallback.tsx:280). These miss a refresh opportunity when unloading is otherwise safe.

   Conversely, admitting all replacements is unsafe: [AddPage.tsx:182](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/AddPage.tsx:182) starts `highPower.settle()` without awaiting it immediately before its replacement navigation.

   Decide unload safety separately from history semantics. An eligible replacement should use `location.replace()`, preserving the intended Back behavior.

9. **F9 — P1, reasoned: subscription and wake behavior need explicit rules.**

   A one-time notification can occur while `/changelog` is still loading through `LazyPage`, before its subscriber exists. If the watcher then stops, the mounted page misses the update. Subscribe **and examine the current snapshot on mount**.

   Also specify that every request entry point checks current visibility, and that reload eligibility is checked again after asynchronous work. A request begun visibly can finish hidden. `reloadIfStale()` protects against an address change after invocation; it does not itself verify visibility or that the invocation began on `/changelog`.

   For timers: check immediately on visible installation; cancel the timer while hidden; rearm after failed/timed-out checks; deduplicate wake events; handle `pageshow` with a visibility guard. `pageshow` can occur for initial loads, frozen-page restoration and background pages—it does not mean “visible.” iOS suspension and timer throttling also mean 15 minutes is an approximate cadence. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event), [WebKit](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)

10. **F10 — P1, established: the proposed tests would approve the unsafe rule.**

    The router cases establish that a mismatch causes a load; they do not establish that unloading preserves reader work. The existing upload integration test even mocks `navigate()` in [add-does-not-wait-for-the-upload.test.tsx:58](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/tests/add-does-not-wait-for-the-upload.test.tsx:58), so it cannot catch the new behavior.

    Add cases that can fail for: a held upload and waiting batch; retained Chat/Remember and dismissed Feedback drafts; an older save pending behind newer text; `connected:false` with `onLine:true`; notice-before-subscription; notice-then-hidden; timeout recovery; a spent lazy-route note; alternating B/C answers across document recreation; and actual development startup.

    “Second notice does not reload” within one component instance is insufficient evidence for a guard whose purpose is to survive document replacement.

11. **F11 — P2, reasoned: the two-build script can be real evidence, but its contract is incomplete.**

    Building the same commit twice is legitimate: build time participates in identity and compiled output. Require the script to assert different identities, a real new-document navigation, and build B’s **running client** stamp—not merely a changed URL or B’s `/build.json`.

    For lazy-route recovery, prove the requested A asset is absent from B and receives production’s HTML fallback. Withhold the watcher’s check selectively while allowing the recovery check; blocking every `/build.json` request defeats the fallback itself. Demonstrate that disabling each mechanism makes its corresponding assertion fail.

    WebKit with an iPad user agent tests the engine and stale-build transition. It does not establish installed-iOS suspension behavior. The preceding plan already acknowledges that limitation.

A few important negatives: durable queued/running jobs resume from the first server list ([jobEngine.ts:656](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/jobEngine.ts:656)); auth-return state uses `sessionStorage`; same-path jumps retain the existing history machinery. I found no established loss of an already accepted Chat answer or a concrete unsafe external destination.

I recommend reducing v1 to the watcher and a `/changelog` refresh that preserves or defers around drafts, pending saves and uploads, retaining existing lazy-route recovery. Postpone general navigation interception until the app can determine whether unloading is safe. The pathname rule makes that second feature look substantially simpler than it is.

**Verdict: build it with changes.**
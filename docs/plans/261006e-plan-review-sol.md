**Do not implement this plan unchanged.** Its “Done looks like” claim is false: the gate resets local state, but several requests can still cross accounts.

1. **F1 — P1, established: an already-started add POST can import as B without B pressing.**

   **(a)** A mounts the page and starts `queue.add(url)`. Its token lookup waits; the session changes to B; the lookup returns B’s session. The POST then leaves with B’s token, even if the gate has already removed A’s page. Alternatively, A’s POST receives 401 and refresh returns B’s credential.

   The path is [AddPage.tsx:729](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/web/AddPage.tsx:729) → [useJobs.ts:409](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/web/useJobs.ts:409) → ordinary `apiFetch`. The epoch in `act` fences effects **after** the request; it does not fence the send. [api.ts:546](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/web/lib/api.ts:546) explicitly permits a refreshed owner to differ. A URL import reserves a slot for the credential’s owner at [routes.ts:11036](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/routes.ts:11036).

   Both outgoing-request sequences reproduced in the local probe.

   **(b) Add this wording:**

   > The add POST and every Retry are bound to the reader who initiated them. Pass that immutable reader through `useJobs` to the credential attachment point, and reject a different owner on both the initial send and the 401 retry. Removing the page or fencing its response is insufficient. Test an unanswered token lookup and an unanswered 401 refresh across A→B.

2. **F2 — P1, established: the sharing controllers are scoped for display, but their requests are not scoped for sending.**

   **(a)** A confirms *Make it public*. The visibility PUT waits for credentials. B signs in and A’s controller retires. The pending PUT subsequently obtains B’s token and publishes **B’s article under that slug**, using A’s confirmation.

   [sharingIo:251](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/web/AddPage.tsx:251) uses `readerId` for storage marks, but its probe, visibility PUT and private-link operations all call ordinary `apiFetch`. [ShareAtAdd.retire:255](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/web/add-share.ts:255) cannot cancel the credential lookup already owned by `apiFetch`. The probe reproduced a pending visibility PUT leaving with B’s token.

   The literal “no request about A’s article” promise also includes upload-arrival polling, upload queueing and job advances. Their existing response/generation fences do not prevent a pending credential lookup or 401 retry from sending as B.

   **(b) Replace the scope exclusion with:**

   > The existing sharing registries protect displayed state, not outgoing credentials. Fence every sharing operation with its captured reader. Apply the same send-time ownership check to upload-arrival reads, upload queue requests and job advances originating in the old reader’s session. Audit the auto-modes setting separately: its abort signal protects session teardown, but its requests also need their initiating reader attached.

3. **F3 — P1, established: excluding A→null→B contradicts the queue instruction.**

   **(a)** A is adding a URL. Sign-out unmounts the gate; B signs in at the unchanged address; a fresh gate treats B as its initial reader and posts automatically. This is exactly the behaviour the plan explicitly preserves at lines 86–89.

   The queue instruction says “on a reader change” and “no spend without B’s own gesture”; it does not grant an exception for an intervening signed-out state. App’s unmounting behaviour is correctly described, but it is the reason a page-local gate cannot cover this sequence.

   **(b) Replace that exclusion with:**

   > Preserve the add visit’s authorization across signed-out renders, above App’s authentication branch. A→null→B requires B’s own Add press just as A→B does. Initial arrival by B remains distinct from an add visit previously authorized by A. Test this through the real App mounting path.

4. **F4 — P1, established: B’s fresh purpose session can wait indefinitely behind A’s save.**

   **(a)** A has an unanswered purpose PATCH for slug S. Switching readers retires A’s session, whose retirement waits for that PATCH. B presses *Add it to this account* and receives their own article under S.

   [retiringPurposes:368](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/web/AddPage.tsx:368) is a module-level map keyed **only by slug**. [prospectivePurpose.activate:425](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/web/AddPage.tsx:425) therefore holds B behind A’s retirement. While that barrier is closed, [AddPurposeSession.kick:391](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/web/add-purpose.ts:391) starts neither the read nor its deadline. B’s box cannot seed or save for as long as A’s PATCH remains unanswered.

   The probe confirmed zero B reads until A’s save resolved, then confirmed B’s read proceeded.

   **(b) Add:**

   > Key retirement barriers by `(readerId, slug)`. Preserve ordering between one reader’s sessions for the same article, while allowing another reader’s session to proceed independently. Test B’s read and save while A’s PATCH remains unanswered.

5. **F5 — P1, established against the plan’s sticky-stop promise: A→B→A can revive the old High-powered intent.**

   **(a)** A ticks High-powered; its PUT receives 404 and schedules a retry. A→B→A happens before that retry fires. The old intent deliberately survives unmounting, and its expected reader is again the credential owner, A. It sends successfully without another press.

   This follows [HighPowerIntent’s retry:184](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/web/add-high-power.ts:184) and reproduced with an owner-checking `put`. It does **not** charge B, but contradicts “once the reader has changed, nothing starts until somebody presses.” The proposed A→B→A test checks only POSTs.

   **(b) Add:**

   > Reader-change retirement permanently invalidates the old High-powered intent, including a request still awaiting credentials. An owner ID matching again does not revive a retired activation. Preserve intent continuation only for ordinary navigation within the same reader activation. Test A→B→A between retry ticks and assert no old High-powered PUT follows.

6. **F6 — P1, reasoned: the replacement gate can leave A’s filename in the document.**

   **(a)** A’s upload job supplies a filename to [useDocumentTitle:1187](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/web/AddPage.tsx:1187). Once announced, that text lives in both `document.title` and a singleton live region outside React’s page subtree. [The hook’s cleanup:576](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/web/page-title.ts:576) clears only the timer.

   The plan specifies the replacement page’s visible content, but gives it no title ownership. Implemented literally, unmounting A’s page leaves those words behind. This is reasoned because the gate has not yet been written.

   **(b) Add:**

   > The blocked gate owns a generic document title and replaces the page-title live-region text. Neither may contain the previous upload’s filename. Include both in the reader-change assertions.

The credential suspicion itself did **not** produce an established finding: production `getSession()` supplies token and user together, and the cached pair is updated synchronously in one callback. A stale cached A pair sends A’s token; it does not silently become B’s. Keep the check inside credential attachment for both attempts, rather than checking `apiFetchOwned` after it sends.

The upload `mine` snapshot also need not leak on B’s first render **if the gate immediately excludes the entire inner page**. Its outgoing queue request still needs F2’s fence.

A simpler product design gets the same guarantee: after any reader change, permanently replace this add visit with a generic stopped page and *Back to the shelf*, for URLs and uploads alike. B starts a fresh add from the shelf. That removes the gate’s reauthorization/button lifecycle; the request fences and reader-scoped barriers remain necessary.

Validation: `tests/api-fetch.test.ts` passed **22/22** using `--configLoader runner`; the throwaway probe exercised the actual API and controller code with mocked auth/transport boundaries. No repository files changed.
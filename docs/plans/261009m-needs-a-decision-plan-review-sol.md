Decision 2 works for live threads after reply, defer, or bring-back, provided the pager uses raw server order rather than `threadOrder`. It is not yet sound for retained or missing threads, and the proposed status behavior has accessibility gaps.

1. **P1 — blocker: there is no defined “server-order position” for a retained thread.**

   Evidence: The plan excludes retained threads from the waiting set but says the showing thread is always inserted at its server position ([plan:36-39](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/docs/plans/261009m-needs-a-decision-pager-steps-only-through-waiting-threads.md:36)). A later GET appends retained questions after the current server response ([FeedbackEarlier.tsx:886](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/src/web/FeedbackEarlier.tsx:886)), and `EarlierThreads` explicitly puts every retained question after every live one ([FeedbackEarlier.tsx:1579](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/src/web/FeedbackEarlier.tsx:1579)). Meanwhile `threadOrder` is group order, not server order ([FeedbackEarlier.tsx:671](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/src/web/FeedbackEarlier.tsx:671)).

   This also creates a second trap: a retained question may still carry stale `state: "waiting"`, so a helper filtering `questions` by state would incorrectly count retained drafts.

   Fix: Define `pagerStops` over `liveQuestions` plus the separate showing question, never over grouped `order` or all retained questions. For a showing retained thread, either reconstruct its canonical `(asked, id)` position—the server’s ordering rule—or explicitly decide that retained threads sit at an end. Determine whether the showing thread counts using live membership plus `state`, not `state` alone. If the showing ID has no corresponding question object at all, close to contents; the current code already falls back that way ([FeedbackEarlier.tsx:1584](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/src/web/FeedbackEarlier.tsx:1584)). Add retained-waiting, absent-ID, and GET-removes-current tests.

2. **P2 — should: the planned live status will often not be announced.**

   Evidence: The plan creates `role="status"` only after a refused press ([plan:55-57](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/docs/plans/261009m-needs-a-decision-pager-steps-only-through-waiting-threads.md:55)); the proposed test explicitly expects no status node beforehand ([feedback-dialog.test.tsx:2073](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/tests/feedback-dialog.test.tsx:2073)). The project’s established accessibility rule is the opposite: a live region must already exist empty before its text changes ([AnnotateDialog.tsx:831](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/src/web/AnnotateDialog.tsx:831)).

   Fix: Always render an empty `role="status" aria-atomic="true"` region. On refusal, clear it and write the sentence in a later task so pressing the same endpoint twice is announced twice. Test its empty initial presence and repeated activation.

3. **P3 — should: “until the thread changes” leaves a false endpoint message after state or GET changes.**

   Evidence: The plan retains the refusal sentence until navigation ([plan:56-57](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/docs/plans/261009m-needs-a-decision-pager-steps-only-through-waiting-threads.md:56)). But a reply, deferral, or bring-back changes `state` without changing the shown ID ([FeedbackEarlier.tsx:649](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/src/web/FeedbackEarlier.tsx:649)), and a newer GET can replace the live set while that thread stays open ([FeedbackEarlier.tsx:685](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/src/web/FeedbackEarlier.tsx:685), [FeedbackEarlier.tsx:874](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/src/web/FeedbackEarlier.tsx:874)). “No later thread…” can therefore remain visible after a later thread appears.

   Fix: Clear the visible refusal whenever the pager signature changes: current ID, waiting IDs/order, previous ID, or next ID. Add a test where a refused endpoint is showing and an in-flight GET adds or removes a waiting thread.

4. **P4 — should: successful navigation and view replacement have no focus/announcement policy.**

   Evidence: Previous/Next replaces the question while focus remains on the same button, but neither the place nor the title is live ([FeedbackEarlier.tsx:1465](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/src/web/FeedbackEarlier.tsx:1465)). Opening a contents row unmounts the focused row, and *All threads* unmounts its own focused button ([FeedbackEarlier.tsx:1387](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/src/web/FeedbackEarlier.tsx:1387), [FeedbackEarlier.tsx:1587](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/src/web/FeedbackEarlier.tsx:1587)).

   Fix: Keep focus on Previous/Next for repeated paging, but announce “Showing {title}. {place}.” through the always-mounted live region. On entry from contents, focus the thread heading; on *All threads*, restore focus to that thread’s row. Add `document.activeElement` and announcement-contract tests.

5. **P5 — should: `title` is acceptable as a desktop-mouse fallback here, but not as the accessible explanation.**

   Evidence: `aria-disabled` is the right choice because native `disabled` loses the reliable tooltip/focus trigger ([tooltips.md:290](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/docs/project/tooltips.md:290)). But native `title` is hover-oriented and absent on touch ([tooltips.md:463](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/docs/project/tooltips.md:463)); it is also not a reliable keyboard or screen-reader description.

   Fix: Keep `title` only for sighted desktop hover if desired, and provide the unavailable reason through `aria-describedby` or a full `aria-label`. The simplest robust shape is `aria-disabled`, a guarded click, a static accessible description, and one always-mounted announcer. Available Previous/Next buttons do not need native titles if the navigation label makes “needing a decision” explicit.

6. **P6 — nit: the place wording is understandable but ambiguous.**

   Evidence: `2 of 5 to decide` can read as “two of five remain,” while `None left to decide` sounds as though a deferred open question is resolved ([plan:47-49](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/docs/plans/261009m-needs-a-decision-pager-steps-only-through-waiting-threads.md:47)).

   Fix: Prefer `2 of 5 needing a decision`; off-list threads can say `5 need a decision` or `No threads need a decision now`.

**Verdict: refuse.** The core direction is good, but decision 2 needs an explicit retained-thread ordering and live-membership contract before implementation. The accessibility fixes are then straightforward.
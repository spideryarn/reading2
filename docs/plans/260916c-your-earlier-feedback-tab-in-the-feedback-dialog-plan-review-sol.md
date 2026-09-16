I found two established P1 interaction defects, so the plan should be revised before implementation.

### Findings

**F1 — P1 — established: switching tabs can leave the microphone recording invisibly.**

The plan hides Write without closing the dialog ([plan:65](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/docs/plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md:65>)). Today recording stops only when `open` becomes false ([FeedbackDialog.tsx:643](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/web/FeedbackDialog.tsx:643>), [FeedbackDialog.tsx:657](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/web/FeedbackDialog.tsx:657>)). Selecting Earlier leaves `open` true, so the microphone and live insertion continue after their controls disappear.

Fix: the transition from Write to Earlier must stop armed dictation through `dictate.dictation.toggle()`, not the focus-restoring field wrapper. Test that an armed microphone stops and its transcript remains in the draft.

**F2 — P1 — established: Earlier still accepts screenshots into the hidden draft.**

Paste, drag-over and drop are handled on the entire dialog, outside the panel ([FeedbackDialog.tsx:813](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/web/FeedbackDialog.tsx:813>)). Hiding Write therefore does not stop an image pasted or dropped over Earlier from being processed and attached invisibly.

Fix: gate attachment processing on `view === "write"`. For drops, still prevent browser navigation, but do not call `takeFile` from Earlier. Add paste/drop tests for Earlier.

**F3 — P1 — reasoned: guarding only ⌘/Ctrl+Enter does not guard submission.**

The existing `<form>` sends unconditionally from `onSubmit` ([FeedbackDialog.tsx:859](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/web/FeedbackDialog.tsx:859>)), while the plan guards only the dialog’s keyboard shortcut ([plan:73](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/docs/plans/260916c-your-earlier-feedback-history-tab-in-the-feedback-dialog.md:73>)). Tabs, Try again and Close will sit inside that form unless it is restructured; any button missing `type="button"` defaults to submit and can file the hidden draft.

Fix: explicitly require `type="button"` on every non-Send control, and guard the form submission/send boundary as well as the keyboard handler. Test clicking every Earlier control with a populated draft and assert no POST.

**F4 — P2 — established: the route-contract update is more specific than “counts moved by one.”**

The contract permits one matcher with multiple methods ([authenticated-api-route-contract.test.ts:421](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/tests/authenticated-api-route-contract.test.ts:421>)). Two route-table rows may share a matcher only by naming the same module constant; repeating the literal creates two matcher sites and fails the uniqueness assertion ([authenticated-api-route-contract.test.ts:1211](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/tests/authenticated-api-route-contract.test.ts:1211>), [authenticated-api-route-contract.test.ts:1777](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/tests/authenticated-api-route-contract.test.ts:1777>)).

Fix: introduce `FEEDBACK_PATH`, use it for both GET and POST rows, change the contract methods to `["GET", "POST"]`, keep matcher count at 69, increase guard count from 84 to 85, and add the GET to the ordered guard list near the existing POST ([authenticated-api-route-contract.test.ts:1873](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/tests/authenticated-api-route-contract.test.ts:1873>)).

**F5 — P2 — reasoned: the focus contract is underspecified.**

The arrow-key case is safe if activation moves focus to the selected tab. Pointer activation is less dependable across browsers, and the plan does not require roving `tabIndex` or explicitly relocate focus before hiding a focused Write descendant ([plan:80](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/docs/plans/260916c-your-earlier-feedback-history-tab-in-the-feedback-dialog.md:80>)). Resetting the view after `showModal()` can also let native initial-focus selection observe the stale Earlier view; opening currently happens in a layout effect ([FeedbackDialog.tsx:417](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/web/FeedbackDialog.tsx:417>)).

Fix: use one activation function that stops dictation, selects the view, focuses its tab, and maintains `tabIndex={0/-1}`. Reset to Write while closed, so it is already the rendered view before the next `showModal()`. Assert `document.activeElement` after pointer and arrow switching.

**F6 — P2 — reasoned: the client/server DTO needs an explicit home.**

Browser code may not import `src/store/contracts.ts`; the client-import test directs shared wire shapes to `src/types.ts` ([client-imports.test.ts:1](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/tests/client-imports.test.ts:1>)). The plan adds a store result and client response but does not place their shared type.

Fix: define an independent narrow `EarlierFeedbackReport`/page DTO in `src/types.ts`. Do not derive it from `FeedbackReport` or `AdminFeedbackReport`, so adding a sensitive field elsewhere cannot widen this response automatically.

### Owner scoping and transport

I found no defence change:

- All non-public API routes pass through the single authentication gate ([routes.ts:6489](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/routes.ts:6489>)).
- The authenticated dispatcher sets the request owner from `VerifiedUser` before dispatch ([routes.ts:8899](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/routes.ts:8899>), [routes.ts:8916](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/routes.ts:8916>)).
- `currentOwnerId()` refuses a pre-gate store read rather than falling back to an environment owner ([owner.ts:237](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/owner.ts:237>)).
- Existing feedback reads use exactly the proposed owner predicate ([pg-feedback.ts:323](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/store/pg-feedback.ts:323>)).
- Production has one API function and one catch-all rewrite; verbs are not split ([vercel.json:33](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/vercel.json:33>)).
- `/api/feedback` is absent from the client’s offline-cache allowlist ([api.ts:835](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/web/lib/api.ts:835>)). Set `private, no-store` before awaiting the store, following the admin route.
- The existing `(owner_id, created_at)` index supports the bounded owner query; sorting timestamp ties by `id` over at most 51 rows does not justify another index ([schema.ts:3859](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/db/schema.ts:3859>)).

The `messages.ts` convention and doc parent are already accounted for; I found no additional doc-links or owner-isolation inventory requirement.

### Simpler version

Fetch lazily once per dialog opening, then reuse that result while switching tabs. A reader cannot file another report and return to Earlier in the same opening—the thank-you panel has no tabs—so repeated fetches within one opening buy no freshness. Clear/invalidate the result when the dialog closes and abort or generation-guard any outstanding request.

Conditional rendering is also viable: the draft, kind, consent and processed screenshot already live in component state, and the file input is cleared immediately after selection ([FeedbackDialog.tsx:987](</home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/web/FeedbackDialog.tsx:987>)). Unmounting loses DOM caret selection, not the draft or attachment. If caret preservation matters, retain hidden panels—but add F1–F3’s view-boundary guards.

VERDICT: refuse
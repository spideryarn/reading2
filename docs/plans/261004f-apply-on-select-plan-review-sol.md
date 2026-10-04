## Verdict: build with changes

The provisional-highlight product decision is reasonable, but the plan is not correct as written. No P0s; six P1s need resolving before implementation. The biggest issue is that persistence depends on event and lifecycle ordering that cannot provide the guarantees the UI claims.

### Findings

**E1 — P1 — A closed box no longer protects an unsettled create on page exit.**

Click-off closes the dialog before calling ordinary `create` ([Reader.tsx:3324](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:3324>)). That unmount removes the dialog’s `pagehide` listener ([AnnotateDialog.tsx:523](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/AnnotateDialog.tsx:523>)). The create may still be waiting for the opening read ([useComments.ts:734](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:734>)) or authentication before `fetch` starts ([api.ts:500](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/lib/api.ts:500>)).

Thus: select → see yellow → click off → leave/reload before the held request starts can lose the highlight without a crash. `pagehide` no longer knows about it.

Concrete plan change: `useComments` should retain every unsettled create’s exact input and replay it through `leavingFetch` on `pagehide`, using the same id. This durability must live above the conditional dialog. Test loaded and not-loaded creates followed by page exit.

**E2 — P1 — Tick-deferred unmount flush is only a StrictMode heuristic and races page exit.**

The proposed setup→cleanup→setup cancellation works for React StrictMode’s simulated cycle, and a keyed replacement is correctly a separate instance. The latch also works when `pagehide` wins first: `left` makes the later cleanup a no-op.

The inverse is unsafe: a real unmount removes the `pagehide` listener immediately, while the save waits for the next task. The page may freeze or disappear before that task runs.

React 19 exposes no supported “this cleanup is a real unmount” signal. It deliberately reruns Effect setup and cleanup in development, and React’s own guidance calls cleanup-only side effects a code smell. [React StrictMode](https://react.dev/reference/react/StrictMode), [React `useEffect`](https://react.dev/reference/react/useEffect).

Concrete plan change: do not make the keyed child’s cleanup authoritative. Lift the draft above it and explicitly flush before state transitions that remove/rekey it, with `pagehide` ownership above the conditional branch. Alternatively, E1’s pending-create registry must cover the delayed flush. Test real unmount immediately followed by `pagehide` without advancing timers.

**E3 — P1 — `pointerdown` makes overlap correction impossible.**

The plan stores the old draft on outside `pointerdown` ([plan:77](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261004f-selecting-applies-the-highlight-and-the-box-customises-or-removes-it.md:77>)), but the replacement anchor exists only after `mouseup` reads the completed selection ([TableView.tsx:1411](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TableView.tsx:1411>)). At save time, Reader cannot know whether this is an ordinary click-away or an overlapping correction.

The payload also lacks both facts the proposed decision needs: “untouched” and “replaced rather than closed” ([AnnotateDialog.tsx:171](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/AnnotateDialog.tsx:171>)).

Concrete plan change: preferably drop overlap correction from v1. Otherwise, do not close on prose `pointerdown`; resolve the gesture at `mouseup`, then pass an explicit exit reason, intent flag, and replacement anchor. Test drags beginning both inside and just outside the old span.

**E4 — P1 — Clearing the mouse selection immediately can follow a link after a drag.**

Current code deliberately retains the native selection ([Reader.tsx:2371](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:2371>)). The later synthesized click uses it to suppress cross-reference jumps and native/internal link navigation ([TableView.tsx:1319](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TableView.tsx:1319>), [TableView.tsx:1372](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TableView.tsx:1372>)).

If `selectProse` clears the selection during `mouseup`, the following click sees a collapsed selection and may follow the link/xref underneath the drag.

Concrete plan change: clear immediately for touch-chip entry only. For mouse, defer until after the click or add a one-shot “this click completes a selection” latch. Add link, footnote, and xref drag-ending tests.

**E5 — P1 — The claimed seamless provisional→optimistic handoff is false while `loaded` is false.**

Reader drops the box before calling `create` ([Reader.tsx:3324](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:3324>)), while `create` waits for the opening read before inserting its optimistic row ([useComments.ts:734](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:734>)). The yellow paint therefore disappears during that window.

On POST failure, the optimistic row is removed ([useComments.ts:782](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:782>)); `createOnLeave` is also unobserved best effort ([useComments.ts:837](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:837>)). So crashes are not the only loss mode.

Concrete plan change: retain a pending mark after the dialog closes until `useComments` signals that the optimistic row has actually been installed—not until the server promise resolves. Remove it on confirmed failure. Explicitly document ordinary-create and keepalive failure. Test loaded-false success and refusal.

The provisional mark should not survive a failed create; as planned, the opposite bug exists—it disappears too early.

**E6 — P1 — The provisional mark needs a real representation, not merely a non-comment id.**

A mark with the ordinary/default kind becomes `mark.cmt[data-comment]` ([annotate.ts:492](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/annotate.ts:492>)), and mouseup opens its first id as a stored comment ([TableView.tsx:1466](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TableView.tsx:1466>)). Consequently, pressing the provisional paint can close/store it on pointerdown and then open the new optimistic CommentDialog on mouseup—or try to open a nonexistent provisional id.

Without `createdAt`, `commentOrder` treats it as oldest, allowing an overlapping stored comment to supply the visible colour instead ([annotate.ts:313](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/annotate.ts:313>)).

Concrete plan change:

- Pass a distinct `provisionalMark` prop to `TableView`; never add it to `comments`.
- Give it the intended draft id, selection-time `createdAt`, `marker:false`, and an explicit provisional discriminator.
- Emit `data-provisional`, not `data-comment`.
- Treat provisional runs as inside the annotation for click-off and inert on mouseup.
- Overlay it after the cached stored `marksByBlock`, cloning only its block’s array. This leaves `anchorKey` unchanged and keeps Quotes, drawer, marginalia and gutter blind to it; those all consume the real comments array ([TableView.tsx:812](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TableView.tsx:812>), [Reader.tsx:1728](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:1728>), [Reader.tsx:2001](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:2001>)).

The anchor offset reasoning itself is sound: both selections and marks use rendered-text offsets.

**E7 — P2 — Copy-only is not yet a defined state machine.**

The plan says every exit after Copy stores nothing, but current Save/Ask bypass the flush gates ([AnnotateDialog.tsx:434](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/AnnotateDialog.tsx:434>)). Pre-Copy text, placement or colour changes remain intent; post-Copy typing with `colour:null` creates an uncoloured comment, not the promised restored highlight. Ask AI cannot operate without storing a source comment.

Also, Copy currently records intent before the asynchronous clipboard result ([AnnotateDialog.tsx:757](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/AnnotateDialog.tsx:757>)), while `useCopy` distinguishes success and refusal. The proposed fixed sentence “Copied…” can therefore be false.

Concrete plan change: specify Copy × pre-existing intent × post-Copy mutation × Save/Ask. My recommendation:

- Do not let Copy silently discard words or a Referee placement already entered.
- An otherwise untouched draft becomes copy-only.
- A later colour/body change exits copy-only; state which colour typing restores.
- Save and Ask either explicitly exit copy-only or are disabled with explanatory copy.
- Render success/failure wording from the actual clipboard outcome.

Remove is sound if it continues setting the latch to `done` before closing; later unmount/pagehide cannot store it.

**E8 — P2 — Click-off changes several interaction contracts that the plan should name.**

- CommentDialog/ChatDialog will normally replace Annotate instead of opening in front of it. That is coherent, but changes the scenario pinned by [one-escape-closes-one-surface.test.tsx:287](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/one-escape-closes-one-surface.test.tsx:287>). Retain Escape arbitration for keyboard/async paths that can still coexist.
- The gutter’s delayed confirmation and Dock should work if the outside handler never prevents propagation/default, but need real `pointerdown`→`click` tests; `.click()` alone misses the ordering.
- A portal is not inside `aside.contains(target)`. Define owned portal roots with a draft-id attribute and test a real portal.
- Scrollbar targets vary by browser; put scrollbar dragging in the browser pass rather than promising it from jsdom.
- Touch origin is currently lost: both mouse and chip call the same one-argument `selectProse`, while Annotate always focuses the textarea ([TouchSelectionChip.tsx:106](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TouchSelectionChip.tsx:106>), [AnnotateDialog.tsx:416](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/AnnotateDialog.tsx:416>)). Carry `input:"mouse"|"touch"` through state; give the dialog container `tabIndex={-1}` for touch focus.

The existing touch rules—block selection by tap and chip suppression while a box is open—otherwise remain compatible.

### Simpler version

The smallest version that gets Greg’s requested behaviour is:

1. Paint a provisional yellow mark immediately.
2. Click-away, ×, Escape and Save commit it; Copy and Remove cancel it.
3. Drop “overlap means correction” from v1.
4. Keep mouse selection through the synthesized click; clear touch immediately.
5. Put pending-save durability and the pending mark in `useComments`/Reader, not dialog cleanup.
6. Give TableView one explicitly inert provisional mark prop.

Also worth reconsidering: the literal “create on selection, box edits/removes the stored row” design is less expensive than the plan claims. The create/remove tombstone race and queued `edit`/`place`/`recolour` paths already exist in [useComments.ts:352](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:352>) and [useComments.ts:717](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:717>). It eliminates the provisional identity and real-unmount problem, at the cost of create/delete traffic for copies and mis-drags.

So: preserve the provisional direction if avoiding those writes matters, but revise the lifecycle, pending handoff, click routing and Copy state before building.
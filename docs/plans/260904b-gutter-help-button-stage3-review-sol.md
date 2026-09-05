I would not ship or commit stage 3 unchanged. Two findings are commit blockers.

## Findings

1. **High — commit blocker: an early press can lose its optimistic summary and later spend again.**

   [`useChatAnchors`](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/useChatAnchors.ts:153>) starts the summary GET, then replaces the entire array when it resolves at line 162. Meanwhile `onCreated` appends the newly minted thread at line 179.

   Real ordering:

   1. Summary GET takes an old snapshot.
   2. Reader presses `?`; one POST starts and `add()` inserts its optimistic summary.
   3. The old GET resolves and replaces the array, deleting that summary.
   4. The App latch has cleared.
   5. A later `?` finds nothing and buys another answer.

   This is the precise stale-GET-over-optimistic-write race the hook’s own header says must not happen. It is especially reachable because [`helpAboutBlock`](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/App.tsx:2547>) explicitly remains active before `chatAnchors.loaded`.

   Independently, an existing stored conversation is always missed during that window, so the first press can already duplicate it. Calling reopening merely a convenience is too weak for a control whose main safety rule is avoiding duplicate spend.

   The fix should either merge the initial arrival with local additions/deletions, or queue/gate help until summaries are authoritative. Add a deferred-GET integration test: press `?`, resolve an older summary response, press again, and assert one POST/thread.

2. **High — commit blocker: a stale summary can permanently open “Starting…” with no recovery or stop control.**

   [`ChatDialog`](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/ChatDialog.tsx:172>) defines every loaded-but-missing thread as `starting`. Consequently the “That conversation no longer exists” branch at line 399 is unreachable once loading finishes: `starting` wins first.

   This happens when:

   - another tab deleted the thread;
   - the first POST failed before creating its pending row, after `onCreated` added the optimistic summary;
   - the reader closes immediately, reopens with `?`, and the new dialog’s GET beats the original POST’s database write.

   The summary keeps routing `?` back to that missing id. The dialog shows “Starting…” indefinitely, and its footer has neither Cancel, Stop, Delete nor retry. “Open in full chat” does not repair the stale summary.

   Therefore closing during the first answer is safe only after the server has accepted the turn. `sweepPending` and recovery correctly handle an existing pending row; they cannot recover a row that was never created or a GET that missed it.

3. **Medium — test blocker: the App latch is not tested at all.**

   The launcher tests construct their own ref, handler and artificial `commit()` in [`help-sends-once.test.tsx`](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/tests/help-sends-once.test.tsx:324>). Only `helpThreadFor` is production code.

   Deleting `helpArming`, moving its assignment after the state calls, removing its clearing effect, or changing the actual App handler leaves every launcher test green. The public-App test checks only that help buttons exist.

   The latch itself looks plausible for the current urgent state updates: synchronous repeated calls are blocked, and a successful send adds the summary during the passive-effect flush. I did not establish a realistic React batching path that independently double-sends once summaries are stable. But the claimed evidence does not verify that conclusion. This stage needs a real rendered-App double-press test.

   Two smaller test defects:

   - [`expect(title).toContain("AI")`](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/tests/block-gutter.test.tsx:361>) cannot contribute a failure after the preceding exact equality assertion.
   - The mutation table says each mutation reddened exactly one test, but deleting the dialog latch is listed as reddening two.

4. **Medium — product call: `helpThreadFor` does not find “help threads”; it finds every whole-block chat.**

   Remember threads are correctly excluded by `kind`; comment-created chats are selection-anchored and correctly excluded. But an ordinary conversation started from the paragraph chat button also qualifies.

   Thus “Ask the AI for help” sometimes asks nothing and merely opens an unrelated old conversation. Given that help origin is deliberately not persisted, this may be the safest cheap v1, but it is a product compromise rather than an exact implementation of the button’s promise. It should be explicitly accepted.

5. **Low: the help draft briefly renders copy that contradicts its action.**

   Auto-send happens in a passive effect at [`ChatDialog.tsx:292`](</home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/ChatDialog.tsx:292>), while the draft UI renders a composer and “Nothing is asked until you send” at line 371. React does not guarantee a passive effect precedes paint. A help target should render a help-specific “Starting…” state rather than the ordinary draft UI.

## What held up

- The dialog ref correctly suppresses StrictMode’s repeated effect and repeated target identities.
- After a successful send, floating/chat-mode remounting does not resend because App has already changed the target to `thread`.
- A `?thread=` URL opens a thread target and does not auto-send.
- Different paragraphs can send concurrently; returning to the first reopens it when summaries remain accurate.
- A locally discarded thread is dropped and a later press can send again.
- Once a pending row exists, closing, recovery, failure storage and `sweepPending` are coherent.
- Passing `opening` only into `askAboutBlock` is technically sound. The stored anchor remains structural; export, highlighting and `anchorSection` use that anchor, while the transcript text is opaque. I see no downstream semantic break.
- The canned first-person message is defensible: pressing `?` expresses that intent. It is not a technical attribution problem, though product may prefer less literal wording.

## Verification

- Suggested tests: **41/41 passed**.
- Five related cancellation/recovery/network files: **81/81 passed**.
- Typecheck: **clean**, covering 1,284 source files, invoked without the sandbox-blocked `tsx` IPC daemon.
- Full `npm test` was inconclusive in this managed sandbox: numerous unrelated suites failed on prohibited IPC sockets, local networking, database access and filesystem writes; I stopped it after those environmental failures accumulated.

**Verdict: do not commit yet.** Fix the summary-arrival race and the missing-thread “Starting…” state, then add a real App-level spend test covering both.
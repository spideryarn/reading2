Verdict: **refuse the plan as written**. The stated invariant is not accurate. F1, F2, F3, and F5 are established P1s from the proposed algorithm and existing request/API contracts.

## Findings

### F1 — P1 · established: browser-only identity cannot protect delivery

(a) A verified snapshot says execution A. Before the next collection, B replaces A while retaining the tmux handle, pane PID, and conversation ID—the case in the brief. The browser still considers A verified.

Neither [`SteerTargetBody`](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/steer-client.ts:67) nor the action bodies carry the execution token. The live check in [`verifyTarget`](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/steer.ts:1027) checks the preserved identifiers, not process start ticks. A replacement launched with the same conversation ID therefore passes. Queueing is weaker still: [`enqueue`](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/routes-actions.ts:1775) records the session/conversation without a live execution check.

`identityWriteGate` cannot close this: its own comment says a cached `allowed` is not authority. Consequently, a draft created for A can be delivered to B before the browser observes B.

(b) Replace the “No server change” paragraph with:

> **Server changes are required for the execution-boundary guarantee.** Every execution-bound steer, answer, session action, and queued message carries the verified execution token from the row the person acted on. Immediately before sending, acting, enqueueing, and delivering a queued item, the server freshly derives the target’s execution identity and refuses if it is unverifiable or differs from the claimed token. Queue items retain that token so a replacement invalidates rather than inherits them. `/api/messages` likewise binds its result to the requested verified token, and the browser discards a result not proven to belong to that token. A browser snapshot alone is never authority at read or write time.

Without that change, narrow the claimed invariant to “once the browser receives a verified replacement reading”; but that would leave the motivating misdelivery open.

### F2 — P1 · established: the unverifiable-gap draft rule binds B’s text to A

(a) The plan’s own sequence breaks its rationale:

1. A is last verified, so its key is `…:A-token`.
2. A is replaced by B while execution is unverifiable.
3. The user types text intended for what is now B.
4. The plan writes it to A’s key.
5. Later A is resumed or selected, and that text is restored as A’s draft.

Thus the sentence “a draft written during a gap can only ever reappear for the same run it was typed at” is false. Reload during the gap is safer only because the in-memory last-token knowledge disappears; it does not repair the ordinary no-reload sequence.

(b) Replace the gap bullet with:

> **The unverifiable gap is read-only for execution-bound state.** Keep the last verified draft and component state in memory, but do not modify its storage key and do not permit typing, sending, queueing, answering, or session actions while the current reading is unverifiable. Draw a continuity warning instead. If the same token returns, reveal the held state unchanged; if a different verified token arrives, remount and restore only that token’s draft. After a reload that begins unverifiable, restore nothing until a verified token arrives. No text entered without a verified identity is automatically attached to either execution.

That is the smallest safe rule. Supporting typing during ambiguity needs a separate visibly “unbound” recovery buffer and a user choice about where it belongs.

### F3 — P1 · established: adding only the token leaves transcript quarantine incomplete

(a) [`coherentWith`](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/types.ts:1300) can preserve a verified process token while downgrading its conversation to `unverifiable`. A direct `conflicting` conversation does the same.

Sequence:

1. Token T, conversation C, transcript C is held.
2. Next row still has T and claimed `claudeSessionId=C`, but execution conversation is conflicting with D.
3. The proposed identity remains `row.id + C + T`.
4. [`Held`](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/RecentMessages.tsx:494) therefore continues exposing C’s transcript despite the browser now knowing the conversation binding is bad.

The proposed stable “no token” marker has another problem: it gives unverifiable rows an identity under which a new transcript read can be started and displayed. That contradicts quarantine.

(b) Replace the transcript bullet with:

> `useRecentMessages` has an identity only when `identityWriteGate(row.execution)` is allowed. That identity contains `row.id`, the gate’s execution token, and its verified conversation id. For `unknown`, `claimed-only`, `conflicting`, or a conversation downgraded by `coherentWith`, synchronously expose no held view, start no read, disable “Read again”, and show the gate’s reason while retaining any previous result internally. Cancel or generation-discard every in-flight read when this identity changes. Do not create an “unverified” identity that can own a transcript read.

The token in `identityOf` is not redundant with the remount. It protects this exported hook and its render-time join independently of one caller’s keying.

### F4 — P1 · reasoned: the mount key’s selection domain is underspecified

(a) If the returned key is only an epoch, switching from verified A to unverifiable B holds the epoch and lets React reuse A’s component for B. The plan also does not state how `continuityOf(null, verified)` establishes the first baseline, or whether a disappearance preserves the last token for that session.

(b) Replace the hook bullet with:

> `useExecutionEpoch(row: FleetRow | null)` is called unconditionally and keeps the last verified token per `row.id`. Its returned key always contains both the session id and its epoch, for example `JSON.stringify([row.id, epoch])`, so changing selections changes the key even when either reading is unverifiable. A first verified token establishes that session’s baseline without reporting replacement; the same token holds; a different verified token increments its epoch; an unverifiable or missing row preserves, but never updates, the per-session baseline.

With that wording, claimed-only, not-reported, disappearance/reappearance, and switching between sessions all have deterministic answers.

### F5 — P1 · established: Stages 3 and 4 cannot perform their promised aborts through the existing APIs

(a) [`FeedApi.recent`](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/feed-client.ts:772) and [`ActionsApi.feed`](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/actions-client.ts:1627) accept no `AbortSignal`. Yet the plan lists only `FeedPanel.tsx` and `useActions.ts` plus tests. An `AbortController` confined to those hooks cannot abort their actual fetches.

Additionally, merely signalling abort does not release `inFlight` if an injected API ignores the signal or never settles.

(b) Add:

> Stage 3 also changes `feed-client.ts`: `FeedApi.recent(limit, signal?)` passes the signal to `fetch`. Stage 4 also changes `actions-client.ts`: `ActionsApi.feed(signal?)` does the same. Each hook races the API promise against its own deadline so timeout settlement and pending-refresh progress do not depend on a test double honouring abort; it also aborts the real fetch and generation-discards any late result. Effect teardown and identity/world changes abort the current controller.

### F6 — P1 · established: the feed digest omits two already-established identity signals

(a) The proposed digest omits `claudeSessionId`. The existing Baseline regression explicitly establishes that a conversation can change under the same handle. If status, question presence, and execution token remain unchanged, the proposed digest does nothing.

It also omits `tmuxServerPid`, even though Stage 3 treats a PID change as important enough to abort an in-flight request. With no request in flight, an old-world feed can remain until manual refresh.

(b) Replace the digest bullet with:

> Re-read on a canonical digest of `tmuxServerPid` plus rows sorted by id, each represented by `[id, claudeSessionId, status.kind, questionSafetyKey(rawQuestion), execution-verdict]`; the verified execution verdict contains `executionTokenText(token)`, while unverifiable arms contain only their stable kind/cause, not changing prose. The initial read establishes the digest baseline. Evidence arriving inside the 20-second floor schedules exactly one trailing read at the earliest permitted time; further changes coalesce into it, and visibility is checked again when it fires. A tmux-server change triggers the same discard-and-read path.

This cannot loop if the digest depends only on `/api/state`; a feed result and `lastReadAt` do not alter it.

### F7 — P1 · established: the `answeringOff` scopes need existing identities and a genuinely page-level owner

(a) The correct dialog signature already exists as [`questionSafetyKey(row.rawQuestion)`](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/types.ts:225). It mirrors the server’s stale-answer fields and distinguishes identical prompt text with different material, options, consequences, or keys.

A genuinely distinct dialog with identical safety fields is intentionally treated as the same by server `sameQuestion`; retaining `grants-permission` is therefore consistent. Disappearance must still count as a change.

Conversely, `answering-disabled` cannot live in `SessionDetail` or merely `SessionsPanel`: [`App`](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/App.tsx:259) unmounts the Sessions panel when modes change, losing a supposedly page-scoped refusal.

(b) Replace the split bullet with:

> `grants-permission` is keyed by `[row.id, verified execution token, questionSafetyKey(row.rawQuestion)]` and clears whenever that tuple changes, including a transition through no question. Use the existing `questionSafetyKey`; never object identity or prompt text alone. `answering-disabled` is a page-level latch owned by `App.tsx`, independent of selection, dialog, and mode. It clears only after a state payload received after the refusal reports `answeringEnabled.kind === "enabled"`. Add `App.tsx` to this stage’s files.

### F8 — P2 · established: `lastGoodAt` is planned as an unused field

(a) Stage 4 lists only `useActions.ts` and tests. Returning `lastGoodAt` does not make any queue or action surface say its data is old, despite the plan’s stated reason for adding it.

(b) Add:

> Draw the actions feed’s last-good age and current error beside the in-scope SessionDetail action/queue surfaces; retain the last good feed underneath. Add `SessionDetail.tsx` to Stage 4. The out-of-scope Health and Overseer consumers may adopt the same field in their owning work.

### F9 — P2 · reasoned: the late-discovery regression has no specified winner

(a) The current poll checks the deadline in the interval callback, not after `await`. A poll can begin before the deadline, resolve after it, and update the launch before the delayed timer callback runs. “A session discovered after the deadline” does not say whether that result is accepted or discarded.

(b) Replace that case with:

> A poll begun before the absolute discovery deadline but resolving after it must not update the launch or erase the give-up state; the absolute deadline wins, the late result is discarded, and no further poll starts.

## Answers to the specific doubts

- The boot field does close PID/start-tick reuse across reboot: the token uses the kernel boot ID, while start ticks distinguish processes within one boot.
- Session ID reuse by tmux is safe only once a verified token is available. It is unsafe during stale or unverifiable observation without the server-side token check in F1.
- `sessionStorage` keeps ordinary tabs separate. A duplicated tab may begin with a copied store, but the copy remains tied to the same execution token; the larger danger is stale identity, not cross-tab overwriting.
- Stage 3 is worth retaining. Status, dialog, conversation, world, and execution changes are useful high-signal refresh triggers. The last-read clock does not make the feed current; it merely makes staleness visible. The plan is accurate only in that narrower sense.
- Stage 4 is also worth retaining, especially the timeout and pending-refresh behavior, but it needs the API seam and a visible consumer.

Verification: `npx vitest run tests/fleet-web.test.tsx --configLoader runner` passed all **430 tests**. The ordinary invocation could not create Vite’s cache directory because this review tree is read-only. No repository files were changed.
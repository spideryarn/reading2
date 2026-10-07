The statement is **inaccurate**: a queued hashchange can overwrite newer local state after a throwing replace.

F1’s synchronous-write policy and F2’s replace-on-close policy adequately address the original findings when writes succeed. Dropping debounce introduces one P1 through the proposed failure handling.

**F10 — P1, established in React/jsdom with an injected `SecurityError`: a failed replace lets an earlier push undo the newer selection.**

(a) At [Stage 1’s mechanism bullets](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/docs/plans/261006l-borrow-the-reading-app-s-machinery-for-the-fleet-dashboard.md:103):

```text
Open A:                 local=A, address=A; hashchange queued
Switch to B; replace throws:
                        local=B, address=A
Earlier hashchange runs:
                        reads address=A, sets local=A
```

The user’s selection is lost without further navigation. The same mechanism can reopen a detail whose close failed. Reading the current hash protects against a **successful** intervening replace; it cannot protect against one that left the address stale.

The [temporary harness](/tmp/fleet-history-second-pass.cjs) reproduced this with actual queued jsdom events and rendered React state. Its successful-replace control retained B; its `pushState` control produced no owned hashchange and retained optimistic B.

(b) Replace the mechanism bullets beginning “Push stays…” through “The queued `hashchange`…” with:

> No debounce. Owned writes use `history.pushState(history.state, "", spelled)` for push and `history.replaceState(history.state, "", spelled)` for replace. Maintain the latest logical state in a ref, update it before attempting the address write, and schedule the matching React state update. Derive subsequent writes and their history kind from that ref, without waiting for a render.
>
> Wrap both History API calls in try/catch. A throw retains the latest logical state and rendered view but leaves the address at its last successful value. Repeated failures can leave any changed parameter stale for an unbounded interval; a reload restores that older address. The next successful owned write persists the complete latest logical state.
>
> Owned History API writes generate no hashchange or popstate. Listen to both events for incoming navigation, re-read the actual location, and adopt it into the ref and React state. Explicit incoming navigation supersedes local changes that were not persisted.
>
> Existing immediate hash assertions hold for successful writes. Add a regression that pushes A, attempts a throwing replacement with B before queued events drain, drains those events, and verifies B remains local. Also verify recovery persists the complete latest state and Back/Forward still adopt their destinations.

This removes the owned-event race; History API writes do not generate the fragment-navigation event. [HTML Standard](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-history-interface)

No repository files changed. No other P0/P1 found within the requested scope.

**Verdict: build with the listed changes.**
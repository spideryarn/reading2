# A state update in one passive effect cannot guard a later effect from the same render

Nothing reached a reader: review of Sources › Digest Stage 2 caught this before the commit was
approved. A press made while another tab was already writing the roughly $1 digest could enqueue a
second run in the interval between that job completing and the client reading its result.

## What happened

The digest correctly waited while the other tab's job was active. When the queue next reported that
job `done`, the render no longer had an active job but its artefact read still said `none`.
`useJobs` announced the completion in a passive effect; that callback set `landing` and began the
refresh. The later `useAutoRun` passive effect from the same commit still held the render's old
`none`, consumed the press and called the unforced start.

The regression that preserves the effect ordering failed before the fix:

```text
FAIL opening it is the request > does not buy a second run while another tab's completed digest is landing
expected [ { slug: 'a-piece', steps: ['sources-digest'] } ] to deeply equal []
```

Commit `ea19598795b26b77211816b56323282c20123a11` introduced the digest instance. Its intent was
right: it copied the `landing` state used by `useSituate`, waited for a queue list newer than the
press, and relied on the durable work key as the last same-request dedupe. The missing case was
inside one React effect pass, not between renders.

## The class: a later effect still owns the render it came from

Calling `setState` in one passive effect schedules another render. It does not rewrite the closures
of passive effects that are still to run from the current commit. A state flag can therefore be a
correct inter-render guard and still be one effect too late as an action-time guard.

The sibling proves this is a class rather than a Digest detail. `useSituate` also sets its landing
state from the queue-completion effect; `useWhereAutoRun` later uses that state to gate an automatic
run. It protects the next render and has the same same-commit opening. The shared queue freshness
check closes the older stale-poll race, but not this effect-order race.

## Why nothing went red

The Stage 2 tests covered StrictMode's doubled mount, arrival without a press, a stored digest, and
an already-running job. None made the running job become terminal while holding the result read in
flight. A first attempted regression manually announced completion before the rerender; adding
`landing` to the rendered `working` predicate made that test green while leaving the real
render-then-effect ordering open. The test had tidied away the bug's defining interval.

Types cannot distinguish a state value captured by the current render from a ref changed earlier in
the same effect pass. The server's work key also does not prove the contract: an unforced duplicate
may skip after it starts, but a profile, source or prompt change can make it run, while the UI rule
says any stored stale or outdated digest consumes the press without another run.

## What would have caught it, ranked by ease against value

1. **Drive completion from an effect, then hold the result read** — done in
   `tests/sources-digest-panel.test.tsx`. It is small and reproduces the original ordering rather
   than calling the completion callback before render.
2. **Guard the paid action with a synchronously written landing ref as well as rendering landing
   state** — done for Digest. State explains the screen; the ref decides whether the action is
   still legal at the instant it runs.
3. **Put completion-to-read coordination in one shared hook** — the long-term fix. Every generated
   artefact that combines `useStepJob` completion with `useAutoRun` should receive the same landing
   state, synchronous guard and identity-protected clearing, rather than reimplementing the pair.
   That change should include the existing Situate sibling and a shared effect-order test.
4. **Drain completions in a layout effect or force a synchronous render** — rejected. It changes
   queue timing for every subscriber and depends on React scheduling to make an action safe. The
   action boundary can answer directly without turning a local invariant into a global timing rule.
5. **Rely on server deduplication** — rejected. It prevents some duplicate spend, not the duplicate
   request, and freshness can legitimately make the second job different work.

## The fix that is right for the long term

The shipped review fix keeps an identity-protected landing value in both state and a ref. The queue
completion writes the ref before starting the refresh; `ensure` refuses while that ref belongs to
the current read; rendered `working` includes the state until the read lands. That closes Digest's
instance without changing shared queue behavior.

The long-term design is a shared completion-landing primitive used by Digest, Situate and the next
artefact with this shape. It should own the state/ref pair and expose an action guard, so a caller
cannot copy only the visible half again. Situate remains wider work from this review.

## The thing I would tell myself

I saw that `landing` was missing and treated the next render as the whole state machine. The paid
action runs in an effect, so I needed to follow effect order through the same commit and ask what the
callback would read before React had a chance to render the flag I had just set.

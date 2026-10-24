# A refused upload's retry waited for a change that had already happened

Caught in GPT Sol's code review of
[the plan](../plans/261024y-a-second-press-on-a-page-already-on-the-shelf-opens-it.md) before it
shipped ([finding 1](../plans/261024y-code-review-sol.md)). When another upload owned the tab's
engine, the extension's add page sat on "Getting the page from Spideryarn's Chrome extension…"
forever, with the reader's capture unspent.

## The class: a lost wakeup

Waiting on an *edge* (a value changing) that may already have happened before the wait began. In
React it looks like a retry keyed on a derived dependency that is not guaranteed to change.

In `src/web/AddFromExtension.tsx` the effect ran when `ready` (`started.current ||
!uploadInFlight(transfer)`) went false to true. On `ONE_UPLOAD_AT_A_TIME` the handler released the
capture, reset `started.current`, and expected the competing upload to settle later. If it had
already settled before React rendered the refusal, `ready` was true before and true after, so no
dependency changed and the effect never re-ran. Nothing errored; the page just waited.

## Which commit

`2623efaa4` ("261024q: GPT Sol's code review fixes for the Chrome extension (C1-C10)"), which added
the refusal-and-retry path. Its intent was right (do not start a second upload on a busy engine);
the mistake was assuming "busy" would always still be true when the refusal arrived.

## Why nothing went red

The existing tests made the competitor settle after the refusal, the one ordering where the edge
exists. The other ordering is a race, so no test happened to produce it.

## What would have caught it, ranked by ease against value

1. **Drive a retry from an event that always happens** — the refusal now also bumps an explicit
   `attempt` counter that is an effect dependency. Busy: the effect waits at `!ready`. Already
   settled: it retries at once over the same capture. Done.
2. **Test both orderings of a race** — "retries once when the competing upload has already settled
   before the refusal renders" in `tests/add-from-extension-already-have.test.tsx`. Seen red with the
   bump removed, green with it. Done.
3. **A habit: whenever code says "retry when X becomes true", ask what happens if X is already
   true.** Costs nothing; would have prevented this.
4. A lint rule against derived-boolean effect dependencies — rejected. It cannot tell a deliberate
   edge-trigger from an accidental one, and would be noise.

## The long-term fix

The shipped fix is the long-term shape: an explicit retry signal rather than inference from state.
A retry is an action, so it gets its own trigger.

---

Up: [postmortems.md](../project/postmortems.md)

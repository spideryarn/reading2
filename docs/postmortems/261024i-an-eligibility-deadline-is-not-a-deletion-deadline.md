# An eligibility deadline is not a deletion deadline

Nothing reached a reader, but the candidate privacy notice was false. Commit `9966db02df90` said a
captured page was held in the browser for at most 15 minutes. The code refused delivery after 15
minutes but deleted an untaken capture only when another event later opened IndexedDB.

## The class: a use deadline mistaken for a retention guarantee

Checking age at read time limits eligibility. It does not schedule deletion. Persistent storage has
no clock of its own, so an open receiving tab and no later button press could leave the HTML stored
indefinitely. The same distinction matters for caches, tokens, drafts and temporary uploads.

The introducing commit was `9966db02df90`; its tests advanced `now()` and asked for the capture, so
they proved refusal and appeared to prove expiry while never inspecting storage after time passed.

## Why nothing went red

The word “expired” was used for both “cannot be taken” and “has been erased.” Every tested cleanup
had an event—take, close, or another press—to run it.

## What would have caught it, ranked by ease against value

1. **Name availability and deletion separately in disclosure text** — done. The policy now lists
   the events that actually delete an untaken capture.
2. **Clear session-scoped mappings on browser startup** — done for the tab-id security fix, and it
   also bounds leftovers across sessions.
3. **Add an alarms permission solely for wall-clock deletion** — rejected. It adds a permission and
   still cannot run while Chrome or the device is stopped; the truthful event-based guarantee is
   simpler.

## The long-term fix

The implementation deletes on take, receiver-tab close, the next cleanup after expiry, and browser
startup. The public claim describes those events and says 15 minutes is the handoff window. If the
product later needs a strict running-browser deletion interval, an alarm and a new permission are a
product decision rather than wording hidden behind `KEEP_MS`.

## The thing I would tell myself

I would ask which event physically issues `delete`. Comparing a timestamp can revoke a capability;
it cannot erase a byte by itself.

---

Up: [postmortems.md](../project/postmortems.md)

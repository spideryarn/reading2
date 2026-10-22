# A read-only handler is not a read-only request lifecycle

The first code review of view-as found three mutations outside the code that its allowlisted GET
handler appeared to run: the ordinary authenticated-request epilogue could write an arrival and
send signup mail after `/current` and `/end`; the Referee source scan filled a process cache on a
cold read; and an auth broadcast maintained the administrator's real IndexedDB cache records. The
boot exception also passed through every key shaped like a Supabase token rather than only the
administrator's auth key that existed when the tab opened.
Nothing reached a reader: all three were found in review of commit `e8180d86d` before this work was
landed.

## What happened

The boundary was drawn around `runViewingAs(handler)`. That was enough for the explicit spend,
email, deferred-work, job, Storage and database backstops inside the handler, but not for work before
or after it, nor for a deterministic helper whose public operation was named “scan”. The three
control routes were deliberately outside the marker so they could write the session row, then fell
through the ordinary `serveAuthenticatedApi` success epilogue. `scanArticleSource` treated a read
as permission to mutate its module-level cache. The browser request cache correctly used no owner,
while the separate auth-event subscriber still wrote offline-cache metadata. The boot script
described one auth capability but implemented a regular-expression namespace, so a newly written
lookalike key reached real storage too.

## The class: semantic read-only scoped to the handler instead of the lifecycle

“GET”, “read helper”, and “handler under a marker” each describe only one slice of a request. A
read-only invariant covers every hook that slice triggers: routing prologue and epilogue, lazy
computation, process caches, reactive auth events and browser persistence. Auditing only the named
operation systematically misses those edges.

## Why nothing went red

The backstop tests invoked each protected effect *inside* a synthetic allowlisted handler, exactly
where the marker worked. The control-route tests proved start/current/end but did not observe the
ordinary arrival epilogue. The source-scan test positively proved that identical bytes were cached,
without asking whether the caller was allowed to leave that cache entry. The API tests proved that
subject responses used no offline-cache owner, not what a separate session broadcast did.

Commit `e8180d86d` introduced the feature and all three gaps. The plan reviews concentrated on the
handler allowlist and explicit backstops; they did not define the request lifecycle as the unit to
inventory.

## What would have caught it, ranked by ease against value

1. **Lifecycle-shaped negative tests** — done. A view-as control request now observes
   `noteArrival`; a view-as scan followed by an ordinary scan proves the first left no cache entry;
   an auth broadcast proves no offline metadata was touched, and a second project's token-shaped
   key proves the pass-through is not an open namespace.
2. **Name mutable reads in the allowlist audit** — done in the owning security doc: lazy caches and
   request epilogues are effects even when the result is deterministic.
3. **One request-mode capability passed through every hook** — valuable, but not built in this
   review. It would replace the header check in the epilogue and the marker checks in helpers with a
   single typed mode, at the cost of widening a mature routing API.
4. **Ban every in-process cache in view-as** — rejected as a general rule. Reading an existing
   deterministic cache is not a write or a disclosure when its key and value are content-derived;
   filling it is the operation this boundary forbids.

## The long-term fix

The shipped fixes are local and complete for the current lifecycle: view-as control requests skip
the arrival epilogue, source scans neither read nor fill their process cache while marked, auth
broadcasts skip offline-cache bookkeeping, and only auth keys present at boot pass through. The stronger design is an explicit request capability
that survives the control-route exception and is consumed by every lifecycle hook. That becomes
worth its breadth when a second feature needs “these writes only, no ambient work”; until then the
focused tests are cheaper and more legible.

## The thing I would tell myself

I called the handler read-only and then treated everything outside its braces as somebody else's
problem. The invariant named a request and a tab, so the audit unit had to be the request and the
tab too.

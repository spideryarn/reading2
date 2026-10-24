# An authentication detour must preserve security state

Nothing reached a reader: review of commit `9966db02df90` found that the receiver's reader binding
was lost on the forced trip through `/login`. A capture first opened for reader A could return from
sign-in as reader B and be treated as B's fresh add visit.

## The class: security state erased by an authentication detour

The add-visit fence correctly survived a signed-out render only while the address stayed an add
address. Redirecting to the login route made the generic “leaving ends the visit” rule erase it.
The full-page OAuth trip also erased the React ref. Authentication was treated as leaving the
protected operation even though it was a continuation of that operation.

The introducing commit was `9966db02df90`. It reused the existing add-visit rule but tested account
changes only while the receiver address remained in place.

## Why nothing went red

Tests exercised A→B and A→signed out at one route. They did not include the actual route sequence
`/add-from-extension` → `/login?next=…` → OAuth reload → `/add-from-extension`.

## What would have caught it, ranked by ease against value

1. **A route-sequence test including a lost in-memory ref** — now proves A is recovered after a
   simulated reload and B receives a stopped visit. Added.
2. **Persist the smallest security identity at the lifecycle boundary** — the first reader id is
   kept in tab-scoped session storage, which survives OAuth but not the receiving tab. Done.
3. **Put the reader identity in extension storage** — rejected: the extension has no authenticated
   reader identity and should not acquire account state merely to repair a web-app lifecycle gap.

## The long-term fix

The login route counts as the extension add address only when its validated return target is the
receiver. The first signed-in reader is remembered synchronously in that tab; a receiver opened
signed out remains unclaimed. The existing add-visit state machine then stops rather than restarts
when another reader appears.

## The thing I would tell myself

I would draw the authentication route and reload as states inside the protected operation. A fence
that lives only in a component or pathname is not a fence across sign-in.

---

Up: [postmortems.md](../project/postmortems.md)

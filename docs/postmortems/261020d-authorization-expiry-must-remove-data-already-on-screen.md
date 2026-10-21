# Authorization expiry must remove data already on screen

The first view-as client could continue showing a reader's already-rendered data after the
thirty-minute session ended or either account became ineligible. A valid nullable email discarded
the expiry, a failed or hanging first `/current` left no expiry at all while the shelf still loaded,
403 revocations did not trigger the 410-only exit, and Back could restore an ended or still-live
document from bfcache. A shared-auth sign-out or account switch also left the subject state mounted
until a later server refusal. Nothing reached a reader: these paths were found while reviewing commit `e8180d86d`.

## What happened

The server correctly refused the next subject-data request. The client treated that refusal as the
whole revocation mechanism, although data already in React state, the DOM and blob URLs needs no
next request to remain visible. Its local expiry existed only after `/current` parsed a non-null
email, even though the response type explicitly permits `null`. The app mounted subject pages in
parallel with that first check. Finally, `location.replace("/")` replaced the newest history entry,
not older entries for the same document, and the idempotent `ended` flag made a restored document do
nothing on its second arrival.

## The class: revocation guarded future reads but not retained results

An expiring authorization has two jobs: refuse acquisition after the deadline and withdraw what is
already retained. A request gate only does the first. Any client that keeps the result — UI state,
cache, object URL, worker or browser history — needs a terminal transition driven by the authority,
not by whether another useful request happens to occur.

## Why nothing went red

The server tests exhaustively covered expired, stopped, foreign and malformed nonces, but each made
a new request. The bar tests covered a successful `/current`, an already-expired answer and a 410;
one test even made `/current` hang, but asserted only that the bar appeared. No test coupled that
hang to whether the shelf was allowed to mount. The API test distinguished the ended 410 from an
unrelated 410, but actor and subject revocations used 403. Commit `e8180d86d` introduced all of
these assumptions together.

The nullable-email and first-check tests failed red before the fix. The terminal-403 and bfcache
restore tests also failed red before their client guards were added.

## What would have caught it, ranked by ease against value

1. **Hold the subject page behind the first authoritative session answer** — done. A hanging or
   failed `/current` can now leave only a neutral checking surface, not reader data.
2. **Test every terminal cause against already-rendered content** — partly done: expiry, ended code,
   actor/subject ineligibility and bfcache restoration now exercise the terminal path.
3. **Keep expiry independent of display identity** — done. A missing email falls back to the id and
   cannot discard the deadline.
4. **Carry a server-authenticated expiry in the boot capability** — the best long-term answer for
   closing a tab even when its first `/current` never returns, but it changes the nonce format and
   boot contract. It is not needed to protect data now that subject pages wait.
5. **Rely on `Cache-Control: no-store` to exclude bfcache** — rejected. HTTP cache and bfcache are
   different mechanisms, and browser behaviour has changed over time.

## The long-term fix

The client now gates subject rendering on a valid id and expiry, accepts a nullable address, hides
the subject tree synchronously on the terminal event, treats authorization-loss codes as terminal,
rechecks subject-admin status through `/current`, hides the document on `pagehide`, and redirects
if bfcache restores it whether or not its local ended flag had fired. An auth sign-out or account
change is terminal before offline-cache bookkeeping. The stronger future design is a signed boot capability containing the absolute expiry,
so the tab can arm its deadline before React or the network; the server remains authoritative on
every request either way.

## The thing I would tell myself

I proved that expired credentials could not fetch more data and called the view expired. The data
that mattered was already there; revocation was a UI-state transition as well as a request refusal.

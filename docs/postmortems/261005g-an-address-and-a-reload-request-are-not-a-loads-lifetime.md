# An address and a reload request are not a load's lifetime

Up: [postmortems.md](../project/postmortems.md). Candidate:
[261005h](../plans/261005h-three-robustness-bugs-unknown-wire-values-rootless-children-list-chain-timer.md),
Stage A. Found in code review on 2026-10-05; the evidence is unit reproduction and tracing, not an
observed production incident or confirmed loss of reader data.

The new temml recovery awaited a build check before exposing the article. It missed two boundaries:
the check can request a reload before the browser replaces the document, and the article load can
be abandoned while the address stays the same.

## The class: a convenient proxy standing in for an asynchronous lifetime

`reloadIfStale()` returning `true` means `location.reload()` returned without throwing. It does
not mean the old document has gone. `renderArticleMaths` returned immediately, so `resolveAccess`
could expose comments and criteria while that requested reload was pending. Those forms' local
drafts are not reload vetoes. The nearby `LazyPage.tsx` already held its failure through a short
grace period; calling the same recovery function did not inherit that caller's protection.

The address comparison had the converse problem: it could authorise a reload after the load that
requested it had ended. `useArticleAccess` replaces its load when `readerId` or `attempt` changes,
as well as when the slug changes. An unchanged address therefore does not establish that the
original load is still current. Checking `signal.aborted` before starting recovery covered only
abandonment before the check, not during it.

Both defects were introduced by **`d96aa2e5a`**, confirmed with `git log -S 'await recover()'` and
`git blame` on the catch. Its purpose was to recover an old bundle's missing temml chunk while
protecting unsent words and suppressing abandoned loads; the predicates implemented less than that
intent.

## Why the checks stayed green

The pending-check test held the recovery promise open and then resolved `false`. It proved that
the check was awaited, but never tested the state after a successful reload request. The
leave-during-check test changed both the address and the abort signal, so the address guard alone
satisfied it. The plan review had identified both lifetime risks (P-1/P-2), but these fixtures
allowed incomplete implementations to look complete.

Two new tests in `tests/maths-stale-chunk.test.ts` went red before either fix:

- Requested reload: expected the article to remain withheld; received the complete article.
- Abort during the check with the same address: expected no reload; the reload spy was called once.

## The fix and its limits

Maths now holds the article through the same `RELOAD_GRACE_MS` as LazyPage after recovery answers
`true`, then releases the original raw-TeX fallback if the document remains. The grace constant lives
in `stale-shell.ts`; LazyPage's behaviour is unchanged. Maths also forwards its load's abort signal
to `reloadIfStale`, which checks it before asking and before claiming the session's reload.

The appropriate lasting shape is a load-owned validity signal checked at the effect boundary,
and an explicit contract distinguishing a requested navigation from a completed one. The signal
check supplies the first. The shared grace is the existing bounded fallback policy for the second,
not proof that a browser must replace a document within five seconds. Tracking every editable
draft as a reload veto would provide broader protection and is outside this review's scope.

## Countermeasures, ranked by ease against value

1. **Vary each lifetime fact independently in tests.** Done: keep the address fixed while aborting;
   finish the recovery decision while withholding document replacement. The tests also verify
   signal forwarding and that an abandoned load does not spend the session's reload.
2. **Read the called function's result contract and its existing callers.** Cheap and effective:
   the `true` contract and LazyPage's grace were already adjacent evidence. Awaiting a promise
   establishes only the event that promise represents.
3. **Use an operation's cancellation signal rather than its visible address as identity.** Done at
   this boundary; addresses can stay equal while operations are replaced.
4. **Wait forever after requesting reload.** Rejected: a browser that leaves this document in place
   would leave the reader on a permanent spinner. A larger grace merely moves the fallback time.

Validation after the fixes: **369 tests passed across 15 files**, including real maths rendering,
stale-shell, LazyPage and the eager-client graph. Browser reload timing remains a check for the
environment that can run a browser.

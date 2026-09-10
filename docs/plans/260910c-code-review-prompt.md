# Code review: plan 260910c, per-account Usage Limits sections — as built

You reviewed the **plan** for this earlier today and found three P0s. This is the **code**, built
from your corrected version. Weight this pass higher than that one: a plan-stage review cannot find a
handler that writes one field and then rejects the request.

**The change:** commits `a17ec425` (the data path), `74634fd3` (the page), and the commit after it
(a fix the full suite found — below), on branch `worktree-usage-per-account`.

**Found by the full suite after the prompt below was first written, and already fixed:** conclusion 2
was a real bug. `headroomShownAbove` was passed unconditionally, so with `accountUsage` not
`published` the tab showed no headroom for any account while looking complete. It is now
`feed.state?.accountUsage.kind === "published"`. **Check that is sufficient** — in particular whether
a `published` feed whose every section is `unknown` should also keep the card's cached windows, since
then the replacement is on screen but carries no numbers. The same run exposed three tests in
`fleet-web.test.tsx` whose Usage → Overseer switch never landed (jsdom delivers `hashchange` as a
later task); all three now dispatch it and prove it. Tell me if the proof assertions are themselves
weaker than they look. The scoped diff is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/d2163d51-5976-446f-b3a6-d06c69812556/scratchpad/260910c.diff`
and the tree is this worktree — read the files, not only the diff.

**The plan, updated to record what your review changed:**
`docs/plans/260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md`
§ "What the review changed". **Your review verbatim:** `docs/plans/260910c-review-sol.md`.
**The doc written for the next reader:** `docs/project/usage-per-account.md`.

## What you should already be satisfied about, and where to check

Confirm each is actually done rather than described as done:

1. **P0-1, the double ambient Codex collection.** `scripts/overseer.ts §
   usageHistoryDaemonOptions` now stashes one reading and hands it to both the history retention and
   `collectAccountUsage`. **Check the stash is safe**: it relies on `daemon.ts` calling `accounts`
   strictly after `run` in the same continuation, and on the daemon refusing to overlap usage passes.
   If either is false the stash can serve the previous pass's reading under a heading dated now. I
   consume-and-null it for that reason; tell me if that is insufficient.
2. **P0-2, the family-discriminated reading.** `AccountUsageSection` in `tools/fleet/wire.ts`.
3. **P0-3, `providerTenantId`.** `pinMismatch` in `tools/overseer/account-usage.ts` is Claude-only,
   requires the tenant, and depends on nothing unlanded from plan 260910b.
4. **The Codex null-id P1.** `codexSectionFrom` refuses numbers for a null `accountId` whether pinned
   or not; `enforceExpectedAccount` in `codex-usage.ts` refuses a null when an id was supplied.
5. **The expiry P1.** `AccountUsageSections.tsx` draws no windows itself and reuses `WindowStatCard`,
   whose `windowStat` re-derives against the browser clock.
6. **The identity-collision P1.** `collapseDuplicateSubscriptions`.
7. **The `problems` P1**, and the history caveat wording in `UsageHistory.tsx`.

## The conclusions I would least like to be wrong about

Check these against the source, not against my prose or my comments.

1. **That no path can put a percentage under an account nobody proved it belongs to.** This is the
   whole point of the feature and the thing I would most like you to attack. There are now four
   parsers of this shape — the producer's `parseAccountUsageSections`, the store's
   `parseStoredAccountUsage`, the fleet's `projectAccountUsage`, and the browser's
   `parseAccountUsageSection` — and any one of them being laxer than the others is a hole. Also
   consider a *held* reading: `accountUsageHeld` republishes the last good sections on every
   checkpoint write until a new pass runs. Can that put a stale section under a fresh-looking clock?
2. **That the `headroomShownAbove` prop cannot hide a reading with no replacement.** On the Usage tab
   the card drops its cached windows and its whole Codex half. If `accountUsage` is `no-reading`
   while `usage` is `published`, does the page then show *nothing* about headroom while looking
   complete? Trace it. I believe `AccountUsageSections` draws a card saying there is no reading, but
   that is a belief about a component's fallbacks, which is exactly the kind I get wrong.
3. **That the daemon change cannot lose or double a pass.** `accounts` runs in a `.then` after both
   the success and the failure paths of `run`. Check the promise chain: can `usageRunning` be cleared
   before `accounts` settles, letting two passes overlap? Can a throw from the `accounts` block
   escape and kill the daemon?
4. **That `overseer usage` behaves the same as before except where I meant it to.** It went from
   throwing on a malformed registry to printing a `!` line and exiting 1, and its `--json`
   `accounts` field changed shape from an array to `StoredAccountUsage`. Is anything else consuming
   that JSON? Search for it; the Overseer's tick script reads this output.
5. **That the `% used` change did not leave a `% left` anywhere**, or a test asserting the old
   wording that now passes for the wrong reason.

## What I want from you

- **P0**: anything that is wrong in the tree as it stands.
- **P1**: any path where an absent, expired, stale or unattributable reading reaches a person as a
  number or as a confident sentence. Over-hunt this; it is the failure class the whole subsystem
  exists to prevent.
- **Tests that cannot fail**, or that assert something weaker than their name claims. I have written
  a lot of them today and I would rather hear which are theatre.
- **Anything more complicated than it needs to be.** Four parsers of one shape is the house pattern
  here (each end reads the file, and the browser cannot import node modules), but say so if you think
  one of them has earned its way out.

**You may fix what you find inside this stage** (`--sandbox workspace-write`) and report anything
wider for me to decide. If you change code, say exactly which files and why in the answer, so I can
read your diff before running the gates.

Gates as of this prompt: `npm run typecheck` clean; the full suite is running and I will report it.

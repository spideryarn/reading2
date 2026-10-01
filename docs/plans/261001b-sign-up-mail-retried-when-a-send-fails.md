# A sign-up mail that fails to send is tried again

[SPIDERYARN-READING2-79](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-79), Greg (admin):

> It looks like we've had at least one signup (from Cody Dong) - but I don't think I received an
> email notifying me

The feature is 6T, [260930i-email-admin-on-sign-up-and-plan-upgrade.md](260930i-email-admin-on-sign-up-and-plan-upgrade.md).

## What happened to Cody's mail: nothing went wrong

Read from production, read-only, on 2026-10-01:

- Cody's account (Google) was created at **17:42:31.918270Z on 2026-09-30**. There has been no
  sign-in since.
- The deploy that first applied `20260930144303_reader_arrivals` and shipped the sign-up code
  (`e3074a82`, log `logs/tmux-jobs/deploy-0930h-1847-439990.log`) **started at 17:47Z**, five
  minutes later. The deploy before it (`0930g`) applied two other migrations; `reader_arrivals` did
  not exist yet.
- Cody's row in `reader_arrivals` has `first_seen_at = 2026-09-30 17:42:31.91827+00`, **equal to
  his account's `created_at` to the microsecond**. The app's insert takes `now()`, which could not be
  earlier than his sign-in 377 ms later; only the migration's backfill copies `created_at`. So the
  migration found him already there and counted him as an existing reader — which is what it is for.
- Production currently has three accounts: Greg's two and Cody's, and none was created since the
  deploy. That means no surviving account should have caused the sign-up mail. Current tables cannot
  rule out a post-deploy account that was later deleted, because its arrival row would be deleted
  with it. Vercel has `RESEND_API_KEY` for production, and neither deployment since has logged a
  warning or an error.

GPT Sol checked this conclusion against the code and the deploy logs and agreed
([261001b-sign-up-mail-retried-when-a-send-fails-evidence-review-sol.md](261001b-sign-up-mail-retried-when-a-send-fails-evidence-review-sol.md)).

## What this changes anyway

Sol's check found a way the next sign-up *could* go silent. `noteArrival` writes the ledger row, then
calls `announceArrival`, and ignores what it returns. `sendEmail` never throws — a Resend 5xx, a
timeout or a missing key comes back as `{ kind: "failed" }` or `{ kind: "skipped" }` — so a failed
send leaves the row in place, and every later request finds "already arrived". **One bad minute at
Resend and the admin never hears about that reader.**

The fix: when the announcement did not go out, **give the claim back** — delete the ledger row this
request inserted and forget the account in this instance's cache — so the reader's next request tries
again. "Did not go out" is `failed`, a thrown error, or `skipped` for any reason but
`"not production"` (a production process with no key is a misconfiguration; a laptop is not). The
type of `announce` becomes `Promise<SendResult>`, so the seam cannot return something the check
cannot read.

`SkipReason` becomes a closed union in `src/email.ts`, and `announced()` in `src/arrivals.ts`
switches over it exhaustively, so a new reason is a type error rather than a silent guess.

**What it is, honestly** (GPT Sol, plan review,
[261001b-…-review-sol.md](261001b-sign-up-mail-retried-when-a-send-fails-review-sol.md)):

- **Duplicates are possible; this is not exactly-once.** A send that timed out after Resend accepted
  it is released and may be sent again. For a mail to the admin, a duplicate is far better than a
  silence.
- **Best-effort retry, not a guarantee.** An instance that lost the insert race has the account in
  its own cache and will not retry it for that instance's life; a release that itself fails may
  leave the row, and is logged at error. Either needs a failed send *and* a second fault.
- **Cost.** While Resend is down, successive requests from that one new reader can try again after
  the prior attempt releases its claim, off the response path (`afterResponse`), at up to the
  10-second send timeout each. Requests during an attempt are suppressed by the cache; a fast
  failure has no backoff. One reader, for the length of an outage.

The dependable version is the `announced_at` lease below. Sol noted it needs no scheduler if
requests claim expired leases themselves; it still needs a migration and more states, which is more
than one rare double fault is worth today.

## Simpler options passed over, and what is left

- **Explain and change nothing.** Cody's silence was correct, but the failure above is a real way to
  lose the next one, and the fix is a few lines.
- **Separate "first seen" from "announced"** (an `announced_at` column and a retry sweep). That also
  covers a process killed between the insert and the send, and the two double faults above — but it
  needs a migration, a lease and a pending state. The residual crash requires the process to die
  after the insert and before the failure cleanup; `afterResponse` asks Vercel to keep the function
  alive, but cannot make that impossible. Left named, not built.
- **Delivery, not acceptance.** A 2xx from Resend is not an inbox. Resend's dashboard shows delivery;
  a bounce webhook is more than this needs.

## For Greg

The one thing no code can prove is the whole path — Resend, then the `hello@` forwarder, then your
inbox. **A test sign-up** (a `+alias` address, confirmed, then one page load) would show it end to
end; the test account can be deleted in Supabase afterwards.

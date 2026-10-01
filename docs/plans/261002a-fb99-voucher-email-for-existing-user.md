# The gift voucher email: an existing reader is told their slots before and after; anyone else is invited

Report `spya-f02640` (SPIDERYARN-READING2-99). Follows
[261001p](261001p-voucher-emails-to-recipient-and-creator.md), which built the voucher emails, and
[261001m](261001m-gift-vouchers-for-free-articles.md), which built the vouchers. Up:
[email.md](../project/email.md), [billing.md](../project/billing.md).

> we want to be able to create gift vouchers both for a) existing users that will give them extra
> credit (whether or not they're already subscribers); and b) users that don't yet exist, in which
> case they'll receive an email inviting them. […] It probably does make sense for them to be
> distinct because I guess the new user, you're trying to kind of convince them to sign up and
> explain a bit about what Spidey Yarn is and whatever. And then with an existing user, it's a bit
> more about trying to tell them how many available article slots they now have, like before and
> after the gift voucher. […] I did not receive an email to that email address, and I believe it's
> an existing user.
>
> — Greg, 2026-10-01

## Why no email arrived: the voucher is older than voucher emails

Not a bug in the sending, and not about existing users. Read from production (read-only,
2026-10-02):

- Greg's voucher (20 articles) was created at **19:00:02 UTC** on 2026-10-01, on build `6bdf24dc`,
  and claimed by his existing account at **19:03:14**, eleven seconds after he filed the report.
- Voucher emails (261001p) were committed from 20:04 that evening (`374ea318a`, `b743dd3b9`,
  `b68513105`) and reached production in the deploy of ~20:39. None of the three is an ancestor of
  `6bdf24dc`.
- `billing_voucher_emails` in production is **empty**: no voucher has been created since, so no
  email has been queued. That table is also the control: any email the code had queued would have
  left a row, in whatever status (`queued`, `sending`, `sent`, `skipped` or `failed`).
- Production's Vercel environment does have `RESEND_API_KEY` (production target, checked by name
  only), so the send gate would not have stopped one either.

So the build he used had no code that sent a voucher email at all. Nothing to recover for that
voucher: it is already claimed, a gift email to it is no longer retryable by design, and its claim
predates the creator's notice too. The next voucher he creates will be the first real test of the
send.

**What is still wrong today** is what he asked for second: the email that would go out now is one
invitation for everybody — *sign in, or create an account, with this same address* — which is the
wrong letter for somebody who already reads here, and tells them nothing about their slots.

## What we are building

At create (and at a real address change, which queues a fresh gift email), **before** the
transaction, the server asks the Auth service whether a reader with that address exists, and if so
what their plan looks like now. The email queued in the transaction is then one of two:

1. **An existing reader** (exactly one live account whose address, trimmed and lower-cased, is the
   voucher's — decided among *all* accounts first, so two with the address are ambiguous even if
   only one confirmed it (Sol F2) — and that one with `email_confirmed_at` set, the confirmation the
   claim requires):
   - On Free (lapsed included): *You had **R** articles left on your free allowance. With this gift
     you have **R′**.* R and R′ are `ingestHeadroom` over `wallUsed` against the budget without and
     with the N articles — the same arithmetic as the wall and the admin page's *how used* column,
     so the email cannot promise a number the wall will not keep. Other gifts already waiting at
     that address go into R′ too, and the email says so, because the next visit claims them all in
     one `UPDATE` (Sol F5).
   - On a paid plan: *You are on a paid plan, so you do not need them today: they stay on your
     account and count whenever you are on Free.* (Billing.md: a gift counts on Free only.)
   - Plan unreadable (`unknown`): the existing-reader email without the numbers.
   - The button says **Open Spideryarn** and goes to `/`; the gift is claimed when they next open
     it signed in, which is what `/` does (`GET /api/billing/usage`).
2. **Anyone else** — no account, an unconfirmed one, more than one match, or the lookup failed: the
   invitation that exists today, which explains Spideryarn and says *sign in, or create an account*.
   It is correct for an existing reader too, only less useful, which is why it is the fallback for
   any doubt.

The admin learns nothing new on the page; the email is frozen in the row as before, so
`/admin/vouchers` and Retry are unchanged.

### Privacy

The existing-reader email states the reader's own remaining allowance, and goes to the address
their account has confirmed — which is why a confirmed, unambiguous match is required. That puts
usage-derived data in Resend's log and the reader's inbox, so **`/privacy` says so** (Sol F4): one
clause on the Resend entry, `LAST_UPDATED` moved, a section in privacy.md, and a test holding the
clause. No note, creator or voucher id, as before; the test that pins that covers the new letter.

## What defences it rests on, and edits none of

The claim (`claimVouchersFor`), the wall and the admin gate are untouched. But this is a new
cross-owner read, so it **rests on** two defences (Sol F3): the admin namespace gate in front of
`/api/admin/` ([security-map.md](../project/security-map.md)), and `authAdminEndpoint`'s refusal to
read one project's accounts against another's database. The lookup goes through
`authAdminEndpoint` and the count-checked `listAccounts`, as `/admin/users` does, rather than a fetch
of its own; a mismatch throws there, and the answer to that is the invitation, before any billing
read.

### A Retry after a claim (Sol F1)

The existing rule refused a gift email's Retry once its voucher was claimed. For an existing reader
that makes nearly every failure permanent: they claim the moment they next open Spideryarn, usually
before anybody has looked at the Status cell. **A gift Retry now needs only an unrevoked voucher still
at the address the email was frozen with**, claimed or not. A `sent` email is still never retried,
so this cannot send a second copy of a delivered one. This is the at-most-once outbox's predicate,
not a security check.

## How the lookup works, and what it costs

`listAccounts(gotruePages(...))` — the paged, count-checked list `/admin/users` uses — filtered to
the address. With the number of accounts we have it is one request. It runs in the admin's request,
before the transaction (a network call does not belong inside one), behind a five-second deadline
whose `AbortSignal` is handed to every page fetch, so the request itself is cancelled rather than
abandoned (Sol F6); a throw or timeout means *anyone else*. An admin's create gets a little slower; nobody else's request is
affected.

The before/after numbers are as of the create. If the reader adds an article between the email and
reading it, the email is one off; it says *had* and *have*, as of the gift.

## Simpler options passed over

- **One email for both, with a line for existing readers** (*already have an account? they are
  added next time you open Spideryarn*). Fewest parts, but Greg asked specifically for before and
  after, and a reader of ours being invited to "create an account" reads as if we did not know
  them.
- **Deciding at send time instead of at create.** The request is frozen at queue time so a retry is
  byte-identical for Resend's idempotency key (261001p, Sol review 2); deciding later would mean
  re-rendering on retry, which breaks that.
- **Looking the address up with a GoTrue filter** (`?filter=`) rather than the full list. Fewer
  bytes, but it is an undocumented substring match, and the full list is the one already checked
  against its own count.

## Deferred

- Two accounts for one address (e.g. email and Google, unlinked): treated as doubt, so the
  invitation. Telling such a reader their numbers would mean choosing an account for them.
- Two vouchers to one address created at the same moment each count only the waiting gifts that
  had committed before them.

## Testing

Red first, against Postgres, with the account lookup injected (no Auth service, no Resend).

- A create for a confirmed existing reader on Free sends the existing-reader email, with R and R′
  (3 and 23 for a fresh account and 20 articles); the wall's edge (at budget, and with a half-price
  public add) in the message itself; a gift already waiting counted in R′, from the database.
- A paid reader gets the paid wording; a plan that cannot be read gets no numbers.
- The lookup itself, through real pages and `listAccounts`: case and spaces, unconfirmed, nobody,
  two accounts (one or both confirmed), a short listing, a refusal, and the deadline aborting the
  page fetch.
- None, several and unavailable each queue the invitation.
- An address change to a reader's address queues the reader's email, and with a new count, uses it.
- A claimed voucher's failed gift email can be retried, and is sent.
- Neither message carries the note, creator or voucher id; `/privacy` holds the new clause.

## Stages

1. Server: the lookup, the second message, the wiring in create and update, tests.
2. Docs (email.md, billing.md), the Sol code review, gates, push, the feedback note.

## Log

- 2026-10-02: plan written. Prior-work check: 261001p (the email itself, landed and deployed
  2026-10-01) is the only neighbour; no session is running on vouchers.
- 2026-10-02: GPT Sol plan review ([answer](261002a-fb99-plan-review-sol.md)): *build with
  changes*; it confirmed the diagnosis (`6bdf24dc` predates `374ea318a`). Seven findings, all taken
  and folded in above: F1 Retry after a claim; F2 ambiguity before confirmation; F3 the defences it
  rests on, named; F4 `/privacy`; F5 waiting gifts in R′; F6 a real abort and tests through the
  pages; F7 the status wording in the diagnosis.

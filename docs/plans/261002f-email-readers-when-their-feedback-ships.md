# Email a reader when their feedback ships

Report `spya-mmhrnw`, from Greg (an admin, so trusted, and proved by `feedback-reporter.ts`, exit 0):

> When someone (other than an admin - I will already be aware) has submitted a Feedback report that
> gets shipped & deployed, send them an email to let them know their feedback is now live!
>
> — Greg, 2026-10-02

## What exists already

- **Which reports have shipped** is already a fact the code knows: a note in `docs/user-feedback/`
  with `ending: shipped`, compiled by `scripts/feedback-endings.ts` into
  `src/feedback-endings.generated.ts`. The Earlier tab reads that map, so a report reads as shipped
  on production **once the commit carrying its note is deployed** (`feedback.md` § Shipped or not).
- **Sending mail** is `sendEmail` in `src/email.ts`: never throws, only production sends unless
  `SPIDERYARN_EMAIL_SEND=1`, an optional `idempotencyKey` that Resend honours for 24 hours.
- **Deploying** is `npm run deploy` (`scripts/deploy.ts`), run only by the Overseer. It already reads
  `.env.prod` and connects to the production database as `postgres` for the migration step.
- **Who is an admin** is `isAdmin(ownerId)` in `src/admin.ts`.

Measured 2026-10-02, read-only on production: **no report has yet been filed by anyone but an
admin**, and no report id is shared by two owners. So when this ships it will email nobody until a
reader files a report and it ships, and there is no backlog to decide about.

## Why a reader may be written to

The brief said to check the feedback row's `consented` column. That column is
`diagnostics_consented` — the "send extra diagnostics" tick-box — and is about *what the report
carries*, not about being written to, so it is the wrong gate. A reader who did not tick it still
wants to hear that their idea shipped.

This is not a consent question at all; it is a **service message about the reader's own report**,
not marketing (ICO: a neutral customer-service message is not direct marketing). The reader expects
a reply of some kind: the Feedback button's hover card says *"It carries this page's address and
your email address, **so we can write back**"* — though only a reader who hovered saw it, so it is
supporting evidence, not proof of notice. The notice is `/privacy`, which lists every kind of mail
we send and gets one clause for this one (below). The email quotes nothing the reader wrote.

**Not done, for Greg to decide:** a sentence in the thank-you toast, *"If we change something
because of it, we will email you when it is live."* The dialog itself is out: Greg removed the
second sentence under its thanks on 2026-09-30, and the toast is gone in a few seconds.

## The trigger: a step at the end of `npm run deploy`, reconciling a ledger

```
npm run deploy
  preflight → gates → migrations → push sha to main → wait for Vercel → verify → logs
                                                                                  │
  NEW, only if the code is live and verified ─────────────────────────────────────┘
  "feedback shipped emails"
    1. the shipped ids in src/feedback-endings.generated.ts at the commit just deployed
    2. production, one query: every feedback row with one of those ids, its owner's current
       confirmed address (auth.users), and its row in the new ledger, if any
    3. a letter for each row that is not an admin's, whose id no second owner shares, that has an
       address, and whose ledger row is absent or `failed`
    4. for each: reserve (insert/update the ledger row to `sending`), send with an opaque, stable
       Idempotency-Key derived from the owner and report ids, then mark `sent` or `failed`
    5. print counts and ids — never an address
```

**`spideryarn.feedback_shipped_emails`**, one row per report emailed: `(owner_id, report_id)` primary
key and foreign key to `feedback` (cascade), `status` in `sending | sent | failed`, `attempts`,
`detail` (an error name, ≤ 200 characters), timestamps. Additive; the deploy applies it.

Why this shape, after GPT Sol's plan review (below) rejected the first draft:

- **Reconcile, don't diff.** Every deploy asks "which shipped reader reports have no `sent` row?",
  so a deploy whose verification failed, a crash halfway through the letters, or a deploy made some
  other way is caught up by the next `npm run deploy`. No "which commit was live before" question,
  which the first draft got wrong.
- **One email per report**, so the idempotency key is one report's and never changes with what
  else shipped alongside it. It hashes the two internal ids rather than sending them to Resend.
  Two reports in one deploy is two short emails; rare enough.
- **Only a definite failure is retried automatically.** `failed` (Resend refused, or no key) is
  retried on the next deploy. A send that may or may not have gone (the request threw) stays
  `sending` with its detail, and so does a crash between reserve and complete; both are printed
  every deploy as needing a person, because a retry more than a day later could send a duplicate.
  Resend's two idempotency-conflict responses are ambiguous too, rather than definite failures. The
  re-run for a person is the CLI below with `--retry <owner_id>/<report_id>`; a fresh reservation
  cannot be taken as a retry, while an interrupted one becomes eligible after ten minutes.
- **After verification**, because the email says "now live" — the same moment the Earlier tab says
  *shipped*.
- **The current confirmed address from `auth.users`**, not the row's `reporter_email` snapshot.
  `reporter_email` stays what the schema says it is — the address the reader had when they wrote —
  and this table never copies an address. Skipped: no confirmed email (`email_confirmed_at`, not
  `confirmed_at`, which phone confirmation also sets), a deleted account (`deleted_at`), and a banned
  one (`banned_until` in the future), the last deliberately: we do not write to an account we
  barred.
- **Its failure is an after-the-fact failure.** The step's name joins `AFTER_THE_FACT_CHECKS`, so a
  failed send turns the deploy red and is listed but never triggers the rollback advice, and the
  summary's line for that case names the failed checks instead of assuming they were the log's.
- **Two guards against a mass mailing.** The map parser throws on any line naming a report it does
  not understand, and on finding none. And more than **20** letters in one run sends nothing and says
  so; the CLI takes `--cap <n>` for a person who has looked and wants the run.
- **The CLI**, `npx tsx scripts/feedback-shipped-emails.ts [--sha <commit>] [--send] [--cap n]
  [--retry <owner>/<report>]`, runs the same reconcile against production. Without `--send` it is a
  dry run that reads only.

### Alternatives passed over

- **Diff the map between the commit that was live and the new one, no table** — the first draft.
  No migration and no production write, but it cannot say which commit was live once a push has
  failed to promote, and it loses a letter whenever the step does not run or dies part way. GPT
  Sol's P1s, and right.
- **The server sends it** (on the next request after a new build, comparing the bundled map with
  the ledger). It would fire on a deploy not made by `npm run deploy`, but there is no request to
  hang it off on a quiet day and no scheduler (`cron-scheduler.md`).
- **The report session sends it when it writes its note.** Wrong moment: that is "on dev", not
  "live".
- **A button on `/admin/feedback`.** Simple and safe, but Greg asked for it to happen by itself.

## The email

Plain text, from `Spideryarn <hello@spideryarn.com>`, so a reply reaches Greg. **No quotation of the
report**: the reader knows what they wrote, the Earlier tab shows it, and each copy of their words in
Resend's log is one more place an erasure must reach. The date it was filed is there so the reader
can tell which report this is; in London time, so an overseas reader may see the day before or after.

> **Subject:** A change based on your feedback is now live on Spideryarn
>
> Hello,
>
> On 2 October you sent us a suggestion through the Feedback button in Spideryarn. We've shipped a
> change in response to it, and it is now live.
>
> Thank you. Reports like yours are how Spideryarn gets better.
>
> You can see what you've sent us, and which of it has shipped, under Feedback → Earlier.
>
> If it isn't quite what you had in mind, just reply to this email.
>
> Greg
> Spideryarn

The first sentence follows the kind: *a problem* → "you told us about a problem through …"; no
kind → "you sent us feedback through …". "Shipped a change in response to it", never "fixed" or
"built", because a shipped ending may be a narrower or tweaked version, and a split report counts
as shipped when one of its parts did.

**For Greg to change freely**: the signature, and the words. They are one function,
`shippedEmail`, whose test pins the shape rather than every word.

## `/privacy`

One clause in the Resend paragraph, after the gift sentence:

> If you send us feedback through the Feedback button and we act on it, we email you once the
> change is live; that email does not quote what you wrote.

And `docs/project/privacy.md` gets a short section saying the same, with this plan cited.

## Where the code goes

- `src/db/schema.ts` + a generated migration — the ledger table.
- `scripts/feedback-shipped-emails.ts` — the pure parts (parse the map, plan the letters, compose),
  the reconcile (`runShippedEmails`, over an injected database client and `send`), and the CLI.
  A script, not `src/`, because only the deploy and an operator run it.
- `scripts/deploy.ts` — call it after `readLogs` when `!codeMayNotHaveShipped(failures)`, with the
  map read from the deployed commit; it opts in to sending with an explicit `env` handed to
  `sendEmail` (`RESEND_API_KEY` from `.env.prod`, `SPIDERYARN_EMAIL_SEND=1`) rather than mutating
  `process.env`. `--dry-run` never reaches it. The summary's after-the-fact line is generalised.
- `scripts/deploy-checks.ts` — the step's name in `AFTER_THE_FACT_CHECKS`.
- Tests: the pure parts with fakes; the reconcile against the local test database, with
  `auth.users` rows that are confirmed, unconfirmed, deleted and banned, an admin, a shared id, and
  the ledger's `sent`, `failed` and stuck `sending` states. Sends go to a fake;
  `tests/setup/provider-guard.ts` already refuses Resend at the network.
- Docs: `email.md` § Feedback that shipped; a line each in `feedback.md`, `feedback-reports.md`
  and `deployment.md`; `privacy.md`.

**Testing sends nothing to a reader.** The suite uses fakes and a private database. One manual
check: a dry run of the CLI against production, where every shipped report is Greg's and so every
one should be skipped as an admin's — which is itself the check that the admin filter works.

## Deferred, by name

- **An opt-out.** One email per shipped report, to somebody who wrote to us, with a reply address.
  If a reader asks to stop, it becomes a column; until then, Greg replies.
- **A view of the ledger on `/admin`.** The deploy prints it; the table can be read.
- **"Declined" and "awaiting" emails** — Greg asked for shipped.
- **HTML** — this is a short reply and plain text reads as one.
- **The toast sentence** above.

## Review log

### GPT Sol, plan, 2026-10-02 ([findings](261002f-email-readers-when-their-feedback-ships-plan-review-sol.md))

Verdict: revise before build. No P0. What changed:

- **P1, `origin/main` is not necessarily the live commit**, and **P1, a diff plus a 24-hour key
  can lose or double a letter.** Both accepted; the diff is gone, replaced by the ledger and
  reconcile above, one email per report.
- **P2, the guards.** A grouped key could pass Resend's 256-character limit (gone with grouping); a
  cap with no override could not be got past (`--cap`); the parser already refuses any unreadable
  line naming a report, which covers partial drift.
- **P2, the deploy summary would call an email failure "log verification inconclusive".**
  Accepted; the line names the failed checks.
- **P2, "every reporter has seen" the hover card was false.** Accepted; the section above no longer
  calls it consent. Its suggestion of a sentence in the dialog is not taken, for the reason given
  there, and is offered to Greg as a toast sentence.
- **P2, the subject and "fixed" overclaimed.** Accepted: the new subject and "shipped a change in
  response to it"; the changelog link is gone. The date stays, so the reader can tell which report.
- **P3, the address policy and `reporter_email`.** Accepted as wording: this table never copies an
  address, and banned accounts are skipped on purpose.

### GPT Sol, code, 2026-10-02 ([findings](261002f-email-readers-when-their-feedback-ships-code-review-sol.md))

Run with `--sandbox workspace-write` on commit `630cc665e`; it fixed all seven of its findings in
place, and I read the diff before committing it. Two P1s: a malformed `--retry` could have widened
into a broad `--send` (now strict argument parsing), and Resend's idempotency-conflict answers were
being retried automatically (now left `sending` for a person). Five P2s: a fenced retry with a
ten-minute lease and a check that the completion actually landed; shipped ids with no row are now
printed; an ineligible `--retry` exits non-zero; the idempotency key is a hash rather than the raw
ids; the deploy summary's after-the-fact line no longer contradicts a forced gate.

Its sandbox could not reach local Postgres, so it could not run the ledger tests it added. I ran
them afterwards: the private-postgres lane, ledger and schema-drift files, 31 passed. Before that,
the ledger test was shown to go red with the deleted-account filter removed from the SQL. Two reds
from the full suite were mine and are fixed: `db-schema-drift` needed the new table counted (43),
and `fixture-ids` caught the pure test reusing two uuids from `upload-records.test.ts`.

**Not exercised for real**: no email was sent, and the CLI could not be dry-run against production
because the ledger table only exists there once the deploy applies its migration. The first draft's
dry run against production (before the ledger) did run, over 2026-10-01→now, and skipped all 37
newly shipped reports as an admin's — every report so far is Greg's. The first real email will be a
reader's first shipped report.

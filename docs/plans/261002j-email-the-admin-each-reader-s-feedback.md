# Email the admin each reader's feedback

Report `spya-wwx6ks`, from Greg (admin), 2026-10-02, on `/read/entropy-…?mode=citations`:

> Anytime someone submits feedback that isn't from me, the admin, please send me an email with their
> feedback.
>
> — Greg, 2026-10-02

## What exists already

- **Filing a report** is `fileFeedback` in `src/routes.ts`: the row is written first
  (`feedbackStore.submit` → `created` | `duplicate` | `limited`), then only a `created` row is
  mirrored to Sentry, after the reader's response has gone out.
- **Sending mail to us** is `notifyAdmin` in `src/email.ts` — plain text, never throws, only
  production sends, the address is `SPIDERYARN_ADMIN_EMAIL` or `hello@spideryarn.com`. `oneLine` and
  `noteText` make a reader's text safe for a plain-text mail. The sign-up notice
  (`src/arrivals.ts` § `arrivalMessage`) is the shape to copy.
- **Who is an admin** is `isAdmin(ownerId)`.
- **A cross-instance cap with a global fuse** already exists: `src/store/pg-rate-limit.ts`, the
  `rate_limit_events` table the paid features use.
- **The reader's address is already shown to the admin**: `/admin/feedback` prints
  `report.reporterEmail` (`AdminFeedbackList.tsx`), and the sign-up notice mails it to us at Greg's
  request (261001b). So the mail carries it.
- Measured by 261002f today: **no reader but an admin has filed a report yet.** Volume is ~0.

## The change, as built

GPT Sol's plan review ([the review](261002j-email-the-admin-each-reader-s-feedback-plan-review.md))
changed four things in the first draft, marked **[Sol]** below.

1. **`src/feedback-notice.ts`** (new):
   - `feedbackNoticeMessage(report, ownerId)` — pure, returns `{ subject, text }`.
     - **Subject** is fixed text plus the closed-vocabulary kind: `New feedback on Spideryarn
       (problem)` / `(suggestion)` / no suffix when unset. Nothing the reader typed.
     - **Body**: report id, kind, filed time, page URL, slug, the reader's address and account id,
       whether diagnostics were consented and a screenshot attached, then the reader's words, then
       a link to `/admin/feedback` and a sentence saying the cap exists.
     - **The reader's words are untrusted text.** Plain text only (no `html` part, so nothing to
       escape *into*); `noteText` for controls and line breaks; **bidi controls removed [Sol]**,
       because `noteText` and `oneLine` keep them; every line quoted with `> ` so it cannot pass as
       one of our lines; **links defanged, best effort [Sol]** — `scheme://` → `scheme[:]//`,
       `mailto:`, `javascript:` and a few more → `mailto[:]`, `www.` → `www[.]`. A bare domain may
       still be autolinked by some client, and the code says so rather than claiming inertness.
     - **The page URL [Sol]**: on our origin it is `new URL(url).href`, never the stored string —
       `isWebUrl` checks the parsed protocol and the row keeps the raw spelling, so an address
       starting with our origin and followed by a line break, a forged `Account id:` line and a
       second address was storable and would have printed all three. Any other origin is printed
       defanged.
   - `noticeFeedback(report, ownerId, { allowance })` — skips admins (`isAdmin`), takes a slot from
     the allowance, sends with `notifyAdmin`, frees the lease. Never throws. An allowance that
     cannot be read sends anyway (logged), since missing a report is the worse mistake at this
     volume.
2. **`fileFeedback` [Sol]**: on `created`, starts `noticeFeedback` right after `send`, beside the
   Sentry mirror, and awaits both. Not `afterResponse`: that starts a task only when the route
   function returns, which is after Sentry's acknowledgement, so a slow Sentry would hold the mail.
   Starting it here also keeps it in the reader's owner scope, which the allowance counts by. A
   `duplicate` (a retry) and a `limited` send nothing.
3. **`ADMIN_FEEDBACK_PATH` / `ADMIN_FEEDBACK_URL`** in `src/urls.ts`, and the router's
   `ADMIN_FEEDBACK_HREF` reads it, as `ADMIN_USERS_*` already do.
4. **`/privacy`**: the Resend entry gains a clause — when you send feedback, we email ourselves a
   copy with what you wrote, the page address and your email address. `tests/privacy-page.test.ts`
   holds it. `LAST_UPDATED` already reads 2 October 2026.
5. **A `feedback-notice` bucket** in `rate_limit_events` — an additive migration widening its CHECK.
6. Docs: `email.md` § Mail the server sends itself, `feedback.md` (a third destination),
   `privacy.md` (a dated section).

## What caps a burst

- **Per reader, already:** `FEEDBACK_HOURLY_CAP` = 30 reports an hour, and a retry sends nothing.
- **Not enough on its own**: Resend's free plan allows 100 emails a day (resetting at midnight UTC)
  and **auth mail shares that quota** (email.md). One reader at their hourly cap would exhaust it in
  under four hours and stop sign-up confirmations and password resets.
- **So `FEEDBACK_NOTICE_POLICY`: 20 mails a rolling day across every reader, 5 from any one [Sol].**
  The first draft counted *reports filed* in the last 24 hours and skipped once past 20. Sol showed
  that loses a whole burst: 21 reports commit before any of their notices runs, every notice reads
  21, and none is sent — not even the one meant to say the cap was reached. The shared rate-limit
  table already does this right: it counts **mails attempted**, under an advisory lock, with a
  global fuse. So the notice takes a slot from a new bucket there, and the draft's cross-owner count
  in `pg-admin-feedback.ts` was dropped before it landed. Every mail now says the cap exists,
  instead of a "this is the last one" line that a concurrent burst could not get right.
- **This is a cap on mail, not on reports.** Greg asked for *every* report; past the cap a report is
  still filed, mirrored to Sentry and listed on `/admin/feedback`, but not mailed. At today's volume
  it will not bite; if it does, the numbers are one constant.
- **A failed send is not retried** (as with the upgrade notice). The row is the record.

**The simpler option passed over:** no global cap, relying on the per-reader hourly cap. Its failure
mode is silent and lands on the wrong people (readers who cannot confirm their sign-up), and the
machinery for a correct cap already existed.

## Tests (each seen red first)

- `tests/feedback-notice.test.ts`: subject carries no reader text; body has id, kind, URL, address,
  account id and the words; CR/LF, U+2028 and a forged `Account id:` line come out quoted; links
  defanged and `Note:` left alone; a foreign page inert; **both of Sol's our-origin URLs** print as
  one token (red with the raw spelling); bidi controls removed; admin → no send and no allowance
  spent; allowance refused → no send; allowance unreadable → sends; a throwing send → `failed`,
  lease still freed.
- `tests/feedback-route.test.ts`: `created` → notice once, after the response, **before Sentry
  acknowledged** (red when the notice waited on the mirror); `duplicate` and `limited` → none.
- `tests/fetch-allowance.test.ts`: the real bucket against Postgres gives one reader five and
  refuses the sixth — the check that the migration ran, since a refused bucket would otherwise be
  read as "allowance unreadable" and send anyway.
- `tests/privacy-page.test.ts`: the new clause.

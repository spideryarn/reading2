# The admin's sign-up and upgrade emails carry the reader's address

Up: [plans.md](../project/plans.md) · Report: SPIDERYARN-READING2-6T (follow-up) · Follows:
[260930i](260930i-email-admin-on-sign-up-and-plan-upgrade.md) · Owner doc:
[email.md](../project/email.md)

> Yes, please include the newly-signed-up user's email address in the email to me, and include a
> link to the /admin page that lists all the users
>
> — Greg, 2026-10-01 (relayed by the Overseer)

**Status: built, on `dev`, not deployed.** No migration.

This reverses one decision in 260930i: *"No address, deliberately"* (GPT Sol, plan review — each
copy of an address in Resend's log, the forwarder and an inbox is one more place an erasure must
reach). Greg has weighed that and chosen the address. The cost stays true, so /privacy says it.

## What changes

1. **Sign-up email** (`announceArrival`, `src/arrivals.ts`) gains `Email: <address>`. The address is
   `user.email` from the **verified** JWT claims (`requireUser`, `src/auth.ts` — not edited), handed
   through `noteArrival(user.id, user.email)` at its one caller in `src/routes.ts`. No lookup.
2. **Upgrade email** (`notifyUpgrade`, `src/billing/sync.ts`) names the reader the same way, so it
   gets the same line. The sync runs from a webhook with no user in hand, so the address comes from
   the Auth Admin API, `GET /auth/v1/admin/users/{id}` (`accountEmail`, in
   `src/store/admin-accounts.ts`) — the same service-role key and the same `SUPABASE_URL` +
   project-mismatch check `/admin/users` already uses, now `authAdminEndpoint` in that file so both
   share it and billing never imports the assembled `pg-admin.ts`. **A failed lookup never stops the
   mail**: it has a 5-second timeout, checks the answer is about the account asked for, never
   throws, and the line says the address could not be looked up.
3. **Both links become `https://www.spideryarn.com/admin/users`** — the page that lists every user
   (`ADMIN_USERS_PATH` in `src/urls.ts`, which the router's `ADMIN_USERS_HREF` now re-uses, so
   there is one spelling). The old link was `/admin`, the index of the admin pages, which is one click
   short of it. There is no per-reader page to link to; the account id stays in the mail to find the
   row.
4. **The address is untrusted text.** The mail is plain text (`src/email.ts` sends `text` only), so
   there is no markup for it to become. What it could still do in plain text is forge lines — a
   newline inside it could draw a fake "All users:" link underneath. So `oneLine` in
   `src/email.ts` replaces every `Cc` control character and U+2028/U+2029 with a space and caps it
   at 254 code points, ellipsis included (a display bound, not a protocol limit), and it goes in
   the **body only, never the subject**. A mail client may still auto-link something
   address-shaped as `mailto:`; that is the client's choice and pointing at the reader's own address
   is harmless.
5. **/privacy**, the Resend entry: the first time you use Spideryarn after signing up, and whenever
   you move to a bigger plan, we email ourselves a note with your address and account id (and the
   plans), through Resend, then Namecheap's forwarding, to our own inbox. The whole route, because
   each hop is a copy. `tests/privacy-page.test.ts` holds the sentence. The session that was
   editing /privacy (fb61b) had finished, so this edits it directly.
6. **Docs**: email.md's "Neither carries the reader's address" paragraph is replaced with what they
   now carry and why; privacy.md gets a dated section; 260930i gets a pointer forward.

## Simpler option passed over

**Only the sign-up email, and leave the upgrade one alone.** Zero new I/O. Passed over because the
brief asks for both if they name the reader the same way (they do), and an upgrade is the moment
Greg most wants to know who. The lookup reuses existing machinery and a credential already in
production, and it cannot fail the mail.

**Storing the address in `reader_arrivals`** so the upgrade could read it from Postgres: passed over
— a second copy of the address in our own database, stale on an address change, and another place
an erasure must reach.

## Tests

- `tests/reader-arrivals.test.ts`: the announce seam receives the address; the body carries it and
  `/admin/users`; a newline in the address cannot start a new line (seen red with `oneLine`
  removed).
- `tests/admin-notice-address.test.ts`: the real request `accountEmail` sends (URL, both headers, a
  signal); refusal, non-JSON, another account's answer (seen red with the id check removed), no
  address, timeout and missing configuration all `unavailable`; the upgrade body found and not
  found; `notifyUpgrade` still reaches `sendEmail` when the lookup fails; `oneLine` on CR, LF,
  U+2028/9 and a long non-BMP string.
- `tests/privacy-page.test.ts`: the new sentence.
- Final checks: those suites, `npm test`, `npm run typecheck`, lint on touched files.

## Reviews

- Plan: GPT Sol, [review-sol](261001b-admin-sign-up-email-carries-the-address-review-sol.md) —
  proceed with changes. Taken: bound and test the real lookup; describe the whole mail route on
  /privacy and in privacy.md, with accurate timing; keep billing off `pg-admin.ts`; share the
  `/admin/users` spelling through `src/urls.ts`; code-point truncation; status line and checks.

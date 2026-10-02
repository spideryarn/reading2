---
reports: spya-f02640
ending: shipped
---
# Gift-voucher email never reached an existing user

[SPIDERYARN-READING2-99](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-99), a problem
reported by Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0) from `/admin/vouchers`
on build `6bdf24dc`. The time in the file name is the feedback row's `created_at` (19:03:05Z), in
London time.

> I tried adding a voucher for [an address]. I think I already have a user created for them because
> we want to be able to create gift vouchers both for a) existing users that will give them extra
> credit (whether or not they're already subscribers); and b) users that don't yet exist, in which
> case they'll receive an email inviting them.
>
> Actually, in both cases, they'll receive an email telling them they've been provided with a gift
> voucher. Ideally, I guess for simplicity, it'd be the same email each time, but maybe it makes
> sense to have them be distinct if it's a new versus existing user.
>
> It probably does make sense for them to be distinct because I guess the new user, you're trying to
> kind of convince them to sign up and explain a bit about what Spidey Yarn is and whatever. And then
> with an existing user, it's a bit more about trying to tell them how many available article slots
> they now have, like before and after the gift voucher.
>
> Anyway, I did not receive an email to that email address, and I believe it's an existing user. So
> can you look into the email sending for gift vouchers?

**Ending: Shipped** to `dev`, needs a deploy, no migration. Plan, evidence and both GPT Sol reviews:
[261002a](../plans/261002a-fb99-voucher-email-for-existing-user.md).

**Why no email came:** the voucher was made at 19:00Z on 2026-10-01, on a build from before voucher
emails existed (they were built from 20:04 and deployed about 20:39). Production's
`billing_voucher_emails` is empty, so nothing was ever queued, and production does have its Resend
key. The voucher itself works: Greg's existing account claimed it at 19:03Z.

**What shipped:** the email now has two versions. If exactly one account already has that address
confirmed, the email tells them how many articles they had left on Free and how many they have with
the gift. On a paid plan, it says the gift waits until they're back on Free. Anyone else, or any
doubt, gets the existing invitation, which explains Spideryarn. Also, a failed gift email can now be
retried after the voucher is claimed, since an existing reader claims it at once. `/privacy` says the
email to an existing reader carries their allowance.

**For Greg:** the next voucher you make will be the first real gift email. Making one for your own
address after the deploy is the end-to-end check.

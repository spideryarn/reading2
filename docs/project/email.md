# Email: Resend, one domain, one key

Up: [architecture.md](architecture.md)

The only email Spideryarn sends today is **auth email**, from Supabase. Anything new that sends mail
should reuse the same Resend key and domain rather than add a second provider.

**Auth email — sign-up confirmations, password resets, magic links — goes out through
[Resend](https://resend.com), from `Spideryarn <hello@spideryarn.com>`, since 2026-09-29.** Before
that it went through Supabase's built-in sender, which is capped at **2 emails an hour for the whole
project**. With `mailer_autoconfirm` off, the third email sign-up in any hour got no confirmation and
could not sign in.

- **Resend account:** `gregdetre` (log in as greg@gregdetre.com), free plan, one domain,
  `spideryarn.com`, region eu-west-1.
- **Not through the Vercel Marketplace.** That was the first choice; its "Connect Account" step
  failed three times with "The installation could not be started." and nothing more. So the key is an
  ordinary one, pasted into Vercel's env vars by hand.
- **DNS is at Namecheap** ([deployment.md § The domain](deployment.md#the-domain)): a DKIM TXT on
  `resend._domainkey`, CNAMEs on `send` and `rsend`, and a DMARC TXT on `_dmarc`. No Resend MX
  record was added at the apex, so Namecheap's Email Forwarding stays in place and `hello@` still
  forwards. An agent's DNS edits are blocked by the permission classifier, so DNS changes are Greg's
  to make by hand.
- **`RESEND_API_KEY`** is a "sending access" key scoped to `spideryarn.com`. The same key is in
  Vercel (all three environments), `.env.local` and `.env.prod` on the laptop, and on the box — its
  `.env.local` via `push-env`, and its `.env.prod` appended by hand, because `push-env` never sends
  that file. It is also Supabase's SMTP password.
- **Supabase's side is a script, not dashboard clicks:**
  `npx tsx scripts/supabase-auth-config.ts smtp` writes host `smtp.resend.com:465`, user `resend`,
  the sender, and a limit of 30 emails an hour, then reads them back. Resend's free plan allows 100 a
  day, so that is the real ceiling.
- **To check it works**, trigger a real Supabase Auth email — for example, a password reset for an
  existing account — and look for it in Resend's Emails log and the destination inbox. A 200 from
  the config API, or a direct send through Resend's API, does not exercise Supabase's SMTP settings.
  Done on 2026-09-29: a direct API send and a Supabase "Reset your password" to greg@gregdetre.com
  both showed Delivered in Resend's log, and the first reached the inbox.

## See also

- [auth.md](auth.md): what the confirmation email is for, and the sign-in flow around it
- [website-text.md § The contact address](website-text.md#the-contact-address): why the sender is
  `hello@`
- [`scripts/supabase-auth-config.ts`](../../scripts/supabase-auth-config.ts): the `smtp` command

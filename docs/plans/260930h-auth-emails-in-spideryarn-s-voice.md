# Auth emails in Spideryarn's voice

Feedback [SPIDERYARN-READING2-6S](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6S),
from Greg, 2026-09-30:

> The auth emails still use Supabase's default wording. "Reset your password" and the sign-up
> confirmation are unbranded boilerplate. Rewrite them in Spideryarn's voice and using Spideryarn's
> branding. Keep things simple and reliable. Run spikes.

Up: [email.md](../project/email.md) owns the result.

## Where the templates live, before this

**Nowhere of ours.** Neither the local stack (`supabase/config.toml`, every
`[auth.email.template.*]` commented out) nor the hosted project had a custom template, so both sent
GoTrue's built-in "Confirm Your Signup" / "Reset Password" boilerplate. Since 2026-09-29 the hosted
project sends through Resend as `Spideryarn <hello@spideryarn.com>` (`scripts/supabase-auth-config.ts
smtp`), so the sender was ours and the words were not.

## What this does

1. **Two HTML files, one per email Greg named**: `supabase/templates/confirmation.html` (sign-up)
   and `supabase/templates/recovery.html` (password reset). The subjects are "Confirm your email for
   Spideryarn" and "Continue to Spideryarn". The second promises neither a reset nor a completed
   login, because which flow its link uses depends on how the email was requested (§ The finding,
   below).
2. **`supabase/config.toml` points the local stack at them**: `[auth.email.template.confirmation]`
   and `[auth.email.template.recovery]`, each a `subject` and a `content_path`. **That file is the
   one home for the subject lines.** The production script reads them from there.
3. **`scripts/supabase-auth-config.ts templates`**, a fourth command beside `show`, `apply` and
   `smtp`. It reads the two sections out of `config.toml` with `smol-toml`, which is already a
   dependency, then reads the HTML files they name. It refuses a path other than
   `supabase/templates/<name>.html`, a file with any Go-template action other than the one
   `href="{{ .ConfirmationURL }}"`, or any link beyond that action and the `hello@` mailto link. It PATCHes `mailer_subjects_{confirmation,recovery}` and
   `mailer_templates_{confirmation,recovery}_content`, and reads them back. The field names come
   from the live OpenAPI schema `UpdateAuthConfigBody` (read 2026-09-30), not from memory: that API
   ignores keys it does not know, so a misspelled one would return 200 and change nothing. `--dry-run` works as for
   the others.
4. **A test**, `tests/auth-email-templates.test.ts`, which checks what we can check without a
   server:
   - each template has exactly one action link, whose target is `{{ .ConfirmationURL }}`, and the
     one `hello@` mailto link;
   - no other Go-template variable appears;
   - the subjects and paths the script would send are the ones in `config.toml`.

### Voice and branding, and what was kept simple

- **The site's look, as far as email can carry it**: the near-black page (`#0a0a0a`), the brand
  orange `#DB8A45` for the wordmark and the one button, and the spider mark beside the name.
- **Everything inline, and table layout.** Email clients drop `<style>` blocks and web fonts often
  enough that neither can be relied on. So the styles are inline and the font is a system stack.
  Georgia stands in for the site's serif wordmark. The column has `width="480"` as well as a CSS
  max-width, and the button's orange and padding sit on a `<td bgcolor>`, not on the `<a>`, because
  classic Outlook's Word renderer ignores padding and sizing on inline elements.
- **One image, the spider mark, from `https://www.spideryarn.com/apple-touch-icon.png`**, with an
  empty `alt` because the word "Spideryarn" sits right beside it. An absolute production URL even in
  local mail, because an email image has to be reachable from whoever opens it, and `localhost`
  never is. If a client blocks images, the email still reads and works.
- **Dark, like the site**, and declared as dark with `color-scheme`. Dark-mode clients that
  re-colour mail are the risk. A client that inverts a dark email lands roughly where a light one
  would, and the button is solid orange either way, so the one thing that must work stays legible.
- **No expiry time in the words.** GoTrue's link lifetime is a setting (`mailer_otp_exp`), and a
  number typed into the copy would go stale silently the day somebody changes it. "The link works
  once" is true whatever the setting.
- **No `{{ .Email }}` or any other value in the body.** Nothing a person typed reaches the HTML.
- **A reply reaches a person.** The footer says so, because `smtp_admin_email` is `hello@`, which
  forwards to Greg ([website-text.md § The contact address](../project/website-text.md#the-contact-address)).

**Simpler options passed over:**

- **Pasting the HTML into the Supabase dashboard.** Six clicks that leave no trace in the repo,
  nothing to diff and nothing to re-run. That is the reason the script exists (its header).
- **`supabase config push`.** It would push the whole of `config.toml`, including LOCAL-ONLY
  settings. The script's header explains why that command is never the right one.
- **Plain text only.** Simpler still, but GoTrue sends the template as the HTML part, and Greg asked
  for the branding.

### Only the two emails Greg named

`magic_link`, `email_change`, `invite` and `reauthentication` stay Supabase's. The app sends none of
them: it has no magic-link sign-in, no change-email screen, and no invitations. They are the same
file shape plus a section in `config.toml`, when one is needed.

## What the spike found, and what it measured

A **throwaway second Supabase stack** in the session's scratchpad (`project_id =
"fb6s-email-spike"`, ports 556xx), because the shared local stack serves every agent on the box, and
loading templates means restarting it. It had `enable_confirmations = true`, which the shared one
has off, so a sign-up confirmation is actually sent. Only auth, the database, kong and the mail
catcher were running. It pointed at the template files in this worktree.

`e2e.mjs` used `@supabase/supabase-js` with the app's own options (`flowType: "pkce"`, return
address `/auth/callback`):

```
confirmation subject: Confirm your email for Spideryarn
confirmation link: 303 -> http://127.0.0.1:5999/auth/callback?code=<…>
confirmed: spike-…@example.com email_confirmed_at=2026-09-30T12:24:10Z
recovery subject: Reset your Spideryarn password
recovery link: 303 -> http://127.0.0.1:5999/auth/callback?code=<…>
recovery subject: Your Spideryarn sign-in link        (second run, after the plan review)
reset: old password refused, new password signs in
dashboard-style recovery link: 303 -> http://127.0.0.1:5999#access_token=<…>&…&type=recovery
PASS
```

That is the literal output from the second run. Code review then found that "sign-in link" still
promised too much for a dashboard-requested recovery, and changed the subject to "Continue to
Spideryarn" and the button to "Continue". **A third run, with that final copy, printed the same lines
with `recovery subject: Continue to Spideryarn`, and PASS.**

The script is kept beside this plan as [`260930h-spike-e2e.mjs`](260930h-spike-e2e.mjs). Its import is
an absolute path into this worktree, so re-running it means editing that line. It was run twice: first
with absolute `content_path`s, then with the repo's relative `./supabase/templates/…`, symlinked into
the spike project, which shows the CLI resolves them from the project root.

Screenshots, from the mail catcher at desktop and phone width:
[confirmation](260930h-shot-confirmation-desktop.png) ([phone](260930h-shot-confirmation-phone.png)),
[recovery](260930h-shot-recovery-desktop.png) ([phone](260930h-shot-recovery-phone.png)).
All four were taken again after each wording change, so they show the final copy.

In words: the email arrives with our subject and our body. The link in our button goes back to the
callback with a PKCE code, and that code signs you in. After a reset, `updateUser` sets a new password: the old one is refused and the new
one works. The check that would go red if the templates were not applied is the subject comparison,
since GoTrue's own subject is "Confirm Your Signup".

### The finding: a password reset cannot reset anything in this app today

This is a finding, and not something the templates cause:

- **The app never asks for a reset.** There is no "Forgot password?" link and no
  `resetPasswordForEmail` call in `src/web/`. The only way to send a recovery email is from the
  Supabase dashboard, which is how the "Reset your password" Greg saw on 2026-09-29 was sent.
- **A dashboard reset link does not sign you in.** Measured on the spike (step 3 of
  [`260930h-spike-e2e.mjs`](260930h-spike-e2e.mjs)): a recovery sent through `/recover` with no
  PKCE challenge lands on `site_url#access_token=…&type=recovery`, with no `?code=`. That this is what the
  dashboard's button sends is inferred, not measured, since the spike has no dashboard. The
  rejection is read from the source, not run in a browser: our browser client is `flowType: "pkce"`, and
  `_getSessionFromURL` in `@supabase/auth-js` throws *"Not a valid PKCE flow url."* for an
  implicit-flow fragment. So the reader arrives signed out.
- **Even signed in, there is nowhere to choose a new password.** Nothing in `src/web/` calls
  `updateUser`.

**So the recovery email promises only that its button continues the recovery attempt**: "Continue to
Spideryarn", a button that says "Continue", and no claim that it resets the password or completes a
login. An app-requested recovery uses PKCE and signs in; a dashboard-requested one still lands signed
out. The first draft promised a new password, and the plan-review revision still called it a sign-in
link. Code review caught the remaining false promise. **When the set-a-new-password step is built,
the recovery words change with it**, and the template's header comment says so. Building that step
is the deferred rest (below). It is a feature with its own auth surface, not a rewording.

## Security

`security-map.md` does not list the templates as a defence, and nothing here edits one. The one
security-relevant choice is **which link the button carries**. `{{ .ConfirmationURL }}` is built by
GoTrue, so the `redirect_to` allow-list (`uri_allow_list`, set by the script's `apply`) still decides
where a one-time code may be sent. A template that built its own link from `{{ .TokenHash }}` and
`{{ .RedirectTo }}` would move that decision into our HTML. The test pins the button's link to
`{{ .ConfirmationURL }}` and nothing else. Recorded here rather than added to security-map.md:
editing that doc's list is Greg's call.

## Applying it to production — for the Overseer or Greg

This is a write to the hosted project's configuration, so this session did not do it. It needs `SUPABASE_ACCESS_TOKEN`
(in the primary's `.env.local` on the laptop; not on this box's worktree) and `.env.prod` for the
project ref. From a checkout of `dev` that contains this commit:

```
npx tsx scripts/supabase-auth-config.ts templates --dry-run   # prints the two subjects and HTML character counts
npx tsx scripts/supabase-auth-config.ts templates             # writes, then reads back all four fields
```

Then the real check, as for `smtp`:

1. **Confirmation:** sign up with a fresh address on www.spideryarn.com. The email should arrive from
   Spideryarn with the subject "Confirm your email for Spideryarn", and its button should confirm the
   account.
2. **Recovery:** from the dashboard, *Authentication → Users → … → Send password recovery* to the
   same address. It should arrive as "Continue to Spideryarn", in our layout. **Its button will
   not sign you in**. That is the pre-existing gap above, not the template.
3. **Resend click tracking must be off** (Resend → Domains → spideryarn.com → Configuration). It is
   off by default. If it were on, Resend would rewrite every link, including the one-time one. This
   session has no Resend login, so this was not checked.

Resend's Emails log shows each send either way. It takes effect immediately and needs no deploy.

**Undo:** the dashboard's *Authentication → Emails* page has a reset-to-default for each template,
or PATCH the four fields back to empty strings.

## Deferred

- **Built 2026-10-01 in [261001i-password-reset.md](261001i-password-reset.md)**, which also
  changed the recovery email's words. What was deferred: **A real password reset**: a "Forgot password?" link in `SignInControls.tsx` that calls
  `resetPasswordForEmail(email, { redirectTo: callbackUrl() })`, and a set-a-new-password step after
  `AuthCallback` sees a recovery session, calling `updateUser({ password })`. The spike shows the
  auth half already works. What is missing is two small screens, and a decision on how `AuthCallback`
  tells a recovery apart from a sign-in (the `PASSWORD_RECOVERY` auth event).
- **The other four templates**, when the app starts sending them.
- **Link scanners can spend the one-time link before the reader clicks.** Microsoft Safe Links and
  similar mail scanners fetch links on arrival, and Supabase's own docs name this limitation for
  `{{ .ConfirmationURL }}`. The fix they suggest is an interstitial page on our origin that needs a
  second click, or a typed code. Deferred until a reader hits it: it adds a page and a route to the
  auth flow, and Greg asked for simple and reliable. The symptom to recognise is "the link says it
  has expired, and I only clicked it once", from somebody on a corporate Outlook.
- **Loading the templates into the shared local stack** happens at its next restart. Nobody needs to
  restart it for this: locally `enable_confirmations` is off, so no confirmation email is sent there anyway.

## Reviews

- **Plan: GPT Sol, read-only, 2026-09-30:**
  [260930h-auth-emails-review-plan-sol.md](260930h-auth-emails-review-plan-sol.md). Verdict *build
  with changes*: seven findings, all ultimately taken; code review tightened 1, 3 and 6 after finding
  their first implementations incomplete.
  1. The recovery copy promised an outcome the app could not provide (now neutral, above).
  2. Scanners and Resend click tracking (deferred, and a production-check step).
  3. The guard was satisfied by a comment (it now requires exactly the action and mailto links, and
     rejects any other Go-template action).
  4. Classic Outlook (a `<td bgcolor>` button and `width="480"`).
  5. The dashboard-reset claim was not in the spike (step 3 added, and the inference marked).
  6. `content_path` was too permissive (pinned to `supabase/templates/<name>.html`, with both file
     bodies asserted in the test).
  7. Footer contrast (`#737373` to `#a3a3a3`).

  It confirmed that `{{ .ConfirmationURL }}` is right for both emails under PKCE, and that the four
  field names are right.
- **Code: GPT Sol, 2026-09-30:** found the incomplete recovery promise and production-template
  guard above, strengthened the tests, and corrected the dry-run description from bytes to
  characters. Its answer: [260930h-auth-emails-review-code-sol.md](260930h-auth-emails-review-code-sol.md).
  Its diff was read, then the focused tests (29 passed), the typecheck and the spike were re-run on it.

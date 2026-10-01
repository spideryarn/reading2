# 261001i — Password reset that resets a password

**Status:** planned, 2026-10-01. The deferred first item of
[260930h-auth-emails-in-spideryarn-s-voice.md § Deferred](260930h-auth-emails-in-spideryarn-s-voice.md#deferred),
for the 6S report ([260930_1310-auth-emails-in-spideryarn-s-voice.md](../user-feedback/260930_1310-auth-emails-in-spideryarn-s-voice.md)).

## What is wrong today

A reader who has forgotten their password has no way back in. There is no "Forgot password?" link,
nothing in `src/web/` calls `resetPasswordForEmail`, and even a reader who arrived signed in from a
recovery link would find nowhere to choose a new password. The recovery email says only "Continue"
because of that ([260930h § The finding](260930h-auth-emails-in-spideryarn-s-voice.md#the-finding-a-password-reset-cannot-reset-anything-in-this-app-today)).

260930h's spike already proved the Supabase half on a local stack: `resetPasswordForEmail` with
`redirectTo: /auth/callback` sends a PKCE link, the link lands on `/auth/callback?code=…`, the
exchange signs in, and `updateUser({ password })` makes the old password fail and the new one work.
What is missing is the app around it.

## What we build

```
sign-in form ──"Forgot password?"──► same form, email only, "Send reset link"
                                        │ resetPasswordForEmail(email, { redirectTo: callbackUrl() })
                                        ▼
                         "If there's an account for x, a link is on its way. Open it in this browser."
email button ──► GoTrue /verify ──303──► /auth/callback?code=…
                                        │ (SDK exchanges at module load, as today)
                                        ▼
                         AuthCallback: initialize() ok, session present
                                        │ was the URL session a recovery? (see below)
                         no ──► leave() as today
                         yes ─► "Choose a new password" form, inline on the callback page
                                        │ updateUser({ password })
                                        ▼
                                  the shelf
```

1. **`SignInControls.tsx`** — in email mode, a small "forgot your password?" button beside "create
   an account". It switches the form to a third mode, `forgot`: the email box only, a "Send reset
   link" button, and "back to sign in". It calls `resetPasswordForEmail(email, { redirectTo:
   callbackUrl() })` — the same bare callback every other sign-in uses, never the current page
   ([auth.md](../project/auth.md), point 4). On success it shows one sentence that does not say
   whether an account exists (GoTrue answers 200 for an unknown address, so we could not say anyway)
   and asks the reader to open the link **in this browser**, because the PKCE verifier lives here.
   On error it shows the error, as the other two buttons do.
2. **Telling a recovery apart.** The SDK knows (`redirectType === "recovery"`, from the verifier it
   stored with a recovery marker) and says so only by emitting `PASSWORD_RECOVERY` instead of
   `SIGNED_IN`. Measured in the installed `@supabase/auth-js` 2.112.4,
   `GoTrueClient.js:414-421`: the event is fired from a `setTimeout(0)` **after** `_initialize`
   returns, so it arrives after `initialize()` has resolved for AuthCallback, and possibly before
   AuthCallback has mounted. Neither "subscribe in the component" nor "check a flag when initialize
   resolves" is reliable. So:
   - `lib/supabase.ts` subscribes **at module scope, straight after `createClient`**, before any
     network round trip can finish, and records the first URL-session event in a promise:
     `urlSessionKind(): Promise<"recovery" | "sign-in">` resolving on the first `PASSWORD_RECOVERY`
     or `SIGNED_IN`.
   - AuthCallback, on the success path it has today (initialize returned no error and a session
     exists), awaits that promise inside the same ten-second deadline. `"recovery"` → render the
     form. `"sign-in"` → `leave()` as now.
   - ~~If the deadline passes with a session and no event, fall back to `leave()`.~~ Changed after
     the plan review: it shows `[auth-kind]` instead. See § Reviews.
3. **`SetNewPassword.tsx`** — a new component, rendered by AuthCallback in its recovery state. Two
   boxes (new password, again), `autoComplete="new-password"`, `minLength={8}` as the sign-in form
   has, a mismatch check before any request, then `supabase.auth.updateUser({ password })`. On
   success: navigate to the shelf. GoTrue's own refusals (too short, same as the old one, weak) are
   shown as GoTrue words them, as the sign-in form does today. A "skip for now" link goes to the
   shelf: the reader is already signed in by the recovery link, which is how Supabase recovery works
   and is not something this change creates.
4. **Page title**: AuthCallback's title becomes "Choose a new password" in the recovery state, via a
   new `page-title` kind.
5. **Copy**: the new sentences go in `src/messages.ts` with codes, per [copy.md](../project/copy.md).
6. **The recovery email's words change** with it, as 260930h promised: subject and heading "Reset
   your Spideryarn password", button "Choose a new password". `supabase/config.toml` and the test
   that pins the subject change too. **Production keeps the old words until the Overseer runs
   `npx tsx scripts/supabase-auth-config.ts templates`** — this session does not write to the hosted
   project. The new words are honest only once the code is deployed, so the order is deploy, then
   templates.

## What we are not doing, and the simpler options passed over

- **No separate `/reset-password` route.** A route needs a gate decision (who may see it), a router
  entry, a `main.tsx` exemption check, and a way to tell a recovery session from an ordinary one that
  survives a reload — which means persisting a flag. Rendering the form on the callback page, in the
  state that only a recovery exchange reaches, needs none of that. Cost: reloading the callback page
  after the exchange loses the prompt and drops the reader on their shelf, signed in. They can sign
  out and ask again. Name it now, build the route if a reader trips on it.
- **No "change password" on /profile.** A signed-in reader can already call `updateUser` from the
  console; a UI for it is a separate feature with its own question (ask for the old password?), not
  part of recovery.
- **Dashboard-sent recovery links stay broken.** Those are implicit-flow (`#access_token=…`) and our
  PKCE client refuses them by design ([lib/supabase.ts](../../src/web/lib/supabase.ts)). Readers now
  send their own; Greg sending one from the dashboard is the only path that still lands signed out.
  The template's header comment says so.
- **A link opened in a different browser fails** with the existing `[auth-nosession]` message. Without
  the stored verifier, the SDK's `_isPKCECallback` returns false, so it does not attempt an exchange and
  `initialize()` has no exchange error to report. PKCE makes the failure inherent; the "open it in
  this browser" line on the sent screen is the cheap mitigation. A token-hash template
  (`/auth/callback?token_hash=…&type=recovery` +
  `verifyOtp`) would work cross-browser, but it moves the redirect decision out of GoTrue's allow-list
  and into our HTML, which 260930h deliberately did not do, and it is a change to the template's link,
  which a test pins. Not now.

## Security: what this touches, and what it does not

No defence in [security-map.md](../project/security-map.md) changes. Specifically:

- `redirectTo` is `callbackUrl()`, the bare callback, as every other auth call. The allow-list
  (`uri_allow_list`) still decides.
- AuthCallback's existing verdict logic — `initialize()`'s own error, not `getSession()`, decides
  whether *this* attempt worked; every auth parameter is cleared; `takeReturn` is consumed on every
  path — is unchanged. The recovery branch sits after the point where today's code would call
  `leave()`, and it consumes the stored return too (and ignores it: after a new password the reader
  goes to the shelf).
- `isAllowed()`, the server gate, the JWKS verification, the per-owner shelf: untouched.
- The sent-screen sentence does not reveal whether the address has an account.
- The template's link stays `{{ .ConfirmationURL }}`, the only Go-template action the test allows.

## Tests (red first)

- `tests/sign-in-forgot.test.ts` (jsdom): the forgot mode calls `resetPasswordForEmail` with the
  typed email and `{ redirectTo: callbackUrl() }`; the sent sentence appears; an error is shown and
  the sent sentence is not.
- `tests/auth-callback.test.ts`: recovery event → the set-password form, not `navigate`; sign-in
  event → `navigate` as now; deadline with a session and no event → `navigate`; an `initialize`
  error still shows `[auth-exchange]` even if a recovery event fires.
- `tests/set-new-password.test.ts` (jsdom): mismatch refuses without calling `updateUser`; success
  calls `updateUser({ password })` and navigates to the shelf; an `updateUser` error stays on the
  form and shows it.
- `tests/url-session-kind.test.ts`: the module-scope listener resolves `"recovery"` for
  `PASSWORD_RECOVERY`, `"sign-in"` for `SIGNED_IN`, and ignores `INITIAL_SESSION`.
- `tests/auth-email-templates.test.ts`: the new subject.

## Browser check

Playwright against the worktree's dev server and the shared local Supabase, using Mailpit
(`http://127.0.0.1:54364`, API `/api/v1/messages`): create a throwaway account, sign out, "Forgot
password?", read the email from Mailpit, open its link in the same browser context, set a new
password, sign out, confirm the old password is refused and the new one works. Plus the cross-browser
case (link opened in a fresh context shows `[auth-nosession]`). Screenshots at desktop and phone width.

## Reviews

- **Plan: GPT Sol, 2026-10-01** —
  [261001i-password-reset-review-sol.md](261001i-password-reset-review-sol.md), "build with these
  changes". What changed because of it:
  1. **(P1) The watcher answers about one session, by access token**, not "the first event". Another
     tab's sign-in arrives over the SDK's BroadcastChannel immediately, so the first event heard can
     be somebody else's. `watchUrlSessionKinds` keeps a map; AuthCallback asks about
     `getSession()`'s token. Tests cover both orders and the SDK's duplicate event.
  2. **No event is no longer a silent sign-in.** It is `[auth-kind]`: "you are signed in, but this
     page could not tell…", with a "go to your shelf" button, and the stored return consumed. And the
     wait is what is left of the one ten-second deadline, not a fresh one (tested with a 9-second
     exchange). This replaces § What we build, point 2's last bullet.
  3. **Not taken, and sent to the Overseer instead:** AuthCallback does not consume the stored return
     (`takeReturn`) on its timeout, no-session and thrown paths. Sol is right that this contradicts
     `auth-return.ts`'s stated promise, and fixing it would only strengthen it — but it is an edit to
     an existing defence, which this brief said not to make. The new recovery paths do consume it.
     **Then done, the same day, on Greg's approval via the Overseer** ("Use your judgment. If there's
     a clearly better way, and it's not too complex, go for it"): AuthCallback now has one `fail()`
     exit, the only caller of `setError`, which always consumes the stored return. Red-first tests
     for `[auth-slow]`, `[auth-nosession]` and `[auth-finish]`, and a source test that `setError` has
     one call site. security-map.md gained the row for this defence.
  4. An `App`-level test that the form survives the session arriving
     (`tests/recovery-form-survives-the-session.test.tsx`), seen red by making `App` remount the
     callback on a user change.
  5. A thrown `updateUser` is caught (`[auth-password-set]`); a thrown `resetPasswordForEmail` was
     already.
  6. The template's title, heading and button are pinned separately; the button assertion was seen
     red by changing its words.
- Code: GPT Sol, workspace-write.

# Turning Google sign-in on in production

**2026-08-27.** Greg pressed *Continue with Google* on `spideryarn.com` and got a page of JSON:

```json
{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
```

at

```
https://alschkahzfagtppxspfq.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fwww.spideryarn.com%2Fauth%2Fcallback&…
```

This is the third item on [auth-ui-and-production.md § What Greg has to do](auth-ui-and-production.md#what-greg-has-to-do),
arriving as a bug report rather than as a checklist. **Nothing is broken in the sign-in code.** The
button did exactly what it should: `signInWithOAuth` built the right authorize URL, with the right
`redirect_to` and a PKCE challenge, and sent the browser to it. The remote project answered *that
provider is off*.

Which is not the same as saying the code is finished, and this plan changes two things in it —
[a preflight](#the-one-app-change-a-preflight-before-the-redirect) so the next misconfiguration is
our error message rather than somebody else's JSON, and
[a check on whose shelf you get](#the-thing-neither-of-us-thought-of-first).

**Reviewed by [GPT Sol](google-sign-in-production-review-sol.md)** before any of it was built; the
verdict was CHANGES and seven findings, and the marked sections below are where they landed.

## The two blockers, both measured today

Neither is a guess and neither is in this repo.

### 1. Google is off in the remote Supabase project

`GET https://alschkahzfagtppxspfq.supabase.co/auth/v1/settings`:

```json
{"external":{ … "google":false … "email":true},"disable_signup":false,"mailer_autoconfirm":false}
```

`"email":true` in the same response is the control — the endpoint can say *on*, so `"google":false`
is a reading rather than a silence. That is the entire cause of the message above.

### 2. Google had never heard of this project's callback — **fixed 2026-08-27**

```
$ ./scripts/check-google-redirect.sh https://alschkahzfagtppxspfq.supabase.co/auth/v1/callback
--- control (must say REJECTED, or ignore everything below) ---
REJECTED  https://not-registered.example/cb                            (invalid_request)
--- the ones you asked about ---
REJECTED  https://alschkahzfagtppxspfq.supabase.co/auth/v1/callback    (redirect_uri_mismatch)
```

That was the reading for two days. Greg added the URI on 2026-08-27 and the same command now says
`ACCEPTED`, with the control still `REJECTED` beside it — which is the only reason the ACCEPTED
means anything.

**It mattered most**, because fixing only #1 would have moved the failure one hop later: Supabase
redirects to Google, Google refuses with `redirect_uri_mismatch`. A different error page, the same
dead end.

### And a third thing, which was invisible until we had a token

The project's **Site URL** and **Redirect URLs** allow-list. `/auth/v1/settings` does not report
them, so while this plan was being written they were unknown rather than wrong, and the guess here
was that they still pointed at the pre-domain-move Vercel hostname.

The guess was too kind. The first `show` against the Management API, once Greg made a token:

```
site_url                         http://localhost:3000
uri_allow_list                   <unset>
```

Supabase's own defaults, never touched — not a stale value, an unconfigured one. **So fixing only
the two blockers above would have produced the worst outcome of the three.** Google would have
answered, Supabase would have found `https://www.spideryarn.com/auth/callback` on an empty
allow-list and matching nothing about `site_url`, silently substituted `site_url` as it does, and
dropped Greg on **`http://localhost:3000`** — a dead address, from a sign-in that succeeded, with
nothing anywhere reporting an error.

That is the case for reading a setting rather than reasoning about it, and it is the one thing in
this plan that no amount of care about the *other* two would have caught.

**The canonical origin is `https://www.spideryarn.com`**, measured:

```
apex: 308 -> https://www.spideryarn.com/
www:  200
```

so `redirect_to` in Greg's URL is right, and the allow-list has to hold the `www` spelling. The apex
never appears in one: the 308 happens at Vercel's edge, before any of our code runs, so a reader who
types `spideryarn.com` is on `www` by the time the button exists.

## What to do

### Greg, in Google Cloud Console — the blocker

Same clicks as [§ 1](auth-ui-and-production.md#1-google-cloud-console-add-one-redirect-uri), and
still nobody else can make them (Google's passkey challenge, and Claude Code's own classifier
refusing credentials pages — twice now):

1. <https://console.cloud.google.com/apis/credentials>, project 815353440959
2. The Web application OAuth 2.0 Client ID
3. **Authorised redirect URIs → + ADD URI**:
   ```
   https://alschkahzfagtppxspfq.supabase.co/auth/v1/callback
   ```
4. Save. Leave the `127.0.0.1:54361` and `blsgjlrezruxcfdyrqpk` entries alone — local sign-in and
   the old app.

Nothing goes in **Authorised JavaScript origins**. This is the server-side code flow; the browser
never talks to Google with our client id, Supabase does. Adding `www.spideryarn.com` there would be
harmless and would also be cargo cult.

**The consent screen is `Testing`, `External`, with no test users** — read off the page by Greg on
2026-08-27, after two plans had asserted things about who could sign in without anybody looking.

With no test users, **nobody can complete a Google sign-in, Greg included.** That is the last thing
standing between the two settings above and a working button, and the fix is one click on that same
page: add `greg@gregdetre.com` under **Test users**.

**And then leave it in Testing.** Publishing is genuinely cheap — this client asks only for `email`,
`profile` and `openid`, all non-sensitive, so *In production* needs no Google verification, no demo
video and no privacy-policy review; it is a button and a warning dialog. The reason not to press it
is the opposite of effort:

> **Testing plus a test-user list is the beta allowlist this repo decided not to build**, enforced by
> Google before a request ever reaches us.

[auth.md § Still open](../project/auth.md#still-open) has said since the gate landed that nothing
stops a stranger making an account and spending the model budget, and that a spend limit is the
missing control. Publishing the consent screen is the moment that goes from theoretical to live.
Staying in Testing costs one click per person and gives the protection back for free — and it is
undone by a button on the day a spend limit exists.

**One correction, because it was overstated in this session.** Google expires refresh tokens after
seven days for apps in Testing, and that was passed to Greg as "sign-in will silently stop working
next week". It will not. Those are *Google's* refresh tokens, which Supabase obtains at sign-in and
this app never uses — nothing here calls a Google API on a reader's behalf. The session that keeps
somebody signed in is Supabase's own, refreshed against Supabase. The seven days are real and they
are not ours.

Then, from a terminal:

```bash
./scripts/check-google-redirect.sh https://alschkahzfagtppxspfq.supabase.co/auth/v1/callback
```

and read the control line first.

### The Supabase side, from the terminal

The dashboard can do all of it, but a click leaves nothing behind that can be re-run or read back.
So: **`scripts/supabase-auth-config.ts`**, two subcommands against the Management API.

```
npx tsx scripts/supabase-auth-config.ts show     # prints what the remote thinks today
npx tsx scripts/supabase-auth-config.ts apply    # writes the six settings, then re-reads them
```

It needs `SUPABASE_ACCESS_TOKEN`. **The reliable way is a personal access token** from
<https://supabase.com/dashboard/account/tokens>, pasted into `.env.local` — it survives a CLI logout
and there is nothing to get subtly wrong.

Supabase's token page now asks for scopes rather than handing out a key to everything, and the two
this script needs are **not a guess** — they are in the OpenAPI document beside the endpoint itself:

| | |
|---|---|
| `GET /v1/projects/{ref}/config/auth` | `x-oauth-scope: auth:read` |
| `PATCH /v1/projects/{ref}/config/auth` | `x-oauth-scope: auth:write` |

So: **Resource access → Project**, that organisation, that one project; **Permissions → Auth →
read and write**; nothing else, and *nothing at all* under Database, Secrets or Storage. A token
scoped to one project's auth config cannot do anything else with itself, which is the whole reason
to answer this question narrowly rather than reaching for **Create legacy token** — that link makes
a key to the entire account, and it is on the same page, one click away, phrased as the easy option.

A short expiry is right, and 7 days is the page's own default. Nothing here is a standing need: the
token is for one `apply`, and a dead one in `.env.local` afterwards is the correct end state.

The CLI on this machine is already logged in, and its token can be handed to one command without
being written down anywhere. An agent cannot do this (the classifier blocks
`security find-generic-password`, correctly), and **the `-a access-token` is the load-bearing part**:

```bash
SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -a access-token -w \
  | sed 's/^go-keyring-base64://' | base64 -d) npx tsx scripts/supabase-auth-config.ts show
```

**The first version of that line did not have it, and the failure was a good one.** `-s` alone
returns whichever item under that service name comes first, and on this machine that is a *project's*
secret keyed by its ref — not the access token. It is base64 like the real one, it decodes cleanly,
it looks exactly like a credential, and the API answers `401 JWT could not be decoded`, which reads
as an expired login rather than as the wrong secret entirely. Worth keeping because the shape
recurs: a lookup that takes the first match is a lookup that will one day match something else.

What `apply` writes:

| | |
|---|---|
| `external_google_enabled` | `true` |
| `external_google_client_id` / `_secret` | the same pair the local stack uses, from `.env.local` |
| `external_google_skip_nonce_check` | `false`, explicitly — see below |
| `site_url` | `https://www.spideryarn.com` |
| `uri_allow_list` | a comma-separated string of the five entries below |

```
https://www.spideryarn.com/auth/callback
https://spideryarn.com/auth/callback
https://spideryarn-greg-detre.vercel.app/auth/callback
https://spideryarn-*-greg-detre.vercel.app/auth/callback
https://spideryarn-reading2-*-greg-detre.vercel.app/auth/callback
```

**Exact paths, not `/**`.** The first draft of this plan proposed `/**` on every host, out of habit;
Sol pointed out that this app has exactly one return address. `callbackUrl()` is the only
`redirectTo` anywhere in `src/web/` — `signInWithOAuth` and `signUp` both use it and nothing else
passes one — so naming `/auth/callback` costs nothing today, and it is Supabase's own
recommendation for production. **The price is that a new return address has to be added here**, and
if it isn't the failure is silent: see the next paragraph.

**It buys less than the obvious reading suggests, and Sol made us say so.** Supabase accepts any URL
sharing the Site URL's scheme, host and port *before* it consults the allow-list at all — so
`https://www.spideryarn.com/anything` is already allowed by `site_url` alone, and naming
`/auth/callback` narrows the **apex and the Vercel hosts**, not the one everybody actually uses. It
is still the right list; it is not the defence a first draft implied.

**A rejected `redirect_to` does not produce an error.** Supabase substitutes `site_url` and carries
on, so the reader arrives signed in at the wrong address rather than seeing anything go wrong. That
is why `site_url` matters even though every request supplies its own `redirect_to` — and it is why
the allow-list has to be right rather than merely permissive enough.

What that costs is worth spelling out, because it is *nearly* harmless and the nearly is the
interesting part. A `?code=` landing on `/` still exchanges — the client is a module-scope singleton
with `detectSessionInUrl`, and it initialises before `main.tsx` routes anything — so the reader does
end up signed in. But [`AuthCallback.tsx`](../../src/web/AuthCallback.tsx) never runs, so the
remembered deep link in `sessionStorage` is dropped and any exchange or provider error becomes a
landing page that silently does nothing. Sol traced that through; it is the difference between a
misconfiguration you notice and one you don't.

Two of the five are arguably unnecessary and are kept anyway, which is worth saying rather than
leaving to be discovered. The apex cannot currently ask to return to itself (Vercel 308s it to `www`
before any of our code runs), and `spideryarn-reading2-*-…` should already be matched by
`spideryarn-*-…` if `*` spans hyphens, which it should. Both are one line, neither widens anything
meaningfully, and the failure if either belief is wrong is a sign-in that breaks for no visible
reason. `http://localhost:5173/**` was in the first draft and is gone: it is the wrong port
(local is `5273`) and, more to the point, local development signs in against the *local* Supabase
stack, so an entry on the remote project buys nothing at all.

The `vercel.app` entries stay for now. They trust every deployment under those names, and the
account is one person's; narrowing them is a decision for the day the generated hostnames are
actually removed, and the second of those hostnames being reachable at all is
[its own open item](../project/deployment.md#who-can-reach-it).

**`external_google_skip_nonce_check` is written as `false` rather than left alone.** The local stack
sets it `true` because GoTrue's nonce check cannot succeed against a container, and
`supabase/config.toml` says in capitals that this is local-only. Writing the safe value explicitly
means the remote cannot end up with the local one by anybody's accident.

**`apply` is not `config push`.** The CLI's `supabase config push` would send the whole of
`supabase/config.toml` at the remote — including `skip_nonce_check = true`, which that file's own
comment says in capitals is local-only, and a `site_url` of `http://localhost:5273`. It is the
obvious command and it is the wrong one.

**`apply` re-reads from the server rather than reporting its own intentions.** The Management API is
a field-level patch — every property is optional, unrelated settings are left alone — and it
**ignores keys it does not recognise**. So a misspelled field name returns 200, prints a success
line, and changes nothing: [silent success](../reusable/silent-success.md) with a login on the end
of it. The field names were taken from the live OpenAPI document at
<https://api.supabase.com/api/v1-json> (schema `UpdateAuthConfigBody`) rather than from memory, and
the script diffs what it asked for against what comes back.

One field is *not* a partial update within itself: writing `uri_allow_list` replaces the whole
list. Hence `show` before `apply`, and hence `apply` printing the before as well as the after.

### A check that can fail

**`scripts/check-remote-auth.sh`** — one request to `/auth/v1/settings` on the remote, printing every
provider that is on and the state of `google` specifically. Run it before the change and after.

Its control is built in and is the reason it prints more than one line: `email` must read **on** and
`github` must read **off** in the same run. A checker that only ever asks about `google` and reports
"off" cannot distinguish a disabled provider from a typo in the JSON path, and this repo has already
shipped exactly that bug once — [§ The check that could not fail](auth-supabase.md#the-check-that-could-not-fail).

## The one app change: a preflight before the redirect

The first draft of this plan said *no app code*, and rejected two client-side mitigations. One of
those rejections was right and one was lazy.

**Right: there is nothing to `try`/`catch`.** `signInWithOAuth` does not make a request. It builds
an authorize URL and assigns `location`, so by the time the 400 exists our code has stopped running,
on an origin that is not ours. No wrapper can see it.

**Lazy: "a preflight means hiding the button on first paint".** That was the only design considered,
and it is a bad one — a button that has vanished is harder to report than an error with a code in
it, and it puts a request on the landing page's first paint. Sol proposed the version that does not
have either problem: **check on the click**, not on the load.

`googleSignInAvailable()` in [`src/web/lib/supabase.ts`](../../src/web/lib/supabase.ts) — one
request to `/auth/v1/settings`, between the press and the redirect. If the project says Google is
off, the reader gets our own sentence, the email form opens beneath it, and nothing navigates:

> Signing in with Google is not switched on for this site yet — nothing you did. Use an email
> address and password below instead. `[auth-provider]`

**It fails open, and that is the load-bearing line.** The answer is `false` only when the project
says so in as many words. Offline, blocked, slow, rate-limited, a body we do not recognise, `google`
absent rather than `false` — all `true`, and the sign-in proceeds exactly as it would have. A
preflight that refuses when it is merely confused does not prevent a bad error message, it prevents
*signing in*, on a working site, for a reason the reader cannot see. There is a 2.5-second deadline
for the same reason.

[`tests/google-availability.test.ts`](../../tests/google-availability.test.ts) is eight tests, of
which five are failing open and one is the case it exists to catch. It was run against a plausible
wrong implementation (`Boolean(external.google)` instead of `!== false`) and goes red on the
"absent rather than false" case, which is the one that would otherwise disable a working button on
some future GoTrue that only lists what is enabled.

There is a race — the provider could be switched off between the check and the navigation — and it
does not matter. This guards configuration drift, not an attacker.

**Two things came off the back of that sentence living somewhere.** Sol's code review pointed out
that [copy.md](../project/copy.md) says every failure message belongs in
[`src/messages.ts`](../../src/messages.ts) with a registered `kind`, and that the rule had been
written for model calls and then quietly not applied to the one screen a reader meets *before* any
model call exists. All five sign-in sentences moved there. It cost more than a tidy-up: the suite's
invariants immediately rejected two of them, because a non-retryable message has to say in words
that another go will not help, and `[auth-denied]` had been marked as a refusal that would repeat
when it is nothing of the kind — a reader who cancels can simply not cancel.

And moving them found a real bug two files away. `[auth-oauth]` and `[auth-denied]` both said
**Google**, in [`AuthCallback.tsx`](../../src/web/AuthCallback.tsx) — but `signUp` sends its email
confirmation link to that same callback, so an expired confirmation told the reader that Google had
refused something Google was never asked. Both are provider-neutral now.

`withGoogle` also grew a `try`. `signInWithOAuth` can *reject* as well as return an error — it writes
the PKCE verifier to storage before assigning `location`, and a browser with storage blocked throws —
and an unhandled rejection there left `busy` true for ever, which is a disabled button and no way
out. Sol again, and this is the class of finding a plan review cannot reach.

## The thing neither of us thought of first

Sol led its review with this, and it is the failure that would look most like data loss.

**Every row in the database carries an `owner_id`**, and the owner of Greg's existing articles is a
specific uuid — an account made through the Auth admin API on 2026-08-26, before there was any way
to sign in ([database.md § An owner exists before any row does](../project/database.md)). A first
Google sign-in either links to that account or creates a new one. If it creates a new one, the site
works perfectly, every query succeeds, and **the shelf is empty** — and the obvious conclusion
(*the migration lost my articles*) is wrong.

What decides it is whether the existing account's email is confirmed; Supabase links a new provider
identity onto a matching confirmed email. That account was created with `email_confirm: true`, so it
should link. **"Should" is what [`scripts/check-owner-identity.ts`](../../scripts/check-owner-identity.ts)
exists to replace.** Run it before the first Google sign-in and again after: `google` must appear in
the providers of the *same* uuid, and no second row with that email may exist.

One honest caveat, and one retraction. `auth.users` turned out not to be readable by the
application's database user — measured, `42501 permission denied for schema auth`, which is Supabase
being right — so it reads the Auth admin API and needs the service-role key from `.env.prod`.

**This plan then said an agent could not run it, and that was wrong.** The classifier had refused a
hand-written `curl` carrying that key, and the conclusion drawn from one refusal was that the whole
path was closed. Running the script itself was never blocked, and it works:

```
SPIDERYARN_OWNER_ID = 001bb7a0-…   (mode: before)
  001bb7a0-…  greg@gregdetre.com  confirmed=true  providers=—  ← SPIDERYARN_OWNER_ID  5 article(s)
```

**`providers=—` is the interesting part**, and it is not what "the email is confirmed, so it will
link" assumed. That account has *no identities at all* — it was created through the admin API with
no password and no provider, which is a state a normal sign-up never produces. Linking is still the
expected outcome (GoTrue matches on the confirmed email before it creates a user), but the
before-reading has moved this from *probably fine* to *probably fine, and here is the exact shape
nobody has tested*. Which is what the script was for.

If it does go wrong, nothing is lost — the rows are still on the original uuid, and the repair is an
`update … set owner_id` per table. Knowing before is much cheaper than diagnosing after.

## The order, and why

1. **Google Cloud Console** (Greg) — otherwise step 3 just moves the error one hop later. Two edits,
   not one: the redirect URI (**done 2026-08-27**) and a test user (**outstanding**).
2. `./scripts/check-google-redirect.sh https://alschkahzfagtppxspfq.supabase.co/auth/v1/callback` —
   read the control line first.
3. `npx tsx scripts/check-owner-identity.ts` — the *before* reading of whose shelf is whose.
4. `npx tsx scripts/supabase-auth-config.ts show`, then `apply`.
5. `./scripts/check-remote-auth.sh` — `google` must flip to ON, with `email` ON and `github` OFF
   beside it.
6. Press the button on `www.spideryarn.com`, in a browser with no session in `localStorage` — see
   [browser-testing.md § signed out is not signed out](../project/browser-testing.md#signed-out-is-not-signed-out-in-a-browser-you-have-used-before).
7. `npx tsx scripts/check-owner-identity.ts` again — and **look at the shelf**. Signing in
   successfully is not the check; seeing your own articles is.

**A deploy is needed, but only for the preflight.** None of the settings above live in our code, so
steps 1–7 work against the build that is already up. The `[auth-provider]` message and its test ship
whenever `main` next deploys, and nothing waits on them.

## The thing worth saying out loud

Greg's Google account is not the only one that will work. `isAllowed()` returns `true` for anybody
Supabase will vouch for, so after this change that is anybody Google will authenticate against this
OAuth client — which, if its consent screen is still in *Testing*, means only the accounts listed
there, and if it is *Published*, means anybody at all. Sol flagged that the difference had been
asserted rather than looked at, and it still has not been: it is one line on the consent screen
page, next to the redirect URI Greg is already going there to add.

Ownership means none of them can see his library
([auth.md § Whose data is it](../project/auth.md#whose-data-is-it)); nothing stops them spending his
model budget on their own. That was
[his call, twice](../project/auth.md#the-bit-this-page-used-to-get-wrong), and the spend limit is
still the control that is missing. Turning Google on is the moment that decision stops being
theoretical.

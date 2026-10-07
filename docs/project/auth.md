# Auth

Up: [security-map.md](security-map.md)

## In this doc

- [§ Where the pieces are](#where-the-pieces-are) — which file does what, before editing the gate
- [§ Locally, signing in needs no Google at all](#locally-signing-in-needs-no-google-at-all) — the dev-admin password account
- [§ The four things worth knowing](#the-four-things-worth-knowing-before-you-touch-any-of-it) — 401 vs 503, the gate's place in `handleApi`
- [§ A request made for one reader is never sent as another](#a-request-made-for-one-reader-is-never-sent-as-another) — two accounts in one browser
- [§ The signed-out page is the landing page](#the-signed-out-page-is-the-landing-page) — what a visitor sees instead of a form
- [§ The button on the live site did not work at first](#the-button-on-the-live-site-did-not-work-at-first) — Google sign-in in production (history)
- [§ Email](#email) — who sends auth mail
- [§ What auth is for here](#what-auth-is-for-here) — the open proxy and the open wallet
- [§ Whose data is it](#whose-data-is-it) — owner scoping from the gate to the store
- [§ Why Supabase Auth](#why-supabase-auth) — the options weighed (history)
- [§ The one test that has to exist](#the-one-test-that-has-to-exist) — the no-session refusal
- [§ What is not done](#what-is-not-done) and [§ Still open](#still-open) — the gaps

**Decided 2026-08-25: Supabase Auth.** The working that produced that is in
[docs/research/260825a-auth-options.md](../research/260825a-auth-options.md) — this file is the decision and where
its pieces live.

**Built 2026-08-27, and live on `www.spideryarn.com` the same day.** The server gate refuses
anonymous requests (`401 … [auth-none]`) and the browser half can sign somebody in.

**For a few hours it could not, and the shape of that is worth keeping.** `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` are read at **build** time, and they were not set on the Vercel
project — so [`src/web/lib/supabase.ts`](../../src/web/lib/supabase.ts) threw at module load,
exactly as its comment promises, and **the whole site was a blank page**. Not a broken sign-in
button: nothing rendered at all, because the throw happens before React mounts.

Three things that made it hard to see, all worth remembering:

- **The server half looked fine throughout.** `/api/health` answered, `/api/library` returned its
  401. Every check you would naturally run on "is auth working in production" passed, because they
  all test the half that was working. [silent success](../reusable/silent-success.md) again.
- **`curl` cannot see it.** The HTML shell returns `200` with the right `<title>`; the failure is a
  console error in the browser. It took loading the page in a real one to know.
- **It was safe, and safe by accident.** No session could be obtained, so the gate refused
  everything — but that is the blank page doing the work, not the design.

The variables are set on **Production only**, so a preview deployment still throws this. See
[deployment.md § Environment variables](deployment.md#environment-variables) and
[§ The domain](deployment.md#the-domain), since the move onto the custom domain is what made a
blank page matter.

**The build is planned in [260826w-auth-supabase.md](../plans/260826w-auth-supabase.md)** (2026-08-26) — what to
click in Google Cloud and in the Supabase dashboard, the client seam, the gate, the tests, and an
appendix of the screens that come later. Read that before writing any of this. Two things in it
that are cheap to get wrong and are measured rather than assumed: both the local and the remote
project already sign tokens with **asymmetric ES256 keys**, so verification is local and needs no
network call and no extra crypto library; and `flowType` in `createClient` **defaults to
`implicit`**, not `pkce`.

## Where the pieces are

| | |
|---|---|
| [`src/auth.ts`](../../src/auth.ts) | **the gate.** `requireUser(req, verify?)`, called once at the top of `handleApi`'s `try` |
| [`src/routes.ts`](../../src/routes.ts) | that one call, and the comment saying why it is *inside* the `try` |
| [`src/web/lib/supabase.ts`](../../src/web/lib/supabase.ts) | the browser client. One of them, module scope, `flowType: "pkce"` |
| [`src/web/lib/api.ts`](../../src/web/lib/api.ts) | `apiFetch` — the token goes on here, for every call site — and `leavingFetch` for `pagehide`. Both can be told which reader a request is for: [§ below](#a-request-made-for-one-reader-is-never-sent-as-another) |
| [`src/web/useSession.ts`](../../src/web/useSession.ts) | who is signed in, as state |
| [`src/web/LandingPage.tsx`](../../src/web/LandingPage.tsx) | **what being signed out looks like** — the pitch, the screenshots, and links to `/login` carrying where you were |
| [`src/web/SignInControls.tsx`](../../src/web/SignInControls.tsx) | the Sign in / Create account switch, the Google button and the email form, and every line of auth logic in them. One page renders it |
| [`src/web/SignInPage.tsx`](../../src/web/SignInPage.tsx) | **the sign-in page**, at `/login`: reads `?next=` (through `loginNext`) and `?new` |
| [`src/web/AuthCallback.tsx`](../../src/web/AuthCallback.tsx) | where Google returns to, and why it reads the URL itself |
| [`src/web/SetNewPassword.tsx`](../../src/web/SetNewPassword.tsx) | choose a new password, shown by AuthCallback after a recovery link — [261001i](../plans/261001i-password-reset.md) |
| [`src/web/lib/url-session-kind.ts`](../../src/web/lib/url-session-kind.ts) | how AuthCallback tells a recovery from a sign-in: the SDK's late `PASSWORD_RECOVERY` event, caught at module scope |
| [`src/web/auth-return.ts`](../../src/web/auth-return.ts) | where the reader was going, in `sessionStorage`, with three rules — and `loginNext`, which turns `/login?next=` into a candidate for it |
| [`src/web/AccountSection.tsx`](../../src/web/AccountSection.tsx) | signed in as / sign out, on `/profile` |
| [`src/web/SourceLink.tsx`](../../src/web/SourceLink.tsx) | the PDF link, because a navigation carries no header |
| [`scripts/check-remote-auth.sh`](../../scripts/check-remote-auth.sh) | which providers the **remote** project has on. Two controls in every run |
| [`scripts/supabase-auth-config.ts`](../../scripts/supabase-auth-config.ts) | `show` / `apply` the project's auth settings through the Management API. **Not** `supabase config push`, and the header says why |
| [`scripts/check-owner-identity.ts`](../../scripts/check-owner-identity.ts) | whose shelf a sign-in lands on — run before and after the first Google sign-in |
| [`scripts/check-google-redirect.sh`](../../scripts/check-google-redirect.sh) | does Google accept a given redirect URI for our client. Checks a known-bad one every time |
| `npm run deploy -- --verify-only` ([`scripts/deploy.ts`](../../scripts/deploy.ts) § `verify`) | the live site refuses an anonymous request. It replaced `scripts/check-production-gate.sh` on 2026-10-03, which passed over a page with no app in it |
| [`scripts/seed-accounts.ts`](../../scripts/seed-accounts.ts) | who `npm run db:seed-owner` creates **locally**, and the fence that keeps it off anything else |

## Locally, signing in needs no Google at all

`npm run db:seed-owner` creates `dev-admin@spideryarn.local` at the id `src/admin.ts` recognises,
with a password generated for that machine, so the email form on the landing page is the whole of it — no
OAuth, no dashboard, and no browser on a machine you cannot reach. That last part is why it exists:
a fresh Hetzner box had no way in that did not go through the noVNC tunnel.
`npm run db:admin-password` prints the credentials.
[supabase-local.md § Signing in](supabase-local.md#signing-in-with-no-google-and-no-browser-you-cannot-reach)
is the detail, and [260831ab](../plans/260831ab-seed-local-admin-user-for-remote-box.md) is the reasoning.

**Production is untouched by any of it.** The seed refuses to run against anything but this repo's
own local stack, and checks that against `supabase status` rather than against `SUPABASE_URL` —
because everything else in the run reads that same variable, so a forwarded port would have every
step agreeing with every other one.

## The four things worth knowing before you touch any of it

1. **The gate is inside `handleApi`'s `try`.** Above it, a thrown `httpError` escapes the catch:
   500 in dev with the message in the body, a blank 500 on Vercel, and the `finally` never runs so
   **the refusal is never logged**. It still fails closed, which is the only mercy.
2. **A 401 is not "the session is gone".** `apiFetch` refreshes once and retries once, and leaves
   sign-out to the SDK's auth events. Dropping a reader out of an article because one request lost
   a refresh race is worse than the bug it would prevent.
3. **JWKS unreachable is 503, not 401.** A 401 tells a good session to throw itself away and
   refresh, which cannot help, and reports our outage as the reader's mistake.
4. **`/auth/callback` is exempt from every rewrite in `main.tsx`.** `canonicalAddHref` folds
   `location.search` into an article's address — its whole job — so a return landing on `/add/…`
   would put our one-time auth code in a stranger's access log.

## A request made for one reader is never sent as another

Another tab can sign in as somebody else while this one is open, and the token is looked up when a
request is sent, not when it was asked for. So a write that waits (a debounce, a retry, a flush as
the page leaves, a call still waiting for its token) could go out as the next reader. Since
2026-10-06 ([261006e](../plans/261006e-add-page-forgets-everything-when-the-reader-changes.md),
[261006f](../plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md)):

- **The tab holds one session, in [`lib/session.ts`](../../src/web/lib/session.ts)**, which makes
  the only identity subscription to the SDK. `useSession` draws the screen from it and `apiFetch`
  binds requests to it, so the two cannot hold different readers. They could when each subscribed
  for itself: the SDK sends every new subscriber a first answer of its own, read from storage as
  it arrives.
- **Every `apiFetch` is bound to the reader the tab held when the call was made.** That reader is
  read synchronously, before the token lookup, from that held session. If the token
  that comes back is known to be another reader's, nothing is sent and the caller gets
  `NotThisReader`, which has no HTTP status; the refusal is written to the log buffer as
  `not-sent`. It refuses only when both readers are known and differ, so a call made while nobody
  is signed in is unfenced.
- **A caller can name its reader instead**: `apiFetch(input, init, madeFor)`, and the same third
  argument on `apiFetchOwned` and `leavingFetch`. The name is believed over the tab.
- **The retry after a 401 is never sent as a different reader**, for every caller. A refresh that
  comes back as somebody else is a change of account, and the first 401 is the answer.
- **A refusal moves the tab on.** When a token lookup answers as a different known reader from the
  one held, the held session is replaced by that one and every subscriber is told, as an SDK event
  would. The request that noticed is still refused; the screen redraws for the reader the token
  belongs to, so their requests go. A lookup never signs the tab out. A session revision, captured
  before the lookup, prevents an answer overtaken by any adopted session from replacing it,
  including a sign-out and sign-in of the same reader. `INITIAL_SESSION` only fills an unheard
  tab; its asynchronous storage read cannot replace a newer event.

**What the binding cannot see is a request made late.** A timer, a retry loop, a flush as the page
unmounts, a module-level service: each *makes* its call after the reader's gesture, possibly after
the reader has changed, and the tab's reader at that moment is the new one. Those pass `madeFor`,
with the reader taken when the work was begun: `heldReader()` from `lib/session.ts`, read
synchronously, for a sender that is not a component (`appendSpoken` in `chat/effects.ts`, whose
retries follow a gap). `leavingFetch` is always one of these, because it is
called as the page goes. And anything that holds a reader's words is keyed on the reader, not on
the address or the slug. The other places this class has turned up are in
[the postmortem](../postmortems/261006g-work-made-for-one-reader-outlives-a-change-of-reader.md).

**The commonest late request is an effect cleanup**, because a change of reader is itself what
unmounts the page: the held session changes first, so the cleanup runs with the next reader's
token already in place. Two small modules carry the rule for everything under the
signed-in `App`:

- **[`lib/made-for.ts`](../../src/web/lib/made-for.ts) § `useMadeFor`** answers with the reader a
  component was *mounted* for, read once and never again. A component or hook that writes late
  passes it as `madeFor`. `null` for a visitor, which is unfenced.
- **[`lib/reader-change.ts`](../../src/web/lib/reader-change.ts) § `forgetOnReaderChange`** is for
  a module-level store keyed by slug (unsent chat words, search words, what the link cards know).
  The store registers a function that empties it; `lib/session.ts` runs them when a known reader
  is replaced by anybody else, sign-out included, before it tells any subscriber, so they are
  empty before React draws the next page.

The Feedback dialog is the one thing above every page: `FeedbackHost` takes the reader and gives
its draft up when the reader changes. A page that holds a reader's words and is not under
the article's gate is keyed on the reader in `App.tsx`: the shelf, the add page and `/profile`.

The dictation boxes use `useReaderTranscriber` from `dictation-upload.ts`, which captures their
mounted reader before recording; audio conversion and retries retain that reader. Both live
engines retain `apiWiringFor(madeFor)` from `live/wiring.ts`, so device detection, offer creation,
provider tool callbacks and meter retirement cannot send as a later reader.

### Browser storage that is a reader's is keyed by that reader

Two readers can use one browser profile, and `localStorage` outlives a sign-out. So a record there
that holds a reader's words or their place says whose it is, and is read back only for them
([261006h](../plans/261006h-browser-storage-keyed-by-reader-and-the-feedback-switch-test.md)).
Signing out clears neither store: the reader may come back, and clearing would not cover the case
above, where the reader changes in another tab with no sign-out in this one.
[`lib/storage-reader.ts`](../../src/web/lib/storage-reader.ts) is the one spelling of "whose",
with `signed-out` for nobody. Two stores follow it:

- **Where you were in an article** ([`last-view.ts`](../../src/web/last-view.ts)): the key is
  `spya.lastViewFor.<reader>.<slug>`. `App` supplies the current session's reader, rather than
  the frozen `useMadeFor`. The hook lives above the auth branches so its arrival identity survives
  sign-out and sign-in, which remount `ArticlePage` while this tab keeps its address.
  When that happens with an article on screen, the address is the previous reader's view, so the
  article's parameters are taken off it and the new reader arrives as at a bare address. An old
  `spya.lastView.<slug>` key is adopted once, by the first signed-in reader with no entry of their
  own, and removed.
- **The search pairs a reload tidies** ([`stored-pairs.ts`](../../src/web/modes/search/stored-pairs.ts)):
  the record carries `readerId`, and every verb of `storedPairsFor(reader)` reads, writes and
  removes that reader's records only. An old record with no reader is removed when read. Another
  reader's words do stay in storage until they come back; nothing running as anybody else is
  handed them.

Keys that are the browser's rather than a reader's (the install hint, which microphone) stay as
they are.

## The signed-out page is the landing page

Since 2026-08-27, no session shows you [`LandingPage.tsx`](../../src/web/LandingPage.tsx) rather
than a bare form: what the thing is, screenshots of it working, and the way in. Greg asked for it and
made both of the calls that shape it.

**The form is on a page of its own, since 2026-10-01.** From 2026-08-27 the buttons were *on* the
landing page — Greg's call then, on the reasoning that a landing page whose only control sends you
somewhere else has put a click between a person and the thing they came for. He reversed it himself:

> For the non-logged-in users, let's create a separate sign-in page and signpost to it at the top
> and bottom, and follow any best practices in making that nice and usable. We're currently
> emphasising Gmail, but we also allow email and password, and that should be apparent. And we
> need to somehow make it easy for people to both log in and register.
>
> — Greg, 2026-09-29 (report spya-p6s5a4)

So `/login` ([`SignInPage.tsx`](../../src/web/SignInPage.tsx)) is the sign-in page, in the
marketing pages' shell, and the landing page's top bar, hero and foot panel link to it; so does
`/pricing`, whose *Get Reader* stores its tier in `buy-intent.ts` and goes to
`/login?new&next=/pricing`. [`SignInControls.tsx`](../../src/web/SignInControls.tsx) shows Google
and the email form together, with *Sign in* and *Create account* as the two halves of a switch, both
submitting one form. One implementation still, and the reason was never tidiness: a second copy of
`signInWithOAuth` is a second place for `redirectTo` to be wrong, and the way *that* goes wrong is
our one-time authorisation code folded into somebody else's URL (see point 4 above).
[261001m](../plans/261001m-a-sign-in-page-of-its-own-signposted-from-the-signed-out-pages.md).

**`?next=` is a candidate, never an instruction.** [`auth-return.ts`](../../src/web/auth-return.ts)
§ `loginNext` validates it (our origin, not the callback, not `/login`), and the controls write it
through the same ten-minute, read-once `rememberReturn` store only when the reader actually signs
in — and `forgetReturn` it if the start fails. A password sign-in finishes on `/login`, where
`App.tsx`'s signed-in branch *takes* the remembered value, so a signed-in visit to an old or shared
`/login?next=…` goes to the shelf. `redirectTo` stays the bare callback. **Same tab only**: a
confirmation link opened in a new tab lands on the shelf, because `sessionStorage` does not cross
tabs. The confirmation message therefore tells the reader to return to the original tab, where the
stored destination still exists — the simple version, chosen over a server-side return token (GPT
Sol, plan review F2).

**A deep link gets the same page.** `/read/some-article` while signed out is the full landing page,
not a shorter prompt. One signed-out page rather than two, and nothing is lost by it: every link from
it to `/login` carries that address as `next`, so signing in lands you on the article.

`/login` is the one exception, because it is a page somebody was *sent* rather than a statement
about who they are.

**The Beta badge beside the wordmark is what is left of a louder sign.** While access was closed
it was a badge *and* a strip under it, because the page has screenshots on it and the thing a
stranger must not conclude was that this is a product they can sign up for. Since 2026-09-03 it is:
Stripe is live, sign-up is open to anyone, and the strip is deleted. The badge stays, because the
software is genuinely young — see [§ Whose data is it](#whose-data-is-it) for what a new account
does and does not get.

The screenshots live in `src/web/assets/` and are all of one article — *The Mythology of AI
Consciousness*, which is on the public web with nothing sensitive in it. Imported through Vite
rather than dropped in `public/`, so they are content-hashed and a redeploy cannot serve a stale one.

**There are four, and getting them took two goes.** The first attempt produced one, and the reason
is worth recording because it was environmental rather than a decision: partway through capturing
them Chrome's window went `visibilityState: "hidden"`, which paints every screenshot solid black,
and nothing reachable from an agent's side raises an occluded window — two Chrome instances were
running and AppleScript addresses only the other one. This is a new entry on
[browser-testing.md](browser-testing.md)'s list of ways the browser lies to you, and a particularly
quiet one: the capture *succeeds*, at the right dimensions, and returns a black rectangle. The way
past it, on 2026-08-27, was Greg taking the other three himself, with the machine's own screenshot
key.

That is what changed the rules the page had been following, and both changes are the same lesson:

- **Each shot declares its own width and height.** There was one `SHOT_W`/`SHOT_H` pair for the
  whole page, which held while every capture came from one browser window on one afternoon. Real
  screenshots of real features are not one shape — two of these are portraits, one is a wide hero,
  one a landscape card — and a rule saying otherwise has exactly one way out, which is cropping good
  pictures to please a test. So the numbers sit in a `SHOTS` record beside the file each belongs to,
  and [`tests/landing-assets.test.ts`](../../tests/landing-assets.test.ts) reads that record and
  checks every entry against the bytes on disk, in both directions: an import with no entry is a
  picture drawn with no space reserved, an entry with no import is a file nothing points at.
- **PNG, quantised, rather than JPEG.** The first shot was a JPEG because the browser automation
  tool produces JPEG. A person's screenshot key produces PNG, and that is the better format here
  anyway: JPEG rings visibly around small light text on a near-black ground, and `pngquant` at
  65–92 takes a UI screenshot — a few dozen flat colours — below what JPEG manages regardless. The
  hero is 119 KB against 280 KB as a JPEG; all four together are under 280 KB.

Adding one later: capture it, run `pngquant --quality 65-92 --speed 1`, downscale to about twice the
width it will be drawn at (the column is 720 px, so 1440), drop it in `assets/`, and give it a
`SHOTS` entry with the real numbers. The `Shot` component takes a max-width utility, which is how
the portraits avoid filling the column.

## The button on the live site did not work at first

**Resolved: this section is history.** Google sign-in works in production — Greg, 2026-10-07:
*"yes it does"*.

**2026-08-27.** Greg pressed *Continue with Google* on `spideryarn.com` and got a page of JSON on
`supabase.co`:

```json
{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
```

Nothing in the sign-in code is wrong. The button built the right authorize URL, with the right
`redirect_to` and a PKCE challenge, and handed the browser over; the project answered that Google is
switched off. Two settings on two dashboards, neither of them in this repo, and **only Greg can make
the first of them** — Google Cloud Console blocks agents twice over.
[260827i-google-sign-in-production.md](../plans/260827i-google-sign-in-production.md) is the whole of it: what is
measured, the two scripts, the order, and the check that says whether it took.

**Two things came out of it that are about this app rather than about a dashboard.**

**A misconfigured provider shows our own sentence, not somebody else's JSON** — from the deploy that
carries this change onward. (The page of JSON is what the build that was live at the time did, and
none of the settings above need a deploy, so the two halves land separately.)
`googleSignInAvailable()` in [`src/web/lib/supabase.ts`](../../src/web/lib/supabase.ts) asks the
project whether Google is on, **on the click** and not on first paint, before `signInWithOAuth`
navigates. There is no other place to catch this: that call makes no request, it assigns
`location`, so the 400 exists only after our code has stopped running on an origin that is not ours.
**It fails open** — offline, blocked, slow, a body we do not recognise, `google` missing rather than
`false`, all proceed exactly as before. A preflight that refuses when it is merely confused does not
prevent a bad error message, it prevents signing in, on a working site, for a reason the reader
cannot see. Eight tests, five of them that one point.

**All five sign-in sentences now live in [`src/messages.ts`](../../src/messages.ts)**, with a
registered `kind`, which is what [copy.md](copy.md) has always said and what the auth screens had
never done. Moving them was not tidying: the suite's own invariants rejected two on arrival, and it
turned up a real bug — both of `AuthCallback.tsx`'s error sentences said *Google*, while `signUp`
sends its email-confirmation link to the same callback, so an expired confirmation blamed a provider
that had never been asked.

**Whether the first Google sign-in gives Greg his own shelf is not obvious**, and it is the failure
that would look most like data loss. Every row carries an `owner_id`, the existing articles belong to
an account created through the admin API before there was any way to sign in, and a Google sign-in
either links to it or makes a second one — in which case everything works and the shelf is empty.
[`scripts/check-owner-identity.ts`](../../scripts/check-owner-identity.ts) is the before-and-after
reading. GPT Sol raised it; it is the one thing in that review no spec could settle.

## Email

Sign-up confirmations and password resets go out through Resend, not Supabase's built-in sender,
since 2026-09-29 — the built-in one allowed 2 an hour for the whole project. The account, the DNS,
the key and the script that configures Supabase are in [email.md](email.md).

## What auth is for here

The gate exists because **a public site plus online ingest plus no login is an open proxy and an open
wallet** — anyone can make the server fetch an arbitrary URL, and anyone can spend
`OPENROUTER_API_KEY` two model calls at a time — and since 2026-08-27 that is the key the whole app
runs on, not just the pipeline ([ai-gateway.md](ai-gateway.md)). That is not hypothetical: on 2026-08-26, before
`src/auth.ts` existed, an anonymous `POST /api/jobs` against the production hostname returned 202 and
created a running job.

The full statement of the problem and Greg's answer in his own words are in
[260825d-deploy-and-repo-move.md § The beta gate](../plans/260825d-deploy-and-repo-move.md#the-beta-gate).

- **It must fail closed.** Session lookup throws, token missing, Supabase unreachable — the answer is
  no. A gate that opens when it is confused is not a gate. The one refinement: "Supabase unreachable"
  answers **503**, not 401, because telling a good session it is bad sends the reader round a refresh
  loop that cannot succeed.
- **401 for missing or invalid credentials, 503 when verification is unavailable**, never 200 and an empty shelf; there is no beta allowlist or 403 path in `requireUser`.

### The bit this page used to get wrong

This section described a one-email allowlist as though it were built, and two paragraphs later
admitted that every signed-in reader shared one shelf. Both halves were written before the gate
existed and they contradicted each other; GPT Sol's review of the built code named the contradiction
on 2026-08-27. What is actually true:

**There is no allowlist.** Greg's call, twice — *"We can get rid of the allowlist once we've added
authentication. I'll accept the risk."* `requireUser` in [`src/auth.ts`](../../src/auth.ts) admits
anybody Supabase will vouch for, and a comment there marks the one place a narrower check would go.
(Until 2026-10-04 that place held an `isAllowed()` that returned `true`, in front of a 403 nothing
could reach.)

**And every reader gets their own shelf**, which is the part that had not been built when that
decision was made. The gate proved a person existed and then dropped the identity on the floor, so
the risk Greg accepted (a shared wallet) was not the whole risk: `articles.slug` is globally unique,
so a second account did not get an empty library, it got Greg's. Sol led its review with it:

> any person who can create a Supabase account can see and change the same library, profile, chats,
> searches and reader state, and can run paid model operations

Offered the small fix (bring the allowlist back) or the real one, Greg chose the real one. How it
works is in [§ Whose data is it](#whose-data-is-it) below.

## Whose data is it

**One line joins the gate to the store**, and it is `setRequestOwner(user.id)` in
[`src/routes.ts`](../../src/routes.ts), immediately after `requireUser`. Everything else follows from
it.

- **The owner is request-scoped**, in an `AsyncLocalStorage` opened by `handleApi` and read by
  `currentOwnerId()` in [`src/owner.ts`](../../src/owner.ts). Not an argument threaded through forty
  store functions: eleven call sites sit four or five frames below a route handler, the CLI shares
  most of them and has no request, and every one of those parameters would have had to be optional —
  which is the shape that lets a caller forget it and get the wrong person's data.
- **`run()` with a fresh box per request, never `enterWith`.** With HTTP keep-alive several requests
  share a calling async context, and `enterWith` mutates it — so request two could read request one's
  owner in the window before its own gate ran. That is the worst bug this area could have and it
  would never show up in testing, where connections are not reused.
- **Inside a request the signed-in user wins, and `SPIDERYARN_OWNER_ID` does not get a vote.** That
  ordering is load-bearing. The environment used to win outright and
  [deployment.md](deployment.md) tells you to set that variable on Vercel — so with the old
  precedence, deploying exactly as documented would have handed every signed-in stranger Greg's owner
  id, every query would have matched, and the isolation would have been dead code that looked like it
  was working.
- **Reading before the gate throws**, rather than falling back to the environment. The tempting
  fallback is a real person's data, and the request would have succeeded and returned it.
- **Every path from a slug to an article carries an owner filter**, through one predicate —
  `ownedSlug()` in [`src/store/owned-slug.ts`](../../src/store/owned-slug.ts) (re-exported from
  `pg.ts`). That is the whole of the isolation:
  comments, chat threads, searches and glossary lookups are reached only through an `articleId` that
  came from one of those paths. There were five near-identical `articleIdFor` helpers across the pg
  modules and no way to tell by looking whether all five had been done, so
  [`tests/owner-isolation.test.ts`](../../tests/owner-isolation.test.ts) asserts that **no file under
  `src/store/` writes `eq(articles.slug, …)` outside the four one-function files it names**
  (`ownedSlug` and the three deliberately ownerless ones).
- **A slug you do not own is 404, not 403.** "There is no such article" is all a stranger should learn
  about it; a 403 confirms it exists. It falls out of the design rather than being a second decision —
  the row simply does not match the `where`.
- **The filesystem store used to refuse to boot in production**, because it had no owner column and
  nowhere to put one — one directory per slug under `data/`, one profile file, no second reader. On
  Vercel it would have failed anyway for want of a writable disk, but as an ENOENT on the first read,
  which reads as a missing article rather than as a store that should never have been selected. That
  store is gone as of 2026-09-05 — see the tombstone bullet below.

### The two things the first version of this walked straight past

GPT Sol reviewed the ownership work the day it landed and came back **BLOCKER —
the isolation claim is false**, with two live cross-reader reads. Both were
outside the store, which is exactly why the predicate above did not catch them:

- **`GET /api/source/:slug` read the reader's PDF straight off disk.** It was
  authenticated and not authorised — it took a slug, opened `data/<slug>/raw.pdf`
  and returned it, never once asking whose article that was. It now calls
  `shelfStore.read(slug)` first, which is the same owner-filtered lookup
  everything else uses, and it calls it *before* it goes for the bytes. It no
  longer touches the disk at all: on 2026-08-31 the read went through
  `sourceStore` ([`src/store/index.ts`](../../src/store/index.ts)), whose
  Postgres side resolves the slug through `ownedSlug` as well — so the ordering
  is belt and the query is braces.
- **The ingest queue was completely open.** `Job` had no owner and there is one
  global map, so any signed-in stranger could list every reader's slugs, source
  URLs, uploaded filenames, guidance text and errors — and cancel, retry, advance
  or delete any of them by id. Disclosure, denial of service and somebody else's
  model spend, from one endpoint.

And Sol put them together, which is the part worth remembering:

> Combining findings 1 and 2 gives Bob a reliable sequence: list Alice's PDF job,
> take its slug, then download its source.

Jobs now carry an `ownerId`, stamped at `enqueue` and filtered on every read and
every mutation. The filter is now the owner argument of the
store ([`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts) § `list` and `get`, which both take the owner),
which `src/jobs.ts` passes from `currentOwnerId()`; the old `mine()` predicate, which let a
housekeeping sweep see everything, is gone, and retention now runs on the finished job's own
owner rather than sweeping everybody.

Two more things came out of the same review and are fixed:

- **A queued callback does not inherit an owner.** An `AsyncLocalStorage` context
  is captured when an async resource is made, and p-queue stores a plain
  function — so with concurrency 1, Alice's job followed by Bob's runs *the whole
  of Bob's* in Alice's context. Measured here, not guessed. Nothing in the
  pipeline reads the owner yet, so it was a landmine rather than a bug; the owner
  is now captured on the job and re-entered with `runAsOwner`.
- **`npm run db:import` could take somebody else's article.** The article id is
  derived from the slug, so importing a slug another owner holds resolved to
  *their* row, updated it, deleted their comments, chat, searches and lookups by
  `articleId`, and reinserted them under the importer's owner — every write
  reporting success. It was fixed to read the owner first and refuse by name, and
  **the importer itself was deleted on 2026-09-01**
  ([260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md) § Stage 3), so
  this route is gone rather than guarded. Kept here because the *shape* recurs: anything that
  resolves an article id from a slug without reading the owner does this.

### The one deliberate exception

**`GET /api/admin/users` reads across owners on purpose**, and it is the only thing that does. It
answers *"who are the readers"*, which cannot be asked with an owner filter on it. Everything above
this line still holds: one route, in a gated namespace, open to one account id, returning **limited
account metadata (the id, the email address, the sign-in providers), counts and dates** — never a
title, a URL, a filename, or a sentence of anybody's reading. [admin.md](admin.md) is the whole of it, including which of its three refusals is a gate
and which two are courtesies.

### What is still shared, and what is still open

- **`articles.slug` is globally unique**, deliberately, because it is the URL contract. Two people
  ingesting the same URL is a question the beta gate has to answer rather than a bug to fix in the
  store — see [ingest-queue.md](ingest-queue.md) for the two functions that decide whether two
  addresses are one article.
- **The ingest queue is the `jobs` table**, via [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts),
  filtered by `owner_id` on every read and mutation, same as everything else.

  **This bullet said the opposite until 2026-09-05** — *"the ingest queue is not in Postgres…
  `jobs.owner_id` in the schema is still unused"* — and it was a security doc denying the isolation
  that was actually there. It went stale when the queue moved, not when the filesystem store was
  deleted: there were two queues after that, and `SPIDERYARN_STORE` unset meant `files`, so a
  laptop got the on-disk one while Vercel — which has no writable disk — got the table. The
  sentence described the laptop and read as though it described the product. The bullet directly
  below it was corrected on the same day the flag went and this one was not, which is the ordinary
  way a list rots: one line at a time, from the bottom.
- ~~**`SPIDERYARN_STORE=files` has no isolation at all**~~ — **the configuration this warned about
  cannot be reached since 2026-09-05**, when the filesystem store went
  ([260903f](../plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md) § F).
  What it said was true and is the reason we are here: that store had no owner column, so two
  signed-in readers on it shared the complete library, profile, comments, chat and searches, and
  authentication did not make it multi-user-safe. A boot refusal in `src/store/index.ts` was the
  whole of the mitigation. There is one store and it has `owner_id`.
- **Child rows are trusted to match their article.** Comments, chat threads, searches and lookups are
  filtered by `articleId` alone — the owner column on them is written, never read — so the isolation
  rests on the invariant that a child's owner equals its article's owner. Nothing in the database
  enforces it. The importer was the one thing that could break it, and it was deleted on 2026-09-01 —
  so nothing writes a child row under an owner other than the request's.
- **`/api/health` runs before the gate**, outside a request, so `currentOwnerId()` falls back to the
  environment owner and an unauthenticated caller learns that owner's article count. No content
  leaks. Sol rated it low and so do I, but it is a real thing the endpoint says.
- **Upload records written before they carried an owner** are accepted from any caller who knows the
  UUID.
- **No RLS.** The filtering is in the queries, not in the database. RLS is the belt to this pair of
  braces and is deferred — [§ RLS and realtime](../plans/260825d-deploy-and-repo-move.md#rls-and-realtime-not-now).

## Why Supabase Auth

Greg asked whether there was something better or simpler, having used it before, and then
specifically about Better Auth and open-source options. Short version of the answer:

- **The schema already decided it.** `owner_id uuid references auth.users(id)` is a foreign key into
  Supabase's own auth table, on every table, from day one — see
  [260825f-postgres-migration.md § Auth](../plans/260825f-postgres-migration.md#auth-the-gate-is-someone-elses-plan).
- **RLS needs it.** Supabase's third-party auth supports exactly five providers — Clerk, Firebase,
  Auth0, Cognito, WorkOS. Only those let an externally-issued JWT drive `auth.uid()`. Better Auth,
  Logto, Ory and Zitadel are not on the list, so any of them strands the RLS path that
  [§ RLS and realtime](../plans/260825d-deploy-and-repo-move.md#rls-and-realtime-not-now) defers but wants
  back.
- **It is the open-source option.** Supabase Auth is itself an open-source, self-hostable auth server.
  The open-source question turned out to be an argument for staying, not for leaving.
- **It is ten lines.** That was the estimate, and it is the one bullet here written before the code.
  What got built is `getClaims(token)` — local verification against the cached JWKS, no network call
  — followed by four claim checks rather than an email comparison, because there is no allow-list to
  compare against. Roughly the size promised, not the shape.

The alternatives, what each would cost, and the traps — Lucia is dead, Vercel's password protection
does not cover a production domain without a $150/month add-on — are all in
[the research doc](../research/260825a-auth-options.md).

## The one test that has to exist

**A request with no session is refused**, and the suite has to be able to *see* that fail — it was
proved by commenting `requireUser` out, which turns [`tests/routes.test.ts`](../../tests/routes.test.ts)
from 54 green to 2 red.

This used to say "and a request with the wrong email", from the days of the one-email allowlist.
There is no allowlist now ([§ The bit this page used to get wrong](#the-bit-this-page-used-to-get-wrong)),
so the second half of the sentence describes a refusal that deliberately does not happen. What
replaced it is [`tests/owner-isolation.test.ts`](../../tests/owner-isolation.test.ts): the question
is no longer *who is allowed in* but *whose rows they see*.

Every realistic failure here is a fail-open bug: an empty env var read as "allow all", middleware not
mounted on every route, a verify call that silently accepts an unsigned token. See
[silent-success.md](../reusable/silent-success.md) — this is that pattern with a security consequence.

## What is not done

- ~~**Google sign-in in production**~~ — **done**: it works (Greg, 2026-10-07). What broke it at
  first, and the two settings that fixed it, are in
  [§ The button on the live site did not work at first](#the-button-on-the-live-site-did-not-work-at-first).
  Both `VITE_*` variables are on the Vercel project, Production only, and the site renders.
- **No general per-reader dollar spend limit**, deliberately: [ai-gateway.md § What stops a reader spending our money](ai-gateway.md#what-stops-a-reader-spending-our-money-and-what-does-not) records the global OpenRouter cap and Greg's decision; [billing.md](billing.md) covers the ingest allowance already enforced.
- ~~**Email in production** needs SMTP~~ — **done 2026-09-29**: sign-up confirmations go through
  Resend ([§ Email](#email)). `mailer_autoconfirm` is still false there, so a sign-up sends a
  confirmation.

## Still open

- **Anyone with a Google account can still sign in** — *once the consent screen is published, and it
  deliberately is not.* Looked at on 2026-08-27 after Sol pointed out the claim had been asserted
  rather than measured: it is **`Testing`, `External`**, which means only accounts on its test-user
  list get through, and Google enforces that before a request reaches us. So there *is* an allowlist
  after all — it is just not ours and not in this repo. Keeping it that way is the cheap stand-in for
  the spend limit below, and publishing is a button on the day that limit exists — no verification is
  needed, and **no scary interstitial either way**: Google's own exception for apps requesting only
  `email`, `profile` and `openid` covers both the unverified-app warning and the seven-day
  authorisation expiry, so staying in Testing costs a listed reader nothing. See
  [260827i-google-sign-in-production.md](../plans/260827i-google-sign-in-production.md). Ownership is what stops a
  reader who does get in from reading your
  library; nothing stops them making an account and spending your model budget on their own. A spend
  limit is the control for that, and it is the next bullet. If it turns out to be needed sooner,
  `requireUser` in [`src/auth.ts`](../../src/auth.ts) is the one place to add the check.
- **Whether to put Cloudflare Access in front** as an outer, code-free gate. Free to 50 users, and it
  cannot be opened by a bug in a route handler. Optional, not required; the trade is a second piece of
  infrastructure. See
  [the research doc](../research/260825a-auth-options.md#the-minimal-end-no-auth-library-at-all).
- **Authenticating against the old app's Supabase project means authenticating against its 9 existing
  users**, on an email provider that is already enabled. Any of them can sign in here. What they
  cannot do is see anybody else's articles — that is what
  [§ Whose data is it](#whose-data-is-it) is for, and it is why that section had to be built rather
  than an allowlist kept.

## See also

- [260825a-auth-options.md](../research/260825a-auth-options.md) — the full survey and the sources
- [database.md](database.md) — the store `auth.users` sits beside
- [security.md](security.md) — the two untrusted parties, and why neither is another user
- [260825d-deploy-and-repo-move.md](../plans/260825d-deploy-and-repo-move.md) — the gate's design, in the plan that
  needs it

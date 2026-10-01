# 261001m — A sign-in page of its own, signposted from the signed-out pages

**Status:** planned, 2026-10-01. For Greg's feedback report `spya-p6s5a4`.

> For the non-logged-in users, let's create a separate sign-in page and signpost to it at the top
> and bottom, and follow any best practices in making that nice and usable. We're currently
> emphasising Gmail, but we also allow email and password, and that should be apparent. And we
> need to somehow make it easy for people to both log in and register.
>
> And so then for the non-logged-in homepage, instead of having that sign-in button at the bottom,
> we'd have a sign-in button that takes you to the sign-in page.
>
> — Greg, 2026-09-29

## What is there today

- `/` signed out is [`LandingPage.tsx`](../../src/web/LandingPage.tsx), and the sign-in controls
  are **on** it, in a panel at the foot (`#sign-in`). The hero's *Start reading* and the top bar's
  *Sign in* both jump to that panel. That was Greg's own call on 2026-08-27 ("a landing page whose
  only control is a link to another page has put a click between somebody and the thing they came
  for", [auth.md § The signed-out page is the landing page](../project/auth.md)); this report
  reverses it, by him, so the docs that state the old rule change with it.
- [`SignInControls.tsx`](../../src/web/SignInControls.tsx) shows **only** the Google button at
  first; email and password hide behind a small grey "or use an email address". Creating an
  account is a small grey "create an account" button *inside* the sign-in form, sharing a password
  box marked `autocomplete="current-password"` — so a password manager never offers to generate
  one, and nothing tells a newcomer that this is where they register.
- `/login` already exists ([`SignInPage.tsx`](../../src/web/SignInPage.tsx)): a compact bare
  column, kept for the password-reset landing. Nothing links to it.
- `/pricing` has its own sign-in panel, and it is the **buy path** for a stranger: *Get Reader*
  stores the tier and scrolls to the panel; signing in there returns to `/pricing`, which finishes
  the purchase ([PricingPage.tsx](../../src/web/PricingPage.tsx) header).
- The landing page is also what a stranger gets at a **deep link** — `/read/<unshared>`,
  `/add/…`, `/profile` — and the address bar holding that path is what puts them back there after
  signing in ([`auth-return.ts`](../../src/web/auth-return.ts)).

## What we build

**`/login` becomes the sign-in page**, rather than a new route. It already exists, is already the
password-reset landing, and `App.tsx` already answers it on both sides of the gate. A second
address (`/signin`, `/register`) would be a second page to keep honest for no gain.

```
signed-out pages                         /login
┌───────────────────────────────┐        ┌──────────────────────────────────┐
│ Spideryarn   Features … Sign in ─────► │ [ Sign in | Create account ]     │
│                               │        │  Welcome back / Start reading    │
│ Read deeply & efficiently.    │        │ ( G  Continue with Google )      │
│ [Start reading] [Pricing]  ───┼──────► │ ───────── or with email ──────── │
│   …                           │ (create│  Email    [            ]         │
│ ┌ panel ────────────────────┐ │  tab)  │  Password [            ] Show    │
│ │ Start with three free …   │ │        │  [Sign in]   Forgot password?    │
│ │ [Create an account] [Sign in]──────► │                                  │
│ └───────────────────────────┘ │        │ (footer)                         │
└───────────────────────────────┘        └──────────────────────────────────┘
```

1. **The controls** ([`SignInControls.tsx`](../../src/web/SignInControls.tsx)), which `/login`
   and `/pricing` both render, so both get this:
   - A two-way switch at the top, **Sign in | Create account**, as two buttons with
     `aria-pressed`. Best practice is that the two are distinguishable at a glance and one click
     apart, rather than registration being a secondary link inside the sign-in form.
   - **Google and email are both visible from the start.** The Google button reads *Continue with
     Google* (one of Google's three permitted labels, and the honest one for both tabs), then an
     "or with email" divider, then the email form. The hide-behind-a-link step goes.
   - In **Create account**: the button says *Create account*, the password box is
     `autocomplete="new-password"` (so password managers offer to generate one) and says "At least
     8 characters" under it; *Forgot password?* is not shown. In **Sign in**: *Sign in*,
     `current-password`, and *Forgot password?* as today.
   - A **Show/Hide** toggle on the password box, since there is no confirm-password field.
   - The forgot-password mode (261001i) stays as it is.
   - Two new optional props: `initialTab` and `returnTo` (below). With neither, it behaves as now
     on `/pricing`: returns to the page it is on.
2. **The page** ([`SignInPage.tsx`](../../src/web/SignInPage.tsx)) moves into the marketing
   family: `.site`, the `SiteNav` top bar (which drops its own *Sign in* link here), one centred
   `site-panel` holding a heading and the controls, and `SiteFooter`. The heading follows the tab
   (*Sign in to Spideryarn* / *Create your account*).
3. **Where they come back to.** `/login?next=<path>` carries the destination; `/login?new` opens
   the Create account tab. A helper `loginHref({ next?, create? })` in `router.ts` builds it and
   omits `next` when it is `/` (the default anyway). `SignInPage` reads `next` through a validator
   beside `isSafeReturn` in `auth-return.ts` that also refuses `/login` itself, and passes it to
   the controls:
   - Google and sign-up already `rememberReturn()` before leaving; they remember `next`, not
     `/login`.
   - Password sign-in signs in in place, and the signed-in branch of `App.tsx` already answers
     `/login` with a `replace` navigation to the shelf; it goes to the validated `next` instead.
   - The redirect target given to Supabase stays the bare `/auth/callback`, so none of
     [auth.md](../project/auth.md) point 4 moves.
4. **The landing page** loses `SignInControls`. The foot panel keeps its sentence and gets two
   links in place of the form — *Create an account* (primary, `?new`) and *Sign in* (ghost). The
   hero's *Start reading* goes to `?new`. Every one carries `next` = the address the landing page
   is standing on, so the deep-link case still lands the reader on their article.
5. **The top bar** ([`SiteBits.tsx`](../../src/web/SiteBits.tsx) `SiteNav`): *Sign in* goes to
   `/login` (with `next`) on every page that draws it, `/pricing` included — signing in from the
   top bar of `/pricing` returns to `/pricing`, which is what the panel there does too. It is a
   `Link` now that the destination is a page rather than a fragment.

### What we are not doing

- **Not touching `/pricing`'s panel.** It is the buy path, and moving it would mean carrying the
  chosen tier through `/login` — real engineering for no reader-visible gain. It gets the new
  controls for free.
- **No separate `/register` route**, and no confirm-password field (Show/Hide instead — the
  current advice, and one field fewer).
- **No social providers beyond Google**, no magic link. Not asked for.

### The simpler version, and why not

The cheapest version is to leave the controls alone and only point the links at `/login`. It would
answer "a separate page" and miss the two things Greg named: email/password being *apparent*, and
registering being *easy*. Both are in `SignInControls`, so it has to change.

## Pushback

One thing worth saying, not worth stopping for: the 2026-08-27 rule existed because a click between
a stranger and the form costs sign-ups. It costs less now than it did: the panel has been at the
foot of a long page since 2026-09-03, so it was already a jump away, and a page of its own can be
linked to from anywhere (an email, the footer). The deep-link return is the part that would have
broken quietly, and `next` covers it.

## Tests (red first)

- `router.test.ts`: `loginHref` — bare, `next=/` omitted, `next` encoded, `new`.
- `auth-return.test.ts`: the `next` validator refuses `//evil.example`, `https://evil.example`,
  `/login`, `/login?next=…`, `/auth/callback`; accepts `/read/x?y=1`.
- `sign-in-controls` (new): email and password boxes visible on first render; the switch flips the
  submit label, the password autocomplete and the presence of *Forgot password?*; Create account
  calls `signUp`; `returnTo` is what is remembered.
- `site-nav-sign-in.test.tsx`: *Sign in* is `/login…` on every signed-out page, including
  `/pricing`.
- Landing: no password box on the page; the foot links and *Start reading* go to `/login?…new`
  with `next` when the landing page stands on a deep link.
- `App`: signed in at `/login?next=/read/x` goes to `/read/x`; an unsafe `next` goes to the shelf.
- Existing `sign-in-forgot`, the two Enter-key tests and `site-footer` stay green.

## Docs that change

auth.md § The signed-out page and § Where the pieces are, website-text.md § The landing page,
the headers of LandingPage, SignInPage, SignInControls and SiteBits § Sign in, router.ts's
"Nothing in the app links to it".

## Done

`npm test`, `npm run typecheck`, Playwright at 1440 and 390 on `/`, `/login`, `/login?new`,
`/pricing`, a deep link, and a local password sign-in that lands on the deep link. Sol code review.

## After GPT Sol's plan review

[261001m-sign-in-page-plan-review-sol.md](261001m-sign-in-page-plan-review-sol.md): no P0, five P1,
two P2. All taken; how each changed the plan:

- **F1 — `next` is a candidate, not an instruction.** The URL's `next` is validated and then written
  through the existing timestamped one-shot store (`rememberReturn`) only when the reader actually
  submits — Google, password or create. The signed-in `/login` branch in `App.tsx` *consumes*
  that store with `takeReturn` and falls back to the shelf, so an old or shared `/login?next=…`
  visited while signed in goes to the shelf. A new `forgetReturn()` is called on every failed
  start. Password sign-in remembers only on `/login` (where `App.tsx` consumes it), not elsewhere.
- **F2 — same tab only, said so.** A confirmation link opened in a new tab lands on the shelf, as
  on `/pricing` today; `sessionStorage` does not cross tabs and the callback stays bare. Not
  building a server-side return token.
- **F3 —** `AuthCallback`'s signed-out "back to the sign-in screen" goes to `/login`, not `/`.
- **F4 —** one form, one real submit button, `onSubmit` dispatches by tab, so `required` and
  `minLength` hold for Create account too.
- **F5 — simplified rather than wired.** The page heading does not follow the tab; it reads
  *Sign in or create an account* and the switch says which half you are in. One less seam.
- **F6 — `/pricing` loses its panel too.** The buy path already rides in `buy-intent.ts`'s
  tab-scoped marker, so *Get Reader* stores the marker and navigates to
  `/login?new&next=/pricing`; *Start reading* (Free) goes to `/login?new`. One sign-in location
  on the whole site, and `SignInControls` has one caller.
- **F7 —** security-map.md and marketing-pages.md join the doc list; `/login` is described as
  what it is (the recovery form is rendered by `AuthCallback`, not by `/login`).

## What landed, and the code review

Built as planned, with the review changes above. Two things the Playwright check (1440 and 390)
turned up and that were fixed before the code review: `/login`'s footer had no gutter (now inside
`SHELL`), and the signed-in `/login` redirect navigated during render, which React warns about
(now `LeaveLogin`, an effect, with a pathname guard for StrictMode's double run).
`security-map.md` was left as it is: its auth-return row is still true, because `next` goes through
the same ten-minute, read-once store.

GPT Sol's code review ([261001m-sign-in-page-code-review-sol.md](261001m-sign-in-page-code-review-sol.md))
fixed six things in place, all checked and kept:

- **C1** — the confirmation message now says to come back to this tab, which finishes F2.
- **C2** — Google's return destination is remembered *before* the provider preflight, and a click
  abandoned because a session arrived from another tab no longer starts OAuth after unmount.
- **C3** — Google being off now forgets the destination, like every other failed start.
- **C4** — choosing Free on `/pricing` clears an older paid buy-intent marker.
- **C5** — the landing foot's *Create an account* is outlined, keeping one orange button per page.
- **C6** — the switch is a labelled `<fieldset>`; plus prose fixes across comments and docs (C7).

My one change to its diff: "afterward" to "afterwards" in the new sentence.

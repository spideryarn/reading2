# A signed-in browser on the box, with no human

**Status: built 2026-09-01.**

`docs/project/browser-testing-playwright.md` shipped that morning with a hole in it, written into
its own last section: *"the reading view itself was not driven, because the box's dev server was
signed out and the API answered `auth-none`"*. Every route past the gate needs a session, so an
agent on the remote box can measure the landing page and nothing else — which is most of what
browser testing is for.

Greg, 2026-09-01:

> Can we create/hardcode a dummy-dev user with a known password … so that you can sign in with
> email & password (rather than needing Google SSO, which is a nuisance)? … The key thing is that
> it shouldn't need human input to create/log in as this dev user.

## Most of that already existed, and this plan is smaller than the question

`npm run db:seed-owner` has written a password-holding `greg@gregdetre.com` since 2026-08-31
([260831ab](260831ab-seed-local-admin-user-for-remote-box.md)), generated per machine into
`~/.config/spideryarn/local-admin-password`, printed by `npm run db:admin-password`. There is no
Google step and no human step. The credential was there the whole time; nothing knew how to hand it
to a browser.

So there are only two real gaps.

**1. Nothing signs a Playwright browser in.** `scripts/seed-local-session.ts` does this for the
laptop's CPU harness, through a magic link and a CDP `verifyOtp` into the app's own SDK instance.
That is the right shape for a browser you did not launch; it is more machinery than Playwright
needs, and it does not use the password at all.

**2. Signing in lands on an empty shelf.** The corpus on this box — 17 articles — belongs to
`DEV_OWNER_ID`, because `SPIDERYARN_OWNER_ID` is blank and that is what the CLI stamps. The account
you sign in as owned one row. A sign-in helper that works perfectly and shows you nothing to open
has not unblocked anything, so this is in scope rather than next to it.

## What gets built

**`scripts/browser-sign-in.ts`** — one module, two ways in:

- `devCredentials()` reads the seeded email and this machine's password file. It never *creates* a
  password, for `scripts/db-admin-password.ts`'s reason: a generated one for an account that does
  not exist reads as "wrong password" rather than "run the seed".
- `signIn(page)` drives **the real form** on the landing page — click *or use an email address*,
  fill both fields, submit — and then waits for something only a signed-in page has.
- Run directly, it launches system Chrome, signs in, and prints one line of evidence.

**`scripts/db-reown.ts`** — move every owned row from one owner to another, against a local database
only. Greg's call, asked and answered 2026-09-01: move the rows rather than give the row-owner a
password of its own. It reads the owned tables out of `information_schema` rather than from a list
in the file, so a table added next month cannot be silently left behind.

Then `SPIDERYARN_OWNER_ID` gets set to the id in `src/admin.ts`, which is what `.env.example` and
[supabase-local.md](../project/supabase-local.md) have recommended since 2026-08-31 while refusing to
do it, because on a database that already has rows it turns eight test files red. Moving the rows
first is the missing half.

## The simpler options passed over

**Write the session into `localStorage` directly.** Rejected for the reason
`scripts/seed-local-session.ts` already wrote down: the SDK's storage shape is private and has
changed between versions, and guessing it gives you a browser that looks signed in to us and is
signed out to the app.

**Call `supabase.auth.signInWithPassword` inside the page**, via `import('/src/web/lib/supabase.ts')`
as `scripts/measure-cpu.ts` does. Simpler, and it works — but only against the Vite dev server,
which serves modules by source path. Driving the form costs one extra second and works against a
build. It also fails loudly if the sign-in UI breaks, which is a thing worth finding out.

**Reuse a saved `storageState`.** The idiomatic Playwright answer, and premature: signing in takes
about two seconds, and a cached session file is one more thing that can be stale in a way that reads
as a broken app.

**Give `dev@spideryarn.local` a password too**, so a browser signs in as the row-owner and sees the
corpus with no data move. Offered; Greg chose the row move, which leaves one sign-in account rather
than two.

## What has to be true afterwards

- A fresh box is correct from its first ingest, with no data move needed — `SPIDERYARN_OWNER_ID` is
  already on `push-env`'s allowlist, so it travels from the laptop.
- The laptop needs the same two steps, and they are not done by this plan: set the variable, and run
  `db:reown` on its own local database first.
- `npm test` is no worse than it was before the row move. Measured, not assumed — the eight red
  files are the reason this was left undone, and the claim that moving the rows fixes them is
  exactly the kind that agrees with itself unless someone runs it.

## What the review changed

GPT Sol reviewed the built code on 2026-09-01 and found one high and four medium defects, all real,
all fixed:

- **`db-reown` did not establish which database it was rewriting.** No `Target:` line, and a
  loopback address is not proof — an `ssh -L` onto 127.0.0.1 passes `isLocalDatabaseUrl`, which Sol
  ran. It now prints the target and settles identity against `supabase status`, with the rule
  extracted into [`scripts/db-reown-rules.ts`](../../scripts/db-reown-rules.ts) so
  [a test](../../tests/db-reown-rules.test.ts) can drive the hostile cases.
- **`db-reown` could report success with old-owner rows still arriving.** It re-counts after
  committing and names them; the documented order now stops the writers and sets the variable first.
- **"signed in as greg@gregdetre.com" was not observed** — `/api/library` answers 200 for anybody.
  The grant's token is now read for its `sub`, and the shelf body for its `articles` array.
- **`--at` said `ok` to a page reading "Not shared."** `<main>` is on the landing page, the library,
  the profile and `NotSharedPage` alike. It now fails on any failing `/api/` call, which is the
  shape a missing article actually has.
- **`npm run setup` printed "one shelf" on the strength of an environment variable**, which says
  nothing about the rows. It now says only what it checked.

Three smaller ones too: base-table-only discovery, lower-cased uuid arguments, and two factual
errors in the prose — the audit table is `article_visibility_changes`, and Storage needs nothing
moved because its `owner` is null and `uploads` carries the staging key, not because every object is
content-addressed.

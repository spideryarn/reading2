# A dev account that is ready to use on every box

**Status: built 2026-09-02.**

Greg, 2026-09-02:

> Let's make sure that there is a dev user (with "Experimental Features" true, and at least a few
> example fixture articles pre-loaded) automatically created for each new gjd-remote box and also on
> this laptop, that we use for most testing, with a hard-coded password somewhere (either stored in a
> doc) or generated dynamically for each box and stored in a gitignored file or something similar. I
> think one of the gjd-remote agents did some of this work already, but I'm not sure, something to do
> with a db:seed command or similar. Right now we're often relying on greg@gregdetre.com (e.g. as
> admin), but then I have to sign in with Google, whereas I want things to not be blocked on my
> input/involvement. Ideally this should run idempotently, i.e. I'd like it to be able to run locally
> and on remote box and it'll create/update as needed.

## Most of this shipped on 31 Aug and 1 Sep, and the plan is the remainder

Greg's own hedge — *"I think one of the gjd-remote agents did some of this work already"* — is
right, and saying so is most of the value here. Four of the six things he asks for exist:

| What he asked for | Where it already is |
|---|---|
| An account that signs in with no Google | `greg@gregdetre.com` at `ADMIN_USER_ID_LOCAL`, seeded by `npm run db:seed-owner` |
| A password generated per box into a gitignored file | `~/.config/spideryarn/local-admin-password`, `0600`, outside the repo entirely — [`scripts/seed-accounts.ts`](../../scripts/seed-accounts.ts) |
| Idempotent, laptop and box alike | The seed signs in first and writes only when the password is genuinely wrong, because a write revokes every open session |
| Automatic on a new box | `npm run setup` runs it; [`infra/hetzner/README.md`](../../infra/hetzner/README.md) makes `npm ci && npm run setup` the step after cloning |

`npm run db:admin-password` prints this machine's email and password, and
[`scripts/browser-sign-in.ts`](../../scripts/browser-sign-in.ts) types them into the real form for a
Playwright browser with no human at the keyboard. **There is no Google step on a local stack** —
that is a production-only fact, and the discoverability gap is the actual reason Greg is asking.

Two things do not exist, and they are the work:

1. **Experimental Features is never seeded.** `spideryarn.reader_profiles` has zero rows on this box.
2. **No command puts articles on the dev shelf.** The committed corpus at
   [`tests/fixtures/data-root/`](../../tests/fixtures/data-root/README.md) is five articles in the
   *filesystem* store's layout, and nothing loads it into Postgres outside the test suite.

And one thing is a trap rather than a gap — see § The store this all lands in.

## No third account, and the reason is written down twice already

The literal reading of *"there is a dev user … created"* is a new, third seeded account. That is the
option this repo has already rejected, twice, and reintroducing it under a new name would undo both:

- [260901j](260901j-a-signed-in-browser-on-the-box-with-no-human.md) offered exactly this — *"Give
  `dev@spideryarn.local` a password too, so a browser signs in as the row-owner"* — and Greg chose to
  move the rows instead, **"which leaves one sign-in account rather than two"**.
- `/api/admin/*` gates on a **uuid allowlist** in [`src/admin.ts`](../../src/admin.ts), not on an
  email address, after a silent production lockout
  ([260828f](../postmortems/260828f-admin-id-was-the-local-one.md)). A third account is not an admin
  until its uuid is added to `ADMIN_USER_IDS` — a permanent, universal admin id published in git,
  which is a worse version of the hardcoded password `seed-accounts.ts` argued its way out of on
  2026-08-31.
- The empty-shelf failure — fixtures owned by an account nobody signs in as — is precisely what
  `SPIDERYARN_OWNER_ID` and [`scripts/db-reown.ts`](../../scripts/db-reown.ts) were built to end. A
  third owner forks that again.

**So the seeded `greg@gregdetre.com` *is* the dev user.** It is a local row in a local Docker stack
with a machine-local password; it shares nothing with the production account but an address. The name
is cosmetic, and `describeAdminMiss` and the seed's `mismatchAdvice` are both keyed to it.

Likewise **the password question is closed**: `scripts/seed-accounts.ts` § *Why a generated secret in
a file* records Greg's call on 2026-08-31 against the "hard-coded, stored in a doc" option his
message offers again. Not relitigated here.

## What gets built

### `npm run db:seed-dev` — [`scripts/db-seed-dev.ts`](../../scripts/db-seed-dev.ts)

One new script. Three things, in order, against a local stack only:

1. **Turn Experimental Features on** for `ADMIN_USER_ID_LOCAL` — an upsert on
   `spideryarn.reader_profiles.experimental_since` mirroring `writeExperimental`'s semantics
   ([`src/store/pg-reader.ts`](../../src/store/pg-reader.ts)): `coalesce` so a re-run never moves an
   existing date, and never `on conflict do nothing`, which would leave a pre-existing row with a
   `null` column untouched while reporting success.
2. **Load three fixture articles** by calling `loadArticleIntoPg` from
   [`tests/helpers/load-article.ts`](../../tests/helpers/load-article.ts), with
   `ownerId: ADMIN_USER_ID_LOCAL`, `serialise: true`, and the default fixture root.
3. **Read back what it did** and print that, not what it meant to do.

**Three slugs, not five**: `writes`, `todo`, `openai-huggingface`. `constitution` is the corpus's
*negative* fixture — it has no `labels.sourceHash`, so `publishRevision` is designed to refuse it.
`noema-mythology-of-conscious-ai` publishes perfectly well and is excluded for a weaker reason: it has
no `raw.json`, so there is no original document behind it, which is a strange first impression on a
shelf. (This plan said "deliberately unpublishable" of both; that was wrong about `noema` — Sol,
finding 6.)

### Why it calls test code, which is a precedent

`src/store/import.ts` and `npm run db:import` were deleted on 2026-09-01
([260827aa](260827aa-delete-the-importer.md)) on the principle that a **second** files→Postgres
implementation, exercised only by tests, will drift from the path production runs.
`loadArticleIntoPg` is the survivor of that deletion: it drives the real write path
(`storeRawSource` → a running `jobs` row → `openOrBeginJobDraft` → `copyArtefacts` →
`publishRevision`).

Giving it a **second caller** is the inverse of what was rejected — one implementation, more
exercise, less drift. The alternatives are worse:

- **Promote it into `src/store/`.** Structurally wrong, not just politically: its own header says it
  deliberately wraps the whole copy in one transaction where production commits one step at a time,
  and it defaults to the fixture corpus root. That is dev tooling, and `src/` is the production
  surface.
- **Run the real pipeline over the fixture HTML.** AI spend, network and nondeterminism on every box,
  when the corpus was committed precisely so that no box needs any of it.

Nothing under `scripts/` imports from `tests/` today, so **this is a new precedent and is named as
one**. [`load-article.ts`](../../tests/helpers/load-article.ts)'s header gains a line naming the new
caller, so the next person to change it knows it is no longer test-only.

### Idempotency means "published ⇒ skip", not "present ⇒ skip"

`loadArticleIntoPg` is re-runnable but is **not** a no-op: a second call opens a draft based on the
published revision, re-copies, and publishes revision 2. Harmless to the shelf, but revisions and
step-run rows would accumulate on every `npm run setup`.

So the seed checks first, and the exact predicate matters:

- **A published revision exists for this slug ⇒ skip.** Done.
- **An `articles` row exists with no published revision ⇒ load it.** That is a previous half-failed
  seed, and skipping on the row alone would turn one failure into a permanently empty shelf that
  every later run calls "already seeded".
- **The slug exists under a different owner ⇒ report it and move on**, naming the owner.
  `articles.slug` is globally unique ([`src/owner.ts`](../../src/owner.ts)), so this would otherwise
  die on the unique constraint — and it is a live case, not a hypothetical: this box already holds
  all five corpus slugs from test runs.

### Where it hooks in

A fourth entry in `STEPS` in [`scripts/setup-local.ts`](../../scripts/setup-local.ts), after
`db:seed-owner`. **Not** folded into `db:seed-owner`, which is accounts-only, talks to GoTrue rather
than to Postgres, and whose rules are deliberately testable with no network at all
(`scripts/seed-accounts.ts`'s header). Different dependencies, different failure surface, and it
prints a password once — worth keeping small.

**`infra/hetzner/provision.sh` keeps running nothing repo-level.** `setup-local.ts`'s own header:
*"there is deliberately nothing box-specific in it, because a setup path that only the box uses is
one only the box can break."* The documented `npm ci && npm run setup` in the Hetzner README is the
hook, and after this it does the whole job.

## The store this all lands in — the trap

`SPIDERYARN_STORE` **defaults to `files`** ([`src/store/index.ts`](../../src/store/index.ts)) and is
not set in `.env.local` on this box. So `npm run dev` here serves article reads off the filesystem,
and **every article this seed writes to Postgres would be invisible in the browser** while the seed
reported three articles loaded. That is the exact shape of
[silent-success.md](../reusable/silent-success.md), and it defeats the whole feature.

CLAUDE.md is already explicit that new work runs on Postgres, *"and that includes your laptop"*. Two
small pieces:

- **`db:seed-dev` reads `SPIDERYARN_STORE` and says so on its last line** — green when it is
  `postgres`, a loud yellow warning naming the variable when it is not. It cannot fix it: `.env.local`
  on the box is **rebuilt** by `gjd-remote push-env` from the laptop's copy, so a line written here
  would be destroyed by the next push. Same shape, same honesty, as `setup-local.ts`'s existing
  `SPIDERYARN_OWNER_ID` warning.
- **`SPIDERYARN_STORE` joins the allowlist** in
  [`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts), so that once Greg sets it on the
  laptop every future box inherits it. Adding a name to the allowlist sends nothing on its own — only
  a value that is actually set travels.

Setting the value is Greg's, on the laptop, and is listed under § What Greg has to do.

## What has to be true afterwards, and how each is checked

Every one of these is a way to report success while the shelf is empty, so each gets a check rather
than a reader.

| The failure | The check |
|---|---|
| Articles loaded onto the wrong shelf | After loading, **query** `count(*)` of published articles where `owner_id = ADMIN_USER_ID_LOCAL` and print that number. Never a sentence derived from intent — `setup-local` was caught doing exactly this ("printed 'one shelf' on the strength of an environment variable", 260901j review) |
| Loaded nothing, reported done | Assert `copied.length > 0` and `published === true` per slug. A bad root returns an empty array and no error; `loadArticleIntoPg` already refuses a zero-copy publish, and the seed asserts it too |
| Skip branch swallowing a failure | The skip is keyed on a **published revision**, not on the `articles` row |
| Experimental "seeded" but off | Read `experimental_since` back for `ADMIN_USER_ID_LOCAL` after the write and print the timestamp |
| Wrong database entirely | Settle identity against `supabase status`, not against `DATABASE_URL` — an `ssh -L` onto loopback passes every URL check, which is what `db-reown` and `db:seed-owner` both learned. Print a password-stripped `Target:` line before connecting |
| The whole thing works and the browser still sees nothing | `npx tsx scripts/browser-sign-in.ts --at /read/writes` — hardened in the 260901j review to verify the grant token's `sub`, the shelf's `articles` array, and to fail on any failing `/api/` call. One invocation covers sign-in, admin identity, an owned shelf and a resolvable article. Run as the end-to-end verification, and named in the seed's closing output |

Plus the ordinary gates: a unit test for the pure decision (which slugs to skip, given rows), and
`npm test` + `npm run typecheck` before commit.

## What Greg has to do on the laptop

Nothing on the box; this plan does it there. On the Mac:

1. `git pull` on `dev`.
2. Add `SPIDERYARN_STORE=postgres` to `.env.local` — the trap above. `SPIDERYARN_OWNER_ID` should
   already be the admin id from `src/admin.ts`; if it is not, set it too, and run
   `npm run db:reown -- --apply` first, in the order in
   [supabase-local.md § One shelf](../project/supabase-local.md#one-shelf-and-how-to-get-there).
3. `npm run setup` — which now ends with the dev shelf seeded.
4. `npm run db:admin-password` prints the laptop's own email and password. **This is the thing that
   was already there and undiscoverable.**
5. `npx tsx scripts/gjd-remote.ts push-env` when convenient, so future boxes inherit
   `SPIDERYARN_STORE`.

## The simpler options passed over

- **A third `dev@spideryarn.local` sign-in account.** § No third account, above. Rejected on the
  admin-uuid allowlist and on 260901j's own record.
- **A hardcoded password in a doc**, which Greg's message offers. Decided against on 2026-08-31 with
  reasons, in `seed-accounts.ts`'s header. Not reopened.
- **Fold it into `db:seed-owner`.** Different dependency set — GoTrue's admin API versus `getDb()` and
  the corpus — and that file's no-network testability is deliberate.
- **Run it from `provision.sh`.** Recreates the box-only setup path that `setup-local.ts` exists to
  end, and runs as the wrong user.
- **Seed all five corpus articles.** Two of the five are deliberately unpublishable fixtures.
- **Move `load-article.ts` somewhere neutral.** Would drag four helper dependencies with it for zero
  behaviour change.

## Docs to update in the same piece of work

- [supabase-local.md § Signing in](../project/supabase-local.md#signing-in-with-no-google-and-no-browser-you-cannot-reach)
  — the new step, and one short paragraph making `db:admin-password` findable, since not knowing it
  existed is what prompted this.
- [dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md) — a row for
  `db:seed-dev` in the commands table.
- [experimental-features.md](../project/experimental-features.md) — that it is on by default for the
  seeded local account, and where.
- [`tests/fixtures/data-root/README.md`](../../tests/fixtures/data-root/README.md) — that the corpus
  now has a consumer outside the test suite.

## What the review changed

GPT Sol reviewed this plan before it was built, on 2026-09-02, and found three high and two medium
defects. All were real and all are fixed. Two of the highs had already been caught by running the
thing, which is the argument for doing both.

- **The end-to-end command named a route that does not exist.** `/reading/writes` — the app's route is
  `/read/<slug>`, and unknown paths deliberately fall back to the library, so the check would have
  loaded the shelf, made only successful API calls and printed `ok` **without ever requesting an
  article**. The verification for a silent success was itself one. Found independently by running it
  before the review landed; Sol found it in the prose.
- **A count is not evidence that the fixtures are visible.** `onTheShelf()` is only the
  SQL-expressible half of the rule — `listArticles` separately drops a revision with no tree and one
  with no blocks — so the count said **13** where `/api/library` said **11**. Caught by running
  `browser-sign-in.ts` against the seeded database. Now the seed calls `listArticles()` itself, and
  Sol's sharper point is also in: it asserts the **named slugs** are present, because a positive total
  is satisfied by eleven old articles while all three fixtures failed.
- **Archived articles were a state nobody had thought about** — implied by Sol's finding 2.
  `listArticles()` answers the *unarchived* shelf, so an article the reader had put away read as
  "missing", would be reloaded on every `npm run setup`, and would then fail the postcondition anyway,
  because a reload does not unarchive. `planSlug` now skips it and says so.
- **The `SPIDERYARN_STORE` warning became a refusal.** The plan said warn-only, on the grounds that
  several agents share this checkout and a failing `npm run setup` is disruptive. Sol's answer is
  better and is what shipped: the promise of the command is *"ready to use"*, and with the filesystem
  store selected neither the articles nor the switch reaches the application at all, so reporting
  completion over that is the exact failure the command exists to prevent. It exits non-zero **after**
  the durable work, and says so, so a re-run is three skips and a second. `SPIDERYARN_STORE=` is also
  in `.env.example` now, not only on the remote allowlist.
- **The source bytes could have gone to the wrong place.** `loadArticleIntoPg` calls `storeRawSource`,
  whose default `blobStore()` **falls back to `data/_blobs/`** when a Supabase credential is missing —
  so a standalone `db:seed-dev` could commit revision rows naming objects only this machine can see,
  which is [260831e](../postmortems/260831e-a-write-path-with-no-reader.md) happening again. The seed
  now constructs `postgresBlobStore(…)` as a fence before the first write; its constructor checks both
  the credential and the database/bucket pairing.
- **Two per-load assertions were redundant and were cut.** `copied.length > 0` and `published === true`
  both re-checked something the loader already throws on, and both asked about the write when the
  question is whether the article is readable. The `listArticles()` postcondition replaces both and is
  strictly stronger.
- **Sol endorsed the `scripts/` → `tests/helpers/` precedent** for this v1: it does not resurrect the
  importer, there is still one fixture-copy implementation, and it drives the real seams. If it ever
  becomes uncomfortable, its advice is to move the canonical loader to `scripts/lib/` and have tests
  import *it* — never a wrapper that reimplements copying, and never a promotion into `src/store/`.

## One thing found by running it, not by either review

**A full `npm test` turns Experimental Features back off.**
[`tests/owner-isolation.test.ts`](../../tests/owner-isolation.test.ts) deletes the environment owner's
`reader_profiles` row in an `afterAll`, and on a machine where `SPIDERYARN_OWNER_ID` is the
administrator — which is what every doc here tells you to do — that is this account's row. The only
symptom is the "since" date moving, which reads exactly like a broken `coalesce`. It is not: three
back-to-back seeds hold the date steady. Re-running the seed fixes it in a second, and both the script
and [supabase-local.md](../project/supabase-local.md#a-shelf-with-something-on-it) now say so.

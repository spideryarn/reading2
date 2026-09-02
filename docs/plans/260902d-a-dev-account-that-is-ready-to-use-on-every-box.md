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

## What the code review changed

Sol reviewed the **built** code afterwards — the review CLAUDE.md says to weight higher, and it
earned that here, finding one high and one medium that the plan review could not have seen.

- **High: a library card is not an article.** The seed decided and reported using `listArticles()`,
  which trusts the **cached `block_count` column**. The reading route reads the actual
  `revision_blocks` rows. So a revision with a tree, a positive `block_count` and no block rows is
  *listed on the shelf* and *404s when opened* — the seed would skip it and exit 0.
  **Reproduced deliberately**: deleting `todo`'s block rows left `block_count = 10` against 0 real
  rows, and `listArticles()` still returned the slug while `loadArticle()` threw 404. The seed now
  asks `loadArticle` — the route's own bar — for every decision and for the final answer, and on that
  broken state it reloaded and republished instead of skipping.
- **High, second half: `archived_at` was being treated as proof of health.** An archived article was
  skipped *and* left out of the expected set, so an archived-and-broken one exited green while absent
  from both the active shelf and the archived one. Archived is now reported and never a reason to
  skip: a healthy archived article is skipped because it is readable, and a broken one is reloaded —
  publishing preserves the archive state. A unit test covers each, and breaking the branch turns the
  right one red.
- **High, third half: the mutable `expected` list was the bug's vehicle.** Built branch by branch as
  the loop ran, so a wrong branch silently shrank what got checked. It is now the fixed seeded set
  minus whatever belongs to another owner — a rule rather than bookkeeping.
- **Medium: `serialise: true` was the wrong lock, held for the wrong span.** It takes `RUN_LOCK`
  around each individual load, leaving the decisions, the gaps between slugs and the postcondition
  unprotected. `store-parity` and `store-roundtrip` take the separate **`CORPUS_LOCK`** and then clear
  every current revision, so a corpus wipe could land between the last load and the answer and the run
  would exit 0 over state that had already gone. That is also what produced the mid-run
  `404 /api/article/writes` seen while testing. The seed now takes `CORPUS_LOCK` around the whole
  article phase, **outside** `RUN_LOCK`, which is the documented order and the only one that cannot
  deadlock.
- **Low: the blob fence was not before the first write**, as its own comment claimed — the experimental
  upsert ran first. Moved above it, so every preflight refusal precedes every mutation.
- **Low: four stale sentences.** `supabase-local.md` still said the store check "warns" when it now
  exits non-zero; it and the fixture README still said both excluded fixtures "exist to be refused",
  which is untrue of `noema`; `seed-dev-rules.ts` still explained why it was a warning and not a
  refusal; and `setup-local.ts` still described the world before the corpus was committed.

Sol cleared three things explicitly: the non-zero exit is correctly placed after the durable work, the
`scripts/` → `tests/helpers/` import has no vitest dependency and no import-time side effect (~128 ms),
and another owner's slug cannot produce a successful exit.

**One thing was left as it is, with the comment corrected instead.** The blob fence checks
configuration — it refuses a missing credential and a database/bucket project mismatch — but it makes
no Storage call, so on an all-skip run a present-but-invalid key passes. Adding a `loadSource` probe
would be the fix if "ready" has to include opening the original document. It does not today, and the
narrower claim is now what the comment says.

## The follow-on: the account needed a name of its own

Greg, reading the finished work, 2026-09-02:

> I think I worry about confusion, because greg@gregdetre.com is my real user on production with
> Google login. So I'd like the dev-dummy user to be called something distinct and different, and
> that highlights it's a dummy.

He is right, and the confusion was worse than cosmetic. Two accounts held one address: one on
production, reached by a Google sign-in, holding real readers' neighbours in the same table; one on
a laptop or the box, holding a generated password precisely so that no human is involved. A Studio
user list, an `/admin/users` screenshot or a line of script output could not be read for which of
the two it came from — and **doing something to production while believing you are local is the
worst single mistake available in this repo.**

### The rename is free, because the gate never read the address

`/api/admin/*` compares uuids, `SPIDERYARN_OWNER_ID` is a uuid, and `tests/helpers/authed.ts` signs
with a uuid — [`src/admin.ts`](../../src/admin.ts) argues that at length and none of it changes. The
email is a label on a row, so this alters what a person sees and nothing that code decides. Proven
rather than assumed: after the rename, `browser-sign-in --at /admin/users` still gets
`200 /api/admin/users`.

`ADMIN_EMAIL` stays `greg@gregdetre.com` and is now documented as production's alone — it is what
`describeAdminMiss` compares and what the Feedback dialog builds a `mailto:` from. The new
`ADMIN_EMAIL_LOCAL` sits beside it, mirroring the `ADMIN_USER_ID_LOCAL` / `ADMIN_USER_ID_PROD` pair
that is already there for exactly the same reason.

### The name

`dev-admin@spideryarn.local`. Fable arbitrated between four candidates and made the argument that
settled it: **"dummy" would be actively misleading.** This is the one account a human *does* sign in
as and type into a form; the row that is truly a dummy is `dev@spideryarn.local`, the owner nobody
signs in as. `dev-` is the accurate scope and `admin` the accurate role, the two read as a matched
pair, and `.local` is a reserved undeliverable TLD (RFC 6762) so nothing can send to it by accident.
Fable also advised *against* renaming `dev@spideryarn.local` for symmetry — churn through
`src/owner.ts` and the docs for no confusion actually prevented. Taken.

### Every existing machine catches up on its own

This is the part that needed real design. Every laptop and box seeded since 31 August holds the old
address at `ADMIN_USER_ID_LOCAL`, and `ensureAccount` refused an id holding an address it did not
expect — so a straight constant change would have stopped `npm run setup` at step 3 on every machine
that already worked, with a refusal only Greg could clear. That is the opposite of the brief.

So `db:seed-owner` **renames the row rather than refusing**, and says so on the line it prints. The
decision is a pure `planAccountEmail` in [`scripts/seed-accounts.ts`](../../scripts/seed-accounts.ts)
— `create` / `keep` / `rename` / `refuse` — tested with no GoTrue running.

Writing an address onto an account you did not create is, in general, account takeover, so the
fence is four-part and every part has to hold:

- **It cannot reach production.** `refuseNonLocalSeed` checks the parsed hostname (not a substring —
  see the userinfo case it already defends against) and `refuseMismatchedStack` asks the Supabase CLI
  which containers these actually are.
- **One id.** Only `ADMIN_USER_ID_LOCAL` has a non-empty `renamableFrom`; the owner row's is `[]` and
  a test pins that it can never be renamed.
- **One old address**, a literal in git, not a pattern.
- **It destroys nothing.** *Measured*, on GoTrue v2.195.0, 2026-09-02, on a throwaway account, before
  the design was chosen: an admin email change leaves the password alone, leaves an open refresh
  token valid, and the new address signs in immediately. Worth measuring because its neighbour is
  the opposite — the password write revokes every session, which is why that one is done only when
  it must be.

The rename runs **before** the password block, not after, because everything below it signs in *at
the new address*: left until later it would falsify its own precondition and the run would report a
wrong password on an account whose password is fine.

### `TEST_EMAIL` was the one identity still written longhand

`tests/helpers/authed.ts` carries a comment about exactly this failure — three test files once spelled
Greg's `sub` out by hand, so a changed dev identity would have left them all quietly describing
somebody who is not there. `TEST_SUB` was fixed then; `TEST_EMAIL` was not, and was still the literal
`"greg@gregdetre.com"`. It now imports the constant.

That mattered more than it looks: `tests/feedback-route.test.ts` asserts a submitted bug report
carries `TEST_EMAIL` as its `reporterEmail`, so the suite was manufacturing feedback from Greg's real
address and checking it came out intact.

It also turned up **a check that was about to stop being able to fail**. `tests/auth.test.ts` proves
no thrown message leaks an email, and its needle was the literal `"gregdetre"` — once the fixture
stopped using that address the assertion would have passed for ever, over any leak at all. It now
searches for the address the fixture actually uses. `tests/admin.test.ts` had the mirror problem in
the other direction: `expect(ADMIN_EMAIL).toBe(TEST_EMAIL)` was what pinned the suite to Greg's real
address, and it now asserts the opposite property on purpose.

### Evidence

Red before green, on the new rules: backing out `renamableFrom` and the new address failed exactly
the four new tests (`4 failed | 30 passed`), and restoring them passed all 34. Then the live path, on
this box, which was in the pre-rename state:

```
✓ renamed greg@gregdetre.com to dev-admin@spideryarn.local (f4d08b58-…) — same account, same password
✓ already present, password already correct: dev-admin@spideryarn.local (f4d08b58-…)
✓ signed in as dev-admin@spideryarn.local, token sub is f4d08b58-…
```

A second run prints no rename line — idempotent. `browser-sign-in --at /read/writes` opens the
article, `--at /admin/users` gets `200 /api/admin/users`, and `db:seed-dev` reports
`3 of 3 seeded articles open cleanly`.

### What Greg has to do on the laptop for this part

Nothing, beyond the `git pull` and the `SPIDERYARN_STORE=postgres` line already listed above. The
next `npm run setup` — or `npm run db:seed-owner` on its own — renames the row and prints what it
did. The password does not change and open browser sessions are not signed out.

### What the rename review changed

[The review](260902d-rename-review-sol.md). No finding was wrong, and two of them were about the
rename claiming more than it did.

- **Medium: `db:admin-password` printed an address the database did not have yet.** Pull the commit,
  run it before the seed, and it prints `dev-admin@spideryarn.local` on a machine still holding the
  old address — exits 0, sign-in refused. The repo's own success-over-stale-state shape. **Not fixed
  by reading the database**, because that file's header argues at length that touching it would be
  wrong: the command has to work with Docker off, which is when somebody is most likely hunting for
  it. Sol's stronger suggestion — a version marker in the password file — is a permanent format
  change bought for a window that closes the first time anybody runs the seed. So it prints what to
  do when the credential is refused, which is also the right advice on a never-seeded machine.
- **Medium: the fence establishes location, not provenance.** The comment claimed "no row we did not
  seed is reachable", which is false: the laptop's row was made by a Google sign-in before any of
  this existed, and `planAccountEmail` sees only an id and an address. Sol proposed proving ownership
  by signing in with the old credentials first — which fails on exactly the legitimate case, since
  that Google row had no password. So the claim is corrected instead, and the assumption written
  down: *a local stack is a single-purpose fixture whose fixed ids belong to this repo*, and a
  restored dump or a genuinely shared stack breaks it.
- **Medium: the rename does not reach a `google` identity.** GoTrue keeps a row per sign-in method
  and the admin `PUT` updates only the `email` one. A machine whose local account began as a Google
  sign-in therefore ends up renamed on the surface and still holding Greg's real address underneath,
  in Studio and on the profile page — which is a real part of the confusion he asked to end. This
  box is not in that state (checked: one `email` identity, `provider: "email"`), but the laptop may
  be. `db:seed-owner` now **re-reads the account from the `PUT` response and says which provider
  still holds the old address**, and deliberately deletes nothing: removing an identity signs that
  method out for good and is Greg's call. `staleIdentities` is the pure part, with four tests.
- **Low, and accepted rather than fixed: an unrelated concurrent writer could race the rename.** The
  code reads, then writes unconditionally. Cooperative peer seed runs are fine — a concurrent
  creation of the target address makes GoTrue reject the rename, and the final sign-in prevents a
  false success — and closing it properly needs locking or a conditional update. Written down here
  rather than papered over.

Four overclaims, all corrected: `.local` is reserved for mDNS but is **not** undeliverable (this
stack runs Mailpit, which would accept a message for it); "nothing in code read the address" is too
broad, since sign-in, display and feedback attribution all do — the true claim is that
*authorization and ownership* do not; `ADMIN_EMAIL` is not literally production-only, because the
migration names it as the address to move *off*; and a test called "never onto a live one" checked
no such thing, so it is now called what it does.

Sol confirmed the sweep: no other tracked executable reader of the old address, nothing in
`.env.local`, and no remaining test that depends on it being Greg's specifically.

### The check that would have cried wolf every time

The stale-identity warning above was written to read `identities` off the `PUT`'s own response body,
on the reasoning that GoTrue's reply *is* the account afterwards. Exercised rather than assumed, and
it is not:

```
PUT body says stale: [ 'email' ]
fresh GET says stale: []
```

The response is composed before the identity row is updated, so it always shows the `email` identity
on the old address. A warning built on it would have fired on **every** rename, including the clean
ones — and a check that cries wolf every time is worse than no check at all, because the one run
where it means something reads exactly like the others. It now re-reads with `findById`.

Then both halves were watched, because a warning nobody has seen fire is not evidence either. On the
real account: renamed, no note. On a throwaway given a `google` identity holding the old address, the
way a browser sign-in would have left one:

```
✓ renamed probe-legacy@… to probe-renamed@… — same account, same password
  note: the google identity still holds probe-legacy@spideryarn.local.
```

The probe account and its identity were deleted afterwards; `auth.users` is back to its five rows.

# The Stripe scripts can reach production, and say so out loud

`npm run stripe:setup` and `npm run stripe:check` could only ever talk to the sandbox and the
laptop. There was no way to point them at production, and the obvious way to try — naming the
target on the command line — failed silently for the database half.

## What was wrong

On 2026-09-03, going live, an agent wrote down this recipe and Greg was about to run it:

```bash
DATABASE_URL=<production> VERCEL_ENV=production STRIPE_SECRET_KEY=sk_live_… npm run stripe:setup
```

Every part of it is reasonable and it does not work. Both scripts call `loadEnvLocal()`, which by
design lets `.env.local` beat the shell ([`src/env.ts`](../../src/env.ts) header, and the reason is
a good one — a `~/.zshrc` export and a deliberate `FOO=x npm run …` are the same thing to a child
process). Measured, rather than read off the source:

```
DATABASE_URL   from shell: SHELLUSER@shell.example.com:6543
DATABASE_URL   after load: postgres@127.0.0.1:54362     ← the laptop
STRIPE key     from shell: sk_live_
STRIPE key     after load: sk_test_                     ← the sandbox
```

The Stripe half fails loudly: a test key with `VERCEL_ENV=production` trips
`stripeConfigProblem()` and the script throws. **The database half fails quietly.** With the key
fixed, `stripe:setup --apply` would have talked to live Stripe, created live products and prices,
and written `stripe_price_id` back to the *local* Postgres — printing "Price ids are on the
billing_tiers rows" while production's rows stayed empty and nothing could be sold.

That is [silent-success.md](../reusable/silent-success.md), and it is the same accident as
[database.md § `DATABASE_URL=… npm run db:migrate` does not do what it looks
like](../project/database.md#database_url-npm-run-dbmigrate-does-not-do-what-it-looks-like). The
recipe even said "read the `Target:` line before going further" — **neither script prints one.**
The instruction described a safety rail that did not exist, which is worse than no instruction.

## The shape of the fix

Take the arrangement [`scripts/check-owner-identity.ts`](../../scripts/check-owner-identity.ts)
already invented for exactly this problem, and make it shared rather than private to one file:

> Everything else here goes through `loadEnvLocal()`, which deliberately lets `.env.local` beat the
> shell … That makes "export the production URL and run it" quietly wrong: `.env.local` would win
> and this would report on the Docker container instead. `.env.prod` is otherwise "read by nothing",
> so it is read here explicitly, and the guard below refuses anything local.

So the target is a **flag, not an environment variable**: `--prod` reads `.env.prod`. Nothing is
typed on the command line, which means nothing can be mistyped, and a live secret never goes into
shell history.

### Why not shell-wins, like the `db-*` scripts

`resolveTargetUrl({ shellWins: true })` is the other established convention here, and it would make
the recipe above work verbatim. Rejected: it covers `DATABASE_URL` only, so `STRIPE_SECRET_KEY`
would need a second shell-wins rule in `src/env.ts` — a rule whose whole content is "sometimes the
thing this file exists to prevent is fine". Two variables that must agree with each other are
better read from one file that already has both, together, correct.

## Stages

1. **One parser, and `.env.prod` beside the rule it excepts.** Extract `parseEnvFile` out of
   `applyEnvFile` in [`src/env.ts`](../../src/env.ts) so there is one implementation, and add
   `readEnvProd()` next to `resolveTargetUrl` — the same argument applies, that the exception
   belongs beside the rule where a reader of either will find both. It searches this checkout and
   then the primary one, because CLAUDE.md says to work in a worktree and `.env.prod` is not copied
   into worktrees; and it returns **which file it read**, to be printed.
2. **`--prod` on both Stripe scripts, and a `Target:` line on every run.** Whatever the mode, say
   the database host, the database user and the Stripe mode before doing anything. Under `--prod`,
   refuse a `DATABASE_URL` that looks local — the failure to catch is `.env.prod` gone missing and
   the laptop being used instead, which otherwise looks like a clean run.
3. **`check-owner-identity.ts` drops its private copy.** Its `fromProd` becomes the shared reader.
   Its regex is subtly weaker (no `export ` prefix, no single-quoted values), so this is a fix as
   well as a de-duplication.
4. **Tests, docs, review.** `billing.md § Setting it up` gets the real recipe.

## The simpler option passed over

Doing nothing to the code and running the three commands from a throwaway worktree whose
`.env.local` held the production values. It works, it is zero risk today, and it was rejected
because it leaves the trap armed for whoever runs this next — and the next person to run
`stripe:setup --apply` against a database they did not check is the one who finds out that prices
exist on live Stripe and nowhere else.

## What the review changed, and the one worth remembering

GPT Sol returned REQUEST CHANGES on the first build. Four of the five findings were ordinary; one
was the same class of bug the whole plan is about, one level down.

**A fail-closed helper used in the opposite polarity is fail-open.** The first version of the guard
asked `isLocalDatabaseUrl(url)` and refused when it said yes. That function answers "is this the
throwaway container", and it deliberately returns `false` for everything it cannot classify —
unparsable strings, and URLs carrying a `?host=` override, which `pg` honours and connects
elsewhere. `false` is the *safe* answer for its two existing callers, where it means "treat this as
remote": don't skip TLS, don't let the migrator past. Read the other way up it means "yes, this is
production", so

```
postgres://u:p@remote.example.com:6543/db?host=127.0.0.1
```

was accepted, and `--prod --apply` would have created live prices and written the ids to loopback.
The reuse looked like exactly the "reuse the machinery that's already here" the repo asks for.

The fix is `whyNotProduction()`, which classifies **positively** — it names what production is and
refuses everything else — and leaves `isLocalDatabaseUrl` alone rather than giving it a polarity
flag. The lesson generalises past this file: *when reusing a predicate, check which way it fails,
not just what it returns.*

The others: the live account was never identified, so Greg's consulting account's live key would
have passed every guard (`SPIDERYARN_ACCOUNTS` and `accountProblem` in
[`src/billing/stripe.ts`](../../src/billing/stripe.ts)); `execFileSync` inherited `GIT_DIR`, which
could point the `.env.prod` fallback at another repository; `--prodd` was silently ignored and
therefore silently meant the sandbox; and the `parseEnvFile` extraction was **not** the pure
refactor it was described as — the old loop made the *first* duplicate line win, as a side effect of
the shell-precedence rule, and the new one makes the last win. Last-wins was kept on purpose and is
now pinned through `applyEnvFile`, which is where the old behaviour lived.

## Not done

`--prod` is not offered on anything that writes more than `billing_tiers.stripe_price_id`. The
general problem — every script that could be pointed at production — is out of scope; this is the
two that had to go live today.

# 261003g — `npm run deploy` refuses any flag it does not know

**Status:** built. Source: the fifth sweep,
`docs/investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md` (not yet on `dev` when this was written)
§ X1 and § X2. Middle robustness tier (CLAUDE.md § three standards): this is the tool the
Overseer reaches for, and its failure here is a production deploy nobody meant.

## The problem

`scripts/deploy.ts` read its flags with `argv.includes(…)` and rejected nothing. Anything that was
not exactly `--verify-only` fell through to lock → gates → **remote migrations → push to `main`**.
Three ways in, all reproduced by the sweep:

1. **A typo** — `--verify-onyl`, `--dryrun`, `verify-only`.
2. **A dropped `--`** — `npm run deploy --verify-only`. npm 11 takes the flag as its own config and
   runs the script with empty argv. Measured here on npm 11.19.0 with a probe package: argv is `[]`
   and the environment carries `npm_config_verify_only=true` (likewise `npm_config_dry_run=true`,
   `npm_config_verify_onyl=true`, `npm_config_host=…`, `npm_config_skip_migrations=true`,
   `npm_config_force_gate=test`; `--verify-only=false` gives `npm_config_verify_only=` — present,
   empty). npm's own baseline keys on this box are `allow_scripts cache global_prefix
   globalconfig init_module local_prefix loglevel node_gyp noproxy npm_version prefix user_agent
   userconfig`.
3. **`--host`**, which the docs call "verify a host other than www" but which only moved
   `TARGET_HOST`: a full deploy of production, then verification of some other host.

## The change

- **One pure parser**, `parseDeployArgs(argv, env)` in `scripts/deploy-checks.ts`, returning a
  discriminated union:
  `{ ok: true, mode: { op: "verify", host } | { op: "dry-run", … } | { op: "deploy", … } }` or
  `{ ok: false, problem }`. Closed grammar: `--dry-run`, `--verify-only`, `--skip-migrations`,
  `--force-gate=<name>`, `--host <url>` / `--host=<url>`. Anything else — an unknown flag, a
  positional, `--force-gate` without `=`, `--verify-only=x`, a host that is not `http(s)://` — is
  refused, naming the argument.
- **`--host` is verify-only.** It is legal only beside `--verify-only`; on its own, or with
  `--dry-run`, it is refused with "`--host` only goes with `--verify-only`". A deploy always
  verifies `www.spideryarn.com`. Making `--host` *imply* verify-only was the alternative; refused
  because a flag that silently changes the operation is the shape of the bug being fixed.
- **`--verify-only` takes nothing else but `--host`**: `--dry-run`, `--skip-migrations` and
  `--force-gate` mean nothing there (verify runs no gates), and saying so beats ignoring them.
- **The dropped `--`**: refuse when the environment has any `npm_config_*` key outside a short
  allowlist, `NPM_ORDINARY_CONFIG` — the baseline keys above, plus ordinary npmrc plumbing
  (registry, proxy, certificates, how npm prints) and `yes`, which `npx -y` exports to everything
  beneath it. The message names the key, says "use `npm run deploy -- --verify-only`", and says
  where the list is if the key is a real npm setting. npm's own `dry_run`, `read_only`, `only`,
  `force`, `offline`, `ignore_scripts` and `if_present` are deliberately not on it. A missing key
  costs one refused run and a one-line edit; a wrong one is an unasked-for deploy.
  **The first draft matched fragments of our flag names instead, and the plan review broke it both
  ways** (below).
- **`deploy.ts` calls the parser first**, at the top of the module body, and exits 2 on a refusal
  — before the lock, git, the network or the database. The old `has`/`flagValue` helpers and the
  four constants go; the rest of the file reads the mode.

**Simpler options passed over.** Checking only `argv` and leaving the npm case to documentation:
docs already spell it right 249 times out of 249; one tired agent is the margin. And — GPT Sol's
suggestion — **requiring an explicit word to deploy at all** (`npm run deploy -- --production`),
which would make every unrecognised input harmless by construction and need no npm list. It is
the more robust design and it changes the command the Overseer runs and every doc that names it,
so it is Greg's to choose, not this fix's to slip in. Worth asking.

## Plan review (GPT Sol, 2026-10-03) — three findings, all accepted

1. **P1, swallowed typos still deployed.** `--verfiy-only`, `--dr-run` and npm's own
   `--read-only` contain none of the fragments. Fixed by the allowlist; all three are regression
   cases, in the function test and against real npm.
2. **P1, a legitimate npm setting blocked a deploy.** `replace-registry-host` contains `host`.
   Fixed by the same change; a test.
3. **P2, the subprocess test's "can never reach production" overclaimed.** The `PATH` stubs do
   not stop a direct `fetch`. The subprocess now also runs with `fetch` pointed at a proxy on a
   closed port (`NODE_USE_ENV_PROXY`; checked that it refuses), and the header says what is still
   not covered: a direct Postgres connection from `.env.prod`, which nothing reaches before git.

## Code review (GPT Sol, 2026-10-03)

1. **P1, not fixed, and it is the one that is left: npm can discard a flag without a trace.**
   `npm run deploy --_verify-only`, `--/verify-only` and `--@verify-only` reach the script as
   empty argv *and* leave no `npm_config_*` key (reproduced with the probe package). Nothing in
   argv or the environment distinguishes them from a bare `npm run deploy`. Closing it means the
   bare command stops meaning "deploy" — an explicit word, as under "Simpler options" above — and
   that is a change to the Overseer's command, so it is reported rather than built.
   `deployment.md` says so.
2. **P1, fixed by the reviewer: `-n` and `--no` deployed.** npm exports them as
   `npm_config_yes=""`, which the allowlist accepted. Only `yes=true` is ordinary now.
3. **P2, fixed: the proxy fence was bypassable** (`NO_PROXY`, lowercase keys) and did not cover
   Postgres. Replaced with a Node preload that refuses and logs `fetch` and TCP connects. The
   reviewer could not run it in its sandbox and it blocked tsx's own unix socket; corrected, and
   given a control test that sees it block.
4. **P2, fixed: the subprocess cases could refuse for the wrong reason** — an inherited
   `npm_config_*` masking an argv regression. They now strip npm config and assert the exact
   refusal.

## X2 — `scripts/check-production-gate.sh`: deleted

It passes over a page with no app and assets that never arrived, its default hosts are not
production, and nothing calls it. `verify()` in `deploy.ts` already covers everything it checks
but one: `DELETE /api/health → 405`, which production answers today (curl, 2026-10-03). That
check moves into `verifyRequestBody`'s neighbour in `deploy.ts`; the script is deleted; `auth.md`'s
row and the test comments that name it point at `npm run deploy -- --verify-only`.

## Tests (red first)

- `tests/deploy-checks.test.ts` — `parseDeployArgs` over every spelling in the investigation, the
  three npm env cases, `--host` alone and with `--dry-run`, and the legal forms.
- `tests/deploy-refuses-flags.test.ts` § "what npm really hands the script" — the real `npm run`
  against a probe package, fed to the real parser: bare is a deploy, `-- --verify-only` is a
  verify, and six swallowed spellings are refused. This is the check on the npm assumption itself,
  and it is what goes red if an npm upgrade exports a new key on every run.
- `tests/deploy-refuses-flags.test.ts` — **the script itself**, as a subprocess, for the three
  cases (typo, npm-swallowed, `--host`): exit code 2, the bad flag named, and **nothing touched**.
  Safe even while red: `PATH` starts with a stub directory whose `git`, `npm`, `npx`, `vercel`,
  `supabase` and `psql` append their name to a log and exit 1, and `DATABASE_URL` and friends are
  removed. The first external step of the deploy path is `git` (`takeLock` → `gitCommonDir`), so
  an unfixed script dies at the stub — and the log saying `git` is the red. Green is exit 2 with an
  empty log.

## Docs

`deployment.md`'s flag table (`--host` row, a line on refusals); the plan 260827v line that says
`--host` deploys nothing; `overseer.md` § Deploying only if the usage it describes changes (it
does not: the Overseer runs bare `npm run deploy`).

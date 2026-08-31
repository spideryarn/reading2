# Making the remote box a real dev environment

The box exists and runs Claude Code ([260831a-remote-server-for-claude-code.md](../research/260831a-remote-server-for-claude-code.md),
[260831d-gjd-remote-cli.md](../research/260831d-gjd-remote-cli.md)). It cannot yet *do* anything with this project:
no repo, no GitHub credentials, no secrets, no database. This plan closes that gap.

Greg's list, 2026-08-31:

> - install Claude Code, and figure out how to authenticate (done, I think — requires me to do it
>   manually the first time)
> - get Chrome & Playwright set up, and run a smoke test on controlling & screenshots from Chrome
> - get GitHub auth setup, so that we can pull/push
> - copy over .env.local (we might need a way to do this regularly in future if we update it locally)
> - set up Supabase local, along with Docker/Orbstack/something-else perhaps
> - set up Vercel, Sentry, Supabase MCPs (and authenticate)

Reviewed by GPT Sol before any of it was built —
[260831x-remote-box-dev-environment-review-sol.md](260831x-remote-box-dev-environment-review-sol.md). It returned
STOP with three blockers, all of which were real, and all of which are folded in below. The shape of
the plan changed as a result: two layers became three, a blocklist became an allowlist, and the
final stage became two proofs instead of one.

## The three layers

The first draft said everything must live either in `provision.sh` or in a push from the laptop.
That was one layer short, and Sol was right about why: the repo and its lockfile are a third source
of truth, and folding project tooling into root-level provisioning produces global installs that
drift away from what `package-lock.json` says.

1. **OS provisioning** — `provision.sh`, run by cloud-init on a fresh box and re-runnable by hand.
   Docker, `gh`, Node, Chrome, system packages. No secrets, nothing project-specific.
2. **Repo bootstrap** — `gjd-remote bootstrap`, driven from the laptop *after* provisioning. Git
   config, clone, `npm ci`, Supabase, migrations. Needs credentials, so it cannot run at first boot.
3. **Secrets and ceremonies** — `gjd-remote push-env` for files, plus the interactive one-offs that
   genuinely need a human (`claude` `/login`, `claude mcp login vercel --no-browser`). These get
   *written down as a numbered ceremony*, because they are the part that recovery forgets.

Sol's correction to the original rule is worth keeping verbatim, because it is a better rule than
the one I wrote:

> A hand-run diagnostic is not a bug. Undocumented state required for recovery is the bug.

## Where we are (measured 2026-08-31, not assumed)

| | State |
|---|---|
| Ubuntu 24.04.4, 16 vCPU, 30GB RAM, 15GB swap | ✅ |
| `/home` on the 50GB volume, 46GB free; root disk 268GB free | ✅ |
| Node 26.8.1, npm 11.19.0 | ✅ |
| Claude Code 2.1.251, **authenticated** (Greg, once, by hand) | ✅ |
| playwright + chrome-devtools MCPs, `--scope user`, both connected | ✅ |
| Chrome 152.0.7977.64, Playwright chromium-1234 | ✅ |
| tmux 3.4, mosh 1.4.0 | ✅ |
| `gh` 2.98.0, `jq`, `file`, `rg`, `unzip` | ✅ installed 2026-08-31 |
| Docker, Supabase CLI | ❌ absent |
| Vercel / Sentry / Supabase MCPs | ❌ absent |
| The repo, `.env.local`, git identity, GitHub credentials | ❌ absent |

**The browser smoke test already passes.** Playwright drove system Chrome against a Node server on
`127.0.0.1:4321`: navigate → read `#t` (`Localhost app OK`) → click `#b` → re-read `#t` (`CLICKED`)
→ screenshot, PNG magic `89504e470d0a1a0a`, 1280x720, 7106 bytes. Two different pages produced two
different PNGs, so it rendered rather than emitting a fixed blank. Stage 1 turns that into a
committed script instead of a thing I once typed.

**One trap found while doing it.** `~/.cache/ms-playwright/chromium-1234` was downloaded by
`@playwright/mcp@0.0.79`. A project that installs its own `playwright` pins a *different* browser
build number and fails with "Executable doesn't exist" until `npx playwright install chromium` is
run. Either run that per-project, or launch with `executablePath: "/usr/bin/google-chrome-stable"`
as the smoke test does.

> **Correction, 2026-08-31 (same day, later).** The attribution above is wrong, and the conclusion
> it led to was the opposite of the truth. `chromium-1234` was **not** downloaded by
> `@playwright/mcp` — it was downloaded by this file's own provisioning step,
> `npx --yes playwright@latest install chromium`, and 1234 is the revision `playwright@1.62.1`
> wants. The MCP bundles `playwright-core@1.63.0-alpha`, which wants **1237**, and that revision was
> never on the box at all.
>
> Which raised the obvious question of how the MCP worked, and the answer is that it never used
> either: reading `/proc/<pid>/exe` during a live MCP navigation showed `/opt/google/chrome/chrome`.
> Both MCPs default to the system Chrome channel. So the 651MB the provisioning step downloaded was
> launched by nothing, and its build number floated with the date of the provisioning run.
>
> The step has been removed and the MCP registration now says `--browser chrome` explicitly. The
> advice in the paragraph above — pass `executablePath` — is still right, and is now the only thing
> that works. [browser-control.md](../project/browser-control.md).

## What is genuinely at risk, given "no backups"

Greg chose no backups because the code is all pushed to a remote. **That premise is not true today.**
Checked on the laptop, 2026-08-31: `main...origin/main [ahead 116]`, 40 uncommitted files. A fresh
clone would not contain the tree currently being worked on, and the box will accumulate the same
kind of unpushed work — with the added twist that nobody is sitting in front of it.

| On `/home`, not in git | Comes back from |
|---|---|
| `.env.local` | the laptop, via `gjd-remote push-env` |
| Claude Code credentials | `claude` `/login`, by hand |
| GitHub token files | re-issued on github.com, by hand |
| tmux sessions and their transcripts | nothing — genuinely lost |
| **Unpushed commits and uncommitted work in the box's checkouts** | **nothing** |
| Local Supabase contents — ingested articles, storage objects, local users | `db:reset && db:migrate` restores the *schema* only, not the data |

The last two rows are the honest ones, and the first draft of this table got both wrong. "No
backups" is a fine decision for a box whose checkouts are always pushed; it is a different decision
for one where five sessions have unpushed work. Stage 2 therefore adds a staleness check rather than
assuming the premise, and stage 5 tests recovery rather than asserting it.


## A landmine to know about before anyone runs `tofu apply`

Checked 2026-08-31: `tofu plan` **already reports `hcloud_server.box must be replaced`**, before any
change in this plan. The reason is `user_data` — the live box was created from the cloud-init we had
*before* yesterday's round of fixes, so the hash in state no longer matches the repo.

That means **any `tofu apply`, for any reason, destroys and recreates the box** and kills whatever
tmux sessions are running. `/home` survives (the volume has delete protection and is bind-mounted
back), and `gjd-remote` reads the host from `tofu output` so it follows the new IP by itself — but
running sessions and their transcripts do not survive.

Do not paper over this with `ignore_changes = [user_data]`: we *want* cloud-init edits to take
effect on the next rebuild. The resolution is to make the rebuild deliberate — it is stage 5(a), and
doing it on purpose converts a landmine into the drill we wanted anyway.

## Stages

Each ends green, committed, and safe to abandon.

### Stage 1 — utilities, a doctor that can fail, and a scripted smoke test

No credentials. `gh`/`jq`/`file`/`rg`/`unzip` (done on the live box; still to fold into
provisioning), the browser smoke test as a committed script, and `push-env`.

**`doctor` currently prints red crosses and exits 0.** Every "doctor is green" claim in the rest of
this plan is worthless until that is fixed, so it is fixed first, and mutation-tested — break one
check, watch the exit code, put it back.

**`push-env` uses an allowlist of key names, not a blocklist.** `.env.local` holds
`HETZNER_CLOUD_API_TOKEN` (can destroy this box) and `SUPABASE_ACCESS_TOKEN` (a management PAT that
`.env.example`'s own comment says can "create and delete projects"). Neither goes to the box.
A blocklist would be the wrong shape anyway: the next secret Greg adds would be pushed by default.
Keys not on the allowlist are skipped **and named**, so the omission is visible.

**Done when:** doctor asserts Chrome can screenshot and Playwright can click, and exits non-zero
when either breaks — demonstrated, not assumed.

### Stage 2 — GitHub credentials and the repo

Greg, 2026-08-31, on what the box should reach:

> I would like to restrict access to certain repos, and then for it to have pretty much full
> permissions for those.
> spideryarn/reading2, gjdutils, spideryarn/hellozenno, gregdetre/healthyselfjournal,
> gregdetre/healthyselfapp, spideryarn/reading, spideryarn/spideryarn (and it should be easy for me
> to add new repos in future if needed)

Those seven span **two owners** — four under the `spideryarn` org, three under `gregdetre` — and a
fine-grained PAT has exactly one resource owner. So it is two tokens, and something on the box has
to pick the right one per repository.

**Two tokens, routed by a credential helper.** Spiked and settled. `git-credential-store` does *not*
do prefix matching (tested: a stored line for `github.com/spideryarn` does not match
`spideryarn/reading2.git`). Per-owner `credential.<url>.helper` config sections *do* match on a path
prefix on git 2.50.0 — but that contradicts `gitcredentials(5)`, which says a path in the pattern
"must match exactly", so it is one git upgrade away from silently changing. And matching sections
fire in **config-file order**, not most-specific-first, so a broader section written above a narrower
one silently shadows it.

So: a ~50-line POSIX `sh` credential helper, registered once against the host (the uncontested
matching rule), which parses the owner out of the request path itself and reads
`/etc/github-tokens/<owner>.token`. Adding a repo under an existing owner is a click on github.com
and no change on the box; adding a *new owner* is one new file and no code change. An unknown owner
fails loudly before any network call, which beats a 404 that looks like a typo.

**Not `GH_TOKEN` in a shell profile.** `gjd-remote.ts:341` already records that non-interactive ssh
sources neither `.bashrc` nor `.bash_profile`, so an exported token would work when Greg tests it by
hand in a login shell and silently fail inside every actual agent session. That is the exact shape
of bug this project keeps writing postmortems about.

Instead: **a git credential helper script** that reads the owner out of the request path and returns
the matching token from a `0600` file. It solves the two-owner routing and the no-profile problem
with one mechanism, and adding a third owner later is one line in a map file. Mechanics are being
spiked separately; the helper must also behave safely for `store`/`erase` and for an unknown owner.

Then `gjd-remote bootstrap`: git identity, HTTPS clone (not `url.insteadOf`, which surprises other
repos and submodules), `npm ci` rather than `npm install`, and a check that laptop `HEAD`, box
`HEAD` and `origin/main` are compared rather than assumed equal.

**Watch for:** if a fine-grained PAT is pending org approval, a private clone reports
*"Repository not found"* — indistinguishable from a typo. Greg owns the `spideryarn` org, so his
tokens are auto-approved, but the failure mode goes in the runbook because it will cost somebody an
afternoon otherwise.

**Done when:** `git push --dry-run` succeeds **from inside a generated tmux job**, not from a login
shell. Testing it the easy way is testing the wrong thing.

### Stage 3 — Docker and local Supabase

Docker Engine from Docker's own apt repo; Supabase CLI pinned to 2.115.0 to match the repo.

Three things research settled, so they do not need re-deciding:

- **Docker's data-root stays on the ephemeral root disk.** In CLI 2.115.0 the Postgres data
  directory and storage objects are bind-mounted from `~/.local/state/supabase/managed/`, which is
  already on the persistent volume. Only image layers are lost on a rebuild — a few minutes' re-pull,
  not data loss. Moving `data-root` would spend pet-volume space to save that, and on Docker 29+ can
  silently leave snapshots under `/var/lib/containerd` anyway.
- **One shared stack for the whole box**, not one per session. The project already has cross-process
  advisory locks for exactly this ([`tests/helpers/run-lock.ts`](../../tests/helpers/run-lock.ts)),
  measured at 0 failures across concurrent runs. A second isolation mechanism would be a second way
  to do the same thing.
- **`docker` group membership is root-equivalent.** On this box that is no marginal loss — the one
  account already has passwordless sudo, Greg's recorded decision — but it is named here rather than
  inherited silently.

**Also: the local stack binds `0.0.0.0`, not `127.0.0.1`.** Verified in CLI source. The keys are the
CLI's fixed public demo values, so the only thing protecting it is the Hetzner firewall's
SSH-and-mosh-only rule. That is worth knowing before anyone edits a firewall rule.

**`npm test` passing on the box proves nothing by itself**, because
[`tests/helpers/pg-ready.ts`](../../tests/helpers/pg-ready.ts) turns an unreachable database into
`describe.skip`. This stage adds a `REQUIRE_POSTGRES=1` mode in which that probe **fails** instead of
skipping, and uses it here.

**Done when:** `REQUIRE_POSTGRES=1 npm test` is green on the box.

### Stage 4 — the MCPs (opt-in)

`infra/hetzner/README.md` says the MCP list is deliberately short and to argue before adding a
third. Adding three at user scope, where every session pays for them, would walk past our own note.
So these are **project-scoped and opt-in**, not global.

- **Supabase — point it at the local stack.** Verified by probe, 2026-08-31: the local API serves a
  full MCP at `http://127.0.0.1:54361/mcp` (`serverInfo.name` `supabase`, version 0.10.0), no auth.
  So the box needs **no production Supabase credential at all**, which is what lets stage 1's
  allowlist leave `SUPABASE_ACCESS_TOKEN` behind.
- **Vercel — OAuth is the only option**, no static-token path exists. Claude Code 2.1.186+ has
  `claude mcp login vercel --no-browser`, which prints a URL to paste into a laptop browser; 2.1.191
  auto-detects headless. This is a recorded ceremony, run over `ssh -t`. Note its MCP can *manage
  deployments* and includes purchase tools, so it keeps human confirmation.
- **Sentry — remote HTTP.** Also updates [sentry-error-monitoring.md](../project/sentry-error-monitoring.md),
  which currently says "There is no Sentry MCP, so this one is a browser tab rather than a tool
  call". There is one now.

**Done when:** each is reachable and one real call to each works.

### Stage 5 — two recovery proofs, not one

The first draft said "rebuild the server and run doctor". That proves less than it looks: replacing
the server **reattaches the same populated `/home`**, so the repo, `.env.local`, credentials and MCP
registrations all survive by inheritance. It tests root-disk recreation, not recovery.

So: **(a)** the ordinary `tofu apply -replace=hcloud_server.box`, and **(b)** a separate clean-home
drill on a disposable volume, where the only inputs are this repo, the laptop's `.env.local`, and
the written-down ceremonies. (b) is the one that finds what we forgot.

**Done when:** both pass with no hand-editing on the box, and doctor exits 0 for the right reason.

## Progress log

**2026-08-31, provisioning extracted — done and proven.** `infra/hetzner/provision.sh` is a real
file now, injected base64 via `filebase64()`. Evidence, not assertion: `tofu validate` passes; the
rendered cloud-init parses as YAML; the decoded script is byte-identical to the file on disk
(sha256 `234b4c9bef8f` both sides); a reconstruction of the pre-extraction form matches the original
byte for byte, so nothing was dropped; and re-running it against the already-provisioned live box
gives `PROVISION OK`, exit 0, all 14 checks green.

Writing the comment that explains the escaping trap, I made the escaping trap: a `${...}` inside my
new comment broke `tofu validate` immediately. That is the third time this exact mistake has been
made in this file, which is the argument for the refactor in one line. The comment is now worded
around it and says so.

**A check that had been lying since it was written.** Two verify-block checks — `password auth off`
and `root login off` — reported FAIL on a correctly configured box. Greg hit this yesterday, pasted
`sshd -T` output showing the config was right, and the conclusion drawn was that something about
sshd's runtime state must differ. It did not. `grep -q` exits on match, killing `sshd -T` (95 lines,
match on line 30) with SIGPIPE, exit 141; `pipefail` then reports the pipeline as failed even though
the grep matched. Eight sibling checks use the same shape and passed only because their producers
are short enough to finish first — luck, and it would have looked like a real regression the day one
of them got chattier. Fixed at the helper, which now runs each check with pipefail off, and
mutation-tested: the real check stays green while four deliberately-wrong ones go red.
Written up in [`docs/postmortems/`](../postmortems/).

**A credential leaked while researching credentials.** A subagent testing git credential helpers on
the laptop misconfigured the helper chain and caused `git credential fill` to print Greg's live
`gho_` GitHub OAuth token into its tool output. Not written to a file, not transmitted, but in the
transcript. Greg is rotating it. The lesson is on the brief, not the agent: an experiment about
credentials must be told to run against a scratch config with fake tokens, and I did not say so.
Note this token is the *laptop's*, and unrelated to the box's — see stage 2, where the box gets its
own tokens and never runs `gh auth login`.

**2026-08-31, stage 4 landed, and it needed no provisioning code at all.** The three service MCPs
are in a committed [`.mcp.json`](../../.mcp.json) at project scope, so a new box gets them from
`gjd-remote clone` rather than from `provision.sh`. That is fewer moving parts than the plan
assumed: nothing to add to the provisioning script, nothing that can drift between a box built
today and one built next year, and the browser MCPs stay where they are because they genuinely are
per-machine.

Measured rather than assumed, all on 2026-08-31:

- The local Supabase MCP serves **11 tools** (`tools/list` over curl, `serverInfo` `supabase`
  0.10.0): `search_docs`, `list_tables`, `list_extensions`, `list_migrations`, `apply_migration`,
  `execute_sql`, `query_logs`, `get_advisors`, `get_project_url`, `get_publishable_keys`,
  `generate_typescript_types`. Two of them write, and it is loopback-only, so it cannot reach
  production — which is the thing that lets the `push-env` allowlist keep leaving
  `SUPABASE_ACCESS_TOKEN` behind.
- `https://mcp.vercel.com` → HTTP 401 `invalid_token`. `https://mcp.sentry.dev/mcp` → HTTP 401.
  OAuth is the only way into either; there is no static-token path.
- **`sentry-error-monitoring.md` was wrong** and has been corrected. It said "There is no Sentry
  MCP" — in a doc whose own opening lesson is *check before concluding we do not have this*.
- A project-scope server otherwise leaves every session at `⏸ Pending approval`. Seen on the box,
  fixed with `enabledMcpjsonServers` in `.claude/settings.json`, and confirmed absent on the laptop
  afterwards.

**The deny syntax is not what it looks like.** The whole-server form is **`mcp__vercel`**, with no
trailing `__*`, from the 2.1.251 binary's own help string: *"Use 'mcp__<server>' to deny one
server's tools ('mcp__<server>__<tool>' for one tool), or 'mcp__*' to deny every MCP server's
tools."* I had guessed `mcp__vercel__*` when briefing the spike, and it would have silently denied
nothing. Vercel's `buy_pro`, `buy_domain` and `buy_credits` are now denied in
`.claude/settings.json`, and the proof is that they vanished from this session's own toolset the
moment the file was written. `gjd-remote` passes no `--dangerously-skip-permissions`, so the deny
list genuinely binds on the box.

**A rebuild does not force re-authentication.** `~/.claude/.credentials.json` and `~/.claude.json`
are under `/home`, `findmnt /home` reports `/dev/sdb`, and that is the volume. So the two
`claude mcp login` runs are a once-per-*box* ceremony, not a once-per-`apply` one.

**Still manual, and unavoidably so:** `claude mcp login vercel` and `claude mcp login sentry`, in a
browser, by Greg. Nothing else in stage 4 needs a human.

**Sol reviewed it and said STOP, with one finding worth the whole review.** The banner
`push-env` writes on the box says "production credentials are deliberately absent", and nothing made
that true. The allowlist matches key *names*; `DATABASE_URL` is spelled the same for the throwaway
container and for the one production database. Point `.env.local` at production for an afternoon,
push, and the box quietly holds production under a file claiming it does not. Measured on the box
the same day: every value there is loopback today — so this was latent, not live. Fixed by making it
structural rather than lucky: `MUST_BE_LOCAL` in
[`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts) refuses to send `DATABASE_URL`,
`SUPABASE_URL` or `VITE_SUPABASE_URL` unless the value is loopback, reusing the migrator's own
`isLocalDatabaseUrl` so "local" cannot mean two things in one repo. Four tests, watched red first,
including the `user:p@localhost:5432@remote.example.com` shape that defeated a regex version of this
check elsewhere.

**The deny list was a claim, not a control, and the doc said otherwise.** Three corrections:
`buy_addon` was missing (there are four `buy_*`, not three); `use_vercel_cli` runs the Vercel CLI and
routes around every per-tool entry; and a session on the box can write
`.claude/settings.local.json`, so any agent that can edit the repo can edit the list. It is a guard
rail against the accidental reach, and the README now says exactly that rather than implying a wall.
`pause_project` and `update_project_deployment_protection` are denied too — neither is routine and
both reach production. `deploy_to_vercel` is deliberately left open, because deploying is ordinary
work here.

**`doctor` was oversold as "check the lot".** It knows nothing about the checkout, `.env.local`, the
database, the migrations, the owner row or the fixtures, and the browser smoke deliberately uses a
global `playwright-core` so it works on a clean `/home` with no checkout at all — so a box that
skipped half of First run gets a green doctor. The runbook now says so and closes with
`REQUIRE_POSTGRES=1 npm test`, which is the step that actually proves that half.

**`infra/hetzner/README.md` was outside the doc-links gate**, which globbed `docs/**` plus
`AGENTS.md` only. That is how it came to carry a link to a `#mcp-servers` heading that did not
exist. It is in the gate now, and the gate immediately found a second dead anchor in the same file —
a link of mine to this plan that used the short form of a heading ending "…, discovered by trying
it". The runbook is the markdown most likely to be followed literally by someone who cannot yet ask
the repo anything, and it was the only one not checked.

**Two claims of mine that were wrong.** `/var/log/provision.log` "must end with PROVISION OK" is
false on the live box — cloud-init tees that file on the first boot and never touches it again, so
it still ends `PROVISION INCOMPLETE` from an old build while the status file says `PROVISION OK`.
And a comment in `gjd-remote-env.ts` said the Supabase MCP "gets --read-only"; no such mode exists on
that server or on Vercel's.

**Still open, and not mine to fix:** `npm run setup` inherits the shell, and
[`scripts/db-migrate.ts`](../../scripts/db-migrate.ts) deliberately prefers an exported
`DATABASE_URL` and allows a remote one under `DB_MIGRATE_ALLOW_REMOTE=yes`. Both exports would have
to be present, and the guard refuses a remote URL without the opt-in — so it is two deliberate acts,
not one slip. But `setup-local.ts` calls itself "local by construction" and that is a shade stronger
than what holds. Raised with Greg and with the session that owns that script.

## The `provision.sh` refactor — approved, with a correction

Extract it from the cloud-init heredoc into `infra/hetzner/provision.sh`, so it is shellcheck-able
and rsync-able to a live box.

**But not through `templatefile()`,** which was what the first draft proposed. That would subject
every `${...}` in the shell script to Terraform's parser — the exact trap that produced a BLOCKER in
the previous review, where an unescaped `${...}` *inside a comment* broke the plan. Use `file()` or
`filebase64()` to inject it literally, and pass Terraform's values separately as a small generated
config file the script reads. That gets the re-runnability without exposing the script to Terraform
at all, and it removes a risk the current embedded version already carries.


## What a fresh clone cannot do, discovered by trying it

Stages 2 and 3 landed 2026-08-31. Two setup steps existed nowhere in writing, and both were found by
running the suite on the box rather than by reading anything.

**1. `npm run db:seed-owner`.** A freshly migrated database has no owner row, so every insert
carrying an `owner_id` dies on a foreign key. The visible error was
`StoreFailure: This app asked its database for something it would not do` — true, and it names
neither the constraint nor the fix. `LOG_LEVEL=debug` gave the real answer: sqlstate 23503,
constraint `uploads_owner_fk`. Seeding took 41 failing files down to 23.

**2. Article fixtures, which git does not carry.** `data/` and `output/` are gitignored (62MB and
11MB on the laptop, empty on a fresh clone), and about 19 test files need an article with both
`blocks.json` and `tree.json`. Their failures mostly do not say so:

```
AssertionError: expected 0 to be greater than 0
Error: ENOENT: no such file or directory, lstat '.../data/writes'
Error: Failed query: insert into "spideryarn"."jobs" ...
```

Only two of the nineteen name the real problem. The `jobs` insert is the same cause two steps
removed — it references a `draft_revision_id` for an article that is not there.

This is the class the project already solved once for Postgres:
[`tests/helpers/pg-ready.ts`](../../tests/helpers/pg-ready.ts) exists so an absent database says so
rather than failing obscurely. **Article fixtures have no equivalent**, and every fresh clone hits
it — this box, a rebuild, the deploy gate's worktree, a new contributor. Worth fixing at the source;
recorded rather than done, because Greg's call was to sync the fixtures and keep moving.

Two failures are not fixture-related: `pdf-bundle-trace` needs a `vite build` first, and `doc-links`
finds three broken links that exist on `origin/main` and are already fixed in the laptop's unpushed
commits.

## The box's checkout is 116 commits behind

The clone is `origin/main`; the laptop is far ahead with uncommitted work besides. So "the tests pass
on the box" is currently a claim about an old tree — the same staleness the durability table warns
about, seen from the other side, and why bootstrap should compare the three heads rather than assume
they agree.

## Still open

1. The exact credential-helper mechanics — whether `credential.useHttpPath` with an owner-prefix
   section matches a repo path, or whether a helper script is required. Being spiked.
2. Whether to give the box its own budget-capped OpenRouter key rather than sharing the laptop's.
   Sol's suggestion; cheap; Greg's call, not urgent.

## Not doing

- Splitting the agent account or removing passwordless sudo. Greg's call, 2026-08-30, recorded in
  [`infra/hetzner/README.md`](../../infra/hetzner/README.md).
- Running anything against production data from the box. `.env.prod` is not pushed, and the two
  production credentials in `.env.local` are not either.
- One Supabase stack per session.

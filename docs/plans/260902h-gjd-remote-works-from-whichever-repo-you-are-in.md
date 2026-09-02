# `gjd-remote` works from whichever repo you are in

**Status:** plan, being written 2026-09-02. Nothing built yet.

## Goal

Today `gjd-remote` ([`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts)) drives one box and knows
one repo: sessions start in `~/code/spideryarn2`, `push-env` writes there, and `doctor` checks that
checkout's MCP servers. Greg wants to run it from any repo on the laptop — hellozenno first — and
have it do the right thing for *that* repo: find its checkout on the box, or clone and set it up
after asking, and start the session there.

> I would love to be able to use gjd-remote so that it can work for multiple repos on the same box
> … I'm thinking that maybe there'd be some config file … relying primarily on convention/defaults
> for now, and we can worry about custom overrides later … If that repo hasn't yet been cloned to
> the remote box, then it should check with the user then automatically clone it & set it up.
>
> — Greg, 2026-09-02

> As always, let's try and get to a good v1 now, documenting & deferring complexity/optimisations
> till later.
>
> — Greg, 2026-09-02

Multiple boxes, each on its own subscription, with round-robin between them, is a stated long-term
goal and is **deferred** — but nothing here may make it harder, and the one laptop-side directory
this plan creates is where that config will live.

## What already exists, and what this plan supersedes

- **Running from another directory already half works.** The shim in `~/bin/gjd-remote` uses
  absolute paths, and the box address is read from *this* repo's Terraform state via the script's
  own location, not `cwd`. What is hard-wired is the session directory default, `push-env`'s
  destination and allowlist, and part of `doctor`.
- **[260831ad-multi-repo-support-for-gjd-remote-box.md](260831ad-multi-repo-support-for-gjd-remote-box.md)**
  proposed the same job on 2026-08-31 and was never built. GPT Sol reviewed it twice
  ([sol 1](260831ad-multi-repo-support-sol.md), [sol 2](260831ad-per-repo-extension-sol.md)). Three
  of its conclusions carry over unchanged: **identity is the git origin, never the folder name**;
  **the remote path is box policy, not a property of the repo**; **never run a committed repo script
  on the laptop**. Two of its conclusions Greg has now overruled, on purpose: it said *no config
  file* and *no auto-clone*, and this plan has both. The reasons it gave were real (a config schema
  grows; a clone that also installs is an orchestration) and are answered below by keeping the
  config tiny and by making the clone-and-setup step ask first and refuse to start a session if setup
  fails.
- **`cloneFacts()` and `remoteSlug()` in `gjd-remote.ts` already scan `~/code` for a checkout by
  origin** — that is how `clone` refuses to make a twin of `reading2` under a second name. "Find the
  checkout for the repo I am standing in" is that code, reused, and it handles the
  `reading2`-is-checked-out-as-`spideryarn2` case with no registry at all.
- **hellozenno's own half** is already written up in that repo at
  `docs/plans/260831a_remote_box_gjd_remote_setup.md`: an ssh submodule URL the box cannot fetch,
  a `.env.local` that shares `FLASK_SECRET_KEY` and a Supabase password with `.env.prod`, startup
  scripts that `kill -9` whatever owns 5173, and no `python3-venv` on the box.

## Decisions (Greg, 2026-09-02)

Asked and answered before anything was written:

| Question | Answer |
|---|---|
| Per-repo "setup instructions": script, config, or convention? | **"almost certainly a config, and probably also an (optional) script"** |
| `new-claude` from a repo not on the box? | **Ask, then clone + setup; refuse the session if setup fails** |
| `push-env` for repos other than Spideryarn? | **"guide the user, e.g. an LLM should look at .env.local environment variable names (but NOT values, try to never read them into your context) and make a proposal which the user can override … also with the option to allow all/none"**; research a TypeScript TUI library for the checklist |
| Touch hellozenno itself? | **Yes, generic side first.** Then, once `/Users/greg/dev/hellozenno` exists, **"wait at least 15 minutes after that new target folder has been created and for things to settle down"** — another agent is moving it out of Dropbox |

Decisions made by the orchestrator, named here so Greg inherits nothing by accident:

- **Identity = `owner/name` from `git remote get-url origin` at the cwd's toplevel**, lower-cased.
  So the Dropbox → `~/dev` move changes nothing. A worktree resolves to the same repo. Inside a
  submodule, refuse and say both candidates. Outside git, refuse and offer `--repo owner/name` or
  `--dir`.
- **Remote checkout = the one directory under `~/code` whose origin matches**, found by the existing
  scan. None → propose `~/code/<name>` and ask to clone. Two → refuse and ask for `--dir`. A
  directory at the proposed path with a *different* origin → refuse. `--dir` still wins over all of
  it, and `GJD_REMOTE_REPO` keeps working as an alias for `--dir` with a deprecation line, rather
  than an invisible redirect (Sol's point: an env var must not silently steer hellozenno work into
  Spideryarn).
- **The box's own configuration stays in this repo** with the tool: Terraform state, `provision.sh`,
  the address. It is not per-repo, because the box is shared, not per-repo. What *is* per-repo is:
  where the checkout lives (box policy, resolved by convention), how to set it up (the repo's
  config), and which env keys may travel (laptop-side policy — see below). Extracting the tool into
  its own repo is the right end state (Sol § G) and is deferred until the repo seam is stable.
- **A laptop-side directory, `~/.config/gjd-remote/`**, is created for the one thing that is
  neither the repo's nor the box's: which env keys Greg approved for which repo. It is also the
  future home of a multi-box list. Nothing else goes in it in v1.
- **The LLM that proposes env keys goes through the repo's gateway** ([ai-gateway.md](../project/ai-gateway.md)),
  because every paid call does and [`tests/no-undeclared-spend.test.ts`](../../tests/no-undeclared-spend.test.ts)
  will fail otherwise. It sees **key names only**, extracted by code; a value never reaches a prompt,
  a log, or the orchestrator's context. It is advisory: the user's ticks decide.
- **Two guards the user cannot override in v1**, and this is a product call to flag: a value that is
  a database URL not pointing at a loopback host, and the two names that can delete infrastructure
  (`HETZNER_CLOUD_API_TOKEN`, `SUPABASE_ACCESS_TOKEN`). The first reuses `isLocalDatabaseUrl`, which
  already exists for exactly this. "There is one production database and no staging copy" is the
  rule those protect, and a tick-box is the wrong place to relax it.

### The simpler options passed over

- **No config file, just `.gjd-remote/setup`** — the prior plan. Greg asked for a config. It stays
  tiny (every key optional, defaults by convention) so the schema-growth objection stays answered.
- **A typed `REPO_POLICIES` map inside the tool** (Sol's recommendation) instead of an origin scan +
  laptop-side file. The scan already exists and needs no entry per repo; the map would need one
  line of code per repo Greg ever uses, which is the thing being complained about.
- **No auto-clone, print the command** — Sol's advice, overruled by Greg. Kept honest by asking
  first, by refusing when not on a TTY, and by never starting a session in a tree whose setup failed.
- **Push any `.env.local` wholesale** — would put hellozenno's production Flask secret on a box
  shared by every agent. Not simpler, just faster.

## References

- [hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md) — the map of the tool and
  the box; gains a section from this work.
- [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) — `sessionDir()`, `cmdClone()`,
  `cloneFacts()`, `remoteSlug()`, `cmdPushEnv()`, `cmdDoctor()`, `main()`.
- [`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts) — the Spideryarn allowlist and
  `buildEnvPayload`; stays as the typed policy for this repo.
- [`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts) — the strict session record `ls`
  parses; gains a repo field.
- [`src/ai-call.ts`](../../src/ai-call.ts) `openRouterJson` and `AI_JOB_ROUTE` — the gateway a new
  job kind is added to; [`src/spend-declarations.ts`](../../src/spend-declarations.ts).
- [`src/db/ssl.ts`](../../src/db/ssl.ts) `isLocalDatabaseUrl` — the value guard.
- [260831d-gjd-remote-cli.md](../research/260831d-gjd-remote-cli.md) — why the CLI has no
  argument-parsing library; a prompt library is a new dependency and has to answer to it.
- Research written for this plan (Sonnet, 2026-09-02):
  [260902a-tui-prompt-library-for-gjd-remote.md](../research/260902a-tui-prompt-library-for-gjd-remote.md)
  and [260902h-per-repo-config-conventions-for-remote-dev.md](../research/260902h-per-repo-config-conventions-for-remote-dev.md).
- hellozenno: `docs/plans/260831a_remote_box_gjd_remote_setup.md` in that repo.
- [engineering-manager.md](../reusable/engineering-manager.md), [silent-success.md](../reusable/silent-success.md).

## The per-repo config

Decided 2026-09-02 from the conventions research
([260902h-per-repo-config-conventions-for-remote-dev.md](../research/260902h-per-repo-config-conventions-for-remote-dev.md)):
**a dotdir, `.gjd-remote/`, holding `config.toml` and an optional executable `setup`.** The two
tools nearest this job (both called cmux, unrelated to each other) use a dotdir with an executable in
it; TOML because `supabase/config.toml` already makes it the hand-edited format in both repos, parsed
with `smol-toml`, which is already in `node_modules` transitively and becomes a direct dependency
the way `@babel/parser` did.

```toml
# .gjd-remote/config.toml — how gjd-remote sets this repo up on the box. Every key optional.
setup = "npm ci && npm run setup"   # run from the checkout, non-interactive shell
check = "npm run doctor"            # read-only "is it still working"; doctor asks it
```

Two keys in v1, and a third file the config may point at implicitly: if `.gjd-remote/setup` exists
and is executable, it is the default `setup`. Then:

- **Every key optional, and no file at all still works.** Defaults by convention: setup is
  `.gjd-remote/setup` if present, else `npm ci && npm run setup` if `package.json` has a `setup`
  script, else "no setup known", said out loud and not treated as success.
- **Unknown keys are an error**, naming the key. A misspelt key that does nothing is silent success.
- **Setup runs on the box, from the checkout, over non-interactive ssh** (no profile sourced, so
  explicit paths). Its exit code is not the verdict: the tool appends its own nonce marker and
  requires it, so a truncated stream cannot read as success. `check` is the read-only question.
- **It may not decide** the remote path, the ssh host, what leaves the laptop, or anything that runs
  on the laptop. Those stay tool-owned (prior plan, § "What stays tool-owned").
- **When setup runs.** Nearly every comparable tool (Dev Containers, Codespaces, Gitpod, Coder) runs
  setup automatically on create; the prior plan said explicit-only. This lands between: setup runs
  as part of a confirmed clone, and on `gjd-remote setup`, and at no other time. A checkout never
  runs code because it arrived; it runs because Greg said yes to that clone.
- Spideryarn gets one, and it is the worked example.

## GPT Sol's plan review, and what changed

[260902h-…-review-sol.md](260902h-gjd-remote-works-from-whichever-repo-you-are-in-review-sol.md)
(prompt alongside). Four blockers, eight should-fixes; the plan below is the plan after them.

Taken:

- **The box-side inventory fails closed** — sentinel, row count, blocked states with reasons
  (`non-checkout`, `unrecognised-origin`, `incomplete-checkout`, `symlink`, `unreadable`), `found`
  requires a valid `HEAD`, and an ssh origin on the box is `found` with a diagnostic that `doctor`
  fails on, because the box cannot fetch it.
- **Clone and setup are one durable, locked transaction.** Clone into a unique staging sibling,
  verify origin and `HEAD`, rename atomically. Setup runs as a **tool-owned tmux job** with an
  attempt id and an atomic status file under `~/gjd-remote/setup/`, held under a box-side `flock`
  per slug — because `npm ci` plus Docker pulls outlive a foreground ssh from a laptop that sleeps.
  **Readiness is the status file, never the checkout's presence**, so a failed setup followed by a
  second `new-claude` says "setup failed on attempt X; `gjd-remote setup` to retry" and starts
  nothing. `--no-setup` is dropped; `gjd-remote clone` is the clone-only path.
- **Three roots, named**, and a command matrix for them (below).
- **Config authority.** After the clone, the config is re-read from the cloned commit; if it differs
  from what the prompt showed, stop and ask again. The setup shell gets `ForwardAgent=no`, no
  TTY, no stdin, a small explicit environment. And said plainly: a `setup` command runs as the
  box's one passwordless-sudo user, like everything else on it; the config cannot be sandboxed and
  the guarantee is only that it cannot alter the laptop's choice of host, path or env policy.
- **tmux metadata gets a version** (`GJD_METADATA_VERSION=1`) and a kind
  (`GJD_KIND=claude|shell|setup`), so a legacy row and a malformed new row are distinguishable.
- **The laptop log gets a validated `repo` field** and setup attempt records.
- **The paid call** needs a new `AiJob` across the exhaustive routing/model maps, `withLedger("cli")`
  around it, and an async seam in `main()` — not a spend declaration, which is for bypasses. Red
  test: one proposal attempt ⇒ exactly one spend row, including the malformed-response case.
- **The value-leak test** covers every sink at once (request body, stdout, stderr, thrown error
  text, checklist descriptions, log line, spend row, saved policy), reusing the existing env parser.
- **Order**: durable setup before auto-clone, auto-clone before generic `push-env`.
- hellozenno's "kill whatever owns 5173" fix joins Stage 5.

Not taken, or not whole — each a decision recorded here:

- **"Only previously human-approved keys may be pre-ticked; the model recommends, never defaults."**
  This cuts against Greg's stated design (the model proposes, the user overrides). Held for Greg
  before Stage 4 — see Open questions.
- **"Require `check` for the automatic path."** Spideryarn has no read-only check today, so that
  would refuse to set up this repo. Readiness = setup exit 0 + our marker + `check` passing when
  one is defined. A repo without `check` is set up and told so.
- **"Cut the `package.json` `setup` inference."** Kept: it is built and tested, it is the
  zero-config path for a Node repo, and whatever it resolves to is shown in the prompt before it
  runs.
- **Depth-2 scanning of `~/code`.** Kept one level deep, which is the convention; nested checkouts
  are not something this box has. Symlinks are not followed and are de-duplicated by realpath.

### The target contract

| root | holds | resolved from |
|---|---|---|
| **tool root** | Terraform state, `provision.sh`, `remote-smoke-browser.mjs`, the OpenRouter key via `src/env.ts` | the script's own location (`REPO` today) |
| **local target** | the `.env.local` `push-env` reads | the toplevel of the repo you are in; a regular non-symlink file directly under it |
| **remote target** | session cwd, setup, `.mcp.json` for `doctor`'s MCP check | the verified checkout on the box |

| command | needs identity? | `--dir` | `--repo` |
|---|---|---|---|
| `new-claude`, `new-shell` | no — `--dir ~` is an explicitly arbitrary directory with `GJD_REPO` unknown | any box path | resolves the checkout |
| `push-env`, `setup`, repo-`doctor` | **yes** | must be a checkout of the same origin, verified | same |
| `clone` | yes, or an argument | — | — |
| `GJD_REMOTE_REPO` | deprecated alias for `--dir`; **refuses** if it disagrees with the cwd's origin | | |

## Open questions for Greg

- **Pre-ticking (Stage 4).** Sol: a new key should never start ticked, because Enter on a model's
  default is weaker than a deliberate tick, and today a new key is skipped until a person adds it.
  Greg's ask: the model proposes and the user overrides, which reads as pre-ticked. Options: (a)
  pre-tick the model's proposal, as asked; (b) pre-tick only keys approved on an earlier run, and
  show the model's recommendation as a mark on each row; (c) as (a) but keys the model calls
  *secret* or *production* are shown disabled. Orchestrator's lean: (b) on the first run of a repo
  is thirty manual ticks, so **(a)**, with a final "send these N keys? y/N" that lists them.

## Stages

Each stage ends green (`npm test`, `npm run typecheck`, `npm run check`), committed, and reviewed
by GPT Sol before the next starts. Implementation is delegated to Opus subagents; the orchestrator
keeps the plan, the briefs, the diffs and the commits.

### Prep — done

- [x] `git pull` (merge); worktree `gjd-remote-any-repo`. A worktree has no
  `infra/hetzner/terraform.tfstate`, so set `GJD_REMOTE_HOST` when exercising the CLI from it.
- [x] Sonnet research: TUI prompt library and per-repo config conventions (both → research docs).
  Seam map of the CLI (Explore agent): the only hard-wired constant is `REMOTE_REPO_DEFAULT`; the
  five split-out modules are already repo-agnostic; no interactive prompt exists; no test pins it.
- [x] GPT Sol review of this plan; findings folded in above.
- [x] Pure modules, built in parallel with the review: `scripts/gjd-remote-repo.ts` (identity,
  resolution) and `scripts/gjd-remote-config.ts` (the config), with tests; `smol-toml` direct.

### Stage 1 — identity, inventory, contract, metadata

- [ ] **Strict inventory.** A new box-side script (in `gjd-remote-repo.ts` or a sibling, tested the
  way `gjd-remote-tmux.ts`'s script is): every entry directly under `~/code`, not following
  symlinks, each with realpath, is-checkout, origin, has-valid-HEAD; row count and `GJDOK` sentinel;
  parsed fail-closed. `resolveRemoteCheckout` grows the blocked states and the `HEAD` requirement.
  Red tests: truncated reply, wrong row count, symlink duplicate, non-checkout at the proposed
  path, partial clone (`.git` present, no `HEAD`), ssh origin ⇒ `found` + diagnostic.
- [ ] **The contract**, wired: `localRepo(cwd)` in `main()`; `--repo` on the six commands;
  `sessionDir()` through the resolution; `push-env`/`setup`/`doctor` verify `--dir`'s origin;
  `GJD_REMOTE_REPO` refuses on disagreement; `.env.local` from the local target; `.mcp.json` from
  the remote target. Every path printed. `REMOTE_REPO_DEFAULT` deleted.
- [ ] **Metadata.** `-e GJD_METADATA_VERSION=1 -e GJD_KIND=… -e GJD_REPO=… -e GJD_REMOTE_DIR=…` on
  every `tmux new-session`; the strict record carries them; `ls` gains `REPO`; legacy = no version
  and no repo ⇒ `(unknown)`; version 1 with a missing field fails the listing. Red test: a mixed
  reply with one legacy and one malformed new row. `LogRecord` gains validated `repo`.
- [ ] Help text, [hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md).
- [ ] Live, from the laptop with the worktree's script: `new-shell` from this repo lands in
  `~/code/spideryarn2` found by origin; from `~` refuses with the options; from a scratch repo with
  a made-up origin reports `absent` and the proposed path; `ls` shows the column.
- [ ] Sol review.

### Stage 2 — config, durable setup, `clone`, repo-doctor

- [ ] `gjd-remote setup [--repo]`: `flock` per slug under `~/gjd-remote/locks/`; a tool-owned tmux
  job (`GJD_KIND=setup`) running the config's `setup` from the checkout with the small explicit
  environment; attempt id; status file `~/gjd-remote/setup/<slug>.json` written atomically with
  attempt, config hash, started/finished, outcome; then `check` if defined. The laptop attaches to
  watch, and reads the status file for the verdict — never the stream. Re-running while an attempt
  is live says so. Red tests: stale status from a prior attempt; output after the marker; a status
  file whose attempt id is not this one.
- [ ] `gjd-remote clone` with no argument = the repo you are in; staging sibling + verify + rename;
  a failure leaves the destination absent and names the staging path.
- [ ] `doctor` splits box checks from repo checks; the repo half needs identity, runs `check`,
  reports the setup status file, and fails an ssh-origin checkout by name.
- [ ] `@inquirer/prompts` wrapper (`scripts/gjd-remote-prompt.ts`, built) wired to a
  `promptStreams()` that always verifies a controlling TTY and wraps `/dev/tty` as a non-closing
  `Readable`; Ctrl-C ⇒ exit 130, nothing mutated. Tests: piped stdin, `-p -`, redirected output.
- [ ] Docs + help. Sol review.

### Stage 3 — clone-then-setup inside `new-claude` / `new-shell`

- [ ] On `absent`: one prompt naming the repo, the path and the exact setup command (or script
  path + hash); clone; re-read config from the cloned commit and re-confirm on difference; setup as
  above; session only on a `success` status. Not a TTY ⇒ refuse with the two commands.
- [ ] On `found` without a `success` status: refuse and say which (`pending`, `failed`, `never`).
- [ ] Red tests: failed setup then a second `new-*` starts no session; concurrent second invocation
  blocked by the lock and told so; truncated scan ⇒ no clone.
- [ ] Live: a throwaway public repo end to end. Sol review.

### Stage 4 — `push-env` for a repo without a policy

Blocked on the pre-ticking answer above; everything else in it is settled.

- [ ] Names-only extraction reusing the existing env parser; the one all-sinks sentinel test.
- [ ] `env-proposal` `AiJob` across the exhaustive maps; `withLedger("cli")`; async `main()` seam;
  one-attempt-one-row test including malformed response and provider failure. Model output
  validated as an exact subset of the names sent; descriptions stripped of control characters.
- [ ] Checklist from the wrapper; the two hard guards shown disabled *and* re-applied after
  selection; select-all selects only eligible keys; final "send these N keys?".
- [ ] Policy saved under `~/.config/gjd-remote/repos/` — `0700` dir, non-symlink temp, rename,
  `chmod 0600`, readback. Red tests: existing `0644` file; a symlink at the path.
- [ ] Spideryarn keeps its typed allowlist. Docs + help. Sol review.

### Stage 5 — hellozenno end to end, and provisioning

Only after `/Users/greg/dev/hellozenno` exists and has been quiet for fifteen minutes.

- [ ] `provision.sh`: `python3-venv`, `python3-pip`; re-run against the box.
- [ ] hellozenno's `.gjd-remote/config.toml` + `setup` (venv, submodule, `npm ci --prefix
  frontend`) + a `check` that looks rather than trusts exit codes; `.gitmodules` → https; the
  `lsof | kill -9` lines replaced by "refuse and name the holder".
- [ ] `gjd-remote new-claude` from that directory: prompt, clone, setup, session — recorded here.
- [ ] `push-env` from it: `FLASK_SECRET_KEY` and the Supabase password not sent; outcome recorded
  as key names only.
- [ ] Its plan doc updated to point here; Sol review of the whole.

## Findings along the way

- **`cloneFacts()`'s scan cannot feed `resolveRemoteCheckout` unchanged** (Stage 1 module agent,
  2026-09-02). Its `sibling=` lines are only ever checkouts with a readable origin, so a plain
  directory at the proposed path has to be synthesised from the separate `exists`/`checkout` keys or
  the `occupied` arm never fires; the glob is one level deep (`~/code/*/`), so a nested checkout
  reads as `absent` and gets a second clone proposed; and a symlink under `~/code` to a real checkout
  is reported under both paths, which reads as `ambiguous`. The wiring stage de-duplicates by
  realpath on the box side and reports non-checkout directories; one-level-deep stays, documented.
- **`scripts/deploy-checks.ts` said `smol-toml` was transitive-only**; it is direct now, and the
  comment says so. Its hand-written parser stays — it is a deploy gate that has been watched going
  red — but the two-parsers state is worth a line here in case someone wants to fold it later.

## What is deliberately not being built

Multi-box and round-robin · custom overrides beyond the config's few keys · lifecycle hooks ·
running any repo script on the laptop · a service supervisor or port allocator · extracting the tool
into its own repo · per-session worktrees on the box · a second Unix user.

## How each guard is made to go red

| Guard | Make it fail |
|---|---|
| Identity by origin | Same basename, different origins → different slugs |
| Remote resolution | Two checkouts of one origin under `~/code` → `ambiguous`, no session |
| Wrong repo at the path | `~/code/<name>` with another origin → `occupied`, nothing cloned |
| Setup verdict | status file names a prior attempt, or is absent, or the stream is cut → failure |
| Truncated inventory | reply without `GJDOK`, or row count short → no clone, no session |
| Partial clone | `.git` with no valid `HEAD` at the path → `blocked: incomplete-checkout` |
| Session after failed setup | Setup status `failed` → no Claude/shell session exists on the box afterwards, and the second `new-*` refuses |
| Names only | A value sentinel in `.env.local` must not appear in the extracted names, the prompt body, or any output |
| Proposal fallback | Malformed model reply → zero pre-ticked, not all |
| Hard guards | A hosted `DATABASE_URL` ticked by the user → refused by name before transfer |
| Config strictness | Unknown key in the config → error naming it |
| New-format record | version-1 record without the repo field → `ls` rejects the listing; legacy row (no version, no repo) shows `(unknown)` |

## Log

- 2026-09-02 — GPT Sol reviewed the plan: four blockers taken (strict inventory, durable setup,
  the target contract, config re-read after clone); stages reordered; pre-ticking held for Greg.
- 2026-09-02 — plan written; questions answered by Greg (table above); research and seam map
  back; config format and prompt library decided. Sent to GPT Sol. Stage 1's pure module starts in
  parallel with that review, since both earlier Sol reviews already asked for it; its wiring into
  `gjd-remote.ts` waits for the findings.

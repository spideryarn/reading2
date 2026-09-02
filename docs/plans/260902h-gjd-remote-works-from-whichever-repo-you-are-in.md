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

## Stages

Each stage ends green (`npm test`, `npm run typecheck`, `npm run check`), committed, and reviewed
by GPT Sol before the next starts. Implementation is delegated to Opus subagents; the orchestrator
keeps the plan, the briefs, the diffs and the commits.

### Prep

- [x] `git pull` (merge) so the tree is current; work in a worktree per
  [worktrees.md](../project/worktrees.md). Note: a worktree has no `infra/hetzner/terraform.tfstate`
  (gitignored), so `host()` dies there — set `GJD_REMOTE_HOST` when exercising the CLI from one.
- [x] Sonnet research: TUI prompt library and per-repo config conventions (both → research docs).
  Seam map of every Spideryarn-specific line in the CLI (Explore agent): the only hard-wired
  constant is `REMOTE_REPO_DEFAULT`; the five split-out modules are already repo-agnostic; no
  interactive prompt exists anywhere; no existing test pins the constant.
- [ ] GPT Sol review of this plan; fold findings in.

### Stage 1 — the repo you are standing in

New module `scripts/gjd-remote-repo.ts`, pure and tested without a network, following the split the
other `gjd-remote-*.ts` files use.

- [ ] `localRepo(cwd)`: toplevel + origin → `{ slug, owner, name, toplevel }`, or a typed refusal
  (`not-git`, `no-origin`, `submodule`, `unrecognised-remote`). Tests: two temp repos with the same
  basename and different origins resolve differently; a nested submodule refuses; a worktree
  resolves to its parent's origin.
- [ ] `resolveRemoteCheckout(slug, facts)`: given the box's `~/code` scan (the existing
  `cloneFacts` output, reshaped), returns a discriminated union — `found(dir)`, `absent(proposedDir)`,
  `ambiguous(dirs)`, `occupied(dir, otherSlug)`. Tests for each arm.
- [ ] `--repo owner/name` on `new-claude`, `new-shell`, `push-env`, `clone`, `setup`, `doctor` for
  use outside a checkout. `-d/--dir` unchanged and still wins. `GJD_REMOTE_REPO` → treated as
  `--dir`, with a one-line deprecation.
- [ ] `sessionDir()` uses the resolution; prints which repo and which directory every time.
- [ ] Sessions carry `GJD_REPO=<slug>` and `GJD_REMOTE_DIR=<dir>` in the tmux environment;
  `ls` gains a `REPO` column (`(unknown)` for older sessions — never inferred from
  `pane_current_path`). The strict parser is extended, not bypassed, and a record missing the new
  field in the new format is rejected as incomplete.
- [ ] Help text and [hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md) updated.
- [ ] Live check from the laptop: `gjd-remote new-shell` from this repo lands in `~/code/spideryarn2`
  (found by origin, not by name); from `~` refuses with the three options; from a scratch git repo
  with a made-up origin reports `absent` and the proposed path, without cloning (Stage 2 adds that).
- [ ] Sol review.

### Stage 2 — config, setup, and clone-then-setup

- [ ] Parser for the per-repo config (format per research), with a typed result and a test per
  key, including "file absent" and "file present, empty". Unknown keys are an error, not ignored —
  a misspelt key that does nothing is silent success.
- [ ] `gjd-remote setup [--repo]`: runs the repo's setup command on the box in its checkout, streams
  output, requires the nonce marker, then runs `check` if there is one. Exit code is the truth.
- [ ] `gjd-remote clone` with no argument means "the repo I am in".
- [ ] `new-claude`/`new-shell` on `absent`: one y/N prompt naming the repo, the path, and the setup
  command; on yes, clone → setup → session; on any failure, no session and the reason. Not a TTY →
  refuse with the two commands to run. `--no-setup` to clone only, printing what was skipped.
- [ ] **`@inquirer/prompts`** lands here (`confirm` now, `checkbox` in Stage 3), a direct dependency
  in `package.json`. Chosen over `@clack/prompts` because its checkbox has pre-ticking, a
  per-item description and a built-in select-all key, and over built-in `readline` because a
  checkbox UI is raw-mode cursor arithmetic that is not worth writing twice —
  [260902a](../research/260902a-tui-prompt-library-for-gjd-remote.md). Every prompt is given
  explicit `input`/`output` streams, so it works after `-p -` has spent stdin (the existing
  `/dev/tty` reopen). The TTY refusal stays ours, not the library's.
- [ ] Spideryarn's own config file, as the worked example; its `setup` is `npm ci && npm run setup`.
- [ ] Docs + help. Sol review.

### Stage 3 — `push-env` for a repo without a policy

- [ ] Key-name extraction from `.env.local` as a pure function that returns **names only**, tested
  with a file whose values are sentinels that must not appear in the output.
- [ ] A new gateway job kind for the proposal (in `AI_JOB_ROUTE` + spend declarations), calling
  `openRouterJson` with the names and a short instruction: classify each as *local dev only*,
  *shared provider key*, *production or signing secret*, *infrastructure-destroying*, with one line
  of reason. A malformed reply falls back to "nothing pre-ticked", never to "all".
- [ ] Checklist TUI (`@inquirer/checkbox`): pre-ticked from the proposal, the reason as each item's
  description, `a` for select-all / select-none, confirm. Non-TTY refuses.
- [ ] The two hard guards, applied after the user's ticks and before any transfer, by name.
- [ ] Persist the approved key list to `~/.config/gjd-remote/repos/<owner>--<name>.toml`, `0600`.
  Next run: pre-tick from the saved list, flag keys not on it as **new**, and skip the LLM unless
  there are new keys or `--propose`. Spideryarn keeps its typed allowlist in `gjd-remote-env.ts`;
  the interactive path is only for repos without one.
- [ ] Destination = the resolved checkout; the write-and-verify path is the existing one.
- [ ] Docs + help. Sol review — hand it the extraction test and a redacted transcript of one run.

### Stage 4 — `doctor` and provisioning

- [ ] `doctor` splits box checks from repo checks; the repo half runs only inside a repo, and runs
  the config's `check` if there is one. The MCP check moves to the repo half.
- [ ] `provision.sh`: `python3-venv` (and `python3-pip`) for hellozenno; re-run against the box.
- [ ] Sol review.

### Stage 5 — hellozenno, end to end

Only after `/Users/greg/dev/hellozenno` exists **and at least fifteen minutes have passed since it
was created, with no writes in the last few minutes** (`stat` the tree). Until then, this stage
waits.

- [ ] Its config file and setup script: venv, `git submodule update --init`, `npm ci --prefix
  frontend`, and a `check` that verifies venv, submodule commit and frontend deps by looking, not
  by exit code.
- [ ] `.gitmodules` → https (its plan doc, item 3).
- [ ] `gjd-remote new-claude` from that directory on the laptop: the prompt, the clone, the setup,
  the session — one run, recorded in this plan with what it printed.
- [ ] `push-env` from that directory: the proposal must put `FLASK_SECRET_KEY` and the Supabase
  password in the not-ticked column; the recorded outcome names keys only.
- [ ] Its plan doc updated to point here; Sol review of the whole.

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
| Setup verdict | Setup script exits 0 with the stream cut before the marker → failure |
| Session after failed setup | Setup exits 1 → `tmux new-session` never runs (assert on the command log) |
| Names only | A value sentinel in `.env.local` must not appear in the extracted names, the prompt body, or any output |
| Proposal fallback | Malformed model reply → zero pre-ticked, not all |
| Hard guards | A hosted `DATABASE_URL` ticked by the user → refused by name before transfer |
| Config strictness | Unknown key in the config → error naming it |
| New-format record | tmux record without the repo field → `ls` rejects the listing |

## Log

- 2026-09-02 — plan written; questions answered by Greg (table above); research and seam map
  back; config format and prompt library decided. Sent to GPT Sol. Stage 1's pure module starts in
  parallel with that review, since both earlier Sol reviews already asked for it; its wiring into
  `gjd-remote.ts` waits for the findings.

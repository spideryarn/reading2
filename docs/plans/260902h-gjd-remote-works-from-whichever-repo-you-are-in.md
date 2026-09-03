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
- [260902b-env-key-proposal-spike.md](../research/260902b-env-key-proposal-spike.md) — the Stage 4
  spike: the classifier run on both repos' real key names, scored against the allowlist. Zero false
  positives on either model, so pre-ticking is safe; the case for the capable model, against web
  search, and the `temperature` bug that stops the call reaching any upstream at all.
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

## Open questions for Greg — answered

- **Pre-ticking (Stage 4).** Decided 2026-09-02:

  > Re whether to pre-tick, I was thinking perhaps an LLM could do a quick inspection of the
  > environment variable names (not values) and (perhaps with the help of a Sonnet web search),
  > make a guess about which should/not be included (and why), and use that as a starting proposal
  > for which to include.
  >
  > — Greg, 2026-09-02

  So the model's proposal is the starting state of the checklist (`preTick: "proposal"`), with
  the reason on each row, the two hard guards greyed out, and a final "send these N keys?" list.
  Sol's objection (a new key should never start ticked) is recorded and overruled. Whether a web
  search improves the proposal is a **spike**, not an assumption — see the Log.

  > And can you make sure to run spikes and update docs as needed as part of this.
  >
  > — Greg, 2026-09-02

- **A checkout set up by hand** (Stage 3's `foundGate`): warn in yellow and proceed for anything
  but a setup that is running right now. Raised with Greg 2026-09-02; not yet answered, so v1
  keeps the warning.

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

- [x] **Strict inventory.** A new box-side script (in `gjd-remote-repo.ts` or a sibling, tested the
  way `gjd-remote-tmux.ts`'s script is): every entry directly under `~/code`, not following
  symlinks, each with realpath, is-checkout, origin, has-valid-HEAD; row count and `GJDOK` sentinel;
  parsed fail-closed. `resolveRemoteCheckout` grows the blocked states and the `HEAD` requirement.
  Red tests: truncated reply, wrong row count, symlink duplicate, non-checkout at the proposed
  path, partial clone (`.git` present, no `HEAD`), ssh origin ⇒ `found` + diagnostic.
- [x] **The contract**, wired: `localRepo(cwd)` in `main()`; `--repo` on the six commands;
  `sessionDir()` through the resolution; `push-env`/`setup`/`doctor` verify `--dir`'s origin;
  `GJD_REMOTE_REPO` refuses on disagreement; `.env.local` from the local target; `.mcp.json` from
  the remote target. Every path printed. `REMOTE_REPO_DEFAULT` deleted.
- [x] **Metadata.** `-e GJD_METADATA_VERSION=1 -e GJD_KIND=… -e GJD_REPO=… -e GJD_REMOTE_DIR=…` on
  every `tmux new-session`; the strict record carries them; `ls` gains `REPO`; legacy = no version
  and no repo ⇒ `(unknown)`; version 1 with a missing field fails the listing. Red test: a mixed
  reply with one legacy and one malformed new row. `LogRecord` gains validated `repo`.
- [x] Help text, [hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md).
- [ ] Live, from the laptop with the worktree's script: `new-shell` from this repo lands in
  `~/code/spideryarn2` found by origin; from `~` refuses with the options; from a scratch repo with
  a made-up origin reports `absent` and the proposed path; `ls` shows the column.
- [ ] Sol review.

### Stage 2 — config, durable setup, `clone`, repo-doctor

- [x] `gjd-remote setup [--repo]`: `flock` per slug under `~/gjd-remote/locks/`; a tool-owned tmux
  job (`GJD_KIND=setup`) running the config's `setup` from the checkout with the small explicit
  environment; attempt id; status file `~/gjd-remote/setup/<slug>.json` written atomically with
  attempt, config hash, started/finished, outcome; then `check` if defined. The laptop attaches to
  watch, and reads the status file for the verdict — never the stream. Re-running while an attempt
  is live says so. Red tests: stale status from a prior attempt; output after the marker; a status
  file whose attempt id is not this one.
- [ ] `gjd-remote clone` with no argument = the repo you are in; staging sibling + verify + rename;
  a failure leaves the destination absent and names the staging path.
- [x] `doctor` splits box checks from repo checks; the repo half needs identity, reports the setup
  status file as a check of its own, and fails an ssh-origin checkout by name. **Running `check`
  from `doctor` is deferred**: it is the repo's own command against a live checkout, and running it
  is a side effect a diagnostic should not have without being asked. Setup runs it, and the status
  file records what it said.
- [ ] `@inquirer/prompts` wrapper (`scripts/gjd-remote-prompt.ts`, built) wired to a
  `promptStreams()` that always verifies a controlling TTY and wraps `/dev/tty` as a non-closing
  `Readable`; Ctrl-C ⇒ exit 130, nothing mutated. Tests: piped stdin, `-p -`, redirected output.
- [ ] Docs + help. Sol review.

### Stage 2 review — GPT Sol's findings, folded in during Stage 3

Findings 6 and 8 were fixed in `gjd-remote-setup.ts` by another agent (commit `d6fdb93`). These are
the rest, all in the CLI, and the ones that had to be moved to be testable at all.

| Finding | What changed | What reddens it |
|---|---|---|
| 1 — the clone transaction was not serialised | One box-side script under a per-destination `flock`: re-resolve, reserve, clone, verify, rename, compare the `.git` inode across the rename | `cloneTransactionScript` run for real, with a fake `flock` that refuses; live, with a real `flock` held on the box |
| 2 — `sweepStaging` could delete what it did not create | The staging name is reserved with `mkdir` before git is told about it; the failure path `rmdir`s an empty directory only; the basename guard is exact | "never touches a directory it did not create at the staging name"; "sweeps only the empty directory it reserved"; `isStagingBasename` and its child case |
| 3 — `cloneFacts` accepted incomplete ssh replies | Deleted. Decisions come from the strict `inventory()`, a strict single-directory probe, and a separately tagged token probe | `checkoutProbeScript` run for real; the box-read tests below |
| 4 — comparing command strings is insufficient | A normalised `SetupSpec`: command, source, check, warnings, the setup script's sha256, the `package.json` body. `diffSetupSpec` names the field | "notices that the setup SCRIPT differs, though the command is identical"; the same for `package.json`; live, `doctor` now fails on this repo's own source disagreement |
| 5 — the box read was not fully fail-closed | `GJDBOXEND` required last, every field exactly once, nothing unasked-for, nothing after the end | "refuses a reply cut off after its last field" and five siblings |
| 7 (CLI half) — readiness was not bound to the checkout | A fresh clone archives the old status in the same locked transaction; every `setupVerdict` call passes slug, dir and the `.git` inode | live: the archive line, and the restored status refused as `wrong-checkout` by both `setup --status` and `new-shell` |
| 9 — the `noflock` cells started jobs that died | `flock` is probed before the lock file; `setupGateDecision` refuses every `noflock` run, `--force` included | "refuses every run when the box has no flock, including a forced one" |
| 10 — settled attempts were never logged | `reconcileSetupLog` writes the terminal record once, by attempt | `needsTerminalSetupRecord`; live, on a `--no-attach` run and the `--status` after it |
| 11 — none of it was reachable from a test | `scripts/gjd-remote-flow.ts`, with the generated shell run for real against temporary repos | `tests/gjd-remote-flow.test.ts`, 60 tests |

Not taken: `setupGateDecision` **starts** on `wrong-checkout` rather than refusing, because the
remedy for it is `gjd-remote setup` and a command may not name itself as the fix for its own
refusal. `foundGateDecision` — the session's gate — does refuse on it, and that is where the guard
matters.

### Stage 3 — clone-then-setup inside `new-claude` / `new-shell`

- [x] On `absent`: one prompt naming the repo, the path and the exact setup command (or script
  path + hash); clone; re-read config from the cloned commit and re-confirm on difference; setup as
  above; session only on a `success` status. Not a TTY ⇒ refuse with the two commands.
- [x] On `found` without a `success` status: **warn and proceed, not refuse** — and that is a
  deliberate departure from the line above, taken with the orchestrator's brief, because
  `~/code/spideryarn2` is `never-run` (set up by hand years before the tool) and ten live sessions
  work in it. `never-run`, `failed`, `config-changed` and a dead `in-progress` print one yellow line
  and start the session; an `in-progress` that **holds the lock** refuses, because that tree is
  being installed into right now. The policy is `foundGate(verdict, lock)`, one function, so the
  plan's stated end state is one edit away — **Greg's call, and it is an open question below**.
- [x] Red tests: `truncated scan ⇒ no clone` is Stage 1's (`inventory()` rejects a non-zero ssh
  before the parse, and nothing downstream sees `absent`). The other two are proved live below
  rather than in vitest: both of the new decisions — `foundGate` and the clone-then-setup order —
  live in `gjd-remote.ts`, which runs `main()` on import and so has no unit test at all. Moving
  `foundGate` into `gjd-remote-setup.ts` to test it would drag `LockState` with it and touch a
  module under Sol review; it is named here as the thing to do when that review lands.
- [x] Live: `gregdetre/gjdutils` as the throwaway, both from a laptop checkout of it and via
  `--repo` from `/tmp` — see the Log. The auto-clone's **second question** was proved end to end on
  2026-09-02 by writing the config into the fresh checkout from the box while the clone was landing,
  which is the only way to reach it on a repo whose own default branch has no setup command and that
  we may not push to.
- [x] Sol review — his Stage 3 findings 1–4 are the table below.

### Stage 3 review — GPT Sol's findings 1–4, folded in

| Finding | What changed | What reddens it |
|---|---|---|
| 1 — session admission was not synchronised with setup | `foundGateDecision` refuses on a held lock **whatever the verdict**, on `noflock`, and on a status file that is there and does not parse; and the session itself is created by `sessionAdmissionScript` ON THE BOX, holding the setup lock and re-reading the status under it, so the decision is still true when it is acted on | `foundGateDecision`'s matrix; `sessionAdmissionScript, run for real` — ten tests, including "REFUSES, and runs nothing, while a setup holds the lock" and "when the status changed underneath"; live, below |
| 2 — the fingerprint omitted execution inputs | `setupSpec` carries the script's sha256 and the `package.json` body **whenever the files exist**, whatever `source` says, and `setupFingerprint` (`v: 2`) is the one hash used by the prompt, the durable status, `--status`, `doctor` and the session gate. `setupJobScript` re-derives both file facts inside the lock and refuses if they moved | `setupJobScript`'s `expectFiles` tests; live, below — the same command `./.gjd-remote/setup` over a changed script now reads `config-changed` |
| 3 — inode binding failed open | A terminal verdict with no `checkoutInode`, asked about a checkout that has one, is `wrong-checkout`; `ensureRemoteCheckout` treats a `stale-stuck` archive as a refusal rather than a clone that may later read as ready | `wrongCheckout`'s "unbound" case; the `stale-stuck` arm of `parseCloneTransaction` |
| 4 — the Ctrl-C message was false after cloning | `cloneThenSetUp` catches `Cancelled` around everything that happens after the clone and re-throws one naming the clone that remains; `main()` prints the thrower's message rather than a constant | live, below: exit 130 and `cancelled: the clone at … remains` |

### Stage 4 — `push-env` for a repo without a policy

The pre-ticking answer is above, and everything else in it was settled before it started.

- [x] Names-only extraction reusing the existing env parser; the one all-sinks sentinel test.
- [x] `env-proposal` `AiJob` across the exhaustive maps; `withLedger("cli")`; async `main()` seam;
  one-attempt-one-row test including malformed response and provider failure. Model output
  validated as an exact subset of the names sent; descriptions stripped of control characters.
- [x] Checklist from the wrapper; the two hard guards shown disabled *and* re-applied after
  selection; select-all selects only eligible keys; final "send these N keys?".
- [x] Policy saved under `~/.config/gjd-remote/repos/` — `0700` dir, non-symlink temp, rename,
  `chmod 0600`, readback. Red tests: existing `0644` file; a symlink at the path.
- [x] Spideryarn keeps its typed allowlist. Docs + help.
- [x] GPT Sol's Stage 3 findings 5, 6 and 8 (the env-policy half) — see the Log.
- [x] Sol review of Stage 4 itself, and its five findings folded in — see the Log.

### Stage 5 — hellozenno end to end, and provisioning

Only after `/Users/greg/dev/hellozenno` exists and has been quiet for fifteen minutes.

- [x] `provision.sh`: `python3-venv`, `python3-pip`; re-run against the box.
- [x] hellozenno's `.gjd-remote/config.toml` + `setup` (venv, submodule, `npm ci --prefix
  frontend`) + a `check` that looks rather than trusts exit codes; `.gitmodules` → https; the
  `lsof | kill -9` lines replaced by "refuse and name the holder".
- [x] `gjd-remote new-claude` from that directory: prompt, clone, setup, session — recorded here.
- [x] `push-env` from it: `FLASK_SECRET_KEY` and the Supabase password not sent; outcome recorded
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

- 2026-09-02 — **GPT Sol's Stage 4 review: the policy now remembers a "no", and the decisions moved
  where a test can reach them.** The review is
  [260902h-…-stage4-review-sol.md](260902h-gjd-remote-works-from-whichever-repo-you-are-in-stage4-review-sol.md).
  - **The blocker (finding 1): a rejected key was indistinguishable from an unseen one.** The policy
    file gains `reviewed` beside `approved` — every name you have answered for, and the subset you
    said yes to. `planChecklist` forces a reviewed row to its saved answer, so an untick survives a
    model that later calls the key harmless, and `pushEnvPlan` asks the model only about names
    nobody has decided. A file with no `reviewed` list reads as `reviewed = approved`, which is the
    only migration that cannot change an answer. `approved ⊆ reviewed` is refused on read and on
    write. `approvalWins` in the CLI is gone: it was the same rule applied to half the cases, and
    two functions holding half a rule each is how they came apart.
  - **Proved on the box**, against a throwaway `gregdetre/gjdutils` clone with a fake eight-key
    `.env.local` (all of it removed afterwards — box clone, its env file, the laptop policy, the
    local clone). Run 1, on a real pty: `LOG_LEVEL` unticked before confirming ⇒ four keys sent, and
    the policy read `4 approved of 6 decided` with `LOG_LEVEL` in `reviewed` only. Run 2 printed
    `no keys you have not decided on — skipping the model`, drew `LOG_LEVEL` unticked with
    `you unticked this on 2026-09-02 — tick it to change your mind`, and made no paid call. On a
    deleted policy, `push-env --none --save --yes </dev/null` wrote `approved = []` with all six
    eligible names in `reviewed`; the run after it asked no model either. **Under the bug both of
    those runs would have paid for a proposal and re-ticked what had just been refused.**
  - **The vacuous leak test (finding 2) is replaced by a real one.** Its three sentinels were never
    in its inputs, so their absence proved nothing. The decisions came out of
    [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) — where `main()`-on-import makes anything
    untestable — into `pushEnvPlan`, with the model call, the two prompts and the printing as
    injected callbacks. One test now feeds a `.env.local` whose every value is a distinct sentinel
    through a real `withLedger` and a stubbed transport, and asserts each one reaches **only** the
    payload for the box: not the names the model was asked about, the request bytes, the ledger row,
    the checklist rows, the confirmation, either stream, the saved policy, or the plan's own answer.
    Watched red twice — the value appended to a row description reddened the rows, the prompt and
    the printed line at once; put into the "reading …" line, only the printed sink.
  - **Staged secrets are removed (finding 3).** `sendEnvPayload` copies the selected keys into a
    `mkdtemp` directory for `scp`, and never removed it. It is a `try/finally` now, and the proof is
    a before-and-after listing around a push that really sent six keys: no new directory. There are
    23 older `gjd-remote-env-*` directories in the laptop's temp, from before the fix, each holding
    a `.env.local` — left for Greg to clear.
  - **Finding 4 got a truer name rather than a stronger test.** "does not fall back … when the
    allowance is short" claimed to kill `allowance.names ?? ALLOWLIST`, and no test can:
    `EnvAllowance.names` is `readonly string[]`, so nothing a caller passes makes the `??` take its
    right branch. The type is the guarantee there. The test does kill every other way `ALLOWLIST`
    could get into `buildEnvPayload`, and now says so.
  - **The wording (finding 5).** The box doc and `--help` called Sonnet cheap; it is the capable
    model, chosen knowing it costs eighteen times more, because the cheap one left a quarter of each
    file `unknown` and twice missed a token that can delete the box. And "values are never read into
    anything sent" was false — they are sent to the box, which is the point. Both now say values
    never reach the **model** or the **ledger**.

- 2026-09-02 — **GPT Sol's Stage 3 findings 1–4 are wired into the CLI, and all four were proved on
  the box** against `gregdetre/gjdutils`, cloned and removed again.
  - **The fingerprint is the whole specification** (finding 2). Every producer in
    [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) now calls `setupFingerprint(spec)` —
    the prompt, `runSetup`, `--status`, `doctor` — and `setupConfigSha256` has no caller left there.
    The status file for a `setup = "echo ok"` run recorded
    `173d52316dce01fe93547750f8e13fe447911eda242d80238dee6ed331f75567`, which is the `v: 2`
    fingerprint of that spec and not the `v: 1` hash of its commands (`1d7cc97f4b9c…`) — 64 hex
    characters, of which the reports print the first twelve. **The proof that matters**: with
    `setup = "./.gjd-remote/setup"` and a `success` recorded, rewriting the script body alone —
    the command string is identical to the byte — gives
    `✗ the last setup was for a different .gjd-remote config (dc1c03ad9d89…, now dc0d9086df4b…)`.
    The old hash could not see that at all.
  - **`runSetup` passes `expectFiles`**, so the job re-derives both file facts under the lock. Read
    off the generated job on the box: `# THE FILES, RE-READ UNDER THE LOCK`, `want_sha='-'`,
    `want_pkg='no'`, and the refusal that writes a terminal `config-changed` status. A job built
    without it emits none of those lines and says nothing about it.
  - **A session is admitted under the setup lock** (finding 1). With a `sleep 45` setup running,
    `new-shell --repo gregdetre/gjdutils` refused — *"a setup for this repo holds the box-side lock
    — one is running RIGHT NOW … whatever the last verdict says (in-progress)"* — and the tmux
    count was unchanged. Once it finished, the same command created the session. The gate is only
    half of it: the `tmux new-session` is now run by `sessionAdmissionScript` on the box, holding
    the same lock and comparing the status file byte for byte with what the laptop decided on, so
    the seconds between the two are no longer a window. `held`, `changed` and a vanished status are
    ten tests in [`tests/gjd-remote-flow.test.ts`](../../tests/gjd-remote-flow.test.ts) that run the
    real script.
  - **Ctrl-C after the clone says what remains** (finding 4). Driven on a real pty:
    `y` at the clone question, Ctrl-C at the second, and the tool printed `cancelled: the clone at
    /home/greg/code/gjdutils remains; setup and the session were not started` and exited **130**.
    It used to print "cancelled, nothing changed" over a fresh checkout on the box.
    - **Reaching that question at all took a race**, and it is worth writing down: gjdutils' own
      default branch has no setup command, so the flow dies with "cloned, but no setup known"
      before the second prompt. A loop on the box wrote a `config.toml` into the checkout the
      instant it appeared — which is exactly the window `expectFiles` exists to close, used here to
      open a prompt. The first attempt failed because the loop had already timed out; a poller that
      is not running looks precisely like a race you lost.
  - **The phase has two arms, not three.** No prompt follows the start of the setup job, so
    "cancelled while setup was running" is a sentence nothing can currently produce — it would be a
    clause no fixture could redden, and it is left out until a prompt exists after `runSetup`.
  - `setupReadScript`'s **second copy in the CLI was deleted**; the tested one in
    [`scripts/gjd-remote-flow.ts`](../../scripts/gjd-remote-flow.ts) is the only one now. The copy
    that lived in the CLI used GNU-only `base64 -w0`, so it could never have been run by the test
    that covers the other.

- 2026-09-02 — **Stage 4 is wired up, and `push-env` was run against the box from a repo it had
  never heard of.** `gregdetre/gjdutils` as the throwaway again, with a `.env.local` of eight
  obviously-fake values, driven on a real pty by `expect`.
  - **First run, no policy**: `asking openai/gpt-5.6-luna about 8 key NAMES (no saved policy for
    this repo yet)`, `Spent: $0.0078 over 1 model call(s)`, then a checklist with the model's
    reason on every row — `not sent before · shared-provider-key: Paid API key for OpenAI model
    access.` **`DATABASE_URL_PROD` and `HETZNER_CLOUD_API_TOKEN` were drawn greyed out with their
    reasons and `a` did not select them**: six of eight went, and the two guards refused nothing
    by name because they were never selectable in the first place, which is the stronger outcome.
    Then `✓ 6 keys, 0600 greg, read back and verified`, and the policy written `0600` inside a
    `0700` directory.
  - **The second run asked the model again, and that was a bug this found in its own new code.**
    A hard-guarded key can never be approved, so it is never in the saved policy, so
    "names not in `approved`" called those two new **on every run for the life of the repo** —
    a paid call per push, forever, for two rows that arrive greyed out. Fixed by excluding the
    blocked names from that comparison, and the run after it reads `no new keys since the saved
    policy — skipping the model` with every row pre-ticked from the file. It would have been
    invisible in a unit test of the module: the module never sees the blocked set and the CLI's
    decision is the thing that was wrong.
  - **A key the model now calls a secret but the policy already approved stays ticked** —
    `FLASK_SECRET_KEY` came back `production-or-signing-secret` on the second run and was ticked
    anyway, with the model's words on the row. Greg's ticks are the decision; the model is advice.
  - **Off a terminal**: `✗ 'which keys should go on the box?' needs a choice, and there is no
    terminal to ask on.` naming `--all` and `--none --save`. `push-env --all --yes </dev/null`
    wrote without a prompt (`--all: 6 of 8 rows are selectable`); `--all` alone still asks.
    `--none` alone changes nothing and says `--save` would record it; `--none --save` wrote
    `approved = []`. `--all --none` is refused as a contradiction, and the Spideryarn path refuses
    all five flags by name rather than ignoring them.
  - `npm run cost` lists the job: `env-proposal  $0.0672  13 call(s)`.
  - **`buildEnvPayload` takes its allowance as a required argument now**, not a defaulted one:
    `{ names, source }`, where `source` is the line the banner on the box uses to say which list
    the file was built from. Defaulting it to Spideryarn's would mean a forgotten argument pushed
    another repo's file under this repo's policy, silently.
  - **GPT Sol's Stage 3 findings 5, 6 and 8, folded in with the wiring.**
    - **5 — `applyGuards` was checking its own homework.** It read `item.disabled`, which is
      `planChecklist`'s *output*, so a bug that produced a wrong `disabled` would have been honoured
      by the function meant to catch it. It takes the guards themselves now (`Guards`, the same pair
      handed to `planChecklist`) and runs them, so a name is sent only when two independent runs
      agree. And a **duplicated name is a typed throw**, not a resolution: two rows called
      `DATABASE_URL`, one disabled and one not, used to put the name in `refused` AND in `send` —
      the CLI printed a red cross for a key it was in the middle of sending. Both were watched going
      red: rows handed in with `disabled: false` and an innocent description are still refused, and
      the duplicate throws whether or not it was ticked.
    - **6 — the real call now goes over a stubbed transport into a real ledger.** Everything else
      stubs `ProposalCall`, so the only thing proved about the real one was that it was a function.
      Now `withLedger("cli", …)` runs for real with only `fetch` and the ledger's *store* replaced,
      asserting the route, `PROPOSAL_MODEL`, `require_parameters`, `response_format`, the **absence
      of the `temperature` key**, and exactly one row per attempt — including when the model answers
      prose and when the provider returns 402. Removing the `withLedger` wrapper turns three of them
      red, which is Sol's finding 7 with a test behind it at last.
      - **A bug in the test's own double, worth keeping.** The first `costStore` mock returned
        `undefined` where the contract says `Promise<void>`. The collector chained onto it, threw
        inside the meter's `finally`, and the call came back **"the model could not be reached"** —
        a stubbed transport that never failed, reported as a provider failure, with the row written
        anyway. A double of the wrong SHAPE breaks the thing it stands in for, and it fails as the
        real failure it is imitating.
    - **8 — `{"keys": []}` for a file full of names is accepted, deliberately.** It means every row
      says "no proposal for this key" and arrives unticked. Taken over the stricter reading because
      the two fail in opposite directions: an omission costs a starting state and is visible on the
      row, where demanding one decision per name would throw thirty-nine good answers away over one
      missing one. Under `preTick: "proposal"` a gap can only send FEWER keys than intended.
  - **The log line named the wrong model for one afternoon.** It printed `QUICK_MODEL_OPENROUTER`
    from the CLI's own import while the request body was built in `gjd-remote-envpolicy.ts` on
    `PROPOSAL_MODEL` — the capable model, since the spike. The name is exported and printed from
    there now, so the line cannot disagree with the request. Re-proved live: `asking
    anthropic/claude-sonnet-5 about 8 key NAMES`, `Spent: $0.0085 over 1 model call(s)`.
  - **The locality guard is one function used by both halves** — `localityVerdict(name, value)` —
    because the checklist greys a row out with it and the payload refuses on it, and two spellings
    of "local" is how a row gets ticked and then rejected after every question has been answered.
    It gained the plan's **hard guard by value**: a value that parses as a postgres URL is subject
    to `isLocalDatabaseUrl` whatever it is called, which is the only arm that can catch
    hellozenno's `DATABASE_URL_PROD`, a name no list in this repo will ever have heard of.
- 2026-09-02 — **Stage 4 spike: the proposal is safe enough to pre-tick from, and it currently
  cannot run at all** — [260902b-env-key-proposal-spike.md](../research/260902b-env-key-proposal-spike.md).
  Six runs over both repos' real `.env.local` key names produced **zero false positives**: no key
  ground truth calls a production or infrastructure secret was ever put in a pre-tickable class, on
  either model. But `buildProposalRequest` sends `temperature: 0` while `AI_JOB_ROUTE` sends
  `require_parameters: true`, and no upstream serving `openai/gpt-5.6-luna` accepts a temperature —
  OpenRouter 404s with `"failed_routing_step":"Filter by Parameters"`, `proposeEnvKeys` turns that
  into "the model could not be reached", and the reader gets a blank checklist that looks like a bad
  afternoon. Drop the temperature. The quick model also leaves a quarter of each file `unknown` and
  twice failed to name a token that can delete the box, where Sonnet left none unknown on spideryarn
  and named all four forbidden keys; at $0.023 against $0.0013 for a command run once per repo, the
  spike recommends `env-proposal` on `CAPABLE_MODEL_OPENROUTER`. Web search was checked per name and
  is not worth building — it resolves two names, both of which the capable model already got right.
- 2026-09-02 — **GPT Sol's Stage 2 findings 1–5, 7 (the CLI half), 9, 10 and 11 are built**, and
  most of them are now reddenable: [`scripts/gjd-remote-flow.ts`](../../scripts/gjd-remote-flow.ts)
  holds the decisions that used to be unreachable inside an entrypoint that calls `main()` on
  import, and [`tests/gjd-remote-flow.test.ts`](../../tests/gjd-remote-flow.test.ts) has 60 tests
  against them — including running the generated shell for real, under the laptop's own bash,
  against temporary git repositories.
  - **The clone is one locked box-side transaction** (findings 1, 2, 7): it takes a per-destination
    `flock`, **re-resolves the destination under the lock**, reserves the staging name with `mkdir`
    (so the failure path can only ever remove a directory it made), clones, verifies origin and
    HEAD, renames, and then **compares the `.git` inode across the rename** — a `mv` that declined
    is otherwise a success with somebody else's tree at the end of it. A fresh checkout **archives
    the old setup status** for that slug in the same transaction.
  - **`cloneFacts` is gone** (finding 3). Clone decisions come from the strict `inventory()` and a
    new strict single-directory probe; the token is its own tagged, status-checked read.
  - **The box protocol is framed at both ends** (finding 5): `GJDBOXOK` first, `GJDBOXEND` last,
    every field named up front and required exactly once, nothing unexpected, nothing after the end.
  - **Configs are compared as a normalised specification** (finding 4) — command, source, check,
    warnings, the sha256 of `.gjd-remote/setup` when a script is what runs, and the `package.json`
    `scripts.setup` body when the convention is. Two different setup scripts used to compare equal,
    because the command is `./.gjd-remote/setup` on both sides.
  - **`flock` is probed before the lock file** and **the gate refuses every `noflock` run**
    (finding 9). Every one of those cells used to start a job that died with exit 78 in a pane that
    then vanished.
  - **A settled attempt closes its own laptop log record, once** (finding 10).
  - **Live**, with `gregdetre/gjdutils` as the throwaway: a clone through the transaction; a second
    clone while another process held `clone-gjdutils.lock` ⇒ `✗ another clone of that destination is
    running on the box right now.  Nothing was cloned and nothing at /home/greg/code/gjdutils was
    touched.`; delete-and-re-clone ⇒ `a setup status from the checkout that used to be here was
    moved aside`; the archived status copied back over the new checkout ⇒ `✗ the checkout at
    /home/greg/code/gjdutils has been re-cloned since that setup ran (its .git was 2789215, and is
    now 2789219)`, and `new-shell` refused on the same words and started nothing; `setup --status`
    on a `--no-attach` run ⇒ `(recorded that attempt's outcome in the log, which only had its
    start)`, written once and not repeated on the next `--status`.
  - **Not proved live**: the `noflock` refusal (the box has `flock`, and removing it would break
    every other agent's setup) and the `taken`/`staging-taken` race arms (they need a second process
    inside a millisecond window). All three are unit tests that run the real script.
  - **A bug this found in its own new code**: the first version of the box config probe printed the
    base64 of `package.json`'s setup body, so "there is no setup script" and "the probe failed" were
    both the empty string, and an ordinary `package.json` came back as unparseable. It was written
    in `gjd-remote.ts`, where nothing could reach it; moving it into the tested module reddened it
    in one run. That is finding 11 earning its keep on the same afternoon it was fixed.
- 2026-09-02 — **Stage 3: `new-claude` and `new-shell` offer to clone and set up a repo the box has
  never had, and no session is created that a setup did not earn.** Every arm was made to happen on
  the box, with `gregdetre/gjdutils` as the throwaway and its `.gjd-remote/config.toml` left
  deliberately uncommitted on the laptop.
  - **No terminal ⇒ no clone.** Standing in a laptop checkout of gjdutils with stdin at `/dev/null`:
    `gregdetre/gjdutils is not on the box. / clone to: /home/greg/code/gjdutils / setup: echo
    hello-from-autoclone && node --version   (config)`, then `✗ 'Clone gregdetre/gjdutils to
    /home/greg/code/gjdutils and run its setup, then start the session?' needs a yes or no, and there
    is no terminal to ask on`, naming `gjd-remote clone` and `gjd-remote setup`. `resolve` afterwards
    still said `absent`.
  - **Yes ⇒ clone, and then the CLONED COMMIT's config decides.** On a pty, `y` cloned into
    `.gjd-remote-staging-gjdutils-b3a81b44`, renamed it into place, printed remote/branch/HEAD — and
    then refused: `setup:  (none known)` … `✗ cloned, but no setup known for gregdetre/gjdutils`. The
    laptop's config is uncommitted, so the cloned commit has none, which is the entire point of GPT
    Sol's blocker 4. The clone stayed; no session.
  - **From outside a checkout** (`--repo gregdetre/gjdutils`, run from `/tmp`) the question reads
    `setup command unknown until cloned (you are not in a local checkout of gregdetre/gjdutils)`, and
    the same refusal follows the clone.
  - **`found` + `never-run` ⇒ one yellow line and the session starts**: `setup status: never run
    through gjd-remote — 'gjd-remote setup' to record it`, then `✓ shell 'sh-260902-185118' in
    /home/greg/code/gjdutils`, which `ls` listed with REPO `gregdetre/gjdutils`.
  - **`found` + `success` ⇒ nothing is said at all** and the session starts.
  - **`found` + `config-changed` ⇒ yellow, session starts**: `setup status: the last setup was for a
    different .gjd-remote config (1e6a558bd403…, now dbe437c2209a…)`.
  - **`found` + `failed` ⇒ yellow, session starts**: `setup status: setup failed on attempt
    a2519278-…, exit 3`. **This is where the plan said refuse**, and the departure is the open
    question above.
  - **`found` + a setup HOLDING THE LOCK ⇒ refused, nothing created**: `✗ a setup attempt
    (745a3d8b-…) started at 2026-09-02T15:58:34Z and has not finished, and it holds the box-side lock
    — a setup for this repo is running RIGHT NOW.` `ls` showed no new shell afterwards.
  - **Not proved end to end, and it cannot be with a repo we cannot push to**: an auto-clone whose
    cloned commit carries a config, so that the second confirmation and the setup run happen inside
    `new-*`. The setup half of that is `runSetup`, the same function `gjd-remote setup` calls and the
    one exercised above.
- 2026-09-02 — **`runSetup()` is now the only place a setup job is started**, and `cloneVerified()`
  the only place a clone is made. Both were extracted rather than copied, because the automatic path
  is the one nobody is reading the output of: two clones with different guarantees, or two ways to
  mint an attempt id, is exactly the drift that makes a status file mean two things. `cmdSetup` is
  now the gate plus a call; `reportAfterAttach` hands back the verdict instead of exiting, so a
  session can refuse on it.
- 2026-09-02 — **A peer widened `SetupExpectation` mid-stage** (commit `d6fdb93`, Sol's Stage 2
  findings 6–8: a verdict knows its checkout). It landed the module and its tests and left the CLI's
  four `setupVerdict` call sites red; they now pass `slug` and `dir`. **`checkoutInode` is still not
  passed by any of them**, so the re-clone arm of `wrongCheckout` cannot fire from the CLI yet — it
  needs `setupReadScript` in `gjd-remote.ts` to `stat` the checkout's `.git`, which is one line and
  belongs with whoever finishes that wiring. Named here rather than half-done quietly.

- 2026-09-02 — **`gjd-remote setup` is wired up and was exercised end to end on the box against a
  throwaway checkout of `gregdetre/gjdutils`.** Every arm was made to happen rather than reasoned
  about: no config ⇒ `no setup known for gregdetre/gjdutils: add .gjd-remote/config.toml or
  .gjd-remote/setup`; a one-line config ⇒ a `setup-gregdetre--gjdutils-092fa6af` session that `ls`
  lists with `REPO gregdetre/gjdutils`, `hello-from-setup` and `v26.8.1` in the box-side log, and a
  status file whose verdict reads back as `success`; the same command again ⇒ "already set up …
  `--force` to run it again"; the config's command changed on the box ⇒ `config-changed`, naming
  both hashes; `exit 3` ⇒ `setup failed on attempt …, exit 3`; a `check` of `exit 1` over a setup
  that exited 0 ⇒ `setup ran … but the repo's check failed`. `gjd-remote kill` takes a setup session
  by name with no change needed — it reads `CLAUDE_SESSION_ID` with `check: false` and a setup
  session simply has none. The box was left as found: only `spideryarn2` under `~/code`, and the
  three setup sessions and every file for that slug removed.
- 2026-09-02 — **The lock outlives the work, and the first version of the wiring did not know it.**
  The generated job takes the `flock` on fd 9 and ends with `exec bash -l`, so the login shell
  inherits the descriptor and the lock is held until the *pane* closes — long after the status file
  said `success`. Checking the lock only on an `in-progress` verdict therefore let a
  `config-changed` re-run start a job that hit exit 75 half a second later inside a pane that then
  vanished, which reached the laptop as "the setup job did not survive starting". **Fixed at the
  source**: the job now does `exec 9>&-` before it `exec`s the pane's shell, so the lock's lifetime
  is the work. A red-first test holds the pane alive (`afterwards` on `SetupJobOptions`, defaulting
  to `exec bash -l`, replaced by `printf …; exec sleep 30`) and takes the lock from outside — it
  failed with the second `flock -n` exiting 1 before the one-line fix and passes after it. The
  laptop-side lock check stays as belt and braces, and its message now says a setup is *running*
  rather than telling you to kill a finished pane. This is the plan's own rule biting: the exit code
  and the stream are not the verdict, and neither is the absence of one.
- 2026-09-02 — **`gjd-remote doctor` from this repo now FAILS on `setup status`, honestly**:
  `✗ setup status  this repo has no setup status on the box — nothing has ever set it up — gjd-remote
  setup`. Nobody has ever run Spideryarn's setup through the tool, and `~/code/spideryarn2` is in use
  by ten live sessions where `npm ci` would delete `node_modules` underneath them, so it was not run.
  The red cross is the true answer, and it is the one Sol's blocker 2 asked for: the checkout being
  there is not readiness.
- 2026-09-02 — **The box's `spideryarn2` has no `.gjd-remote/` at all** — the config was added in
  this worktree and has not been pushed and pulled. The authority check passed anyway, because it
  compared the *resolved commands*, and both sides resolve to `npm ci && npm run setup` (the file on
  this laptop, the `package.json` convention on the box). **That was recorded here as "by design",
  and Sol's Stage 2 finding 4 says it was a hole**: the same reasoning made two different
  `.gjd-remote/setup` scripts compare equal. The comparison is now a normalised specification —
  command, source, check, warnings, the script's sha256, the `package.json` body — so this exact
  case is caught, and `doctor` says so: `✗ setup status  the box and this laptop disagree about
  source ('npm-convention' vs 'config') — gjd-remote setup refuses until they agree`. That is the
  honest answer: the box is at a commit that does not have the config file.
- 2026-09-02 — Stage 1's metadata joined up and exercised against the box. `ls` renders every
  session that existed before this as a dimmed `(unknown)` in the new REPO column and lists them
  all, so legacy rows are shown rather than refused. A `new-claude --wait` and a `new-shell` started
  from this worktree both came back as `spideryarn/reading2`, and a hand-made session carrying only
  two of the four variables made `ls` refuse the whole listing by name — `session 's1-meta-bad' has
  GJD_REPO='', which is neither an owner/name slug nor 'unknown'` — and list normally again once it
  was killed.
- 2026-09-02 — GPT Sol reviewed the plan: four blockers taken (strict inventory, durable setup,
  the target contract, config re-read after clone); stages reordered; pre-ticking held for Greg.
- 2026-09-02 — plan written; questions answered by Greg (table above); research and seam map
  back; config format and prompt library decided. Sent to GPT Sol. Stage 1's pure module starts in
  parallel with that review, since both earlier Sol reviews already asked for it; its wiring into
  `gjd-remote.ts` waits for the findings.
- 2026-09-02 evening — Stages 1–4 built, reviewed by GPT Sol three times (plan, Stage 1, Stage 2,
  Stage 3; a landing review is running), every blocker fixed, all on branch
  `worktree-gjd-remote-any-repo` (pushed). Trunk merged in twice; both conflicts were both-sides
  additions (the box doc; `src/models.ts`'s `AiJob` union) and were resolved by keeping both.
  **Trunk itself is red at the time of writing** on two things that are not this branch's:
  `src/store/pg-admin.ts` imports `./ai-calls-spend-pg.js`, which nobody committed, and
  `src/web/PrivacyPage.tsx` names `openrouter.ai`, which the spend tripwire refuses.
  **Stage 5 waits on two things only Greg can do**: push hellozenno's `main` (its
  `.gjd-remote/` and the https submodule URL are committed there but not pushed, and the box clones
  from GitHub), and say yes to `gjd-remote provision` for `python3-venv` — a change to the box, per
  [hetzner-remote-server-box.md § A change to the box is a change to a file](../project/hetzner-remote-server-box.md#a-change-to-the-box-is-a-change-to-a-file).
- 2026-09-03 — **Stages 1–4 landed on `dev`** (`1a57a8a`, merging 51 trunk commits cleanly), after
  GPT Sol's landing review's one blocker was fixed: the saved policy now carries `reviewed` beside
  `approved`, so an unticked key stays unticked. Typecheck clean, 667 tests green across the
  fourteen files this work owns. **The `~/bin/gjd-remote` shim runs the primary checkout**, which
  needs `git pull` and `npm ci` (two new dev dependencies) before it is the new tool. Stage 5 still
  waits on hellozenno's `main` being pushed and on `gjd-remote provision`. Also: `push-env` runs
  from before today left 23 staged `.env.local` copies under `$TMPDIR/gjd-remote-env-*` (15 from
  2026-08-31 with real local-dev credentials, 8 from today's throwaway runs with fake values) — the
  bug is fixed; the leftovers are Greg's to delete.
- 2026-09-03 — **Post-landing review and the road to Stage 5.** hellozenno's `main` pushed
  (`62e7c54`); the 23 staged env copies deleted; the primary checkout pulled and `npm install`ed,
  so the shim is the new tool (`gjd-remote resolve` → `spideryarn/reading2`, found by origin).
  GPT Sol reviewed the landing fixes (`…-stage4-fixes-review-sol.md`): **go**, with two
  should-fixes, both confirmed and fixed here — the model was still asked about every name when
  one was undecided (now only the undecided, unblocked ones, unless `--propose`), and a failed
  `scp` inside `sendEnvPayload` skipped the `finally` because `die()` is `process.exit`
  (`stageAndSend` now returns the failure and dies after the cleanup). Sol's third, low finding —
  no injected-transport test for `sendEnvPayload` itself — is deferred: it lives in the
  `main()`-on-import file. Then `gjd-remote provision` refused: cloud-init's first-boot status on
  the box is `error` for ever (the pre-split `runcmd`), and the wait gate added on 2026-09-01 had
  never been run against this box. `cloudInitGate` now asks for the bootstrap artefacts as a second
  witness — tests red first, then green;
  [hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md) says why. (Its first
  version read the provision status file instead, and the very next run showed why not: a failed
  run rewrites that file as "started".)
- 2026-09-03 — **Provisioning then failed at "install claude code" with the installer saying
  success.** Root-caused on the box: `su - greg -c 'set -eu; …'` runs `~/.bash_logout` on exit,
  its `clear_console -q` fails without a console, and `set -e` made that the exit status — every
  `su -` step with `set -e` in it, since 2026-09-02. `provision.sh` now runs user steps through a
  non-login `AS_USER` array, and `run` says "failed with exit N" rather than "failed or timed out".
  [260903a-a-logout-hook-decided-the-exit-status.md](../postmortems/260903a-a-logout-hook-decided-the-exit-status.md).
- 2026-09-03 — **Stage 5 run end to end against the box, from `/Users/greg/dev/hellozenno`.** The
  clone, the setup, the session and both `push-env` runs all worked; three things came out of it
  that were not expected, and the third is a decision for Greg.
  - **The slug is `spideryarn/hellozenno`, not `gregdetre/hellozenno`.** Identity is the origin —
    `git@github.com:spideryarn/hellozenno.git` — so every path this stage wrote is
    `spideryarn--hellozenno.*`, not the `gregdetre--…` the stage was briefed to expect.
  - **`resolve`** printed `box:  nothing found; absent, proposed /home/greg/code/hellozenno` and
    exited 1, with `gjd-remote clone spideryarn/hellozenno` as the way out.
  - **`new-claude hz-stage5 -p …`** asked once — `? Clone spideryarn/hellozenno to
    /home/greg/code/hellozenno and run its setup, then start the session? (y/N)` — having already
    printed the laptop's spec, `setup: ./.gjd-remote/setup (script, sha b5c0fb822ea8, check:
    ./.gjd-remote/check)`. **Sol's first watch point held and did not need to fire**: after the
    clone the config was re-read from the cloned commit, printed as `… sha b5c0fb822ea8 … on the
    box`, the same specification, so there was no second question. Clone → staging directory →
    rename, origin and HEAD verified, all in one transaction.
  - **Setup took 2m04s and passed.** `--- submodule: gjdutils` cloned over https with no credential
    prompt (**Sol's second point**); `--- venv: creating` succeeded, `Python 3.12.3`, so
    `python3-venv` is on the box (**Sol's third**); pip installed `backend/requirements-dev.txt`;
    `npm ci --prefix frontend` gave 399 entries in `frontend/node_modules`. Then `gjd-remote setup:
    success — spideryarn/hellozenno exited 0, check success`. **Sol's fourth point**: the durable
    status carries both witnesses — `"configSha256":"968bd9ef2d84…"` and
    `"checkoutInode":"2647533"`, and `stat` says `.git` is inode 2647533. `gjd-remote setup
    --status` afterwards: `config: … agree` and `✓ set up on attempt 577f24b3…`. Re-running
    hellozenno's own `./.gjd-remote/check` on the box by hand: all three green, `=== check passed
    ===`, exit 0.
  - **The session was created and Claude Code started in the right tree** — `gjd-remote ls` showed
    `hz-stage5   spideryarn/hellozenno`, and the pane read `Accessing workspace:
    /home/greg/code/hellozenno`. It stopped at Claude's own "is this a project you trust?" prompt,
    which this agent deliberately did not answer, so the `-p` prompt never ran. Both sessions
    (`hz-stage5` and the setup job's) were killed afterwards; the checkout stays.
  - **`push-env` run 1** (`--save`): `26 key name(s), no values`, `asking
    anthropic/claude-sonnet-5 about 26 key NAMES`, `Spent: $0.0227 over 1 model call(s)` into
    Spideryarn's `data/_ai-calls.jsonl` as `env-proposal` — billed here, run from there, exactly as
    designed. The model pre-ticked 20 and left 6 unticked, and **the two that had to be unticked
    already were**, so nothing needed changing: withheld were `DATABASE_URL`, `FLASK_SECRET_KEY`,
    `SUPABASE_HOST`, `SUPABASE_DATABASE`, `SUPABASE_USER`, `SUPABASE_PASSWORD`. Sent were
    `OPENAI_API_KEY`, `CLAUDE_API_KEY`, `ELEVENLABS_API_KEY`, `PERPLEXITY_API_KEY`,
    `GEMINI_API_KEY`, `CODEX_API_KEY`, `USE_LOCAL_TO_PROD`, `LOGS_DIR`, `FLASK_PORT`,
    `SUPABASE_PORT`, `SUPABASE_POOL_MODE`, `PUBLIC_SUPABASE_URL`, `SUPABASE_URL`,
    `PUBLIC_SUPABASE_ANON_KEY`, `USE_LEGACY_CURSORRULES`, `VITE_FRONTEND_URL`, `VITE_API_URL`,
    `SEGMENTATION_DEFAULT`, `SEGMENTATION_TH`, `RECOGNITION_KNOWN_WORD_SEARCH`. **No row was hard-
    guarded**, `DATABASE_URL` included — its value is `127.0.0.1`, so the value guard had nothing to
    catch, and it was unticked on the model's judgement alone. Result: `✓ 20 keys, 0600 greg, read
    back and verified`.
  - **`push-env` run 2** (`--save --yes`): `no keys you have not decided on — skipping the model`,
    every unticked row still unticked and annotated `you unticked this on 2026-09-03 — tick it to
    change your mind`, then `= 20 unchanged`. The ledger still holds exactly one `env-proposal`
    row, which is the honest proof no second model call happened. `--yes` skips the final "send
    these 20 keys?" confirmation but **not** the checklist itself, which is what `--help` says and
    is worth knowing before scripting it.
  - **The staged-copy leak stays fixed**: zero `$TMPDIR/gjd-remote-env-*` directories before run 1,
    after run 1, and after run 2.
  - **On the box**: `/home/greg/code/hellozenno/.env.local` is `600 greg:greg`, 26 lines, and holds
    exactly the 20 approved names and none of the 6 refused ones.
  - **The thing for Greg to decide.** hellozenno's own plan doc has a section headed
    "Environment variables: do not use `push-env`", written 2026-08-31, and it is now half wrong and
    half still right. Wrong: it says `push-env` "will **refuse** for this repo, deliberately" — the
    checklist route built in Stage 4 means it no longer does. Still right: `backend/utils/env_config.py`
    requires *every* key, so the 20-key file on the box would crash the backend at import. Nobody
    stood the app up — setup deliberately does not — so nothing is broken today, but the box now has
    a `.env.local` that is a hazard rather than a help if someone tries to run it. `FLASK_SECRET_KEY`,
    the one secret that doc singles out, was not sent.

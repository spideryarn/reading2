# Per-repo config conventions, surveyed elsewhere

Research for [260831ad-multi-repo-support-for-gjd-remote-box.md](../plans/260831ad-multi-repo-support-for-gjd-remote-box.md),
which already lands on `.gjd-remote/run setup|check` — an explicit, repo-owned executable, no
declarative config, no lifecycle hooks. This doc checks that choice against how comparable tools
solve "declare, per repo, how to set this checkout up on a remote or ephemeral machine."

## What was surveyed

| Tool | File / location | Format | Setup command(s) | Runs automatically? | Env vars | Ports |
|---|---|---|---|---|---|---|
| [Dev Containers spec](https://containers.dev/implementors/json_reference/) (VS Code, Codespaces, DevPod) | `.devcontainer/devcontainer.json` | JSONC | `onCreateCommand`, `updateContentCommand`, `postCreateCommand`, `postStartCommand`, `postAttachCommand` | Yes, on container create/start/attach, by lifecycle stage | `containerEnv` / `remoteEnv` — **name *and value*** in the file, often `${localEnv:VAR}` to pull a value from the host | `forwardPorts` (numbers or `"service:port"`), `portsAttributes` |
| [GitHub Codespaces](https://docs.github.com/en/codespaces/prebuilding-your-codespaces/about-github-codespaces-prebuilds) | same `devcontainer.json` | JSONC | same lifecycle hooks, split by when secrets exist | Yes — but **prebuilds run only `onCreateCommand`/`updateContentCommand`**, never `postCreateCommand`, because user secrets aren't available yet | Codespaces "user secrets" are a separate GitHub-side store, referenced in the container but not written into the file | same |
| [Gitpod / Ona](https://ona.com/) | classic: `.gitpod.yml`; current: `.ona/automations.yaml` | YAML | classic: `before` / `init` / `command`; current: named `tasks` and `services` under `automations.yaml`, each with a trigger | Yes, on environment start; `init` is cached across restarts (effectively a build step), `command` reruns every start | env vars are workspace/project "environment variables" set in the product UI or org settings, referenced by name in tasks — not stored as values in the YAML | `ports` list with `onOpen`/visibility, separate from tasks |
| [Coder](https://coder.com/docs/admin/templates/extending-templates) | Terraform template (`main.tf`), `coder_agent` + `coder_script` resources | HCL | `startup_script` (deprecated) → `coder_script` resources with explicit `run_on_start`/`run_on_stop`/cron | Yes, agent-driven, but each `coder_script` declares its own trigger — closest thing here to distinguishing setup from a scheduled health check | Terraform variables / `coder_parameter`, injected as HCL, values come from admin-defined template params or user prompts at workspace creation | declared as `coder_app`/`coder_port_share` resources |
| [DevPod](https://devpod.sh/docs/developing-in-workspaces/devcontainer-json) | reuses `.devcontainer/devcontainer.json`; **providers** in `~/.devpod/` | JSONC (repo) + DevPod's own provider config (host) | same devcontainer lifecycle hooks | Yes, same as Dev Containers | same as Dev Containers | same as Dev Containers |
| [mise](https://mise.jdx.dev/tasks/) | `mise.toml` (or `.mise.toml`) | **TOML** | `[tasks.<name>]` with `run`, arbitrary names — `setup`, `dev`, `test` are just tasks, nothing reserved | **No** — mise never runs a task on its own; you always type `mise run setup` (or `mise <task>`) | `[env]` table, values or `{ file = ".env" }` | not modeled — out of scope |
| [direnv](https://direnv.net/) | `.envrc` at repo root (dotfile, not a dotdir) | bash | not a "setup" concept — `layout <lang>`, `use <tool>`, `dotenv_if_exists`, `source_up` | Yes, automatically on `cd`, but gated by an explicit one-time `direnv allow` per file — the one tool here that treats "runs automatically" and "runs without you okaying the code first" as different questions | exported as real values in the script, sourced from `.env` or typed inline; **has to be `direnv allow`ed once** because it is arbitrary shell | n/a |
| Nix flakes | `flake.nix`, `devShells.<system>.default` | Nix language | `mkShell { packages = [...]; shellHook = "..."; }` | No — `nix develop` is always explicit; `shellHook` runs when you enter the shell, not before | none as a concept — the shell just has the packages on `PATH` | n/a |
| [cmux.com](https://cmux.com/docs/configuration) (macOS Claude Code app, 2026) | global `~/.config/cmux/cmux.json`; project `.cmux/cmux.json` | JSON5-ish (comments, trailing commas allowed) | an `automation`/`shortcuts`/`notifications` config, not a setup-script concept | app config, not a build step | not documented as a config concept | n/a |
| [craigsc/cmux](https://github.com/craigsc/cmux) (bash worktree tool, unrelated project despite the name) | `.cmux/setup` | **bash script, no config file at all** | one file, one job: install deps, symlink secrets, codegen | **Yes, automatically**, every time `cmux new` makes a worktree — no opt-out short of deleting the file | left entirely to the script (`ln -sf "$REPO_ROOT/.env" .env`) | n/a |
| claude-squad, claude-tmux, workmux, agent-deck, tmux-claude-session-manager | tool-owned dotfiles (`~/.claude-squad/config.json` etc.) | JSON | none — these manage worktrees/panes, not per-repo setup | n/a | n/a | n/a |

Two 2025–2026 "orchestrate Claude Code over tmux" tools turned up: **cmux.com** (a macOS app,
config is about the UI, not repo setup) and **craigsc/cmux** (a ~560-line bash worktree tool, name
collision, no relation). Neither is a close analogue to `gjd-remote` — both assume you're already on
the box or the worktree, not "find or clone the checkout, then set it up."

## Answers to the five questions

**1. File name/location convention.** No consensus on "one file at repo root" vs "a dotdir." Split
roughly by whether the tool needs more than one artifact: `devcontainer.json`,
`.gitpod.yml`/`automations.yaml`, `.envrc`, `mise.toml` are single dotfiles because they hold
*config*, not an *executable*. The two tools that hand the repo an actual script to run —
craigsc/cmux's `.cmux/setup` and cmux.com's `.cmux/cmux.json` — both use a dotdir, because a script
plus config don't fit in one file cleanly. **`.gjd-remote/run` (a dotdir holding an executable) matches
the pattern of the tools closest in shape to `gjd-remote`, not the ones that are pure declarative
config.** No tool used a key inside `package.json` for this — Coder, mise and direnv all support
polyglot repos where that would not make sense, and neither would it here (hellozenno's root has no
npm project, which the plan doc already noted).

**2. TOML vs YAML vs JSON.** No single winner. YAML for Gitpod/Ona (readable, comments, multi-line
task bodies). JSONC for Dev Containers/Codespaces/DevPod (JSON with comments, because it's
machine-generated as often as hand-edited, and there's a published schema for validation). TOML only
for mise, whose whole audience is people who already write TOML for `Cargo.toml`/`pyproject.toml`.
HCL for Coder because it's Terraform. **The plan doc already rejected having a config file at all**
(`.gjd-remote.toml`), so this question is moot for the current design — flagged for if that decision
is ever revisited. If it were: `smol-toml` is the one to reach for. It is the most-downloaded TOML
parser on npm, fully spec-compliant with TOML 1.1.0, faster and ~39KB smaller than the older
`@iarna/toml`, and Prettier switched to it from `@iarna/toml` in February 2025 — a sign of the
maintenance gap between the two.
([smol-toml on GitHub](https://github.com/squirrelchat/smol-toml),
[Prettier's switch](https://github.com/prettier/prettier/pull/16497))

**3. Setup lifecycle: automatic or on request?** Split, and this is the interesting one. Every
declarative-config tool (Dev Containers, Codespaces, Gitpod/Ona, Coder, direnv) runs its setup step
**automatically** — on container create, environment start, or `cd` into the directory. The one
exception among them, direnv, still runs automatically but requires a one-time `direnv allow` per
file before it will execute anything, which is exactly the "an agent chooses to run this" vs "a
checkout causes this to run" distinction the plan doc's Sol review landed on — direnv just solves it
with a trust prompt instead of "never automatic." mise is the only tool surveyed that **never** runs
a task on its own; every task, including one named `setup`, needs an explicit `mise run`. Among
setup-script tools specifically: craigsc/cmux's `.cmux/setup` runs automatically on every worktree
creation with no opt-out. **`.gjd-remote/run setup` being explicit-only, never triggered by a clone,
is a real position, not a common one** — most prior art either runs automatically or (direnv) gates
automatic execution behind a one-time trust step rather than removing it. Worth writing into the plan
doc as "we checked, and most tools default to automatic — we're deliberately not."

**Setup vs check/health**, separately: only Coder cleanly distinguishes them, because each
`coder_script` declares its own trigger (`run_on_start` vs a cron-scheduled health script) as a
first-class Terraform resource. Dev Containers has no health concept at all. Gitpod's `services`
(long-running) vs `tasks` (run-to-completion) is adjacent but not the same split. **`.gjd-remote/run
setup` vs `.gjd-remote/run check` as two verbs on one executable has no direct precedent** — it's
closer to Coder's model (distinct declared steps) than to the "one script, one job" model of
craigsc/cmux, and is a reasonable synthesis rather than an established convention.

**4. Env vars: name-only or values?** Split by whether the tool trusts its own file. Dev Containers'
`containerEnv`/`remoteEnv` hold literal values (often `${localEnv:VAR}` — a name-only *reference* to
pull a value that lives on the host, never the value itself, into the container). Gitpod/Ona's
environment variables are declared once in the product's own store and referenced by name from
tasks — the file never carries a value. mise's `[env]` table holds values or a `{ file = ".env" }`
pointer. Coder's `coder_parameter`s are template-declared names whose values come from the admin or
the user at workspace-creation time, not from the repo. **The closest prior art to "declare which env
keys may be synced to the remote" is Dev Containers' `${localEnv:VAR}` substitution** — a name-only
placeholder resolved against the *invoking* machine's environment, structurally the same shape as
`gjd-remote push-env`'s allowlist
([`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts)): the repo (or tool) names which keys
travel, the value is read from the source machine at push time, never written into any committed
file. No tool surveyed lets a repo's own config file assert "these named vars should be synced" —
that authority stays with the orchestrating tool everywhere it was checked, which matches
`260831ad`'s "no committed repo hook decides which keys leave the laptop" stance.

**5. Multi-box prior art.** DevPod is the closest analogue: a laptop-side **provider** per remote
host, stored under `~/.devpod/`, added with `devpod provider add ssh -o HOST=user@host` — you can
register several SSH providers (different hosts, or the same host under different users) and DevPod
tracks which workspace lives on which provider. That is exactly the shape "a laptop-side file listing
several remote hosts" would take: named entries, one per box, each with connection details, workspace
placement resolved by name rather than by scanning. Coder does the analogous thing server-side
instead — one control plane, many workspaces, `coder <workspace>` picks one by name; there's no
laptop-side host list because the server is the single point of truth. Plain SSH config `Host`
blocks are the low-tech version of the same idea (`Host box1`/`Host box2`, or a `Host *.internal`
wildcard for shared options) and are what `gjd-remote` already leans on for one box today
([hetzner-remote-server-box.md § Running `gjd-remote` from the box](../project/hetzner-remote-server-box.md#running-gjd-remote-from-the-box)
describes the `~/.ssh/config` marker block). No tool surveyed does automatic **round-robin**
placement across boxes — DevPod and Coder both make placement an explicit choice (`--provider`,
picking a workspace), never a load-balancing decision the tool makes for you.

## What we should borrow

- **Keep `.gjd-remote/run setup|check` as a dotdir holding an executable, not a config file** — this
  matches the shape of the two tools closest to `gjd-remote`'s job (craigsc/cmux's `.cmux/setup`,
  cmux.com's `.cmux/cmux.json` dotdir) and avoids the schema-creep every declarative-config tool
  eventually grows into (Dev Containers alone has five lifecycle-command stages).
- **The explicit-only decision is defensible but should be flagged as against the grain** — write a
  line into `260831ad` noting that Dev Containers, Codespaces, Gitpod/Ona, Coder and craigsc/cmux all
  run setup automatically, and direnv's `direnv allow` is the nearest thing to a middle ground (trust
  once, then automatic) if "always ask" ever proves annoying in practice.
- **For env vars, Dev Containers' `${localEnv:VAR}` substitution validates the existing allowlist
  design** in `gjd-remote-env.ts` — name-only references resolved on the source machine at push time
  is the same shape other tools converge on, not a one-off invention.
- **If a multi-box laptop-side list is ever built**, model it on DevPod's providers: a named entry
  per box under something like `~/.config/gjd-remote/hosts.toml` (or reuse `~/.ssh/config` `Host`
  blocks directly, since `gjd-remote` already parses that file) rather than a bespoke inventory
  format. Nothing here suggests building this before it's needed — the plan doc already defers it.
- **If a config file is ever added despite `260831ad`'s rejection of one**, prefer TOML with
  `smol-toml`, on the strength of mise's example and smol-toml's clear lead over `@iarna/toml` in
  maintenance and spec compliance — but the stronger recommendation from this survey is that no
  config file is needed at all, matching the existing decision.

## Sources

- [Dev Container metadata reference](https://containers.dev/implementors/json_reference/)
- [About GitHub Codespaces prebuilds](https://docs.github.com/en/codespaces/prebuilding-your-codespaces/about-github-codespaces-prebuilds)
- [Configure .gitpod.yml — Gitpod Classic](https://www.gitpod.io/docs/introduction/gitpod-tutorial/2-configure-your-gitpod-yml)
- [Configuring Automations — Ona](https://ona.com/docs/api-reference/resources/environments/subresources/automations/subresources/services/models/service/) (Gitpod's successor product; `.ona/automations.yaml` replaces `.gitpod.yml` tasks)
- [Extending Templates — Coder Docs](https://coder.com/docs/admin/templates/extending-templates)
- [Usage — Startup Dependencies — Coder Docs](https://coder.com/docs/admin/templates/startup-coordination/usage)
- [devcontainer.json — DevPod docs](https://devpod.sh/docs/developing-in-workspaces/devcontainer-json)
- [Add a Provider — DevPod docs](https://devpod.sh/docs/managing-providers/add-provider)
- [devpod-provider-ssh README](https://github.com/loft-sh/devpod-provider-ssh/blob/main/README.md)
- [Task Configuration — mise-en-place](https://mise.jdx.dev/tasks/task-configuration.html)
- [direnv – unclutter your .profile](https://direnv.net/)
- [smol-toml on GitHub](https://github.com/squirrelchat/smol-toml)
- [Switch `@iarna/toml` to `smol-toml` — Prettier PR #16497](https://github.com/prettier/prettier/pull/16497)
- [cmux.com — Configuration docs](https://cmux.com/docs/configuration)
- [craigsc/cmux — README](https://github.com/craigsc/cmux/blob/main/README.md)
- [Using the SSH Config File — Linuxize](https://linuxize.com/post/using-the-ssh-config-file/)

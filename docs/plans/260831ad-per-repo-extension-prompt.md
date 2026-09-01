# Design review: a *general* per-repo extension mechanism for `gjd-remote`

This is a follow-up to your earlier review (the multi-repo one, about the Hetzner box). Greg has
read it and pushed back:

> Ok, this all sounds pretty complex and fiddly and not worth fixing right now. Eventually I'll try
> to clean up the way Hello Zenno works. But there will always be per-repo customisation, so I
> wonder if there's a general way of solving this, e.g. having per-repo config/scripts/hooks/
> overrides?
>
> — Greg, 2026-08-31

He is right that the eleven-item list reads as eleven special cases. **The question now is whether
there is a general seam** — one mechanism that absorbs per-repo variation — rather than
`gjd-remote` growing knowledge of each repo.

**Do not re-answer the earlier review.** Answer this narrower question, and feel free to say that
part of the earlier list cannot be generalised and must stay as special cases.

## Recap of the situation, briefly

One Hetzner CX53. One Linux user, `greg`, passwordless sudo. Many autonomous Claude Code agents run
as that user in tmux sessions, in parallel, in checkouts under `/home/greg/code/`. `gjd-remote` is a
single ~1800-line TypeScript file on the laptop (no arg-parsing dependency) with subcommands `ls`,
`new`, `shell`, `resume`, `kill`, `doctor`, `clone`, `push-env`, `ssh`, `tunnel`, `forget-key`. It
lives inside the `spideryarn2` checkout and is on `PATH` via a shim with absolute paths.

Two repos: `spideryarn2` (TypeScript, npm, local Supabase in Docker) and `hellozenno` (Python 3.12
backend + SvelteKit frontend, its own local Supabase, a git submodule, its own port set). More will
follow.

The per-repo variation found so far, as raw material for generalising:

| Kind of variation | spideryarn2 | hellozenno |
|---|---|---|
| Remote checkout directory | `~/code/spideryarn2` (repo is `spideryarn/reading2`) | `~/code/hellozenno` |
| Language runtimes needed | node | node **and** python3.12 + venv |
| Setup command | `npm run setup` | none yet; needs venv + submodule + `npm ci --prefix frontend` + db |
| Ports it wants | Supabase 5436x, Vite 5173, Supabase `inspector_port` 8083 | Supabase 5432x, Flask 3000, Vite 5173, preview 4173, Storybook 6006, Supabase `inspector_port` 8083 |
| Port behaviour | polite | `lsof -ti:5173 \| xargs kill -9` on startup |
| Env file | `.env.local`, key-value, local demo creds only | `.env.local`, `export KEY=…` form, **all keys required by `env_config.py`**, and ten values byte-identical to `.env.prod` including `FLASK_SECRET_KEY` |
| Submodules | none | one, `gregdetre/gjdutils`, with an **ssh** URL the box cannot fetch |
| Browser for tests | Playwright pointed at system Chrome | expects its own bundled Chromium, which provisioning deliberately does not install |
| Health check | `npm test`, `npm run typecheck` | pytest + svelte-check |

Existing per-repo mechanisms already in play, which may be the right thing to lean on rather than
inventing a new file:

- `.mcp.json` at project scope — MCP servers arrive with the clone. Already works, no tool change.
- `.claude/settings.json` and `.claude/hooks/` — spideryarn2 has both; hellozenno has only
  `.claude/settings.local.json`. Claude Code already executes per-repo hooks on the box.
- `package.json` scripts — spideryarn2 has `npm run setup`. hellozenno's root has **no**
  `package.json` at all (its npm project is in `frontend/`), so "just use npm scripts" does not
  generalise.
- `supabase/config.toml` — already declares that repo's ports, in a format the Supabase CLI owns.
- hellozenno has `scripts/local/{run_backend,run_frontend,init_db,migrate}.sh` — a shell-script
  convention it already uses.
- Neither repo has a Makefile, justfile, Taskfile, devcontainer, mise or `.tool-versions`.

## The trust boundary, which I think is the crux

I want you to test this framing and correct it if it is wrong.

**Anything that merely *runs on the box* is cheap to delegate to the repo.** Every agent on that box
already runs arbitrary code as a user with passwordless sudo. A committed `.gjd-remote/setup.sh` that
`gjd-remote` executes on the box grants no capability that the agent sitting in that checkout does
not already have. So repo-owned *scripts* are close to free, security-wise.

**Anything that decides what *leaves the laptop* is expensive.** The laptop has credentials the box
must never hold. A committed file that says which env keys may be pushed is a security control that
code-being-sent-to-the-box can edit — the control pointing the wrong way. You already argued this
and I agree.

So my working hypothesis is a **two-file split**:

- Repo-owned, committed, executed on the box, freely edited: setup, health check, ports, runtimes,
  services to start.
- Tool-owned, on the laptop, typed and reviewed: the remote-path override map and the env policy.

## What I want from you

### 1. Is the two-file split the right seam?

Attack the framing above. Is "runs on the box" versus "leaves the laptop" the correct line? Are
there things that look like the first and behave like the second? (Candidates I can think of: a repo
hook that runs on the *laptop* before a push; a repo-declared remote directory, which redirects
where a `push-env` lands; a repo-declared port, which lets one repo squat another's port; a setup
script that exfiltrates the box's other repos' `.env.local` files — though again, an agent there
could already do that.) Where exactly should the line fall, and what stays tool-owned no matter what?

### 2. Config, scripts, or hooks — which, and how many?

Greg listed four possibilities: config, scripts, hooks, overrides. They are not the same thing.

- **Declarative config** (a `.gjd-remote.toml`/`json`): ports, runtimes, remote dir. Inspectable,
  diffable, checkable *without executing anything* — which matters for `doctor`. But every new kind
  of variation needs a schema change in the tool.
- **Scripts at fixed paths** (`.gjd-remote/setup.sh`, `check.sh`, `start.sh`): absorbs anything,
  needs no schema, but is opaque to `doctor` and to a human comparing two repos.
- **Hooks** (named events the tool fires: `pre-push-env`, `post-clone`, `pre-session`): more
  structure than scripts, more coupling to the tool's lifecycle.
- **Overrides** (a repo can replace a built-in behaviour): the most powerful and the most surprising.

Which subset actually earns its place for *two* repos, and what is the growth path? Be specific
about the smallest thing that could possibly work. Name what you would **not** build.

### 3. Discovery, defaults, and the repo that has nothing

spideryarn2 works today with no config at all. hellozenno needs several things. A general mechanism
must not make the zero-config case worse.

- What is the behaviour for a repo with no `.gjd-remote/` at all — full functionality with
  conventional defaults, or reduced functionality with a clear message?
- Should `gjd-remote` *infer* anything (detect `pyproject.toml` ⇒ python; detect `package.json` ⇒
  node), or is inference exactly the kind of magic that goes wrong quietly?
- Is a committed file the right home, given that a checkout on the box can be edited by an agent and
  then behave differently from the same repo on the laptop? Should the tool read the repo's config
  from the **laptop** checkout, the **box** checkout, or insist they match?

### 4. Reuse rather than invent

Greg's house rule is "prefer boring" and "reuse the machinery that's already here rather than adding
a second way to do the same thing". Is there an existing convention that should carry this instead
of a new `.gjd-remote/` directory?

Candidates: `.claude/settings.json` + `.claude/hooks/` (already per-repo, already executed on the
box, already understood); `package.json` scripts (does not generalise — hellozenno's root has none);
a plain `Makefile` with conventional targets (`make setup`, `make check`, `make dev` — universal,
language-agnostic, no dependency, but neither repo has one today); devcontainer.json; mise.

For each, say whether it is a genuine fit or a stretch, and make a recommendation. Note that
`gjd-remote` runs commands over ssh in a non-interactive shell that sources neither `.bashrc` nor
`.bash_profile`, so anything requiring a shell environment has to say so explicitly.

### 5. Ports specifically

Ports are the variation most likely to recur and the one where a declarative answer looks most
attractive: a repo declares the ports it wants, the tool detects overlap across repos and refuses
or reports. But the ports are *already declared* in files the repo owns — `supabase/config.toml`,
`vite.config.ts`, `playwright.config.ts`, a `FLASK_PORT` in `.env.local`. Restating them in a
`gjd-remote` config is a second copy that nothing keeps in step, which this codebase has a written
rule against.

Is there an answer that does not duplicate? Options I see: (a) the tool reads the existing files;
(b) the repo declares a *range* it owns and everything inside it is that repo's business;
(c) the tool checks nothing declaratively and instead observes actual listeners on the box and
attributes them to a repo; (d) something else. Which, and why?

### 6. What does this change about the earlier priority list?

Given a general mechanism, which of the earlier eleven "must do" items **disappear into it**, which
**remain genuine special cases in the tool**, and which turn out to be **hellozenno's own bug to fix
in hellozenno** rather than anything `gjd-remote` should know about? Greg has said he will clean up
hellozenno eventually, so sorting the list this way is directly useful.

And: **what is the smallest change that lets hellozenno run on the box now, badly but safely**, with
the rough edges left in place? Greg's judgement is that the full list is not worth doing right now,
and I would like to offer him a v0 that is honest about what it does not do.

## House rules that constrain the answer

- Prefer boring. Prefer *simple* (few parts touching each other) over *easy*.
- Simplest version first; complexity added only when something shows it is needed. Name what you are
  deliberately not building.
- One source of truth: a restated fact is a second copy that nothing keeps in step.
- Make wrong states unrepresentable in the type system where you can.
- This codebase has been bitten repeatedly by **silent success** — a check reporting success while
  doing nothing, with the obvious verification sharing an assumption with the code. Any guard you
  propose needs "and here is how you would make it go red".
- Be concrete and opinionated. Where you think the framing above is wrong, say so and say what
  instead.

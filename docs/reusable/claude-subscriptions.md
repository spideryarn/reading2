# Two Claude subscriptions, one machine

Run Claude Code from one repo and bill account A; run it from anywhere else and bill account B.
Useful when a client's work and your own must not share a subscription, and the only alternative on
offer is `/logout`, `/login`, and remembering.

> **Provenance.** Written 2026-09-08 on Greg's Mac against Claude Code v2.1.263, from three sources:
> two Sonnet web-research passes, a GPT Sol review of the first draft, and — for the parts that
> matter — the shipped binary and the machine itself. Where this doc states a mechanism, it was read
> out of the binary or exercised on the box, and it says which. There is no first-party account
> switcher; see [Where this is going](#where-this-is-going).

## The mechanism, in one paragraph

`CLAUDE_CONFIG_DIR` relocates the whole per-user config tree. Point it somewhere new and you get a
second, independent Claude Code identity: its own login, its own settings, its own session history.
Both accounts stay signed in at once — there is no switching cost and no `/logout` dance. Everything
else in this doc is consequences of that one sentence.

## Why the credential actually separates

On macOS the credential is not a file. `~/.claude/.credentials.json` does not exist; the token is a
Keychain generic-password item under service `Claude Code-credentials`. So the obvious mental model —
"a different config dir holds a different credentials file" — is wrong on this platform, and the
switchers that copy credential files around are fighting the Keychain rather than using it.

What actually happens is that **the Keychain service name is derived from the config dir**. From the
v2.1.263 binary:

```js
let t = e !== void 0 ? !e : !process.env.CLAUDE_CONFIG_DIR,
    r = e !== void 0 ? e.normalize("NFC") : be(),
    c = t ? "" : `-${sha256(r).hex.substring(0, 8)}`;
return `Claude Code${OAUTH_FILE_SUFFIX}${n}${c}`;
```

Unset, the service is `Claude Code-credentials`. Set, it gains a `-<first 8 hex of sha256(configDir)>`
suffix — a genuinely separate item, which is why two logins coexist instead of overwriting each other.

Derive the name for any directory:

```bash
printf '%s' "$CLAUDE_CONFIG_DIR" | shasum -a 256 | cut -c1-8
```

## Three traps

**The path is never tilde-expanded, and the hash is over the raw string.** The resolver is
`process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")` — no expansion, no normalisation beyond
NFC. A literal `~`, a relative path, or a stray trailing slash each hash to a *different* Keychain
item, so you get a session that reports itself signed out and a directory named `~` appearing under
your CWD ([#37570](https://github.com/anthropics/claude-code/issues/37570)). **Absolute paths, no
trailing slash**, always.

**A project's `.claude/settings.json` `env` block cannot set it.** Tested on this machine: a repo
whose settings named a `CLAUDE_CONFIG_DIR` ran under the default account and left the target
directory empty. The binary ignores `CLAUDE_CONFIG_DIR` from project settings, and it is circular
anyway — the config dir is what decides where settings are read from. The env var has to be set
*before* the process starts, which means the shell, which means a wrapper.

**Do not symlink `settings.json` between two config dirs.** Tempting, because otherwise you maintain
settings twice. Claude Code resolves the link and replaces the target atomically, so the symlink
survives — but each config dir takes its own lock while both write the same file, so concurrent
settings changes silently lose one. Copy it, and accept that the copies drift.

## What moves with the config dir, and what does not

Moves — so the second account starts empty and builds its own:

| | Cost of it moving |
|---|---|
| `.claude.json` | global app state: OAuth account, personal (user-scoped) MCP servers, per-project trust |
| `projects/` | session history — `--resume` and `/resume` cannot see the other account's sessions |
| `plugins/` | installed plugins, marketplace clones, caches |
| `teams/`, `tasks/`, `sessions/`, `history.jsonl` | agent and session state |
| **MCP OAuth tokens** | **every OAuth'd MCP server must be re-authorised with `/mcp` in each account** |

Does **not** move, and needs no thought:

- Anything in the repo — `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`,
  `CLAUDE.md`, skills and commands committed to the project. These are found relative to the repo,
  not the config dir. A project `.mcp.json` therefore carries its servers into every account for
  free; a user-scoped MCP server in `~/.claude.json` does not.
- Anything referenced by absolute path from `settings.json`, such as a `statusLine` command living
  at `~/.claude/statusline-script.sh` — `~` resolves from `$HOME`, not from `CLAUDE_CONFIG_DIR`.

Seed the new dir deliberately rather than copying `.claude.json` wholesale: copy `settings.json` and
`plugins/`, plus any user-scoped `mcpServers` and the repo's `hasTrustDialogAccepted` if you would
rather not re-answer the trust dialog. Leave the identity keys alone.

**The session history is the one real loss.** It stays under the old config dir and becomes invisible.
Copying it across is safe when both dirs are the same account, and a judgment call when they are not —
a resumed transcript is submitted under whichever account resumes it.

## Wire it up

Three pieces: a config dir, a login, and something that sets the variable before `claude` starts.

```bash
D=/Users/greg/.claude-clientname
mkdir -p "$D"
cp    /Users/greg/.claude/settings.json "$D/settings.json"
cp -R /Users/greg/.claude/plugins       "$D/plugins"
CLAUDE_CONFIG_DIR="$D" claude auth login --claudeai --email you@example.com
```

`--claudeai` is the default but worth typing: `--console` signs you into Anthropic Console and bills
metered API usage instead, which is a different product wearing the same login flow.

### Use a `PATH` script, not a shell function

This is the part that is easy to get wrong, and it fails silently.

A `claude()` function in `~/.zshrc` works when you type `claude` and **does not exist** for anything
else: a script that spawns `claude`, a cron job, launchd, an IDE, an SSH command, a non-interactive
shell. In this repo `scripts/run-claude.ts` spawns `bin: 'claude'` through `PATH` *and* strips
`CLAUDE_CONFIG_DIR` from the child environment, so every dispatched agent would quietly run on the
default account while your terminal ran on the right one. Nothing would look wrong.

> **Do not generalise that to other repos, and beware the same filename.** MindstoneRebel has its
> own `coding-agent-instructions/scripts/run-claude.ts` which does the *opposite*: it clones the
> whole environment (`run-codex.ts`, `const childEnv = {...process.env}`) and deletes only one
> unrelated key, so an inherited `CLAUDE_CONFIG_DIR` reaches its dispatched agents fine. A GPT
> reviewer read that file, matched the filename, and reported this paragraph as stale — it is not.
> The `PATH` script is still the right answer, because it is correct under *both* behaviours
> without your having to know which repo you are standing in.

A script early on `PATH` survives all of that, because it is re-entered after the environment is
sanitised and re-derives the answer from the working directory:

```zsh
#!/bin/zsh
set -eu
REAL_CLAUDE=/Users/greg/.local/bin/claude
CONF=/Users/greg/.claude-accounts        # "<repo root>:<config dir>", one per line

if [[ -n "${CLAUDE_ACCOUNT_DIR:-}" ]]; then
  export CLAUDE_CONFIG_DIR="$CLAUDE_ACCOUNT_DIR"      # explicit override wins
else
  unset CLAUDE_CONFIG_DIR 2>/dev/null || true
  here="$(pwd -P)/"                      # not $PWD: that is logical, and a symlinked
  best_len=0                             # path into the repo would slip past the test
  while IFS= read -r line; do            # longest match wins, so a worktree can be
    [[ "$line" == \#* || -z "${line// }" ]] && continue   # carved out of its repo
    root="${line%%:*}"
    if [[ "$here" == "$root/"* && ${#root} -gt $best_len ]]; then
      best_len=${#root}; export CLAUDE_CONFIG_DIR="${line#*:}"
    fi
  done < "$CONF"
fi
unset CLAUDE_SECURESTORAGE_CONFIG_DIR 2>/dev/null || true
exec "$REAL_CLAUDE" "$@"
```

The table lives in a file rather than inside the script because `claude-acct` has to answer the same
question — *which account would this directory use?* — and a table copied into two scripts is a table
that will disagree with itself.

Point `REAL_CLAUDE` at the launcher symlink (`~/.local/bin/claude`), never a versioned path — the
installer moves that forward and a pinned version would quietly stop updating.

`"$(pwd -P)/"` against `"$root/"*` matches the repo root and everything under it — git worktrees
included, when they live inside the repo — without also matching a sibling `reading2-old`.

### Fail loudly when the account is not signed in

The worst outcome is not an error, it is a fallback: the wrapper decides the routed dir has no
credential, quietly uses the default, and the wrong subscription is billed for a month. So check, and
refuse:

```zsh
hash8="$(printf '%s' "$CLAUDE_CONFIG_DIR" | shasum -a 256 | cut -c1-8)"
security find-generic-password -s "Claude Code-credentials-$hash8" >/dev/null 2>&1 || {
  print -u2 "claude: $CLAUDE_CONFIG_DIR has no login — refusing to fall back to the default account."
  exit 78
}
```

`find-generic-password` without `-w` reads only attributes, so it triggers no Keychain prompt and
costs nothing per invocation. It proves a credential *exists*, not whose it is — that question has a
better answer below.

## The other mechanism: an injected token

`CLAUDE_CONFIG_DIR` is the right answer for *a person at a terminal in a directory*. There is a
second mechanism, and Greg's MindstoneRebel repo has been running it in anger for longer than this
doc has existed — worth knowing which problem it solves, because it is not this one.

```bash
CLAUDE_CONFIG_DIR="$dir" claude setup-token   # long-lived token, requires a subscription
export CLAUDE_CODE_OAUTH_TOKEN_2=…            # then injected per shell / per tmux pane
```

There, several subscriptions form a **pool of dispatch capacity** rather than a set of identities:
a daemon picks the least-loaded account, and can hot-swap a *running* session onto another one
mid-conversation. Auth binds to the shell or tmux pane, not to the directory and not to the worktree.
Each account is signed in twice on purpose — an `auth login` so a usage dashboard can read its quota,
and a `setup-token` that is the credential actually spent — and the token is minted *before* the
sign-in, so a half-failed setup cannot file one account's credential under another's export.

Choose by the question you are answering:

| | `CLAUDE_CONFIG_DIR` | `CLAUDE_CODE_OAUTH_TOKEN` |
|---|---|---|
| answers | *which account does this directory bill?* | *which account does this process bill?* |
| set by | a `PATH` wrapper, from the working directory | the launcher, per shell or pane |
| isolates | history, settings, plugins, MCP auth | the credential only |
| good for | keeping a client's work off your own subscription | spreading load, unattended dispatch, a headless box |

Two hazards carry across regardless of which you pick:

- **`apiKeyHelper` outranks an injected token, and a settings file cannot be unset from a child
  environment.** A lane can therefore report `subscription` while actually billing a metered API key.
  Assert `authMethod`, not intent — see below.
- **Shell startup files are the wrong place for the export.** MindstoneRebel lost hours on
  2026-09-04 to exports sitting *below* the non-interactive-shell guard in `~/.bashrc`: interactive
  terminals got the right account, every dispatched agent silently got account 1, and nothing looked
  wrong. This is the same failure the `PATH` script above exists to prevent, arrived at
  independently. Put the decision somewhere every invocation reaches.

## How fine can the split get?

The account is chosen **per process, at launch**, from the environment. That fixes the granularity
precisely, and it is worth knowing in both directions.

| Lever | Scope | How |
|---|---|---|
| the routing table | a directory tree — repo plus every worktree under it | `~/.claude-accounts` |
| a shell or tab | everything launched from it, dispatched agents included | `claude-acct use <name>` |
| one invocation | that process only | `CLAUDE_ACCOUNT_DIR=… claude` |

**A single worktree can be carved out of its repo**, because the routing table is longest-match, not
first-match: a longer path beats a shorter one wherever the two lines sit in the file. That was worth
the extra four lines — first-match would mean a worktree route added below its repo's route silently
did nothing, which is this document's whole subject matter.

```
/Users/greg/dev/spideryarn/reading2:/Users/greg/.claude-spideryarn
/Users/greg/dev/spideryarn/reading2/.claude/worktrees/client-job:/Users/greg/.claude-client
```

**`CLAUDE_ACCOUNT_DIR` is the lever that reaches dispatched sessions.** `scripts/run-claude.ts`
strips `CLAUDE_CONFIG_DIR` from the child environment but not this, so a tab pinned with
`claude-acct use` passes its account down to everything it dispatches, while a tab that merely
exported `CLAUDE_CONFIG_DIR` would not. Verified by calling the exported `claudeEnv` directly rather
than by reading it.

Two things you cannot do:

- **Split accounts between subagents of one session.** They run inside the parent process and share
  its credential. A session is one account, whole.
- **Move a session that is already running.** The variable is read at startup, so arming or changing
  the routing affects the *next* `claude`, never the ones already up. That is usually what you want —
  it is why arming the wrapper does not disturb a live fleet — but it does mean "I fixed the routing"
  and "this tab is now on the right account" are different claims. Restart the tab, then ask
  `claude-acct`.

## How to know which account you are actually on

```bash
claude auth status --json
```

No session, no paid call, and it names the account:

```json
{ "loggedIn": true, "authMethod": "claude.ai", "email": "…",
  "subscriptionType": "max", "orgId": "…",
  "projectsDirectory": "/Users/greg/.claude-spideryarn/projects" }
```

`authMethod` and `email` are the assertion worth making. `authMethod: "claude.ai"` is what rejects an
API key, a Console profile, or a Bedrock/Vertex provider having quietly outranked the subscription —
the precedence is `ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY` > `apiKeyHelper` >
`CLAUDE_CODE_OAUTH_TOKEN` > profile/federation > subscription OAuth, so several things beat the login
you think you are using.

Before any unattended run that costs money, assert it in the *same environment* the real invocation
will use:

```bash
claude auth status --json | jq -e '.loggedIn and .authMethod == "claude.ai" and .email == "you@example.com"'
```

A Keychain item existing is not this. `/status` inside a session is fine for a human, but it reports
after startup and possibly after a paid turn.

## Switching by hand

Per-directory routing covers the steady state; you still want to sign in, look, and occasionally
force an account. A single small script beats memorising env-var invocations — see `claude-acct` on
Greg's Mac ([What is installed here](#what-is-installed-here)), which offers:

```
claude-acct              # which account this directory would use
claude-acct list         # every config dir on the machine, and who is signed into each
claude-acct login <name> # create ~/.claude-<name>, seed it, sign a subscription in
claude-acct use <name>   # a subshell pinned to that account, whatever directory you are in
```

`use` exports `CLAUDE_ACCOUNT_DIR`, which the wrapper honours ahead of its routing table, so the
override reaches subprocesses too rather than only the interactive shell.

**There is no supported way to display the active account in the status line.** The `statusLine`
JSON on stdin carries `model`, `cwd`, `cost`, `context_window`, `rate_limits`, `session_id`,
`version`, `output_style`, `agent`, `worktree`, `effort` and more — and no account, email or config
dir field. A statusline script can read `$CLAUDE_CONFIG_DIR` from its inherited environment, or shell
out to `claude auth status --json` at the cost of a subprocess per refresh.

## Known gotchas

- **The VS Code extension does not respect `CLAUDE_CONFIG_DIR`.** Not one bug but several open ones —
  [#30538](https://github.com/anthropics/claude-code/issues/30538) (ignored entirely),
  [#34888](https://github.com/anthropics/claude-code/issues/34888) (per-workspace auth ignored while
  the terminal CLI works), [#56370](https://github.com/anthropics/claude-code/issues/56370)
  (shell-integration lock files hardcode `~/.claude/`). JetBrains is unconfirmed but shares the code
  path. **Treat the terminal as the only place the routing is real.**
- **macOS Keychain caches for around 30 seconds.** A switch can appear not to have taken effect.
- **Every OAuth'd MCP server needs re-authorising per account** via `/mcp`.
- **A trailing slash or a `~` gives you a different account.** Worth restating; it is the failure that
  looks like "it logged me out".

## Where this is going

There is no native account switcher. [#44687](https://github.com/anthropics/claude-code/issues/44687)
asked for `claude auth add --profile X` / `claude auth switch X` and was closed as a duplicate; it is
one of at least eight overlapping requests in the tracker, with no changelog entry and no public
roadmap commitment as of 2026-09-08.

`ANTHROPIC_PROFILE` and `ANTHROPIC_CONFIG_DIR` are real and *look* like the answer — the binary reads
a profile store at `$ANTHROPIC_CONFIG_DIR` (else `~/.config/anthropic`) holding `active_config`,
`configs/<name>.json` and `credentials/<name>.json`, where a profile's `authentication.type` can be
`user_oauth`. **It is not the answer.** That is the Anthropic Console / workload-identity-federation
profile store, written by a separate CLI; selecting one switches you to Console API billing rather
than to a second subscription. `claude --help` exposes no `--profile` flag and no profile subcommand.

Third-party switchers exist and are popular — [claude-swap](https://github.com/realiti4/claude-swap)
(~2.4k stars, actively maintained) and [clauth](https://github.com/uwuclxdy/clauth) are the two with
real traction, both adding usage dashboards and rate-limit-triggered switching. They wrap this same
env var. A twenty-line wrapper you can read is the boring choice, and boring is the house style.

## What is installed here

On Greg's Mac, as of 2026-09-08:

| Path | What it is |
|---|---|
| `~/.claude` | the default account, `greg@rehearsable.ai` (Max) — serves every unrouted repo |
| `~/.claude-mindstone` | `greg@mindstone.com` (Max, individual). **Signed in and live since 2026-09-09**; seeded with settings (+`forceLoginMethod: claudeai`), plugins, and the repo's 125-file auto-memory. No `.claude.json` copied — login created it. |
| `~/.claude-spideryarn` | seeded, **still not signed in**, and its route is therefore **parked** (commented out) in `~/.claude-accounts` — `claude-acct-arm` verifies every route, so a live-but-unsigned route would block arming |
| `~/bin/claude-wrapper.zsh` | the routing wrapper (moved here from `~/.claude-spideryarn/`, which was one account's private dir) |
| `~/bin/claude` | **armed** — the installed copy of the wrapper; `~/bin` precedes `~/.local/bin` |
| `~/bin/claude-acct` | look at and switch accounts |
| `~/bin/claude-acct-arm` | verifies **every** route by email, then installs. `--check` verifies only; `--off` rolls back |

**It is armed, for the MindstoneRebel tree only.** `/Users/greg/dev/gdconsult_work/mindstone` and
everything under it (114 worktrees included) bills `greg@mindstone.com`; every other directory on the
machine is untouched and still bills the default account. Rollback is `claude-acct-arm --off`.

The wrapper was hardened before arming, after two GPT reviews found the original was a *preference,
not a pin*: it now refuses when a protected tree has no matching route, when the routing table is
unreadable, when a higher-precedence credential (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, …)
would outrank the routed login, and when `CLAUDE_ACCOUNT_DIR` tries to walk a protected tree onto
another account. The protected-prefix list is compiled into the wrapper rather than read from the
table, so damaging the table cannot silently un-protect a tree.

Finishing spideryarn is still two commands:

```bash
claude-acct login spideryarn        # then un-comment its line in ~/.claude-accounts
claude-acct-arm                     # re-verifies every route before re-installing
```

It was left staged on purpose. The wrapper refuses to fall back to the default account, so arming it
before the login makes `claude` exit 78 inside the repo — and this machine runs a fleet of agents in
worktrees that would have started failing immediately. Because the account being pinned to is
*already* the default, waiting costs nothing and bills nothing wrongly. Arm it when the login exists,
which is what `claude-acct-arm` checks.

Both accounts are the same today. The point of pinning is that they need not stay that way: adding a
client subscription later is `claude-acct login <name>` plus one line in `~/.claude-accounts`, and
this repo cannot drift onto it by accident.

Adding a repo is that one line:

```
# ~/.claude-accounts  —  <repo root>:<config dir>, both absolute, no trailing slash
/Users/greg/dev/spideryarn/reading2:/Users/greg/.claude-spideryarn
/Users/greg/dev/gdconsult_work:/Users/greg/.claude-gdconsult
```

These wrappers are machine-local and deliberately outside the repo: the Linux box runs the same
checkout and must keep its own authentication.

## See also

- [claude-cli-as-subagent.md](claude-cli-as-subagent.md) — dispatching Claude from outside a session
  via `scripts/run-claude.ts`, which is the caller that a shell function would have missed.
- [silent-success.md](silent-success.md) — the class this doc's loud-failure rule belongs to.
- [Authentication](https://code.claude.com/docs/en/authentication) ·
  [Settings](https://code.claude.com/docs/en/settings) ·
  [Status line](https://code.claude.com/docs/en/statusline) — the official pages, current 2026-09-08.

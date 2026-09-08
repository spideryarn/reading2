# Two ChatGPT subscriptions, one machine

Run the Codex CLI from one repo against one ChatGPT account, and from anywhere else against another.
The sibling of [claude-subscriptions.md](claude-subscriptions.md), and the same shape of answer — a
directory — but almost everything underneath differs, and the differences are why this is a separate
document rather than a paragraph in that one.

**What this can and cannot promise.** Routing chooses a Codex *home*, and therefore which stored
login is available. It does not by itself choose which *credential* a run spends: an API key or an
access token in the environment outranks the stored login. Both halves have to be checked, and the
sections below say how.

> **Provenance.** Written 2026-09-08 on Greg's Mac against `codex-cli 0.153.4`, from web research, a
> read of the MindstoneRebel fleet (which has run several ChatGPT accounts in anger for longer than
> this doc has existed), and a GPT Sol review that found a silent mis-routing hole in the first draft
> of the wrapper below. Everything stated as a mechanism was exercised on this machine; where
> something is inferred or unverified, it says so.

## The mechanism, in one paragraph

`CODEX_HOME` relocates the whole per-user Codex tree. Point it somewhere new and you get a second,
independent ChatGPT identity: its own login, its own config, its own sessions, its own project trust.
Both accounts stay signed in at once. It is officially the variable that "controls where Codex stores
configuration and credentials"
([reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)), and it is the only
mechanism there is — there is no `codex auth switch`.

## Where the credential lives

`$CODEX_HOME/auth.json`, mode `0600`, when credentials are stored in file mode — which is this
machine's setting and, in 2026, the common one. Codex also supports OS-keyring storage, selected by
the `cli_auth_credentials_store` config key (a real, typed key: a nonsense value fails config load on
0.153.4). **The wrapper and identity check below are file-mode only**, so pin it in each routed home
if you rely on them. That is already a divergence from Claude Code, where the credential is *always*
a Keychain item and its service name is a hash of the config dir.

In file mode, measured here:

```
auth_mode      "chatgpt"
OPENAI_API_KEY  null
tokens.id_token / access_token / refresh_token / account_id
last_refresh   "2026-09-06T12:59:10.798455Z"
```

Three things follow.

**Separation is free and obvious.** Two directories, two files, no shared namespace to collide in, no
Keychain cache, nothing derived from the path. `CODEX_HOME=/some/dir codex login status` says
`Not logged in` while the default still says `Logged in using ChatGPT`, and the real `auth.json` mtime
does not move.

**Normal operation writes to this file, and the vendor says not to share it.** `last_refresh` moves
because "after a successful refresh, Codex writes the new tokens and a new `last_refresh` back to
`auth.json`". The [CI/CD auth doc](https://learn.chatgpt.com/docs/auth/ci-cd-auth) draws the
conclusion itself: *"Use one `auth.json` per runner or per serialized workflow stream. Do not share
the same file across concurrent jobs or multiple machines."* And: *"Do not overwrite a persistent
runner's refreshed file from the original seed on every run."* So this is a documented constraint,
not an inference from a timestamp — though the exact failure mode of ignoring it was not reproduced
here.

**The account's identity is in the file.** `tokens.id_token` is a JWT whose payload carries `email`,
and under the `https://api.openai.com/auth` claim, `chatgpt_plan_type` and `chatgpt_account_id`. That
matters because no Codex command will name the account, and this is the only local source that will.
It is also a credential: treat `auth.json` like a password
([auth docs](https://learn.chatgpt.com/docs/auth)).

## Five traps, all measured here

**`codex --cd <dir>` walks straight past directory routing.** `--cd`/`-C` sets the agent's working
directory *after* the process starts, so a wrapper that asks `pwd` has already decided against the
wrong directory. Measured: with a route on this repo, `cd /tmp && codex --cd <repo> …` ran on the
default account and said nothing. **And it has five spellings** — `--cd X`, `--cd=X`, `-C X`, `-C=X`
and the attached `-CX`, all accepted, all verified against `codex doctor --json`'s reported `cwd`. The
first draft of the wrapper below handled four of them; `-C/path` was a silent hole, found in review
rather than in use.

**A relative `CODEX_HOME` that exists is accepted, silently.** `CODEX_HOME=relhome codex login status`
in a directory containing `relhome/` reports `Not logged in` and carries on. The path resolves against
the working directory, so the same command in two places is two accounts. Absolute paths only.

**A `~` is not expanded — but it fails loudly.** `CODEX_HOME='~/.codex'` gives
`Error loading configuration: CODEX_HOME points to "~/.codex", but that path does not exist`, and
exits. This is the one place Codex is *better* than Claude Code, where the same mistake creates a
directory called `~` under your CWD and reports you signed out. The directory must also already
exist — codex will not create it.

**A trailing slash is harmless.** `CODEX_HOME=$HOME/.codex/` works, because nothing is hashed. The
opposite of Claude Code, where a trailing slash is a different Keychain item and so a different
account.

**`CODEX_ACCESS_TOKEN` in the environment outranks the stored login.** It is the Agent Identity path
used for remote exec-server registration, not a subscription pool. An *invalid* exported value breaks
every invocation loudly — measured:
`Error checking login status: invalid agent identity JWT format`. A *valid* one would work, and would
quietly leave the routed subscription. The wrapper below refuses to run while it is set.

## Routing picks a home; it does not pick a credential

`CODEX_API_KEY` takes precedence over a logged-in `auth.json` whenever the variable is set, so a repo
that exports one has already decided who pays. The `--auth` modes and the fallback order are owned by
[codex-cli-as-subagent.md § Which credential a run spends](codex-cli-as-subagent.md#which-credential-a-run-spends).
`OPENAI_API_KEY` compatibility is owned there too, and is worth re-measuring after upgrades rather
than trusting either document — the 0.153.4 binary lists it alongside the other two as a supported
auth environment variable, while the measurement on record was taken on 0.149.1.

The useful discovery is that **`codex doctor --json` will tell you when one of them is set.** With any
of the three exported, the `auth.credentials` check grows a field naming it:

```
OPENAI_API_KEY      →  "auth env vars present": "OPENAI_API_KEY"
CODEX_API_KEY       →  "auth env vars present": "CODEX_API_KEY"
CODEX_ACCESS_TOKEN  →  "auth env vars present": "CODEX_ACCESS_TOKEN"
```

The field is absent when none is. So the preflight for "this run will spend the subscription I think
it will" is: the field is absent, `CODEX_HOME` is the home you expect, and the stored account id is
the account you expect.

## What moves with the home, and what does not

`~/.codex` on this machine is **5.2 GB**. Do not copy it.

| | Size here | Cost of it moving |
|---|---|---|
| `auth.json` | 4 KB | the point of the exercise |
| `config.toml` | 7 KB | model, plugins, MCP servers, **and every project's trust** |
| `sessions/` | 3.3 GB | history — `codex resume` cannot see the other account's sessions |
| `plugins/` | 356 MB | installed plugins, marketplaces and caches |
| `state_5.sqlite`, `thread_history_1.sqlite`, `memories/`, `skills/` | ~145 MB | memories, skills, thread history |
| `log/`, `history.jsonl`, `session_index.jsonl` | small | logs and the session index |

Does not move: anything in the repo (`AGENTS.md`, a project `.codex/config.toml`), and anything a
config value names by absolute path — `~` there resolves from `$HOME`, not from `CODEX_HOME`.

Somebody rotating two subscriptions across several hosts put the cost better than a table does:

> changing CODEX_HOME or logging out/in also changes the effective config, session namespace,
> skill/plugin discovery, and local runtime state. In practice, this creates configuration drift
> between hosts and makes it hard to tell whether a failure is auth or config.
>
> — [openai/codex#4432](https://github.com/openai/codex/issues/4432), 2026-08-17

**Project trust is the one that will bite you.** Codex reads a repo's `.codex/config.toml` only for a
*trusted* project — a `[projects."<abs path>"] trust_level = "trusted"` entry in
`$CODEX_HOME/config.toml`. A new home has none, and the symptom does not say "untrusted": you get a
complaint about a config table that is plainly present, because codex never read the file. Seed each
new home with the checkouts it needs; trust is inherited by subdirectories and worktrees, so one entry
per checkout is enough.

```toml
[projects."/Users/greg/dev/spideryarn/reading2"]
trust_level = "trusted"
```

## Which account am I on? Build the answer, because Codex will not give it to you

```
$ codex login status
Logged in using ChatGPT
```

That is the entire output. No email, no plan, no account id. `codex doctor --json` is better and still
does not name the account — it is explicitly *"a redacted machine-readable report"* — but it does give
three of the four things a preflight needs: the effective `CODEX_HOME`, the stored auth mode, and the
`auth env vars present` field above.

The fourth has to be decoded locally. Compare an **account id**, not an email: ids are the routing
identifier, and printing somebody's email from a shell an agent can read is a worse default than
printing a pass or a fail.

```python
# ~/.codex-identity.py — prints the account id in a Codex home, or exits non-zero.
import base64, json, sys
NS = "https://api.openai.com/auth"
try:
    d = json.load(open(sys.argv[1] + "/auth.json"))
    if d.get("auth_mode") != "chatgpt":
        sys.exit(1)
    p = d["tokens"]["id_token"].split(".")[1]
    c = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
    auth = c.get(NS) if isinstance(c.get(NS), dict) else c
    acct = auth.get("chatgpt_account_id")
    if not acct:
        sys.exit(1)
    print(acct)
except Exception:
    sys.exit(1)
```

The token never reaches argv or stdout — only the id does. Two caveats: the claims are as of the last
refresh, so this answers "who", never "is the subscription still live"; and `plan_type` is in the same
payload if you want it for display.

`/status` inside a session is where a human sees the remaining window and reset time. It reports after
startup, so it is not a preflight.

## Wire it up

```bash
D=/Users/greg/.codex-clientname
mkdir -p "$D"
CODEX_HOME="$D" codex login                 # browser; or --device-auth for a headless box
printf '[projects."%s"]\ntrust_level = "trusted"\n' /Users/greg/dev/some/repo >> "$D/config.toml"
CODEX_HOME="$D" codex exec 'reply with OK'  # warm it once — see #42447 under Known gotchas
```

Copy nothing else to begin with. A second home that starts empty and grows is the point.
`codex login --device-auth` prints a link and a short code instead of opening a browser, which is what
makes signing a second account in over SSH possible at all.

**Log in to the second home; do not copy `auth.json` into it.** This is the obvious shortcut and it
rots rather than failing at the time. The diagnosis given in
[#15410](https://github.com/openai/codex/issues/15410) — a feature request asking for shared auth with
isolated config, closed — is that "OAuth refresh tokens in `auth.json` are single-use. When the real
Codex instance refreshes the token, any copy becomes invalid." Symlinking has the same problem from
the other end. It matches the vendor's own "one `auth.json` per stream" rule above, so treat a copied
credential as a 401 waiting for the original session to refresh.

A related detail worth knowing, since it changes what a home contains:
`codex login --with-api-key` **writes the key into `auth.json`** rather than reading it live
([#5212](https://github.com/openai/codex/issues/5212), closed "not planned"). A home seeded that way
has `auth_mode: "apikey"`, which the identity check below refuses — correctly, because it is not a
subscription.

### A `PATH` script, not a shell function

A `codex()` function in `~/.zshrc` exists only for the person typing. It does not exist for a
dispatcher that spawns `codex` through `PATH` — which is how this repo runs every cross-family review.
A function would leave your terminal on the right account and every dispatched run on the wrong one,
with nothing looking wrong.

The Codex-specific wrinkle cuts the other way and is worse: **codex's own shell tool runs a login
shell**, sourcing `~/.zprofile` and `~/.zshrc`
([codex-cli-as-subagent.md](codex-cli-as-subagent.md#it-is-not-sufficient-and-here-is-the-measurement)).
So a function *would* be visible to the model's shell commands while staying invisible to the
dispatcher — the worst available split. Put the decision on `PATH`.

```zsh
#!/bin/zsh
set -eu
REAL_CODEX=/opt/homebrew/bin/codex
CONF=${CODEX_ACCOUNTS_FILE:-/Users/greg/.codex-accounts}   # "<root>:<home>[:<account id>]"
IDENT=${CODEX_IDENTITY_PY:-/Users/greg/.codex-identity.py}
die() { print -u2 "codex: $1"; exit 78; }

# Route on the directory codex will actually work in. `--cd/-C` moves that AFTER launch, and has
# five spellings; `-Cpath` was the one the first draft missed, which is a silent mis-bill.
here="$(pwd -P)"
for ((i = 1; i <= $#; i++)); do
  case "${@[i]}" in
    --)       break ;;
    --cd=*)   here="${@[i]#--cd=}" ;;
    -C?*)     here="${@[i]#-C}"; here="${here#=}" ;;
    --cd|-C)  (( i + 1 <= $# )) || { print -u2 "codex: ${@[i]} needs a directory"; exit 64; }
              here="${@[i+1]}"; (( i++ )) ;;
  esac
done
here="$(cd -- "$here" 2>/dev/null && pwd -P || print -r -- "$here")/"

route=''; want=''
if [[ -r "$CONF" ]]; then
  best_len=0
  while IFS= read -r line; do                            # longest match wins, so a worktree
    [[ "$line" == \#* || -z "${line// }" ]] && continue  # can be carved out of its repo
    root="${line%%:*}"; rest="${line#*:}"
    if [[ "$here" == "$root/"* && ${#root} -gt $best_len ]]; then
      best_len=${#root}; route="${rest%%:*}"; want="${rest#"${rest%%:*}"}"; want="${want#:}"
    fi
  done < "$CONF"
fi

# A route and a different inherited CODEX_HOME are two authorities disagreeing. Fail closed:
# guessing which one meant it is how the wrong subscription gets billed for a month.
if [[ -n "$route" ]]; then
  if [[ -n "${CODEX_HOME:-}" && "$CODEX_HOME" != "$route" ]]; then
    [[ "${CODEX_ROUTE_OVERRIDE:-}" == 1 ]] || die \
"CODEX_HOME=$CODEX_HOME contradicts the route for $here ($route).
       Set CODEX_ROUTE_OVERRIDE=1 to mean it, or unset CODEX_HOME."
  else
    export CODEX_HOME="$route"
  fi
fi

# An access token in the environment outranks the stored login, silently leaving the routed
# subscription. CODEX_API_KEY does too, but a dispatcher passes that one on purpose.
[[ -z "${CODEX_ACCESS_TOKEN:-}" ]] || die \
"CODEX_ACCESS_TOKEN is set; it outranks the routed login. Unset it, or route by hand."

if [[ -n "${CODEX_HOME:-}" ]]; then
  [[ "$CODEX_HOME" == /* ]] || die "CODEX_HOME must be absolute, got '$CODEX_HOME'"
  [[ -d "$CODEX_HOME" ]]    || die "$CODEX_HOME does not exist — sign in there first."
  got="$(/usr/bin/python3 "$IDENT" "$CODEX_HOME" 2>/dev/null || true)"
  [[ -n "$got" ]] || die \
"$CODEX_HOME has no ChatGPT login. Refusing to fall back to the default account.
       Sign in with:  CODEX_HOME=$CODEX_HOME codex login --device-auth"
  [[ -z "$want" || "$got" == "$want" ]] || \
    die "$CODEX_HOME is signed in as account $got, but the route expects $want."
fi
exec "$REAL_CODEX" "$@"
```

```
# ~/.codex-accounts  —  <repo root>:<codex home>[:<expected chatgpt_account_id>]
/Users/greg/dev/clientwork:/Users/greg/.codex-client:8f3c…-…-…
```

Point `REAL_CODEX` at the stable launcher, never a versioned path, and install the wrapper earlier on
`PATH` — `~/bin` precedes `/opt/homebrew/bin` here.

**Three deliberate choices**, each of which the first draft got wrong or dodged:

- **A route and a conflicting inherited `CODEX_HOME` fail closed.** The wrapper cannot tell a
  deliberate per-command assignment from a stale blanket `export` in a shell rc. Preferring either one
  silently is a mis-bill; `CODEX_ROUTE_OVERRIDE=1` is how a pooled dispatcher says it meant it.
- **The third field is the point of the exercise.** `auth_mode == "chatgpt"` proves *a* credential
  exists, not whose — and a perfectly valid login to the wrong account passes it. Naming the expected
  account id in the route is what turns the check into an assertion.
- **`CODEX_ACCESS_TOKEN` is refused rather than warned about.** `CODEX_API_KEY` is not, because a
  dispatcher passes it deliberately on a fallback attempt; that gap is real and is what the
  `auth env vars present` preflight is for.

Tested here across the matrix: every `--cd` spelling re-routes, including the attached `-C`; a missing
`--cd` value exits 64; a wrong expected account id is named and refused; a contradicting `CODEX_HOME`
is refused and then accepted under the override; `CODEX_ACCESS_TOKEN` is refused; a deeper route beats
its parent from either file ordering; and an unrouted directory falls through to the default.

## How fine can the split get?

Per process, at launch, from the environment.

| Lever | Scope |
|---|---|
| the routing table | a directory tree — repo plus every worktree under it |
| a shell or tab | `export CODEX_HOME=…` there, and everything it launches |
| one invocation | `CODEX_HOME=… codex …` |

**`CODEX_HOME` survives dispatch where `CLAUDE_CONFIG_DIR` does not.** This repo's shared credential
sweep strips variables whose *names* look like credentials and its Claude wrapper additionally drops
`CLAUDE_CONFIG_DIR`; the Codex wrapper drops nothing. So `CODEX_HOME` crosses into a dispatched child
while `OPENAI_API_KEY` and `CODEX_API_KEY` do not — checked by calling the exported functions rather
than by reading them. On the Codex side, no second variable is needed.

Two things remain impossible. Subagents of one session share the parent's credential — a session is
one account, whole. And a running session cannot be moved, because the variable is read at startup;
changing the routing affects the next `codex`, never the ones already up.

## The other mechanism: a pool of homes

Routing by directory answers "which account does this repo bill". A fleet asks a different question —
"which account still has capacity" — with the same variable and a slot index.

| | routed by directory | pooled by slot |
|---|---|---|
| answers | *which account does this repo bill?* | *which account has room right now?* |
| home | `~/.codex-<name>`, chosen from the working directory | `~/.codex-<n>`, chosen by the dispatcher |
| variable | `CODEX_HOME`, set by a `PATH` wrapper | `CODEX_HOME_<n>` in the startup file — a registry the dispatcher reads and writes into the child's `CODEX_HOME` |
| good for | keeping a client's work off your own subscription | unattended throughput, a headless box |

In MindstoneRebel's version, account 1 — the normal `~/.codex` login — is **reserved**: once any
dispatch account exists it is never dispatched to, so a sub-agent's rate-limit cannot stall the person
driving the machine. The reservation is structural rather than a runtime check — account 1 has no
credential env var at all, so no execution profile can bind it. Accounts 2..9 are minted with
`CODEX_HOME="$HOME/.codex-$n" codex login --device-auth`.

**Their conclusion about the limits of this is worth carrying over.** Keeping a metered key out of a
"subscription" lane is done by unsetting variables, and four rounds of review each found one more
route the unset list could not see. The position they settled on is that a lane declaring
`subscription` records route *intent*, not proof of billing, and that per-account credential-store
isolation is the structural answer. Which is this document — so treat the routing as the durable half
and any env-var scrubbing as best-effort.

Two failures from that fleet are worth carrying, and neither is Codex-specific:

- **Dispatch wrappers run in non-interactive shells.** Most `~/.bashrc` files open with
  `[ -z "$PS1" ] && return`, and anything exported below that guard is invisible to a dispatch — so
  every dispatch quietly ran on account 1 while `status` still said "configured", for hours on
  2026-09-04. Worse, *a session that started before the exports were added has the file but not the
  environment*, so its dispatches keep spending the old account with everything on disk looking right.
- **A duplicate export later in the file wins at source time**, and three checks agreed it had not:

  > an indented `export CODEX_HOME_<n>=…` later in the file survives `write_export`'s removal and wins
  > at source time. A non-emptiness check passes it, `codex login status` then verifies the account we
  > just authenticated and succeeds, "Done" is printed — and every future dispatch sources the OTHER
  > account's home.

  That is [silent-success.md](silent-success.md) in six lines, and it is why the wrapper above asserts
  a decoded account id rather than the presence of a file.

## Known gotchas

- **Concurrent first runs against a *fresh* home lose rows, silently.**
  [openai/codex#42447](https://github.com/openai/codex/issues/42447) (open, 0.150.1, 2026-09-03): when
  several `codex exec` processes start against a brand-new `CODEX_HOME` at once, some never get a row
  in `state_5.sqlite`'s `threads` table — *"Every process exits 0 and prints a correct answer, so
  nothing signals that a thread was dropped."* It does not reproduce once the home has been used once,
  so **warm a new home with a single throwaway run before pointing a fleet at it.**
- **`codex update` breaks under a relocated home.**
  [#40837](https://github.com/openai/codex/issues/40837) (open, 2026-08-26): the standalone updater is
  unavailable when `CODEX_HOME` differs from the install home. Update from the default home.
- **Two versions sharing one home fight over the models cache.**
  [#39291](https://github.com/openai/codex/issues/39291) (open, 2026-08-18).
- **The ChatGPT desktop app writes into this tree and will not follow you.**
  `/Applications/ChatGPT.app` bundles its own copy of the same `codex-cli 0.153.4`, and its state is
  all over the default `config.toml` — MCP servers, computer-use, project trust entries.
  [#38193](https://github.com/openai/codex/issues/38193) asks for a separate desktop overlay for
  precisely this reason. A GUI app launched from Finder inherits no shell environment, so —
  **inference, not measurement** — the desktop app stays on the default account. This is the analogue
  of the VS Code extension ignoring `CLAUDE_CONFIG_DIR`: treat the terminal as the only place routing
  is real.
- **MCP OAuth: unverified, and worth verifying before relying on it.** Codex keeps MCP credentials in
  the macOS Keychain under service `Codex MCP Credentials`, account field shaped
  `<server name>|<16 hex>` — so, unlike the ChatGPT login, this is not obviously per-home. The
  discriminator is not a hash of the `CODEX_HOME` path, the server URL, or `name|URL`; all three were
  tried here and none matched. There is a separate `mcp_oauth_credentials_store` config key, and the
  leading candidate implementation for first-class profiles advertises that it "scopes MCP OAuth state
  by profile" ([#4432](https://github.com/openai/codex/issues/4432), 2026-06-03) — which is only a
  feature if it is not scoped today. **Not established.** Find out when you set a second home up.
- **The background app-server is per-home, which is the good outcome.** Its control socket is
  `$CODEX_HOME/app-server-control/app-server-control.sock` and its state is
  `$CODEX_HOME/app-server-daemon/`, so two homes cannot share a daemon and inherit each other's
  account. From `codex doctor --json` here, where the daemon was not running.
- **Nothing inside the repo can choose the account.** A project `.codex/config.toml` is read for a
  trusted project, but is explicitly forbidden from setting `openai_base_url`, `chatgpt_base_url`,
  `model_provider`, `model_providers`, `profile` or `profiles`
  ([config-advanced](https://learn.chatgpt.com/docs/config-file/config-advanced)). So there is no
  in-repo lever at all, and the wrapper is not a workaround for one — it is the only mechanism.
- **`--profile` is adjacent, and not this.** `--profile NAME` layers `$CODEX_HOME/NAME.config.toml`
  over the base config ([reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)).
  It cannot point at a second account, because auth lives in `auth.json` and profiles do not touch it.
  It is not inert, though: `forced_login_method` and `forced_chatgpt_workspace_id` are real typed
  config keys in 0.153.4 (both fail config load on a nonsense value), so an overlay can constrain
  *how* you may log in and *which workspace* within an account is used. Read out of the binary and
  from config validation, not exercised end to end.

## Where this is going

No first-class switcher, and it has been asked for since 2025-09-29:
[#4432](https://github.com/openai/codex/issues/4432) (`--auth-profile`, with a candidate branch),
[#9648](https://github.com/openai/codex/issues/9648) (OAuth rotation),
[#30684](https://github.com/openai/codex/issues/30684) (account/workspace switching) — all open as of
2026-09-08. Two designs are in play: isolated homes per profile (`$CODEX_HOME/profiles/NAME`), and one
shared home with credentials namespaced per account so sessions and memories are not duplicated.

Third-party switchers exist — `codex-accounts`, `codex-switcher`, `aistat` — and are either
`CODEX_HOME` in a trenchcoat or, worse, rewrite the live `auth.json` in place, trading a directory you
can inspect for a mutable file two processes might both be writing. A short wrapper you can read is
the boring choice, and boring is the house style.

## Is two accounts allowed?

OpenAI's [account sharing policy](https://help.openai.com/en/articles/10471989-openai-account-sharing-policy)
prohibits sharing *one* account's credentials with other people; it is about seats, and the sanctioned
answer to needing more of them is Team or Enterprise. Nothing found says one person may not hold two
subscriptions of their own, which is the case this doc is about — a client's work billed to the
client's account, your own to yours. Rotating accounts specifically to evade a rate limit is a
different act and a greyer one; the honest position is that no explicit language either way was found,
and that separating billing is not what the policy is aimed at.

The limits move too fast to write down — a rolling multi-hour window plus a weekly cap, with extra
credits purchasable, repriced repeatedly through 2026. Read them from `/status` or the ChatGPT usage
dashboard rather than from any document, including this one.

## What is installed here

Nothing. As of 2026-09-08 this Mac has a single `~/.codex`, no `~/.codex-*` siblings and no codex
wrapper on `PATH`; the wrapper above was exercised from a scratchpad and left uninstalled. The
Claude-side equivalents *are* installed —
[claude-subscriptions.md § What is installed here](claude-subscriptions.md#what-is-installed-here).

**One thing worth deciding before anything is installed.** This machine's `~/.codex` is signed in to a
`team`-plan account belonging to a client, not to Greg's own subscription. With no routing wrapper and
`--auth subscription-first` — which withholds the API key on the first attempt — **every successful
first attempt dispatched from this repo spends that client's subscription.** A run that hits a
recognised credential failure retries with the key and says so on stdout, so the fallback is visible;
what past runs actually spent would have to come from their saved status output, not from the current
auth state. Either way it is the mis-billing this pair of documents exists to prevent, and it is the
reverse of the Claude case, where the shared default was already the right account.

## See also

- [claude-subscriptions.md](claude-subscriptions.md) — the same problem for Claude Code, where the
  credential is a Keychain item, the config dir is hashed into its name, and a tilde fails silently.
- [codex-cli-as-subagent.md](codex-cli-as-subagent.md) — dispatching Codex from a session, the
  `--auth` modes, and the environment sweep the wrapper depends on.
- [silent-success.md](silent-success.md) — the class most of these traps belong to.

# Several Codex/ChatGPT account-subscriptions on the box, same shape as the Claude ones

**Status:** planning · **Queue item:** `qi-whppvck5` (size L, priority 0.9) · **Started** 2026-09-10
· **Worktree** `.claude/worktrees/claude-accounts`

Greg, 2026-09-09:

> we're going to want to do all the same stuff for Codex account-subscriptions too, as
> HIGH-BUT-NOT-TOP-priority.

And at 21:10Z, the same decision he made for Claude: **`new-codex`, like `new-claude`, uses
`--account auto` by default.**

**The sibling plan is
[260909g](260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md)**,
which did this for Claude and is where the registry, the wizard and the launcher guards already live.
This is a separate doc because that one is long and this is a different family; it is **not** a
separate system. Greg's instruction was explicit: *"coordinate with claude-accounts so the registry,
the wizard and the tab are one shape with a family column, not two systems."*

## Why this is much smaller than the Claude one, and where the work actually is

The Claude plan spent most of its length discovering a mechanism. Here the mechanism is already
written down and the plumbing is already parameterised, so **most of this is wiring, and the genuinely
new part is small**.

**Already measured**, in [codex-subscriptions.md](../reusable/codex-subscriptions.md) (0.153.4, on
this box):

- **`CODEX_HOME` relocates the whole per-user Codex tree** — its own login, config, sessions, trust.
- **An unauthenticated `CODEX_HOME` 401s rather than falling back.** This is the loud-failure
  property the whole design rests on, and it is the Codex twin of the Claude finding.
- The credential is `$CODEX_HOME/auth.json`, mode 0600 — *"treat it like a password"*.
- **A `~` fails loudly**; a relative path is *silently accepted*, which is the trap.
- A trailing slash is harmless — nothing is hashed, unlike the Mac Keychain scheme.
- **`CODEX_ACCESS_TOKEN` and `CODEX_API_KEY` outrank the stored login.**

**Measured here, 2026-09-10, before designing** — both change the size of this job:

1. **`collectCodexUsage` already reads a *chosen* account.** `CollectCodexUsageOptions.env` is
   injectable and **`CODEX_HOME` is already on its child-env allowlist**
   (`codex-usage.ts:564`, with a comment saying why). So
   `collectCodexUsage({ env: { ...process.env, CODEX_HOME: dir }, expectedAccountId })` reads exactly
   one account **with no change to the collector at all**. It even already has the identity gate —
   `expectedAccountId` plus `enforceExpectedAccount()` turn a mismatched reply into `unknown`.
2. **Codex identity is a local read, not an HTTP call.** `auth.json` carries
   `tokens.account_id` (a uuid), beside `auth_mode`, an id/access/refresh token and `last_refresh`.
   So pinning a Codex account needs no network at all — **strictly better than the Claude side**,
   which needs `/api/oauth/profile` and an undocumented endpoint to do the same job.

**So the Codex family is easier than Claude's in the two places Claude was hardest**: identity is
free and local, and per-account usage is a parameter that already exists. What is left is the
registry entry, the wizard's family branch, and the launchers.

## What is already built, on the Claude side, that this inherits

[260909g](260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md)
landed all of this, and it was designed for two families from the start:

- **The registry** already has `family: "claude" | "codex"`, a generic `stateDir` (not `configDir`),
  `providerAccountId`, `providerTenantId`, `displayEmail` (optional) and `familyData`. The
  single-orchestrator rule is **per family**, so a Codex orchestrator can coexist with the Claude one.
- **The wizard** (`claude-accounts add`) already asks its questions with a flag behind each, and
  `--family` is already a flag — it currently refuses anything but `claude` with an explicit message,
  which is the right shape to extend.
- **`overseer usage`** already prints one live line per registered Claude account, skipping other
  families.
- **The launcher guards** — refuse rather than fall back, record the resolved account, reserve under
  a lock — are written and tested.

## The stages

### Stage 1 — the registry and the wizard learn `family: codex`

The `--family codex` refusal becomes a branch. Per-family, behind one interface, the five operations
the Claude plan named as the seams:

| seam | Claude | Codex |
|---|---|---|
| state dir | `CLAUDE_CONFIG_DIR` | `CODEX_HOME` |
| who is signed in here | `/api/oauth/profile` | **`auth.json`'s `tokens.account_id`, read locally** |
| sign in | `claude auth login --claudeai --email` | `codex login` |
| usage | `GET /api/oauth/usage` | `collectCodexUsage({ env: { CODEX_HOME } })` |
| seeded | the `projects/`, `sessions/`, MCP, settings list | **unknown — Stage 1 must establish it** |

**The seeding question is the one real unknown**, and it must not be guessed. On the Claude side an
unseeded pool dir cost us two live bugs (a session that could not be listed and could not message
anyone), and both were found only by running a real session. So Stage 1 **enumerates what a fresh
`CODEX_HOME` lacks** compared with `~/.codex` — `config.toml`, `history.jsonl`, `cache/`, the
`goals_*.sqlite` files, project trust — and says for each whether a dispatched Codex run needs it.
Anything that turns out to be the Codex twin of `sessions/` matters most: **a peer registry, or
anything the fleet reads to see a run.**

`displayEmail` is optional in the registry precisely because a Codex account may not expose one;
`providerAccountId` is the pin either way.

### Stage 2 — the launchers

`run-codex.ts`, the review jobs that call it, and a new `new-codex` command.

- **`--account <name|auto>`, and `auto` is the default** (Greg, 2026-09-09). Same degrade rule as
  `new-claude`: no registry or no Codex pool accounts → the ambient account, said aloud, exactly
  today's behaviour. A **guard** failure still refuses.
- **`env -u CODEX_ACCESS_TOKEN -u CODEX_API_KEY … CODEX_HOME=<dir> codex …`**, process-scoped, never
  exported. Both variables **outrank the stored login**, so a launch that does not clear them is a
  preference rather than a pin — the identical hazard to `ANTHROPIC_*` on the Claude side, and the
  identical fix.
- **A relative `CODEX_HOME` is silently accepted by Codex**, so the registry's existing
  absolute-path validation is load-bearing here in a way it was not for Claude. Keep it, and say why.
- The resolved account goes in the launch record and the tmux metadata, never the word `auto`.

### Stage 3 — per-account Codex usage

Mostly wiring, given measurement 1. `overseer usage` grows a Codex account block beside the Claude
one, reading each registered `family: "codex"` account through `collectCodexUsage` with its
`CODEX_HOME` and its `expectedAccountId`.

**The same reading rules as the Claude block, which are house rules rather than preferences:** an
unknown reading is never rendered as 0%, an expired window carries no percentage, every reading says
when it was taken, and one account failing must not fail the report.

### Stage 4 — the tab

Folds into [260909g Stage 4](260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md#stage-4-usage-limits-one-section-per-account-and-add-account),
which already plans "Claude accounts, then Codex, each laid out the same". **It depends on the plural
history work that is the unfinished half of 260909g Stage 3**, not on anything here.

### Stage 5 — the web Add-account flow

Folds into 260909g Stage 5. The wizard takes a flag for every question specifically so that flow
drives the same command; a Codex account is then a different `--family`, not a second implementation.

## What cannot be tested until Greg acts, and must not be faked

**There is no second Codex account yet.** So everything past Stage 1 is built against fakes, and
**the first real account is Greg's to add while someone is watching** — the same rule the Claude
wizard is under, for the same reason: the login is an interactive browser flow, and a wrong move
rotates a credential that live work depends on.

**And one lesson from the Claude side is worth stating in advance**, because it will otherwise be
learned the same expensive way: the Claude pool account looked completely healthy in every test, and
was in fact **invisible to the fleet and unable to message anyone**, because a per-config-dir
directory nothing had thought about was also the peer registry. It was found by running a real
session and noticing `ListAgents` was empty. **So the first real Codex run gets the same treatment:
dispatch it, then check it can be seen and can report back — not just that it answered.**

## Not this plan's

The plural history/daemon/wire/checkpoint work (the rest of 260909g Stage 3), the Usage Limits tab
itself, and anything about Claude accounts.

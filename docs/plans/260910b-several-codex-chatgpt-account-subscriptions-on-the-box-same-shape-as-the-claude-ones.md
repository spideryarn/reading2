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

## Where the work actually is

> **⚠ The first draft of this section said "much smaller than the Claude one". That was wrong, and
> GPT Sol's review says exactly how**: *"'Much smaller than Claude' is true only of account identity
> and live usage, not of the whole deliverable."* The two measurements below are sound and they do
> shrink two stages — but the launcher, the wizard, the persistent state and the history are all
> **bigger** than the first draft assumed, and the cheerful framing was the risk, because it is what
> would have under-resourced them. Corrected throughout; see
> [the review](#round-1-review-gpt-sol-2026-09-10-two-p0s-and-a-framing-i-got-wrong).

The Claude plan spent most of its length discovering a mechanism. Here the mechanism is already
written down, and **account identity and live usage are genuinely nearly free**. Everything else is
not.

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
   `collectCodexUsage({ env: { ...process.env, CODEX_HOME: dir }, expectedAccountId })` reads the
   account at *that* home — Sol confirmed there is no ambient app-server or executor detour, and the
   checked-in negative capture shows an unauthenticated alternate home returning *account
   authentication required* rather than ambient usage.
   **But "reads exactly one account" was too strong**, and the correction is
   [P1 below](#p1s-accepted): `enforceExpectedAccount()` lets a **null** `accountId` through even
   when an expected id was supplied, so Stage 3 is a *small* collector change rather than none.
2. **Codex identity is a local read, not an HTTP call.** `auth.json` carries
   `tokens.account_id` (a uuid), beside `auth_mode`, an id/access/refresh token and `last_refresh`.
   So pinning a Codex account needs no network at all — **strictly better than the Claude side**,
   which needs `/api/oauth/profile` and an undocumented endpoint to do the same job.

**So the Codex family is easier than Claude's in exactly two places**: identity is free and local,
and per-account usage is very nearly a parameter that already exists. **That is the whole of the
saving.** The launcher is *harder* than Claude's, because `run-codex.ts` has an API-key fallback that
can silently outlive an account pin; the wizard is not family-shaped yet; and the persisted history
carries one Codex observation per record. See the review below.

## What is already built, on the Claude side, that this inherits

[260909g](260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md)
landed all of this, and it was designed for two families from the start:

- **The registry** already has `family: "claude" | "codex"`, a generic `stateDir` (not `configDir`),
  `providerAccountId`, `providerTenantId`, `displayEmail` (optional) and `familyData`. The
  single-orchestrator rule is **per family**, so a Codex orchestrator can coexist with the Claude one.
- **`overseer usage`** already prints one live line per registered Claude account, skipping other
  families. **Verified true.**

And two things this plan first claimed and **Sol's review disproved** — kept visible rather than
edited away, because over-crediting existing machinery is what produces stages bigger than they look:

- ~~The wizard already asks its questions with a flag behind each, so `--family` is the right shape
  to extend.~~ **Syntactically true, substantively false.** `email` is mandatory, the default path is
  `.claude-${name}`, the answers type carries a literal `family: "claude"`, and **the family check
  runs *after* the Claude-shaped questions have been asked** (`claude-accounts.ts:1292` then `1294`).
- ~~The launcher guards are generic.~~ **False.** Resolution, verification, identity, seeding and the
  emitted result are all hard-coded to Claude.

The **registry** genuinely is generic — `family`, `stateDir`, `providerAccountId`,
`providerTenantId`, optional `displayEmail`, `familyData`, and a per-family orchestrator rule — with
one caveat that must be settled before building: **`providerTenantId` is required and Codex has no
obvious value for it.**

## Round 1 review: GPT Sol, 2026-09-10 — two P0s, and a framing I got wrong

Verdict: *"not ready to build as written. The two central measurements are substantially correct, so
Stage 3 is not a rewrite — but the plan underestimates the launcher, wizard, persistent-state, and
history work."* Every checkable claim below was verified against the source before being accepted.

### P0-1 — an account-pinned `run-codex` can still fall through to the API key

**Verified.** `authPlan()`'s default mode is `subscription-first`, and it returns **`[false, true]`**
when a key is present (`run-codex.ts:313`) — attempt one without the key, attempt two *with* it, on a
credential-shaped failure. So:

1. `--account pool2` resolves and is recorded;
2. pool2 returns 429 or "out of credits";
3. the run retries on `CODEX_API_KEY` and **succeeds**;
4. the durable record still says pool2.

That is silent misbilling *and* false attribution — the account register would confidently name the
wrong payer. **`--account` must force subscription-only semantics** and reject `--auth key-first` /
`subscription-first`. If key fallback is ever wanted, it must resolve and record a **distinct
`api-key` payer** rather than the selected subscription.

Sol's implementation note is worth keeping: do this inside the existing TypeScript child-environment
construction, **after `.env.local` has loaded** — a shell-shaped `env -u` cannot resolve its
interaction with `authPlan()`.

### P0-2 — `new-codex` is a harness integration, not another launcher

**Verified.** `gjd-remote` session metadata accepts only `claude | shell | setup`
(`gjd-remote-tmux.ts:156`), the process/status model is Claude-specific, and launch-log accounts are
legal **only** on `new-claude` records (`gjd-remote-log.ts:267`). Resume would also have to restore
the original `CODEX_HOME`, or a thread gets resumed under another account or vanishes from the
picker. My plan gave all of this one line.

**Taken: the simpler v1.** `--account` on `run-codex.ts` only; **interactive `new-codex` is
explicitly deferred** to its own stage. That is the house rule — simplest version first, and name
the deferral at the point of choosing rather than discovering it mid-build. The review jobs go
through `run-codex.ts`, so this still puts Codex review work on a second account, which is the
point of the exercise.

### P1s accepted

- **The identity gate is weaker than I claimed.** `enforceExpectedAccount()` returns the reading
  unchanged when `accountId === null`, *even when an expected id was supplied*
  (`codex-usage.ts:520`). So "reads exactly one account" was too strong. **Stage 3 is a small
  collector change, not none**: when an expected id is supplied, require a non-null exact match, and
  add the missing-null negative test.
- **The wizard and launcher guards are not family-generic.** Verified: `email` is mandatory, the
  default path is `.claude-${name}`, the answers type carries a literal `family: "claude"`, and the
  family check happens **after** the Claude-shaped questions have already been asked
  (`claude-accounts.ts:1292` then `:1294`). The registry *is* generic and `overseer usage` *does*
  skip other families — those two claims held. Stage 1 is bigger than drafted.
- **A schema mismatch to settle before building**: every registry entry requires a non-empty
  `providerTenantId`, and Codex supplies only `tokens.account_id`. **Do not put the account id in
  both fields to satisfy the schema** — that manufactures a tenant pin that does not exist. Either
  discriminate the entry by family or make the tenant explicitly optional for Codex. Sol could not
  determine which of the JWT's email or organizations array is the right workspace pin, and says so.
- **Two variables are not the whole precedence story.** Also clear `OPENAI_API_KEY` rather than
  relying on a version-specific negative result; **`auth.json` can itself hold an API-key login**, so
  the verifier must require `auth_mode === "chatgpt"` plus a non-empty account id; and user config can
  set `model_provider`, base URLs, `forced_login_method`, `forced_chatgpt_workspace_id` or a profile,
  none of which move `CODEX_HOME` but any of which can change who bills. **The plan must not claim
  the two-name list is exhaustive.**
- **The relative-path hole is in the *ambient* path, not the registry one.** Registered entries are
  reparsed on every read, so they are rejected at launch too — stronger than I implied. But under
  "no registry or no pool → ambient", an inherited **relative** `CODEX_HOME` survives. So *ambient*
  must mean either explicitly unsetting `CODEX_HOME`, or validating and announcing the inherited home
  as absolute.
- **Stage 4 is not merely "depends on" the sibling's plural work — I deferred a whole schema change
  silently.** Codex history is one singular `codex?: CodexObservation` per record
  (`usage-history-record.ts:264`) with one `stashedCodex` in retention; the sibling's plural work is
  specifically for *Claude* accounts. So the tab needs that work made family-generic, or a further
  persisted-schema change carrying every Codex account per sample.

### The likely Codex twin of the `sessions/` trap — and it is not a guess any more

This was the plan's one declared unknown, and Sol narrowed it a long way. The 0.153.4 binary exposes
a typed `sqlite_home` **and `CODEX_SQLITE_HOME`**, and the live schemas are:

| database | holds |
|---|---|
| `state_5.sqlite` | `threads`, `thread_spawn_edges`, remote-control enrolments |
| `goals_1.sqlite` | per-thread goals |
| `queue_1.sqlite` | queued thread input |
| `thread_history_1.sqlite` | turns and items |
| `memories_1.sqlite` | memory-generation state |

So Stage 1's inventory is now mostly decided:

- **Definitely seed** a minimal `config.toml`, **especially project trust** — without it,
  `run-codex --sandbox review` ignores the repo's permissions profile and fails.
- **A product decision, not a technical one**: plugins and non-system skills are per-home, so an
  alternate account silently loses installed capabilities. That goes to Greg.
- **Do not seed** `history.jsonl`, `session_index.jsonl`, rollouts, caches, model caches, shell
  snapshots or logs — none is needed for a fresh dispatch.
- **Do not share the SQLite databases or the rollout tree blindly.** Pin **resume** to the account
  that created the thread instead.
- **Clear or refuse an inherited `CODEX_SQLITE_HOME`**, and do not seed `sqlite_home` unless
  deliberately chosen.

**And the honest gap, which is the most valuable line in the review**: Sol could not determine from
the stripped binary whether cross-process `list_agents` reads `thread_spawn_edges` or only the root
process's in-memory task manager. *"There is currently no evidence that sharing the DBs is necessary
or safe. Test it; do not symlink them on analogy alone."* That is the right instruction: the Claude
fix was to share `sessions/`, and reasoning from that analogy is exactly how we would share five
databases that nothing required us to share.

### Stage 0, added — settle these before any production wizard code

1. The Codex registry identity shape, **including the tenant/workspace decision**.
2. The strict local `auth.json` parser and its negative fixtures.
3. Inventory and prohibit `sqlite_home`, provider, profile and stored-key overrides.
4. The minimal seed: trust/config, plus the explicit plugins/skills decision for Greg.
5. Account-pinned resume, and `--account`/`--auth` compatibility.
6. An **empty alternate home as the negative control** — the Codex twin of the Claude measurement
   that an unauthenticated dir 401s rather than falling back.

**Then Greg authenticates the first real alternate home**, and before any general launcher work,
these are proven on it: the alternate app-server account id differs from ambient; usage follows that
home; a real run **bills and records that account**; its subagents stay visible within the root tree;
**the fleet sees its tmux/process row**; resume uses the same home; and plugins/MCP are either
present or *honestly absent*.

That list is the Claude lesson written down in advance. The Claude pool account passed every test
while being invisible to the fleet and unable to message anyone, and it was caught only by running a
real session and noticing `ListAgents` was empty.

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

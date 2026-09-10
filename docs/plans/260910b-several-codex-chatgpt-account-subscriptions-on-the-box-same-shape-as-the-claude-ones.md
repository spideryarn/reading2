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

#### Adding the first real Codex account — what Greg does, and what gets checked

Written after Stage 0, so the steps are the ones the code actually implements rather than a sketch.
**The wizard deliberately does not log in.** There is no `codex login --email`, so a wizard-driven
login is a browser flow with no way to say which account is intended — it could sign the pool home
into the very account we are separating from. So `add` prepares the home and stops.

```
npx tsx scripts/claude-accounts.ts add --family codex --name pool2
#   creates /home/greg/.codex-pool2 (0700), seeds its config.toml with the repo's
#   project-trust entry, then prints the login command and exits 1 without
#   registering anything.

CODEX_HOME=/home/greg/.codex-pool2 codex login       # Greg, watching. A browser flow.

npx tsx scripts/claude-accounts.ts add --family codex --name pool2
#   second run finds auth.json, reads the identity locally, and registers it.
```

Then the seven things that must be true before any launcher work builds on it. The first five the
code can check; **the last two need a real dispatched run**, and they are the two that caught us on
the Claude side.

1. `claude-accounts check` passes the new entry: the parsed `auth.json` identity matches the pin, and
   `codex doctor --json` reports the effective `CODEX_HOME` equal to the registry `stateDir` with
   `sqlite home` inside it.
2. The alternate account id **differs from ambient**. Two ChatGPT accounts of Greg's would share
   `chatgpt_user_id`; only `chatgpt_account_id` separates them, which is why that is the pin.
3. `overseer usage` reads the new account's own windows through its own `CODEX_HOME`, and a reading
   it cannot take is rendered `unknown` rather than `0%`.
4. The negative control still holds *for this home*: with `CODEX_API_KEY` withheld, a deliberately
   wrong home 401s rather than spending anything.
5. A real `run-codex --account pool2` run **bills pool2 and records pool2** — checked by watching
   pool2's usage move, not by reading the launch record, which is the thing under test.
6. **`codex agents` under pool2 sees the run, and the fleet sees its process row.** Stage 0 could
   only establish that the app-server control socket lives under `CODEX_HOME`; whether a pool run is
   visible to anything that has to supervise it is unproven. This is the exact shape of the Claude
   bug — a pool account that passed every check while being invisible to `ListAgents` — and it was
   found only by dispatching a real session and noticing.
7. `codex resume` under pool2 finds the thread, and under ambient does **not**. Stage 0 inferred this
   from `doctor`'s per-home database paths; nobody has watched it happen.

Items 6 and 7 are the ones to actually perform rather than reason about. Everything above them is
already enforced by a test.

That list is the Claude lesson written down in advance. The Claude pool account passed every test
while being invisible to the fleet and unable to message anyone, and it was caught only by running a
real session and noticing `ListAgents` was empty.

### Stage 0 — done, 2026-09-10. What was measured, and what it settles

**Status: complete.** Every number below was produced on the Hetzner box against `codex-cli 0.153.4`
on 2026-09-10, in a session working in worktree `codex-accounts`. Nothing here is inferred from the
sibling Claude plan or from `codex-subscriptions.md`; where a claim is *not* backed by a measurement
it says so in the same sentence. `~/.codex` was never written to and `codex login` was never run —
every experiment used a disposable `CODEX_HOME` at `/home/greg/.codex-probe-stage0`, removed
afterwards.

- [x] 1. Identity shape, including the tenant/workspace decision
- [x] 2. The strict `auth.json` parser's rules and its negative fixtures (rules here; code in Stage 1)
- [x] 3. Inventory of the override surface
- [x] 4. The minimal seed, and the plugins/skills decision
- [x] 5. Account-pinned resume, and `--account`/`--auth` compatibility
- [x] 6. The empty-alternate-home negative control

#### 1. Identity: everything needed is in `auth.json`, and two fields corroborate each other

`$CODEX_HOME/auth.json` has four top-level keys — `auth_mode` (`"chatgpt"` here), `OPENAI_API_KEY`
(`null` here), `tokens`, `last_refresh` — and `tokens` has exactly `id_token`, `access_token`,
`refresh_token`, `account_id`. `tokens.account_id` is a 36-character uuid.

The `id_token` payload carries `email`, `name`, `sub`, `auth_provider` and the namespaced claim
`https://api.openai.com/auth`, which holds `chatgpt_account_id`, `chatgpt_plan_type`,
`chatgpt_user_id`, `user_id`, `groups`, `organizations` and three subscription timestamps.

**Traced, not assumed** — each of these was computed rather than read off a comment:

| relation | result |
|---|---|
| `tokens.account_id == auth.chatgpt_account_id` | **true** — two independent sources for the pin |
| `auth.chatgpt_user_id == auth.user_id` | true, shape `user-…` (29 chars) |
| `sub == auth.chatgpt_user_id` | **false** — `sub` is not the ChatGPT user |
| `auth.organizations` | array of `{ id, is_default, role, title }`; `length == 1` here |
| `auth.chatgpt_plan_type` | `"pro"` |

So **`providerAccountId` is `tokens.account_id`, cross-checked against the id_token's
`chatgpt_account_id`** — a Codex account can be pinned with no network call at all, which is
strictly better than the Claude side's `/api/oauth/profile`. `chatgpt_user_id` is the *person* and
must never be the pin: two ChatGPT accounts belonging to Greg would share it.

**The tenant decision** — see [Sol's round-2 ruling](#round-2-sols-stage-0-design-ruling) below.
The measurement that made it decidable is that `organizations` is a real array of real workspaces
with an `is_default` flag, not a restatement of the account id. **What could not be measured**:
there is one ChatGPT account on this box, so the shape of `organizations` for an account with no
workspace is unknown — an empty array, an absent key and one implicit org are all still possible.
That is the [`a-survey-cannot-see-an-absent-state`](../reusable/silent-success.md) hazard, and the
parser is written to accept all three rather than to assume the one shape we can see.

#### 2. The `auth.json` parser's rules

Six rules, each with a negative fixture in `tests/codex-auth.test.ts`:

1. `auth_mode` must be exactly `"chatgpt"`. **`auth.json` can itself hold an API-key login** — the
   file has an `OPENAI_API_KEY` slot — so a home that "has a credential" is not a home that has a
   *subscription*.
2. `tokens.account_id` must be a non-empty string.
3. The `id_token` must decode and its `chatgpt_account_id` must **equal** `tokens.account_id`. A
   mismatch is a refusal, not a preference for one of them.
4. The JWT is parsed structurally only — three dot-separated segments, middle segment base64url
   JSON. **The signature is not verified and must not be claimed to be.** This parser answers *which
   account is this file for*, not *is this file genuine*; the 401 is what answers the second.
5. Expiry (`exp`) is **read and reported but is not a refusal**, because Codex refreshes tokens on
   use and a stale `exp` on disk is normal.
6. Anything unreadable is `{ kind: "unknown", why }` — never an exception across the boundary, and
   never silently "no account".

#### 3. The override surface is much larger than two variables, and the existing sanitiser misses the half that matters

Round 1 said *"the plan must not claim the two-name list is exhaustive."* It is worse than that.

**Every real config key was verified by probe**, using the fact that **codex silently ignores an
unknown config key** and errors on a real one with a bad value. `codex -c <key>=12345 login status`:

| key | verdict |
|---|---|
| `sqlite_home` | real — `expected path string` |
| `model_provider`, `model_providers.<n>.base_url`, `chatgpt_base_url` | real — `expected a string` |
| `forced_login_method`, `cli_auth_credentials_store`, `projects.<path>.trust_level` | real — `expected string only` |
| `forced_chatgpt_workspace_id` | real — `did not match any variant of untagged enum` |
| `profile` | real — `expected a string` |
| `preferred_auth_method` | **not a key** — silently ignored |
| `this_key_does_not_exist_at_all` | silently ignored |

**That silent-ignore is itself the finding.** A seeded `config.toml` with a misspelled key loads
cleanly and does nothing, and the file's existence is not evidence it worked — the
[silent-success](../reusable/silent-success.md) shape exactly. The read-back that closes it is
**`codex doctor --json`**, whose `config.load.details` reports the effective `CODEX_HOME`,
`sqlite home`, `model provider`, `mcp servers` and `log dir`, and whose `auth.credentials` reports
the auth file path and storage mode. **Every seed must be verified through `doctor --json`, not by
checking that the file was written.**

**The environment is the bigger hole.** Extracting every `CODEX_*` / `OPENAI_*` / `CHATGPT_*` name
from the 0.153.4 binary and running each through the *real* `isSecretName()` from
`scripts/subagent-cli.ts` — the denylist `sanitisedEnv` uses, and which `run-codex.ts` relies on:

- **Dropped (9):** `CODEX_API_KEY`, `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN`, `CODEX_AUTH`,
  `OPENAI_IDENTITY_TOKEN_FILE`, `CODEX_AUTH_API_BASE_URL`, `CODEX_REFRESH_TOKEN_URL_OVERRIDE`,
  `CODEX_REVOKE_TOKEN_URL_OVERRIDE`, `CODEX_CONNECTORS_TOKEN`.
- **Kept — they cross into the child (18):** `CODEX_HOME`, **`CODEX_SQLITE_HOME`**,
  `OPENAI_FEDERATION_RULE_ID`, `OPENAI_WORKLOAD_IDENTITY_CONTEXT`, `OPENAI_BASE_URL`,
  `OPENAI_ORGANIZATION`, `CODEX_AUTHAPI_BASE_URL`, `CODEX_APP_SERVER_CHATGPT_BASE_URL`,
  `CODEX_APP_SERVER_LOGIN_CLIENT_ID`, `CODEX_CLOUD_TASKS_BASE_URL`, `CODEX_OSS_BASE_URL`,
  `CODEX_EXEC_SERVER_URL`, `CODEX_ROLLOUT_TRACE_ROOT`, `CODEX_MANAGED_PACKAGE_ROOT`,
  `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`, `CODEX_AGENT_IDENTITY_JWKS_BASE_URL`, `CODEX_URL`,
  `OPENAI_CLUSTER`.

The denylist catches the **credential-shaped** names and misses the **redirect-shaped** ones, because
a name like `OPENAI_BASE_URL` contains no secret word. `CODEX_SQLITE_HOME` crossing is the one
round 1 specifically asked to be cleared, and today nothing clears it. The remedy is recorded in
[Sol's ruling](#round-2-sols-stage-0-design-ruling); it belongs to Stage 2's file, not this stage's.

#### 4. What a fresh `CODEX_HOME` actually lacks, and the seed

A fresh home was created and four commands run against it. **Created automatically, needing no
seed:** `installation_id`, `sessions/`, `shell_snapshots/`, `thread-writer-locks/`, `tmp/`,
`.tmp/`, `.sandbox_migration`, all six SQLite databases (`state_5`, `thread_history_1`, `goals_1`,
`queue_1`, `memories_1`, `logs_2`) — and **`skills/.system/` complete with all six system skills,
byte-for-byte the same set as the ambient home**. So system skills are not a seeding question.

**Present in `~/.codex` and absent from a fresh home:** `auth.json`, `config.toml`, `cache/`,
`history.jsonl`, `log/`, `models_cache.json`, `packages/`, `plugins/`, `session_index.jsonl`,
`version.json`.

- **`packages/` is not a seed item, and this is a real finding.** `codex doctor` reports
  `current executable` and `install context` pointing at
  `~/.codex/packages/standalone/releases/0.153.4-…`, *while running under the alternate home*. The
  binary and its resources stay in the ambient home whatever `CODEX_HOME` says. So a pool home needs
  no `packages/` — but **`codex update` must never be run from a pool home**, because its notion of
  the package root is the ambient one.
- **The minimal seed is `config.toml` and nothing else.** Copy `model`, `model_reasoning_effort`
  and `approvals_reviewer` from the ambient config, and — the load-bearing part —
  `[projects."/home/greg/code/spideryarn2"] trust_level = "trusted"`. Without it,
  `run-codex --sandbox review` reads no repo permission profile and dies pointing at the wrong
  thing; `run-codex.ts`'s own header documents that failure. **Trust is inherited, so the one repo
  entry covers every worktree under `.claude/worktrees/`** — no per-worktree entries, and none of
  the ambient config's stale `/tmp/…` trust entries get copied.
- **Plugins: decided, not asked.** The ambient home has one plugin cache
  (`plugins/cache/openai-curated-remote`); a fresh home has no `plugins/` at all. Nothing
  `run-codex.ts` does — `exec`, and `review` with the repo permission profile — needs a plugin. So
  **v1 does not seed plugins, and the wizard says so aloud** rather than leaving it to be discovered.
  Greg only needs to weigh in if he later installs a plugin a review job depends on. This is the
  plan's simplest-version-first rule applied to a question round 1 wanted escalated: there is
  nothing to escalate while the answer is "there is one plugin and no job uses it".
- **Non-system skills: nothing to lose today.** The ambient `skills/` contains only `.system/`, so
  there are no user skills an alternate home would silently lack. That will stop being true the day
  Greg installs one; the wizard's seed message names the directory so the gap is visible.

**A trap worth writing down: `CODEX_HOME` must not be under `/tmp`.** A home at
`/tmp/…/codexhome-empty` produced
`WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper
binaries under temporary dir "/tmp"` — and *proceeded*. Under `/home/greg/…` the warning is absent.
So a pool home belongs at `/home/greg/.codex-<name>`, mirroring `~/.claude-<name>`, and a `/tmp`
path is a degraded home that still looks like it works. **Tests must therefore not use `/tmp` homes
to prove seeding behaviour** — they would be measuring the degraded path.

#### 5. Resume is account-scoped for free; `--auth` is not

`codex doctor --json`'s `state.paths` shows **every** database and the rollout tree resolved under
`CODEX_HOME` — `state_5.sqlite`, `thread_history_1.sqlite`, `goals_1.sqlite`, `queue_1.sqlite`,
`memories_1.sqlite`, `logs_2.sqlite`, plus `sqlite home` itself. And `app_server.status` shows the
control socket at `$CODEX_HOME/app-server-control/app-server-control.sock` with its daemon state dir
at `$CODEX_HOME/app-server-daemon`.

Two consequences:

- **`codex resume` cannot cross accounts.** The thread it would resume is in a per-home database, so
  resuming under the wrong home *fails to find the thread* rather than silently resuming under
  another account. That is a loud failure, which is what we wanted, and it removes the P0-2 worry
  about resume restoring the wrong `CODEX_HOME` — provided the launcher re-sets the same home,
  which is Stage 2's job. **This is inferred from `doctor`'s reported paths, not demonstrated by a
  cross-home resume**, because there is no second account to create a thread on. It is on the
  acceptance list below.
- **`codex agents` browses "the shared local app-server daemon", and "shared" means shared per
  `CODEX_HOME`, not per machine.** This is the Codex twin of the Claude trap that cost us a pool
  account which passed every test while being invisible to `ListAgents`. Same caveat: the socket
  path is `doctor`'s own report of where it looks, not a cross-home run — `codex agents` is an
  interactive TUI with no JSON mode, and there was no live Codex session to browse. **On the
  acceptance list, and it is the item most likely to bite.**

**`--auth` is the part that is not free.** Confirmed by reading the code:
`AUTH_MODES = ['subscription-first', 'key-first', 'subscription-only']`, the default is
`subscription-first`, and `authPlan('subscription-first', haveKey=true)` returns **`[false, true]`** —
attempt one without the key, attempt two *with* it. `--pass-env CODEX_API_KEY` is already refused, so
the only route to the key is that second attempt.

#### 6. The negative control — and P0-1 is measured, not theoretical

Three runs of `codex exec --sandbox read-only` against the empty alternate home:

| environment | result |
|---|---|
| nothing set | `401 … Missing bearer or basic authentication in header`, exit 1 — **no fallback to the ambient login** |
| `OPENAI_API_KEY=<bogus>` | byte-identical `Missing bearer`. The ambient OpenAI key is **not** sent by `codex exec` |
| `CODEX_API_KEY=<bogus>` | `Incorrect API key provided: sk-notar***robe … auth error code: invalid_api_key` |

The third line is the whole of P0-1, demonstrated. The error *changed*, so the key crossed and
outranked the pinned home's stored login; with a **valid** key that run succeeds, bills the key, and
the launch record still names the pinned subscription. And `.env.local` on this box sets **both**
`CODEX_API_KEY` and `OPENAI_API_KEY`, so the hazard is live rather than hypothetical.

The first line is the negative control the design rests on, re-confirmed independently of the
2026-09-08 measurement in `codex-subscriptions.md`.

**One more thing the empty home proved**, and it matters for every check we write: after those
three *failed* runs the home contained six SQLite databases, three rollout files, `installation_id`,
`sessions/`, `skills/` and `shell_snapshots/`. **"The directory has something in it" is not evidence
of anything** — not of a login, not of a successful run, not of a seed.

### Round 2: Sol's Stage 0 design ruling

GPT Sol, `gpt-5.6-sol`, high effort, `--sandbox review`, 2026-09-10 — a genuine nested run, not the
[self-review that looks like an independent one](../reusable/codex-cli-as-subagent.md). It was given
every measurement above and asked three questions. **Accepted in full except where marked.**

#### Q1 — the tenant field: `providerTenantId: string | null`

Sol rejected all three options offered and proposed a fourth, which is better than the one this plan
was going to take: **keep the field required, make its type nullable** rather than making it
optional. Every entry still carries the property, `Pick<AccountEntry, …>` keeps working for
`LiveUsageIdentity`, absence is represented explicitly rather than by a missing key, and none of the
out-of-stage narrowing a discriminated union would force is needed. It also matches
`scripts/gjd-remote-account.ts`, which **already** types its resolve-payload tenant `string | null`.
The cost, stated plainly: the compiler still cannot prove a Claude entry has a tenant — the parser
owns that invariant, and the discriminated union stays the better eventual type once its callers can
move together.

The pin, for both launch and `check`: `auth_mode === "chatgpt"`; a non-empty `tokens.account_id`; a
decodable id_token whose `chatgpt_account_id` **equals** it; that value equal to the registry's
`providerAccountId`; and, when the tenant is non-null, the default organization id equal to it.
**Never pin on `email`, `sub`, `chatgpt_user_id` or `user_id`** — they are the person, and two of
Greg's accounts would share them. They may be displayed or kept in `familyData`.

**Deviation 1 — `forced_chatgpt_workspace_id` is not a v1 requirement.** Sol's sixth verifier rule
was that the effective `forced_chatgpt_workspace_id` must equal `providerTenantId`, and be absent
when the tenant is null. Declined for v1, for three reasons that compound: it would put a key into
every seeded `config.toml` **whose effect we have not measured** — Stage 0 established only that it
is a real typed key, which is precisely the standard §3 says is not enough; the ambient account does
not set it, so the rule would fail the account we are separating *from*; and it rests on the premise
Sol itself flags as unproven, that `is_default` names the billed workspace. What we take instead is
the fail-closed half without the unverified half: **v1 never writes the key, and `check` refuses
only if the key is present and disagrees with the tenant.** That catches somebody pinning a
different workspace without asserting a mechanism nobody has watched work.

**Deviation 2 — a lone workspace is used whether or not it is flagged default.** Sol's rule refuses
a non-empty `organizations` array with zero or multiple defaults as ambiguous. Kept for *multiple*
entries, which is genuinely ambiguous and worth a loud refusal. Declined for the single-entry case:
with one account observed we do not know that a personal workspace is flagged `is_default`, and a
rule built from that census would refuse to register Greg's second account with no way forward. So:
**exactly one entry → use it; several entries with exactly one default → use that; anything else →
refuse as ambiguous, and say in the refusal how to proceed.** This is the
`a-survey-cannot-see-an-absent-state` hazard applied to the rule rather than to the data.

#### Q2 — the child environment: an account-pinned drop list

Not a wider `isSecretName` (it is shared with the Claude wrapper, and it conflates
secret-exfiltration protection with process-routing isolation), and not a positive allowlist (which
would make plugins and ordinary CLI behaviour depend on continuously enumerating their environment).
On a registered-account launch: run the existing sanitiser, then **drop all 18 routing and state
variables** from §3, then set back only `CODEX_HOME`.

Sol's classification of the 18, with its own confidence attached — worth keeping, because most of
them are *"potentially identity-changing, but not individually proven in this executable path"*:

| effect | variables |
|---|---|
| direct account/auth selection | `CODEX_HOME`, `OPENAI_FEDERATION_RULE_ID` |
| API-organization selection (API-key mode only) | `OPENAI_ORGANIZATION` |
| state association, not billing | `CODEX_SQLITE_HOME`, `CODEX_ROLLOUT_TRACE_ROOT` |
| documented audit-only | `OPENAI_WORKLOAD_IDENTITY_CONTEXT` |
| endpoint/provider/auth routing — **not individually proven** | `OPENAI_BASE_URL`, `CODEX_AUTHAPI_BASE_URL`, `CODEX_APP_SERVER_CHATGPT_BASE_URL`, `CODEX_APP_SERVER_LOGIN_CLIENT_ID`, `CODEX_CLOUD_TASKS_BASE_URL`, `CODEX_OSS_BASE_URL`, `CODEX_EXEC_SERVER_URL`, `CODEX_AGENT_IDENTITY_JWKS_BASE_URL`, `CODEX_URL`, `OPENAI_CLUSTER` |
| install/metadata — inference, not measured | `CODEX_MANAGED_PACKAGE_ROOT`, `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` |

Drop the last two as well: they buy nothing on a pinned launch. **The list is version-scoped** — a
Codex upgrade can add another routing variable, so the binary inventory is repeated at upgrade time.
And the environment fix does not replace validating the home's effective `config.toml`: providers,
profiles, base URLs, login method and workspace restrictions still have to be checked there.

**And a real bug in shared code, found by Sol and then confirmed by running it.**
`sanitisedEnv(parent, passThrough, drop)` applies `drop` in its main loop but **re-adds every
`passThrough` name afterwards without consulting `drop`**, so a name in both survives:

```
sanitisedEnv(parent, [],                     ["CODEX_SQLITE_HOME"]) → { PATH }
sanitisedEnv(parent, ["CODEX_SQLITE_HOME"],  ["CODEX_SQLITE_HOME"]) → { PATH, CODEX_SQLITE_HOME }
```

So `--pass-env` defeats a drop list, and Stage 2 cannot rely on `drop` alone: it must either refuse
`--pass-env` for a protected name or re-apply the drop after pass-through. `--pass-env
CODEX_API_KEY` is already refused by name, which is why this has not bitten yet. **This is in
`scripts/subagent-cli.ts`, which no stage of this plan owns** — flagged for the Overseer.

#### Q3 — `--account` plus `--auth key-first` is a hard error

No `api-key` payer in v1. A registered account makes the effective mode `subscription-only`; no
`--auth`, or an explicit `--auth subscription-only`, is allowed; an explicit `key-first` or
`subscription-first` is a hard error **before spawning**; the ambient, unpinned path keeps today's
behaviour. Sol's reason for refusing the payer idea is the one worth quoting: an API-key payer would
need its own identity, organization attribution, selection rules and launch-record shape, and
*"adding only the label would recreate the same false-attribution problem under a nicer name."* The
cost is deliberate — a depleted subscription now fails instead of succeeding on the wrong payer, and
the way to spend the key is to launch without an account pin.

## The stages

### Stage 1 — the registry and the wizard learn `family: codex`

**Status: built, 2026-09-10 — implemented by GPT (`gpt-5.6-sol`, high, `workspace-write`) from a
written brief, reviewed and repaired by the manager, then sent for cross-family review.** 141 focused
tests green, `npm run typecheck` exit 0 across all four projects.

What the manager changed after reading the diff, each red-first:

- [x] **`AccountProfileReading.orgId` put back to `string`.** The implementation had widened the
      *Claude* profile's org id to `string | null` to make the types line up — but the producer,
      `profileFromJson`, still refuses to return a reading without one. The widening was forced by
      two lines in `tests/run-claude.test.ts` building a fake profile out of a registry entry; the
      honest fix was a non-null assertion in the fixture, which that file already uses for
      `displayEmail`. A type that says less than the code guarantees is a type a later reader will
      write a dead null-check against.
- [x] **The seed no longer clobbers `config.toml`'s `projects` table.** It assigned a fresh table
      containing only the repo root, so re-running `add` on a home where somebody had added a trust
      entry by hand silently deleted it — and `add` is idempotent precisely so it can be re-run.
      Now merged; the ambient config's own project entries are still never copied.
- [x] **The login offer is decided by a typed `reason`, not by the words in `why`.**
      `codexAuthIsMissing()` matched `/\b(missing|does not exist)\b/` against the error prose to
      decide whether to offer `codex login`. `CodexAuthReading` now carries
      `reason: "missing" | "unreadable" | "malformed"`. **The test agreed with the bug**: it
      asserted the same string the code grepped for, so it could not have caught a rewording. Both
      tests were rewritten to disagree with the prose — the missing case now says *"no credential
      here yet"*, and the unreadable case deliberately says *"missing a closing brace"*. Under the
      old implementation the second one **offers to log in over a live credential**, which is the
      thing that path exists to prevent; it was watched failing before the fix.
- [x] **The parser says out loud that it does not verify the signature**, because "strict identity
      parsing" returning a `CodexIdentity` is exactly the shape a later reader upgrades into an
      authenticity claim it never made.

Stage 0 settled the unknowns this stage was told not to guess,
so the seeding row in the table below is now answered rather than open. Three things Stage 0 found
change what this stage builds:

- **The seed is one file.** `config.toml` with `model`, `model_reasoning_effort`,
  `approvals_reviewer` and `[projects."/home/greg/code/spideryarn2"] trust_level = "trusted"`.
  Everything else a fresh home needs it creates itself, **including all six system skills**.
- **The seed must be read back through `codex doctor --json`**, because an unknown config key is
  *silently ignored* — writing the file proves nothing.
- **The wizard must not run `codex login`.** Unlike `claude auth login --claudeai --email`, there is
  no non-interactive spelling and no way to say which account is intended, so a wizard-driven login
  is a browser flow that could sign a pool home into the account we are trying to keep separate.
  **v1 refuses and instructs**: it prepares and seeds the directory, then prints the exact
  `CODEX_HOME=… codex login` command and exits non-zero **without writing a registry entry**. Greg
  runs that, re-runs `add`, and the second run finds the credential and registers it. That is also
  what makes the first real account "Greg's to add while someone is watching" a property of the
  code rather than a note in a plan.

There is one precedent this stage should follow rather than invent: `claudeEnvironment()` in
`scripts/claude-accounts.ts` builds the Claude child environment by **stripping every `ANTHROPIC_`
and `CLAUDE_` prefixed variable** and then setting `CLAUDE_CONFIG_DIR`. That is a prefix strip, not
a secret-name denylist, and it is exactly the shape Stage 0's finding 3 says the Codex side needs.

#### Found while building this: `tests/run-claude.test.ts` fails on any routed session

**Not this plan's file, and not caused by this plan's diff — but it will be blamed on the next
person's.** Eleven tests in `tests/run-claude.test.ts` § "the CLI, end to end" fail on this box:

```
run-claude: --account mindstone: the effective auth probe reports claude.ai via an
unknown provider, not claude.ai via firstParty
```

`run-claude.ts` routes whenever `--account` is given **or `CLAUDE_CONFIG_DIR` is merely present in
the environment** (`scripts/run-claude.ts:676`). Those tests spawn it as a subprocess with a fake
`claude` on `PATH`; that stand-in cannot answer the routed effective-auth probe, so every assertion
about a successful run fails. The account it names, `mindstone`, appears nowhere in the test file —
it comes from the machine's real `~/.claude-accounts/registry.json`.

Measured, one variable changed and nothing else:

| session environment | result |
|---|---|
| `CLAUDE_CONFIG_DIR` set (this session, routed to `mindstone`) | **11 failed**, 37 passed |
| `CLAUDE_CONFIG_DIR` unset | **48 passed** |

So the trigger is *who is running the suite*, not what the suite is testing. This became reachable
only when 260909g registered the first real pool account and the Overseer began dispatching agents
onto it — which is to say **every agent dispatched onto a pool account from now on will open a red
`run-claude` suite in a file it never touched**, and the obvious inference is that it broke it. That
is the ambient-state class: the test's expected environment is "this box has no routed session", and
that stopped being true this morning.

The repair belongs to whoever owns `run-claude.ts`: the test should pin the registry and the parent
state dir explicitly rather than inheriting them, so the suite answers the same question whoever
runs it. Flagged to the Overseer rather than fixed here — it is outside this plan's file set, and it
is a live launcher.

The `--family codex` refusal becomes a branch. Per-family, behind one interface, the five operations
the Claude plan named as the seams:

| seam | Claude | Codex |
|---|---|---|
| state dir | `CLAUDE_CONFIG_DIR` | `CODEX_HOME` |
| who is signed in here | `/api/oauth/profile` | **`auth.json`'s `tokens.account_id`, read locally** |
| sign in | `claude auth login --claudeai --email` | `codex login` |
| usage | `GET /api/oauth/usage` | `collectCodexUsage({ env: { CODEX_HOME } })` |
| seeded | the `projects/`, `sessions/`, MCP, settings list | **`config.toml` only** — settled in Stage 0 §4 |
| sign-in is driven by | the wizard, non-interactively | **Greg, by hand** — the wizard prepares and refuses |

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

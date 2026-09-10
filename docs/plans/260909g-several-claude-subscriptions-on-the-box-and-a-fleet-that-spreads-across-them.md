# Several Claude subscriptions on the box, and a fleet that spreads across them

**Status:** planning · **Queue item:** `qi-a722zr9h` · **Started** 2026-09-09 · **Worktree**
`.claude/worktrees/claude-accounts`

Greg, 2026-09-09:

> talk me through what I need to do. Ideally there would even be a button or sub-mode (perhaps in
> Usage Limits) for adding new Claude and Codex subscriptions. Let's add a few more Claude
> account-subscriptions first, and then wait for my signal to do more Codex account-subscriptions.

## What this is for, in plain words

Every Claude session on this box — the Overseer, every agent it dispatches, every tab Greg opens —
signs in as one person, `greg@rehearsable.ai`, and spends one Max subscription. That subscription has
a weekly allowance. Tonight it is **82% spent with 5.5 days still to run**, so the Overseer is
holding the fleet at one or two sessions to make it last. The fix Greg wants is more subscriptions:
several Max accounts on the same box, with the fleet spreading its work across them, so the week's
allowance is three or four times bigger and the fleet can run at its natural width.

Two halves, and only the second is ours:

- **The logging-in is Greg's.** Signing into a Claude account is a browser OAuth flow. Nobody can do
  it on his behalf, and on a headless box it means the box prints a URL, he opens it on his laptop,
  and pastes a code back. Deliverable 1 is the checklist he follows, per account.
- **Everything downstream is code.** A registry that says which accounts exist, a launcher that picks
  one per session, usage read per account, and the Usage Limits tab showing one section per account.

Codex/ChatGPT accounts are the same idea for the other model family, and they **wait for Greg's
signal** (his words above). This plan is designed so a Codex account slots into the same registry
later rather than needing a second one.

## Jargon, once

| Word | What it means here |
|---|---|
| **account** | one Claude subscription, identified by the email signed into it (`greg@rehearsable.ai`) |
| **config dir** | `~/.claude` by default. Holds the login, the settings, **the session transcripts and the auto-memory**. `CLAUDE_CONFIG_DIR` moves it. **This is the mechanism we use.** |
| **`setup-token`** | mints a long-lived token, injected as `CLAUDE_CODE_OAUTH_TOKEN`. **Not used — Greg should never run it.** Here only because early sections discuss it. |
| **orchestrator account** | the one the Overseer runs on, which dispatched agents may never spend |
| **pool account** | an account dispatched sessions draw from |
| **the window** | a rolling allowance. Two matter: **five-hour** (short spikes) and **seven-day** (the one that freezes the fleet for days) |

## What was measured on the box, not assumed

All of this was run on the box on 2026-09-09 against Claude Code **2.1.266**, before any design was
settled. Each one changed the plan.

1. **`CLAUDE_CONFIG_DIR` isolates on Linux, and it fails loud.** The Mac doc
   ([claude-subscriptions.md](../reusable/claude-subscriptions.md)) says the credential is a Keychain
   item whose service name is derived from the config dir. **On this box it is an ordinary file**,
   `~/.claude/.credentials.json`, mode 0600. Pointing `CLAUDE_CONFIG_DIR` at an empty directory and
   asking `claude auth status --json` returns `{"loggedIn": false, "authMethod": "none"}` — it does
   **not** silently fall back to the default account. That is the loud-failure property the whole
   design leans on, confirmed here rather than inherited from a doc about another machine.

2. **`claude auth status --json` names the account, for free.** It returns `loggedIn`, `authMethod`,
   `apiProvider`, `email`, `orgId`, `orgName` and `subscriptionType`, makes no model call, and costs
   nothing. This is the assertion that turns "an account is configured" into "*this* account is
   configured", and it is what every gate in this plan is built on.

3. **`cachedUsageUtilization` is one slot per config dir, not a map per account.** In
   `<config dir>/.claude.json` there is exactly one object: `{fetchedAtMs, accountUuid, utilization}`.
   It carries the uuid of whichever account last wrote it. There is no per-account history in there
   at all. **This is the finding that shapes deliverable 4** — see [Stage 4](#stage-3-usage-read-per-account).

4. **Nothing free refreshes that cache.** `claude auth status` leaves `fetchedAtMs` untouched; the
   reading on the box right now is about five hours stale. Only a real session refreshes it. So an
   account's usage reading is only ever as fresh as the last work that account did — which is a
   property to *display*, not a bug to fix.

5. **The shared config dir is carrying 83 auto-memory files and 2.7 GB of transcripts** for this repo
   alone, across 43 project directories. That number is why the mechanism choice below goes the way
   it does.

## The mechanism choice, and why

> **⚠ SUPERSEDED — this section chose the pool model, and Stage 0 disproved its premise.**
> **The decision is [the config-dir model](#the-mechanism-decision-the-config-dir-model)**; there
> are no `setup-token`s and no `CLAUDE_CODE_OAUTH_TOKEN` anywhere in the design. This section is
> kept because it records *why* the pool model looked right — the reasoning was sound and the
> premise (that a per-account config dir would carry its own usage reading) was simply false, which
> is the sort of thing only a measurement finds. **Do not implement from this section.**

There are two ways to make a process bill a different account, and they are not interchangeable.

```
 (A) per-account CONFIG DIRS                (B) POOL MODEL: injected token
 ───────────────────────────                ────────────────────────────────
 CLAUDE_CONFIG_DIR=~/.claude-b              CLAUDE_CONFIG_DIR stays ~/.claude
                                            CLAUDE_CODE_OAUTH_TOKEN=<account b>

 moves: login, settings, plugins,           moves: the billing credential, and
        MCP auth, TRANSCRIPTS, MEMORY               nothing else

 usage cache: naturally per account         usage cache: one shared slot,
                                                         last writer wins
```

**We take (B), the pool model**, for a reason specific to this box rather than to the doc's
recommendation: the config dir owns `projects/`, and `projects/` owns **the auto-memory every agent
here loads on every turn** (83 files for this repo) and **the transcripts `gjd-remote` reads back to
title a session**. Under (A), a session dispatched onto account B would start amnesiac, its
transcript would land somewhere the fleet does not look, and its MCP servers would need
re-authorising. Under (B), all of that is untouched and only the bill moves.

The price of (B) is measurement 3 — the usage cache becomes a shared slot — and
[Stage 4](#stage-3-usage-read-per-account) is how we pay it.

**Config dirs still appear, in one narrow role.** Per the doc, each account is signed in *twice on
purpose*: an `auth login` into its own config dir, which is what lets us read that account's quota
and assert its identity, and a `setup-token`, which is the credential the fleet actually spends. The
config dir is a reading instrument here, not where sessions run.

### The simpler option we passed over

**Do nothing in code; let Greg export a token in a tmux pane by hand.** That genuinely works, and for
one extra account it might have been enough. It was rejected because the failure is silent: nothing
would record *which* account a session was on, `run-claude.ts` deliberately strips
`CLAUDE_CODE_OAUTH_TOKEN` from children so dispatched agents would drift back onto the orchestrator's
account with nothing looking wrong, and the Overseer would still be rationing against one account's
numbers while three were in play. The registry exists so that "which account is this session
spending?" has an answer that is written down rather than remembered.

## Policy this plan assumes (Overseer's reading, pending Greg)

- The Overseer keeps `greg@rehearsable.ai` as the **orchestrator** account. Dispatched sessions draw
  from the pool and never from it — MindstoneRebel's asymmetric rule, so a runaway agent cannot
  stall the thing that would notice.
- ~~**A session Greg starts by hand with no `--account` keeps today's behaviour.**~~
  **Overturned by Greg, 2026-09-09 ~21:10Z**, and it is his decision rather than an inference:

  > Can we tweak the new-claude (and new-codex command in future) to use `--account auto` by default?

  **So an unflagged `new-claude` means `--account auto`.** That is a better default than the one this
  plan assumed: spreading load is the entire point, and a flag nobody remembers to pass spreads
  nothing. `new-codex` gets the same default when it exists.

  **What makes it safe rather than surprising** — `auto` must degrade to today's behaviour instead of
  refusing:

  - **no registry file, or no pool accounts → the ambient account**, exactly as today, with one line
    saying so. A box that has never set any of this up keeps working untouched. This *replaces* the
    earlier rule that `auto` refuses when there is nothing to choose from — that rule was written
    when `auto` was opt-in, and as a default it would have broken every unflagged launch on a fresh
    box.
  - **with pool accounts → it chooses, and prints which and why.**
  - **`--account main`** (the orchestrator's registry name) is the explicit way to ask for the
    ambient account.
  - **a guard failure still refuses** — a missing state dir or an identity mismatch is a fault, not
    an absence, and must never fall through to ambient.
  - **the resolved account is recorded, never the word `auto`**, in both the launch log and the tmux
    variable — otherwise the durable record says "we asked for whatever" rather than what was spent.

  `dispatch.ts` and `routes-new.ts` therefore need no flag, but **pass `--account auto` explicitly
  anyway**, so the record says what was asked for rather than relying on a default that might change.
- **Whether one person may hold several Max subscriptions is Greg's to confirm** with Anthropic's
  terms. Noted once here; not litigated, and not a thing this plan can settle.

## What is already built, and it is more than expected

The map below was made before designing, and it moved three stages from "write" to "wire up".

- **`collectUsage()` already takes a path.** `CollectUsageOptions.claudeJsonPath` and `projectsDir`
  (`tools/overseer/usage.ts:1118`) both default to the home directory but are parameters. Reading a
  second account is a **loop over paths**, not a rewrite.
- **`accountUuid` is already plumbed end to end** — `UsageAccount`, `UsageCacheReading`,
  `CacheObservation`, `UsageHistoryLine.pass.accountUuid` — and `usage-carry.ts` already has
  `sameAccount()`. `attributeCache()` already refuses to join a cache to an account unless both
  carry the same non-null uuid *and* the cache was fetched after the thing it judges.
- **The history file needs no format change.**
  [usage-history.md](../project/usage-history.md#multiple-accounts) says it outright: *"Every line
  carries `accountUuid` and the reader groups by it, so a second account produces a second series
  with no format change. That much is already done."* `tests/fleet-usage-history-series.test.ts:104`
  already asserts a line is plotted **per account and window**.

So the genuinely new code is: the registry, the launcher's choice, a collector loop, and the tab's
per-account layout. Everything underneath already expected more than one account.

> **Two of those four claims were overstated, and Sol's review caught both.** Verified against the
> source afterwards, so this correction is measured rather than conceded:
>
> - **"a loop over paths" is wrong.** `collectUsage` parameterises the *cache path*, but its identity
>   probe does not: `runAuthStatus()` (`usage.ts:1313`) takes **no arguments at all** and shells out
>   to an ambient `claude auth status`. So every account in the loop would be labelled with whoever
>   the ambient login is. The probe has to become per-account before the loop means anything.
> - **"`accountUuid` plumbed end to end" is true of the JSONL and not of the plumbing.** The wire
>   `UsageReport` is singular (`wire.ts:544`), the daemon runs one Claude collector
>   (`overseer.ts:112`), and one history call writes one Claude observation
>   (`usage-history-from-report.ts:219`). Collection, current-report, retention and checkpoint all
>   have to become plural. The *file format* genuinely needs no change; that was the narrow claim,
>   and only it survives.
>
> The cost of leaving this uncorrected would have been a Stage 3 that looked like a loop and turned
> out to be a redesign.

**And one sentence in that doc is now out of date, which is ours to fix.** It says *"a second
account needs a collector that can see both. `collectUsage` reads one `~/.claude.json`;
`CLAUDE_CONFIG_DIR` isolation is plausible and **untested**."* Measurement 1 above is that test.
Stage 3 replaces the sentence with what was measured.

## Round 1 review: GPT Sol, 2026-09-09 — three P0s, and the plan was restructured

Sol's verdict: *"I would not build Stages 1-3 as written… the plan has the right safety instincts,
but its core currently depends on two observations it does not possess — token identity and
attributable current usage. Resolve those experimentally before choosing the pool architecture."*

That is accepted. Every structural claim below was re-checked against the source before accepting it;
the review earned high weight by being right about things that were checkable.

**P0-1 — the shared usage cache can be *falsely* attributed, not merely stale.** Reading the
installed binary, Sol found the cache writer takes `accountUuid` from **config state**
(`oauthAccount.accountUuid`), not from the usage response. If that holds at runtime, a pool account's
usage can be written under the *shared config dir's* account — pool B's spend recorded as account A.
And **`attributeCache()` cannot catch it**: it compares the cache uuid against the same config's
`oauthAccount` uuid, so two consistently-wrong labels agree with each other and pass. My Stage 3
treated the worst case as *stale*; it is *wrong*, which is a different and much more expensive thing.
This is the "a check can answer a weaker question" shape, and it would have shipped.

**P0-2 — the fleet would not actually have spread.** The plan said an unflagged command keeps
today's behaviour. But **the unattended launchers are unflagged**: `dispatch.ts:126` builds
`["new-claude", name, "--no-attach", "-p", "-"]` and `routes-new.ts`'s `newClaudeArgs` likewise —
neither names an account. Verified in the source. So the feature would have appeared installed while
every dispatched session went on spending the orchestrator's account. **Every unattended launcher
must pass `--account auto` explicitly**; only a human's unflagged CLI launch keeps the ambient
account.

Two consequences Sol drew that I had missed: `gjd-remote` is often invoked **from Greg's Mac** while
the registry and tokens are on the box, so **the account must be chosen on the target box**, not in
the calling process; and a caller-local launch log therefore cannot tell the dashboard which account
a live session is on. The account goes into **tmux session metadata** beside `CLAUDE_SESSION_ID`
(`gjd-remote.ts:2728`), with the log as a record rather than the source.

**P0-3 — the weak branch of the Stage 2 assertion proves too little.** Sol *measured* this with an
injected token on the box: `auth status --json` returned `authMethod: "oauth_token"` and **no email,
no uuid, no org, no subscription type**. So the plan's strong branch is not available for token-based
accounts at all, and the weak branch (`authMethod !== "claude.ai"`) cannot tell pool1 from pool2 —
only that *some* non-login credential won. The two-branch design as written is dead.

What replaces it: build a **controlled environment containing exactly one credential** — Sol also
noted, correctly, that `claudeEnv(…, 'env')` forwards all three credential variables
(`run-claude.ts:402`), so `--account` cannot reuse `--auth env` wholesale as the plan claimed — then
require `loggedIn && authMethod === "oauth_token" && apiProvider === "firstParty"`. That proves no
other credential outranked the one we injected, which is the property that actually matters. **Which
account** the token belongs to is pinned once, at registration, and stored as a uuid in the registry.
If identity cannot be established, refuse; the weaker branch is not retained.

**P1s accepted:** `auto` needs an on-box **lock and reservation** (the launch log is not one — two
concurrent launches can both pick pool1 before either appends), and eligibility must exclude accounts
with an active five-hour limit or a recent attributable 429 rather than only ranking by seven-day.
Token storage "protects against accidents, not agents" — every agent runs as `greg`, so 0600 and
`/proc/<pid>/environ` are not a boundary between them; and the plan's `export` would have **persisted
into the `exec bash -l` shell** that `new-claude` leaves running after Claude exits, which is a
concrete bug: scope the variable to the command instead. The transcript scan must run **once**, not
per account, and an unlabelled 429 stays globally unassigned rather than being attributed to every
account.

**One P1 is a design idea worth more than the criticisms** — a third mechanism the plan never
considered: **per-account config dirs with only `projects/` shared**, by symlink or bind mount.

```
~/.claude-pool1/projects  ->  /home/greg/.claude/projects
~/.claude-pool2/projects  ->  /home/greg/.claude/projects
```

If that works, it keeps the transcripts and auto-memory that drove us to the pool model *and* gives
each account a naturally-correct usage cache — which dissolves P0-1 entirely rather than working
around it. Unmeasured, so not yet a recommendation; it is the first thing Stage 0 tries.

**Disputed, and referred rather than absorbed:** Sol's closing policy note — that a tight
orchestrator account should stop orchestrator model calls rather than automatically pausing healthy
pool workers — is right, but it is a change to
[overseer.md](../project/overseer.md#4-never-spend-what-you-are-rationing-and-the-budget-is-global)'s
gate 4, which is the Overseer's doc and not this plan's to rewrite. Raised in the debrief.

## The stages

Each stage ends in a GPT Sol review (`--sandbox workspace-write`, per the house rule since
2026-09-09), the fast gates, and a commit. Codex implements; this session manages and reviews.

### Stage 0 — the two measurements everything else is waiting on

**Nothing below Stage 0 should be built first, and that is the review's main structural finding.**
Three of the P0s reduce to the same thing: the plan chose an architecture on two facts it does not
have. Both need a second real account, so **Stage 0 begins when Greg has run the checklist**.

1. **Does sharing `projects/` across per-account config dirs work?** Symlink or bind mount, then
   check: auto-memory loads, transcripts write and `--resume` finds them, `gjd-remote`'s title
   lookup still works, two accounts writing concurrently do not corrupt anything, and each config
   dir's usage cache is correctly its own. **If it works, take it** — it is simpler than the pool
   model and it removes P0-1. If it fails, record why, and keep the pool model plus a live usage
   read.
2. **What does the shared cache actually do** under an injected token — write the token's uuid, write
   the config dir's uuid, or not write at all? The third is dangerous, the second is dangerous, the
   first is merely limited. This decides whether the shared slot may be read at all.
3. **Does `/api/oauth/profile` answer for a `setup-token` credential** (scope `user:inference`)? It
   is what the binary itself uses, and it is the only candidate for pinning a token to an account —
   which is what closes the checklist's step-4/step-6 gap. Sol could not test it; the review
   environment could not resolve `api.anthropic.com`.

**On calling `/api/oauth/usage` and `/api/oauth/profile` directly**, which is Sol's proposed fix for
P0-1: it is metadata rather than a model call, so gate 4 is satisfied, and the shipped binary already
depends on both. But it is an **undocumented endpoint**, which is a real departure from *prefer
boring* — an upgrade could move it, and nothing would tell us but a reading going quiet. So it is
**second choice, behind the `projects/`-sharing spike**, and if we do take it, the failure mode must
be *unknown*, never a fall back to the shared cache. Named here so it is a decision rather than a
drift.

Stage 0 is a spike: throwaway code, findings written up, **no production code lands from it**.

#### Stage 0 part-done: what the `projects/`-sharing spike already showed

Run on the box 2026-09-09 **without a second account**, by giving a second config dir a copy of the
existing credential and a symlinked `projects/`. The identity half still needs Greg; the *mechanism*
half did not, and it was worth doing early because it partly contradicts the hope that motivated it.

**What works.** A config dir with `projects/` symlinked to the shared one is fully usable: `claude -p`
ran under it and **its transcript landed in the shared directory** (2 files → 3), so `--resume`,
`gjd-remote`'s title lookup and the auto-memory all keep pointing at one place. That is the part
Sol's idea needed, and it holds.

**What does not follow.** The hope was that each config dir would then carry *its own* usage cache,
dissolving P0-1. **It did not appear.** After a completed session under the spike dir, that dir had
`oauthAccount` populated but **no `cachedUsageUtilization` at all**. So a config dir does **not**
reliably acquire a usage reading merely because work happened under it — at least not from a short
non-interactive run. Until that is understood, *"each account's dir has its own clean slot"* is an
assumption, not a mechanism, and Stage 0 must still answer it with a real second account and a real
session.

**A third finding, which sharpens P0-3 from a different direction.** A config dir holding a valid
credential but no `.claude.json` reports `loggedIn: true`, `authMethod: "claude.ai"`,
`subscriptionType: "max"` — and **`email: null, orgId: null, orgName: null`**. Identity therefore
comes from **config state, not from the credential**. So even the *strong* branch of the Stage 2
assertion proves "this directory was logged into by X", never "this credential belongs to X". It
also independently corroborates Sol's reading of the binary in P0-1, from the outside: the account
label and the credential are separate things throughout.

**Do not read the confounded part as evidence.** The *default* dir's cache did refresh during the
spike (82% → 85%), but a dozen other sessions were live on the box, so nothing here distinguishes
"my spike session wrote it" from "the fleet did". It is recorded as unattributable rather than
reported as a result.

#### Stage 0 complete — run against the real second account, 2026-09-09

`greg@mindstone.com` exists (`/home/greg/.claude-gregmindstone`, account uuid `894bf540…`, org
`68f57dc0…`, max, `default_claude_max_20x`). Every reading below is stated with its account and the
time it was taken.

**1. The new account works.** `claude -p` under its config dir returned `MINDSTONE_OK`, exit 0. A
second run with the repo as cwd and `--permission-mode auto` also worked.

**2. Nothing cheap writes `cachedUsageUtilization` — reproduced three times.** A short `-p`, a real
interactive `tmux` session, and a repo-cwd run all completed without the dir's cache slot ever being
created. It is still `null`. Transcripts *were* written and `oauthAccount` *was* populated, so the
sessions genuinely ran. **The per-dir cache is therefore not a usable per-account instrument**, and
the assumption behind both the pool model and the `projects/`-sharing idea is dead in its cheap form.

**3. The endpoints answer, and they dissolve both P0s.** With the config dir's own credential read
in-process and never printed:

| | `greg@mindstone.com` | `greg@rehearsable.ai` |
|---|---|---|
| `/api/oauth/usage` five-hour | **0%** | **9%** |
| `/api/oauth/usage` seven-day | **3%** | **85%** |
| `/api/oauth/profile` | `uuid 894bf540…`, `email greg@mindstone.com` | `uuid eddd4c75…`, `email greg@rehearsable.ai` |

- **P0-1 (false attribution) is gone.** The reading is attributed *by construction* — you asked with
  that account's credential — so there is no shared slot to misattribute and no uuid to second-guess.
- **P0-3 (a credential has no identity) is gone.** `/api/oauth/profile` returns the account uuid and
  email for a credential, which is exactly the pin the checklist's step-4/step-6 gap needed.
- **The response shape is the one `parseUsageCache` already parses** — `five_hour`, `seven_day`, the
  rotating codename windows, `extra_usage`. It slots into the existing machinery rather than
  replacing it.

**4. An independent measurement that could have contradicted the cache, and did not.** The live probe
for `greg@rehearsable.ai` returned seven-day **85%**; its cache, fetched 20:27:16Z, says **85%** under
the same uuid (five-hour 9% live against 8% cached, the live one being fresher). Two joins that could
disagree, agreeing. That is why the live reading can be trusted as a replacement rather than merely
preferred.

**5. Sharing `projects/` works under a real second account.** A throwaway copy of the mindstone dir
with `projects/` symlinked to the shared tree ran a repo session on the mindstone account and its
transcript landed in the shared directory. The default dir's slot was **not** touched (still
20:27:16Z, still the rehearsable uuid) — no cross-contamination. Cleaned up afterwards; the real
`~/.claude-gregmindstone` was never symlinked into, as instructed.

##### The hazard this turned up: the credential expires in hours, and must never be refreshed by us

`claudeAiOauth.expiresAt` for `greg@rehearsable.ai` was **21:00:04Z — about fifteen minutes after the
probe**. Mindstone's had roughly eight hours left. So a collector reading `.credentials.json` directly
will meet an expired token routinely.

**The collector must treat a 401 as `unknown` and stop there.** It must **never** use the refresh
token: refreshing rotates the credential, and a collector racing live sessions for that rotation
could invalidate Greg's login on an account the whole fleet is using. Under the config-dir model this
is self-correcting — an account being worked has its token refreshed by its own sessions — and the
gap is an idle account, where the reading goes unknown exactly when we would like to confirm it is
free. Stated rather than solved: *unknown* is the correct answer there, and gate 4's rule is that a
reading we cannot make is never a percentage.

##### The seeding list, which is the config-dir model's price

What a fresh per-account dir lacks, compared with `/home/greg/.claude`, and whether a dispatched
session needs it:

| Missing | Needed? |
|---|---|
| `mcpServers` — `playwright`, `chrome-devtools` only | **Yes**, and only these two. See below. |
| `mcpServers` — `sentry`, `vercel` | **No — deliberately left out.** See below. |
| `settings.json`: `model`, `permissions`, `autoMode`, `env` | **Yes** — `permissions` and `autoMode` especially; a fresh dir has a different safety posture and no auto-mode environment. |
| `settings.json`: `theme`, `tui`, `statusLine`, `agentPushNotifEnabled` | No — cosmetic. |
| `projects[<repo>].hasTrustDialogAccepted` (4 of 5 entries carry it) | **Yes**, or a session can stop on the trust dialog. |
| `projects/<slug>/memory/` — 83 files for this repo | **Yes** — this is what the `projects/` symlink is for. |
| `plugins/` | Probably — plugin-provided skills otherwise vanish. |
| `hasCompletedOnboarding` and the few flags a first-run flow actually checks | **Yes** — but see the correction below; "~45 flags" was wrong. |

**This is a script, not a manual step**, and it is Stage 1's job. Seed *surgically* — merge the named
keys after the login, never copy `.claude.json` wholesale, because it also carries identity,
eligibility caches and live-session metadata.

##### MCP: configured is not working, so two servers are deliberately not seeded

**Copying `mcpServers` does not make MCP usable.** The server *definitions* live in `.claude.json`,
but their **OAuth credentials live separately in `.credentials.json`** — so a seeded pool dir would
list `sentry` and `vercel` and fail to use them. That is the configured-and-unusable shape, which
reads as working right up until someone needs it.

The Overseer's decision, 2026-09-09, pending Greg:

- **seed only the credential-free servers** — `playwright` and `chrome-devtools`, which is what
  browser testing needs and is the common case for a dispatched agent;
- **leave `sentry` and `vercel` out entirely** rather than present and broken. Absent is honest;
  configured-and-unusable is a trap.
- **never copy MCP refresh credentials between dirs** — they rotate, and duplicating a rotating
  credential invites the same class of problem as refreshing an OAuth token behind Claude's back.
- **the wizard prints one line** saying those two need a `/mcp` login by Greg, under that dir, if a
  pool session is ever to use them.
- **Today's answer for a pool session that needs Sentry or Vercel**: say so in its debrief, and the
  Overseer routes that read to a session on `main`.

##### Two corrections to this list, from Sol's round-2 review

- **The `permissions` worry was overstated.** The user-level settings only add
  `permissions.defaultMode`; the real ask/deny rules are repo-local, and `gjd-remote` passes
  `--permission-mode auto` explicitly. **A fresh dir does not widen what a dispatched agent may do.**
  It does change interactive defaults, and future user-level rules would matter, so it stays on the
  seed list — but not for the reason first given.
- **"~45 first-run flags" was unsupported.** Mindstone has already run sessions without most of them.
  Many are experiment, eligibility, version or account caches that should *not* be copied. Seed only
  the few a first-run flow actually checks.
- **Do not copy `settings.json`'s `env` wholesale.** A future credential or provider variable sitting
  there could defeat account routing entirely. Use a named allowlist.

##### What `projects/` sharing does not cover

`file-history/` and `shell-snapshots/` live **outside** `projects/`, so a conversation resumed under
a different account keeps its transcript but loses rewind and checkpoint history. **Pin a resume to
its original account** unless that is separately tested. Plugin manifests also contain absolute
paths, so copying `plugins/` is not by itself a complete installation.

#### The mechanism decision: the config-dir model

**Take the config-dir model** — one `auth login` per account in its own dir, the launcher exporting
`CLAUDE_CONFIG_DIR`, `projects/` shared by symlink, and usage read live from `/api/oauth/usage`.

Why it wins now that the measurements are in:

- **It needs nothing more from Greg.** No `setup-token`, no second browser flow per account — the
  login he has already done is the whole of it. That also removes a step the checklist could not
  verify.
- **Both P0s are gone by construction**, not worked around: no account ever writes another account's
  dir, and every reading is attributed by the credential that asked for it.
- **Its one real cost — the seeding list — is a script**, and the measurements above enumerate it.
- The pool model's remaining advantage was a shared config dir, and `projects/`-sharing gets the part
  of that we actually needed (memory and transcripts) while keeping caches and credentials separate.

**The one departure from *prefer boring* to declare out loud:** `/api/oauth/usage` and
`/api/oauth/profile` are **undocumented endpoints**. The shipped CLI depends on both, and they are
metadata rather than model calls, so gate 4 is satisfied. But an upgrade could move them, and the
failure would be silent. The mitigations: every failure is *unknown* and never a fallback to another
account's number; the cache stays a corroborating second source where it exists (finding 4 shows the
two agree); and `usage-history.md`'s "absence is never a zero" already covers what to draw.

### Stage 1 — the wizard Greg runs, and the account registry

> **Rewritten 2026-09-09** after Greg ran the checklist by hand and found it fiddly. The registry is
> unchanged; the `add` command became the thing he actually uses.

Greg, 2026-09-09:

> It was a bit fiddly to add the new accounts, and I think I might have missed some steps. Can you
> write a CLI script that I can call, that asks me questions, and then does everything for me. It
> should be idempotent (i.e. if I run it twice for the same account, it just updates as needed).

**`npx tsx scripts/claude-accounts.ts add`**, no flags, asks its way through: the name and email
(offering defaults from what already exists), creates the dir and its `forceLoginMethod` settings if
missing, signs in **only if** the account is not already signed in, seeds the dir from the list
measured in Stage 0, pins identity through `/api/oauth/profile`, writes or updates the registry
entry, and ends by printing `list`.

**Every question is also a flag** — `--name`, `--email`, `--role`, `--config-dir`, `--yes` — so the
web UI and the tests drive *the same code path* non-interactively. That is the design constraint that
stops Stage 5 becoming a second implementation of this.

#### What "idempotent" has to mean, state by state

A second run must be safe, and "safe" is different for each thing it touches. This is the part most
likely to go wrong silently, so it is enumerated rather than asserted:

| State | A second run must… |
|---|---|
| the config dir | create if absent; **never** delete or recreate |
| `settings.json` | **merge** the keys we own, preserving hand edits; never overwrite the file |
| the login | **skip entirely** if `auth status` already names the expected email — a re-login rotates a credential live sessions may be using |
| `projects/` symlink | create only if absent; **refuse loudly if a real directory is there**, never replace it |
| seeded `.claude.json` keys | merge named keys only; never copy the file wholesale (it carries identity, eligibility caches and live-session state) |
| the registry entry | update in place, preserving fields it did not write |

**The test that matters is the one already available**: running the wizard against
`~/.claude-gregmindstone`, where Greg has done the login and skipped the token steps. It must find the
login present, seed only what is missing, register the account, and change nothing else. That is a
real before/after, not a fixture, and it goes to Sol as such.

**Nothing may be a no-op that reports success.** Each step prints what it *found* and what it
*changed* — `already signed in as greg@mindstone.com, skipping login` rather than `✓ login`. This
repo has a documented failure class of exactly that shape
([silent-success.md](../reusable/silent-success.md)), and a wizard whose whole value is "you can
re-run it" is the worst possible place for it.

**I do not run the login step.** It is interactive, it is Greg's credential, and a wrong move rotates
a live one. The login branch is tested with a fake `claude` on `PATH`; the real run is his.

#### Designed so the Codex version is not a rewrite

Codex accounts are next (queued as `qi-whppvck5`, Greg: *"we're going to want to do all the same
stuff for Codex account-subscriptions too, as HIGH-BUT-NOT-TOP-priority"*), and they are the same
shape with different verbs: `CODEX_HOME` instead of `CLAUDE_CONFIG_DIR`, `codex login` instead of
`claude auth login`, and verification through the app-server `account/rateLimits` read that
`scripts/overseer.ts usage` already performs.

So the seams that must be **per-family from the start**, rather than Claude details leaking into
shared code: where an account's state lives (a dir path, but not necessarily named the same),
how to ask *who is signed in here*, how to *sign in*, how to read *usage*, and what counts as
seeded. One registry with the `family` column, one wizard with a family question, and those five
operations behind a per-family interface. Nothing Codex-specific is built now.

**Why the registry first:** it is the one new concept everything else reads, and Stage 0 has already
established what goes in it.

#### The orchestrator account cannot be registered, and that is accepted for now

**Discovered by registering a real account, 2026-09-10.** `add` requires `--config-dir`, but the
orchestrator/ambient account is precisely *"no `CLAUDE_CONFIG_DIR`"* — and pointing one at
`/home/greg/.claude` is **actively wrong**, not merely redundant: the CLI then looks for
`.claude.json` *inside* the directory, where the default account's does not live, and the session
gets no identity, no user-level MCP servers, no trust flags and no first-run state.

The launcher already handles ambient correctly — `stateDir: null` emits no `env` prefix at all, just
plain `claude` — so the gap is only that `add` cannot express it.

**Accepted as is** (the Overseer, 2026-09-10): the registry holds pool accounts only, an unflagged
launch stays ambient, and `auto` picks from the pool. That is the wanted behaviour anyway, so
**`add --ambient` is not to be built unless the wizard turns out to need it.** Recorded here so the
next reader does not mistake the gap for an oversight, or "fix" it by registering `main` with a
`--config-dir` — which would be the one thing that actively breaks.

**Where it lives.** Outside the repo — credentials never go in git:

```
~/.claude-accounts/            0700
  registry.json                0600   who exists, and where their token is
  <name>.token                 0600   one long-lived token per pool account
```

**The token is in a separate file on purpose.** Putting it inline would make the registry itself a
secret, so nothing could print it, log it, or show it on a dashboard. Split, the registry is
describable in public and only the launcher ever opens a `.token`.

**One entry.** Generic fields first, family-specific detail quarantined in `familyData` — Sol's
round-2 P1, and it is right that `family` alone was not enough: `configDir`, a required `email` and
a global orchestrator role are all Claude-shaped assumptions a Codex entry cannot follow.

```jsonc
{ "name": "main",
  "family": "claude",                    // "claude" | "codex"
  "role": "orchestrator",                // "orchestrator" | "pool" — per family, not global
  "stateDir": "/home/greg/.claude",      // CLAUDE_CONFIG_DIR here; CODEX_HOME there
  "providerAccountId": "eddd4c75-…",     // the durable pin — see below
  "providerTenantId": "ba7a24b8-…",      // the org
  "displayEmail": "greg@rehearsable.ai", // for humans; never the thing asserted on
  "addedAt": "2026-09-09T…",
  "familyData": { } }
```

**There is no `tokenPath`, and there must never be one** — the config-dir model has no
`setup-token`. If you are reading a version of this plan that has one, it predates
[the mechanism decision](#the-mechanism-decision-the-config-dir-model).

**`providerAccountId` is the pin, and storing it is load-bearing** rather than decorative. Sol:
*"a config directory can later be logged into as another account. In that case `/usage` would
correctly answer for the new credential while the registry still labels it as the old account."* The
directory is not the identity. So the uuid and org are stored, and **re-checked at use time**, not
just at registration — an identity pinned once and never re-read is a pin that quietly comes loose.

**The invariant for every live read**, which is what actually closes P0-1 and P0-3:

- read the access token **once** into memory, and use that same snapshot for both `/profile` and
  `/usage` — otherwise the two answers can be about different credentials;
- fixed `https://api.anthropic.com` origin, **redirects rejected**, ambient/custom base URLs ignored;
- require account uuid, org uuid and email to match the registry **on every collection**;
- apply the strongest available equivalent immediately before every paid launch.

Sol's honest caveat, kept because it is the limit of what we know: *"I cannot prove the undocumented
endpoint's server-side tenancy contract; the two-account result and matching cache are strong
evidence, not a published guarantee."* And `/usage` carries no identity of its own, so `/profile` is
load-bearing.

**Note what falls out: the orchestrator's entry describes what already exists.** Registering account
1 requires no login at all — its config dir is the default one and its credential is the ambient
login. So the registry starts by *describing* today's box rather than changing it, which is the
cheapest possible first state and makes "no accounts registered" and "one account registered"
behave identically.

**The reader** (`tools/overseer/accounts.ts`, new, pure-parse + one I/O function, matching
`usage.ts`'s split):

- validates on read; each of these is **an error, never a skipped line**: an unknown `role`,
  `family` or `schema`; a duplicate `name`; a relative `stateDir` or one with a trailing slash; a
  missing required field; a duplicate `stateDir` or `providerAccountId` across two entries;
- **never falls back to the default account** on any failure — the loud-failure rule this whole
  design rests on;
- exactly one entry may be `role: "orchestrator"` **per family** — the orchestrator invariant is per
  family, not global, so a Codex orchestrator can coexist with the Claude one;
- a missing registry file is *not* an error: it means "one account, the ambient login", i.e. today.

**What is checked when.** Reading the registry is a file parse, so it cannot check an email — that
needs a subprocess. The split is deliberate and stated in the code: **shape at read time, identity
at use time** (Stage 2's assertion, and the Stage 1 CLI below).

**`npx tsx scripts/claude-accounts.ts`** — `list` (every entry, and `claude auth status --json` under
each config dir, so one command answers "who is signed in where"), `check` (the assertion for all of
them; non-zero if any fails), `add` (writes an entry after the assertion passes — never before).

**Tests, red first:** a fixture registry directory under `tests/fixtures/`; every rejection above
gets its own red test; `add` refuses when the assertion fails; a missing file yields the
one-ambient-account reading rather than an error.

### Stage 2 — the launcher picks an account

> **Rewritten 2026-09-09** after the mechanism decision. The previous version injected
> `CLAUDE_CODE_OAUTH_TOKEN` and reused `--auth env`; that was the pool model and it is gone. Sol's
> round-2 P0-1 was that this section would have had an implementer rebuild the discarded design.

`--account <name>` and `--account auto`, and **`auto` is the default** — Greg, 2026-09-09 ~21:10Z,
see [the policy section](#policy-this-plan-assumes-overseers-reading-pending-greg). An unflagged
`new-claude` spreads load; `--account main` is how you ask for the ambient account explicitly.

**Because it is the default, `auto` may not refuse for want of choice.** No registry, or no pool
accounts, resolves to the ambient account with one line saying so — today's behaviour, on a box that
has set none of this up. A *guard* failure still refuses: an absence is not a fault.

#### The environment is process-scoped, never exported

```bash
env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL … \
    CLAUDE_CONFIG_DIR=/home/greg/.claude-<name> \
    claude …
```

**Not `export`.** `new-claude`'s job script ends `exec bash -l`, so an exported variable persists
into the login shell left behind after Claude exits, and anything a person then runs in that pane
silently bills the pool account. Sol caught this in both rounds; it is a one-word difference with a
wrong-account failure behind it.

**And the `ANTHROPIC_*` unset list is part of the guarantee, not tidiness.** An inherited
credential or provider variable outranks the selected config dir — that ladder is already documented
in `run-claude.ts`'s own header — so a routed launch that does not clear them is a preference, not a
pin.

#### `scripts/run-claude.ts` has a hole that this stage must close

`claudeEnv()` **deliberately strips `CLAUDE_CONFIG_DIR`** from the child environment
(`run-claude.ts:395`). That was right when the variable was one person's terminal preference. Under
this design it means **a session running on pool account B that shells out to `run-claude.ts` gets a
child on the ambient account** — the orchestrator's, the 85% one — with nothing looking wrong.

So `run-claude.ts` takes `--account <name>` too, resolving the registry itself and constructing the
child environment explicitly. It must not inherit the parent's routing by accident, and it must not
silently drop it either: **an unrouted child of a routed parent is a refusal**, not a fallback.

#### The guards, which refuse rather than fall back

In the generated job script, before `claude` runs, in the style of the existing `cd` and
`command -v claude` guards — both of which exist because a session that starts in a wrong state and
*looks* fine is this file's recurring failure:

1. the state dir exists and its `projects` link resolves to the shared tree;
2. `/api/oauth/profile`, using the dir's own credential, returns the **account uuid and org** the
   registry recorded — not merely an email, and not merely "logged in";
3. no competing `ANTHROPIC_*` credential or provider variable survives into the child.

Any failure is `FATAL`, no session, via the existing `failTo` mechanism. **None of them may fall
back to the ambient account** — that is the entire point of the stage.

Sol's fuller refusal list, adopted: missing or invalid registry for explicit *or* auto routing;
unknown name; wrong family or role; duplicate canonical state dir or provider uuid; missing
credentials; profile mismatch; wrong or dangling `projects` link; non-first-party effective auth;
and inability to reserve on the target box.

**One honest gap, named rather than discovered:** a `--wait` launch checks identity now and starts
Claude hours later, so the check can be stale by the time it spends anything. The guards run inside
the job script, after the wait, for exactly this reason.

#### Recording which account a session is on

**Not the launch log alone.** `appendLog()` writes under the *invoking* machine's home
(`gjd-remote.ts:1926`), which is often Greg's Mac — so it can neither drive on-box selection nor
tell the dashboard anything. The account goes into **versioned tmux metadata** beside
`CLAUDE_SESSION_ID` (family, account name, provider uuid), with the log as a secondary record.
Existing v1 metadata keeps being accepted.

#### `--account auto`

Among **pool** accounts of the right family, never the orchestrator. Lowest live seven-day
utilisation from `/api/oauth/usage`; **`unknown` sorts last and is never treated as 0%**; ties break
by least-recently-*reserved*. With no eligible pool account it resolves to the **ambient account**
and says so — see the default rule above.

**A lock alone is not enough, and this is subtle.** Sol: *"A lock that merely serializes 'read
lowest usage' still sends simultaneous launches to the same account because the usage reading has not
changed."* Two launches a second apart both read mindstone at 3% and both go there. So under the
lock we **write a reservation on the box** — account uuid, session uuid, created-at, outcome —
before releasing it. A failed launch records a failure rather than erasing the attempt.
Least-recently-reserved is concurrency-safe; a caller-local launch log is not.

**Starvation, which the first design had.** Choosing purely by lowest known reading means an idle
account whose reading is `unknown` is never chosen, so it never becomes known. Active/reserved load
and recency are part of normal ranking, not just a tie-break.

#### The call sites, which were the whole point

`tools/overseer/dispatch.ts:126` and `tools/fleet/routes-new.ts:422` build `new-claude` argv with no
account. **Both pass `--account auto`.** Without this the feature is a no-op that looks installed —
Sol's round-1 P0-2, and the Overseer has authorised the change.

### Stage 3 — usage read per account

> **Rewritten 2026-09-09** after Stage 0 and Sol's round-2 review. The previous version looped over
> per-dir caches under the pool model. Both the source and the data model changed.

The reading comes from **`/api/oauth/usage`, live, per account**, with identity from `/profile` on
the same token snapshot. The per-dir cache is **diagnostic only**.

#### A correction to this plan's own evidence

Stage 0's finding 4 said the live rehearsable reading (85%) agreeing with its cache (85%) was *"two
joins that could disagree, agreeing"*. **That was overstated, and Sol was right to say so:** the
cache is itself populated from `/api/oauth/usage`, so the two are the same source at two moments,
not two independent instruments. The agreement shows the endpoint is self-consistent and that our
parsing matches the CLI's. It is **not** corroboration that would survive the endpoint changing, and
it cannot be used as a fallback when the endpoint fails. Recorded rather than quietly dropped,
because the original claim is in this document and someone will read it.

#### It does not "slot into" the existing parser

Another overstatement of mine, corrected. `parseUsageCache` expects the `.claude.json` envelope —
`cachedUsageUtilization` wrapping `fetchedAtMs`, `accountUuid` and `utilization`. **`/api/oauth/usage`
returns the inner utilization object only.** So:

- **`parseUsageWindow()` is directly reusable** — including its rule that an expired window yields a
  reading with *no percentage field at all*;
- a new **`parseLiveUsageResponse()`** supplies the envelope: observation time from our own clock,
  identity from the same-token `/profile` result;
- **an empty body `{}` is `unknown`, never a successful empty reading**, and the parser requires
  recognisable expected windows.

#### The data model has to become plural, and that is not a loop

Sol's round-2 P0-3, verified: `UsageReport` is singular (`wire.ts:544`), the daemon runs one pass
(`daemon.ts:313`), the composition root has one Claude collector (`overseer.ts:111`), and one
account is projected into each history line (`usage-history-from-report.ts:219`).

**Writing alternating existing-format lines for A then B does not work**, and this is the trap worth
knowing: the chart **cuts every series absent from the current record**
(`usage-history-series.ts:152`), so an A/B/A/B sequence renders as disconnected points rather than
two lines. One record must carry *all* accounts.

```text
ClaudeUsageSnapshot
  accounts[]     profile + live usage + diagnostic cache, per account
  globalScan     the shared, unattributed transcript scan
  collectedAt
```

**The transcript scan runs once**, not per account. 2.9 GB, and an unlabelled 429 belongs to no
account: feeding the same rejection into `computeUsageVerdict` once per account would manufacture
evidence. Attributable 429s need a durable on-box *session uuid → account uuid* record — which
Stage 2's reservation ledger provides — and everything older or unmatched **stays global**. This is
already rule 4 of the eight in [usage-history.md](../project/usage-history.md): *rejections are never
attributed to an account*.

**The file set is therefore bigger than the earlier plan said**: history schema, wire types,
checkpoint parsing, daemon retention and carry, history projection, the reader and chart, the CLI
JSON, the UI, and their tests.

#### When the endpoint moves, we must find out — containment is not detection

`unknown` stops a wrong number being used. It does not tell anyone the readings have gone quiet, and
a fleet rationing against permanent `unknown` is a fleet flying blind. Sol's list, adopted:

- a strict parser with red tests for 401/403/404/429, timeout, invalid JSON, `{}` and a changed
  envelope;
- per-account last-success and consecutive-failure counts;
- **a loud correlated alarm when every account fails with the same non-401 error or schema
  mismatch** — that is the signature of an upgrade moving the endpoint, as against one account's
  token expiring;
- `claude-accounts check --live-usage`, non-zero on failure, to be run after every Claude upgrade;
- first-failure and periodic still-failing logs from the daemon.

The measurements were taken on 2.1.266; Sol confirms 2.1.267 still contains both paths.

#### The 401 policy, which needs a choice rather than a principle

Never refreshing the credential ourselves is settled. But *fail closed on a 401* has a consequence
worth stating: **an idle account's token expires, so its reading goes `unknown`, so `auto` never
picks it, so it stays idle.** Sol names the fork, and this plan takes the second arm:

- **(a)** refuse to launch on an account whose `/profile` 401s — safe, and idle accounts eventually
  become unusable;
- **(b)** permit the launch from the registered state dir using the **stored** account uuid and org
  plus the effective-auth checks, having first excluded every competing credential variable, and
  **record that the launch used the expired-token exception**. Claude's own refresh then happens on
  startup, and the next collection re-verifies against the server.

**(b), with the exception recorded**, because (a) makes the pool shrink to whichever accounts happen
to be busy — the opposite of the point. The weaker proof is explicit, logged, and re-checked
immediately afterwards rather than assumed.

A safe cheap improvement Sol suggests and we take: on a 401, **re-read `.credentials.json` once** in
case another Claude process has already replaced the token, and retry only then. Never consume the
refresh token.

#### Rationing

`overseer usage` prints one block per account. The Overseer reads the tightest **pool** account and
the orchestrator's separately — one budget per account, stated per account.

**A policy question that is not this plan's to settle**, raised in both reviews and referred to Greg
via the Overseer: gate 4 says supervisor model calls share a budget, but it does not follow that
exhausting the *orchestrator's* subscription should pause workers spending healthy *pool*
subscriptions. Sol's recommendation, and mine: reserve the orchestrator account, stop discretionary
orchestrator model calls when it is tight, and **do not** automatically pause healthy pool workers
unless their work demonstrably requires orchestrator spend.

### Stage 4 — Usage Limits: one section per account, and Add account

One section per Claude account, then Codex, **each laid out the same**: percentage used, when it
resets, the graph. The chart layer needs no change — it already plots per account and window.

**A pool account's reading is labelled for what it is.** Measurement 4 means the honest sentence is
*"as of the last session that ran on it"*, with the age — and that is what the tab says, rather than
a number smoothed into looking current. The Overseer's instruction, 2026-09-09, on being shown
measurement 3: *"if the honest per-account reading is 'as of the last session that ran on it', say so
on the tab rather than smoothing it."* It is also rule 1 of the eight in
[usage-history.md](../project/usage-history.md) — *absence is never a zero* — applied to a reading
that is present but old.

**The Add-account sub-mode shows commands; it does not run them.** Not a limitation to apologise
for, three reasons:

1. **It cannot do the OAuth** — that is a browser flow on Greg's laptop. Stated in the brief.
2. **The dashboard has no usage write path at all today**, and the write envelope that does exist
   for actions is off by default: `FLEET_ACT_ENABLED=1` plus an explicit `confirm: true`
   (`tools/fleet/routes-actions.ts:1230,1313`). Turning a credential-adjacent write on by default
   would be the loosest thing in this plan, on the surface the house standard is *strictest* about
   ([overseer-direction.md](../project/overseer-direction.md), the middle tier).
3. It is the simplest thing that works, and Greg has to be at a terminal for step 2 regardless.

So the sub-mode: shows the exact commands for the next account name, **watches for the new config
dir to appear and become signed in**, verifies the email by running the Stage 1 `check`, and then —
once the read-only assertion passes — offers the one-click *register it*. If the write envelope is
off, it shows `claude-accounts add <name>` and says why in one line rather than failing.

Greg's separate low-priority tidy (qi-3sr3jht6: *X% used* only, parallel Claude/Codex sections, minor
readings collapsed) is **folded in only where it falls out naturally** — the per-account section
layout is the same work — and not widened into.

**Superseded in part by [Stage 5](#stage-5-a-web-interface-that-drives-the-setup).** Greg asked for
the sub-mode to *drive* the setup rather than print commands, so the read-only version above is now
the fallback if the pty flow proves brittle — not the target. The per-account section layout is
unchanged and still belongs here.

### Stage 5 — a web interface that drives the setup

Greg, 2026-09-09, relayed by the Overseer, after the checklist above was sent to him:

> could we build a web interface to make that easier for me (to setup the new Claude
> account-subscriptions)?

So the Add-account sub-mode **drives the flow** rather than printing commands at him. It cannot
remove the sign-in — he still opens a URL and pastes one code, twice per account — but it can remove
the terminal, the paths, the `chmod`, and the chance of pasting a token into the wrong place.

**Measured first, before any of it was designed** — the Overseer asked for this and it was the right
call, because one of the two answers is a trap. Both run under a throwaway config dir on the box,
2026-09-09, 2.1.266, in a pty via `script -q -c`; neither login was completed and the probe directory
was deleted afterwards.

| | `claude auth login --claudeai --email X` | `claude setup-token` |
|---|---|---|
| headless in a pty | **works** | **works** |
| output shape | plain lines | **a full Ink TUI** — alternate screen, bracketed paste, mouse and kitty-keyboard modes |
| the URL | printed whole, twice (an OSC-8 hyperlink and a plain one) | **visible text wrapped across five 80-column chunks** |
| waits for input | yes — `Paste code here if prompted >`, blocking on stdin | same prompt, inside the TUI |
| OAuth scopes | `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload` | `user:inference` only |
| `--email` | lands in the URL as `login_hint=` | no equivalent flag |

**The trap, and it would have shipped.** `setup-token` wraps the *visible* URL across five lines, so
naive line-scraping yields a **truncated OAuth URL** — a link that looks fine and fails on click, for
a reason nobody would guess. The full URL survives intact in the **OSC-8 hyperlink target**
(`ESC ] 8 ; id=… ; <url> BEL`), repeated whole on every chunk. So the extractor parses OSC-8 and
falls back to reassembling the wrapped text, never the other way round — and a test feeds it the
captured five-chunk transcript from this measurement, so the wrapping case is red before it is green.

> **The `setup-token` column is now history, not a step.** The config-dir model dropped it, so the
> web flow drives **one** browser sign-in per account and never handles a token at all. The
> measurement is kept because it is the record of a real trap, and because it says something general
> the pty driver still needs: **a Claude TUI wraps its visible URL and only the OSC-8 target is
> whole.** If a future flow ever drives a TUI subcommand, that is the lesson.

**A real pty is still required** for `auth login` (`node-pty`, or `script` as the boring fallback),
though its output is line-oriented and far easier than the TUI above. This remains Stage 5 because it
is the least blocking work: **the registry, the launchers and per-account usage all land first**, and
the manual three-step sequence keeps working, so if the pty flow proves brittle we stop here having
lost nothing.

**Each step is its own state**, with its own failure text and a kill button: create dir → login (URL
shown, code taken from a form) → **verify identity via `/api/oauth/profile`** → seed → register.
A stuck step is killable; nothing advances on "could not tell".

**It is the wizard with a pty around one step, not a second implementation.** Stage 1's
`claude-accounts add` takes a flag for every question precisely so this route drives the same code
path. The only thing the web flow adds is the pty and the form that feeds the pasted code into it.

**No credential is ever rendered, logged or stored by this flow** — there is no token to store, and
the pty buffer for the login step is filtered before display. The test asserts nothing
credential-shaped reaches what is rendered, stored or logged, including raw pty buffers, exception
objects and captured test fixtures — Sol's note that "never logged" has to cover more than the
browser output.

#### Who may press it — this needs Greg's decision, and it is the reason this stage is last

**This route mints a credential.** The dashboard has no login and sits on loopback plus the tailnet,
so as it stands *anyone who can reach the port* could start an OAuth flow and add an account. That is
a materially bigger boundary than anything else on the page, which reads state and at most steers a
session.

The existing envelope for enacted actions is `FLEET_ACT_ENABLED=1` plus an explicit `confirm: true`
(`tools/fleet/routes-actions.ts:1230,1313`), off by default, and this stage adopts it. **The honest
statement of the boundary:** that gate makes the route *deliberate* — nobody trips it by accident,
and it is off unless the server was started for it — but it is **not authentication**. It does not
distinguish Greg from anyone else on the tailnet. The identity question 260909b left open is the same
one, and it is not this plan's to close.

**Options for Greg, plainly:**

- **(a) Ship it behind `FLEET_ACT_ENABLED`, as above.** Cheapest, matches every other write on the
  page. The boundary is "whoever is on the tailnet, when the flag is on".
- **(b) The same, plus a one-time secret** Greg pastes into the page, checked per request. Small,
  boring, and makes the boundary "whoever Greg gave the string to". Perhaps twenty lines.
- **(c) Leave it printing commands** (the original Stage 4 design) and skip the pty entirely.

**Recommendation: (b).** The gap between "deliberate" and "authenticated" is the whole difference for
a route that mints credentials, and (b) closes it for about the cost of the form it already needs.
This is a *needs Greg* item — recorded here rather than decided.

## File set

Mine: `tools/overseer/accounts.ts` (new), `tools/overseer/usage.ts`, `scripts/claude-accounts.ts`
(new), `scripts/run-claude.ts`, `scripts/gjd-remote.ts`, `scripts/overseer.ts` (the `usage` printer),
`docs/project/claude-accounts.md` (new, parent
[dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md)),
`docs/project/usage-history.md` (the one stale sentence), this plan, and their tests.

Stage 4 adds `tools/fleet/web/src/UsagePanel.tsx` and the six mode registers. Stage 5 adds a route
under `tools/fleet/` and the pty driver.

**Stages 4 and 5 are the ones to hand on if the window runs short.** Stages 1-3 are what make the
fleet able to spread across accounts at all; 4 and 5 make it pleasant. Greg can add accounts with the
checklist today, so neither is blocking.

**Not mine:** `tools/overseer/store.ts`'s `RegisterEntry` (the Overseer's persisted table),
`infra/`, anything Codex-account-specific, and the logging in itself.

## Greg's checklist — adding one Claude account

**Once the wizard lands this is one command**, `npx tsx scripts/claude-accounts.ts add`, and the rest
of this section is its specification rather than your instructions. Until then, here is the correct
manual sequence — **three steps, and no token**.

> **What changed, and why the earlier version would have wasted your time.** The first draft had you
> run `claude setup-token` and store a token file. **The design no longer uses tokens at all**, so
> those steps are not merely unnecessary, they are wrong — please don't run `setup-token`. The
> earlier version is kept below the line as a record of what was corrected.

**Do this on the box, in a tmux pane you can type into.** One browser sign-in per account: the box
prints a URL, you open it on your laptop **in a private window** (otherwise you re-authorise the
account you are already signed into), and paste the code back.

```bash
ACCT=pool2
EMAIL='you@example.com'      # the NEW account's email, in quotes
```

**1. Make its directory**, refusing rather than overwriting if it is already there:

```bash
test -e "/home/greg/.claude-$ACCT" && echo "already exists — stop, and use the wizard to update it" || {
  mkdir -p "/home/greg/.claude-$ACCT"
  printf '{\n  "forceLoginMethod": "claudeai"\n}\n' > "/home/greg/.claude-$ACCT/settings.json"
}
```

**2. Sign in:**

```bash
CLAUDE_CONFIG_DIR="/home/greg/.claude-$ACCT" claude auth login --claudeai --email "$EMAIL"
```

**3. Check it is the right person:**

```bash
CLAUDE_CONFIG_DIR="/home/greg/.claude-$ACCT" claude auth status --json
```

Expect `"loggedIn": true`, `"subscriptionType": "max"`, and **`"email"` showing the new account**. If
it shows the old one, the private-window step did not take: `claude auth logout` under that same
`CLAUDE_CONFIG_DIR`, then step 2 again.

**Then stop.** The rest — seeding the directory so a dispatched session has the MCP servers, the
model, auto mode and the shared memory, pinning the account's uuid, and registering it — is what the
wizard does, and doing it by hand is what you told us was fiddly. **An account that is signed in but
not yet registered is harmless**: nothing will dispatch onto it until it is in the registry.

> **A caution about step 3, which is weaker than it looks.** A config dir can hold a valid credential
> and still report `email: null` — identity comes from `.claude.json`, not from the credential
> itself, measured on the box. So a `null` email is not proof of anything, and the authoritative
> check is `/api/oauth/profile`, which the wizard runs. If step 3 shows `null`, don't conclude
> either way; say so and let the wizard settle it.

---

<details>
<summary>The superseded first version, kept as the record of what was wrong</summary>


> **SUPERSEDED — do not follow this by hand.** Greg, 2026-09-09, having run it: *"It was a bit
> fiddly to add the new accounts, and I think I might have missed some steps. Can you write a CLI
> script that I can call, that asks me questions, and then does everything for me."* So this is now
> **the wizard's specification**, not his instructions —
> [Stage 1](#stage-1-the-wizard-greg-runs-and-the-account-registry) is what he runs.
>
> **Two things changed since it was written and both would mislead:** steps 4 and 5 minted a
> `setup-token`, which the config-dir model does not use at all and which Greg should *not* run; and
> step 3's check is weaker than it looks, because a config dir can hold a valid credential and still
> report `email: null`. Kept here because the wizard has to do each of these steps correctly, and
> because the corrections are the record of what was wrong.
>
> **Corrected 2026-09-09 after GPT Sol's review**, which found seven defects in the first version —
> including one that was shell redirection rather than a placeholder, so pasting it would have hung
> the terminal.

**Do this once per new account.** Everything here runs *on the box*, **in a tmux pane you can type
into**. It has to be interactive: two of the steps open a browser login, and there is nobody but you
who can complete one.

**Before you start:** have the new account's email and password to hand, and be ready to open a URL
on your laptop. The box has no browser, so each login prints a link and a code; you open the link on
the laptop, sign in **as the new account** (use a private window, or you will silently re-authorise
the account you are already signed into), and the box picks it up.

Below, `pool1` is the name — yours to choose, lower-case, no spaces. Use `pool2`, `pool3` for the
ones after. **Absolute paths, and no trailing slash** — a `~` or a stray `/` gives you a different
account and the symptom looks like "it logged me out".

---

**0. Set the two things everything below reuses**, so nothing has to be retyped and no placeholder
can be pasted by mistake:

```bash
ACCT=pool1
EMAIL='you@example.com'          # the NEW account's email, in quotes
```

*Why a variable:* the first draft of this checklist wrote `--email <new-account-email>`, and `<` and
`>` are shell redirection — pasting that would have created a file called `new-account-email` and
hung the terminal waiting on input. Sol caught it.

**1. Make the account's own directory**, refusing if it already exists so a re-run cannot quietly
overwrite a working account's settings:

```bash
test -e "/home/greg/.claude-$ACCT" && echo "already exists — stop, and pick another name" || {
  mkdir -p "/home/greg/.claude-$ACCT"
  printf '{\n  "forceLoginMethod": "claudeai"\n}\n' > "/home/greg/.claude-$ACCT/settings.json"
}
```

That one setting stops a stray Console sign-in taking the directory over later — Console is a
different product (metered API billing) wearing the same login screen. It prevents rather than
detects, which is worth more than any check afterwards.

*Nothing else is copied in.* This directory is a **reading instrument**, not a place sessions run —
your agents keep using `/home/greg/.claude` and keep all their memory and history. Copying settings
or plugins here would be maintaining a second copy of them for no benefit.

**2. Sign in — first browser flow.**

```bash
CLAUDE_CONFIG_DIR="/home/greg/.claude-$ACCT" claude auth login --claudeai --email "$EMAIL"
```

Open the printed URL on your laptop, in a **private window**, sign in as the new account, paste the
code back.

*What you should see:* it says you are signed in.

**3. Check it took, and that it is the right person.**

```bash
CLAUDE_CONFIG_DIR="/home/greg/.claude-$ACCT" claude auth status --json
```

*What you should see:* `"loggedIn": true`, `"authMethod": "claude.ai"`, `"subscriptionType": "max"`,
and **`"email"` showing the new account** — not `greg@rehearsable.ai`. If the email is the old one,
the private-window step did not take: `claude auth logout` under that same `CLAUDE_CONFIG_DIR` and go
back to step 2. This costs nothing and makes no model call, so run it as often as you like.

**4. Mint the token the fleet will actually spend — second browser flow.**

**Stay in the same private browser window, signed in as the same new account.** This matters more
than it looks: see the warning after step 5.

```bash
CLAUDE_CONFIG_DIR="/home/greg/.claude-$ACCT" claude setup-token
```

*Why a second one:* the login in step 2 is how we **read** that account's usage; this token is what a
dispatched session **spends**. They are deliberately separate, so a session can bill account 2 while
still writing its transcripts and memory into the one shared place every agent reads. If it asks you
to sign in again, that is expected.

*What you should see:* a screenful of text and a long token, printed once. **It is shown once.**
Copy it.

**5. Put the token where the launcher will look**, created 0600 from the start rather than made 0600
afterwards — otherwise it exists briefly at whatever the umask allows:

```bash
mkdir -p /home/greg/.claude-accounts && chmod 700 /home/greg/.claude-accounts
( umask 077 && cat > "/home/greg/.claude-accounts/$ACCT.token" )   # paste, then Ctrl-D
ls -l "/home/greg/.claude-accounts/$ACCT.token"                     # expect -rw-------
```

> **The one thing this checklist cannot yet prove.** Steps 2 and 4 are two *independent* browser
> flows, and step 3 verifies the **login**, not the **token**. If step 4 were completed as a
> different account, you would have account A's login paired with account B's token — a config
> directory that reports one account's usage while the fleet spends another's. Nothing here catches
> that today, because an injected token's `auth status` returns no email at all (Sol measured this on
> the box). Doing both flows back to back in one private window is what keeps them the same account.
> Closing this properly is Stage 0's `/api/oauth/profile` measurement.

**6. Register it.** *(Stage 1 of this plan — it does not exist yet. Until it lands, stop after step
5; the login and the token are the parts only you can do, and they keep.)*

```bash
cd /home/greg/code/spideryarn2
npx tsx scripts/claude-accounts.ts add "$ACCT" \
  --config-dir "/home/greg/.claude-$ACCT" \
  --email "$EMAIL" \
  --token "/home/greg/.claude-accounts/$ACCT.token" \
  --role pool
```

The `cd` is needed: `npx tsx` resolves from the working directory, not from wherever you happen to
be. It asserts before it writes — `loggedIn`, `authMethod: claude.ai`, the subscription class, the
account uuid and the email must all match, or it refuses and writes nothing.

**7. Confirm the whole set.**

```bash
cd /home/greg/code/spideryarn2 && npx tsx scripts/claude-accounts.ts list
```

*What you should see:* one line per account, each with the email actually signed in — the
orchestrator (`greg@rehearsable.ai`) and every pool account. Anything that says otherwise is a
problem to fix before dispatching onto it.

---

**Then it is in use.** `gjd-remote new-claude --account auto` picks the least-used pool account;
`--account pool1` names one. **A command with no `--account` behaves exactly as it does today** —
adding accounts changes nothing you have not asked to change.

**Codex/ChatGPT accounts wait for your signal**, as you said. The registry already has a `family`
column for them, so adding one later is the same shape rather than a second system.



</details>
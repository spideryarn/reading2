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
| **config dir** | `~/.claude` by default. Holds the login, the settings, **the session transcripts and the auto-memory**. `CLAUDE_CONFIG_DIR` moves it. |
| **`setup-token`** | `claude setup-token` mints a long-lived token for an account. Exported as `CLAUDE_CODE_OAUTH_TOKEN`, it makes one *process* bill that account without moving its config dir. |
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
   at all. **This is the finding that shapes deliverable 4** — see [Stage 4](#stage-4-usage-read-per-account).

4. **Nothing free refreshes that cache.** `claude auth status` leaves `fetchedAtMs` untouched; the
   reading on the box right now is about five hours stale. Only a real session refreshes it. So an
   account's usage reading is only ever as fresh as the last work that account did — which is a
   property to *display*, not a bug to fix.

5. **The shared config dir is carrying 83 auto-memory files and 2.7 GB of transcripts** for this repo
   alone, across 43 project directories. That number is why the mechanism choice below goes the way
   it does.

## The mechanism choice, and why

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
[Stage 4](#stage-4-usage-read-per-account) is how we pay it.

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
- **A session Greg starts by hand with no `--account` keeps today's behaviour**: the default config
  dir, the default account, nothing injected. Adding accounts must not change what an unflagged
  command does.
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

**And one sentence in that doc is now out of date, which is ours to fix.** It says *"a second
account needs a collector that can see both. `collectUsage` reads one `~/.claude.json`;
`CLAUDE_CONFIG_DIR` isolation is plausible and **untested**."* Measurement 1 above is that test.
Stage 3 replaces the sentence with what was measured.

## The stages

Each stage ends in a GPT Sol review (`--sandbox workspace-write`, per the house rule since
2026-09-09), the fast gates, and a commit. Codex implements; this session manages and reviews.

### Stage 1 — the checklist, and the account registry

**Why first:** the checklist unblocks Greg tonight, and nothing downstream can be *tested against a
real second account* until he has run it. The registry is the one new concept everything else reads.

**Where it lives.** Outside the repo — credentials never go in git:

```
~/.claude-accounts/            0700
  registry.json                0600   who exists, and where their token is
  <name>.token                 0600   one long-lived token per pool account
```

**The token is in a separate file on purpose.** Putting it inline would make the registry itself a
secret, so nothing could print it, log it, or show it on a dashboard. Split, the registry is
describable in public and only the launcher ever opens a `.token`.

**One entry:**

```jsonc
{ "name": "main",                       // the handle: `--account main`
  "family": "claude",                   // "claude" | "codex" — the Codex hook, unused for now
  "role": "orchestrator",               // "orchestrator" | "pool"
  "configDir": "/home/greg/.claude",    // where its `auth login` lives; the usage reading comes from here
  "email": "greg@rehearsable.ai",       // what the assertion must find
  "tokenPath": null,                    // null for the orchestrator: it is the ambient login
  "addedAt": "2026-09-09T…" }
```

`family` is why a Codex account needs no second registry later. Nothing reads it yet, and Stage 1
does not act on it — it is a column, not a feature.

**Note what falls out: the orchestrator's entry describes what already exists.** Registering account
1 requires no login at all — its config dir is the default one and its credential is the ambient
login. So the registry starts by *describing* today's box rather than changing it, which is the
cheapest possible first state and makes "no accounts registered" and "one account registered"
behave identically.

**The reader** (`tools/overseer/accounts.ts`, new, pure-parse + one I/O function, matching
`usage.ts`'s split):

- validates on read; an unknown `role`, a duplicate `name`, a relative path, or a `pool` entry with
  no `tokenPath` is **an error, never a skipped line**;
- **never falls back to the default account** on any failure — the loud-failure rule this whole
  design rests on;
- exactly one entry may be `role: "orchestrator"`;
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

`--account <name>` and `--account auto` on both launchers.

**`scripts/run-claude.ts`** already has almost all of this and the reuse is exact: `--account X`
resolves the registry, injects that account's token as `CLAUDE_CODE_OAUTH_TOKEN`, and then takes the
**existing `--auth env` path** — including `authConflict()`, which already refuses when
`claude auth status` says the run will use the machine's own `claude.ai` login instead. That refusal
*is* the "a dispatched agent must never silently spend the orchestrator's account" guarantee,
already written and already tested. `--account` adds one assertion on top: the probe's account must
be the one the registry named.

**`AuthStatus` gains `email`.** `parseAuthStatus()` (`run-claude.ts:445`) reads `authMethod` and
`apiProvider` today; the JSON also carries `email`, `orgId` and `subscriptionType` (measurement 2).
Adding `email` is what makes the assertion name an account rather than a method.

**The one measurement this plan cannot make yet**, because it needs a second account to exist:

> Does `claude auth status --json` report an **email** when the credential is an injected
> `CLAUDE_CODE_OAUTH_TOKEN` rather than a config-dir login?

Both answers are designed for, and the code takes whichever it finds:

- **If it reports the email** — assert `email === entry.email`. The strong form.
- **If it reports only `authMethod: "oauth_token"` with no email** — assert
  `authMethod !== "claude.ai"`, which proves the injected token displaced the ambient login and so
  proves *we are not spending the orchestrator's account*. That is the safety property that actually
  matters; the email is then pinned at registration time instead, under the account's own config dir,
  where measurement 2 says it is always available.

The weaker branch is not a fallback bolted on after a failure — it is chosen once, at Stage 2, from a
measurement, and recorded here. **A refusal is still a refusal in both branches**: neither arm ever
proceeds on "could not tell".

**`--account auto`** picks the pool account with the lowest seven-day utilisation, and **never the
orchestrator**. Its fallback, named here rather than discovered in review: when no pool account has a
usable seven-day reading — every reading expired or unattributed, which measurement 4 makes an
ordinary state rather than a fault — it picks the pool account **least recently launched onto**, from
the launch log, and says so on stdout. It never silently resolves to the orchestrator, and with no
pool accounts at all it refuses rather than quietly doing what today's command does.

**`scripts/gjd-remote.ts new-claude --account`.** The generated job script gets one line, and **the
token is not in it**:

```bash
export CLAUDE_CODE_OAUTH_TOKEN="$(cat -- /home/greg/.claude-accounts/<name>.token)"
```

The job script lands in `~/.gjd-remote-work/jobs/`, so writing the token into it would put a
credential in a file whose whole purpose is to be re-readable afterwards. The name goes in; the
secret is read at launch, from a 0600 file, as Greg.

Two guards, matching the two that file already runs before it will leave a session standing (the
`cd` and the `command -v claude` at `gjd-remote.ts:2665-2675`): the token file must exist and be
non-empty, and the assertion must pass — **on failure the job fails loudly rather than starting a
session that bills the wrong account.** A session on the wrong account is exactly the shape those
existing guards exist to prevent, wearing different clothes.

**The account is recorded**, so the dashboard can say which account a session is on. The map found
that this concept exists nowhere yet: neither `RegisterEntry` (`tools/overseer/store.ts:341-409`) nor
`SessionMeta` has a field for it. The cheapest correct place is the launch log `appendLog()` already
writes (`gjd-remote.ts:2754`), which is durable, is already the record of "a launch happened", and is
**inside this stage's file set**. Adding a field to `RegisterEntry` is the Overseer's own persisted
table and is left alone — noted for the Overseer as a follow-up rather than reached into.

**Tests, red first:** a fake registry and a fake `claude` on `PATH` that prints a chosen
`auth status` JSON — so both branches of the measurement above are exercised without a second real
account; `auto` never returns the orchestrator; `auto` with no readings takes the named fallback;
an unknown `--account` name refuses; a failing assertion refuses and spends nothing; the generated
job script **contains the account name and does not contain the token**.

### Stage 3 — usage read per account

The collector loops over every registered account's `configDir`, reading
`<configDir>/.claude.json` through the `claudeJsonPath` parameter that already exists.

**Measurement 3 is the constraint, and it is worth restating because it is counter-intuitive.** The
usage cache is *one slot per config dir*, holding whichever account last wrote it. Under the pool
model, fleet sessions run under the **shared** `~/.claude`, so that slot is last-writer-wins across
accounts. Reading it therefore answers "what did the last session to run see?", not "how is each
account doing?".

What makes this work anyway is that **each account has its own config dir from Stage 1**, signed in
by `auth login` — the doc's "signed in twice on purpose". Each account's own dir has its own slot,
and nothing else writes to it.

**But measurement 4 says nothing free refreshes a slot** — only a real session does. So an account's
own dir goes stale the moment that account stops doing work *in that dir*, which under the pool model
is always. The honest consequences, and the design:

- **Take the free reading first.** Sample every registered config dir, plus the shared one, and
  attribute each sample by its `accountUuid` — which `attributeCache()` already refuses to do
  unsafely. An account that has recently run *anything* has a real reading.
- **A stale reading is displayed as stale, never as a percentage that looks current.** This is
  already the house rule, not a new one: `parseUsageWindow()` turns an expired window into
  `{kind:"expired"}` with **no percentage field at all**, and rule 1 of the eight in
  [usage-history.md](../project/usage-history.md) is *absence is never a zero*.
- **No paid refresher in v1.** A tiny `claude -p` under each account's dir would refresh its slot,
  and MindstoneRebel does something like it — but it bills the very account it measures, it needs a
  scheduler this box does not have ([cron-scheduler.md](../project/cron-scheduler.md)), and gate 4 of
  [overseer.md](../project/overseer.md#4-never-spend-what-you-are-rationing-and-the-budget-is-global)
  says the supervisor must not burn the quota it exists to protect. **Simplest version first**: ship
  the free reading, and let a real gap justify the paid one. Named here so it is a decision, not an
  omission.

**Rationing.** `overseer usage` prints one block per account, and the Overseer reads **the tightest
pool account and the orchestrator's separately** — one budget per account, stated per account, which
is gate 4's principle applied rather than weakened. A pool account near its limit takes that account
out of `auto`; the orchestrator near its limit is what pauses the fleet.

**The doc fix.** `usage-history.md`'s "plausible and **untested**" sentence is replaced by what
measurement 1 found, dated, with the version it was found on.

**Tests, red first:** fixture `.claude.json` files for two accounts; the loop attributes each to the
right uuid; a config dir whose slot holds *another* account's uuid is not misattributed (the case
measurement 3 creates); a missing or unreadable dir is one account's absence, never the whole
report's failure; `overseer usage --json` grows a per-account array and the existing single-account
output still parses.

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

**Superseded in part by [Stage 5](#stage-5--a-web-interface-that-drives-the-setup).** Greg asked for
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

**Because `setup-token` is a TUI, a real pty is required** (`node-pty`, or `script` as the boring
fallback), and "capture the token from the output" means reading a rendered screen rather than a
line. That is the fragile part, and it is why this is Stage 5: **the registry, the launchers and
per-account usage all land first**, and the checklist keeps working, so if the pty flow proves too
brittle we stop here having lost nothing.

**Each step is its own state**, with its own failure text and a kill button: seed dir → login (URL
shown, code taken from a form) → assert `auth status --json` names the expected email → `setup-token`
→ capture the token → write the 0600 file → register. A stuck step is killable; nothing advances on
"could not tell".

**The token is never shown and never logged.** It goes from the pty buffer to a 0600 file. The page
gets "written", not the value; the transcript the page displays is filtered, and the test asserts the
token does not appear in what is rendered, stored or logged.

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

**Do this once per new account.** Everything here runs *on the box*, in a terminal you can type into
— a tmux pane, or `gjd-remote ssh -t`. It has to be interactive: two of the steps open a browser
login, and there is nobody but you who can complete one.

**Before you start:** have the new account's email and password to hand, and be ready to open a URL
on your laptop. The box has no browser, so each login prints a link and a code; you open the link on
the laptop, sign in **as the new account** (use a private window, or you will silently re-authorise
the account you are already signed into), and the box picks it up.

Below, `pool1` is the name — yours to choose, lower-case, no spaces. Use `pool2`, `pool3` for the
ones after. **Absolute paths, and no trailing slash** — a `~` or a stray `/` gives you a different
account and the symptom looks like "it logged me out".

---

**1. Make the account's own directory.**

```bash
mkdir -p /home/greg/.claude-pool1
printf '{\n  "forceLoginMethod": "claudeai"\n}\n' > /home/greg/.claude-pool1/settings.json
```

That one setting stops a stray Console sign-in taking the directory over later — Console is a
different product (metered API billing) wearing the same login screen. It prevents rather than
detects, which is worth more than any check afterwards.

*Nothing else is copied in.* This directory is a **reading instrument**, not a place sessions run —
your agents keep using `/home/greg/.claude` and keep all their memory and history. Copying settings
or plugins here would be maintaining a second copy of them for no benefit.

**2. Sign in — first browser flow.**

```bash
CLAUDE_CONFIG_DIR=/home/greg/.claude-pool1 claude auth login --claudeai --email <new-account-email>
```

Open the printed URL on your laptop, in a **private window**, sign in as the new account, paste the
code back.

*What you should see:* it says you are signed in.

**3. Check it took, and that it is the right person.**

```bash
CLAUDE_CONFIG_DIR=/home/greg/.claude-pool1 claude auth status --json
```

*What you should see:* `"loggedIn": true`, `"authMethod": "claude.ai"`, `"subscriptionType": "max"`,
and **`"email"` showing the new account** — not `greg@rehearsable.ai`. If the email is the old one,
the private-window step did not take: `claude auth logout` under that same `CLAUDE_CONFIG_DIR` and go
back to step 2. This costs nothing and makes no model call, so run it as often as you like.

**4. Mint the token the fleet will actually spend — second browser flow.**

```bash
CLAUDE_CONFIG_DIR=/home/greg/.claude-pool1 claude setup-token
```

*Why a second one:* the login in step 2 is how we **read** that account's usage; this token is what a
dispatched session **spends**. They are deliberately separate, so a session can bill account 2 while
still writing its transcripts and memory into the one shared place every agent reads. If it asks you
to sign in again, that is expected — sign in as the same new account.

*What you should see:* a long token printed once. **It is shown once.** Copy it.

**5. Put the token where the launcher will look.**

```bash
mkdir -p /home/greg/.claude-accounts && chmod 700 /home/greg/.claude-accounts
cat > /home/greg/.claude-accounts/pool1.token     # paste the token, then Ctrl-D
chmod 600 /home/greg/.claude-accounts/pool1.token
```

**6. Register it.** *(This command is Stage 1 of this plan — it does not exist yet. Until it lands,
stop after step 5; the token and the login are the parts only you can do, and they keep.)*

```bash
npx tsx scripts/claude-accounts.ts add pool1 \
  --config-dir /home/greg/.claude-pool1 \
  --email <new-account-email> \
  --token /home/greg/.claude-accounts/pool1.token \
  --role pool
```

It asserts before it writes: if `auth status` under that directory does not name that email, it
refuses and writes nothing.

**7. Confirm the whole set.**

```bash
npx tsx scripts/claude-accounts.ts list
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


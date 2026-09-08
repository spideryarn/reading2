# Wave 2: the write path, usage limits, box-health history, the attention inbox, and a Codex adapter

Greg, 2026-09-08, in one message:

> Use @docs/reusable/engineering-manager.md to work on:
> - securing the write path
> - usage limits (perhaps there's an API we can call to get the updated status? failing that, I'll add
>   an admin key. use Sonnet for web research if needed)
> - for the Box Health, show graphs of recentish history (last 24h), so that I can tell whether there
>   might have been problems/disruptions to be aware of, and include the amount/proportion of swap used
> - attention inbox
> - v1 of Codex/GPT harness adapter
>
> Push and pull periodically

The direction, the constraints and every earlier quote live in
[orchestrator-direction.md](../project/orchestrator-direction.md). This plan does not restate them; it
says what gets built, by whom, in what order, and what done looks like.

## Two things are already answered, and the answer changes the work

**Usage limits: there is no API, and the admin key would not help.** Greg offered one; the research
was done and hand-verified earlier the same day, and is written up in
[§ Can we call an API instead? Mostly no, and not with an admin key](../project/orchestrator-direction.md#can-we-call-an-api-instead-mostly-no-and-not-with-an-admin-key).
The short version: every `/v1/organizations/*` usage endpoint reports **Console API-key spend**, not
subscription quota — Anthropic's own FAQ says *"This API only tracks Claude Code usage on the Claude
API"* — and admin keys are minted for a Console organisation, which a personal Max subscription may
not have. The headers that do carry the real numbers are undocumented, unversioned, and currently
reported returning persistent 429s.

**So this stage is not research, it is construction**, and the sources are already identified: the
local `~/.claude.json` cache as a *hint that must be checked against its own `resets_at`*, and the
transcript 429 as *ground truth*. No Sonnet web research is being spent on a question that was
answered today. **Do not ask Greg for the admin key.**

**Swap is already collected.** `parseSwap` and `parseSwapActivity` in `tools/fleet/health.ts` already
return total, used, `usedFraction`, the per-file breakdown, and live si/so from `vmstat` — and
`health-view.ts` already renders a swap card with the *"swap is a cliff, not a slope"* thresholds. So
the swap half of Greg's third bullet is **mostly done**, and what is missing is the part he actually
asked for: **history**. Whoever takes it should check the rendered card against his ask rather than
rebuild the collector.

## Ownership: two agents, one tree of files

Greg added a sixth item mid-run — *"borrow from Spideryarn for voice-dictation and realtime-dialog for
all input-message-text-boxes"* — and said *"if helpful, use `gjd-remote new-claude` to fan these out."*
So this is six workstreams across six sessions, and the split below was **negotiated by message, not
assumed**: proposed to `claude-agents-dashboard` at 12:45 and accepted at 12:58 with three collisions
named.

| item | session | why |
|---|---|---|
| **1. securing the write path** | `claude-agents-dashboard` | A9, A10, A11, A6 are all `owner: dashboard` in [§ The backlog](../project/orchestrator-direction.md#securing-the-live-write-path-a-stage-but-not-the-top-one). The write path is `routes-*.ts` and `steer.ts`. **A6 already landed** (`0a5a3008`, CSP + anti-framing). |
| **2. usage limits** | `w2-usage-limits` | Account-level, not pane-level. Collector and 429 ground truth here; the `FleetStatus` arm is the dashboard's. |
| **3. box-health 24h history + swap** | `fleet-health-history` | Retained in the dashboard process, against the direction doc's assignment — see below. |
| **4. attention inbox** | **split** | The Overseer decides what needs Greg and why; the dashboard renders and collects the tap. |
| **5. Codex/GPT harness adapter v1** | `w2-harness-adapter` | It is a question about what a session *is*, which is the Overseer's tense. |
| **6. dictation + realtime dialog** | `w2-fleet-dictation` | Dictation first, by Greg's call; the dialog stage is gated on it. |

**Every collision has the same shape, and the seam is a type in each case: one side detects, the other
renders.** The dashboard owns `FleetStatus` (five exhaustive switches depend on it) and owns the row
type, so a Codex session and a rate-limited session become *arms it adds*, from *field names we send
it first*. Its words, and they are the rule: **"Send me the shape, not the rows."**

**The split on #4 is the seam working, not a boundary being crossed** — the same shape as A12, which
the dashboard closed on the Overseer's behalf because the prefix belongs where the message is
delivered. Here the ranking belongs where the durations are, which is the store.

### `wire.ts`, and why the Overseer's types are going into it

The dashboard is spiking `tools/fleet/wire.ts`: **one leaf module holding every type that crosses the
server/browser boundary, imported by both sides, so a field one side adds is a compile error on the
other rather than a silently-missing render.** It exists because of the same morning's postmortem —
sixteen instances of a hand-written join that nothing checked, ten of them lossy, the worst being a
body that sent `dryRun` while the route only ever parsed `mode`, so **every box action ever pressed
was a dry run reported as "Done."**

`~/.overseer/current.json` is exactly that kind of boundary and currently has exactly that protection:
none. **So the Overseer's published types go into `wire.ts` when it lands** — we write them, the
dashboard imports them, and neither side can drop a field the other set. The store's parsers are
already leaf-shaped for an unrelated reason (pure, no `execFileSync` and no `Date.now()` inside them),
so they should fit. **If the spike is disproved** — every server type reaches `node:child_process`
transitively and the client tsconfig has no node types — the fallback is a hand-written mirror **plus
a test that fails when the two drift**, which is second best and much better than nothing.

### Where the health history lives, and the one thing owed in return

[§ Two tenses](../project/orchestrator-direction.md#two-tenses-the-seam-between-the-overseer-and-the-dashboard)
assigns the vitals history to the Overseer's past tense, and `daemon.ts` says outright *"No health
history and no local collection"*. **It is being built in the dashboard process instead**, and the
argument for that beat the doc: the reading already exists in-process there, **there is one collector
on this box and it is not ours** (a collection costs ~12s of grepping thirty-five transcripts, on a
box that has hit load 391 with the OOM killer firing), and writing at the source removes both a
transport hop and a dependency on the Overseer being up. It gets its own root, `~/.fleet-health/`, so
there is never a question of two writers on one file. Greg decides whether the direction doc moves.

**The contract taken in return: a gap must render as a gap, never a line drawn across it.** Writing
the history inside the dashboard means a dashboard crash punches a hole in exactly the record Greg
opens to find out whether something went wrong — and his stated purpose is *"so that I can tell
whether there might have been problems/disruptions to be aware of"*. An interpolated line through the
ninety minutes the box was thrashing answers that question with a confident **no**. So the sample
interval is recorded, and a wider-than-interval gap is a **datum** ("no reading"), not a missing one.
Two smaller ones in the same family: a 24h axis on a process up for 20 minutes must say so rather than
letting the axis imply a day, and `health.ts`'s readings are unions with `unknown` arms that **must
not be flattened to numbers on the way to disk** — a stored `null` cannot tell "load was 0" from
"`nproc` failed".

## Ordering, and why it is not Greg's list order

Greg's list is a list, not a ranking — he ranked this work explicitly earlier the same day
([§ The order of work](../project/orchestrator-direction.md#the-order-of-work)): *"attention triage,
then perhaps box vitals and throttling, then account usage limits, then scheduler"*, and separately
put the write path in as *"a stage, but it doesn't have to be the top-priority."* Nothing has changed
that. So on the Overseer's side the order is **attention first**, and the write path stays where he
put it.

## Stages

Each ends with the tree green and committed, and would make sense as a stopping point.

### Stage A — the attention list, the deciding half

**The premise triage was about to be built on is wrong**, and it was measured:
[§ `idle` is the bug](../project/orchestrator-direction.md#idle-is-the-bug-the-vocabulary-describes-the-pane-not-the-work).
`needs-you` means *Claude Code says a dialog is open*; ten of fifteen sessions genuinely waiting on
Greg had ended their turn handing him a decision **in prose, ending in a full stop**, and not one
showed as needing him. So the first thing this stage owes is a way to see those.

- A typed `Attention` list written into `~/.overseer/current.json`, one entry per **question**, not
  per session — *"at 11pm nobody cares which of 36 asked"*.
- **Sorted by kind first** (irreversible, product, technical, other) **and only then by age**: *"age
  is a tie-breaker, not a rank"*.
- **Duplicate collapse**, because a repeated duplicate is the strongest available signal that a
  *policy* is missing.
- **Answerable-from-a-phone** as an explicit field, since a question needing a diff read just makes
  him feel behind.
- Ranking is by **consequence and reversibility, never by self-reported confidence** — A18 and Fable
  reached that independently, and confidence ranking promotes exactly the confident mistakes you want
  caught.

**Done looks like**: the list appears in `current.json`, a schema bump if a reader ignoring it would
be wrong, and — the honest check — **it finds prose-ending questions that `needs-you` misses**, with
the count measured against the live fleet and written into this doc. A list that only reproduces
`needs-you` is a failure of this stage, not a pass.

### Stage B — usage limits, and the reading that refuses to lie

- `tools/overseer/usage.ts`, pure parsers, string in and a discriminated union out — the shape
  `health.ts` already uses and the reason it is trusted.
- **A reading whose `resets_at` is in the past is `stale`, never a percentage.** Measured: the file
  was 48 minutes old and its `five_hour` window had reset 27 minutes earlier, so its `utilization: 70`
  described a window that no longer existed. **The file always parses and always yields a plausible
  number**; nothing in it announces the number is void.
- **The transcript 429 is ground truth**: `"error":"rate_limit"`, `apiErrorStatus: 429`, and a
  `quotaLimits` object carrying `rateLimitType` and a `resetsAt`. Exact, greppable, cannot be stale.
- Account identity from `claude auth status` — which matters the moment there is more than one, and
  multiple Max subscriptions is **medium-term by Greg's call**, so this stage records *which account*
  and builds no rotation.

**Done looks like**: a usage block in `current.json` that says `unknown` when it cannot tell, with a
test that feeds it an expired `resets_at` and watches it refuse. And a **positive control** — a probe
that finds no 429s anywhere must be distinguishable from a probe that is broken
([silent-success.md](../reusable/silent-success.md)).

### Stage C — the Codex/GPT harness adapter, v1

Half of this exists and was measured: `tools/overseer/work.ts` already recognises `codex exec` in the
process tree, because **4 sessions were running it and 0 showed as anything but idle**. And
`steer.ts` already refuses to send keystrokes to a Codex batch job. What does not exist is the
**type**: a session's harness is currently an assumption, not a field.

- A `Harness` discriminated union with a **capability declaration per harness** — what can be
  steered, what can be answered, what can only be watched.
- The principle it serves is already written down: *"One adapter per harness, and honest about what
  each can do. Claude, Codex and bare shells have genuinely different capabilities; flattening them
  into one 'message an agent' verb produces a UI that lies."*
- v1 means **honest recognition, not new control**: a Codex session is identified and its
  capabilities are stated. Nothing new becomes steerable in this stage.

**Done looks like**: the fleet can say *this is a Codex job and you cannot type at it* as a typed
fact rather than a special case buried in `steer.ts`.

### Stage D — box-health history (`fleet-health-history`)

Owned elsewhere; the contract is [§ Where the health history lives](#where-the-health-history-lives-and-the-one-thing-owed-in-return)
above. **Swap is not part of the work**: `SwapReading` already gives `usedBytes`/`totalBytes`/fraction
and the per-file breakdown, `SwapActivityReading` already gives si/so and `activelySwapping`, and
`health-view.ts` already draws the card. Greg's bullet asks for *history*; the measurement exists.

### Stage E — dictation on every fleet input box (`w2-fleet-dictation`)

Greg's call when asked what a realtime dialog would be talking *to*:

> Let's do dictation first. The goal of realtime dialog would be to talk with whichever agent the
> input-message-text-box relates to, perhaps by feeding in a compacted summary of the conversation so
> far, and/or giving it the ability to use tool use to gather more information (e.g. by reading
> docs/code/etc, or anything else that might help it have an informed conversation) — if you feel
> unblocked enough to make progress on that, then add it as a stage and try and get it working.
> Borrow (or better still reuse) from Spideryarn.

**"Better still reuse" is a decision about a principle, and it is his to make.**
[§ Principles](../project/orchestrator-direction.md#principles) says the fleet tool must not depend on
anything under `src/`, *"If it ever earns its own repo, that should be a move, not a rewrite."* There
are ~3000 lines of hard-won client machinery there (`useDictation.ts` 1612, `mic-recording.ts` 461,
`DictationStrip.tsx` 502, `useAudioLevel.ts` 204, `mic-lock.ts` 110). **Copying that is worse than
depending on it**, so the rule becomes: import only **leaf, browser-only, product-agnostic** modules,
extract a coupling behind a parameter rather than importing the coupling, and **write the resulting
import list into this doc** — because that list is the cost of the move if the tool ever gets its own
repo.

**The server half is the real work, and the vocabulary is the point.** Dictation's second pass is not
a better ear, it is a vocabulary: measured 2026-08-27, every dedicated speech-to-text model mangled
this app's own words until one was *told what the words might be*. Ours are different and
better-defined than an article's — session names, worktree names, `gjd-remote`, `tmux`, `vitest`,
`Overseer`. **A fleet dashboard whose transcriber has never heard the word "worktree" will mangle
every message Greg dictates.**

**What cannot be verified from here, and must not be pretended:** there is no audio input device on
this box and Chrome's fake-mic flags do not work headless. The real `getUserMedia` path is Greg's to
test from his own device, and the report must say which half was checked. *"A valid session ticket is
not proof that a microphone opened, a response event is not proof that sound played."*

### Stage F — realtime dialog, gated on Stage E

**The conversation partner is not the agent itself**, and that misreading is the expensive one: an
agent in a tmux pane has turn latency in tens of seconds, and `steer.ts` already reports that a
delivered message can be `partial` — the text landed and the Enter did not. What Greg described is a
realtime model briefed *about* that session — a compacted summary plus tool use to read docs and code
— which he talks through, and which then hands the agent a message. Gated honestly: **an unfinished
Stage F on top of a shaky Stage E is worse than Stage E alone.**

## A5 is not a live exposure; it is a decision that happens at `systemctl enable`

Measured on the box, 2026-09-08, because Astra's finding said *"Tailscale's default policy is
permissive, so verify rather than assume"* and nobody had verified:

- The tailnet has **exactly two devices** — this box (`100.92.255.119`) and Greg's iPhone
  (`100.108.254.125`, offline). Both his.
- `tailscale serve status` and `tailscale funnel status` both report **"No serve config"**. Nothing is
  exposed to the public internet.
- **The running dashboard binds `127.0.0.1` only.** It is not tailnet-reachable today at all; Greg
  reaches it over an ssh forward.
- **The widening is not in the unit.** The repo's unit says `Environment=FLEET_BIND=127.0.0.1` and
  `tests/systemd-units.test.ts` asserts that exact string. It is `/etc/fleet-dashboard.env` — which
  exists, contains `FLEET_BIND=127.0.0.1,100.92.255.119`, and is read at start because
  `EnvironmentFile=` comes after `Environment=`.

So A5 describes an exposure that **does not exist yet and begins at the instant
`sudo systemctl enable --now fleet-dashboard.service` runs** — a step already waiting on Greg. That
reframes it from scheduled engineering into a precondition attached to a command, which is a much
cheaper place for it to live.

**Fable arbitrated and returned a fourth option: close it, and attach the rule to the widening.** The
full reasoning is now in
[orchestrator-direction.md § A5 is CLOSED too](../project/orchestrator-direction.md#the-backlog-after-the-wide-review)
— the short version is that A5 hardens a boundary against parties who do not exist while A7 leaves
open the one that does (all 27 agents share a Unix user and already reach `127.0.0.1:8787`), that
**Tailscale ACLs have no deny rule** so the "cheap" grant is really a whole-policy rewrite with
lockout as its failure mode, and that the genuine equivalent of the reference system's allowlist is
`tailscale serve` plus an owner check on `Tailscale-User-Login`, not an ACL. **No code work; one
precondition on one command; row closed.**

## The simpler option passed over

**Rendering the attention list straight from `needs-you` and shipping it today.** It would have been
an afternoon, it would have looked right, and it would have been wrong in the direction that matters:
it lists the agents that are *blocked*, and Fable's reframing is that a blocked agent is the cheapest
thing on the box —

> The agent that costs real money is the one that is **working, confidently, on the wrong thing**
> … It never asks. It never appears on a "needs you" list.
>
> — Fable, 2026-09-08

Stage A's prose-question detection is the smallest thing that does not inherit that error. The
misdirection half — plan-doc name, last commit, time since a push, whether the session is in the
primary checkout — is deliberately **not** in this wave; the proxies exist in what is already
collected, and building the question surface first is the boring half done honestly.

## Not in this wave

- **The scheduler.** Last by Greg's own ordering, and it should not be quietly promoted
  ([cron-scheduler.md](../project/cron-scheduler.md)).
- **Multiple Max accounts / rotation.** Medium-term by his call.
- **Push notifications.** *"Push almost nothing"* — two categories only, and neither is an agent
  waiting on a question. The inbox is a surface to open, not a thing that buzzes.
- **A22's event protocol, A21's unattended actions, A23's resource claims.** Deferred outright in the
  backlog and not reopened here.

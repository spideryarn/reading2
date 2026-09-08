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

## Where this stands, 13:55 on 2026-09-08

**Important work left**, and it is the implementation of five of the six stages. What is finished is
the part that had to be finished first: **every seam is agreed and every contract is a type**, so the
six sessions can now build in parallel without a negotiation between them.

| | landed | what remains |
|---|---|---|
| **A** attention | the five types, verbatim, in `wire.ts` (`4d5cc454`) | the classifier, and the evaluation that justifies it |
| **B** usage | the dashboard's `Pause` contract (`f1c34e96`) | the collector and the 429 ground truth |
| **C** harness | **DONE** (`5c2e31cb`) — six arms, one `can: true`, Sol-reviewed | nothing; the `steer.ts` inline change is queued behind `fleet-approval-binding` |
| **D** health | seam agreed (`refreshOnce`, not `server.ts`); `lock.ts` extracted for it | retention and the drawing |
| **E/F** dictation | file split agreed with the dashboard | all of it |
| **A5** | **closed**, no code | nothing |

**Three things landed that were not in the plan**, all of them because the work turned them up:

1. **`tools/overseer/lock.ts`** (`93cf4628`) — the one-writer discipline extracted to a leaf, because
   the health retention needed it and *the third copy would have been the simplified one*.
2. **A test for `EPERM`-is-alive**, found by mutation and not by reading: replacing that branch with a
   flat `return false` left all 102 tests green. The branch deciding whether **a live process
   belonging to somebody else** reads as running had no test at all, which is exactly what lets a
   second writer take a live lock.
3. **A live A10 measurement** from `fleet-approval-binding`: **three panes right now hold non-empty
   unsent drafts, one of them the words *"yes, shut it all down"* in a session running in auto mode.**
   Free text typed at a pane concatenates with what is already in the box. That is why the evidence
   union in Stage A is load-bearing rather than fastidious, and why a `prose` item gets **no answer
   control at all** in v1.

**And one cost finding, which is not engineering — stated with its timestamp, because that turned out
to matter.** At **13:30** `w2-harness-adapter` found **two orphaned paid `gpt-5.6-sol --effort high`
reviews running under `ppid 1`**: the Bash-tool shell had been reaped, leaving 45-minute jobs
reparented to init, attributable to no session and invisible to `work.ts`, which only walks *down*
from a pane. **At 14:05 there were none** — every `ppid 1` process on the box was a system daemon.
So the finding is **real but transient**: not a leak that accumulates, but a window during which a
paid job cannot be attributed or stopped. Related to a trap already recorded — a killed codex run
still writes its `--output` file, so a stale review is indistinguishable from a fresh one and both the
exit code and file-exists pass. An orphan whose output path is later reused is that trap with a long
fuse.

The one genuinely long-lived orphan is `bash /tmp/fake-codex-qAz9Um/codex`, reparented **6 days 20
hours** ago at 1.7 MB. That is the **fake** codex from a test harness — the same one whose existence
shaped the decision not to peel shells in `work.ts` — leaked from a test run last week. Harmless, and
a live specimen of what the recogniser is built to refuse.

### "There are none" is a reading, not a property

The sharpest thing Stage C produced, and it generalises past Codex. At **11:58** the honest answer was
zero Codex panes, exactly as the brief predicted — a Codex here is always a Claude session's child.
By **12:15** there were three, two of them a bare interactive `codex` TUI under a `bash -l`. The
module nearly shipped a comment asserting that an interactive Codex had never existed on this box,
**minutes before two did**.

Nothing was wrong with the first reading. What was wrong was the tense it was about to be written in.
The same fragility applies to *"35 `auto`, 1 `default`"* earlier the same day, and to every count in
this doc: **the honest form of a fleet measurement is the timestamp**, and a sentence that drops it
has converted an observation into a claim about the world.

**And knowing the lesson did not prevent it, one paragraph later.** The orphan finding above was
written as *"two orphaned reviews are running"*, which was false by the time anybody read it — by the
same author, minutes after writing the rule down. Then the correction repeated the shape a third time:
two agents walked the process table and reported zero orphans **two minutes apart** (13:03 and 13:05
UTC — the box runs BST, so 14:05 and 13:03 are two minutes, not an hour), and called that
corroboration. It is one observation with a wide error bar.

**So the lesson does not transfer by being remembered, and the reason is that it keeps changing
clothes**: first counting a population, then corroborating a claim, then mistaking co-located readings
for independent ones. The version that catches all three is mechanical rather than remembered — **the
instant a fleet number was taken travels with the number, as a field**, the way `collectedAt`,
`scannedAt` and `waitingSince` are fields in every type built today rather than habits. What actually
settled the orphan question was not a second reading at all but a **mechanism**: an orphan appears
when a Bash-tool shell is reaped mid-run and leaves when the job ends, so the population is bounded by
concurrent reviews rather than growing. That argument would hold with zero readings, which is what
makes it the evidence.

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

#### The shape, and the four decisions inside it

Published into `tools/fleet/wire.ts` (which landed as `3df3e833`), so the dashboard imports it rather
than re-declaring it. Types only, no imports, no runtime values — a `const` there is bundled into the
browser.

```ts
/** Why we believe this needs Greg. The two arms are answered by DIFFERENT MECHANISMS. */
export type AttentionEvidence =
  | {
      /** The harness says a dialog is open. Mechanical, observed, and it has options. */
      kind: "dialog";
      question: string;
      /** In the order the harness drew them. Answering picks one of these. */
      options: readonly string[];
    }
  | {
      /** The turn ended handing Greg a decision in prose. INFERRED, and it may be wrong. */
      kind: "prose";
      /** The tail of the turn, so a person can check the inference rather than trust it. */
      excerpt: string;
      /** What made us think so, in words. Never a score. */
      why: string;
    };

/** Consequence and reversibility. NOT confidence, and NOT urgency. */
export type AttentionKind = "irreversible" | "product" | "technical" | "other";

/** Whether answering this from a phone is a real option. */
export type AttentionAnswerability =
  | { kind: "phone" }
  | { kind: "needs-a-screen"; why: string }
  | { kind: "unknown"; why: string };

export type AttentionItem = {
  /** Stable across snapshots, so a card cannot move under a finger. */
  id: string;
  /** tmux's own handle — the address, and stable across renames. */
  sessionId: string;
  sessionName: string;
  /** When we FIRST saw this question. Not when we last saw it. */
  waitingSince: string;
  kind: AttentionKind;
  evidence: AttentionEvidence;
  answerability: AttentionAnswerability;
  /** Other sessions asking the same thing. Answer once, apply to all. */
  duplicates: readonly { sessionId: string; sessionName: string; waitingSince: string }[];
};

export type AttentionList =
  | {
      kind: "list";
      /** Already sorted: by `kind` first, then by `waitingSince`. The renderer must not re-sort. */
      items: readonly AttentionItem[];
      /** THE POSITIVE CONTROL. Zero items out of zero scanned is a broken probe. */
      sessionsScanned: number;
      scannedAt: string;
    }
  | { kind: "unknown"; why: string; scannedAt: string };
```

**One — the evidence union is the load-bearing part, and flattening it is the bug this stage is most
likely to ship.** A dialog is *observed*: the harness drew it, the options are enumerated, and
answering means picking one. A prose question is *inferred*: we read the tail of a turn and decided it
was a question, and answering means free text. Those are different risks, not different confidences —
A10 says a live Claude descendant does not prove an empty input box owns the keystrokes, so **arbitrary
prose must stay a narrower capability than answering a recognised dialog**. A single `question: string`
field with a boolean beside it would let a renderer draw the same card for both, which is how the
dangerous one gets the easy affordance.

**Two — there is no confidence field anywhere, and that is deliberate.** Fable and Astra's A18 reached
it independently: *ranking by self-reported confidence promotes exactly the confident mistakes you most
want caught*. `AttentionKind` ranks by consequence and reversibility. If a score turns up in a later
draft, it is a regression.

**Three — `waitingSince` is first-seen, not last-seen, and it is why the store had to come first.**
The pane says a dialog is open; it cannot say for how long. Duration is a fact only something with a
memory can produce, which is the whole reason
[§ The order of work](../project/orchestrator-direction.md#the-order-of-work) says attention triage
*arrives* first but cannot be *built* first.

**Four — the producer sorts, and the renderer must not.** *"Do not reorder or replace a card's options
while his finger is approaching them"* (Astra). Stable `id`s make that possible; a renderer that
re-sorts on every payload throws it away. And `sessionsScanned` is the positive control — an empty
list is only good news if something looked.

**What is deliberately NOT in the type**: a routing field. *Who should answer this* (the Overseer for
what it can verify, Sol for evidence in the tree, Fable for wording and defaults, Greg for anything
irreversible) is a real part of the design, but it is a **decision the Overseer acts on**, not
something the phone renders — and shipping it as a field invites a UI that shows Greg a queue of
things it has decided not to ask him. It lands when something answers, not when something lists.

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

#### What landed, 2026-09-08 (`w2-harness-adapter`)

- **`HarnessKind`, `Capability`, `HarnessCapabilities` in [`tools/fleet/wire.ts`](../../tools/fleet/wire.ts)** —
  types only, because that file is compiled a second time under the browser's DOM-only project and
  may hold no runtime value and no import. Placement decided by `claude-agents-dashboard`, which owns
  the row type; it landed `wire.ts` itself twenty minutes before this stage needed it.
- **`Harness`, `HarnessUnknownCause`, `classifyPaneHarness`, `describeHarness` and the
  `HARNESS_CAPABILITIES` table in [`tools/overseer/harness.ts`](../../tools/overseer/harness.ts)** —
  the table is the `const`, so it lives here rather than on the wire. `Record<HarnessKind, …>` makes
  a new arm that declares nothing a build failure; `describeHarness` is an exhaustive switch with a
  `never`.
- **Six arms, not four**: `claude-code`, `claude-headless`, `codex-batch`, `codex-interactive`,
  `shell`, `unknown`. Two more than the plan asked for, and both earned their place — see below.
- **31 tests in `tests/overseer-harness.test.ts`**, all written red first, plus two new real fixtures.
  Five mutations of the finished code were each caught by the test that names them.
- **`steer.ts` got a header pointer only**, deliberately: see *What the plan got wrong*, item 4.

**Nothing renders it yet, and that is the stage boundary rather than an omission.** `classifyPaneHarness`
and `capabilitiesOf` are called by their tests and by nothing else on `dev`. Putting a harness on a
row means editing `collect.ts` / `status.ts` / `web/`, which are `claude-agents-dashboard`'s files;
the wire types are in `wire.ts` precisely so it can do that without a second declaration. The
Overseer's own consumer (a harness on a stored observation) is a later stage and is not smuggled in
here. If this sits unrendered for a week, that is a coordination failure worth noticing — not
evidence the type was wrong.

#### What the plan got wrong

**1. "Half of this exists" understated it, and "what does not exist is the type" was exactly right.**
No complaint — this was the most accurate sentence in the stage.

**2. Four arms would have produced the UI that lies the principle warns about.** The plan says "a
`Harness` discriminated union"; four kinds are not enough to be honest with. The reviewer was asked
outright whether six was over-built and which two it would cut, and answered the other way:

> I would keep all six union arms. `claude-headless` and `codex-batch` are precisely the two arms
> that prevent "same executable means same capability"; cutting either recreates the lie this stage
> is intended to remove.
>
> — GPT Sol, 2026-09-08

That is a better argument for the extra arms than the one they were added on, which was only "it
matched zero panes today, keep it anyway". Concretely:

- `claude --print` is a Claude that **cannot** take a keystroke — it read its prompt once at startup
  and never reads the tty again. Folded into `claude-code`, the page draws a "send" on it.
- A Codex **batch** job is refused because there is no stdin at all (`scripts/subagent-cli.ts` spawns
  with `fd 0 = 'ignore'`, "the load-bearing anti-hang guarantee"). An **interactive** Codex is
  refused because *nobody here has ever tried it* — unproven, not impossible. One `why` string
  cannot say both, and the difference is what decides whether a later stage should attempt it.

**3. The measurement changed under the stage, twice, and that is the finding.**

| | 11:58 UTC | 12:15 UTC |
|---|---|---|
| panes | 22 | 26 |
| `claude-code` | 15 | 17 |
| `shell` | 7 | 6 |
| `codex-batch` | **0** | **1** |
| `codex-interactive` | **0** | **2** |
| `unknown` | 0 | 0 |

At 11:58 the honest answer was the one the brief predicted: *no Codex session has ever been a fleet
row on this box; a `codex exec` is always a Claude session's child or an orphan.* Seventeen minutes
later that was false — one pane was `tmux-job.ts` running `run-codex.ts` directly, and **two were a
bare interactive `codex` TUI under a `bash -l`**, verified against their raw command lines and
captured as `codex-batch-pane.txt` and `codex-interactive-pane.txt`. Neither reading was wrong.
**"There are none" is a reading, not a property**, and a design that had hard-coded the 11:58 answer
would have shipped an arm marked dead code that was live before the commit landed.

**4. "Move steer.ts's Codex refusal so it reads the capability" describes something that was never
in `steer.ts` as code.** What is there is (i) a header bullet asserting the fact in prose and (ii)
`verifyTarget`'s `no-claude-in-pane`, which refuses Codex, bare shells and dead panes *incidentally*,
by requiring a live `claude --session-id <uuid>` descendant. Making `verifyTarget` genuinely consult
a harness capability would need a full command table it does not read — a new `io` call on the send
path — which buys nothing in a stage where every non-Claude kind refuses anyway. So: the header
bullet now names `HARNESS_CAPABILITIES` as the owner of the fact and forbids restating it, and the
inline refusal sentence is **left for a follow-up**, by agreement with `fleet-approval-binding`
(restructuring that file the same afternoon) and `claude-agents-dashboard`. Nothing behavioural
waits on it.

#### The cross-family review, and what it changed

GPT Sol, one round, high effort — prompt in
[260908f-stage-c-code-review-prompt.md](260908f-stage-c-code-review-prompt.md), answer in
[260908f-stage-c-code-review-sol-r1b.md](260908f-stage-c-code-review-sol-r1b.md). It found **no P0**
and confirmed the stage adds no delivery path. It found four real defects, all fixed, and each fix
was then mutated back to check the new test catches it:

1. **P1, a false capability grant.** `claude --session-id abc --print do the thing` classified as
   `claude-code`, and the table then granted prose steering on a headless run — the exact lie the
   stage exists to prevent, sitting in the recogniser, because it anchored on the *first* argument
   only. The parser now walks the whole leading option region; `--print` wins; and it stops at the
   first bare word so a *prompt* containing `--print` cannot flip a live session to headless.
2. **P1, Codex mode read from the wrong end of the line.** `codex --help` gives
   `codex [OPTIONS] <COMMAND>`, so global options come *before* the subcommand and
   `codex --model x review the diff` is a non-interactive review — which the anchored test called
   interactive, and which `work.ts` missed entirely. **A test in this repo pinned that wrong answer**;
   it is replaced. `parseCodexInvocation` now skips the option region, and refuses to eat a known
   subcommand as a flag's value. It also stops calling `codex mcp-server` / `codex login` an
   interactive Codex: utility subcommands are not a harness at all.
3. **P2, a malformed tree could return a *steerable* Claude.** Selection returned at the first level
   with a hit, so a cycle elsewhere was never reached. Structure is now validated over the whole
   reachable subtree *before* anything is selected — including before the depth-0 check, which used
   to answer for a self-parented pane without walking anything.
4. **P2, `why` could be empty.** A probe that failed without a sentence produced
   `{cause: "process-table-unreadable", why: ""}` — a greyed-out button with no reason beside it.
   Every `unknown` now goes through one constructor that refuses a blank.

Plus two contract corrections: `shell.command` is now actually truncated (the type promised it and
the code did not), and two comments that claimed more than the data supports were narrowed — the
`/tmp` guard checks the *spelling* of argv[0], not where the binary is, and `shell` is a claim about
argv[0]'s basename, not about the executable's identity.

**Deferred rather than fixed, with reasons:**

- **Sol's P3, a seventeenth hand-written join: `recogniseClaude` here and `isClaudeForSession` in
  `steer.ts` both read Claude's argv, and disagreed.** Sol is right, and the narrower half is fixed
  (this parser now reads `--session-id=abc`, which steer.ts accepted and it did not). Extracting one
  shared parser waits for `fleet-approval-binding`'s restructure, which Sol itself recommended.
- **Reading `/proc/<pid>/cmdline` for NUL-separated argv.** The right fix for the quoting problem,
  and refused for v1: it is a syscall per candidate against a process that may exit mid-read, which
  is a different design for the probe rather than a better parser. The cost is bounded and now has a
  test naming it — `codex 'review this diff'`, an interactive session with one prompt argument,
  arrives flattened and identical to a batch `codex review this diff` and is reported as batch. In
  v1 both answers refuse steering, so the cost is a wrong label rather than a wrong action.

**Sol's warning about the stage after this one, kept because it is the trap:** if
`codex-interactive` is ever flipped to `can: true`, this sequence sends prose to a *shell* —
classify `bash -l → codex`; the Codex exits; the shell takes the tty back; a stale capability
authorises `tmux send-keys`. **Do not implement that stage by changing one boolean.** It needs a
send-time identity check, or better, a session-addressed Codex control channel instead of tty
injection.

#### Two findings that are not this stage's to fix

**A paid Codex review can end up belonging to no session at all.** At 11:58, two of the three running
`codex exec` processes had an `npm exec` with `ppid 1`: the Bash-tool shell that launched them had
been reaped, leaving a 45-minute `gpt-5.6-sol --effort high` run reparented to init. They were in
`fb2c-feedback-button-on-homepage` and `command-bar-commands-and-place`. At 12:15 one orphan was
still running. **`work.ts` only ever walks DOWN from a pane, so it cannot see these** — the dashboard
cannot show them, attribute them, or stop them, and nothing bills them to anybody. That is a cost
question as much as an engineering one, and `claude-agents-dashboard` has it to surface.

**It is a WINDOW, not a leak, and the difference decides what to do about it.** The claim rests on the
**process lifecycle**, not on a count: an orphan is created when a Bash-tool shell is reaped while its
`run-codex.ts` child is still running, and it ends when that review ends. So the population is bounded
by the number of concurrent reviews and cannot grow on its own. **That argument would hold with zero
readings taken**, which is what makes it the load-bearing part. What is worth fixing is the window
during which a paid job cannot be attributed or stopped — not a growing population of abandoned ones.

Two walks are consistent with it and neither establishes it. At **13:03 UTC** the two live `codex exec`
runs (`fleet-dictation`'s and `fleet-approval-binding`'s) both traced up to an
`sh -c ( npx tsx run-codex.ts … )` whose parent is the **tmux server**, so both were ordinary
`codex-batch` *panes* — the shape `codex-batch-pane.txt` captures — attributable and stoppable;
`orchestrator-setup` walked every `ppid 1` process at **13:05 UTC** and found none.

**Those two readings are two minutes apart, not an hour**, and an earlier draft of this paragraph
presented them as independent corroboration because one was written in BST (14:05) and one in UTC
(13:03) with no note that the box runs UTC+1. Two observations two minutes apart are one observation
with a wide error bar. **This is the sample-window error for the third time in one stage** — first as
the Codex count, then as "two orphans are running right now" (which would have been false by the time
anybody read it), now as a timezone making two near-simultaneous readings look like a trend.

**And the third one is why "I have learned this" is not a defence.** The lesson as written above is
about *counting a population*; it recurred in the shape of *corroborating a claim*, which is the same
error wearing different clothes and did not trip the memory of the first one. The version that catches
both is mechanical rather than remembered, and it is the discipline everything else built today
already follows: **a fleet number carries the instant it was taken, in one timezone, in the sentence
itself** — the way `collectedAt` and `scannedAt` are fields rather than habits.

**One `ppid 1` process really is long-lived, and it is the fake.**
`bash /tmp/fake-codex-qAz9Um/codex -o /tmp/run-codex-gc.txt`, reparented to init **6 days 20 hours**
ago by a test run last week, 1.7 MB, costing nothing. It is a live specimen of exactly what the
recogniser is built not to be fooled by — still on the box, still carrying `codex` as a basename,
still correctly not recognised, because shells are never peeled and nothing under `/tmp` is an
installed tool.

**The process table cannot say which process is reading the tty, and that is now closed rather than
open.** Measured across all 22 panes: `tpgid` equalled the pane's own `pgid` on 21 of them, and **0
of 15 `claude` processes had a process group of their own** — the job shell, the `claude`, and
everything Claude shells out to share one group, because a non-interactive `bash script.sh` does no
job control. The 22nd pane is the positive control: the one interactive `bash -l`, where a
foreground child *does* get its own group, which is how we know the reading works.
`fleet-approval-binding` measured the same thing independently on three panes the same morning. So
**`HARNESS_CAPABILITIES` is a declaration about how a session was launched, not a verified fact about
who holds the terminal**, and it cannot be made into one at this seam. Named in `harness.ts`'s module
comment rather than left to be discovered.

### Stage D — box-health history (`fleet-health-history`)

The contract is [§ Where the health history lives](#where-the-health-history-lives-and-the-one-thing-owed-in-return)
above, and it is met. **Swap is not part of the work**: `SwapReading` already gives
`usedBytes`/`totalBytes`/fraction and the per-file breakdown, `SwapActivityReading` already gives
si/so and `activelySwapping`, and `health-view.ts` already draws the card. Greg's bullet asks for
*history*; the measurement exists.

**Built 2026-09-08. The plan, the review and what changed because of it:**
[260908f-box-health-history-24h-graphs-and-swap-retention.md](260908f-box-health-history-24h-graphs-and-swap-retention.md).

- Store: `tools/fleet/health-history.ts` — append-only JSONL under `~/.fleet-health/`
  (`FLEET_HEALTH_DIR`, absolute only), two files rotating at 8 MiB, `tools/overseer/jsonl.ts` for the
  append discipline and `tools/overseer/lock.ts` for the writer lock. The whole `HealthReport` is
  stored verbatim; there is no projection at the write boundary.
- Join: `tools/fleet/health-wiring.ts` is the single composition, called once by `server.ts`.
  `refreshOnce` gained `retainHealth`, `refreshMs` and `now`, and `refreshHealth` now returns what
  happened instead of `void`.
- Route: `GET /api/health/history?hours=` — gzipped, never downsampled.
- Panel: a verdict strip and four series under the tiles on Box health.

**What other agents should know:**

- `nextWaitMs(refreshMs, collectionFailed)` is exported from `refresh.ts` and is now the **one** copy
  of the backoff rule. `refreshLoop` in `server.ts` uses it, and so does every stored sample. Do not
  inline it again.
- **A break in the chart is never labelled with a cause.** It means no sample was written, which is
  the box, the dashboard, a hung collection, a failed append, or a restart. If you add a state here,
  it must not claim to know which.
- A `HistoryPayload` type sits in `routes-health-history.ts` awaiting `wire.ts`;
  `claude-agents-dashboard` owns that move.

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

#### What was built, and what it cost — `w2-fleet-dictation`, 2026-09-08

Written into this doc rather than a private one, per the brief. The rule above became:

> **Only LEAF, BROWSER-ONLY, PRODUCT-AGNOSTIC modules may be imported from `src/`.** Nothing that
> reaches the database, an auth session, a slug, an article, or a route under `src/routes.ts`. If a
> module is nearly leaf but for one product coupling, extract the coupling behind a parameter rather
> than importing the coupling.

**And it is a test, not a paragraph.** [`tests/fleet-imports.test.ts`](../../tests/fleet-imports.test.ts)
walks the fleet's whole transitive import graph and asserts the set of `src/` files it reaches is
**exactly** the twelve named below, each with a line saying what it is for. Adding a thirteenth is a
diff somebody reviews. It was watched failing — an `import { loadEnvLocal } from "../../src/env.js"`
in one fleet file took two of its five tests red — and its first assertion is a self-check on the
walker itself, because a closure walker that sees nothing looks exactly like one that found a leaf.

##### What the fleet now depends on, from `src/` — the cost of the move

**Direct**, what fleet files actually name: `src/web/useDictation.ts` (the microphone),
`src/web/useDictationField.ts` (the caret, the span, the closed box), `src/web/useAudioLevel.ts`,
`src/dictation-limits.ts` (the size caps, shared by both ends — what that file was built for),
`src/dictation-fillers.ts` (the ums), `src/vocabulary.ts` (`packTerms`, `MAX_TERM`, the fence).

**Transitive**, all leaves: `mic-lock.ts`, `mic-recording.ts`, `mic-devices.ts`,
`dictation-errors.ts`, `audio-level.ts`, and the new `src/web/transcriber.ts`.

**Twelve files, ~4,200 lines, and no external package beyond `react`.** That is what a move to its
own repo would carry, and it is small enough that a person would carry it by hand.

##### The one edge that had to be cut, and what it was worth

`useDictation.ts` imported `sendForTranscription` from `dictation-upload.ts`, which calls `apiFetch`
— and that one edge reached **21 files and 16,054 lines**, through `lib/api.ts` to
`@supabase/supabase-js`, `@sentry/core`, the offline store and the billing plan. So `transcribe` is
a parameter now (`Transcriber<C>` in the new leaf `src/web/transcriber.ts`) and `context` is opaque:
the hook snapshots it per session, travels it on a kept recording, and never looks inside.
`useDictation.ts`'s closure is now **8 files, 2,938 lines, `react` only**.

The six product boxes gained one line each (`transcribe: sendForTranscription`) and nothing else
changed. The two tests that drive the hook directly pass the real product transcriber in, so they
still exercise the whole upload path.

##### Not imported, and both would have been green all the way to the page

`DictationStrip.tsx` and `MicLevel.tsx` render against hand-written class names —
`prof-mic-note`, `prof-listening`, `mic-level` — from a stylesheet this page does not load. They
would typecheck, build, and render an unstyled button. `MicLevel` sat on the import list for an hour
on the strength of a grep for `className="` that could not see a template literal. So: **reuse the
machinery, write the chrome** — `tools/fleet/web/src/DictationControl.tsx`, which is also right on
the merits, since this page follows the device between light and dark and the product is dark
unconditionally.

##### The server half: measured out of contention, not ruled out on principle

`src/transcribe.ts` was the first candidate. Its closure is **161 files and 118,082 lines**, pulling
`pg`, `drizzle-orm`, `stripe`, `jsdom`, `@mozilla/readability`, `pino` and the Anthropic SDK into a
tool whose whole claim is that it runs with the product's server absent. Even the smallest useful
piece, `ai-call.ts`, is 20 files and 20,344 lines. So `tools/fleet/transcribe.ts` makes its own call
to `POST https://openrouter.ai/api/v1/audio/transcriptions` — still through the gateway, no second
one — borrowing the three files under `src/` that import nothing at all.

**The honest half of that ruling:** `transcribeWith` *is* free of the database at runtime, because
`ai-spend.ts` writes through a sink that is `null` unless the product's server installs one. Which
means going through it **would not have metered this spend either** — no `ai_calls` row, nothing for
`npm run cost`. The fleet's OpenRouter spend is invisible to the product's ledger whichever shape is
chosen. That is a property of being a separate tool, not a cost of this decision, and it is named
here rather than discovered later. A dictation is about $0.0005.

##### The vocabulary works, and a 200 would not have told us

`tools/fleet/vocabulary.ts`: `FLEET_TERMS` first (the box's own words — `worktree`, `tmux`,
`gjd-remote`, `Overseer`, `vitest`, the model names), then the live snapshot's session handles,
titles and directory leaves, most recently active first, with the named session promoted. Packed by
`packTerms`, which strips angle brackets and caps each term — a session title is a sentence a model
wrote about work that was often *"look at this hostile input"*, so it needs the same fence an
article title does.

Verified against the real gateway, because the evidence has to be the transcript changing rather
than the status code — OpenRouter's chat route accepted a `prompt` field for eleven days, answered
`200`, and changed nothing. [`tools/fleet/probe-transcribe.ts`](../../tools/fleet/probe-transcribe.ts)
sends one clip twice:

```
with the fleet vocabulary (2663 ms):
  Add this to Spideryarn please, the granularity zoom is fine …
with NO vocabulary (1226 ms):
  Add this to Spiderrion, please. The granularity zoom is fine, …
```

##### Which boxes, and the two that are deliberately left alone

| box | dictation? |
|---|---|
| **Say something to it** — the steering message, `SessionDetail.tsx` | yes, the main one |
| **New session** — the whole prompt an agent wakes up with | yes |
| **Rename** — a session's name, `SessionDetail.tsx` | **no** |
| Overseer message, `OrchestratorPanel.tsx` | **there is no box** |

**The rename field gets no microphone.** A misheard message reaches an agent that can ask what you
meant; a misheard *name* is silently wrong and sticks, and the Save button already warns that saving
the same name again is not a no-op. `claude-agents-dashboard` reached the same call independently.

**`OrchestratorPanel.tsx` has no message box and this work does not add one.** Its own header says
why: there is no Overseer process, so a box there *"would swallow what you typed and look like it
had worked, which is the one thing this page is built not to do"*. A microphone on a box that does
not exist is not a smaller version of that lie.

##### The finding that decides whether this works at all: the tailnet is not a secure context

**`getUserMedia` requires a secure context, and the address Greg's phone uses is not one.** Measured
on the box, 2026-09-08 — one Chrome, one fleet server bound to both addresses:

```
http://127.0.0.1:8802/       isSecureContext true,  navigator.mediaDevices present
http://100.92.255.119:8802/  isSecureContext FALSE, navigator.mediaDevices ABSENT
```

`127.0.0.1` and `localhost` are trustworthy by exception, so dictation works over the ssh forward
Greg uses from his laptop. The tailnet address is CGNAT (100.64.0.0/10) and is on nobody's
trustworthy list. So on the **phone** — the surface this page exists for — `supported` is false, and
the first draft of `DictationControl` returned `null`: no button, no error, nothing to search for.
That would have been the fifth silently-dead feature in this tool in a day. It now says which of the
two reasons it is, because only one has a fix and **the fix is not code**.

**This changes an argument that is already open.** Whether enabling the systemd unit should widen the
bind to the tailnet was being weighed as a *security* question. This makes HTTPS on the tailnet —
`tailscale serve` — a **feature prerequisite**: without it a whole class of browser capability is
absent on the only surface Greg reads this page on. Passed to `claude-agents-dashboard` and
`orchestrator-setup`, who own that decision.

A second, smaller one from the same browser pass: `tools/fleet/headers.ts` sent
`Permissions-Policy: microphone=()` on every response, which blocks the microphone at document level
independently of any of the above. Its own comment had predicted the change and predicted the wrong
route to it — *"when it lands, `microphone=(self)` goes here deliberately rather than by discovering
that the feature does not work"* — and it was discovered the second way, by one console line under a
button whose failure was indistinguishable from this box having no audio hardware.

##### What is verified, and what only Greg can verify

| | |
|---|---|
| The server half, end to end against the live gateway | **verified** — see the A/B above |
| The `keywords` array reaching the model and changing the transcript | **verified** |
| The bundle carrying dictation and not Supabase | **verified** — `grep -c supabase` on the built JS is 0; `mic-no-tape`, `mic-unplugged` and `api/transcribe` are all present |
| The import rule holding | **verified** — the test, watched failing |
| The route's Origin check, size cap and format refusal | **verified** |
| The tailnet address not being a secure context | **verified** — measured in Chrome at both addresses |
| **A microphone opening** | **NOT verified, and cannot be from this box** |
| **A real transcript landing in a real box from real speech** | **NOT verified** |
| **That any of it works on the phone** | **NOT verified, and today it will not** — see the secure-context finding above |

There is no audio input device on this box and Chrome's fake-microphone flags do not work headless
here. Everything past *"Opening the microphone…"* is Greg's to check from his own phone or laptop.

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

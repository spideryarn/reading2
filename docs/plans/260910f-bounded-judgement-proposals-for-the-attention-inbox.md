# 260910f — Bounded judgement: find prose questions and propose help

The roadmap stage is
[260908f § Stage: Bounded judgement](260908f-overseer-and-fleet-improvement-roadmap.md#stage-bounded-judgement-find-prose-questions-and-propose-help);
its five checkboxes and acceptance paragraph are the spec. Dispatched by the Overseer on 2026-09-10 as
queue item `qi-n5mt6p2a`. Owner of this plan: session `bounded-judgement`, worktree
`.claude/worktrees/bounded-judgement`.

**Revised 2026-09-10 after GPT Sol's plan review**
([findings](260910f-bounded-judgement-proposals-for-the-attention-inbox-plan-review-sol-findings.md)), which
refused the first draft on seven P1s. Every finding is disposed of in § The review, below; the
decisions here are the revised ones.

## What this is for

The attention inbox already finds prose questions: `tools/overseer/attention-classify.ts` asks
`openai/gpt-5.6-luna` whether each newly-ended turn handed a person a decision, cached by the tail's
fingerprint, at most 12 calls a pass. The roadmap's status table says what is missing: *"the detector
and its call budget run, but there is no typed proposal with a recipient and no routing to Sol or
Fable"*. Gate 4 of [overseer.md](../project/overseer.md) adds the second gap: there is a per-pass
ceiling and **no per-day one, no cooldown, and no exhausted state**.

So this stage adds three things to the existing detector rather than building a second one:

1. **A proposal per surfaced prose question**: the sentence that asks, why it needs somebody, and who
   holds the information — per
   [overseer-direction.md § Route by who has the information](../project/overseer-direction.md#route-by-who-has-the-information-not-by-confidence).
   Shown on the card, attributed to the model that proposed it. **Nothing is sent to anyone.**
2. **A day budget** that every paid attention call goes through, daemon or CLI, held in a file beside
   the checkpoint, with a cooldown after a quota refusal and a *limited* state the inbox shows.
3. **An evaluation**: the labelled set extended with the six cases the roadmap names, scored against
   the mechanical inbox, plus measured cost — and a plain answer to whether the proposals are worth
   it.

**This stage proposes; it never sends steering or approvals, and no proposal becomes Greg's voice.**

## What already exists, and what this reuses

| Piece | Where | Reused as |
|---|---|---|
| Ended-turn tail + fingerprint | `tools/overseer/turn-tail.ts` | the classifier's input, unchanged |
| Question classifier, gateway client, `callCost` | `attention-classify.ts` | **the only paid call**, widened when proposals are on |
| Per-pass plan + cache, `CacheableVerdict` | `planClassifications`, `attention-memory.ts` | cache gains a prompt version |
| Pass + accounting | `attention-pass.ts` | reserves each call against the day budget |
| Kernel-backed exclusive claim | `tools/overseer/lock.ts` | the budget lock |
| Wire + three parsers | `wire.ts`, `store.ts`, `tools/fleet/attention.ts`, `web/src/types.ts` | a `limited` list arm; a `proposal` item field |
| Card | `web/src/AttentionPanel.tsx` | draws the proposal under the `why` |

## Decisions (and the simpler options passed over)

**D1. One classifier call, widened when proposals are on** — Sol's F7, replacing the first draft's
separate proposer. With proposals off, the prompt, version and output are exactly today's. With
proposals on, a proposal-aware prompt version's `asked:true` arm also returns `recipient`, `reason`
and a verbatim `asks`, validated through the same closed union. Enabling it makes one bounded cold
re-read of the fleet under the day budget. The first draft's second call was passed over because it
cost a module, a second cache lifecycle, a second failure state and a second billable request for
every positive, to buy a switch that a prompt version buys for free. **If the evaluation shows the
widened prompt damages question detection**, that is the trigger to split it — measured in Stage 3.

**D2. No new paying file.** The transport stays in `attention-classify.ts`; the ALLOWED entry in
`tests/no-undeclared-spend.test.ts` and the `UNMETERED_SPEND` row both say a second file under
`tools/overseer/` would be a fork. The declaration is the existing row, amended with the day ceiling.

**D3. The cache key is fingerprint + prompt version; only successful judgements are cached.** The
roadmap says *"execution + content hash + classifier version"*. The pass has no execution token, and
the existing design keys on the tail alone on purpose so two sessions that ended identically cost one
call; what the key must cover is **everything the model is shown**, and that is the tail and the
prompt. Sol agreed this is sufficient for a pure model judgement (its note on D3). A verdict from
another prompt version is **stale, not absent**: it still places the item in the inbox — which is
today's behaviour — and is re-read first when the budget allows, with its proposal shown as
`not-reached` until then. **If that re-read is attempted and fails or is refused, the card stays
but its sessions count as not judged** (Sol's F12 and the sweep behind it), so the list is a floor
rather than calm; a stale verdict the pass never reached, past `maxCalls`, is not counted. Treating it as absent would make every question vanish into *at least N*
on the pass that enables proposals. **Failures are never cached** (Sol's F3), which the existing
`CacheableVerdict` already enforces by type: a 429, an unreadable answer, and a proposal whose `asks`
is not in the tail are all `unreadable`, and `unreadable` cannot be stored.

**D4. The budget is hard, global and shared by every process** — Sol's F1. `model-budget.ts` is the
only way to a paid attention call, daemon or CLI:

- **Reserve before, settle after, under one lock.** Under a budget lock taken with `lock.ts`'s
  `O_CREAT|O_EXCL` claim, `reserve` refuses if one more call at its worst case (a hard output-token
  cap sent as `max_tokens`, and a worst-case cost constant) would cross the global or component
  ceiling for calls, prompt tokens, completion tokens or cost; otherwise it persists and fsyncs the
  reservation, then releases the lock. `settle` re-takes it and replaces the reservation with the
  gateway's numbers; an unpriced call settles at the worst case. **A crash between the two leaves
  the worst case spent.** The lock is *not* held across the request, which is where this departs
  from Sol's wording: a 30-second call would block the other process for no gain, because the
  persisted reservation already makes the second process see the first's spend.
- **Refuse loudly, never reset.** A `model-budget.created` marker (the pattern `reports.ts` uses)
  means an absent or unreadable ledger after initialisation refuses until the next UTC day, rather
  than starting empty and re-granting a spent day. A ledger dated *after* today (the clock went
  backwards) refuses too. A reservation records its day and settles into it across midnight.
- **`--no-write` controls attention memory only**, never budget accounting: a hand run of
  `overseer attention` spends against the same ceiling as the daemon.
- **One named exception: the evaluation** (`scripts/attention-eval.ts`) reserves against a day
  budget of its own in a fresh temp directory, so scoring the labelled set can never spend the
  daemon's day — and so is outside the daemon's ceiling. It is bounded by its own ledger and by the
  labelled set's size (25 items, cents), and it runs only when a person runs it.
- **One call in flight** within a process (the pass is already sequential); the lock covers two.
- **Starting ceilings, proposed rather than known:** global 1,500 calls / 3,000,000 tokens / $1.50 a
  UTC day, from the measured $0.50–1.00/day in `src/spend-declarations.ts`; per pass the existing
  12. These are the number put to the Overseer before proposals are enabled on the live daemon.

**D5. Quota-aware refusal = the gateway's own answer.** `classifyTail` reports a 402 or 429 as a
distinguishable arm, not only as prose; the budget sets a cooldown (15 minutes, doubling per
consecutive strike to a 2-hour cap; a success clears it), and every tail that pass did not reach is
unclassified with that reason. No probe of OpenRouter's key endpoint in v1.

**D6. A stopped model pass is a new list arm, not a warning field** — Sol's F2, which found that all
three parsers project known fields and ignore extras, so an additive `judgement` field on an empty
list would draw *nothing is waiting on you* on every older reader. So: when the day ceiling or a
cooldown refused at least one call, the pass publishes `kind:"limited"`, carrying the items it did
find, the counts, and `stopped: {kind:"exhausted"|"cooling-down", why, until}`. **An older reader
rejects an unknown kind into its own loud `unknown` state** (checked in each parser, and pinned by a
test per parser); a newer reader draws the items with one line saying the inbox is not being fully
judged and until when. `kind:"list"` keeps exactly its present meaning — fully judged within the
pass's own budget — so an older producer's list needs no reinterpretation, which is where this
departs from the second half of Sol's F2 (reading an old `list` as unknown would blank the live
inbox between a dashboard restart and a daemon restart, for no gain in honesty). The mechanical half
keeps running regardless — gate 4: *the cheap deterministic tick must keep working when the budget is
exhausted*.

**D7. Default off.** `OVERSEER_PROPOSALS=1` in the daemon's environment, or the same variable on a
hand run, selects the proposal-aware prompt version; without it every prose item carries
`proposal: {kind:"off", why}`. The day ceiling is put to the Overseer as a number before anybody sets
the variable on the live daemon. The budget itself (D4–D6) is **on** for the existing classifier,
because it only ever refuses.

**D8. Five recipients and a visible "unplaced"** — Fable, 2026-09-10. `sol | fable | greg | overseer |
self`, and a separate `unplaced` arm. `overseer` is the direction doc's own arm — *"the Overseer
answers only what it can verify"* — and `self` is the agent that already has what it needs and
stopped out of habit. **`unplaced` and `self` never promote to `greg`**: *"defaulting to Greg would
make the inbox look the same with and without the feature, which is the one thing you're trying to
measure."*

**D9. Attribution is stamped by the producer, never written by the model** — Sol's F4. `by` is
`{kind:"model", model: ATTENTION_CLASSIFIER_MODEL, via:"overseer"}`, set by the code that made the
call; the card reads *"Proposed by openai/gpt-5.6-luna via the Overseer — nothing has been sent."*
No rendered arm uses Greg as a speaker.

**D10. Live marks are deferred; v1's judgement is the evaluation artefact** — Sol's F9, taking the
fallback it offered. Fable wanted the veto recorded (*"(a) is not vetoable, it is ignorable … an
unrecorded veto teaches nothing"*), and the first draft had a mark CLI writing into the store. Sol
showed that is a second writer with no protocol — no lock, no init marker, no lost state — and that
**a silently lost `wrong` mark is a lost veto**, which is worse than none. Doing it properly means a
daemon-drained submission inbox and a loss-detecting event log, and `daemon.ts` is not this stage's
file. So: **this stage records its judgements in the evaluation artefact** (every proposal on the
labelled set, marked right or wrong against the labels, by us), and the card says *"nothing has been
sent"*. A live veto matters from the moment something *acts* on a proposal, and it arrives with the
stage that sends — the roadmap already requires that stage to get a concrete autonomy change from
Greg and to preserve attribution and durable receipts. Fable's own hedge made the same point: *"the
eval set you're already labelling is the judgement for v1."* **For the Overseer:** the roadmap's
"vetoable" is met only in the weak sense until then.

**D11. Work reports inform the evaluation, not the runtime** — revised on Sol's F5. The first draft
let a session's own `blocked --on greg` report replace the proposer call. Sol showed the join was
unsound (`execution` is frozen at receipt, so a claude relaunched under the same name inherits the
report, and corrected reports were not excluded), and D1 removed the call it saved. A sound runtime
join needs the register's verified execution token carried into the pass — which lists tmux, not
the register — and would save nothing once there is one call. So in v1 the evaluation compares what
the model surfaced with what sessions reported, which is the roadmap's own question (*"if the model
cannot improve on explicit reports at reasonable cost, retain reporting/manual triage"*). The brief
asked the detector to read reports before spending; this is the reason it does not, for the
Overseer to overrule.

**D12. Misdirection is out of scope for this detector; concluded work is not** — Fable, then an
interim Sol finding that its final answer withdrew once it saw the labelled set already did this. The wrong-task fixtures (including *"done — I skipped the gates"*, which is misdirection wearing
a debrief) are `out-of-scope-for-this-detector`, **excluded from precision and recall**, and the
eval says *"N of M labelled items are misdirection; this stage detects 0 of them by design."*
Concluded work, background review, rhetorical questions and permission defects are scored. A debrief
holding a genuine cleanup decision (*"shall I remove the worktree?"*) is a positive; one ending on an
optional offer is a negative.

**D13. `asks` must be the agent's own words.** It must be a substring of the tail the classifier
read (after whitespace normalisation) — `readTurnTail` has already cut after the last user prompt, so
a proposal cannot quote Greg's own sentence back as the agent's. Fable's first named risk.

**D14. `reach` is a live projection, never cached** — Sol's F8. Recomputed each pass and not part of
the proposal id: `greg`, `self` → available; `fable` → unavailable when the checkpoint's usage
verdict is `limited`, else not-checked; `sol`, `overseer` → not-checked, because the checkpoint
carries no Codex reading. **Missing capability is shown, never substituted**: a Fable question whose
Fable is unavailable still says Fable.

## The shape

```ts
// wire.ts — appended
export type ProposalRecipient = "sol" | "fable" | "greg" | "overseer" | "self";
export type ProposalReach =
  | { kind: "available" } | { kind: "unavailable"; why: string } | { kind: "not-checked"; why: string };
export type ProposalAuthor = { kind: "model"; model: string; via: "overseer" };
export type AttentionProposal =
  | { kind: "proposed"; id: string; recipient: ProposalRecipient; reason: string; asks: string;
      by: ProposalAuthor; reach: ProposalReach }
  | { kind: "unplaced"; id: string; why: string; by: ProposalAuthor }
  | { kind: "off"; why: string }            // proposals not enabled (the default)
  | { kind: "not-reached"; why: string }    // stale verdict not yet re-read, budget, cooldown
  | { kind: "not-applicable" }              // a dialog: observed, answered in the detail pane
  | { kind: "not-reported" };               // parsed from an older producer

// AttentionItem gains `proposal: AttentionProposal` (older parsers drop it: poorer, not wrong).
// AttentionList gains a third arm:
  | { kind: "limited"; items; sessionsScanned; sessionsUnreadable; scannedAt;
      stopped: { kind: "exhausted" | "cooling-down"; why: string; until: string } }
```

`id` is `fingerprint + prompt version`, so a proposal keeps its identity across republishing and a
later stage's mark or veto can be keyed to it. No `mark` field in v1 (D10).

## Stages

Implementation by Opus subagents (the brief: Codex is the tighter budget). Sol reviews each stage
once, read-only, findings first to `<answer>-findings.md`; an Opus subagent fixes what it finds; P1
fixes get one narrow 20-minute check, then Fable, and no further round.

### Stage 1 — the labelled set, the budget, and the `limited` state

- [x] **1a. The labelled set.** 14 new fixtures, 24 labelled items, `tools/overseer/attention-labels.ts`
      (`mechanicalInbox`, `scoreMechanical`), `tests/overseer-attention-labels.test.ts`, seen red
      first; Opus subagent; `ac02c4c9`. **The mechanical baseline: 3 of 8 questions caught, 1 false
      alarm in 9 non-questions** (a rhetorical question at the end of a turn). The three it catches
      all end in `?` — two `overseer`, one `self` — so **every question for Sol, Fable or Greg in the
      set is invisible without a model**, which is the case for this stage in one line.
- [x] **1b.** Relabel per D12 (the premature-done fixture's category is misdirection) and add one
      positive: a debrief holding a cleanup decision.
- [x] **1c. Prompt version in the key** (D3): stale-not-absent, re-read first; failures uncached.
- [x] **1d. The ledger** (D4, D5): `model-budget.ts` with lock, init marker, reserve/settle,
      `max_tokens`, cooldown, the CLI and the daemon both through it. Tests race a daemon-shaped and a
      CLI-shaped caller on one ledger, crash between reserve and settle, cross UTC midnight, delete
      and corrupt an initialised ledger, and move the clock backwards; none may exceed or reset.
- [x] **1e. The `limited` arm** (D6) through `wire.ts`, the three parsers, `questions.ts` and the
      panel's one line. A test per parser: the new producer's `limited` read by the parser as it was
      before this stage (the arm rejected into `unknown`), and by the new one.

**1b–1e, as built** (Opus subagent; every listed test seen red, most by mutating the code after it
went green). Where it departed from the brief, each accepted:

- **`closed: {why, at} | null` on the ledger** — the "full ledger saying why" for a lost or torn day.
- **A third refusal, `unavailable`** — the budget lock could not be taken, or the write failed. The
  tail goes unjudged and the list stays a `list` with *at least N*, because there is no honest `until`
  to publish a `limited` against.
- **`classifyTail` clips over-long input, keeping both ends** (a dialog's material can be a whole
  diff), so the worst-case prompt bound holds; **a call that dies in flight settles as unpriced at the
  worst case**, since it may have been billed; a 402/429 or other error response settles at $0.
- **Constants**: `MAX_COMPLETION_TOKENS` 1,000 (sent as `max_tokens`), `WORST_CASE_CALL_USD` $0.01;
  the 3M-token ceiling is prompt plus completion.
- `ATTENTION_MEMORY_SCHEMA` not bumped (a pre-version memory reads with every verdict stale; the
  comment says why). An empty `limited` list publishes as `limited`, not `unknown` — it is already
  loud. A stale verdict whose re-read fails keeps its card — **and, after F12, counts its sessions
not judged**.
- **Two files outside the brief**, both forced by exhaustive switches over `AttentionList.kind`:
  `tools/overseer/status-cli.ts` (`inboxLines`) and `tools/fleet/web/src/QuestionsPanel.tsx`.
- **Not covered by a test**: `runAttentionCommand` end to end (it needs tmux). That a `--no-write`
  hand run still goes through the budget rests on a structural test that only
  `attention-classify.ts` and `model-budget.ts` name `classifyTail` anywhere in the tree.
**Sol's Stage 1 review** ([findings](260910f-bounded-judgement-proposals-for-the-attention-inbox-stage1-review-sol-findings.md)),
read-only, of `f03d5571`: **stopped by the provider's content filter after about nine of its thirty
minutes** (*"This content was flagged for possible cybersecurity risk"* — most likely its own
reproduction scripts for the lock race), with no closing answer. Two established P1s before it
stopped, both confirmed by reading the code:

| ID | Finding | Disposition |
|---|---|---|
| F11 | a second budget instance can `settle` a reservation it did not mint, freeing its worst case and granting past the ceiling | **fixed**, reproduced red first — each `modelBudget(...)` keeps a private set of the ids it minted; `settle` refuses any other, and an id leaves the set only after a persisted settle. The midnight test now crosses midnight on one instance, since settling through a second is what F11 forbids |
| F12 | an `unavailable` refusal while re-reading a STALE `no-question` publishes a calm empty list, because a stale verdict counts as judged | **fixed**, reproduced red first — a tail the pass tried to re-read counts as judged only if it got a usable answer THIS pass; the stale card stays either way |
| F12b | (the fixer's sweep, same class) a stale re-read that was made but came back unusable — unparseable, a 429 — kept its card and did not count the session | **fixed** by the same change, seen red; this **reverses a test expectation** recorded in 1b–1e, and D3 now says so |

Opus subagent. Scoped suites 266/266, typecheck clean.

**Sol's narrow check of the two fixes** ([findings](260910f-bounded-judgement-proposals-for-the-attention-inbox-stage1-p1-check-sol-findings.md)),
read-only, of `2eccd2a6`: **both hold, no new findings.** Its own reproductions now print
`stolen:false` / `secondGranted:false` for F11; for F12 it ran the five stale × outcome cases (stale
`no-question` + `unavailable` → `unknown`; + `stopped` → `limited` with one unjudged; stale question +
`unavailable` → the card kept and one unjudged; + `stopped` → `limited`, card kept; + a successful
re-read → nothing unjudged). **Stage 1 is closed** — one review, one narrow check, then Fable, per the
brief, and no further round.

**Fable, on the two properties Sol's stopped review never reached** (read-only, of `2eccd2a6`):
**the cooldown holds** — it starts only on 402/429, ends when `until` passes (pinned 15m → 30m → 1h
→ 2h → 2h → grant), carries across a new day and a second process, and cannot run away, because a
cooldown refuses every reserve and so admits no further strike; and **the verdict cache holds** — no
failure reaches it by any route (the pass writes only under `isCacheable`, the type excludes both
failure arms, the memory parser refuses a file holding one), and a stale verdict is always re-read
ahead of fresh tails and stays stale when the re-read fails. Two P2s, recorded rather than fixed,
since neither shows a reader anything false:

- **A 429 on the pass's last tail** publishes a `list` with that session unjudged (*at least N*),
  not `limited`; the next pass, two minutes on, says `cooling-down`. Fix if it matters: `strike`
  returns the cooldown it wrote and the pass sets `stopped` from it.
- **A tail that always fails** takes a re-read slot every pass, and twelve of them would starve fresh
  tails until their panes change — the price of *failures are re-asked*, bounded by the day ceiling
  and counted in `overBudget`. A per-fingerprint backoff if it ever bites.

**Not reviewed by Sol, because of the stop:** attack items 4 (a cooldown that never starts or never
ends) and 5 (a stale verdict never re-read, or a failure cached). The narrow P1 check covers the two
fixes only, per the brief; Fable reads items 4 and 5 independently afterwards.

- Lint is advisory here: `Published` in `AttentionPanel.tsx` now trips
  `noExcessiveCognitiveComplexity` with the `limited` branch added; the rest of the file-level
  findings are the repo's `u["kind"]` idiom and pre-existing `useYield`s.

### Stage 2 — the proposal

- [x] The proposal-aware prompt version, `OVERSEER_PROPOSALS`, strict parse (unknown recipient ⇒
      unreadable, never a default), `asks` substring check, producer-stamped `by`.
- [x] `AttentionItem.proposal` in `wire.ts` and the three parsers; absent ⇒ `not-reported`.
- [x] `reach` projected each pass from the checkpoint's usage (D14).
- [x] `AttentionPanel.tsx`: the proposal under the `why`; the `asks` quote as the card's evidence
      (which fixes the panel's standing *"taken by position, not by search"* defect); attribution;
      *"nothing has been sent"*.
- [x] `src/spend-declarations.ts`: the row amended with the day ceiling and the widened prompt.

**As built** (Opus subagent; 74 new tests seen red before any code, and the prompt-version plumbing
checked by breaking it three ways — each break went red on exactly its test). Scoped suites 1,060 of
1,060 across 20 files, typecheck clean. Departures, each accepted:

- **The quote does not replace the tail; it sits above it.** The plan said *"in place of"*. The quote
  is the evidence a person acts on, labelled *"the sentence this proposal is about"*; the tail stays
  behind its disclosure, caveat and all, because it is what the model's inference is checked against.
- **`ATTENTION_MEMORY_SCHEMA` 1 → 2**, as that file's own rule requires. This build reads both;
  rolling back to Stage 1's build rebuilds the memory once, at a few cheap calls.
- **A verdict is rebuilt from known fields before it is cached**, so a stray `by` in the model's
  output is never remembered, let alone shown.
- **The worst-case prompt bound is the larger of the two versions**, so a reservation covers the
  longer version-2 prompt; `model-budget.ts` itself unchanged.
- **Greg as recipient reads *"Proposed: this one is yours"***, never "Greg"; an unavailable holder
  shows *"· not available now"* on the card as well as in its tooltip; `unplaced` needs no quote.
- `OVERSEER_PROPOSALS` is read by one function, `proposalsEnabled()` (exactly `"1"`), and both
  compositions take injected seams so `tests/overseer-attention-cli.test.ts` drives each as composed.
- **Not checked in a browser at 390px** — the layout only wraps and breaks words, and the render
  test covers the content. Browser work goes to a Sonnet subagent here, and Sonnet is rate-limited
  on this account until 2026-09-12. Recorded as unverified.

**Committed at `652b5a3d`.** The full suite on it: 1,023 files passed, 4 failed — exactly the four
known environment files (`cold-start-lazy-imports`, `pdf-bundle-trace`, `fleet-decisions-route`,
`fleet-reports-route`), so green bar the environment; log
`logs/tmux-jobs/bj-s2-fullsuite-1935-617892.log`. The Sol stage review waited out the Overseer's
pause for the five-hour window (19:1x–19:53Z) and runs after the next merge of `dev`.

### Stage 3 — the evaluation, and the answer

**Machinery built ahead of Stage 2**, because it touches only new files: `tools/overseer/attention-eval.ts`
(`evaluate`, `describeEvaluation`, a documented fake classifier, `paidEvalClassifier` — a day budget
of its own in a fresh temp directory, so an evaluation never eats the daemon's day),
`scripts/attention-eval.ts` and `tests/overseer-attention-eval.test.ts` (16 tests, seen red); Opus
subagent. It could not read the key without a second file naming the credential, so **I added
`readGatewayKey()` to `attention-cli.ts` myself** (a few lines) — the one reader, now used by the
hand run, the daemon's runner and the evaluation alike. Routing counts only question verdicts on
scored items; `unplaced` is counted apart from N; W splits into *wrong holder* and *asked on a turn
that asked nothing*.

- [ ] **Blocked in this session — needs someone whose environment holds the key.** The gateway key
      is not in this session's environment, and the worktree isolation guard refuses exporting it
      from `.env.local` (it will not set a credential from command output). That refusal is right,
      and it is not worked around here. The command, for anyone whose shell already has
      `OPENROUTER_API_KEY` exported:
      `npx tsx scripts/attention-eval.ts --prompt-version 1 --out docs/plans/260910f-bounded-judgement-proposals-for-the-attention-inbox-eval-v1.json`
      and the same with `--prompt-version 2 … -eval-v2.json`. Each run reserves against a day
      budget of its own in a fresh temp directory, about twenty calls, a few cents. **What exists
      without it**: the `--fake` run, which proves the plumbing and not the model (it answers from
      the labels, perturbed: 8 of 9 questions, 2 false alarms, against the mechanical inbox's 3 of 9
      and 1), and the mechanical baseline itself, which is real — every question for Sol, Fable or
      Greg in the set is invisible without a model.
- [ ] Run both prompt versions for real over the labelled set (cents). Report **detection** for each
      (does the widened prompt damage it? — D1's trigger) and, for the widened one, routing
      accuracy. Sol's F6 wording: *N proposed; R correct against the labels; W wrong; K of the R
      correct named a non-Greg holder* — `K` is **"could have avoided asking Greg"**, and actual
      avoided waiting is **not measured**, because this stage sends nothing. Decision metrics:
      routing accuracy among judged items, correct non-Greg routes per true question, coverage, and
      cost per correct non-Greg route.
- [ ] A read-only census of the live fleet (`overseer attention --dry`) for the population sizes,
      and the reports comparison (D11): how many sessions waiting on Greg had said so in a report.
- [ ] The answer: does the model beat explicit reports at reasonable cost? If not, say so, leave
      proposals off, keep manual triage — a legitimate ending.
- [ ] Docs: the owning doc for the inbox gets the proposal and the budget; overseer.md's gate 4
      **NOT BUILT** block is narrowed to what is still unbuilt (the scheduler and recovery are not on
      the ledger) — overseer.md is a rule doc, so this goes to the Overseer as a proposed edit rather
      than being made here; the roadmap row updated.

## The review

GPT Sol, plan review of `6638d2bd` (rechecked against `ac02c4c9`), 2026-09-10, read-only and
independent (it ran `tests/fleet-attention.test.ts` itself, 24/24): refused on F1–F6 and F9 (P1),
with F7–F8 (P2). Answer: [plan-review-sol](260910f-bounded-judgement-proposals-for-the-attention-inbox-plan-review-sol.md).

| ID | Finding | Disposition |
|---|---|---|
| F1 | the budget has a CLI bypass and a crash gap | **fixed** — D4; lock held for reserve and settle, not across the request (argued there) |
| F2 | an additive `judgement` field is ignored by old consumers | **fixed** — D6, a `limited` arm and no field on `list`; the second half (old `list` read as unknown) declined, argued there |
| F3 | the proposal cache could store failures | **fixed** — D3; moot for a second cache after F7, and the existing type enforces it |
| F4 | `by`, report-derived and marks have no trustworthy speaker | **fixed** — D9; report-derived proposals and marks are gone (D11, D10) |
| F5 | `same-verified-run` at receipt does not join to the current run | **fixed by removal** — D11; Sol's answer agrees removal resolves it |
| F6 | `K/N` cannot measure avoided waiting | **fixed** — Stage 3 wording |
| F7 | the second call costs more than it buys | **accepted** — D1 |
| F8 | cached `reach` goes stale | **fixed** — D14 |
| F9 | the veto log has multiple writers and no write protocol | **accepted, by Sol's own fallback** — D10: live marks deferred, judgements in the evaluation artefact |
| — | (interim) concluded work wrongly out of scope | withdrawn by Sol in its final answer; the split is D12 |
| note | `proposals.jsonl` unnecessary | **accepted** — dropped |

## Status

**Stage 1 closed** at `44b9eb3c` (the budget and the `limited` arm, `f03d5571`; F11/F12 fixed,
`2eccd2a6`; the narrow check and Fable, above). The Stage 3 evaluation machinery landed early, at
`4380ff57`. `origin/dev` merged at `261b4759` — one conflict, in `store.ts`'s type import, where both
sides had added one name; resolved as the union, and checked with `git diff MERGE_HEAD` for any of
the other side's work going missing (none). **Stage 2 is being implemented.**

**The first full-suite run is not evidence either way**, and is recorded so nobody quotes it: it ran
on `f03d5571` while the F11 fixer and then the merge changed the tree underneath it. Six red: the four
known environment files (`cold-start-lazy-imports`, `pdf-bundle-trace`, `fleet-decisions-route`,
`fleet-reports-route`); the new F11 regression test, loaded before its fix landed — it passes 5 of 5
run alone on the current tree; and `doc-links`, which was real — this plan linked to the roadmap
heading as `…judgement--find…`, and the repo's slugger collapses the space run left by an em dash into
ONE hyphen. Fixed. The full suite that counts runs once, on the final commit, before the push.

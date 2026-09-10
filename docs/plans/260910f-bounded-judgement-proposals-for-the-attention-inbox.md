# 260910f — Bounded judgement: find prose questions and propose help

The roadmap stage is
[260908f § Stage: Bounded judgement](260908f-overseer-and-fleet-improvement-roadmap.md#stage-bounded-judgement--find-prose-questions-and-propose-help);
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
`not-reached` until then. Treating it as absent would make every question vanish into *at least N*
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
- [ ] **1b.** Relabel per D12 (the premature-done fixture's category is misdirection) and add one
      positive: a debrief holding a cleanup decision.
- [ ] **1c. Prompt version in the key** (D3): stale-not-absent, re-read first; failures uncached.
- [ ] **1d. The ledger** (D4, D5): `model-budget.ts` with lock, init marker, reserve/settle,
      `max_tokens`, cooldown, the CLI and the daemon both through it. Tests race a daemon-shaped and a
      CLI-shaped caller on one ledger, crash between reserve and settle, cross UTC midnight, delete
      and corrupt an initialised ledger, and move the clock backwards; none may exceed or reset.
- [ ] **1e. The `limited` arm** (D6) through `wire.ts`, the three parsers, `questions.ts` and the
      panel's one line. A test per parser: the new producer's `limited` read by the parser as it was
      before this stage (the arm rejected into `unknown`), and by the new one.

### Stage 2 — the proposal

- [ ] The proposal-aware prompt version, `OVERSEER_PROPOSALS`, strict parse (unknown recipient ⇒
      unreadable, never a default), `asks` substring check, producer-stamped `by`.
- [ ] `AttentionItem.proposal` in `wire.ts` and the three parsers; absent ⇒ `not-reported`.
- [ ] `reach` projected each pass from the checkpoint's usage (D14).
- [ ] `AttentionPanel.tsx`: the proposal under the `why`; the `asks` quote in place of the
      position-chosen excerpt when present (which fixes the panel's standing *"taken by position, not
      by search"* defect); attribution; *"nothing has been sent"*.
- [ ] `src/spend-declarations.ts`: the row amended with the day ceiling and the widened prompt.

### Stage 3 — the evaluation, and the answer

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

Stage 1a committed (`ac02c4c9`). Plan revised after Sol's review; Stage 1b–1e next.

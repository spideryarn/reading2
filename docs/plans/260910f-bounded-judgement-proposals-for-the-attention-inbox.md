# 260910f — Bounded judgement: find prose questions and propose help

The roadmap stage is
[260908f § Stage: Bounded judgement](260908f-overseer-and-fleet-improvement-roadmap.md#stage-bounded-judgement--find-prose-questions-and-propose-help);
its five checkboxes and acceptance paragraph are the spec. Dispatched by the Overseer on 2026-09-10 as
queue item `qi-n5mt6p2a`. Owner of this plan: session `bounded-judgement`, worktree
`.claude/worktrees/bounded-judgement`.

## What this is for

The attention inbox already finds prose questions: `tools/overseer/attention-classify.ts` asks
`openai/gpt-5.6-luna` whether each newly-ended turn handed a person a decision, cached by the tail's
fingerprint, at most 12 calls a pass. The roadmap's status table says what is missing: *"the detector
and its call budget run, but there is no typed proposal with a recipient and no routing to Sol or
Fable"*. Gate 4 of [overseer.md](../project/overseer.md) adds the second gap: there is a per-pass
ceiling and **no per-day one, no cooldown, and no exhausted state**.

So this stage adds three things to the existing detector rather than building a second one:

1. **A proposal per surfaced prose question**: the sentence that asks, why it needs somebody, and who
   holds the information — Sol, Fable, Greg — per
   [overseer-direction.md § Route by who has the information](../project/overseer-direction.md#route-by-who-has-the-information-not-by-confidence).
   Shown on the card, attributed to the model that proposed it. **Nothing is sent to anyone.**
2. **A day budget** the classifier and the proposer both spend against, held in a file beside the
   checkpoint, with a cooldown after a quota refusal and an *exhausted* state that the inbox shows.
3. **An evaluation**: the labelled set extended with the six cases the roadmap names, scored against
   the mechanical inbox, plus measured cost — and a plain answer to whether the proposals are worth
   it.

**This stage proposes; it never sends steering or approvals, and no proposal becomes Greg's voice.**

## What already exists, and what this reuses

| Piece | Where | Reused as |
|---|---|---|
| Ended-turn tail + fingerprint | `tools/overseer/turn-tail.ts` | the classifier's input, unchanged |
| Question classifier, gateway client, `callCost` | `attention-classify.ts` | the proposer's transport — **one seam**, per the ALLOWED entry's *"a second file here is a fork"* |
| Per-pass plan + cache | `planClassifications`, `attention-memory.ts` | cache key gains a classifier version |
| Pass + accounting | `attention-pass.ts` | runs the proposer after the verdicts |
| Wire + three parsers | `wire.ts`, `store.ts`, `tools/fleet/attention.ts`, `web/src/types.ts` | one new field on `AttentionItem` |
| Card | `web/src/AttentionPanel.tsx` | draws the proposal under the `why` |
| Session claims | `tools/overseer/reports.ts` `readReports` | evidence read before spending a call |

## Decisions (and the simpler options passed over)

**D1. A second, separate model call for the proposal — not a wider classifier prompt.** The simpler
option is to add `recipient` to the existing classifier's JSON. Passed over because the new call has
to be **default-off until Greg has seen the number** (the brief), and a field inside a call that is
already live cannot be switched off separately; and because it would re-classify every cached tail
the moment the prompt changed. The proposer runs only on *prose verdicts that said question* — a
handful a day — so its cost is bounded by the classifier's yield, not by the fleet's size.

**D2. The proposer lives in `attention-classify.ts`'s seam.** The gateway call is generalised to
take a prompt and a parser; `attention-propose.ts` holds the prompt, the parse and the types, and
imports the transport. No second `fetch` under `tools/overseer/` — the ALLOWED entry in
`tests/no-undeclared-spend.test.ts` and the `UNMETERED_SPEND` row both say a second file would be a
fork. The declaration is the existing row, amended to name the proposal call and its ceiling.

**D3. The cache key is content hash + classifier version, not execution.** The roadmap says
*"execution + content hash + classifier version"*. The pass has no execution token (it reads tmux,
and `SessionToScan` carries none), and the existing design keys on the tail alone on purpose, so two
sessions that ended identically cost one call. What the key must cover is **everything the model is
shown**, so the proposer's key is a hash of `(tail, the report claims shown, PROPOSER_VERSION)` and
the classifier's is `(fingerprint, CLASSIFIER_VERSION)`. A version bump re-asks; a verdict filed
under an older version is a cache miss, not a hit. Recorded as a deviation from the roadmap wording.

**D4. The budget is one ledger file with components, and the ceiling is global.** `model-budget.ts`
holds, per UTC day, calls / prompt tokens / completion tokens / cost / unpriced calls, per component
(`attention-classify`, `attention-propose`) **and a global ceiling across all of them**, plus
`cooldownUntil` and the last refusal. It is the seam gate 4 asks for, sized for the two components
that exist; the scheduler and recovery are not wired to it here (not this stage's files), and
overseer.md's **NOT BUILT** block stays until they are — the debrief says so.

**D5. Quota-aware refusal = the gateway's own answer.** A 402 (credits) or 429 (rate) sets a cooldown
(15 minutes, doubling to 2 hours) and every tail that pass did not reach is `unclassified` with that
reason, so the inbox reads *at least N* rather than calm. No probe of OpenRouter's key endpoint in v1.

**D6. Exhausted is loud.** When the day ceiling or a cooldown stops a pass, `AttentionList` carries
`judgement: {kind:"exhausted"|"cooling-down", why, until}` and the panel draws one line saying the
inbox is not being judged and until when. The mechanical half (dialogs, counts) keeps running —
gate 4: *the cheap deterministic tick must keep working when the budget is exhausted*.

**D7. Default off.** `OVERSEER_PROPOSALS=1` (daemon env) or `overseer attention --propose` enables
the proposer; without it every prose item carries `proposal: {kind:"off", why}`. The day ceiling is
put to the Overseer as a number before anybody sets the variable on the live daemon.

D8–D11 were arbitrated by Fable on 2026-09-10; its reasons are quoted where they decide.

**D8. Five recipients and a visible "unplaced".** `sol | fable | greg | overseer | self`, and a
separate `unplaced` arm. `overseer` is the direction doc's own arm — *"the Overseer answers only what
it can verify"* (pull latest; "are the tests red because of me?") — and `self` is the agent that
already has what it needs and stopped out of habit. **`unplaced` and `self` never promote to `greg`**:
Fable, *"defaulting to Greg would make the inbox look the same with and without the feature, which is
the one thing you're trying to measure."* The simpler three-recipient vocabulary was passed over for
that reason.

**D9. Vetoable means recorded: a two-verb mark, from a new CLI.** `npx tsx scripts/overseer-proposals.ts
mark <id> right|wrong [--why …]` appends to `proposal-marks.jsonl` in the store; the card then shows
the mark. Fable: *"(a) is not vetoable, it is ignorable … an unrecorded veto teaches nothing"*, and a
localStorage dismiss is *"a record that doesn't exist"*. `wrong` is the veto; `right` is the
denominator. A page button needs a route, which is outside this stage's files — a later stage reads
the same file. **Hedge, also Fable's:** Greg will rarely `ssh` in to mark, so the v1 judgement is the
labelled set in Stage 1, labelled by us; his marks are a bonus, not the design. A new script file
rather than a subcommand in `scripts/overseer.ts`, which another session owns.

**D10. A session's own `blocked --on greg` report replaces the proposer call; `completed` suppresses
nothing.** A report from the same verified run (`execution: "same-verified-run"`), received after the
tail's prose verdict was first cached, whose session name matches, makes the proposal
`{kind:"from-report", recipient:"greg", needs, eventId}` with no call. It does **not** create an item
on its own — the classifier still has to find the question — because a third evidence arm would move
every parser and the panel for a case the evaluation can count instead. `completed` does not suppress
classification: Fable, *"debriefs end with 'shall I remove the worktree?' constantly, that's an
irreversible question"*.

**D11. Misdirection is out of scope for this detector, and the eval says so in numbers.** The
wrong-task and concluded-work fixtures are labelled `out-of-scope-for-this-detector`, not
expected-negative, and are **excluded from precision and recall**: *"an expected-negative counts
toward precision; these are cases the detector is structurally blind to"*. The eval header reads
*"N of M labelled items are misdirection; this stage detects 0 of them by design."* The proposer is
not asked to flag them.

**D12. The proposer refuses when the speaker is not the agent.** `asks` must be a substring of the
tail the classifier judged — which `readTurnTail` has already cut after the last user prompt — so a
proposal cannot quote Greg's own sentence back as the agent's. Fable's first named risk.

## The shape

```ts
// wire.ts — appended; one new field on AttentionItem
export type ProposalRecipient = "sol" | "fable" | "greg" | "overseer" | "self";
export type ProposalReach =
  | { kind: "available" } | { kind: "unavailable"; why: string } | { kind: "not-checked"; why: string };
export type ProposalMark = { kind: "right" | "wrong"; at: string; why: string | null };
export type AttentionProposal =
  | { kind: "proposed"; id: string; recipient: ProposalRecipient; reason: string;
      /** The sentence(s) that ask, quoted from the tail — checked to be a substring of it. */
      asks: string;
      /** Which model proposed it, e.g. "openai/gpt-5.6-luna via the Overseer". Never "Greg". */
      by: string; proposedAt: string; reach: ProposalReach; mark: ProposalMark | null }
  | { kind: "unplaced"; id: string; why: string; by: string; proposedAt: string; mark: ProposalMark | null }
  | { kind: "from-report"; id: string; needs: string; eventId: string; receivedAt: string; mark: ProposalMark | null }
  | { kind: "off"; why: string }           // proposer disabled (the default)
  | { kind: "not-reached"; why: string }   // budget, cooldown, 429, unreadable answer, quote not found
  | { kind: "not-applicable" };            // a dialog: observed, answered in the detail pane
```

`id` is the proposal cache key, so a mark made against it survives republishing and dies with the
content it was about.

`asks` is validated as a substring of the tail (after whitespace normalisation) — a quote the
producer cannot find in its own evidence is refused to `not-reached`, because a card quoting a
sentence nobody wrote is the injection risk the classifier header already names. It also fixes the
panel's standing defect that the excerpt is chosen by position, not by content.

`reach` in v1: `greg` is always `available`; `sol` and `fable` are `not-checked` with the reason,
unless the usage report in the same checkpoint says the account is limited, in which case
`unavailable`. **Missing capability is shown, never substituted**: a Fable question whose Fable is
unavailable still says Fable.

## Stages

Implementation by Opus subagents (the brief: Codex is the tighter budget). Sol reviews the plan once
and each stage once, read-only, findings first to `<answer>-findings.md`; an Opus subagent fixes what
it finds; P1 fixes get one narrow 20-minute check, then Fable, and no further round.

### Stage 1 — the labelled set, the version in the key, and the day budget

- [ ] Extend `tests/fixtures/overseer-turn-tails/` with labelled cases for the six the roadmap names:
      prose question without `?`, rhetorical question, concluded work, background review, permission
      defect, working confidently on the wrong task. A `labels.json` beside them: expected verdict,
      expected recipient where it is a question, and what the **mechanical inbox** (dialog parse +
      `?` grep) says about it. Sanitised, hand-written from real shapes; no live pane is committed.
- [ ] `CLASSIFIER_VERSION` in the cache key; a verdict from another version is a miss. Red first.
- [ ] `model-budget.ts`: the ledger (D4), cooldown (D5), refusal before a call rather than after,
      one call in flight, and the pass reporting `judgement` (D6) through the list. Red first:
      a pass over a spent day makes zero calls and publishes `exhausted`, never an empty list.

### Stage 2 — the proposer, the projection, and the card

- [ ] `attention-propose.ts`: prompt, strict parse (unknown recipient ⇒ unreadable, never a default),
      `asks` substring check, cache keyed per D3, reports read first (D10).
- [ ] The pass runs it after the verdicts, for prose questions only, under the same budget.
- [ ] `AttentionItem.proposal` in `wire.ts`; all three parsers read it, and an absent field from an
      older producer parses as `off` with *"this Overseer predates proposals"*, not as a failure.
- [ ] `AttentionPanel.tsx`: the proposal under the `why` — *"Proposed: ask Sol — <reason>. Proposal by
      openai/gpt-5.6-luna via the Overseer; nothing has been sent."* — and the `asks` quote in place
      of the position-chosen excerpt when it is present. The veto per D9.
- [ ] `src/spend-declarations.ts`: the row amended (D2) with the proposal call and its day ceiling.

### Stage 3 — the evaluation, and the answer

- [ ] `scripts/overseer-proposals.ts`: `mark <id> right|wrong [--why]` and `stats` — the week in one
      sentence, Fable's number: *"N proposals, $X; R right, W wrong, U unjudged; K would not have
      needed Greg."* `K/N` is the decision value. The daemon appends each new proposal to
      `proposals.jsonl` so the week is countable.
- [ ] Run the classifier and proposer for real over the labelled set (cents), record precision /
      recall against the labels and against the mechanical inbox, cost per useful proposal, and a
      read-only `overseer attention --dry` census of the live fleet for the population sizes.
- [ ] Write the answer: does the proposer beat explicit reports at reasonable cost? If not, say so,
      leave it off, and keep manual triage — a legitimate ending.
- [ ] Docs: the owning doc for the inbox gets the proposal and the budget; the roadmap row updated.

## Status

Planning. Sol plan review next.

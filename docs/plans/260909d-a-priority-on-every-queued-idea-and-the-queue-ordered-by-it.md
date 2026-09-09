# A priority on every queued idea, and the queue ordered by it

**Status, 2026-09-09: written, not yet built.** Up:
[dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md) via
[overseer-queue.md](../project/overseer-queue.md). It continues
[260909b](260909b-queued-ideas-mode-the-overseer-queue-as-ndjson.md), which built the queue as an
append-only NDJSON log, and everything below obeys that file's central constraint: **the queue is not
a todo list, it is gate 3's authorisation record.**

## What Greg asked for

> For the Queued Ideas, it might be helpful to add a `priority` 0-1 (where 1 is very-high-priority)
> metadata field, so that important stuff can jump to the top. You can put all the Spideryarn product
> ideas as low-priority, so that if you run out of other stuff you can get to them, but focus on
> tooling for Overseer first, then web dashboard, and Spideryarn product stuff at the bottom.
>
> — Greg, 2026-09-09

Two things, and they are separable: a **field** on an item, and a **one-off application** of his
ordering to the live queue. The first is code and stays; the second is data and happens once.

## The three questions this has to answer before it writes a line

### 1. Is a priority *content*, or is it *ordering*?

It decides everything else, because 260909b made content sacred: **every content edit bumps
`revision`, and an approval names the revision it was granted for**, so a content edit by anyone but
Greg lapses his approval (Sol's P0-2). If priority is content, the Overseer applying Greg's own
banding to sixteen items would lapse Greg's approval on all sixteen and hand him sixteen re-approvals
to click through — the exact ceremony `idea-queue.ts`'s header says degrades an approval into a
click-through.

**Taken: priority is ordering, not content.** The argument, in the order it convinced:

- **The queue already has an ordering axis, and it does not lapse anything.** `moved` — `--front`,
  `--back`, `--before`, `--after` — is writable by the Overseer today and bumps no revision. A
  priority is a coarser spelling of the same intent. It would be incoherent for `move --front` to
  preserve an approval and `--priority 0.9` to lapse it.
- **Priority grants the Overseer no power it does not have.** It already picks which dispatchable
  item to take (the queue is explicitly not FIFO — *"Take an item only when the current focus has
  nothing dispatchable"*), and it can already `move` anything to the front. What priority adds is
  that the choice becomes **durable, attributed and visible** instead of living in one session's
  head. That is strictly more auditable than the status quo, not less.
- **What must not move, does not move.** Priority cannot promote an item past `authority`.
  `isDispatchable` is untouched: an unauthorised item at 0.9 sorts to the top of the list and is
  still not dispatchable, and the badge still says *proposal*.

**The residual risk, named rather than waved off: priority is a salience vector.** An Overseer
proposal at 0.9 sits at the top of the list Greg reads on his phone, which is a way of pressing for
attention that it did not have before. It is not an authorisation vector — the row says *proposal*
and nothing can dispatch it — and Greg explicitly asked the Overseer to apply his banding, so
capping what the Overseer may set would refuse the thing he asked for. It is recorded here, and every
`prioritized` event carries `by`, so *who pushed this up the list* is answerable.

### 2. A separate event kind, or a key inside `edited`?

**Taken: a new event kind, `prioritized`, parallel to `moved`.**

The alternative is `edited { priority? }` excluded from `changesContent`. That is the shape of the
bug Sol found in round two: `needsGreg` was a key inside `edited` that `changesContent` did not
count, and the consequence was `edit --by overseer --ready` clearing Greg's blocker with no revision
bump. The fix there was an actor asymmetry — a condition inside a function, which the next person
adding a fourth optional key has to know about. A separate kind makes the exclusion **structural**:
there is no way to write a `prioritized` event that accidentally counts as content, because
`changesContent` never sees one.

It costs one parse arm, one fold arm, one `describeTouch` arm — about thirty lines — and buys a
history line that reads `prioritised at 0.85` rather than `edited metadata`.

The CLI still spells it `edit --priority`, as briefed. When an `edit` names both `--text` and
`--priority` it appends **two events in one batch**; `appendEvents` already takes an array under one
lock, so the pair is atomic and the history is honest about there having been two acts.

### 3. What does an item with no priority mean, and where does it sort?

**Taken: `priority: number | null`, and `null` sorts below every stated priority.**

Three candidate defaults, and two of them put words in somebody's mouth:

| default | what silence would then mean |
|---|---|
| `0.5` | *"this is of middling importance"* — an opinion nobody expressed |
| `0` | *"this is worthless"* — a judgement nobody made |
| `null`, sorted last | *"nobody has said"* — which is what is true |

Sorting the unstated last also buys a safety property worth having: **a newly added item cannot
silently leapfrog work Greg ranked.** And it is a nudge — the way to get to the top is to say so.

**The cost, which is real: `add --front` no longer reaches the front** unless a priority comes with
it. That is not hidden. `add` prints the effective position it landed at, and `add --front` with no
`--priority` prints a sentence saying the item sits below every prioritised one and how to change
that. Silently inheriting the top item's priority was considered and rejected: it invents an opinion,
which is the thing the `null` default exists to avoid.

## The sort, and where it lives

**One implementation, in the fold.** `foldQueue` already builds `items` from the internal placement
array; it now sorts that array by **priority descending, then placement position ascending** before
freezing it. Everything downstream — `waitingAhead`, `itemWait`'s *"N ahead of it"*, `queueDepth`,
the route's `rows`, the panel — reads `view.items` and is therefore correct without knowing the rule
exists.

The rejected alternative is sorting at the edges (`list`, the route builder, the panel). It is less
invasive and it is wrong for the reason 260909b gives for computing `ready` server-side: *"a second
implementation of it in browser TypeScript would be a second answer"*. Three call sites is three
chances to forget, and `itemWait` would then be counting *"items ahead"* in an order nobody sees.

The comparator writes the tiebreak out explicitly rather than leaning on `Array.prototype.sort`
being stable. Stability is specified in modern V8 and would work; an explicit index tiebreak says
*what the second key is* to the next reader, and it is what the mutation check swaps.

**Placement stays placement.** The internal `order` array is untouched, so `moved --before X` still
means *before X in the placement order*, and it still decides the order within a band. Where that is
invisible — the anchor is in a different band — `move` says so on the way out rather than printing a
tick over a no-op.

## Schema, and what an older reader does

**`IDEA_QUEUE_SCHEMA` is not bumped.** It is *"bumped only for a change a previous reader could not
survive"*, and bumping it would make the new reader reject every schema-1 line already in the live
file — which is the whole file.

An older reader meeting a newer file ignores `priority` on `added` and rejects a `prioritized` line
as an unknown kind, which becomes an `unreadable-line` problem, which makes the whole queue
undispatchable. That is a **loud refusal, not a wrong answer**, and it is the direction this module
is built to fail in. There is one reader, so the case is hypothetical; it is written down because
the alternative — deciding it at the moment it happens — is how a schema field stops meaning
anything.

## An out-of-range priority rejects the line

`priority` present and not `null` and not a finite number in `[0, 1]` **rejects the whole event at
parse time**, exactly as `needsGreg: "yes"` now does after Sol's round-two P1-1. It is not clamped
and it is not ignored: a clamp turns `1000` into a legitimate-looking top of the queue, and ignoring
it turns a typo into silence. A rejected line is an `unreadable-line` problem and the queue holds.

No new `QueueProblemKind` is needed, which is the point of doing it in the parser.

## `set-priorities --from <file>` — Greg's ordering, applied once, reviewably

Greg's banding is **data, not logic**. Compiling *"Overseer tooling 0.8–0.9, dashboard 0.5–0.7,
Spideryarn product 0.1–0.2"* into the CLI would make a one-off decision permanent and unreadable, so
the bands live in a file the Overseer writes and Greg can read.

    overseer-queue set-priorities --from <file> --by <who> [--apply]

The file is one item per line, because the file **is** the argument Greg reviews and a JSON blob is
not something anybody reads twice:

    qi-a3k9mq2p 0.85   # Overseer tooling
    qi-b7x2ndhr 0.60   # dashboard
    qi-c9w4ktzz 0.15   # Spideryarn product cluster A

Strictly parsed: a line that is not blank, not a `#` comment and not `<id> <0..1>` **refuses the
whole file**. Nothing is applied from a file that was half-understood — the same rule the fold keeps.

Without `--apply` it prints the plan and writes nothing: every item's current priority and its new
one, the rows it would not change, the ids in the file that are not in the queue, and the queued
items the file does not name. Rows where `needsGreg` is true are marked `?` in that output, because
Greg's brief leaves those *"unchanged in priority"* and the reviewer should be able to see at a
glance whether the file honours that — a fact about the file, checked by eye, rather than a rule
hidden in the command.

With `--apply` it appends one `prioritized` event per **changed** item, in one batch under one lock
against one version. Unchanged items produce no event: a log line that changes nothing is noise in a
record whose value is that every line means something.

## Stages

- [ ] **Stage 1 — the field, the event, the sort, and the CLI.**
      `tools/overseer/idea-queue.ts` (the `priority` field, the `prioritized` event, its parse arm,
      its fold arm, the comparator), `scripts/overseer-queue.ts` (`add --priority`,
      `edit --priority`, `set-priorities`, the priority column in `list` and `show`),
      `tests/overseer-idea-queue.test.ts`. Red first, then green, and **the comparator
      mutation-checked**: swap the two keys and watch the ordering tests fail.
- [ ] **Stage 2 — the wire, the route and the tab.** `wire.ts` gains one additive field on
      `QueueRow` at the end of the type; `routes-idea-queue.ts` carries it; `QueuePanel.tsx` shows it
      on the row and renders in the order the server sent, sorting nothing itself.
      `tests/fleet-idea-queue-route.test.ts` and `tests/fleet-queue-panel.test.tsx`.
      Then `npm test`, `npm run typecheck`, lint, and the GPT Sol code review.

## The simpler option this passed over

**A `priority` string in `IdeaMetadata`** — `"high"`, `"low"` — which needs no new event kind, no
parse arm and no comparator subtleties, because `metadata` is already patchable. Rejected on two
counts: it is content, so it lapses approvals (§ question 1), and Greg asked for `0-1` specifically,
which is a scale you can interleave into rather than three buckets you cannot.

**Not sorting at all, and just letting the Overseer `move` things.** That is what exists, and it is
what Greg is asking to replace: an ordering that lives in whoever last reordered the file, rather
than in a number he can state once and have honoured.

## Needs Greg

Nothing new. The open questions from 260909b — the file's location, the identity story for writes
from the page, and the absence of a wait forecast — are unchanged by this.

## File set

Mine: `tools/overseer/idea-queue.ts`, `scripts/overseer-queue.ts`,
`tools/fleet/routes-idea-queue.ts`, `tools/fleet/web/src/QueuePanel.tsx`, and their tests. One
additive field at the **end** of `QueueRow` in `tools/fleet/wire.ts` and nothing else in that file.

Not mine: the daemon, `tools/overseer/jobs.ts`, `scheduler.ts`, `tools/fleet/queue.ts` (the
dashboard's *steering* queue — a different thing with a confusingly similar name),
`docs/project/overseer.md`.

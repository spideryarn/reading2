# A priority on every queued idea, and the queue ordered by it

**Status, 2026-09-09: built; the final code-review blockers are closed.** Up:
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
- **Priority does not grant content authority.** It cannot make an item dispatchable or carry Greg's
  approval onto changed words. It does change the constraint governing what the Overseer takes next,
  though, and the review rightly identified that as a reordering authority Greg has not explicitly
  granted. `priorityBy` and `priorityAt` make each live choice auditable while that governance
  question remains open; they do not answer it.
- **What must not move, does not move.** Priority cannot promote an item past `authority`.
  `isDispatchable` is untouched: an unauthorised item at 0.9 sorts to the top of the list and is
  still not dispatchable, and the badge still says *proposal*.

**The residual risk, named rather than waved off: priority is a salience vector.** An Overseer
proposal at 0.9 sits at the top of the list Greg reads on his phone, which is a way of pressing for
attention that it did not have before. It is not an authorisation vector — the row says *proposal*
and nothing can dispatch it — and Greg explicitly asked the Overseer to apply his banding, so
capping what the Overseer may set would refuse the thing he asked for. It is recorded here, and every
`prioritized` event carries `by`, and the folded item carries `priorityBy` and `priorityAt`, so *who
pushed this up the list, and when* is answerable without reconstructing its history.

### 2. A separate event kind, or a key inside `edited`?

**Taken: a new event kind, `prioritized`, parallel to `moved`.**

The alternative is `edited { priority? }` excluded from `changesContent`. The separate kind buys an
honest history line and lets a content edit and priority change compose atomically as two acts. The
review corrected an overclaim here: this is **not structural authorisation safety**. `parseEvent`
must still reject both `edited { priority }` and an edit with no recognised field, or a buggy writer
can believe a change happened when the parser silently discarded it.

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
it once anything in the queue is ranked. That is a refusal, not a successful command with a note:
unranked `--front`, `--before` and `--after` fail when a named ranked item would remain above the new
one, and say to pass `--priority` or `--back`. They keep working while the whole queue is unranked,
because then the placement still does exactly what it says. Silently inheriting the top item's
priority was considered and rejected: it invents an opinion, which is the thing the `null` default
exists to avoid.

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
means *before X in the placement order*, and it still decides the order within an exact-priority
group. A relative move whose anchor has a different priority is refused by the fold before placement;
otherwise it can alter the hidden order, fail to achieve the named relation, and reorder peers the
caller never mentioned. `front` and `back` remain valid placement-array operations and therefore mean
front or back within the moved item's exact-priority group in the sorted view.

## Schema, and what an older reader does

**`IDEA_QUEUE_SCHEMA` is not bumped.** It is *"bumped only for a change a previous reader could not
survive"*, and bumping it would make the new reader reject every schema-1 line already in the live
file — which is the whole file.

Priority is forbidden on `added`, including `priority: null`; every item is born unstated. `add
--priority` appends `added` then `prioritized` in one locked batch. An older reader therefore meets an
unknown `prioritized` event for every stated priority, records an `unreadable-line` problem and makes
the whole queue undispatchable. That is a **loud refusal, not a wrong answer**. Rejecting the key on
`added` also makes a mistaken new writer fail loudly instead of having its claimed priority ignored
by an old reader. This correction came from the round-two review's P1-2.

## What the plan review changed

GPT Sol reviewed the built priority work (`--model gpt-5.6-sol --effort high`, 2026-09-09). This
round closes the findings in scope here; the review file remains the record for P1-3, the governance
decision beyond the P1-5 mitigation, and P2-2.

| finding | what was wrong | change taken |
|---|---|---|
| **P1-1** | A cross-priority relative move changed hidden placement without achieving the visible relation, while unranked `add --front` could exit zero and land last. | The fold refuses cross-priority `before`/`after`; the CLI refuses misleading unranked relative/front placement only once a ranked item exists. |
| **P1-2** | Priority on `added` let an old reader ignore the field and select the wrong item without a problem. | `added` cannot carry the key; `add --priority` atomically appends `added` then `prioritized`. |
| **P1-4** | One existing parse problem could mask one new fold problem during append preflight. | Baseline and candidate are now folds of the same parsed event stream, with parse problems on neither side. |
| **P2-1** | The separate event kind was overclaimed as structural safety while empty and priority-bearing `edited` events still parsed. | Both forms are rejected; the separate kind is justified by honest history and atomic composition. |
| **P1-5 mitigation** | Who changed the ordering constraint was visible only by replaying history while standing authority remains undecided. | Folded items expose `priorityBy` and `priorityAt`, cleared with the priority; the later code review carries both through the route and shows them in the opened dashboard row. |

## What the code review changed

GPT Sol reviewed the completed work on 2026-09-09. Its verdict was *"do not ship it until the three
P1s are fixed"*. All seven findings were reproduced before the review was handed over, and the
fixes below were each driven through the boundary the finding concerned rather than through a
source-grep assertion.

| finding | what was wrong | change taken |
|---|---|---|
| **P1-1** | `appendEvents` accepted `NaN`, infinities and out-of-range priorities. `NaN` became `null`, while `9` wrote a line the same module refused to read. | Before the lock or any file work, each event is encoded, parsed back and structurally compared with the original. A mismatch is `invalid-event`; rejected batches leave existing and never-created records byte-identical. |
| **P1-2** | A refused first append left `queue.created`, falsely turning an untouched root into a LOST queue; a torn-line repair on a later refusal was omitted from the result. | Candidate validation now precedes marker creation while the marker still precedes the first record. Every append result carries repair information, and the CLI prints a repair before its refusal. |
| **P1-3** | `--expect-version` pinned the queue but not the priority file, so an apply could use different bytes from the dry run. | The dry run prints the first twelve hexadecimal characters of the raw file's SHA-256 and `--apply` requires the same value with `--expect-file`. Raw bytes are deliberate: comments were part of the file the reviewer read. |
| **P2-1** | Only `added` and `edited` rejected a misplaced `priority`; the other event kinds silently ignored extra fields. | One allowed top-level key set per event kind now rejects every extra key. This is compatible with the 85-line live record checked on 2026-09-09 and makes newer-writer fields fail loudly on older readers. |
| **P2-2** | A schema-1 row with no `priority` reached the detail list as the string `undefined`. | The client normalises an absent or non-numeric row priority to `null`, preserving schema-1 compatibility and the honest meaning *unstated*. |
| **P2-3** | `priorityBy` and `priorityAt` stopped at the fold even though the comment claimed the act was visible on the row. | Both fields are additive wire fields, projected for queued and settled rows and rendered in the opened detail as who set the priority and on what date. |
| **P2-4** | The order assertion passed when the first row vanished, persistence was untested for non-finite numbers, and helper tests did not exercise the CLI's apply guards. | The order test first proves both rows exist; append tests assert byte-identical records; subprocess tests cover missing and stale queue/file tokens and a queue problem. Each guard was mutation-checked separately. |
| **`--allow-unnamed`** | In a band-everything migration, a forgotten live item and an intentional omission were indistinguishable. | Apply refuses unnamed live items unless `--allow-unnamed` is present. A dry run with unnamed items includes the flag in its copyable command, making the accepted omission explicit without asking the operator to invent the flag. |

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

    overseer-queue set-priorities --from <file> --by <who>
        [--apply --expect-version <v> --expect-file <digest> [--allow-unnamed]]

The file is one item per line, because the file **is** the argument Greg reviews and a JSON blob is
not something anybody reads twice:

    qi-a3k9mq2p 0.85   # Overseer tooling
    qi-b7x2ndhr 0.60   # dashboard
    qi-c9w4ktzz 0.15   # Spideryarn product cluster A

Strictly parsed: a line that is not blank, not a `#` comment and not `<id> <0..1>` **refuses the
whole file**. Nothing is applied from a file that was half-understood — the same rule the fold keeps.

Without `--apply` it prints the plan and writes nothing: every item's current priority and its new
one, the rows it would not change, the ids in the file that are not in the queue, and the queued
items the file does not name. The apply command it prints names the exact queue version just read
and a digest of the exact raw file bytes. An item arriving after review or any edit to the reviewed
file — comments included — therefore refuses rather than applying a different ordering. When live
items are unnamed, the printed command also includes `--allow-unnamed`, so the accepted omission is
said out loud.

The banding file names **all sixteen Spideryarn product clusters**, including the ones marked
`needsGreg`, because Greg's quoted brief says all the product ideas go low. A `?` beside those rows
is information for the person reviewing the file, not a rule the command enforces: priority orders
the list and cannot answer the question or make the item dispatchable.

With `--apply`, both `--expect-version` and `--expect-file` are required. It appends one
`prioritized` event per **changed** item, in one batch under one lock against the reviewed queue
version, and refuses a changed priority file, a queue with problems, ids absent from the live queue,
or unnamed live items without `--allow-unnamed`. Unchanged items produce no event: a log line that
changes nothing is noise in a record whose value is that every line means something.

## Stages

- [x] **Stage 1 — the field, the event, the sort, and the CLI.**
      `tools/overseer/idea-queue.ts` (the `priority` field, the `prioritized` event, its parse arm,
      its fold arm, the comparator), `scripts/overseer-queue.ts` (`add --priority`,
      `edit --priority`, `set-priorities`, the priority column in `list` and `show`),
      `tests/overseer-idea-queue.test.ts`. Red first, then green, and **the comparator
      mutation-checked**: swap the two keys and watch the ordering tests fail.
- [x] **Stage 2 — the wire, the route and the tab.** `wire.ts` gains three additive fields on
      `QueueRow` at the end of the type; `routes-idea-queue.ts` carries them; `QueuePanel.tsx` shows priority
      on the collapsed row and its provenance in the opened details, and renders in the order the server
      sent, sorting nothing itself.
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

Mine: `tools/overseer/idea-queue.ts`, `tools/overseer/idea-queue-priorities.ts`, `scripts/overseer-queue.ts`,
`tools/fleet/routes-idea-queue.ts`, `tools/fleet/web/src/QueuePanel.tsx`, and their tests. Three
additive fields at the **end** of `QueueRow` in `tools/fleet/wire.ts` and nothing else in that file.

Not mine: the daemon, `tools/overseer/jobs.ts`, `scheduler.ts`, `tools/fleet/queue.ts` (the
dashboard's *steering* queue — a different thing with a confusingly similar name),
`docs/project/overseer.md`.

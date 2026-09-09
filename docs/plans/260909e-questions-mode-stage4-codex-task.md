# Stage 4: closing GPT Sol's review of the Questions tab

Five findings from an independent GPT Sol review, all **reproduced by the reviewer**, none of them a
P0. The review is at `docs/plans/260909e-questions-mode-stage2-review-sol-r2.md` — read it first, in
full. Your job is to close them, with a red test for each.

Working directory (a git worktree — **commit nothing**, I will read the diff and commit):
`/home/greg/code/spideryarn2/.claude/worktrees/questions-mode`

Read `docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md`
§ Half one of design-a-screen.md § 3 and § What the empty list has to prove — both are binding, and
QM2-03 below is a breach of the second.

## QM2-01 (P1) — the local answerability predicate is not the server's

`canAnswer` in `QuestionsPanel.tsx` admits rows the answer route will refuse, so a reader gets
buttons that cannot work. The reviewer found two cases; **checking `tools/fleet/steer.ts` myself, it
is wider than the review says** and that matters:

- **`steerableStatus` (steer.ts:463) refuses FOUR statuses**, not one: `waiting`, `no-claude`,
  `shell` and `unknown`. Only `needs-you`, `working` and `idle` are steerable.
- **Material.** `classifyGate` cannot return `conversation` without `material.kind === "read"`, so a
  retained `conversation` item whose row now parses as `no-material` is recomputed server-side as
  `unknown` and refused. `QuestionCard` suppresses buttons only for `unreadable`, so `no-material`
  slips through.

**Write the predicate as an allow-list with a `never` default over `FleetStatus["kind"]`, not as a
block-list.** `steerableStatus` has a load-bearing `never` for exactly this reason — its comment says
an eighth status arm must stop compiling so somebody decides whether it may be typed into rather
than inheriting a yes. The client copy must fail the same way.

**Do not import `steer.ts`** — it is a node module and this is the browser bundle. Write the local
predicate and comment it as a deliberate mirror, naming `steer.ts § steerableStatus` as the
authority, so the next person to add a status knows there are two places.

**ONE PREDICATE, TWO CONSUMERS — this is the part that closes the class rather than the instance.**
The same admissibility rule is currently written in *three* places: `classifyGate`/`steerableStatus`
on the server (authoritative), `resolveDialogReference` in `types.ts` (as a gap check), and
`canAnswer` in the panel (as a control gate). QM2-01 is what that costs — the panel's copy drifted
from the other two. Export **one** predicate and have both client sites call it, so a fourth
condition cannot be added to one and missed by the other. The reviewer asked for this in those words
and it is the right shape.

## QM2-02 (P1) — the card key has no question identity

Reproduced: answer dialog A successfully; a later snapshot puts dialog B on the **same row with the
same execution token**; the card draws B's prompt with **A's `Sent.` receipt underneath**, and B's
buttons stay disabled because `repeatUnsafe` survived.

`itemKey` keys on `rowId` + execution token. A new question on an unchanged row and execution is
therefore the same key. Add the question's identity: **exactly the fields `sameQuestion` compares** —
the prompt, the material, and every option's label, consequence and key. `sameQuestion` lives in
`tools/fleet/steer.ts`; read it for the field list, do not import it.

The plan withdrew `questionGroupKey` as a **semantic grouping** and said in the same breath that it
is *"an excellent stale-answer safety comparison"*. This is that safe use: the key is about whether
the thing on screen is still the thing that was answered, not about whether two sessions ask the
same thing. Say so in the comment, and cite § What round three changed, 3 so nobody re-deletes it.

## QM2-03 (P1) — the browser never checks for OMITTED items, and this one is the plan's own promise

**The most important of the five.** Reproduced: a fresh, readable payload containing a valid live
dialog row, with `questions: {kind:"complete", items:[]}`. `parseFleetState` kept `complete`,
`questionsAtTime` kept it, and the DOM printed **`Nothing needs you.`**

The plan says the browser is *"the final authority on `complete` — only it knows whether it parsed
every row and every reference"*. It currently validates only the items that **are** present:
`resolveQuestionReferences` iterates `view.items` and has no inverse check, so an item the server
never sent is invisible to it.

Add the **inverse coverage check** in `tools/fleet/web/src/types.ts`: from the parsed payload,
independently derive the set that *should* be represented —

- every parsed row whose `question` is a `question` with `gate.kind === "conversation"`;
- every parsed prose attention item (`evidence.kind === "prose"`) in a published `list`;

— and raise a **gap** for anything in that set with no corresponding item in `view.items`. Never drop
or invent an item; the view downgrades to `partial`, which is the only direction the client may move
it.

**Two constraints, and getting either wrong makes this worse than not doing it:**

- **It must be silent in ordinary operation.** `composeQuestions` derives the same sets from the same
  payload, so they should agree exactly. If your check fires on a normal payload you have written a
  second, disagreeing composer — that is A17 and worse than the hole. Prove it by running the
  existing suites, which use realistic payloads.
- **Do not re-derive prose items from the inbox's `dialog` evidence.** Only `prose` evidence produces
  a prose item; inbox dialog items are deliberately discarded (§ The rule that replaces the join).

You may edit `types.ts` and add a gap arm to `wire.ts` for this. Name the arm after **what was
observed** — a reported item set that omits an eligible observation — never after a diagnosis of the
server.

## QM2-04 (P2) — the prose no-write guard does not guard

The reviewer added a `steer.message` call to the prose card's click, kept the navigation, and **all
14 panel tests still passed**. The test checks for textareas and enabled buttons; it does not check
what the click *does*. `QuestionItems` already has `steer` in scope, so this is an easy later edit
that the claimed guard misses.

Rewrite it: click the prose card with a **recording `SteerApi`** and assert that neither `message`
nor `answer` was called, while the navigation still happened. Keep the structural assertions too.

## QM2-05 (P2) — the answering notice appears where there are no buttons to withhold

A `complete` empty view under a declared hold renders both *"…option buttons are withheld"* and
*"Nothing needs you."*. It also shows on prose-only lists, where answering in Sessions is a **message**
operation and is not affected by the answer hold at all — so the banner is not merely redundant
there, it is misleading.

Draw it only when at least one **`dialog`** item is present — the arm that would otherwise carry
buttons. `dialog-unaddressable` already states its own reason on the card.

## QM2-06 (P2) — the freshness thresholds are copied across the boundary, not shared

**Not from the review — found here afterwards, by asking the question the review's own findings
raise.** A peer session put it well on 2026-09-09: *"if your stage moved any check across a boundary,
that is the shape worth re-reading before you call it done."* QM2-01 is one instance. This is
another, and it is quieter.

`tools/fleet/questions.ts` names three thresholds:

```ts
const FLEET_STALE_CADENCES = 2.5;
const CHECKPOINT_STALE_MS = 5 * 60_000;
const SCAN_STALE_MS = 6 * 60_000;
```

`questionsAtTime` in `tools/fleet/web/src/types.ts` re-applies the same rule against the browser's
clock — correctly, and that re-application is the whole point of the selector — but with the numbers
written as **bare literals**: `(state.refreshMs ?? 60_000) * 2.5`, `5 * 60_000`, `6 * 60_000`.

**They agree today; I checked.** Nothing would notice if they stopped. A server threshold widened
without the client's would make the browser call `partial` a view the server called `complete` — or,
in the dangerous direction, hold `complete` open past the server's own deadline.

The `wire.ts` rule (types only, no runtime values) is what pushed these into being copied, and it
does **not** force it: `types.ts` already imports runtime values from four `tools/fleet/*.ts` modules
(`attempt-clock.js`, `execution-token.js`, `overseer-claim.js`, `usage-absence.js`), so a browser-safe
module with no node imports is both feasible and precedented.

Give the three constants **one home** that both sides import, and say in its comment why it is not in
`wire.ts`. Do not move `isStale`/`questionClockStale` themselves — they differ deliberately (the
server's refuses an unusable deadline, which is a defence the client does not need) and merging them
would be a second, larger change smuggled in behind this one.

## Tests — every fix gets one, each watched RED first

In `tests/fleet-questions-panel.test.tsx` and, for QM2-03, wherever the client-parser cases live
(`tests/fleet-questions-client.test.ts`).

- QM2-01: **one test per refused status** (`waiting`, `no-claude`, `shell`, `unknown`) plus
  `no-material`, each asserting no enabled option button and no call on the seam.
- QM2-02: the reviewer's exact reproduction — answer A, deliver B on the same row and execution,
  assert A's receipt is gone and B's buttons are live.
- QM2-03: the reviewer's exact reproduction — a live conversation row with `items: []` must not
  render *Nothing needs you.*; and the prose equivalent. **Plus the one that stops the cure being
  worse than the disease**: an ordinary payload where server and client agree produces **no** such
  gap.
- QM2-04: as described above.
- QM2-05: a hold plus an empty list, and a hold plus a prose-only list — neither shows the notice; a
  hold plus a dialog item does.
- QM2-06: a test that **imports the shared constants and asserts both sides use them**, so a future
  edit to one has to be an edit to both. A test that merely re-states the numbers would agree with a
  drift rather than catch it — it must reference the shared home, not a literal.

**Report which you watched fail, and what each proved.** For QM2-03 say explicitly that you watched
the *no-false-positive* test pass on realistic payloads.

## Constraints

- `strict` and `noUncheckedIndexedAccess`. Exhaustive `switch` + `never` wherever you branch on a
  union.
- **Do not touch**: `tools/fleet/steer.ts`, `routes-steer.ts`, `send-coordinator.ts`, `Dock.tsx`,
  `mode.ts`, `tailwind.css`, `SessionDetail.tsx`, `AttentionPanel.tsx`, or any other panel.
- `QuestionsPanel.tsx` may have just gained a queue-pointer region from another task. **Re-read it
  immediately before editing** and leave that region alone.
- **Do not commit.** Do not run `npm test` or `npm run typecheck`. Run
  `npx vitest run tests/fleet-questions-panel.test.tsx tests/fleet-questions.test.ts tests/fleet-questions-client.test.ts`.

## When you are done

Write `docs/plans/260909e-questions-mode-stage4-report.md`: what you changed per finding, which tests
you watched fail first, **anything in the review you believe is wrong** — some findings are, and
saying so with evidence is worth more than closing one that was not real — and anything left undone.

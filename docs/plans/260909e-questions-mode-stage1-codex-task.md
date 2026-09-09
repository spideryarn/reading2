# Stage 1: the Questions view's data contract and its composition

You are implementing **Stage 1 only** of an agreed plan. Do not start Stage 2 or Stage 3, do not add
a UI panel, and do not register a dashboard mode.

Working directory (a git worktree — commit nothing, I will read the diff and commit):
`/home/greg/code/spideryarn2/.claude/worktrees/questions-mode`

## Read first

1. **The plan**:
   `docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md`.
   Read § The design in full, then § Stage 1. The plan has been through three GPT Sol review rounds
   and every rule in it is there because a round found a defect; treat it as binding.
2. `docs/project/fleet-dashboard-modes.md` § "Absence is stated, never drawn" and § "Where the
   panel's data comes from" — the house rules this must satisfy.
3. `tools/fleet/attention.ts` — the closest existing analogue: a reader that must never throw, with
   its own compatibility policy and an arm for every silence. **Match its standard of commenting**:
   say why, name the failure the code is built against, and never restate what the code says.
4. `tools/fleet/wire.ts` — where the new types go. Note its rule: **types only, no runtime values,
   no imports.**
5. `tools/fleet/state.ts` § `statePayload` — where the composition is wired in.
6. `tools/fleet/web/src/types.ts` — the client's parser, and its "fifth state" discipline.

## What to build

### 1. `tools/fleet/wire.ts` — one additive block at the END of the file

Do not edit anything already there. Add:

- `QuestionTarget` — a session this tab can name: `sessionId`, `sessionName`, and whether it is
  addressable, with the reason when it is not.
- `QuestionItem` — four arms: `dialog`, `dialog-unaddressable`, `prose`, `prose-unaddressable`.
  Per the plan:
  - `dialog` carries a **row reference** and no question text (the panel resolves against `rows`);
    it exists only for a `conversation` gate.
  - `prose` carries the attention item's id, the excerpt, `why`, `waitingSince`, the
    `AttentionKind`, and per-member addressability for duplicates. **Nothing on a prose item implies
    a write is possible** — v1 is read-only there.
  - the two `unaddressable` arms carry the reason.
- `QuestionGap` — the causes listed in the plan's gap table, **each its own arm**, not a string.
- `QuestionsView` — `complete` / `partial` (with `gaps` a **non-empty tuple**) / `not-observed`.

Every arm is named after **what was observed**, never after what it implies. Every arm's comment
says which producer can write it.

### 2. `tools/fleet/questions.ts` — new file, pure

```ts
composeQuestions(input: {
  rows, attentionFeed, collectionError, collectedAt, refreshMs, now
}): QuestionsView
```

Pure: no I/O, no `Date.now()`, no imports from `src/`. Rules, all from the plan:

- **The pane is the authority on dialogs; the inbox is the authority on prose.** The inbox's own
  `dialog` items are discarded.
- A dialog item is admitted **only** when `row.question.gate.kind === "conversation"`. Permission-
  and unknown-gate dialogs produce **no item at all**.
- **One dialog card per row.** No grouping, no fingerprint, no cross-row identity.
- A prose item is **never** suppressed by the presence of a row dialog. Keep both.
- A prose item with no row, or a row with no steerable address (`paneId` or `claudeSessionId` null),
  becomes the `-unaddressable` arm — **never dropped**.
- Every gap in the plan's table is detected and reported. `complete` is only ever returned when the
  composer can positively establish each source was observed and complete.

### 3. `tools/fleet/state.ts` — wire it in

Beside `attention`, **off the same single checkpoint read** (`statePayload` already calls
`deps.readCheckpoint()` exactly once; do not add a second call). The new field is a **required** key
on the pushed payload type.

### 4. `tools/fleet/web/src/types.ts` — the client's half

- A parser producing the same view, plus **its own gap** for *the server sent a `questions` field
  this page cannot read* and for *an older server sent none* — two different gaps.
- Reference resolution against `rows` and `attention`. **An unresolvable reference is a gap, never a
  dropped card.**
- The **cross-field inconsistency check**: the client parses `gate` and `material` independently, so
  a `{kind: "conversation"}` gate beside a `no-material` or `unreadable` material is impossible on
  the server path and must be **downgraded to a gap** here.
- **Downgrade-only**: the client may lower `complete` to `partial`, never raise it.
- Freshness is re-applied by a **derived selector against current client time**, not once at parse —
  a view that was fresh when parsed goes stale while the page is open.

## Tests — write them first and watch each one go RED

Put them in `tests/fleet-questions.test.ts` (server composer) and add the client-parser cases to the
existing client-types suite if one fits, otherwise `tests/fleet-questions-client.test.ts`.

The plan's Stage 1 list is the specification — implement **every** bullet under "Server composer"
and "Client parser". Note the corrections a review round made to it:

- There is **no** `conversation` + `no-material` case to test on the server path — `classifyGate`
  requires `material.kind === "read"` before returning `conversation`. That case belongs to the
  client parser, as an inconsistency to downgrade.
- A `conversation` dialog with no `paneId` cannot arise through the real collector. Construct it as
  a **typed unit input** to the composer, and say so in a comment, rather than as a pane fixture.
- Use the existing pane fixtures for the gate cases. `tests/fleet-pane.test.ts` shows what exists.

**Report honestly which tests you watched fail before implementing.** A reproduction that was never
red proves nothing, and this repo treats a check nobody has seen fail as no evidence at all.

## Constraints

- `tools/` may not import from `src/` — `tests/fleet-imports.test.ts` enforces it over the whole
  transitive graph. A **test** may import from anywhere.
- `strict` and `noUncheckedIndexedAccess` are on. Prefer a discriminated union to a bag of optionals;
  use a `never` check wherever a `switch` must be exhaustive.
- **Do not touch**: `tools/overseer/**`, `tools/fleet/steer.ts`, `tools/fleet/routes-steer.ts`,
  `tools/fleet/send-coordinator.ts`, `tools/fleet/web/src/App.tsx`, `Dock.tsx`, `mode.ts`,
  `tailwind.css`, or any existing panel. Other agents are live in this tree.
- Do not commit. Do not run `npm test` in full (it takes ~26 minutes); run your own suites with
  `npx vitest run <file>`.

## When you are done

Write a short report to `docs/plans/260909e-questions-mode-stage1-report.md`: what you built, which
tests you watched go red first and what each proved, anything in the plan you found to be wrong or
impossible, and anything you left undone. **If something in the plan cannot be built as written, say
so rather than building something adjacent** — that has happened twice already on this job and both
times the plan was the thing that was wrong.

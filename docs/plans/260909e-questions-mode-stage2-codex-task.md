# Stage 2: the Questions panel, the answering, and the registrations

You are implementing **Stage 2 only** of an agreed plan whose Stage 1 is already built, reviewed and
merged. Do not start Stage 3: no queue pointer, no browser work, no screenshots, no docs under
`docs/project/`.

Working directory (a git worktree — **commit nothing**, I will read the diff and commit):
`/home/greg/code/spideryarn2/.claude/worktrees/questions-mode`

## Read first, in this order

1. **The plan**:
   `docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md`.
   Read § Half one of design-a-screen.md (especially § 3, *What the screen must never do*),
   § The design, § The item arms, § The prose card, § What the empty list has to prove, and then
   § Stage 2 including its subsection **Five decisions this session took before writing the task**.
   The plan went through three GPT Sol rounds and every rule in it is there because a round found a
   defect. It is binding. Where this task and the plan disagree, **stop and say so** rather than
   picking one.
2. `docs/project/fleet-dashboard-modes.md` — § The registrations, § Absence is stated never drawn,
   § The seam, § The card on the button, § The test. This is the checklist your work is graded
   against.
3. The Stage 1 code you are building on:
   - `tools/fleet/wire.ts` § QUESTIONS VIEW (the four `QuestionItem` arms, `QuestionGap`,
     `QuestionsView`);
   - `tools/fleet/questions.ts` (the server composer);
   - `tools/fleet/web/src/types.ts` § Questions view — `parseQuestions`, `resolveQuestionReferences`
     and **`questionsAtTime`**, which is the selector you must call on every render.
4. The things you will reuse rather than rewrite:
   - `tools/fleet/web/src/SessionParts.tsx` § `QuestionCard` — draws a dialog, takes `onAnswer` and
     `busy`;
   - `tools/fleet/web/src/steer-client.ts` — `SteerApi`, `sentTarget`, `SentTarget`, `SteerOutcome`;
   - `tools/fleet/web/src/SteerReceipt.tsx` — `SteerReceipt`, the only vocabulary for what became of
     a send;
   - `tools/fleet/web/src/MessageOverseerCard.tsx` — the **template** for a card that composes a
     control, a seam and a receipt, and the model for the standard of commenting expected;
   - `tools/fleet/web/src/ui.tsx` — `Card`, `Button`, `Mono`, `Pill`, `cx`.

## What to build

### 1. `tools/fleet/web/src/QuestionsPanel.tsx` — new file

A **self-contained component that takes props and renders**. It fetches nothing, holds no timer, and
makes no assumption that it is the whole page: the tab is one mount of it and a later landing
surface will be another.

```ts
export function QuestionsPanel({
  view,              // QuestionsView, ALREADY time-adjusted by the caller
  rows,              // readonly FleetRow[] — dialog items resolve their rowId against these
  answeringEnabled,  // AnsweringReading — four arms, only `enabled` permits a button
  onSelect,          // (sessionId: string) => void — what a prose card's tap does
  steer,             // SteerApi, defaulted to httpSteerApi, injectable for tests
  now,               // number — the page's one clock, for ages
}): ReactNode
```

#### The view's three arms

- **`not-observed`** — draw the named silences and **nothing that could be read as a count**. It may
  never say *nothing needs you*, and it may not say *0*.
- **`partial`** — draw the items **and** the gaps, with a line above the list saying the list may be
  short. An empty `partial` is the dangerous one: it must say *this list may be incomplete* rather
  than *nothing needs you*.
- **`complete`** — the only arm that may say *Nothing needs you.* when `items` is empty.

Each gap renders as its own sentence, in the voice of whoever failed to answer, naming the failed
observation. Use a `Record<QuestionGap["kind"], …>` or an exhaustive `switch` with a `never`
default, so a nineteenth gap arm fails the build here rather than rendering blank.

#### The four item arms, with a `never` default

- **`dialog`** — resolve `item.rowId` against `rows`.
  - Row found and `row.question !== null`: draw `QuestionCard` with `question={row.question}`,
    `sessionName={row.name}`, `busy`, and `onAnswer` **only** when every one of these holds:
    `answeringEnabled.kind === "enabled"`, this card has no sticky server refusal, and the row
    still carries a question. Otherwise pass `null`, which makes the card a read-only summary.
  - Row not found, or found with `row.question === null`: draw a **stub card** naming the session
    and saying that a dialog was observed on it and the row could not be read on this side. **Never
    drop the card, and never index into `rows` and render whatever `find` returned.** (Plan
    § Stage 2, decision 4.)
  - Answering goes through `steer.answer(row, index)`. Snapshot `sentTarget(row)` **before** the
    `await` and hold `{result, target}` as one value — the row underneath is replaced at every
    collection while the card stays on screen, so a receipt compared against a later `row` answers a
    different question from the one that was asked. `MessageOverseerCard.tsx` says why at length.
  - `SteerReceipt` renders the outcome.
  - A refusal whose `code` is `answering-disabled` or `grants-permission` is **sticky** for that
    card: the options stop being buttons and the server's own `why` is shown verbatim. A control
    that refuses every time you press it is worse than one that says why it is not a control.
- **`dialog-unaddressable`** — the same question, drawn read-only, with `item.target.why` as the
  reason. **Never a button**: the server will refuse a row with no `paneId` or no `claudeSessionId`,
  and offering a control that cannot work is the thing the separate arm exists to prevent.
- **`prose`** — the excerpt, `item.why`, the age from `item.waitingSince` against `now`, the
  `attentionKind` as a ranking label, and the duplicates when there are any. **Tapping the card
  calls `onSelect(item.target.sessionId)`** and nothing else. One short line says why answering is
  one tap away rather than here — the address cannot yet be proved to belong to the asker. **Nothing
  on a prose card writes.** No textarea, no send, no microphone, no option button.
- **`prose-unaddressable`** — the same words, no control at all, with `item.target.why`.

#### The answering-state notice, drawn ONCE above the list

`answeringEnabled` is a claim about the server, so it is stated once rather than on every card
(plan § Stage 2, decision 1). Three states, three different sentences:

- `enabled` — no notice at all.
- `disabled` — the server has declared a hold; a tap would come back 503 and nothing would reach the
  session. Buttons are withheld.
- `not-reported` **or** `unreadable` — **whether answering works could not be established**, which
  is not the same sentence as a declared hold and must not be drawn as one. Say which of the two,
  and that no hold has been declared. Buttons are withheld all the same, because the kill switch is
  older than the field that reports it, so silence is consistent with the hold being on.

Do not import, move or copy `HeldBack` from `SessionDetail.tsx`. Another session is live in that
file, and a copy of its words would be a third home for one sentence.

#### Card state, keyed

Per-card state — the outcome, the sticky refusal, the busy flag — is keyed by **the item's own id
and the row's execution token**: `{boot, pid, startTicks}` when `row.execution.kind === "verified"`,
and the constant string `"unverified"` otherwise (plan § Stage 2, decision 5). **Not**
`paneId + panePid + claudeSessionId`, which is exactly the tuple that survives one Claude exiting
and another starting in the same pane. When the key changes, the state is discarded.

The simplest correct implementation is a child component with a React `key` built from that string,
so the state is discarded by React itself rather than by an effect that has to remember to.

### 2. The six registrations

Add **only** your own entries. Never edit another mode's entry; several sessions are adding tabs to
these files at once.

| Register | File | What to add |
|---|---|---|
| `MODES` | `web/src/mode.ts` | `"questions"`, **appended** to the end of the array, never placed first |
| `MODE_LABELS` | `web/src/mode.ts` | `questions: "Questions"` |
| `MODE_ICONS` | `web/src/Dock.tsx` | a Lucide icon, `size={16} strokeWidth={1.75}`, with a comment saying why that glyph and not a neighbour's |
| `MODE_TIPS` | `web/src/Dock.tsx` | a `head`/`what`/`how` card — see below |
| the mount | `web/src/App.tsx` | a `mode === "questions" ? … : null` arm |
| `--dock-mode-count` | `web/src/Dock.tsx` + `web/src/tailwind.css` | see below |

**The tip's `how` must describe the artefact, not the gesture** — this copy is also the button's
accessible description, read where nothing is being pressed. The non-obvious half here is that the
list is composed from **two observers with two different cadences**, that a dialog is mechanically
observed while a prose item is inferred from a pane tail, and that **an empty list says which kind
of empty it is**. Read the tips already in `Dock.tsx` before writing yours.

**`--dock-mode-count`**, agreed with the concurrent `decisions-mode` session before either landed:
`tailwind.css` currently hard-codes `flex: 8 0 auto` on `.dock-modes` under `@media (pointer:
coarse)`, a hand-kept copy of `MODES.length` that has already been wrong once. Replace it with
`flex: var(--dock-mode-count, 8) 0 auto`, and have `Dock.tsx` set the custom property from
`MODES.length` in the `style` of the `.dock-modes` element. Rewrite the CSS comment so it says the
count now comes from `MODES.length` and no longer needs hand-keeping. **If you find the literal is
already `9` or already a custom property when you get there, the other session landed first — take
whatever is there and do not add a second mechanism.**

### 3. `App.tsx` — the mount, and the ticking clock

```tsx
{mode === "questions" ? (
  <div className="tw:mx-auto tw:max-w-3xl">
    <QuestionsPanel … />
  </div>
) : null}
```

**The view prop is derived on every render**, off the page's existing one-second clock:

```ts
const questions = feed.state === null ? null : questionsAtTime(feed.state, now);
```

This is the point of the whole requirement. `questionsAtTime` is correct and its only production
caller today is the parser, so a view **cannot currently go stale while the page sits open** — and
the plan requires exactly that. Compute it beside the other derived values, and pass it down. When
`feed.state === null` nothing has arrived; draw the panel's *no payload yet* state rather than
inventing a view.

`answeringEnabled` comes off the payload with `?? ANSWERING_NOT_REPORTED`, exactly as the Sessions
tab does — **never `false`**, which would print *answering is switched off* over a server that has
said no such thing. `onSelect` is `(id) => go("sessions", { sel: id, selpid: null })`, in **one
write**: `chooseMode` followed by `setParam` is the closed-over-snapshot bug `mode.ts` § `go`
documents, and it silently discards one half.

## Tests — `tests/fleet-questions-panel.test.tsx`, written first and each watched RED

Model the file on `tests/fleet-feed-panel.test.tsx`: jsdom, `IS_REACT_ACT_ENVIRONMENT`, a `createRoot`
per test, `act` around every render. Drive the page through `App` where the test is about the
composition, and the panel directly where it is about rendering.

**Drive writes through the `SteerApi` seam, never a stub of `fetch`** — except in the one test below
that needs the real body built, which uses `makeSteerApi(fakeFetch)` so the request body is the one
the browser would actually send.

The four from `fleet-dashboard-modes.md` § The test:

1. `expect(MODES).toContain("questions")` and `expect(MODE_LABELS.questions).toBe("Questions")`.
2. Setting `window.location.hash = "#questions"` **before** mounting `App` draws something only this
   panel draws. Mutate the `App.tsx` arm to `false` and watch this go red; say in your report that
   you did.
3. Pressing the dock's Questions button writes the hash and switches the panel.
4. The empty state says **which** nothing it is — assert all three arms separately, and assert that
   an empty `partial` does **not** contain the words *nothing needs you*.

This tab's own eight:

5. **A click sends the row's `rawQuestion` verbatim.** Build the row through `parseFleetState` from a
   server-shaped payload so `rawQuestion` is the server's own object, click option 2, and assert the
   POST body's `question` deep-equals that object and `optionIndex` is `1`. A body rebuilt from
   `row.question` is the defect `steer-client.ts`'s header is about.
6. **It refuses when the row no longer carries a question.** A `dialog` item whose row is present
   with `question: null` draws the stub card, offers no button, and calls nothing on the seam.
7. **Card state does not survive a change of `row.execution.token`.** Send, get a receipt, deliver a
   new payload in which the same row's `execution.token.startTicks` differs, and assert the receipt
   is gone. Then deliver a payload where the token is **unchanged** and assert the receipt is still
   there — a test that only checks the discard passes for a component that discards everything.
8. **A successful, a `partial` and an `unknown` send each leave the controls in the right state.**
   Specifically: a `partial` or `unknown` outcome must not leave the reader invited to press again as
   though nothing had happened; assert the receipt's own words are on screen for each.
9. **No prose card renders anything that writes.** Render a view containing one `prose` item and
   assert there is no `<textarea>` and no enabled `<button>` inside the prose card. This is the
   assertion that stops v1's decision being undone by a later edit that looks harmless.
10. **A prose card's tap selects the session**, and the hash carries `sel` and no stale `selpid`.
11. **`answeringEnabled` in its `disabled` and its `not-reported` readings are two different
    things** — two different sentences on screen, and no option buttons under either.
12. **The view goes stale while the page sits open.** Deliver one payload whose view is `complete`,
    assert the panel says so; then **advance the clock without delivering another payload** (fake
    timers plus `act`, so the one-second `useNow` interval fires) past the fleet staleness deadline,
    and assert the panel has left `complete` and names the staleness. If this test passes against an
    `App.tsx` that calls `questionsAtTime` only at parse time, it is not testing what it claims —
    check that it goes red against the un-wired version before you wire it.

Also add, to whichever existing suite fits: an assertion that the dock's buttons are derived from
`MODES` rather than a literal list, if one is not already there.

## Constraints

- `tools/` may not import from `src/` — `tests/fleet-imports.test.ts` walks the whole transitive
  graph. A **test** may import from anywhere.
- `strict` and `noUncheckedIndexedAccess` are on. Prefer a discriminated union to a bag of optionals;
  a `switch` that must be exhaustive gets a `never` default.
- **Do not touch**: `tools/overseer/**`, `tools/fleet/steer.ts`, `tools/fleet/routes-steer.ts`,
  `tools/fleet/send-coordinator.ts`, `tools/fleet/web/src/SessionDetail.tsx`,
  `tools/fleet/web/src/AttentionPanel.tsx`, `tools/fleet/web/src/SessionsPanel.tsx`, or any other
  existing panel. `wire.ts`, `questions.ts` and `state.ts` are Stage 1's and should need no change —
  **if you believe one of them does, say so in your report rather than editing it**.
- In `mode.ts`, `Dock.tsx`, `App.tsx` and `tailwind.css` make **small, targeted edits** and re-read
  the file immediately before each. Other agents are editing these files right now.
- **Do not commit.** Do not run `npm test` in full (~26 minutes) and do not run `npm run typecheck`
  (it may not work in your sandbox). Run your own suites with
  `npx vitest run tests/fleet-questions-panel.test.tsx`, and the two Stage 1 suites
  (`tests/fleet-questions.test.ts`, `tests/fleet-questions-client.test.ts`) to check you have not
  disturbed them. I will run the full gates.
- Match the standard of commenting in `MessageOverseerCard.tsx` and `steer-client.ts`: say **why**,
  name the failure the code is built against, never restate what the code already says.

## When you are done

Write a report to `docs/plans/260909e-questions-mode-stage2-report.md`:

- what you built, file by file;
- **which tests you watched fail before implementing, and what each one proved** — especially tests
  2 and 12, where the whole value is in having seen the un-wired version go red;
- what the registrations looked like when you got there (did `decisions-mode` land its mode or its
  `--dock-mode-count` first?);
- anything in the plan you found to be wrong or impossible. **If something cannot be built as
  written, say so rather than building something adjacent** — that has happened twice on this job
  and both times the plan was what was wrong;
- anything you left undone.

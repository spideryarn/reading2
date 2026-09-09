# Stage 3: the queue pointer, and what it does to "Nothing needs you."

You are adding **one feature** to a tab that is otherwise built, reviewed and green. Do not
restructure the panel, do not touch the dialog or prose card rendering, and do not do any browser
work — that is done.

Working directory (a git worktree — **commit nothing**, I will read the diff and commit):
`/home/greg/code/spideryarn2/.claude/worktrees/questions-mode`

## Read first

1. The plan:
   `docs/plans/260909e-questions-mode-everything-that-needs-greg-s-input-answerable-in-place.md` —
   § The queued ideas waiting on Greg, which are acceptance-critical rather than droppable, and
   § What the empty list has to prove before it may reassure. Both are binding.
2. `tools/fleet/web/src/QuestionsPanel.tsx` — the panel you are adding to.
3. `tools/fleet/web/src/queue-client.ts` — the seam. Read its header: **four arms, because the
   server has three and the wire can fail too.**
4. `tools/fleet/web/src/QueuePanel.tsx` — how the existing tab drives that seam, including
   `refreshNonce`.
5. `docs/project/fleet-dashboard-modes.md` § Absence is stated, never drawn.

## Why this exists

The tab answers *"is anything needed from me?"*. One whole class of things needed from Greg is **not
answerable on it**: the Overseer's idea queue refuses writers other than the Overseer by design, so
a control here would be a lie about who may write. GPT Sol's P1-5 on the plan was that excluding
that class silently makes the tab's own promise knowingly false — he will stop checking the other
place. So the tab carries a **counted pointer**: it says how many queued items are waiting on his
authority, and sends him to the Queued ideas tab.

## What to build

### 1. `QuestionsPanel.tsx` — two new props and one new region

```ts
queueApi?: QueueApi;      // defaulted to httpQueueApi, injectable for tests
refreshNonce?: number;    // the dock's Refresh; re-reads when it changes
onOpenQueue: () => void;  // navigates to the Queued ideas tab
```

**One read when the tab is entered**, through the seam — not a field on the pushed payload, and
nothing on the collection loop. Re-read when `refreshNonce` changes. `QueuePanel.tsx` is the shape to
copy.

The region renders **at the end of the list, always**, in every view arm including `complete` with no
items. It is not a `QuestionItem` and must not be added to that union.

**Every arm of `QueueView` gets its own sentence**, and none of them may be collapsed:

| arm | what it must say |
|---|---|
| `loading` | it is being read. Never a count, never a reassurance. |
| `queue`, `depth.needsGreg > 0` | the count, and a way to the Queued ideas tab |
| `queue`, `depth.needsGreg === 0` | **the queue was read and nothing in it is waiting on you** — a measurement, said out loud, not silence |
| `never-written` | no queue file exists yet. Ordinary, and *not* an empty queue |
| `unreadable` | the **server** could not read the file, in its words (`why`) |
| `no-answer` | **this browser** never got an answer, in our voice (`why`) |

Use an exhaustive `switch` with a `never` default.

### 2. **THE PART THAT IS EASY TO MISS, AND IS THE POINT OF THE STAGE**

`Nothing needs you.` is currently drawn whenever the view is `complete` with no items. **That
sentence is now false unless the queue was also read and found empty.**

If the queue read is `loading`, `never-written`, `unreadable` or `no-answer`, the panel has **not
established that nothing needs him** — it has established that no *session* does. So:

- `complete`, no items, and `queue` with `needsGreg === 0` → *Nothing needs you.* may be drawn.
- `complete`, no items, and **any other queue arm** → it may **not**. Draw a sentence that says the
  sessions were observed and found quiet, **and that the queued ideas could not be checked**, with
  the queue arm's own reason beside it.

This is the same discipline as `QuestionsView`'s three arms one level out: an absence of observation
may not be read as an observation of absence. Do not invent a new gap arm in `wire.ts` for it — the
queue is not part of that view and this is a rendering decision inside the panel.

### 3. `App.tsx` — wire it

`queueApi` and `refreshNonce` already exist in that file and are passed to `QueuePanel`. Pass the same
ones here. `onOpenQueue` is `() => go("ideas")` — **one write**, via `go`, never `chooseMode`
followed by `setParam`.

## Tests — `tests/fleet-questions-panel.test.tsx`, each watched RED first

Add to the existing suite; do not restructure it. `drawPanel` is its helper — extend it rather than
writing a second one.

1. **A count reaches the screen and the link opens the Queued ideas tab.** Drive through `App` and
   assert the hash becomes `#ideas`.
2. **Each of the six arms above draws its own sentence**, and no two are the same string.
3. **`complete` with no items and a readable, empty queue says *Nothing needs you.*.**
4. **`complete` with no items and a queue that could NOT be read does not say it** — one test per
   unreadable arm (`no-answer`, `unreadable`, `never-written`, `loading`). This is the acceptance
   test of the whole stage; write it first and watch all four go red.
5. **The queue is read once on entering the tab, and again when `refreshNonce` changes** — count the
   calls on the injected seam, and assert it is not called on an ordinary payload push.
6. **The panel never reaches `fetch`** — the seam is injected in every test, so a suite that quietly
   made real requests would tell you nothing.

## Constraints

- `strict` and `noUncheckedIndexedAccess` are on. Exhaustive `switch` + `never` default.
- **Do not touch**: `wire.ts`, `tools/fleet/questions.ts`, `tools/fleet/state.ts`,
  `tools/fleet/web/src/types.ts`, `queue-client.ts`, `QueuePanel.tsx`, `Dock.tsx`, `mode.ts`,
  `tailwind.css`, or any other panel. If you believe one of them must change, **say so in your report
  rather than editing it**.
- Small, targeted edits to `QuestionsPanel.tsx` and `App.tsx`; re-read each immediately before
  editing. Other agents are live in this tree.
- **Do not commit.** Do not run `npm test` or `npm run typecheck`. Run
  `npx vitest run tests/fleet-questions-panel.test.tsx` yourself. I will run the full gates.
- Match the commenting standard of the file you are editing: say **why**, name the failure the code is
  built against, never restate what the code says.

## When you are done

Write `docs/plans/260909e-questions-mode-stage3-report.md`: what you built, **which tests you watched
fail first and what each proved** — especially the four in (4) — anything in the plan you found wrong
or impossible, and anything left undone.

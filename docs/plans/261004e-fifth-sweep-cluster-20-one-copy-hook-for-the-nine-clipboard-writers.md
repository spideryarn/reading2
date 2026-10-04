# Fifth sweep, cluster 20: one copy hook for the clipboard writers

Up: [plans.md](../project/plans.md) ·
umbrella: [261003f-fifth-codebase-sweep-umbrella.md](261003f-fifth-codebase-sweep-umbrella.md)
(§ The clusters, row 20)

Eight files in `src/web` put text on the clipboard, each with its own hand-written copy of the same
four things: the guard for a browser with no clipboard, the promise handling, a "which press is
this" token, and a timer that takes the tick away again. The copies have drifted. A fix for one
(`b57dde403`, 2026-09-05, the per-press token) reached two of them and stopped. This plan puts the
four things in one hook, `useCopy`, and moves every writer onto it. What each button *shows* stays
its own.

The evidence is W8 and W12 in
[261003b-fifth-sweep-web-client.md](../investigations/261003b-fifth-sweep-web-client.md) and GPT
Sol's review of them (W8, W12, and its own findings 2 and 4) in
[261003b-fifth-sweep-review-sol-on-server-and-web.md](../investigations/261003b-fifth-sweep-review-sol-on-server-and-web.md).

## The census, re-run on 2026-10-04 against `origin/dev` at `c17785511`

```sh
grep -rn "navigator.clipboard" src --include=*.ts --include=*.tsx
```

Eight files, eight executable writes (the rest of the matches are comments). The audit's "8
clipboard files plus `FeedbackDialog.tsx`" counts `FeedbackDialog` twice: it is one of the eight.

| File § control | Guard | Token | Tick goes after | Failure goes after | Live defect today |
|---|---|---|---|---|---|
| `AnnotateDialog.tsx` § `CopyQuote` | yes | **yes** | 1600 ms, restarted per outcome | 1600 ms | none |
| `BlockGutter.tsx` § `onCopy` | yes | **yes**, and an `alive` flag | 1500 ms, restarted | 1500 ms | none |
| `Tweets.tsx` § `CopyButton` | yes | no | 1600 ms, **not restarted** | 1600 ms | stale press; short tick |
| `ChatPanel.tsx` § `CopyAnswer` | yes | no | 1600 ms, **not restarted** | 1600 ms | stale press; short tick |
| `AccessSharing.tsx` § `CopyLink` | yes (since `261003g`) | no | 1500 ms, **not restarted** | never (stays until a later press settles) | stale press; short tick |
| `ShelfEntry.tsx` § `useShelfActions` | yes | no | 1500 ms, **uncancelled** `setTimeout` | n/a: the failure is a sentence in the shelf's notice (`shelf.report`) | short tick; an overtaken refusal still reaches the notice; a timer still running after unmount (finite, not a leak) |
| `FeedbackDialog.tsx` § `copy` | yes | no | never | never; both cleared by the dialog's reset | stale press, including across a reset; "Copied" and the failure sentence shown together |
| `ViewportProbe.tsx` § `copy` | yes (since cluster 18) | no | never | never; Show and Clear both clear it | stale press (a debugging instrument) |

Two defects, in plain words:

- **Stale press.** `writeText` is a promise. Press twice and the older press can settle last, so the
  button reports the older result. The worst case is press, press, second succeeds, first is refused
  a moment later: the button says "failed" over a clipboard that holds what was asked for. In
  `FeedbackDialog` a press can also settle after the dialog was reset, and tick a fresh form.
- **Short tick.** Where the timer hangs off an effect keyed on the state, a second success while the
  tick is still showing sets `"copied"` over `"copied"`, React bails out, the effect does not re-run
  and the second tick lasts only what was left of the first timer. `ShelfEntry`'s uncancelled
  `setTimeout` gives the same symptom by a different road. `AnnotateDialog` fixed this for itself
  with a fresh-object trick.

Sol's finding 2 (`AccessSharing` refuses silently) was fixed on 2026-10-03 by plan `261003g` § 5 and
is not live. W8's own defect (`ViewportProbe`'s optional chain) was fixed by cluster 18.

## The hook

A new file, `src/web/useCopy.ts`, beside the other hooks. One export; the clipboard write itself is
private to it until something with no component needs one (GPT Sol, plan review).

```ts
/** How one write went. */
export type CopyOutcome =
  | { result: "copied" }
  | { result: "unavailable" }               // no `navigator.clipboard` at all
  | { result: "refused"; error: unknown };  // `writeText` rejected, or threw

export type CopyState = "idle" | "copied" | "failed";

export function useCopy(revert: {
  /** How long a tick shows. `null`: until a later press settles, or `reset()`. */
  copiedMs: number | null;
  /** How long a failure shows. `null`: until a later press settles, or `reset()`. */
  failedMs: number | null;
}): {
  state: CopyState;
  /**
   * Start a write. Returns nothing: there is no promise for a caller to drop.
   * `said` is called once with the outcome, in the same step that sets `state`,
   * and only if this press is still the newest and the component is mounted.
   */
  copy(text: string, said?: (outcome: CopyOutcome) => void): void;
  /** Back to idle now, and any press still out is overtaken. */
  reset(): void;
};
```

What it owns, once:

- **The guard**, as a statement, with the one long comment about why the optional chain is wrong.
  **It runs inside the click**: with no clipboard object, `state` is `failed` and `said` has been
  called before `copy()` returns, as every caller does today (`tests/viewport-probe.test.tsx`
  asserts the refusal straight after the press). `writeText` is also called before `copy()` returns,
  so it is inside the user's gesture. A synchronous throw from it is `refused`.
- **The token.** A counter bumped by every `copy()` and every `reset()`. Only the press that still
  holds the newest number, on a mounted component, sets state or calls `said`. The check and the
  call are one step, so nothing can come between them. (The first draft returned a promise carrying a
  `current` boolean; Sol showed a reset or an unmount can land between the hook settling and the
  caller reading the boolean. `BlockGutter` checks at the moment it announces, and so does this.)
- **The timer.** One, in a ref, cleared and restarted on every outcome that sets state, so every
  tick gets its full time. Cleared by `reset()` and on unmount.
- **While a press is out, nothing changes.** The feedback from the previous press, and its timer,
  carry on until the new press settles. That is what all eight do today.
- The mounted flag is set in the effect's setup as well as cleared in its cleanup, because the app
  mounts under StrictMode, which runs setup, cleanup, setup.
- `copy` and `reset` keep one identity for the life of the component. The timings are read when a
  press settles, so a caller may pass a fresh object every render.

Both timings are required rather than defaulted, so each caller's choice is written at its call
site.

What stays with each caller: the glyphs, the words, the live region, the tooltip, what a failure
says and where.

### The mapping, caller by caller

| Caller | `useCopy(…)` | Other changes |
|---|---|---|
| `AnnotateDialog` | `{ copiedMs: 1600, failedMs: 1600 }` | `Said`, `press` and its effect go; `onCopyPressed()` still runs before the write |
| `BlockGutter` | `{ copiedMs: 1500, failedMs: 1500 }` | `op`, `settle`, `later` go; `alive` and `marking` stay for the bookmark button; `announce` moves into `said` |
| `Tweets` | `{ copiedMs: 1600, failedMs: 1600 }` | `"done"` becomes `"copied"`; `text()` is still called on the click |
| `ChatPanel` | `{ copiedMs: 1600, failedMs: 1600 }` | none |
| `AccessSharing` | `{ copiedMs: 1500, failedMs: null }` | none |
| `ShelfEntry` | `{ copiedMs: 1500, failedMs: null }` | `copied` is `state === "copied"`; a failure goes to `shelf.report` from `said`, with today's two sentences. The `failed` state is not drawn |
| `FeedbackDialog` | `{ copiedMs: null, failedMs: null }` | `copied` and `copyFailed` become one state; the dialog's reset calls `reset()` |
| `ViewportProbe` | `{ copiedMs: null, failedMs: null }` | `said` is derived from the state; **Show and Clear both** call `reset()`, as both clear the message today. The two strings `tests/viewport-probe.test.tsx` pins do not change |

### What a reader sees differently

Beyond the two defects in the census, three changes follow from one state replacing two. Each is
the truthful reading: the newest press is what the button reports.

- **FeedbackDialog**: a failed copy after a successful one used to leave "Copied" on the button
  beside the sentence saying the clipboard could not be reached. The button now goes back to "Copy
  the report".
- **ShelfEntry**: a failed copy while an earlier tick is showing used to leave the tick until its
  timer ran out. The tick now goes at once.
- **ShelfEntry**: a refusal that an even newer press has overtaken used to put "Couldn't copy the
  link" in the shelf's notice over a clipboard holding the link. It is now dropped. So is one that
  arrives after the row has gone from the shelf: the reader has moved on, and `BlockGutter` already
  says nothing after unmount for the same reason.

## Stages

**Stage 1 — the hook, beside the old code.** `src/web/useCopy.ts` and `tests/use-copy.test.tsx`.
No caller changes. Each test below names the wrong hook it must fail against; the implementer
breaks the hook that way and sees it red.

- The outcomes: copied; no clipboard object is `unavailable`, set before `copy()` returns, nothing
  thrown; a rejection is `refused` with the error; a synchronous throw is `refused`. `writeText` has
  been called by the time `copy()` returns.
- Stale press, both ways round: second succeeds then first rejects (state `copied`, `said` called
  once); second fails then first succeeds (state `failed`). *Wrong hook: checks the token only on
  failure.*
- Full tick: a second success 1000 ms into a 1600 ms tick is still showing 1000 ms later, and gone
  700 ms after that. *Wrong hook: timer keyed on state; timer that never expires.*
- Each timing is its own: `{1500, null}` reverts a success just after 1500 ms and not before, and
  keeps a failure. `{null, 1600}` the other way. *Wrong hook: one hard-coded duration.*
- A press out does not disturb the feedback showing, or its timer.
- `reset()`: back to idle; overtakes a press still out (`said` never called); clears a running
  timer, so a later press's tick is not cut short by the old one.
- Unmount with a press out, and unmount while a tick is showing: no state set, `said` not called,
  `vi.getTimerCount()` is 0.
- Under `<StrictMode>`, a copy still ticks. *Wrong hook: mounted flag set once, cleared in cleanup.*
- `copy` and `reset` are the same functions after a re-render that passes a new, equal options
  object.
- `said` is called in the step that sets state, never after an unmount or a reset that came between
  the write settling and the call.
- **A source scan**, with `@babel/parser` as `tests/stop-details.test.ts` does (this checkout's
  `typescript` has no `createSourceFile`, docs/project/linting.md). It finds, in executable code
  under `src/web`: any member access named `clipboard` (dotted, optional, or computed with a string
  literal), and any call of a member named `writeText`. Inline fixtures prove it: a comment that
  mentions both is not a hit; `navigator.clipboard?.writeText(t)`, `navigator["clipboard"]` and
  `const c = navigator.clipboard` each are. In this stage the files it finds are `useCopy.ts` plus
  the eight; later stages shrink the list to `useCopy.ts` alone. It is a guard against a ninth
  hand-written writer, not proof against a determined alias.

**Stage 2 — move the two that have no defect.** `AnnotateDialog` and `BlockGutter`. Extraction
only: `tests/annotate-dialog-copy.test.tsx` and `tests/block-gutter.test.tsx` stay green without an
edit, and nothing a reader sees changes.

**Stage 3 — move the six that have one.** Behaviour changes, so a separate commit. For each live
defect a failing test first, seen red against today's component, in that component's existing test
file where it has one:

- stale press: Tweets, ChatPanel, AccessSharing, ShelfEntry (the overtaken refusal reaching the
  notice), FeedbackDialog (across a reset; and "Copied" beside the failure sentence), ViewportProbe
  (a press out, then Clear, then it settles);
- full tick: Tweets, ChatPanel, AccessSharing, ShelfEntry;
- ViewportProbe: a settled "copied", then Clear, shows no message (a characterisation: green today,
  and it is what the mapping could have lost).

Then move each caller, cut each file's guard comment to a pointer at `useCopy.ts`, shrink the scan's
list to one, and replace web-client.md's *"No shared copy button"* line with the hook.

Then a browser check of every copy button at desktop and phone widths, with clipboard permission
granted, and once with it denied.

Each stage: `npm test`, `npm run typecheck`, lint on the touched files, GPT Sol's review (it fixes
inside the stage), commit by name.

## GPT Sol's plan review, 2026-10-04: NOT READY, eight findings, seven taken and one in part

- **P-1** (ViewportProbe's Clear also resets): taken, in the mapping and stage 3's tests.
- **P-2** (a returned `current` boolean can be stale by the time the caller reads it): taken. `copy`
  now returns nothing and calls `said` under the hook's own check.
- **P-3** (ShelfEntry's overtaken refusal is a live defect the first draft kept on purpose): taken.
  Its second half, that a successful retry leaves the earlier "Couldn't copy" notice up, is **not**:
  the notice is `useShelf`'s one `actionError`, shared with archive and re-run, and `report` can only
  set it. Clearing it from a copy could clear another action's failure. It is outside this cluster's
  files; reported in the debrief.
- **P-4** (name every behaviour change; say what a pending press does): taken, § What a reader sees
  differently, and the "while a press is out" rule.
- **P-5** (the no-clipboard path is synchronous today and a test relies on it): taken, kept
  synchronous.
- **P-6** (tests that a plausible wrong hook would pass): taken, each test names its wrong hook.
- **P-7** (the scan named a compiler API this checkout does not have): taken, Babel.
- **P-8** (extraction and behaviour change in one commit): taken in part. Sol asked for the defects
  to be fixed in each caller first and the callers moved afterwards. That writes six tokens and six
  timers by hand in order to delete them in the next commit, and "while both paths exist, a fix must
  land in both" is the drift this plan exists to end. Instead the split is by caller: stage 2 moves
  the two with nothing to fix and changes no behaviour; stage 3 moves the six where the move is the
  fix, red tests first. No commit mixes a silent extraction with a behaviour change.

## What this plan passes over, and why

- **Only a `copyText` function, no hook** (W8's original fix). Simpler, and it would have been
  enough for the guard. It does nothing for the stale press or the timer, which are where the drift
  is; Sol's review of the audit said so.
- **A shared `<CopyButton>` component.** The eight render as an icon button, a text button, a menu
  item, an `<a>` and a debug panel, with live regions in three different places for stated reasons.
  One component would need a prop for each difference.
- **One glyph for failure everywhere.** `b57dde403` changed `AnnotateDialog`'s ✕ to a warning
  triangle because its Close ✕ sits beside it. Tweets and ChatPanel still draw an ✕; neither sits
  beside a Close button, and Tweets shows the failure in words. Left as they are: it is a design
  choice, not drift in the lifecycle. Reported to Greg in the debrief.
- **Moving ChatPanel's live region out of its button.** `AnnotateDialog`'s comment doubts a live
  region nested in a button is announced. That is an accessibility question to test with a screen
  reader, not part of this extraction.
- **A timeout for a `writeText` that never settles.** Tweets' comment explains why a timeout would
  turn "still asking" into a "couldn't copy" that may be false. Unchanged.
- **Clearing the shelf's "Couldn't copy" notice on a successful retry.** See P-3 above.

## What landed

**Stage 1, `453599ea6`.** `src/web/useCopy.ts` and `tests/use-copy.test.tsx` (39 tests, each proved
red against a named wrong hook by the implementer).

**GPT Sol's review of stage 1: READY after its own fixes**, which landed with stage 2. It read the
candidate at `453599ea6`.

- S1-1 (P1, fixed): a `said` that throws escaped the click on the no-clipboard path, and on the
  promise path rejected a promise nobody holds. The hook now logs it and carries on; the outcome
  and the timer are unaffected. Four tests, red first.
- S1-2 (fixed): deleted the one test the implementer could not make red.
- S1-3 (fixed): the scan now also sees a template-literal key and `document.execCommand("copy")`.
- S1-6 (fixed): five more lifecycle tests, among them "the older press settles first, while the
  newer is still out", which a hook keeping the latest *completed* press would have passed before.
- S1-5 (reported, accepted as it stands): two things every moved caller gains or changes, which
  "extraction only" did not say. A `writeText` that throws synchronously now shows the failure
  instead of throwing out of the click handler; no browser is known to do this. And in Tweets,
  `copy(text())` builds the text before the hook's guard, where today a browser with no clipboard
  skips building it; the text is a string join and nothing sees the difference.

**Stage 2.** `AnnotateDialog` and `BlockGutter` are on the hook; 113 lines out, 38 in. Their four
test files pass without an edit (127 tests). Mutations: announcing outside `said` reds four
`block-gutter` tests; calling `onCopyPressed` when the write settles rather than at the press reds
two `annotate-dialog-keeps-a-draft` tests. Swapping the order of `onCopyPressed()` and `copy()`
inside the one click handler reds nothing, and cannot: both run in the same step.

**Stage 3.** The other six are on the hook, and `tests/use-copy.test.tsx`'s scan now allows the
clipboard in `useCopy.ts` alone. Eighteen tests were red against the old components first:

| Caller | Red first | Test file |
|---|---|---|
| Tweets | stale press; full tick | `tweets-copy-icons` |
| ChatPanel | stale press; full tick (plus three characterisations: it had no rendering test) | `chat-copy-answer`, new; renders `Turn`, because six test files mock `ChatPanel.js` with a bare factory and a new export would break them |
| AccessSharing | stale press; full tick (plus one characterisation: the failure sentence does not time out) | `access-sharing` |
| ShelfEntry | full tick; overtaken refusal reaching the notice; a failure leaving the old tick up; a timer left after unmount; **a rejection that is not an `Error` threw inside the old `.catch`** (found while writing the tests) | `shelf-action-touch` |
| FeedbackDialog | stale press; a copy of the last report ticking the next one; "Copied" beside the failure sentence | `feedback-dialog` |
| ViewportProbe | a write settling after Clear, after Show, a refusal after Clear; stale press (plus two characterisations of Clear and Show) | `viewport-probe` |

Each move was then mutated and a test went red, with one exception: `failedMs` in ShelfEntry can
be any value, because the button never draws `failed`.

`tests/eager-client-graph.test.ts` went red, correctly: `useCopy.ts` is now reachable from both the
reader's startup and the lazy `/admin` route (through `ShelfEntry`). It is on `SHARED_WITH_READER`
with its reason. Docs: web-client.md § Shared code (client) names the hook; comments.md's note that
the seven call sites had drifted and the hook was "Greg's call" is replaced by what was done.

One thing from stage 2 changed that no reader can see: `AnnotateDialog` had no mounted flag, so a write settling
after the box closed set state on a component that was gone, which React ignores. The hook drops it.

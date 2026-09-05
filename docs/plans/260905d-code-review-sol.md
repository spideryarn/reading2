Verdict: **refuse**. Two established P1s violate I3.

### F1 — P1 — established

Restoring some Diagram views starts an unrequested paid model call.

(a) Reproduction:

```js
localStorage.setItem(
  "spya.lastView.<slug>",
  "?mode=diagram&diagram=force"
);
location.href = "/read/<slug>";
```

After the article loads, `force` POSTs to `/api/similar/<slug>`; `drift` and `trail` POST to `/api/projection/<slug>`. The initiating paths are [last-view.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-position-and-design-link/src/web/last-view.ts:198) and [DiagramPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-position-and-design-link/src/web/DiagramPanel.tsx:868).

(b) Smallest safe change: do not restore Diagram as the active mode. Keep `diagram`, `dx`, and `dhue`, so an explicit later Diagram press reopens the selected view.

```ts
const MODES_REQUIRING_EXPLICIT_OPEN = new Set(["chat", "diagram"]);
return !(
  key === "mode" &&
  MODES_REQUIRING_EXPLICIT_OPEN.has(pairValue(p))
);
```

A narrower implementation could only drop Diagram for `force`, `drift`, and `trail`.

### F2 — P1 — established

Remember mode has the same auto-start behavior that motivated dropping Chat, but is still restored.

(a) On an article with no Remember conversations, store `?mode=remember` and reopen the bare article. [RememberBand](/home/greg/code/spideryarn2/.claude/worktrees/feedback-position-and-design-link/src/web/App.tsx:3253) mounts `ConversationBand`; after its list loads, [the arrival effect](/home/greg/code/spideryarn2/.claude/worktrees/feedback-position-and-design-link/src/web/App.tsx:4435) calls `startNew()`, opens a conversation, focuses its composer, and writes a new `?thread=`. This directly contradicts the candidate’s claim that only Chat opens a conversation panel on arrival.

(b) Add `"remember"` to the explicit-open set above. This retains the subordinate `remember=quiz` state, so opening Remember deliberately still returns to Quiz. If restoring Quiz immediately matters, special-case `remember=quiz` and drop only Recall/default.

### F3 — P2 — established test gap; future impact reasoned

The newly added `useQueryStates` scan remains formatting-dependent. A one-line call such as:

```ts
useQueryStates({ fresh: rememberParam });
```

is missed by [the regex](/home/greg/code/spideryarn2/.claude/worktrees/feedback-position-and-design-link/tests/last-view.test.ts:175), while the `>20` sanity check still passes. Manual `URLSearchParams#set` writers are also outside the scan.

The current active article-parameter inventory is complete; this is a future link-precedence hole. Smallest immediate closure: count every `useQueryStates(` occurrence and assert every occurrence matched the supported literal-object form. A TypeScript-AST collector would fully cover formatting and reject computed keys explicitly.

### F4 — P2 — established

`localStorage` is read twice per article-open in development because `<StrictMode>` replays layout effects. [useLastView](/home/greg/code/spideryarn2/.claude/worktrees/feedback-position-and-design-link/src/web/last-view.ts:289) has no guard, despite I2 saying exactly once.

Instrument `localStorage.getItem`, mount one article under the existing `StrictMode`, and observe two calls.

Smallest fix:

```ts
const restoredFor = useRef<string | null>(null);

useLayoutEffect(() => {
  if (restoredFor.current === slug) return;
  restoredFor.current = slug;
  // existing restore
}, [slug]);
```

### F5 — P3 — established

The Design move works, but current comments/docs still say Design is in the shelf masthead:

- [Library.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-position-and-design-link/src/web/Library.tsx:283): delete the obsolete Design-location comment; change “the other two” to “its neighbour”.
- [Link.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-position-and-design-link/src/web/Link.tsx:18): replace “masthead’s three links” with “Profile and the conditional Admin link”.
- [tooltips.md](/home/greg/code/spideryarn2/.claude/worktrees/feedback-position-and-design-link/docs/project/tooltips.md:76): make the inventory and current browser instructions say Profile plus conditional Admin.
- [plan](/home/greg/code/spideryarn2/.claude/worktrees/feedback-position-and-design-link/docs/plans/260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md:42): remove the incorrect claim that only one tooltip-doc line became stale.

The focused suite passed: **17/17**. I found no defect in the slug guard, synchronous navigation ordering, parent-layout/child-passive effect ordering, Back/Forward behavior, current parameter inventory, localStorage exception handling, byte-preserving pair filtering, or the functional `/design` move.
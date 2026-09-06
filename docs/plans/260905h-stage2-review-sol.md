Refuse this candidate on **F19**, an established P1. The focused test passes 8/8 and the four tested dismissal paths are sound, but opening a saved comment exposes an untested fifth path.

## Findings

### F19 — P1 · Established: selecting a comment hands focus back to the Dock instead of into the dialog

Sequence:

1. Open Comments with Enter; focus moves to `.dock-close`.
2. Tab to `.dock-question` and activate it.
3. `App` closes the drawer and opens `CommentDialog` in the same interaction ([App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/App.tsx:3633)).
4. The Dock cleanup unconditionally focuses the original Comments button ([Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/Dock.tsx:1047)).
5. `CommentDialog` has neither autofocus nor a focus effect ([CommentDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/CommentDialog.tsx:217)).

The newly opened `role="dialog"` therefore receives no focus. Because it precedes the Dock in DOM order, the next Tab goes onward through Tweets/Metadata rather than into the content just selected.

The smallest coherent closure is to give `CommentDialog` the same modeless-dialog focus lifecycle:

```tsx
const closeRef = useRef<HTMLButtonElement | null>(null);
const openerRef = useRef<HTMLElement | null>(null);

useEffect(() => {
  const opener = document.activeElement;
  openerRef.current = opener instanceof HTMLElement ? opener : null;
  closeRef.current?.focus();

  return () => {
    const back = openerRef.current;
    openerRef.current = null;
    if (back?.isConnected) back.focus();
  };
}, []);

// On .cmt-close:
ref={closeRef}
```

React runs the Dock’s passive cleanup before the new dialog’s passive setup, so the dialog records the stable Comments button, takes focus, then can return there when it closes. Add an interaction test that activates a real `.dock-question`, asserts focus on `.cmt-close`, closes the dialog, and asserts focus on Comments.

### F20 — P3 · Established: the docs omit the third React error boundary

Both [logging.md](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/project/logging.md:935) and [copy.md](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/project/copy.md:174) say there are two boundaries. There are three `componentDidCatch` implementations:

- `AppBoundary` — `[render]`
- `ChunkBoundary` inside `LazyPage` — `[chunk]`
- `FeatureErrorBoundary` — `[mode-render]`

Exact replacement opening for `copy.md`:

```md
**The three error boundaries are the third exception.** `[render]` is the whole
app failing to draw, `[chunk]` is a lazy route failing to arrive, and
`[mode-render]` is one mode failing while the article stays readable.
```

In `logging.md`, replace “Two error boundaries” with “Three React error boundaries” and add `LazyPage.tsx`/`ChunkBoundary`; all three call both reporting functions.

### F21 — P3 · Established: “no logger” and “11 console calls” still misdescribe the source

[logging.md](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/project/logging.md:51) says `src/web/` has no logger, while the same section describes `recordLog`, structured entries, redaction and a 200-entry ring buffer. That is a client logger; what it lacks is Pino and a continuous remote stream.

The documented grep does return 11 non-preview matching lines, but three are comments in `lib/api.ts`. There are eight executable direct calls in the six named files. The command is a textual scan, not a call counter.

Exact replacement:

```md
`src/web/` has no Pino or continuous remote log stream; it does have the
structured client-side ring buffer in `log-buffer.ts`. A textual grep run on
2026-09-06 returned 11 non-preview matching lines: three mentions in comments
and eight executable direct `console.log`/`console.error` calls across the six
files below. This is a dated inventory of direct spellings, not an enforced
count; re-run it and inspect the matches.
```

Also replace “What the browser has now, none of it a logger” with:

```md
What the browser has now:
```

### F22 — P3 · Established: “modal with respect to the prose” overstates pointer blocking

[comments.md](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/project/comments.md:658) calls the drawer modal with respect to the prose. It is not: only pointer input is intercepted. The prose is not inert or hidden, and focus is deliberately free to leave the drawer.

Exact replacement:

```md
- **Pointer-blocking over the prose**, and only there: the scrim intercepts
  pointer events over the article. The prose is not inert or hidden from
  keyboard or assistive-technology navigation.
```

## ARIA and the remaining suspicions

Dropping `aria-modal` while retaining a labelled `role="dialog"` is the right call. `aria-modal="true"` would claim that every external surface is unavailable, contradicting the deliberately operable Dock. A real modal trap would make that contradiction worse unless the Dock moved inside the modal scope.

The `open`-only dependency is safe today: `Panel` has exactly one legal non-null value, `"questions"`, so `?panel=` cannot switch directly between two open panels. `isConnected` is also sufficient for the unmount case currently described; it prevents focusing a removed opener. It does not address F19 because that opener remains connected while the workflow advances to another dialog.

The existing Escape effect and scrim do not appear to fight the new focus effect.

Verification: focused test 8/8; `git diff --check` clean; no files changed.
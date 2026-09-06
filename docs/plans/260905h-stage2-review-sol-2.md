Refuse on **F23 and F24**, both established P1s.

## Findings

### F23 — P1 · Established: selecting another drawer comment bypasses the dialog’s mount-only focus effect

Sequence:

1. Open comment A, from the gutter or an existing `?note=`.
2. Open the Comments drawer.
3. Select comment B.
4. `App` changes A → B without a `key`, so [CommentDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/CommentDialog.tsx:194) remains mounted.
5. The drawer cleanup restores the Comments button, but the dialog’s empty-dependency effect does not rerun. Focus remains outside the newly selected dialog.
6. Its `openerRef` also still describes comment A’s opening path, so closing B can restore an obsolete gutter control rather than Comments.

This affects visitors and owners. A `/tmp` React harness reproduced both the persistent component and focus remaining on the Comments button.

The smallest closure is a second effect for comment changes, separate from the mount/unmount lifecycle:

```tsx
const dialogRef = useRef<HTMLElement>(null);

useEffect(() => {
  const dialog = dialogRef.current;
  const active = document.activeElement;
  if (dialog?.contains(active)) return;

  if (active instanceof HTMLElement && active !== document.body) {
    openerRef.current = active;
  }
  closeRef.current?.focus();
}, [comment.id]);

// On <aside>:
ref={dialogRef}
```

This leaves prev/next and delete-to-neighbour alone when focus is already inside, but completes the drawer handoff and updates the eventual restore target. Extend the focused test with “dialog A already open → drawer → B → close,” asserting focus first enters B and finally returns to Comments.

### F24 — P1 · Established: deleting a gutter-opened comment can leave focus on `<body>`

When the deleted comment has no neighbour:

1. The gutter button is recorded as the opener.
2. Delete optimistically removes the comment and sets `?note=` to null in the same commit ([App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/App.tsx:3232)).
3. Both the focused Delete button and the gutter opener disappear before passive cleanup.
4. `back.isConnected` is false, so cleanup deliberately does nothing.
5. Focus lands on `<body>`, losing the reader’s position.

A `/tmp` harness reproduced exactly that result.

Smallest closure:

```tsx
if (back?.isConnected) {
  back.focus();
} else {
  document
    .querySelector<HTMLButtonElement>('.dock button[aria-label="Comments"]')
    ?.focus();
}
```

That fallback is meaningful after deletion and naturally does nothing when the whole article and Dock are unmounting. Add a gutter-open → delete-last test.

### F25 — P3 · Established: the documented console command does not perform its stated exclusion

[logging.md](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/project/logging.md:58) says preview pages are excluded, but its command includes them: 18 matches rather than 11.

Exact replacement:

```md
The command is `grep -rn --exclude='preview-*.tsx' 'console\.\(log\|warn\|error\|info\|debug\)' src/web/`,
and the six files are …
```

The dated inventory itself is otherwise durable and correct: 11 textual matches, three comments and eight executable calls across six files.

### F26 — P3 · Established: “Only the prose is behind the dim” is too narrow

The scrim is fixed across the viewport at z-index 92; the comment/chat dialogs are 70 and the structural reader chrome is lower. Therefore much more than prose is behind it.

Replace the sentence in [Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/Dock.tsx:1076) with:

```tsx
The rest of the reader, including the prose, is behind the dim.
```

Correspondingly, the bullet in [comments.md](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/docs/project/comments.md:658) should begin:

```md
- **Pointer-blocking over the reader beneath the dock:** the fixed scrim intercepts
  pointer events over the prose and the other reader chrome below it.
```

### F27 — P3 · Established: the close button is not first in the dialog’s tab order

When navigation is shown, Previous and Next precede `.cmt-close` in [CommentDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a2-mode-failure-containment/src/web/CommentDialog.tsx:270).

Exact replacement:

```tsx
**The close button is the target**: it is stable across comment changes and
is the reader's explicit way out.
```

The three-boundary documentation is correct: exactly three `componentDidCatch` implementations exist, and each calls `captureClientFailure` and `recordLog`.

Prev/next, delete-to-neighbour, and Discuss-this do not otherwise show a lifecycle fight: the persistent dialog preserves internal focus, and the chat composer takes focus after the comment cleanup. Leaving the existing complexity warning alone was the right call.

Verification: supplied focused test **2/2**; temporary adversarial harness **2/2**, with both tests asserting the defects above; no repository files changed.
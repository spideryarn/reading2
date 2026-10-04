# Code review: 261004a a selection's box opens on Yellow, and closing it saves the highlight

Review the BUILT code of commit 0896a975e in this worktree (`git show 0896a975e`), against the plan
docs/plans/261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md
(its last section, your own plan review's findings D1 to D6, wins over the text above it).

Greg (the owner) asked, verbatim: "I like the new human highlights when I select text - can we
default to the yellow colour, and default to saving it, so that it requires fewer clicks?"

Read: src/web/AnnotateDialog.tsx in full, src/web/HighlightSwatches.tsx, src/web/reader/Reader.tsx
(`selectProse`, the `<AnnotateDialog>` mount, its `onSave`), src/web/useComments.ts (`create`,
`createOnLeave`), src/web/help/help-topics.tsx (the `comments` topic), docs/project/comments.md
(§ The box a selection opens, § Copying the passage, § Deliberate limits),
tests/annotate-dialog-keeps-a-draft.test.tsx, tests/annotate-dialog-copy.test.tsx.

You may fix what you find inside this stage (the files above and their tests). Anything wider,
report and leave. Do not commit; leave your changes in the working tree. Run
`npx vitest run tests/annotate-dialog-keeps-a-draft.test.tsx tests/annotate-dialog-copy.test.tsx`
and `npm run typecheck` after any change.

Check in particular:
1. `flush(leaving, chosen)`: are the two gates exactly D1's, tested before `fate` moves? Any path
   where an untouched box is stored by an exit nobody chose, a draft is stored twice, or stored
   against the wrong passage. The bfcache `pageshow` replay after an untouched `pagehide`.
2. State versus ref: `colourChanged` and `copyPressed` are React state read through
   `latest.current` by `flush`. Copy pressed and the × pressed in the same frame, before a render:
   does `close` see `copyPressed`? If not, fix it (a ref set synchronously beside the state is the
   house pattern, as `fate` is) and add the test that is red first.
3. The hint's three states and the placeholder: true in every state, Referee included? Is the hint
   wrong when the reader picks No colour after Copy, or when `!loaded`?
4. Referee mode (`placing`): unchanged behaviour, and the default read once at mount.
5. Tests: any new case that passes without the change (say which, and pair it), any case the plan
   review asked for that is missing, any leak between cases (the test defines
   `navigator.clipboard` and never removes it).
6. Other suites that mount this box and would now see `colour: "yellow"` or a save on Escape where
   they assumed none: tests/one-escape-closes-one-surface.test.tsx,
   tests/opening-read-gates-writes.test.tsx, tests/what-the-enter-key-promises.test.tsx,
   tests/touch-selection-chip.test.tsx, tests/marginalia-notes.test.ts, any Playwright spec. They
   pass; say whether any passes for the wrong reason.
7. The docs and the Help text: anything now false that still says an untouched box stores nothing
   (docs/project/touch.md, quotes.md, the header comments of Reader.tsx and useComments.ts).

Severity P0–P3, IDs C1, C2, …, file:line evidence. For each: fixed here / reported. Verdict on the
first line of your answer: land as is / land after fixes (made) / do not land.

# Plan review: 261004a a selection's highlight is yellow by default, and closing the box saves it

Read-only review of a PLAN:
docs/plans/261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md, in
this worktree. Read it, then: src/web/AnnotateDialog.tsx (all of it, header comment included),
src/web/HighlightSwatches.tsx, src/web/reader/Reader.tsx (`selectProse`, the `<AnnotateDialog>`
mount and its `onSave`), src/web/TouchSelectionChip.tsx, src/web/useEscapeToClose.ts,
src/web/useComments.ts (`create`, `createOnLeave`), docs/project/comments.md (§ The box a selection
opens, § Copying the passage, § Deliberate limits), docs/project/quotes.md (§ Your highlights are
rows too), docs/plans/261003i-the-comment-box-never-loses-a-draft-and-ask-ai-is-a-button.md and its
plan review, tests/annotate-dialog-keeps-a-draft.test.tsx, tests/annotate-dialog-copy.test.tsx,
tests/one-escape-closes-one-surface.test.tsx.

Greg (the owner) asked, verbatim: "I like the new human highlights when I select text - can we
default to the yellow colour, and default to saving it, so that it requires fewer clicks?"

Answer:
1. Is the plan a faithful and sensible reading of his sentence? Is the split it draws, explicit
   closes (×, Escape, Save, Ask AI) store an untouched yellow box and implicit exits (another
   selection, unmount, pagehide) do not, the right line? Argue the other side if you would draw it
   elsewhere (for example: every exit but Discard stores; or only Save stores).
2. Is the two-predicate design (`isTouched` gating implicit exits, `hasSomethingToStore` plus the
   Copy rule gating × and Escape) correct against the existing latch (`fate`), the draft id, the
   bfcache `pageshow` replay, StrictMode's mount-cleanup-mount, and Reader's keyed mount? Name any
   path where a draft is stored twice, stored against the wrong passage, or where an untouched box
   is stored by an implicit exit after all (e.g. Escape while CommentDialog or ChatDialog is in
   front and `escapeEnabled` is false; the textarea's first Escape; `pageshow` after an untouched
   `pagehide`).
3. The Copy rule ("Copy then close stores nothing if nothing else was touched"): is it worth its
   one boolean, or is it a hidden rule that will surprise? Is "at the press, not at the resolve"
   the right moment?
4. Referee mode keeps no default colour. Right, or an inconsistency that will bite?
5. Ask AI now stores yellow by default, which makes the word a row in Quotes. Is the plan right to
   store what the box shows and ask Greg, or should the default be dropped for Ask AI now?
6. Anything else that reads `colour` at create time and would change behaviour once most new
   comments carry one: the drawer, marginalia, Quotes rows and counts, the public projection,
   export, search-hit overlap, the ✳ mark, `commentKind`.
7. Tests: is a case missing, and is any listed case one that could pass without the change?
8. Is there a simpler version that does what he asked?

Severity P0–P3, IDs D1, D2, …, file:line evidence, a concrete change to the plan. Verdict: build
as planned / build with changes / rethink. Write the verdict on the first line of your answer.

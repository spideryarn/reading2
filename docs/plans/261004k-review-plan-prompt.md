# Review the plan: the block chat as a card in the Marginalia column

You are reviewing a **plan**, read-only. Do not change any file.

## The candidate

Live pre-commit candidate, base `4995c5be4`, one untracked file:

- `docs/plans/261004k-block-chat-as-a-card-in-the-marginalia-column.md`

It follows `docs/plans/261003p-block-chat-spinner-and-docking-in-the-marginalia-column.md` (option A,
shipped) and its two reviews (`261003p-review-plan-gpt-sol.md`, `261003p-review-code-gpt-sol.md`).

Code the plan would change, to read against it (this does not limit scope):

- `src/web/ChatDialog.tsx` (the panel; `useChat`, the focus lifecycle, the "?" auto-send latch)
- `src/web/reader/Reader.tsx` (§ `overlay`, `chatOpenBlock`, `chatDockRoom`, `marginNotes`,
  `openAskedFromDrawer`, and where `<ChatDialog>` is mounted)
- `src/web/marginalia/MarginaliaColumn.tsx` (`MarginNotesSlot`, `CommentNote`, `ShutNote`,
  `useMarginLayout`), `src/web/marginalia/notes.ts`
- `src/web/TableView.tsx` (the `margin` prop, the cell's click and selection handlers)
- `src/web/layout.ts` (`fitMargin`, `fitBoth`, `chatDock`)
- `src/web/styles/dialogs.css` (§ `.chat-dialog`, `.chat-dialog.docked`), `src/web/styles/marginalia.css`
- `docs/project/marginalia.md`, `docs/project/comments.md` § chat-dock, `docs/project/fonts.md`

## What to do

An independent attack on the plan first. Will this design work in this codebase as written? What
will break, what is missing, what is more machinery than the job needs, and is there a simpler shape
that gives Greg the same trial? Trace real code paths rather than reasoning from the plan's prose;
where the plan asserts something about the code ("the shut line un-truncates when open", "React
events bubble through the portal", "useMarginLayout collects `[data-marg-note]`"), check it.

The product decision is Greg's and is not under review: option B, expandable and collapsible, as a
trial, with A reachable behind one switch, and A's floating panel kept where there is no column.

## Output

Severity by consequence: **P0** data loss, security, charging, or broadly unusable; **P1**
user-visible wrong behaviour or an authoritative contract violated; **P2** design or maintainability
risk; **P3** prose. Say for each finding whether it is **established** (direct evidence, exact source
path) or **reasoned**. IDs `F1`, `F2`, … One verdict line at the top: *build as written* / *build
after changes* / *rework*.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Does a `setState` from a ref callback on the host reach `ChatDialog` before paint, or is there a
  visible frame of the docked panel on every open?
- Changing `createPortal` on and off inside `ChatDialog`: does the `Composer`/`Conversation` subtree
  remount, and does anything in it not survive that (the plan claims the draft and the help latch do)?
- `useMarginLayout` gathers the notes once per `key`; is the host in that list at the right time?
- Are there native listeners on the prose that a portal does not shield the card from?
- Auto-collapse when scrolled out of view: can it loop with the layout pass (collapse changes
  heights, which moves things, which changes intersection)?
- `focus({ preventScroll: true })` and the iPad keyboard.

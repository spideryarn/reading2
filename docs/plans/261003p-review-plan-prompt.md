# Review prompt — plan 261003p (plan stage, read-only)

You are reviewing a **plan**, before anything is built. Do not change any file.

**Candidate (live, pre-commit):** base `8019e3549`; one untracked file,
`docs/plans/261003p-block-chat-spinner-and-docking-in-the-marginalia-column.md`. Read it first.

**The code it is about** (a starting list, not a limit on scope):
`src/web/ChatPanel.tsx` (`Turn`, the block starting `const thinking =`, and `ToolStrip`),
`src/web/ChatDialog.tsx`, `src/web/styles/dialogs.css` § `.chat-dialog`,
`src/web/layout.ts` § `fitMargin` / `fitBoth` / `Fit`, `src/web/styles/marginalia.css`,
`src/web/reader/Reader.tsx` (`overlay`, where `ChatDialog` mounts, `marginRoom`),
`src/web/styles/narrow-window.css`, `docs/project/loading-spinner.md`, `docs/project/marginalia.md`,
`docs/project/comments.md`, `docs/project/touch.md`.

**What I want from you, independently, before reading my suspicions:**

1. Is the plan's account of the code true? In particular the claimed spinner gap (pending, no text,
   every tool row finished) — trace it in `Turn` and in the chat reducer (`src/web/chat/reduce.ts`):
   can a message really be in that state, and for how long?
2. Does Stage 2 (docking the fixed panel over the Marginalia column) break anything the plan does
   not name: the keyboard inset on iPad, the focus contract, `narrow-window.css` rules keyed on
   `.chat-dialog`, z-order against `.marg-head`, the dock/controls bars, the return chip, the
   jobs tray, anything else fixed on the right?
3. Is `chatDock` computable from `Fit` and the window width as described, in both `fitMargin` and
   `fitBoth`? Is `--marg-left` what the plan thinks it is?
4. Is there a simpler design that gets the same value, or a reason option B is cheaper than the
   plan says?
5. Anything in the tests section that would pass without the feature (a check never seen red).

**Severity scale:** P0 data loss / security / charging / broadly unusable; P1 user-visible wrong
behaviour or an authoritative contract violated; P2 design or maintainability risk; P3 prose.
Grade by consequence. Give every finding an ID, F1, F2, …, and say whether it is **established**
(direct evidence in the source) or **reasoned**. End with a one-line verdict: build as planned /
build after changes / do not build.

**My own suspicions (already mine; spend most of the run elsewhere):**
- 272px may be too narrow for a composer with its buttons.
- A top-anchored panel on an iPad with the soft keyboard up.
- Whether the mark on the block needs a prop through `TableView` or can be done some cheaper way.

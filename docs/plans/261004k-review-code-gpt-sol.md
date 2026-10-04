land after fixes (applied)

Five stage defects were reproduced and fixed red-first. One wider defect is reported below. No commits; no plan or `docs/project/` edits by this review.

- **F8 — P1, established, fixed: keyboard protection missed loaded-thread composers.** The composer lives in the conversation body, while focus and viewport handling checked only the footer. Two new tests observed **zero** `scrollIntoView` calls on thread-composer focus and viewport changes. Handling now locates the actual composer. Both tests pass in [chat-dialog-in-column.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/tests/chat-dialog-in-column.test.tsx:680).

- **F9 — P1, established, fixed: mounted A → B → A revived A’s collapsed state.** The existing test checked only A → B. The new return-trip test failed with `collapsed=true`. Leaving a selected thread now clears its collapse latch. The regression passes in [chat-dialog-in-column.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/tests/chat-dialog-in-column.test.tsx:394).

- **F10 — P1, established, fixed: hidden transcript updates broke scroll following.** With hidden geometry emulated, an answer finishing while collapsed restored offset **800 instead of 1400**. Hidden updates and scroll events also cleared a scrolled-up reader’s “Latest” control. `Conversation` now ignores hidden geometry and resumes its existing follow policy on expansion. Three red-first regressions cover completion, the earlier reading position and hidden scroll events.

- **F11 — P1, established, fixed: changing anchor hosts lost focus on an unchanged control.** A composed Reader/ChatDialog test confirmed that the Close button retained its DOM identity through A → B, yet focus fell to `<body>`. The move previously saved focus only when the host prop already differed; Reader’s old host can disappear during that commit. Focus is now captured before every commit and restored only on an actual move. [chat-card-host-change.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/tests/chat-card-host-change.test.tsx:79) went red, then green.

- **F12 — P1, established, fixed: adding or removing a card closed an expanded margin note.** Changing the entry from `MarginNotesSlot` to a fragment remounted the disclosure. The red test observed changed DOM identity and `aria-expanded=true→false`. Reader now keeps the note at a stable React child position. The arrival-and-close regression passes in [chat-dock-wiring.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/tests/chat-dock-wiring.test.tsx:297).

- **F13 — P1, established, reported: switching conversations while typing loses composer focus in floating mode too.** A temporary float-only probe confirmed that the old textarea disconnects, its replacement is distinct, and focus becomes `<body>`. The pre-stage code already keys `Conversation` by thread ID without a corresponding focus transfer. This wider behavior was left unchanged.

The plan-review findings are now closed as follows:

| Finding | Result |
|---|---|
| F1 | Chip, “?”, prose mark, Comments drawer and margin opening paths provide the reopen signal; F9 closes mounted return trips. |
| F2 | Width calculation subtracts the rem-scaled gap before minimum/cap checks. |
| F3 | The measured host precedes ordinary notes; the aside contributes its height. |
| F4 | Fold subscription selects dock/float fallback while the anchor is folded. |
| F5 | Persistent portal preserves live children; editor/move tests detect remounts, and F11 fixes host-replacement focus. |
| F6 | Draft and thread composer focus/viewport handling now pass, including nonzero `offsetTop`. Physical iPad Safari keyboard behavior remains unproven. |
| F7 | Chat links retain previews with null paragraph provenance; matching article/chat URLs are tested. |

`CommentDialog.onOpenThread` does not increment `reopen`, but that path mounts a fresh ChatDialog because CommentDialog renders without an overlay. It cannot retain a collapsed card through that path.

The requested mutation checks all detected their corresponding defects:

| Test coverage | Mutation | Result |
|---|---|---|
| Dock/float fallback | Disable dock selection | Failed |
| Disconnected-host fallback | Accept a detached host | Failed |
| Container cleanup | Remove container removal | Failed |
| Draft collapse control | Permit draft collapse | Failed |
| Collapse isolation | Remove thread-ID comparison | Failed |
| Help sent once across moves | Remove help latch | Failed |
| Open editor survives moves | Key Conversation by placement too | Failed |

For **all four not-prose tests**, I also checked the actual failure mechanisms. Removing the portal failed the placement requirement. Drawing the unportalled panel as an ordinary margin child, still inside the host, preserved placement but caused **row selection and an unwanted passage callback**. A wholly internal selection remained excluded by the prose-origin guard; additionally labelling that inline panel `.prose` made that test fail too. These were temporary mutations and fixture relocations; all were removed.

Validation:

- All eight requested files passed initially: **111 tests**. After fixes, `npm test -- <those eight files>` passed **118 tests**.
- Nine additional files passed: `chat-card-host-change`, `chat-dialog-docks`, `chat-dialog-gives-focus-back`, `chat-dialog-shares-the-draft`, `chat-empty-reads-from-the-top`, `chat-live-dictation`, `chat-open-block-mark`, `chat-turn-waiting-spinner`, and `one-escape-closes-one-surface`. Combined: **17 files, 196 tests passed**.
- `npm run typecheck` could not launch because the sandbox rejected tsx’s IPC socket. Running the same guarded script with `node --import tsx scripts/typecheck.ts` **passed all four projects and coverage of 3028 source files**.
- Scoped lint passed with two existing warnings and eight informational findings. Repository-wide lint remains red on its baseline. `git diff --check` passed.

This review used source tracing and DOM component tests; it did not rerun the browser screenshots or test a physical iPad.
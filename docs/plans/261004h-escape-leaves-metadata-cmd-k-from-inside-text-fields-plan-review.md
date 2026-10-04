1. **P1 — A command selection can discard unsent text.**  
   **(a)** Type an unsent question in Chat, press ⌘-K, choose Search, then return to Chat. The draft is gone: [ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-metadata-escape-cmdk-icon/src/web/ChatPanel.tsx:395) explicitly keeps drafts only for the panel’s lifetime. Likewise, a Comment follow-up lives in component state and disappears when a page command unmounts it. Opening and dismissing the bar preserves these drafts; selecting a command need not.  
   **(b)** Add draft preservation before command-driven mode/page changes, using reader/article-scoped storage that survives those unmounts. Add round-trip tests for Chat and Comment follow-ups.

2. **P1 — Metadata Escape can abort dictation after focus leaves the textarea.**  
   **(a)** Start dictating “Why you’re reading this one,” move focus to another button, and press Escape. The typing guard no longer applies. Navigation unmounts `ProfileBox`; [useDictation.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-metadata-escape-cmdk-icon/src/web/useDictation.ts:1854) aborts recording/transcription. Autosave preserves existing text, but the authoritative transcript never arrives. Device audio recovery is best effort.  
   **(b)** Feed `ProfileBox.onBusyChange` into the Metadata Escape guard and decline navigation while recording or transcribing, regardless of focus. Test Escape from a button during both states. Background pipeline jobs need no equivalent guard: their lifetime already outlasts Metadata.

3. **P2 — Ctrl-K in a Mac text field loses its editing meaning.**  
   **(a)** On a Mac, place the caret halfway through a textarea and press **Ctrl-K**. [isModChord](/home/greg/code/spideryarn2/.claude/worktrees/fb-metadata-escape-cmdk-icon/src/web/key-chord.ts:51) accepts either Ctrl or Meta on every platform. Removing the typing refusal therefore opens Commands and prevents delete-to-end-of-line, although Greg requested **Command-K**.  
   **(b)** Preserve Ctrl-only K while typing on a Mac, locally in `useCommandBarChord`; keep ⌘-K working there and Ctrl-K working on Windows/Linux. Add platform-specific tests. On Windows/Linux, cancelling a browser’s Ctrl-K binding when opening Commands is correct.

4. **P2 — Inline confirmations do not own Escape.**  
   **(a)** Open “Delete permanently,” then press Escape with body or a confirmation button focused. The confirmation in [Metadata.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-metadata-escape-cmdk-icon/src/web/Metadata.tsx:3229) is ordinary markup with no Escape handler. The sharing confirmation has the same gap. Escape leaves Metadata and unmounts the confirmation instead of cancelling it in place. Neither is protected by `dialog[open]`.  
   **(b)** Add a consuming Escape handler while either confirmation is active: cancel the confirmation, restore trigger focus, and stop propagation. Test that the first Escape stays on Metadata and a subsequent Escape leaves.

5. **P2 — Opening Commands commits and removes a title editor.**  
   **(a)** Edit the title, type a partial replacement, press ⌘-K, then dismiss Commands. `showModal()` moves focus, triggering [TitleEditor’s blur submission](/home/greg/code/spideryarn2/.claude/worktrees/fb-metadata-escape-cmdk-icon/src/web/TitleEditor.tsx:121). The rename saves and the input unmounts. The plan’s promise that the field remains behind the modal and receives focus back is false here; Escape can no longer cancel that rename.  
   **(b)** Suspend title-editor blur submission when focus moves into Commands, retaining the editor until the bar closes. Add a real-browser round-trip check; the tests’ `showModal()` stub does not move focus.

I found no existing field handler that needs to receive modified K. The drawer’s capture listener handles Escape only, so moving the K listener does not create an ordering collision there. Search drafts already survive mode changes; annotation drafts save on unmount; tooltips and hover cards consume Escape before the proposed Metadata listener.

The permitted test run passed: `tests/command-bar.test.tsx`, **71 tests**. Files changed concurrently during the review; I made no edits.

**Ready with changes.**
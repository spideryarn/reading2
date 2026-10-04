**build after changes**

1. **F1 — P1, established: reopening the current conversation cannot reliably expand it.**  
   The plan stores the collapsed thread ID inside `ChatDialog`, but the existing reopening paths only write `?thread=`. [openChatThread](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/reader/Reader.tsx:1967), the gutter chat handler, and the “?” handler can write the ID already open. That supplies no new opening event to clear the collapsed state. An ID also prevents collapse transferring to B, but does not prevent A remaining collapsed after A → B → A.

   Add an explicit reopening signal shared by these paths. Test pressing the gutter chip and “?” on the **already selected, collapsed** thread.

2. **F2 — P1, established: the specified width calculation omits the margin gap.**  
   Decision 4 says the gap is subtracted, but its formula subtracts only `CHAT_DOCK_GUTTER`. [fitBoth](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/layout.ts:608) gives `margLeft = 1152` at 1440px with Structure. The proposed helper therefore returns 280px. Adding the existing 20px `--marg-gap` puts the card’s right edge at **1452px**. The same calculation overruns an 1180px window by 12px.

   Subtract the actual gap **before** checking the minimum and applying the cap. Account for its rem sizing, and assert the right edge and gutter in the browser check.

3. **F3 — P1, established: appending a separately measured host does not place the card level with its block.**  
   [MarginNotes](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/marginalia/MarginaliaColumn.tsx:191) groups that block’s ordinary notes into one `[data-marg-note]` box. [useMarginLayout](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/marginalia/MarginaliaColumn.tsx:741) assigns both that box and the appended host the same row top; [layoutNotes](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/marginalia/notes.ts:381) then pushes the host below the ordinary notes plus 8px. An expanded existing note can push the chat substantially away from its paragraph.

   Specify the ordering deliberately—preferably the card first—and qualify alignment where earlier notes already collide. Also settle the geometry explicitly: position the measured host outside the cell, with the aside contributing height inside it. The proposed absolute aside would otherwise leave the host’s `offsetHeight` at zero.

4. **F4 — P1, established: folding defeats “Never nothing.”**  
   [foldCss](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/fold.ts:148) hides cells with `display:none`; it does not unmount their contents. Folding the section containing an open chat therefore leaves its host node in hand while hiding the card. The plan’s fallback condition still chooses card mode.

   Use the existing [fold subscription and visibility predicate](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/fold.ts:232) to select A while the anchor is folded. Test folding and unfolding with a conversation open.

5. **F5 — P1, established: the portal preserves `ChatDialog`, but remounts its live surface.**  
   I ran a fileless probe against the installed React: inline → portal → inline → portal kept the parent mounted once and mounted its child **four times**. The main draft and `sentHelpFor` survive above that boundary, as claimed. Other state does not:

   - [Conversation](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/ChatPanel.tsx:1111) owns transcript position, follow state, and the open editor.
   - [EditQuestion](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/ChatPanel.tsx:2011) owns the unsent rewrite.
   - [Dictation cleanup](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/useDictation.ts:1865) aborts transcription and ends capture on unmount.

   Focus also falls away during a move. The existing [focus-return effect](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/ChatDialog.tsx:488) captures the original aside once, so replacing that aside leaves its containment check pointing at a detached element.

   Prefer one persistent portal container moved between attachment points. Extend the resize test beyond draft text and send count to editor state, transcript position, focus, and focus return.

6. **F6 — P1, reasoned: shrinking a block-anchored card does not keep its composer above the iPad keyboard.**  
   The current panel combines a reduced height with a **bottom anchor**. [useVisualViewport](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/useVisualViewport.ts:41) also supplies `offsetTop`, because Safari can pan its visible viewport. B removes the bottom anchor while retaining only the height subtraction.

   For example, a card beginning 350px down the viewport can extend beneath a keyboard whose visible strip ends at 500px, even with its height capped at 300px. `preventScroll` does not resolve that geometry.

   Define how the composer is brought into the visible strip when focused. Exercise nonzero `offsetTop`; desktop Chrome at iPad dimensions cannot establish Safari keyboard behaviour.

7. **F7 — P1, established: moving chat links into a prose row changes their inferred provenance.**  
   [ProseHoverCard](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/ProseHoverCard.tsx:429) derives `inBlock` from the nearest `tr[data-block]`. After portalling, a chat answer’s external links and source links acquire the anchor paragraph’s ID. [link-facts.ts](/home/greg/code/spideryarn2/.claude/worktrees/qi-9gtawaxd-margin-chat-card/src/web/link-facts.ts:1003) relies on `inBlock === null` to withhold paragraph-relative summaries from chat links.

   Restrict article provenance to links actually inside the authored prose. Avoid the plan’s blanket exclusion of native listeners: chat link previews and block-link hover cards intentionally use delegated native listeners and should continue working. Test a chat link matching a URL present in the anchor paragraph.

The simpler trial is a persistent chat surface, a measured host with explicit geometry, and **manual** expand/collapse initially. Automatic collapse adds visibility history, focus exceptions, and viewport handling beyond Greg’s requested trial; it can follow once placement works.

The shut-line duplicate is real and its proposed fix is sound. Portal events do bypass the table’s React handlers, and host collection occurs after DOM attachment; I found no established one-frame docking defect. Without automatic re-expansion, collapse alone does not inherently create an intersection/layout oscillation.

Add a Reader-level test for actual placement, reopening, filtering, and fallback. Tests handed a host directly cannot detect removal of Reader’s switch wiring. No files changed.
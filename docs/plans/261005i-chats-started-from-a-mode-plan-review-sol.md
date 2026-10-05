The plan is **not ready**. The established blockers are missing summary refresh wiring, docking that depends on Marginalia being enabled, and widening Chat’s thread list without protecting its active conversation logic.

The underlying design is sensible: keep `kind`, `anchor` and `origin` separate; derive caller links from origins; reuse Chat’s tools and dialog. I found no substantially smaller persisted design that delivers both requests.

**F1 — P1, established: the caller’s mark will not appear after the first conversation without a reload.**

(a) D2 relies on summaries fetched once per article. [`useChatAnchors.ts:324`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/useChatAnchors.ts:324) fetches them only when `slug` changes. Chat’s band receives no summary-update callback at [`Reader.tsx:2900`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/reader/Reader.tsx:2900); its send handler only submits and updates the selected thread. Adding `origin` to responses does not refresh this separate list.

Scenario: check a claim → Send → answer finishes → Back to Debate. The mark is absent. Existing marks also retain stale outcome lines after follow-ups, retries and edits.

(b) Add this first-stage checklist item:

> **Keep caller summaries current.** Refresh `useChatAnchors` when returning to a caller mode and after a conversation is created, finishes a turn, is edited, retried or deleted. Preserve its protections against stale fetches and local writes; do not lift streaming transcript state into Reader. Test check claim → Send → finished answer → Back → mark and latest line → reopen, without reload; also test a follow-up and deletion.

**F2 — P1, established: a wide window alone does not dock the conversation.**

(a) D3 promises docking when the window is wide. [`chatDock`, `layout.ts:945`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/layout.ts:945) returns `null` whenever `fit.margW` is zero. Reader’s fit depends on `marginOpen` at [`Reader.tsx:520`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/reader/Reader.tsx:520).

The diagnostic script established:

| Width | Marginalia off | Marginalia on |
|---|---|---|
| 1440 | floating | docked |
| 820 | floating | floating |
| 390 | floating | floating |

(b) Replace D3’s reopening sentence with:

> Once the thread exists, pressing its mark sets `thread=<id>` and `margin=1` together, preserving the current mode and sub-mode. This reserves the existing right-hand column when it fits; `ChatDialog` docks there when `chatDock` permits and floats otherwise. Test reopening with Marginalia initially both off and on at all three widths.

**F3 — P1, established: listing every kind also makes Chat open every kind.**

(a) The second stage says to hand Chat’s panel every listable thread. But [`ChatPanel.tsx:373`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/ChatPanel.tsx:373) selects the active conversation from that same array. A reader leaving Remember and selecting Chat carries Remember’s `?thread=` into it. Widening the array therefore opens that conversation inside Chat despite D5.

Chat’s send still uses the band’s `kind="chat"` and on-screen blocks at [`ConversationModes.tsx:931`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/modes/conversation/ConversationModes.tsx:931). The server rejects `visible` on a non-chat thread at [`routes.ts:2984`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/routes.ts:2984). Changing row-click navigation alone does not close this path.

(b) Replace the second-stage implementation item with:

> Separate **listable threads** from **conversations Chat may open**. Give `ThreadList` every kind except Candidates, but resolve Chat’s active conversation and thread drafts only against `kind === "chat"`. Once loading establishes that Chat’s `?thread=` names another kind, clear it with replace and show the list. A Remember row pushes `mode`, `remember` and `thread` together in one navigation. Base the empty-list arrival rule on all listable conversations, so an article with only Remember conversations shows those rows. Test entry from Remember, a pasted non-chat thread URL, and an article with no ordinary chats.

**F4 — P1, reasoned: Live can create the thread before the origin-bearing Send.**

(a) The first stage carries origin only through `SendOptions.origin`. Chat already offers Live on an empty handoff conversation: [`ChatPanel.tsx:621`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/ChatPanel.tsx:621) passes its Live controls through. [`withSpokenTurn`, `chat.ts:455`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/chat.ts:455) can create the stored thread through a separate path.

Scenario: check claim → start Live before Send → finish a spoken exchange. That creates an ordinary thread without origin. The later typed Send cannot attach origin under the proposed insert-only rule.

(b) Add:

> **First-slice Live rule.** While an unsaved conversation carries a pending origin, omit Live and refuse its start callback. Enable Live after a typed Send has established the stored origin. Test that Live cannot create an originless thread from a claim handoff. Supporting a spoken first turn with origin is a later stage.

**F5 — P2, reasoned: origin’s lifetime is required but its owner is unspecified.**

(a) The plan correctly notices draft movement, but its single immediate handoff/Send test does not exercise it. The handoff is consumed at [`ConversationModes.tsx:756`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/modes/conversation/ConversationModes.tsx:756); arrival can move the draft to another id at line 814. [`chat-draft.ts:97`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/chat-draft.ts:97) currently moves text alone. Component-local origin would disappear on unmount; one article-wide pending origin could contaminate another conversation.

(b) Replace “Client, carrying it” with:

> **Client, carrying it.** Store pending origin beside the thread’s draft in the existing article-scoped draft store, keyed by thread id. Set it when taking the handoff; `moveThread` moves it and `dropThread` removes it. Text edits do not change it. Send reads the selected thread’s pending origin; retain it until the server confirms the stored origin, including after a failed first request. Test mode departure and return, draft movement, two independent handoffs, clearing and discarding a draft, and a failed first Send.

**F6 — P1, established: the filter contradicts the URL-state contract.**

(a) D5 explicitly keeps the source filter out of the URL. [`url-state.md:10`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/docs/project/url-state.md:10) explicitly requires view state in the URL. This filter changes which conversations the reader sees; reload and copied links would show a different list.

(b) Replace the filter bullet with:

> A filter above the list: All, the default; Chats; then each other source present. Store the selection in its own query parameter, with absent meaning All. Derive available choices from the complete list. If the selected source disappears, replace it with All before hiding the control. Test reload, Back and a copied filtered URL.

**F7 — P1, established: the listed migration step generates SQL but never applies it.**

(a) The checklist names only `npm run db:generate`. [`scripts/db-generate.ts:313`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/scripts/db-generate.ts:313) explicitly says `db:migrate` applies the result. [`database.md:199`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/docs/project/database.md:199) names that separate operation.

Following the checklist literally leaves the running database without the columns that the new store reads and writes.

(b) Replace the migration item with:

> **Migration**, additive: generate the columns, CHECKs and composite identity FK; inspect the SQL and CHECK expressions. Apply it with `npm run db:migrate`, verify its `Target:` line, and run the database round-trip and constraint tests before browser verification. Production application remains part of the Overseer’s deployment.

**F8 — P2, established: Q-open-where promises a sidebar Chat does not have.**

(a) Option B says “list on the left”; its deciding criterion is continuing a conversation “with your other chats in view.” [`ChatPanel.tsx:596`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/ChatPanel.tsx:596) renders the conversation and list as alternatives. Neither option provides that sidebar today.

(b) Replace option B’s opening and the deciding paragraph with:

> **B. It opens inside Chat.** The conversation replaces Chat’s list, as an ordinary chat does today. Returning to the list lets you choose another conversation. Keeping the list visible beside the transcript would be additional layout work, outside this choice.
>
> **What would decide it.** Choose A if these conversations should retain Remember’s controls and context. Choose B if you want to continue them within Chat. Neither option keeps other conversations visible beside the transcript in this slice.

**F9 — P2, reasoned: the later summary option lacks an explicit spending action.**

(a) Q-thread-summary B proposes a paid model call “when the chat goes quiet.” The supplied charging rule requires a press. Default A avoids this in the current stages, but B needs a valid trigger before becoming a build stage.

(b) Replace option B’s opening with:

> **B. A “Summarise conversation” button writes or refreshes one sentence using a fast model.** Each press makes one additional paid call. Until pressed again, the saved summary may lag later conversation turns. Automatic refresh is a separate product decision.

The remaining suspicions do **not** establish additional defects:

- **An anchorless thread can render in `ChatDialog`.** Its thread target requires only an id at [`ChatDialog.tsx:133`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/ChatDialog.tsx:133); the transcript branch does not require an anchor. Docking’s missing condition is F2.
- **The identity FK is appropriate.** Use the composite `(article_id, origin_block_id)` reference, matching the anchor FK at [`schema.ts:3720`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/db/schema.ts:3720). Identities survive re-extraction.
- **The proposed cap is not too short for summary paragraphs.** `MAX_ANCHOR_CHARS` is 20,000; the summary seed quotes at most 2,000 escaped characters. Keep the full origin snapshot separate from the shortened composer quote.
- **`reader_notes` needs no first-slice eligibility change.** [`reader-notes.ts:287`](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/reader-notes.ts:287) already includes ordinary origin chats. The script confirmed inclusion. Adding source labels to its index can remain deferred.

Separately, the four questions for Greg are product choices:

| Question | Answerable without reading code? | Technical call for you? |
|---|---|---|
| Open where | After F8 corrects the promised sidebar | Navigation mechanics are yours; destination is Greg’s |
| Dig deeper | Yes; the structured-result trade-off is explained | No |
| Thread summary | Yes, after making spending and freshness explicit | Trigger implementation is yours; summary versus latest line is Greg’s |
| Start beside | Yes, after correcting docking’s conditions | Layout mechanics are yours; first-visit experience is Greg’s |

Verification was read-only: the diagnostic script passed, and the single test file passed all 10 tests using `--configLoader runner`. No database or browser verification was possible. No files were changed.

not ready
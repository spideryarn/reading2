The core design is appropriately small: a paragraph button, the existing handoff, and an editable draft. I would resolve the quotation boundary and length handling before building. No files changed.

1. **F1 — P2: Seeing the text before Send does not establish its trust boundary.**  
   **Plan:** [line 38](docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md:38), [line 115](docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md:115).  
   **Evidence:** [converse.ts:1897](src/converse.ts:1897) appends the question directly to the final user message. Nothing parses the opening quotation or treats its contents specially. The existing passage handoff explicitly distinguishes quoted content from instructions at [converse.ts:2026](src/converse.ts:2026).

   A summary can repeat instructions from an article; editable quotation marks alone do not make those instructions the reader’s request. **Change the plan:** identify the text as an AI-generated summary and explicitly mark it as content to discuss, not instructions. Use the existing [untrusted-fence.ts:22](src/untrusted-fence.ts:22) machinery, which also prevents text from closing its own delimiter. This requires no server field or system-prompt change.

2. **F2 — P1: A valid stored paragraph can produce a draft that cannot be sent.**  
   **Plan:** [line 118](docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md:118).  
   **Evidence:** Summary validation limits **words across a level**, not characters per paragraph ([simple-summary.ts:683](src/simple-summary.ts:683), [types.ts:5300](src/types.ts:5300)). Consequently, “a few hundred characters” is an expectation, not a guaranteed bound. Chat rejects the entire message above 4,000 characters ([routes.ts:3032](src/routes.ts:3032)); that includes the header, quote, and reader’s question.

   **Change the plan:** specify what happens when the assembled draft exceeds the cap. Preserve the draft and give a clear local length message before sending; avoid silently truncating the paragraph. Add a boundary case. The proposed Reader test should also append a question and verify the exact POST body, rather than stopping at “nothing POSTed.”

3. **F3 — P3: The title rationale describes `titleFrom` incorrectly.**  
   **Plan:** [line 52](docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md:52), [line 95](docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md:95).  
   **Evidence:** [chat.ts:115](src/chat.ts:115) collapses whitespace before cutting at a word boundary. Keeping the header and quote on one line therefore buys nothing. The proposed prefix consumes 30 of the 60 characters, leaving little distinguishing paragraph text. The title also starts with the header, not the paragraph’s own words.

   **Change the plan:** remove the one-line requirement and use a shorter heading if recognition in the list matters. Qualify the saved-conversation promise with “after Send”: new conversations are local until then ([useChat.ts:601](src/web/useChat.ts:601)), and unsent drafts disappear on a mode switch ([ChatPanel.tsx:392](src/web/ChatPanel.tsx:392)).

4. **F4 — P3: Typing a question is not required by the reused composer.**  
   **Plan:** [line 27](docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md:27).  
   **Evidence:** [ChatPanel.tsx:2258](src/web/ChatPanel.tsx:2258) allows any nonempty draft, so Send immediately after handoff sends the quoted paragraph alone.

   **Change the plan:** say “Nothing is sent until the reader presses Send.” Keeping this existing behavior is simpler than introducing a separate question requirement.

Deferring a persistent return link is right. Option 1 represents origin honestly, though an unchanged paragraph’s hash can survive a rewrite—the mark disappears when its identity changes, not necessarily on every rewrite. Option 2’s rejection is sound: a summary chat could become the conversation reopened by the source block’s “?” button ([useChatAnchors.ts:189](src/web/useChatAnchors.ts:189)). Option 3’s rename, edit, and collision weaknesses are real. A cheaper future experiment would be a session-only paragraph-to-thread map, explicitly without persistence; it need not enter v1.

The trailing blank line survives `seed` and `draftFor`; Send trims it. I found no width-dependent mounting branch that would prevent the phone handoff from being taken. A later summary rewrite does not alter the copied draft.

**Verdict: not ready to build; settle quotation framing and overlong-draft handling first.**
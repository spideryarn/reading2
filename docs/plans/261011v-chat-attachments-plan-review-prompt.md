# Plan review: docs/plans/261011v-chat-attachments.md

Read-only review. Do not edit files. Review the plan at
docs/plans/261011v-chat-attachments.md (repo root is the current directory). It answers an admin
feedback request ("chat modes could accept attachments, PDFs, etc. … push back if a bad idea") with
a push-back, three shapes weighed, a recommended v1 (A′: a shelf article attached to a chat thread)
that is NOT being built yet, and a question for Greg. Your earlier consultation is
docs/plans/261011v-chat-attachments-consult-sol.md.

Check against the code, not the prose:

1. Is every factual claim true? In particular:
   - `search_library` / `read_library_passage` behaviour and citation rule (src/chat-tools.ts);
   - OpenRouter server web search in chat rounds (src/converse.ts);
   - the URL caps on read_web_page;
   - that `chat_threads` is exported (docs/project/export.md, src/store/article-rows.ts);
   - that chat has no per-reader spend allowance;
   - that an uploaded article costs one slot (docs/project/billing.md).
2. A′'s claim that it "opens no channel search_library does not already open" and needs no defence
   edit: is that right? Would adding an exact-slug scope to search_library, or a thread column
   written by an ownership-checked route, touch anything in docs/project/security-map.md § Where
   the defences physically live?
3. Anything missing from A′ that would make it fail or be silently wrong:
   - what happens when the source article is archived or deleted, or is still importing;
   - retry/edit semantics;
   - the prompt-cache placement;
   - a source that is the open article itself.
4. Is the question for Greg the right one, and is the recommendation sound?

Write findings as a numbered list, each with severity (high/medium/low), the evidence (file:line),
and the fix to the plan. End with a one-line verdict: SOUND, SOUND WITH FIXES, or UNSOUND.

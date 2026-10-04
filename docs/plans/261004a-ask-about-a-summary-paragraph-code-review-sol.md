- **CR-1 — P1, fixed:** [chat-handoff.ts:174](/home/greg/code/spideryarn2/.claude/worktrees/fbr9nbkt-ask-about-a-summary-paragraph/src/web/chat-handoff.ts:174). Escaping happened after truncation: 2,000 quotation marks produced a **4,077-character draft**, which Chat rejects even without an added question. Escaping now precedes the cap.
- **CR-2 — P1, fixed:** [chat-handoff.ts:177](/home/greg/code/spideryarn2/.claude/worktrees/fbr9nbkt-ask-about-a-summary-paragraph/src/web/chat-handoff.ts:177). Truncation could split an emoji’s surrogate pair, displaying `�`. The cut now keeps the pair intact.
- **CR-3 — P1, not fixed; outside stage:** [chat-handoff.ts:91](/home/greg/code/spideryarn2/.claude/worktrees/fbr9nbkt-ask-about-a-summary-paragraph/src/web/chat-handoff.ts:91). Existing `askAboutBlock` has the same surrogate-pair defect at its 60-character boundary.

Both in-stage defects had failing tests before the fix. The requested suite now passes **57 tests**; doc-link checks pass **16 tests**, and touched-file lint passes. F1, F3 and F4 are implemented; F2’s escaped-length gap is corrected.

Uncommitted changes:

- `src/web/chat-handoff.ts`
- `tests/chat-handoff.test.ts`
- `docs/project/summaries.md`
- `docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md`
- `docs/postmortems/261004a-a-bound-before-escaping-does-not-bound-the-sent-text.md`

The identical titles are an explicit plan decision. Touch layout remains with the separate browser review.

**Verdict: land with these fixes included, subject to the separate browser check; CR-3 does not block this stage.**
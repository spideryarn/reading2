- **E1 — P1 — [segments.ts:644](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/live-conversation-realtime-upgrade/src/web/live/gpt-live/segments.ts:644): The pause rule can corrupt words and numbers.** A 400 ms gap does not establish an utterance boundary. Read-only probes using 200 ms fragments, separated by that gap, froze `198` + `7` as **`198 7`**, `extra` + `ordinarily` as **`extra ordinarily`**, and `3.` + `14` as **`3. 14`**. These strings become the persisted answer. The new test covers neighbouring fragments and a shorter gap, so it misses this boundary. Preserve concatenation when ambiguous, or use evidence of an utterance boundary beyond elapsed time.

- **E2 — P2 — [session-shared.ts:200](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/live-conversation-realtime-upgrade/src/web/live/session-shared.ts:200): The no-article branch still claims unverified success.** Without `inArticle`, `spya-zzzzzz` survives and returns “Showed the reader 1 passage.” Membership was never checked, and `LiveStatus` renders no passage links without blocks. This branch should report that showing the passage was unavailable. The current production reader supplies `blocks`, so this does **not** recreate the reported production failure.

The remaining checks:

- **Dev seam:** In a production build, the `PROD` guard prevents reading or writing the global seam. In development, `noMicrophone` is persistent: subsequent starts stay silent while it remains set, and reconnect preserves the call’s `microphone: false` even after clearing it. Stop and teardown still release the silent track; I found no new lifecycle leak.
- **Passages:** With the article map supplied, both engines reject malformed and unknown IDs before recording pointers or passage arrays, and omit empty passages. Server validation remains intact. The four-ID cap also changes Realtime, but I found no downstream dependency requiring every supplied ID; it limits each pointer, not the number of tool calls.
- **Frozen text:** Later fragments do not rewrite previously frozen or emitted text. E1 corrupts text before freezing.
- **CSS:** The detail shrinks overwhelmingly before the label and wraps, with a `5em` floor. The comment’s “loses none” is an approximation: the label still has nonzero shrink. These rules address the reported layout problem; the tests verify declarations, not rendered layout.
- **D1–D4:** All four fixes look intact: nonterminal usage checkpoint, literal typed text, typed timeline anchoring/boundary, and producer shutdown before the final snapshot.

**Validation:** 58 tests passed across the three named files. No files changed.

**Verdict: land after fixing the P0–P1s.**
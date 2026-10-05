I fixed two narrow issues and left wider Chat behavior unchanged. No commits, database writes, or migration edits.

- **CR1 — P1 — Held Enter can send without a separate Send action. Established by running an App integration reproduction; unfixed, wider scope.** [key-chord.ts:108](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/key-chord.ts:108), [ChatPanel.tsx:2746](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/ChatPanel.tsx:2746). After the lens handoff focuses Chat’s populated composer, `repeat: true` Enter produces **one POST, expected zero**. Physical keyboard timing remains browser-dependent. The shared send predicate needs repeat protection; guarding Debate’s input alone cannot protect the newly focused composer. [Reproduction output](/tmp/why-reading-stage1-repeat.log).

- **CR2 — P1 — A displaced unsent draft becomes inaccessible after a mode change. Established by running; unfixed, inherited and explicitly accepted by the plan.** [ConversationModes.tsx:851](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/modes/conversation/ConversationModes.tsx:851). Its words remain in memory, but only the selected draft is restored and given a row to reopen. Added the missing characterization test.

- **CR3 — P2 — IME safety depended entirely on native form behavior. Reasoned browser risk; fixed, with guard tests observed red → green.** [DebatePanel.tsx:1419](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/DebatePanel.tsx:1419). Added the existing `isImeComposing` guard, including key code 229. Native IME behavior still needs a browser check.

- **CR4 — P3 — “Your angles” wording omitted when a conversation becomes listable. Established by tracing and running the unsent-handoff case; fixed.** [help-modes.tsx:721](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/help/help-modes.tsx:721), [debate.md:151](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/project/debate.md:151). Clarified that an unsent draft has no saved thread to list.

Your six suspicions:

1. **No current producer found.** `lens: undefined` would fool the guard, but current constructors and column mapping produce exact shapes. JSON omits undefined properties; exports use the mapper.
2. **No new Debate mismatch found.** Valid mapper output satisfies the CHECKs; accepted Debate shapes map back. Reserved `summary`, `glossary`, and `citations` rows can still be ignored deliberately—pre-existing behavior.
3. Blank input and ordinary successive submissions are safe; focus reaches Chat. IME protection is added. Held Enter exposes CR1; displaced drafts expose CR2.
4. Two chats with one lens remain separate. Renaming retains the original lens label. Deletions elsewhere appear on summary refresh, without real-time cross-tab updates. No entry exists before Send; returning to Chat restores the selected lens draft.
5. The seed uses plain words and Chat’s existing plain-words prompt. Quote runs cannot close its fence; a permitted 600-character lens survives escaping without truncation. Actual web-search behavior remains untested.
6. Saved-thread timing is clarified. The separate-Send promise remains violated by CR1.

Validation: **152 tests passed across 11 scoped suites**; both builds, typechecking, migration-chain checks, lint, and `git diff --check` passed. Lint reported two existing complexity advisories. The broad unit run was stopped after unrelated sandbox failures; it is not a passing full-suite result.

Please run the database suites `chat-origin-route.test.ts`, `store-chat-pg.test.ts`, `store-roundtrip.test.ts`, and `chat-spoken-route.test.ts`. Expect origin preservation through reads, exports, retry/edit and spoken follow-ups, plus rejection of invalid column combinations. Also test the migration against parent-schema plain and claim rows: their data and origins should remain unchanged. **Migration must precede this code:** ordinary chat reads select `origin_lens`. Desktop/phone/IME checks and the paid search smoke test remain outstanding.

Repository files changed:

- [DebatePanel.tsx](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/DebatePanel.tsx)
- [help-modes.tsx](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/help/help-modes.tsx)
- [debate.md](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/project/debate.md)
- [debate-lens.test.tsx](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/tests/debate-lens.test.tsx)
- [debate-lens-in-chat.test.tsx](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/tests/debate-lens-in-chat.test.tsx)
- [conversation-band-origin.test.tsx](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/tests/conversation-band-origin.test.tsx)
- [IME coverage postmortem](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/postmortems/261005n-a-submit-handler-test-cannot-prove-the-key-that-reaches-it.md)
- [Held-key postmortem](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/docs/postmortems/261005o-a-held-key-becomes-a-new-action-after-focus-moves.md)

VERDICT: do not land
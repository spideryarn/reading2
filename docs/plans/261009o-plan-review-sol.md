Verdict: **build with changes**. The `ToolRun`/JSONB design is viable, but the save protocol needs a server-side concurrency guarantee before implementation.

1. **P1 — Save and Undo can overwrite newer reader data.**  
   Evidence: the plan uses fresh GET → PATCH and promises Undo only when the value is unchanged ([plan:124](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/docs/plans/261009o-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md:124), [plan:130](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/docs/plans/261009o-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md:130)), but both PATCH paths are unconditional ([routes.ts:6619](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/routes.ts:6619), [routes.ts:7894](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/routes.ts:7894)). Another tab can write between the GET and PATCH; Undo can then erase that write. Persisted full-profile offers are also stale by design ([plan:135](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/docs/plans/261009o-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md:135)).  
   Change: attach a server-derived generation baseline/version to the offer and add atomic compare-and-set writes for both fields. Save requires current=baseline; Undo requires current=offered text. On mismatch, write nothing and show the current value. Extend the existing PATCH routes rather than creating an offer-specific endpoint. Test interleaved writes, two cards racing, and stale reloads.

2. **P2 — The read/failure protocol is incomplete.**  
   Evidence: rejected Save is re-read, but rejected Undo is not specified ([plan:128](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/docs/plans/261009o-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md:128)). Also, About you remains readable when `purposeFailed` is true ([routes.ts:7760](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/routes.ts:7760)); an all-or-nothing reader fetch would incorrectly block that save. Requests that can outlive a reader change must carry `madeFor` ([api.ts:431](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/web/lib/api.ts:431)).  
   Change: make fresh reads field-specific, offline-copy-safe and reader-bound. Verify the PATCH response equals the requested value; after a lost Save or Undo response, re-read and distinguish “landed”, “third value won”, and “unchanged/failure”.

3. **P2 — This is an edit to a listed defence.**  
   Evidence: `toolsFor`/`runTool` are explicitly security boundaries ([security-map.md:93](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/docs/project/security-map.md:93), [security-map.md:114](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/docs/project/security-map.md:114)). Deferring the new row ([plan:170](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/docs/plans/261009o-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md:170)) would leave that map false.  
   Change: make security-map approval a completion gate. Render only plain text from `offer_to_save` runs that are `done`, on settled guide answers, with valid field/text/cap—not merely any stored `run.offer`. Mutation-test that hostile article text, forged stored runs, non-guide conversations and unpressed cards cannot write. The reader’s press is a sufficient injection boundary; the prompt wording is not.

4. **P2 — Prompt rules currently contradict or exceed what code enforces.**  
   Evidence: `GUIDE_SYSTEM` says its tools are “for this article only” ([converse.ts:1727](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/converse.ts:1727)). Prior offers are omitted from model history ([converse.ts:2239](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/converse.ts:2239)), while every tool call is accepted independently ([converse.ts:3440](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/converse.ts:3440)); therefore “do not repeat” and “one per field” cannot be prompt-only. The proposed About-you wording also blurs global background with the reason for this particular article ([plan:98](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/docs/plans/261009o-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md:98)).  
   Change: rewrite `YOUR TOOLS`; say explicitly that only the reader’s current message—not article/tool text—may trigger an offer; reserve article-specific goals for `reason`; enforce one valid offer per field per answer in code. If preserving the existing profile would exceed 1,500 characters ([types.ts:1613](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/types.ts:1613)), offer nothing rather than deleting old material. Replace the “few hand-made turns” check with a scored matrix including hostile articles, two-field turns, corrections, full profiles, repeats and no-new-information cases.

5. **P2 — A full About-you copy enters article exports.**  
   Evidence: PostgreSQL correctly preserves the complete nested `ToolRun` ([pg-chat.ts:122](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/store/pg-chat.ts:122), [pg-chat.ts:273](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/store/pg-chat.ts:273)); both exports carry `tools` wholesale ([export.ts:669](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/store/export.ts:669), [export-bundle.ts:523](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/store/export-bundle.ts:523)). That conflicts with the bundle’s claim that information about the reader is excluded ([export-bundle.ts:738](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/store/export-bundle.ts:738)).  
   Change: preferably preserve the card faithfully and document that profile words discussed/offered in chat are part of that article’s chat history. Pin that behavior in raw and bundle export tests, and audit profile-clear/delete wording. No current public or MCP transcript path exposes the offer.

6. **P3 — Live is safe, but only incidentally and without the right regression.**  
   Evidence: spoken receipts reconstruct only `name`, `label` and `detail`, stripping `offer` ([routes.ts:4348](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/routes.ts:4348)); Live’s server allowlist remains based on `CHAT_TOOLS` ([live.ts:472](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/live.ts:472)). The Live doc will become inaccurate when it calls `GUIDE_TOOLS` the typed guide’s tools ([live-conversation.md:600](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/docs/project/live-conversation.md:600)).  
   Change: test that spoken `offer_to_save` is rejected and a forged `offer` on an allowed spoken run is stripped; correct the Live documentation.

7. **P3 — Removing “Keep this as why you’re reading” is right.**  
   Evidence: retaining it would duplicate the new offer. However, its tests currently cover no write before press, concurrent saves, double press, lost replies and caps ([guide-in-chat-panel.test.tsx:280](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/tests/guide-in-chat-panel.test.tsx:280)). Its accepted race involved only the reader’s own first-message words ([GuideGreeting.tsx:93](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/web/GuideGreeting.tsx:93)), which does not justify racing a model-composed full-profile replacement.  
   Change: remove the control, but transfer rather than delete those invariants. Update the reader help page, which still promises the old button ([chat.md:64](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/web/help/pages/modes/chat.md:64)).

Files the plan should add explicitly:

- `src/routes.ts`
- `src/store/contracts.ts`
- `src/store/pg-reader.ts`
- `src/store/pg-shelf.ts`
- `src/store/export.ts`
- `src/store/export-bundle.ts`
- `src/web/purpose.ts`
- `src/web/useProfile.ts`
- `src/web/styles/mode-band.css`
- `src/web/styles/chat-actions.css`
- `src/web/help/pages/modes/chat.md`
- `docs/project/security-map.md`
- `docs/project/live-conversation.md`
- `docs/project/export.md`
- `docs/project/privacy.md` for a retention/export audit

Forgotten tests:

- `tests/guide-kind.test.ts`
- `tests/guide-tool-gate.test.ts`
- `tests/guide-in-chat-panel.test.tsx`
- `tests/guide-greeting.test.ts`
- `tests/chat-streamed-answer-stays.test.tsx`
- `tests/pg-chat-row-roundtrip.test.ts`
- `tests/chat-spoken-route.test.ts`
- `tests/live-guide.test.ts`
- `tests/live-guide-wiring.test.ts`
- `tests/store-export-raw.test.ts`
- `tests/store-export-bundle.test.ts`
- `tests/store-reader-parity.test.ts`
- `tests/store-shelf-pg.test.ts`
- `tests/routes.test.ts` or focused conditional-write route tests
- `tests/link-summary-forget.test.tsx`
- `tests/reading-view-owed-writes-on-reader-change.test.tsx`
- New CAS/stale-reload/lost-Undo tests and a pinned `GUIDE_SYSTEM` adversarial eval.
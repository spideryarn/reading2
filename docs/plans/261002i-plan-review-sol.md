No P0s. The central choices are sound, but the plan is not build-ready: Tutorial’s client/export blast radius and prompt-security contract need to be explicit first.

## P1

### P1 — Tutorial will silently inherit Chat behaviour in several client paths

A fourth `ThreadKind` is the right abstraction, but the plan’s “wherever a grep leads” is too loose for the number of semantic branches involved.

The most dangerous current fallbacks are:

- `ConversationKind = Exclude<ThreadKind, "candidates">` will admit `tutorial`, but its prop mapping has only `chat` and `remember`. This at least produces a compiler error: [ConversationModes.tsx:246](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/modes/conversation/ConversationModes.tsx:246), [ConversationModes.tsx:316](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/modes/conversation/ConversationModes.tsx:316).
- All single-thread behaviour is currently keyed on `kind === "remember"`: thread selection, arrival, empty-thread cleanup, Start over, and which threads reach the panel. Tutorial would otherwise get Chat’s list/new/close lifecycle: [ConversationModes.tsx:398](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/modes/conversation/ConversationModes.tsx:398), [ConversationModes.tsx:413](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/modes/conversation/ConversationModes.tsx:413), [ConversationModes.tsx:637](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/modes/conversation/ConversationModes.tsx:637), [ConversationModes.tsx:660](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/modes/conversation/ConversationModes.tsx:660), [ConversationModes.tsx:711](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/modes/conversation/ConversationModes.tsx:711).
- `ChatPanel` treats every non-Remember kind as Chat: mode identity, header, controls, loading/list state, empty state, input size and placeholder: [ChatPanel.tsx:370](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/ChatPanel.tsx:370), [ChatPanel.tsx:483](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/ChatPanel.tsx:483), [ChatPanel.tsx:587](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/ChatPanel.tsx:587), [ChatPanel.tsx:1203](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/ChatPanel.tsx:1203), [ChatPanel.tsx:2041](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/ChatPanel.tsx:2041).
- Even if `SpokenKind` remains narrow, Live props are currently passed unconditionally. Tutorial must omit `live`/`onStartLive`, not merely rely on server rejection: [ConversationModes.tsx:723](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/modes/conversation/ConversationModes.tsx:723), [ChatPanel.tsx:2307](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/ChatPanel.tsx:2307).
- `subModeParams` maps every non-Quiz Remember view to default Recall. Adding `tutorial` to the union without changing this makes command-bar/tutorial links open Recall silently: [sub-modes.ts:239](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/sub-modes.ts:239).
- The real toggle has a hard-coded two-element array: [QuizPanel.tsx:227](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/QuizPanel.tsx:227).
- New-thread titles are exhaustive and need a Tutorial entry: [useChat.ts:385](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/useChat.ts:385).
- `readItFor` has a default Chat line, unlike exhaustive `systemFor`; a missed Tutorial arm silently gets Chat’s canned assistant line: [converse.ts:821](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:821), [converse.ts:857](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:857).

Define a shared `SINGLE_THREAD_KINDS`/`isSingleThreadKind`, used by both `targetOf` and the client. Separately define presentation by kind; “single-thread” does not imply “same label, invitation, composer or Live support.”

### P1 — Rollback export and restoration will turn Tutorial into Chat

The plan names “Export” but not the actual loss paths:

- Rollback export explicitly writes `remember` or `chat`; both Candidates and a future Tutorial become Chat: [export.ts:620](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/store/export.ts:620).
- The restore/round-trip seeder repeats the same ternary: [seed-reader-state.ts:286](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/helpers/seed-reader-state.ts:286).
- Fixture expectations currently allow only Chat and Remember: [fixture-corpus.test.ts:388](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/fixture-corpus.test.ts:388).

The bundle export is already correct because it preserves stored fields generically: [export-bundle.ts:509](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/store/export-bundle.ts:509).

Stage 3 needs an explicit export→restore assertion showing a Tutorial thread remains Tutorial. This is required, not polish.

### P1 — `TUTORIAL_SYSTEM` must retain the shared security/tool rules

The Tutorial prompt specification discusses pedagogy but not the existing tool-result and link defences. A Tutorial answer uses the same renderer and web tools, so its system prompt must include:

- no claims about tools not run: [converse.ts:355](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:355);
- never invent model-written URLs: [converse.ts:387](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:387);
- treat fenced web results as untrusted evidence: [converse.ts:402](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:402).

That last rule is part of the documented prompt-injection mitigation: [security.md:900](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/project/security.md:900). None of the hard defences listed in [security-map.md:80](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/project/security-map.md:80) otherwise needs changing.

Add Tutorial to the existing web-link and plain-words prompt tests.

### P1 — “Start from zero” contradicts the present product contract

The plan says someone who has not read the article can enter Tutorial and be taught from the top: [plan:114](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md:114).

The current Remember rationale says the opposite: its structural defence against replacing reading is that the reader must already have read the piece: [remember-mode.md:51](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/project/remember-mode.md:51). The project principle is that generated text routes into the prose rather than replacing it: [vision.md:59](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/project/vision.md:59).

Resolve this before code. A compatible design would define Tutorial as guided reading: teach briefly, then route the reader into a cited passage and ask them to work with it. If the intended product is instead “learn the article without reading it,” that is a deliberate exception requiring an explicit decision, not merely a new sub-mode.

## P2

### P2 — Stance removal is right, but stale-wire compatibility should be narrower

Keeping the database column, CHECK, `RememberStance`, and historic exported values is correct. Removing stance from new writes, retry and edit is also correct.

The safer shape is:

- Retain `RememberStance` and `REMEMBER_STANCES` only for legacy reads and HTTP validation.
- Remove stance from the domain write path: `Turn`, pending replies, `ConverseRequest`, `buildConverseMessages`, client send options and optimistic rows. Current write points are [chat.ts:207](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/chat.ts:207), [chat.ts:301](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/chat.ts:301), and [converse.ts:1194](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:1194).
- At the route boundary, accept, validate and ignore a legacy stance only on an ordinary Recall send. Continue rejecting it on Chat/Tutorial/Candidates and on retry/edit. Old clients never sent stance on retry/edit; the existing route explicitly forbids it: [routes.ts:2823](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/routes.ts:2823). Broadly accepting it weakens validation without adding compatibility.
- Do not remove compatibility merely “a week after deploy.” Tabs can remain open longer than a week. The parser is cheap; retain it indefinitely unless telemetry or a client-version boundary proves it safe to remove.

Removing the copies in `withRetry` and `withEdit` is correct: [chat.ts:655](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/chat.ts:655), [chat.ts:720](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/chat.ts:720).

The help flag is independent and must remain stored on the user row. Retry already returns that stored question, edit spreads it, and the route reads it from `user.help`: [chat.ts:646](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/chat.ts:646), [chat.ts:751](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/chat.ts:751), [routes.ts:3349](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/routes.ts:3349). Add a regression test that stance removal does not change help retry/edit behaviour.

Test fallout is larger than the plan says:

- Delete/rewrite current-behaviour assertions in `remember-prompt`, `remember-route`, `remember-store`, `remember-panel`, `store-chat-pg`, mode-surface, touch and voice/CSS tests. Representative assertions: [remember-prompt.test.ts:107](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/remember-prompt.test.ts:107), [remember-route.test.ts:244](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/remember-route.test.ts:244), [remember-store.test.ts:89](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/remember-store.test.ts:89), [store-chat-pg.test.ts:710](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/store-chat-pg.test.ts:710).
- Preserve historic-stance coverage in migration, fixture and round-trip tests; those are now legacy-data tests, not behaviour tests: [fixture-corpus.test.ts:336](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/fixture-corpus.test.ts:336), [store-roundtrip.test.ts:471](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/store-roundtrip.test.ts:471).
- Update the package script, eval README and cost fixture, not just rename the eval file: [package.json:73](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/package.json:73), [evals/README.md:1148](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/evals/README.md:1148), [interactions.ts:260](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/evals/cost/interactions.ts:260).

Recall’s existing canned line can stay. Tutorial needs its own explicit line, and `readItFor` should become exhaustive.

### P2 — “Every reply cites a block” needs exceptions and a leakage eval

It does not inherently conflict with “your own reasoning carries no block id”: a reply can contain a properly cited article claim and uncited reasoning. But it conflicts in two concrete cases:

- Existing rules require a pure clarification when the reader’s meaning is unclear: [converse.ts:616](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:616). An unrelated compulsory citation would be noise or invention.
- A nudge that names or quotes the answer’s block can disclose the answer before the reader chooses the “escape hatch.”

Use: “Every substantive Recall reply includes at least one genuine article pointer; a pure clarification may cite none. Block IDs attach only to claims or quotations from the article.” Add an eval for:

- pure clarification;
- model inference that must remain uncited;
- neutral nudge that links the relevant passage without quoting the answer;
- second failure/direct “tell me,” where the gap is filled;
- two-way nudges remaining one short closing move rather than two simultaneous exercises.

“At most one correction” is fine, but the eval should affirm that zero corrections is normal when the reader is correct, disagrees with the author, or the article is ambiguous.

### P2 — Reader-facing and registry scope is incomplete

Required additions not explicitly named:

- Help currently promises two sub-modes and documents all four Reply stances: [help-modes.tsx:441](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/help/help-modes.tsx:441). Project policy requires Help in the same commit: [help-page.md:67](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/project/help-page.md:67).
- Features copy describes Recall and Quiz only: [FeaturesPage.tsx:302](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/FeaturesPage.tsx:302).
- `remember-mode.md` itself must be updated for adaptive Recall, three sub-modes, the changed prompt/cache diagram, removal of the picker, and Tutorial’s product boundary.

## Fourth-kind audit: deliberate stays versus changes

These sites should remain narrow:

- `SpokenKind` and the client model/reducer `Extract<ThreadKind, "chat" | "remember">`, because Tutorial has no Live: [chat.ts:433](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/chat.ts:433), [model.ts:843](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/chat/model.ts:843), [reduce.ts:457](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/chat/reduce.ts:457).
- `Reader` and `ChatDialog` use positive `=== "chat"` checks for floating/anchored conversations, so Tutorial will not leak into Chat: [Reader.tsx:897](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/reader/Reader.tsx:897), [ChatDialog.tsx:554](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/ChatDialog.tsx:554).
- Both normalisers already use `isThreadKind`, so adding `tutorial` to `THREAD_KINDS` is sufficient: [types.ts:3548](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/types.ts:3548), [pg-chat.ts:231](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/store/pg-chat.ts:231).
- Last-view handling remembers the `remember` parameter but deliberately does not restore Remember mode automatically; Tutorial inherits that safely: [last-view.ts:67](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/last-view.ts:67), [last-view.ts:180](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/last-view.ts:180).
- Activation correctly treats every non-Quiz Remember sub-mode as non-generating, but needs a Tutorial test: [activation.ts:603](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/activation.ts:603), [activation.ts:659](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/activation.ts:659).
- The command bar derives rows from `subModesOf`; registry and URL mapping changes should be sufficient, with its exhaustive test extended: [sub-modes.ts:200](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/sub-modes.ts:200).

Tutorial will silently inherit Chat’s model, cost job, timeout, web tool and output limit through non-Candidates branches: [converse.ts:139](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:139), [converse.ts:255](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:255), [converse.ts:1479](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:1479), [converse.ts:1904](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:1904). That is probably right, but the plan should state and test it.

## Prompt caching

No proposed per-turn value changes bytes above the breakpoint.

- Rewriting `REMEMBER_SYSTEM` causes one expected cold prefix after deployment.
- Tutorial creates its own stable prefix and therefore one cold write on first use.
- Removing stance affects only the final user message below the article breakpoint.
- Profile, reading goal, position, history and question remain below it: [converse.ts:1223](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:1223), [converse.ts:1236](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:1236), [converse.ts:1245](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:1245).

Add the existing byte-identity assertion for Tutorial with differing history/profile/goal/question. Do not interpolate adaptive state into `TUTORIAL_SYSTEM`.

## Stage order

Stages 1 then 2 are fine. Split Stage 3:

1. Resolve the “guided reading versus replacement” product decision and write the prompt/eval contract.
2. Backend/persistence: union, schema and migration, partial index, shared single-thread predicate, routing, prompt branch, export/restore.
3. Client/URL: params, registry, toggle, ConversationBand, ChatPanel, no-Live wiring, Help and Features.
4. Eval and cross-family review.

The migration widening must be applied before code can insert `tutorial`; the current CHECK permits only three kinds: [schema.ts:3359](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/db/schema.ts:3359). The separate partial unique index is the right database shape, matching Remember’s existing index: [schema.ts:3373](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/db/schema.ts:3373).

Live, cloze interactions and the model-starts-a-Chat tool are legitimately deferrable. Export/restore, Help, explicit Tutorial canned text and the product-boundary decision are not.

## Verdict

Approve the fourth `ThreadKind` and the basic stance-removal design, but revise the plan before building. The required changes are: centralise single-thread semantics, specify every non-Chat UI branch, prevent export/restore kind loss, preserve the shared prompt-security rules, and decide whether Tutorial is guided reading or an intentional exception to the product’s “reading remains necessary” principle.
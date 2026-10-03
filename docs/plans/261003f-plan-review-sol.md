## Findings

### F1 — P0 — An unknown glossary lookup can start two paid runs

Evidence:

- The plan opens Glossary and invokes `ask(X)` ([plan:57](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md:57)).
- Normal command-bar mode activation arms Glossary generation ([Dock.tsx:1550](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/Dock.tsx:1550), [Dock.tsx:1579](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/Dock.tsx:1579)).
- An empty Glossary consumes that activation and enqueues the whole glossary ([useAutoRun.ts:159](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/useAutoRun.ts:159), [useGlossary.ts:894](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/useGlossary.ts:894)).
- `ask(X)` separately POSTs a one-term model lookup ([useGlossary.ts:941](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/useGlossary.ts:941), [useGlossary.ts:971](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/useGlossary.ts:971)).
- Metadata mounts instead of `OwnedReader`, while `useGlossaryRead` exists only inside `OwnedReader`; therefore the proposed glossary state and `ask` seam do not exist there ([ArticlePage.tsx:424](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/article/ArticlePage.tsx:424), [ArticlePage.tsx:452](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/article/ArticlePage.tsx:452), [ArticlePage.tsx:481](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/article/ArticlePage.tsx:481)).

Fix: make lookup a dedicated, explicitly unarmed transition—not `activateMode("glossary")`. Store a slug-scoped, nonce-bearing handoff, move to Glossary through plain query-state navigation, consume it once, then call `ask`. Offer lookup only after the glossary read has settled to `ready` or `none`; loading/error is not evidence that the term is absent. On Metadata, either omit the command or lift the read/controller above the Reader/Metadata branch. Pin one `POST /api/glossary/:slug/ask` and zero job POSTs.

### F2 — P1 — Existing-term resolution can open a hidden or wrong term

Evidence:

- The plan proposes matching the raw term list and aliases from `useGlossaryRead` ([plan:58](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md:58)).
- `GlossaryRead.glossary` includes hidden entries; Reader deliberately derives a separate visible `terms` list with `shownEntries` ([Reader.tsx:964](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/reader/Reader.tsx:964), [Reader.tsx:971](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/reader/Reader.tsx:971)).
- `openTermInGlossary` can lower the threshold, but does not unhide an entry ([Reader.tsx:1107](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/reader/Reader.tsx:1107)).
- Two legitimate entries may share an alias by design, so “matches an alias” is not necessarily one term ([glossary.ts:640](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/glossary.ts:640), [glossary.ts:662](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/glossary.ts:662)).

Fix: resolve only against Reader’s visible `terms`. Specify collision order: exact name first; if several visible entries share an alias, show separate rows or require disambiguation rather than silently selecting one.

### F3 — P1 — The jump command bypasses the deliberate-jump contract

Evidence:

- The plan says to “go to `?at=<blockId>`” ([plan:50](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md:50)).
- The ordinary `atParam` write replaces history and is debounced ([params.ts:112](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/params.ts:112)).
- Deliberate jumps must use `jumpTo`: it records the origin, pushes history, cancels the debounce, scrolls immediately, and supports the return chip ([useReadingPosition.ts:235](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/reader/useReadingPosition.ts:235), [useReadingPosition.ts:267](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/reader/useReadingPosition.ts:267)).

Fix: pass Reader’s existing `jumpTo(hit.blockId)` into the command executor. Test Back and the return chip, not merely the resulting URL.

### F4 — P1 — Tag commands leave Metadata visibly stale

Evidence:

- The plan calls `editArticleTags` directly ([plan:66](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md:66)).
- Metadata’s existing save wrapper also arms a trailing refresh and updates `provenance`, which is what its `TagEditor` renders ([Metadata.tsx:915](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/Metadata.tsx:915), [Metadata.tsx:917](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/Metadata.tsx:917)).

Built as written, a tag command issued on Metadata succeeds server-side, closes the bar, and leaves the visible editor showing the old tags.

Fix: add a state-owning `editTags(change)` controller to `ShelfRow`, analogous to `archive`. Metadata supplies its existing wrapped save; Reader supplies an owner-scoped controller. Both bar and chat invoke that controller, never the raw transport. Test that the Metadata editor changes without reload.

### F5 — P1 — Experimental commands can silently do nothing

Evidence:

- The plan gates only on `loaded` and `signedIn` ([plan:72](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md:72)).
- `ExperimentalSetting.set` returns `void`, while `saving` is separate state ([experimental-store.ts:127](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/experimental-store.ts:127)).
- A second call while saving simply returns without changing anything ([experimental-store.ts:463](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/experimental-store.ts:463), [experimental-store.ts:471](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/experimental-store.ts:471)).

Because the store flips optimistically, the row can immediately offer the inverse action while the first save is live; pressing it closes the command bar but performs no action.

Fix: make the row unavailable while `saving`, and provide an awaitable command-level result so a rejected save can produce `ActionOutcome.stay`. Test a second keyboard and pointer activation during saving.

### F6 — P1 — The proposed bookmark chip bypasses the existing safe controller

Evidence:

- The plan proposes constructing/running `makeBlockBookmarker(owner.comments.create)` ([plan:94](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md:94)).
- The factory’s retry ID and in-flight coalescing live in its closure, so recreating it loses those guarantees ([block-bookmark.ts:28](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/block-bookmark.ts:28)).
- Reader deliberately memoises one instance and exposes it only after the opening comments read succeeded ([Reader.tsx:2094](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/reader/Reader.tsx:2094), [Reader.tsx:2938](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/reader/Reader.tsx:2938)).

Fix: extract/reuse a stable Reader-owned bookmark controller with an explicit availability state. Do not instantiate the factory in the chip renderer. Test that a late comments GET cannot erase the bookmark and that an uncertain retry reuses the same ID.

### F7 — P1 — Generic jump verbs collide with navigation commands

Evidence:

- `jump to` and especially `take me to` are assigned to literal first-occurrence search ([plan:50](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md:50)).
- Existing ranking compares the whole canonical query against labels and aliases ([command-match.ts:344](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/command-match.ts:344)).
- Parsed argument rows are appended independently after ranking ([CommandBar.tsx:1027](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/CommandBar.tsx:1027)).

Thus `take me to glossary` matches no Glossary row and becomes “jump to the first occurrence of ‘glossary’,” potentially reporting that the article does not contain it.

Fix: remove generic navigation wrappers from literal search. Prefer explicit forms such as `jump to first X`, `first occurrence of X`, and `where does it first say X`; alternatively strip `take me to` and rerank a known command before considering literal search. Add a collision matrix against every existing mode/page/action, not only find/glossary parsers.

### F8 — P1 — Chat tokens omit the accepted stable-ID and policy boundary

Evidence:

- Stage 1 only introduces a natural-language verb parser, while Stage 2 feeds stored model tokens through that same evolving verb table ([plan:45](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md:45), [plan:87](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md:87)).
- Current actions are React closures with no argument schema or risk class ([command-match.ts:150](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/command-match.ts:150)).
- The accepted architecture requires a stable serialisable ID, argument schema, risk class, trusted dispatcher, and code-enforced confirmation gate ([chat-llm-help-commands-vision.md:69](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/project/chat-llm-help-commands-vision.md:69)).
- Chat is explicitly different because its context contains hostile article and fetched-page text ([chat-llm-help-commands-vision.md:186](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/project/chat-llm-help-commands-vision.md:186)).

Fix: recut Stage 1 to establish a versioned `CommandProposal` descriptor/executor first. Free-text parsing may produce that descriptor, but stored chat syntax should carry an exact stable action ID plus encoded typed arguments—not be reparsed as natural language. The chat renderer must use an explicit allowlist, recheck current ownership/availability/block membership at click time, and recognise tokens only in ordinary Markdown text nodes, not code or link labels. Stage 2 then only adds the renderer and prompt.

Spend chips need not be excluded categorically: the accepted policy explicitly permits them as truthful proposed buttons. The missing safety property is the stable, code-enforced proposal boundary.

### F9 — P2 — “Read two answers” is not adequate validation of the prompt change

Evidence:

- The plan calls this “one eval-free change, checked by reading two answers” ([plan:97](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md:97)).
- The prompting guide explicitly says reading a few outputs is not evidence because ordinary sampling variation can dominate a prompt change ([prompting-guide.md:194](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/project/prompting-guide.md:194), [prompting-guide.md:215](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/project/prompting-guide.md:215)).

Fix: add a small recorded eval covering normal requests, requests requiring no proposal, malformed arguments, existing versus absent glossary terms, and hostile article instructions. Measure valid-proposal rate, unsolicited-proposal rate, and whether prose remains useful when no chip is appropriate.

The dictation design itself names the right two guards (`armed` and `readOnly`) and stopping on close. Its tests should exercise both Enter and pointer activation while armed/transcribing. No new URL parameter is introduced, so last-view classification needs no change.

**Verdict: build with these changes.**
Verdict: Stage A code is ready after the fixes below, and Stage D’s Jev spend is correctly declared and recorded. No P0 findings remain; all P1/P2 findings were fixed. Three factual P3 issues remain in the new vision doc, which I left untouched as requested.

### Findings

- **F11 — P1 — Established:** Encoded query keys could override new command state. For example, `%6dode=summary` survived before `mode=search`, so Search could open in the wrong mode; `%73ection=…` could similarly prevent the requested Metadata section revealing. Fixed with decoded-key, byte-preserving removal in [router.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/router.ts:1112), used by [CommandBar.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/CommandBar.tsx:420) and [params.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/params.ts:1711). Red-first coverage: “replaces encoded search keys and preserves special characters…” and “replaces an encoded section key…”.

- **F12 — P1 — Established:** A late-mounted collapsible section could be “successfully” consumed without opening. The mutation observer could dispatch before `Section`’s passive effect installed its listener. Fixed by installing the listener during the layout phase in [Metadata.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/Metadata.tsx:3431). Red-first coverage: “does not consume a late section before its reveal listener can open it”.

- **F13 — P2 — Reasoned:** The 15-second reveal timeout silently abandoned a valid, slowly mounted section. Fixed by observing until success, ID change, or unmount in [PageContents.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/PageContents.tsx:144). The observer remains bounded and is cleaned up. Red-first coverage: “keeps waiting past the old bound…”.

- **F14 — P2 — Established:** `ActionOutcome` was discriminated, but its consumer used a non-exhaustive `if/else`; a future outcome could silently inherit `stay` behaviour. Fixed with an exhaustive switch and `never` check in [CommandBar.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/CommandBar.tsx:910). Typecheck covers exhaustiveness.

- **F15 — P1 — Established:** If Escape dismissed the bar while a POST was outstanding, a later refusal vanished. Fixed so a refusal reopens the bar with the server’s sentence in [CommandBar.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/CommandBar.tsx:913), wired through [Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/Dock.tsx:3242). Red-first coverage: “reopens with the refusal if a dismissed run was not accepted”.

- **F16 — P3 — Established:** The Decisions-endpoint comment still said only `shelf-topics-jev` used it. Fixed in [spend-declarations.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/spend-declarations.ts:70).

- **F17 — P3 — Established, reported:** The vision doc says Metadata section commands, archive, and export are built, but those are Stage B and are not present. Evidence: [chat-llm-help-commands-vision.md](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/project/chat-llm-help-commands-vision.md:81) and [the “Where we are” claim](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/project/chat-llm-help-commands-vision.md:203). Not fixed per scope.

- **F18 — P3 — Established, reported:** Calling the bar broadly “free, instant, and offline-safe” is false now that rerun rows POST paid work. Evidence: [vision line 82](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/project/chat-llm-help-commands-vision.md:82) versus [the rerun POST](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/CommandBar.tsx:380). Not fixed.

- **F19 — P3 — Established, reported:** The vision says the 51-row eval catalogue was copied from the bar. The catalogue itself says it includes planned, unbuilt Stage B rows. Evidence: [vision line 105](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/project/chat-llm-help-commands-vision.md:104) and [catalogue provenance](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/evals/command-pick/catalogue.ts:2). Not fixed.

### Cleared attack points

- A rerun press makes exactly one POST with Metadata’s shared body: `{slug, steps: [step], force: [step]}`. Rapid Enter/click repeats are blocked.
- Accepted runs still navigate after Escape. That is deliberate: the paid run has begun, and Metadata’s processing row is its durable visible acknowledgement. Refusals now reopen with their explanation.
- `?section=` validates against real sections, is never remembered, is consumed only after revealing, and arrival starts no work.
- `find <words>` safely round-trips `&`, `#`, quotes, Unicode, and stale encoded keys. Search reads `find` on arrival.
- `useJobs("quiet")` does re-render on job-list changes, but mounting it does not start idle polling.
- No optional Stage A field needs tightening: `stay.message`, `CommandBarArticle.view`, and the new reopen callback are required.
- The new `reading-view-overview.md` Stage A paragraphs are factually accurate.

Stage D’s declaration at [spend-declarations.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/spend-declarations.ts:408) matches `shelf-topics-jev`: OpenRouter account, `eval` job, Decisions wire, metered. [jev.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/evals/command-pick/jev.ts:36) uses the declared wrapper and fetch, records usage before throwing on HTTP failure, and runs beneath the eval ledger.

Verification:

- Scoped Vitest suite: **177 passed**
- Direct TypeScript gate: **2,686 source files covered and passed**
- `tests/declared-spend.test.ts`: included and passed
- Biome check: passed; only Dock’s pre-existing complexity advisory
- `git diff --check`: passed
- Full `npm test`: blocked before collection because the sandbox could not reach local Postgres/Docker
- The `npm run typecheck` launcher hit the sandbox’s `tsx` IPC restriction; its direct equivalent passed
- No commit or index change made

Files changed:

- `src/spend-declarations.ts`
- `src/web/CommandBar.tsx`
- `src/web/Dock.tsx`
- `src/web/Metadata.tsx`
- `src/web/PageContents.tsx`
- `src/web/params.ts`
- `src/web/router.ts`
- `tests/command-bar-rerun-and-find.test.tsx`
- `tests/metadata-section-param.test.tsx`
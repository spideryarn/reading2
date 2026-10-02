No P0 or P1 findings.

### P2 findings

- **The parser does not itself “serialise `brief` as absent.”** Its serializer remains the identity function at [params.ts:1142](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/params.ts:1142); omission happens when nuqs sees the parser’s default, while non-hook link construction explicitly uses `null` in [sub-modes.ts:239](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/sub-modes.ts:239). Thus the test promised at [plan:54](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/docs/plans/261002c-summary-opens-on-brief.md:54) should not expect `summaryParam.serialize("brief")` to return absence—it returns `"brief"`. Assert `defaultValue === "brief"` and, through a mounted query-state setter, that choosing Brief removes `?summary=` while choosing Simple writes it. The current red tests verify rendering and `subModeParams`, but not the slider’s actual URL write.

- **“Writes all three levels at once” and “changes nothing about … when” are slightly inaccurate.** Fuller is deliberately `FIRST_LEVEL` at [simple-summary.ts:161](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/simple-summary.ts:161); on cacheable articles Brief and Simple wait until Fuller’s stream starts at [simple-summary.ts:694](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/simple-summary.ts:694) and [simple-summary.ts:868](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/simple-summary.ts:868). This does **not** make Brief a worse first view today: the UI receives no partial level, waits for all calls at [simple-summary.ts:916](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/simple-summary.ts:916), then stores one all-or-none artefact. Neither selection affects scheduling, cost, loading state, or availability. Reword the plan as “one job stores all three atomically; the selected level does not affect generation.”

### Complete default-assumption audit

- [params.ts:1123](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/params.ts:1123): comment, fallback semantics, and `.withDefault("simple")`. **Covered** by the planned code/comment change.
- [sub-modes.ts:217](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/sub-modes.ts:217): comment names Simple as the omitted default; [sub-modes.ts:249](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/sub-modes.ts:249) clears Simple. **Covered**.
- [summaries.md:185](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/docs/project/summaries.md:185): URL table and legacy `gists` fallback name Simple. **Covered**.
- [url-state.md:84](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/docs/project/url-state.md:84): current URL contract names Simple as default/absent and legacy fallback. **Covered**.
- [simple-panel.test.tsx:539](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/tests/simple-panel.test.tsx:539): owner and visitor expectations for absent/legacy-invalid `?summary=`. These have already been changed to Brief in the worktree, including explicit Simple at [simple-panel.test.tsx:561](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/tests/simple-panel.test.tsx:561). **Covered**.
- [command-bar-sub-modes.test.tsx:451](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/tests/command-bar-sub-modes.test.tsx:451): Simple must become explicit; [command-bar-sub-modes.test.tsx:456](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/tests/command-bar-sub-modes.test.tsx:456) changes the omitted default to Brief. **Covered**.
- [SummaryMode.tsx:270](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/modes/summary/SummaryMode.tsx:270) has an out-of-range native-slider fallback of `"simple"`, but this is not the absent-URL default and cannot occur through the constrained three-stop input. **No change needed**.

There is no separate server/public default:

- Owner and visitor bands both use `summaryParam` at [SummaryMode.tsx:60](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/modes/summary/SummaryMode.tsx:60) and [SummaryMode.tsx:129](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/modes/summary/SummaryMode.tsx:129).
- Public rendering selects between those bands at [Reader.tsx:2108](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/reader/Reader.tsx:2108).
- Server address handling parses only `?mode=`, for the page head, at [read-address.ts:47](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/read-address.ts:47).
- Reading-view command rows consume `subModeParams` at [Reader.tsx:3066](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/reader/Reader.tsx:3066); metadata/public-page links consume `withSubMode` at [Dock.tsx:1543](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/Dock.tsx:1543). There are no independent defaults to update.

### Last-view trace

The interpretation works:

1. `summary` is explicitly remembered at [last-view.ts:67](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/last-view.ts:67).
2. Explicit `summary=simple` or `summary=fuller` survives filtering unchanged at [last-view.ts:261](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/last-view.ts:261).
3. A bare reopen receives that remembered query at [last-view.ts:303](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/last-view.ts:303), before painting at [last-view.ts:395](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/last-view.ts:395).
4. After the change, choosing Simple writes it explicitly; Fuller already is explicit. Choosing Brief removes the parameter, and `mode=summary` restores onto the parser default, Brief.
5. A shared link carrying any article state still beats memory at [last-view.ts:303](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/last-view.ts:303). Therefore “only an article with no remembered level” is informal rather than exhaustive: an explicit `?mode=summary` link without a level, malformed values, and legacy stored default-less Simple also open Brief. The plan already accepts the legacy case.

Activation remains level-independent: Summary’s bar button targets the `simple` job at [activation.ts:242](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/activation.ts:242), every Summary command row does likewise at [activation.ts:603](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/activation.ts:603), and `useSimple` has one level-neutral loading/read state at [useSimple.ts:57](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/useSimple.ts:57).

The prepared tests are genuinely red: 5 intended failures across the two targeted files.

**Verdict: Ready—two behavior-line changes are sufficient; tighten the parser test wording and the generation-timing claim.**
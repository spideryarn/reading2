The missing-publication-date explanation is consistent with the code; I found no reason to change the prompt. All 164 targeted tests pass. Typechecking passes via `node --import tsx scripts/typecheck.ts`; the requested npm command is blocked by the sandbox’s IPC restriction. No commits or database writes.

VERDICT: do not ship

- **P1 — unresolved design:** [timeline.ts:843](/home/greg/code/spideryarn2/.claude/worktrees/fb-fyjac4-timeline-which-year/src/timeline.ts:843). One historical date still assigns its year to unrelated yearless dates throughout the piece. Labelling this assumption makes it visible, but does not support it. I recommend shipping part 1—the article’s words—and withholding part 2 pending the plan’s open decision.

- **P1 — fixed:** [timeline-time.ts:390](/home/greg/code/spideryarn2/.claude/worktrees/fb-fyjac4-timeline-which-year/src/timeline-time.ts:390). Impossible calendar dates could seed `pieceYear`. They now cannot. Reversed ranges are also refused. February 29 in a non-leap assumed year remains refused; ignoring direction without a publication day is consistent with the named assumption.

- **P1 — fixed, pre-existing:** [timeline.ts:551](/home/greg/code/spideryarn2/.claude/worktrees/fb-fyjac4-timeline-which-year/src/timeline.ts:551). Labels could display an invented year against a cited day and month. Labels now require their year to be stated. Passing `assumedYear` to this check would not have fixed it.

- **P2 — fixed:** [timeline.ts:730](/home/greg/code/spideryarn2/.claude/worktrees/fb-fyjac4-timeline-which-year/src/timeline.ts:730). Rejected-to-dated reruns orphaned event links. A narrow fallback now preserves ids when temporal words and cited passages match uniquely. Missing phrases and ambiguous matches still receive new ids.

- **P2 — fixed:** [TimelinePanel.tsx:532](/home/greg/code/spideryarn2/.claude/worktrees/fb-fyjac4-timeline-which-year/src/web/TimelinePanel.tsx:532), [MarginaliaColumn.tsx:328](/home/greg/code/spideryarn2/.claude/worktrees/fb-fyjac4-timeline-which-year/src/web/marginalia/MarginaliaColumn.tsx:328). Header wording now handles all eight source combinations; open-row wording handles partially dated ranges; marginalia explicitly marks assumed years.

- **P2 — wider, unchanged:** [notes.ts:330](/home/greg/code/spideryarn2/.claude/worktrees/fb-fyjac4-timeline-which-year/src/web/marginalia/notes.ts:330). Marginalia excludes rejected rows, including `noYearFrame` rows drawn as words. The changed voice logic therefore does not make those rows appear there.

Visitor payloads and exports retain `yearFrom`; Skim uses ids and labels; chat tools do not consume Timeline dates. Regression tests demonstrated the failures, including a mutation check for the label guard.
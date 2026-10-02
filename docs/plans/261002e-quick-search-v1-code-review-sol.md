- **F10 — P1 — FIXED:** Recursive halving could throw before a sibling’s meter finished, losing its ledger row. Each split now cancels and drains its descendants and preserves the originating failure. Evidence: [quick-search.ts:294](/home/greg/code/spideryarn2/.claude/worktrees/fb-c77zuq-quick-search/src/quick-search.ts:294). Red-first tests in `tests/quick-search.test.ts` reproduced premature collector closure; failure, deadline and reader-abort cases now pass.

- **F11 — P1 — FIXED:** A provider refusal became a timeout if the deadline expired during cancellation cleanup. Classification now follows the composite signal’s first abort reason. Evidence: [quick-search.ts:380](/home/greg/code/spideryarn2/.claude/worktrees/fb-c77zuq-quick-search/src/quick-search.ts:380). The red-first regression expected HTTP 502 and received `[ai-slow]`; it now retains 502 and both accounting rows.

- **F12 — P3 — FIXED:** Comments/docs incorrectly claimed a dated model request, “flesh out” while quick was pending, and no downstream matcher awareness. Corrected `models.ts`, `setup-dev.md`, `useSearch.ts`, `SearchPanel.tsx`, the plan and `search.md`. Evidence: [model request](/home/greg/code/spideryarn2/.claude/worktrees/fb-c77zuq-quick-search/src/models.ts:467), [finished-only button](/home/greg/code/spideryarn2/.claude/worktrees/fb-c77zuq-quick-search/src/web/SearchPanel.tsx:1028). Prose corrections checked against code and existing panel/hook tests.

F1–F9 were checked individually:

| Finding | Implementation verified |
|---|---|
| F1 | Local heading exclusion; searchable supplements retained |
| F2 | Bounded previews with whole-paragraph highlighting |
| F3 | Allowlisted overflow classification |
| F4 | Complete, valid probabilities required; shared deadline; draining fixed above |
| F5 | Kind-aware retry and synchronous duplicate guard |
| F6 | Kind preserved through storage, exports, public projections and seed helper; visitor controls absent |
| F7 | Final-arm measurements committed; floor 0.7 and cap 20 implemented |
| F8 | Fixed-model job, metering and privacy disclosure |
| F9 | Quick score explanations on individual results |

No raw display path for the dated stored model ID was found. The generic wait and legend copy does not establish another defect. No wider defect was established.

All **268 tests across the seven prescribed files passed**. The full type checker passed through `node --import tsx scripts/typecheck.ts`; the npm launcher itself was blocked by the sandbox’s IPC-socket restriction. Lint reported two existing complexity advisories; `git diff --check` passed. Postgres checks remain yours to run.

Both bugs have postmortems. All changes are uncommitted; no push or state-changing git command was run.

**VERDICT: land after my fixes**
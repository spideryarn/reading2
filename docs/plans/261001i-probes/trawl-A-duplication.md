# Trawl A: duplicated helpers

Read-only sweep of `src/`, `scripts/` and a glance at `tools/`, 2026-10-01. Inputs: `npm run dupes`
(jscpd: 419 clones, 2% of tokens) grouped by file pair, plus grep for same-job functions under
different names. Counts are files, and approximate.

**Headline.** The small utilities are mostly fine. The real duplication is two server call shells
(pipeline and streamed), where most callers still hand-roll 50-150 lines, and their client mirrors.

## Duplicate families, ranked by ease x value

| # | Family | Ease | Value |
|---|---|---|---|
| 1 | Streamed chat-wire call shell (server) | M | High |
| 2 | Threshold slider row | E | High |
| 3 | Pipeline Messages-wire call shell | M-H | High |
| 4 | Relative time: `Metadata.tsx § ago` | E | Med |
| 5 | Abortable sleep / Retry-After / backoff | E-M | Med |
| 6 | Client answer-stream loop | M | Med |
| 7 | Artefact-mode client hook state | H | Med |
| 8 | Spinner classes | E | Low-Med |
| 9 | Plural / duration / absolute-date formatting | E | Low-Med |
| 10 | Small private copies (`escapeHtml`, `escapeRegExp`, `allOrStop`, nanos) | E | Low |
| 11 | Script harness copies (CDP, seed scripts) | M | Low |

### 1. The streamed chat-wire call shell (server)
- **Canonical:** `src/stream-run.ts` § `runStream`. It handles the deadline, the stall clock, the
  `openRouterStream` loop, `classifyEnd` and the failure hand-off. It has **3 callers**:
  `src/explain.ts`, `src/citation-investigate.ts`, `src/plain-words.ts`.
- **Hand-rolled copies (7):** `src/search.ts`, `src/referee-claims-run.ts`,
  `src/referee-criteria-run.ts`, `src/referee-mirror.ts`, `src/quiz-mark.ts`, `src/converse.ts`,
  `src/link-summary.ts`. Each uses the pieces from `src/openrouter-stream.ts` (`stoppedByReader`,
  `explainAbort`, `classifyEnd`) but writes its own try/catch/finally, stall timer, logging and
  ending switch. jscpd's biggest pair in the repo is `referee-claims-run.ts` and `search.ts` (188
  lines). Next are `referee-claims-run.ts` and `referee-criteria-run.ts` (139 lines) and
  `referee-mirror.ts` (69 lines).
- **Docs:** none of them names `runStream`. `docs/project/comments.md` § streaming, which CLAUDE.md
  points to for "a new streaming endpoint is a generator and a route", lists
  `src/openrouter-stream.ts`, `sse(res)` and `src/web/lib/sse.ts`, but not `stream-run.ts`.
- **How an agent finds it today:** only by reading `explain.ts`. An agent following the docs will
  copy `search.ts`, and seven of the ten existing examples are copies.
- **Fix:** add `runStream` to comments.md § streaming now, which is cheap. Then move the referee
  runners onto it one at a time. These runners extract structured items mid-stream, so `runStream`
  may need an `onDelta` hook.

### 2. Threshold slider row
- **Canonical:** `src/web/ThresholdSlider.tsx` § `ThresholdSlider`. It has **1 caller**, `FaqPanel`,
  and its header says that moving the others onto it was deferred (plan 260929g).
- **Copies:** `src/web/GlossaryPanel.tsx` § `GateSlider`, `src/web/CitationsPanel.tsx` §
  `BarSlider`, `src/web/QuotesPanel.tsx` § `BarSlider`, and probably `src/web/SearchPanel.tsx` §
  `ConfSlider`. Each has the same title, aria label and reset markup.
- **Docs:** only `faq.md` names it, so an agent adding a threshold to a fifth mode would copy the
  Glossary's. The logic is already shared through `src/web/threshold.ts` § `applyThreshold`, so
  this is purely markup. **Easiest high-value move**; each panel needs a browser check.

### 3. The pipeline Messages-wire call shell
- **No canonical helper.** About 17 stage modules (`src/arc.ts`, `glossary.ts`, `quotes.ts`,
  `tweets.ts`, `ideas.ts`, `faq.ts`, `crossrefs.ts`, `timeline.ts`, `citations.ts`, `sketch.ts`,
  `illustrated.ts`, `trajectory.ts`, `quiz.ts`, `hierarchy.ts`, `labels.ts`,
  `simple-summary.ts`, ...) repeat the same sequence:
  1. `streamMessage(job, {system: [article + cache_control, SYSTEM], ...})`
  2. a throttled `onText` progress line (`now - last < 500`, in 15 files)
  3. `finalMessage()` inside `try`, with `catch` calling `anthropicCallFailed`
  4. `wasRefused`, then `MODEL_REFUSED` (18 files)
  5. a `max_tokens` check, then `truncationFailure` (18 files)
  6. the text blocks joined (the filter appears 30 times in 17 files)
  7. a per-module `parseJson` that wraps `src/parse-json.ts` § `parseJsonAnswer` (14 files)
- The pieces are shared (`src/messages-stream.ts` § `streamMessage` and `wasRefused`,
  `src/anthropic-call.ts` § `anthropicCallFailed`), but the sequence is not. The docs (`ai-gateway.md`,
  `cost-tracking.md`) name `streamMessage` and say to use `finalMessage()`, which is the
  load-bearing rule. A new stage copies a neighbour, and correctly.
- **Value:** high, because every new mode adds one. **Ease:** medium-hard. Prompt-cache layout and
  per-stage progress wording differ, so the helper would take the system blocks and a progress
  formatter. A first step: a `messageText(message)` helper and a `progressEvery(ms, report)` helper.

### 4. Relative time ("3 days ago")
- **Canonical:** `src/web/relative-time.ts` § `timeAgo` / `relativeAgo`, imported by 13 web files,
  paired with `src/web/useNow.ts` § `useNow`. The docs name it in `library.md`, `admin.md` and
  `changelog.md`.
- **Copy:** `src/web/Metadata.tsx` § `ago`, with 3 call sites. It has no 30-day switch to a date and
  no `useNow` clock, so it goes stale. Plan 260825e already said to use `timeAgo` "not this file's
  own `ago`", and the copy survived. **Easy, worth doing.**
- **Ops side (`scripts/`, `tools/`):** `tools/fleet/web/src/view.ts` § `formatDuration`,
  `scripts/overseer-decisions.ts` § `formatAge` and `scripts/overseer.ts` § `agoInWords` produce
  three different short forms. `src/web/mic-recording.ts` § `formatDuration` is a stopwatch
  (`1:07`): same name, different job. Leave it, but note the name clash.

### 5. Abortable sleep, Retry-After, backoff
- **Abortable sleep:** the canonical one is `src/concurrency.ts` § `sleepUnlessAborted`, which
  rejects with `abortedWaiting()`. The copies:
  - `src/pdf-read.ts` § `waitOrGiveUp`, which `concurrency.ts`'s own comment names as "the second"
  - `src/embeddings.ts` § `sleep`, which **resolves** on abort rather than rejecting, a silent
    divergence
  No doc names any of them.
- **Retry-After parsing:** `src/ai-call.ts` § `retryAfterMs(headers)` and `src/fetch.ts` §
  `retryAfterMs(header, now)`. ai-call's comment argues that "a second parser would be a second
  opinion", and one exists. They already disagree: `fetch.ts` allows 0 and rejects decimals, while
  `ai-call.ts` returns null for <=0 and accepts decimals.
- **Backoff formulas:** `src/fetch.ts` § `retryDelayMs`, `src/embeddings.ts` § `backoffMs` and
  `src/pdf-read.ts` § `backoffFor`, plus a 429 loop in `src/hierarchy-deepen.ts`. Their jitter
  rules differ on purpose and are documented inline, so only the sleep and the header parser are
  worth merging.

### 6. Client answer-stream loop
- **Canonical:** `src/web/lib/sse.ts` § `readAnswerStream`, with 2 callers: `useGlossary.ts` and
  `useCitations.ts`. No doc names it. `copy.md`, `search.md` and `performance.md` name the
  lower-level `readEvents`.
- **Hand loops over `readEvents` (7):** `useComments.ts`, `useSearch.ts`, `useCriteria.ts`,
  `useClaims.ts`, `useMirror.ts`, `useQuiz.ts`, `link-facts.ts`. jscpd pairs: `useComments` and
  `useSearch` (96 lines), `useCriteria` and `useSearch` (89 lines). Some carry item frames rather
  than text deltas, so not every one fits.

### 7. Artefact-mode client hook state
- About 10 hooks (`useCitations`, `useTimeline`, `useDebate`, `useFaq`, `useIdeas`, `useSketch`,
  `useIllustrated`, `useTweets`, `useSimple`, `useTrajectory`, plus `useGlossary`, `useQuotes` and
  `useQuiz`) each declare the same `{stale, outdated, error, job, failed, stalled, starting,
  automatic, ensure, regenerate, cancel}` shape. Each also writes the same 404/ready/error read
  around `src/web/useOrderedRead.ts` § `useOrderedRead`, `src/web/useStepJob.ts` § `useStepJob`
  and `src/web/useAutoRun.ts` § `useAutoRun`. jscpd: `useCitations` and `useTimeline` share 127
  lines, `useCitations` and `useDebate` 123.
- `mode.md` names all three hooks well ("rather than a ninth copy"). The remaining repetition
  is the state glue between them. The value is real, but this is hard to do without a generic
  `useArtefact<T>` that every mode's quirks (profile, findNote, outdated) must fit, so weigh it
  carefully.
- A narrower sibling: `src/web/useProjection.ts` and `src/web/useSimilar.ts` (82 lines).

### 8. Spinner classes
- **Canonical:** `<LoaderCircle className="cmt-spinner">`, 34 uses. It is named in `web-client.md`
  and `icons.md`.
- **Copies:** `.srch-spin` (`SearchPanel.tsx`, 5 uses), `.spin` (`DictationStrip.tsx`, 2) and
  `.chat-dialog-spinner` (`ChatDialog.tsx`, 2). All three run the same `cmt-spin` keyframes.
  The `cmt-` prefix is what makes it look comment-specific. A rename to a neutral class would stop
  further copies.

### 9. Formatting with no shared helper
- **Plural:** about 82 inline `n === 1 ? "" : "s"` ternaries (12 in web, 21 in server, 49 in
  scripts/tools), plus 3 private `plural()` copies in `tools/` (`attention-eval.ts`,
  `attention-labels.ts`, `ScheduledOccurrences.tsx`). There is no `src/` helper. Cheap to add, but
  the copies do little harm.
- **Absolute dates:** about 15 web files call `toLocaleDateString` with their own options (`month:
  "short"` vs `"long"`, `dateStyle`). `src/web/relative-time.ts` § `absolute` ("12 Aug 2026") is
  private. Exporting it as the house date would stop new variants.
- **Currency:** `src/billing-plan.ts` uses `Intl.NumberFormat` (GBP) and is the only one. Fine.

### 10. Small private copies
- `src/pdf-read.ts` § `escapeHtml` is a local arrow function that does not escape `'`, while
  `src/html.ts` § `escapeHtml` does and is used by 7 files. **A one-line fix.**
- `escapeRegExp` appears in `src/citation-lookup.ts` and `src/term-match.ts`, and twice in
  `tools/fleet/`. These are identical one-liners, so they are low value.
- `allOrStop` has two **exported** functions with the same name and different contracts:
  `src/concurrency.ts` (with a drain deadline, used by `pdf-read.ts` and `hierarchy-deepen.ts`)
  and `src/labels.ts` (the original, which can hang). `concurrency.ts`'s header says "the one to
  import is this one". Auto-import can pick the wrong one. Rename or un-export the labels copy.
- `src/ai-spend.ts` § `formatNanos` and `src/admin.ts` § `formatSpendNanos` are **deliberate**: a
  bundle boundary, since `ai-spend` imports `node:async_hooks`. `tests/admin-spend-column.test.ts`
  holds them equal. They could become one copy if `ai-spend.ts` re-exported the `admin.ts` one.
- Cosmetic repeats: the `readHref(slug, carriedSearch(location.search), "metadata")` link in 4 files. Slugifiers (`src/ingest.ts` § `kebab`, `scripts/plan-name.ts` § `toSlug`, `scripts/gjd-remote.ts` § `slugify`) differ by domain. Leave them.

### 11. Script harness copies
- `scripts/measure-cpu.ts` and `scripts/measure-startup.ts` share 178 lines (`class Cdp`, `readDebugPort`, `waitForPort`, `waitForOrigin`). Also `db-reown.ts` and `db-seed-dev.ts` (37). Low value: bench scripts.

### Checked and clean
- **AI gateway bypass: none undeclared.** Paid calls go through `src/ai-call.ts` or `src/messages-stream.ts`. Live mode (`src/live.ts`) is the sanctioned exception. Other bypasses are declared in `src/spend-declarations.ts` (about 22, including the new `scripts/probes/261001g-exa-upstream-probe.mjs`). `tests/no-undeclared-spend.test.ts` enforces this with a parser.
- **Single paths, no second copy found:**
  - cost recording: `src/ai-spend.ts` § `recordSpend`, plus `src/live.ts` § `acceptRealtimeUsage`
  - client fetch: `src/web/lib/api.ts`, 76 files; the raw `fetch` calls are justified
  - tooltips: `src/web/Tooltip.tsx`; about 90 raw `title=` remain, per `tooltips.md`
  - logging: `src/log.ts`
  - URL state: `src/web/params.ts`
  - clipboard: only `AnnotateDialog.tsx`
  - debounce/throttle: none exists, and no copies either

## Shared building blocks, for a signpost doc

Server:
- `src/ai-call.ts` § `openRouterJson` / `openRouterStream` / `openRouterImage` / `openRouterTranscription`: any paid chat-wire call. Never `fetch` a provider.
- `src/messages-stream.ts` § `streamMessage`, `wasRefused`: a pipeline stage on the Messages wire. Always `finalMessage()`.
- `src/stream-run.ts` § `runStream`: a reader-facing streamed answer (deadline, stall, ending verdict). The lower-level pieces are `src/openrouter-stream.ts` § `classifyEnd` etc.
- `src/routes.ts` § `sse(res)`: writing SSE frames from a route.
- `src/parse-json.ts` § `parseJsonAnswer` / `parseJsonFrom`: a model's JSON answer. `src/anthropic-call.ts` § `anthropicCallFailed`: an SDK error as a stage failure.
- `src/ai-spend.ts` § `recordSpend` / `formatNanos`; `src/cli-ledger.ts` § `withLedger`: cost rows; a CLI on the ledger.
- `src/concurrency.ts` § `allOrStop`, `WidthGate`, `sleepUnlessAborted`: fan-out with a stop, an adaptive width limit, an abortable wait.
- `src/after-response.ts` § `afterResponse`: work that must outlive the response. `src/source-hash.ts` § `hashBlocks` / `checkpointKey`: the content hash a stage caches on.
- `src/html.ts` § `escapeHtml`, `plainTitle`; `src/log.ts` § `log(component)`, `errorFields`, `since`; `src/messages.ts`: escaping, server logs, reader-facing failure sentences.

Client:
- `src/web/lib/api.ts` § `apiFetch`, `fetchOk`, `readJson`: any call to our API. `src/web/lib/sse.ts` § `readAnswerStream` / `readEvents`: a streamed answer.
- `src/web/lib/describe-failure.ts` § `describeFetchFailure`; `src/web/lib/reader-facing.ts` § `ReaderFacingError`: an error a reader sees.
- `src/web/useOrderedRead.ts`, `useStepJob.ts`, `useAutoRun.ts`; `src/web/JobProgress.tsx`: a mode's read, job, auto-run, and progress card.
- `src/web/Tooltip.tsx` § `Tooltip` / `ControlTip` / `TipNote`; `src/web/useHoverCard.ts`: any tip, or a card on prose.
- `src/web/IconButton.tsx`, `src/web/components/ui/button.tsx` / `toggle.tsx`, `src/web/Toast.tsx`: controls and a transient confirmation.
- `src/web/ThresholdSlider.tsx` with `src/web/threshold.ts` § `applyThreshold`: "show items above a score".
- `src/web/lib/DataTable.tsx` § `DataTable` / `useSortedTable`; `src/web/lib/table-sort.ts`: a sortable table with URL state.
- `src/web/relative-time.ts` § `timeAgo` with `src/web/useNow.ts` § `useNow`: "3 days ago".
- `src/web/params.ts` (nuqs parsers), `src/web/router.ts` § `readHref` / `carriedSearch`: URL state and links.
- `src/web/key-chord.ts` § `isTyping` / `isModChord`; `src/web/keynav.ts` § `useArrowNav`; `src/web/useEscapeToClose.ts`: keyboard (tiers in `keyboard.md`).
- `src/web/useSlow.ts`, `useOnline.ts`, `useTapReveal.ts`; `<LoaderCircle className="cmt-spinner">`: a delayed spinner, offline state, tap-twice, the spinner.

Scripts: `scripts/tmux-job.ts` (long jobs), `scripts/run-codex.ts` / `run-claude.ts` on `scripts/subagent-cli.ts`, `scripts/plan-name.ts`.

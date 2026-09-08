# Spideryarn: the improvements worth doing next

Status as of 2026-09-08: **researched umbrella plan; implementation not started**. Based on
`4adcdfd62703b6565a27a03c50f20f8a215f1bd8`, after pulling `origin/dev` first. Review and validation
results are recorded at the end. This is a plan-only commission: completing this document does
not authorise implementing every product decision below.

> Write a rich many-step plan to improve the codebase (prioritising the various suggestions by a
> combination of ease and value), with enough research and detail that another less-capable agent
> could follow it correctly.
>
> Focus on Spideryarn, rather than the orchestrator/web-UI.
>
> You can also include product improvements as well as just cleaning up
>
> — Greg, 2026-09-08

The best next work is to protect the reader's current work, keep the article usable when a mode
fails, and remove a few avoidable interruptions to reading. Finishing existing migrations is worth
more than inventing another architecture. The recommendations below mix product improvements with
engineering work, but label product choices explicitly so an implementer does not mistake a
proposal for Greg's decision.

## Read this before taking a stage

- [Vision](../project/vision.md): augment understanding; generated material should bring the reader
  back to the article. This plan adds no automatic summaries, completion scores or engagement goals.
- [The sweep method](../reusable/improve-the-codebase.md): verify nominations, count actual
  instances, distinguish a defect from an unproved hypothesis, and prefer deleting a mechanism.
- [Engineering manager](../reusable/engineering-manager.md): worktrees, bounded delegated stages,
  independent Sol review, and a commit at each good stopping point.
- [Block ids](../project/block-ids.md) and [granularity zoom](../project/granularity-zoom.md): read
  before changing passage targeting, extraction or reader composition. Never substitute offsets for
  block identity; do not make a second hierarchy.
- [Fourth sweep](260906h-improve-the-codebase-fourth-sweep.md): history, not today's backlog. Several
  of its highest-ranked proposals are already built; the reconciliation below is part of this audit.
- [Quality commands](../project/code-quality-overview.md) and
  [testing](../project/testing.md): the full gate needs local services; an offline pass is not that gate.

## Scope, evidence and limits

**Inspected:** product `src/`, including `src/web/`, `src/store/`, `src/db/`, pipeline and API
boundaries; `api/`; relevant tests, eval harnesses, product scripts and configuration; recent
product commits, earlier sweeps, relevant project docs, postmortems and reader feedback. Three
breadth agents covered client/duplication, server/store/pipeline, and existing knowledge/defences;
the primary checked nominations against current source and rejected stale claims. A separate Sol
investigation checked the strongest client race claim through its mounted UI.

This was a broad static sweep with deeper reading of selected seams, **not a line-by-line review of
every file**. Scope inventory at the baseline: 594 tracked files under `src/`, 1 under `api/`, 107
under `scripts/`, 676 under `evals/`, 1,045 under `tests/`, 165 under `drizzle/`, and 2 under
`styles/`. The last five totals include supporting material outside the product investigation;
they are an inventory, not a claim that every item was examined.

**Excluded:** `tools/fleet/`, `tools/overseer/`, their UI, operational behaviour and improvement
backlogs; machine configuration changes; private agent memories and transcripts; live production
database, Storage, Stripe and monitoring data; live product inference; browser measurement and reader
interviews. No production incident frequency, storage-growth rate, accessibility conformance or
performance saving was measured. Runtime sequencing claims below need deterministic red tests
before fixes. Existing postmortem measurements remain attributed to their original date.

Evidence states are independent of rank:

- **Reproduced:** a command run in this audit produced the stated outcome.
- **Proved from code:** the current source establishes the mechanism; no user incident is claimed.
- **Hypothesis:** plausible benefit or failure requiring a specified experiment. A product idea can
  have a proved existing limitation and still have hypothetical value.

### Measurements, with their denominators

Run on 2026-09-08 against the baseline above:

| Command / scope | Result | What it establishes |
|---|---|---|
| `npm run knip` | exit 1; config-load error for stale client stamp `dea7bf69…` versus source `4adcdfd6…`, followed by findings | graph discovery is degraded; reported unused counts are not reliable deletion evidence |
| `node_modules/.bin/jscpd src api --min-lines 5 --min-tokens 50 --format typescript,tsx --reporters console` | 250 clone reports | product nomination pool, not 250 worthwhile refactors |
| `node_modules/.bin/biome lint --only=complexity/noExcessiveCognitiveComplexity --max-diagnostics=none src api` | 84 infos, 580 files checked | complexity triage, not 84 defects |
| same tools through the repo-wide npm scripts | 321 clones; 160 complexity infos over 1,962 files | includes non-product code; deliberately not used to rank product areas |
| `git log --since=2026-09-01 --no-merges --format= --name-only -- src api`, count each nonblank path | `routes.ts` 54 commits, `messages.ts` 52, `types.ts` 42, `jobs.ts` 39, `pipeline.ts` 34 | recent editing pressure; refactors and comments contribute too |
| current line counts | `routes.ts` 8,676; `App.tsx` 481; `styles.css` 68 | the last two have already been decomposed; size alone would mis-rank this work |

Repeat these commands when taking a stage. Find a cited symbol by content: line numbers below are
dated coordinates, not stable identities. Keep raw test output and red-control evidence with the
stage's own plan/review artifacts, without secrets or article prose.
This audit's [command evidence](260908f-prioritised-spideryarn-codebase-improvements-evidence.md)
records the completed checks and the unsuccessful attempts separately.

## Priority: value and ease, with risk allowed to veto

Value is a judgement from 1 (small editor convenience) to 5 (protects reader work or the core reading
experience). Effort is **focused engineering time including targeted tests and review**, before
shared-machine/full-suite delays: XS ≤ half a day, S about one day, M two–three days, L four–seven
days. These are rough estimates for an agent needing explicit guidance, not delivery promises.
Ratio uses value divided by effort points XS=1, S=2, M=4, L=8. Confirmed reader-facing correctness
comes first regardless of ratio; product decisions and destructive operations can block scheduling.
The ratio is a tie-break, not a sorting algorithm: a cheap alias deletion scores well but cannot
displace protecting reader work. With no observed drift, a dedup waits for an edit in its own area.

| Order | ID / cluster | Evidence | Value | Effort | Ratio | Risk / dependency |
|---|---|---|---:|---|---:|---|
| First | A — opening reads overwriting newer reader actions | Proved from code; independently reachable | 5 | S for gating; M for reconciliation | 2.5 / 1.25 | product choice; preserve old rows as well as new ones |
| Next | B — contain failures in independently mounted modes | Proved from code: one boundary call site | 5 | M per batch | 1.25 | medium; activation and controller placement |
| Early small product win | C — carry a glossary question into chat | Proved from code (gap); Hypothesis (benefit) | 3 | S | 1.5 | medium; draft ownership decision |
| Early engineering win | D — make unused-code analysis work without a fresh build | Reproduced | 4 | S | 2 | low; preserve the production build guard |
| Then | E — stream the glossary's two waiting lookups | Proved from code (gap); Hypothesis (benefit) | 4 | M | 1 | medium; complete/save/abort contract |
| Then, after a product choice | F — serve a figure worth enlarging | Proved from code; dated reader report, benefit Hypothesis | 4 | M | 1 | medium; bandwidth, stable manifest identity |
| Continue the existing job | G — finish route-table migration in safe slices | Proved from code; partially shipped | 4 | L total | 0.5 | medium; lifetime checks before each move |
| With a relevant route slice | H — one binary-response writer | Proved from code: six differing header set-sites | 3 | S | 1.5 | medium; preserve auth/cache/status per caller |
| Small cleanup | I — retire the obsolete revision alias | Proved from code: 13 test imports | 2 | XS | 2 | low; migrate references before deletion |
| As the next retry-rule edit arises | J — share the search/criterion retry decision | Proved from code: two copies; no drift proved | 3 | S | 1.5 | low–medium; keep result shapes separate |
| As the next gateway edit arises | K — share seven identical missing-key checks | Proved from code: seven of twelve reads | 2 | S | 1 | low–medium; retain five distinct contracts |
| Optional targeted investigation | L — can the outer error mapper fail on an unknown throw? | Hypothesis; no production source established | 2 | XS investigation | 2 | defer without a realistic red witness |
| Product experiment | M — keyboard access to terms in the current passage | Proved from code (gap); Hypothesis (benefit) | 4 | M | 1 | medium; avoid hundreds of tab stops |
| Separate fidelity job | N — retain PDF item boundaries through scoring | Proved from code (limitation); Hypothesis (improvement) | 4 | L | 0.5 | high; extraction/hash/ID implications |
| Implement the existing on-demand decision | O — operate abandoned-draft retention | Proved from code: definition, zero callers | 3 | M | 0.75 | high; per-article scope and atomic protection |
| Alongside the first batch, before E/F/M | P — test whether the reading tools help understanding | Hypothesis, explicitly open Q6 | 4 | S preparation | 2 | recruiting/consent; no telemetry project |

An implementer should not take this table as permission to begin sixteen projects. The recommended
first batch is **A, the first B stage, C, D, and preparation of P**; then review the result with Greg. If A's red experiment
disproves a candidate, delete that candidate rather than fixing an unreachable state. E and F are the
next product batch, after P's protocol is ready; conducting the study can wait for consent and
recruitment. G is a continuation with its own history; coordinate with its current owner.

## Common completion contract for every implementation stage

- [ ] Pull/merge latest `dev`, inspect current work and the stage's source census, then claim an
  isolated worktree and run `npm run worktree:setup`. This document-only audit stayed in the primary
  checkout under the documented doc-edit exception; code implementation must not.
- [ ] Read the owning docs and prior plan named in that stage. Re-check that the work is unbuilt.
- [ ] For a defect, write the reachable red test first. For a refactor, characterise current behaviour
  and demonstrate one plausible semantic mutation that the test rejects. A syntax error is not proof.
- [ ] Delegate a bounded implementation; keep source files non-overlapping between concurrent agents.
  Two stages needing `Reader.tsx` or `routes.ts` are sequential even when their ideas are independent.
- [ ] Run the focused checks, then `npm test`, `npm run typecheck`, and lint touched source files.
  Run `npm run check` as the pre-commit gate, which includes the build and suite; avoid launching
  duplicate full suites concurrently. Follow current testing docs for resource admission/local DB.
- [ ] For UI changes, delegate real-browser verification through `scripts/run-claude.ts` to Sonnet
  on this box, following [browser control](../project/browser-control.md). Check the outcome at
  narrow and wide widths; use keyboard and touch where affected.
- [ ] Get Sol review of the scoped diff, raw results and negative controls. Resolve findings and
  update the owning doc in the same stage. Rule-text changes follow the important-doc approval rule;
  an ordinary signpost does not require it.
- [ ] Commit only named owned files with the staged-revert guard, push `HEAD:dev`; do not deploy
  `main`. Update this plan's status for the cluster. Before removing a completed worktree, run
  `npm run worktree:check` inside it and keep any unique data.

### Starting points for focused checks

All names below are current files under `tests/`; they are starting points, **not a claim that
the proposed behaviour is already covered**. Run with `npx vitest run tests/<name> ...`, letting
the existing configuration choose the correct database lane. Use `--project unit` only for suites
that actually belong there. New race/lifetime/stream cases go alongside the closest existing suite.

| Cluster | Read and extend these existing tests first |
|---|---|
| A | `referee-criteria-panel.test.tsx`, `use-search.test.ts`, `use-comments-load-state.test.ts`, `annotation-reuse.test.tsx`, `artefact-read-race.test.tsx` |
| B | `a-broken-mode-leaves-the-article-readable.test.tsx`, `every-boundary-contains-a-throw-that-is-not-an-error.test.tsx`, `no-boundary-reads-the-caught-value.test.ts` |
| C / E | `glossary-asked-term.test.ts`, `glossary-asked-term-race.test.tsx`, `glossary-lookups.test.ts`, `glossary-lookup-refusals.test.ts`, `term-lookup.test.ts`; use `quiz-mark-stream.test.tsx` as a terminal-frame precedent |
| D | `client-shell.test.ts`, `build-stamp.test.ts`; add the actual Knip consumer smoke test |
| F | `assets.test.ts`, `collect-assets.test.ts`, `rehost.test.ts`, `asset-route.test.ts`; preserve `blocks-baseline.test.ts` identity guarantees |
| G | `authenticated-api-route-contract.test.ts`, `routes.test.ts`, plus the per-slice stream/lock oracle required by the migration plan |
| H | `source-route.test.ts`, `asset-route.test.ts`, `export-route.test.ts`, and current public/feedback route coverage located through each caller |
| I | the 13 importer suites listed in I, plus `doc-links.test.ts` |
| J | `searches.test.ts`, `store-searches-pg.test.ts`, `referee-criteria-store.test.ts`, `referee-criteria-routes.test.ts` |
| K | `explain.test.ts`, `models.test.ts`, `quiz-mark-route.test.ts`, plus existing tests for each migrated missing-key caller |
| L | `routes-status-classes-survive-the-store-guard.test.ts`, `db-error-scrub.test.ts`, `comment-referee-mark.test.ts`; preserve these shipped defences |
| M | `hover-card-touch.test.tsx`, plus a new mounted keyboard witness through the selected interaction |
| N | `pdf.test.ts`, `pdf-score.test.ts`, then all downstream consumers found by the `PageText`/`pass0` census |
| O | `store-publish-guards.test.ts`, `article-delete-pg.test.ts` for fixture/protection conventions; add a dedicated draft-sweep selection/race suite |

P produces a study protocol; automated tests cannot establish whether people learned from it.

## A — opening reads must not erase later actions

**Class:** a page-lifetime guard is mistaken for an ordering guard. `live` prevents a response from
an old mount committing; it says nothing about a GET and POST from the same mount.

Starting points: `src/web/useCriteria.ts` § opening load effect (around 109–145), `ask` and `put`;
`src/web/CriteriaPanel.tsx` § `CriteriaView` renders `NewCriterion` before its loading message;
`src/web/useSearch.ts` § opening effect; `src/web/useComments.ts` § opening effect. The nomination
census is **three hooks**, not three observed production incidents. `useClaims` already uses
`useOrderedRead`; the job-backed artefact readers were repaired earlier. See
[the earlier race postmortem](../postmortems/260905e-a-slow-response-overwrites-a-fast-one.md).

**Independent Sol verification confirmed the mounted paths.** Criteria's `NewCriterion` and
Search's owner `Box` remain usable while their GET is pending. Comments' reachable path is the
free annotation `create`: `OwnedReader` starts its GET, and `AnnotateDialog` Save does not consult
`comments.loaded`. A completed write is erased from **this tab**, not from Postgres; reload restores
it. The ordinary new-comment AI flow hands off to Chat, so the nominated legacy comment-stream
path was false and is excluded. Provenance and introducing commits are in
[the new postmortem](../postmortems/260908c-an-opening-read-can-erase-a-later-write.md).

**Simpler product choice before engineering:** recommend keeping fields mounted/editable but
gating Run/Find/Save until the opening read settles, successfully **or with an error**. This orders
the operations without inventing a list merge protocol. Show Greg the brief extra wait before
implementing that changed behaviour. No choice has been made by Greg in this plan-only task.
A never-ending request must have a bounded failure ending: `apiFetch` currently has no response
deadline; `SESSION_DEADLINE_MS` only bounds obtaining a credential. If immediate submission is required instead, use
the reconciliation stages below. Do not build the complex version before asking about the simpler
product option.

### Stage: the recommended submit gate, if selected

- [ ] Write one mounted-UI red witness per surface: hold the opening GET containing old row A,
  type the input, and show that today's enabled action can create/complete B before GET A erases it.
  Start this reproduction outside StrictMode: a development remount can hide ordering bugs.
- [ ] Pin the selected behaviour: typing remains possible, while Run/Find/Save and keyboard submit
  are refused during the outstanding read. Thread `loaded` to the existing readiness predicates in
  `SearchPanel.Box`, `CriteriaPanel.NewCriterion`, and `AnnotateDialog`; gate the handler as well as
  the button. Do not make a hook's `ask` silently return without writing: its callers immediately
  activate the returned row id. If adding a hook-level refusal, represent refusal in the return
  type and update callers deliberately; gating the actual event handlers is the smaller change.
- [ ] Use `loaded`, not `!loadFailed`: once GET has failed, there is no later snapshot to overwrite
  a write. Test success, failure and timeout release the action; preserve the existing load error.
  Give the opening reads a named response deadline. Its ordering is: **abort or invalidate the
  GET's commit generation → mark the load failed and `loaded=true` → enable writes**. Hold GET A
  past that deadline, successfully create B, then release A and prove B remains. Keep the current
  page-reload recovery for load failure in v1; adding in-place retry would require gating again or
  reconciliation, because a retried GET can otherwise recreate the same race.
- [ ] After load succeeds, perform the write and require A and B remain. After load fails, require
  the new write remains. Preserve draft text, dictation guards, colour, reminted ids and tombstones;
  add a StrictMode regression after the non-StrictMode red witness.
- [ ] Add a concise loading reason where necessary, review all three surfaces in the browser, and
  complete the common checks. If this closes the current paths, skip both reconciliation stages.

### Alternative stage: reconcile Criteria if pre-load submission must stay

- [ ] Mount the actual Referee criteria UI, hold its opening GET response, submit through
  `NewCriterion`, and release stream frames through completion before releasing the older GET.
  Require a positive witness that the POST and completion actually happened.
- [ ] Seed the held GET with one **pre-existing criterion**, then stream a different new criterion.
  The expected final list contains both. This rejects the attractive but incomplete fix of simply
  invalidating the only initial read when a write begins: that fix can permanently hide old rows.
- [ ] Include GET failure, stream failure with partial results, delete during the stream, server id
  remint on retry, slug change and unmount. Reuse the hook's current tombstones and chosen-colour
  overlays; they solve different ordering questions.
- [ ] Choose the smallest result reconciliation: fence stale snapshots and refresh after the write,
  or merge the initial snapshot with locally changed/deleted rows using explicit local ownership.
  Reuse `useOrderedRead` only if its commit model fits; do not create a generic streaming-hook API.
- [ ] Assert no duplicate paid request, no lost old row, no resurrected deleted row and no stuck
  loading state. Update [referee mode](../project/referee-mode.md). Complete the common checks.

### Alternative stage: extend reconciliation to Search and free Comments creation

- [ ] Independently prove that each real composer is mounted and enabled while its initial GET is
  outstanding. A direct hook call is insufficient if the UI prevents the schedule.
- [ ] For Comments use `AnnotateDialog` → `comments.create`, with **Also ask the AI** off. Do not
  write the red witness against the obsolete new-comment streaming path.
- [ ] For each reachable sibling, repeat the old-row/new-row test and its own delete/remint cases.
  Leave a false candidate out, with the reason in this plan.
- [ ] Share only the ordering invariant that survived both implementations. Existing
  `tests/artefact-read-race.test.tsx` is a precedent, not proof that list mutations are covered.
- [ ] Review the finished code for reverse schedules too: old GET first, local failure afterwards,
  and a successful mutation followed by a failed refresh. Keep usable rows on refresh failure.

**Stop point:** each repaired hook stands alone; no half-migrated data shape or API change.

## B — a broken mode should leave the article readable

**Proved from code:** there is one `<FeatureBoundary>` call site, around Ideas in
`src/web/reader/Reader.tsx:1590`. `MODES` currently has **15 entries**:
`plain, hierarchy, chat, glossary, search, referee, summary, diagram, ideas, remember, outline,
quotes, timeline, debate, structure`. That is not fifteen identical panels: `plain` and `hierarchy`
have no independent band, and conversation modes include additional controller/session concerns.

The earlier statement that every controller still needs extracting is stale: mode files now live
under `src/web/modes/`. Read
[the Ideas containment plan](260905h-a-mode-failure-should-leave-the-article-readable.md) and
[reader decomposition](260906c-separate-article-access-reader-composition-and-mode-controllers.md).
`ModeSurface` intentionally owns markup, not errors.

### Stage: contain Debate, using the existing mechanism

- [ ] Trace `DebateBand` in `modes/debate/DebateMode.tsx` and identify all render-time work. Wrap the
  controller and panel together, not only the visible panel; leave shared article geometry outside.
- [ ] Extend `tests/a-broken-mode-leaves-the-article-readable.test.tsx` with a Debate controller throw
  under real StrictMode. Assert the throwing seam ran, prose/spine/dock remain, the fallback names
  Debate, and one scrubbed report is emitted without article/error-message text.
- [ ] Exercise activation retirement: a throw before `useAutoRun`'s effect must not leave a token
  that later Back navigation spends. Successful activation is the positive one-POST control.
- [ ] Test retry/reset identity, owner-to-visitor transition, different slug, and switch to Plain.
  Complete common checks and commit this independently useful improvement.

### Stage: extend containment with an honest inventory

- [ ] Classify each mode's actual mounted controller/visitor branch. Record explicit exemptions for
  structural views that cannot be isolated without taking the article with them.
- [ ] Migrate small independent bands first (Quotes, Timeline, Summary, Glossary), then Search,
  Referee and Diagram; handle Chat/Remember separately because session and draft state can live
  above the band. Do not wrap stateful hooks that execute in the parent and claim they are protected.
- [ ] Derive a completeness test from `MODES`, with named exemptions and a shrinking legacy set.
  A new mode must force a containment decision. A synthetic new mode must fail the check.
- [ ] For each migrated family, retain a behavioural throw witness. JSX presence alone does not
  establish that the throw occurred beneath the boundary. Finish by deleting the legacy set or
  explicitly documenting each remaining architectural exception.

## C — keep the glossary question when opening chat

**Proved gap; product benefit unmeasured.** The search box already exists: `AskATerm` in
`src/web/GlossaryPanel.tsx:1499`. Its failure button calls `onAskChat()` with no term, and
`src/web/modes/glossary/GlossaryMode.tsx:94` only switches modes. The
[reader report](../user-feedback/260904_1301-glossary-search-box-for-a-term.md) explicitly records
this remaining gap. Do not rebuild the box, add fuzzy matching, or persist custom glossary entries:
those are different, previously weighed decisions.

### Stage: one explicit draft handoff

- [ ] Product proposal for Greg: pressing **Ask in chat** opens an editable question about the
  entered term and sends nothing until the reader presses Send. Prefer a fresh conversation to
  overwriting an existing draft; present that choice concretely before implementing it.
- [ ] Read `src/web/chat-handoff.ts`, the current `ChatDialog` opening props, and the conversation
  controller. Use the existing reader-owned prop path if possible. Its old global-cell implementation
  was deleted for cross-article/StrictMode bugs; do not revive it or put private text in a URL.
- [ ] Carry the trimmed submitted term and article identity, not whichever text happens to be in
  the box when an old failure arrives. Keep validation and ownership checks unchanged.
- [ ] Test term survives handoff, draft stays editable, zero model requests before Send, exactly one
  after Send, existing draft preserved, navigation cancels a pending handoff, and visitors have no
  paid control. Test a long term and quoted characters as data.
- [ ] Check focus reaches the composer and Escape/back behaves as the current dialog contract says.
  Update [glossary](../project/glossary.md); complete common checks.

## D — let Knip inspect source without requiring build output

**Reproduced:** `npm run knip` reports a config-load error because `vite.api.config.ts` evaluates
`readClientShell` at module load, then continues to print findings and exits nonzero. The failed
discovery can leave its Vite/API graph incomplete; those findings are not safe deletion evidence.
A stale/missing shell should block an API build; it should not degrade static inspection after
every pull. The production guard is valuable and must remain.
The [postmortem](../postmortems/260908d-build-only-config-work-runs-during-static-analysis.md)
traces the introducing commit and explains why the existing shell tests do not cover this consumer.

### Stage: decouple config discovery from build execution

- [ ] Read `knip.jsonc`, `vite.api.config.ts`, `scripts/client-shell.ts` § `readClientShell`, and
  `scripts/build-stamp.ts`. Reproduce in a disposable worktree with a missing shell and then a
  deliberately stale stamp; do not remove the primary checkout's build artifacts.
- [ ] Inspect the installed Knip Vite plugin and schema. First try the smallest supported
  configuration that statically includes the API entry without evaluating its build-only config.
  If that loses alias/import coverage, move build-only shell evaluation to Vite's build invocation
  while keeping config analysis inert. Verify the plugin's actual evaluation behaviour before
  selecting this route. Do not add `if (KNIP) return fakeShell` or weaken stamp comparison.
- [ ] Prove Knip has no config-load error in either missing/stale-shell case and reports a deliberately unused
  fixture module/export; a success with no project files is a failure. Preserve CSS/font dependencies,
  root scratch-file discovery, aliases and `api/index.js`/`src/vercel.ts` reachability.
- [ ] Prove `npm run build:api` still rejects missing/stale shell and `npm run build` succeeds in
  client-then-API order. A completed Knip run with advisory findings need not have exit code zero.
- [ ] Re-run Knip and triage actual product findings. Do not convert that list into automatic
  deletions. Update [static analysis](../project/static-analysis.md); complete common checks.

## E — show glossary answers as they arrive

Two owner-facing waits: **Look up a term** and an existing entry's **Check the web**. The first
is not persisted; the second is. Inspect `src/web/useGlossary.ts`, `src/web/GlossaryPanel.tsx`
§ `AskATerm`/lookup display, `src/term-lookup.ts` § `makeAskAboutTerm` and lookup handlers,
`src/explain.ts`, and the actual route-table entries. The
[streaming plan](260826o-streaming-the-slow-two.md) is historical: semantic search already streams;
do not reimplement that half.

### Stage: stream the unsaved asked-term answer first

- [ ] Characterise today's owner validation, matched quote/block, failure codes and response schema.
  Trace existing spend/rate-limit middleware in current `routes.ts`; the old feedback note's claim
  that there is none predates later billing work and must not become an assumption.
- [ ] Adapt the existing streamed `explain` generator and `src/web/lib/sse.ts` transport. Preserve
  server-derived anchor/provenance and explicit terminal success/error. A progress spinner alone
  does not satisfy streaming: a delayed fake provider must make useful text visible before completion.
- [ ] Keep the answer provisional until terminal success. EOF without terminal, provider error,
  timeout, changed term, changed slug and unmount must have deliberate endings; partial text must
  not become a completed lookup. Never send the reader's typed term as trusted article quotation.
- [ ] Keep public DTOs unchanged and count calls through the route. Aborting a client does not by
  itself prove a provider stopped billing; verify the server cancellation path separately.

### Stage: stream and save an existing entry lookup

- [ ] Add the durable lookup variant after the unsaved path works. Stream deltas but persist only
  the authoritative completed result, including sources/search count and correct term identity.
- [ ] Test failure before first token, midstream failure, save failure after text, concurrent lookup,
  article/entry removal, stale responses, and EOF without terminal. A save failure must not display
  an answer as safely kept. Reuse existing lookup ownership and concurrency semantics.
- [ ] Test owner versus public rendering, refresh the page to verify the stored result, and prove
  the first readable sentence arrives before the controlled delayed completion. Complete common
  checks; update [glossary](../project/glossary.md) and [comments](../project/comments.md) only where
  their streaming seam is actually shared.

## F — give figures enough resolution to read

**Code-verified limitation:** `imageSourceOf` (`src/assets.ts:360`) reads only `img[src]`.
The [monkeys report](../user-feedback/260907_0735-the-monkeys-illustration-does-not-load.md) and
[its plan](260908a-the-monkeys-illustration-did-not-load.md) measured a 300px fallback against larger
`srcset` candidates. Those network/byte measurements belong to that investigation; this audit did
not repeat them. The broken-image fix is shipped; higher-resolution selection is not.

### Stage: settle and implement a bounded candidate policy

- [ ] Put concrete options before Greg: keep current thumbnails, or choose a bounded larger
  candidate for reading/enlarging. Suggested trial: prefer a supported candidate around 1,280px,
  retain current per-image/article byte and time caps, fall back to `src` when selection/fetch fails.
  The target is a proposal, not an inferred requirement or measured optimum.
- [ ] Read [article images](../project/article-images.md), `src/assets.ts` § `AssetEntry`,
  `imageSourcesIn`, `storedAssetFor`; `src/collect-assets.ts`; and `src/web/rehost.ts`.
  Keep the **original DOM source as manifest lookup identity** while recording/choosing the URL
  fetched separately. Changing the key to the chosen `srcset` URL alone makes the browser lookup
  miss silently and risks image-only block identity on re-extraction.
- [ ] Start with one candidate family whose parsing can be correct and bounded, such as width
  descriptors on `img[srcset]`. Explicitly retain fallback for density descriptors, malformed lists,
  data URLs, unsupported formats and art-directed `picture/source`; do not pretend to reproduce all
  browser candidate selection. Apply the existing SSRF/redirect/byte checks to every candidate.
- [ ] Fetch at most a bounded preferred candidate plus fallback; preserve global concurrency and
  article budget accounting. Handle repeated images and HTML-escaped query strings once.
- [ ] Test manifest join, original-source fallback, public/private rendering, no publisher request
  while a stored image resolves, missing objects, malicious URLs, and stable block IDs across reruns.
  Decide the `ASSETS_VERSION`/cache migration explicitly. No automatic whole-library re-fetch.
- [ ] Compare a real diagram's labels at normal size and enlarged, on mobile and desktop, with
  downloaded-byte totals. Stop if the gain is not worth the bytes; record the evidence.

### Stage: format support only if the candidate experiment justifies it

- [ ] Treat WebP/AVIF as a separate decision. `sniffImage` and `imageDimensions` in `src/assets.ts`
  currently know PNG/JPEG/GIF. A content-type header or file extension is not format validation.
- [ ] Investigate the narrow parser/library change needed for verified format, dimensions and
  extension mapping; consult official format/library sources when choosing an implementation.
  Test truncated containers, huge dimensions, mismatched MIME and unknown formats before rollout.
- [ ] If complexity dominates the saved bytes, retain the supported-format policy. This stage may
  end with a documented decision to defer; it must not leave half-supported stored formats.

## G — finish the existing route migration, not a new router

Read [the umbrella migration](260907b-split-the-authenticated-api-dispatch-by-domain.md),
[Referee's slice](260907e-referee-joins-the-route-table-and-the-stream-lifetime-test-that-has-to-come-first.md),
and [Chat/live's completed slice](260908a-chat-and-live-sessions-join-the-route-table.md).
At this baseline their inventory is **37 of 81 guards moved, 44 remaining**. Re-count through the
existing verifier before claiming a slice; these are guards, not 81 distinct URLs.

The earlier fourth-sweep proposal to split into per-domain files has been overtaken by this
reviewed closure/table approach. Follow the design that landed. Do not add a router dependency,
rewrite handler bodies during migration, or use total file length as the acceptance metric.

### Stage: Comments, including its missing stream-lifetime witness

- [ ] Verify `/api/comments` is still unclaimed. Begin with the next slice's existing leftover-guard
  control, rather than minting a parallel inventory.
- [ ] Before moving the six Comments guards, write an oracle for
  `POST /api/comments/:slug/:id/answer`: hold the stream while a second attempt reaches the
  `answering` registry. A dropped `await` must release too early and turn the oracle red. Checking
  only a 409 before streaming starts does not test this lifetime.
- [ ] Move bodies verbatim in original order, preserve decode/body-read/auth gates and outer
  response error mapping, and run the existing body-comparison/route tests plus the new oracle.
- [ ] Commit a complete slice. Update the original migration plan's counts and moved prefixes.

### Stage: paid single-flight and article/link-summary slices

- [ ] Follow the queue in the Chat/live plan. For sketch/similar/projection, mutate
  `return withSpendAttribution(...)` to an unawaited `void` in the test control: changing only
  `await` cannot see a return-linked lifetime. Preserve the `INFLIGHT` lock through settlement.
- [ ] For `GET /api/link-summary`, prove the SSE/database single-flight claim lives until the stream
  ends. Use the local database lane for the real lock; a mocked promise cannot establish fencing.
- [ ] Take one contiguous domain per reviewed commit. Reject mixed cleanup in handler bodies.

### Stage: close the transition

- [ ] Re-enumerate the actual remaining guards; new routes may have arrived since 81 was counted.
  Migrate the remainder and make the legacy-guard test require zero.
- [ ] Delete superseded matchers/readers only after searching all scripts, tests, evals and docs.
  Keep no second matching path “just in case”. Run route order, status, ownership, spend and streaming
  suites, then common checks. Further domain-file extraction needs its own measured reason.

## H — share binary response mechanics, keep policies with callers

**Six `X-Content-Type-Options` set-sites under `src/`, not six identical blob-security contracts.**

| Caller at the baseline | Deliberate difference to preserve |
|---|---|
| `routes.ts` § `sendSource` (around 497–565) | owner PDF read; inline disposition; no explicit cache header; GET |
| `sendPlate` (609–648) | owner/illustration manifest; hash **and extension** match; private immutable cache |
| `sendArticleAsset` (698–737) | owner/assets manifest; sniffed MIME; private immutable cache |
| `sendExport` (765–817) | owner/current-revision bundle; ZIP attachment; private no-store; not a blob manifest |
| admin feedback screenshot branch (8035–8061) | admin cross-owner permission; validated report identity; PNG; private no-store |
| `src/public/routes.ts` § `sendBytes` (155–165) | public read policy upstream; namespace no-store; GET **and HEAD** |

### Stage: one response-only helper

- [ ] Characterise each row's full response through its route, including missing/unauthorised cases.
  Byte `Content-Length`, disposition and HEAD are separate assertions. Use multibyte fixture bytes.
- [ ] Extract only status/headers/body writing at the existing server HTTP seam. Inputs are resolved
  bytes, content type and explicit response options. Authorisation, storage-key derivation,
  manifest validation, cache policy choices and error status remain in each caller.
- [ ] Move all six response writers; count remaining set-sites. Do not accidentally enable HEAD on
  authenticated routes merely because the helper supports it for the public route.
- [ ] Mutate a route's cache policy and omit HEAD body suppression to prove the route tests reject
  both. Complete common checks. If a helper adds more branching than it removes, keep the current
  writers and the stronger tests instead; no current security drift was found.

## I — remove a compatibility address with no production consumer

`src/store/revisions.ts` exports only `NO_INPUT_HASH` and `PIPELINE_RUN` from `artifacts.ts`.
The header says seven test importers; this audit counted **13** actual import statements:
`store-publish-guards`, `pg-session-real-step`, `store-pg-session`, `store-carry-forward`,
`store-glossary-delete-pg`, `all-skipped-publication-refusal`, `publication-enqueues-the-labels-successor`,
`pg-session-exact-base`, `glossary-delete-then-rebuild`, `store-step-fence`, `billing-settlement`,
`labels-land-after-the-shelf`, `rerun-failure-keeps-the-old-artefact` (all under `tests/`, `.test.ts`).

### Stage: repoint and delete

- [ ] Repeat the import census over `src tests scripts api evals` and search docs/comments for the
  full filename and `RevisionLifecycle`/`revisionLifecycle` fragments; delegate the rename sweep.
- [ ] Repoint consumers at `src/store/artifacts.ts`. Update the obsolete alias pointer in
  [cron scheduler](../project/cron-scheduler.md), which already owns the on-demand retention
  decision; [database](../project/database.md) may link there. Do not create a second fact home.
- [ ] Delete the alias file and update active references. Historical plans may keep clearly dated
  text, but broken Markdown links must be adjusted so doc-link checks pass.
- [ ] Run the 13 affected test files, doc links, typecheck and common gates. No new unit test is
  needed for a pure import rewrite. Never delete the real revision implementation in `pg-revisions.ts`.

## J — one retry decision for Search and Referee criteria

**Two implementations, no present drift proved:** `src/searches.ts:137` § `withRun` and
`src/referee-criteria-store.ts:67` § `withCriterion`. Both require same id, same text and a failed
row to reset; both preserve colour. The criterion header's claim that the retry rule is imported
is false. See [the original retry incident](../postmortems/260826f-search-retry-remints-instead-of-resetting.md).

### Stage: share the predicate, not the entire stored row

- [ ] Pin the decision table: no prior id, mismatched text, pending/completed/error row, new source
  hash, caller retry id, changed criterion config and selected colour. Test through each real caller.
- [ ] Put a small typed predicate in the existing shared owner (`searches.ts`, if the import
  direction remains acyclic). Leave fresh-id minting and criterion-specific row rebuilding local.
  Reject a generic row state machine whose only customers are these two different products.
- [ ] Fix the misleading comment; run search/criterion retry suites and common checks. If no shared
  seam is simpler than the current two predicates, land the comment correction and defer extraction.

## K — remove seven copies of missing OpenRouter configuration handling

Exact `process.env.OPENROUTER_API_KEY` census under `src/`: **12 reads**. Seven carry the same
load/log/reader-failure sequence: `converse`, `explain`, `search`, `quiz-mark`, `referee-claims-run`,
`referee-criteria-run`, `referee-mirror`. Five have distinct contracts: `ai-call` explicit override,
`embeddings` typed embedding failure, `messages-stream`, `transcribe`, and `pdf-read` stage failure.
The PDF misclassification from the fourth sweep is already fixed.

### Stage: a leaf shared by the seven matching readers

- [ ] Compare the seven missing/configured paths and `loadEnvLocal` order. Preserve the failure
  kind, reader code and operator-only detail; never log the key or environment object.
- [ ] Put the common check at the existing gateway/env seam, without importing the heavy AI client
  into browser/shared modules. Leave the five different contracts explicit.
- [ ] Test missing key means non-retryable configuration failure, configured key reaches the
  existing call, explicit overrides still work, and neither error responses nor logs contain secrets.
- [ ] Repeat the census: six original reads should disappear if the seventh becomes the shared
  implementation, or seven become one new shared read. Name the five exceptions in the seam's
  comment. Do not change model/provider/routing policy in this stage.

## L — investigate only the remaining unknown-throw mapper hypothesis

The proposed store/route agreement guard is **already built**, contrary to the breadth nomination.
`tests/routes-status-classes-survive-the-store-guard.test.ts` reconciles the actual bindings and
numeric-status contract, with negative controls. `db-error-scrub.test.ts` covers safe refusals and
sensitive errors; `comment-referee-mark.test.ts` exercises route → guard → real Postgres. Do not
rebuild any of those. They close the class in
[the original incident](../postmortems/260901d-a-409-and-a-404-arrived-as-500.md).

### Stage: a short reachability investigation that may end with no change

- [ ] Inspect the outer catch/status mapper in `src/routes.ts` (around 6420), not just
  `mayPassThrough` in `src/store/db-errors.ts`. It reads properties of an unknown thrown value;
  a `null` or throwing accessor could make the catch throw. **No production source of such a
  value was established by this audit.**
- [ ] Find a realistic route/dependency seam that can throw the value, then write a route-level red
  witness. A contrived getter passed only to a private helper is not evidence of a product defect.
- [ ] If reachable, make the mapper total over that input while preserving the shipped status,
  scrub and logging contracts. Keep all three existing suites unchanged/green unless the new case
  belongs in one. Do not introduce another class inventory or parser.
- [ ] If no realistic seam is found, record that and stop. This is an XS investigation, not the
  M-sized prevention rewrite in the first draft. A real fix, if warranted, gets its own sizing,
  root-cause note and common checks.

## M — keyboard access to a term without tabbing through the whole article

`src/web/ProseHoverCard.tsx:303` explicitly distinguishes links, which already receive focus, from
`mark.term`, which does not. The proposal to give every term occurrence `tabIndex=0` was rejected
for a good reason: an article can have hundreds of occurrences. `useHoverCard` already has focus
handling; “add focus support” would be a stale task.

### Stage: a small interaction experiment, then implementation if useful

- [ ] Propose a passage-scoped action: from the selected block, open a keyboard-operable list of
  its glossary terms, then the existing definition card. First inspect `TableView`, its selected
  block actions, `term-match.ts`, and existing GlossaryPanel navigation; use those seams.
- [ ] Show Greg a concrete prototype/interaction before choosing a new shortcut or permanent
  control. An alternative worth trying is jumping to the corresponding existing glossary row,
  which needs less card/focus machinery. Prefer that if it solves the task adequately.
- [ ] Test no term/one term/multiple occurrences, term inside a link, stale block id, repeated word
  across blocks, Escape/focus return, and arrow-key editing. Do not suppress ordinary links or
  turn hundreds of terms into tab stops. Test through real keyboard events and a browser.
- [ ] Success is reaching the right definition while keeping the passage and place, not a blanket
  accessibility-conformance claim. Update [keyboard](../project/keyboard.md) and
  [glossary](../project/glossary.md) once the interaction is chosen.

## N — preserve PDF evidence before improving the heuristic

`src/pdf.ts:665` § `pass0` collects positioned text items and builds page text by concatenating
`item.str`, adding a newline only for `hasEOL`. `src/pdf-score.ts:465` § `folioOffset` documents the
upstream information loss and its current workaround. The
[postmortem](../postmortems/260904c-a-document-refused-for-an-answer-it-never-had-to-give.md)
records the original failure; the known examples are already repaired. **No current failing PDF
was reproduced here.** This is a separate fidelity investigation, not Tier 0 work.

### Stage: deterministic evidence and a decision

- [ ] Read `PageText`/`TextItem` and every `pass0` consumer. Build a free corpus comparison using the
  existing PDFs and include adversarial folio/heading adjacency, `12.3.` as an actual section number,
  columns, inline spans and genuine page numbers. No paid extraction is needed to inspect text items.
- [ ] Keep original page text/hash unchanged initially; carry the minimum additional item-boundary
  metadata needed by scoring. Do not blindly insert spaces between every item: fonts split words
  into items too. Explicitly compare old and new heading evidence and refusal reasons.
- [ ] Build a second scored path only in the experiment. Adopt it only if the corpus demonstrates
  an improvement without weakening fidelity checks, then write a separate implementation plan for
  extraction versions, cache invalidation, old artifacts and stable block-ID carry-forward.
- [ ] Remove `folioOffset` only when the replacement handles its proven cases. A new PDF formatter,
  decoder dependency or mass re-extraction is outside this stage.

## O — implement the already-decided on-demand draft cleanup

**Proved from code:** `sweepAbandonedDrafts` (`src/store/pg-revisions.ts:2519`) is defined but has
zero callers in `src/`, `scripts/`, `api/` and `tests/`. Failed/crashed drafts can retain copied
`revision_blocks`; this audit did not measure how many exist or how fast they grow. The current
selection predicate excludes current and job-referenced revisions, but it later deletes by the
enumerated IDs without a delete-time protection recheck. Whether an ordinary path can newly
protect an old candidate in that interval is unproved; the implementation must still preserve
that protection atomically.

The policy is already decided in [cron scheduler](../project/cron-scheduler.md):

> Ignore for now - we'll sweep on demand.
>
> — Greg, 2026-09-06

Its owning doc defines that as **when an article next runs a step, sweep that article's old
drafts**. No scheduler or cadence decision is needed. The first draft of this plan missed this
decision; Sol caught it. Keep this fact in `cron-scheduler.md`. Reconsidering it would need an
explicit reversal from Greg, justified by new measurements.

### Stage: scope and safely wire the existing on-demand operation

- [ ] Add a read-only inventory/report for draft age, status, reference protection and associated
  row/byte estimates, using the exact candidate-selection predicate. Run locally first; production
  reads are allowed but do not print article text or credentials.
- [ ] Change the global sweeper seam to accept the **resolved article identity** and constrain
  selection/deletion to that article. Place one bounded invocation on its existing step-start path
  after ownership/identity is established, using the current transaction/fencing conventions.
  Do not run a whole-library sweep because one reader starts a step.
- [ ] Test old abandoned, recent, current, published, job-referenced and in-flight drafts with local
  fixtures, including another article with equally old candidates. A dry-run counts the same
  selection predicate; an approximate dashboard count is not approval evidence.
- [ ] Put a test barrier between enumeration and deletion. Add and commit current/job protection
  for a candidate, then release deletion: **delete zero protected rows and preserve every article
  and job pointer**. Use compatible locking or an atomic delete-time recheck of the same protection
  predicate. Capture actual affected-row count; do not report the earlier candidate count as deleted.
- [ ] Choose bounded age/batch limits within the existing on-demand policy, retaining the current
  live/owned-draft protection. The historical six-hour constant is a starting point to assess, not
  permission to delete reader-owned work. Test that step start really calls the scoped operation
  and cleanup errors have an explicit, reviewed effect on the requested step.
- [ ] Prepare the command and candidate summary before asking for the destructive remote run.
  Keep that manual remote run pending until approved. This does not reopen the approved on-demand
  design; it is the separate safeguard for a destructive operation against real production data.
- [ ] Log bounded counts/duration/outcome, prove idempotence, and update the implementation status
  in `cron-scheduler.md`. The stage may finish measured/deferred with no deletion; do not call it
  operated retention until a real step invocation has exercised it.

## P — test the product's purpose before adding more modes

This addresses [open question Q6](../project/open-questions.md#q6), not an inferred analytics
requirement. The outcome of interest is a reader reconstructing and interrogating an argument,
not time-in-app, clicks or articles completed.

### Stage: prepare a small reader study Greg can run

- [ ] Write a short protocol using two comparable article passages and counterbalance which is read
  with Spideryarn versus ordinary prose. Start with a small formative set, for example 3–5 consenting
  readers; this is enough to find friction, not to claim a statistically established learning effect.
- [ ] Ask readers to find a claim and its evidence, explain a key term in the author's sense, name
  an uncertainty/counterargument, then reconstruct the argument without the article. Include a later
  optional recall check if practical. Use human-authored rubrics, not model fluency as the score.
- [ ] Observe whether generated text leads back to evidence. Record where mode choice, missing
  glossary explanations or poor figures interrupted them. Collect only what participants agree to;
  avoid installing event telemetry or storing per-answer grades in the product.
- [ ] Give Greg the protocol and recruitment text for approval; do not contact readers. After the
  study, rank observed obstacles above speculative feature work and update Q6's owner doc with the
  decision. Leave uncertain results uncertain.

## Reconciled, rejected or deliberately deferred nominations

These checks prevented the plan from becoming a repeat of the previous sweep:

| Nomination | Current evidence and disposition |
|---|---|
| split `App.tsx` / `styles.css` | already decomposed; 481/68 lines today. Continue real ownership seams, not a second wholesale split |
| repair `PublishRefused` retry classification | already typed `RefusalKind`, with total `Record<RefusalKind, ReaderFacingFailure>` and classified throw sites. A proposed new exhaustive guard duplicates the compiler |
| type Stripe Portal feature coverage | `FEATURE_DRIFT` in `scripts/stripe-setup.ts` already keys off SDK feature types and is exercised. Do not re-propose |
| centralise hierarchy freshness, guard sanitiser hooks, inventory env names | current `store/artifacts.ts`, `tests/the-sanitiser-has-one-policy.test.ts` and env inventory tests already address the old nominations; extending their threat model needs a specific escaped case |
| add the glossary search box / stream semantic search | both exist. C/E target the narrower remaining handoff/lookup gaps |
| adaptive quiz | already shipped 2026-09-07. Quiz attempts/grades intentionally do not persist; saving them would change a public privacy promise |
| make every glossary occurrence focusable | rejected interaction; M investigates a bounded route instead |
| automatically retry every transient stage | deferred: duplicate spend, durable checkpoints and lease budgets make this a separate product/reliability decision. No incident-rate measurement here justifies taking it ahead of A–F |
| new typed capability/config framework | deferred: env-name inventory is newly built; first demonstrate a concrete requiredness/consequence mismatch in current code. Do not replace it with a larger abstraction speculatively |
| deduplicate every provider object, hook and fallback component | no measured drift; the existing routing differences, tombstones, error copy and retry behaviour matter. K takes only the identical missing-key contract |
| progressively release each article image | plausible: `rehostImages` uses one later replacement and `IMAGE_WAIT_MS` bounds slow assets. Measure a fast/slow-image trace first; the current batched draw preserves React ownership and publisher-request rules |
| persist reader-added glossary entries / typo suggestions | explicitly deferred/rejected in the reader report; would need owner-only storage/public projection and a product decision. Not required for C or E |
| automatic profile-based learning histories or Recall-informed quiz batches | larger privacy/data-model choice; no new demand or benefit evidence in this audit |
| rewrite all stale docs | not a stage. Correct material present-tense claims when touching their owner: e.g. library's deletion UI and historical filesystem prose, reader-profile's old multi-user statement, and Q11's now-shipped image hosting. Preserve dated quotes/history |

## Overall architectural judgement

The approach is sound: one Postgres store, immutable/fenced publication, stable block IDs, a shared
hierarchy, URL-owned viewing state, owner/visitor capability boundaries and streaming endpoints.
The productive direction is to finish and exercise those seams. The strongest remaining risks are
at joins: opening reads versus writes, controller lifetime versus failure containment, streamed text
versus durable completion, and route completion versus lock/spend lifetime.

There is no evidence here for framework replacement, another mode registry, a second store, a new
job scheduler inside the reader, or a broad rewrite. The large PDF and retention jobs remain named
and bounded so they can be weighed separately. A useful first delivery can stop after the initial
four clusters and P's study preparation, leaving a safer, less interruptive reader and a way to
choose the next product work.

## Audit completion and review

The focused Sol review of A and the two new postmortems is preserved in
[round one](260908f-prioritised-spideryarn-codebase-improvements-races-review-sol.md) and
[the correction check](260908f-prioritised-spideryarn-codebase-improvements-races-review-sol-2.md).
Its five points are accounted for: Knip's continued-but-degraded findings are described accurately;
the diagnostic commit hash is fixed; Greg's product choice is explicitly pending; timeout ordering
and page-reload recovery are explicit; and silent hook-level `ask` refusal is forbidden. Round two
accepted four and identified one remaining “exits while loading” phrase; that phrase was replaced
with the reviewer's exact narrower meaning. No application code was built or reviewed as a fix.

The [full Sol review](260908f-prioritised-spideryarn-codebase-improvements-review-sol.md) returned
exit 0 and an answer with **no established P0/P1**. Its candidate changed during review; the report
records its last snapshot, not a claim to have reviewed every final byte. The primary checked its
five findings against the source and revised the plan as follows:

| Full-review ID | Disposition and check |
|---|---|
| F1 | Accepted. L now preserves the shipped status-class agreement guard and its negative controls; only a bounded unknown-throw investigation remains, conditional on a realistic red witness. |
| F2 | Accepted. O follows Greg's existing per-article, step-start sweep decision. The authoritative home stays `cron-scheduler.md`; I only repairs its obsolete pointer. O states the delete-time protection race and actual affected-row count explicitly. |
| F3 | Accepted. P's protocol preparation joins the first batch and precedes E/F/M; recruitment can follow later. Both table and narrative say so. |
| F4 | Accepted. The prompt's appended final manifest names all eight deliverables. They land together; final link validation is repeated with only that manifest over tracked HEAD. |
| F5 | Accepted on evidence labels: all sixteen rows now use the defined states. The reported duplicate Stripe row was not present in the final candidate; exactly one remains. |

These are author-verified corrections to P2/P3 findings, not a further independent review verdict.

- [x] Pulled `origin/dev` before the product audit; baseline recorded.
- [x] Product scope clarified; orchestrator/fleet excluded.
- [x] Parallel nominations checked against current code and prior work; stale/overbroad claims removed.
- [x] Product-only clone/complexity counts collected; failed Knip run recorded as failed.
- [x] Independent Sol race verification incorporated, including the false comment-stream path and
  the simpler submit-gating product option.
- [x] Sol plan review received and findings resolved as recorded above.
- [x] Document links and validation recorded: 16 tests across doc-links and raw-NUL guards pass;
  typecheck passes; full gate blocked.
- Landing: the resulting candidate commit is recorded in the full review artifact; the final handoff
  reports the push to `dev`.

Validation so far: `npm test` was attempted and stopped before collection because the sandbox
refused local Postgres (`connect EPERM 127.0.0.1:54362`); this is **not a passing suite**.
`npm run typecheck` hit the sandbox's `tsx` IPC restriction; running the same script with
`node --import tsx scripts/typecheck.ts` passed all four projects and covered 1,666 source files.
`npm run check` was also attempted and stopped at the same IPC restriction before its gates ran.
These commands include the repo's non-product projects because the existing gate is repo-wide.
The final targeted document run passed **2 files / 16 tests**. Its first raw-NUL attempt could not
spawn `git ls-files` inside the sandbox; rerunning those two unit files outside it passed.
No application code was changed by this audit.

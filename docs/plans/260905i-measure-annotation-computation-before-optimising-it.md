# Measure annotation computation before optimising it

Status as of 2026-09-06: **done, and on `dev`.** Measured, optimised, verified in a real browser,
reviewed by GPT Sol at every stage. Stage 1b was not needed. The headline, because it is the part
worth carrying away: the annotation pipeline was over its budget by 3–4× and is now ~40× cheaper per
gesture, and that moved end-to-end time by about 6% — annotation was only 10–14% of the gesture, and
the rest is this review's A8.
Source baseline
`6eecb377f24d92446086a006d5b3103daae40aef` (branch `worktree-a7-annotation-measure`).

This is item **A7** of
[the main-app architecture review](260905e-main-app-architecture-review.md#a7-reduce-annotation-computation-before-changing-the-document-renderer),
and its checklist is that document's *Stage: Optimise annotation inputs, if measurements warrant
it*. That stage is the authority; this plan is how it gets run.

## The job, in one paragraph

**It is a measurement job first.** Two loops in
[`TableView.tsx`](../../src/web/TableView.tsx) are proved from source and their latency is not
measured: `marksByBlock` takes `openComment` and `openChat` in its dependency list, so opening or
closing a dialog re-parses one block's HTML per stored comment and per anchored chat; and
`proseHtml` loops every block in the article whenever `marksByBlock`'s identity changes, calling
`annotateHtml` — a parse, a `TreeWalker` and a re-serialisation — on every block that carries any
mark. The existing `proseCache` keeps `{ __html }` object identity so React does not *rewrite* the
DOM for unchanged output, and that is already a large, measured win
([performance.md § Scrolling rebuilt the whole article](../project/performance.md#scrolling-rebuilt-the-whole-article-2026-09-03));
it does not avoid *computing* that output first. That gap is the whole subject.

**Closing this as deferred, with numbers, is a good outcome** and the review says so. What is not
acceptable is closing it either way without numbers.

## What is already known, so this does not rediscover it

- [performance.md § Still open, ranked](../project/performance.md#still-open-ranked-with-citations)
  item 1 already states the mechanism, and the source confirms it exactly:
  [`useComments.ts`](../../src/web/useComments.ts) § the `delta` branch calls
  `put({ ...rest, id, status: "pending", answer: text })` **on every streamed token**, so the
  comment object and the `comments` array are both replaced while `blockId`, `quote` and `start`
  are untouched. `useComments` is owned by `Reader`, so each delta re-resolves every anchor and
  rebuilds the whole HTML map. Only the DOM-*writing* half was fixed on 2026-09-03. This job
  supplies the missing number for the computing half, and this is the suspected worst case.
- [`search-hits.ts`](../../src/web/search-hits.ts) § `pages` already holds a `renderedText` cache in
  a `WeakMap` keyed on the `blocks` **array identity**, with the argument for why that key is right
  (nothing mutates a blocks array in place, so a surviving identity guarantees the html survived).
  It is module-private, so `marksByBlock` and `termMarks` each parse the same HTML again. **But it
  is eager** — `page()` runs `blocks.map(renderedText)` — and comments and terms are sparse, so
  sharing it naively would turn a five-block parse into a 2,046-block one. See Stage 2 step 1.
- [`termMarks`](../../src/web/annotate.ts) already restricts its scan to the blocks the server says
  contain a term, and `openTerm` is already kept out of the scan's inputs. The glossary *press* path
  is not the suspect.
- The recent length work ([260905d](260905d-mode-switching-is-sluggish-on-a-very-long-article.md))
  established that **length is the axis that hides quadratics here**.

### The local corpus, surveyed 2026-09-05 — and why the workload is the hard part

Read-only SQL against the local Supabase (`127.0.0.1:54362`, schema `spideryarn`), plus an inventory
of the committed fixture corpus. A dated example, not a durable fact:

| slug | blocks | comments | anchored chats | glossary entries |
|---|---:|---:|---:|---:|
| `evaldeepen-…-book` | 2,569 | 0 | 0 | none |
| `m1-kuhn-spya-a2zrjb` | 2,046 | 0 | 0 | none |
| `replication-crisis-spya-hrjamq` | 551 | 5 | 0 | 20 |
| `antikythera-mechanism-spya-zhxrzm` | 357 | 0 | 0 | none |

**The two longest local articles carry no annotation inputs at all**, so a browser run against
either would exercise no marks and would report a comfortable number for the wrong reason.
`replication-crisis` (551 blocks, 5 comments, 20 glossary entries) is the only local article with both real length and real annotation
inputs, and 551 blocks is the article every 2026-09-03 measurement used.

The committed corpus under `tests/fixtures/data-root/data/` is smaller still: largest glossary is
19 entries over 42 distinct blocks (`noema-mythology-of-conscious-ai`, 141 blocks, 11 `<figure>`),
and the only stored-comment fixture is `writes/comments.json` — three comments, one deliberately
anchored to a non-existent block, so **two** resolvable anchors. That does not satisfy the parent
checklist's "many comments and overlapping glossary/search marks". So if the real 551-block
article does not settle the question, a heavier workload has to be made rather than found — which is
Stage 1b, and deliberately not built unless it is needed.

### The baseline gesture cost, measured 2026-09-05 — end-to-end, not yet attributed

Playwright against system Chrome on the Hetzner box, **`npm run dev` Vite dev server on port 5276
from this worktree**, `SPIDERYARN_STORE=postgres`, signed in through a local magic link. Click to
next painted frame (two nested `requestAnimationFrame`s), five repeats after discarding the first.

Population first, because a timing over no marks means nothing.
`replication-crisis-spya-hrjamq`: 551 `tr[data-block]` rows, 20 distinct glossary terms (177 raw
`<mark>`s), 5 distinct comments (8 raw), 20,347 nodes. `scaling-hypothesis`: 186 rows, **0** terms,
5 distinct comments, 5,656 nodes.

| gesture | 551 blocks (min/median/max) | 186 blocks (median) |
|---|---|---:|
| open a comment | 746 / **948** / 1035 ms | 335 ms |
| close a comment | 726 / **741** / 871 ms | 262 ms |
| press a glossary term | 832 / **927** / 1017 ms | no glossary on that article |
| one keystroke in the find box | 8.8 / **12.4** / 20.0 ms | 13.4 ms |
| hover across two prose rows | 8.2 / **13.6** / 57.4 ms | 14.1 ms |

**Three things this says, and one it does not.** Opening a comment and pressing a term are far past
"instant" and scale with article length — 3.0× the blocks for ~2.8× the cost — while hover and a
keystroke stay flat regardless of length, which is what makes the two slow ones look like an
O(article) cost rather than dialog-rendering cost. The flat controls also prove the harness and the
page were live, so the fast numbers are real fast numbers. What it does **not** say is that
annotation is the cause: `getBoundingClientRect` was 29.9% of script after the last round of fixes
([performance.md § Clicking](../project/performance.md#clicking-2026-09-05-and-everything-above-this-line-is-about-scrolling)),
and the dialog and the panel do their own work. Attributing this is Stage 1a's job.

**And it is a development-only baseline, expected to be inflated** — not, strictly, an upper
bound, since StrictMode and unbundled modules do not put a mathematical ceiling on production
scheduling and browser work (Sol F13). `main.tsx` wraps the app in `<StrictMode>` unconditionally
and `npm run dev` serves unbundled modules through `@react-refresh`. The production-build
measurement is the authoritative one and is what the decision rule is applied to.

Two corrections to the corpus survey above, established independently against Postgres:
`replication-crisis-spya-hrjamq` is owned by `referee-test-260901@example.com`, not
`dev-admin@spideryarn.local` — signing in as the wrong owner gets a 404 that looks like a fast page
— and `scaling-hypothesis` **does** carry 5 stored comments, though still no glossary.

## Decision rule, written before the measurement

Recorded up front so the answer cannot be chosen after seeing the numbers. Revised after GPT Sol F3:
16ms is a whole 60Hz frame, not one subsystem's budget, and a per-delta cutoff ignores cadence.

Every gesture is reported as **two** numbers: end-to-end action-to-second-painted-frame, and
**annotation's attributable share** — time accumulated inside `marksByBlock` and `proseHtml`,
including their leaf calls. The rule is applied to the attributable share, with the end-to-end
number reported beside it so a large share of a trivial total cannot masquerade as a problem.

**The statistic is the median of at least five warmed repetitions**, the first discarded — the same
shape `measure-cpu.ts` uses, and settled here rather than chosen after the fact (Sol F3). A
conspicuous maximum is investigated and reported, never silently dropped.

**What Stage 1a actually ran was five repetitions *including* the discarded first — four warmed, one
short of this rule** (Sol F19). Recorded rather than quietly reconciled. It does not reverse the
verdict, which cleared the threshold by 3–4×, but it is the sort of gap that becomes a habit if the
rule is silently relaxed to fit the run. Stage 3's A/B takes six.

**Optimise** if, on the largest workload measured, either holds:

- a discrete gesture (open/close a comment, press a term, one keystroke in the find box) spends
  **≥ 8ms** of attributable annotation time at the median — half a 60Hz frame, which is as much as
  one subsystem may take before it is the reason a frame is missed; or
- during a streamed comment answer, annotation occupies **≥ 10% of the main thread**, or the
  **worst single delta** costs ≥ 16ms.

  **Duty cycle is defined as** total attributable annotation ms divided by wall time from the first
  state-changing delta through the final painted frame (Sol F10). React batches deltas, so the
  denominator is wall time and the numerator is the sum over however many renders actually
  happened — not per-delta arithmetic.

An earlier draft added "≥ 30% of an end-to-end total over 50ms". It is cut: 30% of anything over
50ms is over 15ms, which the 8ms clause has already caught, so it decided nothing and read as a
second opinion (Sol F3).

**Defer** only when the workload that stayed below the thresholds was **the heavy one** — Stage 1b's
seeded article, or Stage 1a if 1a already crossed and made 1b unnecessary. A low number on a light
workload is not a defer; see Stage 1a. Where the heavy workload is measurably under budget, defer
**and write the number down**, because the mechanism is understood and the number tells the next
person when to revisit.

Counts alone never decide this. Counts say what the work *is*; the attributable timing says whether
it matters. A scalar microbenchmark (average per-call cost times a call count) is **diagnostic
only** and never the number the rule is applied to: `annotateHtml`'s cost varies with HTML size,
text-node count, mark count and overlap, and an average destroys that distribution.

## Anti-goals

Taken from the review, and none of them is in scope:

- **No prose virtualisation and no replacing the HTML table.** `rowSpan`, native text selection,
  find-in-page, stable block-id anchors, accessibility, note navigation and measured scroll
  geometry all depend on the document as it is.
- **No observable store per paragraph.** Plain typed maps owned by the renderer.
- **No module-global cache keyed only by `BlockId`** — stable identity is not immutable content.
- **No keying on a streamed answer body.** A delta that leaves the anchor alone must cost nothing.
- Not moving `useComments` ownership below `Reader` (§ Still open item 1's own fix). That is a
  different change with a documented delete-race hazard; this job measures the cost it causes and
  may make it cheap, but does not move it.
- No repo-wide reformatting, no renames, no restructuring `src/web/styles.css`.

## Stages

### Stage 1a — attribute the 948ms, and nothing else

**The smallest experiment that can decide this**, and it comes first because the baseline above
already establishes that the gesture is slow; what is unknown is *which subsystem* (Sol F4, and its
"cheaper decisive first experiment").

1. **Inclusive timers around `marksByBlock` and `proseHtml` only**, plus cheap leaf counters. Leaf
   *timers* are a separate diagnostic mode and are **off during the decision run**: `proseHtml`
   calls `addZoomHandles` once per block, so on 551 blocks leaf timing would add over a thousand
   clock reads inside the very interval being measured, against an 8ms threshold (Sol F11).
2. **Production build** — `npm run build`, then `vite preview`, per
   [performance.md](../project/performance.md#what-we-still-do-not-know). Never the dev server for a
   decision number: `main.tsx` wraps the app in `<StrictMode>` unconditionally.
3. **On `replication-crisis-spya-hrjamq`** (551 blocks, 5 comments, 20 glossary entries, owner
   `referee-test-260901@example.com` — sign in as the *wrong* owner and the 404 looks like a very
   fast page), with `scaling-hypothesis` (186 blocks) as the length control.
4. **The glossary press first**, because it is the clean probe: `openTerm` re-runs `proseHtml`
   across the article and provably re-runs neither `marksByBlock` nor `termMarksByBlock`. Then
   comment open and close, which add anchor resolution. Then a streamed answer.

**Stage 1a can end the job in one direction only.** If the glossary press's memo time is near its
927ms total, A7 is **established**, Stage 1b is skipped and Stage 2 starts. If every 1a probe comes
in under the threshold, that is **not** a defer — it is only a finding that 551 blocks with 20 terms
is not heavy enough to convict, and Stage 1b becomes **mandatory**. Defer is unavailable until 1b
has run and also come in under threshold.

The asymmetry is the whole guard (Sol F4, third pass). An early draft said 1a "alone can end the
job" in either direction, which reopened exactly the false-deferral path two rounds of review had
closed: a comfortable number on a light workload reads identically to a subsystem that is genuinely
cheap. An *optimise* verdict is safe to take early because the cost has been demonstrated; a
*defer* verdict is a claim about workloads that were never run.

If 1a comes in low, that is still worth writing down: the gap between the memo time and the ~927ms
total points at commit, layout and geometry, which is **A8's ground, not this job's**, and the
comment probe separately says whether anchor resolution is worth anything on its own.

#### What the memo timer does and does not attribute

Written down because the number will be quoted later. **Counted:** detached-element `innerHTML`
parsing, `TreeWalker` traversal, re-serialisation, array construction, the per-block loop and
`addZoomHandles`. **Not counted:** React reconciliation and commit below the memo, the live DOM's
`innerHTML` assignment and its parse, `MutationObserver` delivery, and style, layout, paint and the
geometry reads that follow. The end-to-end number beside it is what captures those. So the memo
number is *annotation computation*, and it must be called that and not "the cost of opening a
comment".

Timing the whole `proseHtml` loop slightly over-attributes figure-handle scanning to annotation.
That is deliberate: it is work annotation invalidation causally re-runs, and Stage 2 would avoid it,
so it is part of A7's preventable cost.

### Stage 1a result, 2026-09-06 — **optimise**, and Stage 1b is not needed

Production build (`npm run build`, bundle `index-YNLoFL5N.js`, hash checked against the served
page), `vite preview` on port 5290, `SPIDERYARN_STORE=postgres`, Playwright against system Chrome on
the Hetzner box. Five repeats per gesture, first discarded, mode `"counts"`. Population confirmed
first: 551 `tr[data-block]`, 177 raw term marks (20 distinct), 8 raw comment marks (5 distinct),
20,346 nodes.

**Re-runnable**, which the original throwaway harness was not (Sol F19) —
[`scripts/measure-annotation.ts`](../../scripts/measure-annotation.ts) is that harness promoted, and
it prints the raw per-repetition vectors, prints the population counts first, and refuses to report
at all when `window.__perf` is missing or the page rendered no blocks:

```bash
npm run build && SPIDERYARN_STORE=postgres npx vite preview --port 5290 --strictPort
npx tsx scripts/measure-annotation.ts --slug replication-crisis-spya-hrjamq \
  --url http://localhost:5290 --local-sign-in --sign-in-via http://localhost:5274/ \
  --email referee-test-260901@example.com --repeats 6
```

| gesture, 551 blocks | end-to-end med | **attributable** med | verdict at 8ms |
|---|---:|---:|---|
| press a glossary term | 285 ms | **29.9 ms** | over by 3.7× |
| open a comment | 232 ms | **30.4 ms** | over by 3.8× |
| close a comment | 211 ms | **24.9 ms** | over by 3.1× |
| one keystroke in the find box | 33 ms | 0.00 ms | — |
| hover across two rows | 67 ms | 0.00 ms | — |

Length control, `scaling-hypothesis` at 186 blocks: comment open **5.4 ms** attributable against
30.4 ms — 3.0× the blocks for ~5.6× the cost.

**Stage 1a convicts, so Stage 1b is skipped**, exactly as the asymmetry rule allows: an *optimise*
verdict may land on 1a alone because the cost has been demonstrated, where a *defer* could not.

**And the honest proportion, which is not what a keen reader would want it to be.** Annotation is
only **10–14% of the gesture** — the three medians are 10.5%, 13.1% and 11.8%, and they are ratios
of separate medians rather than paired per-run shares, so read them as a band and not a figure.

**What the other ~86% is, the instrument does not say** (Sol F16). All it establishes is that the
time falls **outside these two memos**. It likely includes React reconciliation and commit, the live
DOM's own `innerHTML` parse, style, layout, paint and the geometry reads — and the dialog's and the
panel's own work, which is nobody's "ground" in this review. Much of it is probably A8's, and an
earlier draft of this section simply asserted that; it is not established here and the wording is
now weaker on purpose. A7 is real, it is over budget, and it is not on its own the reason the
interface feels sluggish. Both halves of that go in performance.md, because a write-up that quietly
implied it fixed the 948ms would send the next person to the wrong room.

The production numbers are also ~3× below the dev-server baseline in § The baseline gesture cost
(285ms against 927ms), which is what `<StrictMode>` and unbundled modules are worth here, and why
the plan refused to decide on a dev-server number.

#### Where the time actually goes, and how it reshapes Stage 2

Diagnostic run, `"full"` mode, glossary press, **numbers perturbed upward by the leaf clocks and
therefore not decisive** — and the *split* is perturbed too, in a direction that has to be named
(Sol F14). Each leaf sample costs two clock reads, so the diagnostic adds roughly **1,102** reads
around 551 `addZoomHandles` calls against only **192** around 96 `annotateHtml` calls. Repeating the
run does not remove a systematic bias, so `addZoomHandles`' share is **overstated by an unmeasured
amount** and the 55/40 split below is a perturbed estimate, not a trustworthy division.

**The call counts are not perturbed, and they carry the argument on their own**: 551 calls to
service a change touching one or two blocks is avoidable work whatever each one costs.

| inside `proseHtml` | calls | ~ms | share |
|---|---:|---:|---:|
| `annotateHtml` | 96 | 20.6 | ~55% |
| `addZoomHandles` | **551** | 15.3 | ~40% |
| `renderedText` / `resolveMark` | 0 / 0 | 0 | — |

On comment open the leaves are `renderedText` **5**, `resolveMark` **5**, `annotateHtml` 96,
`addZoomHandles` **551**.

Three things follow, and they change the plan:

1. **`addZoomHandles` runs on all 551 blocks and is ~40% of the cost**, including the ~455 blocks
   that carry no mark at all and whose html cannot have changed. That is pure waste and per-block
   reuse deletes all of it.
2. **`annotateHtml` runs on all 96 marked blocks** when a term press changes the marks of one or
   two. Per-block reuse deletes almost all of that too.
3. **Anchor resolution is not the cost on this workload** — five parses and five searches. So the
   shared rendered-text cache that was Stage 2 step 1 is **deferred, not disproved** (Sol F15). It
   would save five parses here, and the anchor-stability work below removes even those; deferring it
   also leaves `search-hits.ts` § `pages` alone, which is one fewer file touched in a tree a dozen
   agents are working in.

   **What five anchors cannot establish**: that the cache is unwarranted for a reader with a hundred
   comments, or for the initial render, or for a genuine anchor change — none of which
   anchor-stability covers. This is a simplest-first deferral on one article's evidence, and the
   trigger to revisit it is a denser workload actually being measured, not an argument.

**Streaming was not measured on the path the plan named as the worst case.** `useComments`' own
`send()` streaming is reachable only by retrying or deepening an already-answered comment, and no
comment on this article had an answer. What was measured instead is the path a fresh "ask" gesture
actually takes today — a chat thread — and it is cheap: one render, 37.3ms attributable over a
23,008ms wall interval, **0.2% duty cycle**, because chat deltas do not touch `marksByBlock`'s
dependencies at all. So the comment-streaming worst case is still **unmeasured**, not disproved. It
does not change the verdict, which A and B already settled, and the Stage 2 work removes it by
construction: a body-only delta changes no block's marks, so every block reuses its output.

**A side effect to disclose.** Exercising the streaming gesture created real comments in the *local*
database: `replication-crisis-spya-hrjamq` went from 5 comments to **17**, and gained 2 chat threads.
Local only, additive, nothing overwritten — but it means the Stage 1a numbers above and any later
run are no longer over the same workload, which is why Stage 3 measures before and after in one
session rather than against this table.

### Stage 1b — only if Stage 1a would otherwise defer

**Conditional, and skipped entirely if Stage 1a decides.** This is where the earlier draft's
general-purpose clone-and-remap framework lived; it is not built unless the real measurement
demands it (Sol F4), because 551 blocks with 20 terms may simply not be a heavy enough workload to
tell us about a reader with a dense glossary on a 2,000-block article.

If Stage 1a lands under the threshold, seed **one** long local article with dense, overlapping
comment and glossary marks — local Postgres only, additive, never the remote — and time the same
gestures on it in the same production build. Say plainly in the write-up that the workload was
seeded. If *that* also lands under the threshold, A7 defers with two workloads' worth of evidence.

**The seed has acceptance criteria, checked before anything is timed** (Sol F4), because "dense" and
"overlapping" are satisfiable by a workload thin enough to reproduce the very false defer this stage
exists to prevent:

| | at least |
|---|---:|
| blocks in the article | 2,000 |
| anchored comments, on distinct blocks | 100 |
| distinct prose blocks carrying a glossary occurrence | 1,000 |
| blocks where a comment range and a glossary range genuinely intersect | 100 |

These are **rendered, working** counts, verified in the loaded page — `tr[data-block]`,
resolvable anchors that `resolveMark` actually finds, blocks that `termMarks` actually marked, and
real range intersections — not the counts that were inserted. A seeded row whose anchor no longer
resolves is not a comment for this purpose. A seed that fails these is a broken fixture and is
fixed before it is timed, never timed and caveated.

`m1-kuhn-spya-a2zrjb` (2,046 blocks) is the obvious host: it is long and carries nothing, so
seeding it disturbs no existing state.

Seeding one article is a `INSERT` and a glossary row. It is much less machinery than a clone helper
that has to remap ids in `Block.id`, in the root element id inside `block.html`, in tree nodes and
ranges, in note references and internal links, and in glossary occurrence lists — and get every one
of them right, because a clone whose glossary occurrences still name the originals leaves every
clone unmarked, takes `annotateHtml`'s fast path, and **biases the whole job toward defer**.

### Stage 1c — the regression bench

A vitest file mounting the real `TableView` and driving **prop transitions** through `act()`,
modelled on [`tests/prose-not-rebuilt.test.tsx`](../../tests/prose-not-rebuilt.test.tsx) (including
its `perf.js` mock and its `MutationObserver` over `.prose`).

**It is a prop-transition bench, not a gesture bench** (Sol F5). `TableView` has no find box, no
glossary panel, does not own the comment stream and has no scroll prop. It models: `openComment` /
`openChat` changing; a new `comments` array whose bodies grew but whose anchors did not (the
streaming delta); a new `hitMarks` map; `openTerm` changing; `terms` changing; and a prop the prose
does not depend on. It **proves the memos' behaviour**; it does not prove the real gesture changes
those props, and **it never supplies a number the decision rule is applied to**. Its assertions are
counts and zero/nonzero invariants, never milliseconds.

Its real purpose is Stage 2's safety net, so if the job defers it still earns its place: it pins
today's behaviour so a future change cannot quietly make this worse.

**What stops a zero meaning nothing** ([silent-success.md](../reusable/silent-success.md)): every
zero-work assertion is paired, in the same test, with a changed-input control that must move *every
counter being trusted*, and the rendered row count is asserted equal to the block count — a
component that threw also mutates nothing. In the browser, `window.__perf` must be shown to exist
and a nonzero control taken before any zero is believed.

**Done when:** the numbers exist, are appended to [performance.md](../project/performance.md) — that
file is shared with the A4 job, so append, do not restructure — and the decision rule has been
applied in writing.
### Stage 2 — optimise

**Reached**: Stage 1a convicted. Two steps, not the three the plan had before — the shared
rendered-text cache is cut for the reason in § Where the time actually goes.

1. **Stable anchor resolution, so that step 2 can hit.** `marksByBlock` today takes `openComment`
   and `openChat`, and rebuilds its map and every per-block array whenever either changes — so
   *every* block's marks change identity when the reader opens one dialog. Split it: resolution
   depends on the comments and chats alone, keyed on the **semantic anchor inputs**
   `(id, blockId, quote, start)` plus the block-content generation — **not** on the comment object
   or the array, because [`useComments.ts`](../../src/web/useComments.ts) § the `delta` branch
   replaces both on every streamed token while the anchor is untouched (Sol F1). When no anchor was
   added, removed or altered, hand back **the previous map and the previous per-block arrays**,
   unchanged, by identity. Then apply `open` in a second cheap pass that touches only the blocks
   holding the previously and newly open ids.

   **Its value is not the five parses it saves.** It is that per-block array identity survives a
   selection change, which is the precondition for step 2 hitting at all.

   **Acceptance:** a body-only streamed delta produces zero `resolveMark`, zero `renderedText`,
   zero `annotateHtml`, zero `addZoomHandles` and zero prose mutations.

2. **Per-block input reuse in `proseHtml`** — where the measured cost is: 551 `addZoomHandles` calls
   and 96 `annotateHtml` calls to service a change that touches one or two blocks. Keep each
   block's inputs beside its `{ __html }` output in the existing `proseCache` ref, and when they are
   all unchanged, reuse the output and call neither `annotateHtml` nor `addZoomHandles`.

   **The equality contract, because the naive version misses everywhere** (Sol F7):

   - The key is the **source** per-block arrays — comment/chat marks, term marks, hit marks — plus
     **only the selected flags relevant to that block**: whether it holds the previously or newly
     open term, comment, chat or hit. `openTerm` is global, so keying on it directly would
     invalidate every block on every press and buy nothing.
   - The composite `marks` array built inside the loop is freshly allocated every pass and **cannot
     be its own key**.
   - [`hitMarks()`](../../src/web/search-hits.ts) rebuilds every per-block array and bakes `open`
     into fresh marks whenever `openKey` changes, so its arrays must first be made **independent of
     `openKey`**, with the selected flag applied per block afterwards — the same split `openTerm`
     already has from `termMarksByBlock`, whose docstring gives the argument.
   - A block is always recomputed from **all** its mark kinds together, so overlapping comment,
     term and hit ranges keep their one shared `<mark>` rather than nesting.
   - Rebuilt into a fresh map each run, exactly as `proseCache` already is, so a removed block
     evicts itself and nothing is unbounded. **Never keyed on `BlockId` alone** — stable identity is
     not immutable content.

**Tests before code, red first.** Stage 1c's bench becomes the regression test, tightened from
"this many parses" to "no parses for an unchanged anchor". Plus the correctness set: changed content
under the same block id; **a changed glossary entry — new forms and new occurrence blocks while
`article.blocks` is unchanged — where the old underline goes, the new one appears, an overlapping
comment or hit still shares one `<mark>`, and only the affected prose nodes change** (Sol F8);
removed blocks; article and access changes; overlapping marks; figures; note-return navigation.

### Stage 2 result, 2026-09-06 — both steps landed, tests red first

Two files of source and two of tests. `npm run typecheck` clean; `npx biome check` on the four
files returns exactly the baseline HEAD already had (two errors and one complexity info, all
pre-existing).

**Step 1 — [`TableView.tsx`](../../src/web/TableView.tsx) § `marksByBlock`.** One memo still, with
the same dependency list, but the body is now three module-level functions and a ref:
`anchorKey(comments, chats)` reduces the inputs to `(kind, id, blockId, start, quote)` per anchor —
so a streamed delta, which replaces every comment object and the array, produces the **same key**;
`resolveAnchors` runs only when that key or `byId` changes; and `applyOpen` puts the ring on
afterwards, handing back the previous per-block arrays **by identity** for every block that neither
lost nor gained it. When the anchors and the selection are both unchanged the memo returns the
**same map**, so `proseHtml` does not even re-run.

**Step 2 — `proseHtml`.** `proseCache` now holds a `ProseEntry` per block: the html, the three
source mark arrays, the pressed term *if this block has it*, and the `{ __html }` object. A block
whose inputs all match is passed through with neither `annotateHtml` nor `addZoomHandles` called.
`NO_MARKS` — one shared empty array — is what makes the unmarked majority compare equal at all; a
`?? []` literal would have missed on every one of them.

**And [`search-hits.ts`](../../src/web/search-hits.ts) § `hitMarks` had to be split first**, exactly
as F7 said: its per-block arrays are now built without `openKey` and cached in a `WeakMap` on the
`Found[]` identity (`unpressed`, the same key and argument as `pages`), with the pressed flag
applied per block on top. Without that, step 2's key would have missed on every block with a hit
whenever the reader pressed a result. `App.tsx` is untouched — the signature did not change.

**[`tests/annotation-reuse.test.tsx`](../../tests/annotation-reuse.test.tsx)**, nine tests, written
before the code and **watched fail**: 4 red / 5 passing beforehand, 9 green after. The four that
were red are the body-only delta (`renderedText` 2, `resolveMark` 2, `annotateHtml` 1,
`addZoomHandles` 95 → all 0), selecting a different comment and pressing a different term (95
`addZoomHandles` → 2), and an unrelated prop re-annotating a block (1 → 0). The five that passed
throughout are the changed-input controls that make those zeroes mean anything — a new comment, a
changed hit, a changed block html under a stable id, a changed glossary entry, a removed block and
an article swap — plus the shared-`<mark>` and row-count guards, which every test carries.

One existing assertion had to move: `tests/annotation-cost.test.ts` charged the two memos by
re-rendering with a fresh-but-identical `comments` array, which is precisely the shape that now
costs nothing. It takes a fresh mount instead, and the "`addZoomHandles` runs on every block" claim
is now made about a first paint, which is still true.

### Stage 3 — verify in a browser, document, land

**Measure before and after in one session, back to back** (Sol F12), rather than comparing against
the Stage 1a table. Build the pre-Stage-2 commit, measure; build the post-Stage-2 commit, measure;
same slug, same gestures, same warmed repetitions, same browser session, both populations reported.

**A/B in one session rather than against the recorded numbers, for a specific reason**: exercising
the streaming gesture in Stage 1a wrote real comments into the local database, so that article now
carries 17 comments where the Stage 1a numbers were taken over 5. The workload moved under the
measurement. Comparing today's build against yesterday's table would be comparing two different
articles and calling the difference a fix — and on a box a dozen agents share, the workload can move
again between now and then. Two builds, one session, one workload is the only version of this
comparison that cannot be quietly wrong.

Without it, Stage 2 can satisfy every count regression in the bench and still deliver a reader
nothing, which is the failure mode this whole page is about.

Then a browser subagent on the built app: comment open/close, a search, a glossary press, a
streaming answer, note navigation and figure enlarge all still work; prose text selection still
works; the DOM identity property still holds. Append the result to
[performance.md](../project/performance.md); update the A7 checkboxes in
[260905e](260905e-main-app-architecture-review.md) and nothing else in that file. Full gates, push
to `dev`.

## What is left, and deliberately

- **A genuine change to any source still rebuilds every array of that kind.** One moved anchor
  rebuilds every resolved array, a new `terms` rebuilds every term array, a new `Found[]` rebuilds
  every base hit array. So *writing* a comment still re-annotates every block carrying a comment or
  a chat — the html usually comes back identical and React is handed the object it already has, but
  the parse is paid. The gestures made cheap are the ones that **repeat**: selection changes and
  streamed deltas. Reconciling per anchor rather than rebuilding wholesale is the next step if a
  workload ever asks for it; nothing measured here does.
- **The comment-answer streaming path is untested against a real stream.** It is unreachable without
  seeding, so Stage 1a measured the chat path instead. Stage 2 removes the case by construction and
  there is a jsdom test for it, but no browser has driven it.
- **The shared rendered-text cache is deferred, not disproved** — see § Where the time actually
  goes. Five anchors decided it; a hundred-comment article might not.
- **`Block.html` and `Article.blocks` are still mutable types**, so `byId`'s identity key and
  `search-hits.ts`'s `pages`/`folds` WeakMaps remain sound by convention rather than by compiler.
  Making that a type reaches into the pipeline, the stores and the server, which is a sprawl this
  job declined.
- **The other ~85% of the gesture is untouched**, and it is where a reader's complaint actually
  lives. That is A8's ground: three passes still measure the whole article on every mode switch
  ([performance.md § What is left](../project/performance.md#what-is-left-and-it-is-a-design-decision-rather-than-a-patch)).

## Reviews

GPT Sol on this plan before any code, and at the end of every stage; two rounds each, then settled
here in writing.

### Round 1 on the plan — `260905i-plan-review-sol-r1.md`, verdict "do not proceed"

Nine findings, **all nine accepted**, no overrules. F1, F2, F4 and F8 were the blocking ones and all
four were right. Folded in above:

| ID | Sev | Finding | Where it landed |
|---|---|---|---|
| F1 | P1 | Splitting `openComment` out fixes selection, not streaming — a delta replaces the comment object too | Stage 2 step 2, keyed on semantic anchor inputs |
| F2 | P1 | `performance.now()` "around a gesture" measures an unspecified interval and cannot attribute time to annotation | § The wall clock: two measurements, end-to-end and attributable |
| F3 | P2 | 16ms is a whole frame, not a subsystem budget; a per-delta cutoff ignores cadence | § Decision rule rewritten |
| F4 | P1 | The fixture matrix omits the workload that decides the answer, and naive cloning leaves stale ids in `block.html`, tree ranges and glossary occurrences | § Workload cohorts and the clone helper |
| F5 | P2 | The bench cannot drive a find box, a glossary panel or a scroll — and StrictMode makes exact counts incomparable | § The bench: named a prop-transition bench, counts only |
| F6 | P2 | Sharing `search-hits.page()` would turn a sparse 5-block parse into an eager 2,046-block one | Stage 2 step 1, lazy per-block |
| F7 | P2 | `openTerm` is global and `hitMarks` allocates fresh — naive per-block keys would miss everywhere | Stage 2 step 3, equality contract stated |
| F8 | P1 | The parent acceptance requires a changed-glossary-entry regression; the plan had none | Stage 2 test set |
| F9 | P2 | Unconditional counters are permanent instrumentation and do not solve the browser's `?perf=1` problem anyway | § The instrument: off by default, enabled explicitly |

### Round 2 on the plan — `260905i-plan-review-sol-r2.md`, verdict "do not proceed"

Settled by ID: **F1, F2, F5, F6, F8, F9 settled.** F3, F4 and F7 came back still open, and three
new findings arrived. **All accepted; nothing overruled in either round.**

| ID | Sev | Finding | Where it landed |
|---|---|---|---|
| F4 | P1 | The synthetic cohorts got counts but no Chrome timing, so the plan could still defer without ever timing the workload the cohorts existed to protect | **The restructure.** Stage 1a attributes the real 551-block article first; Stage 1b seeds one heavier article and is built *only* if 1a would otherwise defer. The general clone-and-remap framework is cut |
| F3 | P2 | min/median/max reported but no statistic named as deciding; the 30% clause was arithmetically redundant | § Decision rule: median of five warmed repetitions, first discarded; 30% clause cut |
| F7 | P2 | Keying reuse on `hitMarks`' source arrays does not work, because `hitMarks()` rebuilds them all when `openKey` changes | Stage 2 step 3: make base hit arrays independent of `openKey`, then apply the flag per block |
| F10 | P2 | Accumulated totals cannot yield "worst single delta" or a duty cycle | Instrument records `{ n, ms, maxMs }`; duty cycle defined against wall time from first state-changing delta to final painted frame |
| F11 | P2 | Leaf timers add >1,000 clock reads inside the very interval being measured, against an 8ms threshold | Three instrument modes: off / counts (the decision run) / full (diagnostic) |
| F12 | P2 | Stage 3 never required re-running the production workload to prove the optimisation helped | Stage 3 now re-runs Stage 1a's exact workload and compares |
| F13 | P3 | "upper bound" overclaims what StrictMode and unbundled modules establish | Reworded to "development-only baseline, expected to be inflated" |

### The scoped F4 check — `260905i-plan-review-sol-f4.md`, verdict "F4 still open"

Discovery is closed, but F4 was an established P1 whose fix — the 1a/1b restructure — was not in the
round-two snapshot, so it got one narrowly scoped check of that fix alone, per
[engineering-manager.md § GPT Sol](../reusable/engineering-manager.md).

It came back still open, and it was right: the restructure said both "Stage 1a alone can end the
job" and "Stage 1b is mandatory when 1a is under threshold", which is a contradiction that resolves
in favour of the comfortable answer. It also noted that "dense" and "overlapping" are satisfiable by
a seed thin enough to reproduce the false defer.

**Accepted, not overruled**, so no escalation was needed. Three corrections applied: Stage 1a may
now end the job **only with an optimise verdict**; Stage 1b is mandatory before any defer; and the
seed has a table of objective, rendered-count acceptance criteria checked before anything is timed.
F4 is settled by the plan as it now stands.

**What the two rounds were worth, plainly:** the plan lost a clone-and-remap framework it did not
need, gained a first experiment that can end the job in one measurement, and had its central
optimisation (F1) corrected from one that would have fixed selection while leaving streaming — the
suspected worst case — exactly as slow as before.

### Stage 1a review — `260905i-stage1a-review-sol.md`, verdict "approve with P2 findings"

No established P0 or P1; the optimise verdict stands. Seven findings, and the reviewer established
three of them by **running mutations against an archive of the commit** rather than by reading it,
which is why F17 is the one that mattered.

| ID | Finding | Settled how |
|---|---|---|
| F17 | **The instrument's own test stayed green through three mutations that break the decisive timers** — memo start times replaced with `NO_CLOCK`, a real clock read added in `"counts"` mode, and `maxMs` replaced by the accumulated total | Fixed: the test now spies on `performance.now`, drives a scripted clock so an enabled memo must record an exact positive duration, and feeds unequal samples so a total cannot pass as a maximum. Each mutation was applied, seen red, and reverted |
| F18 | The snapshot's `mode` did not always describe its samples — `stop` kept nonzero counters under `mode: "off"`, and `"counts"` → `"full"` blended two kinds of sample under one label | Fixed: counters reset whenever the mode actually changes, so they always belong to the mode reported. The old "start does not reset" reasoning is superseded and the docstring says so |
| F19 | The measurement was a scratchpad harness, so the numbers could not be re-run or audited; and only medians were kept | Fixed: promoted to `scripts/measure-annotation.ts`, which prints raw per-repetition vectors and population counts and refuses to report when `window.__perf` is absent. The four-warmed-repetitions gap is recorded in § Decision rule rather than reconciled away |
| F14 | The `"full"` split is systematically biased toward `addZoomHandles` — 1,102 clock reads against 192 | Accepted: the split is now labelled a perturbed estimate, and the argument rests on the unperturbed call counts |
| F15 | Five anchors do not establish the rendered-text cache is generally unwarranted | Accepted: "deferred, not disproved", with what five anchors cannot show spelled out |
| F16 | The residual ~86% was assigned to A8; the instrument establishes only that it is outside the two memos | Accepted: reworded, and the guess is labelled a guess |
| F10 | `maxMs` is per-site, so summing two maxima may combine different renders and neither alone is the worst *combined* delta | **Remedy declined, finding accepted** — see below |

**The one overrule, and why.** F10 asks for a render identifier or a combined outer interval so the
"worst single streamed delta ≥ 16ms" clause can be evaluated numerically. **Not built.** Stage 2's
acceptance for the streaming case is *zero work for a body-only delta* — strictly stronger than any
millisecond threshold, and it needs no per-render correlation to check. Building a render-id
mechanism to evaluate a rule that Stage 2 makes moot is a moving part bought for nobody. The
limitation is real, so it is written into `annotation-cost.ts`: **`maxMs` is per-site, and the two
memo maxima may come from different renders — do not add them and call the result a delta.** If a
later job needs that number, this is the note that says what to build.

### Stage 3 result, 2026-09-06 — it works, and it does not make the gesture feel faster

Two builds, one browser session, one workload, as § Stage 3 requires. `c7835411` (instrument, no
optimisation) on port 5391 against `14253086` (optimised) on 5392, **bundle hashes checked distinct**
— `index-D9RIP3o6.js` and `index-DQQLlviO.js` — because performance.md records a day lost to
`vite preview` serving one bundle to two ports. Population identical on both: 551 rows, 177 term
marks (20 distinct), 17 comments, 20,352 nodes. Six repetitions, first discarded.

**The call counts are the evidence, and they are deterministic** — identical on every single
repetition on both builds, immune to the noise of a box a dozen agents share:

| comment close, per gesture | before | after |
|---|---:|---:|
| `addZoomHandles` | **551** | **1** |
| `annotateHtml` | **97** | **1** |
| `renderedText` | 18 | **0** |
| `resolveMark` | 18 | **0** |
| attributable, median | 34.6 ms | **0.80 ms** |

`renderedText` and `resolveMark` going to zero is Stage 2 step 1 working: a selection change moves no
anchor, so nothing is re-resolved. The rest is step 2.

**The glossary press proves the reuse is per-block rather than global.** Before, all six presses read
exactly 97/551 *whichever term was pressed*. After, the count tracks how many blocks that particular
term occurs in — 3, 24, 46, 38, 27, 11 — and never once sat at 97/551. Attributable median 22.8ms →
10.9ms, with every matched pair improving.

Controls: a find-box keystroke and a hover read 0.00ms attributable on both builds. **Those two
numbers are now unverified**, and the reason is the same bug class again: `input.value += "x"`
updates React's value tracker, so `onChange` very likely never fired, and hover was dispatched
without `pointerType: "mouse"`, the only kind `useHoverCard` acts on. Both were found while fixing
the detached-node bug and both are now driven properly. **What still stands is the conviction**,
which never rested on the controls: it rests on gestures whose counters moved by hundreds, on the
same page in the same session. But "the flat controls prove the page was live" was a weaker claim
than it read as — a gesture that never reaches the app is flat too.

**And the part that must not be buried: end-to-end barely moved.** Comment close 211.7ms → 198.6ms;
the glossary median actually rose, though that compares different terms on a shared box. This is
exactly what Stage 1a predicted — annotation was 10–14% of the gesture, this removes almost all of
that share, and it does not touch the other ~85%. **Nobody should read this as "opening a comment got
faster to the eye". It did not, measurably, on this box today.** What is gone is provably unnecessary
recomputation; what remains is A8's ground.

**Part 2, correctness in a real browser on the optimised build — all seven pass.** Comment marks
underline in the right place and `data-cmt-open` lands on exactly the clicked one; pressing a second
glossary term moves `data-term-open` off the first; a search marks 63 occurrences and one result
takes `data-hit-open`; **overlap was found naturally rather than seeded** — one
`<mark class="cmt term" data-comment="spya-tpgvdy" data-term="spya-vzgcap">`, a single element
carrying both, not nested; a 1,193-character prose selection round-trips exactly; a figure's ⤢ opens
the lightbox; and note navigation works on an article with 387 citation markers, jumping and setting
`data-came-from` for the return.

**One bug found, in the harness rather than the app**, and it is worth its paragraph because it is
the same class as everything else this job kept tripping over. The `comment-open` gesture grabbed the
`mark[data-comment]` element *before* clicking close — but opening and closing genuinely rewrites
that block's html, so the close detached the node already held, and the next dispatch hit a node that
was no longer in the document. It did nothing, cost nothing, and was recorded as a fast gesture. The
vector was `[25.6, 0, 22.4, 0, 35.3, 0]` **on both builds**, which is how it nearly passed for a
property of the code. Fixed, and the script now requires each gesture to declare an observable effect
so a no-op cannot be reported as a fast one.

### Stage 2 review — `260905i-stage2-review-sol.md`, verdict "accept"

No established P0 or P1, and the correctness audit is the substantive part: the reviewer enumerated
everything the injected prose html actually depends on — block html, comment/chat marks and their
resolved offsets and open flags, term marks and the per-block `openTerm`, search marks with their
offsets, strength, palette and open flags, and `addZoomHandles` as a pure function of the annotated
html — and found **all of them represented** in `ProseEntry`/`sameInputs`. It separately cleared
`anchorKey` against separator collisions (ids and block ids contain no newlines, and the quote length
disambiguates embedded ones), cleared `byId` identity for current producers, and cleared
`applyOpen(base, null, null) === base` as safe because every caller only reads or spreads.

**The findings that mattered were about the tests, not the code**, and they were found by mutation:

| ID | Sev | Finding | Settled |
|---|---|---|---|
| F20 | P2 | Deleting `start` from `anchorKey` left **all 9 tests green** — yet `start` is what says *which* occurrence of a repeated quote a comment is on, so losing it draws on the stale one | Regression added: repeated quote, comment moved by `start` alone, underline must move. Mutation seen red |
| F21 | P2 | Applying hits through a **second** `annotateHtml` pass left all 9 green, though comment + term + hit then produced nested `<mark>`s | Three-way overlap now guarded at the `TableView` composition seam, including a hit arriving last onto a block already through the reuse path. Mutation seen red |
| F22 | P2 | The identity caches' immutability was prose: mutating a `Found` in place returns stale offsets, and pushing into a returned array **permanently poisons** later results. No caller does either today | `readonly` types where it stays contained: `Found`'s own fields, `hitMarks`/`baseMarks`/`unpressed`, the private `Page`, and `TableView`'s mark arrays, `byId` and `hitMarks` prop — no edit needed in `App.tsx` or any test, and pinned by three `@ts-expect-error`s in `tests/search-hits.test.ts`. **Stopped at `Article.blocks` and `Block.html`**, which is where it leaves the client |
| F23 | P3 | `sameInputs`' docstring overstated producer identity preservation — true for selection and streaming, false when any source genuinely changes | Comment corrected |

**The two misses are the same shape as F17 one stage earlier**, and that is the pattern worth
naming: this job has now written three test suites, and a cross-family reviewer has found a mutation
that survives all of them **every time**. Writing the test first makes it fail for the reason you
expected; it does not make it fail for the reasons you did not think of. Mutating the finished code
is what finds those, and it has been worth doing every single time here.

## Log

- 2026-09-05 — plan written; local corpus surveyed; GPT Sol rounds 1 and 2 both returned "do not
  proceed", sixteen findings between them, all accepted, none overruled. Browser baseline taken:
  comment-open is ~948ms end-to-end on 551 blocks and scales with length. Plan restructured around
  Sol's cheaper decisive experiment: Stage 1a attributes the real article, Stage 1b is conditional
  on 1a not convicting. A third, scoped check of F4 found the restructure still permitted a defer on
  a light workload; fixed. Plan committed at `89955db2`.
- 2026-09-06 — Stage 2 built: anchor resolution keyed on the anchors rather than the comment
  objects, `open` applied in a second per-block pass, per-block input reuse in `proseHtml`, and
  `hitMarks` split from `openKey` so that reuse can hit. Nine new tests in
  `tests/annotation-reuse.test.tsx`, four of them watched red first.
- 2026-09-06 (later) — Stage 2 reviewed and accepted; Stage 3's A/B confirms it by
  deterministic call counts (`addZoomHandles` 551→1, `annotateHtml` 97→1 on a comment close) and all
  seven browser correctness checks pass. End-to-end moved ~6%, which is what a 10–14% share predicts,
  and the write-up says so rather than implying the click is fixed. Stage 2's review found two
  mutations the tests missed; both closed. A harness bug that recorded a no-op gesture as a fast one
  is fixed. Postmortem written on the pattern.
- **Note on this log's own accuracy, 2026-09-06.** The status line at the top of this file said
  "Stage 3 still to run" for an hour *after* Stage 3 had run and been written up two sections below.
  The edit that should have corrected it was a string replacement with no assertion, made against
  wording a subagent had since changed, so it matched nothing and reported success. Caught during the
  debrief, by reading the file rather than by trusting the tool that wrote it. It is the class this
  job's own postmortem is about
  ([260906a](../postmortems/260906a-a-red-first-test-defends-the-change-not-the-code.md)), committed
  in the doc that describes it — which is worth one line here, because the next person editing a long
  plan doc with a script will reach for the same shortcut.

- 2026-09-06 — the instrument landed (`src/web/annotation-cost.ts`, three modes, six sites). Stage 1a
  measured on a production build: **attributable annotation is ~30ms median per gesture on 551
  blocks, 3–4× over the 8ms threshold — optimise.** Stage 1b skipped. The breakdown cut Stage 2 from
  three steps to two: `addZoomHandles` over all 551 blocks is ~40% of the cost and anchor resolution
  is five parses, so the shared rendered-text cache is not worth its file. Also recorded plainly:
  annotation is only 10–14% of the gesture, and the rest is A8's ground.

### The cleanest probe available, and why

A **glossary term press** is the one gesture that isolates `proseHtml`. Changing `openTerm`
provably does not touch `termMarksByBlock` (its deps are `[blocks, terms]`) and provably does not
touch `marksByBlock` (its deps are `[comments, chats, byId, openComment, openChat]`), while
`proseHtml` lists `openTerm` explicitly — so a press re-runs the whole per-block loop and nothing
else in the annotation pipeline. It measured 927ms. If attributable annotation time is small on
*that* gesture, it is small everywhere, and A7 closes as deferred with a clean argument.

# Simplification audit, 2026-08-26

Six agents read the whole codebase against the static-analysis tools installed the same day
([static-analysis.md](../project/static-analysis.md)), looking for dead code, duplication, complexity
with a simpler shape, and boundaries in the wrong place. The result was then reviewed by **Fable**
and **GPT Sol**, both of which found the first draft materially wrong in places. This is the revised
plan.

**The through-line of almost every finding worth doing: the codebase already knew.** The best items
here are not discoveries. They are places where a comment, a doc, or a postmortem *says* two things
must stay in step, and nothing makes them. `security.md` predicted the `assertSlug` spread.
`useChat.ts` names the bug a shared `r.ok` check would have prevented — twice. `searches.ts` says
"this is the third file to carry this bug" and names the durable fix that was never made.
And the plan behind explain's streaming rewrite wrote down, in as many words, a guard `converse.ts`
was missing — then nothing tracked it for four months. Most of the work below is finishing sentences
the repo already started.

## Status, 2026-08-26

Done, each with the tests green before it was committed:

| | |
|---|---|
| **0.1** converse's missing stall guard | `753c741` — red test first, then the guard, plus a postmortem |
| **0.2** search retry reminting | `99bde25` — confirmed real; the fix keys on **id and criterion**, not id alone (see below) |
| **1.1** `Block` declared twice | `675d399` |
| **1.2** `assertSlug` ×5 | `2c43273` — one `src/slug.ts`; overrides a written decision in `shelf.ts`, and says so |
| **1.3** provider-error leak (6 sites) | `e95c5de` — with **2.7** folded in, as the review advised |
| **1.7** dead code and needless exports | `7359bdb` — minus `spineWidth`/`GUTTER_PX`, whose files another agent has open |

**2.7** (the provider-order constant) landed inside `e95c5de` too, as the review advised — same
files, same invariant. `2230249` then fixed five things GPT Sol found in the work above.

**The two most useful things that happened while implementing**, both the same shape:

*0.2's fix, exactly as its postmortem proposed it, turned an existing test red* — one that sends the
same id with a *different criterion* and requires a fresh id back, because that is what stops a stray
id overwriting a saved search. **The change that makes your new red test green is not automatically
the right change, and the test that objects may be the one holding the requirement.**

*And that corrected fix was still wrong.* Same id and same criterion proves "same question", never
"this is a retry" — a double-clicked POST, a stale tab, or a replay all match both, and would have
reset a `pending` or `done` row, destroying an answer and paying for another call. It needed a third
condition: the run must have **failed**. Two rounds of review to get one four-line predicate right.

Sol also found a **seventh** provider-leak site after the count had already gone three → six:
`search.ts` rethrew `response.json()`'s `SyntaxError`, and V8 quotes the first characters of the
offending input inside that message. Rule 1 again, one level further out than anyone had looked.

Still open: 1.4 (18 sites), 1.5, 1.6, 1.8, Tier 2 apart from 2.7, all of Tier 3.

## Three rules for whoever implements this

All three come from the review, and they are the difference between this plan working and
half-working.

**1. Grep the genre, not this list.** The first draft undercounted every duplication it found —
`assertSlug` 3 when it is 5, the `r.ok` check 4 when it is 18 across 12 files, the provider-error
leak 3 sites when it is 6, the fence-stripping parser 4 when it is 5. Six agents each read one slice,
so each saw the copies inside its slice and none saw the outermost ones. This repo grows by copying
the nearest module of the same genre, comments included. **Before fixing any instance, grep the whole
tree for the idiom.** A dedup that leaves two copies alive is worse than none: the next reader
believes it is done.

**2. Put the shared piece where the invariant already lives.** Do not mint new homes.
`src/parse-json.ts` already owns JSON parsing (its 40-line header is the reasoning);
`src/openrouter-stream.ts` already owns what the streaming paths must agree on. And **not
`src/types.ts`** — that file is declaration-only and browser-safe on purpose.

**3. Line numbers here are already stale**, and several target files are dirty with other agents'
work. Locate every item by content, and re-grep immediately before committing.

## What was deliberately *not* changed

The auditors were told some duplication is honest, and they took it seriously. They declined:
`App.tsx` (1312 lines, second-most-churned — read in full, judged load-bearing; its churn is every
new mode touching one seam by design); the four `*Band` components; the five
`useKeyWithClickEvents` findings ([a documented trade](#a1-the-keyboard-only-reader));
`annotateHtml`'s complexity of 46 (the function [search.md](../project/search.md) credits with
already solving the overlapping-marks problem); `useComments.send`'s 69; `writeAtomic`'s deliberate
two copies; `db/schema.ts`'s Drizzle column boilerplate; `params.ts`'s seven parsers; the
chat/comments/searches storage triplication; and `handleApi`'s 77, which is **branch count, not
convolution** — 27 flat one-line `if (matched && method) { …; return true }` blocks.

Two Knip findings are **false positives**, checked by hand: `DEFAULT_MODEL` in three files is
`export const DEFAULT_MODEL = OPENROUTER_MODEL` used as each function's own default parameter —
`models.ts` really is the single source of truth — and likewise the four timeout constants and
`citedBlockIds`. Knip cannot see cross-file self-use.

## Not ours: the split store

`postgres-storage-implementation.md:363` already records it: chat, searches and glossary lookups
have tables and an importer but no Postgres store, so in `postgres` mode **their writes still go to
files**. The two glossary writes refuse loudly with a 501; chat and search writes do not.
`store/index.ts`'s own header calls that "the worst available outcome: it reports success and loses
the data." The cheap mitigation is to extend `notMigrated` to chat and search writes.

It is not in this plan because it is item 10 on someone else's tracked list and they are editing
those files now. Flagged here so it is not lost.

---

## Tier 0 — two real bugs the audit found

These come first because they are defects, not tidying, and because **§2.4 must not be built on top
of the second one.** Both get the treatment [AGENTS.md](../../AGENTS.md) requires: a failing test
first, a root-cause subagent, and a postmortem under `docs/postmortems/`.

### 0.1 `converse` misfiles a stalled stream that ends cleanly
`explain.ts` has two post-loop guards; `converse.ts` has one. `converse`'s `timedOut`/`stalled`
reporting lives **inside its `catch`** — the error path only. When one of our own clocks ends the
stream *cleanly* (`sseChunks` cancels the reader, and a cancelled read resolves `{done: true}`
rather than throwing), `converse` falls through to `!end.terminated && finishReason === null` and
files a stall as "the answer stopped arriving before it was finished".

`explain.ts`'s comment on the guard `converse` is missing describes the exact cost: both messages end
in "try again", so the reader never notices; what is lost is the log line, which says
`ended without finishing` instead of `stalled: true` — the line somebody reads when explanations
start failing and they want to know whether to blame the network or the provider.

**Correction to this section's first draft.** It said `explain.ts`'s comment pointed at
`converse.ts` for a guard `converse.ts` lacks. That is wrong: the comment saying so sits on *guard 1*
(`readerAborted`), which `converse` does have. Guard 2's comment cites `tests/explain.test.ts` and
does not mention `converse` at all.

The truth is better evidence for §3.4, not worse. The gap was **written down and left**: the plan
behind the commit that gave `explain` guard 2 says *"`src/converse.ts` has the same shape, guarded
only for the reader's signal"* ([explain-deeper-answers.md § 2](explain-deeper-answers.md)) — and
nothing tracked it afterwards. Two copies of one invariant plus a note in a plan is not a mechanism;
a shared transport is.

**Do:** the failing test first, mirroring `tests/explain.test.ts` § "says a silence is a silence".
Then the guard. Then §3.4 stops it recurring.

### 0.2 Search retry may leave a stuck run and a wrong `?run=`
Reported by GPT Sol, **under investigation, not yet confirmed**: a retry sends an already-used id
(`useSearch.ts:160`); the server deliberately remints a taken id (`searches.ts:165`); the client
replaces the old row with `pending` and then appends the reminted row without removing the old one
(`useSearch.ts:95`). If real: a stuck pending run, a duplicate, and `?run=` pointing at the wrong id.

**Confirmed**, and written up in
[search-retry-remints-instead-of-resetting.md](../postmortems/search-retry-remints-instead-of-resetting.md).
Introduced by `cb1f269`, the single commit that created `searches.ts` and `useSearch.ts` by copying
`comments.ts`/`useComments.ts`: it carried the delete-tombstone across and dropped the other half of
the contract.

**`useComments` was checked and is clean.** `createComment` has the reset-in-place branch, so the
server never remints a comment's own id on a retry — which means the `begin`-frame remap in
`useComments.ts` that looks like the fix is actually dead code for the retry case.

**§2.4 stays blocked until this is done.** Extracting `useTombstonedList` now would enshrine the
asymmetry, because `useComments`'s safety comes from a server contract `useSearch` did not have.

---

## Tier 1 — small, safe, each closes a gap the repo already named

### 1.1 `Block` and `BlockKind` are declared twice
`src/blocks.ts:49-50,65-81` keeps private copies; every other consumer (35+ import sites) uses
`src/types.ts:15-16,22-34`. Field-identical **today**, with nothing enforcing it. `blocks.ts`
produces `blocks.json`, which [architecture.md](../project/architecture.md) calls the spine. Add a
field to `types.ts`'s `Block` and `runBlocks` silently does not emit it — `pipeline.ts` uses only
`run.stats`, so there is no assignment point where drift would surface.

Verified: nothing imports `Block`/`BlockKind` **from** `blocks.js` (only `runBlocks` and
`splitIntoBlocks`), so the local declarations and their `export` keywords can both go. The
browser-safety reason `types.ts:5` gives for keeping declarations separate does not apply — an
`import type` is erased.

**Do:** delete the local declarations, `import type { Block, BlockKind } from "./types.js"`.
**Effort** S · **Value** high · **Risk** none — a compile-time no-op, and the typecheck proves it.

### 1.2 `assertSlug` is byte-identical in **five** files
`comments.ts:42`, `searches.ts:52`, `chat.ts:48`, `glossary-lookups.ts:57`, `shelf.ts:57` — each
joins a slug onto a filesystem path. (The audit found three; a whole-tree grep found five. Rule 1.)
[security.md](../project/security.md) named this risk when there was one copy:

> `isSlug` and `assertSlug` are two different definitions of a slug… a codebase with two answers…
> will eventually be asked the question by something that only checks one of them.

Six definitions now: five identical `assertSlug`s plus the stricter `isSlug`
(`^[a-z0-9][a-z0-9-]*$`) in `ingest.ts`.

**Do:** one `src/slug.ts`, imported by all five. Then [A.3](#a3-one-definition-of-a-slug-or-two).
**Effort** S · **Value** high · **Risk** none (identical bodies).

### 1.3 Provider error text reaches the log and the client — **six sites, not three**
`explain.ts:549`, `converse.ts:463`, `search.ts:421` throw
`Error(\`OpenRouter ${status}: ${detail.slice(0, 400)}\`)` on non-2xx. Sol found three more on
*successful* responses: `converse.ts:488`, `explain.ts:571`, and non-streaming `search.ts:431`.

The comment above the first says why it is wrong: *"The status, not the body. OpenRouter's error text
is the one place a provider might echo part of what we sent back at us, and what we sent is the whole
article plus the reader's selection."* The **log line** obeys that; the **throw** does not, and
`handleApi`'s outer catch does `send(res, status, { error: (err as Error).message })` and hands the
raw error to `errorFields`. `searches.ts:231` says *"This is the third file to carry this bug… the
durable fix is at the throw site, not here."*

Scope honestly: behind a one-email beta gate the reader receiving the message is the person who
supplied the article, so this is not a cross-user breach. It is a straight violation of this repo's
hard rule — *never put any article prose in a log* ([logging.md](../project/logging.md)).

**Do**, per Sol, and note two corrections to the first draft:
- **Discard the detail at the provider boundary.** Do not park it on a "non-logged" field — that is
  sensitive data waiting for a future serializer to find it. Keep a fixed public message, the status,
  and safe diagnostics only.
- **Do not add a local catch to `lookUpTerm`.** It has no pending row to reconcile, and a catch there
  risks erasing its existing 409 (`api.ts:417`). Sanitise at the throw site and let the route catch.
- Keep the status **in** the fixed message, so [A.5](#a5-what-the-reader-sees-when-a-model-call-fails)
  can later distinguish "busy, retry" from "broken" without another change.
- Privacy tests first.

**Effort** S · **Value** high · **Risk** low — but it changes client-visible error text, so ship the
interim wording and say so in the commit.

### 1.4 The `r.ok` check is copy-pasted — **18 sites across 12 files**
`useComments`, `useSearch`, `useChat`, `useShelf`, `useLibrarySearch`, `useJobs`, `useGlossary`,
`useSummaries`, `App.tsx`, `Metadata.tsx`, `Library.tsx`, `Tweets.tsx`. `useChat.ts:566` explains the
cost of the version that omits it:

> a bare `.catch()` on these calls reported success for every error the server could return… This app
> has been bitten by exactly that before — see the note on `forget` in useComments.ts, where a DELETE
> that 500'd removed a comment from the screen and said nothing.

Two independent bugs, one missing check. `useSearch` already imports `describeFetchFailure` from
`useComments.js`, so this continues a direction the repo started.

**Do:** `fetchOk(url, init?)` in `src/web/lib/http.ts`. Callers keep their own `try/catch` and
message. **Exclude the streaming variants** (`useChat.ts:376`, `useComments.ts:205`) — different
shape. **Migrate one feature per commit**; the list is the grep, not this paragraph.
**Effort** S per feature · **Value** medium-high · **Risk** very low.

### 1.5 `partsOf` is imported out of another stage's implementation file
`glossary.ts:44` and `tweets.ts:32` both `import { partsOf } from "./arc.js"` — a pure `Tree` walk
with nothing to do with the arc, and the one real violation of
[architecture.md § Stage ownership](../project/architecture.md#stage-ownership) the audit found.

**Do:** a new `src/tree.ts` for server-side tree behaviour — `partsOf`, plus the range resolution
from 1.8. **Not `types.ts`**, which is declaration-only and browser-safe. Note `src/web/tree.ts`
already exists and is the client's; pick a name that does not invite confusion.
**Effort** S · **Value** medium · **Risk** none.

### 1.6 One entrypoint guard, spelled four ways — **12 sites, and it needs tests**
`fetch.ts:1129` and `toc-flatten.ts:92` still use
`import.meta.url.endsWith(path.basename(process.argv[1]))`. Seven stages use the resolved-path form,
and `arc.ts:359` says why: the basename form also matches when a *different* file with the same name
imports the module, running `main()` as a side effect. `evals/` and `scripts/` add two more
spellings.

**Do:** one shared `isMain()`. **Sol's warning is the important part: a faulty helper makes every
CLI silently do nothing.** Unit-test same-basename files, paths with spaces and URL-encoding, and a
missing `argv[1]`, before migrating any caller.
**Effort** S+tests · **Value** medium · **Risk** low with tests, high without.

### 1.7 Dead code and needless exports
- `src/web/components/ui/collapsible.tsx` — zero importers, orphaned when the masthead `▾` became a
  hand-written drawer. **Delete** — and update the component inventory at `web-client.md:37`, which
  still lists it. Re-grep immediately before committing.
- `converse.ts:677` re-exports `readerAborted` with a comment claiming `tests/converse-stop.test.ts`
  imports it; that test imports only `stoppedByReader`, and both `converse.ts:56` and
  `explain.ts:63` import it straight from `openrouter-stream.js`. **Drop it.** Note the comment gives
  a *second* reason (discoverability — "this is where a reader looking for them will come"), so this
  overrides a written decision rather than correcting an error; say so in the commit.
- `jobs.ts:38` re-exports `JobStatus`/`StepStatus`, imported nowhere. **Drop those two names**, keep
  `Job`/`JobStep`/`StepName`.
- Drop `export` where nothing outside the file uses it: `owner.ts:63`, `db/ssl.ts:28`,
  `Cited.tsx:104`, `ContextPanel.tsx:52`, `params.ts:46,184,391,476`, `lib/sse.ts:52`,
  `layout.ts:110`, plus type-only `MarkKind`, `Tier`, `SpineMode`, `GlossaryStatus`,
  `SummariesStatus`, `ProseSection` — **and** the ones the first draft missed: `comments.update`,
  `TextPart`, `Annotation`, `SummaryRung`, `buttonVariants`, `toggleVariants`.
- `store/contracts.ts:24` names `ChatStore` and `SearchStore` as seams in that file; neither exists.
  **Fix the comment.**
- **`scratch-tok2.mts`: do not delete.** It is untracked in a tree several agents share; ask its
  owner first. (Both reviewers flagged this independently.)

**Correction to the first draft:** this will *not* leave Knip near-empty, so Knip does not become
promotable to a gate on the strength of it.
**Effort** S · **Value** medium · **Risk** none, except the delete — hence the re-grep.

### 1.8 The same range-resolution guard, twice
`tree.ts:230` and `:318`, verbatim including *"Index lookup, never string comparison — block ids
carry no order"* — the [block-ids.md](../project/block-ids.md) invariant spelled out twice. Fold into
the shared tree module from 1.5. **Effort** S · **Value** low · **Risk** very low.

---

## Tier 2

### 2.1 The Postgres readiness probe, six copies and a variant
`store-parity`, `store-import-convergence`, `store-roundtrip`, `store-comments`,
`store-export-isolation` use a 10s pool + `to_regclass`. But `store-shelf-pg.test.ts:98` probes the
`fts` **column** with its own message, and `db-schema.test.ts:41` still uses the **old 2s timeout**
and keeps its pool for the tests rather than closing it. So: **a parameterised readiness probe, not
one fixed probe** — and it must preserve module-load timing, because `store-parity.test.ts:105`
records why:

> At 2s this probe timed out under nothing worse than a dev server holding connections, and the whole
> suite skipped — inside a run that still printed a green '1103 passed'.

That `db-schema.test.ts` still carries the 2s timeout the incident was about is itself a finding.
**Effort** M · **Value** high · **Risk** low (needs `DATABASE_URL` to verify — run with the local
stack up).

### 2.2 Five stages hand-roll the same model-call parts
`arc`, `glossary`, `tweets`, `summarise`, `toc`. **Corrections to the first draft:** there are five
fence-stripping parsers, not four; they are *not* byte-identical (different return types and
labels); `src/parse-json.ts` already exists and owns `parseJsonFrom`, so the wrappers belong **there**
as `parseJsonFenced(raw, source)` — not in a new `src/model-call.ts`; and `summarise`'s `parseJson`
being exported is **not drift** — `tests/parse-json.test.ts:171` dynamically imports it by name, so
de-exporting breaks that test.

Genuinely shared and worth extracting: article-input loading, text-block extraction, throttled
character progress. **Do not build a broad `handleStopReason(...)` options machine** — `summarise`
has batching, repair and partial salvage, and does not share arc/tweets/glossary's request shape.
**Leave the `messages.stream(...)` call sites alone.**
**Effort** M · **Value** high · **Risk** low — each stage has its own test file.

### 2.3 `useGlossary` / `useSummaries` / **`Tweets`**: share the scaffolding, not the verbs
Both reviewers endorsed the split, and both said the first draft scoped it too small: `Tweets.tsx:94`
has the same loading/job/failure lifecycle a third time.

The **verbs stay separate** — glossary's `find`/`more`/`reset` because the step *appends*, summaries'
`write` because it *replaces*. The **scaffolding** is not domain logic. But it is **not
byte-identical**, as the first draft claimed: `useGlossary`'s `load` parses a third flag, `outdated`,
which `useSummaries` has no equivalent for. So the shared hook returns the **raw parsed response**
and each caller derives its own flags.

**Do:** `useJobArtefact<T>(slug, loadUrl, stepName)` → `{ status, response, error, job, failed,
reload, run, cancel }`. Glossary keeps `look`/`looking`/`lookFailed` (not job-backed).
**Effort** M · **Value** high · **Risk** medium — the `job`/`failed`/`stopped` timing is a
closure-vs-render read both files flag as learned the hard way. Manual check: start a job, kill the
server, confirm the failure banner still appears in all three.

### 2.4 `useComments` / `useSearch` — **blocked on 0.2**
Extract the tombstoned-list scaffolding, not `send()` (comments reads `begin`/`delta`/`done` frames
and remaps a reminted id; search is a plain POST). But **fix 0.2 first**, with a red test — and the
abstraction needs an explicit `remap(oldId, newId)`, or a server contract guaranteeing
reset-in-place, otherwise it hard-codes today's identity confusion.
**Effort** M after 0.2 · **Value** medium · **Risk** medium.

### 2.5 The `Progress` job-runner, three copies — **the reviewers disagree; verify before doing**
`GlossaryPanel.tsx:1284`, `SummaryPanel.tsx:626`, `Tweets.tsx:331`. `SummaryPanel`'s docstring says
*"The same component the glossary panel has, and the same reasoning."*

- **Fable**: the differences are parameterisable. Give `<JobProgress>` a `buttonClass` prop, keep each
  panel's class, and the change is invisible — Tweets joins now and [A.4](#a4-two-button-styles)
  dissolves into a pure aesthetic question blocking nothing.
- **Sol**: the differences go past class names — fallback text, step names, icons — so a shared
  component either grows a bag of styling parameters or visibly unifies them. Do all three after
  deciding the design, or none.

They agree on one thing: **do not do the partial two-panel merge the first draft proposed.** Measure
the real difference (`gloss-btn` vs `summ-btn` differ in hover colour and disabled opacity) and
decide. **Effort** S–M · **Value** high · **Risk** low logically, but product-facing if the styles
diverge more than the props can absorb.

### 2.6 `store/export.ts` re-queries what `pg.ts` already has
`export.ts:100-107` re-writes `pg.ts`'s `currentRevision` join; `export.ts:145-155` re-writes
`blocksFor`'s row mapping, comments included. A new block column must be added twice — in the code
that is explicitly the **rollback path** out of a bad cutover.
**Effort** S · **Value** medium-high · **Risk** low; parity tests cover it.

### 2.7 The provider-order block, three copies
`converse.ts:408`, `explain.ts:514`, `search.ts:395` — `provider: { order: ["anthropic"] }` plus nine
identical comment lines. Routing policy in three places, nothing checking they agree.
**Do:** one exported constant in `openrouter-stream.ts` (the module that already owns what these
paths must agree on). **Fold into the 1.3 commit** — same files, same invariant, and doing 1.3 as
three separate edits re-creates the drift surface.
**Effort** S · **Value** medium · **Risk** none.

---

## Tier 3

### 3.1 Split `handleApi` at its existing resource boundaries
Not a route table — the flat shape is defensible and the order-sensitive matches are documented.
Group the 27 branches into the clusters the header already names, as five or six `handle*Routes`
functions called in sequence. **Sol: add a route/method matrix test first** — the existing route
tests do not cover all 27 branches. With that, this is Tier 2.
**Effort** M · **Value** medium · **Risk** low as pure extraction.

### 3.2 Break up `importArticle`
`store/import.ts` — one 460-line transaction body, complexity 72, already delimited by its own
comments. Extract the sections as `tx`-taking helpers. Covered end-to-end by the store tests —
**but only if the local Postgres stack is running**, otherwise they skip. And `store/*` is the most
actively edited area in the tree right now, so "quiet tree" applies here most, not least.
**Effort** M · **Value** medium · **Risk** low with a DB up.

### 3.3 Extract `TableView`'s cell-rendering closure
Complexity 46 — arc-column and gist-column branches inline in the row loop. Extract `ArcCell` and
`GistCell`. **Stays in Tier 3**: the file is dirty with another agent's work, nothing tests this
path, and `rowSpan`/keys/conditional classNames are exactly what fails into "a plausible wrong
article" that [granularity-zoom.md](../project/granularity-zoom.md) warns about. Browser check at
narrow and wide widths, reading and outline mode.
**Effort** M · **Value** medium · **Risk** medium.

### 3.4 A shared OpenRouter streaming transport — **scheduled; the first draft was wrong to decline**
The first draft kept `converse` and `explain` apart because a comment said to. **0.1 is the evidence
that the comment is now documenting drift rather than protecting clarity**: the same clean-cancellation
race is classified correctly in one path and wrongly in the other, and `explain`'s comment points at
`converse` for a guard it lacks. `converse.ts:12` also still claims explain "returns an answer or
throws", though explain now streams.

**Not** one parameterised `converseOrExplain()`. Extract a transport that owns: key, endpoint,
headers and **safe** provider errors (1.3); the timeout and restartable stall clocks; SSE completion,
finish-reason and clean-abort detection (0.1); and text/citation/model/usage accumulation. Prompt
construction, stop-button semantics, empty-answer policy, block citations and success logging stay in
the two verbs. Search belongs in this too.

**Add identical stall, timeout, premature-EOF and non-2xx tests to both callers first.**
**Effort** L · **Value** high · **Risk** real — the highest-stakes paths in the app.

### 3.5 `summarise`'s concurrency pool — **do not change**
The first draft suggested replacing the hand-rolled 20-line ordered pool with `p-queue`. Sol is
right that this is wrong: it saves almost nothing and changes failure and scheduling semantics on
working, well-commented code. **Dropped.**

---

## Order of work

1. **0.1** — test, guard, postmortem. **0.2** — confirm, test, fix, postmortem.
2. **1.3 + 2.7 together** (same files, same invariant), privacy tests first.
3. **1.2** → one `slug.ts`. **1.1** → `Block`. **1.5 + 1.8** → the shared tree module.
4. **1.6** with its tests. **1.7** the sweep, minus the scratch file.
5. **1.4**, one feature per commit.
6. **2.1, 2.2, 2.6.**
7. **2.3** (three callers). **2.5** once measured. **2.4** only after 0.2.
8. **3.1** with its matrix test; **3.2** with a DB up; **3.4** when there is room; **3.3** last.

After each: `npm run check`, and a browser pass on anything under `src/web`. Many small commits, not
one per tier — several agents are editing this tree.

---

## Appendix A — deferred, needs Greg's input

Everything above is internal: done right, no reader notices. These are not.

### A.1 The keyboard-only reader
The five `useKeyWithClickEvents` findings are a deliberate trade, and `ContextList.tsx`'s header
explains it: making every entry focusable would put three columns of forty sections — a hundred-plus
tab stops — in front of the prose, when the keyboard model is ↑/↓ stepping by level
([keyboard.md](../project/keyboard.md)). The residual is real: a reader with no pointer cannot jump
directly to an arbitrary landmark or open its tooltip card. Do nothing, a roving tabindex over the
current column, or a "jump to section" command? **Product decision.**

### A.2 `JobStore` — resolved: keep it
Both reviewers said keep. It is the future multi-process queue contract (`contracts.ts:158`), the
Postgres migration is visibly in flight, and Sol notes deleting it would throw away a written spec.
`ChatStore`/`SearchStore` are a storage-correctness task belonging to that migration, not to this
plan. Tier 1.7 only fixes the misleading comment. **No decision needed — recorded as closed.**

### A.3 One definition of a slug, or two?
Both reviewers reclassified this. Fable checked the disk: every slug under `data/` already satisfies
the strict rule, and slugs are *minted* through `isSlug` (`jobs.ts:679`), so a nonconforming one
could only be historical. **Plan:** do 1.2 with the loose rule, then query the remote `articles`
table; if it comes back clean, collapse to strict. Only an actual nonconforming slug makes this
yours.

### A.4 Two button styles
`Tweets.tsx`'s `Progress` uses the shadcn `Button`; `GlossaryPanel` and `SummaryPanel` use
hand-written `gloss-btn`/`summ-btn`, which differ from each other in hover colour and disabled
opacity. Unifying `<JobProgress>` across all three means picking one.
[web-client.md § Tailwind and shadcn](../project/web-client.md#tailwind-and-shadcn-components)
records what is deliberately staying hand-written, and also points toward shadcn for chrome.
**Which way?**

### A.5 What the reader sees when a model call fails
Fixing 1.3 changes the text in the error the client receives — today it can be raw provider output.
Removing the leak is not your call; the replacement wording is. The real choice is whether to
distinguish "the model is busy, try again" from "this is broken" — which maps cleanly onto the HTTP
status, so 1.3 keeps the status in the interim message to leave that door open. A reading app whose
principle is *augment, don't replace* probably wants the reader to know which. **Wording is Greg's.**

### A.6 Two features make the reader wait without streaming
Sol's finding, and new: semantic search and glossary term-lookup both make a reader wait on a
non-streaming request, which sits awkwardly against what
[AGENTS.md](../../AGENTS.md) says about helping the reader read efficiently. This is not a bug and it
is not in the plan — but it means the current client shapes of those two features should not be
treated as permanent abstraction boundaries (relevant to 2.3 and 2.4). **Worth deciding before those
extractions harden.**

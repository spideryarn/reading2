# Open the article sooner, and call the mode Hierarchy

Status: **built 2026-08-29**, in three commits — `0aa30ac` (the arc's freshness check),
`837df17` (the Contents → Hierarchy rename), and the deferral itself. **Revised after GPT Sol's
review** —
`defer-arc-and-rename-hierarchy-sol.md`, verdict *"revise before building"*. Every finding below was
re-checked against the tree; the four that contradicted the first draft are marked **[corrected]**.

Three things Greg asked for on 2026-08-29, in one plan because they are small and land together:

1. Check that adding an article runs a sanitiser, and find out whether that is part of or after
   Readability. **Answered below — it already does, and no work is needed.**
2. Take the slow model steps out of the critical path so the article opens sooner.
3. Rename the "Contents" reading mode to "Hierarchy".

> Right now, we build the Table of Contents and Arc as part of the initial queue when we add an
> article. They're slow, so this adds a lot of latency when adding a new article before we can read
> it.
>
> — Greg, 2026-08-29

---

## 0. The sanitiser question, answered

**Yes, and it is a stage of its own — stage 3, after Readability, not part of it.** No work needed.

```
 1 fetch ──► raw.html
 2 extract ──► article.html          Mozilla Readability. NOT a sanitiser.
 3 blocks  ──► blocks.json           ★ DOMPurify under jsdom, then split, then ids
 4 toc     ──► tree.json
 5b arc    ──► arc.json
 6 serve   ──► the browser           ★ DOMPurify again, under Chrome's parser
```

Both stars are real, and the second is the one that guards the render.
[`src/sanitize.ts`](../../src/sanitize.ts) says so in its own words:

> **This pass is not the last line of defence, and must not be treated as one.** It runs under
> jsdom's parser; the browser runs Chrome's. Its job is to make the *stored artefact* clean, so
> `blocks.json` on disk is not a loaded gun and every later consumer inherits a sane starting point.
> The pass that guards the actual render is the browser one.

The policy is shared rather than duplicated —
[`src/sanitize-policy.ts`](../../src/sanitize-policy.ts) (577 lines) is imported by both the Node
binding and [`src/web/sanitize.ts`](../../src/web/sanitize.ts). The reason Readability cannot be
relied on is recorded and *measured*, not assumed: `<img onerror>`, `<svg onload>`,
`<span onmouseover>` and `<video onerror>` all survive Readability and all fire. Mozilla agrees, in
Readability's own security policy.

**Nothing in this plan changes any of that.** Neither part below touches stage 2 or stage 3.

---

## 1. Can ToC and Arc run in parallel?

**No — arc reads the tree.** [`src/arc.ts:274`](../../src/arc.ts) opens `tree.json`, and
`partsOf(tree)` is where its parts come from. One sentence per part requires knowing the parts.

```
 blocks.json ──► [4 toc] ──► tree.json ──► [5b arc] ──► arc.json
                  model               model
```

There is no version of this where they overlap without arc guessing at a structure toc has not
decided yet. So the latency win has to come from taking a step *out* of the wait, not from
overlapping the two.

## 2. Which step to take out

Greg chose **arc only** (2026-08-29), from three options. The reason the other two are expensive:

**An article with no `tree.json` cannot currently be opened at all.** Not "renders badly" — it is
not servable. [`src/api.ts:152`](../../src/api.ts) is `if (!blocksFile || !tree) continue;` when
listing the library, and [`src/api.ts:557`](../../src/api.ts) is `if (blocks && tree) return dir;`
when locating one. `tree: Tree` is required in both payload types
([`src/types.ts:1051`](../../src/types.ts), [`src/public-types.ts:131`](../../src/public-types.ts)),
and the spine, granularity zoom, outline, diagram, Dock and stats all read it. Deferring `toc`
therefore means either inventing a throwaway tree or making the tree optional across the client.

**Arc is already optional, everywhere, today.** `arc?: Arc` in both payload types, and
`buildArcColumn` in [`src/web/tree.ts:327`](../../src/web/tree.ts) opens with
`if (!arc || !cells?.length) return null;`. **This is the single fact that makes this change small.**

**[corrected]** Sol checked this further than I had and it is stronger than I wrote, in one way and
weaker in another. Every current read and render path tolerates an absent arc — both stores
(`src/api.ts:203`, `src/store/pg.ts:1176`), the public path (`src/store/public-reader.ts:323`,
`src/public/dto.ts:329`), the spine and stats (which read the tree, not the arc), and `has.arc`,
which only reports presence. But `TableView` (`src/web/TableView.tsx:698`) does not render an empty
column without one — **it falls back to the ordinary root gist**. So today's no-arc state is usable
content, not a gap. The "Loading" state Greg asked for is therefore *new UI*, not an existing
empty state being filled in.

So the shape is:

```
NOW    fetch → extract → blocks → toc → arc → the reader can open it
                                  model  model

AFTER  fetch → extract → blocks → toc → the reader can open it
                                  model
                                        arc runs behind them, on demand
```

### 2.1 The part that is not free: arc cannot tell whether it is current

This is the whole of the real work, and the codebase has already written down why. From
`FORCE_ONLY_WHEN_NAMED` in [`src/pipeline.ts:183`](../../src/pipeline.ts):

> `arc` stays in the cascade for exactly the inverse reason: **it cannot tell whether it is current,
> so its position is the only signal there is.** Give it a freshness check of its own and it belongs
> here too.

Its position *is* the signal — and this change removes its position. Today `arc` sits in
`DEFAULT_INGEST_STEPS` immediately after `toc`, so `cascadeForce` sweeps it whenever an earlier step
is forced. Take it out of that list and a re-ingest builds a **new tree** with no arc run behind it,
while the old `arc.json` still exists — and `stepIsDone` (`src/pipeline.ts:504`) falls back to
"does the artefact exist" when a step has neither stamp nor `isDone`, which `arc` has neither of
(`src/pipeline.ts:1183`).

**[corrected] This bug already exists; the change makes it the normal path rather than an edge
case.** I had written that deferring arc *introduces* it. Sol checked `cascadeForce`
(`src/jobs.ts:185`) and it operates only on the steps already in that job —
`steps.slice(first).filter(...)`. So a job of `steps: ["toc"]` with `force` **cannot reach arc
today either**. Anyone who has ever refreshed just the ToC already has a silently-truncated arc.
That reframes the freshness check: it is a fix on its own merits, not merely a prerequisite.

What the reader then sees is nothing at all, which is the bad part:

> `arc` and `summary` are joined to the tree by exact block-**range** pair … and an entry whose
> range matches no node is **dropped from the reading view without a word**.
>
> — the withdrawn-stamp note on the `toc` step, [`src/pipeline.ts:1109`](../../src/pipeline.ts)

`buildArcColumn` keys on `` `${e.range[0]}|${e.range[1]}` `` ([`src/web/tree.ts:341`](../../src/web/tree.ts)).
A recut tree changes the ranges; the lookups miss; the column silently empties. A stale arc does not
announce itself.

**So: give `arc` a freshness check, and only then take it out of the default steps.** In that order.
`Arc` today is `{ version, generator, slug, entries }`
([`src/types.ts:154`](../../src/types.ts)) — no source hash at all.

**Hash the blocks *and* the tree, not just the blocks.** `tweets` and `glossary` hash blocks alone,
and for the arc that is provably not enough — the whole hazard above is a tree that moved while the
blocks did not. `ideas` already faced exactly this and its stamp says so
([`src/pipeline.ts:1441`](../../src/pipeline.ts)):

> `inputHashFor` above hashes only the blocks, which `StepStamp`'s own docstring has flagged as
> wrong for exactly this family of stages since it was written: **section boundaries can move
> without a single block changing.**

So `ideas` is the precedent to copy, not `tweets` (`src/ideas.ts:108`), and `structureHash`
(`src/source-hash.ts:146`) already covers ids, parents, ranges, titles and gists — which also
settles a question I had left open: a tree recut into *identical ranges* but with reworded gists
does need a re-run, because the arc's prompt is built from tree titles and gists
(`src/arc.ts:152`).

**[corrected] Blocks + tree is necessary but not sufficient — the metadata must be in it too.**
`generateArc` reads `meta.json` (`src/arc.ts:277`) and passes it to `articleText`, which puts
`TITLE:`, `BY:` and `PUBLISHED IN:` at the head of the prompt (`src/article-prompt.ts:119`). A
metadata-only change would escape a blocks+tree fingerprint entirely — and this is not hypothetical,
because the app has an in-app title rename (`useArticleRename`, `src/web/TitleEditor.tsx:159`). So
the fingerprint covers **blocks + tree + the metadata fields `articleText` actually reads**.

Two more places the new field has to reach, which the first draft missed:

- **Postgres step status** computes arc as presence-only (`src/store/pg.ts:1270`) and must learn the
  check, or the two stores will disagree about whether an arc is current.
- **The public DTO** (`src/public/dto.ts:193`) needs a decision on whether the provenance field
  crosses to visitors.

And: **every existing `arc.json` lacks the new hash and becomes stale the day this ships.** That is
not a migration detail, it is the visitor problem in § 2.2 arriving for the whole existing library
at once.

Once arc has that check, it belongs in `FORCE_ONLY_WHEN_NAMED` on the same grounds as the other
three — its own docstring says so in the sentence quoted above.

### 2.2 Where the trigger lives, and who is not allowed to pull it

Greg wants the article to land in the Hierarchy mode, which starts the work:

> I think it makes sense for the article to open initially to the "Contents" view, which would
> immediately trigger the various LLM calls, and in the meantime the "Contents" mode would be in a
> "Loading" state (with a spinner etc).
>
> — Greg, 2026-08-29

Hierarchy is already the default mode (`.withDefault("toc")`,
[`src/web/params.ts:267`](../../src/web/params.ts)), so "opens to it" needs no change.

Reuse [`src/web/useStepJob.ts`](../../src/web/useStepJob.ts) — the same hook `useGlossary`,
`useIdeas` and `useSummaries` already use. Do not hand-roll a fifth copy; the hook's own docstring is
a list of the bugs the four divergent copies had.

**[corrected] But `useStepJob` does not auto-start, and the first draft assumed it did.** It returns
a `start` callback and nothing calls it (`src/web/useStepJob.ts:188`) — every existing caller is
driven by a reader pressing a button. "Opening the article triggers the call" therefore needs work
this plan had not accounted for:

- an effect that calls `start()`, guarded against `<StrictMode>`'s double-invoke with a ref — the
  open-counter twenty lines above it (`src/web/App.tsx:738`) is the precedent, and its docstring
  records that without the ref *"the number is simply wrong"*;
- local arc state, since the hook owns only the job half and each caller owns its own read;
- race handling for a reader who navigates away mid-job.

**And `OwnedReader` cannot see the mode.** `mode` is read by `useQueryState` further down
(`src/web/App.tsx:1120`), below the capability seam. So "start it when they enter Hierarchy" needs
the mode lifted or the trigger placed elsewhere — whereas "start it whenever an owner opens the
article" needs neither. **Recommendation: trigger on owner-open, not on mode entry.** It is simpler,
it starts the work sooner, and since Hierarchy is the default mode the reader is almost always in it
anyway.

**Mount it in `OwnedReader`, not in `Reader`.** This is a real constraint and not a stylistic one.
[`src/web/App.tsx:755`](../../src/web/App.tsx) is the capability seam, and the acceptance test for
public reading is *"a signed-out browser issues no POST whatever"*. A visitor must not start an arc
job.

**Consequence, and it is bigger than the first draft said — this is the one decision left for
Greg.** An article whose arc has not run shows a visitor the root-gist fallback for ever, because
the only thing that would start the job is a *signed-in* reader opening it, and a signed-out browser
must issue no POST at all.

The first draft treated this as affecting new articles only. It does not: **adding a required
fingerprint makes every existing `arc.json` unstamped, so the whole current library lands in this
state on the day it ships**, and no visitor can trigger the repair.

**Greg's decision, 2026-08-29: owner-triggered only, and the regression is accepted.** He was shown
the second-job option (Sol's recommendation and mine) and chose the smallest scope instead.

So: an article whose owner has not opened it since this shipped shows a visitor the root-gist
fallback, indefinitely, and that includes the entire existing library on day one. This is a
deliberate trade, not an oversight — it keeps the machinery small and spends no model calls on
articles nobody reads.

**Because it is deliberate, it gets a test rather than a comment.** Sol's condition for this option
was "explicitly accept *and test* permanent root-gist fallback for visitors", and that is the right
condition: the fallback is good enough that nobody would report it as broken, so the only thing that
will keep it from being mistaken for a bug later is a test that says it is intended.

Explicitly rejected: generating the arc from an anonymous GET. That turns a public read into a paid
mutation and is an abuse path.

Still open for a later day, if the regression grates: the second non-blocking job. Nothing in this
plan forecloses it.

### 2.3 Reading the arc once it lands

There is no `GET /api/arc/:slug`; the arc arrives inside the article payload. Two options:

- **Refetch `/api/article/:slug`** when the job finishes. Simplest, no new route, but re-reads every
  block and the whole tree to collect one small object — and on the Postgres store that is the exact
  cost `docs/plans/glossary-read-latency.md` was written about.
- **Add a small `GET /api/arc/:slug`.** One more route, but it is the shape the other on-demand
  artefacts already have.

**Recommendation: the small route**, on the glossary-read-latency precedent. **Sol agrees**, having
checked that both stores load blocks, tree and arc together (`src/api.ts:203`,
`src/store/pg.ts:1176`), so a refetch repeats the whole expensive projection for one small artefact.
Its additions:

- add `loadArc` to the reader contract and both stores;
- have the route distinguish **current / stale / absent**, three states rather than two;
- **do not render a known-stale arc while rebuilding.** The exact-range join would otherwise show a
  plausible but silently incomplete arc — which is the failure this plan exists to prevent, arriving
  through the new code instead of the old;
- keep the public read path bundled as it is.

### 2.4 How much latency this actually buys

### Measured, 2026-08-29 — and it is 4%

From `data/_ai-calls.jsonl`, the one ingest that logged both steps
(`what-if-we-had-bigger-brains-imagi`):

> **Corrected 2026-08-30.** The first version of this table summed the three label calls as though
> they ran one after another. They do not — `src/labels.ts` runs them concurrently, and the ledger's
> timestamps show all three starting at 163.1s and the last finishing at 186.2s. The sum was 65.2s;
> the wall-clock contribution is 23.1s. Found by GPT Sol reviewing
> `docs/research/opening-an-article-before-the-toc.md`, and verified from
> `data/_ai-calls.jsonl`. The conclusion does not change; the denominator does.

```
                        start    end    wall-clock
toc  structure call       0.0   163.1      163.1s  ████████████████████████████████
toc  label batch ×3     163.1   186.2       23.1s  ████        (concurrent: 22.0, 23.2, 20.0)
arc                     187.4   197.8       10.4s  ██
                                          ────────
     total                                 197.8s
```

**Deferring arc removes ~5% of the wait** — 10.4 seconds out of 197.8. The wait is the ToC, and
within it the single structure call is **88%** of everything.

n = 1: it is the only article in the log with both steps. The 35 calls with no `stepName` were
checked in case they hid pipeline work — they are chat, embeddings and search. A 16:1 ratio is
unlikely to invert, but this is one article and should not be quoted as more.

**Greg was shown this and chose to build the deferral anyway** (2026-08-29), having been offered
"freshness check + rename only" and "go after the ToC instead". Recorded because the trade looks
worse after the measurement than before it, and a later reader should not have to rediscover that:
the deferral is being taken for a tidier pipeline and 10 seconds, at the price of the visitor
regression in § 2.2.

Attacking the ToC — a heading-based tree to open on, streaming the structure pass, a cheaper model
for pass 1, or publishing the tree before labels merge — is where the remaining four minutes are.
Not this piece of work.



**[corrected] The first draft said this removes "one call in three". That is not supported.** ToC is
one structure request followed by *potentially many* label batches, which may run parallel or serial
depending on cacheability (`src/labels.ts:1242`, `:1355`). Arc is one later serial request. So
request count says nothing about the saving. The quantity that matters is **arc wall time over total
toc+arc wall time**, and nothing here knows it yet.

Sol also checked whether arc could overlap label generation, since arc does not consume `navLabel`:
in principle yes, but the intermediate tree is not published until labels have merged
(`src/toc.ts:756`), so exposing it needs a new artefact or callback. **Not a cheap change** — treat
label deferral as separate work.

Every step already logs `ms` through `plog.info`, so the numbers are recoverable from an ingest of a
few real articles rather than estimated. **A plan that claims a latency win and never measures it is
the failure mode this repo has a doc about** ([silent-success.md](../reusable/silent-success.md)).
Get before/after numbers from the same articles.

### 2.5 Tests

- **The red-first test for the staleness bug**: build an arc, rebuild the tree so the ranges move,
  assert the arc is reported stale. It must fail before the freshness check exists — that is the
  point of writing it first.
- A test that `DEFAULT_INGEST_STEPS` no longer contains `arc`, and one that a default ingest leaves
  an article that is servable and openable.
- A test that the Hierarchy view renders with `arc: undefined` — cheap, and it pins the property this
  whole plan leans on.
- A visitor test that no arc POST is issued. `tests/visitor-gaps.test.ts` is where that family lives.

---

## 3. Renaming Contents → Hierarchy

> One more thing - I'd like to rename the "Contents" mode to "Hierarchy". Make sure to rename all the
> variables, docs, references, etc.
>
> — Greg, 2026-08-29

Greg chose **the label and the mode id, but not the pipeline step** (2026-08-29).

### 3.1 Why this is worth doing beyond taste

`toc` currently means two different things: the **mode** the reader is in, and the **pipeline step**
that builds `tree.json`. They collide in the same repo and occasionally in the same file. After this
rename, `toc` means only the build step and `hierarchy` means only the mode. The rename removes an
ambiguity rather than just moving one.

The pipeline step, `tree.json`, the step stamps and the job rows keep the name `toc`. Renaming those
would need a database migration for no reader-visible gain.

### 3.2 The rename is safe for existing links

Worth stating, because it is the usual reason not to rename a URL value. It does not apply here:

**[corrected] The conclusion holds but the first draft's reason for it was wrong.** I had written
that `toc` never appears in a URL, quoting the `MODES` docstring
([`src/web/params.ts:212`](../../src/web/params.ts)). Sol found that `withMode`
([`src/web/Dock.tsx:652`](../../src/web/Dock.tsx)) does `params.set("mode", mode)` **unconditionally,
including for the default** — so every Dock navigation writes `?mode=toc` into a real URL that a
reader can copy and share. Links carrying it exist.

They are safe anyway, for the other reason:

- An unrecognised `?mode=` value parses to `null` and the query state falls back to the default
  ([`src/web/params.ts:221`](../../src/web/params.ts)) — *"a link from a future version with a mode
  this one has not got degrades to the article instead of to an error."*

So an old `?mode=toc` link lands on Hierarchy, which is the same view it always meant. Two things
follow, and neither was in the first draft:

- **A legacy `?mode=toc` test is required, not optional.** It is now the only thing keeping those
  links working.
- **Make `withMode` delete the parameter when the mode is the default**, so URLs generated from here
  on are canonical and this does not recur at the next rename.

### 3.3 Every site, swept

The mode and the step are textually identical, so this list was built by reading each hit, not by
matching a string.

**Mode — rename to `hierarchy`:**

| File | Line | What |
|---|---|---|
| `src/web/params.ts` | 233 | the `MODES` entry |
| `src/web/params.ts` | 267 | `.withDefault("toc")` |
| `src/web/params.ts` | 205–230 | the docstring, which discusses "the current Table of Contents middle sections" |
| `src/web/Dock.tsx` | 292, 294 | `mode: "toc"`, `label: "Contents"` |
| `src/web/Dock.tsx` | 45, 76, 78, 84, 668, 702–703 | prose and a quoted Greg passage |
| `src/web/page-title.ts` | 98 | `toc: "Contents"` in `MODE_LABEL` |
| `src/web/page-title.ts` | 251–252 | `spec.mode ?? "toc"`, `mode === "toc"` |
| `src/web/page-title.ts` | 241, 338 | prose |
| `src/web/App.tsx` | 1130 | `const inMode = mode !== "toc"` |
| `src/web/App.tsx` | 1817 | `setMode("toc")` |
| `src/web/visitor.ts` | 163 | `if (mode === "toc") return null` |
| `src/web/layout.ts` | 114, 396 | comments naming `mode !== "toc"` and "the dock's Contents button" |
| `src/web/styles.css` | 4931 | the comment listing what the middle band can be |
| `src/web/ChatPanel.tsx` | 11 | a quoted Greg passage |

**Tests:** `tests/url-state.test.ts:388` (`defaultValue`), `tests/page-title.test.ts:62,82`,
`tests/visitor-gaps.test.ts:210`.

**Step — leave alone:** all of `src/pipeline.ts`, `src/jobs.ts`, `src/types.ts:1597` (`StepName`),
`src/models.ts:301`, `src/ai-call.ts:193`, `src/toc.ts:707`, `src/store/pg.ts:1338–1340`,
`src/store/pg-revisions.ts:1061`, `src/store/artifacts-fs.ts:499`, `src/store/import.ts:975`, and
**`src/web/Metadata.tsx:678`** — that last one is `stage.step === "toc"`, a step in the metadata
page's pipeline display, sitting in a client file among mode code. It is the one hit most likely to
be renamed by accident.

**[corrected] The table above is a starting point, not the sweep.** Sol found material omissions,
so § 3.3 must be redone as an exhaustive acceptance sweep before the rename is called done. What it
found missing: mode-bearing URLs in `src/types.ts:1992` and `src/routes.ts:1718`; further mode and
visible-label references in `src/web/App.tsx:1122–1135` and `:1800–1820`, `src/web/Dock.tsx:297–301`
and `src/web/library-hits.ts:108`; a second visitor test at `tests/visitor-gaps.test.ts:98`; and
active docs at `docs/project/url-state.md:170`, `docs/project/glossary.md:124` and
`docs/project/web-client.md:88`. It also confirmed `src/web/Metadata.tsx:678` is a step reference
that must stay `"toc"` — **and that `STAGE_ICONS.toc` at `src/web/Metadata.tsx:222` is a second
one**, which I had missed.

**Docs:** `docs/project/glossary.md:61,117`, `docs/project/ideas.md:65`,
`docs/project/search.md:49` (three ASCII dock diagrams — `⊞Contents` becomes `⊞Hierarchy`, and the
box rules need re-padding), `docs/project/keyboard.md:112–118`,
`docs/project/page-titles.md:113,290`, `docs/project/web-client.md:73`,
`docs/project/performance.md:501`.

`docs/project/page-titles.md` needs thought rather than substitution: it argues about the *length* of
the word, and "Hierarchy" is 9 characters where "Contents" is 8.

**Not rewritten — historical records.** `docs/plans/*-sol.md`, `*.activity.log` and
`docs/postmortems/` are transcripts of what was said at the time. Rewriting them would falsify the
record. Same for Greg's dated quotations: where he said "Contents", the blockquote keeps "Contents"
and the surrounding prose explains. Flagging this as a decision rather than an oversight.

### 3.4 Outline sits next to it

An `outline` mode landed at HEAD (`ea4102a`) hours before this plan. Its own plan calls it *"the
first mode that is a second answer to a question an existing surface already answers"*, added so Greg
can compare the two ([`src/web/params.ts:252`](../../src/web/params.ts)). Hierarchy and Outline are
near-synonyms sitting next to each other in the dock. Greg was asked and said go ahead
(2026-08-29). Recorded because if Outline wins, one of these two names is going away.

---

## 3.5 What actually landed

All of § 4's order, in three commits:

1. **Measured first** — § 2.4. The answer (4%) is why § 2.4 now opens with a warning rather than a
   promise.
2. **`0aa30ac`** — `inputFingerprint` and `isStale` in [`src/arc.ts`](../../src/arc.ts) over blocks +
   tree + the three metadata fields `articleText` sends; a `stamp` on the arc step; the `arc` case in
   Postgres's currency switch and four columns added to its `metadata` projection; `sourceHash` on
   `Arc`. [`tests/arc-freshness.test.ts`](../../tests/arc-freshness.test.ts), 13 tests, red first.
3. **`837df17`** — the rename, § 3. Including `DEFAULT_MODE`, `withMode` dropping the parameter when
   it is the default, a legacy-`?mode=toc` test, and
   [`tests/dock-mode-urls.test.ts`](../../tests/dock-mode-urls.test.ts) — which was watched failing
   against the old unconditional `set`.
4. **The deferral** — `arc` out of `DEFAULT_INGEST_STEPS` and into `FORCE_ONLY_WHEN_NAMED`;
   `GET /api/arc/:slug` with `loadArc` on the reader contract and both stores;
   [`src/web/useArc.ts`](../../src/web/useArc.ts) mounted in `OwnedReader`; the `arc-pending` state
   on the L0 column; [`tests/visitor-arc-gap.test.ts`](../../tests/visitor-arc-gap.test.ts).

**One test had to be rewritten rather than fixed**, and it is the interesting one:
`tests/jobs.test.ts` § *"keeps `arc` in the cascade, because it cannot check itself"*. Its name was
the old specification and its reasoning was correct at the time. The stamp makes it false, so it is
now *"lets `arc` out of the cascade, now that it CAN check itself"*. Four other assertions in that
file expected `arc` to be swept in by position and no longer are.

## 4. Order of work

**[corrected] Reordered on Sol's finding 9.** The first draft removed arc from the defaults before
the client could reliably start or read it, which leaves an unsafe gap if the work ships across more
than one deploy.

1. **Measure the baseline.** Before anything changes.
2. **Add the freshness check** — blocks + tree + metadata — and the Postgres status logic, *while
   arc is still a default step*. Red test first, including the forced `steps: ["toc"]` case that is
   already broken today.
3. **Add the narrow read route**, owner auto-start with its StrictMode ref, local arc state, and
   stale-arc suppression.
4. **Settle the visitor / legacy-arc question** (§ 2.2) — Greg's call, see below.
5. **Only then** remove arc from `DEFAULT_INGEST_STEPS` and add it to `FORCE_ONLY_WHEN_NAMED`,
   together in one commit.
6. The rename, separately.
7. Update the architecture docs that currently state arc has no hash and is protected by the default
   cascade: `docs/project/architecture.md:173–203`, `docs/project/ingest-queue.md:393–430`,
   `docs/project/database.md:126–135`.

The first draft claimed steps 1 and 2 were "worthless apart". **Sol is right that this is wrong**:
the freshness check fixes the existing explicit-`toc` hole on its own, and is worth landing whether
or not the deferral follows.

## 5. Questions, and where they landed

All five went to Sol; four are answered and folded in above.

1. *Is blocks+tree enough?* **No** — metadata too (§ 2.1). And a recut tree with identical ranges but
   reworded gists **does** need a re-run, because the prompt is built from titles and gists.
2. *Refetch or a narrow route?* **Narrow route**, with three states (§ 2.3).
3. *The visitor case?* **Not good enough** — and worse than described, because it catches the
   existing library too. **Open: Greg's call** (§ 2.2).
4. *Keep arc in the defaults behind a flag?* Superseded by the answer to 3 — a second non-blocking
   job is the better shape than a flag.
5. *Anything mis-sorted between mode and step?* Nothing mis-sorted, but the sweep was **incomplete**
   (§ 3.3).

Sol also confirmed § 0's sanitiser quotations are fair and not selective, having read the
surrounding docstrings.

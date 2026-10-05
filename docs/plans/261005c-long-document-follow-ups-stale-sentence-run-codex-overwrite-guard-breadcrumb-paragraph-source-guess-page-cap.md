# Long-document follow-ups: four small fixes, and four write-ups

Up: [plans.md](../project/plans.md)

Queue item `qi-k9xnhcje`, from the debrief of
[261005a](261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md)
(`93620b647`). Eight findings, lettered (a) to (h) as the queue item letters them. The item asked
for (a), (e), (f), (g), (h) to be fixed and (b), (c), (d) to be written up. After diagnosis, **(a)
moves to the write-ups**: it is not a small fix and it carries a product question. The reasons are
in its section.

One stage, four independent fixes, one commit each. Each is red first.

## The fixes

### (e) The "not built yet" sentence

`ARTICLE_TOO_LONG_FOR_ONE_PASS` in `src/messages.ts` tells the reader that "reading a long piece in
sections is not built yet". Since 261005a, structure and labels do exactly that, and no longer show
this message. About twenty other steps (`budgetFor` callers: glossary, ideas, quotes, arc, …) can
still raise it, so the message stays; only the untrue clause goes.

New wording:

> This article is longer than this step can handle in one go. Trying again will not help — the
> article is the same length each time — but a shorter piece will work. [ai-too-long]

Test: `tests/messages*.test.ts` or `tests/token-budget.test.ts` asserts the message does not say
"not built yet". Comments nearby that repeat the claim are corrected too.

**Passed over:** naming which steps do read in sections. The reader cannot act on it.

### (f) `run-codex.ts` overwrites a reviewer's own report

When a write-capable reviewer writes its report to the `--output` path itself, the wrapper then
copies codex's one-line last message over it (`copyFileSync(outFile, answerPath)` near the end of
`main`, and the `--launch-dir` copy above it). The report is lost.

Fix: snapshot the target before the run (absent, or its mtime and size). After the run, if the
target was created or changed during the run **and** its content differs from the last message, the
reviewer wrote it: leave it alone, write the last message beside it as `<target>.last-message.txt`,
and say so on the console. Otherwise behave as now — a stale file from an earlier run is still
overwritten, which is what makes a fresh answer distinguishable from a stale one.

One pure helper pair in `scripts/subagent-cli.ts` (`snapshotWriteTarget`, `placeAnswer`), used by
both copy sites in `run-codex.ts`. Tests in `tests/run-codex.test.ts` on real temp files: reviewer
wrote the target (kept, sidecar written); target untouched during run (overwritten); target absent
(written); target changed but identical to the last message (no sidecar).

`run-claude.ts` has the same shape. It is checked, and given the same helper if the same overwrite
is reachable there; if it is not a one-line reuse, it is reported instead.

**Passed over:** refusing the run when `--output` is inside a writable sandbox. That breaks the
ordinary case, where the reviewer does not write the file.

### (g) A paragraph's label as the breadcrumb's "section"

Diagnosis (reproduced with the real `buildTree`, `buildSummaryTree`, `crumbPath`): the cause is not
the long-document builder. A model-built tree is ragged — a chapter may have no sections, so its
paragraphs sit at depth 2 while other chapters' sit at depth 3. `sectionDepth` is one global number
(`leafDepth - 1`), so cutting the summary tree there keeps those depth-2 paragraphs as the chapter's
children, and `crumbPath` (`src/web/crumbs.ts`) names one as the section.

Fix, in `crumbPath`: stop the walk at a child that is a stored leaf (`next.node.children.length ===
0` and not a supplement). The file's own header already promises "never a paragraph".

Test in `tests/headings-crumbs.test.ts`, built with the real functions: a tree with "Chapter One"
(two sections) and "Afterword" (none); the trail in the Afterword is `["Afterword"]`. The existing
hand-built helper in that file gives every node `children: []` and has to be made to build real
children, or the existing cases go red for the wrong reason.

Browser check by a Sonnet subagent at desktop, iPad and phone widths.

**Not fixed here, reported:** the same ragged shape makes `buildSections`
(`src/web/position.ts`) emit one-paragraph "sections" with empty titles, which `?at=` and
Structure's arrow keys step through. Fixing that changes what a section address means, so it is a
finding for the queue, not part of this fix.

**Also not a bug:** in a bounded (long-document) tree, a chapter with no sub-headings gets window
sections titled with a paragraph's opening words, by design (`titleFrom: "opening-words"`). Whether
a reader should see those in the breadcrumb is a product question, listed below.

### (h) A 500 from `/api/source-guess` on an upload

Diagnosis (reproduced): deterministic, not a flake. An upload may have 250 pages
(`src/uploads.ts`); source-guess reads the first pages through `pass0` with `maxPages: 150`
(`PASS0_MAX_PAGES`, `src/source-guess-run.ts`). `pass0` refuses a 151-page PDF with `TooManyPages`,
which has no status, so the route answers 500. It happens twice per long upload, then the second
failure is stored as `none / provider-failed` — a false reason — and the search for the paper's
source never runs. Nothing shows on screen; the cost is two error logs and no source link for any
long upload.

Fix:

1. `defaultFirstPages` no longer refuses by page count. Only `FIRST_PAGES` pages are used, so it
   reads those and stops: an `AbortController` aborted from `onPage` once `FIRST_PAGES` have been
   read, if `pass0` then still yields the pages read; otherwise a small `firstPages` option on
   `pass0` that ends its loop early. The implementer picks whichever `pass0` supports with fewer
   changes, and says which.
2. A failure to read our own stored source (anything thrown from the first-pages read that is not
   the deadline) settles `none` with a new `GuessWhy`, `"source-unreadable"`, and returns it. It is
   not the provider's failure and a retry reads the same bytes.

Tests in `tests/source-guess-run.test.ts`: a 151-page PDF through the real `defaultFirstPages`
returns its first pages (red today: `TooManyPages`); and the harness's `firstPages` fake throwing a
plain `Error` resolves `{ status: "none" }` with store log `["claim", "finish"]` and no allowance
taken (red today: rejects).

Uploads that already stored `none / provider-failed` for this reason stay as they are. Not
backfilled: it is a missing link, never a wrong one, and a backfill is a write to readers' data.

## The write-ups

Each has a recommendation. None is built here.

### (a) Tens of thousands of short paragraphs outlast the labels job — moved here

A 120,000-paragraph page plans about 2,000 label batches. Labels is its own one-step job, four
batches wide, checkpointed per batch. A job gets three 740-second windows in total
(`REQUEUE_BUDGET = 2`, `src/jobs.ts`), whether or not a window made progress. So the labels end
`failed` with a Retry card, and the document finishes only if the reader presses Retry about every
37 minutes.

**Why it is not fixed here.** The correct fix is a rule that a window which made durable progress
does not spend the budget, with a ceiling. That needs a new column on `jobs`, a migration, a change
to the job store's contract and both requeue paths (cooperative pause and lapsed lease), about eight
files. The version without a migration leaves the lapsed-lease path blind and has no ceiling. And
past the engineering there is a product question the fix would answer by default:

- two thousand paid model calls for one article, with no spend cap anywhere, and labels spends no
  quota slot;
- the reader's tab has to stay open for hours, because only the browser drives the job;
- the job holds one of six global job slots throughout.

**Recommendation:** build the progress rule (new `jobs.stalled_requeues`, reset by the first
checkpoint write of a claim; requeue while `stalled_requeues < 2` and `requeues < 40`) as its own
plan — but only after Greg decides whether a document this size should get labels at all. The
cheaper product answer is a stated ceiling: above N label batches, the article keeps its authored
headings and opening-words titles and labels are not attempted. `[Q-label-ceiling]` below.

### (b) Nothing estimates whether a call's input fits

`budgetFor` budgets the answer. Nothing checks the request. One 10 MB paragraph makes a 60-block
labels batch of about 2.7 million tokens, and a structure slice overflows the same way. The provider
refuses, and the reader gets a generic failure.

**Recommendation:** build it, as engineering with no product trade-off. One shared estimate beside
`budgetFor` (rendered characters ÷ the repo's existing chars-per-token figure, against the model's
input allowance). Structure takes the bounded headings tree when the input does not fit, as it
already does when the answer does not. Labels sends a deterministic excerpt (opening and closing
words) of any block over a stated size; the block's id and the article text are untouched. Small,
and it makes a pathological paragraph a labelled paragraph instead of a failed article. Queue it.

### (c) More than 1,096 top-level sections and Arc refuses

`generateArc` budgets `300 + parts × 80` answer tokens plus 40,000, against 128,000. At 1,097 parts
it refuses before any call. The article still opens and reads; Structure's coarse list and
Marginalia lack the Arc sentences, and the Arc job shows as failed.

**Recommendation:** do not build grouped Arc yet. A piece with over a thousand top-level headings is
a reference work, and a one-sentence arc per part of it is of doubtful use. The cheap, honest step
is to make the refusal quiet: above the cap, Arc is not requested, and nothing shows as failed.
Build grouped generation only if a real document turns up that wants it.

### (d) Checkpoint reads and writes have no time limit

The structure slices keep a reserve of time to finish in, but a checkpoint read or write that
stalls is awaited without a deadline. `src/db/client.ts` sets no statement or query timeout at all,
so this is true of every database call, not only checkpoints.

**Recommendation:** fix it at the pool, not in the slices: a `statement_timeout` (and a client-side
`query_timeout`) on the shared pool, sized well above the slowest legitimate query. It is one
setting, it bounds every caller, and it turns a hang into an error the existing failure paths
already handle. It needs a measurement first (the slowest real query in production logs), so it is
its own small plan. Racing individual checkpoint writes against a timer is the option to avoid: a
write abandoned mid-flight needs a persistence policy nobody has written.

## Questions for Greg

- **`[Q-label-ceiling]`** — (a) above. Should a document with tens of thousands of paragraphs get
  AI labels at whatever it costs, or stop at a stated size? Recommendation: a stated ceiling first.
- **`[Q-window-crumb]`** — in a long document, a chapter with no sub-headings shows "Chapter ›
  first words of a paragraph…" in the breadcrumb, by design. Keep, or show the chapter alone?
  Recommendation: show the chapter alone; the opening words are a navigation aid in Structure, not
  a section name.

## Log

- 2026-10-05: plan written after three diagnosis subagents (a, g, h). (a) moved from fix to
  write-up.
- 2026-10-05: GPT Sol's plan review
  ([261005c-long-document-follow-ups-plan-review-sol.md](261005c-long-document-follow-ups-plan-review-sol.md)):
  build with changes. All nine findings accepted; the next section is what changed.

## What the plan review changed

Where this section and the text above disagree, this section wins.

- **(e), G8:** the developer message in `TooLongForOnePass` (`src/token-budget.ts`) says "not built
  yet" too. It is in scope.
- **(f), G1:** the snapshot is the target's content (a hash), not its mtime and size. A changed
  target is evidence that something wrote it during the run, not proof of who.
- **(f), G2:** freshness belongs to the final credential attempt. The snapshot is taken before each
  attempt. A target the final attempt did not touch is not that attempt's answer and is replaced by
  its last message as now; if an earlier attempt of the same invocation wrote it, those bytes are
  moved aside (`<target>.earlier-attempt.txt`) rather than destroyed. One rule: nothing written
  during this invocation is destroyed.
- **(f), G3:** the snapshot is taken after preflight (`sameWriteTarget` can create an empty file) and
  on the effective target, the `--launch-dir` default included. `run-claude.ts` has the same
  overwrite and gets the same helper; a kept report must not make an empty result pass its
  answer-usability check. Tests at the wrapper level with a stand-in child as well as on the helper,
  if the wrappers' existing tests have such a stand-in; if they do not, the helper tests plus a
  note of what is unproven.
- **(g):** confirmed sound. "Block leaf", not "paragraph". Keep positive cases for cut sections and
  supplements when the hand-built fixture is repaired.
- **(h), G4:** aborting `pass0` rejects; it does not yield pages. So: a `firstPages` option on
  `pass0` that bounds its loop, and source-guess stops passing the 150-page cap. The test asserts
  the first pages' actual text and that page three is never requested.
- **(h), G5:** part 2 (settle `none / source-unreadable` on any read failure) is **cut**. The catch
  covers the storage read as well as the parse, and a storage failure is transient; nothing cheap
  tells the two apart. With G4 the known cause is gone, and what remains is a real fault that
  should stay a 500 and be retried.
- **(a), G9:** the failure depends on how long a batch takes, which is unmeasured: at 10 s a batch
  the document needs about seven windows, not three. It is a risk, not a certainty. And the job
  holds a global slot while running, not while queued between claims.
- **(b), G6:** "nothing checks the request" overstated it. `src/structure-cascade.ts` already
  estimates whole requests against `maxRequestTokensPerBatch`. What is unchecked is the
  whole-document call, the slices and labels. The estimate has to cover the complete rendered
  request — instructions, outline, crumbs and gists, context blocks and the target text, with room
  kept for the answer — so excerpting an oversized block is not enough on its own, and the slices
  need the guard as well as the whole-document call.
- **(c):** apply the "not requested above the cap" rule to the automatic request and to the
  server's own generation, so a manual request or a reopen cannot recreate the failed job. That
  such a document is a reference work is my inference.
- **(d), G7:** two settings are not enough, and "bounds every caller" was wrong. Pool checkout needs
  `connectionTimeoutMillis` or it can wait for ever before any query timeout applies; `pg`'s
  `query_timeout` returns an error without cancelling the query, so a write can still land
  afterwards. The plan for (d) has to cover acquisition, check what the server-side timeout does
  through the production transaction pooler, and say what a caller does about a write whose
  outcome is unknown.

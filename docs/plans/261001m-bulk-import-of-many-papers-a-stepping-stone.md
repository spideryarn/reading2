# Bulk import of many papers: a stepping stone

Status: planned 2026-10-01, plan review pending. Feedback report `spya-chhzxv`, Greg's own (admin).

> And one way to do this would be to make it easy for people to upload, you know, potentially
> thousands of papers, you know, as PDFs or whatever, and to then do really minimal processing on
> them and only go deep in the processing if they request it for particular ones. And we probably
> wouldn't charge them for most of those papers. … I think what we'd say is you can upload as many
> as you like, but the limit only applies to the ones on which you do the AI processing. … in an
> ideal world, we'd be able to say process a paper without AI for a tenth of a penny. … I think the
> other thing we'd need is a way to do batch imports so that you could upload a thousand papers in
> one go or whatever. … it would need to sort of queue and do things in parallel with whatever
> concurrency, perhaps adaptively, and be idempotent so you could just keep on uploading the same
> batch and it would only deal with the ones that haven't already been uploaded. … if you think
> this is really complicated and there's no sort of reasonably simple 80-20 solution, then stop and
> let's discuss. If you can see a way to do a decent job or at least a stepping stone that will get
> most of the way without too much complexity and that's a stepping stone in the right direction,
> then proceed autonomously.
>
> — Greg, 2026-10-01 (the full text is in the report's note)

## The request, in four parts

1. **Batch upload.** Many files in one go, queued, a few at a time, and idempotent: re-dropping the
   same folder does only the files not already in.
2. **A near-free "minimal" import.** Title, authors, abstract, for about $0.001 a paper and never
   more than $0.01.
3. **Import levels** chosen at import time: minimal / some (structure and summary) / all main modes.
4. **Billing**: the slot limit counts only papers that got AI processing.

## What the code says today (the evidence)

Two subagent surveys and two spikes, 2026-10-01.

- **There is no such thing as an article without AI.** An uploaded PDF's `extract` step is a model
  transcription ($0.007–0.12 a paper, [260902g](260902g-estimate-article-ingestion-and-mode-generation-costs.md)),
  and an article cannot reach the shelf without blocks *and* a tree from `hierarchy`, a Sonnet call
  ($0.05–0.36). `reasonsNotToPublish` in `src/store/pg-revisions.ts` refuses anything less, and
  `listArticles` drops a row with no tree. So a "minimal" article would mean a new kind of article
  that the publish gate, the shelf, the reading view, export and search all have to learn about.
- **Re-runs are free.** `POST /api/jobs {slug, steps}` reserves no slot
  ([billing.md § Which requests spend a slot](../project/billing.md)). If a minimal import were
  free and "process it fully" were a re-run, the whole pipeline would be free. So part 2 is not
  separable from part 4: whatever the minimal level is, *upgrading* one must go through the
  admission wall.
- **Free metadata without a model is unreliable.** The spike over the 14 eval PDFs
  (`evals/pdf/…`): the PDF's own Info title was right once in ten (it is usually empty or
  "Microsoft Word - …"); a largest-font-on-page-1 heuristic got the title 4/10 on the hard title
  fixtures, authors about 5/10; an abstract after an "Abstract" heading 6/10; a DOI is in the text
  4/10, an arXiv id 2/10. pdf.js does it in about 100 ms a paper.
- **A cheap model on the text of pages 1–2 does it, for half the budget.** Spike 2: `openai/gpt-5.6-luna`
  (the repo's quick model), reasoning effort low, JSON out, the pdf.js text of pages 1–2 capped at
  6,000 characters. Titles 13/13 (all ten hard title fixtures), authors 13/13 with no affiliation
  noise, abstracts present on 10 and correctly null on the 2 with none, a DOI on 4 of the 5 that
  print one, and the injection fixture not obeyed. **About $0.0005 a paper** (15k input and 3.3k
  output tokens over 13 papers, at Luna's listed $0.20/M in and $1.20/M out; OpenRouter itself
  reports `cost: 0` because the key is BYOK, so the figure is from token counts and was checked
  against `upstream_inference_cost` on a probe). That is **about $0.53 per 1,000 papers**, and
  1–6 s a paper. Not tested: scans with no text layer, which would need the model to read the
  page image and would cost more.
- **Upload is one file at a time by design** (`ONE_UPLOAD_AT_A_TIME`, `src/web/uploadEngine.ts`;
  `UploadPicker` refuses a multi-file drop with *"One at a time, please"*). The browser hashes
  every file (sha256) before sending it, and an uploaded PDF's `article_revisions.raw_sha256` is
  that same hash, so "is this file already on my shelf" is one indexed-enough query.
- **One reader can fill the whole job queue.** The global cap is six running jobs across all
  readers (`DEFAULT_JOB_CONCURRENCY`, `src/jobs.ts`) and there is no per-reader share. A bulk
  upload that queued a hundred ingests at once would hold every slot for an hour.

## The 80/20, and the push-back

**The batch half is simple and is a step in the right direction whatever Greg decides about
billing. The minimal half is not simple, and is worthless until the billing decision is made**, so
it is proposed here and not built.

Why minimal is not the stepping stone: the only reason to make an import minimal is so that it does
not cost a slot (otherwise the reader may as well have the full import they paid the slot for). That
is the billing change, which is a defence and Greg's. Building a minimal level first would build the
hard part (a second kind of article, or a second kind of shelf row) whose payoff is gated on a
decision not yet taken.

**Push-back on the shape of "minimal".** The obvious version, *a minimal article on the shelf that
you can later process*, is the expensive one: every view in the app assumes an article has prose,
blocks and a tree. The simpler version, proposed below, is **not an article at all**: a list of
*papers you have but haven't read yet*, each a stored PDF plus a title, authors and abstract, with
a *Read this* button that runs the ordinary import on the file already stored. Nothing that reads
an article has to change, and the upgrade is the ordinary admitting route, so no bypass exists.

**And on "adaptive concurrency"**: a fixed small number is enough. The bottleneck is not the
browser's upload bandwidth but the shared job queue (six slots for everybody), and the right
number for that is "a few of yours at once", not whatever the network will take. Adaptive
throttling is machinery with nothing to adapt to yet.

## What this ships (Stage 1–2)

**Drop or pick many PDFs (or HTML files) on the shelf, and they import one after another, a few at
a time, skipping the ones you already have.**

```
  shelf: drop 40 files
    │
    ├─ hash all 40 in the browser (sha256, already done per file today)
    ├─ POST /api/uploads/known {sha256: [...40]}  ── read-only; answers which you already have
    │       → 12 already on your shelf (or already importing): shown as "Already in", linked
    │
    └─ the other 28 go into a browser queue, at most 2 of them in flight at once:
          grant → PUT → POST /api/jobs {uploadId}  (exactly today's single-file path, one slot each)
          … and the next file starts only when one of the two in flight has finished importing
```

- **Idempotent** by content, not filename: the same bytes under another name are skipped; a new
  version of a paper is a new file. *Already in* covers an article on your shelf whose
  `raw_sha256` matches (archived ones too — re-dropping a folder must not resurrect what you
  archived), and an upload of yours with that hash that is still importing. Duplicates within one
  drop are collapsed in the browser.
- **In flight means until the import finishes, not until the bytes are sent.** That is what keeps
  one reader's batch to two of the six global job slots, and it is the whole of the concurrency
  design: a constant, `BATCH_IN_FLIGHT = 2`.
- **Every file is today's import**: one slot each, the same quota refusal. When the quota runs out
  the queue stops, the rest are marked *Not started — out of articles* with the existing
  `QuotaNotice` link, and nothing is half-sent.
- **Level**: the existing *Generate the main modes* tick box (`src/web/auto-modes.ts`) is the
  choice, shown above the batch and read from the same stored setting. Off = today's import
  (structure and summary); on = that, then the main modes, queued per paper as each finishes, via
  `queueAutoModes`. That is two of Greg's three levels; the third is the proposal below.
- **A single file is unchanged.** One file still goes to `/add/upload/<id>` as now. Two or more go
  to the batch panel on the shelf.
- **The tab has to stay open**, as for every import today (the browser is the worker,
  [ingest-queue.md](../project/ingest-queue.md)); the panel says so. Closing the tab stops the
  queue; dropping the same files again picks up where it left off — that is what idempotence buys.
- **Caps**: at most 200 files per drop for now (a number for the panel's sake, not a defence —
  the slot limit is the defence), and each file through the existing `uploadProblem` checks.

### Stages

1. **Server: `POST /api/uploads/known`.** Signed-in, read-only, body `{sha256: string[]}` (≤ 200,
   each 64 lowercase hex), answers `{known: {sha256, slug | null, state: "article" | "importing"}[]}`
   for the caller's own articles and uploads only. A query in the store, a route, tests (red first:
   another owner's article with the same hash must not be reported; an archived one must be).
2. **Client: the batch engine and panel.** `src/web/batchUpload.ts`, a module singleton bound to
   the reader the way `uploadEngine` is, built with `createBatchUpload(deps)` so tests drive it with
   no network; it reuses `requestGrant`, `putFile` and the job POST rather than the single-file
   engine's state machine. `BatchPanel.tsx` on the shelf: one row per file, its state, a link when
   it is an article, Stop for the rest. `UploadPicker` hands a multi-file drop or pick to it instead
   of refusing. Tests for the engine (concurrency held at two until imports finish, dedupe,
   quota stop, sign-out fence). Browser check: desktop and 390px.

Done = the gates green, Sol's code review, a real browser run that drops several PDFs (two already
on the shelf) and watches them import two at a time, and the docs: `ingest-queue.md § Uploading a
PDF` gains a *Many at once* section.

## Proposed, not built: a minimal level, and the billing change it needs

For Greg; the Overseer carries it.

**Minimal import = a "to read" list, not an article.** A paper uploaded at the minimal level is
stored (the bytes are already content-addressed in Storage today) and gets one row: title, authors,
abstract, DOI, and the file's hash. It shows on the shelf in its own list, *Papers you haven't
read yet*, and *Read this* runs today's import on the stored file — through the admitting route,
so it takes a slot then.

- **Cost per paper**: pdf.js reads pages 1–2 for nothing, and the quick model turns that text into
  title, authors, abstract and DOI for about $0.0005 (measured, above): Greg's "tenth of a penny" is
  met with room to spare. A
  DOI or arXiv id in the text (about half of papers) could instead go to Crossref/DataCite, which
  `src/bibliographic.ts` already calls politely and which costs nothing but has no abstract.
- **Billing change (a defence, so Greg's)**: a minimal paper takes no slot. In its place it needs
  its own ceiling, because it still spends real money (the cheap call, and Storage): for example
  1,000 minimal papers per account per month on any paid tier, fewer on free. Without a ceiling, a
  script could upload 100,000 files at $0.0003 each plus the storage.
- **What else it costs**: a new table, a shelf section, a route, a cheap-model prompt, and the
  privacy page saying we keep PDFs you haven't opened.
- **What it gives up**: a minimal paper is not readable in Spideryarn until you press *Read this*;
  it is a card, not an article. That is the point — but it is a product call.

This is also what the "system knows me" half of Greg's message would build on: hundreds of
titles and abstracts are a cheap, honest picture of somebody's interests, readable by the reader
profile without any per-paper AI beyond the minimal call.

## Deferred, named

- Adaptive concurrency (above).
- Folders and zip files (a browser folder drop delivers files already; a zip needs unpacking).
- A batch that survives closing the tab (it would need the server to drive jobs, which is
  [ingest-queue.md](../project/ingest-queue.md)'s own open item).
- Per-reader fairness on the global queue for single uploads; the batch path is the only one that
  can flood it, and it holds itself to two.

## Simpler options passed over

- **Just lift "one at a time" and let the single-file engine run N at once.** It is a state machine
  for one transfer with a page that navigates to it; N of them means N pages. A small separate
  queue that reuses its network functions is less code than generalising it.
- **Server-side dedupe inside `POST /api/uploads`.** It would change the single-file path's
  behaviour for a reader who re-uploads on purpose; the read-only *known* route leaves that path
  alone.

# Bulk import of many papers: a stepping stone

Status: **Building** (2026-10-01, evening). Feedback reports `spya-chhzxv` and `spya-eym66s`, both
Greg's own. Greg answered § Questions for Greg the same day. His words and the design they decide
are § Greg's answers and § The build. Everything from § *The request, in four parts* down to
§ *Questions for Greg* is the plan as it stood before he answered, kept so the first review reads
against it. **Where it disagrees with § The build, the build wins.**

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

## Greg's answers, 2026-10-01

> 1 Let's say that papers for which we have done minimal AI processing (i.e. you've uploaded but
> it's basically just extracted authors & abstract, or something like that) cost 0.01x an
> AI-processed paper. So uploading 1000 papers with minimal AI-processing would use up 10
> paper-slots.
> 2 Each paper should be shown on the shelf as normal, but indicate in the UI that it hasn't been
> AI-processed yet.
> 3 Yeah, I don't see why we can't keep them. Why would it need a note in /privacy ? After all,
> they chose to upload them... and they have the option to delete them.
> 4 Yes, bulk upload only does the minimal step
> And if possible, use DeepSeek v4.1 Flash or similar (i.e. very cheap, but still pretty modern
> and smart for its price) via OpenRouter for this (but via a ZDR provider, e.g. Fireworks).
>
> — Greg, 2026-10-01

And a second report the same afternoon, `spya-eym66s`, that the Overseer folded in. It is the
original wish, and where it differs, the answers above win:

> … if you upload multiple PDFs at the same time, ideally it would be possible to do that. … by
> default, maybe it wouldn't run AI processing when you do that, only when you open each of them for
> the first time. Whereas if you upload just one at a time or import one at a time, then it would
> automatically trigger at least some of the AI processing, much as it does now. … let's look for an
> 80-20 v1 for a) allowing uploading multiple at the same time; and b) when uploading multiple at a
> time, minimise the AI processing on them until they're opened for the first time.
>
> — Greg, 2026-10-01 (report `spya-eym66s`, filed from `/changelog`)

What each answer changes:

1. **Billing.** A minimal paper costs **0.01 of a slot**. This replaces the earlier "no slot, own
   monthly ceiling" proposal: the slot allowance *is* the ceiling. A free account can add 300
   minimal papers, and a Reader 2,000 a month. Pressing *Read this* on one costs the other 0.99, so
   a paper never costs more than one slot in all.
2. **The shelf.** A minimal paper is an **ordinary shelf entry**: a thin article, not a separate
   list. This reverses the earlier recommendation of a card on a list of its own.
3. **Privacy.** Nothing new to say. `/privacy` already says *"A PDF you upload is stored as a
   file"*, and since 2026-09-06 a reader can delete any article. The page names every model a
   reader's text reaches, so the new model gets a line there. That is a fact, not a policy, and
   `tests/privacy-page.test.ts` holds it.
4. **Bulk upload does only the minimal step.** One file at a time stays today's full import.
5. **The model.** `deepseek/deepseek-v4.1-flash`, checked live on OpenRouter on 2026-10-01. It is
   on OpenRouter's ZDR list through `fireworks`, at $0.22 in and $0.66 out per million tokens. The
   route is `{ order: ["fireworks", "deepinfra", "together"], only: [the same three], zdr: true,
   require_parameters: true, allow_fallbacks: true }`. Fireworks comes first and the other two
   fall back within ZDR. Fireworks alone was tried first, and its shared pool refused 21 calls in 39
   at two in flight. **Measured and shipped:**
   [evals/results/paper-metadata-2026-10-01.md](../../evals/results/paper-metadata-2026-10-01.md).
   DeepSeek is level with Luna on authors, abstracts and DOIs, and perfect on the production route
   (26 of 26 calls). One title shape is worse: a scan whose text layer is a catalogue line sometimes
   keeps its byline. At about $0.0004 a paper it is a little cheaper than Luna. Not "clearly worse",
   so it ships, and the regression is named to Greg in the note.
6. **"Until they're opened" (`spya-eym66s`).** Opening a minimal paper does **not** start the full
   import by itself. It shows the paper — title, authors, abstract, the PDF — with *Read this* one
   click away. The reason is that opening would otherwise spend 0.99 of a slot on a click that did
   not say so, and a reader skimming twenty titles would spend twenty slots. The earlier answers
   ask for a clear "not AI-processed yet" indication, which this is.

## The build

```
  shelf: drop 40 PDFs
    │  each file hashed once in the browser (sha256, as today)
    │  at most 3 files in flight, where "in flight" lasts until that file's job has ENDED
    ▼
  POST /api/uploads {filename, bytes, sha256, level: "minimal"}
    │  402 if 0.01 does not fit; 409 "already on your shelf" if this owner has an article
    │  (archived too) or a live upload with these bytes
  PUT  <signed url>                       bytes straight to Storage, as today
  POST /api/jobs {uploadId, level: "minimal"}
    │  under the billing lock: duplicate check again, claim the upload, reserve a `minimal` row
    │  enqueue steps ["fetch", "metadata"]
    ▼
  fetch (no model) → metadata: pdf.js text of pages 1–2, ≤ 6,000 chars → DeepSeek → JSON
    │  {title, authors, abstract, doi}, checked against a schema; the DOI against a pattern
    ▼
  publish a revision with the metadata and the raw source, and NO blocks and NO tree —
  allowed only because articles.processing = 'minimal'; the reservation is charged (0.01)
    ▼
  shelf card: title · authors · "Not AI-processed yet" · abstract ▸ · [Read this]
    │
  [Read this] = POST /api/jobs {slug, process: true}
    │  admitted like an ingest, at 0.99 (the 0.01 already paid is credited)
    │  steps: today's ingest from extract on, over the stored file (Rebuild already does this)
    ▼
  the publication that lands a tree flips processing to 'full', charges the reservation,
  and marks the minimal row superseded, in one transaction: the paper totals exactly 1 slot
```

### Billing: the unit, the wall, and the 0.99

**The enforcement unit becomes points, 200 to a slot.** A private ingest costs 200, a public one
100, and a minimal paper 2. Half-units do not stretch to 0.01, because Greg's sentence needs a
hundredth of a *private* slot. The rule in `src/billing/half-units.ts` survives as it was written:
nothing divides, and every count stays an integer. The change is a branded `Points` at the wall
only. Each kind of row keeps its own price constant, `wallUsed(usage)` adds them up, and
`wallBudget(limit) = limit × 200`. Tiers, deltas, proration and clamps stay in `Articles`, exactly
as now. `HalfUnits` and `Points` are both branded, so a mix of the two does not compile.

**Three admissions, each one a rule that already exists:**

| what | admits when | why |
|---|---|---|
| ingest (a URL, a single upload) | `used + 200 <= budget + 100` | today's `used < budget` in half-units, multiplied out: the same one-half overdraft, once |
| *Read this* on a minimal paper | `used + 198 <= budget + 100` | the same wall, crediting the 0.01 already paid |
| minimal paper | `used + 2 <= budget` | must fit whole, like High-powered AI: a batch never steps past the wall |

When `used` is a multiple of 100, which is true of every account today, the first row is exactly
the current rule. `tests/billing-half-units.test.ts` keeps its cases, multiplied by 100.

**The 0.99 is a supersession, not a 198-point row.** *Read this* reserves an ordinary `ingest` row.
The publication that charges it also stamps `superseded_at` on that article's `minimal` row, and a
superseded row costs nothing. So the paper's charge is exactly one ingest: 200 private, 100 public,
and frozen on delete by the existing trigger. Every sentence that counts "articles added" counts it
once, unchanged. The 198 appears only in the admission check, as a credit.

A correlated version was considered and rejected: count the minimal row only while no ingest
exists for its article. The delete trigger unlinks `article_id` on every row, so deleting an
upgraded paper would lose the correlation, and its 0.01 would come back. A stamp on the row
survives the unlink.

**The rows.**

- `ingest_events.kind` gains `'minimal'`.
- `superseded_at` is allowed only on a charged minimal row, by a check constraint.
- `in_flight` is split by kind. Today every unsettled row counts at full price, and an in-flight
  minimal reservation must cost 2, not 200.
- While *Read this* runs, the paper costs 1.01. That errs on the safe side, and it falls back to
  1.00 when the publication lands.
- A failed *Read this* releases its reservation, as any ingest does, and leaves the paper minimal
  at 0.01.

**What a reader sees.**

- `/profile` keeps its integer sentences about articles, and adds one: *"and N papers not yet
  AI-processed, at 1/100 of an article each."*
- A ratio is printed only while N is 0, the rule the public and High-powered counts already follow.
- `/admin/users` gives the minimal count a column of its own.
- The refusal for a minimal batch says how many papers still fit: `floor((budget − used) / 2)`.
  That is an exact count of the adds that would be admitted, not a rounding of usage.

**What makes it hold against a script.** Every admission is the existing shape: insert the billing
row, lock it `for update`, read usage with every unsettled reservation, and reserve under the lock,
with nothing that touches the network inside it. The minimal reservation is one more caller of that
shape, at its own cost. The tests are written red first:

- the boundary: 2 points left is admitted, 1 left is refused;
- twenty concurrent minimal reservations against a budget that fits ten admit exactly ten;
- *Read this*: 198 left is admitted, 197 left is refused;
- superseding, then deleting, then sharing an upgraded paper totals 200, 200 and 100 points.

### What Opus changed in the billing design

Asked to check the reading of "costs the remaining 0.99" before the plan went to Sol. Opus agreed
that supersession is faithful and better than a 198-point row, and found the following, all taken.

- **One unit, not two.** `HalfUnits` is replaced wholesale, keeping its brand and its rules, by
  `Points`: private ingest 200, public 100, minimal 2, budget `limit × 200`. A second unit beside it
  would give two answers to "is this account full?". Every comparison left in half-units would
  silently ignore minimal rows: `atTheWall`, `privateHeadroom`, the sharing offer, High-powered
  AI's fit, and `/profile`'s `atLimit`. This supersedes the "at the wall only" paragraph above.
- **`superseded_by uuid references ingest_events(id)`, not a bare timestamp.** A check holds it to
  a charged minimal row. A trigger, or the one store function that writes it, checks that the
  referenced row is a charged `ingest` for the same article. A timestamp lets any code path
  supersede. The reference proves that an ingest paid for it, and it survives the delete trigger,
  because ingest rows are never deleted.
- **The credit is this paper's own row, not a constant.** *Read this* credits 2 only when the
  article's minimal row is charged inside the current window, which is what `used` counts. A paper
  added last month on a paid plan gets no credit.
- **One *Read this* at a time.** Under the lock, *Read this* is refused while that article already
  has an ingest reservation in flight, so two presses cannot both take the credit.
- **Refuse every free path into a minimal article.** `POST /api/jobs {slug, steps}`, Rebuild,
  on-demand modes, chat and High-powered AI all refuse a minimal article. Without that, bulk-add at
  0.01 then re-run extract onward on each paper is full processing at a hundredth of the price.
  `processing` flips to `'full'` only in a publication that settles a charged ingest, with the
  administrator exempt as everywhere. The publication supersedes the minimal row in that same
  statement, whatever route the ingest came from.
- **A retry keeps its kind.** `withRetrySlot` re-reserves through `reserveIngest`, which is an
  ingest at 200 points. A retried minimal job must reserve a minimal row again, and a retried
  *Read this* must go through *Read this*'s own admission. The reservation's kind decides it, and
  the job carries it.
- **The sharing offer leaves minimal papers out.** `articlesToShare` weights every row as one
  half-unit freed, and has no `kind` filter. It is weighted by kind now, and minimal articles are
  excluded: sharing one is refused anyway, and the offer must never name a PDF nobody has read.
- **A minimal row is always priced 2.** A minimal article cannot be shared, so its row is never
  public. It is frozen `'private'` if the paper is deleted, and costs 0 once superseded. Its price
  therefore does not depend on visibility, and a test holds that through the delete trigger.
- **Failures are free, and that is existing policy, said rather than hidden.** A script could loop
  bad PDFs through the model for nothing. At $0.0005 a call it is the *Known limit* in billing.md,
  repeated, and the answer when it matters is the same daily attempt cap.

### The thin article

- **`articles.processing text not null default 'full' check in ('minimal','full')`.** It is a
  property of the work, so it sits beside `visibility`. A minimal job creates its article as
  `'minimal'`, and the publication that lands a tree sets it to `'full'`.
- **`article_revisions.abstract text` and `doi text`**, both nullable. The title and authors go in
  the existing `title`, `authors` and `byline`.
- **The publish gate** (`reasonsNotToPublish`) accepts a revision with no blocks and no tree only
  when the article is `'minimal'` and the `metadata` step ran. Everything else is refused, as today.
- **Everything else fails closed.**
  - `loadArticle` throws a typed 409, `NOT_PROCESSED`, for a minimal article, where today it
    throws a 404. So chat, live, comments, citations, term lookup and every other caller refuses
    before it spends.
  - The reading view catches that 409 and shows the paper: title, authors, abstract, the PDF
    download and *Read this*.
  - `enqueue` refuses any `{slug, steps}` job on a minimal article, so the modes cannot be run free.
  - Sharing, High-powered AI and *Start again* refuse while the article is minimal.
  - Export skips a minimal article, and says so.
  - The public shelf and the public reader already require a tree.
- **Idempotent by content.**
  - The duplicate check runs under the owner's billing lock, which serialises that owner's
    reservations, and the upload is claimed in the same transaction. So two tabs dropping one folder
    produce one paper, not two.
  - "Already on your shelf" means this owner has an article whose revision has these bytes as
    `raw_sha256` (archived ones too, so re-dropping a folder does not bring back what you archived),
    or another upload with these bytes that is claimed and whose job has not failed.
  - An `(owner_id, claimed_sha256)` index on `uploads` serves the second (F8).

### The batch, in the browser

- **`src/web/batchUpload.ts`**, a module singleton bound to the signed-in reader, as `uploadEngine`
  is. It is built as `createBatchUpload(deps)` so tests drive it with no network.
  - It reuses `upload.ts`'s hash, grant and PUT.
  - It hashes each file once, as a stream, and never holds the whole drop in memory (F7).
- **At most three files in flight**, and in flight lasts until the job ends (F2, per tab). A
  minimal job takes seconds, so three of yours hold half the global six for seconds, not for an
  hour. A per-reader limit on the server waits until something shows it is needed.
- **It hears every ending**, not only `done`: `error`, `cancelled`, a 4xx from the job POST, and a
  job that vanishes from the list (F3). The job engine gains the seam for this, so one file never
  stalls the queue.
- **Quota stops the queue.** When the server says the next 0.01 does not fit, the rest are marked
  *Not started: out of allowance*, linked to the existing `QuotaNotice`, and nothing is half-sent.
- **`BatchPanel.tsx` on the shelf.** One row per file shows its state, then a link once it is on the
  shelf, or *Already on your shelf* for a duplicate. Stop ends the rest. The panel says the tab has
  to stay open.
- **When it applies.** A drop or pick of **two or more files** goes to the batch; one file is
  today's full import, unchanged.
- **A mix of kinds, whatever a single upload takes.** That means PDF and HTML today, sniffed off
  the bytes by `uploadedDocumentKind`, as for one file. It was PDFs only until Greg, 2026-10-01
  ~19:55: *"eym66s - for the avoidance of doubt, it should be possible to bulk-upload (a mix of)
  both PDFs and HTML etc"*. The metadata step branches on the kind (§ The metadata step).
- **Up to 1,000 files in one drop.** That cap is for the panel's sake; the allowance is the defence.

### The metadata step

`src/paper-metadata.ts`:

- **What it reads.** For a PDF, the pdf.js text of pages 1–2. For an HTML file, the main text
  from the repo's existing non-AI HTML path, with the page's own title and `citation_*` /
  description meta tags first as labelled lines. Either is capped at 6,000 characters and goes
  through one shared `extractMetadataFromText`, so the call, the fence and the validation are one
  code path. That text is untrusted document text, and the prompt fences it as data.
- **The call.** A new gateway job, `paper-metadata`, on `PAPER_METADATA_MODEL`. The JSON it returns
  is checked against a schema.
- **The DOI** must match `^10\.\d{4,9}/\S+$`, or it is dropped.
- **No text layer.** A PDF with none gets its filename as its title and no other metadata. There is
  no model call, and it still costs 0.01: the paper is on the shelf, and *Read this* transcribes it
  from images as today.
- **A model failure fails the job.** The reservation is released, and the batch row says *Couldn't
  read this one*.

Its eval, `evals/pdf/minimal-metadata/score.mts`, is committed. It scores title, authors, abstract
present or absent, and DOI against `expected.json`. It runs each model three times over the 13
PDFs and records the cost from the ledger. Luna's numbers are the bar.

### What Sol's plan review changed

[261001m-bulk-import-build-plan-review-sol.md](261001m-bulk-import-build-plan-review-sol.md)
(prompt [261001m-bulk-import-build-plan-review-prompt.md](261001m-bulk-import-build-plan-review-prompt.md)):
**build with changes**. Sol found no further way to spend AI on a minimal article, once the guards
above are built. All eight findings are taken.

1. **P0: "claimed, but no job yet" was undefined.** Without a rule, a crash between the claim and
   the enqueue either lets a second tab import the same file, or makes that file a duplicate for
   ever. **The rule:** under the lock, another upload with the same bytes counts as live in two
   cases. One is that its job is not yet terminal. The other is that it has no job at all and its
   grant (`minted_at`, two hours) has not run out. So a crash makes that file a duplicate for at
   most two hours, and then it can be dropped again. A deleted article has no revision, and its
   upload's job has ended, so deleting a paper frees it to be added again. Tests cover two tabs,
   a crash after the claim, Retry racing a fresh drop, and delete-then-re-add. A durable claim
   table, as Sol proposed, would close the two hours. It is passed over because 0.01 and a
   duplicate card, at worst, does not pay for a table and a second identity.
2. **P1: a *Read this* reservation names its article from birth.** `ingest_events.article_id` is
   set at reservation for a *Read this*, and stays null for any other ingest until it settles. A
   unique partial index allows one unsettled ingest per article. So retry can tell the three kinds
   apart (`minimal`; `ingest` with no article; `ingest` with an article, which is *Read this*),
   and two presses cannot both run. Settlement of a target-bound row charges the ingest, sets
   `processing = 'full'` and writes the minimal row's `superseded_by`, in one transaction. A match
   of zero rows, or of more than one, rolls the publication back. A tree may land on a minimal
   article with a null reservation only when the owner is verified as the administrator.
3. **P1: one currency, but separate predicates, all in one module.**
   - ordinary ingest: `used + 200 <= budget + 100`;
   - *Read this*: `used + (200 − eligibleCredit) <= budget + 100`;
   - minimal: `used + 2 <= budget`;
   - High-powered AI: `used + cost <= budget`;
   - full-ingest headroom: `max(0, floor((budget + 100 − used) / 200))`.

   `atLimit` on `/profile` means *cannot add an ordinary article*, and `sharingWouldMakeRoom` tests
   that same predicate. `describePlan` and the admin cell print a ratio only while minimal usage is
   zero.
4. **P1: the terminal seam is a contract.** The job engine gains
   `watchTerminal(jobId, callback)`, fed by both the `/advance` response and every list
   reconciliation. A job counts as *vanished* only once it was registered and a later list has
   left it out. Tests cover `done`, `error` and `cancelled`, completion while the tab is hidden,
   completion seen only through `/advance`, and a job trimmed before the next poll.
5. **P1: the stages are reordered**, so each committed stage is true on its own (below).
6. **P2: `article_revisions.raw_sha256` gets a partial index too**, and the duplicate query is
   checked with `EXPLAIN`.
7. **P2: no streaming hash.** One hashing worker reads a file's `arrayBuffer()` when it reaches
   the front of the queue, keeps the digest, and passes it to the grant. So each file is hashed
   once, one file at a time, and the drop is never all in memory together.
8. **P2: three per tab is backpressure, not a defence**, as stated above. Accepted.

### Stages

1. **The extractor and the model.** `paper-metadata.ts`, the gateway job and its route, and the
   eval, run on DeepSeek and on Luna. *Gate: if DeepSeek is clearly worse, stop and tell Greg.*
2. **Billing arithmetic.**
   - `Points` in place of `HalfUnits`, and the predicates module.
   - The ledger migration: `kind 'minimal'`, `superseded_by` and its checks, and the one-upgrade
     index.
   - `reserveMinimal`, the target-bound reservation for *Read this*, kind-preserving retry, and
     the in-flight split.
   - The `/profile`, `/admin` and voucher surfaces.
   - Red-first boundary and race tests.
3. **The thin article, on the server.**
   - The migration: `processing`, `abstract`, `doi`, and the two hash indexes.
   - The `metadata` step, and `level: "minimal"` on the upload and job routes.
   - The duplicate check under the lock, the publish gate, and the target-bound settlement that
     flips `processing` and supersedes the minimal row.
   - `listArticles`, the `NOT_PROCESSED` 409, and the guards.
   - `POST /api/jobs {slug, process: true}`.
4. **The browser.**
   - The job engine's terminal seam, `batchUpload.ts` and `BatchPanel.tsx`.
   - The shelf card's marker and *Read this*.
   - The reading view's not-processed page.
   - A real browser drops a folder of PDFs, two of them already on the shelf, at 1280px and 390px.
5. **Docs and the note.**
   - `billing.md`, `ingest-queue.md` § *Many at once*, and `library.md`.
   - `setup-dev.md`'s model table, and `/privacy`'s model line.
   - The feedback note, and a line to the Overseer naming the migrations.

Each stage gets Sol's code review, and the gates are run, before it is committed.

### Deferred, named

- A per-reader share of the global job queue (above).
- A batch that survives closing the tab.
- Zip files in a batch.
- Real metadata for scans with no text layer (it needs the page image, and more money).
- Confirming a DOI through Crossref or DataCite.
- Searching minimal papers by their abstracts, and embeddings of them (`spya-eym66s`'s
  "searchable"). The abstract is stored, so this is a later step that needs no new import.
- The reader profile reading the abstracts: the "system knows me" half of `spya-chhzxv`.

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
  page image and would cost more. These figures are from the raw-call version of
  `evals/pdf/minimal-metadata/cheap-model-spike.mts` (20abc3379). Since
  [261001o](261001o-route-the-cheap-model-metadata-spike-through-the-gateway.md) the script calls
  through the gateway and its spend reaches the ledger. The gateway's `eval` job sends no effort,
  though, so a re-run measures Luna at the provider's default effort, not `low`, and will probably
  cost more.
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

## Outcome: stop and discuss

GPT Sol's plan review ([261001m-review-plan-sol.md](261001m-review-plan-sol.md), prompt
[261001m-review-plan-prompt.md](261001m-review-plan-prompt.md)) came back **rethink**, and the
findings are right:

| id | sev | finding | where it leaves the batch build |
|---|---|---|---|
| F1 | P0 | `/known` is read-before-write: two tabs both hear "new", both import, both take a slot | idempotency needs an atomic owner+hash claim on the server |
| F2 | P1 | "two in flight" is per tab, not per reader, and does not see the single-file engine | a per-owner limit on the server, or no fairness claim |
| F3 | P1 | the client hears only `done`; an `error`, a `cancelled` or a hidden tab stalls the queue | a terminal-state seam in `jobEngine` |
| F4 | P1 | "importing" is not one upload state; `pending` may be abandoned bytes | an explicit state policy |
| F5 | P1 | the main-modes box defaults on: 200 papers would queue ~1,200 mode jobs and fill the queue | batches default off, inside the backpressure |
| F6 | P1 | the minimal "upgrade" needs a new admitted route; the `{uploadId}` path cannot reuse a verified upload | design detail for the minimal build |
| F7 | P1 | every file hashed twice, whole in memory | hash once, bounded |
| F8 | P2 | neither `raw_sha256` nor uploads-by-hash is indexed | two partial indexes |

**So the batch half is not the simple stepping stone this plan took it for.** Fixed properly it is
an atomic claim, a server-side per-owner limit, a terminal-state seam, a state policy and two indexes
— and what it buys is still only *a reader's remaining quota* in one drop (a few dozen papers), not
the thousands Greg described. Sol: *"the full-import batch is also not 'most of the way' to
thousands — the reusable parts are file selection, atomic owner/hash registration, storage, and
status UI, while the full-ingest completion scheduler is specialised work."*

**And the minimal half, which is the real stepping stone, waits on a billing decision**, because
its only point is that it does not cost a slot. That is a defence and Greg's.

Opus was asked to arbitrate between (A) build the fixed batch, (B) build something smaller, and
(C) stop. It picked **B: the metadata extractor alone, as a library function with a scored eval**,
because every shape of "minimal" needs it. **Overruled, on Greg's own instruction** — *"if you think
this is really complicated and there's no sort of reasonably simple 80-20 solution, then stop and
let's discuss"* — because a function nothing calls is not a stepping stone a reader can stand on,
and it is about an hour's work for whoever builds the minimal level once the questions below are
answered. What Opus wanted from it is recorded under *When it is built* below.

What this session leaves on `dev`: this plan, the review, and the two spikes in
[`evals/pdf/minimal-metadata/`](../../evals/pdf/minimal-metadata/), which answer the cost question.

## Questions for Greg

**The background, in plain words.** Today every paper you add gets the full treatment: a model
reads the whole PDF and turns it into text (a few pence to ten pence), and another builds the
structure and summary (five to thirty-five pence). That is what a "slot" pays for. There is no way to
add a paper *without* that, and the shelf only knows how to show papers that have had it.

**The good news, measured today:** the cheap thing you hoped for exists. A small model reading only
the text of a paper's first two pages got the title and authors right on all 13 test papers, found
the abstract wherever there was one, and costs **about $0.0005 a paper — 50p per thousand**, half
your "tenth of a penny". Without any model at all, the title is right only about half the time, so
the model is worth its 0.05p.

**What I would build once you answer**, the simplest version:

```
  shelf
  ├─ your articles (as now: read, modes, everything)
  └─ Papers you haven't read yet            ← new: a list, not articles
       ├─ "Attention Is All You Need" · Vaswani, Shazeer, … · abstract ▸   [Read this]
       ├─ …
       └─ drop a folder of PDFs here: each is stored, gets its title/authors/abstract for 0.05p,
          and is skipped if you already have it
  [Read this] = today's full import of the stored file, and THAT is when it takes a slot
```

1. **Billing: may a "haven't read yet" paper take no slot, with its own monthly ceiling instead?**
   For example: up to 1,000 a month on any paid tier, 50 on free. Something has to bound it, because
   each one still costs us 0.05p plus storage, and without a number a script could add 100,000.
   *Yes* means the shape above. *No* means minimal imports cost a slot like any other, and then there
   is little reason to build them at all. If yes: are 1,000 and 50 the right numbers?
2. **Is a "haven't read yet" paper a card on a list, or an article you can open?** A card (above) is
   much the simpler: nothing in the reading view changes, and *Read this* is the import we already
   have. An article you can open with no structure, summary or modes means teaching every mode, the
   shelf, export and search what an article with nothing in it looks like — several times the work.
   I recommend the card.
3. **May we keep the PDFs of papers people have not opened, and say so on `/privacy`?** We keep the
   file of every article today; this would be the same, for files nobody has read yet.
4. **Batches: full imports too, or minimal only at first?** Dropping 40 PDFs and having all 40 get
   the full treatment is what the reviewed plan above built, and it is the part with the hard
   concurrency problems (F1–F5). I recommend minimal-only batches first, with *Read this* one at a
   time or on a ticked handful; your three levels then become *minimal* on the drop, and *standard*
   or *all main modes* (the existing tick box) when you press *Read this*.

### When it is built

- The extractor: pdf.js text of pages 1–2, capped at 6,000 characters, to the quick model, JSON
  checked against a schema, the DOI checked against a pattern, a DOI or arXiv id optionally confirmed
  through `src/bibliographic.ts` (free, no abstract). Its eval scored and committed, several runs per
  file, cost totals recorded, more injection fixtures, scans with no text layer named as out of scope
  (Sol's last paragraph; Opus).
- An owner-scoped *paper* row keyed on (owner, sha256), unique, so a re-dropped batch is idempotent
  by construction rather than by a read-before-write (F1, F8).
- *Read this* as its own admitting route that takes the paper's opaque id, never a hash or a path,
  reserves through `withIngestSlot`, and cannot run twice (F6).
- The abstract and title are document text: fenced wherever they later reach a prompt (the reader
  profile), and a DOI validated before it becomes a link (F6).

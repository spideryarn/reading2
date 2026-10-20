# Longer documents, up to 400 pages, at one slot per 100 pages

Up: [plans.md](../project/plans.md)

Report `spya-p5x9wy` (Sentry `SPIDERYARN-READING2-M4`), Overseer queue item `qi-ajxrg7a4`. Status:
**planned, nothing built — awaiting Greg**, because the change edits the slot quota, which is a
defence listed in [security-map.md](../project/security-map.md)
([billing.md § The quota](../project/billing.md#the-quota-and-the-one-thing-it-has-to-survive)), and
an unattended run plans a defence change and asks rather than building it.

> I think we need to allow import of longer articles. Let's go up to 400 pages. But let's have a rule
> that each 100 pages counts as 1 article (in terms of the user's allotted number of articles). In
> other words, if I'm a user with 2 articles left, and I upload a 150-page article, it uses up both
> those article-slots.
>
> That user would not be able to import a 250-page article, because that would need 3 slots.
>
> Probably it should warn the user during the import process that multiple slots are being used for
> long articles. But don't block - just let them know during the import process.
>
> — Greg, 2026-10-19 (`spya-p5x9wy`)

## What it means, precisely

- **The cap** (`MAX_PAGES`, [`src/uploads.ts`](../../src/uploads.ts)) goes from 250 to 400. It is
  the only page cap; the upload dialog's limits line and the over-the-cap refusal both read it.
- **The cost of a PDF is `ceil(pages / 100)` slots**: 1–100 pages is one, 101–200 two, 201–300
  three, 301–400 four. Greg's two examples (150 → 2, 250 → 3) fix the rounding as up.
- **A web page, a Word file, Markdown, text: one slot, as today.** They have no page count, and
  `MAX_PAGES` is already a statement about PDF transcription only (`src/pipeline.ts`, the
  `kind === "pdf"` guard around `refuseAnOverlongPdf`). Their length is bounded by the 50 MB cap and
  by the structure step's slices. Named, not solved: a 2,000-paragraph web page is still one slot.
- **"Don't block" is about the warning, not the quota.** Greg's own example refuses the 250-page
  import with two slots left. So the reader is *told* when a document uses several slots, and is
  *refused* only when those slots are not there — the same wall as any import.

## Why the charge has to move to stage 1

Today a slot is reserved at the route (`POST /api/jobs`, `withIngestSlot` in
[`src/billing/admission.ts`](../../src/billing/admission.ts)), before anything is fetched. **Nobody
knows the page count then.** A pasted PDF address has not been downloaded; an uploaded file has gone
straight to Storage and has not been opened (`POST /api/uploads` asks the quota and reserves
nothing). The count is first known in stage 1, `fetch`, where `refuseAnOverlongPdf`
(`src/pipeline.ts`) already opens the PDF with `countPdfPages` to apply the cap — **before
transcription, which is where the money is**.

So: the route reserves one slot as now, and stage 1 **reprices the reservation** to the document's
slot count once it has counted the pages. A top-up that does not fit refuses the job there, with a
sentence that names the pages, the slots needed and the slots left; the reservation is released as
for any failed import, and nothing has been spent on a model.

### Options considered for when to charge

| | when the extra slots are charged | why not |
|---|---|---|
| A | **in stage 1, under the billing lock, before transcription** (recommended) | — |
| B | at settlement, when the job succeeds | Greg's 2-slots-left reader would get a 250-page article and go a slot over; a script could import N long PDFs on one slot each, all in flight at once |
| C | at the route, by counting pages first | a pasted address is not downloaded yet; an upload would have to be opened in the route, and that is stage 1's work moved into a request handler |
| D | in the browser, before upload | can never cover a pasted address, so it cannot be the wall; it is a nice early warning (deferred below) |
| E | raise the cap and keep one slot | the simplest, and not what Greg asked: a 400-page import costs us about five times an ordinary one |

## How the quota changes (the defence part — not built until Greg says yes)

**One integer column, `ingest_events.slots`, default 1, check `slots between 1 and 4`.** Every
count in `usageSql` (`src/store/pg-billing.ts`) that prices an `'ingest'` row becomes a sum of
`slots`. The alternative, extra rows of a new kind (as `high_power` did), was passed over: one row is
one import, and N rows for one import is the N : 1 ledger shape billing.md already spends paragraphs
apologising for. A column keeps "how many imports" and "what it cost" both answerable.

What then follows, each of which is a reading of an existing rule rather than a new one:

- **Public halves it.** A 150-page public article costs 2 × 100 = 200 points, one slot — billing.md
  § *A public article counts half*, applied per slot. Live, frozen on delete, exactly as now, because
  the visibility term is unchanged and only the count becomes a sum.
- **In flight costs full price, in full.** An unsettled row counts `200 × slots`, so once stage 1 has
  topped up, a second import in the same account sees all of it. Before the top-up it counts 200, as
  now.
- **The wall is the ingest wall.** The top-up admits when
  `used_without_this_row + 200 × slots <= budget + 100` — `admitsIngest` generalised to a cost, the
  same half-article overdraft, once. With two slots left: 150 pages (2) admits, 250 pages (3) is
  refused. A new predicate in [`src/billing/points.ts`](../../src/billing/points.ts),
  `admitsLongIngest(used, budget, slots)`, so nothing outside that module compares points.
- **The repricing is one claim-fenced store operation, keyed on the job**, not on a reservation id.
  The fetch step does not hold the reservation id: it lives on `EnqueueRequest.ingestEventId` and is
  deliberately kept off `Job` and `StepContext` (`src/jobs.ts`, `src/pipeline.ts`). So
  `repriceFetchedPdf(jobId, claim, pages)` resolves `jobs.ingest_event_id` itself and, in the house
  lock order — `lockBillingAccount`, then the job and its row `for update` — checks that this
  claimant still holds the job, that the row is an unsettled, unreleased `'ingest'` of the same
  owner, computes usage **minus this row's current weight**, checks the new weight, and sets it.
  Calling it twice with the same count is a no-op. Nothing that touches the network inside it: the
  page count is computed before the lock is taken.
- **Why the claim fence matters.** Every claim walks the steps again and an unfinished fetch runs
  again; after a deadline handoff an old attempt can still be finishing while its replacement runs.
  Without the fence, a stale attempt could write *one slot* over the replacement's *four*. Tests: the
  same claimant twice, a stale claimant after handoff, two claimants seeing different responses from
  one address, concurrent repricing of different jobs on one account.
- **A retry reserves one fresh slot and stage 1 reprices it again**, so a retry costs what the
  document costs; the old reservation was released when the job failed. A step re-run is free and
  has no reservation to reprice.
- **The page count is stored with the fetched source** (on the raw-source pointer the fetch step
  already writes), because two later charges need it and neither runs stage 1 again — see the next
  two items.
- **A minimal paper (bulk import) stays at a hundredth, whatever its length**: it reads three
  fields. ***Read this* does not run stage 1** — it carries the minimal paper's fetch and forces
  `extract` (`queueReadThis`, `src/routes.ts`) — so `reserveUpgrade` reads the stored page count and
  reserves that weight up front, less the paper's two-point credit, and `reservationShapeOf` carries
  the weight through a retry. A 300-page paper read in full then costs three slots, not one.
- **High-powered AI on a long document: Greg's call, not a consequence.** Today it is exactly one
  more article. Charging the document's slots again matches *"double the processing cost per
  article"*; keeping one is simpler. It is asked as its own question. If it is the slots, the switch
  reads the stored page count.
- **Jobs already past fetch when this lands are not repriced**: their fetch is done and is skipped,
  and their row defaults to one slot. Proposed: grandfather them, said out loud — the readership is
  small, and it is at most a few jobs in the minutes around a deploy. Sharing the deploy with a
  migration is the alternative, and costs more than it saves.
- **The administrator stays exempt**: no reservation, so no top-up and no warning.
- **Imports and slots are two numbers, kept apart.** `usageSql` keeps its row counts (how many
  articles were added, how many are public) and gains slot sums beside them (what they cost).
  `wallUsed` adds the sums; `ingestsUsed` and *"N articles added"* go on counting rows. So a reader
  with one 150-page article reads *1 article added, using 2 of your 3*, never *2 articles added*, and
  no surface divides points, as now.
- **`usageSql` is not the only query that counts ledger rows.** `articlesToShare`
  (`src/store/pg-billing.ts`, the conditional sharing offer) assumes each article it names frees 100
  points; a long article frees `100 × slots`. The admin aggregation (`src/store/pg-admin.ts`) and the
  columns that derive costs from it (`src/web/admin-columns.tsx`) count rows too. Each is audited
  and carries both the count and the sum where it needs both meanings.

## What the reader sees

- **Before choosing a file**, the limits line: *PDF … up to 50 MB. PDFs up to 400 pages; every 100
  pages counts as one article.* (`uploadLimits`, `src/uploads.ts`.)
- **During the import**, once stage 1 has counted: the job card says, for a document over 100 pages,
  *This PDF is 150 pages, so it uses 2 of your articles (one for every 100 pages).* It does not stop
  or ask; the import carries on. This is the warning Greg asked for. **It is persisted** — the fetch
  step's stored detail, or a field on the job row — not `StepContext.report`, which is live-only and
  would vanish when the step ends or the claim changes hands. It stays on the card until the job
  ends. Not shown to an administrator, whose imports cost no slots.
- **When the slots are not there**: the job fails in stage 1 with *This PDF is 250 pages, which
  counts as 3 articles, and your account has 2 left.* plus the existing conditional sharing offer and
  upgrade link. Seconds after starting, before anything is paid for.

## Will a 400-page document actually import? (the cost and limits side)

From the measurements in
[261004b](../investigations/261004b-big-document-imports-at-the-limits.md) and
[261005a](../plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md)
(Doctorow, 250 pages, 3,053 blocks), scaled linearly — **estimates, to be measured in stage 3**:

| | 250 pages, measured | 400 pages, estimated |
|---|---|---|
| transcription (extract) | 166 s, $0.65, 43 chunks | ~270 s, ~$1.05, ~70 chunks (under the 100-chunk concurrency) |
| structure, in slices | 131 s, $1.00 | ~210 s, ~$1.60 (5 slices of ~1,000 blocks, 8 at a time) |
| labels | 235 s, $1.62 | ~375 s, ~$2.60 (inside its 700 s budget, barely comfortable) |
| **import total** | **~$3.30** | **~$5.30, ~$1.30 per 100 pages** |
| blocks stored | 3,053 | ~5,000 (batched inserts tested to 6,000) |
| article response | 2.3 MB | **~3.7 MB, against Vercel's 4.5 MB** |

**One slot per 100 pages limits the damage; it does not pay for it.** A slot on the Reader plan is
worth $0.50 ($10 for 20), and an ordinary import costs $0.03–$0.39 (billing.md § What we sell). A
100-page block of a long document costs about $1.30 at import, so a 400-page import uses $2 of
allowance and costs us about $5.30. That is still a loss — but it is already true today, when a
250-page import costs about $3.30 for one slot, so the rule makes things better, not worse. One slot
per 50 pages would roughly break even; Greg chose 100 and the question says so. Modes run later
(glossary, quotes, chat) also scale with length and are not counted; that is true today at 250. The
estimates come from one fairly sparse book; a dense document plans more chunks
(`src/jobs.ts` says 250 ordinary pages can approach ~84), so the true upper bound is higher.

**The real risk is the article response.** A dense paper is ~14 blocks a page, so 400 of its pages
is ~5,800 blocks, and the response could pass 4.5 MB, at which point the article would not load at
all. That is already queued as `qi-sbytr395` and has never been measured on Vercel. Raising the cap
makes it reachable, so **the measurement comes first, before the cap moves**, and the cap does not
move past what loads.

## Stages, once Greg says yes

1. **Measure at 400 first.** One real 400-page PDF (a public-domain book) and one dense one through
   the local pipeline, with the cap lifted for the run only: time per step, cost, blocks, chunks, and
   the article response size. If the dense one passes ~4 MB, the cap stays at the largest size that
   loads and `qi-sbytr395` becomes a blocker. About $10–15 of model calls.
2. **The ledger.** Migration: `ingest_events.slots smallint not null default 1 check (slots between 1
   and 4)`. `usageSql` gains slot sums beside its counts; `admitsLongIngest`; the claim-fenced
   `repriceFetchedPdf`; `articlesToShare` and the admin aggregation. Tests first, red then green: the
   two-slots-left pair from Greg's message; twenty concurrent repricings on one account; the stale
   claimant; a public long article at half; delete freezes the price of all its slots; a retry; the
   admin.
3. **Stage 1 calls it, and the reader is told.** `refuseAnOverlongPdf` → count, cap, store the count,
   then reprice when `slots > 1` and the job has a reservation. *Read this* reserves its weight from
   the stored count. The persisted warning, the refusal sentence in `src/messages.ts`, the limits
   line. `MAX_PAGES = 400`. A route matrix, not only helper tests: a pasted PDF, a redirect and a
   paper-source PDF, an upload with a misleading filename, HTML, Word and Europe PMC JATS staying at
   one slot, the 100/101/200/201/300/301/400/401 boundaries, and the refusal landing before any paid
   step starts.
4. **Docs.** billing.md gains *§ A long document costs a slot per 100 pages*; ingest-queue.md,
   `/help` (it states the limits), `stated-limits.test.ts`'s numbers.

## Deferred, by name

- **A warning before upload** (option D): counting pages in the browser with pdf.js, so the reader
  knows before choosing. An early courtesy only — the wall stays in stage 1.
- **Length-pricing web pages and Word files.** No page count to price by; words would be the unit.
- **Pricing the modes by length.** A glossary of a 400-page book costs more than of a 10-page paper,
  and re-runs are free. True at 250 pages today.

## Reviews

- Plan review (GPT Sol, read-only): [261020b-…-plan-review-sol.md](261020b-longer-documents-up-to-400-pages-plan-review-sol.md).
  Verdict *do not approve unchanged*; ten findings, each checked against the code and taken. The
  plan above is the revised one. In short: stage 1 has no reservation id, so the repricing is keyed
  on the job and fenced on the claim (F1, F2); *Read this* never runs stage 1, so the page count is
  stored and reused (F3); jobs past fetch at deploy are grandfathered, said out loud (F4);
  High-powered is asked, not inferred (F5); counts and slot sums kept apart, and `articlesToShare`
  and the admin queries audited (F6, F7); the warning is persisted (F8); the cost section now says a
  slot does not pay for 100 pages, and measurement comes before the cap moves (F9); a route test
  matrix (F10).

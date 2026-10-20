# Longer documents, up to 400 pages, at one slot per 50 pages

Up: [plans.md](../project/plans.md)

Report `spya-p5x9wy` (Sentry `SPIDERYARN-READING2-M4`), Overseer queue item `qi-ajxrg7a4`. Status:
**approved by Greg 2026-10-20 (reply `spya-km9brn` to [q-x8gdr3](../user-feedback/questions/q-x8gdr3.md)),
being built.** The change edits the slot quota, which is a defence listed in
[security-map.md](../project/security-map.md)
([billing.md § The quota](../project/billing.md#the-quota-and-the-one-thing-it-has-to-survive)), so it
was planned and asked first. The file name still says *100 pages*, the price Greg first asked for; it
is kept so the question, the report note and the review keep pointing here.

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

## Greg's answers

> 1A
>
> 2A
>
> 3 hmmm, tricky. Ok, let's go with 50 instead of 100 pages per slot.
>
> — Greg, 2026-10-20 (reply `spya-km9brn` to q-x8gdr3)

1. **The charge is raised once the pages are counted**, in stage 1, before any transcription money is
   spent (option A below).
2. **High-powered AI on a long PDF charges its slots again** — a 300-page PDF is 6 slots to import and
   6 more to switch to High-powered.
3. **One slot per 50 pages, rounded up**, not per 100. That replaces the example numbers in Greg's
   report, which were written at 100: with 50, a 150-page PDF is 3 slots, a 250-page one 5, and a
   400-page one 8 — 8 of a Reader's 20, and more than a free account's 3, so a free account cannot
   import a PDF over 150 pages. Greg chose it knowing that (option B in the question said so).

## What it means, precisely

- **The cap** (`MAX_PAGES`, [`src/uploads.ts`](../../src/uploads.ts)) goes from 250 to 400, once
  stage 1 below has shown that a 400-page article loads. It is the only page cap; the upload
  dialog's limits line and the over-the-cap refusal both read it.
- **The cost of a PDF is `ceil(pages / 50)` slots**: 1–50 pages is one, 51–100 two, … 351–400 eight.
  `PAGES_PER_SLOT = 50` is one named constant beside `MAX_PAGES`, and `slotsForPages` the one
  function that does the division.
- **A web page, a Word file, Markdown, text: one slot, as today.** They have no page count, and
  `MAX_PAGES` is already a statement about PDF transcription only (`src/pipeline.ts`, the
  `kind === "pdf"` guard around `refuseAnOverlongPdf`). Their length is bounded by the 50 MB cap and
  by the structure step's slices. Named, not solved: a 2,000-paragraph web page is still one slot.
- **A minimal paper (bulk import) stays at a hundredth, whatever its length.** It reads three fields.
  Its page count is recorded, because *Read this* needs it.
- **"Don't block" is about the warning, not the quota.** Greg's own example refuses the import that
  needs more slots than are left. So the reader is *told* when a document uses several slots, and is
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
slot count once it has counted the pages. A reprice that does not fit refuses the job there, with a
sentence that names the pages, the slots needed and the slots left; the reservation is released as
for any failed import, and nothing has been spent on a model.

### Options considered for when to charge

| | when the extra slots are charged | why not |
|---|---|---|
| A | **in stage 1, under the billing lock, before transcription** (Greg chose this) | — |
| B | at settlement, when the job succeeds | Greg's 2-slots-left reader would get the long article and go over; a script could import N long PDFs on one slot each, all in flight at once |
| C | at the route, by counting pages first | a pasted address is not downloaded yet; an upload would have to be opened in the route, and that is stage 1's work moved into a request handler |
| D | in the browser, before upload | can never cover a pasted address, so it cannot be the wall; it is a nice early warning (deferred below) |
| E | raise the cap and keep one slot | the simplest, and not what Greg asked: a 400-page import costs us about twenty times an ordinary one |

## The race between reserving and raising the charge

This is the part of the design a script would attack, so it is written out.

```
route (POST /api/jobs)            stage 1 (fetch), seconds later         stage 2 (extract)
──────────────────────            ──────────────────────────────         ─────────────────
lock billing row                  download / open the PDF
usage + 200 ≤ budget + 100 ?      count pages            (no lock held)
insert ingest row, slots = 1      ── one transaction ──────────────
commit                            lock billing row
enqueue job (row carries it)      lock job row: still this claim?
                                  ingest row: unsettled 'ingest'?
                                  usage − this row + 200·slots ≤ …?
                                  set slots (and pages); commit
                                  ── refused: throw, job fails ────
                                  write raw (only if priced)  ─────▶  transcription ($)
```

**Between the two, this job is counted at one slot.** Every other admission for the account in that
window sees 200 points for it, not 200 × slots. That is the whole of the gap, and what makes it safe
is that **nothing paid can start until the reprice has committed**: the reprice is inside the fetch
step, before `writeRaw` (fetched) and before the upload is promoted to `verified`, and stage 2 cannot
run without the raw manifest. A refused reprice throws, so the raw is never written.

What the gap can and cannot do, worked through:

- **A burst of long PDFs at a free account** (budget 600 points, three slots). Twenty `POST`s: three
  admit at 200 each, as today; the rest are refused at the route. Each of the three then reprices to
  8 slots: `used without this row (400) + 1,600 > 700`, refused. **All three fail in stage 1, having
  spent nothing on a model.** The gap lets more jobs *start* than can finish, never more paid work
  than the budget.
- **Two long PDFs that would each fit alone, together.** Two slots left; two 100-page PDFs (2 slots
  each) added at once. Both admit at one slot (two used). The first to reprice sees the other's one
  slot still in flight: `+ 200 + 400 = 600 > 400 + 100`, refused; it is released when its job fails.
  The second then fits only if the first's release has committed. So both can be refused where one
  would have fitted. **Fails safe, said out loud**: the reader adds them one at a time. Not worth a
  queue.
- **A long PDF and an ordinary page together.** The page admits at one slot either way; whichever
  order the two reprice/admit in, the billing lock serialises them and the second sees the first's
  current weight. No interleaving lets both through over the wall.
- **Settlement against the reprice.** Settlement (`settleIn` and the six other endings) takes the job
  row and then the ingest row, and never the billing row. The reprice takes the billing row, then the
  job row, then the ingest row. Both take the job row before the ingest row, so they cannot deadlock;
  the job row lock means a job cannot end, or change hands, between the reprice's fence check and its
  write. A visibility change takes the billing row first, as everywhere.
- **A stale claimant.** After a deadline handoff, an old attempt may still be inside fetch. The
  reprice checks the job row against *this* claim (`liveAttempt(jobId, attempt)`, the same fence
  `beginPaidStep` uses) with the row locked, and throws `StaleAttemptError` otherwise, so a stale
  attempt can neither lower the replacement's eight slots to one nor raise them. Two claimants that
  saw different responses from one address: the live one's count wins, and only the live one writes
  the raw it priced.
- **Calling it twice with the same count** (a re-run fetch in the same job) is a no-op.

**What the gap would let through, if a path skipped stage 1.** Then a PDF would run on its one-slot
reservation. Three paths do skip it, and each is closed at the route instead:

1. **A retry.** `retryJob` keeps the slug and skips the steps already done, so a retry of a job that
   failed in stage 2 or later does not fetch again. **The retry reserves the old row's `slots`** at
   the route (`reservationShapeOf` carries the weight). The old row was repriced in the old job's
   fetch, so the retry costs what the document costs. A retry of a job that failed in stage 1 reserves
   the old weight too, and stage 1 reprices it again — to the same or another count.
2. ***Read this* on a minimal paper.** It carries the minimal paper's fetch and forces `extract`
   (`queueReadThis`, `src/routes.ts`). `reserveUpgrade` reads the minimal row's stored `pages` and
   reserves `200 × slots` less the paper's two-point credit, up front.
3. **Jobs already past fetch at the deploy.** Grandfathered at one slot, said out loud: at most a few
   jobs in the minutes around a deploy, on a tiny readership.

And one belt to go with the braces, **proposed for Sol to weigh**: stage 2, before transcription,
asks the same store operation with the stored page count (idempotent when the row already carries
it). That turns any path nobody has listed into a charge, or a refusal, rather than a free long
import — at the cost of one more short transaction per PDF.

## How the quota changes

**Two columns on `ingest_events`**: `slots smallint not null default 1 check (slots between 1 and
8)`, and `pages integer` (nullable; the PDF's page count once stage 1 has counted it, for any row
kind). `slots` prices the row; `pages` is the fact `slots` came from and the one *Read this* needs
from a minimal row. Every count in `usageSql` (`src/store/pg-billing.ts`) that prices an `'ingest'`
or `'high_power'` row gains a sum of `slots` beside it. The alternative, extra rows of a new kind (as
`high_power` did), was passed over: one row is one import, and N rows for one import is the N : 1
ledger shape billing.md already spends paragraphs apologising for. Columns keep "how many imports"
and "what it cost" both answerable. A minimal row's `slots` stays 1 and means nothing: a minimal row
is priced at 2 points by its kind.

What then follows, each of which is a reading of an existing rule rather than a new one:

- **Public halves it.** A 150-page public article costs 3 × 100 = 300 points, one and a half slots —
  billing.md § *A public article counts half*, applied per slot. Live, frozen on delete, exactly as
  now, because the visibility term is unchanged and only the count becomes a sum.
- **In flight costs full price, in full.** An unsettled row counts `200 × slots`, so once stage 1 has
  repriced, a second import in the same account sees all of it. Before the reprice it counts 200.
- **The wall is the ingest wall.** The reprice admits when
  `used_without_this_row + 200 × slots <= budget + 100` — `admitsIngest` generalised to a cost, the
  same half-article overdraft, once. With six slots left: 300 pages (6) admits, 301 pages (7) is
  refused. A new predicate in [`src/billing/points.ts`](../../src/billing/points.ts),
  `admitsIngestOf(used, budget, slots)` (with `admitsIngest` its `slots = 1` case), so nothing outside
  that module compares points. For a *Read this* row the credit is subtracted as now.
- **The repricing is one claim-fenced store operation, keyed on the job**, not on a reservation id.
  The fetch step does not hold the reservation id: it lives on `EnqueueRequest.ingestEventId` and is
  deliberately kept off `Job` and `StepContext` (`src/jobs.ts`, `src/pipeline.ts`). So
  `priceFetchedPdf(jobId, attempt, pages)` reads the job's owner, then, in the house lock order —
  `lockBillingAccount`, then the job `for update` under `liveAttempt` — resolves
  `jobs.ingest_event_id`, takes the row `for update`, and:
  - no reservation (the administrator, a re-run): returns `unpriced`, nothing written;
  - a minimal row: records `pages`, returns `minimal`;
  - an unsettled, unreleased `'ingest'` row of the same owner: computes usage **minus this row's
    current weight**, checks the new weight, sets `slots` and `pages`, returns
    `{ priced, slots, pages }` — or `{ refused, slots, pages, slotsLeft, shareToMakeRoom? }`;
  - anything else (settled, released, another owner's): throws — it is a ledger contradiction.
  It reaches the step as a `StepContext` callback, like `beginPaidWork`, bound to the claim in
  `src/jobs.ts`; absent from a command line or a test, where nothing is charged. Nothing that touches
  the network is inside it: the page count is computed before the lock is taken.
- **High-powered AI charges the article's slots again** (Greg, answer 2). `switchOnHighPower` reads
  the `slots` of the article's charged ingest row (the largest, if a re-add left several) and writes
  its `'high_power'` row with the same `slots`; `admitsHighPower` becomes `used + cost × slots <=
  budget`, still whole. An article with no charged ingest row pays one slot, as today (pre-billing,
  pre-`article_id`, admin-added).
- **The administrator stays exempt**: no reservation, so no reprice and no warning.
- **Imports and slots are two numbers, kept apart.** `usageSql` keeps its row counts (how many
  articles were added, how many are public) and gains slot sums beside them (what they cost).
  `wallUsed` adds the sums; `ingestsUsed` and *"N articles added"* go on counting rows. So a reader
  with one 150-page article reads *1 article added, using 3 of your 3*, never *3 articles added*, and
  no surface divides points, as now.
- **`usageSql` is not the only query that counts ledger rows.** `articlesToShare`
  (`src/store/pg-billing.ts`, the conditional sharing offer) assumes each article it names frees 100
  points; a long article frees `100 × slots`. The admin aggregation (`src/store/pg-admin.ts`) and the
  columns that derive costs from it (`src/web/admin-columns.tsx`) count rows too. Each is audited
  and carries both the count and the sum where it needs both meanings.

## What the reader sees

- **Before choosing a file**, the limits line: *PDF … up to 50 MB. PDFs up to 400 pages; every 50
  pages counts as one article.* (`uploadLimits`, `src/uploads.ts`.)
- **During the import**, once stage 1 has counted: the job card says, for a document over 50 pages,
  *This PDF is 150 pages, so it uses 3 of your articles (one for every 50 pages).* It does not stop
  or ask; the import carries on. This is the warning Greg asked for. **It is persisted** — in the
  fetch step's stored detail — not `StepContext.report`, which is live-only. Not shown to an
  administrator, whose imports cost no slots, nor for a minimal paper.
- **When the slots are not there**: the job fails in stage 1 with *This PDF is 250 pages, which
  counts as 5 articles, and your account has 2 left.* plus the existing conditional sharing offer and
  upgrade link. Seconds after starting, before anything is paid for.
- **`/profile`**: *1 article added, using 3 of your …* when a long article is among them.

## Will a 400-page document actually import? (the cost and limits side)

From the measurements in
[261004b](../investigations/261004b-big-document-imports-at-the-limits.md) and
[261005a](../plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md)
(Doctorow, 250 pages, 3,053 blocks), scaled linearly — **estimates, to be measured in stage 1**:

| | 250 pages, measured | 400 pages, estimated |
|---|---|---|
| transcription (extract) | 166 s, $0.65, 43 chunks | ~270 s, ~$1.05, ~70 chunks (under the 100-chunk concurrency) |
| structure, in slices | 131 s, $1.00 | ~210 s, ~$1.60 (5 slices of ~1,000 blocks, 8 at a time) |
| labels | 235 s, $1.62 | ~375 s, ~$2.60 (inside its 700 s budget, barely comfortable) |
| **import total** | **~$3.30** | **~$5.30, ~$0.66 per 50 pages** |
| blocks stored | 3,053 | ~5,000 (batched inserts tested to 6,000) |
| article response | 2.3 MB | **~3.7 MB, against Vercel's 4.5 MB** |

**At one slot per 50 pages the price roughly covers the import.** A slot on the Reader plan is worth
$0.50 ($10 for 20); 50 pages of a long document costs about $0.66 at import, so a 400-page import uses
$4 of allowance and costs us about $5.30. Modes run later (glossary, quotes, chat) also scale with
length and are not counted; that is true today at 250. The estimates come from one fairly sparse
book; a dense document plans more chunks (`src/jobs.ts` says 250 ordinary pages can approach ~84),
so the true upper bound is higher.

**The real risk is the article response.** A dense paper is ~14 blocks a page, so 400 of its pages
is ~5,800 blocks, and the response could pass 4.5 MB, at which point the article would not load at
all. That is already queued as `qi-sbytr395` and has never been measured on Vercel. Raising the cap
makes it reachable, so **the measurement comes first, before the cap moves**, and the cap does not
move past what loads.

## Stages

1. **Measure at 400 first.** One real 400-page PDF (a public-domain book) and one dense one through
   the local pipeline, with the cap lifted for the run only: time per step, cost, blocks, chunks, and
   the article response size. If the dense one passes ~4 MB, the cap stays at the largest size that
   loads and `qi-sbytr395` becomes a blocker. About $10–15 of model calls. Written up under
   `docs/investigations/`. Runs beside stage 2, which touches none of its files.
2. **The ledger.** Migration (additive): `ingest_events.slots smallint not null default 1 check
   (slots between 1 and 8)` and `ingest_events.pages integer check (pages > 0)`. `usageSql` gains slot
   sums beside its counts; `admitsIngestOf`; `slotsForPages`; the claim-fenced `priceFetchedPdf`;
   the retry weight; `reserveUpgrade`'s weight; `switchOnHighPower`'s weight; `articlesToShare` and
   the admin aggregation. Tests first, red then green: Greg's two-slots-left pair at 50 pages (100
   pages admits, 101 refused); twenty concurrent reprices on one account; the stale claimant; a public
   long article at half; delete freezes the price of all its slots; a retry; *Read this* on a long
   minimal paper; High-powered on a long article; the admin.
3. **Stage 1 calls it, and the reader is told.** `refuseAnOverlongPdf` → count, cap, then
   `priceFetchedPdf` (through the `StepContext` callback) before `writeRaw` / promotion. The
   persisted warning, the refusal sentence in `src/messages.ts`, the limits line. `MAX_PAGES = 400`
   (or what stage 1 found loads). A route matrix, not only helper tests: a pasted PDF, a redirect and
   a paper-source PDF, an upload with a misleading filename, HTML, Word and Europe PMC JATS staying at
   one slot, the 50/51/100/101/350/351/400/401 boundaries, and the refusal landing before any paid
   step starts.
4. **Docs.** billing.md gains *§ A long document costs a slot per 50 pages*; ingest-queue.md,
   `/help` (it states the limits), `stated-limits.test.ts`'s numbers, the security-map line for
   billing.

## Deferred, by name

- **A warning before upload** (option D): counting pages in the browser with pdf.js, so the reader
  knows before choosing. An early courtesy only — the wall stays in stage 1.
- **The warning on a retry or a *Read this*.** Neither runs stage 1, so neither card says the
  sentence; the charge is right and `/profile` shows it.
- **Length-pricing web pages and Word files.** No page count to price by; words would be the unit.
- **Pricing the modes by length.** A glossary of a 400-page book costs more than of a 10-page paper,
  and re-runs are free. True at 250 pages today.

## Reviews

- Plan review 1 (GPT Sol, read-only, before Greg's answers):
  [261020b-…-plan-review-sol.md](261020b-longer-documents-up-to-400-pages-plan-review-sol.md).
  Verdict *do not approve unchanged*; ten findings, each checked against the code and taken. In
  short: stage 1 has no reservation id, so the repricing is keyed on the job and fenced on the claim
  (F1, F2); *Read this* never runs stage 1, so the page count is stored and reused (F3); jobs past
  fetch at deploy are grandfathered, said out loud (F4); High-powered is asked, not inferred (F5);
  counts and slot sums kept apart, and `articlesToShare` and the admin queries audited (F6, F7); the
  warning is persisted (F8); measurement comes before the cap moves (F9); a route test matrix (F10).
- Plan review 2 (GPT Sol, after Greg's answers, on the race): pending.

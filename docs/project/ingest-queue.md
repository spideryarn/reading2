# The ingest queue

Paste a URL on the homepage and an article appears on the shelf a minute or two later, with the
stages ticking over while you watch. Since 2026-08-26 the watching happens on a page of its own,
`/add/<the URL>` — [§ The add page](#the-add-page).

> **The record moved on 2026-08-27, and the artefacts did not.** A job now lives behind `JobStore`
> ([`src/store/jobs.ts`](../../src/store/jobs.ts)) — a filesystem adapter writing the same
> `data/_jobs/*.json` as before, and a Postgres one — so `POST /api/jobs/:id/advance` can be answered
> by an instance that did not create the job. p-queue and the in-memory `Map` are gone with it, and
> what replaced them is a **claim**: an attempt token, a lease, and every write fenced on
> `id = $id and attempt_id = $attempt and status = 'running'`.
>
> **An ingest works on Vercel as of 2026-08-30, and everything below this line about it not working
> is kept because each answer was a correct diagnosis of a real obstacle and none of them was the one
> that mattered.** A real article — `paulgraham.com/todo.html` — was pasted at spideryarn.com and
> came out the other end: fetched, extracted, ten blocks with fresh ids, a table of contents, and
> published to the shelf. That morning the same paste had failed in sixteen milliseconds, as nine
> before it had.
>
> Three things had to be true together, and the last was the one nobody was looking at:
>
> 1. **A writable disk.** `ROOT` was derived from the module's own location, which is two levels up
>    from `src/store/` in the repository and `/var` in a bundle — so every ingest died on
>    `mkdir '/var/data'`. Now an injected, invocation-scoped root.
> 2. **One invocation for the whole job.** Every `/advance` may land on a different instance, so
>    step two looked for what step one wrote and found nothing. A claim now walks every step —
>    `advanceJobToCompletion`, [`src/jobs.ts`](../../src/jobs.ts).
> 3. **Something that actually publishes.** This is the one that had been marked done and was not.
>    `publishRevision` was called only from `revisions.ts`, the fixture loader and tests — **never
>    from the job path**. So a job could run every stage, write every file, go `done`, and leave
>    `articles.current_revision_id` exactly where it was. A green job, an empty shelf, and every
>    check reporting success. `src/store/publish-session.ts` is the finalizer that closed it. (That
>    decorator was deleted on 2026-09-01; the publication is now `pgStoreSession`'s own — see
>    *A finished job publishes the article* below.)
>
> **What still does not work, found within a minute of the first success:** re-running a *single*
> step against an existing article. Opening an article starts an `arc` job, which gets its own job
> id and therefore its own empty scratch, and cannot see what the ingest wrote —
> `ENOENT: /tmp/spideryarn/<owner>/<jobId>/data/<slug>/blocks.json`. The article reads fine, because
> `TableView` falls back to the root gist, which is exactly why it is worth writing down rather than
> leaving to be noticed. The same applies to `tweets`, `glossary`, `summary` and `ideas` whenever a
> reader asks for one. That is the hydration problem, and it is the next piece.
>
> **Fixed on 2026-09-01, and this paragraph is kept because the diagnosis was right.** `claimSession`
> ([`src/jobs.ts`](../../src/jobs.ts)) is two lines now: under `SPIDERYARN_STORE=postgres` a claim
> gets `openPgStoreSession`, whose reads are the article's own draft revision rather than a
> job-scoped directory, and every late step's `run` takes the article through `readArticle(ctx.slug,
> store)` instead of opening a path. `tests/claim-session-postgres.test.ts` § *"runs a late single
> step that reads the article from the store, not from its empty root"* ingests under one job id and
> then runs `["arc"]` under a second, which is exactly the shape above.

> **Superseded, and kept.** *"This does not make an ingest work on Vercel, and the section below
> saying it nearly does is the mistake worth not repeating."* Every stage still writes
> `data/<slug>/*.json` and `stepIsDone` reads those files, so invocation A writes `raw.json` to an
> ephemeral disk and invocation B finds nothing and fetches again. The job is durable; the *pipeline*
> is not. **True when written, and it correctly named obstacle 2 above** — what it missed is that
> fixing it would still have produced a green job and an empty shelf, because nothing published.

> Now let's think about the "Add" functionality that takes a URL as an argument. There should be
> some kind of queue that processes things (e.g. fetch, Mozilla Readability, sanitiser), and ideally
> a progress indicator.
>
> — Greg, 2026-08-25

Before this, the add box on the homepage printed the four commands for you to run yourself. That was
honest — there was no job runner — and it is what
[library.md § Adding an article](library.md#adding-an-article-the-box-submits-now) described. This is that stub
growing up, and it kept the shape it promised it would: the input stayed, and the command list became
the progress list.

| File | What's in it |
|---|---|
| [`src/pipeline.ts`](../../src/pipeline.ts) | the six steps, as data — the only place that knows the pipeline's order |
| [`src/jobs.ts`](../../src/jobs.ts) | the queue, the job records, and the restart sweep |
| [`src/routes.ts`](../../src/routes.ts) | six HTTP routes, all of which return immediately |
| [`src/web/jobEngine.ts`](../../src/web/jobEngine.ts) | the poll and the driver, for the whole tab — [§ The browser is the worker](#the-browser-is-the-worker) |
| [`src/web/useJobs.ts`](../../src/web/useJobs.ts) | the subscription over the engine, and the actions |
| [`src/web/AddArticle.tsx`](../../src/web/AddArticle.tsx) | the box on the shelf, the progress list, and `JobCard` |
| [`src/web/AddPage.tsx`](../../src/web/AddPage.tsx) | `/add/<a whole URL>` — [§ The add page](#the-add-page) |
| [`src/ingest.ts`](../../src/ingest.ts) | `slugFromUrl` and `isSlug` — what an article gets called, and whether that name is safe |
| [`src/fetch.ts`](../../src/fetch.ts) | stage 1, somebody else's — [fetching.md](fetching.md) |
| [`src/web/UploadPicker.tsx`](../../src/web/UploadPicker.tsx) | the file picker, the drop zone and the progress bar — [§ Uploading a PDF](#uploading-a-pdf) |
| [`src/uploads.ts`](../../src/uploads.ts) | what counts as a PDF worth uploading, and how big is too big |

## Uploading a PDF

**Built 2026-08-27.** Choose a PDF off your own machine, or drop one on the shelf, and it becomes
an article the same way a pasted URL does. The picker had been sitting there since 2026-08-26
saying in as many words that there was nowhere to send a file — deliberately, because a disabled
button or a spinner over a file going nowhere are both
[the failure this repo keeps writing up](../reusable/silent-success.md). There is somewhere now.

**The bytes never touch our server**, and that is not an optimisation. A Vercel function refuses a
request body over 4.5 MB — flat, unraisable, the same on Node, Edge and Fluid — and two of the
three PDFs in this project's own eval set are bigger than that. So:

```
  POST /api/uploads   {filename, bytes, sha256}   ~200 bytes of JSON to us
     └─ navigate to /add/upload/<id> here, with zero bytes sent
  PUT  <signed url>   the whole file              straight to Supabase Storage, no credentials
  POST /api/jobs      {uploadId}                  ~60 bytes of JSON to us
     └─ the server HEADs the staging object first: no object, no job
```

The middle step carries no bearer token and no API key. The grant is in the URL, it is bound to one
path *we* chose, and it lasts two hours. `MAX_BODY_BYTES` in
[`src/routes.ts`](../../src/routes.ts) is untouched — that is the point, no route grew a
large-body path. Measured end to end on 2026-08-27 with the 145 KB fixture: verified, extracted,
split, given its hierarchy and its arc in 148 seconds, and `GET /api/source/:slug` handed back all 144,779 bytes.

**Where each piece lives.** [`src/web/upload.ts`](../../src/web/upload.ts) hashes and sends;
[`src/store/blobs.ts`](../../src/store/blobs.ts) is the seam, with the Supabase and filesystem
adapters beside it; [`src/upload-records.ts`](../../src/upload-records.ts) is one attempt's state;
`acquireUpload` in [`src/pipeline.ts`](../../src/pipeline.ts) is the half of stage 1 that verifies
bytes instead of fetching them. The design, the measurements behind it and the two cross-family
reviews are in [260826u-pdf-upload-and-storage.md](../plans/260826u-pdf-upload-and-storage.md).

### The things about it that are not obvious

**The upload is not the ingest, and they happen in different places.** The transfer starts on the
shelf, because that is where the `File` is — a file handle is not something an address can carry.
But since 2026-09-03 it does not *stay* there: it belongs to
[`src/web/uploadEngine.ts`](../../src/web/uploadEngine.ts), a tab-level singleton beside
[`jobEngine`](../../src/web/jobEngine.ts), which owns hashing, the grant, the PUT **and** the
`POST /api/jobs` that follows it. The reader presses Add and is sent to `/add/upload/<uploadId>`
**at byte zero**, and can then go anywhere in the app while the file goes up and the ingest starts
itself. [§ Add commits, and does not wait](#add-commits-and-does-not-wait).

Closing the tab still loses the upload, because the bytes exist only in the browser until they
reach Storage — there is no server-side copy to resume from, which is the same 4.5 MB body limit
that put them there in the first place.

**There is no new step in the pipeline.** An upload's first step is still called `fetch`; it simply
has two halves, and the branch on `ctx.upload` is the only place in the whole pipeline that knows
where an article came from. Both halves write the same `raw.json`, so stage 2 onwards cannot tell
which ran — the same seam [content-extraction.md](content-extraction.md) calls the entire design.
What the step *says* does change: "Checking the file", not "Fetching the page", because there is
nothing to fetch and no page, and a reader watching a row that claims otherwise learns something
untrue about where their document went.

**The staging object is never deleted, and that is a rule rather than an oversight.** Measured
against the running stack: deleting an object **re-arms** any grant still live over its key. So a
tidy-up inside the two-hour TTL races the browser it is cleaning up after, and can end with us
having checksummed one document and extracted another. Verified bytes are *copied* to
`sha256/<hash>.pdf` — create-only, so the name stays a true statement about the contents — and the
staging key is left alone. A sweep after `SWEEP_GRACE_MS` is not built;
[`tests/upload-acquire.test.ts`](../../tests/upload-acquire.test.ts) asserts the object survives,
which is what stops somebody adding the obvious `remove` later.

**A reload of `/add/upload/<id>` is answered from the upload record once the job has gone.** Finished
jobs are trimmed to fifty per reader, and modes are jobs, so fifty is a fortnight of ordinary use.
After that the upload is still `claimed` and the article is still on the shelf, so `POST /api/jobs
{uploadId}` answers `200 {article}` — the slug the record has carried since `enqueue` returned —
rather than 202 with a job that no longer exists, and `AddPage` goes straight to the article. While
the job *is* there it is still the answer, whatever status it is in, matched by `upload.id` rather
than by slug.

**A PDF too long to read is refused here, not three stages later.** Since 2026-09-04 the
acquisition step counts the pages between verifying the checksum and promoting the bytes, and refuses
over [`src/uploads.ts`](../../src/uploads.ts) § `MAX_PAGES` — so the bytes are never promoted to
their canonical name, the upload record ends `rejected` rather than `verified`, and the job card names the page count and the limit
within seconds. The position is load-bearing: `verified` is terminal
([`src/source.ts`](../../src/source.ts)), so a refusal after it cannot record its own reason.
The record takes a static reason and the job takes the sentence with the number in it —
[content-extraction.md](content-extraction.md) and
[260903k](../plans/260903k-pdf-page-cap-refused-with-no-reason-given.md) § Stage 4.

**An upload never adopts an existing article.** `freeSlug` may adopt one, because `urlKey` can
prove two addresses are one piece. An upload has no address, so there is nothing that could make
two of them one article — two files called `paper.pdf` get two, per
[Greg's answer](../plans/260826u-pdf-upload-and-storage.md#gregs-answers-2026-08-26).

**Since 2026-08-31 that is a mint rather than a search.** Every new slug ends in a globally unique
short id (`paper-spya-k3m9qt`, [`src/ingest.ts`](../../src/ingest.ts) § `slugWithShortId`), so an
upload takes a name nothing else can want. `freeUploadSlug` and `slugIsSpokenFor` walked a `-2`…`-99`
counter and read the candidate's fetch manifest to ask *is this article this upload's own*; both are
gone, and nothing collides any more.
See [the plan](../plans/260831b-finish-the-database-move.md) § Stage 3 item 0.

### A retry keeps the failed attempt's name, and that is a decision

**A retry is the continuation of one named prior attempt, and a second upload of the same file is
not.** `retryJob` says which of the two it is —
[`slugForRetry`](../../src/jobs.ts), reached only when the request carries a `retryOf` — and where a
fresh request would *mint*, a retry takes the name the attempt it repeats already had. It asks the
**shelf** first, so an address that already has a published article wins over the remembered name;
and it *reserves* everywhere else, so the queued retry sits inside `jobs_active_source` and a racing
paste of the same URL is refused rather than minting a second article for one address.

**The shelf and nothing else, and a refused retry inserts no row at all.** Both halves were different
until GPT Sol's review on 2026-09-03, and both were the same hole: an adopted row *reserves nothing*,
so it is outside `jobs_active_source` and is safe only while some other active row reserves that
address on its behalf — which is liveness, not a guarantee. Sol reproduced two active articles for
one address twice over, by letting the holder go terminal between the repair's lookup and the insert
it then makes. So a retry now adopts only what the shelf holds — a *durable* fact, which every later
lookup finds too — and when the index refuses it, `enqueue` **hands back the job that refused it**
rather than repairing the allocation and inserting anyway
([`handBackToARetry`](../../src/jobs.ts)). No second row, no hole, and semantically what the reader
asked for: another ingest of that address is live, so they get the live one.
`tests/one-article-for-one-address.test.ts` § *and a retry's two*.

The same shape survives for a *fresh* paste, which adopts from a live job through `freeSlug`. Its
window is one round trip rather than two, it predates this work, and closing it the same way would
turn a second URL request for one unpublished article into a dedup rather than a queued job. Written
down rather than changed; the durable fix for the class is a table that claims an address.

Between 2026-08-31 and 2026-09-03 it minted a fresh name instead, and *"which costs nothing"* is what
this paragraph used to say. It stopped being true on 2026-09-01, when per-chunk checkpoints landed
keyed on the **article** ([content-extraction.md](content-extraction.md)): the article is a pure
function of the slug, so a retry that moved the name moved the article and could not see one chunk
the failed attempt had paid for. On a PDF too long to finish inside one lease that is not a bill but
a cliff — every attempt starts from zero, so it can never finish at all. The visible fingerprint
nobody read was the slug: three retries gave `…-spya-aaa-spya-bbb-spya-ccc`, three articles, three
invoices. `tests/retry-keeps-the-checkpoints.test.ts` and
[the plan](../plans/260903k-pdf-page-cap-refused-with-no-reason-given.md) § Bug 2.

### Add commits, and does not wait

> sometimes it takes a while to upload over a slow connection. I have to wait before I can then
> click the Add button … I'd like to be able to upload and then click Add immediately, which would
> then wait for the upload to finish and run the ingestion queue immediately, so I could go off and
> do something else in the meantime.
>
> — Greg, 2026-09-03

Add is now **one button for both ways in** — a typed URL or a chosen PDF, whichever was touched
last, and the label says which (*Add* or *Add PDF*). The *Send it* button is gone. Pressing it with
a file chosen mints the grant, navigates, and leaves; `uploadEngine` finishes the transfer and
queues the ingest wherever the reader has gone.

**Handing out the address at byte zero needed a lock on the other end**, and that is the part worth
knowing. `POST /api/jobs { uploadId }` now asks Storage whether the staging object is there before
it claims anything (`uploadHasArrived`, [`src/routes.ts`](../../src/routes.ts)) and answers
`UPLOAD_STILL_ARRIVING` when it is not — taking no claim, no job and **no quota slot**. Without it,
three ordinary gestures queue an ingest over a file that has not arrived — reload the page, open it
in a second tab, press Stop and reload — and `acquireUpload` refuses each of those *terminally*, so
a reader's own reload destroyed their upload.

The object's existence is the readiness state rather than a `ready` column, because a column would
need a writer and the only candidate is the browser saying it has finished. It is a true test
rather than a proxy, and that is measured: a PUT aborted at 320 KB of 5 MB leaves **no object at
all**, and re-PUTting the same grant then succeeds. The table, and the rest of the design, is in
[260903j-background-pdf-upload-so-add-does-not-wait.md](../plans/260903j-background-pdf-upload-so-add-does-not-wait.md).

Two consequences that follow from the gate rather than from the feature:

- **An upload's existing job is found before the quota slot is reserved.** `admitIngest` throws 402
  before its callback runs, so a reader on their last slot who reloaded the ingest page used to be
  refused for having no allowance when the right answer was the job their first request had already
  made.
- **A cancelled transfer can never become a job**, however many times its address is opened. Nothing
  told the server it was cancelled; the object simply never arrived, and that is now enough.

### Abandoned uploads are not swept, and nothing sweeps them

`sweepable()` in [`src/source.ts`](../../src/source.ts) has **no production caller** — only its own
definition and `tests/source.test.ts`. So an expired `pending` record and its staging object stay
where they are. `asOf` *reports* an expired grant without rewriting the row, which is right, but
nothing ever deletes anything. Cancelling got easier on 2026-09-03, so the pile grows faster.

Written down rather than fixed (2026-09-03, verified by grep). Whoever writes the sweep: it must not
delete an object whose record could still be claimed, because the readiness gate above now treats
that object as the fact.

### `/add/upload/<id>` has to survive a reload, and for a day it did not

The address is most of why the ingest lives on a page of its own — you can reload it, bookmark it,
send it. It could not be reloaded. `canonicalAddHref`, which main.tsx runs on every load to rewrite
an `/add/` path into the encoded spelling `addHref` mints, did not know about upload addresses: it
read `/add/upload/<uuid>` as the *URL* `upload/<uuid>`, percent-encoded the slash, and left the
reader on `/add/upload%2F<uuid>` being told *"That isn't a web address we can fetch"*.

**Every unit test passed while that was true**, and they were not bad tests — the rewrite is
something `main.tsx` does on load, not something `parseRoute` decides, so nothing that asked
`parseRoute` could see it. It took pressing reload in a browser
([browser-testing.md](browser-testing.md)). The guard is now `parseRoute` itself rather than a
second copy of the pattern, because two places knowing what an upload address looks like is how
they come to disagree.

### The slug comes from the filename, and that is the ugly part

`source.pdf` becomes the slug `source`; `paper.pdf` becomes `paper`, then `paper-2`. The reader
sees the title everywhere that matters — the shelf card, the masthead, the tab — so this is a
directory name rather than anything they read. But `document.pdf` and `download.pdf` are extremely
common and the counters will pile up.

The plan's alternative is to store under a provisional id, run pass 0, and reserve the final slug
from the title. That is a **rename**, and [block-ids.md](block-ids.md) is largely about why renames
here are expensive. Written up as an open question rather than quietly decided:
[260826u-pdf-upload-and-storage.md § Still open](../plans/260826u-pdf-upload-and-storage.md).

### The checks are the cheap ones, and they are not the real ones

**The picker's checks** `uploadProblem` in
[`src/uploads.ts`](../../src/uploads.ts) reads a name, a browser-guessed MIME type and a size,
every one of which is a claim by whoever chose the file. The check that decides anything is the
`%PDF-` magic over the bytes that actually arrived, on the server, before anything expensive. The
module is shared rather than inlined in the component for exactly the reason
[`src/ingest.ts`](../../src/ingest.ts) is: `POST /api/uploads` will ask the same question, and a
browser and a server disagreeing about what counts as a PDF is invisible until a file is taken in
one place and refused in the other.

**And the server must not answer that question on the browser's behalf.** `POST /api/uploads` calls
the same `uploadProblem` with `type: ""` — no guess — because the browser's MIME guess does not
cross the wire, and supplying `"application/pdf"` there writes the answer we want into the input:
`looksLikePdf` accepts *either* the type or the name, so `notes.txt` sails through on a type we
made up. Caught by a test, not by reading.

**The real check is `acquireUpload`**, in the step, over the bytes: the object exists and is under
the cap (`head`, before anything moves), one bounded `get`, `%PDF-` over what came back, and our
SHA-256 against the browser's — and, since 2026-09-04, the page count, between the checksum and the
promotion. That last one is the only one of the five that can refuse a file which really is a PDF.
Downloading once and doing the middle two over that same copy is not
tidiness — reading the object twice is the one sequence content addressing does not cover, because
the grant is still live and the second read may not be the bytes the first one verified.

**A drop uploads it; the button does not.** The two entry points differ on purpose, and the
difference was reported as a bug before it was a decision. Greg, 2026-08-27:

> I tried dragging and dropping a PDF onto the Add zone in the home page, and nothing seems to have
> happened.

Nothing had gone wrong. The drop took the file, showed its name and its size, and waited for a
"Send it" press — and a control captioned *Or drop a PDF here* that catches a file and then waits is
indistinguishable from one that swallowed it. So a drop now sends immediately. It is an unambiguous
commit gesture aimed at a target that names itself, and there is nothing left to confirm; the X on
the progress row is still there to stop it.

The **button** still chooses-then-sends, because a file dialog is a place people browse. The first
PDF you click is often not the one you meant, and the row with its size is the only chance to notice
before 50 MB goes.

The mechanical part is that `take()` returns a boolean rather than the caller reading `chosen`
afterwards: `setChosen` does not change `chosen` until the next render, so a drop handler asking
"did that work?" in its own tick reads the *previous* file, or `null`. `file.current` is written
synchronously for the same reason, and it is what `send()` actually reads.

Three smaller things in the picker that are easy to get wrong and are worth not rediscovering:

- **The drag highlight counts, it does not toggle.** `dragleave` fires every time the pointer
  crosses into a child element, so a boolean cleared on leave makes the zone flicker as you move
  across it. Enters minus leaves is the fix that survives nested children.
- **`dragover` must call `preventDefault`.** Its default action is *"this is not a drop target"*,
  and without cancelling it the browser opens the PDF in the tab instead — which looks exactly
  like a drop handler that never ran.
- **The drop target is the whole add box, and there is no dashed rectangle any more.** Until
  2026-09-03 the picker drew its own dashed box — an icon, *Or drop a PDF here*, and an *Upload a
  PDF* button — about 130px of a 300px section, for the rarer of the two ways in, which on a 390px
  phone pushed the shelf's own list entirely below the fold. So it went, and its parts went two
  ways: the button is now a small **PDF** control on the URL row beside Add, and `UploadPicker`
  wraps everything in the section as the drop target, which is *much larger* than the dashed strip
  was. Nothing else changed — dragging, the counter, the refusals, progress, cancellation and retry
  are as they were. The border is transparent at rest and turns orange when a file is over it, so
  the target costs no height until it is doing something. What advertised dropping was the caption;
  that sentence now lives in the PDF button's `title` — and **the wrapper covers the card's own
  padding for exactly that reason**, because a title that promises more target than exists sends a
  near-miss through to the browser, which opens the PDF over the page. Measured before and after in
  [260903g](../plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md#stage-3-the-two-layout-jobs).
- **Both caps are stated before the file is chosen** — *PDF, up to 50 MB and 250 pages* — from
  `uploadLimits()` in [`src/uploads.ts`](../../src/uploads.ts), which builds the sentence out of
  `MAX_UPLOAD_BYTES` and `MAX_PAGES`, so it cannot promise a limit that is not the one enforced. It
  sits in the slot the chosen-file row takes, so it costs no height once a reader has acted on it.
  The **page** cap is the reason this exists: a file manager shows you a size and never a page
  count, so until 2026-09-04 the only way to discover it was to upload a book and be refused at the
  end — Sentry `SPIDERYARN-READING2-V`, *"couldn't upload PDF"*, and
  [the postmortem](../postmortems/260904b-a-sentence-written-for-the-reader-was-thrown-away-at-the-seam.md)
  is the other half of the same report. `MAX_PAGES` moved out of
  [`src/pdf-read.ts`](../../src/pdf-read.ts) to make it sayable: that module pulls in pdf.js, and
  the browser cannot import it.

## The add page

> Add a url that I can use to add something directly, e.g. `/add/[my-full-url-here]` or
> `/?add=[my-full-url-here]` or similar … And then modify the Home page so that when you add a url
> and click add, it takes you to this page.
>
> — Greg, 2026-08-26

`/add/https://example.com/an-essay` queues that article, shows the stages ticking over, and takes you
to the reading view when the last one goes green. Pressing **Add** on the shelf now goes here rather
than queueing where it stands, so there is exactly one thing that starts an ingest and it has an
address. The spellings the address bar accepts, and why the app's own is percent-encoded, are in
[url-state.md § `/add/<a whole URL>`](url-state.md#which-article-is-the-path).

**Two things this buys, and neither is the redirect.**

*An ingest has somewhere to be.* The progress list on the shelf was fine for something you were
watching and could not be reloaded, bookmarked or sent to anybody, because it was a state of that
page rather than a place. Reload `/add/…` and you are still watching the same job — `enqueue` hands
back the job already working on that article rather than starting a second one, so the page picks up
where it was rather than starting again ([§ Idempotent is the goal](#idempotent-is-the-goal-this-is-a-step-towards-it)).

*An article can be handed to us from outside.* A bookmarklet, a share sheet, or a shortcut is now
`spideryarn/add/` plus wherever you are, with nothing to paste.

### The three traps in a page whose whole job is one effect

- **Queue it once.** `<StrictMode>` mounts, unmounts and mounts again in development, so a plain
  effect POSTs twice. The guard is a ref, which survives that where state does not. Worth knowing
  *why this had to be got right rather than noticed*: `enqueue` would have handed the second request
  the same job, so both POSTs would have looked completely successful and the only trace of the bug
  would have been a duplicate line in the log — [silent-success.md](../reusable/silent-success.md)
  again, and the same trap the article open-count fell into on the same day.
- **Watch that one.** By the job id `queue.add` returned, not by slug. `useJobs` polls the whole
  queue, and the same article being re-run from another tab is the same slug and a different job.
  This is what widened `add` from `Promise<void>` to `Promise<Job | null>`; its docstring in
  [`useJobs.ts`](../../src/web/useJobs.ts) used to argue against that, and the argument was sound
  until a caller existed that needed the receipt.
- **Leave properly.** The navigation to the article `replace`s rather than pushes, so Back takes the
  reader to wherever they came from rather than dropping them here to watch a job that has already
  finished.

### Three ways the address can lie about itself

All three were found by review rather than by use, and together they are the argument for the
rewrite being a pure `canonicalAddHref` that main.tsx calls rather than four lines inside it:

- **The target URL's own `add=`.** `/add/https://x.test/article?add=2` canonicalised to `/add/2` —
  the article's own parameter read as ours, and replacing it. The path form is asked first now.
- **An `add=` that is not a parameter.** `?next=/somewhere?add=x` matched, because only the *first*
  `?` in a URL begins its query and the pattern accepted any of them. Anchored to a real boundary now.
- **An encoded segment carrying a query.** `/add/https%3A%2F%2Fx.test%2Fa?edition=2` was
  double-encoded into something that is not a URL at all, because a query string's mere presence was
  being read as proof the segment was raw. The query is now always put back, whichever spelling the
  segment is in — which is what the first of these three needed anyway.

An article already on the shelf takes about a second — every step finds its artefact and skips — so
adding the same URL twice is a blink and then the article, rather than an error telling you that you
already have it.

**The add box stopped being an `<input type="url">` for this.** The browser will not submit one
without a scheme, and `example.com/an-essay` is meant to work — so it is a plain text input whose
validation is `slugFromUrl`, the same function the server derives the slug with. The one check that
used to live on the page has moved into `slugFromUrl` itself; see the next section.

## Two URLs, one article

> And will this de-dupe correctly if near-identical versions of the url are used, e.g. http vs https
> or without url protocol or capitalised similar non-significant changes, or if we already have the
> article?
>
> — Greg, 2026-08-26

It did not. `freeSlug` compared the URL you gave against the one in `meta.json` **as strings**, so
adding `http://x.test/piece` when the shelf held `https://x.test/piece` read as a different article:
it stepped aside to `x-piece`, fetched it again, extracted it again, and paid for a second tree and
a second arc — then put two cards on the shelf under one headline. Nothing errored, and the check
anyone would run said the article was there. [Silent success](../reusable/silent-success.md) again.

The fix is two functions in [`src/ingest.ts`](../../src/ingest.ts), and **the reason there are two
rather than one is the whole design**:

| | Answers | May it change the address? |
|---|---|---|
| `normaliseUrl` | *what do we fetch and store?* | **No.** Whatever comes out is what gets fetched. |
| `urlKey` | *is this the article we already have?* | It is never fetched, so yes — freely. |

`normaliseUrl` is therefore limited to what the URL spec itself calls insignificant: it supplies a
missing scheme (`example.com/x`, `//example.com/x` → `https://…`), lower-cases the scheme and host,
drops a default port, and drops the fragment — which is never sent to a server, so an article whose
stored URL carried one would be claiming we fetched something we did not. It leaves `http` alone.
Turning `http` into `https` is a different request to a possibly different server, and that is not a
call to make on the reader's behalf. Anything it will not fetch comes back as `""`, which is one rule
with one answer — an early version handed the input back instead, which reads well in an error
message and is indistinguishable from *already normal*, so `http://127.0.0.1/x` was refused and then
happily slugged as `x` one function later.

`urlKey` is where `http` and `https` become one article. On top of the above it drops the scheme
entirely, a leading `www.`, one trailing slash, and the tracking parameters a share button staples on
(`utm_*`, `fbclid`, `igshid` and a dozen more).

### The rule it is written to, which is an asymmetry

**Failing to merge two spellings of one article costs a duplicate** — a second card on the shelf,
visible, deletable, paid for once. **Merging two different articles costs the wrong article**,
silently, under the headline the reader pasted, with nothing anywhere saying so. So a merge has to be
one the spec or universal practice actually guarantees, never one that is merely usually right.

That rule arrived from [GPT Sol's review](../../scripts/run-codex.ts) of the first version, which
merged four things it should not have, and each is now a test:

| Merged before | Why it must not |
|---|---|
| `/Why-Trees` and `/why-trees` | plenty of servers are case-sensitive and mean it |
| `?tag=a&tag=b` and `?tag=b&tag=a` | a repeated parameter's order is part of the request |
| `?a=x%26b%3Dy` and `?a=x&b=y` | decoding and re-joining on `=` and `&` is ambiguous — the first is **one** parameter whose value contains an ampersand |
| `alice:pw@host/x` and `bob:pw@host/x` | two readers' credentialled views of a page are not one article |
| `?a=1&&b=2` and `?a=1&b=2` | an empty query field is part of the request target; only *tracking* pairs are dropped |

The path-case one is worth dwelling on, because the argument *for* lower-casing was not silly: the
slug is lower-cased already, so `/Why-Trees` and `/why-trees` want the same readable name whatever
the key says. But wanting the same name costs nothing now — the short id makes them two slugs — so
the key deciding they are two articles resolves it into the cheap failure rather than the expensive
one. Credentials are not dropped from the key — they are
refused by `normaliseUrl` outright, since an `/add/…` URL now lives in browser history and in
whatever access log sees the request, and percent-encoding hides a password from nobody.

Query-string **order between different names** stays significant for the same reason, and that is a
deliberate non-merge: nobody reorders a URL they copied, so the merge buys nothing, and it cannot be
had without the sort that broke the repeated-parameter case.

**What else it will not merge:** a different host (`a.example/news` and `b.example/news` are two
articles, and they now get two slugs without anybody stepping aside), a real subdomain (`blog.example.com` is a site; only `www.` is
decoration), a non-default port, and any query parameter not on the tracking list — `?ref=`, `?s=`
and `?id=` are used both ways, so they stay.

Both are tested exhaustively in [`tests/ingest.test.ts`](../../tests/ingest.test.ts), and what is
built on top of them in [`tests/jobs.test.ts`](../../tests/jobs.test.ts) § `freeSlug`.

### Every slug carries a short id, so nothing has to step aside

> Yes, let's add a short id — and actually then we could in future allow users to rename the slug,
> and redirect/find it from the short id. So make sure it's globally unique. I'm fine with adding
> that to all slugs.
>
> — Greg, 2026-08-31

So a new article is `why-trees-spya-k3m9qt` ([`src/ingest.ts`](../../src/ingest.ts) §
`slugWithShortId`, minting through `src/ids.ts` so there is one id shape and not two). Two articles
can no longer want the same name, which deleted the ladder `freeSlug` used to walk — the host prefix
(`b-news`), then `-2`…`-99` — and `freeUploadSlug` and `slugIsSpokenFor` with it. Existing slugs are
untouched and nothing is backfilled.

The id is **also a column**, `articles.short_id`, and that is the second half of the decision rather
than a copy for convenience: a slug the reader renames no longer contains one, and the column is the
handle a rename would redirect through. `slugForShortId`
([`src/store/find-article.ts`](../../src/store/find-article.ts)) is that lookup. The rename itself is
not built.

### What the short id changed about adoption, and it is not nothing

`freeSlug` still *adopts* — adding an article we already have comes back to its slug, so every step
skips — but it can no longer find it by name. It used to derive the candidate slug from the URL and
ask what was under it; a slug ending in a random id cannot be derived, so that probe would find
nothing and mint a second article for a URL already on the shelf. **The question is now asked the
other way round:** *which slug already holds this `urlKey`?*

The lookup is an argument, which is what makes every decision above testable without a filesystem, a
network or a queue. Its default asks the shelf and then **the live queue** — because a job that is
queued or running has taken a slug and not yet published an article for it. Without that second
half, two adds of one URL a second apart get two slugs, every unique key in the schema contains the
slug so none of them fires, and the reader pays twice. **Two adds of one URL at the same *instant*
are a different case**, which no slug-shaped key can catch and `jobs_active_source` does — see
[The article's line](#the-articles-line).

### What it still cannot know

Two addresses that are genuinely different and serve the same piece — a syndication, a canonical URL
and an AMP one, a link-shortener — are two articles here, and nothing short of fetching both could
say otherwise. `<link rel="canonical">` is in the HTML we already fetch and would close most of that
gap; it is not read yet.

## Opening a link starts a fetch, and that is new

Nothing else in this app does anything expensive because you *arrived* somewhere. The add page does:
the POST is on mount, which is what makes a bookmarklet work and also what turns a link a stranger
sends into a server-side fetch of their choosing. `normaliseUrl` therefore refuses a host that is on
this machine or this network — loopback, link-local (`169.254.169.254` is the one worth naming),
`10./172.16-31./192.168.`, the IPv6 equivalents, and `localhost` — and it refuses them *after*
`new URL` has expanded the compressed spellings, so `127.1` and `0x7f.0.0.1` are caught by a check
for `127.0.0.1`.

**The obvious version of that check has a hole, and it took a second review pass to find.**
`http://[::ffff:127.0.0.1]/` is loopback, and `new URL` re-spells it as `[::ffff:7f00:1]` — neither
a dotted quad nor `::1`, so a check for those two waves it straight through. An IPv4-mapped address
now has its IPv4 half decoded and checked properly, so `::ffff:8.8.8.8` stays fetchable; the rest of
`::/96` — `::`, `::1`, the deprecated v4-compatible form — is refused outright, being unroutable
anyway.

**That is a smaller claim than "no SSRF" and the gap is stated in
[security.md](security.md).** A *name* that resolves into the private range still gets through, as
does a redirect into it, as does a rebind between the check and the connection; only the fetch itself
can catch those. Refusing `localhost` also costs the ability to add a page from a dev server on this
machine, which is a real loss and a small one — this reads published articles.

## The pipeline is a list, not a function

Six steps, in [`src/pipeline.ts`](../../src/pipeline.ts):

```
  fetch     Fetching the page              → data/<slug>/raw.html
  extract   Extracting the article         → output/<slug>.html, data/<slug>/meta.json
  blocks    Splitting into blocks          → output/<slug>.blocks.json   (and the sanitiser)
  hierarchy Building the table of contents → data/<slug>/tree.json, data/<slug>/blocks.json
  arc       Writing the arc                → data/<slug>/arc.json
  tweets    Writing the thread             → data/<slug>/tweets.json     (never on a plain add)
```

Each step is a name, a label, **the artefact it produces**, and the function that produces it. A job
is a *list of step names*, which is the whole reason this is data rather than four `await`s in a row.
Greg asked for more than "add this URL" — re-run one stage after a prompt change, refresh an article
from source, and *"potentially it'll be used in other ways too"* (2026-08-25). All of those are the
same machinery given a different sub-list, and none of them needed a special case.

- **Add** — every step in `DEFAULT_INGEST_STEPS`, which is the first five.
- **Re-run a stage** — `{ slug, steps: ["arc"], force: ["arc"] }`.
- **Refresh from source** — the default steps, with `force: ["fetch"]`.
- **Write the thread** — `{ slug, steps: ["tweets"] }`, which is the button on the tweets page.

### `STEP_ORDER` is not the default list

They were the same array until the sixth step arrived, and separating them is the whole change the
tweet thread needed in this file ([260825g-tweet-thread-page.md](../plans/260825g-tweet-thread-page.md#the-one-real-snag-stated-precisely)).
The constant was quietly doing three jobs:

| Read at | What it means there | Does `tweets` belong? |
|---|---|---|
| `orderSteps`, sorting by `STEP_ORDER.indexOf` | the chain's order | **yes** — a name that is missing gets `-1` and sorts to the *front*, so it would run before `fetch` |
| `isStepName`, which is `STEP_ORDER.includes` | the names the API will accept | **yes** — otherwise `POST /api/jobs { steps: ["tweets"] }` is a bad request and the button can never work |
| `enqueue`'s `request.steps ?? …` | what a bare "add this URL" runs | **no** — a thread costs a model call and nobody asked for one |

So `STEP_ORDER` gained `tweets` and `enqueue` now defaults to `DEFAULT_INGEST_STEPS`, which is the
same five as before. [`tests/jobs.test.ts`](../../tests/jobs.test.ts) pins both: that `tweets` is a
valid name, and that it is **not** in the default list.

### The pipeline is no longer one straight line

`cascadeForce` above encodes *"invalidating a step invalidates everything after it"*, and that is
sound for a chain in which each step eats what the one before it wrote. **`tweets` is not a link in
that chain.** It reads `blocks.json` and `tree.json` — the same inputs the arc reads — and nothing
reads what it writes. Its position after `arc` in `STEP_ORDER` is about *running order*, not about
dependency, and reading it as dependency costs money: forcing `arc` in a job that also holds
`tweets` would spend a second model call rewriting a thread whose inputs never moved.

So `FORCE_ONLY_WHEN_NAMED` in [`src/pipeline.ts`](../../src/pipeline.ts) holds the steps the
positional cascade may not speak for, and `tweets` is in it. Forcing an earlier step no longer
forces the thread; `force: ["tweets"]` still does, which is the rewrite button.

**Read that together with the next section, because neither half is safe alone.** Taking a step out
of the cascade is only defensible when the step can tell for itself whether it is current — and
`tweets` can. `arc` stayed *in* the cascade for the inverse reason — it had no freshness check, so
its position was the only signal it had.

**It has one as of 2026-08-29** ([`src/arc.ts`](../../src/arc.ts) § `inputFingerprint`, over the
blocks, the tree and the metadata the prompt carries), which by that rule makes it a candidate for
the set. It is worth knowing *why* it needed one: position was never quite the signal it looked
like. `cascadeForce` only names steps already in the job, so a forced `{ steps: ["hierarchy"] }` never
reached `arc` at all — the tree was re-cut, `arc.json` stayed, and the reading view silently dropped
every arc entry whose range no longer matched a node, because the join is by exact block range.
docs/plans/260829f-defer-arc-and-rename-hierarchy.md § 2.1.

### A step can now say whether its artefact is *current*, not just present

`stepIsDone` asked one question — are the files there? — and calling the answer a cache was
generous. A `tweets.json` describing last week's text is present, so the step would skip, report
*"already done"* with a green tick, and the page would serve a thread about an article that has
since changed. A [silent success](../reusable/silent-success.md) of the exact kind this repo keeps
finding, and the reason the plan's `sourceHash` was not enough on its own: **nothing would ever have
read it.**

`PipelineStep` therefore has an optional freshness check. Existence still runs first and the override
can only narrow the answer, so a freshness check can never declare a missing file fine. `tweets` was
the first step to supply one, as `threadIsCurrent` in `src/tweets.ts`; since D0 on 2026-08-29 it is a
`stamp` in [`src/pipeline.ts`](../../src/pipeline.ts) like every other stamped step, and `sameStamp`
compares the stored `sourceHash` against what the store holds, with the prompt version and the
model id beside it — which is what [architecture.md § Storage](architecture.md#storage) has always
specified for a cached artefact and what nothing had implemented. Anything unreadable answers *not
current*: the cost of being wrong that way is one model call, and the other way round is a wrong
thread served for ever.

**A stamp has to cover everything the prompt reads, and four of them did not.** `tweets`, `glossary`
and `summary` hashed the blocks alone; `ideas` and `sketch` added the tree and left out the
metadata. Every one of those prompts is built out of the tree's skeleton and carries the article's
title, byline and site at its head, so the sections could be re-cut or the page re-extracted under a
new headline and the
step went on reporting itself current. All six are now fingerprinted against their own prompt
([`src/source-hash.ts`](../../src/source-hash.ts)) — two functions, because `ideas` and `sketch` send
a head with a `URL:` line and a synthetic title the other four never send; `assets` keeps the
blocks-only hash because the blocks really are all it reads. Nothing was visibly broken, and that is the shape to notice: the
pipeline's artefact reads return `null` today, so the stage re-runs whatever the stamp says. The
fault would have arrived with the reads that make skipping work.
[260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md) § stage 1.

The consequence worth stating: a refresh does not force the thread, but it does not strand one
either. The next time anything asks for `tweets` the hash no longer matches, so the step runs
without anyone having to remember.

### Forcing a step forces every step after it

This was wrong for an afternoon, and the way it was wrong is the reason it is now a rule rather
than a convention. "Refresh from source" was written as `force: ["fetch", "extract"]` — force the
two stages that read the outside world, leave the rest alone. But the rest are not independent of
them: `blocks`, `hierarchy` and `arc` all find their artefacts still on disk from last time, skip
themselves in milliseconds, and report three green ticks. What you get is **a freshly fetched
article under last week's tree and last week's arc** — every gist describing paragraphs that have
moved, and nothing anywhere saying so.

That is [silent success](../reusable/silent-success.md) exactly: the pipeline reports success, the
check you would naturally run (*did the refresh work? is the article current?*) says yes, and the
reading view quietly shows the wrong thing. Caught by an outside review rather than by using it,
which is the usual way with this family.

So `cascadeForce` in [`src/jobs.ts`](../../src/jobs.ts) expands any `force` to include everything
downstream of the earliest step named. The pipeline is a chain; invalidating a step invalidates what
comes after it, by definition. The alternative is asking every caller to remember a rule the
pipeline already knows.

### A step is done when *all* its files are there

`extract` writes the HTML **and** `meta.json`. `hierarchy` writes `tree.json` **and** its copy of
`blocks.json`. Each step declares an `outputs` list rather than a single artefact, and counts as
done only when every one of them is present — because a crash between the two writes would
otherwise leave a step reporting itself finished with half its output, and the stage after it
consuming the missing half.

**There are two copies of `blocks.json`, and it matters here.** Stage 3 writes
`output/<slug>.blocks.json`; stage 4 copies it into `data/<slug>/blocks.json` as it writes the tree,
so the pair in the data directory is guaranteed to be the one the tree was built from. Each step's
`done()` checks *its own* artefact — the first one for `blocks`, the second for `hierarchy`. Getting that
backwards means a finished `blocks` step reports itself unfinished until `hierarchy` has also run, so
every retry redoes stage 3 and a `{ steps: ["blocks"] }` job can never skip itself. Which also means:
run `blocks` on its own and the two copies disagree until you run `hierarchy` as well. That is the
pipeline's existing shape, not something the queue introduced, and it is why a re-run of a middle
stage should generally include the ones after it.

Sanitising is not a step. It happens *inside* `blocks`, at the top of `splitIntoBlocks`, so that the
stored `blocks.json` is already safe and no later consumer has to remember —
[`src/sanitize.ts`](../../src/sanitize.ts), and see [open-questions.md § Q9](open-questions.md) for
how that landed.

### `fetch` is its own step, and since 2026-08-27 it has two halves

**The second half is an upload**, and everything about it is above under
[Uploading a PDF](#uploading-a-pdf). The short version, here because this is the section somebody
reads when they are looking at the step list: same step name, same one output (`raw.json`), same
`beginStep`/`finishStep`/cancellation/`assertProduced` machinery — a different label and a
different way of coming by the bytes.

**Both halves count a PDF's pages before they store it**, and since 2026-09-04 that is the only work
this step does which is not [`src/fetch.ts`](../../src/fetch.ts)'s: an upload after the checksum and
before the promotion, a fetched document once the bytes are known to be a PDF and before `writeRaw`.
One helper called at two branch-specific points, so the call is duplicated and the policy is not —
[§ A PDF too long to read is refused here](#uploading-a-pdf).

That it is a *step* rather than something beside the step list was a review finding, and the
reasoning is worth keeping: work that floats outside the list bypasses exactly the machinery built
to make interrupted work visible.

#### Why it is a step at all

Stage 1 used to be three lines inside `src/extract.ts`. It is now a step with an artefact,
`data/<slug>/raw.html`, which [architecture.md § Storage](architecture.md#storage) has always listed
and nothing had ever written.

The reason is retries. Extraction going wrong is the common failure — Readability is a heuristic —
and when it does you want to try again **without asking the publisher a second time**, and without
the answer being different because they changed the page in between. The previous version of this
project reached the same conclusion from production:
[original-version/extraction.md § Keep the untouched original](original-version/extraction.md#keep-the-untouched-original).

The step itself is three lines because the work is [`src/fetch.ts`](../../src/fetch.ts), which
landed the same day from the agent who owns stage 1 — byte caps counted on the decompressed stream,
the page's own declared encoding rather than an assumed UTF-8, PDFs told apart by their bytes,
address checks before each redirect hop, and typed failures carrying a sentence a reader can act on.
Those sentences are what a failed step shows. It takes an `AbortSignal`, so cancelling a job stops
the fetch rather than waiting it out. See [fetching.md](fetching.md).

## The queue: it was p-queue, and now it is an index and a loop

**p-queue is gone as of 2026-08-27**, and the reason is worth keeping because the library was never
the problem. It was chosen on 2026-08-25 against
[third-party-library-selection.md](../reusable/third-party-library-selection.md) — **p-queue 9.3.3**,
33.6M downloads a week, one small pure-ESM package, concurrency and `AbortSignal` in the API — and
the rejected list below is still the right list for the question that was being asked.

What changed is the question. Concurrency 1 was a promise **this process** made, and the moment
there can be two instances it stops being a fact. It became `jobs_only_one_running`, a partial unique
index that the database enforced across all of them. The loop that keeps a laptop's job going after
the tab is closed is the pump in [`src/jobs.ts`](../../src/jobs.ts), which is `advanceJob` in a
`for(;;)` with a backoff — the same primitive the browser calls, with nothing privileged about it.

### Concurrency is a number now, and it was never a resource limit

**Until 2026-08-30 this section said "concurrency is still 1, and still deliberately"**, and the
argument it gave was a good one: three of the six steps are long model calls billed by the token and
one is a fetch of somebody else's server, so running two articles at once doubles the spend rate and
halves the politeness — *"for a single reader adding a handful of articles a day, in exchange for
nothing."*

The exchange stopped being nothing.

> In general, I think we will need the ability for multiple things to run simultaneously. What is
> stopping that? Is it worries about CPU/RAM/database connections? Or something else? Certainly
> having one job across all owners doesn't seem feasible. Can't we rely on Vercel and the LLM
> providers to scale?
>
> — Greg, 2026-08-30

Mostly yes, and the honest answer to *what is stopping that* was: a policy, not a resource. So the
index is gone ([`drizzle/0032_jobs_concurrency_cap.sql`](../../drizzle/0032_jobs_concurrency_cap.sql))
and the cap is `SPIDERYARN_JOB_CONCURRENCY` — `jobConcurrency()` in
[`src/jobs.ts`](../../src/jobs.ts), which is where the number and the reasoning live.

**A unique index cannot express "at most N", so the mechanism changed with the number.** `claim`
locks the `queue_state` singleton `FOR UPDATE`, counts the running rows inside that lock, and refuses
over the cap — [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts). Which is what `queue_state`'s own
comment had described since the day it was written, and what nothing did until now: the table was
seeded, protected by a delete trigger, and inert.

**The cost is that the database no longer enforces this at all.** The index was a backstop against a
claimant that did not follow the convention; a count inside a lock is only as good as every claimant
taking the lock. What stands in for it is a test — the parity suite's cap case, watched red against
a `claim` that ignored its argument, on both adapters
([`tests/store-jobs-parity.test.ts`](../../tests/store-jobs-parity.test.ts)).

**What the number rations is spend and provider rate limits**, not CPU, memory or connections. There
is no spend cap anywhere in this repo, and the label and summary fan-outs each multiply by N. It does
not ration correctness: two jobs still never *run* on one article, which is the article's own line
below and not this one.

**The pump does not start on Vercel.** It cannot outlive the invocation that made it, so all it
could produce there is a `running` row whose claimant is already frozen. The browser is the only
driver in production, which is what the advance endpoint was built for.

### The article's line

**Within one article the jobs form a queue; the cap above is across articles.** Greg, 2026-09-02:
*"can we always and by default append to existing per-article queue, so that we can run as much as we
like, and it simply takes longer?"* So a second, different request for one article is **created**,
not refused, and waits.

Four partial unique indexes on `jobs` arbitrate it ([`src/db/schema.ts`](../../src/db/schema.ts)),
and they replaced one — `jobs_active_slug`, unique on `(owner_id, slug)` over `queued` and `running`
— which had been doing three jobs at once. Splitting it is what let an article hold more than one:

| index | on | where | for |
|---|---|---|---|
| `jobs_one_running_per_slug` | `(slug)` | `status = 'running'` | the article mutex |
| `jobs_reserved_slug` | `(slug)` | active **and** `reserves_name` | name reservation |
| `jobs_active_work` | `(owner_id, slug, work_key)` | active **and not** `cancelling` | de-duplication |
| `jobs_active_source` | `(owner_id, url_key)` | active **and** `reserves_name` | one mint per address |

Two more things came with them and are easy to miss. `jobs_slug_order`, a **non-unique** index on
`(slug, created_at, id)` over the active statuses, is what the predecessor scan reads — it runs inside
the `queue_state` lock every claimant takes, so a sequential scan there would serialise the whole
account behind it. And a check constraint, `jobs_cancelling_is_running`: a `queued` row carrying
`cancelling` is a state the cancellation API cannot produce and nothing could clear, and it would sit
outside `jobs_active_work` while still blocking its article's line for ever.

**The first two are global on `slug`, not owner-scoped.** `articles.slug` is globally unique because
it is the URL contract, so two owners can build toward one name. De-duplication is a fact about one
person's request; the article is not.

**`reserves_name` is *the slug was minted*,** and nothing broader. `enqueue` fills `url` from
`meta.json` for a late step, so `{slug, steps:["ideas"]}` on an article that has been on the shelf
for a month carries a URL exactly as a fresh paste does — and that request is *naming* an article
rather than claiming a name. The fact is known at one moment only, which is why slug allocation
returns `{slug, kind: "minted" | "adopted"}` rather than a string
([`freeSlug`](../../src/jobs.ts)). An upload always mints, there being no address that could make two
uploads one article.

**A retry's allocation has three shapes and no fourth** — a mint that reserves, an adoption of a
durably published address, or an adoption with no address at all — and it reserves in the first,
which is what keeps re-taking the
failed attempt's name from opening the race `jobs_active_source` closes — and when the index refuses
it, it takes the holder's job rather than inserting an unreserved row. See
[§ A retry keeps the failed attempt's name](#a-retry-keeps-the-failed-attempts-name-and-that-is-a-decision).
Nothing on `jobs_reserved_slug` can object to re-taking the name, because all four of these indexes
are partial over `queued`/`running` and the attempt being retried is terminal.

**Which conflict fired is decided by re-reading, never by the constraint name.** One insert can
violate two of those indexes at once and Postgres promises nothing about which it reports; read as
the wrong one, the caller renames an article and pays for a second model call. So `enqueueOrGet`
keeps `on conflict do nothing` and classifies from the rows — `EnqueueOutcome` in
[`src/store/jobs.ts`](../../src/store/jobs.ts), four answers with four different repairs.

**The order is enforced at the claim**, and nowhere else: a job may claim only when **no older active
row and no other running row exist for the same slug**, ordered by `(created_at, id)`; otherwise
`busy`, *another job on this article is ahead of it*. Called a deterministic order rather than FIFO
on purpose — Postgres is given the application's millisecond timestamp and `id` is random, so two
requests inside one millisecond order by luck. What the rule guarantees is that the set of
predecessors is the same for every claimant and never empties out of order; two requests that close
together are a double-click, which de-duplication collapses into one job before the order can matter.

**The *"and no other running row"* half is not a refinement of the first**, and leaving it out cost a
500. A row whose insert commits after a newer one has already claimed the slug has nothing older than
it on the article, so an order-only rule lets it through — and its `UPDATE` then walks into
`jobs_one_running_per_slug`, which is a unique violation where the contract says wait. On the
filesystem store, which has no index underneath, it was worse: two jobs running on one
`data/<slug>/`. The late commit still does not get to displace the job already inside the article; it
waits like everything else.

**A predecessor that is stopping still blocks.** Stop on a *queued* job settles it terminal at once
and it leaves the line by itself; Stop on a *running* one leaves it `running` with `cancelling` set
until its claimant releases or its lease lapses, and the mutex still covers that row. The successor
unblocks when the cancellation becomes terminal, not when Stop is pressed.

**The cost, named rather than solved: an abandoned `queued` row blocks its own article's line.** It
is not swept, and there is no `last_seen_at` — that would turn *"durable until resumed or
cancelled"* into *"alive only while a browser keeps reaching the server"*, which is a product change
rather than the repair of an expired lease. A stuck queued job is a card with a Stop button, it
blocks one article and nothing else, and every owner tab drives it, so it only stays queued when
nobody is looking.

**And that is why `enqueue` requires you to own the article a slug-named request targets.** The
predecessor query is global on the slug; job lists and Stop are owner-scoped. Without the check,
owner B could queue `{slug, steps}` against owner A's article and walk away — the job fails closed at
claim under Postgres, but **nothing ever claims it**, so the row sits at the head of A's line for
ever. A URL or upload mint is the exception, governed by reservation instead. A slug you do not own
is a **404, not a 403** ([auth.md](auth.md)); a slug *nobody* has is allowed through, because a
random short id means no other reader can ever come to want that name.

**What serialising is protecting is corruption, not ambiguity.**
[`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts) keys every artefact write, the
`beginStep`/`finishStep` marker and `interrupted()` on `(slug, step)` in one shared `data/<slug>/`
directory with no job scoping, and on a laptop there is no per-job scratch to save it. Two jobs
running at once on one article would overwrite each other's output outright.
### On the filesystem, "one process" had to be made true

The files adapter has always said its fence holds within one process and not across two, and that is
still what it promises. What it did not survive was **one process with two copies of the module in
it**: saving anything the server imports restarts the Vite dev server in place, re-evaluating
[`src/store/jobs-fs.ts`](../../src/store/jobs-fs.ts) with empty Maps while the request inside a step
carries on. The new copy swept the `running` job back to `queued` and the browser started the same
eight-minute model call again — eleven times on one job, on 2026-08-30, at $5.43.

`QueueState` goes through [`src/process-state.ts`](../../src/process-state.ts) now, so the index and
the attempt tokens have the lifetime the file always claimed for them; `aborts` in
[`src/jobs.ts`](../../src/jobs.ts) went with it, because a Stop after a save had been reaching an
empty map. A restart is a **pause** rather than a duplicate: the new copy is told `busy` and the old
claimant's work is still used. The whole story, including why aborting the abandoned call would have
been the wrong companion fix, is
[260902c-the-truncation-retry-cost-storm.md](../postmortems/260902c-the-truncation-retry-cost-storm.md).

**Two OS processes over one `data/` are still not fenced**, and that is unchanged rather than fixed —
`claimIn`'s single `update … where status = 'queued'` is what makes Postgres immune, and running with
`SPIDERYARN_STORE=postgres` is what CLAUDE.md already asks for.
### The browser is the worker

So a wedged job in production is not a queue that needs draining. It is a job whose only engine has
walked away — and until 2026-09-01 walking away was ordinary navigation.

The loop that calls `POST /api/jobs/:id/advance` lived inside `useJobs`, which is mounted from the
shelf, the add page and `useStepJob`. **`App()` is a chain of early returns**, so it returns a
different root per route and there is no persistent shell component at all: every route change
unmounted all three, and `drive`'s `while (alive())` stopped.

**The plan for this work said that meant "click into an article and your import stops", and that was
wrong** — worth recording, because it is the claim two rounds of review were argued against.
`useArc` runs on every owned reading view and goes through `useStepJob`, so the reading view mounts
a poller of its own and picks the job back up within a second. What actually stopped were the routes
that mount none: `/profile`, `/design`, `/admin`, the landing page.

**The fault worth fixing was never the size of that gap.** It was that whether an ingest kept
running depended on whether the page you happened to open happened to mount an unrelated hook —
`useArc`, which exists for the arc feature and knows nothing about the queue. Condition that hook
for any reason, or stop calling it, and driving silently becomes route-dependent again with no test
anywhere that would notice. Driving was working by accident, and an accident is not a design.

[`src/web/jobEngine.ts`](../../src/web/jobEngine.ts) is the fix: **a module-scope service, one per
tab**, owning the poll timer, the job list, the visibility rules and one drive loop per job.
`App` starts it from a `useEffect` keyed on `user.id` and stops it when that changes; `useJobs`
became a `useSyncExternalStore` subscriber over its snapshot, plus the actions. Not a React
provider — a provider whose entire purpose is never to unmount is a component doing an imperative
service's job.

Three things about it are worth knowing before touching it, and each was argued out rather than
chosen:

- **When it polls, and what grants permission to ask.** `start()` is the only thing that wakes it,
  and `start()` comes from the reader's session. A mounted subscriber chooses the *cadence* — the
  active rate while any job is running, wherever the reader is; otherwise it sleeps until poked — but
  it does not grant permission. That distinction is deliberate and it was looser for a day: waking on
  *"started, or anything is subscribed"* let four old tests keep working without a session, and it
  meant the signed-out-reader-asks-nothing guarantee held only because no visitor route happens to
  mount `useJobs`. A guarantee that rests on nobody ever changing the component tree is not a
  guarantee. GPT Sol, 2026-09-01: *"test compatibility should not define production authentication
  semantics."*
- **Completion is a monotonic cursor, not a set.** A subscriber captures the engine's completion
  sequence during its **first render** and consumes events past it. A per-subscriber `Set` seeded in
  the subscription effect — which is what the old code did, correctly, while the poll belonged to
  the mount — would baseline away a job that finished between render and effect, and the engine now
  polls whether or not anything is mounted.
- **The session is fenced on `user.id`, in three places rather than one.** A public job carries no
  `ownerId`, so the engine cannot tell from the list that it belongs to the reader who just signed
  out. Every request captures a generation and every callback checks it — and the fence has to cover
  the **poll**, the **drive loop's claim on its job id**, and the **actions**. The middle one was
  missed first time round and is the subtle one: `stop()` clears the driving map, so a restarted
  session may rightly drive the same durable job, and the old loop's `finally` would then delete the
  *new* session's claim and let a second loop start. Each loop now carries its own token and releases
  only its own. Actions capture `jobEngine.epoch()` in `useJobs`'s `act`, or a fetch fired by one
  reader lands in the next one's error state.

  Signing out is **not** Stop: the durable job is left alone and reconciled when its owner returns.
- **A final 401 pauses everything, and there are exactly two ways out.** From a poll, an advance or
  an action — `apiFetch` refreshes and retries once on its own, so only the *final* one counts. The
  reader is not signed out and keeps the server's sentence on screen. It resumes on a new access
  token (`resume()`, wired through `useJobSession`) or on an action that succeeds. The hole worth
  remembering: a queued poke used to restart the poller straight past the pause, and if that poll
  succeeded it cleared the error while leaving the engine paused — a stopped queue with nothing on
  screen saying so, which is [silent-success.md](../reusable/silent-success.md) exactly.

### What the card says, and why it says the time

Each row of the progress list already names its step. Since 2026-09-01 a *running* step also says
how long it has been running, and one place decides what state an import is in:
[`src/job-state.ts`](../../src/job-state.ts), beside [`job-failure.ts`](../../src/job-failure.ts)
which does the same job for what a failure offers.

`displayJob(job, now)` is **pure, with the clock injected** — a mapper that reads the wall clock is a
mapper nothing can test — and returns one of eight states: `waiting`, `working`, `slow`, `stopping`,
`interrupted`, `failed`, `stopped`, `done`. Four things about it are decisions rather than details.

**It takes no lease, and cannot.** `Job` on the wire carries no `leaseExpiresAt`; it lives on the
Postgres row and the filesystem `attempts` map and never reaches `publicJob`. So *running with an
expired lease* is invisible to the browser until [the sweep](#the-browser-is-the-worker) settles it,
and that is the design working: taking a lease here would re-derive ownership in the reader's
browser. Elapsed time is a **display** clock and decides nothing.

**`interrupted` is the `[jb-gone]` code at the end of `job.error`**, not `failureKind === "retry"`
and not the sentence itself. Many failures are retryable; only one of them is *nobody was there any
more*. And it must be the code rather than the prose, because a reworded sentence would otherwise
**reclassify every job already stored** — which is exactly what a stable code exists to prevent. A
structured `endingKind` field would be the better long-term answer and was considered; it was
rejected for now because it could only classify jobs settled after it landed, and every interrupted
job a reader can see today carries the sentence and no field.

**The "taking longer than usual" threshold is per step, not global.** Six minutes into `hierarchy` is
an ordinary run; six minutes into `fetch` is a fetch that is never coming back. But a **threshold**
and a **promise** are different claims, and only the weaker one is affordable on this much data.

- A threshold says *past here, stop assuming this is normal*. Every step has one.
- *"This step usually takes N"* is a promise about finishing, and **one step has earned one**:
  `sketch`. `hierarchy` gets a threshold and no sentence.

`sketch`'s evidence is thirteen calls, all `ok`, 121–199s, median 144 — and the reason a *call*
duration may stand in for a *step* duration here is that a `sketch` step is one model call, and on
the single occasion the two clocks can be compared they agree exactly: the one real ingest step ran
159s and its one model call ran 159s. Twelve of the thirteen are eval or CLI traffic rather than a
reader's, which is a caveat about *what was drawn* and not about the clock — and is why the sentence
is a range.

**`hierarchy` keeps its ten-minute threshold rather than falling back to the default**, and the
reason is the sort that only shows up if you check: the default is 180s, which is **below the only
successful hierarchy run there has ever been** (187s). Letting it default would put a warning under
the one shape of run we have evidence for, every time. Two more grounds: hierarchy steps have been
seen doing genuine work for 498s — the two longest failures ran fifteen and seventeen successful
model calls before hitting the token budget — and the claimant self-aborts at 740s, so ten minutes
leaves ~140s in which the sentence is on screen before the lease settles the job.

**How to measure it, since three attempts got this wrong.** Read `data/_jobs/*.json`, take each step
whose **own** status is `done`, and compute `finishedAt − startedAt`. That is the same subtraction
the card shows, over the same two fields, so the number can be held to the screen. Successful steps
only, because a promise about finishing cannot be measured from something that did not finish.

> **The trap, sprung three times in one day, and the third time it survived two reviews.** The first
> figure came from grouping `_ai-calls.jsonl` by `runId`, which pulls in **eval batches of several
> articles under one id**. Corrected to group by `jobId` — and that version, *"hierarchy: six runs,
> median 409s"*, was wrong in both halves: **five of the six jobs failed at `hierarchy`**, so the
> median was a time to *failure* printed on a card as a time to finish; and model-call spans are not
> the clock `displayJob` shows, so the number could not be checked against the screen at all.
>
> **The tell was there and was argued away.** One "run" was 772 seconds, and no step can run that
> long — the claimant aborts itself at 740s. A measurement impossible under the code's own deadline
> is not a measurement. Noticing that and explaining it away is how a wrong number survives two
> reviews. GPT Sol found it on the third pass;
> [silent-success.md](../reusable/silent-success.md) is the whole of it.

**An unmeasured step still warns, and must not say "usual" while it does.** The default threshold is
a guess, so past it the reader is told the step *has been running for a while* — not that it is
longer than usual, which would be a statistical claim from no statistics.

**The card runs its own clock.** `ctx.report` writes `step.detail` in memory and never persists it,
so a job six minutes into `hierarchy` returns a byte-identical record on every poll and `sameJobs`
correctly suppresses the re-render — the elapsed time would freeze at whatever it read when the step
began. Both surfaces use `useNow(1000)` while busy and `null` — off — otherwise. It
said *a day* and called it a timer that never fires; it fired, once a day, per card.

**Transport health is deliberately not part of it.** Consecutive failed advances are not a fact about
the job — the job is fine; the *connection* is unwell — and are not on `Job` at all. `driverStalled`
is a separate question with its own threshold of three, which is about **sixteen** seconds of getting
nowhere — the first advance is immediate and the backoff follows a failure, so three land at ~0s, 8s
and 16s: two gaps, not three. It answers a real silent success: `drive()` swallows an advance
rejection and retries for ever, so a card could sit confidently at `queued` while every status poll
looked healthy.

It is rendered on **both** surfaces, through `StepJob.stalled`. It was on `JobCard` only for a day,
on the argument that reaching `JobProgress` meant threading a prop through eight panels — but a
reader drawing a sketch may never look at the shelf, so their one surface was the one that could
spin without the warning Stage 5 exists to give. `useStepJob` already owns the queue subscription, so
it computes `stalled` there; nothing about transport health went onto `Job` or through `displayJob`.
The prop is **required** rather than optional, so the compiler did the fifteen-file sweep instead of
a warning being quietly wired into two panels out of eight.

### There is no 409, and a second job on one article simply waits

> I got `Spideryarn is already busy with this article. Wait for that to finish, or stop it and ask
> again.` when I tried to run Ideas while Glossary was already running. Can we always and by default
> append to existing per-article queue, so that we can run as much as we like, and it simply takes
> longer?
>
> — Greg, 2026-09-02

**Asking for work on an article that already has a job in flight queues a second job.** It answers
202 with a new job id, the row goes in `queued`, and `claim` is what makes it wait its turn — see
[The article's line](#the-articles-line) above. Only *identical* work collapses onto the job already
doing it, so a double-click on *Find quotes* still costs one model call.

**A whole family of machinery went with the refusal on 2026-09-02**, deleted rather than left,
because dead machinery for a refusal that cannot happen is the next agent's wrong turn:
`JobConflict`, `ARTICLE_IS_BUSY`, `structuredDetail` in [`routes.ts`](../../src/routes.ts),
`blockingJob` and `lastBlocker` in `useJobs.ts`, `blocking` in `useStepJob.ts`, and the second
`<Band>` in `JobProgress.tsx` that drew the blocker with its own `WORKING_ON_THIS_ARTICLE` label.
Every panel that passed it lost a required prop. `HttpError.details` stays — it is generic and belongs to the
error type rather than to this case — but nothing on the server puts a structured field beside
`error` any more, and whatever brings one back must match **one declared class and read one declared
field** rather than spreading an error's own properties: a Drizzle failure's message carries bound
parameters, and a provider's carries its own words.

*`Too many articles already called "x"` is a different sentence and stays.* It is the retry budget
running out inside slug allocation, which is a fault rather than a queue state.

**No queue positions, and that is Greg's call.** A waiting job shows as waiting, in the card it
already has — `displayJob` says *Waiting to continue.* beside a Stop button. The reason a job is
waiting is **logged** at the claim rather than carried to the client, which is where *"why did this
sit for four minutes"* actually gets asked.

**Two lookups had to change with it, because each picked one row where several now exist.**
`useStepJob`'s `job` memo took the first active match out of a **newest-first** list, so a panel with
two matching jobs — a forced and an unforced glossary, whose work keys differ — bound to the newer one
and silently dropped the older one's progress and its failure. It takes the running match if there is
one, otherwise the **oldest queued**, which is the one `claim` will take next, with the same
`(createdAt, id)` tie-break so the panel and the server cannot disagree. And the upload
repeat-claim recovery in [`routes.ts`](../../src/routes.ts) looked for a job **by slug** over every
status, so reloading `/add/upload/<id>` could be handed a later mode job on that article, presented
as the reader's import; it matches `job.upload.id` now, which is the thing it meant.

### The app says out loud that it needs a tab open

> Keep a Spideryarn tab open while this imports. If you close them all, it will continue when you
> return.

Once per shelf, only while something is importing, and on the add page under its card. Until there is
a real background runner this is simply true, and calling the thing a queue without saying it
over-promises. **No determinate progress bar**, ever, for the same reason: response size and provider
latency are both unknown, so a percentage would be a number we invented —
[silent-success.md](../reusable/silent-success.md) with a decimal point.

The sentences themselves live in `src/job-state.ts` rather than `src/messages.ts`, and carry no
bracketed codes, because none of them is a failure — [copy.md](copy.md).

The plan and both reviews are
[260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md](../plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md).

### The rejected list, kept

Still the right answers to the 2026-08-25 question, and pg-boss is still the first thing to
re-evaluate — see [§ When this becomes Postgres](#when-this-becomes-postgres).

| Rejected | Why |
|---|---|
| **BullMQ** | The best-known of these and its `updateProgress` + `QueueEvents` is exactly the progress mechanism we want — but it needs **Redis**, and [architecture.md](architecture.md) says filesystem, one process, no infrastructure. Worth a second look one day: BullMQ 6 added a Postgres backend, though its own docs still call Redis "the most battle-tested option". |
| **pg-boss** | The runner-up — Postgres-only, nothing else to run, with retries, backoff, dead-lettering and cron included. It needed a database we didn't have, and adopting one to get a queue would have been the tail wagging the dog. **Postgres has since landed as a plan**, and this was reconsidered rather than inherited: still no, but for a different reason, and it stays the first thing to re-evaluate — see [§ When this becomes Postgres](#when-this-becomes-postgres). |
| **graphile-worker** | The same idea as pg-boss and a good library. pg-boss has 2.7× the downloads and 1.6× the stars, which under [our first criterion](../reusable/third-party-library-selection.md#selection-criteria) — pretraining data — is the whole difference. |
| **bee-queue** | Redis again, with less momentum than BullMQ. No upside. |
| **fastq** | Fine, and lower-level than we need. Its enormous download count is `glob` pulling it in transitively, not people choosing it. |
| **better-queue** | Looks like it does everything; last published September 2022, no types. A trap. |
| **Inngest, Trigger.dev** | Hosted SaaS, or a self-hosted stack of eight to ten containers. For one reader on a laptop. |
| **Nothing at all** — a hand-rolled FIFO | Genuinely viable at ~50 lines, and it was close. p-queue wins on the two criteria that matter here: an API a model already knows cold, and someone else owning the concurrency and abort edges. |

The previous version of this project had **no queue**, and is worth reading as evidence rather than
as precedent — [original-version/overview.md](original-version/overview.md). Its ingestion ran inline
inside Next.js API routes, with the browser tab as the orchestrator: a React component held the task
list and called the API once per unit of work. Their own docs call it a prototype shortcut, and it
cost them production 504s on long documents, lost all progress on a refresh, and never got migrated.
`PROJECT_STATUS.md` there still lists *"Background processing — move from frontend-driven to proper
job queue"* as unstarted. So: the server owns the queue here, and the browser only watches.

## Why polling

`GET /api/jobs` every second while anything is running, every eight seconds when nothing is.

A job is five or six steps over one or two minutes, so a one-second poll is at worst a second behind
something that changes every twenty; nobody can tell. What it buys is that the client holds no
connection. It survives the dev server restarting under it, which vite does on any config change. It
is the same three lines against a future standalone server, or against a serverless one where SSE is
awkward. And there is no reconnect logic to get wrong — the failure mode of a dropped `EventSource`
is a progress panel that quietly stops updating, which looks exactly like a stuck job.

The poll reschedules itself on each response rather than running on an interval, so a slow response
can never stack a second request on the first. It stops dead while the tab is hidden rather than
slowing down — an action's own poke still makes exactly one reconciliation request, and coming back
polls at once. See [§ The browser is the worker](#the-browser-is-the-worker) for who owns the timer.

## Idempotent is the goal; this is a step towards it

Greg, asked whether an interrupted job should survive a restart (2026-08-25):

> We want to get to the point where this is idempotent and simply picks up from where it started.
> But if that's a lot more work, then make a note somewhere that this is the intention, and build
> simpler machinery that's a step in that direction.

**What is built.** Every step declares the files it produces, and a step whose files are all already
on disk is *skipped* rather than run. Job records live behind `JobStore` — `data/_jobs/<id>.json`
written atomically on the filesystem adapter, a row on the Postgres one. On startup the filesystem
adapter returns anything still `running` to `queued`, because this process has just started and
nothing on disk can have work happening against it; Postgres cannot reason that way and uses a
**lease** instead. The steps keep their individual statuses either way, so a resumed job still shows
which stages finished, and **Retry queues the same steps and skips them**.

**A lease that nothing enforces is a note.** `settleExpired` is what turns an abandoned claim back
into something a reader can act on, rather than taken over. It runs at the top of every advance
rather than on a timer: there is no scheduler on Vercel, that is the exact moment somebody wants the slot, and it is
one indexed `UPDATE` over rows that are almost always none. It had **no caller at all** for the first
day of its life, which meant a killed instance left its job `running` for ever and every advance
answered `busy` — the in-memory queue had self-healed on restart, so this was a regression rather
than a gap. GPT Sol found it; see [260827m-durable-queue-code-review-sol.md](../plans/260827m-durable-queue-code-review-sol.md).

**It runs from two doors, and the second one is why a reader ever sees it work.** On Vercel
`/advance` only fires when somebody is *already* driving a job, so a sweep living only there was
structurally unable to reach the case that needs it most: the reader who comes back to a claimant
that died while they were away. Since 2026-09-01 `listJobs` sweeps too — **owner-scoped**, so one
reader's poll can never settle another's job, and gated on *the list already contains a `running`
job* rather than on *any expired lease*. That gate is deliberately the blunter of the two: `Job` on
the wire carries no lease, and sharpening it would mean exporting one, which is what keeps ownership
decisions on the server. Both log lines carry a `where` field, because the interesting question about
a settlement is which door found it.

**And it does not always end the job.** Since 2026-09-03 a lapsed claim on a job that has not used up
its budget goes back to `queued` **on its own row** — running steps back to `pending`, everything
else untouched — and only after that is it settled `error` / `[jb-gone]` with a Retry button. That
is what the filesystem adapter's `sweepStopped` has always done at restart, and Postgres had no
equivalent: on the store we actually ship, a deploy landing mid-ingest cost the reader their job. The
same row is the whole point, because the row keeps the slug, the slug keeps the article, and the
article keeps its checkpoints.

The budget is [`REQUEUE_BUDGET`](../../src/jobs.ts) — **two requeues, so three lease windows in
all** — and the number is the caller's while enforcing it is the store's, the same division
`LEASE_MS` and the concurrency cap already have. Without one a job that overruns every lease requeues
for ever, buying model calls nobody is waiting for. Three windows because each attempt starts with
every checkpointed chunk already banked, so one is the ordinary case, two covers a bad tail, and
three covers a deploy landing during the second. **It said three requeues until 2026-09-03**, which
was four windows against a justification that counted three — the constant and its reasoning meant
different things, and the reasoning was the half that was right (GPT Sol). Nothing requires *progress*
before a window is granted, so an un-checkpointed paid call can be bought once per window; the two
expensive fan-outs are checkpointed, which is why the number is the whole of the protection. The
budget is per *job*: pressing Retry makes a new job with a fresh two, so the reader is the outer loop,
and the machine gives up before the person does. `jobs.requeues` is the counter on Postgres; the
filesystem adapter keeps it in memory, so a restart resets the cap there — weaker parity, accepted
because a restart there is `sweepStopped`, which requeues with no budget at all, and because that
store is not what ships.

**What that costs, measured rather than asserted.** Statements per poll go **1 → 2 while a job is
running**, about **+1.5 ms** each locally, nearly all of it round trip rather than work — counted at
the driver over 300 iterations, not read off the source. An idle shelf is unchanged, because the gate
is closed. A 630-second worst-case import — the sum re-measured on 2026-09-04 in
[`src/jobs.ts`](../../src/jobs.ts) § `LEASE_MS`, the old line having said 520 — is therefore some 630
extra statements and well under a second of database time, and a long PDF that takes two claims pays
it twice. On Vercel→Supabase the round trip dominates, so the statement count is the
honest headline and the milliseconds are a floor. This paragraph used to say "one indexed `UPDATE`
over rows that are almost always none", which was fair when it happened once an advance and is not
when it happens once a second.

**And since 2026-09-01 it does not always fail, which is why it is no longer called `failExpired`.**
A row carrying `cancelling` is a reader who pressed Stop and then lost the claimant, so it settles as
**cancelled**, with the `error` and `failureKind` of any earlier attempt cleared — the field always
describes *this* ending. That makes three mechanisms agree rather than leaving one the odd one out:
`releaseStepIn` already settled a live claimant's release on a `cancelling` job as cancelled, and the
filesystem adapter's `sweepStopped` already did the same on restart. It returns
`{ id, status }` pairs rather than ids, because a caller that has to guess which of two endings it
just caused is a caller that will guess wrong, and the log says *settled N job(s)* accordingly.

**A terminal job never keeps a step that says `running`**, and the two endings differ. A **cancel**
settles the abandoned step back to `pending` with no sentence — the reader asked, so there is nothing
to explain. An **interruption** settles it as `error`, carrying `INTERRUPTED.message` and a
`finishedAt`. Otherwise the card draws a spinner on a job that is over, which is
[silent-success.md](../reusable/silent-success.md) with the reader as the thing that fails quietly.

**Why the sentence goes on the step and not only on the job**: `JobCard` renders `step.error` and
**never** `job.error`. That is worth knowing before you change either, because the first version of
this settled both endings to `pending` on the reasoning that a step sentence would duplicate the
job's — and the reasoning was about a UI that does not exist. It shipped an interrupted job showing
a muted pending step, a Retry button, and no explanation at all. `JobProgress`, the other renderer,
is the mirror image: it shows the job's sentence and never the step's. So storing both duplicates
nothing on either surface. GPT Sol found it on 2026-09-01.

**The lease is the database's arithmetic, end to end** — and it is `clock_timestamp()`, not `now()`.
`claim` mints `clock_timestamp() + leaseMs` and every expiry comparison uses the same function;
endings still stamp `now()`. It was `Date.now()` at both ends first, which is one clock on a laptop
and two the moment a Vercel function talks to Supabase; and then it was `now()`, which is worse than
it looks, because **`now()` is transaction-start time**. A claim that waited behind the `queue_state`
lock would take a back-dated lease, and a statement that crossed its deadline while blocked would be
judged on the time before it waited.

**The fence has four conditions, not three, and expiry is one of them.**
[`src/store/job-fence.ts`](../../src/store/job-fence.ts) holds `liveAttempt` — id, attempt token,
`status = 'running'`, **and a lease that has not run out** — shared by
[`pg-jobs.ts`](../../src/store/pg-jobs.ts) and by all three job fences in
[`pg-revisions.ts`](../../src/store/pg-revisions.ts), which is what covers the draft, the step runs
and the publication. Its own module because `pg-revisions.ts` importing `pg-jobs.ts` would be the
kind of cycle `npm run check` gates on.

Until 2026-09-01 there were three conditions, and **expiry therefore revoked nothing on its own**:
a claimant whose lease had lapsed could still commit, as long as it got there before Stop or the
sweep won the row — including committing an interruption over a reader's Stop. `leaseIsOver` is the
exact complement of the fence's lease test, so *the fence refuses if and only if the sweep may
settle*, and there is no instant where a job is neither writable nor settleable. GPT Sol, 2026-09-01.

**A `running` row with no lease at all counts as over, not as ask.** `jobs_running_is_fenced` makes
it unreachable, so both answers are dead code — but *ask* is the one that would leave such a row
disabled at "Stopping…" for ever, with neither the claimant nor the sweep able to move it, and *over*
makes it recoverable by machinery that already exists. It also matches the filesystem adapter, where
no entry in `attempts` has always meant lapsed.

**Taking a job away from a claimant is deliberately not done.** Guessing that an owner is dead is how
two runners end up writing one article, and it is only safe once every durable write is inside the
fenced transaction — [260827j-transactional-stage-runner.md](../plans/260827j-transactional-stage-runner.md), not
built. What makes an expired lease mean something in the meantime is that the claimant sets **its own
timer**, shorter than the lease, and aborts its own step: so a lapsed lease says *the process is
gone* rather than *the process is slow*.

So in practice: the server dies during `hierarchy`, you press Retry, and `fetch`, `extract` and `blocks`
are skipped in milliseconds while `hierarchy` starts again. That is "picks up from where it started" for
the case that matters — the two model calls, which are the expensive part.

**The check used to be existence, and it is not any more.** A step now declares `produces` — the
*kinds* of thing it makes, `tree`, `labels`, `blocks` — beside the old `outputs` list of paths, and
an **artefact store** ([`src/store/artifacts.ts`](../../src/store/artifacts.ts), file adapter
[`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts)) answers whether they are all there.
It answers by **parsing**, not by `stat`ing, which is the fix for the truncation hazard this section
used to list as unbuilt: a `writeFile` killed halfway leaves a file that exists and will not parse,
and that used to report its step done. `stepIsDone` takes a store, so the same question will be
asked of Postgres columns without the pipeline changing — and the store is now a **required**
argument rather than one that quietly defaults to the filesystem, since a Postgres caller that
forgot it used to compile and get a confident answer about the wrong store. See
[260826e-postgres-storage-implementation.md § Step 11](../plans/260826e-postgres-storage-implementation.md), half B.

**One step asks a second question, and only one.** `extract` and `blocks` write to the same path —
`output/<slug>.html`, first as Readability left it and then with the block ids stamped in — so the
filesystem cannot tell the two apart, and both are "some non-empty text". After a re-extraction an
old `blocks.json` therefore sat beside new *unstamped* HTML with every check passing, and the
reading view served an article whose paragraphs had no anchors and whose comments pointed at
nothing. `blocks` now checks that every id in its `blocks.json` is actually in the HTML beside it —
exact, not a spot check, and cheap because stage 3 makes no model call and re-running it carries the
ids over rather than minting new ones.

**What is still not built, honestly.** Three things, roughly in order of value:

1. **A freshness stamp for every step.** [architecture.md § Storage](architecture.md#storage)
   specifies that `tree.json` is keyed on `hash(blocks.json) + prompt version + model id`. Three
   steps implement it — `tweets` and `summary` via the optional `isDone` above, `glossary` via the
   newer `stamp`, which hands the store four values and lets one `sameStamp` do the comparing.
   `tree.json` and `arc.json` carry no hash at all, so `hierarchy` and `arc` are still presence-only, and
   `arc` still needs the force-cascade to notice that its tree moved. `labels.json` *does* carry
   one, which is what `hierarchy`'s stamp is read from today even though nothing yet compares it.
2. **Atomic artefact writes across a step's whole set.** `hierarchy` and `labels` write temp-then-rename,
   and the store's `write` does too; the other stages still write in place, and none of it makes the
   *pair* `extract` produces atomic. Only a database transaction prevents that.

   **And the state a kill leaves is worse than "one artefact of two", which is what this said until
   a review read the code.** `has` requiring all of `produces` catches a *missing* half. It cannot
   catch a *replaced* one: leave a complete generation A on disk, let a rerun overwrite exactly one
   of the step's three outputs with a perfectly good generation B and then die, and every path is
   present, parses, and is individually beyond reproach. The step reported itself done, holding two
   generations at once, and no amount of looking at the files could say so.

   So the store records the **attempt** as well as the output —
   [`beginStep` / `finishStep` / `interrupted`](../../src/store/artifacts.ts), a marker under
   `data/<slug>/steps/` on the filesystem and `revision_step_runs.status` in Postgres. A marker
   still sitting there is a run that did not finish, and a run that did not finish is not done
   however good its files look. `finishStep` is on the success path only, so a throw, a cancel and a
   `kill -9` all leave the same honest answer.
3. **Automatic resume on startup**, rather than a sweep to `error` and a Retry button. Cheap once
   (1) and (2) hold, and unwise before then: automatically re-running steps against artefacts we
   cannot vouch for is how you get a tree built for the previous version of an article.
   **Built on 2026-09-03, twice over** — `REQUEUE_BUDGET` above. The reason it became safe is
   (1) and (2): the requeue drops the job's draft pointer, so every step re-asks `stepIsDone` about
   *artefacts* rather than trusting its own record, and the expensive half is held by the checkpoints
   instead. Carrying the draft across attempts is still not done — that is decision 8 of
   [260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md).

The sweep-then-retry shape is deliberately the same one
[`sweepOrphaned`](../../src/routes.ts) uses for comments, and for the same reason: a status of
`running` on disk does not mean work is happening, and a spinner that spins for ever is the worst of
the available outcomes.

Related, and the reason a failed job stops rather than continuing: every step consumes the artefact
the one before it wrote. Carrying on past a failure would run the two model calls against whatever
stale file happened to be on disk, and produce a tree for the previous version of the article —
which looks entirely fine. A [silent success](../reusable/silent-success.md).

## The failures Retry is not offered under

Until 2026-08-26 the button appeared under every failure. That included the ones that are
arithmetic. Greg pasted a long article, stage 4 worked out that its answer would not fit in one
model response, said so, and offered him a Retry — which made the identical call and failed
identically. The whole story is in [260826a-toc-max-tokens.md](../postmortems/260826a-toc-max-tokens.md).

**A failure can now say what kind it is**, and the card asks before drawing the button. The kinds
are the four in [`src/messages.ts`](../../src/messages.ts) — the same four the reader-facing failure
sentences already use — and three of them mean another go cannot help.

- A stage says so at the throw site with `stageFailure(kind, { generic: detail })` — or with
  `stageFailure(failure, detail)`, which says the kind *and* writes the reader's sentence
  ([`src/job-failure.ts`](../../src/job-failure.ts)). Grep for that name to see every claim the
  pipeline makes. The `{ generic }` is a second claim, and since 2026-09-04 the compiler insists on
  it: *I know the reader gets the generic copy for this kind, and that is correct*
  ([copy.md § The seam between the two audiences](copy.md#the-seam-between-the-two-audiences)).
- [`src/jobs.ts`](../../src/jobs.ts) copies it onto the job as `failureKind`, beside the message it
  already copies. On the job and not on the step, because Retry is a job-level action and the runner
  can fail with no step having failed.
- [`AddArticle.tsx`](../../src/web/AddArticle.tsx) asks `jobWorthRetrying(job)`. Nothing takes the
  button's place when it is hidden: the failed step's own message is already on the card and already
  says why.
- **[`JobProgress.tsx`](../../src/web/JobProgress.tsx) asks the same question**, since 2026-09-03.
  Until then the band drew its ordinary run button again under every failure and never asked — so
  one job could offer a button on the shelf and withhold it in the band, or the reverse, and the
  band is the only surface a reader inside a mode has. It gets the same Retry
  (`POST /api/jobs/:id/retry`) and the same silence where the button is withheld. The answer
  reaches it as `StepFailure.retryable`, a field on the failure rather than a prop beside it, so a
  panel cannot wire the sentence and forget the judgement
  ([`src/web/useStepJob.ts`](../../src/web/useStepJob.ts)).

**A structured field rather than a bracketed code**, which is the other half of how a failure can
carry its kind. The codes exist because a stored chat message or comment keeps `err.message` and has
nowhere else to put anything (see `kindOfMessage` in `src/messages.ts`). A job is a struct with room
for a field, so it takes the field rather than inheriting a workaround it does not need. The one
place `failureKindOf` still reads a code is a failure thrown by the model-call layer, which is the
layer with nowhere else to put it.

**Not a `permanent` flag.** Nothing here is permanent: configuration changes, providers change their
policies, and websites change what they serve. The answerable question is narrower — *should this
unchanged attempt be offered again now?*

**Which way to be wrong.** A failure that says nothing gets the button. That is for compatibility:
every job recorded before the field existed carries nothing, and so does one the restart sweep
marked, which really is worth another go. It is not because a wasted click is cheap — here a false
retry costs minutes of pipeline and another billed model call, which is a good deal worse than the
same mistake on a chat message.

**What makes a failure permanent is Retry's own shape.** For an ordinary job `forceForRetry` forces
nothing, so a retry never *forces* a step that already succeeded — but that is not the same as never
rerunning one. Under Postgres a failed attempt's draft is discarded, and whatever its steps wrote
went with it, so the new attempt's own freshness checks may find them gone and correctly rerun them
anyway; only on the filesystem store, where an artefact really does stay on disk, is the skip
guaranteed. A stage that failed while reading an artefact an earlier step wrote will read that
identical artefact again. That is what separates the two lists:

| Cannot come out differently | Might |
|---|---|
| an answer too long for one response (`TooLongForOnePass`) | a model answer that would not parse |
| a missing source URL — Retry asks the same `meta.json` | the wrong number of arc sentences |
| a page Readability already refused, over cached bytes | an empty answer, a refusal, a timeout |
| a tree that does not contain its own root | a fetch that failed at somebody else's server |
| a PDF over the page cap, or a chunk over the request cap | a nav-label batch that came back truncated |
| a PDF that will not open — locked with a password, or damaged past parsing | |
| a source document whose stored bytes are damaged — it is content-addressed, so a re-fetch lands on the same bad bytes | |
| an answer truncated at `max_tokens` — *see below* | |

Model-output validation failures are in the right-hand column on purpose. The next call is a fresh
draw, and the whole reason those checks are loud is that the model does occasionally get it right on
the second attempt.

**A *refresh* is the exception, and since 2026-08-31 it re-runs from the top.** A forced job's steps
finish into a **draft**, and a failure throws that draft away — so "this step already succeeded" is a
statement about a revision the retry cannot see, and honouring it published the old article under a
row of green ticks. `forceForRetry` now re-forces everything the original request forced (Greg's
decision 8; [260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md)
§ *The fourth fault*). The cost is deliberate: a refresh that dies late re-fetches and re-extracts.
It no longer **pays** for the PDF transcription a second time, which this paragraph said until
2026-09-04 — the per-chunk checkpoints are keyed on the article and a refresh is of an article
already on the shelf, so the second run re-reads its own finished chunks rather than re-buying them
([content-extraction.md](content-extraction.md)). So the left-hand column above is about an ordinary
retry — a refresh really does go back to the publisher.

**Truncation is the one entry that is not certain, and it is worth being exact about why.**
`TooLongForOnePass` is arithmetic: the same block count gives the same estimate for ever. Running
past `max_tokens` mid-answer is not — adaptive output varies between calls, and what we have is two
observations on one article. So it is `bug` rather than `blocked`, because the thing that needs
changing is a constant in [`src/token-budget.ts`](../../src/token-budget.ts) rather than anything
the reader can do, and the sentence says **unlikely** rather than *will*. The button and the copy
have to agree; softening the sentence is the honest way to make them.

It is `truncationFailure` that carries the tag, and it returns an `Error` rather than a string
**so that `throw new Error(truncationFailure(…))` does not compile.** Five stages meet a truncation
— hierarchy, arc, summary, glossary, thread — and each used to build its own `new Error` around the
message, which is precisely how a sixth stage added next month copies the line without the tag and
nothing says so. The type is the guard.

`src/labels.ts` is the deliberate exception, and the only caller left taking the bare sentence. It
throws `BatchIncomplete`, which the stage **catches and retries with double the headroom** — so the
same attempt has not been made twice, and the claim does not hold. If that retry also fails, what
escapes is a fresh error combining both messages, and the second failure is often a 429 or a refusal
rather than a truncation. Hiding the button there would be wrong on both counts.

`FetchFailure.retryable` in [`src/fetch.ts`](../../src/fetch.ts) is deliberately **not** wired into
this. It marks a plain HTTP 500 non-retryable while 502–504 are retryable, which is a sensible
enough thing for a fetch layer to believe and not a claim that the page will never load.

## The one security check

`isSlug` in [`src/ingest.ts`](../../src/ingest.ts) is a path-traversal guard, not a tidiness check.

A slug arrives from the client on `POST /api/jobs` and is joined onto `data/` and `output/`, so
`../../.ssh` has to be refused there or it is refused nowhere. It lives beside `slugFromUrl` because
the two must not drift: everything `slugFromUrl` can produce must pass, and
[`tests/ingest.test.ts`](../../tests/ingest.test.ts) asserts both halves.

For the `{ url }` shape the slug is **derived, not accepted** — the add box shows you the same
derivation so the two agree by construction rather than by trust.

## The routes

```
  GET    /api/tweets/:slug     the thread, and whether it still describes the article
  GET    /api/jobs             every job this server knows about, newest first
  POST   /api/uploads          { filename, bytes, sha256 } → 201, where to PUT a PDF and for how long
  GET    /api/uploads/:id      what became of one upload
  POST   /api/jobs             { url } | { uploadId } | { slug, steps?, force? }  → 202, the job
  GET    /api/jobs/:id         one job — what the poll reads
  DELETE /api/jobs/:id         forget a finished job's record (artefacts untouched)
  POST   /api/jobs/:id/cancel
  POST   /api/jobs/:id/retry   → 202, a NEW job with the same steps
```

`POST /api/jobs` answers **202**, not 200: the work has been accepted and has not been done, and the
body is a receipt to poll. Retry creates a new job rather than mutating the old one — what went
wrong the first time is worth keeping, and overwriting it would erase the only evidence at exactly
the moment somebody is trying to work out what happened.

**Retry answers 409 for anything the card would not have offered**, and until 2026-08-31 it checked
nothing but ownership. That was harmless while a retry of a finished job forced nothing — every step
found its artefacts current and skipped — and it stopped being harmless the same day, when
[`forceForRetry`](../../src/jobs.ts) began re-forcing everything the original forced. A *successful*
forced refresh could then be POSTed to its own `/retry`, re-force every step, pay for the PDF
transcription again, and be done to each completed replacement job in turn for as long as somebody
kept asking. GPT Sol,
[260831b-stage3-items3and4-review-sol.md](../plans/260831b-stage3-items3and4-review-sol.md) finding 3.
So [`retryJob`](../../src/jobs.ts) now refuses a job that is not `error` or `cancelled`, and one that
`jobWorthRetrying` says would fail the same way — the same two questions the button already asks
(`src/web/AddArticle.tsx`). The rule is written twice deliberately: the button asks what to draw,
the server asks whether to spend, and a client is not where a spending rule lives. Somebody else's
job stays a **404** (`null`), because *no such job of yours* and *that job is not a candidate* are
different answers.

Cancelling stops a queued job outright, and a running one as fast as the step it is in allows. Every
step gets the `AbortSignal`: the fetch layer folds it into its own deadline, and the Anthropic SDK
takes one directly, so a model call stops mid-stream. The tokens already streamed are paid for
either way, so there is nothing to save by letting the call run on — and a Stop button that does
nothing for two minutes is a Stop button that looks broken. Between the click and the step
unwinding the job carries `cancelling`, which is why the button says "Stopping…" rather than
staying "Stop" — but only while a claim is live. A Stop that lands on a claim whose lease has already
lapsed goes straight to *stopped*, because there is nobody left to wait for.

### Stop is one statement, and it used to be two

The decision — *is anybody inside this job?* — happens **inside the `UPDATE`**, and since
2026-09-01 it has three answers rather than two. Queued means over right now. Running with a lease
that has **lapsed** means over right now too. Running with a live lease means set `cancelling` and
let the claimant read it at its next step boundary.

**The lapsed branch is what makes Stop mean what it says.** The claimant sets its own deadline
*inside* the lease and aborts itself ([`src/jobs.ts`](../../src/jobs.ts) § `LEASE_MS`), so a lapsed
lease says the process is *gone* rather than *slow* — there is provably nobody to read a flag.
Without it, Stop on a dead claimant showed a disabled "Stopping…" for up to 12.67 minutes and then
reported the job **interrupted**, which is not what the reader did.

Two things about that branch are load-bearing. It settles with **`settleExpired`'s field set, not the
running branch's** — `draftRevisionId` included, because the running branch deliberately leaves the
pointer for the claimant to dispose of, and a terminal row still holding one is a draft
`sweepAbandonedDrafts` spares for ever — a sweep which, checked 2026-09-04, **nothing calls**, so
failed drafts accumulate without bound. Ranked and deliberately not built in
[260904a](../postmortems/260904a-a-retry-minted-a-fresh-name-so-the-checkpoints-could-never-be-found.md). And the condition is written **once**, as `over`, and reused
across every `case`: seven branches that have to agree is the shape of the bug this section is about.

**There is deliberately no force-stop short of the lease.** A live claim may genuinely be working,
and clearing it out from under a claimant is how two runners come to write one article.

It was two calls until 2026-08-27, cancel-if-idle and then ask, and GPT Sol found what lives in the
gap between them. A claimant that releases in that gap turns the job `queued`; the second call then
writes `cancelling` onto it; and **nothing in the system ever moves that row again** — every later
claim reads the flag, answers `stopping`, and the reader's Stop button is already disabled because
the job says it is stopping. A job stuck for ever, with no error, from two statements that were each
correct.

The same state is reachable from the other end, so `releaseStep` is also where a cancel that arrived
mid-step lands: a step that succeeds under a Stop ends the job rather than requeueing it.

**Stopping a job on one instance and running it on another works**, which is the part the abort
signal cannot do. An `AbortSignal` is a thing a running function is listening to, and a second
instance has no function to interrupt — so Stop is two halves: the flag, which everybody can see, and
the local abort, which only helps when the claimant happens to be here. That is why Stop feels
instant on a laptop and takes until the next step boundary in production.

**Stop and the claimant's own deadline share that one signal, and the reader must not.** A step
listening for one is listening for both, deliberately — but the *account* the reader is given differs,
and until 2026-09-04 it did not: an overrun took the branch written for Stop and the card said *"You
stopped this before it finished"* to somebody who had pressed nothing (seen on a 144-page PDF, at
742.8 s). The abort now carries a typed reason, `DeadlineReached` in [`src/jobs.ts`](../../src/jobs.ts),
and an overrun reads `INTERRUPTED` on the step as it always did on the job. **A deadline overrun is
also not a lapsed lease** and does not go through the requeue budget above: the claimant is still
here, it unwinds, and `walkClaim` ends the job as a retryable error for the reader to pick up.

**The claimant's timer is armed at the claim, not after the session opens.** Everything above rests
on the claimant aborting itself *inside* its own lease, and for a while it did not: the timer was
created after `parts.session(...)` had been awaited, which under Postgres is two row locks and
possibly a block copy — with no deadline armed for any of it. The real deadline drifted later than
the arithmetic assumed, which is precisely what let a claimant still be alive when its lease lapsed.

## Naming the step is the point

Each row of the progress list says what is happening: *Extracting the article*, *Building the table
of contents*. Not "Step 3 of 5", and not "Loading…".

That is the one thing the previous version got right without a queue at all —
[original-version/extraction.md § Document lifecycle](original-version/extraction.md#document-lifecycle-atomic-no-processing-state)
records a blocking screen with method-aware captions, and
[design-system.md § Loading](original-version/design-system.md#loading-states) is the reasoning. A
named step tells you what is slow and what is about to fail. A counter tells you neither.

The two model steps also report as they stream — how much has arrived, not what it says, because the
JSON is unparseable until it is complete. That is a deliberately low bar: the question a reader
watching a two-minute step is actually asking is whether anything is still happening.

## The box only shows this sitting

> The "Add an article" shows this long history of imports. Perhaps just show the most recent, or the
> ones since the page was opened, with the rest hidden by default, and a button to expand them. Or
> move them to a separate History page. Use your judgment.
>
> — Greg, 2026-08-27

Three rules had each been right on its own and added up to the wrong thing. A **successful** job
leaves the box eight seconds after it finishes (`KEEP_DONE_MS`), because the article it made is on
the shelf directly below and that is the better place to look at it. A **failed** one never leaves
at all, deliberately: the card is the only account of what went wrong, and clearing it on a timer
would take that away while the reader was still reading it. And the server keeps **fifty finished
jobs per reader**, favouring failures where the two kinds compete for a slot, for the same reason
(the rule is `src/store/pg-jobs.ts` § `trimFinished`).

So the box meant to say *here is what is happening now* was, on any shelf more than a few weeks old,
a column of every import that had ever gone wrong — sitting above the shelf, which is the actual
point of the page.

**The line is when the tab was opened**, and everything past it is folded behind one chevron:
`n earlier imports`. That is `TAB_OPENED_AT` and `earlier` in
[`AddArticle.tsx`](../../src/web/AddArticle.tsx).

Three things about it are worth writing down.

**Not a separate History page**, which was Greg's other suggestion. A page needs a route, a link
somebody has to find, and a reason to visit — and the value of these records is nearly all in the
first minute after something breaks, when you are already looking at the place it broke. A
disclosure keeps them where they happened and costs one line.

**The clock is module scope, not a mount.** Adding an article navigates to `/add/<url>` and coming
home remounts the component, so a per-mount clock would fold the failure you caused thirty seconds
ago into "earlier" before you had read it. This is client-side navigation inside one tab, so a
module constant is exactly *since the page was opened*. A real reload resets it, and should — that
is a new sitting.

**The failures are counted on the collapsed line**, in the destructive colour, whether or not it is
open. Everything under there is finished, so the only reason to look is that one of them went wrong;
a disclosure that hides a failure without mentioning it is
[silent-success](../reusable/silent-success.md) with the *reader* as the thing that fails quietly.
Cancelled jobs are not counted — you stopped it, and you know you did.

The rule that a test can hold on to is **when in doubt, show it**: `earlier` is a positive test, so
anything still running, and anything whose `finishedAt` cannot be read, stays on screen.
[`tests/add-article-history.test.ts`](../../tests/add-article-history.test.ts) pins that, because a
job hidden by mistake is a failure the reader never learns about and nothing on the page looks wrong.

## A finished job publishes the article, and until 2026-08-30 it did not

`grep -c publishRevision src/jobs.ts` answered **0**. The stages ran, wrote their files, the job went
`done` — and `articles.current_revision_id` never moved, so the reader's shelf stayed empty after an
ingest whose every step was green. Publication was a human running `npm run db:import`.

What closes it is the **session a claim runs on**: [`claimSession`](../../src/jobs.ts) picks
[`pgStoreSession`](../../src/store/pg-session.ts) under `SPIDERYARN_STORE=postgres`, every step
writes its product into that claim's own draft revision, and a `done` ending publishes the draft and
finishes the job in **one transaction**.

Five things about it are worth knowing before touching it.

- **It is the session, not something bolted onto the coordinator.** A `done` ending reaches the store
  through two doors: `commit`, when the last step ran, and `settleJob`, when every step skipped. A
  finalizer after the walk would see only the second — and for the first it would arrive *after* the
  job row already said `done`, which is the crash gap
  ([260830a-v1-imports-review-sol.md](../plans/260830a-v1-imports-review-sol.md) critical 2): a kill
  between the two leaves the article published and its job failed, with Retry blocked by a guard that
  now sees an article.
- **Only `done` publishes.** A job that failed, was cancelled or was interrupted publishes nothing
  and leaves the reader on the revision they already had; its draft is failed in the same transaction
  and the job's pointer to it is cleared, so nothing is left for the sweeper to spare for ever.
- **The draft is opened when the claim starts**, not at the moment of publication, and that is what
  lets a claim adopt what an earlier request of the same job left behind — a two-step job whose first
  request ran `fetch` and handed the claim back holds that work in the draft, so the second request
  can skip the step and still publish it.
- **It only happens under `SPIDERYARN_STORE=postgres`.** On a laptop where the flag is `files` — set
  explicitly, since `npm run dev` itself now defaults to `postgres` — the session is the filesystem
  one and behaves exactly as it always has: no draft, no publication, no database.
  [`tests/claim-session-files.test.ts`](../../tests/claim-session-files.test.ts) is that half of the
  claim, and it proves it by taking `DATABASE_URL` away.
- **Opening it is a database call, so it can fail — and that failure ends the job.** Three doors reach
  the same recovery in [`src/jobs.ts`](../../src/jobs.ts) (`endAsStorageFailure`): the publication
  that goes wrong when every step skipped, the session that would not open at all, and the draft that
  goes away *underneath a live claim*. All three fail the draft, clear the job's pointer to it and
  terminalise the job in one transaction, because a job left `running` holds the global slot until
  its lease lapses and offers the reader no Retry either. The kind the database boundary gave the
  failure is **kept** rather than rewritten as `retry`, so a permanent refusal does not reach the
  card promising that another go is safe.
- **A claim that loses its draft is not a claim that lost its job**, and the third door exists
  because the two used to be one error. `jobs.draft_revision_id` is `on delete set null`, so deleting
  a draft revision takes the pointer out of a live claimant's row silently; the fence
  (`requireLiveJobOwnsDraft` in [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)) then
  refused, and until 2026-09-02 it said the same thing it says when the *job* has moved on. The walk
  believed that, answered `busy`, and left a `running` row nothing could claim, stop or finish for
  the 760 seconds of `LEASE_MS` — with every other job on that article queued behind it. The fence
  now raises `JobDraftGone`, which crosses the session seam as `DraftGoneError` and ends the job.
  [260902f](../postmortems/260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md);
  the reproduction is
  [`tests/a-claim-that-lost-its-draft.test.ts`](../../tests/a-claim-that-lost-its-draft.test.ts).

**A decorator held this seam from 2026-08-30 to 2026-09-01**, and it is worth a paragraph because
several plans and reviews are about it. `publishingSession` wrapped the *filesystem* session and, at
the end of a `done` job, copied the files the stages had written into a draft and published that. It
existed because the stages wrote their own files inside `run()` and returned nothing a session could
write, so `pgStoreSession` would have refused every one of them by name. Every step returns its
product now, so the copy has nothing left to do, and the flip
([260831b](../plans/260831b-finish-the-database-move.md) § Stage 3 — the flip) deleted it.
[`copyArtefacts`](../../src/store/copy-artefacts.ts) stays, as the fixture loader it started life as.
[`tests/claim-session-postgres.test.ts`](../../tests/claim-session-postgres.test.ts) is the proof,
and the trick that makes it evidence is a **fresh empty scratch root per claim**, so filesystem
persistence cannot quietly do the work Postgres is supposed to be doing.

## When this becomes Postgres

`Job` and `JobStep` live in [`src/types.ts`](../../src/types.ts), shaped as table rows — every field
a scalar or a small blob a column could hold. The same discipline `LibraryEntry` follows
([library.md § When this becomes Postgres](library.md#when-this-becomes-postgres)).

**Updated 2026-08-25.** The row that said "pg-boss" is
[reversed by the Postgres plan](../plans/260825f-postgres-migration.md#the-queue), and the row that said
`LISTEN/NOTIFY` was simply wrong. Both are corrected here rather than left to disagree.

| Today | Then |
|---|---|
| `data/_jobs/<id>.json`, one file per job | a `jobs` table, `steps` as `jsonb`. **`id` stays `text`** — jobs are minted by the same `mintId()` as blocks, so they are `spya-` ids, not uuids |
| p-queue, in the server process | our own `jobs` table plus a singleton `queue_state` row, claimed under a lease, surviving the process |
| restart sweep marks orphans `error` | lease expiry, and a rescue sweep that reclaims what a dead worker held |
| one process, so the in-memory map is authoritative | the table is authoritative, and every write is **fenced on `attempt_id`** |
| polling `/api/jobs` | still polling — it is fine, and it is the part that does not need to change |

Three things that changed since this table was first written:

- **Not pg-boss after all.** The original reason to reject it (a second client and its own pool) has
  gone away now that we connect to Postgres directly, so it was reopened honestly. It is still not
  being adopted, for a weaker reason: our `jobs` table is unusually rich — per-step state, a
  cancellation that must *not* release the global slot, de-duplication on forced steps — and would
  have to exist beside pg-boss's own, leaving two sources of truth about the same work. **Revisit
  when redelivery or backoff becomes a requirement rather than a nicety.**
- **`SKIP LOCKED` does not give concurrency 1.** The obvious
  `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` lets two workers claim two *different* jobs, which is
  exactly the global concurrency-1 guarantee this document chose on purpose. Claiming must lock the
  singleton `queue_state` row first.
- **`LISTEN/NOTIFY` is not available.** It is session-scoped, and we reach Postgres through a
  transaction-mode pooler, which hands out a connection per transaction. It would not error at
  connect time — it would simply never deliver. **Keep polling**, which this document already says is
  the right answer.

The seam is [`src/jobs.ts`](../../src/jobs.ts): `enqueue`, `listJobs`, `getJob`, `cancelJob`,
`retryJob`, `forgetJob`. Nothing above those six knows there are files.

## They are the same functions the CLI runs

`npm run extract`, `npm run blocks` and `npm run hierarchy` still work, and still do exactly what
they did. Each of those scripts is a thin argv wrapper around an exported function, and the queue
calls the same function — so there is one code path per stage and no way for the two to drift. That
was the point of the refactor, and it is the thing to preserve if anyone changes a stage.

**`npm run arc` is gone, and so are its seven siblings** — `tweets`, `glossary`, `ideas`, `quotes`,
`timeline`, `quiz`, `sketch`. Deleted on 2026-09-01, because *re-run a stage* is one of the three
things listed above and the queue already does it: `{ slug, steps: ["arc"], force: ["arc"] }`. A CLI
beside it was a second way to do the same thing, and the queue's way is the one that exercises the
store writes. The exported functions are untouched; only the argv wrappers went
([setup-dev.md § The pipeline stages](setup-dev.md#the-pipeline-stages)).

Greg chose in-process over spawning subprocesses (2026-08-25). The cost is real and worth stating: a
stage that throws inside the server process is now the server's problem, and the four stage files
belong to other agents ([architecture.md § Stage ownership](architecture.md#stage-ownership)). The
edits were kept to the smallest shape that could work — lift the body of `main()` into an exported
function, leave everything else alone — and no stage's behaviour or artefacts changed.

## See also

- [library.md](library.md) — the homepage this box sits on
- [260826u-pdf-upload-and-storage.md](../plans/260826u-pdf-upload-and-storage.md) — the upload the picker is the
  front half of, and the object store under it
- [260826c-pdf-ingestion.md](../plans/260826c-pdf-ingestion.md) — how a PDF becomes an article once we have one
- [architecture.md](architecture.md) — the pipeline, the storage layout, and who owns which stage
- [content-extraction.md](content-extraction.md) — stages 1–2, and what `meta.json` is for
- [setup-dev.md](setup-dev.md) — the commands, for when you want to run a stage by hand
- [original-version/overview.md](original-version/overview.md) — the project that did this without a
  queue, and what it cost
- [silent-success.md](../reusable/silent-success.md) — why a failed step stops the job
- [third-party-library-selection.md](../reusable/third-party-library-selection.md) — the process
  behind the p-queue choice

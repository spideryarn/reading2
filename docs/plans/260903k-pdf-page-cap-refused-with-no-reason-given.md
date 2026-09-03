# A PDF refused for its length, and told nobody why

Greg uploaded Kuhn's *A Landscape of Consciousness* (2024) on 2026-09-03 and stage 2 failed with:

> Extracting the article could not be done for this article as it stands, and asking for it again
> unchanged would most likely come back the same way. `[jb-step-no]`

> I don't know why.
>
> — Greg, 2026-09-03

He did not know why because **nothing anywhere could tell him**. The sentence that would have —
*"This PDF has 142 pages and the limit is 100"* — was written, at
[`src/pdf-read.ts`](../../src/pdf-read.ts) ~1135, and reached neither the reader nor Sentry.

Following the thread turned up **two further bugs, each larger than the one reported**, and the
second of them blocks what Greg asked for. They are stages 3 and 5 below.

## What the evidence says

Sentry `SPIDERYARN-READING2-T`, 2026-09-03T15:56:06Z, job `spya-xxd8fq`, slug
`lawrence-kuhn-2024-a-landscape-of-consciousness-spya-tx8r32`:

```
serveApi → serveAuthenticatedApi → advanceJobWith → walkClaim → runStep
        → collectSpend → Object.run → runPdfExtract → stageFailure
```

Tags: `step: extract`, `message_withheld: True`, and the exception is bare — `Error: Error`.

`stageFailure` is called from `runPdfExtract`'s own body in exactly one place, the `TooManyPages`
catch, with no `pass0`, `pdfCall` or `read` frame between the two. `MAX_PAGES` is 100 and the paper
is ~142 pages.

**Reproduced** in `tests/pdf-page-cap-message.test.ts`: a real 142-page PDF built with `pdf-lib`,
through the real `pass0`/`runPdfExtract`, asserting on `readerFailureOf` —

```
AssertionError: expected 'Extracting the article could not be d…' to contain '142'
Received: "Extracting the article could not be done for this article as it stands, and asking
           for it again unchanged would most likely come back the same way. [jb-step-no]"
```

The cap bites at 101 pages and fires off `doc.numPages` before any `getPage`, so **no money was
spent** on the refusal. GPT Sol ran the same test independently and got the same failure.

The feedback report (`SPIDERYARN-READING2-V`, `report_id spya-bqwm97`) added nothing and could not
have: `has_linked_error: false`, and the collected diagnostics ride as a `diagnostics.json`
**attachment**, which the Sentry MCP does not return — so an agent reading the report through the
tool sees the tags and none of the payload. Noted, not in scope.

## Bug 1 — the swallowed sentences

[`src/job-failure.ts`](../../src/job-failure.ts) has two `stageFailure` forms:

```ts
stageFailure(kind, detail)     // says only what KIND it is. detail is the diagnostic — log only.
stageFailure(failure, detail?) // carries the reader's sentence too.
```

`readerFailureOf` takes the second form's sentence, and for the first form **substitutes
`stepGaveUp`'s generic sentence for the kind** and discards the detail as far as the reader is
concerned. Sentry then withholds the detail too, because it carries no bracketed code and a code is
the only available proof we wrote every character of it.

Both halves of that are correct and deliberate. What is wrong is that **six throw sites wrote a
sentence for the reader and passed it through the form that discards it** — five of them `blocked`,
which withholds the Retry button as well, so the reader gets a dead end *and* no explanation:

| site | the sentence nobody sees |
|---|---|
| [`src/pdf-read.ts`](../../src/pdf-read.ts) ~1135 | `This PDF has 142 pages and the limit is 100. That is a cost cap, not a technical one.` |
| [`src/pdf-read.ts`](../../src/pdf-read.ts) ~426 | `A chunk of this PDF encodes to N MB, over the 30 MB a request can carry.` |
| [`src/pipeline.ts`](../../src/pipeline.ts) ~1595 | `RawDocumentUnavailable` — the document behind the manifest is gone or corrupt; re-fetch. |
| [`src/pipeline.ts`](../../src/pipeline.ts) ~1624 | Readability refused the page. |
| [`src/pipeline.ts`](../../src/pipeline.ts) ~1766 | `NoBlocksProduced` — nothing in the extracted HTML. |
| [`src/pipeline.ts`](../../src/pipeline.ts) ~2977 | `ours`, and the plainest case of the lot — see below. |

The sixth proves this is a class. The illustrate step's `refuse()` throws *"… Draw the Sketch first —
it is the chip one to the left — and then press this one again"*, and the comment above it says the
sentence **"names the chip rather than the step, because it is read by somebody looking at a band and
not at a pipeline."** Written for the reader, said so in a comment, and the reader gets
`[jb-step-ours]`. Reproduced: `readerFailure` is `undefined` and the band shows the generic sentence.

**And the class is wider than `stageFailure`.** ⟨Sol⟩ `runPdfExtract` has two bare
`throw new Error(...)` whose text is plainly for a reader
([`src/pdf-read.ts`](../../src/pdf-read.ts) ~1277, ~1285): a truncated answer naming the pages it
lost, and a safety-filter refusal naming the pages **and offering a remedy** (*"a smaller chunk
sometimes gets through"*). Both currently arrive as the generic retryable sentence. A type-level fix
to `stageFailure` cannot catch these, which is why stage 1 audits by hand rather than declaring the
class closed.

**Named: a two-audience seam whose default is the wrong audience.** The split landed in `46439f1c`
*"Split the two audiences a step's failure has, at the seam"* on 2026-09-03 — the same day — and it
turned every pre-existing single-string throw site into a diagnostic-only one. Nothing at the call
site, and nothing in the types, marked which of those strings had been written for a reader.
`src/messages.ts` predicts it in a comment dated the same day:

> A step that has a real way out should declare its own message and say so. ⟨Sol, 2026-09-03⟩

## Bug 2 — a retry loses the article, so the checkpoints are unreachable

**This one is not about messages, it is about money, and it blocks Greg's cap decision.**

Chunk checkpointing landed 2026-09-01 so that a long PDF could be finished across attempts. Its own
comment in [`src/pipeline.ts`](../../src/pipeline.ts) states the goal:

> a retry is a new job id on a different machine, so every attempt started from zero and a long
> document could fail for ever without ever accumulating enough finished chunks to get under the
> deadline. **This store is keyed on the article, so it survives both.**

It is keyed on the article — and **a retry mints a new article.** ⟨Sol, and verified here⟩

```
retryJob  → enqueue({ slug: old.slug, url|upload: …, … })            src/jobs.ts ~3007
enqueue   → request.upload ? { kind: "minted", slug: slugWithShortId(request.slug) }   ~2351
          → request.url    ? await freeSlug(request.slug, request.url)                 ~2349
freeSlug  → adopts only what slugForUrlKey (the shelf) or inFlightSlugForUrlKey finds  ~2737
            …and the latter skips any job that is not queued/running                   ~2777
checkpoints → read and written keyed on ref.articleId    src/store/checkpoints-pg.ts ~95, ~125
```

The **upload** branch is unconditional — no branch, always a new slug. The **URL** branch adopts a
slug only from a published article or a live job, and a *failed first ingest* is neither, so it also
mints. Either way attempt 2 is a different article and cannot see attempt 1's finished chunks.

`tests/checkpoints-durable-resume.test.ts` does not catch it because it constructs every "attempt"
with the same `articleId` by hand (~205, ~354) — a test that proves the store works, over an
assumption about the caller that is false.

**Reproduced**, both branches, in `tests/retry-keeps-the-checkpoints.test.ts` against real
`enqueue`/`retryJob`/`pgJobStore`/`lockOrCreateArticle` and a real checkpoint write-then-read:

```
× an upload's retry lands on the article the first attempt paid for
× a failed first URL ingest's retry lands on the article the first attempt paid for
✓ a slug-named re-run's retry keeps the article, so the checkpoints are reachable
✓ a release between steps keeps the article, so a later claim resumes
✓ a re-run of an address already on the shelf adopts the shelf's article
   Expected: "test-…-upload-spya-rh9ybq"
   Received: "test-…-upload-spya-rh9ybq-spya-w3t203"
```

The three greens are controls — same store, same namespace, same key — so the two reds are about
Retry moving the article, not about the checkpoint store. **And the bug has a visible fingerprint
nobody read:** `retryJob` passes `slug: old.slug` and `slugWithShortId` appends a *second* short id,
so a reader who retries three times gets three articles with three stacked ids.

**Where it does and does not survive:**

| path | keeps the article? |
|---|---|
| released between steps, re-claimed later | **yes** — same job row, `releaseStepIn` never touches `slug` |
| `force` re-run of an article already on the shelf | **yes** — adopted, by slug or by `slugForUrlKey` |
| mid-step deadline abort → reader presses Retry | **no**, for an upload or a failed first ingest |
| restart mid-ingest | **no on Postgres** — see stage 3 |

Neither is re-pasting the URL an escape: `jobs_active_source` is partial over `queued`/`running`, so
once the first attempt is `error` a second paste allocates afresh. And `/add/upload/<id>` sends the
reader to the dead article rather than starting a job, so **Retry is the only door and it is the
broken one.**

**Blast radius:** both checkpoint namespaces, defeated identically by the same line
(`src/store/pg-session.ts` ~597). `pdf-chunk` — up to ~100 paid calls, and the liveness cliff, since
a document that cannot accumulate finished chunks can fail for ever. `hierarchy-labels` — a handful
of paid calls, no cliff.

**Deeper still, and deliberately not fixed here:** `openOrBeginJobDraft`'s own header says *"Retry
still mints a new job with a new id and therefore a new draft"*, and on a **new** article there is no
published revision to copy from — so the draft is empty, `stepIsDone` finds nothing, and *every* step
re-runs. Retry's advertised "skipping what succeeded" is void for a failed first ingest. Scope
arbitrated separately; see stage 3.

**Three comments are now wrong** and are corrected in stage 6: `src/store/pg-session.ts` ~577 and
`src/pdf-read.ts` ~950 both call `articleId` stable "across every job, every attempt and every draft
revision" — true of the store, false of the pipeline; and `forceForRetry`'s comment still describes
the job-scoped `/tmp` that landing D2 replaced.

## Greg's decisions, 2026-09-03

- **Raise the cap to 250 pages.** A cost cap of about a dollar per hundred pages, and a long journal
  paper is exactly the document this app is for.
- **Refuse early, not in stage 2**, so the reader hears it in seconds rather than after a job card
  has been running.
- > Increase the parallelism (i.e. more chunks at once).

**All three depend on bug 2 being fixed first.** Raising the cap while a retry starts from zero means
a long PDF that overruns its lease fails for ever and re-buys every chunk each time — the exact
disease the checkpointing was written to cure. Sol's verdict: *"not landable until retry preserves
article identity."* Agreed.

## What the measurements say

Real dense prose: arXiv 2303.18223, *A Survey of Large Language Models*, 144 pages, 5.6 MB. Box load
average 12.7–28.9 on 16 cores at the time, so these are contended upper bounds.

| document | pages | `pass0` mean | chunks | pages/chunk | single-page chunks |
|---|---|---|---|---|---|
| `evals/pdf/much-harder` | 17 | 73 ms | — | — | — |
| llm-survey (real) | 144 | **3.7 s** (6.3 s cold, isolated) | **48** | 3 / 3 / 3 | **0** |
| synthetic 142pp of prose | 142 | 1.3 s | 36 | 2 / 4 / 4 | **0** |

Peak RSS stayed in a 417–531 MB band from 8 to 144 pages with no trend against page count.

**The `CHUNK_CONCURRENCY` worst case does not happen for prose.** A 144-page paper plans 48 chunks of
three pages, not 144 of one. `48 / 8 = 6` waves — 270 s at the 45 s mean, 588 s at the one observed
98 s call, both inside the 740 s deadline. 250 pages of prose extrapolates to ~84 chunks, 11 waves,
495 s at the mean. The one-page-chunk case needs pages far sparser than continuous prose. This is
what makes the cap raise defensible rather than hopeful — **once bug 2 is fixed**, because the tail
still needs a second attempt and today a second attempt buys nothing.

**`STEP_BUDGET_MS` is wrong for both steps this touches** ([`src/jobs.ts`](../../src/jobs.ts) ~283).
`fetch: 10_000` is marked *"GUESS, generous. Network only, no model call. Never measured"*, and stage
4 adds a page count to it. `extract: 5_000` already admits *"a long PDF is slower and this number
does not cover it."* It is admission for the *next* step rather than a per-step timer ⟨Sol⟩, so
updating it fixes arithmetic and documentation, not cancellability — but an understated budget still
starts a step that cannot finish, and wastes a lease doing it.

## Stages

Landing order matters: 1 and 2 are independent, 3 gates 4 and 5.

### Stage 1 — the sentences reach the reader

Red test first, at the seam: `readerFailureOf(what the site throws, "<label>")` must return the
specific sentence, not `stepGaveUp`'s. One per site. Then a `ReaderFacingFailure` for each in
[`src/messages.ts`](../../src/messages.ts) with a registered code — `CODE_KINDS` plus, for the
page-cap one, an entry in `FROM_FACTORIES`, since it takes the count and the limit and so follows
`quizBandsNotSpread` rather than inventing a shape.

**Eight sites, not six.** The two bare `throw new Error` in `runPdfExtract` (~1277, ~1285) are
audited in this stage too, and the safety-filter one keeps its `nativeFinish` **unauthored** —
that value is provider-controlled ⟨Sol⟩.

**The illustrate helper becomes a closed reason union, not `refuse(why: string)`.** ⟨Sol⟩ Its three
branches — no sketch, stale sketch, wrong reader profile — mean three different things and want
three sentences and three codes. A free-string factory would also let arbitrary text be minted into
a *coded* `ReaderFacingFailure`, which is precisely the provenance Sentry is told to trust.

**`{ authored }` on seven of the eight, each traced rather than assumed:**

| site | every character of it comes from |
|---|---|
| `TooManyPages` | `doc.numPages` off pdf.js's page tree, and our `MAX_PAGES`. Two numbers. |
| `MAX_ENCODED_BYTES` | arithmetic on a byte length, and our constant. Two numbers. |
| `RawDocumentUnavailable` | four constructors: slug, a content-hash key, byte counts, a local digest, and `credentialsSeen()` — which returns *"SUPABASE_URL is set/not set"*, never a value. |
| `NoBlocksProduced` | slug, in otherwise fixed prose. |
| illustrate, ×3 | two fixed literals and one interpolating the slug. |
| truncated-answer | page numbers. |
| **Readability — NOT authored** | see below. |

**Readability is the exception, and Sol was right to stop it.** `READABILITY_REFUSED` is
`/^Readability could not parse this page\./` — **prefix-only, no anchor at the end** — and the catch
forwards the whole `err.message`. Today the only throw it can match is a fixed literal at
[`src/extract.ts`](../../src/extract.ts) ~433, but a prefix match is not proof that every character
came from there, and `src/job-failure.ts` is explicit that wrapping `${err.message}` is what
`{ authored }` must never do. So: a typed `ReadabilityRefused` error, classified by type, with a
fixed diagnostic. Not `{ authored: err.message }`.

**On the slug**, the wording matters and Sol corrected mine. A slug *is* constrained external input.
It is permitted because [logging.md](../project/logging.md) permits it outright — *"Ids, slugs,
counts, statuses and timings"* — and because `captureFailure` already sends it as a Sentry tag. Not
because it "isn't outside text".

**Folded in: the missing factory guard.** `tests/messages.test.ts:49` promises that
`everyFactoryIsCovered` "below" catches a forgotten factory, and **no function of that name exists**
— in a file whose own docstring is about two hand-maintained lists agreeing by shared omission.
Factories are registered by hand while constants are swept automatically. It already has a victim:
**`placingFailed` ([`src/messages.ts`](../../src/messages.ts) ~1012, used by `src/routes.ts` ~809) is
an exported failure factory absent from `FROM_FACTORIES`** ⟨Sol⟩ — so it has never been through a
single invariant in that file. That is the guard's red proof: write the guard, watch it fail on
`placingFailed`, then add it.

**Done when:** every site's red test is green; the guard exists and was seen to fail on
`placingFailed`; no diagnostic is marked `authored` without a line in the table above; `npm test`,
`npm run typecheck` and `npm run check` pass.

### Stage 2 — make the compiler catch the next one

Delete `stageFailure(kind: FailureKind, detail: string)` and replace it with:

```ts
stageFailure(kind, { generic: diagnostic })  // the reader gets the generic sentence for `kind`, on purpose
stageFailure(failure, detail?)               // unchanged
```

One word at the call site, greppable, parallel to the existing `{ authored }` claim, and impossible
to write by accident — so every remaining site is looked at once. Sol agrees this is the right
minimal shape and notes its limit: it catches misuse of `stageFailure` and cannot catch a bare
`throw new Error` meant for a reader, which is why stage 1 audits those by hand.

Two callers outside `src/` must change ⟨Sol⟩ — `tests/job-failure.test.ts` ~441 and
`tests/retry-is-only-for-a-failed-job.test.ts` ~375 — and `npm run typecheck` covers tests via
`tests/tsconfig.json`, so deleting the overload produces the complete list.

**Done when:** the overload is gone, typecheck is clean, every site either declares a sentence or
says `{ generic }`, and `src/job-failure.ts`'s header documents the marker beside `{ authored }`.

### Stage 3 — a retry keeps its article, so the checkpoints are worth having

**The gate for stages 4 and 5.** An internal retry needs an explicit "adopt the old slug" allocation
path, for both branches, so that `retryJob` lands on the same article and `articleId` and the
checkpoint rows are reachable.

Red test first, driving real `enqueue`/`retryJob` — **not** a hand-built `articleId`, which is
exactly the shortcut that let this ship. Both branches as separate cases, an upload and a failed
first URL ingest, asserting the same slug and article across attempts and that a chunk written by
attempt 1 is read by attempt 2.

Care needed on why the current allocation is the way it is: minting for an upload is deliberate
(*"two uploads of one file are two documents"*, `src/jobs.ts` ~2357) and `freeSlug`'s refusal to
adopt from a failed job protects the slug-holding invariants the queue's partial unique indexes
depend on. So this is **adoption on the retry path specifically**, not a change to what `enqueue`
does for a fresh request. `retryJob` has the old job in hand, which is what makes that distinction
expressible: a retry is by definition the continuation of one named prior attempt, where a fresh
upload of the same file is not.

**Article identity only, and the draft is deliberately not carried.** Greg, 2026-09-03: *"Get input
from Fable, then use your judgment."* Fable's verdict, and the reason it is right:

> **Option A is finishing D2; option B is reopening decision 8.**

Carrying the draft is not a new idea we are declining — it is **decision 8 of
[260831b-finish-the-database-move.md](260831b-finish-the-database-move.md)** (~243, appendix
~1669), which Greg already deferred, and whose appendix names the cheaper substitute in as many
words: *"The per-chunk PDF checkpoints already hold the expensive part … Making them durable would
recover most of the value of this idea for a fraction of the work."* That is D2. It landed. It is
unreachable **only** because of the slug mint. So this stage is not choosing between two designs; it
is repairing the one already chosen.

The two do not collapse into one, checked rather than assumed: `openOrBeginJobDraft` finds a draft
only via *this job's* `draft_revision_id`, and both failure paths null it — `failRevisionIn` inside
the commit, and `settleExpired` on a lapse. So adopting the slug recovers the `articleId` and the
checkpoints, and the draft is still a fresh empty one.

And the waste B would save is almost never paid. Of the default ingest — `fetch, extract, blocks,
hierarchy, assets` — only `extract` (PDFs) and `hierarchy` make paid calls, and the expensive halves
of both are checkpointed. Walking the failure points: fail in `extract`, B saves nothing; fail in
`hierarchy`, B saves seconds of deterministic work; fail in `assets`, B saves **one** un-checkpointed
outline call. That is the whole marginal value, against a draft/revision seam every job shares.

**Folded in on Greg's instruction, 2026-09-03: a Postgres `sweepStopped`.** It exists only on the
filesystem store (`src/store/jobs-fs.ts` ~217), where it puts running steps back to `pending` and the
job back to `queued` — a pause on the same row, so the article is kept. On Postgres there is no
equivalent: a restart leaves the lease to lapse and `settleExpired` (`src/store/pg-jobs.ts` ~896)
ends the job `error` / `failureKind: retry`. So on the store we actually ship, **a deploy during an
ingest costs the reader their article** — and sends them to the broken Retry door. It belongs in this
stage because it is the same question (does an interrupted job keep its identity?) answered for the
other interruption.

**The trap Fable found, and it is the one that could make this worse than the bug.** If the retry
lands as `adopted` it *reserves nothing*, so it sits outside `jobs_active_source` — and a fresh paste
of the same URL in the same instant would then mint, giving **two articles for one address**, the
exact race the `sourceTaken` comment (`src/jobs.ts` ~2471) describes. Both mitigations, not one: ask
`slugAlreadyHolding` first and adopt whatever the shelf or a live job holds, falling back to the old
slug; and have the retry **reserve** the old slug where the old job reserved it (i.e. where the
article has no published revision), so a racing paste is refused by `jobs_active_source` and re-asks
`freeSlug`, which then sees the queued retry via `inFlightSlugForUrlKey`. Nothing on
`jobs_reserved_slug` can object, because only a *terminal* job held that name.

Two things that fall out for free: all four partial indexes cover only `queued`/`running`, so
re-taking a terminal job's slug conflicts with nothing; and `jobs_active_work` then turns a
double-press of Retry into a `sameWork` dedup instead of — as today — two articles paid for twice.

> **The first mitigation above was wrong, and the second was not enough.** Adopting what a *live
> job* holds is the trap wearing the mitigation's clothes: the holder can go terminal between the
> lookup and the insert, and `inFlightSlugForUrlKey` is a scan that cannot close its own gap. What
> shipped instead is the shelf only, plus handing the holder back rather than inserting — see
> [§ What the second review found](#what-the-second-review-found-and-what-was-done-about-it).

**The `sweepStopped` half needs an attempt cap.** ⟨Fable⟩ A requeue variant belongs in
`settleExpired`, keyed on the *same job id*. Without a cap, a job that always overruns requeues for
ever. Fable's advice was to keep this out of the plan entirely; Greg asked for it folded in, so it is
in, with the cap.

**Done when:** both red tests are green; a restart mid-ingest on Postgres resumes rather than fails,
with a test, and a job that always overruns stops rather than looping; the racing-paste case has a
test of its own; the durable-resume test no longer hand-builds the `articleId`; `hierarchy-labels` is
confirmed fixed by the same change; the slug no longer stacks a second short id.

### Stage 4 — the cap, and where it is enforced

`MAX_PAGES` 100 → 250, and no admission control: the thing admission control was for — *"accepting a
document and discovering at minute twelve that it cannot finish"* — becomes, once stage 3 lands,
discovering at minute twelve that it is half done, saying so, and keeping the half.

**Where the refusal goes — Sol corrected this and the correction is load-bearing.** Not a shared
post-manifest seam: by the time `acquireUpload` returns it has already stored the canonical bytes,
built the manifest, and settled the upload `verified` (~1425), and `verified` is **terminal**
(`src/source.ts` ~248) — so a refusal after that point cannot mark the record rejected, which is the
lost-reason race `acquireUpload`'s own `refuse()` comment describes. Instead **one shared page-limit
helper called at two branch-specific points**: for an upload after hash verification and *before*
canonical storage and `verified`; for a URL after `fetchDocument` has identified PDF bytes and
*before* `writeRaw`. That duplicates one call, not the policy.

**And not `pass0`.** ⟨Sol⟩ `pass0` walks every page calling `getTextContent` — that is stage-2
extraction work, and 3.7 s of it. A small *open, read `numPages`, destroy* primitive instead, which
the existing `pass0` guard then shares so the two limits cannot drift.

`RejectReason` maps an enum to a **static** failure (`src/source.ts` ~354), so it cannot reconstruct
"142 pages" ⟨Sol⟩. The upload record therefore takes a static reason while the job carries the
sentence with the count in it.

Stage 2's `TooManyPages` catch **stays** as a backstop with the reader sentence stage 1 gave it: an
article ingested before this change, or re-extracted after the cap moves again, must not walk past
it.

`fetch` and `extract` get measured budgets. `src/pdf-read.ts` § `CHUNK_CONCURRENCY`'s comment is
rewritten — its arithmetic is against a 100-page cap and its closing claim about a Retry that "would
do the same thing again" is a statement about the world before stage 3.

**Done when:** a >250-page PDF is refused in stage 1 with a sentence naming its page count, by
separate tests for an upload and a fetched URL; a 142-page PDF is accepted and planned into chunks;
the upload record ends `rejected`, not `verified`; budgets say MEASURED with the date.

### Stage 5 — more chunks at once: `CHUNK_CONCURRENCY` 8 → 16

> Increase the parallelism (i.e. more chunks at once).
>
> — Greg, 2026-09-03

**16, and the number is the width at which the deadline stops being the binding constraint.**
Measured 2026-09-03. Waves × per-call duration against the 740 s deadline, at the 45 s mean and the
one observed 98 s tail:

| width | 48-chunk real paper | 250 pp / 84 chunks | the comment's own adversarial 100×1-page |
|---|---|---|---|
| 8 | 270 s / 588 s | 495 s / **1078 s** | 585 s / **1274 s** |
| 12 | 180 s / 392 s | 315 s / 686 s | 405 s / **882 s** |
| **16** | **135 s / 294 s** | **270 s / 588 s** | **315 s / 686 s** |
| 24 | 90 s / 196 s | 180 s / 392 s | 225 s / 490 s |
| 32 | 90 s / 196 s | 135 s / 294 s | 180 s / 392 s |

16 is the first width where **every** case clears 740 s even on the all-waves-hit-the-tail bound,
including the 100-one-page-chunk case the existing comment constructed as its worst. Past 16 the
deadline no longer binds, so further width is the thing that comment warns against — *"width past
the point the deadline is met buys latency nobody is waiting on"* — while still costing the two
risks below. **Cost is unchanged**: `SYSTEM` is sent per chunk and there is no prompt caching on this
path, so total spend is chunk count × prompt, independent of width. This buys latency only.

Of the comment's three reasons against going wider, the measurements move two:

- *"A fatal chunk costs the whole document."* **Overstated.** `keepChunk` runs inside each chunk's
  own task immediately after its call returns and passes its check (~1306), before `allOrStop` can
  reject and call `stop()` (~1339), and it is not wired to the abort signal. So an answered sibling
  is durably banked. What a fatal chunk actually costs is the money for requests still in flight,
  plus this attempt's assembly — **conditional on stage 3**, without which the banking is
  unreachable anyway.
- *"`cutPages` builds a fresh PDF per chunk and a request may carry up to `MAX_ENCODED_BYTES`."*
  The framing is wrong in a way that matters, and not in the direction I expected. Encoded chunks
  are small — median 0.29 MB on the 144-page paper — but **`cutPages` calls `PDFDocument.load(source)`,
  and pdf-lib eagerly parses the *whole source file* on every call.** So memory scales with N × the
  source, not N × the chunk. Measured peak RSS at the dense `evals/pdf/harder` fixture: 749 MB at 8,
  **866 MB at 16**, 1105 MB at 24, 1374 MB at 32 — against a ceiling that is almost certainly the
  2 GB Vercel default (`vercel.json` sets no `memory`, and Vercel does not allow it there; no
  credential on this box can read the dashboard, so **unconfirmed**). 16 keeps real headroom for the
  rest of the request and for a co-located second ingest; 32 does not.

**And one new risk that raising the width makes worse, so it is fixed in this stage rather than
noted.** A 429 is currently **immediately fatal with no retry**, and it aborts every chunk in
flight. `withTransportRetries` excludes `ProviderRefused`, and its comment says why: *"A
`ProviderRefused` means the provider answered — with a 400, a 429, a 402 — and asking twice more
changes none of those."* That is right for 400 and 402 and **wrong for 429**, which is the one status
that means *ask again later*. `PDF_READER_MODEL` is routed with `allow_fallbacks: false`, so every
concurrent chunk competes against one upstream; doubling the width doubles the request rate into it.
So: 429 becomes retryable with backoff — respecting `Retry-After` where the provider sends one — and
stays distinct from a policy refusal. This is the safety belt for the width, not a separate errand.

**Done when:** `CHUNK_CONCURRENCY` is 16 with a measured justification in the style of the current
one — the table above, the binding constraint, the date; a 429 is retried with backoff and a 400/402
still is not, with a test for each; `MAX_PAGES` at 250 is checked against 16 rather than 8.

### Stage 6 — the postmortems, the docs, and a real PDF end to end

- **Two postmortems**, because these are two classes. The swallowed sentences (`46439f1c`, a
  two-audience seam defaulting to the wrong audience — prevention is stage 2, written after it
  lands rather than promised). And the unreachable checkpoints (a feature keyed on an identity its
  caller does not preserve, with a test that asserted the store and assumed the caller — prevention
  is stage 3). Both name the class outright and rank recommendations.

  **The introducing change for the second one is already written down**, which makes it a better
  postmortem than most: `tests/pipeline-slug-claim-files.test.ts` ~98 records that returning an
  upload's slug on retry was *deliberately deleted* with the short-id change on 2026-08-31, "so a
  retry mints a fresh name". That was four days before the checkpoints arrived and started depending
  on the opposite. Nobody was wrong at the time; the second change did not go looking for what the
  first had decided.

  Write B up not as a fresh recommendation but as **"decision 8 still stands, and matters less after
  this stage than when it was made"** ⟨Fable⟩.

- **One more thing to file, found on the way and not fixed here:** `sweepAbandonedDrafts`
  (`src/store/pg-revisions.ts` ~1768) has no callers at all, so failed drafts accumulate unbounded.
  Ranked in the postmortem, not built — it is nobody's blocker today and it is not this job.
- [content-extraction.md](../project/content-extraction.md),
  [ingest-queue.md](../project/ingest-queue.md), [copy.md](../project/copy.md). A substantive rule
  change to `copy.md` goes through the before/after approval process ⟨Sol⟩; a signpost edit does not.
- **Drive it in a browser**, in a subagent, on the real 144-page arXiv paper already parked in the
  scratchpad: upload, watch the card, read the sentence. Tests going green is not evidence a reader
  can see it.

## What the second review found, and what was done about it

GPT Sol reviewed the built stages 1–3 on 2026-09-03 and returned **DO-NOT-SHIP** over one finding.
All six were fixed; the two that were decisions rather than repairs are recorded here because the
decision is the part a future reader needs.

**1 (P0) — the racing-paste race was still open.** `jobs_active_source` is partial on
`reserves_name`, so an **adopted** retry sits outside it and is safe only while some other active row
reserves its address — liveness, not a guarantee. Sol reproduced two active articles for one address
through both of `enqueue`'s repairs, by letting the holder go terminal in the gap between the
repair's lookup and the insert it then makes:

```text
sourceTaken: active = ["holder-spya-111111", "blind-spya-222222"]
nameTaken:   active = ["old-spya-000000",    "blind-spya-222222"]
```

Reproduced again here before anything was changed, against the real filesystem adapter with the
interleaving forced —
`tests/one-article-for-one-address.test.ts` § *and a retry's two*, which the existing racing-paste
test (finding 5's coverage gap) could not see because it only covers the steady-state minted case.

The fix is two halves and neither of them is a cleverer repair, because **no repair can work**:
whatever the lookup learns about a live holder is stale by the time the insert runs, which is the
whole bug. So (a) `slugForRetry` adopts only what the **shelf** holds — a durable fact every later
lookup finds too — and mints, and therefore reserves, for everything else; and (b) a retry the index
refuses **inserts nothing at all** and is handed the job that refused it
([`handBackToARetry`](../../src/jobs.ts)). That also makes the allocation loop provably terminating
for a retry, which the adopting version was not. The invariant is then constraint-backed rather than
scan-backed: a retry's row either reserves its address, or carries a published one, or carries none.

**Rejected: widening `jobs_active_source` to cover non-reserving rows.** That is the guarantee stated
directly, and it breaks the per-article queue — which is the thing the index is partial *for*.

**Not fixed, and named:** `freeSlug` adopts from a live job for a *fresh* paste too, so the same
interleaving can orphan that row's address. It predates this work, its window is one round trip
rather than two, and closing it the same way would turn a second URL request for one unpublished
article into a dedup rather than a queued job. The durable fix for the class is a table that claims
an address, which is a bigger build than this one.

**2 (P2) — the requeue budget counted the wrong thing.** `REQUEUE_BUDGET = 3` bought the original
attempt *plus three requeues* — four lease windows — while the justification beside it counted three
attempts. **Decided: two requeues, three windows**, which keeps the measured reasoning and drops a
paid window rather than keeping one nothing had argued for. Written down alongside it: nothing
requires checkpoint *progress* before a window is granted, so an un-checkpointed paid call can be
bought once per window; and the filesystem adapter's counter is process-local, so a restart resets
the cap there.

**3 (P1)** `nativeFinish` was going to the log verbatim — an unconstrained provider string, which
[logging.md](../project/logging.md) says is not to be trusted for being expected to be a short enum.
`knownNativeFinish` matches it against our own list and logs the literal it matched; anything else is
`"unrecognised"`. Tested at the **destination**, not only in the reader's sentence.

**4 (P1)** `SOURCE_DOCUMENT_GONE` told the reader that adding the article again fixes it, which is
false for `RawDocumentUnavailable`'s `corrupt` reasons: the object is content-addressed, so a
re-fetch lands on the same name and leaves the bad bytes alone. Split out as
`SOURCE_DOCUMENT_DAMAGED`, and **`bug` rather than `blocked`** — all three non-retryable kinds
withhold the button, so the choice is only about what the reader is told, and `blocked` promises a
way out this reader has not got.

**6 (P3)** Two comments that had stopped matching their code: the expiry sweep no longer always
settles, and the Readability refusal is typed rather than matched on its sentence.

## Recommended, not built

**An interrupted job resuming without a press.** Once stage 3 makes a retry cheap, the remaining
wrinkle is that a pathologically dense 250-page PDF asks the reader to press Retry once or twice.
Automating that is a change to shared job machinery, is not needed for the document that prompted
this, and belongs to whoever owns the queue.

## The simpler options passed over

**Just raise `MAX_PAGES` to 250 and stop.** One line, and it is what was asked for. Rejected twice
over: it leaves six-to-eight sentences reaching nobody in the one seam every failed step passes
through, and — because a retry starts from zero — it would make long PDFs fail *for ever* rather
than fail once. The one-line version is actively worse than the status quo.

**Raise the cap and fix only the page-cap sentence.** Rejected: the illustrate step's swallowed
instruction is the same bug, found while looking at this one.

**Build admission control instead of fixing retry.** It is what `src/pdf-read.ts`'s comment asks for,
and it is the larger build. Fixing retry identity is smaller, fixes a shipped feature that does not
work, and makes admission control unnecessary rather than merely deferred.

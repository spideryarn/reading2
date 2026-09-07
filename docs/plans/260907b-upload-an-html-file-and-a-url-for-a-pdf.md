# Upload an HTML file, and give it a URL for a PDF

**Status:** in progress, 2026-09-07.
**Why:** feedback report `SPIDERYARN-READING2-2A`, from Greg, so
[feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it) says *build it*.
The note is [`260906_1709-upload-an-html-file-and-a-url-for-a-pdf.md`](../user-feedback/260906_1709-upload-an-html-file-and-a-url-for-a-pdf.md).

> Right now I can give it a url for HTML, or I can upload a PDF. I want to be able to upload an HTML
> file, just like I can upload a PDF. Also, make sure that it works for me to be able to give it a
> url for a PDF.
>
> — Greg, via Feedback, 2026-09-06 17:09 UTC

Two asks. **The second one turned out to be already built**, and this doc records the reproduction
rather than a fix, because a check nobody has watched pass is not evidence
([silent-success.md](../reusable/silent-success.md)). The first is the work.

## Ask 2, a URL for a PDF: already works, measured

Run in this worktree against the local stack, 2026-09-07 01:10 UTC:

```
npx tsx scripts/stage.ts ingest https://pdfobject.com/pdf/sample.pdf
```

```
fetch      done   18 KB          host=pdfobject.com
extract    done   Sample PDF     kind=pdf pages=1 chunks=1 records=6
blocks     done   6 blocks, 6 new ids
hierarchy  done   3 sections over 6 blocks
assets     done   0 images stored
job done: sample-spya-vgwr6s   $0.0242
```

Nothing is broken here. And the machinery that makes it work is **what the upload half should reuse
rather than duplicate**: `sniffKind` decides html-vs-pdf from the *bytes*, never from the address or
the header ([`src/fetch.ts`](../../src/fetch.ts)), and `src/pipeline.ts` branches on `manifest.kind`
at both `fetch` and `extract`.

**One trap, recorded so the next person does not fall in it.** An earlier session reproduced this
against `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf` and got
`FetchFailure` / `403 forbidden`. That is **w3.org refusing our user-agent**
([fetching.md § The user-agent question](../project/fetching.md#the-user-agent-question)), not a
defect in this path — and mistaking it for one costs an afternoon fixing something that already
works. Use a bot-tolerant host.

## Ask 1, uploading an HTML file

### What makes an upload a PDF today

Four places, and nothing else:

| where | what it assumes |
|---|---|
| `looksLikePdf` / `uploadProblem`, [`src/uploads.ts`](../../src/uploads.ts) | the picker and `POST /api/uploads` both refuse anything that is not named or typed as a PDF |
| [`src/web/upload.ts`](../../src/web/upload.ts) | the browser's PUT hardcodes `Content-Type: application/pdf` |
| `acquireUpload`, [`src/pipeline.ts`](../../src/pipeline.ts) | `looksLikePdf(got)` over the bytes, `storeRawSource(got, "pdf")`, and `kind: "pdf"` in the manifest |
| the copy | `accept="application/pdf,.pdf"`, the button captioned *PDF*, `uploadLimits()`, `UPLOAD_NOT_A_PDF` |
| `ingestFile`, [`scripts/stage.ts`](../../scripts/stage.ts) | the CLI twin of the browser path, refusing anything without `%PDF-` and PUTting as `application/pdf` |
| the masthead and the metadata page | `meta.source === "pdf"` used as the proxy for *this was uploaded* — see § The UI was asking the wrong question |

### The design: ask the question stage 1 already answers

Stage 1's byte-level machinery is **already kind-agnostic, already exported, and already the answer
for the fetched half**:

- `sniffKind(contentType, bytes)` — html, pdf, or neither, decided by the bytes. Passing `null` for
  the content type is the honest thing for an upload: there is no header, only a filename the
  reader chose. `null` is already one of the vague mime types the function handles.
- `decodeHtml(bytes, contentType)` — the HTML spec's own encoding algorithm, BOM then `<meta
  charset>` then windows-1252.
- `storedDocumentBytes(doc)` — **for HTML the stored bytes are the decoded string, not the arrived
  bytes.** That is the invariant `writeRaw` exists to keep, and the upload path has to keep the same
  one or stage 2's `new TextDecoder().decode(bytes)` reads mojibake.

So `acquireUpload` stops asking *is this a PDF* and starts asking *what is this*, of the same
function the URL half asks. `refuseAnOverlongPdf` and `MAX_PAGES` move inside the `pdf` branch,
where they were always meant to be — an HTML file has no pages to count.

To share the decoded-bytes rule rather than restate it, `storedDocumentBytes` widens from
`FetchedDocument` to `Pick<FetchedDocument, "kind" | "text">`. One word, no behaviour change, and it
is the difference between one rule and two copies of one — which is the exact drift its own header
says it exists to prevent.

### The hard part: an uploaded HTML file has no URL

This is the thing that makes the job less trivial than it reads. Stage 2 does
`if (manifest.kind !== "pdf") { const url = requireUrl(ctx); … }`, and an uploaded HTML file reaches
that line with nothing to give it.

`runExtract` uses its `url` for exactly two things
([`src/extract.ts`](../../src/extract.ts) — checked, not assumed):

1. `new JSDOM(html, { url })`, which is the base relative hrefs and image srcs resolve against;
2. `meta.url`, the article's recorded address.

**The decision: an uploaded HTML file is extracted with no base URL at all.** `runExtract` and
`readArticle` take `url: string | null`; `null` omits the JSDOM option and omits `meta.url`. Not a
`file://`, not an `upload://`, not a synthetic origin — for the reason
[fetching.md](../project/fetching.md#not-everything-gets-fetched-rawmanifest-has-an-origin) already
gives about `RawManifest`: a placeholder *reads as an address* to everything downstream and not one
of them would complain.

`Meta.url` is already optional and an uploaded **PDF** already has no URL, so nothing downstream is
being asked to handle a new shape.

**What that costs, stated plainly.** Relative hrefs and relative `<img src>` in the uploaded file
stay relative and resolve to nothing. The prose — which is what this app is for — is unaffected. The
images are dropped **cleanly and by existing design**: `src/assets.ts` already refuses a non-absolute
URL and its comment already names this exact case —

> A relative URL after stage 2 means Readability had no base to resolve it against.

So a saved page whose figures are all relative paths comes out as an article with its text intact and
no figures. That is the class of article that comes out badly, and it is named here rather than
half-supported.

**And one case works for free.** A document carrying `<base href="https://…">` resolves correctly
with no code at all, because `document.baseURI` reads the `<base>` element and Readability resolves
against `baseURI`. That is the HTML spec's own mechanism for exactly this, not an invention of ours.

### The UI was asking the wrong question, and it only became wrong today

Not found by planning it — found by an inventory sweep, which is why the sweep was worth running.
Both the masthead ([`src/web/Masthead.tsx`](../../src/web/Masthead.tsx)) and the metadata page's
`Origin()` ([`src/web/Metadata.tsx`](../../src/web/Metadata.tsx)) decide whether to say *"Uploaded
from a file — there is no web address to go back to"* with:

```ts
const uploaded = meta.source === "pdf";
```

Each carries a long, careful docstring defending it — *"the evidence is `meta.source === 'pdf'`,
which is a fact stage 2 wrote down"* — and each was **right until today**. `source` is the **media
kind**; using it for **origin** is the conflation [`src/source.ts`](../../src/source.ts)'s own header
already warns against, on two axes it calls independent. It worked because every upload was a PDF.

Left alone, an uploaded web page would have been told *"No web address was recorded for this
article"* — true, but the wrong sentence and the wrong icon, on the page whose whole job is saying
what we hold. That is a visible defect this change would have *created*, so it is in scope. Greg's
words were *"just like I can upload a PDF"*, and an uploaded PDF says the right thing.

**And it needs no migration.** `article_revisions.raw_filename` already exists, is already written
from `RawManifest.filename` by stage 1, and is null for everything that was fetched — its own column
comment even says *"`origin` is derivable"*. So it is surfaced as `Meta.filename`, and
`cameOffADisk(meta)` in [`src/web/SourceLink.tsx`](../../src/web/SourceLink.tsx) is the one place
the question is now asked. The old `source === "pdf"` arm stays inside it, because revisions written
before that column existed have no filename and would otherwise lose a sentence they have been
showing all along.

**Not in `PublicMeta`, deliberately** — the public SQL projection does not select it and
`publicMeta` is a hand-built allowlist, so it is withheld twice.

### A privacy question this work did not create and did not fix

The first draft of that last paragraph said *"publishing a document is not publishing what you
called it"*, and **GPT Sol showed that is false**, which is the finding worth keeping out of the two
reviews:

> Uploading `confidential-client-acme.html` produces a public slug containing
> `confidential-client-acme`. The exact `raw_filename` does not enter `PublicMeta`, but the claim
> that what the reader called the file remains owner-only is false.

`slugFromFilename` ([`src/ingest.ts`](../../src/ingest.ts)) mints the article's slug from the
filename's stem, and the slug **is** in `PublicMeta`. So for a *published* uploaded article, the
kebabed stem has been on the open web since uploads existed in August. `Meta.filename` withholds the
exact string — extension, case, punctuation, anything kebabing dropped — and that is a real but
smaller claim.

**Not changed here, on purpose.** Minting an opaque slug for uploads instead would change the
addresses of existing articles, is a product decision about what a URL should look like, and is
nothing to do with the report being answered. It predates this work in every respect except that
this work was about to write a comment asserting the opposite. **It is Greg's call**, and it is on
[`awaiting-approval.md`](../user-feedback/awaiting-approval.md) so it does not vanish into a plan
doc nobody reopens.

### Where the bytes are served back from: unchanged, deliberately

`GET /api/source/:slug` calls `sourceStore.readPdf`, and the narrowness is a **defence**:

> `readPdf`, not "read the source document", because the content type is the boundary: an HTML
> source served from our own origin is stored XSS.
> — [`src/routes.ts`](../../src/routes.ts)

An uploaded-HTML article therefore gets *"That article did not come from a PDF."* from that route,
exactly as a URL-fetched HTML article does today. **No change**, and none should be made without
answering the stored-XSS question first. [`src/routes.ts`](../../src/routes.ts) is on
[security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)
and this work does not touch it.

### Refusals

`RejectReason` keeps the key `"not-a-pdf"` — the `uploads.reason` column is free text with no check
constraint, so a new value would need no migration, but existing rows carry the old key and renaming
it would orphan them for nothing. The *message* is reworded to name both kinds, and the reader-facing
code `[up-pdf]` stays, because a code is what a reader quotes
([copy.md](../project/copy.md)). The constant is renamed `UPLOAD_UNREADABLE_FILE`, which the compiler
checks; the persisted string and the quoted code do not move.

## What this deliberately does not do

Each of these is a deferral, not an oversight.

- **No canonical-URL recovery.** Reading `<link rel="canonical">` or `og:url` out of the uploaded
  file and using it as the extraction base would fix relative images for a large share of saved
  pages. It is ~20 lines. It is deferred because that URL comes from untrusted file contents and
  would flow into stage 4.5's image fetching, which is a security question that wants answering on
  its own rather than as a rider. `<base href>` — the spec's own mechanism — already works.
- **No fetching of relative assets** from any remote host, and no guessing at one.
- **No JavaScript execution.** JSDOM runs with scripts off, as it already does for fetched pages.
- **No MHTML, no `.zip` of a saved page, no `.md`, no `.txt`.** One new kind, and it is the one
  asked for.
- **No change to `GET /api/source/:slug`** — see above.
- **No general MIME framework.** `DocumentKind` stays the two things stage 1 already knows.

## The bug the unit tests could not see, and what it cost

Worth reading before the next change to this path, because it is the whole of
[silent-success.md](../reusable/silent-success.md) in one line.

Every unit test passed. The first **real** upload died at stage 2 with *"No source URL for
spider-silk-spya-hks5cq"*. The `extract` branch had been written as:

```ts
const url = manifest.origin === "upload" ? null : requireUrl(ctx);
```

`origin` is set by `acquireUpload` and is **absent from every manifest loaded back out of the
store**. `readRaw` in [`src/store/artifacts-pg.ts`](../../src/store/artifacts-pg.ts) rebuilds a
manifest from columns, there is no `origin` column, and that adapter *deliberately* declines to
invent one — its own comment says an invented `origin: "url"` "would be a false statement every later
reader would believe". So `origin` is a field written by one step, readable by the step immediately
after it, and gone thereafter. Nothing else in the repo reads it.

**The tests could not have caught it**, and that is the lesson rather than the fix: every assertion
in `tests/an-uploaded-html-file-becomes-an-article.test.ts` was about the manifest the step
**returns**, and the pipeline reads the one the store **keeps**. Two objects, one name.

The fix is `cameFromAnUpload` in [`src/fetch.ts`](../../src/fetch.ts), which reads `filename` — the
`raw_filename` column, which does survive — and the regression test deletes `origin` from the
manifest before asserting, which is exactly what the store does.

## Evidence

- `npm run typecheck` and `npm run cycles` clean.
- `npm test`: green apart from two **pre-existing** broken doc links in other agents' plan docs
  (`260906a`, `260906f`), untouched here; `dev` already carries a commit about one of them.
- **A URL for a PDF**, `https://pdfobject.com/pdf/sample.pdf` — published, 6 blocks, $0.024.
- **An uploaded web page**, a real 665 KB saved copy of Wikipedia's *Spider silk* —
  `npx tsx scripts/stage.ts ingest <file.html>`, published in 110 s for $0.20: 263 blocks,
  5,273 words, 36 sections. The stored revision, read back out of Postgres:

  | column | value |
  |---|---|
  | `final_url` | `null` — no address invented |
  | `raw_filename` | `spider-silk.html` |
  | `raw_source_kind` / `raw_content_type` | `html` / `text/html` |
  | `raw_encoding` | `UTF-8` |
  | `source` | `null` — correctly not a PDF |

  And `assets: 0 stored`, which is **the deferral doing exactly what this doc says it does**: that
  page's 31 images are protocol-relative (`//upload.wikimedia.org/…`) or root-relative, and with no
  base URL `src/assets.ts` refuses every one of them. Text intact, figures gone. If that turns out
  to matter more than it looks, the canonical-URL recovery above is the thing to build next.

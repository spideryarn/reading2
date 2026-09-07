# Upload an HTML file, and a URL for a PDF

**Sentry:** `SPIDERYARN-READING2-2A` · reported 2026-09-06 17:09 UTC, from `/`, `kind=suggestion`,
build `84521f3b`. From Greg, so
[feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it) says *build it*.

**Ending: shipped**, on `dev`.

> Right now I can give it a url for HTML, or I can upload a PDF. I want to be able to upload an HTML
> file, just like I can upload a PDF. Also, make sure that it works for me to be able to give it a
> url for a PDF.

The plan doc, with the design, the measurements and the four things deliberately deferred, is
[260907b-upload-an-html-file-and-a-url-for-a-pdf.md](../plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md).

## What happened, in short

**Two asks, and only one of them was work.**

**A URL for a PDF already worked**, and this is a reproduction rather than a fix — measured end to
end against the local stack on 2026-09-07, `https://pdfobject.com/pdf/sample.pdf` in at stage 1 as
`kind=pdf` and out as a published article with 6 blocks over 3 sections. Nothing was changed for it.
Worth recording because an earlier session tried the same thing against a `w3.org` PDF, got a `403`,
and could have spent an afternoon fixing a bug that did not exist: that was **w3.org refusing our
user-agent**, not our path.

**Uploading an HTML file is built.** The picker takes `.html` and `.htm`, the browser labels its
upload correctly for the object store, and stage 1 decides what the file *is* from the bytes —
through the same `sniffKind` a fetched document goes through, so a `.html` full of `%PDF-` is
transcribed as a PDF and a `.pdf` full of markup is read as a page. The PDF page cap no longer
applies to a web page, which has no pages.

Two things fell out that were not in the request and are in the change:

- **An uploaded web page has no URL**, and a lot of stage 2 assumed one. It is extracted with no
  base URL rather than a placeholder.
- **The masthead and the metadata page were asking the wrong question** — they used "is this a PDF?"
  as the proxy for "did you upload this?", which was true right up until today. Left alone they
  would have told Greg *"No web address was recorded for this article"* about a file he had just
  uploaded. Fixed, with no migration, off a column that was already there.

## The known limitation a reader will meet before we do

**A saved page whose figures are all relative paths arrives with its text intact and its figures
missing.** That is not a bug to be reported back — it is this change's one deliberate deferral, and
it is worth knowing before somebody spends an afternoon on it.

With no base URL, relative `<img src>` and relative links resolve to nothing, and `src/assets.ts`
refuses non-absolute URLs — cleanly, by a rule it already had. The real end-to-end test was a saved
Wikipedia article, and all 31 of its images are protocol-relative, so it published with **0 images
stored**. A file carrying its own `<base href>` works properly, for free.

The fix, when it is wanted, is recovering an address from the file's own `<link rel="canonical">`.
It was deferred because that URL comes out of untrusted file contents and would flow into stage 4.5's
image fetching, which is a security question worth answering on its own rather than as a rider.

## The bug worth remembering, because the tests could not see it

Every unit test passed while the feature was broken end to end. The `extract` step asked
`manifest.origin === "upload"` — a field `acquireUpload` sets and **the storage layer never
reconstructs**, because manifests are rebuilt from columns and there is no `origin` column. So the
assertions were about the manifest the step *returns* and the pipeline reads the one the store
*keeps*: two objects, one name. Found by running a real upload, not by a test.
[silent-success.md](../reusable/silent-success.md) is the class. `cameFromAnUpload` reads a field
that survives, and the regression test deletes `origin` before asserting.

## And one thing that is now Greg's

A cross-family review found that **an uploaded file's name is already in its public URL** — the
slug is minted from the filename stem and the slug is in `PublicMeta`, so publishing
`confidential-client-acme.html` publishes `confidential-client-acme`. That predates this report by
weeks and is true of uploaded PDFs too; it surfaced only because this work was about to write a
comment claiming the opposite. Not changed here — minting opaque slugs would move existing
addresses — and it is on [awaiting-approval.md](awaiting-approval.md) so it does not get lost.

## What else was deliberately not done

No MHTML, no `.md`, no `.txt`, and no change to `GET /api/source/:slug`, which stays PDF-only
because serving a reader's HTML back from our own origin is stored XSS. The plan doc has the full
list, and the GPT Sol review that produced four of the fixes above.

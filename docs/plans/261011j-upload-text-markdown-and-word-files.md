# Upload a text, Markdown or Word file

**Status:** shipped to `dev`, 2026-10-11. Screenshots: [txt](261011j-shot-1-txt.png), [docx](261011j-shot-2-docx.png), [md](261011j-shot-3-md.png), [refusal](261011j-shot-4-refusal.png).
**Why:** feedback report `spya-qxh28e` (#563, `SPIDERYARN-READING2-HC`), from Greg — proven an
admin's by `feedback-reporter.ts`, exit 0 — so it is built. Queue item `qi-ff2bfwq3`.

> We want to allow the user to be able to upload articles in a wider range of formats, e.g. .txt,
> .markdown and other text files, and also ideally Word documents if not too complex.
>
> see third-party-library-selection.md
>
> — Greg, via Feedback, 2026-10-11 01:44 UTC

Today an upload is a PDF or a web page and nothing else (`uploadKind` in
[`src/uploads.ts`](../../src/uploads.ts); the HTML half is
[260907b](260907b-upload-an-html-file-and-a-url-for-a-pdf.md), which this follows closely).

## The design: convert to a web page at the door, and let the HTML path do the rest

**A text, Markdown or Word file becomes an HTML document inside stage 1's `acquireUpload`, and from
then on it *is* an uploaded web page.** Stored as `kind: "html"`, read by stage 2's Readability,
sanitised by stage 3 like every other page.

```
 browser ──PUT──▶ staging object ──acquireUpload──▶ what is it? (bytes first, then the name)
                                                     │
              pdf ─────────────────────────────────── store as pdf      ─▶ stage 2 (transcribe)
              html ────────────────────────────────── store as html     ─▶ stage 2 (Readability)
              text / markdown / docx ──▶ convert ──▶ store as html     ─▶ stage 2 (Readability)
```

Why this shape:

- **No third `DocumentKind`.** `DocumentKind = "html" | "pdf"` is named in the bucket's content
  types, `raw_sources.kind`, the feedback attachment map, export, the source scan, the registry
  backfill. A `"docx"` kind would be a change to each, and a migration, for a format whose only use
  downstream is to be turned into HTML.
- **No new defence.** What comes out of the converters is HTML that goes through exactly the
  Readability → `sanitize.ts` path a hostile `.html` upload already goes through. Uploading an HTML
  file is already legal, so a converter that emitted anything at all adds no reachable markup that an
  uploaded `.html` could not already carry.
- **The rule "stored bytes are the decoded string" is the precedent.** An HTML upload already stores
  the decoded text rather than the arrived bytes ([260907b § The design](260907b-upload-an-html-file-and-a-url-for-a-pdf.md#the-design-ask-the-question-stage-1-already-answers)).
  This stores one step further from the arrived bytes, for the same reason: stage 2 reads one shape.

**The simpler option passed over** was to refuse `.docx` and do only text and Markdown. Word is
the larger half of the value (a reader's own drafts, reports, papers sent as attachments) and
mammoth makes it a library call, so it is in; what is left out of it is below.

**What this costs, said plainly:**

- ~~The original file is not kept.~~ **It is, since the plan review** (§ After the plan review):
  stored content-addressed beside the page. Diagnostics and export still carry the converted page,
  not the original. Fixing a converter later does not reach articles already made, which is true of
  every stage-1 decision.
- **The manifest's `contentType` is `text/html`**, ours, as it already is for an upload; the
  filename keeps the `.docx`/`.md`/`.txt` that says what the reader gave us.

## What is decided by the name, and what by the bytes

Same rule as `uploadedDocumentKind`, extended rather than replaced:

1. **`%PDF-` at byte zero is a PDF**, whatever it is called.
2. **Leading HTML evidence is a web page**, whatever it is called — the invariant
   `tests/fetch.test.ts` pins ("evidence the fetched path found may never be contradicted by a
   filename"). So `page.txt` that starts `<!doctype html>` is read as a page.
3. **Otherwise the name's claim decides**: `.docx` → Word; `.md`, `.markdown`, `.mdown`, `.mkd` →
   Markdown; `.txt`, `.text`, `.rst`, `.org` → text — and then the bytes must agree:
   - Word: a zip (`PK\x03\x04`) that mammoth can read; anything else is refused `[up-pdf]`.
   - text and Markdown: no binary evidence (`evidence.binary`, the NULs the sniffer already looks
     for) and not another vocabulary's root.
4. `.pdf`, `.html`, `.htm` as today.

"Other text files" is **by extension, and only by extension**: `.txt`, `.text`, `.rst`, `.org`
read as plain text. The browser's `File.type` cannot widen it, because `POST /api/uploads` decides
on the name alone (`uploadProblem` with `type: ""`, `src/routes.ts`), and a picker that accepted a
file the server then refused is the disagreement `src/uploads.ts` exists to prevent. Kept narrow on
purpose: `.tex`, `.rtf`, `.odt`, `.epub`, `.doc` (the old binary Word) are refused with the existing
sentence. See § Deferred.

## The converters

**Plain text** — ours, a dozen lines. Decode: BOM (UTF-8, UTF-16LE/BE), else strict UTF-8, else
windows-1252 (what the HTML decoder would default to). Split on blank lines into `<p>`s, every
character escaped. The first non-empty line is the `<title>` if it is short (≤ 120 chars), else the
filename's stem. Single newlines are left in the paragraph, so hard-wrapped text (Project
Gutenberg's 72 columns) reads as prose.

**Markdown** — `micromark`, already in the tree (4.0.2, the tokenizer under
`mdast-util-from-markdown` which `src/citable.ts` and the help pages use), plus
`micromark-extension-gfm` for tables, strikethrough, task lists and autolinks. Same author and
family; `micromark(text, { extensions: [gfm()], htmlExtensions: [gfmHtml()] })` returns HTML.
**Raw HTML in the Markdown is escaped**, micromark's default (`allowDangerousHtml: false`). Not
for safety — an `.html` upload is already legal and the sanitiser is downstream — but because it is
the library's default and the boring choice; a `<details>` in a README shows as text. Title: the
first `#` heading via Readability's own reading of `<h1>`, else the stem.

**Word** — [mammoth](https://github.com/mwilliamson/mammoth.js), BSD-2, since 2013, still released
(1.12.x, 2026). Chosen by [third-party-library-selection.md](../reusable/third-party-library-selection.md):

| | mammoth | docx-preview / docx4js | pandoc (binary) | LibreOffice headless |
|---|---|---|---|---|
| what it is | docx → semantic HTML (headings, lists, tables, footnotes, links) | docx → styled DOM for a browser | universal converter | full office suite |
| fits "one server process, TypeScript" | yes, pure JS | browser-first | a binary on Vercel: no | no |
| community / pretraining | the standard answer, ~13 years | small | huge, but not a library | — |

mammoth's *semantic* output (it maps Word styles to `h1`–`h6`, `ul`/`ol`, `table`, footnotes,
rather than reproducing fonts and colours) is exactly what Readability and the block splitter want.

**Version ≥ 1.11.0 matters**: 1.11.0 stopped mammoth reading *external* files a document links to
(a `.docx` can name `file:///etc/passwd` as a linked image — CVE-2025-11849). We pin the current
release and pass nothing that turns external access on.

**Images are dropped in v1.** mammoth's default inlines them as `data:` URIs; stage 4.5
(`src/assets.ts`) hosts only absolute `http(s)` images, so they would be dropped there anyway, but a
50 MB document's base64 would ride through Readability first. So `convertImage` returns no `src`,
and the media parts are not decompressed at all (below). Hosting a Word document's figures is
§ Deferred.

### A `.docx` is a zip, so it can be a zip bomb

The 50 MiB cap is on the compressed bytes. mammoth decompresses `word/document.xml` with jszip,
which grows its output to whatever the stream inflates to, ignoring the declared size — so a 50 MB
file that inflates to 50 GB takes the process down. **The guard, before mammoth sees anything**
(`boundedDocxParts`; this is the version after the plan review — the first trusted declared sizes,
§ After the plan review):

1. fflate's streaming `Unzip` reads the archive **16 KB at a time** and inflates each part we keep,
   **counting the bytes that actually come out**. Past **32 MiB** in all, it stops and refuses. No
   header field is believed: not the declared size, not the compressed size, not an offset.
2. It refuses more than 2,000 entries, a name that appears twice, and any compression method
   other than stored or deflate; it skips `word/media/`, `word/embeddings/` and `word/fonts/`
   without inflating them.
3. The kept parts are re-zipped, stored (level 0), and *that* is what mammoth reads — so whatever
   the reader's archive says about itself never reaches jszip.

Each refusal has a test built from a hand-made adversarial zip (a lying deflate header, a lying
stored entry, a streamed archive with data descriptors, a repeated name, an unknown method), and
each was watched going red with its check removed.

mammoth's XML parser is `@xmldom/xmldom`, which installs only XML's five predefined entities, so
neither external entities nor billion-laughs expansion is reachable (checked by the reviewer
against the installed source).

## Where the code goes

| file | change |
|---|---|
| `src/uploads.ts` | `uploadKind` returns `"pdf" \| "html" \| "text" \| "markdown" \| "docx" \| null`; `uploadContentType` labels the PUT (`text/plain` for text and Markdown, the Word MIME for `.docx`); `uploadLimits()` and `uploadProblem`'s sentence name the formats |
| `src/fetch.ts` | `uploadedFormat(filename, bytes)` beside `uploadedDocumentKind`, same evidence, the rule above |
| `src/upload-convert.ts` (new, server-only) | `convertUpload(format, bytes, filename)`: the three converters and the zip guard |
| `src/source.ts`, `src/store/blobs.ts` | `StoredKind` gains the three formats (extension, content type), so the original is stored like any other object |
| `src/pipeline.ts` § `acquireUpload` | ask `uploadedFormat`; for the three, convert and continue as `kind: "html"` with the converted text; a converter failure is `refuse("not-a-pdf")` |
| `scripts/stage.ts` § `ingestFile` | the same function, so `npm run ingest -- notes.md` agrees with the browser |
| `src/messages.ts` | `UPLOAD_UNREADABLE_FILE`'s sentence names the formats; code `[up-pdf]` and reason `"not-a-pdf"` unchanged, for 260907b's reasons |
| `src/web/UploadPicker.tsx` | `accept` lists the new extensions and types |
| `supabase/config.toml` | the `sources` bucket allows `text/plain` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |

**The bucket change does not reach production by itself.** `scripts/deploy.ts` refuses on
bucket drift until the repair, `npx tsx scripts/check-buckets.ts --prod --apply`, has run
([deployment.md](../project/deployment.md)). That is the Overseer's to run as part of the deploy,
not this session's; the note says so, and until it runs a text or Word upload gets a 415 at the
bucket while PDF and HTML are untouched.

## Not a defence edit

None of `security-map.md § Where the defences physically live` is touched: not the sanitiser, not
`routes.ts` (the upload route already asks `uploadProblem` by name), not `fetch.ts`'s scheme/size
envelope (the new function sits beside `uploadedDocumentKind`, which is classification, not the
envelope). The zip guard is new defensive code in a new module.

## Stages

1. **Classification and conversion**: `uploads.ts`, `fetch.ts`, `upload-convert.ts`, `acquireUpload`,
   `ingestFile`, the bucket line, tests (unit for each converter and the zip guard; the pipeline's
   upload test for one text and one `.docx` through to an article). Run against the local stack with
   `npm run ingest -- <file>` on a real `.txt`, `.md` and `.docx`.
2. **What the reader sees**: picker `accept`, `uploadLimits()`, the two refusal sentences, docs
   ([ingest-queue.md](../project/ingest-queue.md), [content-extraction.md](../project/content-extraction.md),
   `/help` if it lists formats), and one browser pass uploading each kind.

## After the plan review

GPT Sol said **REWORK** ([plan-review-sol](261011j-upload-text-markdown-and-word-files-plan-review-sol.md)).
What each finding became:

1. **Keep the original (high).** Accepted: vision.md principle 6, *never lose what the reader gave
   us*. `acquireUpload` now stores the arrived bytes too, content-addressed as
   `sha256/<raw_sha256>.{txt,md,docx}` — the hash `article_revisions.raw_sha256` already holds and
   the extension `raw_filename` already carries, so the original is findable with **no migration
   and no new column**. Nothing in this repo ever deletes a blob. Export and the Feedback
   diagnostics still carry the converted page, which is what the pipeline read; carrying the
   original too is deferred below. **On the injection scan** (`src/injection-scan.ts`, a defence
   this work does not touch): its question is whether the model reads text the reader cannot
   see, and mammoth flattens white, one-point and Word-"hidden" text into ordinary paragraphs, so
   what the model reads and what the reader sees are the same page — the scan examines the right
   thing. A test pins that flattening, so a mammoth upgrade that kept any of it would go red.
2. **The zip guard was not sound (high).** Accepted and rebuilt: § A `.docx` is a zip. The
   reviewer was right that `unzipSync` bounds the buffer but not the work, and that stored and
   duplicated entries escaped the count.
3. **mammoth hardening (medium).** Floor raised to **1.12.3** (1.12.2 fixed a prototype pollution
   that could re-enable external file access; 1.12.3 a ReDoS); `includeEmbeddedStyleMap: false`
   added. **A worker with a timeout was not added**: no document parser here runs in one — pdf.js
   and Readability read hostile files in-process — and what a `.docx` adds over those, the zip, is
   now bounded. Isolating every parser is its own piece of work, queued below.
4. **CLI and deploy contract (low).** The CLI uses `uploadedFormat` and `formatContentType`, and
   the bucket line says plainly that `check-buckets --prod --apply` must run before the deploy's
   gate passes; the deploy only refuses.
5. **Test seams (low).** Added: Markdown end to end (CLI), browser-type variants
   (`tests/uploads.test.ts`), the staging type against the declared bucket list, an embedded
   picture, the adversarial zips, and `acquireUpload` against the database for a text file and a
   bad `.docx`. Not added: a converter timeout (there is none, per 3).

## Deferred (each gets an overseer-queue entry)

- **Images from a Word document**, hosted like a web page's figures (extract `word/media/*`, store
  through `src/assets.ts`).
- **More formats**: `.odt`, `.rtf`, `.epub`, old binary `.doc`, LaTeX `.tex`.
- **Maths in Markdown** (`$…$`) drawn as maths, via the existing TeX path.
- **Export and Feedback diagnostics carry the original file** of a converted upload, beside the
  page made from it.
- **Run untrusted document parsers in a worker with a timeout** — mammoth, pdf.js, Readability —
  as their READMEs recommend.

## Review

- Plan: GPT Sol, `--sandbox review` — [261011j-…-plan-review-sol.md](261011j-upload-text-markdown-and-word-files-plan-review-sol.md).
- Code: GPT Sol, fixes in place — [261011j-…-code-review-sol.md](261011j-upload-text-markdown-and-word-files-code-review-sol.md).
  Verdict REWORK; what each finding became:
  1. **`uploadedFormat` broke the byte-evidence invariant (medium).** Fixed by me (Sol left
     `src/fetch.ts` alone, reading the whole file as a defence; only its scheme/size envelope is):
     the converted names now take `classify`'s reading first, exactly as the fetched path does, and
     the invariant corpus in `tests/fetch.test.ts` runs every converted extension — red before the
     fix on `page.docx`. The "PDF header only at byte zero" exception for text names is gone.
  2. **mammoth in-process, no deadline (medium).** Kept as deferred, now recorded where risks are
     recorded: [security-risks.md R19](../project/security-risks.md), beside pdf.js, the same
     risk. Queue `qi-ymdddydy`.
  3. **The original is kept but nothing reads it (medium).** Sol fixed the three sentences that
     called the converted page the original (Metadata's export card and *View the original*, the
     Feedback tick-box). Using the original in export and diagnostics stays queued
     (`qi-5pthxgvh`).
  4. **Adversarial-zip tests incomplete (low).** Added: a bomb with its central directory cut
     off, trailing junk, an archive cut mid-part. Sol confirmed the counted bound holds on every
     path, and corrected the module header's overstatement of it.
  5. **Reader-facing claims (low).** Fixed by Sol, each with a test seen red.

  And from the browser check: a text file's first line was both the title and a repeated first
  paragraph; it is now the page's `<h1>`.

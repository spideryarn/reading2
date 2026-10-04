# A PDF chunk too big for one request (`pdf-chunk-big`)

**Status: A and B were built on 2026-10-04, under plan
[261004f](261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md). C and D
are not built. See [§ Result](#result) at the end.** What follows is the investigation as it was
written on 2026-09-28, when nothing was built and Greg was to decide which option to build, if any.

**Where the report came from:** Greg, 2026-09-28, passed on by the Overseer as a low-priority brief.
There is no note under `docs/user-feedback/` for it, and none was added. He imported
<https://compmem.princeton.edu/wp/wp-content/uploads/2025/11/Synthesizing-images-to-map-neural-networks-to-the-human-brain.pdf>
and got:

> Part of this PDF is too large to send to the AI service in one piece — 32 MB, where 30 MB is the
> most a single request can carry. … [pdf-chunk-big]

> LOW PRIORITY Delegate to an agent to investigate and propose ways we might address this.
>
> — Greg, 2026-09-28

## Why it failed, in plain words

The paper is 9 pages and 26.6 MB. Almost all of that is on **one page, page 6**, which is two brain
maps drawn as vector graphics. They are not pictures but about 740,000 tiny filled shapes, 15.8 MB
and 3.4 MB once compressed (47.7 MB and 9.8 MB unpacked). Cut out on its own, page 6 is a 20.2 MB
PDF, and 26.9 MB once base64-encoded for the request.

The importer sends the paper in pieces, called chunks. Each chunk also carries **the page before it**,
marked "do not transcribe", so the model can finish a sentence that runs across the page break
(`chunkFrom` in `src/pdf-read.ts`). The planner already gives a heavy page a chunk of its own, and it
did: the plan was `1–3, 4–5, 6, 7, 8, 9`. But page 7's chunk then took page 6 along as its context
page, even though page 6 alone was 6.7 times the planner's own 3 MB bound. That gives 20.2 MB +
3.8 MB = 23.9 MB raw, **31.85 MB encoded**, and the 30 MB check refused it. Page 6's own chunk
(26.9 MB) would have passed.

```
chunk        sent pages     encoded   vs the 30 MB check
  6          5 (ctx), 6     26.9 MB   passes
  7          6 (ctx), 7     31.9 MB   refused  ← the report
  7, no ctx  7               5.1 MB   passes
```

**The 30 MB number is out of date.** The comment on `MAX_ENCODED_BYTES` says *"Anthropic's own limit
is on the whole encoded request"*, and 30 MB sits under Anthropic's 32 MB. But the PDF reader has
been `openai/gpt-5.6-luna` since the bake-off (`PDF_READER_MODEL`, `src/models.ts`). OpenRouter
sends a PDF to an OpenAI model as a native file part, and OpenAI's docs say, as of 2026-09-28:
*"each file must be under 50 MB. The combined limit across all files in the request is 50 MB."*
([file inputs](https://developers.openai.com/api/docs/guides/file-inputs)). Nothing Vercel imposes
is involved: the function fetches the PDF, or reads it from storage, and the model request goes out from it, so
Vercel's 4.5 MB inbound body limit never sees these bytes.

## What was measured (the spike)

All on the Hetzner box, 2026-09-28. The scripts were under `data/spike-pdf-big/` (gitignored) and
are not kept.

| question | answer |
|---|---|
| Where is the weight? | Two vector drawings on page 6 (15.8 + 3.4 MB compressed). Page 7 has two JPEGs (1.55 + 0.92 MB) and cuts to 3.8 MB. Every other page is under 1 MB. |
| **Does the provider really take a 32 MB chunk?** | **Yes.** With the check raised to 45 MB for one run, `npm run eval:pdf-read` imported the whole paper: 6 chunks, all answered (the CLI's own `Chunks:` line shows 3, because it plans without page sizes), about 80 s, **$0.066**. The chunk the report refused came back with its text. |
| Can page 6 be slimmed without a new dependency? | Yes. Swapping every drawing or image over 1 MB for an empty one of the same size, with pdf-lib, which we already use: **20.2 MB → 0.98 MB in 0.2 s**. Its text layer went from 803 words to 769. The 34 lost are all labels *inside* the brain maps (layer numbers, "t statistic value"). Prose and both captions are intact. |
| Can it be flattened to a picture instead? | Yes, with PDFium, which the figure route already ships. Page 6 at 150 dpi: **0.87 MB, 5 s**; page 7: 0.58 MB, 7 s. Peak memory about 530 MB. But the page's text layer is gone, and the model has to read the prose off pixels. |
| Quality notes on the successful run | Pages 6 and 7 were flagged for "missing" words. The missing words are the figures' axis labels and tick numbers. The prompt tells the model to give a figure's caption and nothing else (rule 7), so this is the checker counting figure text, not a transcription fault. |

**Spend:** $0.066 of metered model calls, all of it the one import above. The GPT Sol review ran
on the Codex subscription.

## The options, most worth doing first

Every option below runs where the importer already runs, on Vercel, in plain TypeScript, with
libraries we already have. None needs the browser or a Supabase Edge Function.

### A. Match the check to the model that actually reads the PDF — one line, and it fixes this report

Raise `MAX_ENCODED_BYTES` to **40 MB**, and correct the comment. OpenAI's 50 MB is a limit on the
*file*. Nobody documents OpenRouter's limit on the whole request, and we have tested once, at 32 MB.
So 40 fixes this paper and leaves room for the request's JSON and whatever a proxy adds (GPT Sol's
number; the draft said 45). Tie the limit to the model **structurally**, not just by putting the two
constants side by side: `openRouterReader` accepts any model string (`src/pdf-read.ts:797`), so the
limit should come from the model it is given. Moving back to a Claude reader would then bring back
the 32 MB limit by itself.

- **Cost:** a couple of hours with the test.
- **Gives:** this paper imports as it is. The spike proved it end to end.
- **Gives up:** nothing today. It rests on a documented file limit and one live run, not a
  near-limit probe. One 38–40 MB request, a few cents, would settle that if we ever want more.

### B. If a chunk would be refused, try it again without its context page — small, and it fixes the cause

At the size check (`src/pdf-read.ts:824`), when a chunk that carries a context page is over the
limit, cut it again without the context page. Refuse only if it is *still* over. On this paper, page
7's chunk falls from 31.9 MB to 5.1 MB.

The draft had a broader version: drop any context page heavier than `MAX_CHUNK_BYTES` (3 MB) when
planning. Sol showed that costs more than it looks. Page 7 is itself 3.8 MB, so page 8 would lose its
context too. And the context page is what lets the model set `continues` on a paragraph broken across
the page. Without it the paragraph is split in two, and the repair of a word hyphenated across the
page break needs `continues` as well (`src/pdf-read.ts:1556`). The narrow version gives up that
continuity only on a chunk that would otherwise fail outright. It measures the real bytes rather than
the planner's estimate, and it leaves the planner alone.

- **Cost:** about 15 lines and a test. Half a day with review. Sol checked the code: nothing assumes
  a chunk has a context page. The prompt, the scorer and the checkpoint key all handle its absence
  (`src/pdf-read.ts:699`, `:1998`, `:2980`).
- **Gives:** under the old 30 MB check, nothing in this paper would be over.
- **Gives up:** on the rare chunk it fires on, a paragraph broken at the page boundary comes out as
  two paragraphs.
- **Leaves alone:** a heavy page is still sent twice, once as itself and once as its neighbour's
  context. Here that is 20 MB of extra upload and a second render of 740,000 shapes. It is a cost
  and not a failure, so it can wait for C.

### C. Slim a single page that is over the limit on its own — only when one appears

A and B do nothing for one page that is over 40 MB by itself. For that page, do what the spike did:
in the copy sent to the transcriber *only*, replace large drawings and images with empty ones of the
same size. The transcriber needs the caption, not the picture. Figure recovery reads the original
PDF from storage, so it loses nothing.

- **Cost:** a day or two. The work is in the guards, not the swap. Some PDFs wrap a whole page,
  prose included, in one drawing object, and a scanned page's image *is* its text. So the check has
  to be the one the spike used: compare the page's text layer before and after, and keep the slimmed
  copy only if the prose survives. Scans (`pass.isScan`) need option D instead.
- **Gives:** removes the limit for most born-digital PDFs. Not all: some of a page's weight can sit
  outside the large drawings and images this would swap out, such as fonts or many small objects. It
  also makes heavy pages faster and cheaper to upload.
- **Gives up:** the model can no longer see the figure. Today it ignores the figure anyway, apart
  from the caption.

### D. Send an over-limit page as a picture — the fallback for scans

Draw the page with PDFium (0.9 MB, about 5 s a page here) and send that one-page image-PDF instead.

- **Cost:** a day. The drawing code exists (`src/pdf-figure-render.ts`), and it needs a whole-page
  entry point and a PNG-in-PDF wrapper.
- **Gives:** works on scans with huge page images, where C cannot help.
- **Gives up:** the text layer. The model reads the prose from pixels, and a 5 s WASM render joins
  the importer's time budget. Worse than C for any page that has real text, so use it only when C
  refuses.

### Ruled out

- **Fewer pages per chunk.** The failing chunk was already a single page plus its context, so this
  cannot help.
- **Sending the PDF by URL or Files-API id.** OpenAI documents the same 50 MB for every way of
  attaching a file.
- **Another provider** (Gemini: 50 MB / 1,000 pages). This buys nothing over A, and changing the
  PDF reader means a new bake-off.
- **The browser or an Edge Function.** Nothing here outgrows Vercel. The heaviest option, D, is
  5 s and about 530 MB.

## Recommendation

**Build A and B together, as one small stage, and nothing else yet.** A fixes this report today and
removes a number that has been wrong since the reader changed model. B means a context page can
never be the reason a chunk is refused. Build C only when a real single page over 40 MB turns up,
and D only for a scan that C refuses. Neither has been seen yet.

GPT Sol reviewed this recommendation (read-only, 2026-09-28). It agreed with the cause, traced
through the code, and with the ranking. Its corrections are folded in above: 40 MB not 45, the
narrower B, the structural tie between model and limit, and three factual fixes.

The reader-facing message (`pdfChunkTooBig`, `src/messages.ts`) says *"a PDF with fewer or smaller
images in it will go through"*. Here the weight was a drawing, not an image. After A and B this
message should be very rare, so it can stay as it is.

## What Greg needs to decide

1. **Build A + B now, or leave it?** It is low priority, and so far one paper has hit it.
   Recommended: build them. The cost is half a day, and the 30 MB number is wrong for every PDF.
2. **When a chunk would otherwise be refused, is it acceptable to send it without its context page
   (B)?** The cost is that a paragraph running across that one page break comes out as two
   paragraphs. Recommended: yes, since the alternative is failing the whole article.
3. **C and D: wait until a real example turns up?** Recommended: wait.

## Result

**A and B were built on 2026-10-04**, as part of stage 2 of plan
[261004f](261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md). Greg did
not answer the three questions above one by one. His report `spya-bac46a` asked for big PDFs to be
made robust up to the stated limits, and that plan took it as a yes to items 1 and 2; the trade-off
in item 2 is written again under that plan's § Decisions so that he can overturn it. Item 3, options
C and D, still waits for a real example.

What was built, all in `src/pdf-read.ts`:

- **A.** The allowance is `READER_REQUEST_BYTES`, keyed on the model: **40 MiB** encoded for
  `openai/gpt-5.6-luna`, and the old 30 MiB for any model that is not listed. The key is checked by
  the compiler against `PDF_READER_MODEL`, so changing the reader model fails `npm run typecheck`
  until its limit is written down. 40 MiB still rests on a documented 50 MB file limit and one live
  run at 32 MB; no request near 40 has been sent.
- **B, the narrow form.** In `runPdfExtract`, a chunk whose cut is over the reader's allowance and
  which carries a context page is cut again without it. The planner is untouched. The run says which
  pages in its `notes` and in one log line. The chunk's checkpoint key is the key of the chunk that
  was sent (`context: null`), so it cannot be served to a later run that asks for the same pages
  with their context page, or the other way round; no other chunk's key changes.
- **The seam that makes both testable for free.** `openRouterReader` takes the wire (`ask`) and the
  allowance as a third argument, and says its allowance as `PdfReader.maxEncodedBytes`.
  `tests/pdf-chunk-size-policy.test.ts` runs the real reader over a fake wire.

Checked by hand with the production numbers and no network, 2026-10-04: a 4-page PDF whose page 2
is 25 MiB and page 3 is 8 MiB. Page 2 went with page 1 as context (33.34 MiB encoded). Page 3 with
page 2 in front of it would have been 44 MiB, so it went alone (10.67 MiB), with the note. A 3-page
PDF whose page 2 is 31 MiB alone was refused with the same sentence as before, now reading "41 MB,
where 40 MB is the most".

One thing differs from the text above. Where a chunk is *still* over the allowance without its
context page, it is refused on its size without the context page, so the sentence gives the page's
own weight.

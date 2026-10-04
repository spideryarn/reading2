---
reports: spya-bac46a
ending: shipped
---
# Big PDFs and long documents, up to our limits

Report `spya-bac46a` (SPIDERYARN-READING2-C6), a problem, from Greg (admin, production row
proven), 2026-10-04 10:33 UTC, from the home page. Queue item `qi-p8jh7k2h`.

> We've had issues loading big PDFs and documents. Can you run some evals or tests to make sure
> that things are working robustly for big ones up to our limits, basically.

**Ending: Shipped**, on `dev`, not deployed. What shipped is the measurement and two fixes. **It
did not make 250-page PDFs work**, and that is the thing to read this note for. Plan:
[261004f](../plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md).
Write-up:
[the investigation](../investigations/261004b-big-document-imports-at-the-limits.md).

## What it found

The dialog promises 50 MB and 250 pages.

- **50 MB works.** A real 45 MB, 160-page paper imported in under six minutes and loads.
- **250 pages mostly does not.** A real 250-page book was transcribed and then refused at the
  structure step, with nothing to show for it. Any document over about 2,890 paragraphs-and-headings
  is refused there: a novel from about 230 pages, a dense journal paper from about 178.

## What changed

- An article of more than 3,855 blocks could not be saved, and the reader was told to retry. Fixed.
- A PDF with one very heavy page was refused at a limit written for a model we no longer use.
  The limit is now 40 MB, and a page too heavy only because of the page sent before it goes
  without that page. This is the fix plan 260928b wrote and did not build.
- A free harness and tests that hold the stated limits against the code.

Paid spend: $2.15, on two real PDFs.

## What was not done

- **Making a too-long document into an article.** Greg's call, five options, a recommendation:
  `qi-kbkbw4rp`, and on [awaiting-approval.md](awaiting-approval.md).
- **A document pasted as an address stops at 32 MB**, not 50. A listed security defence, so left
  for Greg: `qi-bv9nbj5z`. Greg answered 2026-10-04 and it is built: one 50 MiB limit for both,
  [261004k](../plans/261004k-one-size-limit-for-an-upload-and-an-address.md).
- A long article's response may be too big for Vercel: `qi-sbytr395`.
- Transcription asks nearly every chunk twice and checkpoints under half: `qi-astc8qqs`.
- The Sentry status write: this session has no Sentry sign-in, so the next sweep does it.

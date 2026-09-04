# "couldn't upload PDF"

**[SPIDERYARN-READING2-V](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-V)** · reported
2026-09-03 15:57 UTC · resolved 2026-09-04 · *the crash was already fixed; the reason he hit it was
not*

## What the reader said

> couldn't upload PDF

Four words, and they turned out to be enough, because the diagnostics tick-box was on and Sentry had
the other end of the story.

## What actually happened

A duplicate of an already-fixed bug, joined by eighty-six seconds:

| | when | what |
|---|---|---|
| `SPIDERYARN-READING2-T` | 15:56:06Z | the throw — job `spya-xxd8fq`, slug `lawrence-kuhn-2024-a-landscape-of-consciousness`, `step: extract`, `message_withheld: True`, `Error: Error` |
| `SPIDERYARN-READING2-V` | 15:57:32Z | "couldn't upload PDF" |

He uploaded Kuhn's 142-page paper against a 100-page cap, and **the sentence explaining that was
written seven lines from the throw and reached neither him nor Sentry.** His release was built at
12:15; the fix landed at 19:40 (`92ff0e83`) and the cap moved to 250 the next morning (`92cf9383`).
Both are ancestors of production `main`. So the same file would go through today, and there is no
live bug of that kind. Already written up in
[the postmortem](../postmortems/260904b-a-sentence-written-for-the-reader-was-thrown-away-at-the-seam.md),
which now carries a note joining V to T rather than a second account of the same thing.

## The defect that was left, and it is the one he actually named

**He wrote *upload*, not *extract*.** A page cap is not a thing a reader can check before uploading —
a file manager shows a size and never a page count — so the only way to find it was to send a book
and be turned away at the end of the process. And nothing in the add box said so. The entire text
was:

> Add an article · PDF · Add · The article's text is sent to a third-party model provider for
> processing.

Fixing the crash makes the refusal *legible*. It does not stop the reader wasting the upload. So:

**Before choosing a file, the box now says: `PDF, up to 50 MB and 250 pages.`** One muted 12px line,
in the slot the chosen-file row later occupies so it costs no height once acted on, wired to the
button with `aria-describedby`, confirmed in a browser at 390px and 1280px.

To get there, `MAX_PAGES` moved from `pdf-read.ts` to `uploads.ts`, beside `MAX_UPLOAD_BYTES` —
`uploads.ts` is dependency-free and shared by browser and server by design, while `pdf-read.ts`
drags in pdf.js, so **the browser could not name the number at all**. That is the structural reason
the caps were unstated, rather than an oversight.

The three picker refusals also gained codes (`[pick-pdf]`, `[pick-empty]`, `[pick-big]`), reversing a
documented decision not to give them any. The evidence for reversing it is this very report: a bare
paraphrase like "couldn't upload PDF" fits **seven branches across four files**, and a code would
have cut that to one. `copy.md` now carries the `pick-`/`up-` distinction.

## Two things worth keeping

**The red test was made to go red twice.** The first failure was the ordinary one. Then GPT Sol
pointed out that `textContent` is blind to visibility — a line could be in the DOM, asserted on, and
invisible — so a hidden-walk assertion went in, and *that* was driven red on purpose by temporarily
marking the element `hidden`. A test that was never red proves nothing, and that applies to each
assertion, not just the file.

**One review finding was declined, with a reason.** Sol wanted a compatibility re-export of
`MAX_PAGES` left behind for a concurrent branch. That branch's only external importer is
`src/pipeline.ts:92`, a line it does not touch, so the merge is clean — the alias would have been a
permanent second import path bought against a risk of nil.

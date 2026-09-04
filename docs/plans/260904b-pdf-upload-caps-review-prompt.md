# Review: stating the PDF caps before the file is chosen

Repo: /home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b (a git worktree of
the Spideryarn app — TypeScript + ESM, React client, Postgres, Vercel).

## The report this came from

A reader pressed Feedback on 2026-09-03 and wrote, in full: **"couldn't upload PDF"**. Sentry
`SPIDERYARN-READING2-V`, 15:57:32Z. Eighty-six seconds earlier the same user's job threw
`SPIDERYARN-READING2-T`: `step: extract`, `message_withheld: True`, exception `Error: Error`. That
was a 142-page paper hitting a then-100-page cap, and the sentence explaining it was thrown away at
a seam. **That bug is already fixed and deployed** (cap now 250; the refusal names both numbers;
postmortem `docs/postmortems/260904b-a-sentence-written-for-the-reader-was-thrown-away-at-the-seam.md`).
His build predates the fix.

So the remaining defect is a different one, and it is what this change is about: **a page cap is not
something a reader can check before uploading.** A file manager shows a size and never a page count,
so the cap was discoverable only by uploading a document and being refused at the end. Nothing in
the add box stated either cap.

## What the change does

1. **Moves `MAX_PAGES` from `src/pdf-read.ts` to `src/uploads.ts`.** `src/uploads.ts` is the
   dependency-free module whose stated job is "what counts as a PDF worth uploading, decided in one
   place… the answer has to be the same in the browser and on the server"; `MAX_UPLOAD_BYTES` already
   lives there and `src/messages.ts` already imports it. `src/pdf-read.ts` pulls in pdf.js and
   p-queue, so the browser could not import the number at all. The essay about *why 250 is safe
   against the step deadline* stays with the `CHUNK_CONCURRENCY` arithmetic it is about; the
   declaration moves.
2. **Adds `uploadLimits()`** in `src/uploads.ts`, built from both constants, rendered as one muted
   12px line in `src/web/UploadPicker.tsx`'s status slot when no file is chosen and no transfer is
   running: `PDF, up to 50 MB and 250 pages.`
3. **`formatBytes` stops printing a trailing `.0`** — "up to 50 MB", not "up to 50.0 MB". This also
   changes the existing size refusal to "That's 60 MB, and the limit is 50 MB."
4. **`UPLOAD_TOO_MANY_PAGES` in `src/messages.ts` now names the limit**, which its own docblock said
   it could not do only because of the import barrier that point 1 removes.
5. Tests: a new jsdom test that renders the real `AddArticle` and asserts both numbers are on screen
   before any file is chosen (**written first and watched fail** — the box's whole text was
   "Add an article PDF Add The article's text is sent to a third-party model provider for
   processing."); plus unit assertions that `uploadLimits()` is derived from the constants.

## What I want from you

Be adversarial. Specifically:

1. **Is moving `MAX_PAGES` right, or is it the wrong module?** Another agent is concurrently editing
   `src/pdf-read.ts` heavily on a separate branch. Is there a cheaper design that gets the browser
   the number without the move, that does not create a second source of truth?
2. **Anything the new render condition gets wrong.** `{!chosen && !transfer && ...}` — is there a
   state where this shows when it should not, or hides when it should not? Note the hint deliberately
   stays visible under a refusal, including the size refusal that repeats "50 MB" one line above.
3. **`formatBytes`**: is stripping `.0` safe for every caller, and is `mb >= 100` still equivalent to
   the old `mb < 100` branch?
4. **Is the test a real test?** It renders the component and reads `textContent`. Would it stay green
   if the line were rendered but invisible (`display:none`, off-screen, `aria-hidden`)? Is that worth
   fixing, and how, in jsdom?
5. **Copy.** The reader-facing sentences now read (exact):
   - hint: `PDF, up to 50 MB and 250 pages.`
   - too big: `That's 60 MB, and the limit is 50 MB.`
   - not a PDF: `That isn't a PDF. Uploads are PDFs for now — a web page can go in the box above instead.`
   - job, over the cap: `This PDF has 300 pages, and this app reads at most 250 of them in one go. That is a limit on what reading a document is allowed to cost rather than a technical one, so the same file will be refused the same way — a shorter document, or the part of this one you actually want, will go through. [pdf-pages]`
   - upload record, over the cap: `That PDF has more pages than the 250 this app reads in one go. …[up-pages]`

   The three picker refusals carry **no bracketed code**, deliberately, argued in `src/uploads.ts`'s
   header: "these never involve a provider or a request, so there is nothing for anybody to look up."
   The project's copy rule (`docs/project/copy.md`) says a code exists "so that a person reporting a
   problem can quote a handful of characters instead of paraphrasing a sentence". The report that
   started this was a bare paraphrase. **Should those three get codes?** Argue it either way, but
   commit to one.

Ignore anything in the diff that is not part of the above — the tree is shared with other agents.

The diff follows.

(The scoped diff that followed is the change itself; read it from the commit rather than from a
stale copy here.)

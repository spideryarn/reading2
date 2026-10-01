# 261001s — Past imports say more; "Why are you reading this?" says whether it saved, and asks again later

Two of Greg's suggestions from the Feedback dialog, batched because both are about adding an
article. Overseer queue item `qi-vjrbdnsg`. Reports `spya-a5gzb9` (SPIDERYARN-READING2-8A) and
`spya-hbqezu` (8C). The note is `docs/user-feedback/261001_1830-imports-detail-and-why-you-are-reading.md`.

## What Greg asked for

`spya-a5gzb9`, Greg, 2026-10-01, on the signed-in home page:

> In logged-in homepage, add more metadata for past imports.
>
> e.g. see screenshot of failed imports. There's not enough information there to be useful (e.g.
> hyperlink to source/original/uploaded, datetime stamp and human-readable `X ago`, quick button to
> generate a pre-populated Feedback `problem` report with lots of details, etc.

`spya-hbqezu`, Greg, 2026-10-01, on the add page:

> When importing, I can see it now shows "Why are you reading this?" - great! But it doesn't have a
> UI indication of when/whether it has saved it or not.
>
> Also, if they don't fill this in (e.g. because they didn't notice it), pop up an input box asking
> why they're reading it when the article loads for the first time.

The report did not carry the screenshot, so this works from the page itself.

## What is there now

- **The import cards** (`JobCard` in `src/web/AddArticle.tsx`, shared with the add page) show the
  title or slug, the steps, and Retry / Dismiss. A failed one also shows the failed step's message.
  Nothing says *where it came from* or *when*, and there is no way from the card to tell us about it
  except opening Feedback and typing it all out.
- **The add page's purpose box** (`PurposeBox` in `src/web/AddPage.tsx`) is deliberately *not* the
  autosaving `ProfileBox`: there is no article to save to until the import finishes, so what the
  reader types is held in the page and stored when they press **Save and open** (plan 260930e). Its
  hint says nothing about that, so while the import runs a reader cannot tell whether their sentence
  has gone anywhere. That is the gap Greg hit.
- **When nothing was typed and the box was never focused**, the add page opens the article as soon
  as the import finishes, and the purpose is never asked for again.

## What changes

### Stage 1 — a past import says where, when, and has a "Report this" (8A)

Under the title on every import card, one muted line:

```
arxiv.org/abs/2401.01234 ↗  ·  1 Oct 2026, 10:35 · 3 hours ago
```

- **Where**: an address import shows its URL as a link (new tab, `rel="noopener noreferrer"`),
  drawn as a link only when `isWebUrl` (`src/urls.ts`) says it is `http(s)` — the URL is the
  reader's own input, and an `href` built from it must never be `javascript:`. An upload shows its
  filename as plain text. A re-run with neither shows nothing here.
- **When**: `exactly(createdAt)` and `timeAgo(createdAt, now)` from `src/web/relative-time.ts`, the
  client's one formatter. Both visible, because Greg asked for both. The card's clock (`useNow`) is
  off for finished cards; "3 hours ago" going stale while the tab sits open is acceptable for a
  history list, and the page re-renders on every poll anyway.
- **Report this** (only on a **failed** job; the prefill below is superseded by review item 6 — ids, closed values and times only): opens the Feedback dialog with kind **Problem**
  chosen and the body filled with what we know:

  ```
  This import failed.

  Source: https://…            (or: Uploaded file: name.pdf)
  Article: <slug>
  Job: <id>
  Started: 2026-10-01T10:35:00.220Z
  Ended: 2026-10-01T10:36:12.004Z
  Failed at: <step label>
  Error: <the step's message>

  What I expected:
  ```

  The text is the reader's to edit or delete before sending, and none of it is article prose. The
  dialog's `FeedbackApi.open()` becomes `open(prefill?)`, `prefill = { kind, body }`. If the draft
  is empty the body is put in; if the reader already has a draft, the prefill is appended after a
  blank line rather than thrown over their words. The kind is set either way.

  Built as a pure function `importProblemReport(job)` so the words are tested without a dialog.

Shown on both surfaces that draw `JobCard` — the home page and the add page — because a failure on
the add page needs the same button and the same timestamp; the URL line repeats the add page's
header there, which is harmless.

### Stage 2 — the add page's purpose box says whether it has saved (8C, first half)

A status line under `PurposeBox`, in `ProfileBox`'s `prof-save` style so it looks like every other
saving box:

| When | It says |
| --- | --- |
| box empty | nothing (the hint already says *Optional*) |
| text typed, import still running | **Not saved yet** — kept here until the import finishes |
| text typed, import finished (*ready*) | **Not saved yet** — Save and open stores it |
| Save and open pressed | spinner, **Saving…** |
| save refused | the existing *Not saved — reason* (moved into the line) |

There is no *Saved* state on this page, because a successful save navigates straight to the
article. That is the honest shape: the sentence is stored at the moment it can be, and the line
says so until then.

**Passed over: autosave as soon as the import finishes.** The box could save itself the moment the
article exists. It is not done because the page then has two ways to save and the deliberate
"Save and open" decision (modes written for the purpose from the start) would race the timer. The
status line answers the question Greg asked — *has it saved?* — without that.

### Stage 3 — ask once, when the article first opens (8C, second half)

**Which opens count as "first".** Only an article opened **straight from the add page with
nothing typed and the box never touched** — the "didn't notice it" case Greg names. Not:

- *Open without it* — the reader saw the box and declined;
- any article already on the shelf — otherwise every old article without a purpose would ask the
  next time it was opened, which is a nag rather than "the first time";
- bulk-imported papers (plan 261001m) — forty prompts for forty papers.

**How the reading view knows.** The add page writes a one-shot mark,
`sessionStorage["spideryarn.ask-purpose"] = slug`, only on the silent auto-open path. The reading
view, **for the owner only**, takes it on mount (reads and removes it, if it names this slug). With
the mark, it reads the purpose (`usePurpose`, `GET /api/reader?slug=`); if that answers *ready*,
`purpose === null` and `purposeFailed === false`, it opens a small dialog:

```
┌ Why are you reading this? ───────────────────┐
│ [ textarea — ProfileBox, autosaving ]         │
│ Shapes the quotes, ideas, glossary and the    │
│ reading route for this article. You can       │
│ change it later on Metadata.                  │
│ ✓ Saved                                       │
│                         [Not now]  [Done]     │
└───────────────────────────────────────────────┘
```

`ProfileBox` + `useAutosavedText` (plan 261001l), so it saves itself, says so, and warns on leave.
**Done** saves anything pending and closes once it has; a refusal keeps the dialog open with the
reason. **Not now** and Escape close it. Either way the mark is already gone, so it is asked once.
A tab, not the reader, is the unit: sessionStorage survives a reload of the article (where the mark
is already consumed, so it does not ask again) and does not follow the reader to another device,
which is fine for a one-time question.

**What the answer cannot change.** If the reader ticked *Generate the main modes as soon as it
opens*, those jobs were queued as the article opened and are written without the purpose. The
dialog says nothing about that (a reader cannot act on it), and the modes the reader opens from
then on use the purpose. **Passed over:** holding the auto-modes until the dialog is answered —
braids the add page and the reading view together, and a reader who closes the tab without
answering would get no modes at all, silently.

## Deferred, named

- **A link to the uploaded original.** There is no route that hands a reader back the bytes they
  uploaded, and for a failed import the stored object may have been expired. Adding one is a new
  owner-only read path onto Storage — small, but its own piece of work with its own security
  check (docs/project/security-map.md). The filename is shown as text meanwhile.
- **Holding auto-modes for the purpose** — above.
- **Asking on other devices / for older articles** — deliberately not; see Stage 3.

## Tests (red first)

- `importProblemReport` — URL vs upload vs neither; failed step label and message; ISO times.
- `JobCard` — the source line links only an `http(s)` URL (a `javascript:` URL renders as text); an
  upload shows its filename unlinked; *Report this* only on `status: "error"` and calls the
  feedback opener with kind `problem` and that body.
- `FeedbackDialog` — a prefill into an empty draft sets body and kind; into a non-empty draft it
  appends.
- `AddPage` — the status line's words in each phase; the mark is written on the silent auto-open
  and **not** on *Open without it* or *Save and open*.
- the mark helpers — take returns the slug once and clears it; a different slug leaves it.
- `PurposePrompt` — opens only with the mark and `purpose === null && !purposeFailed`; not for a
  visitor; Not now closes; Done saves then closes.

## Browser check

Playwright on the box, desktop and 390px: a failed import on the home page (line, link, *Report
this* opening a filled Problem report); the add page's status line through running → ready →
saving; and the first-open prompt after a silent import.

## GPT Sol's plan review, and what changed

`261001s-plan-review-sol.md`. No P0. Each finding checked against the code:

1. **Existing articles get marked** (the `alreadyArticle` / `articleAnswer` completions, and URL
   re-adds adopted from the shelf). True, and **kept on purpose**: the prompt only appears when the
   article has no purpose, and a reader who has just re-added an article and ignored the box is the
   "didn't notice it" case as much as a first import is. The cost is one question, once, for an
   article they just chose to add. Not worth carrying a new/adopted flag across the API for.
2. **"Never touched" was "not focused right now".** True. A monotonic `purposeTouched` ref (set on
   focus or input, reset only with a new source) decides the mark; the existing auto-open rule is
   unchanged.
3. **Consuming the mark before the read.** True. *Peek* on mount; remove it only on a definitive
   answer (a purpose exists → remove, no prompt; definitively none → remove, prompt). A failed read
   keeps it for the next load. Tested mounted under StrictMode.
4. **`useAutosavedText` must be seeded, and `commit` is not awaitable.** True. `seed("")` once on
   the definitive *none*; **Done** is a latch: commit, close when the state reaches clean/saved,
   stay open on error.
5. **Owner-only must be a component boundary.** True. The prompt is its own component mounted
   inside `OwnedReader` (src/web/article/ArticlePage.tsx), so a visitor never mounts the hook or
   makes the request.
6. **The prefill breaks feedback.md § The one rule.** Accepted, and it changes stage 1. The rule
   is: *everything in a report is something the reader typed into this dialog, a value from a
   closed vocabulary we wrote, or a fact the reader is told, on the page, that we take.* A source
   URL (which can carry a private token — Greg's own 8C URL did), a filename, and a step's error
   sentence are none of those just because they were pre-typed. So the prefill carries **ids,
   closed values and timestamps only**: job id, slug, status, the failed step's name, the failure
   kind, created/started/finished times. The card itself still shows the URL, filename and error.
   **Whether the prefill may also carry the URL, filename and error is Greg's call** — it is a
   change to a stated privacy rule (and to privacy.md's promise), so it is written up, not built.
   The catch with ids alone: *Dismiss* forgets the job record (`DELETE /api/jobs/:id`), so a
   report filed and then dismissed points at a job we no longer have.
7. **Prefill lifecycle.** True. `open({ id, kind, body })`; the dialog applies each request id once
   (StrictMode-safe). Empty draft → body and kind set. Non-empty draft → appended after a blank
   line, the reader's chosen kind kept, and skipped if it would pass the 4,000-character cap.
   No host (`useFeedbackOpen() === null`) → no button.
8. **A failed job may have no failed step; `createdAt` is not "started".** True. The step is
   optional; labels say *Added* for `createdAt`, *Started*/*Ended* only when those exist.
9. **The relative time freezes.** True (`sameJobs` suppresses identical polls). Finished cards get a
   one-minute clock (`useNow(60_000)`); and when `timeAgo` has fallen back to a date (past 30 days)
   the second label is dropped rather than printing the date twice.
10. **The refusal outlives an edit.** True. An edit clears it.

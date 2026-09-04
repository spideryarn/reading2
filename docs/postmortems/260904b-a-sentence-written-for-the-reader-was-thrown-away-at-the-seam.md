# A sentence written for the reader was thrown away at the seam

**Reported 2026-09-03** by Greg, who uploaded Kuhn's *A Landscape of Consciousness* (2024) — 142
pages, against a 100-page cap — and got:

> Extracting the article could not be done for this article as it stands, and asking for it again
> unchanged would most likely come back the same way. `[jb-step-no]`

> I don't know why.
>
> — Greg, 2026-09-03

He could not know. The sentence that would have told him existed, in the source, seven lines from
the throw:

```ts
throw stageFailure(
  "blocked",
  `This PDF has ${err.pages} pages and the limit is ${err.limit}. That is a cost cap, ` +
    `not a technical one — see docs/plans/260826c-pdf-ingestion.md.`,
);
```

It reached the reader's screen not at all, and Sentry not at all. Fixed the same evening in
`92ff0e83` (19:40) and made unrepeatable the next morning in `b0556bd7` (09:20), under
[260903k](../plans/260903k-pdf-page-cap-refused-with-no-reason-given.md) stages 1 and 2.

## The change that did it, seven and a half hours earlier

`46439f1c`, *"Split the two audiences a step's failure has, at the seam"*, **08:19 on 2026-09-03**.
The Sentry event is at **15:56 the same day** (`SPIDERYARN-READING2-T`, job `spya-xxd8fq`, tags
`step: extract`, `message_withheld: True`, and the exception itself bare — `Error: Error`).

That commit was right, and it was right for a counted reason rather than a suspected one. `src/jobs.ts`
copied `(err as Error).message` onto `step.error` and `job.error`, which are what the progress band
and the shelf card render, so whatever a step happened to put in an exception was published to a
reader: provider `stop_details` from six stages until 2026-08-26, two token figures and a file path
from `truncatedMessage`, and — that same morning — a source file reference and an instruction
addressed to whoever tunes the quiz prompt. Three write-ups of one shape. Splitting the channel was
the correct answer.

The whole of the bug is in one signature. Before:

```ts
export function stageFailure(kind: FailureKind, message: string): Error;
```

After:

```ts
export function stageFailure(kind: FailureKind, detail: string): Error;          // log only
export function stageFailure(failure: ReaderFacingFailure, detail?: …): Error;   // the reader's
```

**The first line is the same signature, under a renamed parameter** — `message` became `detail`, and
nothing else about it changed. Every call site in the pipeline kept compiling, kept running,
and silently changed which audience it was addressing — from *this is what the reader is told* to
*this is a note for the log, and the reader gets a generic sentence naming the step*. Nothing at the
call site marked which of those strings had been written for a reader, and nothing in the types
could. Eight throw sites had written one. **Five of them were `blocked`.**

The page-cap sentence is the clearest case, because it was almost entirely the reader's and it ends
with a documentation path that is entirely not — a sentence that was itself two-audience, which is
the best evidence available that the split needed doing.

## The class: the old spelling kept compiling, and changed audience

One channel is split into two, and the question that decides whether the split is safe is not which
of the two is the better default — it is **which of the two inherits the existing syntax**. Whichever
does, every existing call site is silently reassigned to it, and the compiler is exactly as happy as
it was the day before. The migration is left to whoever remembers to do it, at a moment when the
mechanism looks finished.

Two things made this expensive, and both are general.

**The default went to the discarding side, so every observation point stayed healthy.** The reader
saw a grammatical, plausible, correctly-worded sentence about a step that could not be done. The
operator's log still had the full diagnostic, so nothing was missing from there either. Sentry had a
stack, a step tag and a status. Nobody looking at any of the three could see that something had been
lost, because nothing had been lost *from where they were looking* — the sentence was written and
then dropped between two of them. **The only observer who could tell was the reader, and all he could
report was that he did not know why.**

**On five of the eight the kind was `blocked`, which withholds the Retry button.** So the one seat
that could see the loss was also the seat with nothing to do about it: a dead end and no reason for
it, which is worse than either alone. `blocked` is the one non-retryable kind whose whole meaning is
*there is a way out* — and the generic sentence it falls back to cannot name one.

**Where this touches [260904a](260904a-a-retry-minted-a-fresh-name-so-the-checkpoints-could-never-be-found.md),
found in the same job.** Both are a change built on a property that another change had just removed,
hours apart, with nothing at the deciding site recording that anything was owed — ten hours there,
seven and a half here. But they fail differently, and the difference is the interesting part. There,
the fact *was* written down, three times, in the wrong files: at the borrower rather than at the
module that grants it. Here the fact was **never written down anywhere**. Which strings were the
reader's lived only in the prose itself and in the head of whoever wrote each one. A borrowed key can
at least go stale loudly if you move the note to the right file; this one had no note to move, which
is why the fix had to be a type rather than a comment.

## It was predicted, in a comment, the same day

Inside `STEP_GAVE_UP`'s `blocked` case in [`src/messages.ts`](../../src/messages.ts) — the map that
produces the exact sentence Greg was shown — is this, dated 2026-09-03:

> A step that has a real way out should declare its own message and say so. ⟨Sol, 2026-09-03⟩

It is a paragraph about a *different* near-miss: for six hours that same fallback ended *"A shorter
piece sometimes gets through"*, borrowed from the `blocked` messages that really are about size, and
it was cut because pointing a reader at a shorter article when the problem is a missing source
document sends them off doing the wrong thing. Having reasoned all the way to *this generic sentence
cannot say anything useful, so the steps that have something useful to say must declare it*, the note
was written down and the eight steps that already had something useful to say were not gone and
looked for.

A prediction filed is not a prediction acted on. This is the second time in three days that this
repo has recorded the shape of a fault and left it — `truncatedMessage` was written up as *"the same
string has two audiences"* and left, which is quoted in `46439f1c`'s own commit message as the reason
that commit exists. **A default is not fixed by documenting it**, in that commit's words. Neither is
a debt.

## What would have caught it, and what to do

Ranked by ease and value.

1. **Make the old spelling stop compiling — and this landed, as stage 2.** The bare-string overload
   is deleted; a kind-only failure now says `stageFailure(kind, { generic: detail })`, one greppable
   word at the call site, parallel to the `{ authored }` claim already there. `stageFailure("blocked",
   "This PDF has 142 pages and the limit is 100.")` is now `error TS2769: No overload matches this
   call` — verified twice, once against a scratch file and once by the `@ts-expect-error` in
   [`tests/job-failure.test.ts`](../../tests/job-failure.test.ts), which was watched red (`TS2578:
   Unused '@ts-expect-error' directive`) by putting the deleted overload back. The runtime
   deliberately did not change, so an untyped caller loses nothing from the log; the refusal is
   entirely in the types.

   **The transferable rule is one sentence: when one channel splits into two audiences, give neither
   of them the existing syntax.** Make both new, take the mechanical pass, and do it *at the moment
   of the split*, when the author still knows which call site meant what. A week later it is
   archaeology, and here it was archaeology within a day.

   **What it does not cover, stated rather than assumed:** a bare `throw new Error("prose a reader
   could act on")`. TypeScript has no checked exceptions, so no signature can reach it. Two such
   throws were in `runPdfExtract` and stage 1 audited them by hand — and the audit was not a closed
   class, which the review of stage 4 then proved: a password-protected or corrupt PDF was still
   rethrown bare and still handed a Retry button that could never work, in an input class nobody had
   thought to look at. That is exactly recommendation 2.

2. **Say out loud when a `blocked` failure arrives with no sentence of its own.** *Not built.* When
   `readerFailureOf` falls through to `stepGaveUp("blocked", step)`, a step has promised the reader a
   way out and named none — which is a copy defect no type can see, because the throw may be bare.
   One `warn` at that fallback, carrying the step name, turns the whole remaining class into a log
   query. It is the same instrument as 260904a's recommendation 2 and the same lesson pointed at a
   different absence: **log the ordinary case, not the exception** — the miss, not the throw. Cheap,
   a handful of lines in the shared failure seam. It is left unbuilt because this job's stages were
   closed and a new line in that seam wants its own red test rather than a rider on somebody else's;
   it is first among the things not done.

3. **A sentence a person could act on is constructed in `src/messages.ts` or nowhere.** Mostly true
   already, and stage 1 made it more so: `everyFactoryIsCovered` in
   [`tests/messages.test.ts`](../../tests/messages.test.ts) was promised in that file's header and had
   never existed, so a failure factory missing from the registry went through no invariant at all —
   it had a victim waiting, `placingFailed`. The guard now derives its list from the module's own
   exports, and a forgotten factory is a red compile. What is left over is the bare throw again, so
   this is a habit rather than a mechanism, which ranks it below 2: a habit is what failed here.

4. **Drive the real failure in a browser.** The entire suite was green over this bug, because every
   test that could have seen it was asserting the same seam the code was using. The only witness was
   a person looking at a card. This job's browser run, on a real dev server, found two further things
   no test did — a job stopped by its own deadline telling the reader *"You stopped this before it
   finished"*, and a privacy line claiming an article's text had gone to a model provider about a
   document refused locally before any paid call. Highest findings per hour of anything here, and
   fourth only because it finds what you go and look at.

## What this cost, and what it did not

No money. The cap fires off `doc.numPages` before any `getPage`, so the refusal was free every time
it happened. What it cost is a reader with a paid slot, a 142-page paper the app is precisely for,
a card offering no button, and no way to find out why. Seven and a half hours between the commit and
the event, and however many refusals of the other seven kinds went unexplained after it — that
number is unknown and unknowable from here, since the whole symptom is a sentence nobody kept.

## The same incident, reported twice — noted 2026-09-04

Greg pressed **Feedback** eighty-six seconds after the throw, and that report was triaged separately
before anyone joined the two up. Both are this one event:

| | when | what it is |
|---|---|---|
| `SPIDERYARN-READING2-T` | 2026-09-03T15:56:06Z | the throw: job `spya-xxd8fq`, `step: extract`, `message_withheld: True`, exception `Error: Error` |
| `SPIDERYARN-READING2-V` | 2026-09-03T15:57:32Z | *"couldn't upload PDF"* — the reader's account of the same minute, from `/add/upload/4f2dc343-…` |

Same user, same release (`edfa8fbfa510`), and the release is the point: it was built at 12:15 that
day and **contains none of the fix**. Stage 1 landed at 19:40 (`92ff0e83`) and the cap moved to 250
the next morning (`92cf9383`); production carried both by 14:22 on 2026-09-04. So V needs no fix of
its own — his 142-page paper is now inside the cap, and a document that is not gets a sentence
naming both numbers.

**What V did add, and it is not in the list above.** He wrote *upload*, not *extract*. The refusal
he could have acted on was a page cap he had no way of knowing existed: a file manager shows you a
size and never a page count, so the cap was discoverable only by uploading a book and being turned
away at the end of it. The add box now says *PDF, up to 50 MB and 250 pages* before a file is
chosen — `uploadLimits()` in [`src/uploads.ts`](../../src/uploads.ts), built from the two constants
that enforce it, guarded by
[`tests/upload-caps-are-stated-before-the-file-is-chosen.test.tsx`](../../tests/upload-caps-are-stated-before-the-file-is-chosen.test.tsx).
`MAX_PAGES` moved out of [`src/pdf-read.ts`](../../src/pdf-read.ts) to make that sayable at all: that
module pulls in pdf.js and p-queue, and the browser cannot import it — which is also why
`UPLOAD_TOO_MANY_PAGES` in [`src/messages.ts`](../../src/messages.ts) had been written without its
own limit in it, and now has one.

**And the report's own shape was the argument for a change nobody had asked for.** *"Couldn't upload
PDF"* fitted seven branches across four files — the picker's three, the page cap, the quota wall, a
dead transfer, extraction failing later — and telling them apart took the Sentry event, not the
sentence. The picker's three refusals had deliberately carried no bracketed code, on the reasoning
that they involve no provider and no request so there is nothing to look up; that tested the wrong
thing, and they are `[pick-pdf]`, `[pick-empty]` and `[pick-big]` now, with the family and the
`pick-`/`up-` distinction written into [copy.md](../project/copy.md#the-bracketed-code). ⟨GPT Sol
argued for this; the glossary reversed the same rule the same day for the same reason,
[260904c](260904c-the-glossary-said-the-term-was-not-there.md).⟩

**A fifth thing that would have caught the class**, weaker than the four above and cheap: *a limit
the reader cannot measure for themselves must be stated before they spend anything on it.* Size is
visible in a file manager; page count, token cost and rate limits are not. The class is **a
precondition discoverable only by violating it**, and the four ranked recommendations are all about
the sentence at the moment of refusal rather than about the sentence before the attempt.

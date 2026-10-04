# Sweep cluster 5: a failed read can be retried, says a reader's sentence, and does not re-arm Regenerate early

Cluster 5 of the fifth codebase sweep
([umbrella](261003f-fifth-codebase-sweep-umbrella.md) § The clusters). Evidence:
[web-client W2 and W4](../investigations/261003b-fifth-sweep-web-client.md),
[cross-zone X9, X11, X13k](../investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md),
and Sol's "Illustrated has the same failed-read recovery gap"
([review](../investigations/261003b-fifth-sweep-review-sol-on-server-and-web.md)).

## What a reader gets

Today, when the first read of a mode's artefact fails (a dropped connection, a server blip):

1. **Ideas, Timeline, Quotes, Debate, Glossary, Citations, Quiz and Illustrated show a sentence and
   no button.** The only way out is to leave the mode and come back. FAQ, Simple, Skim and Thread
   already have a *Try again* (`retryRead`, from `418a3d57f`).
2. **The sentence is the browser's own words.** Fourteen hooks do
   `setError((err as Error).message)`, so Safari's "Load failed" or a JavaScript bug's text reaches
   the reader, unreported. `describeFetchFailure` (`src/web/lib/describe-failure.ts`) is the one
   rule for this and these hooks skip it.
3. **Regenerate can be pressed twice for one result.** After a rewrite job finishes, the panel reads
   the new artefact. Until that read lands (or if it fails) Summary, Ideas, Glossary, Thread and
   Sketch show the old artefact with Regenerate enabled. Pressing it is a second paid run. Quiz
   alone holds the button (`rewriting`, `b5b21cb56`, and
   [postmortem 261002f](../postmortems/261002f-a-band-local-hold-cannot-protect-a-job-that-outlives-the-band.md)).
4. **Referee's source-scan notice can say "Checking document" for ever** — `useSourceScan` has no
   deadline on its read.

After: every one of those bands has *Try again*; the sentence is one written for a reader; the five
panels hold Regenerate the way Quiz does; the scan gives up after a deadline and says so.

## Re-checked against today's tree (2026-10-04, `ab8289e2a`)

- `grep -rn 'setError((err as Error).message)' src/web` → the same 14 hooks: Illustrated, Debate,
  Sketch, Arc, Quotes, Simple, Skim, Quiz, Citations, Timeline, Glossary, Faq, Tweets, Ideas.
- `git grep -ln retryRead -- src/web` → still only Faq, Simple, Skim, Tweets (hook and panel each).
- Bare error paragraphs, by content: `IdeasPanel` 245, `TimelinePanel` 433, `QuotesPanel` 983,
  `DebatePanel` 1076, `GlossaryPanel` 443, `CitationsPanel` 985, `QuizPanel` 965,
  `IllustratedView` 891 (`Empty`'s error arm). `SketchView` 222 words its own error inside its
  empty state — to be read in stage 1 and given the retry if it has none.
- `busy:` — Quiz alone has `|| owner.rewriting`; `SummaryMode.tsx:152`, `IdeasPanel:207`,
  `GlossaryPanel:307`, `Tweets.tsx:149`, `SketchView:287` do not.
- `useQuiz.ts § readMark` and `useMirror.ts § readRun` are still hand-written copies of
  `readAnswerStream`. Only Quiz is in this cluster; Mirror is held by the umbrella.
- Summary changed on 10-03/04 (Tweets is now Summary's Thread, 261003l; Fuller, 261004b). The hooks
  are still `useSimple` and `useTweets`, and the panels still `SimplePanel` / `Tweets.tsx` under
  `modes/summary/`.

## Stages

Two stages, each committable and green on its own.

### Stage 1 — the read: a sentence for a reader, and a way to ask again

**1a. `describeFetchFailure` in the 14 hooks (X9).** Replace each
`setError((err as Error).message)` in a read's `catch`. Consequences to handle, not skip:

- `tests/describe-fetch-failure.test.ts` refuses a bare `throw new Error(` in any file that calls
  `describeFetchFailure`, because such a throw would reach the reader as `PAGE_FAULT`. So each of
  the 14 files gets its throws read: one written for a reader becomes `ReaderFacingError`; one that
  is a programming fault stays bare and is exempted the way that test already allows, or is left to
  become `PAGE_FAULT`, which is the correct outcome.
- Only the read's catch is in scope. The other `(err as Error).message` sites in these files
  (stream catches in `useGlossary` 587/660/1014, `useCitations` 526, `useQuiz` 593) are **not**
  changed unless the test above forces it, and if it does, each is routed correctly rather than
  silenced. `readAnswerStream` throws the server's `error` frame as a bare `Error`; if a file's
  stream catch must go through `describeFetchFailure`, that throw becomes `ReaderFacingError`
  (the server's frame is a reader channel — copy.md § The same seam in the browser).
- `useTweets` already words a failed re-check itself (`THREAD_RECHECK_FAILED`); kept.

**1b. `retryRead` in the hooks that lack it (W2 + Illustrated).** Ideas, Timeline, Quotes, Debate,
Glossary, Citations, Quiz, Illustrated — and Sketch and Arc if reading them shows a reader-visible
error with no way to ask again. **Sketch and Illustrated keep a loaded picture through a failed
revalidation but draw the error only in their empty branch (F4): both draw `ReadError` beside the
kept picture too**, tested (the picture stays, one GET, no POST, recovery). It is `useFaq`'s: clear the error, return to `loading` only when
nothing is loaded, `reload()`. Read-only: it never starts a job. Where a hook is split into a read
half and a band half, `retryRead` lives on the read half and the band half passes it through.

**1c. One `src/web/ReadError.tsx`** — `ReadError({ error, onRetry })`, markup only: the sentence
with `role="alert"` and a *Try again* button. FAQ's markup moves into it; FAQ, Simple, Skim, Thread
and the eight above use it. No state, no parsing, no policy. The button label stays *Try again*
(already on four panels; copy.md rule 3).

**1d. The mode-matrix test** (`tests/read-error-matrix.test.tsx`). One table, a row per panel. Each
row mounts the real panel over a failing opening GET and asserts:

- a button named *Try again* is drawn;
- the sentence shown for a bare `TypeError("Load failed")` thrown by `fetch` is the reader's
  "couldn't reach" sentence and never contains `Load failed` in a built page's form;
- the sentence for an unbranded programming fault is `PAGE_FAULT`, not the fault's own text;
- pressing *Try again* makes exactly one more GET, **no** POST to `/api/jobs`, and on success shows
  the artefact.

**And it finds the mode a fix missed (F7):** a second, static half lists every file under `src/web`
that calls `useOrderedRead`, and fails unless each is either a row in the table or in an explicit
exclusion list with its reason (Arc: its error is never drawn; Claims and Relations: not a mode
panel's artefact read — each confirmed in the build). Proved able to fail by removing a row. The
sentence checks (14 hooks) and the recovery checks (the panels) are separate columns, because Arc
is in the first and not the second. That is the lever the
umbrella asks for: the pattern "the fix landed only in the mode being built" was found three times.

Red first: the eight panels' rows are red before 1b; the 14 sentence rows are red before 1a.

**Simpler option passed over:** adding the button inline to each of eight panels with no shared
component. Rejected because twelve copies of five lines of markup is how FAQ's fix came to reach
four; `ReadError` is markup only, which is the limit Sol set when rejecting `useArtefactRead`.

**Not built:** a generic `useArtefactRead` or hook factory (rejected by three sweeps and again by
the umbrella).

### Stage 2 — Regenerate's hold, the scan's deadline, Quiz's stream reader

**2a. The hold in five panels (X11) — revised after Sol's plan review (F2, F3, F5, F6).**
Summary (`useSimple` / `SummaryMode`), Ideas, Glossary, Thread (`useTweets` / `Tweets.tsx`) and
Sketch. Quiz's rule, with two holes in Quiz's own version closed first.

*The rule.* Pressing a forced verb records **the identity of the artefact it was pressed on**.
While that identity is still the one on screen the panel is `rewriting`, and **every forced paid
control** honours it — the badge's Regenerate, and also Simple's *Write it again*, Ideas' *Find
them again*, Thread's stale-banner control, Glossary's *Find more* / *Find terms again*, on stale
and unprofiled artefacts too (F5). It is released by exactly three things:

1. a **fresh** read shows a different identity (the replacement arrived);
2. the job is known to have failed or been cancelled (`queue.failed`);
3. the job list is loaded and idle, and a **fresh** read **that started after the band saw it go
   idle** has landed (the rewrite ended without replacing it).

*Fresh* means two things Quiz's version does not check today:

- **Provenance (F2).** A GET that was already in the air when the job finished can land after the
  queue goes idle, carrying the old artefact; Quiz counts it (`okReads`) and releases. So a read
  carries the number it *started* with, and rule 3 counts only reads whose start number is above
  the mark taken when idle was first seen. The band then calls `refresh()` once at that moment, so
  a read that qualifies is guaranteed to exist (otherwise a hold with nothing in flight would
  never release).
- **Not a cached copy (F3).** `apiFetch` answers a failed GET from the offline store with a real
  200 marked `x-spideryarn-offline: copy`. A copy is not the server's word, so it neither releases
  the hold (rules 1 and 3) nor counts as a start-numbered fresh read.

*Where the hold lives (F3, F6).* Not in any band and not in any one read instance: Ideas' band
makes its own reader, Marginalia a second, and Simple, Thread and Sketch are wholly the band's, so
closing the band during the job and reopening it would lose a band-local hold and the cached copy
would put the old artefact back with Regenerate enabled. So the hold is **one small module-level
store**, keyed by `(slug, step)`, holding the identity — `src/web/rewrite-hold.ts`, read with
`useSyncExternalStore`, cleared with the job engine's own teardown (sign-out). One hook over it,
`useRewriteHold`, owns the three release rules; each mode hook passes its identity, its queue and
its fresh-read facts, and keeps its own state, verbs and copy. **Quiz moves onto it** (its `held`
state on `QuizRead` goes), so there is one rule, not Quiz's and a corrected copy. A full page
reload forgets the hold. That is an accepted limit, said in the module header as what it is: a
reader who reloads the page during a rewrite can be offered a second one (F11).

*The hold knows whether its POST has landed (F9).* `starting` is mount-local in `useStepJob`, so a
band closed and reopened while the forced POST is still in the air sees an idle job list, and rule
3 would release on the unchanged artefact before the job exists. So the stored hold carries
`posted: boolean`, set by the verb that made it when `queue.start` settles (the promise outlives
the band; a refused POST releases the hold there). **Rule 3 applies only to a posted hold.**

*A held panel with nothing running always offers a read (F10).* A cached copy clears `error`, so a
band held on one would show no *Try again* and nothing re-reads on reconnect. So whenever a panel
is `rewriting` with no job and none starting, it draws a quiet line and the read-only retry —
Quiz's existing "waiting for the new questions" line (`QuizPanel.tsx`, the `rewriting && !job`
arm) is the model, with `ReadError`'s button. That is the way out of every stuck hold, whatever
stuck it.

*Identity.* `batchId` for Quiz; `generatedAt` for Simple, Ideas, Glossary and Thread (Glossary's
is re-stamped by an append — that is still "the job wrote", which is all release rule 1 claims; it
is not read as proof of a rewrite). `Sketch` has no `generatedAt` (F6): the builder reads what
`GET /api/sketch` returns and uses the artefact's own clock or content fingerprint if it has one;
if it has none, the identity is a client fingerprint of the stored `sketch` value alone — never the
response's `stale` / `outdated` / `profileChanged`, which change without a job (F12) — and the plan
log says which.

*Sketch and Illustrated draw `ReadError` beside a kept picture (F4)* — that part is built in
stage 1, because without it a held Sketch whose reload failed has no visible way out.

Tests. First Quiz, red: (a) the F2 interleaving — a GET in flight, the job finishes, the old GET
lands with the old batch, the trailing GET is pending → still held; (b) a cached copy of the old
batch lands at idle → still held. Then one table, a row per mode (six): press the forced verb,
finish the job, fail the reload → every forced control is disabled and exactly one forced POST was
made; a fresh read of a new artefact re-enables; a failed job re-enables; unmount the band during
the job and remount with the reload answered by a cached copy (real `apiFetch`, seeded cache) →
still held, **and the read-only retry is drawn; pressing it once the server answers recovers**
(F10). And the F9 sequence: press, POST pending, remount, an unchanged read lands → still held; the
POST lands, the job finishes, the reload fails → still held.

**Simpler option passed over:** disable the forced verbs whenever `error !== null`. It covers the
failed reload but not the delayed one, nor the cached copy (no error at all), and it would also
disable them after any unrelated failed revalidation.

**2b. `useSourceScan` gets a deadline (X13k).** The read goes through the existing finite-read
shape (`src/web/lib/opening-read.ts § openingRead`: race, then abort, `ReaderFacingError` at the
deadline). The scan takes about nine seconds on a 1.3 MB paper, so the list deadline of 15 s is too
short: `openingRead` gains an optional deadline and message, and the scan passes its own (60 s, and
a sentence saying the check did not finish and reloading asks again — written per copy.md, with a
bracketed code in `src/messages.ts`). The hook's header comment ("no retry … reloading the page is
the whole repair") stays true. Test: fake timers, a fetch that never settles → `failed` with the
sentence at the deadline, and the request aborted; red first.

**2c. `useQuiz § readMark` moves onto `readAnswerStream` (W4, Quiz only) — revised (F8).**
`readAnswerStream` hard-codes its own two sentences (the unnamed `error` frame, and the body
ending), and Quiz has its own. So: first pin Quiz's **exact** sentences in
`tests/quiz-mark-stream.test.tsx` (its EOF test asserts only a truthy error today) and the partial
text on each stop; then give `readAnswerStream` an optional `sentences: { stopped, ended }`,
defaults unchanged, and have its `error`-frame throw be a `ReaderFacingError` (the server's frame
is a reader channel). Quiz keeps the partial by holding the last `delta` text itself. Add the
`data: null` error-frame row (a TypeError today). **If the migration needs more than that one
optional parameter, stop: add the null guard to `readMark` instead and say so in the log** — W4 is
T2 and not worth new machinery. Mirror's copy stays (held by the umbrella).

## What done looks like

- Both greps in § Re-checked return nothing for the read catches / every listed panel has the
  button; the matrix test is green and was red per row.
- `npm test`, `npm run typecheck`, lint on touched files.
- A Sonnet browser check at desktop, iPad and phone widths: a failed first read in three of the
  panels shows the sentence and *Try again*, the button fits the band at each width, and pressing
  it recovers.
- GPT Sol: this plan (read-only), then each stage's code (write-capable).
- `docs/project/` updated where it names the behaviour: `useAutoRun.ts`'s header ("Ideas, Quotes and
  Timeline draw no button at all in their error state") is now false and is corrected; `copy.md §
  The same seam in the browser` lists who uses `describeFetchFailure`; `mode.md`'s checklist gains
  the matrix test as the place a new mode registers.

## Out of scope

Mirror's stream reader; the other `(err as Error).message` sites outside these 14 read catches
(Metadata, AccessSharing, upload, export …) — a different cluster's files; a generic read hook.

## Sol's plan review, round one (REFUSE) — what was done with each finding

[The review](261004c-sweep-cluster-5-plan-review-sol.md).

- **F1 (P1, retry can start a paid job)** — see § F1 below.
- **F2 (P1)** accepted: provenance by start number, in 2a; Quiz fixed first, red.
- **F3 (P1)** accepted: module-level hold; a cached copy never releases.
- **F4 (P1)** accepted: `ReadError` beside a kept Sketch / Illustrated picture, in stage 1.
- **F5 (P2)** accepted: every forced paid control honours the hold.
- **F6 (P2)** accepted: the hold is not on any read instance; Sketch's identity is settled in the build.
- **F7 (P2)** accepted: discovered membership plus named exclusions.
- **F8 (P2)** accepted: exact sentences pinned first; one optional parameter, or the null guard alone.

### F1 — Sol's facts upheld, its remedy overruled (Opus arbitrated, 2026-10-04)

Sol: after the opening GET and `useAutoRun`'s one automatic re-read both fail, the reader's bar
press is still in hand; *Try again* answering 404 sets `none`, and the press (or Thread's arrival
rule) calls `ensure()`. True, traced by Opus. Sol's remedy was that a manual retry should suppress
that permission. **Overruled**, because honouring the press is the written design
(`useAutoRun.ts § A failed read is not an answer`: *"If the second read comes back empty the press
is still in hand and the run starts, which is what pressing a mode means"*, Greg's rule of
2026-08-31), pressing the bar button again in the same state would run anyway, the run is unforced
and capped at one per `(slug, target)` per session, and FAQ, Simple, Skim and Thread behave this
way today. What Sol is right about is that the stated invariant was false. So, in stage 1:

- the invariant is **"`retryRead` itself sends only a GET; a press still in hand is honoured exactly
  as it would have been had the first read answered"** — `useFaq.ts`'s two comments saying it
  "never starts a model job" are reworded, and `useAutoRun.ts`'s header names the manual retry as a
  third route to the answer;
- the matrix test pins both cases, for an armed ordinary mode and for Thread: armed press, retry
  to 404 → exactly one **unforced** POST; a pasted-link arrival, retry to 404 → none (Thread: one,
  by arrival).

## Sol's plan review, round two (REFUSE) — settled here; discovery on the plan is closed

[The review](261004c-sweep-cluster-5-plan-review-2-sol.md). Sol withdrew F1's P1 and agreed the
overrule. F2, F4, F5, F7, F8 closed. Four new findings, all accepted and written into 2a above:
**F9** (P1, a remount during the POST) → the hold carries `posted`; **F10** (P1, held on a cached
copy with no way out) → a held, idle panel always draws the read-only retry; **F11** (P2) → the
reload limit is described as a possible second run; **F12** (P2) → Sketch's fingerprint is the
stored value only. Per engineering-manager.md these two P1 fixes were not in a reviewed snapshot,
so stage 2's code review is asked to check F9 and F10 specifically.

## Log

- 2026-10-04 — plan written against `ab8289e2a`.
- 2026-10-04 — stage 2a, 2c and F17 built (not yet reviewed). What differs from § 2a as written:
  - **The hold carries the job's id, not `posted: boolean`.** The boolean is set when the POST
    answers, but the engine learns of the new job only on its next poll, so for one round trip the
    list is still idle and the rule-3 read races that poll — F9's own sequence, half the time.
    Rule 3 now needs the posted job *listed as over* (`StepJob.ended`, and `StepJob.start` returns
    the id). Shown by a mutant: with the boolean, `tests/rewrite-hold.test.tsx` § F9 fails at
    "the POST answered and the list has not shown the job". Cost: a finished job trimmed from the
    list before any band saw it over leaves the hold until a new artefact or a reload.
  - **Consequence for an existing test:** `quiz-regenerate-revalidation` § "lets go when the
    rewrite failed while the band was closed" posed that as an empty job list; it now lists the
    failed job, as the server does. The assertion is unchanged.
  - **Rule 3's mark is taken in render, not in an effect**, or the post-job read `useStepJob` has
    already started would be discounted and every rewrite would cost a second GET.
  - **Rule 2 ignores `queue.failed` while `starting`**: a previous press's refusal is still on
    `failed` during the next press's POST, and released the new hold at once (in Quiz's original
    too).
  - **Sketch's identity** is the client fingerprint: `JSON.stringify` of the stored `sketch` value
    as sent. `Sketch` has no clock and no content fingerprint of its own (`sourceHash` is the
    article's).
  - **Sketch's badge never drew.** `readSketch` does not carry `profileHash`, so `profiled` was
    always false and the redraw in the badge's panel was unreachable; `useSketch` now reads it off
    the stored value. Found because the Sketch row could not find a Regenerate to press.
  - **2c took the one-parameter route.** One behaviour beyond the pinned ones: a stall or a body
    that dies mid-read now keeps the partial reply, as the other stops always did.
  - Not covered: a job-level *Retry* after a failed forced run makes a new job with no hold.

- 2026-10-04 — stage 2 reviewer fixes, not committed:
  - **F18 (P1)** — two forced clicks before React's next commit sent two POSTs. The shared verb now
    fences synchronously; the six-mode click cases failed first.
  - **F19 (P1)** — an older online observation released a press on a newer offline artefact, and a
    different offline identity bypassed `rewriting`. Replacement evidence is now fenced to the
    press with a read-start clock that survives remounts; offline identity changes remain held.
    Two retained-reader cases and six offline-identity cases failed first.
  - **F20 (P1)** — another job's failure released this press, while this press's own failure or
    cancellation needed an online read after remount. `ended(id)` now returns the exact terminal
    status. Unrelated failure controls are suppressed while held, preserving the read-only escape.
    Six unrelated-job cases and twelve own-terminal offline cases failed first.
  - **F21 (P2)** — a rejected start callback left an unposted hold. The rejection now drops its own
    hold and propagates. One boundary test failed first; ordinary queue transport failures already
    resolve to null.
  - **F22 (P2)** — Quiz's new partial-preservation behaviour on a stall or broken body was unpinned.
    Both stops are now tested for partial text, failed status and no answer tick; discarding the
    partial made both tests fail. No marking behaviour was changed by the review.
  - **F23 (P3)** — the Thread postmortem still described its retained regression and implemented fix
    as temporary / future work. Corrected its evidence and countermeasures.
  - Root cause and the countermeasures:
    [a hold outliving its panel needs evidence owned by the same action](../postmortems/261004g-a-hold-outliving-its-panel-needs-evidence-owned-by-the-same-action.md).

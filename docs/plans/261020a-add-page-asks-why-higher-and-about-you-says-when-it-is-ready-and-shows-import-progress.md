# 261020a — The add page asks why higher up, offers About you, says when it is ready, and shows how far the import has got

Two of Greg's suggestions from the Feedback dialog, batched because both are about the add page.
Overseer queue item `qi-hrh4vwex`. Reports `spya-kan788` (SPIDERYARN-READING2-KJ, with addendum
`spya-jk0cgg`) and `spya-skq3fg` (KK).

## What Greg asked for

`spya-kan788`, Greg, 2026-10-19:

> When adding a new article, put the "Why are you reading this?" box nearer the top of the add page.
>
> And if they haven't filled out a user profile yet at all, perhaps also add a box for that too, so
> they can potentially fill out both. Make it clear which is which and how they're different.
>
> And when the import process has finished, make that crystal clear, e.g. a button appearing at both
> bottom and top.

Addendum `spya-jk0cgg`, 2026-10-19:

> And make the "Why are you reading this?" box bigger/auto-expanding.

`spya-skq3fg`, Greg, 2026-10-19:

> When loading a big/slow article, can we provide a loading bar with some kind of estimation of how
> long it will take (especially that extraction step)?

## Prior work, and what is there now

- [261001s](261001s-imports-detail-on-home-and-why-reading-saved-state-and-first-open-prompt.md)
  made the purpose box say whether it saved, and the reading view ask once when it was never
  touched. [261004l] made it autosave. Nothing has moved it or touched the profile on this page.
- **The add page, top to bottom** (`AddPage` in `src/web/AddPage.tsx`): heading and source; the
  upload bar while a file is going up; the disclosure sentence; refusals; the job card (`JobCard`,
  `src/web/AddArticle.tsx`), with one row per step, a running clock on the running step and, for
  `sketch` alone, a measured *usually*; *keep a tab open*; the automatic-modes tick box;
  High-powered AI; the author gift (admins); sharing; **and only then** *Why are you reading
  this?*, a two-row textarea; then, once the import is in and the reader is engaged with the box,
  *Ready.* and **Open the article**; then *Back to the shelf*. On a phone the purpose box is two or
  three screens down.
- **When the import finishes and the box was never touched, the page opens the article by
  itself.** It waits (phase `ready`) only when the box is focused, holds unsaved words, or a sharing
  or author-gift question is open. So "make it crystal clear when it has finished" is about that
  waiting state: today it is one line and one small button at the very bottom.
- **About you** (`reader_profiles.profile`) is edited on `/profile`, in the profile popover, and
  offered by the guide in chat on first open. The server resolves it for the first automatic modes
  **at publication**, as it does the purpose (plan 261004h), so words saved during the import reach
  them.
- **Progress: the docs forbid a determinate bar, on purpose.**
  [ingest-queue.md § The app says out loud that it needs a tab open](../project/ingest-queue.md#the-app-says-out-loud-that-it-needs-a-tab-open):
  *"No determinate progress bar, ever … response size and provider latency are both unknown, so a
  percentage would be a number we invented."* `StepRow`'s comment says the same. `src/job-state.ts`
  gives a *usually* sentence only to a step with enough measured runs (one: `sketch`). PDF
  `extract` reports `N/M chunks` through `ctx.report`, but `report` does not write the row by
  itself, and PDF extract and assets make no other write while running, so the reader never sees
  their counts. (A step that also calls `ctx.preview`, `simple`, carries its latest detail along
  with each preview write.)

## Part A — the boxes and the finish (build)

### A1. The boxes move to the top

`PurposeBox` moves from the bottom of the page to directly under the header and the upload bar,
above the disclosure sentence and the job card. Same condition for showing (`showPurpose`), same
session, same autosave. Nothing else moves.

**Not above the upload bar**: that is what a reader who just pressed Add on a 40 MB file came to
watch, and it carries the Stop. One bar's height is not "far down".

### A2. Bigger, and as tall as its words

Floor of four rows (from two), grows with what is typed, never scrolls inside itself:
`useFitTextarea` (`src/web/useFitTextarea.ts`, already used by Quiz and Feedback's reply box) and
`overflow: hidden; resize: none` on this box only.

### A3. About you, when the reader has none

Under the purpose box, **only when the reader's stored profile is empty** — decided once, from the
first successful read of `GET /api/reader`, and latched for the life of the page so the box does not
vanish under the reader's hands as their first words save. A failed read shows nothing (we cannot
tell they have none).

- Bound to `useProfile()` (`src/web/useProfile.ts`), the hook `/profile` uses: ordered writes,
  the `keepalive` write on unmount and `pagehide`. A plain textarea like `PurposeBox`, **not
  `ProfileBox`**, for `PurposeBox`'s reason: no microphone on a page that may open the article by
  itself — but with `ProfileBox`'s other pieces, which live in the component and not the hook:
  `useIdleCommit` (save after a pause), save on blur, `SaveStatus`, the counter, the leave warning,
  and **no `maxLength`**, which would silently cut the end off a long paste (Sol, finding 3).
- **Which is which**, said in the labels and one hint line each:
  - *Why are you reading this one?* — "For this article only." (existing hint, shortened)
  - *About you* — "For every article: your background, what you already know, what you are working
    on. Saved to your profile; edit it any time on Profile."
  The two boxes sit in one bordered group headed by nothing more, so the difference is in the
  labels rather than in a paragraph above them.
- **It holds the page as the purpose box does, and only if it was drawn.** The completion effect
  leaves by itself only when nothing is focused or unsaved; it now also asks the About-you box
  (focused, or `dirty`/`saving`/`error`/in flight) — **only when the box was shown**. A failed read
  is `error` too, and holding on it would wait for ever behind a box nobody saw; a completion before
  the read has answered opens, since there was no box to be in (Sol, finding 2). The decision is
  taken once per completion, so a later save cannot turn a waiting page back into one that leaves.
- **Open the article waits for both saves** (Sol, finding 5); a refused About-you save lets go of
  the press, stays on screen with its words, and offers *Open without saving*, which abandons both
  drafts. The unmount write is the net for a reader who leaves some other way.
- No key of its own: `App` already remounts the page per reader (`key={user.id}`), and the hook's
  writes are bound to the reader it was made for.

### A4. Ready, at the top and the bottom

When the page is waiting (`ready`, and `repeat`), the same block — a sentence and **Open the
article** (with *Open without saving* when it applies) — is drawn **twice**: once at the top, under
the header and above the boxes, in a highlighted panel that says *Your article is ready*; and once
where it is now, at the bottom. One component, `ReadyBar`, two placements, the same handlers, so
the two cannot disagree. The top one is the "crystal clear" half.

## Part B — how far the import has got

### The measurement

Read-only, against production, 2026-10-20, by the method in
[ingest-queue.md § What the card says](../project/ingest-queue.md#what-the-card-says-and-why-it-says-the-time)
(done steps only, `finishedAt − startedAt`; whole import `created_at → finished_at`). The `jobs`
table only goes back to 2026-09-28 and holds **11 imports** (8 done, 3 failed), none resumed across
a lease window.

| | n | seconds |
|---|---|---|
| fetch | 9 | median 1.3, max 3.5 |
| extract, URL | 6 | 3.1, 3.9, 4.8, 12.7, 62.2, 122.4 |
| extract, upload (PDF) | 2 | 91, 216 (an 8 MB third failed at 204) |
| blocks | 8 | median 1.9, max 4.9 |
| structure | 8 | mostly < 1; 12 and 74 when the model call runs |
| whole import, URL | 6 | median ≈ 19, range 7–232 |
| whole import, upload | 2 | 112, 267 |

**URL extraction is bimodal and unrelated to length** (a 4.6k-word page took 122 s, a 13.7k-word
one 62 s, an 11.9k-word one 13 s): the slow ones look like a fallback extractor, which is not known
in advance. Upload extraction probably rises with size, on two points. The spread is 40× between
median and max. **A "time left" figure from this would be wrong by minutes, or by a factor of
thirty, either way** — the number we invented that the docs warn about.

Two more facts: `runStep` resets `startedAt` on every lease window, so a resumed step's duration
is its last window only; and PDF `extract` already counts its chunks (`23/69 chunks, pages 40–41`
through `ctx.report`), but `report` does not write the row and that step makes no other write while
running. The poll reads Postgres (`listJobs` → `store.list`), so the count never reaches the
reader, in production or in dev. The best progress signal we have is being thrown away.

### B1. A real fraction, saved and drawn (build)

- **`JobStep.progress?: { done, total, unit }`**, a counted fraction, set through a second,
  optional argument: `ctx.report(detail, { done, total, unit })`. Only callers that are counting
  real units pass it: PDF `extract` (`unit: "chunk"`) and `assets` (`"image"`). In the job's
  `steps` JSON, so no column.
- **Only a counted report saves, at most once every five seconds** (`REPORT_SAVE_EVERY_MS`). It
  goes through the preview's write chain — `stepPreviews` becomes `stepNotes` — so it is
  serialised, its failures are logged at debug and swallowed, and **`settle` waits for it before the
  step's own commit**: `noteProgress` replaces the whole `steps` array, so a late write would
  otherwise put a finished step back to `running` (Sol, finding 1; the same race the preview's
  `settle` was written for). A report without a count stays in memory, as before — saving every
  report would be a write-volume change across twenty modes nobody asked for (Sol, finding 7). Cost:
  about 44 writes for the slowest measured PDF extract, at most ~148 in a whole lease window.
- **Gone however the step ends**: `settle` deletes it on success and failure, `runStep` deletes it
  when a step starts (a requeued one), and `settledSteps` in `src/store/pg-jobs.ts` drops it, and a
  running step's `detail`, on all six store settlements — pause, requeue, expiry and the three Stops
  (Sol, finding 4). A done step's detail is its product's and is kept.
- **The card draws it**: under a running step that has `progress`, a thin `<progress value max>`
  (the upload bar's shape, `Sending` in AddPage.tsx) and *23 of 69 sections of the file done* or
  *8 of 12 images done*. "Done", not "read": both counts include a unit that failed (Sol, finding
  6). A step without counted progress keeps exactly what it has now.
- **No time-left figure, and no whole-import bar.** A whole-import bar would weight steps whose
  durations we have just shown we cannot predict; the doc's rule against an invented percentage
  stands, and is reworded to say what is now allowed: a fraction of units the step has counted.

### B2. A time-left estimate (deferred, its own queue entry)

When there are enough imports to measure — the bar `src/job-state.ts` sets is about a dozen
successful runs per step and kind — repeat the measurement above, and if upload `extract` turns out
to track bytes or pages, say *usually N–M minutes for a file this size* under that step. The URL
side needs the fallback extractor's path to be told apart first. Queued as its own entry; this plan
does not build it.

## The simpler options passed over

- **Moving only the purpose box, without an About-you box.** Greg asked for both.
- **A single button at the top only.** Greg asked for top and bottom; on a phone the reader may be
  at either end.
- **Parsing `N/M` out of the existing `detail` string** instead of a `progress` field. No new field,
  but a reworded sentence would silently stop drawing the bar — the stable-code-not-prose lesson in
  ingest-queue.md.
- **A rough time-left range now, from eleven imports.** Rejected above; B2.

## Stages

1. Part A, with tests (`tests/add-page-purpose.test.tsx` and a new file for the About-you box and
   the two Ready bars), and the browser check in a Sonnet subagent.
2. Part B1: the throttled save and `progress` (a test in the jobs suite that a reported count
   reaches the store, and one that it is gone after the step ends), the bar on `StepRow`, and the
   ingest-queue.md reword.
3. Part C, below: two more reports the Overseer folded in after stages 1–2 landed.

## Part C — a tick you cannot miss, and a microphone on both boxes

Two more of Greg's reports, 2026-10-19, handed to this work by the Overseer:

`spya-a40t70`:

> … move the Why are you reading this? nearer the top. And maybe we need two copies of the button to
> open the article at the top and at the bottom when it does eventually, when it is eventually ready
> to open. And it should be really visible somehow that something has changed and that it is now
> ready to open, that it has finished. So whether there was a loading spinner before that's gone, or
> a loading spinner that becomes a big green check mark or something, so it's really clear when
> things have finished importing.

`spya-wc4vku`:

> In the sort of page that shows after they add something while it's importing, make sure there's a
> dictation button next to the Why are you reading this? input box. And indeed, we really want a
> dictate button next to pretty much all of our input boxes that are going to have more than a few
> words of text typed into them. Let's make a minimal tweak to our docs and/or design system to make
> this more likely going forwards.

The first is stages 1–2 bar one thing:

### C1. A big green tick

The top `ReadyBar` leads with a large green `CircleCheck` (lucide, the icon set we use;
[icons.md](../project/icons.md)) beside *Your article is ready.* — the "big green check mark" — so
the change from a page of spinners is visible from across the room. The bottom bar stays plain.
The colour is `--positive` (styles/tokens.css), the contrast-tested go-ahead green in both themes,
through a class (`.add-ready-tick`, profile.css) since Tailwind has no `positive` key and a missing
key emits nothing. **Built.**

### C2. A microphone on both add-page boxes — not built here; handed back to the sweep

**Decided after the Part C plan review**
([261020a-part-c-plan-review-sol.md](261020a-part-c-plan-review-sol.md), *revise before build*):
this page is the hardest place in the app to put a microphone, and doing it safely is a job of its
own rather than a tail on this one. The four P1s are the spec for whoever takes it: the boxes
unmount on more transitions than completion (a public-copy or failure answer, and a source change),
and unmounting aborts a recording, so public-copy navigation must also wait; the Open guards need
separate per-box refs for same-tick checks *and* parent state to render the combined disabled state,
and must cover both bars, ⌘+Enter, *Open without saving* and the waiting effect (then disable both
microphones once Open is waiting); the
live guesses reach `onChange`, so About you's autosave and the purpose session's timer *and* its
seed-triggered commit must pause during a dictation; and the keeper key must be
`add:purpose:${wanted}` (not `source`, which is empty for every upload) and `add:about-you`. Plus
P2s: article context once a slug exists, and a lifecycle test stage. The P3 documentation work must
also update dictation.md's box count and keeper inventory, as well as taking Greg through the exact
controls.md rule wording before editing it. `spya-wc4vku` is left unresolved for the Overseer's
sweep, which offered to pick it up, together with C3 and the app-wide sweep. The text below is the
pre-review proposal retained for history, not the implementation spec; the corrections above
supersede it.

Both `PurposeBox` and `AboutYouBox` get the dictation button in their label row and the strip
under the box, through `useDictationField` exactly as `FeedbackSendBox` uses it
([dictation.md § Adding it to a box](../project/dictation.md#adding-it-to-a-box)): `readOnly` on
the box while the words come back, `context: { kind: "profile" }` (there may be no article yet;
the reader's own words prime the transcript), `keep` keyed on the box and the source, and a new
`DictationSurface`, `"add"`, so a failure says where it happened.

**The reason the add page never had one is the page leaving by itself**: a microphone running
when the import finishes would be unmounted and its words aborted
(the comment on `PurposeBox`). So **a box whose dictation is busy holds the page** at the finish,
as focus does: the box reports `busy` (armed or transcribing) upward through a ref the completion
effect reads, beside `focusedRef`. Pressing the microphone button moves the focus out of the
textarea, so focus alone does not cover it. And **Open the article is disabled while either box
is dictating** (the house rule: a guard and a disabled button, dictation.md), so a press cannot
unmount a live recording. No double press on Stop: these boxes do not send.

The transcript's words arrive through `onChange`, so the purpose session and the profile hook see
them exactly as typing; the commit at the end of a dictation is the box's existing commit (purpose:
`purpose.commit`; About you: `profile.commit`).

### C3. The rule, written down

One rule in [controls.md](../project/controls.md), beside *Controls that do the same job look the
same*: **a box that takes more than a few words of the reader's prose gets the microphone**, with a
pointer to dictation.md § Adding it to a box, and the reason (Greg's words above). Not a lint: a
mechanical check cannot tell a prose box from a search field.

### Deferred

**Sweeping the rest of the app's prose boxes** for a missing microphone is its own queue entry: the
list of boxes, each a small change but each with its own send/leave/unmount behaviour to check, is
a separate job from this page.

## Review

**Part C plan review, GPT Sol, 2026-10-20** —
[261020a-part-c-plan-review-sol.md](261020a-part-c-plan-review-sol.md). *Revise before build*:
eight findings. C1's colour (finding 8) taken and built; C2 and C3 handed back rather than built,
§ C2 says why.

**Plan review, GPT Sol (gpt-5.6-sol, high, read-only), 2026-10-20** —
[261020a-add-page-plan-review-sol.md](261020a-add-page-plan-review-sol.md). *Revise before build*,
nine findings, all accepted and folded into the sections above: (1) a late report write could undo
the step's commit — the write goes through the preview's chain and `settle` waits; tested with the
delayed-snapshot case; (2) the About-you hold needed a defined state machine — hold only a drawn box;
(3) the plain textarea lacked `ProfileBox`'s idle save, warning and paste safety — added, no
`maxLength`; (4) progress and running detail survived the store's six other exits — `settledSteps`;
(5) Open did not wait for the About-you save — it does; (6) "parts read" was false for counts that
include failures — unit-named "done"; (7) saving every report was a wider change than asked — only
counted ones; (8) the "never reaches the poll" claim was too absolute — narrowed here and in the
three comments that made it; (9) fetch n was 9, not 8.

Mutation checks, each watched red and restored: the About-you hold removed (the waits test);
the drawn-box condition removed (the failed-read test); Open not waiting for About you (the refusal
test); the report throttle removed (the burst test); `settledSteps` keeping progress and detail
(all six parity doors).

**Code review, GPT Sol (gpt-5.6-sol, high, workspace-write), 2026-10-20** —
[261020a-add-page-code-review-sol.md](261020a-add-page-code-review-sol.md). Four findings, each
fixed by the reviewer with a regression watched red: (1) a second Open after a refused About-you
save left before the retry answered — every unsaved state now waits; (2) *Open without saving* was
offered while the other box's PATCH was still on the wire — it waits for both requests to settle;
(3) an untouched repeat paste still had its action only at the bottom — both waiting phases share
the two `ReadyBar`s; (4) a failed progress write was logged as a failed preview. Its sandbox could
not reach Postgres; the four suites were run outside it afterwards: 385 passed, typecheck clean.

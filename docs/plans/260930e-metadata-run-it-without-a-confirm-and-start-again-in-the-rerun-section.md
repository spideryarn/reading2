# Metadata: *Run it* without a confirm, and *Start again* as the section's first row

Two suggestions from Greg (admin) on `/read/<slug>/metadata`, 2026-09-30, batched:

> In Metadata when I click "Run it" or "Run it again" for a mode, don't include the confirmation
> step. Just do it.
>
> — SPIDERYARN-READING2-64

> In Metadata, amalgamate the "Start the whole article again" into the run-it-again section above,
> e.g. as a button at the top, or something like that.
>
> — SPIDERYARN-READING2-65

Status: **built, on `dev`, not deployed** (filled in at the end).

## Background

The **Re-run AI processing** section (`RerunSection`, src/web/Metadata.tsx) has one row per mode,
each with a *Run it* / *Run it again* / *Find more terms* button. Since 2026-09-07 the first press
only opened an inline confirm (*"Another model call. The result changes only if the run
succeeds."*, with its own words for Glossary, Sketch, Trajectory and Debate) and the second press
started the job. A failed row's *Retry* went through the same confirm.

Underneath the rows, for readers with experimental features on, there is a separate subheading,
*Start the whole article again*, and a card holding `ResetArticle` — its own button, and a
three-part confirm (kept / lost / cost) before anything is sent.

## What the per-mode confirm guards, before removing it

The brief asked this first, because a confirm can be part of a defence.

- **No reader's slot.** A re-run is `POST /api/jobs { slug, steps, force }`; only a request carrying
  a `url` or `uploadId` reserves a slot, and the retry of a re-run is free
  ([billing.md § Which requests spend a slot](../project/billing.md)).
- **No reader's money, and nothing of theirs is lost.** A re-run writes a draft revision that
  replaces the live artefact only on success; glossary appends terms rather than replacing them.
- **Our money, and only against a slip of the finger.** Each press costs us one model call (two for
  Debate, about $0.20 for the Sketch). There is no per-reader cap — Greg declined one on
  2026-09-06 on the strength of OpenRouter's global monthly cap
  ([ai-gateway.md § What stops a reader spending our money](../project/ai-gateway.md)). The confirm
  does **not** stop anyone determined: a script calls the route directly, and a person just clicks
  twice.
- **It is not on [security-map.md](../project/security-map.md)** § Where the defences physically
  live, and nothing in `src/` server-side depends on it.

So it protects Greg's wallet from accidental single clicks, and Greg is the one asking for it to go.
It comes out **for every reader**, not only for admins.

**Passed over: keep the confirm for non-admin readers.** It would add an admin branch to the one
component where a mistake costs money, for a protection that only guards the account of the person
who asked to remove it. If an ordinary reader ever turns out to run these up, the real fix is the
per-reader limiter ai-gateway.md already names, not a second click.

**The reset keeps its confirm.** It is not a *Run it*: it removes every generated extra and can move
comments to "no longer in this version". That confirm says what the reader loses, which is the
reader's, so Greg's request does not reach it.

## What changes

### 1. One press runs it (64)

- `RerunRow`'s *Run it* / *Run it again* / *Find more terms* calls `start({ force: true })` directly.
  `force: [step]` by name, exactly as before — the payload does not change.
- *Retry* on a failed row goes straight through too (`failed.retry`), since it buys exactly what
  the run buys; asking there and not on the run would be an inconsistency with no reason behind it.
- Double-press: `JobProgress` swaps the button for a *Starting…* status the moment `starting` is
  set, and then for the job band, so a second click has no button to land on. The confirm's own
  `busy` state goes with the confirm. **Retry did not have this** (Sol, plan review F1): it was
  `void queue.retry(id)`, so its button stayed up until a poll found the new job. It now goes
  through the same latch as `start` in `useStepJob` — `starting` before the `await`, and the new
  job (the retry route answers with it; `useJobs.retry` now returns it) becomes the watched one.
  Every mode panel's Retry gets this, not only Metadata's.
- **What the confirm said that nothing else says.** The draft-then-publish promise is already in
  the section's one-line intro. The rest moves to a short, faint note **under** the row's name (on
  its own line, so a phone does not push only those rows' buttons onto a line of their own —
  browser check), which is also the button's `aria-describedby` (Sol F4):
  - Sketch: *about $0.20, about two minutes*, from `SKETCH_PRICE` / `SKETCH_WAIT`.
  - Debate: *Up to two calls: $0.20–0.40 on a short article, more on a long one* (Sol F3 — pass B
    is conditional, and the range is for a short article).
  - Trajectory: *Needs Quotes first; without them it stops before any model call* (Sol F3).
- **Glossary** (Sol F2, then its code review). Forcing it appends when `existingFor`
  (src/glossary.ts) accepts the old list — same source, prompt version and reader profile — and
  rewrites it otherwise. The first build keyed *Find more terms* on `done`; the code review showed
  `done` tracks the model and not the profile, so that guessed wrong both ways. Built instead: the
  glossary gets the plain *Run it* / *Run it again* like every mode, and a note — *Adds more terms
  to an up-to-date list; otherwise writes a new one* — covering every branch of `existingFor`
  (no prior list, and a changed source, prompt version or profile; the second code review listed
  them) rather than predicting one. The review's wording named all four and was too long to read
  as a faint note; *up-to-date* carries them. The old confirm
  and label promised the append every time, so this is a pre-existing gap the removal surfaced, not
  one it opened.
- **Double press on Run** (code review, by extension of its Retry finding). Two click events can
  reach the handler before React commits `starting`. A ref latch in `RerunRow` holds for the POST's
  round trip. Not in `useStepJob.start`: other panels call it twice on purpose, and two suites went
  red when it was there. Retry's latch is in `useStepJob`, where Sol put it.

### 2. *Start again* is the section's first row (65)

- The separate *Start the whole article again* heading and its own card go. The reset becomes the
  **first row inside the same card** as the modes, above them, shaped like them: an icon, **Whole
  article**, and the *Start again* button on the right. The description and the *Also make these
  again* checkbox sit below it in that row, and the confirm opens in that row as before.
- Still behind the experimental switch, as today. With it off the section is exactly the mode rows.
- The section intro changes from *"Ask for any of these to be written again…"* to cover both halves
  honestly: a mode row costs nothing and keeps what is there until the run succeeds; the first row
  starts the whole article again and says in its confirm what it keeps and what it loses.

```
Re-run AI processing ▾
  One line of intro
  ┌──────────────────────────────────────────────────────┐
  │ ↺  Whole article                       [↺ Start again] │  ← experimental only
  │    Reads our stored copy again …                      │
  │    ☐ Also make these again: Arc, Quotes …             │
  ├──────────────────────────────────────────────────────┤
  │ ◆  Arc                                [↻ Run it again] │
  │ ◆  Sketch                             [↻ Run it again] │
  │    about $0.20, about two minutes                      │
  │ …                                                      │
  └──────────────────────────────────────────────────────┘
```

## Tests

`tests/metadata-rerun-section.test.tsx` asserts the two-click rule in several places; those
assertions are inverted, not deleted: **one press posts `{ slug, steps: [step], force: [step] }`**,
Retry posts the retry on one press, the Sketch and Debate rows show their price, and accessible
names still carry the mode. The obsolete-confirm tests go with the confirm.
`tests/metadata-reset-section.test.tsx` gets its placement updated: the reset row sits inside the
rerun card, before the first mode row, and still asks before it posts.

## Docs

- [ingest-queue.md](../project/ingest-queue.md) § *A reader can ask for them again*: the "Two
  clicks, not one" paragraph is rewritten to say one click, why, and where the two prices are now.
- The `RerunRow` / `RerunSection` headers in Metadata.tsx and `ResetArticle`'s header.

## Reviews

- **Plan, GPT Sol** ([260930e-plan-review-sol.md](260930e-plan-review-sol.md), EXIT=0): revise —
  billing/security reasoning and the reset wiring sound; four gaps (Retry double-press, stale
  glossary, lost qualifications in two notes, notes not accessible descriptions). All four taken,
  above. Its suggestion to also warn inline that a stale rewrite hides saved look-ups is deferred.

- **Code, GPT Sol** ([260930e-code-review-sol.md](260930e-code-review-sol.md), EXIT=0, with
  fixes): a synchronous Retry latch in `useStepJob` and its tests (kept); the glossary label still
  mispredicting (reworked, above); ResetArticle's Retry still fire-and-forget (P3, deferred below).
  The work after it went back for a second look —
  [260930e-code-review-2-sol.md](260930e-code-review-2-sol.md), EXIT=0: ready after its fixes (the
  glossary note missed the no-list and prompt-change cases; two comments credited `starting` where
  the ref does the work; a test for the post-answer, pre-poll gap). No latch defect found.

## Checks

- Browser, twice (Sonnet subagent, Playwright, own dev server): one-press run with no confirm;
  notes under the four rows; Whole article first in the card with its confirm intact; experimental
  off hides it; at 390px every row's button stays on the name's line and nothing overflows.
  [260930e-shot2-390.png](260930e-shot2-390.png), [260930e-shot2-1280.png](260930e-shot2-1280.png),
  [260930e-shot2-reset-confirm-1280.png](260930e-shot2-reset-confirm-1280.png).
- Both double-press tests went red without their latch (two posts, two retries) before going green.
- `npx vitest run .test.tsx`: 257 files, 4596 tests green; typecheck exit 0.

## Deferred

- A per-reader limiter on re-runs (ai-gateway.md already has the design, and the files are on the
  security map, so it is Greg's).
- Undo for an accidental *Find more terms* (the appended terms stay). **Designed and deliberately
  not built**, on GPT Sol's advice — [261001i](261001i-glossary-undo-find-more-and-say-append-or-rewrite-in-metadata.md) § 2.
- Saying, on the glossary's row, that a rewrite stops saved look-ups showing beside entries whose
  ids change (they stay stored). The old confirm did not say it either.
- Telling the reader in advance whether a glossary run will append or rewrite: needs the server to
  expose `existingFor`'s verdict through `articleMetadata`. **Done, 2026-10-01** — [261001i](261001i-glossary-undo-find-more-and-say-append-or-rewrite-in-metadata.md) § 3.
- ResetArticle's Retry fires and forgets `queue.retry` (Sol code review P3). It predates this work,
  sits behind its own confirm, and the server collapses a duplicate reset; giving `useResetJob` the
  same latch is the fix. **Done, 2026-10-01** — [261001i](261001i-glossary-undo-find-more-and-say-append-or-rewrite-in-metadata.md) § 1.

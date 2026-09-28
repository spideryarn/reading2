# Reset an article, and optionally make its extras again

*Status as of 2026-09-28: stage 1 (server) built and committed; stage 2 (the button) not built —
evidence: `jobs.reset` and `POST /api/article/:slug/reset` exist; no `ResetSection` in
`src/web/Metadata.tsx`.*

## The ask

> And a new agent to add a reset-and-regenerate button in the lower part of Metadata mode (perhaps
> the default is just to reset as if it had just been imported for the first time, and there's an
> option to regenerate any extra stuff that had been generated for the article with a queue).
>
> — Greg, 2026-09-28 (relayed by the Overseer)

Constraints from the Overseer's brief: the reader's own data must survive (comments, highlights,
notes, reading time); block ids are the contract and must be preserved the way re-extraction
preserves them; stop and ask if the design would delete reader-written data or need a destructive
migration.

## What exists already (the survey)

- **Metadata** is a page, `/read/<slug>/metadata`, owner-only — `src/web/Metadata.tsx`. Its lower
  part, in order: *Your reading*, **Generate it again** (`RerunSection`, one forced single-step job
  per row for nine steps, `src/rerun-steps.ts`), Export, Technical details, Archive, Delete.
- **A job** is `enqueue(request)` in `src/jobs.ts`; `POST /api/jobs` is its route. Jobs on one
  article run **one after another** (`jobs_one_running_per_slug`, claimed in `created_at` order), and
  the tab's `jobEngine` drives them — [ingest-queue.md](../project/ingest-queue.md). A request with a
  `slug` and no `url` spends no billing slot ([billing.md](../project/billing.md)).
- **What a fresh import runs**: `DEFAULT_INGEST_STEPS` = fetch, extract, blocks, hierarchy, assets
  (`src/pipeline.ts`). Then `labels` follows as a free successor job whenever the tree's labels are
  pending, and `arc` starts itself when the owner opens the article. Everything else — tweets,
  glossary, quotes, ideas, timeline, quiz, faq, sketch, illustrated, debate, citations — is made
  **on demand**, the first time a reader opens that mode (`useAutoRun`).
- **A revision** is one row of `article_revisions`. Each job copies the current one into a draft
  (`beginDraftIn`, `src/store/pg-revisions.ts`), runs its steps into the draft, and publishes it; the
  old revision stays in the table. **Every artefact column is `carry`**, and the draft copies the
  step-run rows too — so re-running the import steps today does *not* drop the extras; they ride
  along, flagged stale.
- **Where reader data lives**: comments/highlights/bookmarks/notes in `comments`, reading time in
  `reading_time`, chat in `chat_threads` — all keyed on `(article_id, block_id)` against
  `block_identities`, whose rows are never deleted. **Nothing a reader owns references a revision.**
  Shelf state (title override, archived, visibility, purpose) is on `articles`. So replacing the
  revision cannot delete any of it; the only way to lose something is for a block to come back
  under a **new id**, which leaves the comment in place but *detached* — Comments lists it last as
  "no longer in this version of the article" (`src/web/comment-nav.ts`).
- **Caching**: a step skips when its stamp matches (`stepIsDone`); `force` bypasses that. A second
  cache, `checkpoints` (hierarchy passes, PDF chunk reads), is **not** bypassed by `force`, keyed on
  the content and prompt/model — so a forced re-read of an unchanged source with an unchanged
  prompt mostly replays rather than pays (the exceptions are in *What it costs to press*).

## The design

**One new server action, `POST /api/article/:slug/reset`, body `{ regenerate: boolean }`.** It
enqueues **one job**, the reset:

- steps `DEFAULT_INGEST_STEPS`, `force: ["extract"]`. `cascadeForce` sweeps blocks, hierarchy and
  assets in behind the forced extract; `fetch` is already done, so it skips — **we re-read the
  copy we stored, we do not fetch the page again** (verified by Sol: `extract` reads the stored raw
  manifest, for URL articles and uploaded PDFs alike).
- a new nullable column `jobs.reset jsonb`, `{ regenerate: StepName[]; profile?: string }`. Null
  means an ordinary job. `regenerate` is the extras the current revision *has* (non-null column,
  in `STEP_ORDER` order) when `regenerate: true` was asked, else `[]`. `profile` is the reader's
  profile resolved **once, at the press**, exactly as `POST /api/jobs` resolves it — so a
  regenerated `ideas` or `sketch` is written for the reader's profile as it stands at the press
  (Sol F2).

**Where the extras get dropped**: when a job with `reset` mints its draft, the same transaction
sets every *extra* step's columns to null in the draft and deletes those steps'
`revision_step_runs` rows. A reopened draft (lease recovery) copies nothing back, so it stays
reset; a retry mints a new draft, so `reset` is carried through retry. The published revision the
reset replaces keeps its extras. Which steps are extras is **one exhaustive map**,
`RESET_ROLE: Record<StepName, "import" | "successor" | "extra">` in a new `src/reset.ts`, so a new
step cannot be added without somebody deciding what a reset does to it; the columns come from
`STORAGE` in `src/store/artifacts-pg.ts`, not a second list.

**Where the regeneration gets queued: inside the reset's publication**, beside the labels
successor that `publishRevisionIn` already buys in the same transaction. For each step in
`reset.regenerate`, `enqueueSuccessorIn` queues one single-step job (extended to take an optional
profile). So the regeneration exists **only if the reset published**, and is created strictly
after it. Two further rules make that true rather than nearly true:

- **Each regeneration job's work key is scoped to the reset** (the reset job's id goes into the
  key). Otherwise it can de-duplicate onto an identical job that is still active from before the
  reset — `enqueueSuccessorIn`'s `boundToOlderBase` case, a holder with a draft on the old base
  that can never publish over the reset (Sol F1, rounds 1 and 2). The cost of scoping: if the
  reader also asked for, say, quotes during the reset, two quotes jobs queue; the second finds the
  step done and skips, free.
- **They are given explicit, increasing `created_at` values** (transaction time plus *i*
  microseconds). All N are inserted in one transaction, where `now()` is fixed, and the queue
  breaks timestamp ties by random id — so without this, `illustrated` could claim before `sketch`
  and refuse for want of one (Sol F6).

**How the revision code learns it is a reset (Sol F7)**: it reads `jobs.reset` from the job row it
already locks — `openOrBeginJobDraft` selects the live job row `for update` before minting, and
`publishRevisionIn` fences the same row before moving the pointer. Nothing is threaded through the
session. `PublishRevisionResult` keeps `successor` for labels and gains
`regenerated: SuccessorOutcome[]`.

**The reset's work key includes a reset marker**, so a reset never de-duplicates onto a plain
"re-read" job (`force: ["extract"]`) that happens to be queued and silently not reset anything.
The marker is deliberately independent of the regeneration list and profile: only one reset may
be active on an article. Otherwise reset A can publish and insert its regeneration jobs behind an
already-queued reset B; B then publishes, and A's jobs recreate extras B asked to leave absent.
An identical second press shares the active reset; a different plan is a 409. Existing non-reset
keys still hash exactly as before.

Why each piece is this shape:

- **Dropped in the draft, not deleted from the published revision.** `deleteGlossary` nulls in
  place, but doing that here would make a reset two writes with a window between, and destroy the
  only copy. In the draft it publishes atomically with the new text, and the previous revision
  stays as it was — an undo is possible later without anything new being kept.
- **One job per extra, not one multi-step regeneration job.** (Round 2 made this dearer: it now
  needs the reset-scoped key and the sequenced timestamps above, where one multi-step job would
  get ordering for free. Kept, because a failure in a multi-step job discards every extra it had
  already *paid for*, and debate or illustrated failing would throw away ten calls.) Sol (F5) is right that the real
  trade-off is between these two, not the combined job the first draft rejected. A multi-step job
  shares the article's prompt-cache prefix between neighbouring steps (glossary+quotes;
  ideas/timeline/quiz/faq/sketch) and so is cheaper; but one failure publishes none of them, and
  the reader sees nothing until the last lands. Separate jobs cost **exactly what opening each mode
  costs today** (each auto-run is its own job), land one by one, and fail one by one. Chosen:
  separate. Revisit if the bill says otherwise.
- **Regenerate pays again; it does not reuse the cache.** The reset deletes the step-run stamps, so
  those steps run for real. Re-using the cache would hand back exactly the output the reset exists
  to throw away.
- **A server route, not a `reset` field on `POST /api/jobs`.** The server decides which extras to
  regenerate from what the revision holds; the client cannot name steps. It reuses `enqueue`, so
  billing admission, ownership (a slug you do not own is a 404) and de-duplication are the
  existing ones.

### What "the extras" covers, and what it does not (Sol F3)

**Covered**: the twelve revision artefacts off the import list — arc, tweets, glossary, quotes,
ideas, timeline, quiz, faq, sketch, illustrated, debate, citations — everything a *mode* generates
and stores on the article's revision.

**Not covered, deliberately**: things that live in their own tables because a reader *asked* for
them — saved concept searches (`search_runs`), referee criteria and the referee claims extracted
for them, chat, glossary look-ups, citation finds, link summaries. Each is either a reader's own
question with its answer, or tied to one, and deleting rows outside the draft is not undoable. They
are left alone; if their source hash still matches (unchanged text) they keep showing as current,
which is true — the text they were made from is the text on the page. Listed for Greg below.

### What it keeps, and what it can lose

- **Kept, always**: comments, highlights, bookmarks, notes, chat, reading time, the title you gave
  it, archived/visibility/purpose, everything in the list above, and the previous revision.
- **Block ids**: carried by text match, exactly as any re-extraction does (`previousBlocksFrom`,
  [block-ids.md](../project/block-ids.md)). A paragraph whose text is unchanged keeps its id.
- **The known loss: maths.** An article first imported before TeX conversion
  ([260924b](260924b-pdf-transcriber-writes-maths-as-tex.md)) re-extracts its maths paragraphs as
  different text, so they get new ids and any comment on them becomes detached (kept, listed last).
  Measured there: 27/149, 51/365, 58/145 blocks re-minted on three test articles. The same is true
  of any re-extraction and was accepted on 2026-09-24. **This feature does not fix it; the confirm
  says it in plain words.** The fix, if counts show it matters, is the one-off remap that plan
  names.
- **A PDF can come back slightly different even with no maths.** The front-matter pass is not
  checkpointed and decides which records are hidden, so a re-read can change the title or hide a
  different paragraph (Sol F4). Same consequence: a paragraph whose text changed gets a new id.
- **Glossary look-ups and citation finds are keyed on entry ids.** A regenerated glossary or
  citation list mints fresh ids (the inheritance in `src/citations.ts` needs a previous list, and
  the reset removes it), so earlier look-ups stop showing beside their entries. The rows are kept,
  not deleted. The confirm names this too.

### What it costs to press (corrected after Sol F4)

- **No billing slot**, either way (a request with a slug and no URL is free —
  `src/billing/admission.ts`).
- **The reset, web article**: re-reading the stored HTML is free; the hierarchy passes and the
  labels batches replay their checkpoints when the text is unchanged, so they are usually free;
  **assets re-fetches the images from the publisher** (the document is our copy, the pictures are
  not); `arc` is re-bought when the owner next opens the article.
- **The reset, PDF**: the transcription chunks replay their checkpoints, but **the front-matter
  pass is always paid again** — one model call.
- Any text that did change re-buys the hierarchy and labels for the parts that changed.
- **Regenerate**: roughly what opening each of those modes costs — one model call each, except
  debate (two), sketch (~$0.20), and illustrated (a brief plus one image call per plate).

## Assumptions pending Greg

Each is a default we built; say the word and it changes.

1. **Owner only; an admin can reset their own articles but not other people's.** The Overseer's
   default was "owner and admin". Nothing in the app lets an admin act on another owner's article
   today — every job is owner-scoped, and the admin surface is read-only (`/api/admin/*`). Adding
   it would be the first cross-owner write, which is a security design of its own
   ([security-map.md](../project/security-map.md)). Choose "owner and admin" only if you want admins
   to repair readers' articles, and then it is its own piece of work.
2. **Reset re-reads the stored copy; it does not fetch the page again.** "As if just imported" could
   mean either. Re-reading gives today's pipeline over the *same* text (works for uploaded PDFs, no
   surprise edits from the publisher). Re-fetching already exists as *Refresh from source* on the
   shelf row. Pick re-fetch if what you want is "the article as it stands on the web now".
3. **Reset drops arc too.** Arc is not in the import list (it starts itself when you open the
   article), so a just-imported article has none. It comes back, paid, on the next open.
4. **A confirmation that says what is lost, kept and paid**, two clicks as *Generate it again* does.
5. **Behind the experimental-features switch at first**: it re-reads the article and can detach
   comments on maths, so it earns a trial before it is offered to everyone.
6. **The old revision is kept, with no undo button in v1.** Revisions already make it free to keep;
   an undo is a pointer move plus the questions of what an undo does to comments made since — its
   own small feature if you want it.
7. **Regenerate remakes only the extras the article had**, not all twelve.
8. **Reset clears the modes' generated artefacts, not things you asked for.** Saved concept
   searches, referee criteria and their claims, chat, glossary look-ups and citation finds are left
   as they are (see *What "the extras" covers*). The alternative — clearing referee claims too,
   since they are generated — would be a delete outside the revision that no undo could reach.

## Stages

### Stage 1 — the server: a reset job and the route

- [ ] `src/reset.ts`: `RESET_ROLE` (exhaustive over `StepName`), `extraSteps()`, and the columns
      each extra owns, read from `STORAGE`.
- [ ] `jobs.reset jsonb` (nullable) `{ regenerate: StepName[]; profile?: string }` — additive
      migration via drizzle-kit generate. Carried through `enqueue`/`JobRequest`, **into
      `workKeyFor` and `sameWork` only when present**, and into retry (a retried reset still
      resets, with the same regenerate list and profile).
- [ ] Draft minting for a `reset` job nulls the extras' columns and deletes their step-run rows,
      in the same transaction. Only on the mint branch; a re-opened draft is already reset.
- [ ] `publishRevisionIn`: when the publishing job has `reset.regenerate`, queue one successor per
      step, in order, in the same transaction (`enqueueSuccessorIn`, extended with an optional
      profile that goes into the row and its work key).
- [ ] `POST /api/article/:slug/reset` `{ regenerate }` → resolves the profile as `POST /api/jobs`
      does, reads which extras the current revision has, enqueues the reset job. Returns its id and
      the list it will regenerate. 404 for a slug you do not own. 400 for a non-boolean.
- [ ] Tests, **red first**, against Postgres:
  - a reset over an article with quotes + glossary + arc publishes a revision with those columns
    null and their step-runs gone; the previous revision still holds them;
  - comments and reading time on unchanged blocks survive with the same block ids;
  - `regenerate: true` records exactly the extras present, in `STEP_ORDER`; **nothing else is
    queued until the reset publishes**, and then one job per extra is, carrying the profile;
    `false` queues none; a failed reset queues none;
  - with an identical `quotes` job already queued *before* the reset, **and** with one active
    holding a draft on the old base, a successful reset still ends with its own queued post-reset
    `quotes` job (Sol F1, both rounds);
  - `sketch` and `illustrated` successors claim in that order even when their ids sort the other
    way (Sol F6);
  - a reset does not collapse onto a queued plain `force: ["extract"]` job;
  - another owner's slug is a 404 and enqueues nothing;
  - `RESET_ROLE` classifies every step (type-level; plus a test that `DEFAULT_INGEST_STEPS` are all
    `import`).
- [ ] Mutate: remove the null-out; the first test must go red.
- [ ] Sol code review (writes fixes in stage); commit; update this plan.

**Landed (stage 1).** As planned, with two departures: the route is singular, `/api/article/…`,
matching its neighbours; and `STORAGE` moved to `src/store/artifact-storage.ts` (re-exported from
`artifacts-pg.ts`), because `src/reset.ts` is imported by `pg-revisions.ts`, which `artifacts-pg.ts`
imports — a cycle otherwise. The browser sees `reset.regenerate` on a job but never its profile
(`publicJob`). Every test was seen red first; four mutations (null-out, successor scope, explicit
`created_at`, `reset` on retry) each turned a named test red.

### Stage 2 — the button

- [ ] `ResetSection` in `src/web/Metadata.tsx`, above *Archive this article*, gated by
      `useExperimental().on`. Two-click confirm in plain words (lost / kept / cost), a checkbox for
      "also make the extras again" listing which ones by name. After pressing, the jobs show in the
      same progress UI the rerun rows use, and the page re-reads its metadata when they finish.
- [ ] Copy in the component, not `messages.ts` (it is not a failure — [copy.md](../project/copy.md)).
- [ ] Component test for the confirm and the request body; browser check in a subagent against the
      local dev server (Playwright, this box).
- [ ] Sol code review; commit.

### Stage 3 — docs

- [ ] [ingest-queue.md](../project/ingest-queue.md): a section beside *A reader can ask for nine of
      them again*. [experimental-features.md](../project/experimental-features.md): add it to the
      list. [block-ids.md](../project/block-ids.md): one line that a reset is a re-extraction.
- [ ] Push to `dev`; worktree check; remove.

## Rejected

- **Null the extras on the published revision, then run the import** (the `deleteGlossary`
  pattern): two writes, a window where the article is half reset, and the old artefacts destroyed.
- **One job with the reset and every extra step in it**: a failure in step four would fail the job
  and discard its draft, losing the reset along with it.
- **Reset job, then one multi-step regeneration job**: cheaper through shared prompt cache, but
  all-or-nothing and nothing visible until the last step lands (see *The design*).
- **Enqueue the extras at press time, behind the reset**: ordered only by millisecond timestamps,
  and can de-duplicate onto a job that ran before the reset (Sol F1).
- **`force` the extras in the regenerate jobs**: glossary appends when forced, and a failed reset
  would then re-buy extras on the old text.
- **Re-fetching as the reset** (see assumption 2).

## Reviews

- **Plan, round 1** — GPT Sol, refuse: F1 (regeneration not causally after the reset) P1, F2 (no
  profile) P1, F3 (scope of "extras") P1, F4 (cost and stored-copy claims wrong) P1, F5 (the
  rejected alternative was the wrong one) P2. All accepted; the design above is the answer to each.
  [review](260928a-reset-and-regenerate-article-review-sol.md).
- **Plan, round 2** — GPT Sol, refuse: F2–F5 answered; F1 still open for a holder bound to the old
  base, F6 (successors in one transaction share a timestamp, so `illustrated` can claim before
  `sketch`) P1, F7 (how the revision code reads the flag) P2. All three answered above. Discovery
  on the plan closes here; the F1 and F6 fixes get a narrow check in the stage 1 code review.
  [review](260928a-reset-and-regenerate-article-review-sol-r2.md).
- **Stage 1 code, round 1** — GPT Sol (reviewer-fixer), accept after Postgres regressions pass:
  F1 and F6 fixes confirmed sound. F8 P1 **fixed by Sol**: two resets with different
  regeneration choices could queue together, and the first one's successors would recreate
  extras the second asked to leave absent. Resets are now single-flight per article (the work key
  carries a plain reset marker; an identical second press shares the active reset, a different
  one is a 409), and a reset's `created_at` is the database clock at insert. Postgres tests run by
  me afterwards: 14 files, 527 tests, exit 0.
  [review](260928a-reset-and-regenerate-article-stage1-review-sol.md).
- **Stage 2 code, round 1** — GPT Sol (reviewer-fixer), accept after fixes. **Fixed by Sol**: F9
  P1 (a stale-but-present extra was not named), F10 P1 (the regeneration list vanished on reload —
  now recovered from `job.reset`), F11 P1 (FAQ, Illustrated and Citations have no rerun row, so
  their regeneration had no visible progress — now drawn), F12 P1 (cost copy understated debate,
  sketch, illustrated and arc; kept/lost copy widened), F13 P2 (confirm is a `fieldset`/`legend`).
  Reported: F14 P2 (`RESET_EXTRA_NAME` duplicates `RESET_ROLE`, held only by a test) — taken in
  stage 3; F15 P2 (client infers presence from run receipts, server from non-null columns; they
  agree on normal revisions) — left, noted here.
  [review](260928a-reset-and-regenerate-article-stage2-review-sol.md).

**Landed (stage 2).** `src/web/ResetArticle.tsx` (its own file: Metadata.tsx is near its
complexity budget), `ResetSection` in Metadata.tsx, and a `reset` action on `useJobs` that goes
through the same `act` wrapper as `run`, so a success pokes the job engine. After the reset
finishes, the page offers a Reload: the reading view holds the article in memory and nothing
re-fetches it. A first browser pass on the box confirmed the gate, the placement and the checkbox;
the rest is re-checked in stage 3.

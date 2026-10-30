# Several Skim briefs per article, and a picker between them

Report `spya-xyje0z` (Greg, admin, suggestion, 2026-10-27, on Skim):

> Could we allow for multiple Skim briefs, i.e. a default one (perhaps based on user profile + why
> you're reading), with the option to add one or more new briefs, and then select between them
> (kinda like how you can choose between Chat threads).
>
> — Greg, 2026-10-27 (`spya-xyje0z`)

Up: [skim.md](../project/skim.md). Note: [docs/user-feedback/](../user-feedback/).

## What exists

- **One route per article revision**, `article_revisions.skim` (jsonb), written by the `skim` step
  ([`src/skim.ts`](../../src/skim.ts), [`src/pipeline.ts`](../../src/pipeline.ts) § `skim`).
- **What it is planned for** is the reader profile plus the article's *why you're reading*
  (`articles.purpose`), rendered by `renderProfile` and hashed into the route's stamp. Skim shows it
  as *Reading for: …* with **Edit** ([`SkimPurpose.tsx`](../../src/web/SkimPurpose.tsx)). That
  sentence is shared: Metadata, the add page and every profiled mode read it.
- [skim.md](../project/skim.md) (§ the purpose box is editable in place) records that a Skim-only
  focus with "several routes per article" was weighed on 2026-10-11 and not built, *queued for if
  the shared purpose feels wrong in use*. This report is that.

So **the default brief is what exists today**, exactly as Greg describes it (profile + why you're
reading). Nothing about it changes; it keeps its column, its job, its banner, its visitor view.

## The simplest version

**A brief** is one sentence the owner types — *what are you skimming for?* — plus the route planned
for it. Added briefs live in a new table; the default stays where it is.

```
articles ──┬── article_revisions.skim          ← the default brief's route (unchanged)
           └── skim_briefs (article_id, id)    ← each added brief: its text, its route, when
```

- **Table** `skim_briefs`: `article_id` (FK, cascade), `id` (minted, `spya-` style like a chat
  thread's), `brief` text (≤ `MAX_PURPOSE_CHARS`), `skim` jsonb (null until planned),
  `profile_notice_dismissed_for` text, `created_at`, `planned_at`. Owner-only, at most 12 per
  article. Modelled on `chat_threads`.
- **What an added brief is planned from**: the reader profile, with the brief **in place of** the
  article's *why you're reading* — `renderProfile({ profile, purpose: brief })`. A brief is the
  answer to the same question, asked again; mixing the two would make every added brief lean back
  towards the default. Cheap to change (one argument), and said so in the question's details.
- **Planning a brief's route is a job, with the brief named on it** — the `skim` step, given
  `Job.skimBrief = <id>`, the way Illustrated's step is given `Job.illustrationNote`: carried on the
  request, frozen onto the job row, part of the work key (so two presses for one brief are one job,
  and presses for two briefs are two), and kept out of `publicJob`. The step reads the brief's
  sentence, plans against the same pinned `skimInput`, and writes the route to the brief's row
  instead of the revision's column; the stamp it compares against is the row's. A completion for a
  brief deleted (or an article transferred) meanwhile writes nothing.
  **Passed over: a direct request** (`POST …/plan` that awaits `generateSkim`). It looked like fewer
  parts, but Sol's plan review (F2–F4) showed it would need its own single-flight claim, completion
  fence, deadline, prerequisite recovery (Quotes, Ideas re-run first) and revision pinning — all of
  which the job queue already has. ~15 mechanical edits beat a second claim system.
- **Stale like the default — the whole calculation, not just the hashes** (Sol F6): the loader's
  freshness logic (`stale`, `outdated`, `notOnRoute`, missing input, prompt-version gating) is
  extracted from `loadSkim` and run over a brief's route too, with the profile hash taken from
  `renderProfile({profile, purpose: brief})`. The banner and its *Plan it again* are the default's,
  pointed at the brief; the dismissal key is `profileNoticeKey`, stored on the row, with the same
  generated-at conditional write. The rewrite hold and pending-job state are keyed by
  `(slug, brief-or-default)`, not `(slug, "skim")` (Sol F4).
- **Re-planning an added brief**: from its banner, and from *Plan it again* in the band. Metadata's
  Skim row stays the default's and says so (Sol F5).
- **The address**: `?brief=<id>` (replace, like `?thread=`), absent = the default. `?stop=` and
  `?depth=` keep their meaning inside whichever brief is chosen; a stop not on the chosen route is
  the existing `notOnRoute` case. Leaving Skim clears `?brief=`. An unknown id falls back to the
  default and is cleared.
- **Visitors see the default only.** Added briefs are the owner's own steering, and showing them
  would be an edit to the visitor projection (`publicSkim`), a listed defence. Not done.
- **Delete** a brief: a bin, two-press like Chat's `ArmedDelete`. **Edit** a brief's sentence, like
  the default's *Edit*: it saves and re-plans that brief. The sentence is its name.
- **Export** carries `skim_briefs` in the snapshot walk and its coverage registry, and the sentences
  in `your-words.md`, planned or not ([export.md](../project/export.md), Sol F8).
- **Transfer** (Sol F1, P0): briefs are the reader's own words, like Chat threads. They are counted
  as reader state (`ownWords: true`) in `pg-article-transfer.ts` and deleted on a confirmed
  transfer; their presence blocks an unattended voucher transfer, as threads do. Deletion follows
  the FK. Chat and the guide's `prepareMode` stay default-only; MCP has no Skim tool.
- **API**: `GET /api/skim/:slug/briefs` (list: id, sentence, when, whether planned),
  `GET /api/skim/:slug/briefs/:id` (one route with the default's `SkimResponse` freshness fields),
  `POST /api/skim/:slug/briefs` `{ id, brief }` (create; client-minted id like a chat thread, so
  `?brief=` points at it from the first frame), `PATCH …/briefs/:id` `{ brief }`,
  `DELETE …/briefs/:id`, `POST …/briefs/:id/profile-notice-dismissal`; planning is
  `POST /api/jobs { slug, steps: ["skim"], skimBrief }`. All owner-only, 404 to anyone else.

## The product choices

Two, put to Greg in one question file: the picker's shape, and whether an added brief replaces the
article's *why you're reading* or adds to it (recommended: replaces — built that way, one argument to
change). Settled here without asking (Sol listed them as choices; each is cheap to revisit and has
no bad-experience side): briefs are editable, the chosen brief is remembered, and briefs are added
only over a ready default route.

### The picker

Recommended: **A**, the *Reading for: …* line becomes the
picker, because that line is already where Skim says what the route was planned for.

- **A. The brief line is the picker.** `Route for: understand the method ▾`; pressing opens a short
  list — the default (with *Edit*, as today), each added brief (bin), and *New brief…*, which opens
  the same *What are you skimming for?* box with *Plan a route for this*.
- **B. Chat's list view.** A `‹ Briefs` button in the head leads to a list of briefs, one row each,
  with `+` in the header. Closest to Chat, but takes the whole band and costs a click each way.
- **C. A chip row** above Gist · More · Most: `Default · Methods · vs Smith 2019 · +`. One click
  to switch, but a second row of chips beside the depth chips, and long briefs truncate, worst on a
  phone.

## Stages

1. **Plan, Sol plan review, question file.** This doc; the question published.
2. **Storage, job and API** (doesn't depend on the answers): migration + schema, store functions,
   `Job.skimBrief` through the queue and the `skim` step, the routes, shared freshness, export,
   transfer. Tests: store round-trip, owner-only 404s, a brief job with a faked model writes the
   brief's row (not the revision column) and a cost row, two briefs are two jobs and one brief
   twice is one, a deleted brief's completion writes nothing, transfer deletes briefs, freshness
   for a changed brief/profile/input. Sol code review.
3. **Client, minus the picker**: `useSkimBriefs` (list/create/plan/delete), `useSkim` reading the
   chosen brief's route, `?brief=` in URL state, the band drawing an added brief's route with its
   banner and *Plan this route*. Reachable by URL for now. Sol code review.
4. **The picker, once Greg answers**, then the browser check (Sonnet) and docs
   ([skim.md](../project/skim.md), [url-state.md](../project/url-state.md)).

## Waits for 1 November

The box's OpenRouter key is over its monthly limit until 1 November, so **no route for an added
brief can be planned for real until then**: every test uses the faked model, and the browser check
can show the picker, an unplanned brief and its button, but not a freshly planned route (it can
show the default's). One real end-to-end plan after the reset is queued.

## Done

- An owner can add briefs, switch between them and the default, delete one, and see each planned
  for its own sentence; the default and visitors are unchanged.
- The note for `spya-xyje0z`, its ending, and the queue entry for the real-model check.

## Log

- 2026-10-27: plan written.
- 2026-10-27: Sol plan review ([…-plan-review-sol.md](261027d-several-skim-briefs-plan-review-sol.md)):
  F1 (P0, transfer) and F2–F8 accepted; the direct request replaced by a job parameter; edit
  allowed; brief remembered with position; replace-vs-supplement added to the question.
- 2026-10-27: **stage 2 landed** (server only, no UI). Table `skim_briefs` and `jobs.skim_brief`
  (`drizzle/20261027130746_skim_briefs.sql`, `drizzle/20261027130814_jobs_skim_brief.sql`);
  the store [`src/store/pg-skim-briefs.ts`](../../src/store/pg-skim-briefs.ts) (article lock as
  the mutex, 12 per article, idempotent create on the id, the job's write fenced on its claim);
  `Job.skimBrief` carried as `illustrationNote` is (route parse, `publicJob` strips it, row,
  work key, `sameWork`, retry); the six owner-only routes; `routeFreshness` and `skimResponseFor`
  in [`src/skim.ts`](../../src/skim.ts), which the default's `loadSkim` and GET now go through too;
  transfer (`ownWords: true`) and export (rollback `skim-briefs.json`, bundle
  `augmentations/skim-briefs.json`, and `your-words.md` on the shelf list). Tests:
  `tests/skim-briefs-pg.test.ts`, plus rows in the transfer, voucher-claim, export-coverage,
  your-words and `sameWork` grid tests.
  **Design choice, where the brief's route is written.** The `skim` step itself is unchanged: the
  job route renders `renderProfile({ profile, purpose: brief })` into `Job.profile`, so the step
  plans and stamps for the brief with no new branch. Only the runner's two conversations with the
  revision differ, and both are in `runStep` (src/jobs.ts § `SkimBriefTarget`): freshness compares
  the step's expected stamp with the brief row's route instead of the revision's run row, and
  after `run` the route goes to `skim_briefs` (fenced on the claim, conditional on the row) with no
  `beginStep` marker and no commit into the draft. The step returns a new outcome,
  `kept-elsewhere`, which the walk treats as a skip, so the draft — with any Quotes or Ideas run
  before it — publishes through the existing skipped-tail door. Passed over: a separate
  `skim-brief` step name (a new entry in `STEP_ORDER`, the registries, Metadata and every
  exhaustive table over steps, for one destination), and teaching the session's `commit` a second
  destination (the transaction is the revision's, and a brief does not belong in it). The cost of
  the choice: the brief's step must be the job's last, which `parseSkimBrief` enforces by allowing
  only `quotes`, `ideas` and `skim` beside it. Brief routes carry no `viewAs` (they fail closed
  while the administrator views as a reader).
- 2026-10-27: **stage 2 code review corrections** against `2a56e2ea8`: a brief's route
  now goes through `StoreSession.commit`, with its own target, so its write, any earlier
  Quotes/Ideas publication and the job's completion share one transaction. This replaces
  the `kept-elsewhere` path described above; otherwise a lost claim could buy a forced
  route twice, or expose a route before its inputs published. A forced job also checks
  whether its brief still exists before spending. Brief mutations check ownership in
  their article-lock query; reads repeat it in the child-row query, closing the transfer
  race for this store ([postmortem](../postmortems/261027b-authorisation-by-a-parent-lookup-expires-before-a-child-row-read-or-write.md)).
  Regression tests were written first, but the review sandbox cannot reach Postgres,
  so their failing and passing assertions still need running. Stage 3 must retain enough
  job-target information on the wire to distinguish brief jobs from the default after
  polling or remounting; stripping `skimBrief` currently prevents that. Reusing a deleted
  brief id during an old job also remains an open server edge: the job needs a durable
  row-incarnation token to distinguish the replacement.
- 2026-10-27: **review corrections verified against Postgres, and two more fixes.** Sol's
  regressions now run: all red-then-green bar the server-retry one, which stayed red for a
  reason of its own. `retryJob` handed the job's URL back (read off the shelf at enqueue, for
  display), so the retry allocated through `slugForRetry`'s address branch and adopted the
  reader's *other* article with that URL; no brief there, so the step read "already done"
  and the job ended `done` having planned nothing. A brief's retry now keeps its slug and
  sends no URL, and a missing brief's skip says "the brief was deleted" instead of "already
  done". (The same adoption can move any late-stage retry when a reader holds two articles
  for one address; not changed here.) C5 is fixed by refusal rather than an incarnation
  token: `create` answers 409 for an id a queued or running job on this article still
  targets, under the article lock the job's completion also takes — one query, where a
  token would be a column, a wire field, a retry copy and a second fence. The window it
  leaves (delete and re-create between the job route reading the brief and the job's
  insert) degrades to an edit mid-run, which the route's profile stamp already reports as
  `profileChanged`. Commit's `kept: false` cannot hide an existing brief: the session's
  article lock already refuses an article that is not the draft's under the same owner.
- 2026-10-27: **stage 3, the client minus the picker.** C4: `publicJob` keeps `skimBrief`
  (an id, not the sentence), and `useStepJob` takes the target as a fifth argument —
  `writesStep(job, step, brief)` scopes only `skim`, so a brief job's Quotes and Ideas stay
  ordinary prerequisites; `start` names the brief on every request. Metadata's row, which
  passes none, is the default's and ignores brief jobs, Retry included. F4: `useSkim(slug,
  quotes, ideas, brief)` — one hook, not a sibling, since everything but the address and the
  automatic run is identical; the read, dismissal, job and rewrite hold (`keyOf` gains the
  brief) are the route's, and its refs are keyed by route; `useAutoRun` is disabled for a
  brief, which drops the opening press rather than spend it. A brief's 404 is an error, not
  the empty state. `SkimBand` reads `?brief=` and **remounts per route** (`key`), so no state
  crosses routes. Client module [`src/web/skim-briefs.ts`](../../src/web/skim-briefs.ts)
  (list, create with a client-minted id, edit, delete, and `useSkimBriefs`, read only while
  `?brief=` names one). F7, **a change from "Leaving Skim clears `?brief=`" above**: the
  brief is kept like `?stop=` and `?depth=` (every parameter outlives a mode switch, and
  `brief` is in last-view's `REMEMBERED`), so leaving and returning reopens it with its own
  position; an unknown id is cleared together with its stop and depth. The band: an added
  brief draws as the default, with its sentence in the *Reading for:* line (no Edit),
  *Plan this route* in its empty state, its banner's *Plan it again* pointed at it, and a
  standing *Plan it again* in the foot — **a decision for the picker stage to revisit**:
  Greg removed the default's standing button in favour of Metadata, which cannot re-plan a
  brief (Sol F5). Tests: `tests/skim-briefs-client.test.tsx`, and § an added brief in
  `tests/skim-panel.test.tsx`; each seen red with its fix undone.
- 2026-10-27: **stage 4, the picker (option A, Greg's choice).** A ▾ (`.chat-icon`) beside
  *Reading for: …* opens [`SkimBriefPicker.tsx`](../../src/web/SkimBriefPicker.tsx): the default
  (the article's purpose, marked *default*), each added brief, and *New brief…*; the current one has
  a tick and `aria-current`. **A Radix `Popover` on `MENU_SURFACE`, not a `DropdownMenu`**: each row
  carries its own pencil and Chat's `ArmedDelete` (moved to
  [`ArmedDelete.tsx`](../../src/web/ArmedDelete.tsx) so both use one control), and a menu item cannot
  hold a second control a keyboard reaches; Tab walks the rows, Escape closes. Decisions:
  - **The list is read lazily**, once the ▾ is first opened (or when `?brief=` names one, as
    before), so Skim on the default costs no request it did not cost before. The price is a short
    *Reading your briefs…* the first time the list opens; *New brief…* works meanwhile, and the
    server's 409 covers the limit if the list has not answered.
  - **Nothing is typed inside the popover.** *Edit* and *New brief…* close it and open the band's own
    box (`BriefIntent`, held in `SkimBand` above the per-route remount): *Edit* on another route
    switches first and opens the box on arrival; the default's *Edit* is `PurposeLine`'s, unchanged;
    an added brief's line gains the same *Edit*, which saves with `edit` and then asks `ensure()`
    (unforced; the new sentence changes the stamp). *New brief…* creates with a client-minted id,
    switches `?brief=` to it, and the arriving band calls the empty state's `ensure()` once its read
    says none. At 12 the item is disabled with the reason.
  - **A switch is one `useQueryStates` write** of `brief`, `stop: null`, `depth: null`, with
    `history: "replace"`. Deleting the brief on screen switches to the default.
  - **`useSkimBriefs` lays this tab's writes over the list** until a read that began after them
    lands: a read in flight at the create could otherwise land without the new brief, and `SkimBand`
    would clear the id as unknown.
  - **The added brief's foot keeps *Plan it again*.** *Edit* re-plans only a changed sentence, and
    Metadata's row is the default's, so the foot is the only re-plan of an unchanged brief. Moving it
    into the picker would put a paid press in a list of choices.
  - **Not done:** the picker is not offered where `PurposeLine` draws nothing (the purpose could not
    be read), nor in the default's empty state (Sol F6's race). Under a banner the picker's *Edit*
    opens its box only once the banner has gone, since the banner re-plans there. No arrow-key
    navigation inside the list.
  Tests: § the picker between briefs in `tests/skim-panel.test.tsx` (lazy read, one-write switch,
  New brief creates and plans, the limit, two-press delete back to the default, the default's box
  from the list, an added brief's edit re-plans, none for a visitor); each but the visitor's seen red
  with its piece of the fix undone.
- 2026-10-27: **GPT Sol's code review of stages 3 and 4**
  ([review](261027d-several-skim-briefs-code-review-3-sol.md)) found D1–D6, and fixed each red-first:
  - D1: one id for *New brief* across retries.
  - D2: a lost reply to a create or edit is checked against the list before it is called a failure.
  - D3: `POST /api/jobs/:id/advance` now goes through `publicJob` too. Until then it put the rendered
    profile on the owner's wire; that predated this plan.
  - D4 (P0): drafts are held above the per-route remount, so Back/Forward no longer loses typing.
  - D5: a visitor drops the private brief's stop and depth along with `?brief=`.
  - D6: a create or edit that finishes after a Back leaves navigation alone, and keeps its re-plan
    pending.

  Browser check (Sonnet, desktop and 390px): all nine items passed. Two notes left as they are:
  - An unplanned brief's line sits inside the empty state's padding, so it is indented about 14px more
    than the default's line over a ready route.
  - Escape sometimes takes two presses when focus is on a tooltipped icon in the list. That is the
    shared tooltip's behaviour, not the picker's.

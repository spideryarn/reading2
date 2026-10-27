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

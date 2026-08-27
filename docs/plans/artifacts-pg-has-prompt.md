# One question, and it is a contradiction inside our own plan

You are reviewing a design decision in the Spideryarn repo, before the code is written. Answer
plainly and say NO-SHIP on anything you think is wrong. Read the code; do not take my summary on
trust.

## Context

We are replacing `db:import` with a live Postgres write path. The seam is `ArtifactStore` in
[`src/store/artifacts.ts`](../../src/store/artifacts.ts), with one adapter built already —
[`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts). I am about to write the Postgres
adapter, `src/store/artifacts-pg.ts`.

The plan is [`docs/plans/delete-the-importer.md`](delete-the-importer.md); the relevant sections are
"The adapter's shape, settled" and "The build order for C, commit by commit" (items C1, C3, C4).

Two earlier rounds of your own review settled:

- `has` answers **presence and completion, never freshness**: every requested value reconstructs and
  passes the same shallow shape checks the filesystem decoder applies, **and** a
  `revision_step_runs` row exists with `status = 'done'`. Freshness stays in `stepIsDone`
  (`src/pipeline.ts`) via `stampFor` + `sameStamp`.
- C1 gave the `toc` step a real stamp. It was built (`59e8e3a`) and then **withdrawn** (`414f3f9`).
  The reason is in the long comment on `STEPS.toc` in [`src/pipeline.ts`](../../src/pipeline.ts):
  a `toc` that can report itself stale re-runs, a re-run may move the tree's block-id boundaries,
  and `arc` and `summary` are joined to the tree by exact block-**range** pair in
  [`src/web/tree.ts`](../../src/web/tree.ts) — an entry matching no node is dropped from the reading
  view silently. `arc` has no stamp at all; `summary` hashes only the blocks. So a `toc` re-run
  silently loses entries from artefacts that still report themselves current. Consumer invalidation
  would have to land first, and `cascadeForce` in `src/jobs.ts` is computed once at job creation and
  cannot hear a step deciding at run time that it is stale.

## The contradiction

When C1 was withdrawn I wrote a consequence into C4 of the plan, and I now think it is wrong. C4 says
two things that cannot both be true. Quoting the plan:

> **And it carries an explicit `toc` case, said out loud.** C1 would have removed the need for one;
> C1 is withdrawn, so `toc` still has no stamp and `has` cannot answer "is this tree current" the way
> it does for every other step. The rule is therefore: for `toc`, the stored run row's `input_hash`
> must match the stored block rows.

and, four lines later:

> *Red first, with the case corrected.* ... `beginDraftIn` carries block rows **and** a done `toc`
> run, so under presence-and-completion `has(slug, "toc", ["blocks"])` is **true**, and it is
> `stepIsDone` that answers no once C1's stamp is compared. Assert exactly that pair — `has` true,
> `stepIsDone` false — which is also what keeps freshness out of storage.

## What I now believe, and want you to attack

**The `toc` case should be deleted from C4 entirely. `has` should be presence + a `done` run row,
uniformly, for every step including `toc`.** Three reasons:

1. **It is a freshness rule, and freshness was ruled out of `has` for good reasons** — `has` is
   handed no expected stamp and teaching storage what "current" means for a step puts pipeline logic
   in the storage layer.
2. **It reintroduces exactly the hazard C1 was withdrawn to avoid.** `has(slug, "toc", …) === false`
   makes `stepIsDone` false, which makes `toc` re-run, which may move the tree's boundaries, which
   silently drops `arc` and `summary` entries that still report themselves current. The route into
   the bug is different from C1's; the bug is the same bug.
3. **Parity does not need it.** On the filesystem, after stage 3 re-runs, `data/<slug>/tree.json`
   still exists and `has(slug, "toc", …)` is `true`. Under Postgres carry-forward the `tree`,
   `labels` columns and the `done` toc run row are all carried, so `has` is `true` too. The two
   adapters already agree without a special case. The gap — that neither store can tell a carried
   tree from a freshly built one — is real, and belongs to `cascadeForce` in landing D, not to
   storage.

There is also a mechanical problem with the rule as written. `toc` has no stamp, so the runner in
landing D passes no `inputHash` to `finishStepRun`
([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)), which leaves `NO_INPUT_HASH`
(the string `"unstamped"`, see `src/store/artifacts.ts`) in the column. Comparing that against
`hashBlocks(storedBlocks)` can never match, so `has(slug, "toc", …)` would be **false for every
article the pipeline ever writes**, and `toc` would re-run on every job for ever. Only rows the
*importer* wrote carry a real hash there. I want you to check that claim against the code rather
than accept it.

## Questions

1. Is deleting the `toc` case right? If not, what does the rule have to be so that it does not
   re-run `toc` on every job and does not silently drop `arc`/`summary` entries?
2. Is my mechanical claim about `NO_INPUT_HASH` correct?
3. `has` requires a `revision_step_runs` row with `status = 'done'`. Under carry-forward, is
   requiring that row **for every step** free of the same hazard I am accusing the `toc` case of?
   Specifically: is there any step where the carried row and the carried column can disagree such
   that `has` says false and a re-run loses something?
4. `stampFor` has to merge two sources, because `revision_step_runs` has no `profile_hash` column
   and `ideas.profileHash` lives only in the JSONB artefact — where `null` is a real recorded value
   meaning "written deliberately without a profile". Which source should win where both have a
   field (`inputHash`/`promptVersion`/`model`)? My inclination is **the artefact overlays the row**,
   because the filesystem adapter reads the artefact and nothing else (`stampOf` +
   `STAMP_SOURCE` in `src/store/artifacts-fs.ts`), and the artefact is the thing whose freshness is
   being judged. The row then supplies only `implementationVersion`, which no artefact carries.
   Argue the other way if the other way is right.
5. `NO_INPUT_HASH` (`"unstamped"`) and `PIPELINE_RUN` (`"pipeline"`) are sentinels in NOT NULL
   columns meaning "nothing was recorded". I intend `stampFor` to drop both rather than hand them
   back as though they were a recorded hash or a recorded implementation version, and to return
   `null` when the merged stamp has no keys at all — matching the filesystem adapter, which returns
   `null` for `fetch`, `extract` and `blocks`. Is dropping `PIPELINE_RUN` right, or does that lose
   a real distinction?
6. `read(slug, "extract", "meta")` must reconstruct a `Meta` (`src/types.ts`) from columns on
   `article_revisions`. There is no "is there a meta" column. `db:export`
   ([`src/store/export.ts`](../../src/store/export.ts)) writes `meta.json` only `if (revision.title)`.
   I intend to follow it: a null `title` means the artefact is absent and `read` returns `null`. The
   filesystem decoder for `meta` instead requires a non-empty `slug` (`json("slug", isString)` in
   `src/store/artifacts-fs.ts`), and `slug` in Postgres comes from the bound reference rather than
   from a column, so it can never be missing. Is keying absence on `title` right, and is there a
   revision that legitimately has blocks but no title?
7. `read(slug, "fetch", "raw")` must reconstruct a `RawManifest` (`src/fetch.ts`). `RawManifest.file`
   is required and names a file on disk; Postgres has no such column until C6 adds `raw_filename`.
   `db:export` derives it by sniffing `raw_bytes` — but `raw_bytes` is being dropped in the
   demolition, so sniffing has no future. I intend: prefer `article_revisions.raw_source_kind`
   (`'html'`/`'pdf'`) and derive `raw.html`/`raw.pdf` from it; fall back to sniffing `raw_bytes` only
   for legacy rows that have no source reference; and return `null` when neither is available, since
   a manifest whose `file` is a guess is worse than an absent one. Is that right, or should `raw`
   simply be unreadable until C6?

Answer each numbered question. Say NO-SHIP where I am wrong, and say what to do instead.

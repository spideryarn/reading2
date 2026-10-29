# Re-run Structure from Metadata, and *Start again* from the command bar

*Status, 2026-10-29: planned; reports `spya-gkmgdd` and `spya-cqg70c`.*

## The ask

Two reports from Greg (admin), two minutes apart, both on *Consciousness in AI*
(`arxiv-2308-08708-spya-xax6v4`):

> I was trying to find a way with Tomambar to sort of re-import or reload or reset a page, but I
> couldn't figure out how. In an ideal world, we'd have an easy way to do that, and it would—well, I
> guess there's two versions. One is sort of re-import, which might involve extra improvements and
> new stuff that we're doing now, but keep my data. And I suppose then there's another version,
> maybe with a special option that would be default false, for kind of wipe all of my chats and
> comments and bookmarks and input of all kinds as well. So in this case, what I want to do was to
> see the new structure mode in action, which would presumably involve re-importing this article, I
> don't know. Or actually, maybe I can just rerun the structure mode. […]
>
> — Greg, 2026-10-29 16:35 (`spya-gkmgdd`)

> In the most recent feedback report, I said I was going to try and rerun the structure mode. I'm
> looking at it in metadata, and I can't see a way to rerun just the structure mode...?
>
> — Greg, 2026-10-29 16:37 (`spya-cqg70c`, from the Metadata page)

"Tomambar" is a dictation slip for the top bar, meaning the command bar.

## What already exists

- **A re-import that keeps the reader's data is built**: *Whole article › Start again*, the first
  row of Metadata's *AI processing* card ([260928a](260928a-reset-and-regenerate-article.md),
  `src/web/ResetArticle.tsx`, `POST /api/article/:slug/reset`). It re-reads the stored copy with
  today's pipeline (extract → blocks → structure → assets, then the labels successor), keeps
  comments, highlights, bookmarks, notes, chats and reading time, and optionally makes the extras
  again. It sits **behind the experimental switch** (experimental-features.md) and inside a section
  that is shut by default, and **the command bar has no row for it**. The bar's
  `ai-processing` row answers *"rerun everything"*, but not *reset*, *re-import* or *start again*.
- **Per-mode re-runs exist** (`METADATA_RERUN_STEPS`, `src/rerun-steps.ts`), each with a
  *‹Name› › Run again* row in the bar. **Structure is deliberately not one of them.** The objection
  in `rerun-steps.ts` is that a forced `structure` publishes a tree with pending labels, which
  strips the paragraph labels and buys the free-of-quota but dear `labels` successor behind the
  press.
- Structure mode's own *Try again* (`StructureNotice.tsx`) does exactly that forced run, but only
  on a tree that fell back to the author's headings.
- **Spending is settled.** Both are slug-only jobs (`POST /api/jobs {slug, steps, force}` and the
  reset route). They spend no slot, and we pay the model cost
  ([billing.md § Which requests spend a slot](../project/billing.md#which-requests-spend-a-slot-and-why-the-wall-is-at-the-routes)).
  Principles §1 governs *us* re-running the shelf. A reader pressing a button on one article is not
  a backfill.

## What changes the old objection

**A forced `structure` replays its checkpoint unless something about how Structure is made has
changed** (structure-step.md § the structure answer is checkpointed: the key is the whole request,
the model and `PROMPT_VERSION`). The labels batches are checkpointed the same way. So:

- if nothing has changed since the tree was made, a press costs close to nothing and gives back the
  same tree; the labels disappear for the minute it takes the successor to replay them;
- if the prompt, the model (High-powered AI) or the article has changed, it buys a new tree and new
  labels. **That is exactly the case Greg is asking for**: the deeper level from
  [261029a](261029a-structure-one-level-deeper.md) reaches an existing article this way.

The objection was a cost hidden behind the press. The fix is to say that cost on the row, which is
what `RERUN_COST_NOTE` is for, not to withhold the row. The arc needs nothing extra: its stamp
covers the tree, and `useArc` makes it again, unforced, when the reader next opens the article
(`src/web/useArc.ts`; `src/pipeline.ts` § `arc`). *Wrong, and corrected below (Sol's finding 1).*

## The design (v1)

1. **`structure` joins `METADATA_RERUN_STEPS`**, first in pipeline order. Its row and its
   *Structure › Run again* bar row come from the existing derivation, with a note:
   *"Builds the outline again with today's Structure; the paragraph labels are rewritten after it,
   and are missing until then. Unchanged if nothing about Structure has changed."* No price
   (tests/no-ai-cost-for-readers.test.ts). It is not behind the switch, matching the other rows:
   the switch hides clutter, never a way to redo something already made.
   The rewrite of `rerun-steps.ts`'s *"structure is out"* paragraph says why the reason no longer
   holds, and `tests/metadata-rerun-steps.test.ts` moves it from `REFUSED` to the list.
2. **A command bar row for the reset: *Start this article again***, typed-only, which opens
   *AI processing* (`?section=ai-processing`), where the reset is the first row. It answers
   *re-import*, *reimport*, *reload article*, *reset*, *reset article*, *start again*, *start over*
   and *refresh article*. It is a place, not an action, because the reset keeps its confirm (it can
   detach comments, 260930e) and the bar is not where that confirm gets skipped. It is shown only
   while the experimental switch is on, because the row it leads to is drawn only then. The words
   avoid the bare verbs the Metadata row owns (*regenerate*, *rerun*, *reprocess*, *redo*).
3. **Docs**: rerun-steps.ts's header, structure.md (re-running Structure), experimental-features.md's
   line about *Start again* (it now has a bar row), and the reading-view command-bar list if it
   enumerates section rows.

## Deliberately not, and the simpler option passed over

- **The wipe** (Greg's second version: throw away chats, comments, bookmarks and other input as well).
  It destroys a reader's data. Building it means finding every table that holds reader input keyed
  to an article, and a missed one fails silently. *Delete* followed by adding the URL again already
  gets him there. So it goes to Greg as a question with a recommendation, not built.
- **Taking *Start again* out from behind the switch.** That would be a separate call, and nobody has
  asked for it. The bar row follows the switch.
- **Simpler option passed over:** pointing Greg at *Start again* and building nothing. It answers
  the first report. It does not answer the second, which asks to re-run only Structure, and it
  re-reads the whole article to get there.
- **Chaining the arc into the Structure press** (as `StructureNotice` does): it covers only the tab
  that pressed and not the command bar. The `loadArticle` check (Sol's finding 1, below) covers
  every path at once.

## GPT Sol's plan review, and what changed

[The review](261029l-re-run-structure-review-sol.md) found the plan wrong on the arc and
too sure on cost. Each finding, and what was done:

1. **The arc does not heal itself (blocker, accepted).** `loadArticle` embeds the stored arc
   without checking it against the tree. `useArc` then treats it as ready and never asks `/api/arc`,
   so a re-cut tree leaves a truncated arc for good. That was already true after Structure's *Try
   again* in any tab but the one that pressed. **Fix:** `loadArticle` leaves the arc out when any of
   its sentences matches no top-level part of the current tree. That is the reading view's own
   rule (`buildArcColumn`, src/web/tree.ts: an unmatched sentence is dropped). Absent, the owner's
   `useArc` takes its existing absent-then-make path, unforced, and the arc step's stamp decides.
   The check is purely structural and costs no hashing. It does **not** use `arcIsStale`, which also
   says stale on an arc prompt bump, and on the hot path that would quietly re-buy every arc on
   the shelf the day the prompt changes. Going one level deeper inside a section, which is Greg's
   case, leaves the parts alone, so the arc stays.
2. **Other tree-derived artefacts (accepted in part).** A re-cut tree changes `structureHash`, so
   Glossary, Quotes, Ideas, FAQ, Quiz, Sketch, Thread, Reception and Bibliography may say they are
   out of date. None remakes itself: `useAutoRun` runs only on *nothing there*. That is the
   behaviour Structure's *Try again* and the reset already have, and the row's note says so.
   **Cross-references are the silent one**: stale, they draw no links and say nothing
   (useCrossrefs.ts). That is also already true after a reset. It gets a queue item rather than a
   fix inside this change, because the right answer (say so, or remake them) is a product choice
   about a paid call.
3. **"Unchanged if nothing has changed" was too strong (accepted).** A missing or unreadable
   checkpoint buys the full call, and older articles may have none. The note now says *usually*.
   The section's intro promises that what is there stays until the new run succeeds, which is
   untrue of the labels, so the note says that too.
4. **The test (accepted).** `structure` must not join `FORCE_ONLY_WHEN_NAMED`, since in a multi-step
   job forcing it has to invalidate labels. The test now asserts the real property, that
   `cascadeForce([s], {s})` is `{s}`. The `useStepJob` comment that calls Structure
   StructureNotice's alone is updated.
5. **The row is free again before the labels land (accepted as a known limit).** A second press
   then forces Structure again, which replays its checkpoint and queues the labels again: a wasted
   replay, not a wrong state. A controller that tracks Structure and its labels as one lifecycle is
   more machinery than the case is worth today.
6. **Signposts (accepted).** structure-step.md's "not on Metadata, use the CLI" line, StructureNotice's
   comment, and the regenerated command-pick catalogue.

## GPT Sol's code review, and what it fixed

[The answer](261029l-re-run-structure-code-review-sol.md) (exit 0). It fixed these inside the stage, and I read the diff and re-ran the gates:

1. **`fitsTree` is now a bijection over `partsOf`**, not a subset check. The subset check kept an
   old arc when the tree had *gained* a part, and it kept duplicate entries. It also skips
   depth-one supplements, as the generator does. It moved to `src/tree-parts.ts` and is
   re-exported from `src/arc.ts`. The generator writes exactly one entry per `partsOf` part
   (`buildArc` refuses anything else), so a generated arc meets it. On the local shelf,
   144 of 145 stored arcs pass, so the check does not hide and re-buy arcs wholesale.
2. **Public and private-link readers** (`publicArticle` in src/public/dto.ts) got the same check.
   They cannot repair an arc, because `useArc` is owner-only, so a bad one is simply left out and
   no request starts.
3. **Reverted: `fitsTree` in `/api/arc` and in Metadata's `isCurrent("arc")`.** Sol added both so
   that the route could not hand back as ready an arc the payload had left out. That broke
   tests/freshness-deciders-agree.test.ts: the page would disagree with the queue's decider. And a
   route saying stale while the runner says current would have `useArc` post jobs that skip. It is
   not needed on the real path either. After a re-cut, the arc's stamp is over the old tree's
   nodes, so the stamp alone calls it stale. tests/arc-fits-tree-pg.test.ts now asserts exactly
   that, with today's tree as the control. Only a hand-damaged arc with a current stamp stays
   inconsistent (below).
4. **Tests**: there are now a real `DockCommandBar` test (the row is absent with the switch off,
   present with it on, navigates there and sends no POST), an exact-request test for
   *Structure › Run again*, and a Postgres test for `loadArc`. The Postgres lane ran here and
   passed, though it could not run in Sol's sandbox.

Reported and not fixed: a hand-damaged arc whose freshness stamp is still current is now refused
by the payload, but the unforced arc runner may trust the stamp and not rewrite it. That is
corrupted stored data, not this path, so it is left alone.

## What waits

The box's OpenRouter key is over its limit until 1 November, so no real Structure run is possible
here. Tests use the existing mocked job paths. Greg can see the new Structure on that paper only
after the deploy *and* the key reset, by pressing *Structure › Run again*.

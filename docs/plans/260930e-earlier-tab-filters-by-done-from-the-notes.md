# The Earlier tab says which reports are done, and filters by it — derived from the notes

[SPIDERYARN-READING2-63](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-63), report
`spya-bfcvxg`, 2026-09-30, `kind=suggestion`, from Greg (admin).

> In the feedback dialogue, there's an earlier tab, which is great. It would be nice if we could
> provide a way to filter to things that have or have not been achieved and deployed. In the past,
> this might not have been possible because you may not have had access to the production database,
> but I think we do now have the .env.prod database keys, so it should be possible to mark feedback
> rows as achieved, and you have my permission to do that.
>
> — Greg, 2026-09-30

Follows [260916c](260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md), whose § Deferred
named this as the harder later step.

## The decision: derive it, don't mark it

Greg offers the obvious design — a status column on `feedback`, set by an agent holding the
production keys. **This plan does not take it**, and the reason is the thing it would have to be kept
in step with.

Every report already ends in a note under `docs/user-feedback/` that names one of three endings
([feedback-reports.md § Three ways a report ends](../project/feedback-reports.md)). That note is
mandatory, it is written by the session that did the work, and it lands on `dev` in the same push
as the work (or after it). So:

- **"Achieved"** is already recorded — in the note. A column would be a second copy, written by a
  second actor (whoever holds production keys, at some later time), and the two would drift the
  first time a sweep skipped the write. Report sessions run unattended on pool accounts and do not
  write to production; making them do so for bookkeeping is the wrong direction.
- **"Deployed"** comes free. If the notes are compiled into the server bundle, then the production
  server knows about a note **only once the commit carrying it has been deployed** — and the note
  never lands before the work it records. So on production, "this build has a *shipped* note for
  this report" means "the fix is live". No deploy log, no commit lookup, nothing to update after a
  deploy. On a dev server it means "on `dev`", which is also true.

So nothing is written to the production database, now or later, and there is no backfill to run
there. What needs backfilling is **the notes**, which is a repo change.

**The one thing it cannot say** is "achieved on `dev`, not yet live" to a reader on production:
production cannot see `dev`. Deploys happen several times a day, so the gap is hours. Named in
§ Deferred.

## Design

### The note gains a header

Every note starts with a small fenced block, before the title:

```
---
reports: spya-bfcvxg
ending: shipped
---
```

- `reports` — the feedback row id(s) (`report_id` in the Sentry issue's tags; the same id is the
  `feedback.id` column), comma-separated when one note records several reports.
- `ending` — `shipped` | `declined` | `awaiting`, the three endings, lower-case. It is the note's
  **current** ending: when Greg answers an awaiting one, the header is edited, not a second note
  added.
- `parts` — optional, only on a report split into several queue entries: how many entries (and so
  notes) it was split into.

`reports: none` is allowed for the one note whose report never had a row id (relayed by the
Overseer, `260929_0429-animated-wordmark-on-more-pages.md`); it contributes nothing to the map.

**A report's status combines its notes** — `awaiting` if any note is awaiting, **or if a split
report has fewer notes than its `parts`** (a half not yet started has no note, so without `parts` it
would be invisible — report 41, [feedback-reports.md](../project/feedback-reports.md) on split
entries; GPT Sol, plan review P1); otherwise `shipped` if any is shipped (some change asked for
shipped — which is what the label claims); otherwise `declined`.

### The notes are compiled into a map the server imports

`scripts/feedback-endings.ts` reads `docs/user-feedback/*.md` (not `awaiting-approval.md`), parses
each header, and writes **`src/feedback-endings.generated.ts`**: one `"spya-…": "shipped",` line per
report, sorted by id. Sorted random ids mean two sessions' additions are rarely adjacent, so merges
rarely conflict; when they do, the resolution is to re-run the script.

Why a committed file rather than a build step: the dev server loads `src/routes.ts` through a plain
Node `import()` from `vite.config.ts`, so a Vite `import.meta.glob` over the notes would work in the
API build and in vitest but not on a dev server; and the API build does not ship `docs/`. A
generated module works in all three and is boring.

**`tests/feedback-endings.test.ts`** keeps it honest:

- the committed map equals what the script produces from the notes now (the script exports its pure
  function; the test calls it) — so a note written without re-running the script goes red at
  `npm test`, with the command to run in the failure message;
- every header present has a known ending and well-formed ids — a headerless note deliberately stays
  out of the map and reads as not shipped, as § What stays unwritten explains;
- the combination rule above, on hand-made inputs.

### The wire shape gains one field, and the read gains one parameter

- `EarlierFeedback` gains `shipped: boolean` (named *shipped*, not *done*, after the plan review:
  it claims a change went out, not that everything asked for was achieved). **Not the three-way ending**: a reader who is not Greg
  does not need to be told a report was declined or is waiting on the administrator in a list whose
  question is "did anything come of this"; *done* is the claim this list can make, and "not done" is
  honest about the rest. (Showing *declined* to its author is a real question, deferred.)
  `shipped` is true exactly when the combined ending is `shipped`. **The route computes it** from
  the map for every row, filtered or not; the store keeps returning four fields.
- `GET /api/feedback?show=shipped|unshipped` (absent = all). **The filter is on the server**, not over the
  50 rows the client already has: Greg has filed well over 50 reports, and a client-side "not done"
  over the newest 50 would silently drop the older ones — the very ones most likely to be not done.
  The route turns the map into the list of done ids and hands it to the store; the store adds
  `id = any($ids::text[])` or `not (id = any($ids))` **beside** the owner predicate, which stays exactly as
  it is. Any other value of `show` is a 400.
- `listMine(limit, filter?)` — the filter is `{ ids: readonly string[]; keep: "in" | "out" }`, so the
  store knows nothing about notes.

**This does not change a defence.** The owner predicate (`owner_id = currentOwnerId()`) is unchanged
and still the only owner scoping; the new predicate can only narrow a reader's own rows. The map
holds report ids and endings for every reader, but it lives in server code and is used only as a
lookup against the reader's own rows; nothing sends it whole. No RLS, gate, auth or admin change.

### The dialog

- Above the list, three small toggle buttons: **All · Shipped · Not shipped**, `aria-pressed`, `type="button"`.
  Default All. State is **keyed by filter**: each filter has its own loading/failed/loaded state, read
  the first time it is chosen in an opening and kept after. One generation counter per opening; a
  response is stored under the filter that asked for it, and dropped if the dialog closed since.
  Retry re-reads only the filter showing.
- Each shipped row shows a small **Shipped** marker in its meta line (date · kind · Shipped), with a
  `title`: "We shipped a change for this, and it is in the version of Spideryarn you're using." —
  the "deployed" half of the claim, in words.
- Empty states per filter, said literally: "None of your reports has a shipped change yet." / "Every
  report you've sent has a shipped change." The "Showing your 50
  most recent" line applies within the filter.

### Backfill: the notes, not the database

All 145 notes, most without an id and with the ending phrased in prose. A Sonnet subagent looked up
each note's Sentry short id's `report_id` tag, one issue at a time (bulk Discover queries do not see
feedback issues), and classified the ending from the note's own text. **Not** from the `spya-…` ids
already near the top of some notes: several of those are article or session ids. Two lookups
(2A, 4K) were re-checked against Sentry by hand and matched. The calls worth knowing:

- **Declined (3):** 15 (answered, no change), 23 (Greg: "Nothing — close it"), and M, the
  2026-09-02 test submission, whose note says "nothing to build and nothing to decline" — declined
  is the nearest ending, and it reads as *not shipped*, which is true.
- **Awaiting (1):** 5J, the only line on `awaiting-approval.md` as awaiting.
- **Shipped with a deferred or declined half:** 12, Y, 19, 21, 5C, 5Q — shipped, since the label
  claims a change went out, not that everything asked for did.
- **Split:** 41 has two notes, both shipped; both carry `parts: 2`.
- **No row id:** the wordmark note (`260929_0429-…`), relayed by the Overseer without a Sentry
  issue: `reports: none`.

149 reports: 145 shipped, 3 declined, 1 awaiting (including this report's new note).

**Nothing in the production database is touched**, so there is no command for Greg or the Overseer
to run. Greg's permission to mark production rows is noted and not needed.

### What changes for report sessions

Nothing is required of them yet — see the next section. A session that knows about the header
writes it and runs `npx tsx scripts/feedback-endings.ts`; one that does not leaves its report reading
*not shipped* until somebody adds it.

### Known limits, accepted

- **Report ids are unique per owner, not globally** (`(owner_id, id)` is the key; the browser
  mints the id). The map is keyed by bare id, so a reader whose report id happened to equal one of
  the ~150 in the map would see their own report marked shipped. Six base-36 characters and a few
  hundred rows make a coincidence vanishingly unlikely, and a deliberate one fools only its maker,
  on their own row — the owner predicate still means nobody sees anyone else's. Keying by owner
  would mean committing owner UUIDs to the repo; keying by `sentry_event_id` fails for a report
  that never mirrored. (GPT Sol, plan review P1-2: noted, not taken.)
- **A report with no note is "not shipped"**, which is the safe direction: the label is never
  claimed without a note saying so. The test-submission note gets `ending: declined` (nothing was
  built; that is what *not shipped* means).
- **A reverted change leaves its note saying shipped.** Rare; the reverting session should edit the
  header. Named in the header comment of the generated file's script.
- **A merge conflict in the generated file** is resolved by merging the notes and re-running the
  script — never by picking a side.

### What stays unwritten: the rule in feedback-reports.md

Adding "write the header and run the script" to
[feedback-reports.md § The note](../project/feedback-reports.md) changes a rule-bearing doc, which
goes to Greg as a before/after first ([edit-important-docs.md](../reusable/edit-important-docs.md)),
and this session is unattended. So **the test does not require a header**: a note without one is
simply not in the map (not shipped). Headers present must parse, and the map must match them.

**The cost of leaving it unwritten:** every report finished from now on reads *not shipped* until
its note gets a header. So this is the one thing in this plan waiting on Greg.

#### Proposed rule change, for Greg

In [feedback-reports.md § The note, in `docs/user-feedback/`](../project/feedback-reports.md),
after the paragraph that begins "It holds the reader's words verbatim":

**Before:** (nothing)

**After:**

> **It starts with a header** that the Feedback dialog's Earlier tab reads, to say which reports
> shipped:
>
> ```
> ---
> reports: spya-bfcvxg
> ending: shipped
> ---
> ```
>
> `reports` is the `report_id` tag on the Sentry issue (the feedback row id — not the article's
> `spya-` id), comma-separated for several, or `none`; `ending` is `shipped`, `declined` or
> `awaiting`, and is edited when the ending changes; `parts: N` goes on each note of a report split
> into N entries. Then run `npx tsx scripts/feedback-endings.ts` and commit what it changes with
> the note. `feedback.md` § Shipped or not.

And the sweep's status write, which already reads each note's ending, could read the header instead
of the prose — a follow-up, not needed for this.

## Simpler option passed over

**Client-side filter over the 50 already fetched**, no server change: rejected because it silently
misses everything older than the newest 50, and Greg — the reader who asked — is past 50.

**A status column set by hand** (Greg's suggestion): rejected above — a second copy of the note's
ending, written later by someone else, plus a production write per report forever, and "deployed"
would still need deriving or a second column.

## Deferred

- **"On `dev`, not yet live"** as a third state on production. Would need the production server to
  know what is on `dev` (a fetch of the repo, or a column after all). Hours of gap; not worth it yet.
- **Showing *declined* / *waiting* to the reader**, with the reason. A product question for Greg:
  telling a stranger "declined" wants a sentence of why, which today is in a note written for us.
- **The same marker on `/admin/feedback`.** One column; cheap, but not asked for.
- **A link from a done row to what changed** (the changelog entry). Nice; needs the note → changelog
  join.

## GPT Sol plan review

`gpt-5.6-sol`, high effort, read-only; verdict **RETHINK**, eight findings. What changed:

- **P1, split reports** — an unstarted half has no note, so "any shipped" would claim the report.
  Taken: `parts: N`, and fewer notes than parts reads as awaiting.
- **P1, ids unique only per owner** — noted, not taken; § Known limits says why.
- **P1, a missing note is invisible** — taken as a statement of the default (no note ⇒ not
  shipped, the safe side), plus explicit handling of the two odd notes (test submission,
  `reports: none`). The one-off comparison against production rows it suggested is not done: this
  session does not read production.
- **P2, a revert leaves a note saying shipped** — accepted as a limit; the claim stays "is in the
  version you're using", because that is what Greg asked for and a revert of shipped feedback work
  is rare.
- **P2, the seam** — the store returns four fields; the route adds `shipped` on every path.
- **P2, vocabulary and caching** — renamed *done* → *shipped*, empty states said literally, and
  the client's state keyed per filter with a per-filter request sequence (tests for out-of-order
  answers and a late answer after close).
- **P3, SQL** — one bound `text[]` with each element quoted; tests for empty sets, both modes,
  a colliding id across two owners, a match older than the cap, and hostile element text.
- **P3, rule doc** — `feedback-reports.md` left alone; § Proposed rule change above.

## Stages

1. Plan + GPT Sol plan review (read-only).
2. Script, generated map, test; wire shape, route, store; dialog filter and marker; tests.
3. Backfill note headers; regenerate; docs (feedback.md, feedback-reports.md).
4. GPT Sol code review (fixes in place), gates, commit, push, note.

## Outcome

(filled in at the end)

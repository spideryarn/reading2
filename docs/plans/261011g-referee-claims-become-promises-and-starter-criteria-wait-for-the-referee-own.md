# Referee's Claims become Promises, and the starter criteria wait for the referee's own

Queue item qi-2dxtedww, from Greg's reply `spya-dbfeqh` to
[q-fkq30v](../user-feedback/questions/q-fkq30v.md) (report `spya-h5aypq`, SPIDERYARN-READING2-FZ).
Session `fbh5aypq-referee-promises-starters`, 2026-10-11.

## What Greg asked

> 1B
> 2A
> 3B
> 4 all? Use your judgment based on that combination of ease and value.
>
> — Greg, 2026-10-10 (reply `spya-dbfeqh` to q-fkq30v)

1B: Referee has a sub-mode called **Claims**, and since 2026-10-09 so does Sources. They are
different things. Referee's sets what the piece promises up front against the passages meant to
deliver it; Sources' checks the piece's claims against the web. Referee's becomes **Promises**, all
the way down ([rename-or-move.md § A rename on screen is a rename all the way down](../reusable/rename-or-move.md#a-rename-on-screen-is-a-rename-all-the-way-down)).

4A: starter criteria from the errors reviewers most often miss, **offered only after the reviewer
has written one criterion of their own**, so we do not anchor them (the research,
[261009b § 1](../research/261009b-what-a-peer-reviewer-needs-and-where-sources-and-referee-divide.md)).

2A and 3B need no work. 4B, 4C and 4D are separate queue entries.

## Part 1: Claims → Promises

### What a grep finds, before and after

| Thing | Today | After |
|---|---|---|
| Chip label | Claims | **Promises** |
| URL value | `?referee=claims` | `?referee=promises` (old value lifts) |
| Files | `src/referee-claims.ts`, `src/referee-claims-run.ts`, `src/store/pg-referee-claims.ts`, `src/web/ClaimsPanel.tsx`, `src/web/useClaims.ts`, `evals/referee-claims.ts`, `tests/referee-claims*.test.*`, `tests/store-pg-referee-claims.test.ts` | `referee-promises…`, `PromisesPanel.tsx`, `usePromises.ts`, … |
| Types and functions | `Claim`, `ClaimPassage`, `ClaimsRun`, `ClaimsFinish`, `validateClaims`, `runClaimsStream`, `ClaimsBand`, `refereeClaimsStore`, `RefereeClaimsStore`, `runRefereeClaims`, `pullingClaims`, `CLAIMS_*` … | `PaperPromise`, `PromisePassage`, `PromisesRun`, `PromisesFinish`, `validatePromises`, `runPromisesStream`, `PromisesBand`, `refereePromisesStore`, … |
| Route | `/api/referee/claims/:slug` | `/api/referee/promises/:slug` |
| Model job (`AiJob`), its tier and effort rows | `referee-claims` | `referee-promises`; `RENAMED` in `cost-categories.ts` gains `referee-claims → referee-promises` (`ai_calls.job` is append-only) |
| Env var | `SPIDERYARN_REFEREE_CLAIMS_MODEL` | `SPIDERYARN_REFEREE_PROMISES_MODEL` (set nowhere: not in the box's `.env.local`; Vercel lists only `SPIDERYARN_OWNER_ID`, per 261009w's check) |
| Log / Sentry route tag | `route: "referee-claims"` | `"referee-promises"` |
| Table | `referee_claims` | `referee_promises` |
| Columns | `claims`, `claims_omitted` | `promises`, `promises_omitted` |
| Constraints | `referee_claims_status`, `referee_claims_empty_unless_done`, the two FKs, the pkey | `referee_promises_…` |
| Stale-notice mode word | `claims` | `promises`, with `claims` in `RETIRED_STALE_NOTICE_MODES` |
| Export | `referee-claims.json`, `augmentations/referee-claims.json` | `referee-promises.json`, … |
| Auto-run target | `"claims"` (`auto-run-targets.ts`) | `"promises"` |
| Reader copy | "Pull the paper's claims", "the claims the paper makes", … | "promises" where the word names this list or an item in it |

**The naming rule for builders.** `Promise` alone is the JavaScript global and is never used as a
type name: one item is a `PaperPromise`. Anything about the list, the run, the panel, the store or
the job takes `Promises`/`promises`. **No blanket replace on `claim`**: it also means Sources'
Claims (`sources-claims`, `SourcesClaim…`, `ReceptionAndClaimsPanel`), a comment's or upload's
*claim* (row claiming, `claimUpload`, `beginAnswer`'s claim), and ordinary English. Each hit is read
and decided.

### What keeps its word, on purpose

- **The prompt's text, and the JSON the model answers in.** The prompt asks for "the claims the
  paper makes up front", which is the precise English for what the model should find; the panel
  calls the list *promises* because that is what it is for a referee (what the paper said it would
  deliver). Changing a prompt is a measured change ([prompting-guide.md](../project/prompting-guide.md)),
  and this work is a rename. So the model's wire keys stay, and with them **the stored item's inner
  key `claim`** (the sentence's text) inside the `promises` jsonb: it is the model's word for the
  sentence, and renaming it would need every stored row rewritten and a reader for both shapes
  through the deploy (261009w F4 kept inner keys for the same reason). A comment at the type says
  so.
- **Prompt version tags and hash namespaces**, if any: changing them marks every unchanged run
  outdated (261001r F1, F2).
- **History**: `docs/plans/`, `docs/postmortems/`, `docs/user-feedback/`, `docs/research/`,
  `docs/investigations/`, `evals/results/`, applied migrations and their snapshots, the changelog
  ndjson, frozen eval inputs (`evals/command-pick/catalogue-261002c.ts`, `evals/command-pick/results`).
  Links to renamed live files are retargeted, path only.
- **The postmortem title** `260901e-claims-shipped-filesystem-only…` and similar: history.

### The database: rename in place, with a view for the old code

`npm run deploy` applies migrations, then waits for Vercel; for those minutes production runs the
old code against the new schema. The old code reads `referee_claims` in the Promises GET and run,
and in every article's export (`readArticleRows`). So one migration, as 261009w did for
`sources_claim_checks`:

```sql
ALTER TABLE spideryarn.referee_claims RENAME TO referee_promises;
ALTER TABLE spideryarn.referee_promises RENAME COLUMN claims TO promises;
ALTER TABLE spideryarn.referee_promises RENAME COLUMN claims_omitted TO promises_omitted;
-- constraints renamed (ALTER TABLE … RENAME CONSTRAINT), the pkey index too
CREATE VIEW spideryarn.referee_claims AS
  SELECT article_id, owner_id, status, promises AS claims, model,
         promises_omitted AS claims_omitted, error, created_at, source_hash, …every column…
  FROM spideryarn.referee_promises;
-- grants as 261009w's view
```

A view over one table whose columns are plain references (renames included) is auto-updatable, so
the old store's inserts, updates and `ON CONFLICT (article_id)` upserts go through it. **A test
proves the old store's statements work through the view** on the test database (copied from
261009w's view test). The old code catches no constraint by name (to check); if it does, those
constraint names stay until the contract, as 261009w F3.

`stale_notice_dismissals.mode`'s CHECK is widened to admit `promises` beside `claims`; old rows keep
`claims` and are read through `RETIRED_STALE_NOTICE_MODES`.

**The contract** (drop the view; rewrite `claims` stale-notice rows and narrow that CHECK; rename
any constraint left with its old name) is safe only after this deploy is live, so it is written as
a queue-item draft for the Overseer, not a migration now.

### What is still accepted

- **A tab open across the deploy** calls `/api/referee/claims/…` and gets a 404 until it reloads.
  Referee is behind the experimental switch; a second route for one deploy is not worth it. To
  check: what `useClaims` does on a 404 (if it offers a paid re-run as "not made yet", the
  reader's press costs one call; nothing is lost).
- `?referee=claims` from an old link lifts to `promises` (red-first test).

### Where else the name lives

`referee-views.ts` (`REFEREE_VIEWS`), `RefereeMode.tsx`, `mode-catalog.ts` (the Referee row's
words; Referee's sub-mode row, if any, and its aliases — `claims` is Sources' to keep, so it is not
an alias here), the command-pick catalogue regenerated, the help page and corpus regenerated, the
help image if it shows the chip (left; the next screenshot pass updates it), `referee.css`,
`docs/project/referee-mode.md` § 2 and every live doc that names Referee's Claims, `CLAUDE.md`'s line
if it names it.

## Part 2: starter criteria wait for the referee's own

### What is there today

Criteria's form already has six **presets** ("Technical soundness", "Strength of evidence",
"Significance", "Controls", "Presentation", "Prior work", from Nature, PLOS ONE, eLife and NeurIPS
forms: `CRITERION_PRESETS` in `src/web/CriteriaPanel.tsx`). Pressing one fills the form; nothing
runs. **They show from the first visit**, before the referee has written anything — exactly the
anchoring the research warns about.

### The change

1. **The presets are hidden until the referee has at least one saved criterion.** Since no starter
   is on screen before that, the first criterion is necessarily one they wrote. Deleting their only
   criterion hides the starters again. Until then, one line under the form says they will appear:
   *"Starters appear here once you have written a criterion of your own, so they do not set the
   agenda."* (wording to settle in the build).
2. **A second group, from what reviewers most often miss.** Reviewers given papers with nine planted
   major errors found about 2.6 (Schroter et al., *J R Soc Med* 2008, 607 reviewers). The research
   doc names the kinds of error seeded: do the conclusions follow from the results; is the control
   adequate; do the figures say what the text says; are the limitations stated. We add, each in
   plain words and editable on arrival:
   - **Conclusions** — "Do the conclusions follow from the results the paper reports, or do they go
     further?" (for / against: *goes beyond the results* / *follows from the results*)
   - **Abstract vs results** — "Does the abstract say the same thing as the results section?"
     (for / against: *the abstract says more or differs* / *the abstract matches the results*)
   - **Numbers** — "Do the numbers in the text agree with the tables and figures they cite?"
     (single)
   - **Sample size** — "Is the number of participants or samples justified, and is the
     calculation reported?" (single)
   - **Allocation** — "Could the way groups were assigned or samples chosen bias the comparison?"
     (single)
   - **Limitations** — "Does the paper state its limitations, and are they the important ones?"
     (single)
   "Controls" stays in the first group (it is both). The two groups are labelled by where they come
   from: *From referee forms* and *What reviewers often miss*, with the second group's card citing
   the study in one sentence.
3. **Never run without a press**, as today: a starter fills the form; *Run this criterion* runs it.

**The study's own error table could not be read** (PMC served a captcha to the research subagent;
bmj.com and SAGE refused). The six starters above are framed as the kinds of error the research
doc's summary names, not as a transcription of the study's table, and the card says "kinds of
error reviewers often miss in studies like this" rather than quoting the nine. If a later pass reads
the table, the list is a constant to adjust.

### Not a prompt change

The starters are reader text that the referee may send to the existing criteria prompt as their own
criterion. Nothing about the prompt changes. They are written in the plain words
[prompting-guide.md](../project/prompting-guide.md) asks for anyway, because the referee reads them
first.

### Tests (red first)

- No starter is rendered while the criteria list is empty (loaded or not); they render once one row
  exists; they hide again after the last row is deleted.
- The two groups render with their headings; pressing a "often miss" starter fills text, kind and
  poles and runs nothing.
- The hint line shows only while starters are held back.

## Stages

1. **The rename** (code, migration with view, tests renamed, old-URL lift, stale-notice alias,
   catalogues regenerated, docs). Built by an Opus subagent. Done when
   `git grep -n -i -E 'referee[-_ ]?claims|refereeClaims|ClaimsPanel|useClaims|ClaimsRun|validateClaims|runClaimsStream|ClaimsBand'`
   outside history finds only: the view and the migration, `RENAMED` / `RETIRED_*` aliases, the
   lift, and comments saying *"called Claims until 2026-10-11"*.
2. **The starters** (CriteriaPanel, tests, referee-mode.md § 1).
3. **GPT Sol code review** (write-capable), gates, a Sonnet browser pass (the chip reads Promises;
   `?referee=claims` lands on Promises; a run streams; starters absent on a fresh article, present
   after one criterion), the contract draft, the bookkeeping, land on `dev`.

## Passed over

- **Rename in place without a view** (the Skim and Learn precedent; the CLAUDE.md beta licence).
  One statement shorter, and every article's export fails in production for the minutes of the
  deploy. The view costs one statement and one contract line.
- **Rename the stored item's inner `claim` key too.** A grep would find one name; it would need every
  stored row rewritten, a dual-shape reader through the deploy, and either a prompt change or a
  translation layer between the model's wire and storage. Not worth it for a field that holds the
  paper's own claim sentence.
- **Keep the presets visible from the start and only add the new group.** Ignores the anchoring
  condition Greg's answer carried over from the question.
- **Replace the form presets with the "often missed" ones.** The form presets are what venues ask
  referees to judge, which is a different and also useful starting point; two labelled groups keep
  both and say where each came from.
- **Keep `claims` as a command-bar alias for Referee.** Sources owns "Claims" now; the alias would
  send that word to the wrong mode.

## After GPT Sol's plan review

[261011g-plan-review-sol.md](261011g-plan-review-sol.md): **BUILD WITH CHANGES**. The view itself is
sound (Postgres carries insert, update, delete, `RETURNING` and `ON CONFLICT DO UPDATE` through a
plain-reference view; the old store catches no constraint by name).

- **F1 (P1), overruled: no old-route alias.** Sol showed the old hook does not read a 404 as "not
  made yet": a stale tab's GET shows a load failure, and a stale tab's re-run press shows an empty
  run and then an error. Nothing stored is touched, and a reload fixes it. 261009w kept aliases
  because its mode is every reader's; Referee is behind the experimental switch, and the alias here
  would have to translate every SSE frame the old hook reads, for one deploy. Named here so it is a
  decision.
- **F2 (P2), accepted:** the `claims → promises` lift goes through boot, in-app navigation and Back,
  and the remembered last view, as one transform, each under a test.
- **F3 (P2), accepted:** the gate is a **latch**, set by a saved row or by the referee's own press
  of Run, and never cleared by a delete: deleting cannot undo anchoring, and the starters would
  otherwise flicker. Neither the starters nor the wait line show before the opening read lands.
  No chat or MCP path creates a criterion; a comment says one that ever does must not set it.
- **F4 (P2), accepted:** the group was called *What reviewers often miss* and listed Allocation,
  which the research says reviewers caught *best*. It is now **Worth a second look**, five starters
  without Allocation, and the study is cited only for the aggregate (fewer than three of nine).
- **F5 (P2), accepted:** the job alias goes in `RETIRED_JOBS` (`src/step-order.ts`); `RENAMED` is
  gone.
- **F6 (P3), accepted:** the `.clm-` CSS namespace and the slash-form route join the rename and the
  done-grep.
- Keeping the inner `claim` key: Sol agrees.

## Log

- **Merge of `origin/dev`** (`2a21dced5`). Dev had added Referee › Notes as a sixth sub-mode and
  the `comments_severity` migration. This migration is restamped after it (journal idx 194, its
  snapshot reparented onto dev's), and the sub-mode order is now criteria, promises, mirror, notes,
  candidates. `db:chain` is clean; `db:generate --allow-empty` reports no changes.
- **GPT Sol's code review**, [261011g-code-review-sol.md](261011g-code-review-sol.md): **LAND AFTER
  FIXES**, which it made. The main one: the starter latch moved out of the panel into `useCriteria`
  (`startersUnlocked`), held in sessionStorage per reader, article and tab
  (`criterionStarterLatch`). It also fixed `evals/footnote-digits/snapshot.sql`, which still named the
  dropped `claims` column; made the view's grants and final check stricter; did more renames; put
  the starter groups in fieldsets with legends; and edited the copy. Each change was read before
  it was accepted.
- **Gates.** `npm run typecheck` passes after Sol's edits. The full `npm test`, run before Sol's
  edits: 1958 files passed and one failed, `check-exit-does-not-truncate`. That test measures pipe
  timing and shares nothing with this change, and it passed on a re-run. The 31 files Sol touched,
  plus doc-links, help-corpus and the old-address and old-name tests, were re-run afterwards: all
  672 tests pass. The 8 expand tests run on the private-Postgres lane.
- **Seen red.** Two faults were put into the view: `finished_at` missing, then two columns in
  swapped order. In both cases the migration's own final check refused to apply it, so every
  test lane failed to migrate. The expand test sits behind that check, so the check is the guard
  that has been seen failing. Both faults were edited back out.

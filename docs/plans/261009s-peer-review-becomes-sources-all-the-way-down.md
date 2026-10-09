# Peer review becomes Sources, all the way down (and 261009l's Stage 3)

Report `spya-c2qmbg` (SPIDERYARN-READING2-BV), question
[q-xf2xvb](../user-feedback/questions/q-xf2xvb.md), queue item qi-m9tmnpy3 (which supersedes
qi-j8py7rjw, the held Stage 3 of
[261009l](261009l-peer-review-mode-merges-citations-and-debate.md)). Session
`fbc2qmbg-sources-rename`, 2026-10-09.

## What Greg asked

The question asked whether the merged Citations + Debate mode should keep the name "Peer review",
now that it clashes with Referee ("For peer reviewers"). A keep it, B rename it to a word with no
clash such as "Context" or "Sources", C rename Referee.

> B Sources.
>
> Rename comprehensively, eg including docs, code, database etc
>
> — Greg, 2026-10-09 (reply `spya-egmn6r` to q-xf2xvb)

So the mode is renamed **Sources** all the way down
([rename-or-move.md § A rename on screen is a rename all the way down](../reusable/rename-or-move.md#a-rename-on-screen-is-a-rename-all-the-way-down),
[mode.md § Renaming a mode](../project/mode.md#renaming-a-mode)), and the stored names that still
say `citations` and `debate` are renamed after the sub-modes they now are (261009l § Stage 3, which
was held only for this answer).

The brief adds one standard beyond the precedents: **the deployed code and the database must never
be out of step in a way that breaks a reader.** The Skim and Learn renames accepted a few broken
minutes between the migration and the new code going live; this one does not (§ The database).

## The names

One name per thing. The left column is what a grep finds today; the right is what it finds after.

| Thing | Today | After |
|---|---|---|
| Label on screen | Peer review | **Sources** |
| Mode word, `?mode=` | `peer-review` | `sources` |
| Sub-mode param | `?peer-review=` | `?sources=` |
| Sub-mode words | `bibliography`, `reception`, `claims` | unchanged (they live under `?sources=`) |
| Mode identifiers | `PeerReviewMode`, `PEER_REVIEW_VIEWS`, `PeerReviewView`, `peerReviewParam`, `liftLegacyPeerReview`, `peer-review-counts.ts`, … | `SourcesMode`, `SOURCES_VIEWS`, `SourcesView`, `sourcesParam`, `liftLegacySources`, `sources-counts.ts`, … |
| Folder | `src/web/modes/peer-review/` | `src/web/modes/sources/` |
| Help page | `help/pages/modes/peer-review.md`, `/help/mode-peer-review` | `…/sources.md`, `/help/mode-sources` |
| Project doc | `docs/project/peer-review.md` | `docs/project/sources.md` |
| `chatfrom=` word | `peer-review` | `sources` |
| **Bibliography** step / job | `citations` | `bibliography` |
| Its column | `article_revisions.citations` | `article_revisions.bibliography` |
| Its route | `/api/citations/:slug` (+ `/:id/investigate`) | `/api/bibliography/:slug` (+ `/:id/investigate`) |
| Its files | `src/citations.ts`, `CitationsPanel.tsx`, `useCitations.ts`, `styles/citations.css`, `citations-list-not-found.ts`, `evals/citations-*.ts`, `tests/citations*.test.*` | `bibliography`-named |
| Its types | `Citations`, `PublicCitations`, `CitationsResponse`, `CitationsFound`, `CitationsOrigin`, `loadCitations`, `generateCitations`, `CITATIONS_*`, … | `Bibliography`, `PublicBibliography`, … |
| Its root CSS class | `.citations` | `.bibliography` |
| **Reception** step / job | `debate` | `reception` |
| Its column | `article_revisions.debate` | `article_revisions.reception` |
| Its route | `/api/debate/:slug` | `/api/reception/:slug` |
| Its files | `src/debate.ts`, `debate-journal.ts`, `debate-registry.ts`, `debate-synthesis.ts`, `debate-themes.ts`, `web/DebatePanel.tsx`, `useDebate.ts`, `debate-levels.ts`, `debate-order.ts`, `debate-threads.ts`, `styles/debate.css`, `evals/debate/`, `tests/debate*.test.*` | `reception`-named |
| Its types | `Debate`, `DebateLean`, `DebateBears`, `ClaimDebateRow`, `PublicDebate`, `generateDebate`, `DEBATE_*`, … | `Reception`, `ReceptionLean`, `ReceptionBears`, `ClaimReceptionRow`, `PublicReception`, `generateReception`, `RECEPTION_*`, … |
| Its CSS prefix | `dbt-` | `rcp-` |
| Its URL words | `?debateby=`, `?debatethread=` | `?receptionby=`, `?receptionthread=` |
| Its env var | `SPIDERYARN_DEBATE_MODEL` | `SPIDERYARN_RECEPTION_MODEL` |
| Its eval | `npm run eval:debate` | `npm run eval:reception` |
| **Claims** step / job | `debate-claims` | `sources-claims` |
| Its column | `article_revisions.debate_claims` | `article_revisions.sources_claims` |
| Its route | `/api/debate-claims/:slug` (+ `/checks`) | `/api/sources-claims/:slug` (+ `/checks`) |
| Its files and types | `debate-claims.ts`, `useDebateClaims.ts`, `DebateClaimList`, `PublicDebateClaimList`, … | `sources-claims.ts`, `useSourcesClaims.ts`, `SourcesClaimList`, … |
| A reader's claim check: job | `debate-check` | `sources-claim-check` |
| …its table | `debate_claim_checks` (+ its constraints and index) | `sources_claim_checks` (+ the same, renamed) |
| …its files and types | `pg-debate-claim-checks.ts`, `useDebateChecks.ts`, `debate-checks.ts`, `DebateClaimCheck`, `DebateCheckTarget`, `DEBATE_CHECK_*`, … | `pg-sources-claim-checks.ts`, `useSourcesClaimChecks.ts`, `sources-claim-checks.ts`, `SourcesClaimCheck`, `SourcesClaimCheckTarget`, `SOURCES_CLAIM_CHECK_*`, … |
| Chat origin values | `citations` (a cited work); `debate` (a claim **or** a lens) | `bibliography` (a cited work); `sources-claims` (a claim); `reception` (a lens) |
| Their CHECKs | `chat_threads_origin_debate`, `…_lens_debate_only` | `…_origin_sources_claims`, `…_origin_reception`, `…_lens_reception_only` |
| Public payload keys | `citations`, `debate`, `debateClaims` | `bibliography`, `reception`, `sourcesClaims` |
| Export files | `citations.json`, `debate.json`, `debate-claims.json`, `debate-claim-checks.json` | `bibliography.json`, `reception.json`, `sources-claims.json`, `sources-claim-checks.json` |
| Find-it job | `citations-find` (+ `SPIDERYARN_CITATIONS_FIND_MODEL`) | `citation-find` (+ `SPIDERYARN_CITATION_FIND_MODEL`), matching its file `citation-find.ts` and its rate bucket `citation-find` |

**The naming rule for builders**, so each hit is decided the same way: an identifier about the
Reception artefact (the `debate` step) takes `Reception`; one about the claims list (the
`debate-claims` step) or a reader's claim check takes `SourcesClaims` / `SourcesClaimCheck`; one
about the mode as a whole takes `Sources`; one about Bibliography's artefact (the `citations` step)
takes `Bibliography`. `DebatePanel` draws Reception and Claims; it becomes `ReceptionPanel` (its
Claims half keeps living in it, as today; splitting the 3,150-line file is not this work).

### What keeps its word, on purpose

- **"citation", singular, for one cited work or a web citation.** A bibliography is a list of
  citations, so the domain noun stays: `CitedWork`, `citedAt`, the `citation-*` files and jobs
  (`citation-investigate`, `citation-influence`, `citation-paper-passages`, `citation-lookup`), the
  `citation_finds` / `citation_investigations` / `citation_index_*` tables, the `cite-` CSS prefix on
  a work's row, `mark.cite` in the prose, `?citeby=` and `?citebar=` (they order and filter cited
  works). And everything that is chat's or a comment's **web** citation: the `Citation` type,
  `src/web/citations.ts`, the `citations` columns on `comments`, `chat_messages` and
  `glossary_lookups`, `collectCitations`, `url_citation`. None of these names the mode.
- **"debate" in prose and prompts.** The prompt text is unchanged ("the debate about this piece" is
  English), and so are Greg's quotes and comments that say *"Debate became Reception on
  2026-10-09"*.
- **Prompt version tags**: `citations/6`, `debate/7`, `debate-claims/1`, `debate-check/1`. They are
  stored in each artefact's `version` and in `revision_step_runs.prompt_version`; changing them would
  mark every unchanged list outdated (Skim precedent, 261001r F1). A comment at each says so, and
  the next real prompt change bumps it to the new word.
- **Input-hash namespaces** (any `"debate-…\n"` / `"citations-…\n"` literal fed to a hash): changing
  one makes every stored hash stale (261001r F2). Kept, with a comment.
- **History**: `docs/plans/`, `docs/postmortems/`, `docs/user-feedback/`, `docs/research/`,
  `docs/investigations/`, `docs/tutorials/`, `evals/results/`, applied migrations and their snapshots,
  `src/web/changelog-versions.ndjson`. Links to renamed live files are retargeted, path only.
- **`ai_calls.job` and `.step_name`**: append-only. `RENAMED` in `cost-categories.ts` gains
  `citations → bibliography`, `debate → reception`, `debate-claims → sources-claims`,
  `debate-check → sources-claim-check`, `citations-find → citation-find`.
- **Feedback rows**: evidence, kept as sent; `feedback-payload.ts` normalises a stale tab's old step
  names (its `RETIRED_STEPS` copy) and old mode words.
- **The retired words as aliases**: `RETIRED_MODES` gains `peer-review: "sources"` and keeps
  `citations`/`debate` (now pointing at `sources`); the Bibliography/Reception/Claims sub-mode rows
  keep `citations`, `debate`, `debate claims` and gain `peer review` on the mode row (so typing it
  still finds this mode, not Referee, as 261009l decided). The mode row's alias `sources` goes: it is
  now the label, which `tests/mode-catalog.test.ts` refuses as an alias.

### "Source" already means other things: how they are kept apart

The new word lands among at least eight older meanings: `sourceHash` (about 1,100 hits), the
imported article's `rawSource` / `SourceStore` / `raw_sources`, `SourceGuess`, `SourceScan`,
`PaperSource`, chat's web sources (`WebSources`, `.chat-sources`, `chat_messages.citations`),
`ThreadSource` (where a chat came from), Reception's own key sources (`keySources`, the web pages it
found), the queue's `--source` flag, and the Storage bucket `"sources"`. Nothing is renamed among
those, and **no builder runs a blanket replace on "source"**. Instead the mode only ever appears in
these forms, none of which collides today (checked: no such file, class, param or identifier exists):

- the mode word `"sources"` in `MODES` and `?mode=`, and the param `?sources=`;
- identifiers that **start** `Sources` / `SOURCES_` / `sources` followed by a capital
  (`SourcesMode`, `SOURCES_VIEWS`, `sourcesParam`, `SourcesClaimList`);
- the step `sources-claims`, the job `sources-claim-check`, the table `sources_claim_checks`;
- the files `src/web/modes/sources/`, `sources-counts.ts`, `sources-claims.ts`,
  `sources-claim-checks.ts`, `docs/project/sources.md`, `help/pages/modes/sources.md`.

So `git grep -E '\bSources[A-Z]|SOURCES_|sources-claim|"sources"|[?&]sources='` finds the mode and
nothing else. Within Reception, the found web pages stay "key sources" (`keySources`), which is
also what a reader would call them; the count chip that says *N sources* inside Reception is
unchanged. `thread-source.ts`'s constants (`SOURCE_DEBATE_CLAIM`, `SOURCE_CITED_WORK`, …) keep the
`SOURCE_` prefix that means "where a chat came from" and get the sub-mode word after it
(`SOURCE_SOURCES_CLAIM`, `SOURCE_RECEPTION_LENS`): ugly in one file, unambiguous.

## Old links still land

Each lift goes through the one canonicaliser 261009l built (`liftLegacyPeerReview`, renamed
`liftLegacySources`), which `settleAddress`, `liftedLegacyHref` and last-view's `restoredHref` all
reach, so boot, navigation, Back and a remembered last view agree:

| Old address | Lands on |
|---|---|
| `?mode=peer-review` (+ `&peer-review=X`) | `?mode=sources` (+ `&sources=X`) |
| `?mode=citations` (+ `citeby`, `citebar`) | `?mode=sources` (Bibliography), params kept |
| `?mode=debate` / `&debate=claims` / `&debateby=claim` | `?mode=sources&sources=reception` / `claims` |
| `?debateby=X`, `?debatethread=X` | `?receptionby=X`, `?receptionthread=X` |
| `?chatfrom=peer-review|citations|debate` | `?chatfrom=sources` |
| `/help/mode-peer-review`, `/help/mode-citations`, `/help/mode-debate` | `/help/mode-sources` |

Each row gets a test that is red first (`tests/peer-review-old-addresses.test.ts`, renamed
`tests/sources-old-addresses.test.ts`, gains the `peer-review` rows).

## The database: expand now, contract after the deploy

### Why not rename in place, as Skim and Learn did

`npm run deploy` applies migrations, then pushes and waits for Vercel
([deployment.md](../project/deployment.md)). For those minutes, and for as long as it takes if the
build then fails, **production runs the old code against the new schema**. Old code selects
`article_revisions.citations` / `.debate` / `.debate_claims` by name, so a column renamed in place
fails every read of a revision: every reader's article, not just this mode. That is the break the
brief rules out.

### Expand (ships with this work, one migration per renaming stage)

Everything the old code reads keeps existing and stays true; everything the new code reads exists
and is true; writes from either version are visible to both.

1. **Columns.** `ADD COLUMN bibliography`, `reception`, `sources_claims` (jsonb), copy from the old
   column, and one `BEFORE INSERT OR UPDATE` trigger on `article_revisions` that keeps each pair
   equal: on insert, whichever is null takes the other; on update, whichever changed is copied to
   the other (`IS DISTINCT FROM`, so clearing to null mirrors too). New code reads and writes only
   the new columns. The old columns stay **declared in `schema.ts`** as `legacy…` fields with a
   comment saying nothing reads them, so that the next `drizzle-kit generate` (by anybody) does not
   quietly propose dropping them before the contract.
2. **Step names in `revision_step_runs`.** The CHECK is widened to hold the old and the new names.
   Existing rows are **copied** under the new name (the old rows stay), and an `AFTER INSERT OR
   UPDATE OR DELETE` trigger mirrors any write on one spelling onto the other, guarded by
   `pg_trigger_depth()`. So a lease the old code takes on `citations` is seen by the new code as a
   lease on `bibliography`, and neither starts a duplicate run; a draft's copied runs carry both.
3. **Job step names.** Not rewritten in the expand. New code reads a job's old step names as new
   ones through `RETIRED_STEPS` (`src/step-order.ts`, read in `pg-jobs.ts § toJob` already, the
   Skim mechanism), which gains the three steps. A job the old code queues in the window is run
   correctly by the new code.
4. **Chat origins.** The CHECKs are widened to accept both spellings (and the shapes of each); rows
   are not rewritten; new code writes the new values and reads the old ones through one mapper
   (`thread-origin.ts`): `citations` → `bibliography`, `debate` with a block → `sources-claims`,
   `debate` with a lens → `reception`.
5. **The claim-checks table.** `ALTER TABLE debate_claim_checks RENAME TO sources_claim_checks` (its
   constraints and index renamed with it), then `CREATE VIEW debate_claim_checks AS SELECT * FROM
   sources_claim_checks`. A one-table view is auto-updatable in Postgres, so the old code's
   insert, update and select keep working through it; a test proves the old store's statements
   (including its `ON CONFLICT` against the partial unique index, if it uses one) work through the
   view on the test database. Grants on the view match the table's.
6. **The cost bucket CHECK** (`schema.ts`, the one naming `'debate-check'`) and any other CHECK that
   lists a renamed job: widened to both.

### Contract (after this work's deploy is live; queued, not shipped here)

A second migration, which by then only drops things no live code reads: the three old columns and
their trigger, the `revision_step_runs` old-named rows and mirror trigger (narrowing the CHECK), a
rewrite of `jobs.steps` / `jobs.reset` and of the chat origins to the new values (narrowing their
CHECKs), the `debate_claim_checks` view, and the widened bucket CHECK. Plus removing the `legacy…`
declarations from `schema.ts`. It is safe only once the expand's deploy is live, so it is **a queue
item for the Overseer** (`scripts/overseer-queue.ts`), filed by this work with the SQL drafted in
it, rather than a migration in `drizzle/` now, which `npm run deploy` would apply in the same
breath as the expand. The read-side aliases (`RETIRED_STEPS`, the origin mapper's old values) can
stay as aliases, as `trajectory` and `remember` do.

### What is still accepted

- **A tab open across the deploy** calls `/api/citations/…`, `/api/debate/…` or
  `/api/debate-claims/…` and gets a 404 in the band until it reloads (Skim precedent: one route
  per sub-mode, briefly, on a beta; a second path forever is the worse trade). This is the client
  being out of step with the server, not the database with the code; it is named here so it is a
  decision, not a surprise. Sol is asked to weigh it.
- **The IndexedDB offline copy** keyed on the old route paths is lost until fetched again (261001r
  F3, overruled there for the same reason).
- **`jobs.work_key`** hashes ordered step names; a job queued by the old code and re-queued by the
  new may not dedupe across the window. At worst one duplicate run (261001r F5).

### Locally

The suite runs on a private database built from the tree's own migrations
([testing.md](../project/testing.md)), so nothing needs the shared local database until the push.
The expand applies cleanly to old code by construction, so applying it to the shared local database
at push time does not break the other worktrees either; still, it is applied at push time and the
Overseer told. **Nothing is run against production.** The Overseer deploys.

## Stages

Each ends green (typecheck, the touched suites, doc-links), committed, and pushed to `dev` so that
the two later sessions naming this mode (`fbu62q09-metadata-ai-step-names`,
`fbh5aypq-peer-review-research`) pick up the new names.

### Stage 1: the mode word, Peer review → Sources (no database)

Label, `MODES`, `RETIRED_MODES`, `?sources=`, `chatfrom`, the folder, every `PeerReview*` /
`PEER_REVIEW_*` / `peerReview*` identifier, `peer-review-counts.ts`, the tests' names and helpers,
the mode catalogue (aliases above), the help page and its retired anchors, the command-pick
catalogue regenerated, `docs/project/peer-review.md` → `sources.md` and every signpost to it
(`CLAUDE.md`, `reading-view-overview.md`, …), every live doc that names the mode. The `peer-review`
lift rows (§ Old links) red first. Done when `git grep -i -E 'peer.?review'` outside history finds
only Referee's own words (*peer reviewer*, *For peer reviewers*), the retired-word aliases and
lifts, and comments that say *"called Peer review until 2026-10-09"*.

### Stage 2: Bibliography (`citations` → `bibliography`)

The step, job, column (expand migration, part 1 and the Bibliography rows of parts 2, 4 and 6),
route, files, types, constants, root CSS class, public key, export file, chat origin `citations`,
`citations-find` → `citation-find` and its env var, `RENAMED`, `RETIRED_STEPS` (both copies),
`MODEL_ENV_VAR`, `tests/db-step-constraint.test.ts`, `tests/env-names-are-inventoried.test.ts`, the
evals, `scripts/backfill-plain-titles.ts`'s column entry, `docs/project/citations.md` →
`bibliography.md` and its signposts. Decided by hand against § What keeps its word.

### Stage 3: Reception and Claims (`debate` → `reception`, `debate-claims` → `sources-claims`, `debate-check` → `sources-claim-check`)

The same list for the other two steps, plus the claim-checks table (expand part 5), the `dbt-` →
`rcp-` prefix (`styles/debate.css` → `reception.css`), `?debateby=` / `?debatethread=` with their
lifts, `evals/debate/` and `eval:debate`, the env var, the chat origin split, and
`docs/project/debate.md` → `reception.md`.

### Stage 4: review, browser, contract queued, land

GPT Sol code review (write-capable, fixes inside the work), the full gates, a Sonnet browser pass
(old links at desktop and phone width; each sub-mode opens; Ask in chat's way back from a work, a
claim and a lens; a visitor's band), the contract queue item, the bookkeeping (q-xf2xvb, the
report's note, `feedback-endings.ts`), and messages to the two sessions if they are live.

## Done is

- `git grep` outside history finds one name per thing: `peer.?review` only as above; `debate`
  only in prose, prompts, prompt-version tags, hash namespaces, retired aliases and lifts,
  `RENAMED`/`RETIRED_STEPS`, the expand migration and the `legacy…` declarations; `citations` (the
  mode's plural) likewise, and otherwise only as chat's/comments' web citations.
- Every old address in § Old links lands, under a test.
- The expand migration applies to the test database and the shared local one; the old code's
  statements still work against it (tested for the column pair, a step run lease and the claim-check
  view).
- `npm test`, `npm run typecheck`, doc-links green; on `dev`.

## Passed over

- **Rename in place, one migration (the Skim and Learn precedent).** Simpler by one migration and
  three triggers, and it breaks every revision read in production for the minutes of the deploy,
  or longer if the build fails after the migration ran. The brief rules that out.
- **Expand by adding columns, without triggers.** Old code's writes in the window (a Bibliography
  run finishing mid-deploy) would land only in the old column and vanish from the new code's view;
  a rollback would lose the new code's writes the same way.
- **Rewrite `revision_step_runs` in the expand.** Old code looking up `citations` would find no
  finished run and re-run the step (a paid call per article in the window), and a lease it held
  would no longer match its own `UPDATE`. The mirror trigger avoids both.
- **Keep the old API paths as aliases for one deploy.** It would spare a stale tab's 404, at the
  cost of two names per route until someone removes them; and the response shapes' public keys
  change anyway. See § What is still accepted.
- **Rename `citation` (singular) too.** It is the right word for one cited work and for a web
  citation, and it does not name the mode; renaming it would invent a worse word for 300 hits.
- **Bare `claims` for the Claims step.** Referee has a sub-mode and identifiers called claims;
  `sources-claims` cannot be confused with them (the brief).
- **Split `DebatePanel` into a Reception and a Claims panel while renaming it.** Worth doing some
  day; not inside a rename, where it would hide behaviour changes in a 3,000-line diff.

## Log

- 2026-10-09: prior-work check: nothing on `dev` renames the mode (`git log`, `docs/plans`); the
  question file is still `open` with the reply unquoted. Inventories by three Sonnet sweeps
  (debate ≈ 7,800 lines in 460 files incl. eval corpora; citations in 371 test files; peer-review
  555 hits in 142 files). `SPIDERYARN_DEBATE_MODEL` and `SPIDERYARN_CITATIONS_FIND_MODEL` are set in
  no environment (Vercel production lists only `SPIDERYARN_OWNER_ID`; not in `.env.local`), so
  renaming them drops no override.

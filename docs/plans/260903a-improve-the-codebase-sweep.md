# Improve the codebase — the 2026-09-03 sweep

The periodic whole-tree sweep from
[improve-the-codebase.md](../reusable/improve-the-codebase.md), run autonomously overnight. This is
the umbrella doc: everything found, clustered, scored, and an honest line on what is left.

**Headline: the tree is in good shape, and that is the finding.** Four of the five zone audits came
back with a verdict of "sound" and no fresh live defect. The rework that is worth doing is almost all
**Tier 1** — a broken gate, a proven copy-paste drift, a defence that is one line short of catching
its class, and a pile of comments that cite files which no longer exist. There is no Tier 3 here that
is not already planned and already named.

## Scope line

**Swept** by nine parallel audit agents (four by lens, five by zone), all read-only against
`worktree-improve-260903` at `ba05333b`:

| | covered |
|---|---|
| by lens | what the code says about itself (comments, postmortems, stale citations) · duplication and two-ways-to-do-one-thing · dead code and unused exports · the defences (tests, types, static analysis, production signals) |
| by zone | `src/store/` + `src/db/` + `drizzle/` · the request path (`src/api.ts`, `src/routes.ts`, `api/`, the handler modules) · `src/web/` + `styles/` · the pipeline + the AI-call layer · `scripts/` + `evals/` + config |

**Excluded**: `docs/plans/` (739 files, read only for prior rejections), `node_modules/`,
`tests/fixtures/`, the `drizzle/*.sql` bodies, and the remote database — nothing here was run against
production.

**Blind to**, structurally: anything that only exists at runtime. No races, no ordering bugs, no
provider drift, no rendering. No browser was driven. Every "X is unused" below is an **absence**, and
is only as good as the grep behind it — each names its directories, and each is to be re-run
immediately before its deletion rather than trusted from this doc.

**Also blind to**: the four zones that came back clean may be clean, or may be the zones whose agent
read least deeply. Two of them (the request path, the pipeline) said so themselves and named the
files they only grepped.

## Baseline, measured on this tree

| | |
|---|---|
| `npm test` | 553 files pass, **1 fails** — `tests/pdf-bundle-trace.test.ts`, and see T0.1 |
| `npm run typecheck` | clean, 1082 files |
| `npm run typecheck:committed` | **clean** — and see T1.1 |
| `npm run check` | **red**, because of that one test |
| `npm run cycles` | clean |
| `npm run complexity` | 91 findings (advisory) |
| `npm run dupes` | 265 clones, 1.73% of lines (advisory) |
| `npm run knip` | 13 files, 138 exports, 106 types (advisory) — and see T1.7 |

## What the churn says

`git log --since="45 days ago" --name-only` over `src/`, 726 commits, pairs that changed together at
least 7 times, scored by `co-changes / min(changes to either)`:

```
  9  1.00  src/web/chat/model.ts      <->  src/web/chat/reduce.ts
  8  0.89  src/store/jobs.ts          <->  src/store/pg-jobs.ts
 16  0.84  src/store/contracts.ts     <->  src/store/fs.ts
  8  0.80  src/public-types.ts        <->  src/public/dto.ts
 14  0.74  src/pipeline.ts            <->  src/store/artifacts-fs.ts
 11  0.69  src/jobs.ts                <->  src/store/jobs-fs.ts
 15  0.68  src/pipeline.ts            <->  src/store/artifacts.ts
 12  0.63  src/store/artifacts-fs.ts  <->  src/store/artifacts.ts
 10  0.67  src/store/jobs-fs.ts       <->  src/store/pg-jobs.ts
```

Every one of the store rows is the same fact: **the recurring edit in this repo is "change a store
seam", and it costs three files — the contract, the filesystem half, the Postgres half.** That is
exactly what [260831b-finish-the-database-move.md](260831b-finish-the-database-move.md) exists to
end, and this sweep's contribution is the measurement, not a competing plan. See T3.1.

The most-churned files over 60 days are `src/web/styles.css` (128 commits), `src/web/App.tsx` (105),
`src/routes.ts` (74), `src/types.ts` (59), `src/db/schema.ts` (53). None of them is a finding on its
own — size is a symptom, not the disease, and each of those has one reason to change, not many.

---

# Tier 0 — live, and in the way

## T0.1 · `npm run check` cannot pass on a clean checkout

**Evidence: reproduced.** `npm run check` is red on this tree, on a clean `npm ci`, with nothing
uncommitted.

The `test` gate runs `tests/pdf-bundle-trace.test.ts`, which needs `api-dist/vercel.js`. That file is
produced only by `npx vite build --config vite.api.config.ts` — which is in
[`vercel.json`](../../vercel.json)'s `buildCommand` and in
[deployment.md](../project/deployment.md), but **not** in `npm run build`, and so not anywhere in
`npm run check`. Two further problems compound it: the `test` step runs *before* the `build` step in
`STEPS`, so even if `build` produced the bundle the ordering would defeat it.

The test is right to fail loudly rather than skip — its own comment says so, and that judgement is
correct. What is wrong is that the command which is supposed to tell you "something is newly wrong"
says it every single time, which is precisely the failure
[`scripts/check.ts`](../../scripts/check.ts)'s own header sets out to avoid:

> A check that always fails is a check nobody runs.

**The fix, and the simpler option it passes over.** The simple option is to add an api-build step to
`check.ts` before the test gate. The one chosen instead is to make `npm run build` *be* the whole
build — both passes, in order — because the full recipe currently lives in `vercel.json` and in a doc
and nowhere that a developer runs, which is two-ways-to-do-one-thing on the thing that ships:

```json
"build:client": "vite build",
"build:api": "vite build --config vite.api.config.ts",
"build": "npm run build:client && npm run build:api"
```

Then `vercel.json` reduces to `npm run build`, `check.ts` moves `build` above `test`, and the recipe
has one home.

**The caller the first draft of this missed** — found by the review, and it is the reason the named
component scripts are there rather than a bare `&&`: `scripts/deploy.ts:619-623` already runs
`npm run build` and *then* the api build as a separate `run("npx", ["vite", "build", "--config", …])`.
Left alone it would build the API twice. It collapses to one `run("npm", ["run", "--silent",
"build"])` and one gate.

**Verified before proposing**: the two builds run clean in this worktree, the api pass takes 402 ms,
and `tests/pdf-bundle-trace.test.ts` goes 2/2 green with `api-dist/` present. Ordering is sound —
`readClientShell` needs the client first, both stamps resolve the same commit from `git rev-parse
HEAD`, Sentry still gets client maps then API maps, and `no-secrets-in-bundle` stays scoped to the
browser bundle.

**Risk**: `npm run build` gets slower for everyone who runs it by hand, by about 400 ms. Acceptable.

**The second thing the first draft got wrong, found while building it.** `--fast` skipped the build
step outright, which after this change left `--fast` **permanently red** — the test gate would still
want `api-dist/`. A mode nobody can use is the same bug as a gate nobody can pass, one flag along.
So `--fast` now narrows the step to `build:api` rather than skipping it: the client build is the slow
half, and the API pass is the one the test gate needs. On a tree that has never had a client build it
fails loudly, naming the fix, from `scripts/client-shell.ts` — verified:

```
Cannot read the built client shell at …/dist/index.html: ENOENT …
Run `npm run build`, which builds the client and then this.
(`build:api` on its own needs a `dist/` that already exists.)
```

That is the right answer for `--fast` on a clean checkout: it is a shortcut for a tree you have
already built once, and it now says so rather than failing somewhere else.

**Also in this stage, because they define `npm run build` as client-only in prose**:
`docs/project/dev-and-deployment-overview.md`, `docs/project/setup-dev.md`,
`docs/project/deployment.md`, and the error messages in `scripts/client-shell.ts` that say
"Run `npm run build` first — the API build compiles dist/index.html into the function".

---

# Tier 1 — cheap, mechanical, evidence in hand

## T1.1 · `committed` has met its own promotion condition

**Evidence: reproduced.** `npm run typecheck:committed` exits 0 on this tree: *"✓ HEAD typechecks."*

[`scripts/check.ts`](../../scripts/check.ts)'s `committed` step is `gate: false`, and the paragraph
above it explains why and states its own exit condition in as many words:

> The day `npm run typecheck:committed` is green, `gate: false` becomes `gate: true` and this
> paragraph goes.

That day is today. Flip it, delete the paragraph down to the two sentences that say what the step is
for, and update [static-analysis.md](../project/static-analysis.md) and
[code-quality-overview.md](../project/code-quality-overview.md) where they list it as advisory.

Do this **after** T0.1, so that the run which proves the promotion is a run that could have been
green.

## T1.2 · `articleIdFor` is copied six times and one copy has already dropped a check

**Evidence: proved from the code** — the six declarations and the missing call were re-grepped
against this tree, but nobody has driven a malformed slug through `pg-comments.ts` and watched the
status come back wrong. The review was right to downgrade this: re-grepping is not reproducing.
**The stage closes the gap** by writing that red test first —

```ts
await expect(pgCommentsStore.load("not a slug")).rejects.toMatchObject({ status: 400 });
```

— watching it fail before the extraction and pass after.

```
src/store/pg-chat.ts:105             throwing variant, calls requireSlug
src/store/pg-searches.ts:89          throwing variant, calls requireSlug
src/store/pg-referee-claims.ts:89    throwing variant, calls requireSlug
src/store/pg-referee-criteria.ts:64  throwing variant, calls requireSlug
src/store/pg-lookups.ts:42           throwing variant, calls requireSlug
src/store/pg-comments.ts:84          throwing variant, DOES NOT call requireSlug
src/store/ai-calls-pg.ts:44          different contract — explicit owner, returns null
src/store/realtime-sessions-pg.ts:43 different contract — explicit owner, returns null
```

**This is the drift proof the sweep asks for**: five siblings validate the slug and the sixth does
not, so a malformed slug reaching any comment-store method falls through to a database query and
comes back as `notFound` instead of the clean 400 the other five give. Not a security hole —
`ownedSlug` still scopes correctly — but it is a fix that failed to reach one of the copies, which is
the shape that predicts the next one.

Alongside it, `lockArticle(tx, articleId)` is byte-identical in four of the same files
(`pg-referee-claims.ts:142`, `pg-chat.ts:243`, `pg-searches.ts:136`, `pg-referee-criteria.ts:145`).

**Fix**: one exported `articleIdForOwned(slug, db?)` in [`src/store/pg.ts`](../../src/store/pg.ts),
which is where `notFound`, `ownedSlug` and `requireSlug` already live — *put it where the invariant
already lives rather than minting a new home*. The six throwing copies call it; the two
different-contract copies stay exactly where they are. `lockArticle` goes to the same place.

**Deletion test**: passes — six callers collapse onto one primitive that lives beside the three
helpers it composes, and the interface gets smaller, not larger.

## T1.3 · Seventeen transactions do not pin their isolation level, and nothing would catch an eighteenth

**Evidence: proved from the code** for the absence; **hypothesis** for whether it currently misfires.

[sql.md](../project/sql.md) names `read committed` as the level these transactions depend on, and
four files pin it explicitly — `pg-session.ts:187` (`READ_COMMITTED`), `pg-billing.ts:312`,
`pg-feedback.ts:314`, `src/billing/sync.ts:173`, with `article-rows.ts:534` deliberately pinning
`repeatable read` instead. The rest take whatever the role defaults to:

```
src/store/pg-chat.ts             343, 391, 440, 494, 560, 642, 659
src/store/pg-comments.ts         295
src/store/pg-jobs.ts             652
src/store/pg-referee-criteria.ts 170
src/store/pg-searches.ts         160
src/store/pg-referee-claims.ts   163
src/store/pg-visibility.ts        95
src/store/pg-revisions.ts        665, 850, 1445, 1626
```

This is the class from
[260901f-a-for-update-that-locks-nothing.md](../postmortems/260901f-a-for-update-that-locks-nothing.md),
whose fix *requires* `read committed`. Whether the remote role actually defaults to something else is
unverified and is the honest hypothesis here — but the cost of pinning is one argument per call site,
and nothing about it can be wrong.

**The valuable half is not the pinning, it is the check.** Add a test that walks
`src/store/*.ts`, finds every `.transaction(` call, and requires each to name an isolation level (or
appear in a small, commented allow-list saying why not). That closes the class rather than the
instances, which is the whole point — a ninth `pg-*.ts` file is coming, and this is what tells its
author.

**Note the corollary the audit turned up**: nothing anywhere catches or retries a Postgres `40001`
serialization failure. Under `read committed` that is not reachable, which is a further reason to pin
rather than leave it to a role setting nobody has read.

## T1.4 · A lock at module scope, in the file the cost-storm write-up named and left

**Evidence: proved from the code.**

[`src/store/ai-calls-fs.ts`](../../src/store/ai-calls-fs.ts) still has

```ts
let writing: Promise<void> = Promise.resolve();
```

at module scope. [`src/process-state.ts`](../../src/process-state.ts) exists for exactly this and
says so:

> A `const` at module scope usually *is* process state … It stops being true the moment the state is
> a **lock**, because a second copy of a lock is not a slower lock, it is no lock at all.

[260902c-the-truncation-retry-cost-storm.md](../postmortems/260902c-the-truncation-retry-cost-storm.md)
converted two such variables (`QueueState` in `jobs-fs.ts`, `aborts` in `jobs.ts`), and
[260902g](260902g-cost-tracking-that-can-set-a-price.md) names this third one in writing as the same
bug class, out of scope at the time. It has not been touched since.

**Blast radius, stated honestly**: production runs `SPIDERYARN_STORE=postgres`, where this adapter is
never consulted, and under test it is always the filesystem one but vitest isolates per file. So the
exposure is a developer's own `data/_ai-calls.jsonl` interleaving after a dev-server restart. Small.
The reason to do it anyway is that it is a two-line change into machinery that already exists, and
leaving a named, diagnosed instance of a class the repo has fixed twice is how the third one gets
written.

### The count, which the first draft of this finding did not do

improve-the-codebase.md says **count every instance before you plan the fix**, and this finding
arrived as "one variable". The review caught it. `git grep -nE 'let (writing|queue): Promise<.*> =
Promise\.resolve\(\)' -- src` gives **ten**:

| | |
|---|---|
| `src/store/ai-calls-fs.ts:80` | `writing` — **in scope** |
| `src/store/realtime-sessions-fs.ts:76` | `writing`, the identical append-mutex shape — **in scope**, added after the review |
| `src/chat.ts:68`, `comments.ts:47`, `glossary-lookups.ts:69`, `profile.ts:317`, `referee-claims-store.ts:60`, `referee-criteria-store.ts:57`, `searches.ts:198`, `shelf.ts:68` | eight `queue` read-modify-write chains — **deferred to [260831b](260831b-finish-the-database-move.md)**, being the filesystem store that move deletes |
| `src/web/mic-lock.ts:63` | client-side; no module reload, not this class |

Plus the six module-local liveness and locking registries in `src/routes.ts` that a previous sweep
already named and deferred behind the route split.

**This paragraph exists so nobody reads T1.4 and believes the module-reload class was swept and
closed.** Two of ten are fixed here; fourteen sites in two named groups are deferred with a reason.

## T1.5 · A test that would pass a query attributing every comment to every owner

**Evidence: reproduced** — the audit built the sabotaged query and ran it through `.toSQL()`; all
three assertions passed.

`tests/admin-queries.test.ts:119-130` guards
[`src/store/pg-admin.ts`](../../src/store/pg-admin.ts)'s three child counts with:

```ts
expect(sql).toMatch(/group by "articles"\."owner_id"/);
expect(sql).toContain("inner join");
expect(sql).toMatch(/"current_revision_id" is not null/);
```

No `ON` predicate is pinned, so a join written `eq(articles.ownerId, articles.ownerId)` — a real
regression shape, cross-attributing every child row to every owner — satisfies every line.

This is *the* tautology named in [improve-the-codebase.md](../reusable/improve-the-codebase.md), and
the sibling file has already been through it and fixed it: `tests/store-block-reads.test.ts:127-133`
carries the account of GPT Sol breaking the identical assertion and the fix, which is to pin the
whole predicate. The fix here is the same three lines, one per child table:

```ts
expect(sql).toContain('inner join "articles" on "comments"."article_id" = "articles"."id"');
```

**Assert the relationship, not the vocabulary.**

## T1.6 · Comments that cite files which no longer exist

**Evidence: reproduced** — file deletions confirmed by `git log --diff-filter=D`, and the citations
re-grepped against this tree.

Three deletions were done cleanly and their citations were not swept:

- **`src/store/import.ts`**, deleted 2026-09-01 in `b73ad746`. **36 references remain** across 28
  files in `src/`, `tests/` and `scripts/`. Some are already correctly past-tense
  (`src/source-hash.ts:65`, `src/store/pg-revisions.ts:647`); most read as present tense and describe
  a live writer. The full list is in the sweep notes; the load-bearing ones are
  `src/store/artifacts-pg.ts:279` and `:1177`, `src/db/schema.ts:317` and `:989`,
  `src/store/pg.ts:1199`, `src/store/export.ts:505`, `src/web/Masthead.tsx:314,341`,
  `src/web/Metadata.tsx:1195`, `src/pipeline.ts:1033`, `src/library-scalars.ts:17`,
  `src/parse-json.ts:258`.
- **`checkNoteFields` / `src/block-fields.ts`**, deleted the same day in `b3e97191`.
  `src/store/pg.ts:1748` still names it as a live second line of defence beside a CHECK constraint
  that is now the only one; `tests/store-block-roles-pg.test.ts:19` still lists it.
- **`src/summarise.ts`**, deleted 2026-08-31 in `cc2b67d4` with the whole of Summary mode.
  `src/messages-stream.ts:332` still cites it as "the worst of them" for mis-parsed refusals.

And three that were never right, or stopped being right:

- `src/anthropic-call.ts:12` enumerates the callers as *"six pipeline stages (arc, labels,
  summarise, hierarchy, glossary, tweets)"*, and lines 18 and 23 reason from that number — *"nothing
  in these six stages caught that"*, *"what every one of these six requests carries is the whole
  article"*. There are **ten** today: `arc`, `labels`, `glossary`, `hierarchy`, `ideas`, `quiz`,
  `quotes`, `sketch`, `timeline`, `tweets` (plus `job-failure.ts` and `messages.ts`), and
  `summarise` is one of the deleted files above. This one is in a file whose whole subject is not
  leaking an upstream error body to the reader, so the undercount matters.
- `src/notes.ts:390` cites `src/graph.ts` as a third copy of the first-duplicate-wins rule. No such
  file has ever existed (`git log --all -- src/graph.ts` is empty). `src/web/graph.ts` does exist;
  the rule's actual third home appears to be `src/web/notes-view.ts:48`. **Check which before
  editing** — this one is a hypothesis about intent, not a proven target.
- [design-css-overview.md](../project/design-css-overview.md) says `src/web/styles.css` is
  "~1200 lines", twice (lines 19 and 498). It is **12,830**. The second occurrence is load-bearing:
  the doc's closing open question is *"whether ~1200 lines of well-commented CSS is the answer at
  this size"*, asked about a file ten times that size.

**No mechanical check catches stale prose**, and inventing one would be more machinery than the
problem is worth. The cheapest real answer is the one the sweep already uses: when a file is deleted,
grep for its name. That belongs in [rename-or-move.md](../reusable/rename-or-move.md), which covers
renames but not deletions — a one-line addition.

## T1.7 · Knip reports four false positives because one glob is not recursive

**Evidence: proved from the code.** [`knip.jsonc`](../../knip.jsonc) has `"evals/*.ts"` under
`entry` and `"evals/**/*.ts"` under `project`. Nested eval entry points are therefore in scope but
have no entry pattern, so knip calls them unused: `evals/hierarchy-structure/blind.ts`,
`evals/hierarchy-structure/verify-costs.ts`, `evals/sketch/run.ts`, `evals/sketch/svg.ts`. All four
are real, documented in `evals/README.md`, and one is named in a plan as the way to run it.

Knip is an advisory that is meant to become a gate when its findings reach zero. Four of its findings
are its own config. Fix the glob; the remainder of the backlog is then honest.

## T1.8 · Dead code, verified

Each of these was re-grepped across `src/`, `api/`, `scripts/`, `evals/`, `tests/`, `styles/`,
`docs/`, `package.json` and the vite/drizzle/vercel configs. **Re-run the grep at deletion time**
rather than trusting this list.

| what | where | lines | note |
|---|---|---|---|
| `mark<T>` | `src/web/perf.ts:204` | ~8 | 16 files import from `perf.js`; none imports `mark` |
| `structuralLeaves` | `evals/hierarchy-structure/model-arms.ts:464` | ~8 | its own comment says "exported for run.ts's stats"; `run.ts` never calls it |
| `requestOwner` | `src/owner.ts:209` | ~3 | **plus a false comment** naming `src/jobs.ts` as its one caller; `jobs.ts` uses `currentOwnerId()` at 9 sites and this at none |
| `listUploads` | `src/upload-records.ts:146` | ~3 | **plus a false comment** — "for the sweep, and for tests", neither exists |

**Explicitly not proposed, and why** — so the next sweep does not re-find them:

- The nine `src/web/preview-*.tsx` harnesses knip calls unused each have a matching root-level
  `preview-*.html` Vite entry and were all edited within the last week. Alive.
- `buttonVariants` / `toggleVariants` in `src/web/components/ui/`: unused, but they are shadcn's own
  generated shape, and diverging from upstream to save one line is a worse trade.
- The remaining ~230 knip "unused export" hits are, on sampling, symbols used inside their own file
  and exported anyway. The fix is dropping a keyword, not deleting content, and it is 200 mechanical
  edits for no line count. Recorded as a class; not doing it.
- `src/store/fs.ts` and the `*-fs.ts` family: **not** deletable one file at a time.
  `src/store/index.ts:201` still branches on `STORE` for the whole suite, so removing one adapter
  flips the default store under ~100 test files at once. This is Stage D of
  [260831b](260831b-finish-the-database-move.md) and stays there.

## T1.9 · Three copies of "Escape closes this dialog", and ~~three~~ **two** raw reads of `?at=`

**Evidence: proved from the code.** **Done — `eee69715`.**

`src/web/ChatDialog.tsx`, `AnnotateDialog.tsx` and `CommentDialog.tsx` each defined the same
`useEffect` adding and removing a bubble-phase `keydown` listener testing `e.key !== "Escape"`. They
now call `useEscapeToClose`.

**`Dock.tsx` stays out, and that is the interesting half.** Its drawer also closes on Escape and must
win a race against `CommentDialog`'s listener, so it uses the capture phase and
`stopImmediatePropagation`. Before, that fact lived in a comment pointing at a copy; now the hook
says why Dock is not one of its callers and Dock says why it is not one, so **the race has two named
parties instead of one comment and three anonymous copies** — which is the actual win here, more than
the six lines saved.

### The count was wrong, again, and in the direction the sweep keeps failing

The plan said `?at=` was read raw at **three** sites, the third being `Dock.tsx`. **There are two**,
both in `App.tsx`. `Dock.tsx` reads `carriedSearch(location.search)` — the *whole* query string, to
carry view state across a link, a different job. The two `App.tsx` comments name Dock as the source
of the read-at-render *pattern*, and this plan read that as a third instance of the thing.

That is the second miscount in this sweep (T1.4 was the first, in the other direction), and both came
from **trusting a citation instead of running the grep**. Worth recording as the method's own failure
mode: an audit agent reads a comment saying "same trick as X" and files X as a hit.

`currentAt()` now lives in `src/web/params.ts`, which [url-state.md](../project/url-state.md) already
frames as the one home for URL reads, and it carries the call sites' reasoning about why the read is
synchronous at render rather than through `useQueryState`.

## T1.10 · The guard for the most expensive recurring accident is wired into nothing

**Evidence: reproduced.** `scripts/check-staged-revert.ts` exists.
`ls $(git rev-parse --git-common-dir)/hooks/` is **empty** — not even the samples. `package.json` has
no script for it. `npm run check` does not run it. Neither
[CLAUDE.md](../../CLAUDE.md)'s "Commit only your own files" recipe nor
[version-control.md § Commit your own files](../project/version-control.md)'s does. It is named in
exactly two places, both narrative prose deep inside version-control.md, at lines 456 and 574 — and
line 456 is the sentence that says what should have happened:

> the fix is not a firmer comment — it is `scripts/check-staged-revert.ts` run before every commit,
> by everyone

That is the accident CLAUDE.md summarises as *"it silently staged a revert of other people's work
across the whole tree for six hours"*. The fix was written and then left where only somebody who
already knows the postmortem would find it.

**Fix**: a `package.json` script (`"check:staged-revert"`), a line in the commit recipe in both
CLAUDE.md and version-control.md, and — the question for Stage 1 — whether it also belongs as a step
in `npm run check`. It is fast and reads the index, so it is cheap; but `check` is not run before
every commit, so the recipe line is the load-bearing half.

**Note**: CLAUDE.md is a file whose wording is a rule, so this edit goes through
[edit-important-docs.md](../reusable/edit-important-docs.md) — one approved change, before and after
shown. **Deferred to the end of the run for Greg's approval**; the `package.json` script and the
version-control.md line are not, and land in Stage 1.

## T1.11 · Two opposite rules for which `DATABASE_URL` a script obeys

**Evidence: proved from the code.**

The 2026-08-27 incident behind
[database.md § `DATABASE_URL=… npm run db:migrate` does not do what it looks like](../project/database.md)
produced a fix: capture the shell's value *before* `loadEnvLocal()` buries it.

```
shell wins   scripts/db-migrate.ts:71-75   fromShell = process.env.DATABASE_URL, then ?? 
             scripts/db-check.ts:45
             scripts/db-corpus-readiness.ts:77
             scripts/db-repair-migration-ledger.ts:87

file wins    scripts/db-seed-dev.ts:97,109   loadEnvLocal() first, no capture
             scripts/db-reown.ts:113,142
```

~~Both of the second pair document the trap in their own headers and **deliberately decline the
fix**~~ — **this was wrong, and the lane that built it said so.** Their headers *describe* the trap
and answer it with a printed `Target:` line; neither weighs capturing the shell value and rejects it.
So the divergence was undeclared in substance even where it looked documented, which is worse than
the plan thought rather than better.

There **is** a good reason for their answer, and it is not the one they give: **neither script has a
remote mode at all.** There is no `--allow-remote`, the only valid target is this repo's own local
Docker stack, and both settle that against `supabase status` rather than against the connection
string (`scripts/db-reown-rules.ts`). Shell-wins would therefore change nothing but the failure
message, while reopening the `~/.zshrc` case that `src/env.ts`'s whole precedence rule exists to
close — and the old app's stack really is running next door on port 54342. That reason is now
written down where the choice is made.

**The risk was always the next script**, which copies the nearest sibling of its genre and inherits a
rule nobody chose — the exact mechanism improve-the-codebase.md describes.

**As built**: `resolveTargetUrl({ shellWins })` in [`src/env.ts`](../../src/env.ts), beside the rule
it excepts rather than in `db-reown-rules.ts`, which answers the different question "is this our
stack". The option is **required**, so the seventh script has to choose. Behaviour is unchanged at
all six call sites (four `true`, two `false`).

**The part that is better than this plan asked for.** It reads `INHERITED` — the snapshot `src/env.ts`
takes at module load — rather than a `const` the caller captures. The four shell-wins copies each
depended on their capture running *above* `loadEnvLocal()`, so an import reordered or a helper
introduced above them would silently turn shell-wins into file-wins with nothing to show for it.
Reading the snapshot makes the answer order-independent, which **ends the ordering trap rather than
documenting it**.

**Deliberately scoped as local-only**: nothing in this stage ran against any database, remote or
local. The resolver was verified as a pure function against injected environments, which is most of
why it was worth extracting.

---

# Tier 2 — worth doing, each with its own review

## T2.1 · Nothing has ever asked the ledger whether a job step ran twice

**Evidence: proved from the code** (an absence — swept `src/cost-report.ts`, `src/ai-spend.ts`,
`scripts/ai-cost.ts`, `src/store/ai-calls-spend-pg.ts`).

[260902c](../postmortems/260902c-the-truncation-retry-cost-storm.md) ranks this as its **second**
recommended remedy, and the sentence is worth quoting because it is the argument:

> Reading the ledger for duplicates at all … nobody had ever asked it, on 565 rows. The two big ones
> were found by eye three days later; the six on `read` were never found at all until this.

The cost-tracking work that landed since ([260902g](260902g-cost-tracking-that-can-set-a-price.md))
built pricing and reporting, but not this.

**Bar it has to clear** (from improve-the-codebase.md): show it would have fired on the actual
incident, and that it is bounded against alert fatigue. It clears both — grouping by
`(job_id, step_name)` and reporting any group with more than one distinct `run_id` would have shown
eleven runs of one `hierarchy` step in the same run that produced them. It is a report line, not an
alert, so there is no fatigue to bound.

**A pure fold, not a store query** — the review's correction, and it matters: **the incident lived in
the filesystem ledger**, so a Postgres-only grouped query would not have fired on it. `npm run cost`
already loads `AiCallRow[]` into memory, so the right shape is a pure function over the rows, called
from the existing report before any early return:

```ts
export function duplicateJobSteps(rows: readonly AiCallRow[]) { … }
```

Two cases pin it, and the second is what stops it being noise: two rows sharing `jobId`+`stepName`
with **different** `runId` are reported; two sharing the `runId` as well are **not**, because a step
legitimately fans out into several calls inside one run.

## T2.2 · ~~What is the SSRF boundary in `src/urls.ts` defending against now?~~ — answered, and fixed

**Evidence: proved from the code.** **Answered and applied during this run.**

The question was: `src/urls.ts` justifies a URL shape rule by saying stage 1's `guardAddress` is far
stronger *but* `src/store/import.ts` writes a revision without going through stage 1 — and that file
was deleted on 2026-09-01. So either the rule was still load-bearing for a reason nobody had written
down, or it was defending against a threat that no longer existed.

**It is still load-bearing. The writer moved and got narrower.** Every current writer of
`article_revisions.finalUrl` was traced back to an entry point:

| writer | entry point | through `guardAddress`? |
|---|---|---|
| `fetchDocument` (`src/pipeline.ts`, stage 1) | `POST /api/jobs`, the pipeline CLIs | **yes** — `src/fetch.ts`, and re-checked on every redirect hop |
| `acquireUpload` (`src/pipeline.ts`, stage 1) | PDF upload | n/a — the manifest carries no URL, deliberately |
| `copyArtefacts` (`src/store/copy-artefacts.ts`) | `tests/helpers/load-article.ts` → **`scripts/db-seed-dev.ts`**, on every `npm run setup` | **no** — it copies a manifest's `url` verbatim, with no fetch |

**`scripts/` is where the caller was**, which is the trap improve-the-codebase.md names in as many
words and which four previous audits in this repo have fallen into.

**Not a live defect**: `db-seed-dev.ts` refuses anything but a local database
(`isLocalDatabaseUrl`, plus a hard refusal on `NODE_ENV=production` / `VERCEL`) and loads only the
committed fixture corpus, so nothing reader-facing is exposed. The deleted `src/store/import.ts` had
neither guard and would take any `DATABASE_URL`, production included. So the hole is smaller than it
was, and not closed — which is exactly why the function stays.

The comment in `src/urls.ts` now says this, and the trailing sentence that said the narrower hole is
"stage 1's to close for everything except an import" now says "for everything it fetches".

## T2.3 · Seven streaming handlers hand-roll the same stall timer

**Evidence: proved from the code**, and **no drift** — checked, all six non-`converse` copies have
exactly three `clearTimeout(stallTimer)` calls in the same relative positions.

```
src/explain.ts:473-492            src/referee-claims-run.ts:397-406
src/search.ts:594-610             src/referee-criteria-run.ts:514-523
src/quiz-mark.ts:562-577          src/referee-mirror.ts:1479-1493
src/converse.ts:1335-1373         (+ a per-round variant at 1511-1516)
```

Each builds `AbortSignal.timeout(deadline)`, a second `stall` controller restarted by a `touch()`
closure, and `AbortSignal.any([...])` — same variable names, near-verbatim comments.

The argument *for* doing it is written in one of the copies. `src/explain.ts:494-500` records that
the *request / status / spend* half of exactly this was already consolidated into `src/ai-call.ts`:

> six callers each keeping their own copy … is how three of them ended up differing

## …and it is **deferred**, on the review's argument, which is better than mine

I asked for this one explicitly, and the answer was no. Three reasons, all of which I accept:

1. **No drift.** Seven stable copies are not evidence for an abstraction. The adjacent transport
   code's *historical* drift is not evidence that this timer idiom has drifted — and the sweep's own
   rule is that copies stable for months are usually honest, and merging them couples things that
   were independent.
2. **My proposed signature was wrong**, which is the tell. `withStallTimeout(…) → {signal, touch}`
   gives no way to clear the live timeout. Every current caller has a `finally { clearTimeout(…) }`;
   removing that without a `dispose()` leaks the timer and can hold the process open. The honest
   minimum is `streamClocks({timeoutMs, stallMs, signal}) → {signal, touch, dispose}` — and it must
   *also* expose the deadline and stall signals separately, because callers use them to classify
   which kind of failure they had.
3. That is already enough interface for the YAGNI test to fail today. **A helper that has to hand
   back four things is not concentrating complexity behind a smaller interface; it is relocating it.**

**Revisit when there is a first behaviour change to make, or the first actual drift.** Recorded here
so the next sweep finds the rejection rather than re-proposing it — which is the whole point of
writing down what we decided not to do.

---

# Tier 3 — named and sized, not started

## T3.1 · Finish the database move

Not new, not this sweep's to start:
[260831b-finish-the-database-move.md](260831b-finish-the-database-move.md). What this sweep adds is
the measurement in *What the churn says* above — the three-file store-seam edit is the single most
repeated shape of change in the tree over the last 45 days, on four independent file pairs. It is the
best evidence yet that finishing the move is the highest-value structural work available, and it is
also the reason no single `*-fs.ts` file can be deleted before Stage D.

## T3.2 · `src/web/styles.css` at 12,830 lines

[design-css-overview.md](../project/design-css-overview.md) already asks this question about itself
and calls it open. The client audit found essentially no drift inside it — one hardcoded hex, with a
comment justifying it, across ~989 selectors — so it is a long file with one reason to change rather
than a tangled one, which is explicitly *not* a finding by this sweep's own rule. **Greg's call, not
an engineering one.** Named here only so the next sweep does not re-open it as a defect. Its stale
line count is fixed in T1.6.

## T3.3 · The 14-branch `mode ===` dispatch in `App.tsx`

Named, sized and **explicitly refused** by
[260902o](260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md) as T3.1 there — a
registry shape was considered and rejected. Recorded so this sweep does not re-propose it.

---

# What came back clean

Recorded because a negative result from a real sweep is worth as much as a finding, and because the
next run should not re-spend agents here.

- **The request path.** No wrong status codes, one error envelope, one body reader, one auth check at
  the top of `handleApi`, all ~~six~~ **seven** SSE streams terminate with an explicit frame, no `console.log` in a
  request path. Each of the four postmortem classes in this zone has a fix *and* a mechanical test
  that re-catches the class.
  <br>**"Six" was wrong when it was written**, corrected 2026-09-03 by
  [260903d](260903d-improve-the-codebase-second-sweep.md) § T1.6. Six go through the `sse()` helper
  (`src/routes.ts:1344, 1614, 3417, 3664, 3799, 3917`); the seventh, `streamChat`, writes its SSE
  headers by hand at `:2309` and so is invisible to a grep for the helper.
  **"Terminate with an explicit frame" was also too strong**, and the correction's first draft
  repeated it: search and both referee streams deliberately omit the terminal frame on some paths
  (`src/routes.ts:3452, 3698, 3832`), which is a documented no-op case rather than an oversight. What
  is true of all seven is that each closes via `res.end()` in a `finally`. The *method* is the
  lesson: **counting the callers of a shared helper counts everything except the instance that does
  it by hand**, which is the one worth finding — and `sse()`'s own comment (`:947`) is stale in the
  same direction, still saying only chat and comments use it when six callers do.
- **The pipeline and the AI layer.** One JSON-from-model parser, one price table, one token
  estimator, one model-id source, one gateway path with the one declared exception. `maxRetries: 0`
  and one bounded repair retry. The `id > start && id < end` string-comparison trap from
  block-ids.md does not recur anywhere. `assertTreeSound` still runs before `generateLabels`.
- **The client.** Block-id discipline holds — every `querySelector` that resolves a node by identity
  goes through `data-block="${id}"`, none by offset or structural path. One `activeSectionIndex`
  primitive, four callers, no rival. Seven files with unbalanced listener counts, all seven
  intentional boot-time singletons or per-session objects.
- **The store's own defences.** `guarded()`, `SEAM_ASYMMETRIES` and
  `tests/store-seams-have-two-implementations.test.ts` are a genuinely good answer to "is this one
  interface or several", and each recent store postmortem became a class-closing test rather than a
  patch.
- **Types.** No `as any` in `src/**` outside comments. The `as unknown as` casts that exist are two,
  in one file, forced by raw `db.execute()`, and commented.

One item is a **product decision, not an engineering one**, and is flagged for Greg rather than
scheduled: `DELETE /api/glossary/:slug` — the glossary panel's "start again" — is a declared 501 on
the deployed app. It is properly tracked (`SEAM_ASYMMETRIES.GlossaryStore` in `src/store/live.ts`,
enforced by a test), and it is blocked on the open question in
[260826e](260826e-postgres-storage-implementation.md) about whether a published revision may be
mutated. It is user-visible and has been open a while.

**Correction, 2026-09-03: it turned out to be engineering, not a product decision.** The mutate-a-
published-revision question was answered "yes, as one named exception" and the delete is built —
see [260903e-glossary-delete-in-postgres.md](260903e-glossary-delete-in-postgres.md). The one product
choice inside that work (refuse with 409 while a live job holds a draft, rather than queue behind it)
was small enough to make directly rather than carry back to Greg first.

---

# Stages

Each ends committable, green and deployable. Parallel stages are constrained by
**non-overlapping file sets**, not by independent ideas.

### Stage 1 — the gates (serial, first)

T0.1, T1.1, T1.7 and the code half of T1.10. Files: `scripts/check.ts`, `package.json`,
`vercel.json`, `knip.jsonc`, **`scripts/deploy.ts`** (the double-build the review found),
`scripts/client-shell.ts` (two error messages), `docs/project/static-analysis.md`,
`docs/project/deployment.md`, `docs/project/dev-and-deployment-overview.md`,
`docs/project/setup-dev.md`, `docs/project/version-control.md`.

**Done looks like**: `npm run check` exits 0 on a clean tree with `committed` as a gate, knip's four
self-inflicted findings are gone, and `check-staged-revert` is a named npm script referenced from
the commit recipe. This goes first because every later stage's evidence is a `check` run.

### Stage 2 — three lanes in parallel

The review rejected the first cut of this table: it assigned `src/store/ai-calls-fs.ts` to two lanes
at once and swallowed 2b's natural test file inside a `tests/store-*.test.ts` wildcard. **No lane
owns a wildcard. Every file is named, and every file appears exactly once.**

| lane | items | files |
|---|---|---|
| **2a — store** | T1.2, T1.3 | `src/store/pg.ts`, `pg-comments.ts`, `pg-chat.ts`, `pg-searches.ts`, `pg-referee-claims.ts`, `pg-referee-criteria.ts`, `pg-lookups.ts`, `pg-revisions.ts`, `pg-visibility.ts`, `pg-jobs.ts`, `src/store/export.ts` (citations only), `docs/project/sql.md`; tests: the new isolation test, the new `pg-comments` slug test, and any existing `tests/store-*.test.ts` **it names before starting** |
| **2b — the ledger, the tautology, the target** | T1.4, T1.5, T2.1, T1.11 | `src/store/ai-calls-fs.ts`, `src/store/realtime-sessions-fs.ts`, `src/process-state.ts`, `src/ai-spend.ts`, `src/cost-report.ts`, `scripts/ai-cost.ts`, `scripts/db-reown.ts`, `scripts/db-seed-dev.ts`, `scripts/db-migrate.ts`, `scripts/db-check.ts`, `scripts/db-corpus-readiness.ts`, `scripts/db-repair-migration-ledger.ts`, `scripts/db-reown-rules.ts`; tests: `tests/admin-queries.test.ts` and the new lock test |
| **2c — dead code and false comments** | T1.8, T1.6 | `src/owner.ts`, `src/upload-records.ts`, `src/web/perf.ts`, `src/anthropic-call.ts`, `evals/hierarchy-structure/model-arms.ts`, `src/notes.ts`, `src/messages-stream.ts`, `src/pipeline.ts` (comments only), `src/web/Masthead.tsx`, `src/web/Metadata.tsx`, `src/db/schema.ts`, `src/library-scalars.ts`, `src/parse-json.ts` |

**The rules that make the three safe to run at once:**

- **2c edits nothing under `src/store/`.** Its citation sweep reaches `pg.ts`, `pg-revisions.ts`,
  `artifacts-pg.ts`, `export.ts` and `data-root.ts`; it produces that list and hands it to 2a, which
  applies it. `src/store/ai-calls-fs.ts` and `realtime-sessions-fs.ts` belong to **2b alone** —
  2a does not open them.
- **2b owns every `scripts/db-*.ts`**; neither other lane touches `scripts/`.
- **`src/urls.ts` (T2.2) belongs to no lane** — the orchestrator did it, before the lanes ran.
- Each lane **names every test file it will edit** before it starts, rather than claiming a glob.

### Stage 3 — the client tidyups

T1.9 only. `src/web/ChatDialog.tsx`, `AnnotateDialog.tsx`, `CommentDialog.tsx`, `App.tsx`,
`Dock.tsx`, `params.ts`. T2.3 is deferred (see above) and T2.2 is done.

### Deferred for Greg — questions, not work

Per the run's instruction to defer anything needing a decision rather than guess. The review added
the first item's scope: **the important-doc process covers more than CLAUDE.md.** Per CLAUDE.md, it
is *"this file above all, the seven entry points, anything in `docs/reusable/`"*.

1. **The doc edits whose wording is a rule.** Prepared as exact before/after proposals, **written
   but not committed**, for one approved set:
   - `CLAUDE.md` — the `check-staged-revert` line in the commit recipe (T1.10)
   - `docs/reusable/rename-or-move.md` — the deletion case (T1.6)
   - `docs/project/code-quality-overview.md` — `committed` moving from advisory to gate (T1.1)
   - `docs/project/design-css-overview.md` — the "~1200 lines" correction (T1.6). The bare number is
     a factual fix; the closing open question it appears inside is closer to intent, so both go in
     the proposal.

   The corresponding code stages **may not claim docs-complete** while these are pending, and the
   plan says so rather than quietly landing them.
2. **`DELETE /api/glossary/:slug`** — the "start again" button is a 501 on the deployed app, tracked
   and tested, blocked on whether a published revision may be mutated
   ([260826e](260826e-postgres-storage-implementation.md)). A product decision.
   *(Correction, 2026-09-03: not deferred after all — built in
   [260903e-glossary-delete-in-postgres.md](260903e-glossary-delete-in-postgres.md), which found the
   question small enough to answer directly.)*
3. **T3.2, `styles.css` at 12,830 lines.** The doc already calls this open; the sweep found no drift
   inside it. Not an engineering defect.

### What the review says this sweep could not see

Recorded so the next run starts here rather than rediscovering it. **Module re-evaluation during a
live request** is the shape this sweep called "sound" in the request path without carrying forward
the qualification the cost-storm postmortem already made about `routes.ts`'s registries and the
filesystem queues (see T1.4's count). The adversarial test nobody has written is a
`vi.resetModules()` case that *begins* work through one module copy and *retries or stops* through
another. That belongs in its own plan, not this one.

The other admitted blind spots stand and static reading cannot clear any of them: overlapping
database transactions, provider streams that end without throwing, the behaviour of generated and
deployed artefacts, and anything visible only in a browser.

### Not doing, and why

- The 230 over-exported symbols (T1.8): mechanical, zero line count, high diff noise.
- **`src/store/export.ts`'s re-exports** — the first draft called these dead and **it was wrong**.
  `tests/store-export-raw.test.ts` pulls `MissingRawObject` and `CorruptRawObject` out of
  `export.js` by *dynamic* destructured import, which the audit's grep did not see. `export.ts`'s own
  comment names that test file. Two of the four (`readRawDocument`, `ArticleNotFound`) genuinely have
  no importer, but dropping an export keyword for no line count is the work this plan declines
  everywhere else. **Left alone.**
- The stall-timer extraction (T2.3): deferred, with the argument recorded above.
- Splitting `styles.css` or `App.tsx`: T3.2, T3.3 — one is Greg's call, one is already refused.
- Deleting any `*-fs.ts` adapter: blocked behind 260831b Stage D, for a stated reason.
- The eight `queue` read-modify-write chains and the six `routes.ts` registries (T1.4's count):
  deferred to the database move and the route split respectively, both already-named plans.
- Any change to the remote database: out of scope for an unattended run, by CLAUDE.md.

---

## Progress

- [x] Plan reviewed by GPT Sol — **"not ready"**, and right on both counts. Re-cut below.
- [x] T2.2 — the SSRF question: answered, and the comment corrected
- [x] Stage 1 — gates · `453f3784`, pushed
- [x] Stage 2a — store · `726bac0e`, pushed
- [x] Stage 2b — ledger, tautology, target · `8e6f1f2e`, pushed
- [x] Stage 2c — dead code and false comments · `453f3784`, pushed
- [x] Stage 3 — client tidyups · `eee69715`, pushed
- [ ] The important-doc edits, prepared and awaiting Greg —
      [260903a-…-doc-proposals.md](260903a-improve-the-codebase-sweep-doc-proposals.md)

## What the next sweep should know

**Every stage is done. Nothing here is half-landed.** What is left is three decisions, all in the
proposals doc or below, and none of them is engineering.

**The method's own failure mode, found twice in one night.** Two counts in this plan were wrong —
T1.4 said one lock where there are ten, T1.9 said three `?at=` reads where there are two — and both
came from the same thing: **an audit agent read a comment saying "same trick as X" and filed X as an
instance.** That is a hazard of this sweep's own best advice, which is to start from what the
codebase says about itself. Comments that cross-reference each other are how you find a cluster and
are not a census of it. A one-sentence addition to
[improve-the-codebase.md](../reusable/improve-the-codebase.md) is proposed for this.

**Three of this plan's claims were corrected by the lanes that built them**, which is the system
working: the `DATABASE_URL` scripts do not "deliberately decline" anything, `export.ts`'s re-exports
are alive, and `notes-view.ts` is not the third home of first-duplicate-wins (`internal-links.ts` is).
A plan is a claim too.

**The shared local Postgres cost more time than any finding.** Across the night, `store-jobs-parity`
and a dozen timing-sensitive suites failed a *different subset every run* and passed in isolation
every time — the unscoped `settleExpired()` window `ba05333b` documents as still open, plus one lane
having its vitest processes killed by another session's `pkill`. **Nothing was ever wrong.** The cost
was in proving that, repeatedly. If a future sweep wants one infrastructural win, it is this: a way
for a worktree's test run not to share a database with every other worktree's.

## Where it ended

`npm run check`, on the merged tree at `726bac0e`:

```
  ✓ typecheck    clean          ✓ cycles       clean
  ✓ build        clean          ✓ chain        clean
  ✓ test         clean          ✓ committed    clean      ← a gate as of this sweep
All gates green.
```

That is the first fully green `check` of the run, and the point of doing T0.1 first: at the start of
the night the command could not pass on any clean checkout, so no later stage could have used it as
evidence.

| | before | after |
|---|---|---|
| `npm run check` | **red on any clean checkout** | green |
| gates | 5 | **6** — `committed` promoted, as `check.ts` had promised in writing |
| knip unused files | 13 | **9** — four were its own config |
| jscpd clones | 265 | **258** |
| `.transaction(` unpinned | 17 of 24 | **0**, and a test that names the next one |
| `articleIdFor` copies | 6, one with a dropped check | **1** |
| citations of a file deleted 2026-09-01 | 36 across 28 files | **0** |

## What the review changed

`260903a-improve-the-codebase-sweep-review-sol.md`. It returned **not ready** and the two reasons it
gave were both real, so this section records what moved rather than burying it:

| | |
|---|---|
| **T1.8 would have deleted live exports** | `tests/store-export-raw.test.ts` imports two of them dynamically. Dropped from the plan. The audit grep missed a destructured `await import(...)` — and `export.ts`'s own comment names that test file, so the codebase said so and we still missed it. |
| **Stage 2's lanes collided** | `src/store/ai-calls-fs.ts` was in two lanes; a `tests/store-*.test.ts` wildcard swallowed another lane's test. Re-cut with every file named once and no globs. |
| **T1.4 counted one instance of a ten-instance idiom** | The sweep's own "count every instance" rule, broken by the sweep. Now counted: two fixed, fourteen deferred with reasons. |
| **T1.3's heading said seven, its own list said seventeen** | Heading corrected. |
| **T1.2's evidence state was overstated** | Re-grepping is not reproducing. Downgraded, and the stage now writes the red test that would earn the word. |
| **T2.1 would not have caught its own incident** | The incident was in the *filesystem* ledger; a Postgres query would have missed it. Now a pure fold over `AiCallRow[]`. |
| **T0.1's fix missed a caller** | `scripts/deploy.ts` already runs both builds, so the naive change would build the API twice. |
| **T2.3 should not be built** | Accepted — see the argument above, which is better than the one I had for doing it. |
| **The approval scope was too narrow** | Four important docs, not one. |

Findings I checked and did not act on: none — every one of the nine held up against the tree.

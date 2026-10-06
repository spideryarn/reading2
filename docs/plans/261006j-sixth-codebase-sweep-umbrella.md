# Sixth codebase sweep: the umbrella plan

A whole-tree sweep run on 2026-10-06 the way
[improve-the-codebase.md](../reusable/improve-the-codebase.md) says, three days after the
[fifth](261003f-fifth-codebase-sweep-umbrella.md). This doc lists what was found, groups it into six
clusters with disjoint file sets, says which are being built in this run, and ends with the
decisions that are Greg's.

What it is for, in Greg's words (feedback report `spya-p5p3qx`, Sentry SPIDERYARN-READING2-DT,
2026-10-06):

> When you have spare capacity, kick off some agents to tidy up anything in the codebase that you
> think will make future development easier as you see fit. see e.g. improve-the-codebase.md

The Overseer's relay added the shape: land the items with no real trade-off (added complexity counts
as one), each in its own worktree, at most two in flight; batch anything that is a genuine choice
into one question for Greg.

## The short version

- **One live defect, found by the plan's reviewer, not by the sweep** (Tier 0, small): the citation
  chip renderer and `citableText` disagree about nesting depth, so at eleven nested blockquotes one
  draws a chip the other says is not there. It is fixed first, in S5. The fifth sweep's twenty-two
  buildable clusters have all landed; what it left is small.
- **What three days and 856 commits added is mostly residue, not rot:** machinery for the deleted
  filesystem store that outlived it (about 1,600 lines of scripts and test setup), comments that
  still describe that store, the gist columns and a stylesheet that is now 73 lines of `@import`,
  dead lint suppressions, and tests that wait on a clock or carry guards the types could delete.
- **One extraction is worth doing:** the `revision_blocks` row → `Block` mapper exists five times.
- **Seven clusters, S1–S7, are built in this run** (S7, the deploy's robots.txt check, was moved
  out of the decision queue by the review). Eight items are Greg's or the Overseer's, in § For Greg.
- **§ What the review changed is binding on the builders** wherever it and a cluster's text differ.

## How it was run, and where it was scaled down

Breadth: six Sonnet nominators (leftovers from the fifth sweep; history since `59bd41171`; the
static tools; the zones the fifth sweep skipped; what the code says about itself; the defences) and
two GPT Luna nominators (server; client and tooling). **Both GPT runs returned no nominations after
a light pass** — targeted greps, no file-by-file reading, by their own scope lines. That is a weak
null, not a clean bill: the server and client zones were not swept by a second family at breadth.

Depth: **not run as separate investigation docs this time.** The fifth sweep wrote six, three days
ago, and all six concluded the architecture is sound; nothing the breadth pass returned is a
candidate for "real cause versus symptom" work. The cross-family check is instead GPT Sol's review
of this plan and of each cluster's code. If Sol's review finds an area that wants depth, it gets it.

Raw nominations are kept beside this doc's working files in the session scratchpad and summarised
here; the counts below are the nominators' own, and the ones marked ✓ I re-ran on today's tree.

## Scope line

- **Swept:** `src/`, `scripts/`, `tools/`, `evals/` for self-describing comments and stale names;
  `tests/` as defences; the fifth umbrella and its cluster plans for what was left; history
  `59bd41171..HEAD` (856 non-merge commits ✓, 126 postmortems dated 261003 or later by title, about
  15 read closely, 18 long commit bodies with no doc change); the repo root, `package.json`
  scripts, `.claude/hooks`, all CSS under `src/web/`, `infra/hetzner/` against its doc,
  `supabase/config.toml`, `drizzle/` (comment paths only), `docs/tutorials/` (identifier
  spot-check); 110 readiness records and 21 per-run logs.
- **Measured:** typecheck 0 errors over 3,336 files (2,810 at the fifth sweep); 0 import cycles;
  knip 0 unused files, 0 unused dependencies, 4 unlisted dependencies, 778 unused exports (463
  values at the fifth sweep, 538 now; pruning stays rejected); biome 174 errors, 166 warnings,
  5,326 infos; jscpd 548 clones, 1.22% of lines; 0 `@ts-ignore` / `@ts-expect-error` outside tests.
- **Not swept:** the SQL of the migrations; the contents of `docs/plans/`; `evals/` results; the
  interior of `infra/hetzner/provision.sh` (2,298 lines, spot-checked); per-export knip review;
  about 45 unopened "must agree" comment pairs.
- **Not run:** the full suite, a browser, a deploy, any paid call, any database write.
- **What the method cannot see:** runtime races; anything visual; CSS classes or custom properties
  built from a runtime-computed prefix; a coupled pair whose comment uses none of the phrases
  grepped for; and whatever a second model family would have nominated at breadth.
- **Tree audited:** `ba56c1cb` (origin/dev when the worktree was set up). Line numbers are stale
  already; locate by content. **Every "unused" below is an absence: re-run its grep before
  deleting.** One nominator's "nothing names it" was already wrong once in this sweep (S1, the
  witness instrument: my re-run found six more files naming it).

## Evidence states

**R** reproduced, **C** proved from the code, **H** hypothesis. ✓ means I re-ran the grep today.

## The clusters

All six are Tier 1 (cheap, mechanical, evidence in hand) except S5's mapper, which is Tier 2 and
gets a characterisation test before the extraction. Ease and value are 1–5. File sets are disjoint
between clusters in the same wave.

| # | Cluster | Ease | Value | Risk | Wave |
|---|---|---:|---:|---|---|
| **S1** | Delete what the filesystem store left behind | 4 | 4 | low | 1 |
| **S2** | False comments | 4 | 3 | very low | 1 |
| **S3** | Lint: dead suppressions out, cheap rules cleared and gated | 4 | 3 | low | 2 |
| **S4** | Tests that wait on a clock, or carry guards a type could delete | 3 | 4 | low | 2 |
| **S5** | Server: one block-row mapper, three dead null-checks, one `MAX_DEPTH` | 3 | 4 | med | 3 |
| **S6** | CSS: classes nothing emits and tokens nothing reads | 4 | 2 | low | 3 |

### S1 — delete what the filesystem store left behind

The store went on 2026-09-05 and the flag on 2026-09-06. Still here:

- **The store-migration "witness" instrument** (C ✓): `vitest.witness.config.ts`,
  `scripts/store-migration-witness.ts`, `scripts/store-migration-candidates.ts`,
  `tests/setup/fs-store-witness.ts`, `tests/setup/fs-store-witness-setup.ts`,
  `tests/store-migration-witness.json`; about 1,170 lines. The script's own comment says "there is
  nothing condemned left for it to witness". No `package.json` script names it. **But the names
  also appear in** `knip.jsonc`, `tsconfig.json`, `tests/one-store-only.test.ts`,
  `tests/store-migration-registry.ts` and its test, `tests/helpers/fixture-artefacts.ts`,
  `evals/deepen/run.ts`, `evals/deepen/harness.ts` and `docs/project/static-analysis.md` — the
  builder reads each and decides whether it is a config entry to remove, a comment to reword, or a
  live dependency that keeps a file alive. If the registry test is live for another reason it stays.
- **`scripts/migrate-fs-toc-to-hierarchy.ts`** (C ✓, 163 lines): migrates the filesystem store's
  `toc` names. Named only by `docs/project/structure-step.md`, two plans and a SQL comment in an
  applied migration (which is not edited).
- **`scripts/backfill-raw-manifests.ts`** and `tests/backfill-manifest.test.ts` (H, 299 lines): it
  repairs `data/<slug>/raw.json` on disk. `src/store/artifacts-pg.ts`'s `NoStoredDocument` error
  text points a reader at it. Delete only if the builder shows nothing writes or reads that file
  any more, and then reword the error text; otherwise leave it and say why.
- **The `{ kind: "off" }` arm of `ReaderPlan`** in `src/billing-plan.ts` (H): its comment says the
  filesystem store produces it and "index.ts refuses to boot". A nominator found nothing in `src/`
  that constructs it; a GPT nominator read the nearby comments as a deliberate billing-off state.
  The builder settles it by grepping every constructor of `ReaderPlan` and the `BILLING_OFF` path.
  **If any request can reach it, it stays and only the false comment is fixed.**

Done when: the files are gone, `npm run typecheck`, `npm run knip` and the suites that named them
pass, and a grep for each deleted basename over the whole tree outside `docs/plans/` and
`docs/postmortems/` returns nothing.

### S2 — false comments

Comment-only: no line of behaviour changes. The rule is CLAUDE.md's "always correct stale/incorrect
comments". A comment that records history ("was X until 2026-09-05") is fine and stays.

- **83 comments say `styles.css § <section>`** (C ✓, `grep -rn "styles\.css §" src tools scripts
  tests` = 83). `src/web/styles.css` is 73 lines of `@import` ✓; the sections live in 48 files
  under `src/web/styles/`. Each pointer is rewritten to the file that now holds the section.
  (The three hits in `tests/` belong to this cluster too; S4 does not touch those lines.)
- **Filesystem-store comments that are false as written** (C): `src/store/contracts.ts` (an
  `index.ts` "files adapter"), `src/messages.ts` ×2, `src/chat.ts`, `src/types.ts` ×4 (defending
  optional `visibility?` / `sharing` with the dead store — the comment is fixed; making the fields
  required is not in scope), `src/block-policy.ts`, `src/source-hash.ts`,
  `src/store/pg-searches.ts`, `src/fetch.ts`, `vite.config.ts`.
- **Gist-column and "Hierarchy" statements** (C): `library-hits.ts` ("default mode is
  `hierarchy`"), `Dock.tsx`, `narrow-window.css`, `models.ts` ("the core of the product"),
  `mode-band.css` and `referee.css` (naming `.nav-label`, `td.gist`, `.ctx-panel`),
  `StructurePanel`, `FeatureBoundary`, `ModeHerald`, `structure.ts`, `routes.ts`.
- **`tools/fleet/pause.ts`'s TODO** (C): says `ConversationRateLimit` "will be published"; it is in
  `wire.ts` and imported by `pause.ts`.
- **Dead repo paths in files `doc-links` does not read** (C): `infra/hetzner/provision.sh` (writes
  "see docs/project/remote-box.md" into the box's SSH config), `infra/hetzner/main.tf`,
  `knip.jsonc`, six in `supabase/config.toml`, four in `.env.example`. Applied `drizzle/*.sql`
  files are not edited. Widening `doc-links` to non-Markdown files was considered and **not built**:
  a test plus an exemption list for sixteen hits is more machinery than the class has earned.
- **`biome.jsonc`'s "~16 functions worth looking at"** — the rule reports 452. (S3 owns
  `biome.jsonc`; this line moves to S3.)

Done when: each grep above returns only history, `npm run typecheck` and `npm test` are unchanged,
and `git diff --stat` shows no non-comment line changed (the reviewer is asked to check exactly
that).

### S3 — lint: dead suppressions out, cheap rules cleared and gated

- **17 `suppressions/unused`** (R, biome's own report): 15 in `src/web/SketchView.tsx` as JSX
  comments that suppress nothing, plus `ScoreBars.tsx` and `StructurePanel.tsx`. Delete, then make
  `suppressions/unused` an error so the next dead one is caught.
- **Two ESLint suppressions in a Biome repo** (C): `tools/fleet/routes-new.ts` (`no-control-regex`)
  and `tools/fleet/web/src/ReadinessPanel.tsx` (`react-hooks/exhaustive-deps`). Biome ignores both.
  The second may be hiding a real hook-deps finding from the gate: remove it and see what the gate
  says; fix what it finds or suppress it in biome's syntax with the reason.
- **Captured web pages are linted** (R): 9 errors in `tests/fixtures/data-root/**/raw.html` and
  more under `tests/fixtures/**/*.html`. Exclude them in `biome.jsonc` the way
  `evals/extraction/fixtures/**` already is.
- **Rules cheap enough to clear and promote to error** (R, counts from today's run):
  `noDuplicateProperties` 8 (all `annotations.css`), `noUselessFragments` 9, `noImplicitAnyLet` 4,
  `useImportType` 3, `useRegexLiterals` 4 (`tools/fleet/pane.ts`), `noUnsafeFinally`,
  `noVoidTypeReturn`, `noChildrenProp`, `noShadowRestrictedNames` (13 across those four with
  `noUnsafeOptionalChaining`, whose 6 are all in tests). A rule is promoted only once its count is
  zero, and each promotion is proved by a red control (put one violation back, see the gate fail).
  `annotations.css`'s duplicate properties are checked in a browser if removing one could change
  which declaration wins.
- **`biome.jsonc`:** the deprecated `recommended` field that prints a warning on every run, and
  the stale "~16 functions" comment.
- **Four unlisted dependencies** (R, knip): `@jridgewell/trace-mapping`, `@supabase/auth-js`,
  `@tailwindcss/oxide`, `@vitest/utils` are imported but arrive only transitively. Declared in
  `devDependencies` at the versions already installed, so nothing new is downloaded.

Passed over: promoting all of lint (rejected by every sweep), and gating knip's "unused files"
alone (it is at zero, but `--include files` still flags two live Vite configs).

### S4 — tests that wait on a clock, or carry guards a type could delete

- **`pgReady`'s return type** (C): it returns `pool?: Pool` even with `keepPool: true`, which
  produces 179 `!pool` / `pool?.` / `pool!.` guards across `tests/`, four of them
  `describe.skipIf(!pool)` that can never skip and read like the silent skip removed on 2026-09-05.
  An overload returning `{ pool: Pool }` for `keepPool: true` lets the compiler find every guard,
  and they are deleted. This is a "kill a class by construction" item: less code, no new machinery.
- **`tests/admin-only-routes.test.tsx`** (R: failed in 2 of 21 readiness logs with the Suspense
  fallback's empty heading): it waits 50 × `setTimeout(1)` for a lazy chunk. Wait on the heading.
- **`tests/fetch.test.ts`'s absolute 400 ms budget** (R historically: 478 ms under load,
  2026-09-08): its own comment says the real check is the 1× / 2× / 4× ratio. Assert the ratio.
- **`tests/fleet-child.test.ts`'s global `process.kill` spy** (failed twice; cause H): inject
  `kill` the way `spawn` already is, if the source seam is one parameter; otherwise settle each
  fake child in `afterEach`.
- **`it.skipIf(!built)`** in `pdf-bundle-trace`, `cold-start-lazy-imports`, `no-secrets-in-bundle`
  (C): `worktrees.md` says these fail loudly; the code skips. Since `worktree:setup` builds
  (2026-10-06), the skip becomes a failure that names the build command, and the doc is then true.
- **`migration-reconciliations.test.ts`** still `describe.skip`s silently with no local database
  (C); it joins the `pgReady` rule.
- **Stale `REQUIRE_POSTGRES=1` comments** in 8 test files and `infra/hetzner/README.md` (C).
- **Five regex import-readers** where an AST helper exists (C): `tests/sanitize-client.test.ts`
  (its comment: "An AST check would be the real thing"), `tests/fleet-recovery-resume-route.test.ts`
  (double-quote only, the 261004b failure), `tests/overseer-launch-protocol.test.ts`,
  `tests/stop-details.test.ts`. They move to `tests/helpers/import-graph.ts` § `runtimeImportsOf`
  / `tests/helpers/ts-ast.ts`. Six postmortems name this class (a text match standing in for a
  parser). Each moved check is shown to fail against a wrong implementation the regex would pass.
- The 6 `noUnsafeOptionalChaining` hits in tests, so S3 can gate the rule.

Passed over, again: a blanket ban on sleeps in tests; merging the 16 private `waitFor` helpers.
Not built here: the 63 tests that read a `.css` file as text (a real class, but replacing them is a
judgement per test and some have no browser twin) — named for the next sweep.

### S5 — server: one block-row mapper, three dead null-checks, one `MAX_DEPTH`

- **The `revision_blocks` row → `Block` mapper exists five times** (C ✓):
  `src/store/artifacts-pg.ts`, `pg-revisions.ts`, `pg.ts`, `export.ts`, `public-reader.ts`. Four
  are identical apart from whitespace; the fifth (`public-reader.ts`) omits `note` on purpose. A
  new block column is five edits, and a miss in `export.ts` silently drops data from an export.
  Stage 1: a characterisation test over all five call paths, proved able to fail. Stage 2: one
  function beside the row type it reads (where the invariant already lives), with the public
  reader's omission an explicit argument or a wrapper, not a second copy. **Sol is asked directly
  whether the extraction earns its keep**, and to compare what each copy does on a malformed row
  before any is deleted (postmortem
  [261003a](../postmortems/261003a-consolidating-duplicate-controls-keeps-the-survivors-omissions.md)).
- **Three null-checks the `FetchedDocument` union made dead** (C ✓): `src/link-previews.ts` and
  `src/chat-tools.ts` (`|| doc.text === null`), `src/paper-text.ts` (`doc.text ?? ""`). Left by
  fifth-sweep cluster 17. The compiler confirms each narrowing.
- **`MAX_DEPTH = 12` twice** (C): `src/citable.ts` and `src/web/Cited.tsx`, each with a "kept in
  step" comment. One exports, the other imports — if the client may import that module without
  pulling server code into the bundle (`tests/eager-client-graph.test.ts` decides); otherwise an
  equality test.
- **Two decisions that live only in commit bodies** (C): `7fc1b41fb` (a stored run stamps the hash
  of the exact blocks it sent) gets a sentence in `docs/project/database.md` beside the hash-input
  section; `bddf8c0c8` (`forgetSummaries()` is a generation fence: "no stale summary survives the
  save settling", not "none is ever shown") gets one in `docs/project/links.md`.

### S6 — CSS: classes nothing emits and tokens nothing reads

- **Seven classes styled and never emitted** (C: a script checked 1,538 class tokens against the
  tree; 53 absent, 46 of those cleared as dynamic): `.cite-note`, `.sk-crumb`,
  `.skim-place-repeat`, `.srch-retry`, `.tip-soon-flag`, `.tip-soon-learned`,
  `.cmt-transport-error`. The builder re-greps each, including for a computed prefix.
- **Tokens defined and never read** (C): `--depth-3`, `--header-height`, `--quote-color`, and the
  `--sidebar-*` family (shadcn leftovers; there is no sidebar component).
- **`docs/project/design-css-overview.md`** says 15,951 lines over 37 files; it is 25,018 over 48.
  An entry-point doc, but this only makes it match the tree
  ([engineering-manager.md § Along the way](../reusable/engineering-manager.md#along-the-way)).
  Where the count can be replaced by the command that prints it, it is.
- A before/after browser look at three modes, since nothing here should change a pixel.

## How the clusters are built

Each cluster is one builder (an Opus subagent) in its own worktree, two in flight at most. **This
umbrella is the plan for all six**, reviewed once by GPT Sol before anything is built; each cluster
then keeps a short plan doc of its own (`261006j-sixth-sweep-s<N>-….md`) recording what landed, what
the builder found false in this plan, and what it left, and gets its own GPT Sol code review (which
may fix inside the cluster). The simpler option passed over: six separately reviewed plans. For
items this mechanical the plan review's value is in checking the file sets and the claims, which
one review of this doc does.

Gates per cluster: `npm run typecheck`, `npm test`, `npm run lint` on touched files, the
doc-links test, then merge `origin/dev` and push `HEAD:dev`. No deploy.

## For Greg

Nothing here is built. Each has a recommendation; the plain-words version goes to Greg as one
question when the clusters have landed.

1. **`docs/project/version-control.md` still describes asking Greg about every merge conflict**,
   and frames resolution as a "proposal rule" for him; CLAUDE.md and
   `git-resolve-merge-conflicts.md` have said "resolve it yourself" since 2026-09-10. It also lacks
   "merge `origin/dev` on waking". Carried from the fifth sweep's item 7. Rule-doc wording, so it
   needs a before and after. *Recommend:* yes.
2. *(Moved to S2 by the review: dated banners on the three stale tutorials.)*
3. **`--danger` and `--ink-faintest` are used and never defined**, so four rules always take their
   fallback; chat's tool errors draw in the brand orange. Defining a red is a small change a reader
   would see. *Recommend:* define `--danger` from the existing colour scale and delete the
   fallbacks; drop `--ink-faintest` in favour of the nearest defined ink.
4. **"One write in flight, the newest waiting behind it" now exists three times**
   (`useAutosavedText`, `add-purpose.ts`, the GPT-Live commit queue). The fifth sweep held a shared
   helper for want of a second instance; there is now a third. A helper is a new abstraction.
   *Recommend:* not yet — no drift is shown between the three; write the rule down in
   `web-client.md` and revisit when one of them gets a fix the others need.
5. **"A read is a value plus booleans"** — seven postmortems in three days name this class, and one
   names the by-construction fix: a single `asking | failed | known` type for a mode's read, which
   six per-mode hooks would adopt. Tier 3: large, invisible to readers, and it touches every mode.
   *Recommend:* its own plan, starting with one hook as a spike, after Greg says the class is worth
   a week.
6. **The sort / gate / reset CSS is copied across Debate, Glossary, Search and Quotes** (24
   duplicate groups). This is the CSS half of the fifth sweep's undecided question 3 (one word and
   one track for the threshold sliders). *Recommend:* decide question 3 first.
7. **`docs/plans/` holds 855 images (147 MB) and 132 diff/log files (8.9 MB)**, tracked. Every
   worktree and clone carries them. *Recommend:* leave history alone; ask whether screenshots older
   than a month may be deleted from the tree (they stay in git history).
8. **The retired `citation-find` rate bucket** survives in a database CHECK constraint and one
   test. Removing it is a migration. *Recommend:* yes, after a read-only count of production rows
   that still carry the value.
9. **For the Overseer — readiness records hold counts, not the names of failing test files.** 22 of
   99 finished runs failed in `test` and nothing says which file; a capped `failedFiles` list would
   make "red for hours or a flake?" answerable. It adds a field to a record shape the dashboard
   reads. *Recommend:* yes; queued for the Overseer rather than built here.
10. *(Moved to cluster S7 by the review; the text is kept as the cluster's description.)*
    **The deploy's robots.txt check is the weak one.** `scripts/deploy.ts`
    § `verifyRobots` uses a per-line regex (`hasDisallowAll`); postmortem 261005j and the function's
    own comment say the group-aware `judgeRobotsTxt` in `scripts/check-public-shell.ts` is the real
    check, and "a deploy does not run it". Swapping it deletes `hasDisallowAll` and its six tests.
    It is a change to the deploy script, which runs on the higher standard and which only the
    Overseer runs. *Recommend:* yes; queued for the Overseer.

Still undecided from the fifth sweep and unchanged: 1 (the spine hover card's bullets), 2
(`?spine=0`), 3 (the threshold sliders), 6 (the `toc/10` eval arm).

## Considered and rejected

For the next sweep's search. *(again)* marks an earlier rejection raised again.

- Splitting `Reader.tsx` (now one 4,242-line component), `converse` (1,125 lines) or any other long
  function by size *(again)* — 162 functions exceed 200 lines and none was shown to have a second
  reason to change except `exportArticle`, whose second reason is S5's mapper.
- Pruning knip's unused exports *(again)*; promoting all of lint *(again)*; a blanket sleep ban in
  tests *(again)*.
- Widening `doc-links` to non-Markdown files — see S2.
- Removing the `trajectory` → `skim`, `hierarchy` → `structure` and `?remember=` aliases, and the
  `liftLegacy*` URL shims: all kept on purpose, none has a removal condition that has passed.
- Making `visibility?` / `sharing` required on the article types: the comment defending the
  optional was false, but tightening the type is a separate change with its own callers to read.
- Merging the three hand-copied `class Cdp` clients in `scripts/`, and `sectionsOf` in two eval
  scripts: low stakes, measurement scripts, one has forked on purpose.
- Cluster 23 of the fifth sweep (async steering for the fleet dashboard) stays conditional on a
  recorded stall; none was found in the postmortems since.
- The fifth sweep's claim that `TOC10_STRUCTURE` / `TOC10_OUTPUT` "carry a false name" is itself
  wrong: they are the real toc/10 blocks the toc/11 patch replaces.

## One level up

**Is the overall approach sound? Yes.** Nothing found argues for a different design, and the
measurements moved the right way: no cycles, no unused files, a clean typecheck over 500 more
files.

The habit the fifth sweep named — a fix that does not travel to the siblings — showed up less this
time. What showed up instead is its cousin: **a thing is removed, and what described or served it
stays.** The filesystem store's instrument, scripts and comments; the stylesheet that was split
while 83 pointers kept its old name; three tutorials. A deletion's blast radius is found by grepping
for the *name* of the thing removed, in comments and config as well as code, and
[rename-or-move.md](../reusable/rename-or-move.md) already says that for a rename. The same sweep
after a removal is what would have caught all of S1 and most of S2.

## What the review changed

[GPT Sol's review](261006j-sixth-codebase-sweep-umbrella-review-sol.md), read-only, verdict **ready
with these fixes**. Ten findings, all accepted; none overruled. Where this section and a cluster's
text above differ, this section wins.

- **U1, S1.** `tests/store-migration-registry.test.ts` reads the witness JSON and executes the
  candidates script, and the registry itself is live (it checks today's lane assignments). So: the
  witness assertions are retired explicitly and the lane checks kept; the witness files go only once
  nothing live reads them. **`scripts/backfill-raw-manifests.ts` stays**: `raw.json` still has
  writers (`src/store/export.ts`, `src/fetch.ts`) and a reader. **`ReaderPlan`'s `off` arm goes**:
  no request path constructs it (`readBillingSummary`'s branches never do; `BILLING_OFF` exists only
  in a false comment in `src/billing/summary.ts`, corrected too). The builder still re-runs that
  grep before deleting.
- **U2, file sets.** `knip.jsonc` belongs to S1 alone (S2 does not touch it). The six
  `noUnsafeOptionalChaining` fixes (`tests/blocks-baseline.test.ts`,
  `tests/collect-pdf-figures.test.ts`, `tests/fleet-composer-envelopes.test.tsx`) belong to S4 alone.
  The `styles.css §` hits in `tests/` are 18 lines, not three; `tests/doc-links.test.ts`'s is a
  parser input and is left alone. S2 lands before S4 starts, so the two never hold a test file at
  once.
- **U3, S3.** The eight duplicate declarations in `annotations.css` are deliberate fallbacks (a
  plain `content` for browsers without alt-text syntax, a second for accessible wording). **They are
  not removed.** They get a `biome-ignore` with that reason, or are left as they are.
- **U4, S3.** Lint is not a gate (`scripts/check.ts` runs it with `gate: false`), so "promote to
  error" gated nothing, and `suppressions/unused` is a diagnostic category with no rule setting.
  **S3 clears and does not gate**: the dead suppressions, the two ESLint comments, the fixture
  exclusion, the trivially fixable small counts, the two `biome.jsonc` lines, the four unlisted
  dependencies. A new selective gate is added machinery and is not built.
- **U5, S4.** `pgReady` gets two public overload signatures (`keepPool: true` → a certain pool; the
  general options → as now), with compile-time cases for true, omitted and a plain boolean. The
  compiler does not report every redundant guard, and the 179 grep hits include unrelated pools
  (`tests/store-transaction-isolation.test.ts`): **only guards on a binding that verifiably came
  from the helper are removed.** `migration-reconciliations.test.ts` keeps its local-only mutation
  protection.
- **U6, S4.** `tests/fetch.test.ts`'s absolute budget is a deliberate defence: its comment says a
  linear implementation still blocked the server for seconds, so a ratio alone would pass the
  regression it exists for. **Not changed.**
- **U7, S5.** The mapper extraction earns its keep, narrower than written: the copies differ in
  `id` versus `blockId`, in what an empty result becomes, and in whether HTML is sanitised, and
  those differences stay at the call sites. The shared part is **a public-safe mapper, plus an
  owner wrapper that adds `note`** — not a boolean argument, because `public-reader.ts` expressly
  refuses privacy decisions hidden in arguments. The SELECT lists still need separate edits, so the
  claim is "one mapper to edit", not "one edit".
- **U8, S5, Tier 0.** Reproduced with React SSR: for `"> ".repeat(11) + "spya-k3m9qt"` the renderer
  draws a citation chip and `citableText` finds none (depths 10 and 12 agree). `src/citable.ts`
  counts AST levels; `src/web/Cited.tsx` counts block nesting. **A boundary parity test, red first,
  and a fix to the traversal, before any constant is shared** — equal constants cannot repair it.
  Small in practice (eleven nested blockquotes), but it is the "kept in step by a comment" pair
  having drifted, which is the evidence that matters.
- **U9, S6.** `--sidebar` itself is live (it feeds `--panel` in `tokens.css`) and stays; so does
  `.tip-soon-tap`, grouped with a dead selector. The `design-css-overview.md` counts are dated
  historical measurements with their command beside them, not false claims: **left alone.**
- **U10.** The robots.txt check is a reproduced defect (`hasDisallowAll` passes a Twitterbot-only
  restriction beside an unrestricted `User-agent: *`), so it is built now as **S7**; only running a
  deploy is the Overseer's. Dated banners on the three stale tutorials are factual corrections and
  join S2.

Waves, after the review: **1** S1 + S2 · **2** S3 + S4 · **3** S5 + S6 · **4** S7.

## Review status

- This umbrella, round 1: [GPT Sol](261006j-sixth-codebase-sweep-umbrella-review-sol.md),
  read-only, **ready with these fixes**; all ten applied above. No second round: the fixes narrow
  the work and each cluster's code gets its own review.

## What landed

(Filled in as each cluster lands.)

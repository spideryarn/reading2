/**
 * **Every test file that touches the filesystem store, and what is to be done
 * with it** — stage A of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
 *
 * A ledger, not a protection. The plan says so in as many words: *"the manifest
 * is a ledger, not the protection. The real protection against a wrong
 * classification is the per-suite mutation evidence from B and the assertion
 * inventory in G."* [store-migration-registry.test.ts](store-migration-registry.test.ts)
 * can prove that every mechanically discovered candidate has an entry and a
 * reason. **It cannot prove any verdict here is right.** A green run of it says
 * the list is complete, and nothing else. Do not cite it as coverage.
 *
 * ## Two maps, deliberately not one
 *
 * GPT Sol rejected the literal merge of this with 260903e's lane manifest, and
 * the counter-example is decisive: `tests/auth-user-seeding.test.ts` and
 * `tests/admin-store.test.ts` are pure Postgres tests, so the *store* verdict
 * says nothing about them, while their *lane* is decided by GoTrue reading
 * `postgres` whatever the SQL does. Co-location is worth having; pretending one
 * verdict implies the other is not. So: one file, two separately typed maps,
 * two completeness guards. **`STORE_MIGRATION` is finalised in stage A;
 * `TEST_LANES` in stage T-C**, after the database factory exists — because
 * deciding a lane means testing an assumption about a clean database, which
 * cannot be done before there is one.
 *
 * A third joined them in stage B3, for the same reason and one more:
 * `STORE_CONVERSIONS` records *that a file was converted and how much
 * evidence it left*, which is **historical and monotone** where a
 * `STORE_MIGRATION` entry is a description of outstanding work that ought to
 * die when the work does. Its own docstring has the argument.
 *
 * ## Where the entries come from, and what is deliberately absent
 *
 * Two witnesses, neither subsuming the other:
 *
 * 1. **[`scripts/store-migration-candidates.ts`](../scripts/store-migration-candidates.ts)**,
 *    a transitive import-graph walk. A file's imports are a *claim*.
 * 2. **[`store-migration-witness.json`](store-migration-witness.json)**, an
 *    instrumented full-suite run recording which files actually *executed* a
 *    condemned function, down to the method. What a file executes is the fact,
 *    and this is the authority on "needs action".
 *
 * **The 499 files that ran and touched nothing are excluded categorically, by
 * the witness, and that sentence is the recorded reason for all of them.** The
 * plan asks for *"a recorded reason for every file excluded as already safe"*
 * because an unexplained exclusion is where a missed file hides. Four hundred
 * and ninety-nine hand-written reasons would say less than this one does: each
 * of those files ran under instrumentation and reached no condemned function,
 * which is a stronger statement than any sentence somebody could write about it
 * — and a weaker one written 499 times would rot on the first refactor.
 *
 * ## The categories answer one question: *what work does this file need?*
 *
 * Not *what does it import*, and not *which store is it on today*. Two files
 * already running against Postgres can land in different categories, because
 * one needs an edit and the other does not.
 *
 * | category | the work |
 * |---|---|
 * | `filesystem-adapter-behaviour` | none until stage G. Its **subject** is the filesystem implementation, so it is kept until its adapter dies and deleted in the same commit. Deleting it earlier creates an uncovered interval indistinguishable from success. |
 * | `store-agnostic-fake` | swap the fake. The test is not about storage; it was handed a `createFsArtifactStore` over a temp directory because that was the cheapest store to construct. A narrow `ArtifactReads` or a purpose-built fake replaces it. |
 * | `database-integration` | move it, or finish moving it. It belongs on Postgres — either it is not there yet (a route suite on the `files` default), or it is there and still carries a filesystem half that goes away with the adapter. |
 * | `shared-mechanism-collateral` | **none, to this file.** It never chose the filesystem store; one shared mechanism put it on the list, and fixing that mechanism takes it off again without anybody opening the file. |
 *
 * ### The fourth category is earned by the data, and it has five mechanisms
 *
 * The plan named three categories. A fourth is warranted, and the check that
 * warrants it is that **every one of a file's recorded sites is incidental** —
 * a file that is a genuine database integration test *and also* records ledger
 * rows is a `database-integration`, not collateral. The mechanisms, all five
 * measured rather than assumed:
 *
 * - **`ledger-redirect`** — until 2026-09-05, `selected()` in
 *   [`src/store/ai-calls.ts`](../src/store/ai-calls.ts) returned `fsCostStore`
 *   whenever `NODE_ENV === "test"`, whatever the flag said, so any suite driving
 *   a request through `handleApi` wrote ledger rows to a file. **Stage C removed
 *   that line and nothing else about the selection**, so the mechanism then
 *   reached only the files that left `SPIDERYARN_STORE` unset and took
 *   `fsCostStore` from the `files` branch. **That branch went with stage F on
 *   2026-09-05 and the flag itself on 2026-09-06, so the mechanism reaches
 *   nothing at all now.** The twenty-two that pinned the flag recorded into the
 *   run's private database instead,
 *   and for them this mechanism is history rather than outstanding work; the
 *   entries are left saying so rather than rewritten one by one.
 * - **`step-context-paths`** — `runStep` in [`src/jobs.ts`](../src/jobs.ts)
 *   calls `contextPaths(job.slug)` **unconditionally**, on every step of every
 *   job, under either store; that is `fsLocations` and therefore `dataRoot`.
 *   So every job-running suite touches two condemned modules to compute a
 *   `dir` and an `htmlFile` string that the Postgres path never writes to.
 *   Whoever removes `StepContext.dir` resolves all of these at once.
 * - **`fixture-loader`** — [`tests/helpers/load-article.ts`](helpers/load-article.ts)
 *   (and `scratch-article.ts` over it) copies a fixture into Postgres with
 *   `copyArtefacts` **from a `createFsArtifactStore`**. Every suite that seeds
 *   an article this way inherits both touches. One helper, stage D's, decides
 *   all of them.
 *
 *   **Half resolved on 2026-09-05, and the twenty entries below are left saying
 *   what they said.** The loader's *source* is now
 *   [`helpers/fixture-artefacts.ts`](helpers/fixture-artefacts.ts), a reader over
 *   the fixture tree, so the `artifacts-fs` half of this mechanism is gone for
 *   every one of them — measured with the ad-hoc witness on four of the twenty,
 *   which went from `artifacts-fs:createFsArtifactStore` + `copy-artefacts` to
 *   `copy-artefacts` alone. The **`copy-artefacts` half remains**, because the
 *   loader still drives `copyArtefacts` and always will: it is what makes the
 *   fixture go into Postgres through the production write path. That module's
 *   fate is stage G's — it is on the instrumented list because it lived beside
 *   the adapters, not because a fixture loader is condemned. Rewriting twenty
 *   reasons to say half of each is now history would be twenty copies of this
 *   paragraph; the entries stay, and this is where the fact lives.
 * - **`shared-symbol`** — [`src/store/pg-chat.ts`](../src/store/pg-chat.ts)
 *   imported `requireTail` and `CHAT_SWEPT` from `src/store/fs.ts`: a surviving
 *   Postgres adapter depending on a condemned module. **Resolved in stage G on
 *   2026-09-05** — both moved to [`src/chat.ts`](../src/chat.ts), which already
 *   owned `ChatConflict` and every other `ChatThread[]` operation, on the
 *   precedent of `COMMENT_SWEPT` in `src/comments.ts`. The entries keeping this
 *   mechanism stay as the record of why they were classified that way; the
 *   reach itself is gone.
 * - **`import-only`** — the file imports the app, the app imports an adapter,
 *   and nothing calls it. Recorded only for entries the dynamic witness never
 *   saw; see `evidence` below.
 *
 * ## `evidence`, and why some entries carry it
 *
 * `"dynamic"` — the default — means **the instrumented run watched this file
 * execute a condemned function**, so its name is in the witness's `touched`
 * map. `"static-only"` means it is not, and the verdict rests on the import
 * graph plus the file's own docstring, which is weaker evidence. The guard
 * holds the two apart, so this field cannot quietly become decorative.
 *
 * They are files that **did not exist when the witness ran**, at
 * 2026-09-03T09:19Z, and arrived over the following day; re-running witness 2
 * is what upgrades them, and the list grows whenever a suite lands between two
 * runs. There was one exception until 2026-09-05 — `tests/slug.test.ts`, here on
 * the grep's authority because it read a condemned file's *source text*, which
 * is invisible to an import walk and executes nothing, so both witnesses were
 * structurally blind to it and only a human verdict covered it. Stage G's `jobs`
 * group deleted that case with `src/store/jobs-fs.ts`; the empty *Invisible to
 * an import walk* section at the foot of this map says what happened and why the
 * heading stays.
 *
 * ## Counts are perishable
 *
 * The witness measured 588 test files; the graph walk saw 597 an hour and a
 * half later. Nothing here is a fact about the repository for longer than a
 * morning. The guard re-derives the static universe on every run for exactly
 * that reason.
 */

/** What is to be done with a file. See the table in the header. */
export type StoreVerdict =
  | "filesystem-adapter-behaviour"
  | "store-agnostic-fake"
  | "database-integration"
  | "shared-mechanism-collateral";

/** Which shared thing put a collateral file on the list. One of five, above. */
export type CollateralMechanism =
  | "ledger-redirect"
  | "step-context-paths"
  | "fixture-loader"
  | "shared-symbol"
  | "import-only"
  /**
   * **The one mechanism that does not honour the category's promise**, and it is
   * here rather than made into a fourth category because the file's *store use*
   * really is incidental — what is not incidental is that it names a condemned
   * module in an `import`.
   *
   * `DATA_ROOT_ENV` from [data-root.ts](../src/store/data-root.ts) is the only
   * instance: two suites give each claim its own scratch root and then assert
   * the roots are **still empty**, which is an assertion that nothing was
   * written rather than a dependency on writing. But stage G cannot delete
   * `data-root.ts` without editing both files, so "nobody edits this file" is
   * false for them and saying otherwise would lose two files at the moment they
   * matter. GPT Sol, reviewing stage A, 2026-09-03.
   */
  | "condemned-symbol-import";

/** How the verdict was reached: watched executing, or read off the graph. */
export type Evidence = "dynamic" | "static-only";

interface EntryCommon {
  /**
   * Why **this file**, in the classifier's own words. Not a restatement of the
   * category — the category is already there — but what the file is for and
   * what the migration will have to do to it.
   */
  readonly reason: string;
  /** Omitted means `"dynamic"`, which is the ordinary case. */
  readonly evidence?: Evidence;
}

/**
 * A discriminated union rather than an optional `mechanisms` field, so that a
 * collateral verdict without a mechanism is a compile error rather than
 * something the guard has to notice.
 */
export type StoreEntry =
  | (EntryCommon & {
      readonly category: Exclude<StoreVerdict, "shared-mechanism-collateral">;
    })
  | (EntryCommon & {
      readonly category: "shared-mechanism-collateral";
      /** Non-empty. Several files are collateral twice over. */
      readonly mechanisms: readonly [CollateralMechanism, ...CollateralMechanism[]];
    });

/**
 * The store inventory. Keyed by repository-relative path, alphabetical.
 *
 * Finalised in stage A. A file added here is a claim that somebody read it.
 */
export const STORE_MIGRATION: Readonly<Record<string, StoreEntry>> = {
  /**
   * **Written on 2026-09-05, after the witness ran**, so it is here for the
   * ordinary reason the header gives: re-running witness 2 is what upgrades it.
   *
   * It is not resting on the import graph alone, though. The ad-hoc witness was
   * pointed at it —
   * `npx tsx scripts/store-migration-witness.ts --files tests/tree-redundant-rung.test.ts` —
   * and reported "ran, touched nothing" under full instrumentation. `evidence`
   * still says `static-only` because that is what the field means: the stored
   * `touched` map does not name this file, and the guard holds the two apart so
   * the field cannot become decorative.
   */
  /**
   * **The four suites the link-preview stage brought, 2026-09-05**, and all four
   * are here for one reason: they import `src/store/index.js` or a `pg-*`
   * adapter, which is how the import graph reaches a condemned module. None of
   * them touches the filesystem store, because there is not one to touch — it
   * was deleted on 2026-09-05, and `link_previews` could not have had a files
   * side even in principle: it is one row shared by every reader and a claim two
   * servers contend for. *This cited `SEAM_ASYMMETRIES` until that constant was
   * retired the same day, one commit after this line was written.*
   *
   * `evidence: "static-only"` on all four, and that is what the field means
   * rather than a shrug: they were written after the witness run, so the stored
   * `touched` map does not name them. Re-running witness 2 is what upgrades it.
   */
  "tests/link-preview-route.test.ts": {
    category: "database-integration",
    evidence: "static-only",
    reason:
      "Born on Postgres. It seeds two articles under two real owners through `scratchArticleInPg` " +
      "and drives `handleApi`, so the ownership half of what it tests IS the Postgres owner " +
      "filter. `fetchDocument` is the only thing faked; the store, the claim and the limiter are " +
      "the real ones. There is no filesystem side of this to have migrated from.",
  },
  "tests/link-preview-cache.test.ts": {
    category: "database-integration",
    evidence: "static-only",
    reason:
      "Born on Postgres, and could not be anywhere else: its subject is an advisory-lock claim, " +
      "a lease, an `expires_at` in a WHERE clause and an upsert that refuses to downgrade a live " +
      "row. Every one of those is a property of the database rather than of a store interface.",
  },
  "tests/link-summary-cache.test.ts": {
    category: "database-integration",
    evidence: "static-only",
    reason:
      "Born on Postgres, for `link-preview-cache.test.ts`'s reason with money on it: its subject " +
      "is an advisory-lock claim, a lease, a fencing token and four staleness comparisons in a " +
      "WHERE clause. It also seeds two articles under two real owners, because the store resolves " +
      "the slug through `articleIdForOwned` and the owner filter IS half of what it tests.",
  },
  "tests/link-summary-prompt.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Pure functions in, strings out. It imports src/link-summary.js for the prompt builders and " +
      "the request body, and that module imports the store — which is how the import graph reaches " +
      "a condemned one — but nothing here selects a store, opens a connection or writes a byte. " +
      "Same shape and same backstop as link-preview-extract.test.ts.",
  },
  "tests/fetch-allowance.test.ts": {
    category: "database-integration",
    evidence: "static-only",
    reason:
      "Born on Postgres. A rate limit that is not atomic across instances is not a rate limit " +
      "(GPT Sol, 2026-09-05, P1-5), so the thing under test is a count and an insert inside one " +
      "owner-scoped `pg_advisory_xact_lock` — which has no filesystem equivalent.",
  },
  "tests/link-preview-extract.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "HTML in, four fields out. It imports src/link-previews.js for `extractPreview` and " +
      "`saneParagraph`, and that module imports the store — which is how the import graph reaches " +
      "a condemned one — but nothing here selects a store, opens a connection or writes a byte. " +
      "The unit lane's poisoned `DATABASE_URL` is the backstop, and it passes under it.",
  },
  "tests/tree-redundant-rung.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Pure-function tests of `buildTree` and `checkTree`: a model proposal in, a tree out, with " +
      "block fixtures written in the file. It imports src/hierarchy.js, which is how the import " +
      "graph reaches a condemned module — that file also holds stage 4's CLI and its checkpoint " +
      "plumbing — but nothing here selects a store, reads a path or writes a byte, and the " +
      "instrumented run confirms it executes no condemned function.",
  },
  /**
   * **Arrived from `dev` on 2026-09-04 and the hole check caught it**, which is
   * why that check walks the import graph live instead of reading a stored
   * answer. It reaches a condemned module through `src/jobs.js`; it never runs
   * one.
   *
   * **`npm test` cannot redden this file at all.** Its assertions are three
   * `@ts-expect-error` directives over `precededBy`, and vitest strips those
   * without looking — `tests/tsconfig.json` is the instrument, and the file's
   * own header says so. So the flag cannot reach it from either side: no store
   * is selected, and no store code executes.
   */
  "tests/step-job-preceded-by.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "A compile-time test of `StepBefore<S>`. It imports src/jobs.js, which is how the import " +
      "graph reaches a condemned module, but its subject is a type and its assertions are " +
      "`@ts-expect-error` directives that only `npm run typecheck` evaluates. Nothing here selects " +
      "a store or calls one, so the hinge changes it in no way.",
  },
  /**
   * **Arrived from `dev` on 2026-09-05 with Debate mode, and the hole check
   * caught it** — which is the second time that check has earned its keep by
   * walking the import graph live rather than reading the stored answer. The
   * witness JSON was measured at 02:10 that morning and this file did not exist.
   *
   * Measured rather than reasoned, on the `tree-redundant-rung.test.ts`
   * precedent above:
   * `npx tsx scripts/store-migration-witness.ts --files tests/debate-step-registration.test.ts`
   * reported **"ran, touched nothing"** under full instrumentation, and the
   * instrument's own `--self-check` passed immediately before — twelve control
   * files, all eight modules still hooked at method level, 24 sites. An
   * instrument that had quietly stopped hooking anything reports exactly the
   * same "touched nothing", which is why the self-check comes first and is
   * named here rather than assumed.
   *
   * `evidence` stays `static-only` because that is what the field means: the
   * stored `touched` map does not name this file. The guard holds the two apart
   * so the field cannot become decorative.
   */
  "tests/debate-step-registration.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Debate's step registration, asked as effects: the stamp field names inside the artefact, " +
      "the `STAMP_SOURCE` row, and a model resolved through `modelFor` rather than compared " +
      "against `CAPABLE_MODEL`. It reaches a condemned module through src/pipeline.js, which is " +
      "how most of this map's files reach one, and it runs against `memoryArtefactsFrom` " +
      "(tests/helpers/memory-artefacts.ts) rather than any store — the stage D helper written " +
      "for exactly this. Nothing here selects a store, reads a path or writes a byte.",
  },
  /**
   * **The entry the dynamic witness could not produce**, and the reason the
   * registry does not take its silence as proof.
   *
   * The instrument records *calls*: it proxies each condemned export and notes
   * an `apply`. This file imports `PATHS` — a plain object of filenames — and
   * only ever *reads* it, so nothing was ever applied and the witness filed the
   * file under "ran and touched nothing". GPT Sol found it by reading the
   * instrument rather than trusting its output, 2026-09-03, and it is the whole
   * of the class: a static sweep for runtime imports of a condemned module
   * across every test file turns up exactly one other candidate, and none in
   * `ranAndTouchedNothing`.
   */
  "tests/store-artefacts-pg.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["shared-symbol"],
    evidence: "static-only",
    reason:
      "**Settled in stage G, 2026-09-05, and the prediction was wrong about the remedy.** It " +
      "borrowed `PATHS` from the filesystem adapter so that the two maps agreed about what an " +
      "artefact of each kind is called — a constant, read and never called, which is why the " +
      "witness could not see it. This entry expected the names to move somewhere neutral. They " +
      "did not need to: the comparison was between two **derived** maps, and the sibling " +
      "assertion holds `STORAGE` against `STEPS[step].produces` in `src/pipeline.ts`, which is " +
      "where a step actually declares what it makes. That is strictly the better oracle, and it " +
      "catches one thing the pair could not — a `PATHS` entry no step produces was invisible to " +
      "a comparison of the two. So `cover the same (step, kind) pairs` was deleted rather than " +
      "relocated. The file also gained two cases ported from `tests/step-context-paths.test.ts` " +
      "as that file died: the artefact counts each of `extract` and `hierarchy` declares, and " +
      "`stepIsDone` over an empty store.",
  },

  "tests/a-claim-that-lost-its-draft.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "step-context-paths", "condemned-symbol-import"],
    reason:
      "Pins `JobDraftGone` — a claimant whose draft is deleted mid-step must end the job rather " +
      "than log `lost the claim`. It already pins the flag to postgres and takes the run lock; " +
      "every filesystem touch was the ledger the redirect hands it plus the `dir` string `runStep` " +
      "computed before calling the step. It imported `DATA_ROOT_ENV` to point itself at a scratch " +
      "root, so stage G had to touch it. **And what stage G found there is worth more than the " +
      "edit**: the root's comment read *\"no step here writes to a disk, and this proves it\"* and " +
      "**nothing ever read the directory back** — no `readdir`, no assertion, in any case. It " +
      "proved nothing, and it cited `claim-session-postgres`, the file that actually asserted on " +
      "its roots. The machinery is gone and a note stands where it was; a comment claiming an " +
      "assertion that is not there is this job's dominant failure, found here by accident.",
  },
  "tests/acquire-extract-blocks-end-to-end.test.ts": {
    category: "store-agnostic-fake",
    reason:
      "**Done in stage G, 2026-09-05, and the prediction held: 5 cases in, 5 out.** It asks " +
      "whether stages 1, 2 and 3 *join* — that the manifest stage 1 returns is the one stage 2 " +
      "resolves. It ran `fsArtifacts` under a scratch `SPIDERYARN_DATA_ROOT` purely because a " +
      "store is needed for `previousBlocksFrom` and `assertIdsCarried`; nothing in the claim was " +
      "about where the artefacts landed, and it is `memoryArtefacts()` now. **One correction " +
      "worth keeping**: the scratch root was doing even less than this entry credited it with — " +
      "`fsBlobs` resolves `data/_blobs` off the repository root and ignores the override, so the " +
      "bytes never went where the variable said.",
  },
  "tests/all-skipped-publication-log.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B on 2026-09-04, and the entry stays until the witness is re-run.** " +
      "The coordinator must not put a Drizzle error's bound parameters — a job's steps array and " +
      "the article's title — into a log line. Its header used to say `no database at all, " +
      "deliberately`, and the whole fixture was `fsJobStore` and `fsStoreSession`; it now pins " +
      "`postgres` before any import, seeds one article through `scratchArticleInPg` and drives the " +
      "real `claimSession`, with `expect(STORE).toBe('postgres')` where the `files` self-check " +
      "used to be. Mutation watched red: `error: ending.error ?? null` in `finishIn` set to " +
      "`null`. The category is left alone deliberately — a converted file may only leave this map " +
      "once `store-migration-witness.json` is re-run at the end of stage B, so this reason says " +
      "the work is done rather than the verdict being quietly re-labelled.",
  },
  "tests/all-skipped-publication-refusal.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "step-context-paths"],
    reason:
      "An all-skipped claim whose publication is refused must end the job rather than hang it. " +
      "Runs against Postgres by hoisted flag with a real draft and a real lineage conflict; the " +
      "four filesystem sites are the test ledger and `contextPaths`, neither of which it asked for.",
  },
  "tests/artefact-copy.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "`copyArtefacts` and `readParts` exercised filesystem-to-filesystem, over a written-out list " +
      "of expected files. `src/store/copy-artefacts.ts` is on the condemned list, and the " +
      "fs-to-fs direction is the only one this file drives — its Postgres counterpart is the " +
      "fixture loader.",
  },
  "tests/billing-settlement.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["step-context-paths"],
    reason:
      "Reads `ingest_events` back at all seven places a job can end, to prove a quota slot is " +
      "charged or released exactly once. Postgres from the first line; the two filesystem sites " +
      "are `runStep` building a `StepContext` for a step that writes nothing to disk.",
  },
  "tests/block-roles.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "**Re-classified in stage D on 2026-09-05, from `store-agnostic-fake`, after reading it.** " +
      "Most of the file counts notes, supplement blocks and markers across the committed corpus " +
      "after a real `runExtract` and `splitIntoBlocks`, and none of that touches a store. Its one " +
      "store-touching case is *survives the filesystem artefact store, field for field*, and that " +
      "case is a **serialisation round trip**: write the artefact, read it back, and check " +
      "`role`, `treatment` and `noteId` all came home. Handing it an in-memory fake would make it " +
      "`toEqual` against the object it just put in — a case that cannot fail, which is worse than " +
      "the reach it removes. The claim itself is not lost: " +
      "`tests/store-block-roles-pg.test.ts` is the same round trip through Postgres, and this " +
      "case dies with the adapter in stage G.",
  },
  "tests/blocks-baseline.test.ts": {
    category: "store-agnostic-fake",
    reason:
      "Stage 3 must get the previous run's blocks from a store rather than from a path, and must " +
      "tell absent from unreadable. It runs the same five mutations against both stores; the " +
      "filesystem arm is a constructed store handed straight to `previousBlocksFrom`, so a narrow " +
      "fake substitutes for it without touching the claim. **Stage D looked at it on 2026-09-05 " +
      "and left it, for a reason worth having in front of whoever picks it up.** Six of its seven " +
      "filesystem cases take `helpers/memory-artefacts.ts` unchanged; the seventh — *refuses when " +
      "stage 4's copy is over the size this store can read* — is about the 32 MiB ceiling in " +
      "`DECODERS`, which Postgres has no equivalent of and a fake cannot have without copying the " +
      "table. Converting six of seven leaves the import and frees nothing, so the unit of work is " +
      "either stage G's per-assertion inventory or moving that one case to " +
      "`tests/pipeline-artifact-store.test.ts`, where the adapter's own surface already lives.",
  },
  "tests/candidates-route.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "fixture-loader"],
    reason:
      "Already converted: it pins `postgres` before any import specifically so the " +
      "`chat_threads_kind` CHECK is in play, and seeds through `scratchArticleInPg`. Its three " +
      "filesystem sites are the seeder's copy step and one ledger row from the stubbed model call.",
  },
  /**
   * **Written 2026-09-05, after the witness ran**, so `static-only` for the
   * ordinary reason the header gives. Modelled line for line on
   * `chat-anchor-route.test.ts`, which is the entry after next, and it reaches
   * what it reaches by the same two doors.
   */
  "tests/chat-help-route.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "fixture-loader"],
    evidence: "static-only",
    reason:
      "`chat_messages.help` at the route: what the wire may carry, and that a retry of a help " +
      "question is still answered as one. It pins `postgres` before any import and seeds through " +
      "`scratchArticleInPg`; what it still reaches is the seeder's copy step and the ledger row " +
      "the stubbed model call records.",
  },
  /**
   * **Written 2026-09-05.** A pure prompt-wording test, and it reaches a
   * condemned module only by naming `src/converse.js` in an `import` — the same
   * shape as `help-prompt.test.ts` below and as `tree-redundant-rung.test.ts` at
   * the top of this list.
   */
  "tests/chat-search-triggers.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Report 1X: the chat system prompt's search triggers, read off " +
      "`buildConverseMessages(...)[0].content` with fixture blocks written in the file. No " +
      "network, no store, no path. It imports src/converse.js, which is how the graph reaches a " +
      "condemned module, and executes none of it beyond building a message array.",
  },
  "tests/chat-anchor-route.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "fixture-loader"],
    reason:
      "**Converted in stage B on 2026-09-04**, and the sentence that made it a candidate is the " +
      "one it deleted: its header used to leave the foreign key to `chat-anchor.test.ts` because " +
      "`this harness writes to the filesystem store, which has no such thing`. It now pins " +
      "`postgres` before any import and seeds through `scratchArticleInPg`; what it still reaches " +
      "is the seeder's copy step and the ledger row the stubbed model call records.",
  },
  "tests/chat-anchor.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    reason:
      "The Postgres half of the anchor: three legal shapes, the `{ blockId, quote }` fourth that " +
      "must not exist, and the `comments_identity_fk` an export/import round trip needs. It talks " +
      "to Drizzle directly and reaches the filesystem only through `loadArticleIntoPg`.",
  },
  "tests/chat-library-exclusion.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    reason:
      "`excludeSlug` must filter inside the query rather than after the cap, with a fixture that " +
      "deliberately beats the over-fetch. Already rewritten off `data/` directories onto scratch " +
      "articles in Postgres for exactly this migration; what is left is the seeder's own copy.",
  },
  "tests/chat-live-ticket-route.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    reason:
      "**Converted in stage B on 2026-09-04.** The live ticket must hand back the history and the " +
      "id of the current tail **from one read**, and must not seed a voice model with block ids. " +
      "Under Postgres *last* is a fact about `chat_messages.ordinal` resolved by a second query, " +
      "so the tail can be wrong — on the copied `example/` it could not be, because the messages " +
      "came back in the order they went into the object. It also journals a `realtime_sessions` " +
      "row now. What is left is the seeder's copy step; the model is stubbed, so no ledger row.",
  },
  "tests/chat-live-turn.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "fixture-loader"],
    reason:
      "**Converted in stage B on 2026-09-04.** What a second tab does to a live stream — a stale " +
      "retry must not abort the answer and then 409, and a stop naming a replaced answer must not " +
      "kill the replacement. Its `loadThreads` read-back would have returned an empty array under " +
      "a pinned flag rather than an error, so every `status` assertion would have read `undefined` " +
      "and passed nothing; it now goes through `chatStore.load`. The move also puts the store " +
      "attempt in play — `pgChatStore.finish` refuses a caller with no token, where the " +
      "filesystem store had none at all. What is left is the seeder's copy and the ledger row the " +
      "stubbed stream records.",
  },
  "tests/chat-route.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "fixture-loader"],
    reason:
      "The `begin` frame's ids, at the route, where the two correct halves used to disagree. " +
      "Already on Postgres via a hoisted flag and `scratchArticleInPg` — its docstring is the one " +
      "the other converted suites cite for why the flag must be set in `vi.hoisted`.",
  },
  "tests/chat-spoken-route.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    reason:
      "**Converted in stage B on 2026-09-04.** The one write path whose contents a browser " +
      "dictates: which claims in a spoken exchange the route believes, which it replaces, and the " +
      "409 that is the endpoint's whole idempotency. Its read-backs went through `loadThreads`, " +
      "which reads the data root and never consults the store — so pinning the flag without " +
      "moving them would have handed every one an empty list rather than an error. They now go " +
      "through `chatStore.load` inside `asTestOwner`, over an article `scratchArticleInPg` " +
      "seeded. What is left is the seeder's copy step; no model is called, so no ledger row.",
  },
  "tests/claim-session-postgres.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "step-context-paths", "condemned-symbol-import"],
    reason:
      "The flip's acceptance test: `claimSession` picks the Postgres session and a job published " +
      "through it reaches the shelf. It gave every claim its own empty scratch root and asserted " +
      "the roots were **still empty** afterwards — so its filesystem contact was an assertion that " +
      "nothing was written there, which is the opposite of a dependency. This entry asked that " +
      "stage G **re-express those eleven assertions rather than delete them**, and that is what " +
      "happened on 2026-09-05: `assertScratchUntouched(root)` is `assertNothingOnDisk(slug)`, " +
      "which asks whether `data/<slug>/` and `output/<slug>.html` exist under the repository " +
      "root — where the deleted `dataRoot()` resolved on a laptop, and where a rebuilt " +
      "`path.resolve(import.meta.dirname, \"..\", \"..\")` would land. All eleven call sites " +
      "kept, and the new form is stronger in one direction: the temp root only ever proved that " +
      "nothing was written *to the root it had pinned*.",
  },
  "tests/comment-referee-mark.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    reason:
      "A referee's negative valence must survive `handleApi` → `pgCommentStore` → `loadComments` " +
      "without being clamped to zero by anything shaped like a confidence. Pinned to `postgres` " +
      "already, because `comments.criterion_id` and `comments.valence` are columns; the seeder is " +
      "its only filesystem reach.",
  },
  /* **`tests/data-root.test.ts` is deleted**, 2026-09-05, in stage G's last
     adapter group, with `src/store/data-root.ts`, `src/store/artifacts-fs.ts`
     and `src/job-scope.ts`. Its entry said the prediction that held: *"its
     `/var` and warm-`/tmp` arguments have nowhere to go once no path is
     computed at all"*. Every one of its cases was `chooseDataRoot`,
     `findRepoRoot`, `dataRoot` or `fsLocations`, so there was nothing in it to
     relocate. The one thing worth naming is its path-traversal case, *refuses
     an id that could climb out of the scratch directory*: `segment()` refused
     `..`, `a/b`, `""` and `.` as a job id, and it was the only guard on a job
     id anywhere. It is not homeless — **no job id is concatenated into a path
     any more**, so the property has ceased to exist rather than lost its
     coverage. Slugs are a different question and `assertSlug` still answers it
     (`tests/slug.test.ts`). */
  /**
   * **Arrived 2026-09-05 with the empty-block id fix**, and the hole check
   * caught it the same way it caught `step-job-preceded-by`: a new test file
   * that reaches a condemned module through an import it needs for one
   * assertion. Classified by reading it rather than by re-running witness 2,
   * which takes the box's Postgres lanes with it and would have been a twelve
   * minute run beside other agents' suites.
   */
  "tests/empty-blocks-keep-their-ids.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Block ids surviving a re-extraction, per docs/project/block-ids.md. Its last case asks the " +
      "real `STEPS.blocks.isDone` — hence the `src/pipeline.js` import the graph follows — but " +
      "hands it a hand-built `ArtifactReads` of three artefacts, and `blocksMatchTheirHtml` reads " +
      "through that object and nothing else. Every other case calls `splitIntoBlocks` on a string. " +
      "No store is selected and none is constructed, so the hinge changes it in no way.",
  },
  /**
   * **`evidence: "static-only"`, because this file arrived after the witness
   * ran** — 2026-09-05 against 2026-09-03T09:19Z — so its name is not in the
   * stored `touched` map and cannot be, until witness 2 is re-run. The verdict
   * rests on the import graph and on the file's own seeder call, which is the
   * same standing as its several neighbours here.
   */
  "tests/enqueue-drives-what-it-queues.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    evidence: "static-only",
    reason:
      "`enqueue` drives what it queues unless the caller passes `pump: false`, asserted as an " +
      "effect — queue a `fetch` step on a seeded article and look a moment later at whether " +
      "anything moved it. The claim is about the queue and only exists in Postgres; the seeder is " +
      "the whole of its filesystem contact. Arrived 2026-09-05 with the parameter, which replaced " +
      "three callers setting `VERCEL=1` to make one `if` go the other way.",
  },
  "tests/enqueue-owns-the-article.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    reason:
      "A slug-named job may only be queued by the article's owner, asserted as *the row cannot be " +
      "created* rather than *it cannot run*. Its own header explains that the filesystem store " +
      "has no owner column and therefore no second reader, so this claim only exists in Postgres; " +
      "the seeder is the whole of its filesystem contact.",
  },
  "tests/glossary-ideas-baseline.test.ts": {
    category: "store-agnostic-fake",
    reason:
      "The four states stages 5d and 5f must tell apart — absent, hash-mismatched, unreadable, " +
      "throwing — where confusing the third with either of the first two silently replaces a " +
      "glossary instead of appending to it. The filesystem arm is a constructed store handed to " +
      "`previousGlossaryFrom`; the Postgres arm already carries the same cases. **Stage D checked " +
      "it on 2026-09-05 and found nothing standing in the way**, unlike its neighbour " +
      "`blocks-baseline`: every write in its filesystem arm is a shape or parse manipulation that " +
      "`helpers/memory-artefacts.ts`'s `plant` reproduces, and there is no ceiling case. It is " +
      "unconverted because the stage stopped, not because it cannot be — about fifteen `writeFile` " +
      "sites, and `articleIn(dir)` reads the article off the same directory, so the fixture tree " +
      "stays either way.",
  },
  "tests/helpers-load-article.test.ts": {
    category: "database-integration",
    reason:
      "Not collateral: its subject **is** `tests/helpers/load-article.ts`, so it is edited in the " +
      "same commit as the helper rather than resolved by it. Each of its four cases is one of the " +
      "loader bugs that would have produced a green suite proving nothing — no bytes in the " +
      "bucket, the wrong `created_at`, a zero-step copy that still published.",
  },
  "tests/helpers-seed-reader-state.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    reason:
      "Covers the one thing in the reader-state seeder that no corpus fixture exercises: a comment " +
      "anchored to a block the current revision no longer has, which needs an identity that " +
      "writing the blocks does not mint. Its own writes are direct Drizzle inserts; the article " +
      "underneath them comes from `loadArticleIntoPg`. It also reads `data/` corpus JSON directly " +
      "with `readFile`, which the graph walk cannot see and stage G's corpus decision still owns.",
  },
  /**
   * **Landed after the witness ran, so the verdict is the graph's plus the
   * file's own subject** — the same position, and the same classification, as
   * the eval-parity entry below it.
   */
  /**
   * **Written on 2026-09-05, after the witness ran**, so it carries
   * `evidence: "static-only"` for the reason the header gives — re-running
   * witness 2 is what upgrades it, and the whole-suite run was deliberately not
   * repeated for one new file.
   *
   * It is not resting on the import graph alone. The ad-hoc witness was pointed
   * at it —
   * `npx tsx scripts/store-migration-witness.ts --files tests/helpers-store-fakes.test.ts` —
   * and reported **"ran, touched nothing"** under full instrumentation. The
   * graph reaches `artifacts-fs` from here only through
   * `helpers/memory-artefacts.ts` → `src/pipeline.ts`, whose `contextPaths` this
   * file never calls.
   */
  "tests/helpers-store-fakes.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "The two stand-in stores stage D introduced, tested for the two properties the suites using " +
      "them cannot reach: the fixture reader's size ceiling, and that the memory fake hands back " +
      "copies rather than its own objects. Both were P1s from that stage's cross-family review, " +
      "and both were invisible from the ten suites — the corpus is 27× under any ceiling, and " +
      "every caller happened to write back through the reference it read. **Nothing here needs " +
      "doing when the filesystem store goes**: neither helper imports a condemned module, and the " +
      "graph only reaches one through `src/pipeline.ts`, which this file never asks for a path.",
  },
  /**
   * **Written 2026-09-05.** Report 1S's addendum, and the property that costs
   * money if it breaks: everything above the `cache_control` breakpoint has to
   * be byte-identical between a help turn and an ordinary one. Its second half
   * drives `converse` with a stubbed `fetch` to say the same thing about the
   * tool definitions.
   */
  "tests/help-prompt.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Fixture blocks written in the file, `fetch` stubbed, and the assertions are on the message " +
      "array and the serialised request body. It imports src/converse.js, which is how the graph " +
      "reaches a condemned module; nothing here selects a store, reads a path or writes a byte.",
  },
  "tests/hierarchy-cascade.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "The pure arithmetic of the hierarchy cascade — the stopping rule, the batch packing and " +
      "the starts-only range derivation. Every function under test is a function of an article " +
      "and a recipe, with no model, no network and no store; it reaches a condemned module only " +
      "because `src/hierarchy.ts` imports the app to reach `generateHierarchy`. Nothing here " +
      "changes when the filesystem store goes.",
  },
  /**
   * **The cascade's other half, and the same verdict for the same reason.**
   * Landed 2026-09-05 with stage 4 of
   * docs/plans/260904d-deepen-fat-sections.md, long after the witness ran, so
   * `static-only` is the state of the evidence rather than a preference —
   * re-running witness 2 is what upgrades it.
   */
  "tests/hierarchy-expand.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "The scoped expansion call's protocol: the prompt's heading precedence, the request's " +
      "cache order, the strict reading of an answer, and the record of what was decided about " +
      "each candidate. It makes no model call and constructs no store; its only file read is " +
      "three committed JSON fixtures under `evals/results/`, by an absolute path off " +
      "`import.meta.url`. It reaches a condemned module only because `src/hierarchy.ts` imports " +
      "the app to reach `generateHierarchy`. Nothing here changes when the filesystem store goes.",
  },
  /**
   * **The third of the cascade's files, and the first that touches a store at
   * all** — which is why the reason below says what kind. Landed 2026-09-05
   * with the second half of stage 4 of
   * docs/plans/260904d-deepen-fat-sections.md, after the witness ran, so
   * `static-only` is the state of the evidence rather than a preference.
   */
  "tests/hierarchy-deepen.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "The scoped expansion checkpoint: the canonical request the key is a digest of, the gate " +
      "a stored answer has to pass, and a whole wave run against a fake executor. It does use a " +
      "checkpoint store — `memoryCheckpoints`, the in-memory fake — and never a real one, so " +
      "there is no database, no blobs and no filesystem here; `SPIDERYARN_STORE` changes nothing " +
      "about it. It reaches a condemned module only because `src/hierarchy.ts` imports the app " +
      "to reach `generateHierarchy`. Nothing here changes when the filesystem store goes.",
  },
  /**
   * **Stage 5's two files, landed 2026-09-05**, and the same verdict as the
   * three above for the same reason — they reach a condemned module only through
   * `src/hierarchy.ts`, which imports the app to reach `generateHierarchy`.
   * `static-only` is the state of the evidence rather than a preference: both
   * arrived long after witness 2 ran, and re-running it is what upgrades them.
   */
  "tests/hierarchy-prompt-hoist.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Three constants and a renderer, pinned where they landed after being hoisted out of " +
      "`src/hierarchy.ts` into a leaf so that the deepening wave could be imported without " +
      "closing a cycle. It builds one request in memory and hashes it; there is no store, no " +
      "network and no filesystem. Nothing here changes when the filesystem store goes.",
  },
  "tests/hierarchy-deepen-wave.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "The deepening wave end to end against a fake executor: which sections a mechanical bound " +
      "selects, that the result does not depend on the order the calls come back in, that a wave " +
      "declines to start a call it cannot finish, and that the whole thing is off by default. The " +
      "two model calls `generateHierarchy` would make are mocked at the module boundary and the " +
      "only stores it constructs are `nullCheckpointStore` and `memoryCheckpoints`, so there is " +
      "no database, no blobs and no filesystem. Nothing here changes when the filesystem store " +
      "goes.",
  },
  /**
   * **Arrived from `dev` after the registry was written, and the hole check
   * caught it** — which is the whole reason that check re-derives the import
   * graph live rather than reading a stored answer. Named, classified, kept.
   *
   * Classified twice, independently, and identically: the registry's owner and
   * the eval author who added the test both landed on
   * `shared-mechanism-collateral` / `import-only` / `static-only` within the
   * same hour, and the merge conflict between them was prose only. Worth a line
   * because agreement reached separately is the only kind that says anything.
   */
  /**
   * **The same story a day later**, and recorded because the hole check catching
   * a second arrival is the check earning its fourteen seconds twice.
   *
   * Landed 2026-09-04 with stage 2 of
   * docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md, well after
   * the witness ran, so `static-only` is not a preference — the dynamic evidence
   * does not exist for it yet and re-running witness 2 is what upgrades it.
   */
  "tests/hierarchy-structure-checkpoint.test.ts": {
    category: "store-agnostic-fake",
    evidence: "static-only",
    reason:
      "Holds the structure call's checkpoint: that its key is a digest of the request the call " +
      "really makes, and that only an answer which parsed and built is stored. Its checkpoint " +
      "store is a `Map` written in the file and its model call is mocked, so it constructs no " +
      "store of any kind and reads no path; it reaches a condemned module only because " +
      "`src/hierarchy.ts` imports `nullCheckpointStore`. Nothing here changes when the filesystem " +
      "store goes.",
  },
  "tests/hierarchy-eval-incumbent-parity.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Holds the eval harness's incumbent arm against `PRODUCTION_EFFORT` so an isolated arm " +
      "cannot silently answer a question production does not have. It compares two constants and " +
      "executes no storage at all; it reaches a condemned module only because the eval graph " +
      "imports the app. Nothing here changes when the filesystem store goes.",
  },
  "tests/illustrated-pg.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    reason:
      "The three things about `illustrated` that can only be wrong in Postgres — the column, the " +
      "`REVISION_READ_POLICY` projection that has to grant `sketch` alongside it, and the carry " +
      "into a new draft. It talks to `pgArticleReader` directly and never consults the flag; the " +
      "seed is its only filesystem reach.",
  },
  "tests/jobs-commit-path.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B on 2026-09-04.** Pins the path as well as the result: it wraps the " +
      "session the runner actually builds, so a runner that went round `commit` fails here rather " +
      "than passing quietly. The claim is about `session.commit`, which is where the transaction " +
      "lives under Postgres — and the file used to wrap `fsStoreSession`, which says of itself " +
      "that there is **no transaction in it**, so the suite whose subject is *the commit as one " +
      "act* was pinned against the implementation where it is not one. The mock now wraps " +
      "`openPgStoreSession`, the real `blocks` stage runs forced against a `scratchArticleInPg` " +
      "fixture, and the artefacts come back through `readOnlyPgArtifacts` over the published " +
      "revision instead of `fsArtifacts`. **Still `database-integration` rather than " +
      "re-categorised**: the map shrinks when `tests/store-migration-witness.json` is re-run at " +
      "the end of stage B, and converted files drop out of it then rather than being given a " +
      "verdict that no longer describes any outstanding work.",
  },
  /* **`tests/jobs-fs-adapter.test.ts` and `tests/jobs-fs-load.test.ts` stood
     here until stage G's `jobs` group, 2026-09-05.** Both entries went with
     `src/store/jobs-fs.ts`, and what became of each is worth one line, because
     the two had different fates:

     - **`jobs-fs-load`** was deleted outright. All six of its cases were
       `loadFromDisk` / `reloadForTests` cold-start properties — stamping an
       ownerless record with this installation's owner, bringing a job's work key
       and `reservesName` back with it, writing an enqueued job out as `queued`.
       Postgres has no cold start: `jobs.owner_id` is `not null`, and the ticket
       is two columns that survive a restart by being columns. The one claim with
       a live home moved there long ago — *queues a job it was handed as running,
       in the outcome as well as the store* is `tests/store-jobs-parity.test.ts`.
     - **`jobs-fs-adapter`** was split rather than deleted. Its `sweepStopped`
       block died with the adapter; its `what a step counts as done` block
       became `tests/step-context-paths.test.ts`, because that block's subject
       was `StepContext.dir` / `htmlFile` and not the job store — which is
       exactly what the file's own header asked for in advance, and the reason
       it wrote the request down. **That file lasted one day**: the same stage's
       last group removed those two fields, and the block's surviving claim is
       in `tests/store-artefacts-pg.test.ts` now. Both halves of the promise
       kept, in order, by two different groups. */
  "tests/jobs-walk.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B on 2026-09-04.** *Claim once, keep the same attempt while walking, " +
      "release only on handoff or terminal settlement* — seven mutations to `advanceJobWith`, each " +
      "watched red, and all seven against a process-local `Map`: the real store the header claimed " +
      "to keep was `fsJobStore`, so the whole file's subject was an in-memory mutex. It is now " +
      "`pgJobStore` and the real `claimSession`, with only `session.reads` faked — and the eighth " +
      "mutation, `eq(jobs.status, 'queued')` deleted from `claimIn`, is the first evidence any of " +
      "it reaches the SQL that ships. **Still `database-integration` rather than collateral**, and " +
      "that is the honest verdict rather than an un-updated one: the map shrinks when " +
      "`store-migration-witness.json` is re-run at the end of stage B, at which point converted " +
      "files drop out of it entirely. Two things it now needs that no other converted queue suite " +
      "does: an article per case, because `claimSession` opens a draft; and a stamp on every fake " +
      "product, because `publishRevisionIn` refuses a tree that ran against `unstamped`.",
  },
  "tests/jobs.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B on 2026-09-04**, and it was the largest of them — though less by " +
      "depth than by breadth, because most of its blocks are pure functions with no store " +
      "under them at all: eight of the ten it had **on 2026-09-04**, which is a dated count and " +
      "not a live inventory — `describe(\"unrunnableStepPlan\")` arrived later, with Stage E. " +
      "**It was split first**: `sweepStopped`, `writeOnce`'s temp file, the " +
      "interrupted marker and `STEPS[name].outputs` went to " +
      "`tests/jobs-fs-adapter.test.ts`, because their subject is the adapter rather than the " +
      "queue and this map cannot give one file two verdicts. What is left — the queue's " +
      "arithmetic, plus the two blocks that drive `enqueue` and `advanceJob` for real — now runs " +
      "on `spideryarn.jobs`. **The conversion cost no fixture in the first block**, which is worth " +
      "knowing before anyone converts another queue suite: `lockOrCreateArticle` creates the " +
      "article row when a claim opens a draft for a slug nothing holds, so a job on a bare slug " +
      "still fails offline at `fetch`, exactly as it did on files. What it did cost: " +
      "`fixtureWithRawJson` became a seeded article, because *fetch counts as done* is a " +
      "`revision_step_runs` row as well as an artefact; `pauseForTests` went away by queuing rows " +
      "with `enqueueOrGet` and never starting a pump — though the first block still drives " +
      "`enqueue`, which does start one, and those leftover pumps race the claims two cases later " +
      "(that file's § *asking again, on `busy`*); `expireLeaseForTests` became an `update … " +
      "set lease_expires_at = clock_timestamp() - interval '1 second'`; and a third id the " +
      "filesystem never validated turned up — `jobs.upload_id` is a foreign key, so the invented " +
      "uuid the short-id case passed now needs a real `uploads` row. Two mutations, one per " +
      "store-touching block: `settleExpired`'s lease predicate inverted (**2 red**), and " +
      "`hasArtefacts`'s `revision_step_runs` requirement deleted (**green**, with a control " +
      "proving the function is on the path — nothing here tells *artefacts present* from *a step " +
      "recorded done*). **Still `database-integration` rather than collateral**, which is the " +
      "honest verdict rather than an un-updated one: the map shrinks when " +
      "`store-migration-witness.json` is re-run at the end of stage B, at which point converted " +
      "files drop out of it entirely.",
  },
  "tests/live-session-routes.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B on 2026-09-04, and the entry stays until the witness is re-run.** " +
      "The order at the ticket — OpenAI mints, we journal, and only then does the token go out — " +
      "plus a retried report that must not become a second row. The journal is now Postgres: the " +
      "flag is pinned before any import, one article is seeded under `TEST_OWNER`, and every " +
      "read-back is `realtimeSessionStore.find`. **The ledger followed in stage C**, and this file " +
      "was the one the stage-C freeze had missed: it read its rows back out of the JSONL, so " +
      "removing the redirect turned four cases red. Its `ledger()` helper now asks `costStore` and " +
      "scopes on the session id, and the collapse-on-read half — which was about an append-only " +
      "file with no unique key — is covered on the store it is a fact about, by " +
      "tests/store-ai-calls.test.ts. Two assertions were re-expressed in stage B: the " +
      "journal-write failure is provoked by a `vi.spyOn` rejection on `issue` rather than by a " +
      "path that cannot be written, and *nothing was journalled* is a row count rather than the " +
      "size of a parsed JSON object. Mutation watched red: the `is null` earliest-wins predicate " +
      "deleted from `markConnected`. The category is left alone deliberately — a converted file " +
      "may only leave this map once `store-migration-witness.json` is re-run at the end of stage " +
      "B, so the reason says the work is done rather than the verdict being re-labelled.",
  },
  /**
   * **A new arrival, 2026-09-07**, and it arrived by gaining an import rather
   * than by being written: the stage 2a review's F1 was that `copyArtefacts`
   * cannot carry an article whose labels are still pending, and the case that
   * reproduces it calls `copyArtefacts` — which is the only name left in
   * `TARGETS`. `evidence: "static-only"` for the reason the four link-preview
   * entries above give: the file is newer than the stored `touched` map, and
   * re-running witness 2 is what upgrades it.
   */
  "tests/labels-receipt-invalidation.test.ts": {
    category: "database-integration",
    evidence: "static-only",
    reason:
      "Born on Postgres and could not be anywhere else: its subject is what one transaction does " +
      "to `article_revisions.nav_label_status` and a `revision_step_runs` row when a labels " +
      "manifest lands beside a tree — `writeArtefacts`'s receipt deletion, its two refusals, and " +
      "the `stepIsDone` answers that follow. It drives `beginStep`/`write`/`finishStep` through " +
      "`pgArtifactsIn` inside a real claim, and rolls the transaction back. `copyArtefacts` is " +
      "reached by one describe block, which copies into that same Postgres store; there is no " +
      "filesystem side of any of this to have migrated from. " +
      "docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md#stage2a-review.",
  },
  "tests/load-article-serialisation.test.ts": {
    category: "database-integration",
    reason:
      "Asks **Postgres** whether the loader's `serialise` flag reaches the lock, by holding the key " +
      "on a connection of its own and seeing which load waits — and must not take the run lock " +
      "itself, or both arms pass with the lock doing nothing. Like the loader's own suite it is " +
      "stage D's to edit, not collateral.",
  },
  "tests/owner-jobs.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["step-context-paths"],
    reason:
      "**Converted in stage B on 2026-09-04.** Any authenticated Bob could list, fetch, cancel, " +
      "retry or advance Alice's jobs; the file's reason for needing no database was that *jobs " +
      "never reach Postgres*, and the seven refusals are now `where owner_id = $1` in " +
      "`pg-jobs.ts`. Alice and Bob are seeded into `auth.users` because the queue's owner column " +
      "carries a foreign key. What is left is `runStep` computing `contextPaths(job.slug)` on the " +
      "one `fetch` step it queues.",
  },
  "tests/pg-session-exact-base.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["step-context-paths"],
    reason:
      "A draft may only replace the revision it was copied from, asserted through `commit` and " +
      "again through standalone `publishRevision` so the guard is in the primitive rather than in " +
      "one caller. Entirely Postgres; the two filesystem sites are `contextPaths` on the way into " +
      "a step.",
  },
  "tests/pg-session-real-step.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect"],
    reason:
      "The one file that drives a **real** stage through a real `pgStoreSession` commit, with a " +
      "deliberately stale fixture so a commit that wrote nothing would read the carried copy back " +
      "and pass. Its only filesystem contact is two reads of the redirected test ledger.",
  },
  "tests/pipeline-artifact-store.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "**Done in stage G, 2026-09-05, and this entry was one of stage A's three over-condemnings.** " +
      "It read *\"every claim is about `PATHS`, `pathFor` and `has()` parsing\"*; the file was " +
      "**75 executed cases and 67 survive**, on `memoryArtefacts()`. (The freeze's *\"~18 of 54\"* " +
      "was counting `it()` **sites**, three of which are loops of 7, 11 and 6 — a second way to be " +
      "wrong about the same file.) Eight died: the four-case block holding `produces` against " +
      "`outputs` through `PATHS`, which needs a second list; `pathFor` against a literal path; the " +
      "`{ not json` arm, since nothing decodes text into an artefact; and two aliasing cases — see " +
      "below, because they are the finding. **The two `blocks` cases that were pure aliasing would " +
      "have asserted the opposite of the truth if ported.** On disk `extract/extractedHtml` and " +
      "`blocks/stampedHtml` were one file, so wiping the ids clobbered both; under two columns " +
      "`blocksMatchTheirHtml` re-derives with the stored blocks as baseline and `splitIntoBlocks` " +
      "**carries the old ids over** — measured, byte-identical document back. One deleted, one " +
      "replaced by `not done once stage 3's document has lost an id its blocks name`. And the file " +
      "was reading its fixtures out of the gitignored `data/writes/…` and writing into the real " +
      "`data/raw-shape/`; both now go through the committed corpus.",
  },
  "tests/quiz-mark-route.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "fixture-loader"],
    reason:
      "**Converted in stage B on 2026-09-04.** A mark is bound to the batch the reader was shown: " +
      "a stale `batchId` is a 409, a source-stale quiz is checked first, an unknown `questionId` " +
      "is a 404 and never a fall-forward, and every refusal lands before a single SSE header. The " +
      "article and the quiz were a copied `example/` directory it rewrote in place; they are three " +
      "seeded articles now, each with its quiz written into the clone so `copyArtefacts` and " +
      "`publishRevision` put it on the revision. **A revision landing between the two reads** was " +
      "a `writeFile` over `blocks.json` and is a real second publication taken inside the gap, " +
      "which is the one case here that changed character rather than merely moving. What is left " +
      "is the seeder's copy step **and the ledger**. This entry said 'the provider is stubbed to " +
      "reject, so no ledger row' until GPT Sol's review of the batch, and that was wrong twice: " +
      "`src/ai-call.ts`'s streaming wrapper records spend through a `finally`, so a rejection and " +
      "an aborted stream both record — and `src/store/ai-calls.ts` § `selected` returns " +
      "`fsCostStore` whenever `NODE_ENV === 'test'`, **whatever the flag says**, so pinning this " +
      "file to Postgres never moved its ledger at all. The 2026-09-03 witness agrees: it recorded " +
      "`ai-calls-fs:fsCostStore.record` here. Stage C is what takes it.",
  },
  "tests/referee-claims-omitted.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B on 2026-09-04**; the category stays `database-integration` because " +
      "the map shrinks by re-running `store-migration-witness.json` at the end of the stage, not " +
      "by re-labelling a file whose conversion is done. `claimsOmitted` was computed by the " +
      "validator, printed by the panel, and never carried between the two — and the file was " +
      "checking the one store that cannot have that bug, since a JSON file carries any key it is " +
      "handed while a column has to be named. It now pins `postgres`, seeds through " +
      "`scratchArticleInPg` and reads back through `refereeClaimsStore.load`. Watched red by " +
      "deleting the `claimsOmitted` spread from `finish` in src/store/pg-referee-claims.ts.",
  },
  "tests/referee-claims-routes.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B on 2026-09-04**; the category stays `database-integration` until " +
      "the witness is re-run, which is what takes a converted file off this map. This is the " +
      "family whose absence let Claims ship filesystem-only and answer 501 in production, so " +
      "converting it is the postmortem's own remedy. **Two cases were dropped rather than " +
      "translated**: the 400 out of `claimsProblem` — *this article has no text yet* — cannot be " +
      "reached under Postgres at all, because `reasonsNotToPublish` refuses to publish a revision " +
      "with no blocks, so neither it nor *writes nothing when it refuses* has a fixture that can " +
      "exist. The ordering claim they carried survives on the 404 case. Watched red twice: the " +
      "sweep writing `pending` instead of `error`, and — only after a new case asserting a young " +
      "run survives a GET — deleting `lt(created_at, cutoff)`, which had left the file green.",
  },
  "tests/referee-criteria-routes.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B on 2026-09-04**; the category stays `database-integration` until " +
      "the witness is re-run. Four criteria routes, asserting that the validators are actually " +
      "reached — a validator nobody calls passes its own tests perfectly — with the same 501 " +
      "exposure as its Claims sibling. **One assertion was dropped**: `\"sourceHash\" in body === " +
      "false` was true only because the filesystem fixture had no `blocks.json`, and " +
      "`sourceHashFor` answers `undefined` only for a revision with zero `revision_blocks` rows, " +
      "which the publish guard makes unreachable. Its positive twin stands in its place. Enough " +
      "tests to want one mutation per `describe`: recolour coalescing slot 0 to null, `remove` losing " +
      "its id predicate, and the sweep writing `pending` all went red; dropping `where " +
      "article_id` from `criteriaFor` stayed **green**, because one article in a private database " +
      "cannot tell a scoped read from an unscoped one.",
  },
  "tests/referee-criteria-store.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "**Edited in stage G, 2026-09-05, not deleted.** Three things of different kinds: " +
      "`withCriterion` as a pure decision, a **filesystem** round trip with a negative valence in " +
      "it, and parity against Postgres. The middle block went — seven cases driving " +
      "`beginCriterion`/`finishCriterion`/`loadCriteria` at `data/<slug>/referee-criteria.json`, " +
      "whose -80-out-of-the-bytes-on-disk claim has a Postgres counterpart in " +
      "`tests/store-parity-referee.test.ts`. The eight pure `withCriterion` cases and the " +
      "ownership 404 are untouched, and the parity walk kept its steps as a Postgres walk. " +
      "20 cases to 13.",
  },
  "tests/referee-mirror-route.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B on 2026-09-04**; the category stays `database-integration` until " +
      "the witness is re-run. Makes Mirror reachable, and stubs global `fetch` because the " +
      "earlier argument for costing nothing rested on `OPENROUTER_API_KEY` being absent, which " +
      "`.env.local` makes false — so the seed happens in `beforeAll`, above the stub, since " +
      "`scratchArticleInPg` puts the raw document in the bucket over HTTP. The comments now go " +
      "through `commentStore`, where `valence` is a column and `criterion_id` a foreign key, and " +
      "the anchors are read off `article.blocks` because the three `spya-…` literals were " +
      "`example/`'s. Watched red by clamping a negative valence in `toComment` " +
      "(src/store/pg-comments.ts).",
  },
  "tests/referee-routes-postgres.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    reason:
      "The suite written *because* of the 501 postmortem — it pins `postgres`, owns the sentence " +
      "*these routes work under Postgres*, and fails rather than skips under `REQUIRE_POSTGRES`. " +
      "It reaches the filesystem only through `scratchArticleInPg`, and its header's argument for " +
      "existing separately is the thing the hinge makes moot.",
  },
  "tests/referee-scan-route.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B on 2026-09-04**; the category stays `database-integration` until " +
      "the witness is re-run. The wire and nothing else: `src/injection-scan.ts` had 82 passing " +
      "tests and no production caller for a day. Four seeded articles now carry four raw " +
      "documents of their own, written through `mutate` so the manifest and the bytes go in the " +
      "way stage 1 puts them there. This is the one of the five with a silent failure available " +
      "to it — a wrong digest addresses nothing, and a scan of nothing reports a clean paper — " +
      "so the hash is computed by this file and again by `storeRawBytesFor`, the read re-hashes " +
      "what the bucket returns, and a new first case compares the served bytes with the written " +
      "ones. Watched red by rotating the digest in `readRawDocument`: four cases fail with " +
      "`MissingRawObject`, which is the proof that a wrong hash is loud rather than empty. The " +
      "coverage claim is unchanged; only the store under it is.",
  },
  /**
   * **Written 2026-09-07, after the witness ran**, so `static-only` for the
   * ordinary reason the header gives. It was born on Postgres — there is no
   * filesystem half to finish moving — so it is collateral rather than a
   * `database-integration`.
   */
  "tests/referee-stream-lifetime.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    evidence: "static-only",
    reason:
      "The three streaming referee routes held open mid-stream, so that moving them into " +
      "`AUTH_ROUTES` cannot quietly turn an awaited handler into a launched one. It seeds through " +
      "`scratchArticleInPg` and that copy step is the only condemned module it reaches: all three " +
      "generators are stubbed, so no model is called and no ledger row is written. Watched red " +
      "three times against the unmoved routes — dropping the guard's `await`, deleting " +
      "`refereeing.delete(key)`, and releasing the lock before the stream finishes — each failing " +
      "on its own assertion. The second of those is the one that matters: an earlier draft of the " +
      "file stayed green under it, because a freshly begun row is spared by `sweepPending`'s age " +
      "guard whether or not the lock holds it.",
  },
  "tests/remember-route.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "fixture-loader"],
    reason:
      "Every case is a request that must **not** be quietly accepted once `kind` and `stance` " +
      "exist, plus the 409s that pin the check *before* `settleThread` aborts another tab's " +
      "answer. Already on Postgres with a scratch article; the ledger row and the seeder copy are " +
      "all that is left.",
  },
  /**
   * **Landed 2026-09-04, after the stored witness ran**, which is why it needs
   * an entry at all — the hole check re-derives the static universe live, and
   * the file arrived into it.
   *
   * The measurement was made rather than inferred:
   * `npx tsx scripts/store-migration-witness.ts --files tests/reserved-article-address.test.ts`
   * reported *ran, touched nothing*. `--files` writes no JSON, so the stored
   * map still predates the file and the honest `evidence` is `static-only`
   * until witness 2 is re-run — which is what would move this entry off the
   * map, exactly as the header says.
   */
  "tests/reserved-article-address.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Whether `/read/public` is the public shelf in all three places that decide it — the " +
      "client's `parseRoute`, the edge's `decidePublicPage`, and `lockOrCreateArticle`, which is " +
      "the one line that brings an article address into existence. The first two are pure " +
      "functions of a string. The third needs Postgres and gets it, in transactions it rolls " +
      "back, because a refusal inside an insert path cannot be observed without the row and the " +
      "lock. It reaches a condemned module only because `src/store/pg-revisions.ts` imports " +
      "`src/store/pg.ts` and `src/web/router.ts` imports the app; nothing here changes when the " +
      "filesystem store goes.",
  },
  "tests/retry-is-only-for-a-failed-job.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B on 2026-09-04.** Retry spends money and the client had never been " +
      "asked — a completed forced PDF refresh could be re-retried indefinitely. Its last case read " +
      "the new job's force flags **out of `data/_jobs/`**, which was deliberate (only that is what " +
      "a later request sees) and was exactly the assertion that had to be re-pointed at the jobs " +
      "table: it is now `pgJobStore.list(owner)` filtered by slug, and the flags are the `steps` " +
      "JSONB column. `fsJobStore` and `fsStoreSession` are `pgJobStore` and the real " +
      "`claimSession`; the fake steps hand back the seeded article's own artefacts, because " +
      "`SHAPE` is applied by both stores and `raw` needs a manifest naming a real `raw_sources` " +
      "row. The mutation is `failureKind` deleted from `finishIn` — a column with no filesystem " +
      "counterpart — watched red. **Still `database-integration` rather than collateral**, and " +
      "that is the honest verdict rather than an un-updated one: the entry should simply leave " +
      "this map, and can only do so when `tests/store-migration-witness.json` is re-run at the end " +
      "of stage B and stops seeing this file reach a condemned module.",
  },
  "tests/routes.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B2 on 2026-09-04** — the HTTP surface itself, and the broadest reach " +
      "in the inventory. The pre-conversion count recorded here was *twenty-three sites*; the " +
      "derived number is **16 `cp`/`rm`/`writeFile` calls and 28 calls into the filesystem-only " +
      "readers and writers** (`loadComments`, `loadShelf`, `loadRuns`, `createComment`, " +
      "`patchComment`, `beginAnswer`, `beginRun`, `deleteRun`), plus `SPIDERYARN_READER_FILE`. " +
      "Five `scratchArticleInPg` articles replace the `example/` copies and every read-back now " +
      "goes through `commentStore`, `shelfStore`, `searchStore` or `readerStore`. Three things " +
      "changed meaning rather than moving: the reader profile is a row keyed on the owner, so the " +
      "isolation is a seeded owner under `asTestOwner` and a database postcondition in `afterAll`; " +
      "the three admin cases that asserted **501 because filesystem** now assert 200 and a list, " +
      "which stage F does not touch; and an orphaned `pending` comment is one whose lease has run " +
      "out, which brought a case with it. **The tally that used to stand here is gone rather than " +
      "corrected**, and that is the rule above being applied to this entry: it read *ten " +
      "mutations, seven red and three green* against thirteen runs, because slug runs and " +
      "recolour runs collapse differently depending on whether you count markers or executions — " +
      "and within a day B3 closed two of the greens, gave the tweets block a real mutation and " +
      "the admin block a second, so every number in the sentence was wrong. A count of mutations " +
      "is a copy of a fact whose home is the test file; the file says what it ran, and " +
      "`STORE_CONVERSIONS` is what checks the evidence has not shrunk since. **Still " +
      "`database-integration` " +
      "rather than collateral**, and that is the honest verdict rather than an un-updated one: " +
      "the entry should simply leave this map when `tests/store-migration-witness.json` is re-run " +
      "at the end of stage B.",
  },
  "tests/shelf.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "**Edited in stage G, 2026-09-05, not deleted.** Archive, rename and open-counting against " +
      "real files under `data/` — `src/shelf.ts` is what `fsShelfStore` was made of, and that " +
      "module is now dead in `src/` but not yet removed, so its own cases stay and this file is " +
      "what would notice a quiet removal. What went is the five cases that read the *shelf* back " +
      "through `listArticles`/`articleMetadata` off `src/api.ts`; every one has a counterpart in " +
      "`tests/store-shelf-pg.test.ts` § the shelf's writes. 19 cases to 13.",
  },
  "tests/source-store.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "**Done in stage G, 2026-09-05, and the prediction held exactly.** Three sections, and only " +
      "the middle one was condemned: a grep that the route reaches the seam, the **filesystem** " +
      "adapter doing what the route used to do under a scratch root, and the Postgres adapter " +
      "refusing a dangling reference rather than reporting the article sourceless. Section 2 went " +
      "with the adapter, 20 cases to 14, and **every one of its six has a Postgres counterpart** " +
      "in section 3. Section 1's source-text bans were trimmed rather than kept whole: " +
      "`not.toContain(\"readFile(\")` and the file-wide `node:fs/promises` ban survive because " +
      "they can still redden, and the `fsLocations(` / `readRaw(` bans went — a `not.toContain` " +
      "of a deleted symbol is a check nothing can fail.",
  },
  "tests/stage2c-raw-bytes.test.ts": {
    /* **Was `store-agnostic-fake` until 2026-09-05, and the prose below said so
       for a while after the value did not.** Stage D's write-up and this reason
       both reported the re-classification; the field kept the old value, so the
       one thing in this file that is *executable* disagreed with the two things
       that are not. That is the failure the registry exists to prevent, caught
       by the cross-family review rather than by anything here — the guard checks
       that entries exist and are reasoned, never that a reason and its category
       agree. Worth knowing before trusting a category you have only read about. */
    category: "filesystem-adapter-behaviour",
    reason:
      "Stage 1 hands stage 2 a content address, and every case names its own `fsBlobs(dir)` so " +
      "that *absent* is a fact about a directory the test made rather than about whatever " +
      "`.env.local` said. `fsBlobs` is out of scope for this migration. **Stage D read the " +
      "`createFsArtifactStore` beside it and did not replace it**, against this entry's own " +
      "earlier sentence: its one case is *writes a raw.json the filesystem artefact store reads " +
      "back as the manifest*, whose entire claim is that the file `writeRawFiles` writes is the " +
      "file `PATHS.fetch.raw` reads — two constants in two modules that nothing else compares. A " +
      "fake with no paths in it cannot hold that, so the case is filesystem-adapter behaviour " +
      "wearing a store-agnostic file's clothes, and it dies in stage G with `writeRawFiles` and " +
      "the filesystem CLI path it documents.",
  },
  /* **`tests/step-context-paths.test.ts` lived one day**: created on 2026-09-05
     in stage G's `jobs` group and deleted on 2026-09-05 in stage G's last
     adapter group, which is the same stage keeping its own promise. Its entry
     said *"it dies when `StepContext.dir` does, and the claim to port then is
     that a step must declare every artefact it writes: in Postgres that is
     `produces`, and `tests/store-artefacts-pg.test.ts` is where it would go"*.
     That is exactly where it went — § `has both of extract's and all three of
     hierarchy's`, with the block's `stepIsDone`-over-an-empty-store case beside
     it. The three path assertions died with `STEPS[…].outputs`, which had no
     caller in `src/` after `src/api.ts` went and was being kept alive by this
     file alone. */
  "tests/step-failure-seam.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B on 2026-09-04, and the entry stays until the witness is re-run.** " +
      "An error nobody wrote a reader sentence for must reach neither `step.error` nor `job.error` " +
      "— both fields, because the band and the card render different ones and a DOM test of either " +
      "would stay green. It read the persisted values off the file the queue wrote; `persisted` " +
      "now selects the two columns out of `spideryarn.jobs`, and the file's own docstring records " +
      "that this claim is **weaker** than it was, because `getJob` is a `SELECT` too now and the " +
      "two reads differ only by `toJob`'s mapping. No article is seeded: these are first ingests " +
      "of slugs nothing holds, so `lockOrCreateArticle` makes the row the way a real claim would. " +
      "Mutation watched red: `error` stripped from the steps written by `finishIn` — 5 of 8. **And " +
      "the read-after-write race the plan asked about is gone**: there is no `data/_jobs/` left in " +
      "it, and ten consecutive runs on a box at load 32–52 were green. The category is left alone " +
      "deliberately — a converted file may only leave this map once " +
      "`store-migration-witness.json` is re-run at the end of stage B.",
  },
  "tests/store-ai-calls.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "**Done in stage G, 2026-09-05, and the prediction held with one correction.** The " +
      "assertion it exists for is that `credits_used_nanos` comes back a `number` rather than " +
      "the string `node-pg` hands back for `int8`. The `fsCostStore` half went with " +
      "`ai-calls-fs.ts`; the Postgres half and `totalRows` survived, 25 cases to 13, and the two " +
      "SQL sums it holds against each other came through intact. The correction is that the " +
      "filesystem half was not all JSONL trivia: two of its twelve cases — the half-open range " +
      "on `read(since, until)` and `forJob` — were `CostStore` contract behaviour with no second " +
      "home anywhere, so they were rewritten against `pgCostStore` rather than dropped. Both " +
      "were watched going red before being believed. 13 cases to 15.",
  },
  "tests/store-block-roles-pg.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    reason:
      "The third consumer of `role`/`treatment`/`noteId`, and the one that needs a database — " +
      "`writeBlocks` could have written `treatment: null` for ever and 293 tests stayed green, " +
      "because every corpus article predates classification. Its fixture is classified *before* " +
      "being loaded, and the loader is its only filesystem contact.",
  },
  "tests/store-carry-forward.test.ts": {
    category: "database-integration",
    reason:
      "**Edited in stage G, 2026-09-05.** A re-extraction must not take the reader's paid-for " +
      "artefacts with it — free on a directory, and the reason `beginRevision` copies the " +
      "published revision into the draft. One case asked the same question of both stores; the " +
      "filesystem half went with `src/api.ts`. What it bought is named in the case's own comment: " +
      "the files asked the step's own `stamp` and so got `assets` right for free, which is the " +
      "second opinion `pg.ts`'s hand-written `isCurrent` switch was checked against. The Postgres " +
      "half still reddens if `case \"assets\"` is deleted.",
  },
  "tests/store-chat-pg.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["shared-symbol"],
    reason:
      "A pure Postgres suite — ordering by `ordinal` rather than `created_at`, a retry that drops " +
      "the previous attempt's citations, an edit that deletes `>=` instead of `>`. Its single " +
      "filesystem site is `requireTail`, which `src/store/pg-chat.ts` imports from `fs.ts`; that " +
      "is a live coupling between a surviving adapter and a condemned module, and it has to be " +
      "broken before `fs.ts` can be deleted at all.",
  },
  "tests/store-export-raw.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    reason:
      "`db:export` must produce the raw document now that it is a reference rather than a `bytea` " +
      "column — the hole where it returned `[]` and looked exactly like an article that never had " +
      "a source. Built on the fixture loader on purpose, so that what the adapter writes and what " +
      "the export reads are provably the same thing.",
  },
  "tests/retry-keeps-the-checkpoints.test.ts": {
    category: "database-integration",
    /* It landed on 2026-09-03, after that day's witness ran, so the verdict
       rested on the import graph and the file's own docstring. The 2026-09-04
       re-run watched it, which is what took the `static-only` off. */
    reason:
      "Whether the Retry button lands on the article the failed attempt paid for — the question " +
      "`tests/checkpoints-durable-resume.test.ts` assumed away by building both attempts' " +
      "`articleId` by hand. It drives real `enqueue`/`retryJob` against the Postgres queue and a " +
      "real checkpoint write-then-read, and article identity is only expressible there: the " +
      "filesystem store has no articles table and no second owner.",
  },
  "tests/store-jobs-parity.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "**The verdict was always about the arm, not the file, and stage G's `jobs` group settled " +
      "it that way on 2026-09-05: four lines out of `ADAPTERS`, and the file lives.** The reason " +
      "written in stage A said the refusals *survive in the Postgres arm* and only *the parity " +
      "framing* does not — which is right, and is why this is the file the plan names when it " +
      "says that applying stage G's brief literally would delete coverage " +
      "(docs/plans/260903f-… § *Applied literally, G's own brief deletes coverage*). Fifty-three " +
      "cases run against Postgres inside the `describe(adapter.name)` loop and every one of them " +
      "is a **literal assertion** — the fence, `settleExpired`, the running cap, queue order, name " +
      "reservation — not a comparison of one store with another. Deleting the file to remove one " +
      "entry would have lost all fifty-three. **Kept as `filesystem-adapter-behaviour` rather " +
      "than re-categorised**, on the precedent this map's header states for `fixture-loader`: an " +
      "entry records why a file was classified as it was, and the map shrinks when " +
      "`store-migration-witness.json` is re-run, not by rewriting verdicts one at a time. The " +
      "reach itself is gone.",
  },
  "tests/store-parity-referee.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "**Edited in stage G, 2026-09-05, not deleted.** Written after Claims shipped with one " +
      "adapter and returned 501 in production, to compare the two stores step by step through " +
      "every referee write. Parity stopped existing at the hinge; the literals did not, and they " +
      "are what this file was really holding. Two have no second home anywhere: a valence of −80 " +
      "beside a confidence of 55 (the `clampConfidence` trap) and the only guard on " +
      "`CLAIMS_ORPHAN_GRACE_MS` outside `tests/store-pg-referee-claims.test.ts`. The two walks " +
      "kept their steps and now assert at each one whose comment names what it can break.",
  },
  "tests/store-parity.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "**Edited in stage G, 2026-09-05, not deleted.** *The test the whole migration rested on* — " +
      "every read compared as the wire form the client receives, with every revision deleted first " +
      "so a carried column could not fake a match. The comparisons went with the filesystem arm; " +
      "the corpus load through the production write path stayed, and with it every assertion that " +
      "was ever about Postgres alone: built-from-nothing, the publication gate refusing " +
      "`constitution`, `url`/`fetchedAt` from stage 1 or nowhere, the card dated from `raw.json`, " +
      "`ADDED_AT` ordering over three rolled-back rows, the search exclusion, and the 400 on a " +
      "traversal slug. What was dropped is listed in the plan § G3 landed.",
  },
  "tests/store-pg-session.test.ts": {
    category: "database-integration",
    reason:
      "Sixteen cases on the transactional session, three of which are checks on the other " +
      "thirteen. Case 6 is the filesystem one: the preflight reads `session.reads` and never the " +
      "disk, proved by planting a perfectly good `arc.json` in `data/` — a control that has to be " +
      "re-expressed rather than dropped, because dropping it is how the claim quietly becomes " +
      "untested.",
  },
  "tests/store-reader-parity.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "**Edited in stage G, 2026-09-05: four lines, not a deletion.** The experimental switch was " +
      "two genuinely different implementations — `coalesce(…, now())` inside an upsert against a " +
      "decision made in a write queue — and only the `stores` array lost an entry. All six cases " +
      "now run against Postgres, including *keeps both when the two writes are started at once*, " +
      "which has no second home. It creates its own `auth.users` row rather than writing the " +
      "development owner's profile, which is the habit the conversions should copy.",
  },
  "tests/store-realtime-sessions.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "**Done in stage G, 2026-09-05.** Three *a second write must not undo the first* rules — " +
      "duplicate `issue`, earliest `markConnected`, first `close` — held across both journals; " +
      "the filesystem arm of `bothStores` went with the module and the seven cases now run once, " +
      "against `pgRealtimeSessionStore`. 14 cases to 7, none lost. **The old wording here said " +
      "its Postgres half *always skips* because `20260902150952_realtime_sessions_and_usage.sql` " +
      "was unapplied everywhere, so it was a filesystem-only suite wearing a parity coat.** That " +
      "was true when it was written and stopped being true in stage F, which rewrote the " +
      "readiness handling: `pgReady` throws now and there is no skip mechanism left in the file. " +
      "The same sentence was in the file's own header and was wrong in both places.",
  },
  "tests/store-roundtrip.test.ts": {
    category: "database-integration",
    reason:
      "`data/` → Postgres → `data/` with nothing lost, which is the rollback nobody has ever run. " +
      "Its export target is `src/store/export.ts`, which survives — what dies is the *source* " +
      "side, where the corpus is read in through a filesystem artefact store, and the comparison " +
      "needs a new left-hand side rather than a new claim.",
  },
  /**
   * **A stage-B fix *added* a filesystem reach to a file that had none**, which
   * is the one direction nobody was watching for, and it is why the witness is
   * re-run rather than reasoned about.
   *
   * The 2026-09-03 witness has no record of this file touching the store. The
   * 2026-09-04 re-run does. Nothing about the shelf changed: `17d2f00d`, the
   * commit that converted the last thirteen suites, gave this one
   * `scratchArticleInPg` seeding to fix an order dependency, and that helper
   * clones its corpus article through `copyArtefacts` over a
   * `createFsArtifactStore`. So the reach arrived with the remedy.
   *
   * Two consequences worth keeping. A witness delta is **not** a conversion
   * oracle in either direction — this is the "appeared" case, and the plan
   * already records the "disappeared" one. And `fixture-loader` is a mechanism
   * that keeps recruiting: every suite stage B moved onto the seeder inherited
   * it, so stage D's decision about one helper is what settles this entry.
   */
  "tests/store-shelf-reads.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    reason:
      "Counts the statements `listArticles` runs and inspects which tables they name — a constant " +
      "number whatever the shelf holds, and none of them `revision_blocks`. Entirely Postgres, " +
      "and it was not on this list at all until 2026-09-04: `17d2f00d` seeded it through " +
      "`scratchArticleInPg` to stop it depending on another file's rows, and that seeder copies " +
      "the corpus article with `copyArtefacts` from a `createFsArtifactStore`. Its whole " +
      "filesystem contact is those two calls, made by the helper on its behalf, so stage D's " +
      "loader decision takes it without anybody opening the file. **Not a stage-B conversion** — " +
      "it was already a Postgres suite, and no mutation evidence is claimed for it.",
  },
  "tests/store-session-isolation.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["step-context-paths"],
    reason:
      "Asks the transaction its **actual** isolation level, with a rig that makes the ambient " +
      "default `repeatable read` so a passing assertion cannot be the database's own default " +
      "agreeing with the bug. Nothing about it is filesystem; the two sites are `contextPaths`.",
  },
  "tests/store-session.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "D1a — the commit seam **on the filesystem, where there is no transaction to hold**, and its " +
      "sharpest case is a refusal over an artefact carried from a previous run, because against an " +
      "empty directory a refusal proves nothing. The Postgres half of the same seam already lives " +
      "in `store-pg-session.test.ts`.",
  },
  "tests/store-uploads-parity.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "**Done in stage G, 2026-09-05, and the prediction was half right.** The claim race ran " +
      "under two implementations with no shared code — `open(…, \"wx\")` atomic at the kernel " +
      "against a conditional `UPDATE` and `rowCount` — plus the `null`-versus-absent shape that " +
      "would serialise onto a wire whose client type forbids it. The shape assertion belongs to " +
      "the surviving adapter, as predicted. **The race comparison was not dropped with the " +
      "comparison**: `lets exactly one of two simultaneous claims win` is the only thing in the " +
      "tree that would notice `eq(uploads.status, \"pending\")` leaving that `WHERE`, which was " +
      "watched happening. This file is also the only one that asks `pgUploadStore` for its " +
      "contract: `an-upload-is-queued-only-once-its-bytes-arrive` calls `create` to seed a row " +
      "and `store-guarded` checks the wrapper, but neither asserts behaviour. 22 cases to 11 — " +
      "every case kept, each run once.",
  },
  "tests/store-wiring.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["fixture-loader"],
    reason:
      "**Converted in the hinge, 2026-09-05, and the old entry's claim held.** What `src/routes.ts` " +
      "**hands** the store: the attempt token a Postgres `finish` refuses to go without, and the " +
      "sweep's `keep` set of bare row ids rather than composite keys. It wrapped the real " +
      "filesystem store as a spy substrate and was filed `store-agnostic-fake` on the grounds that " +
      "the substrate was interchangeable — which was true, and is why the move is a fixture swap " +
      "and not a rewrite. What was not true is that it needed no database: the substrate it wrapped " +
      "was chosen by the flag, so five of its seven cases went red the moment the flag went. The " +
      "article is `scratchArticleInPg` now instead of a copied `example/` directory.",
  },
  "tests/term-lookup.test.ts": {
    category: "database-integration",
    reason:
      "**Converted in stage B on 2026-09-04, and the entry stays until the witness is re-run.** " +
      "`lookUpTerm` is store-independent orchestration, and most of this file drives it through " +
      "`src/store/index.js` — the wiring a route actually reaches. That wiring is what changed " +
      "store: the flag is pinned before any import and one corpus article is seeded under a " +
      "throwaway slug with an extra glossary entry the text never matches. **One assertion was " +
      "dropped rather than translated**: `lookUpTerm('example', …)` rejecting with " +
      "`/built-in example/` exercised `assertWritable`, which `index.ts` supplied only when the " +
      "store was not Postgres, because the 403 existed to protect a committed directory Postgres " +
      "never had (the dependency itself went on 2026-09-06) — the file's header records the drop, and the 404-for-an-unknown-slug half " +
      "is kept in a case of its own. Mutation watched red: `entries` emptied in " +
      "`pgArticleReader.loadGlossary`. The category is left alone deliberately — a converted file " +
      "may only leave this map once `store-migration-witness.json` is re-run at the end of stage " +
      "B, so the reason says the work is done rather than the verdict being re-labelled.",
  },
  "tests/the-query-string-does-not-decide-the-route.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["shared-symbol", "fixture-loader"],
    reason:
      "**Converted in stage B on 2026-09-04.** A query string must not decide whether a route " +
      "exists — `?summary=1` hid a shipped branch for five days — and the pair of cases needs a " +
      "thread that **really exists**, which was the only reason a store was ever involved. On " +
      "files that meant a `chat.json` under a slug no article had been published under; it now " +
      "pins `postgres` before any import and seeds through `scratchArticleInPg`, so the same " +
      "sentence means rows joined to an owned article. What is left is the seeder's copy step and " +
      "**one symbol**: this route's GET always calls `sweepChat`, and the *Postgres* sweep writes " +
      "`CHAT_SWEPT` — declared in `src/store/fs.ts` when this was written, and moved to " +
      "`src/chat.ts` in stage G on 2026-09-05, which is what the prediction below asked for. " +
      "Named by GPT Sol's review of the batch, and it is the second of the two symbols " +
      "`store-artefacts-pg`'s entry above predicted would need somewhere neutral to live — " +
      "**deleting `fs.ts` moves this string, it does not remove it.** No model is called here, so " +
      "no ledger row.",
  },
  /* **`tests/two-servers-one-queue.test.ts` stood here until stage G's `jobs`
     group, 2026-09-05.** It reproduced the eleven concurrent `hierarchy` runs of
     2026-08-30 (docs/postmortems/260902c-the-truncation-retry-cost-storm.md)
     with `vi.resetModules()` and two imports, because the filesystem fence was a
     variable in one module's memory and a dev-server restart made a second copy.
     **Deleted rather than converted, and its own header is the authority**: it
     said the Postgres adapter's absence was the point, because a store whose
     state is in the database makes "another copy" and "another request in this
     copy" the same question, and `tests/store-jobs-parity.test.ts` already asks
     it of that store. The hazard is abolished by `claimIn`'s single
     `update … where id = $id and status = 'queued'`, not covered elsewhere. */
  "tests/an-uploaded-html-file-becomes-an-article.test.ts": {
    category: "database-integration",
    /* Written on 2026-09-07, so no witness has ever seen it run and the verdict
       rests on the import graph and this file's own docstring — which is what
       the field means and all it means. It sits beside its PDF sibling rather
       than in the *Arrivals* bucket below, because that heading is about files
       that landed between two witness **runs**, and there has been no run since
       this one was written. */
    evidence: "static-only",
    reason:
      "The HTML half of the same step, and it exists because the two things that break here break " +
      "**silently**: an upload path that stored the arrived bytes rather than the decoded string " +
      "would publish mojibake with nothing raised (the windows-1252 case is the only way that can " +
      "fail honestly), and a kind decided from the filename rather than the bytes would be wrong " +
      "in whichever direction nobody tested. Real upload records against the real store, like its " +
      "PDF sibling. docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md.",
  },
  "tests/upload-acquire.test.ts": {
    category: "database-integration",
    reason:
      "The first place that has the bytes, so the checks are built to fail honestly: a magic-byte " +
      "refusal on a right-sized plausible file, and a checksum refusal on a **same-length** " +
      "substitution. It drives the real upload record lifecycle, which selected its adapter by " +
      "flag, so the whole harness landed on Postgres at the hinge. **Stage G, 2026-09-05:** its " +
      "`fsArtifacts` became `memoryArtefacts()` and its `contextPaths(slug)` went with " +
      "`StepContext.dir`; 9 cases in, 9 out, nothing about the claim touched.",
  },
  "tests/uploads-api.test.ts": {
    category: "database-integration",
    reason:
      "*Never accept a client-supplied object path* — the assertions are about what a request may " +
      "**name**, not about status codes, since a 400 for the wrong reason still passes. Its " +
      "`minted` list exists because a previous version swept records another suite was about to " +
      "read, and that isolation problem gets sharper, not softer, on a shared database.",
  },

  /* ---- Arrivals the 2026-09-03 witness was too early to see ---------------
     Written as a static-only bucket, and it is no longer one. Re-running the
     witness on 2026-09-04 watched four of these execute a condemned function,
     so they carry no `evidence` field any more — the field's guard is what
     said so, by refusing the `static-only` claim the moment the dynamic
     record existed. The heading stays because the *grouping* is still true
     and still useful: these are the files that landed between two witness
     runs, which is the way a hole opens. Two more of the same class were in
     the main list above and were upgraded the same way. */

  "tests/an-upload-is-queued-only-once-its-bytes-arrive.test.ts": {
    category: "database-integration",
    reason:
      "Arrived after the 2026-09-03 witness ran and was carried on the import graph alone until " +
      "the 2026-09-04 re-run watched it execute one, which is what took its `static-only` off. " +
      "The readiness gate: `POST /api/jobs {uploadId}` must HEAD " +
      "the staging object before it claims anything, because the reader now reaches " +
      "`/add/upload/<id>` at byte zero and a reload of it used to queue a job over a file that " +
      "was not there — which `acquireUpload` refuses terminally. It drives the real route, the " +
      "real upload records and the real blob store, so it moves with `src/upload-records.ts` and " +
      "`src/store/blobs.ts` and needs neither changed.",
  },
  "tests/article-cache-call-site.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["step-context-paths", "fixture-loader"],
    reason:
      "**Converted in stage B on 2026-09-04.** Arrived after the 2026-09-03 witness ran, and the " +
      "2026-09-04 re-run watched it — so the `static-only` came off, and the two mechanisms named " +
      "above are now measured rather than derived. Asks the only " +
      "question that would have gone red on the conditional-cache postmortem: run a two-mode job " +
      "through the real walk and read the `StepContext.cacheArticle` each step is actually " +
      "handed. It hoisted the store flag away and drove `fsJobStore`, " +
      "`fsArtifacts` and `fsStoreSession`; it now pins `postgres` and takes its session from " +
      "`claimSession`, so every step's product is committed into the claim's own draft and the " +
      "job publishes. **Collateral rather than `database-integration`, and this one really is**: " +
      "the claim under test is store-agnostic, and what it still reaches is `runStep` computing " +
      "`contextPaths(job.slug)` for every step it walks and `scratchArticleInPg`'s copy of a " +
      "corpus article, which the draft the walk publishes has to be carried forward from.",
  },
  "tests/glossary-delete-then-rebuild.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["step-context-paths"],
    reason:
      "Arrived after the witness ran, with the glossary-delete work off `dev`. It drives a real " +
      "claim, `openPgStoreSession`, `advanceJobWith` and a real publication, then reads back on " +
      "another connection — entirely Postgres, and its reach into `artifacts-fs` is " +
      "`src/jobs.ts`, which is `runStep` computing paths. The 2026-09-04 re-run confirmed it, so " +
      "the verdict is no longer the graph's alone.",
  },
  "tests/pdf-page-cap-message.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Arrived after the witness ran, with the swallowed-sentence work " +
      "(docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md § Stage 1). Builds a real " +
      "over-cap PDF — `MAX_PAGES + 42` pages, derived rather than pinned — and asks what " +
      "`readerFailureOf` gives the reader when `pass0` refuses it; its sibling case builds the " +
      "142-page paper that prompted the work and asserts it is now accepted. Its " +
      "whole static reach is `src/pdf-read.ts` importing `cli-ledger.ts` for its command-line " +
      "half; the refusal is thrown before any paid call, so no ledger row is ever written and the " +
      "checkpoint store is a `Map`. Re-run witness 2 to confirm.",
  },
  "tests/a-429-is-asked-again.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Arrived after the witness ran, with the chunk-concurrency work " +
      "(docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md § Stage 5). It stubs " +
      "`fetch` and drives `openRouterReader().read()` to prove a 429 is asked again while a 400 " +
      "and a 402 are not. No store of any kind: no database, no blobs, no checkpoints. Its whole " +
      "static reach is the same `src/pdf-read.ts` → `cli-ledger.ts` import its two siblings above " +
      "have, and no paid call is ever recorded because the wire is a stub. Re-run witness 2 to " +
      "confirm.",
  },
  "tests/checkpoint-hit-rate-is-logged.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Arrived after the witness ran, with the checkpoint-instrumentation work " +
      "(docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md § Stage 6, building " +
      "recommendation 2 of docs/postmortems/260904a-a-retry-minted-a-fresh-name-so-the-" +
      "checkpoints-could-never-be-found.md). It drives `runPdfExtract` with a stub `PdfReader` " +
      "and `generateLabels` with no credential, over a `Map` checkpoint store, and reads what " +
      "the logger wrote. No database, no blobs, no artefacts on disk; its whole static reach is " +
      "the same `src/pdf-read.ts` → `cli-ledger.ts` import its page-cap siblings have, and no " +
      "paid call is ever made so no ledger row is written. Re-run witness 2 to confirm.",
  },
  "tests/a-long-pdf-is-refused-before-it-is-stored.test.ts": {
    category: "database-integration",
    reason:
      "Arrived after the 2026-09-03 witness ran and was upgraded off `static-only` by the " +
      "2026-09-04 re-run, which watched it reach `artifacts-fs`. It came with the page-cap move " +
      "(docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md § Stage 4). It drives the " +
      "real `fetch` step through both of its halves — real upload records, the real blob store, " +
      "`fsArtifacts` — to prove an over-long PDF is refused before anything is stored and the " +
      "upload record ends `rejected`. It moves with `src/upload-records.ts` and " +
      "`src/store/blobs.ts`, like `upload-acquire.test.ts` whose harness it follows. The URL half " +
      "mocks `src/fetch.js` for `fetchDocument` only, because `fetchDocument` refuses loopback. " +
      "**Stage G, 2026-09-05:** `fsArtifacts` became `memoryArtefacts()` and `contextPaths` went " +
      "with `StepContext.dir`; 8 cases in, 8 out.",
  },
  "tests/pdf-read-failure-sentences.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Its sibling, same work and same shape: the other three refusals in `runPdfExtract` — a " +
      "chunk too large to encode, a truncated answer, a safety-filter refusal — asserted at the " +
      "reader seam. The two chunk cases pass a fake `PdfReader`, so nothing reaches a provider or " +
      "a ledger, and the same `src/pdf-read.ts` → `cli-ledger.ts` import is the only reach. " +
      "Re-run witness 2 to confirm.",
  },
  /**
   * **A third arrival from the same plan, on the same day.** Stage 5 this time,
   * so `static-only` for the same reason as its two siblings above: the dynamic
   * evidence does not exist yet and re-running witness 2 is what upgrades it.
   */
  "tests/pdf-source-parsed-once.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Arrived with stage 5 of docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md. " +
      "Counts `PDFDocument.load` through a `vi.mock` seam to prove the source PDF is parsed once " +
      "for the whole stage rather than once per chunk. It drives `runPdfExtract` with a stub " +
      "`PdfReader` over `memoryCheckpoints`, which is a `Map`, so there is no database, no blob " +
      "store and no path read; its whole static reach is the same `src/pdf-read.ts` → " +
      "`cli-ledger.ts` import its page-cap siblings have, and no paid call is made so no ledger " +
      "row is written. Re-run witness 2 to confirm.",
  },
  /**
   * **The mock is the whole answer here**, and it is worth a line because the
   * static reach looks alarming and is not. The graph walks
   * `src/transcribe.ts` → `src/vocabulary-sources.ts` → `src/store/index.ts` and
   * then fans out across the condemned filesystem modules — but this file
   * `vi.mock`s `src/store/index.js` outright, so the hinge module is never
   * evaluated and not one of them is ever loaded, let alone called. Witness 1
   * bucketed it `flag-selection-only`, the mildest reach it recorded, before
   * that bucket went with the flag on 2026-09-06.
   */
  "tests/feedback-dictation-vocabulary.test.tsx": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Arrived after the witness ran, with the feedback-reports batch — it answers Greg's " +
      "report that the Feedback dialog's microphone misspells `Spideryarn`, by pinning the two " +
      "joins in front of the server: that the dialog hands `useDictation` a `context`, and that " +
      "the upload puts it in the body. A jsdom React test that stubs `fetch` and mocks " +
      "`src/store/index.js`, `src/web/lib/api.js` and `useDictation`; no database, no blobs, no " +
      "path read. Its whole static reach is `src/transcribe.ts` importing " +
      "`src/vocabulary-sources.ts`, which imports the store hinge this file has already " +
      "replaced. Re-run witness 2 to confirm.",
  },
  "tests/nav-label-status-pg.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Arrived after the witness ran. A pure Postgres suite for the nav-label lifecycle column " +
      "(docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md, stage 1) — the write " +
      "beside the artefacts, both DTOs, the carry-forward and the CHECK. It seeds through " +
      "`scratchArticleInPg`, which loads a corpus article into Postgres and reads no `data/` " +
      "directory of its own. Re-run witness 2 to confirm.",
  },
  "tests/store-glossary-delete-pg.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["import-only"],
    evidence: "static-only",
    reason:
      "Arrived after the witness ran. A pure Postgres store suite — the in-place `UPDATE`, " +
      "`revision_step_runs` deliberately left alone, and the 409 for a queued job holding a draft. " +
      "Its only static reach is `src/api.ts` importing `createFsArtifactStore`, an import in a " +
      "module it loads rather than a call it makes. Re-run witness 2 to confirm.",
  },

  /* ---- Invisible to an import walk, found by the grep --------------------- */

  /* **This section is empty, and it is kept for the header's sake.**
     `tests/slug.test.ts` was its only member: one case `readFileSync`d
     `src/store/jobs-fs.ts` **as source text** to check the `_jobs` path it built
     from a hardcoded `JOBS_DIR`, which no import walk can see and no call
     instrument can watch — the whole reason a hand-written verdict was needed
     for it. Stage G's `jobs` group deleted those three lines on 2026-09-05, in
     the same commit as the module.

     **The property was not relocated to `src/store/pg-jobs.ts`, deliberately.**
     `jobs.slug` is a text column there: no `path.join`, no directory, and so
     nothing for a slug to escape into. The inbound half — `assertSlug("_jobs")`
     throws, case-folded — is the whole of the rule now and stays in that file,
     with a comment where the deleted lines were.

     The heading survives the entry because the *class* does: a test that reads a
     condemned file's source is invisible to both witnesses, and the next one
     will need a line here. scripts/store-migration-witness.ts § the blind spots
     says the same thing from the other end. */
};

/* ------------------------------------------------------------------------- */

/**
 * **What a conversion left behind, per file** — the record that outlives the
 * `STORE_MIGRATION` entry.
 *
 * ## Why this is a second map rather than a field on the first
 *
 * The two facts have different lifetimes, and that is the whole argument.
 * `STORE_MIGRATION` says *how each current filesystem reach will be
 * eliminated*: it describes remediation still outstanding, it shrinks as the
 * work lands, and an entry that stops being true should be deleted. A
 * conversion is **historical and monotone** — it happened, on a date, and no
 * later stage un-happens it. A `convertedInB` field on the first map made the
 * second fact a passenger on the first one's lifetime, so the moment stage B's
 * re-run took four converted files off `STORE_MIGRATION` their evidence record
 * went with them and the guard stopped checking them. Resolved this way by GPT
 * Sol, 2026-09-04, reviewing the fork written down in the plan.
 *
 * **The two maps are deliberately not disjoint, and that is measured rather
 * than tolerated.** Twenty-two of these twenty-six still appear in
 * `STORE_MIGRATION`, because a suite converted onto Postgres can still reach
 * the filesystem through machinery it never asked for — the fixture loader,
 * above all. Forcing an either/or would push somebody to delete a true entry
 * from one map to satisfy the other.
 *
 * **`stage` rather than a field named for one stage.** `convertedInB` was
 * already the wrong name the day it was written: C, D and E convert too, and
 * whoever converts under D would either lie in a field called `InB` or add a
 * second field beside it.
 *
 * ## What is recorded here, and what is deliberately not
 *
 * **This records only *that* the conversion happened, and how much evidence it
 * left.** Which mutation was run, what the run printed, what it does not cover
 * — all of that lives in the test file, beside the assertion it bears on, and
 * is deliberately not copied here: one fact, one home, and a copy in a registry
 * read by whoever is thinking about categories would drift from the original
 * read by whoever is thinking about the test.
 *
 * **A `reason` in `STORE_MIGRATION` may cite a mutation in a clause; it may not
 * be where the record lives.** Two entries were found on 2026-09-04 whose
 * mutation was written there and nowhere else, which the guard cannot see and a
 * reader of the test cannot either. The line is between *"mutation watched red:
 * `failureKind` deleted from `finishIn`"* — a sentence explaining a verdict,
 * which belongs in a reason — and the run's output and what it does not cover,
 * which belong beside the assertion.
 *
 * ## The counts, which are the frozen cohort and not a threshold
 *
 * The plan's answer to the guard's third hole was *"the fix is not a fourth
 * threshold"*, and these are not one. A threshold is a number somebody picked;
 * these are a **measurement of each file taken at its conversion**, so the
 * guard compares a file against its own past rather than against a floor
 * somebody guessed. That is what makes each individual marker load-bearing: the
 * hole Sol reproduced was that renaming ten of eleven markers left the file
 * satisfying *"at least one of each, somewhere"*, and no rule of that shape can
 * see a marker go missing.
 *
 * Directions chosen so the honest edit is always the green one:
 *
 * - `mutations` / `blindSpots` are **floors**. Evidence is monotone, so adding
 *   a mutation is free and removing one is loud.
 * - `blocksWithoutJudgement` is a **ceiling**, and a ratchet. See below.
 */
export interface Conversion {
  /** ISO date the conversion landed. */
  readonly date: string;
  /** The plan stage that did it — `"B"`, `"B2"`, and later `"C"`, `"D"`, `"E"`. */
  readonly stage: string;
  /**
   * Anchored `**Mutation.**` markers the file carried when it converted.
   * A floor: the guard fails if the file now has fewer.
   */
  readonly mutations: number;
  /** Anchored `**Blind to.**` markers, same day, same rule. */
  readonly blindSpots: number;
  /**
   * **The arrears on stage B3's per-`describe` rule, and a ratchet.**
   *
   * The rule the plan states is *one mutation per store-touching `describe`,
   * and the blocks that need none say why in their own headers*. Measured
   * against the tree on 2026-09-04, **that convention is B2's, not B's**: of
   * `routes.test.ts`'s 18 top-level blocks, 15 carry a `**Mutation.**` or a
   * `**No mutation…**` judgement; of the other 25 files' 82 blocks, **9 do**.
   * The stage-B files write their evidence per *file* — often in the file's own
   * header docstring — rather than per block.
   *
   * So the rule cannot be switched on as an equality today without reddening
   * 25 suites at once, and this number is the honest way to hold it anyway: the
   * count of this file's top-level blocks carrying no judgement, frozen, and
   * checked as a **maximum**. A block added to a converted file without a
   * judgement pushes the count up and fails; writing a judgement for an
   * existing block pushes it down and the record is edited to match. **A new
   * conversion records `0`** and is therefore born under the full rule.
   *
   * The debt it names is 76 blocks across 26 files, measured 2026-09-04 by
   * running the guard. Paying it down is what turns this field into a line of
   * zeroes and the ratchet into the equality.
   */
  readonly blocksWithoutJudgement: number;
}

/**
 * Every file a stage of this plan converted onto Postgres, keyed by
 * repository-relative path, alphabetical.
 *
 * Twenty-six on 2026-09-04: stage B's twenty-five, plus `routes.test.ts`, which
 * was large enough to become its own stage B2.
 */
export const STORE_CONVERSIONS: Readonly<Record<string, Conversion>> = {
  "tests/all-skipped-publication-log.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 2, blindSpots: 2, blocksWithoutJudgement: 1 },
  "tests/article-cache-call-site.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 2, blindSpots: 2, blocksWithoutJudgement: 2 },
  "tests/chat-anchor-route.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 2, blindSpots: 2, blocksWithoutJudgement: 3 },
  "tests/chat-live-ticket-route.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 2, blindSpots: 3, blocksWithoutJudgement: 4 },
  "tests/chat-live-turn.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 2, blindSpots: 2, blocksWithoutJudgement: 3 },
  "tests/chat-spoken-route.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 4, blindSpots: 2, blocksWithoutJudgement: 4 },
  /**
   * **Stage C's whole cohort**, frozen before the work started from the dynamic
   * witness crossed with `TEST_LANES`: of the twenty-seven files that reached
   * `ai-calls-fs` at run time, this was the only one the redirect's removal
   * could break, because it is the only one that both pinned the flag to
   * `postgres` and lived in the lane where `DATABASE_URL` is poisoned.
   *
   * **The freeze was one file short, and the run is what said so.** With the
   * line removed, `tests/live-session-routes.test.ts` went red too — four cases
   * — because it read its ledger rows back out of a JSONL rather than out of the
   * store. It is recorded above under stage B and its entry is not amended: the
   * counts there are what that file carries, and this sentence is where the
   * stage-C edit to it is written down.
   */
  "tests/cost-store-under-test.test.ts":
    { date: "2026-09-05", stage: "C", mutations: 2, blindSpots: 2, blocksWithoutJudgement: 0 },
  /**
   * **Stage D's cohort, and its shape is different from B's and C's.**
   *
   * D's lever is not a set of files: it is one import in one helper.
   * [helpers/load-article.ts](helpers/load-article.ts) built a
   * `createFsArtifactStore` over the fixture root and handed it to
   * `copyArtefacts` as the **source**, and 56 test files executed
   * `createFsArtifactStore` at run time while only 14 named it — the other ~42
   * inherited it from that line, through `scratchArticleInPg`. So the entry
   * below for a *helper* is the largest single conversion in this plan, and the
   * ~42 files it frees are not listed here because **none of them was edited**.
   * `STORE_CONVERSIONS` records files that were changed and what evidence they
   * carry; a file freed by somebody else's change has nothing to show.
   *
   * The other six are the `store-agnostic-fake` rows that named the store
   * directly. Each was handed a filesystem store over a `mkdtemp` directory
   * because that was the cheapest store to construct, and each now takes
   * [helpers/memory-artefacts.ts](helpers/memory-artefacts.ts).
   */
  "tests/helpers/load-article.ts":
    { date: "2026-09-05", stage: "D", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 0 },
  "tests/illustrated-step-registration.test.ts":
    { date: "2026-09-05", stage: "D", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 0 },
  "tests/job-failure.test.ts":
    { date: "2026-09-05", stage: "D", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 0 },
  "tests/jobs-commit-path.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 1, blindSpots: 2, blocksWithoutJudgement: 2 },
  "tests/jobs-walk.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 2, blindSpots: 3, blocksWithoutJudgement: 2 },
  "tests/jobs.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 2, blindSpots: 4, blocksWithoutJudgement: 9 },
  "tests/late-step-on-a-cold-instance.test.ts":
    { date: "2026-09-05", stage: "D", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 0 },
  "tests/list-reconciles-expired.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 3, blindSpots: 2, blocksWithoutJudgement: 1 },
  "tests/live-session-routes.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 6 },
  "tests/one-article-for-one-address.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 2, blindSpots: 2, blocksWithoutJudgement: 2 },
  "tests/owner-jobs.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 2 },
  "tests/quiz-mark-route.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 4, blindSpots: 2, blocksWithoutJudgement: 4 },
  "tests/quiz-step-registration.test.ts":
    { date: "2026-09-05", stage: "D", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 0 },
  "tests/referee-claims-omitted.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 2 },
  "tests/referee-claims-routes.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 2, blindSpots: 2, blocksWithoutJudgement: 1 },
  "tests/referee-criteria-routes.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 4, blindSpots: 4, blocksWithoutJudgement: 1 },
  "tests/referee-mirror-route.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 1 },
  "tests/referee-scan-route.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 3 },
  "tests/retry-is-only-for-a-failed-job.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 1, blindSpots: 2, blocksWithoutJudgement: 2 },
  /**
   * **Stage B2, and the only file in the tree that writes evidence the way the
   * rule asks for it** — fifteen of its eighteen top-level blocks carry a
   * `**Mutation.**` or a `**No mutation…**` judgement, against nine of the
   * other twenty-five files' eighty-two. The three that do not are the store
   * self-check at the top and the two body-validation tables, whose headers
   * argue in prose that there is no store between the request and the refusal
   * but do not say `**No mutation…**`.
   *
   * Counted after B3 closed its two greens, 2026-09-04: the search store's
   * `remove` gained a second run, the tweets waiver became a real mutation and
   * the admin block a second one, so twelve rather than the ten it converted
   * with. Recorded at what the file carries now rather than at what it carried
   * first, because the floor is only worth what the last measurement was.
   */
  "tests/routes.test.ts":
    { date: "2026-09-04", stage: "B2", mutations: 12, blindSpots: 12, blocksWithoutJudgement: 3 },
  "tests/second-job-queues.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 2, blindSpots: 2, blocksWithoutJudgement: 2 },
  "tests/stage-stamp-agreement.test.ts":
    { date: "2026-09-05", stage: "D", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 0 },
  "tests/step-failure-seam.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 6 },
  "tests/term-lookup.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 3 },
  "tests/the-query-string-does-not-decide-the-route.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 2, blindSpots: 2, blocksWithoutJudgement: 2 },
  "tests/tweets.test.ts":
    { date: "2026-09-05", stage: "D", mutations: 1, blindSpots: 1, blocksWithoutJudgement: 0 },
  "tests/upload-records.test.ts":
    { date: "2026-09-04", stage: "B", mutations: 3, blindSpots: 3, blocksWithoutJudgement: 5 },
};

/* ------------------------------------------------------------------------- */

/**
 * Which vitest project a Postgres-touching suite belongs in — 260903e's Stage
 * C, absorbed here as stage T-C.
 *
 * ## What a lane is
 *
 * `private-postgres` — the run mints its own database
 * ([`scripts/db-test-create.ts`](../scripts/db-test-create.ts)) and points
 * `DATABASE_URL` at it, so no dev server, no peer's suite and no residue from a
 * killed run can be inside it. This is where a Postgres suite belongs unless
 * something stops it.
 *
 * `shared-services` — the suite is about a **Supabase service**, and the
 * services are bound to the stack's one configured database. GoTrue, Storage,
 * Realtime and PostgREST all read `postgres` and cloning the SQL does not
 * redirect them, so a suite that joins their answers to app rows has to run
 * where both halves agree.
 *
 * `unit` — no database at all, and the ordinary parallel lane. **It is the
 * default and it is not written down**: a file absent from the map below is a
 * unit-lane file, which is most of `tests/`. The variant exists because T-D's
 * third project needs a name. An explicit `unit` *entry* would mean the scan
 * calls a file Postgres-touching and it still needs no database — there is none
 * today, and the guard **refuses one**, deliberately: routing it needs a third
 * case wherever T-D derives its project globs, and a lane the projects cannot
 * route sends a file to a project that creates no database and then fails for a
 * reason nobody can place. Widen both together or neither.
 *
 * ## Why this is a second map and not a second column on `STORE_MIGRATION`
 *
 * Because neither verdict predicts the other, and GPT Sol's counter-example
 * settles it: `tests/auth-user-seeding.test.ts`, `tests/seed-admin-signin.test.ts`
 * and `tests/admin-store.test.ts` are all genuine Postgres tests, so the store
 * verdict above says nothing about them, while their lane is decided by GoTrue
 * reading `postgres` whatever the SQL does. A classification that cannot
 * predict its own exceptions is not the same classification.
 *
 * ## A file cannot be in two lanes, and that is the compiler's job
 *
 * This is a `Record`, so two entries for one file is TypeScript error 1117 —
 * *"an object literal cannot have multiple properties with the same name"* —
 * rather than something a test has to notice. Watched: duplicating
 * `"tests/store-comments.test.ts"` with the other lane makes `npm run
 * typecheck` refuse the file by name. So
 * [store-migration-registry.test.ts](store-migration-registry.test.ts) polices
 * only the two directions a `Record` cannot: a scanned file with no entry, and
 * an entry for a file the scan no longer finds.
 *
 * ## The four in `shared-services`, and why each
 *
 * - **`tests/auth-user-seeding.test.ts`** — its subject is that a row this repo
 *   writes into `auth.users` is one GoTrue can read back, and it proves it by
 *   calling `GET /auth/v1/admin/users`. The service answers about `postgres`,
 *   so a row seeded into a clone is invisible to the only oracle the file has.
 * - **`tests/seed-admin-signin.test.ts`** — signs in through the Auth service
 *   as `ADMIN_USER_ID_LOCAL`. Same service, same database, and the account it
 *   needs is one `db:seed-dev` put in the shared stack.
 * - **`tests/admin-store.test.ts`** — the one that has to be *reasoned* about
 *   rather than watched, because **it passes in the private lane while checking
 *   nothing**, which is this repo's chronic failure shape. Accounts come from
 *   GoTrue over HTTP (`postgres`, so still non-empty, so its
 *   `users.length > 0` control still fires) and every aggregate beside them is
 *   `?? 0` out of the clone (`src/store/pg-admin.ts`). Its claim is that the
 *   *types* of a real join survive the driver; against a clone the join has one
 *   real side and one empty one, and `typeof 0` is `"number"` however wrong the
 *   number is. Measured green on a private database on 2026-09-03 — which is
 *   the argument for moving it, not against.
 * - **`tests/db-test-create.test.ts`** — the factory's own suite, and the only
 *   one of the four chosen **by contract rather than by a red**: it passes
 *   57/57 in the private lane too, because `dumpSharedSchema` hardcodes
 *   `-d postgres` and the host and port do not change. What is wrong is
 *   quieter. `baseUrl()`'s documented job is to mean *the shared database*, and
 *   under a private lane it silently means a clone — so the factory's own suite
 *   would mint siblings of a clone, and T-D's lane would create a database in
 *   order to create databases. The file whose job is to police the factory is
 *   the worst place to leave that ambiguity. Its integration half is
 *   additionally gated on `SPIDERYARN_TEST_DB_FACTORY=1`, and T-D decides
 *   whether the lane sets it.
 *
 * **`tests/store-realtime-sessions.test.ts` is deliberately not here**, and
 * 260903e's first list was wrong to include it. Checked rather than inherited:
 * its Postgres half inserts its own two `auth.users` rows through
 * `seedAuthUser` — a database fixture written over the same connection as
 * everything else, **not** a call to the Auth service — and exercises
 * `pgRealtimeSessionStore` over Drizzle. The string `Realtime` in it is the
 * feature's name, and nothing in the file speaks to a Supabase service. It
 * passed in the private lane, first time, unchanged.
 *
 * ## Storage is **not** isolated, and nothing here changes that
 *
 * The private lane clones the SQL. The bucket does not move: `blobStore` talks
 * to the Storage service over HTTP and that service is bound to `postgres`, so
 * two runs share one bucket and `storage.objects` in a clone is permanently
 * empty. Acceptable, because every key this repo writes is content-addressed —
 * two runs writing the same bytes write the same object, and neither can
 * clobber the other's contents. But it is a **stated limitation**, not
 * something a reader should discover: a test that asserts on what the bucket
 * contains, or on it being empty, is not isolated by the private lane and will
 * race a peer.
 *
 * **Two files reach the real bucket, and getting to that number took three
 * goes.** Five suites mention `src/store/blobs.js` at all. Two of them —
 * `tests/illustrated-route.test.ts` and `tests/store-export-bundle.test.ts` —
 * `vi.mock` it, the first to a filesystem blob store over a temp directory and
 * the second to a store that *throws* on any read (`blob store touched: this
 * code path must not read the bucket`), so neither goes near Storage. A third,
 * `tests/store-export-raw.test.ts`, imports only a type. What is left:
 *
 * - `tests/helpers-load-article.test.ts` — calls `blobStore().head()` directly,
 *   to prove the loader *puts* the raw document in the bucket rather than
 *   assuming the backfill already did.
 * - `tests/source-store.test.ts` — calls `storeRawSource(bytes, kind)` with its
 *   default third argument, which is `blobStore()`. Nothing in the file says
 *   "bucket", which is why the first two counts of this list both missed it:
 *   one said three (counting the two mocked files), GPT Sol's review said one
 *   (spotting the mocks but not the default argument). Neither was right, and
 *   the way to see it is to follow what `blobStore()` is *called by*, not what
 *   the test file mentions.
 *
 * ## How the lanes were decided
 *
 * By running, not by reading — 260903e's own instruction, and the reason this
 * map could not be written in stage A. Every entry below was run against a
 * database minted by the factory, one file at a time, under `REQUIRE_POSTGRES=1`
 * so that a skip counted as a failure. The results, the tail of suites that
 * assume seeded local state, and what was fixed against what was catalogued are
 * in
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § T-C.
 */
export type TestLane = "private-postgres" | "shared-services" | "unit";

/**
 * Keyed by repository-relative path, alphabetical within each lane.
 *
 * The set of keys is not a judgment: it is whatever
 * [store-migration-registry.test.ts](store-migration-registry.test.ts) § the
 * lane scan finds — every test file that calls `pgReady(`, builds its own `pg`
 * `Pool`/`Client`, or imports a helper that opens a connection. Adding a file
 * that touches Postgres therefore turns that guard red until it is given a lane
 * here.
 *
 * **That scan is a syntactic inventory guard and nothing more**, which is worth
 * knowing before you rely on this list being complete. It reads the text a file
 * contains, so it cannot see an aliased constructor (`new PgPool()`), a helper
 * of a file's own that connects somewhere else, a dynamic `import()`, or a
 * transitive `getDb()` inside application code. The guard's own docstring gives
 * the measurements and says why a transitive-import guard is the wrong answer.
 * **The semantic backstop is T-D's**: the unit project must delete or poison
 * `DATABASE_URL` after `.env.local` has loaded, so a database test that escaped
 * this list fails loudly rather than quietly reaching the shared database.
 */
export const TEST_LANES: Readonly<Record<string, TestLane>> = {
  /* ---- shared-services: bound to the stack's own `postgres` -------------- */

  "tests/admin-store.test.ts": "shared-services",
  "tests/auth-user-seeding.test.ts": "shared-services",
  "tests/db-test-create.test.ts": "shared-services",
  "tests/seed-admin-signin.test.ts": "shared-services",

  /* ---- private-postgres: everything else that touches a database --------- */

  "tests/a-claim-that-lost-its-draft.test.ts": "private-postgres",
  /* **Arrived from another worktree the same afternoon this lane was built**,
     and needed no exemption — it seeds an owner through `seed-auth-user`, which
     the scan's `CONNECTING_HELPERS` list now names precisely because of it.

     The order is worth keeping: the poisoned `DATABASE_URL` found it first, by
     failing its `insert into auth.users`, and the predicate was widened
     afterwards so that the *guard* catches the next one instead of a test
     failure. A syntactic manifest and a semantic backstop are not two ways of
     doing the same job — this file is what it looks like when the second one
     feeds the first. */
  "tests/a-long-pdf-is-refused-before-it-is-stored.test.ts": "private-postgres",
  /* Storage, not Postgres — see `an-upload-is-queued-…` below. Found by the
     Storage poison on its first full run, which is what a semantic backstop is
     for: Sol read four out of the lane map and running it found two more. */
  "tests/acquire-extract-blocks-end-to-end.test.ts": "private-postgres",
  "tests/admin-feedback-store.test.ts": "private-postgres",
  "tests/ai-calls-spend-pg.test.ts": "private-postgres",
  /* The two asset routes, 2026-09-06. Postgres for the two seeded articles and
     their manifests; the bucket is a temp directory, mocked at the `blobStore()`
     selector exactly as `illustrated-route` mocks it, so nothing here touches
     Storage. */
  "tests/asset-route.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04. Its header used to say **"no database at
     all, deliberately"**; it now seeds one article and drives a real
     `claimSession` claim over it, so it writes an article, a revision, its
     blocks and a job row under one fixed slug. The private lane is what keeps
     two runs off that slug — `jobs_one_running_per_slug` would not fail the
     second, it would make it wait. No GoTrue and no bucket: the owner is the
     dev one the clone already seeds, and the article comes out of the committed
     corpus. */
  "tests/all-skipped-publication-log.test.ts": "private-postgres",
  "tests/all-skipped-publication-refusal.test.ts": "private-postgres",
  /* **Storage, not Postgres — and a lane all the same.** GPT Sol found four
     files in the unit lane reaching the real shared Supabase bucket over HTTP
     (2026-09-04). This one PUTs a staging object and has the route HEAD it
     back. `private-postgres` is the only lane that both leaves `SUPABASE_URL`
     alone and serialises, so two of these files cannot collide inside one run.
     `LANES_BEYOND_THE_SCAN` below carries the per-file reason. */
  "tests/an-upload-is-queued-only-once-its-bytes-arrive.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and it needs the private lane more than
     most: it seeds an article and then *publishes* three revisions of it
     through the real `claimSession`, so it writes articles, revisions, step
     runs and job rows under one fixed slug. Two concurrent runs would be two
     walks over one article's line — and `claim` refuses while an older active
     job holds the slug, so the second would not fail, it would hang until its
     bounded loop gave up. No GoTrue and no bucket: the owner is the dev one the
     clone already seeds, and the article comes out of the committed corpus. */
  "tests/article-cache-call-site.test.ts": "private-postgres",
  "tests/article-rows-snapshot.test.ts": "private-postgres",
  "tests/billing-admission.test.ts": "private-postgres",
  "tests/billing-checkout.test.ts": "private-postgres",
  /* Stage 3b's, arriving from this worktree rather than from `dev`, and caught
     by the same guard for the same reason. It calls `pgReady`, seeds its own
     owner and its own two tiers, and its oracle is rows it writes itself — so
     the private lane is right and nothing in it needs the shared stack. */
  /* Stage 5's, 2026-09-05: a public article costs half a slot. It calls
     `pgReady`, seeds its own owner and writes its own articles and ledger rows,
     and its oracle is those rows — so the private lane is right and nothing in
     it needs the shared stack. */
  "tests/billing-half-units.test.ts": "private-postgres",
  "tests/billing-quota-adjustment.test.ts": "private-postgres",
  "tests/billing-quota-race.test.ts": "private-postgres",
  "tests/billing-settlement.test.ts": "private-postgres",
  "tests/billing-tiers.test.ts": "private-postgres",
  "tests/billing-usage-route.test.ts": "private-postgres",
  "tests/blocks-baseline.test.ts": "private-postgres",
  "tests/candidates-route.test.ts": "private-postgres",
  "tests/chat-anchor.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and the lane follows from what it now
     seeds rather than from what it asserts: `scratchArticleInPg` writes an
     article, a revision and its blocks under the throwaway slug, and the route
     writes conversations against them. Nothing here goes near GoTrue or the
     Storage bucket — the model is stubbed and the article comes out of the
     committed corpus — so the private clone is enough, and it is what keeps the
     `chat_threads` rows of two concurrent runs out of each other's `load()`. */
  "tests/chat-anchor-route.test.ts": "private-postgres",
  "tests/chat-library-exclusion.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and this one has a second writer the
     other chat route suites do not: the ticket journals a `realtime_sessions`
     row before the token leaves the server, owned by `TEST_OWNER` and so
     depending on that account existing in `auth.users`. The private lane's
     setup seeds exactly those accounts, and it writes the rows over SQL rather
     than through the Auth service — nothing here talks to GoTrue — so
     `shared-services` would buy nothing while the clone keeps a growing journal
     of stub sessions out of the shared stack's own. */
  "tests/chat-live-ticket-route.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04. The lane is decided by what the cases do
     rather than by what they seed: each one leaves a model call hanging open
     and then aborts it, and the rows it is asserting about — a reply that must
     still be `pending`, and one that must have reached `done` — are read back
     while another case may be halfway through the same sequence. On a shared
     database a neighbour's answer under the same thread id would be
     indistinguishable from a regression. No GoTrue and no Storage: the article
     is the committed corpus and the provider is stubbed. */
  "tests/chat-live-turn.test.ts": "private-postgres",
  /* Written 2026-09-05 for `chat_messages.help`. Same shape and same reasons as
     `chat-anchor-route.test.ts` beside it: `postgres` pinned before any import,
     the article seeded through `scratchArticleInPg`, the model stubbed. It
     reads conversations back with `chatStore.load` after every post and asserts
     on the first thread in the list, which is an assertion a neighbouring run
     writing to the same `chat_threads` could falsify without touching this
     file. */
  "tests/chat-help-route.test.ts": "private-postgres",
  "tests/chat-route.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and the lane follows from the read-backs
     rather than from the writes: three cases go and look in the store, and two
     of them assert a `load()` is **empty**. An emptiness assertion is the one
     shape a neighbouring run can falsify without touching this file at all, so
     the private clone is not merely tidiness here — it is what makes those two
     refusals mean what they say. Nothing goes near GoTrue or the Storage
     bucket: no model is called and the article comes out of the committed
     corpus. */
  "tests/chat-spoken-route.test.ts": "private-postgres",
  /* Written 2026-09-08 for the chat slice of the `AUTH_ROUTES` migration
     (docs/plans/260908a-chat-and-live-sessions-join-the-route-table.md). It
     seeds two conversations under a slug of its own and asserts, after the
     route deletes one, that the store kept **exactly** the other — an exact
     list rather than a membership check, which a neighbouring run writing to
     `chat_threads` under the same slug could falsify. Nothing goes near GoTrue
     or the Storage bucket: no model is called and the article comes out of the
     committed corpus. */
  "tests/chat-thread-delete-route.test.ts": "private-postgres",
  "tests/checkpoints-durable-resume.test.ts": "private-postgres",
  "tests/claim-session-postgres.test.ts": "private-postgres",
  "tests/comment-referee-mark.test.ts": "private-postgres",
  "tests/comment-sweep.test.ts": "private-postgres",
  "tests/corpus-lock.test.ts": "private-postgres",
  /* 2026-09-05. Its second block drives a collector whose sink is `costStore`,
     so a settled call becomes a real row and a late one becomes nothing — which
     is the asymmetry `lateCalls` exists to report and cannot be shown against a
     store nothing selects. It was written against `fsCostStore` for a day and
     the import-graph guard is what said so. */
  "tests/cost-ledger-shortfall.test.ts": "private-postgres",
  /* Stage C, 2026-09-05. A `unit`-lane file until the redirect it asserted
     went away; what it asserts now is *which database* the ledger lands in,
     and that needs one. */
  "tests/cost-store-under-test.test.ts": "private-postgres",
  "tests/db-error-scrub.test.ts": "private-postgres",
  "tests/db-referee-criteria.test.ts": "private-postgres",
  "tests/db-schema-drift.test.ts": "private-postgres",
  "tests/db-schema.test.ts": "private-postgres",
  "tests/db-transaction-errors.test.ts": "private-postgres",
  "tests/enqueue-drives-what-it-queues.test.ts": "private-postgres",
  "tests/enqueue-owns-the-article.test.ts": "private-postgres",
  "tests/export-route.test.ts": "private-postgres",
  "tests/feedback-store.test.ts": "private-postgres",
  /* The first inbound rate limiter, and the lane follows from what it
     counts: `rate_limit_events` rows per owner in a rolling hour. A peer
     run sharing the stack's database and the same seeded owner would add
     fills this file never made, and a cap suite that counts somebody
     else's traffic fails for a reason nobody can reproduce. It seeds two
     owners over SQL and needs neither GoTrue nor a bucket. */
  "tests/fetch-allowance.test.ts": "private-postgres",
  "tests/find-article.test.ts": "private-postgres",
  "tests/glossary-delete-then-rebuild.test.ts": "private-postgres",
  "tests/glossary-ideas-baseline.test.ts": "private-postgres",
  /* **The scan could not see this one, and T-D's poisoned `DATABASE_URL` found
     it on its first full run** — 4 failures, `the migration ledger could not be
     read`. It called no `pgReady(` and built no pool: it drives the health
     handler, which reads the ledger through the application's own `getDb()`,
     and its own comment admitted the dependency (*"with a full environment and
     a populated shelf there is nothing left to complain about"*).

     **It is an ordinary scanned file again since 2026-09-04**, and the
     exemption it used to carry in `LANES_BEYOND_THE_SCAN` is gone. Giving it a
     lane fixed which database it uses; it did not make the no-database case
     skip, and Sol found it *failing* four ways with the stack off, against the
     stage's own promise. The gate it now has is a real `pgReady(` on the
     migration ledger — which the scan does see, so the exemption went stale the
     moment the fix landed and the guard said so before anybody had to. */
  "tests/health.test.ts": "private-postgres",
  "tests/helpers-load-article.test.ts": "private-postgres",
  "tests/helpers-seed-reader-state.test.ts": "private-postgres",
  /* Storage, not Postgres — see `an-upload-is-queued-…` above. */
  "tests/illustrated-pg.test.ts": "private-postgres",
  "tests/illustrated-route.test.ts": "private-postgres",
  /* Storage, not Postgres — see `an-upload-is-queued-…` above. */
  "tests/job-failure.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and the lane follows from what a single
     case writes: a seeded article, a `jobs` row against it, and then a **real
     `blocks` stage committing through `pgStoreSession`** — so one run of it
     touches `articles`, `article_revisions`, `revision_blocks`,
     `block_identities`, `revision_step_runs` and `jobs`, and ends by publishing
     a revision. Two copies of it on one database would queue behind each other
     on `jobs_active_slug` and then argue about which revision is current. It
     seeds a bucket object through `scratchArticleInPg`, so it wants the lane
     that leaves `SUPABASE_URL` alone as well as the one that serialises. */
  "tests/jobs-commit-path.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and the lane is what keeps ten seeded
     articles from being eleven. Every case here seeds a throwaway article and
     walks a job that publishes over it, and one case deliberately puts **two**
     jobs on one article to watch the younger wait — which is `jobs_active_slug`
     arbitrating, so a peer's ingest or a second copy of this file in the same
     per-article line would turn a `busy` this file asserts into one it did not
     cause. Two of the cases also `vi.resetModules()` and re-import
     `src/store/pg-jobs.js`, which opens a second pool against the same
     database; the private clone is what makes that a second connection rather
     than a second contender for somebody else's dev server. `scratchArticleInPg`
     puts a bucket object in as well, so it wants the lane that leaves
     `SUPABASE_URL` alone as much as the one that serialises. */
  "tests/jobs-walk.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and the lane follows from two of its
     cases in particular. One puts a *second* job on a busy article and asserts
     that the queue appends rather than renames, which is `jobs_active_slug`
     arbitrating — a peer's real ingest of the same slug, or a second copy of
     this file, would sit in the same per-article line and turn that into a
     refusal nobody asked for. Another counts the running rows the cap sees. It
     also expires a lease on the database's own clock and then asserts what the
     sweep did, which is a statement about rows nobody else may be settling.
     `scratchArticleInPg` puts a bucket object in for the advance block, so it
     wants the lane that leaves `SUPABASE_URL` alone as well as the one that
     serialises. */
  "tests/jobs.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and the lane is doing real work here
     rather than following a rule. Two of the cases count `list` and
     `settleExpired` calls and one asserts the sweep is *not* called, so the
     file's subject is how many statements a poll issues — and a peer's dev
     server sweeping the same table, or a second copy of this run's own two
     owners, is exactly the thing that makes those counts wrong. It seeds two
     `auth.users` rows over SQL and touches no Auth service, so `shared-services`
     would buy nothing while the private clone keeps the seeded pair out of the
     stack `tests/admin-store.test.ts` reports on. */
  /* Arrived in this lane in stage G, 2026-09-05, when the shelf it measures
     stopped being a walk of `data/`. It seeds 300 published revisions with no
     library scalars **under an owner of its own** and reads the one aggregated
     warning `scalarsForShelf` emits for them, in a child with
     `NODE_ENV=development` because the logger is silent under `test`. Nothing
     about it wants a Supabase service; it wants 300 rows nobody else can see,
     which is what this lane is. `tests/request-spend.test.ts` is the same
     child-plus-private-database arrangement. */
  /* Stage 2 of the labels split, 2026-09-06. It seeds one article and drives
     real `beginStep`/`write`/`finishStep` claims over it — writing articles,
     revisions, block rows, step runs and a job row under one fixed slug — so
     two concurrent runs would be two walks over one article's line. Everything
     it does is inside a transaction it rolls back; the article itself is
     suffixed per run and cleaned up in `afterAll`. */
  "tests/labels-receipt-invalidation.test.ts": "private-postgres",
  "tests/library-log-volume.test.ts": "private-postgres",
  "tests/list-reconciles-expired.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and the lane follows from a count: one
     case asserts that a ticket OpenAI refused journalled **nothing**, by
     counting `realtime_sessions` rows for this slug before and after. A
     neighbour's run under the same fixed slug would change that number without
     touching this file. It writes rows owned by `TEST_OWNER` — the account the
     private lane's setup seeds — over SQL rather than through GoTrue, and the
     article comes out of the committed corpus, so nothing here wants the shared
     stack. */
  "tests/live-session-routes.test.ts": "private-postgres",
  /* `link_previews` is the one **ownerless** table in this schema, so its
     rows are shared by construction and these two files clear the whole
     table between cases — which is exactly the thing a shared database
     must not have done to it while a peer is mid-run. The private lane is
     what makes "the cache is empty" a fact this file established rather
     than one it hopes for. The route file also seeds an article and a
     second owner; neither wants the shared stack. */
  "tests/link-preview-cache.test.ts": "private-postgres",
  "tests/link-preview-route.test.ts": "private-postgres",
  /* Stage 3's half of the same feature, and the private lane for the same two
     reasons: it clears `link_summaries` between cases, which is a thing no
     shared database may have done to it while a peer is mid-run, and it seeds an
     article under a second owner. */
  "tests/link-summary-cache.test.ts": "private-postgres",
  "tests/load-article-serialisation.test.ts": "private-postgres",
  "tests/lock-lifecycle.test.ts": "private-postgres",
  "tests/migration-reconciliations.test.ts": "private-postgres",
  /* New on 2026-09-06. Nothing it asserts is about state the shared stack has:
     it seeds its own throwaway article per run and reads back one column. */
  "tests/nav-label-status-pg.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04. The lane follows from what arbitrates:
     the refusal this file's repair handles is `jobs_active_source`, a partial
     unique index over *every* active reserving job for a URL — global on the
     address, not scoped to this run — so a peer's dev server holding the same
     address would change the answer. The addresses are minted per case
     (`anAddress`) and could not collide by accident, but the count in
     `activeSlugsFor` is over the owner's whole queue, and the owner is the
     shared dev one. No article, no GoTrue, no bucket. */
  "tests/one-article-for-one-address.test.ts": "private-postgres",
  "tests/owner-isolation.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04. Its header's *jobs never reach Postgres*
     is what the conversion falsifies, and the lane follows from the two owners
     it now has to seed: `jobs.owner_id` is a foreign key into `auth.users`, so
     the file writes rows into a schema GoTrue also reads. It touches no Auth
     *service* — the rows go in over SQL — so `shared-services` would buy
     nothing, while the private clone is what keeps a seeded `auth.users` row
     out of the shared stack that `tests/admin-store.test.ts` reports on. */
  "tests/owner-jobs.test.ts": "private-postgres",
  "tests/pg-ready.test.ts": "private-postgres",
  "tests/pg-session-exact-base.test.ts": "private-postgres",
  "tests/pg-session-real-step.test.ts": "private-postgres",
  "tests/pipeline-slug-claim.test.ts": "private-postgres",
  "tests/plans-match-tiers.test.ts": "private-postgres",
  /* Stage 2b of 260906a: publication queues the free `labels` job. Postgres
     throughout — it publishes real revisions, claims a real job and inserts a
     real `ingest_events` row to prove the successor never settles one. */
  "tests/publication-enqueues-the-labels-successor.test.ts": "private-postgres",
  /* The lane's own negative control, and it has to be *in* the lane to be one:
     it asks Postgres which database this worker landed in after a
     `vi.resetModules()`, which is a question only a worker with a minted
     database can ask. Watched failing before `PINNED` was added to
     tests/setup/private-db.ts. */
  "tests/private-lane-survives-a-module-reset.test.ts": "private-postgres",
  "tests/public-visibility-pg.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and the lane is decided by the one case
     that publishes: *a revision landing between the two reads* is now a second
     real publication onto a seeded article, taken while a request is halfway
     through the handler. That mints a `jobs` row, opens a draft and moves
     `articles.current_revision_id`, and `jobs_one_running_per_slug` means a
     neighbouring run mid-ingest on the same slug turns it into somebody else's
     failure. No Auth service and no Storage beyond the corpus bytes the seeder
     dedups, so `shared-services` would buy nothing. */
  "tests/quiz-mark-route.test.ts": "private-postgres",
  /* Storage, not Postgres — see `an-upload-is-queued-…` above. This is the
     worst of the four: it removes and re-plants **one deterministic canonical
     key** with deliberately corrupt bytes, so two concurrent runs can destroy
     each other's oracle. */
  "tests/raw-source-store.test.ts": "private-postgres",
  /* The five referee suites below were converted together in stage B on
     2026-09-04, and they take the private lane for one reason between them:
     each seeds its own throwaway article through `scratchArticleInPg` and then
     writes reader state — a claims run, criteria, comments — against it. None
     goes near GoTrue, and the only Storage traffic is the corpus bytes the
     seeder dedups, except `referee-scan-route`, which stores four small raw
     documents of its own under content-addressed names nothing else can
     collide with. */
  "tests/referee-claims-omitted.test.ts": "private-postgres",
  "tests/referee-claims-routes.test.ts": "private-postgres",
  "tests/referee-criteria-routes.test.ts": "private-postgres",
  "tests/referee-criteria-store.test.ts": "private-postgres",
  "tests/referee-mirror-route.test.ts": "private-postgres",
  "tests/referee-routes-postgres.test.ts": "private-postgres",
  "tests/referee-scan-route.test.ts": "private-postgres",
  /* Three streaming referee routes held open mid-stream. Private rather than
     shared because it backdates `attempt_started_at` and `created_at` on this
     article's rows to reach the sweep's age branch, which a peer suite reading
     the same table at the same moment would see. */
  "tests/referee-stream-lifetime.test.ts": "private-postgres",
  /* Converted in the hinge, 2026-09-05: its child wrote a JSONL ledger through
     `fsCostStore`, which `costStore` chose because the flag was unset. The rows
     are `spideryarn.ai_calls` now, and the child reaches the private database
     because it inherits both `DATABASE_URL` and `SPIDERYARN_ENV_PINNED`. */
  "tests/request-spend.test.ts": "private-postgres",
  "tests/remember-route.test.ts": "private-postgres",
  /* The guarantee the Metadata page's "Generate it again" control sells: a
     re-run that fails leaves the reader on the artefact they already had
     (docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md).
     It publishes a revision, fails a draft over it, and reads back through
     `loadQuotes` — the reader's own path — so there is no honest version of it
     without a database. */
  "tests/rerun-failure-keeps-the-old-artefact.test.ts": "private-postgres",
  /* Landed 2026-09-04 with the reservation of `/read/public`
     (docs/plans/260904b-pricing-page-and-public-showcase.md § Stage 3a). Two of
     its three enforcers are pure functions and need nothing; the third is
     `lockOrCreateArticle`, and there is no honest way to observe a refusal
     inside an insert path without the row and the lock. Every case there runs
     in a transaction it then rolls back, so it leaves nothing behind — but it
     does briefly hold the article slug `public`, and two copies of that in one
     database would meet each other on `articles_slug_unique`. No GoTrue and no
     bucket: the owner is the dev one the clone already seeds, so no
     `OWNER_AUDIT` entry either. */
  "tests/reserved-article-address.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04. It seeds five throwaway articles and
     walks a job over each, so it writes articles, revisions, step runs and job
     rows under five fixed slugs — and two of its cases queue a **real** retry,
     whose pump takes the article's line. A second copy of this file in a shared
     database would meet its own slugs in `jobs_active_slug` and hang rather
     than fail. No GoTrue and no bucket beyond the loader's own: the owner is
     `DEV_OWNER_ID`, which the private clone already seeds, so no `OWNER_AUDIT`
     entry either. */
  "tests/retry-is-only-for-a-failed-job.test.ts": "private-postgres",
  /* Landed with stage 3 of 260903k on 2026-09-03 and was never given a lane —
     it drives the Postgres queue, and article identity is only expressible
     there. Filed here on 2026-09-04 by the stage that found the gate red, and
     independently by T-C when it arrived from `dev` and the lane guard refused
     to stay green — which is the whole point of a guard that re-derives the
     universe rather than reading a stored answer. Two identical entries were a
     duplicate key and a red typecheck; this is the surviving one, in the
     alphabetical run where a reader will look for it. It calls `pgReady` and
     its oracle is checkpoint rows it writes itself, so the private lane is
     right and nothing about it needs the shared stack. */
  "tests/retry-keeps-the-checkpoints.test.ts": "private-postgres",
  /* Converted in stage B2, 2026-09-04 — the whole HTTP surface, and the last
     file of stage B. Five seeded articles under fixed `test-routes-…` slugs,
     and reader state written on every one of them: comments, saved searches,
     shelf rows and the owner's single `reader_profiles` row. The private lane
     is what makes that safe twice over. A second copy of this file in a shared
     database would meet its own slugs in `articles_slug_unique`; and the
     reader-profile block writes the row keyed on `TEST_OWNER` — the local
     administrator — which on the shared database is Greg's own, so `npm test`
     would have been editing a real profile. It reaches GoTrue for
     `/api/admin/users`, which is the shared stack's Auth service in every lane
     and is read-only there. */
  "tests/routes.test.ts": "private-postgres",
  "tests/run-lock.test.ts": "private-postgres",
  "tests/running-slot.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and the lane follows from the rows it
     writes rather than from the route it drives: the holder job and the two
     the route accepts are `spideryarn.jobs` rows under `TEST_SUB`, and the
     third case's *identical requests are one job* is `jobs_active_work`
     arbitrating between two inserts. A shared database would let a peer's real
     ingest of this file's slug — or a second copy of this file — sit in the
     same per-article line and turn a 202 into a queue position nobody asked
     about. Nothing here reaches GoTrue or the bucket: the owner row is one the
     private clone already seeds, and no article is loaded at all. */
  "tests/second-job-queues.test.ts": "private-postgres",
  /* Its slug carries a per-run uuid and its block ids are minted, so it
     collides with nothing; the private lane is still where it belongs, because
     it inserts an article, a revision and a (rolled-back) job and reads
     `revision_step_runs` directly. Its ambient owner is a row the private
     clone already seeds, no article is loaded from the corpus, and nothing
     goes near GoTrue or the bucket. */
  "tests/shared-site-run-row-gate.test.ts": "private-postgres",
  "tests/source-store.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and the private lane is not optional
     here: six fixed slugs, each of which `lockOrCreateArticle` **creates** the
     `articles` row for on the first claim, and `articles_slug_unique` is
     global. Two concurrent runs would be two jobs on one article's line, and
     `claim` refuses while an older active job holds the slug — so the second
     would not fail, it would sit in `settle`'s poll until it gave up. Its
     ambient owner is the row the private lane's setup already seeds, no article
     is loaded from the corpus and nothing goes near GoTrue or the bucket. */
  "tests/step-failure-seam.test.ts": "private-postgres",
  "tests/store-ai-calls.test.ts": "private-postgres",
  "tests/store-artefacts-pg.test.ts": "private-postgres",
  "tests/store-block-roles-pg.test.ts": "private-postgres",
  "tests/store-carry-forward.test.ts": "private-postgres",
  "tests/store-chat-pg.test.ts": "private-postgres",
  "tests/store-checkpoints.test.ts": "private-postgres",
  "tests/store-comments.test.ts": "private-postgres",
  "tests/store-export-bundle.test.ts": "private-postgres",
  "tests/store-export-covers-tables.test.ts": "private-postgres",
  "tests/store-export-isolation.test.ts": "private-postgres",
  "tests/store-export-raw.test.ts": "private-postgres",
  "tests/store-export-referee.test.ts": "private-postgres",
  "tests/store-glossary-delete-pg.test.ts": "private-postgres",
  "tests/store-job-draft.test.ts": "private-postgres",
  "tests/store-jobs-parity.test.ts": "private-postgres",
  "tests/store-lookups-pg.test.ts": "private-postgres",
  "tests/store-parity-referee.test.ts": "private-postgres",
  "tests/store-parity.test.ts": "private-postgres",
  "tests/store-pg-referee-claims.test.ts": "private-postgres",
  "tests/store-pg-session.test.ts": "private-postgres",
  "tests/store-publish-guards.test.ts": "private-postgres",
  "tests/store-raw-source-race.test.ts": "private-postgres",
  "tests/store-reader-parity.test.ts": "private-postgres",
  "tests/store-realtime-sessions.test.ts": "private-postgres",
  "tests/store-revision-policy.test.ts": "private-postgres",
  "tests/store-roundtrip.test.ts": "private-postgres",
  "tests/store-searches-pg.test.ts": "private-postgres",
  "tests/store-session-isolation.test.ts": "private-postgres",
  "tests/store-shelf-pg.test.ts": "private-postgres",
  "tests/store-shelf-reads.test.ts": "private-postgres",
  "tests/store-slug-guard.test.ts": "private-postgres",
  "tests/store-step-fence.test.ts": "private-postgres",
  "tests/store-transaction-isolation.test.ts": "private-postgres",
  "tests/store-uploads-parity.test.ts": "private-postgres",
  /* Converted in the hinge, 2026-09-05. It wraps whichever store `routes.ts`
     hands things to and asserts the call; that was the filesystem one because
     the flag was unset, and it is `pgChatStore`/`pgSearchStore` now. */
  "tests/store-wiring.test.ts": "private-postgres",
  "tests/store-writes-land-in-postgres.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04. It seeds one corpus article under a
     throwaway slug with an extra glossary entry the text never matches, and
     then asks `lookUpTerm` — built by `src/store/index.ts` out of whichever
     adapters are live — for four refusals. No GoTrue and no model; the private
     clone is what keeps a neighbour's article out of the two cases whose
     subject is a slug that resolves to nothing. */
  "tests/term-lookup.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and the lane follows from the one thing
     the file needs to be true: a conversation that really exists. That is now
     an `articles` row, its published revision and a `chat_threads` row hanging
     off both, seeded by `scratchArticleInPg` under a throwaway slug. No Auth
     service, no Storage — the article comes out of the committed corpus and no
     model is called — so the private clone is enough, and it is what stops two
     concurrent runs seeing each other's single thread in a `load()` this file
     asserts the length of. */
  "tests/the-query-string-does-not-decide-the-route.test.ts": "private-postgres",
  /* Converted in stage B, 2026-09-04, and the lane follows from `spideryarn.
     uploads` rather than from the bucket: this file mints records and never
     issues a real grant — the issuer is a stand-in and no bytes are PUT — so
     `SUPABASE_URL` could stay poisoned for all it cares. What it does need is a
     database nobody else is minting into, because *exactly one of two
     simultaneous claimers wins* is a conditional `UPDATE` whose `rowCount` a
     peer's sweep could change, and the owner row it writes under goes into the
     `auth.users` of whichever database it lands in. */
  "tests/upload-records.test.ts": "private-postgres",
  /* Storage, not Postgres — see `an-upload-is-queued-…` above. */
  "tests/upload-acquire.test.ts": "private-postgres",
  "tests/an-uploaded-html-file-becomes-an-article.test.ts": "private-postgres",
  "tests/uploads-api.test.ts": "private-postgres",
};

/**
 * **Lanes the scan could not have worked out, and how each was found.**
 *
 * `TEST_LANES` is otherwise exactly the set of files the static scan finds, and
 * the guard checks that in **both** directions — an entry the scan does not see
 * is normally a rename or a deletion, and going red about it is the point.
 *
 * These are the exception, and they exist because the scan is syntactic and the
 * poison is not. A file here reaches Postgres through application code —
 * `getDb()` three modules down — with none of the syntax `opensAConnection`
 * looks for, so nothing but *running it* can find it. What runs it is stage
 * T-D's unit project, which poisons `DATABASE_URL`: an escapee that used to
 * borrow the shared database silently now fails, names itself, and is moved
 * here.
 *
 * **The guard covers the exemptions too**, or this would be a hole rather than
 * a door: every entry must name a file that exists, must have a lane in
 * `TEST_LANES`, must still be invisible to the scan — an entry that becomes
 * visible is a stale exemption and has to go — and must carry a reason long
 * enough to be one.
 *
 * Keep it short. A long list here means the scan has stopped being a useful
 * approximation, and the answer then is a better predicate, not more entries.
 */
export const LANES_BEYOND_THE_SCAN: Readonly<Record<string, string>> = {
  /* ---- Storage, which no DATABASE_URL poison could ever have found ------ */

  "tests/an-upload-is-queued-only-once-its-bytes-arrive.test.ts":
    "Reaches Supabase Storage, not Postgres, so no DATABASE_URL poison could ever " +
    "have found it: it PUTs a staging object with blobStore() and has POST /api/jobs " +
    "HEAD it back. Found by GPT Sol reading the lane map against src/store/blobs.ts, " +
    "2026-09-04, and confirmed by running it. Its own header already said so - `the " +
    "blob store here is the Supabase one, against the local stack`.",
  "tests/raw-source-store.test.ts":
    "Reaches Supabase Storage, not Postgres. The dangerous one of the four: it " +
    "removes and re-plants ONE deterministic canonical key with deliberately corrupt " +
    "bytes, so two concurrent runs on this box can destroy each other's oracle. GPT " +
    "Sol, 2026-09-04. Serialising it inside a run is what this lane buys; two " +
    "separate `npm test` invocations still share the bucket - see " +
    "docs/project/testing.md.",
  "tests/uploads-api.test.ts":
    "Reaches Supabase Storage, not Postgres. It writes staging objects through " +
    "blobStore() so that the readiness gate has something to find, and removes them " +
    "afterwards. GPT Sol, 2026-09-04.",

  /* ---- and the two the poison found the moment it covered Storage ------- */

  "tests/acquire-extract-blocks-end-to-end.test.ts":
    "Reaches Supabase Storage transitively, through the pipeline's own acquire step - " +
    "it names no store at all, which is why neither the scan nor a reading of the lane " +
    "map found it. The Storage poison did, on its first full run, 2026-09-04: five " +
    "failures, `TypeError: fetch failed / connect ECONNREFUSED 127.0.0.1:2`.",
  "tests/job-failure.test.ts":
    "Reaches Supabase Storage through storeRawSource(), planting a damaged source " +
    "document so the pipeline can refuse it. Found the same way and on the same run as " +
    "acquire-extract-blocks-end-to-end.test.ts, 2026-09-04 - three failures.",
};

/**
 * **Every fixed owner uuid a Postgres-touching suite names, and what it does
 * about the `auth.users` row behind it** — one entry per *(file, owner)* pair.
 *
 * ## Why pairs and not files, which is the whole of GPT Sol's blocking finding
 *
 * The first version of this was keyed by file, and treated a `seedAuthUser(`
 * call anywhere in a file as covering **every** owner in it. Sol found the
 * witness already in the tree: `tests/store-jobs-parity.test.ts` declares
 * `STRANGER` and seeds only `OWNER` and `OWNER_B`. It is safe today because
 * `STRANGER` is never written under — and **the file-keyed guard would have
 * stayed green on the day that stopped being true**, which is this repo's
 * chronic failure shape. The pairs number a couple of dozen across a couple of
 * dozen files — small enough to audit per owner, so it is audited per owner.
 * **No total is written here on purpose.** Four counts in this plan drifted
 * within one day, and the entries below are the list; a number beside them is
 * a second claim that can be wrong on its own
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § Counts are perishable here).
 *
 * ## Keyed by uuid, and the reason names the constant
 *
 * The uuid is the identity the foreign key cares about; the constant's name is
 * what a reader recognises. So the key is the uuid — a changed one goes stale
 * and the guard says so — and the reason says `OUTSIDER` or `STRANGER` out
 * loud. Lower-case, because Postgres compares `uuid` by value and two spellings
 * of one owner would otherwise read as two owners.
 *
 * ## The two verdicts
 *
 * `seeded` — the file puts a row in `auth.users` for this owner. **Mostly
 * checked rather than promised**: the scan resolves the arguments of every
 * `seedAuthUser`/`seedLocalAccounts` call, and where it can see the owner
 * there, no `why` is required. Where it *cannot* — `tests/feedback-store.test.ts`
 * seeds through a local `seedOwner()` wrapper, one level of indirection past
 * anything a regex should chase — a `why` is required and the guard enforces
 * that. A `seeded` verdict in a file with no seed call at all is refused
 * outright.
 *
 * `no-row-needed` — a foreign key is checked on **write**, and this owner is
 * never on the writing side of one. Always with a reason, because the reason is
 * the part that can go out of date: it has to say what the owner is used for
 * *and* what would change if that stopped being true.
 *
 * ## What this cannot do, said plainly
 *
 * It cannot tell you the verdict is *still* true. Nothing statically observable
 * changes when a suite starts writing rows under its outsider — the scan sees
 * the same uuid on the same line. What catches that is running the suite
 * against a private database, which is what stage T-C did and what T-D makes
 * routine. This map's job is narrower and worth having on its own: **a new
 * owner cannot arrive unnoticed.**
 */
export type OwnerVerdict =
  | {
      readonly kind: "seeded";
      /** Required only when the scan cannot see the seed call's argument. */
      readonly why?: string;
    }
  | { readonly kind: "no-row-needed"; readonly why: string };

/** Keyed by repository-relative path, then by lower-case owner uuid. */
export const OWNER_AUDIT: Readonly<Record<string, Readonly<Record<string, OwnerVerdict>>>> = {
  /* ---- seeded, and the scan can see it -------------------------------- */

  /* Laned on 2026-09-04, and this guard asked for its verdict the moment it
     was — which is the two maps composing rather than overlapping: giving a
     file a lane puts it in this one's universe too, so a file cannot arrive
     with a database and no account of the rows it writes under a fixed owner.
     It seeds `…dd` itself through `seedAuthUser`. */
  "tests/a-long-pdf-is-refused-before-it-is-stored.test.ts": {
    "00000000-0000-4000-8000-0000000000dd": { kind: "seeded" },
  },
  "tests/admin-feedback-store.test.ts": {
    "00000000-0000-4000-8000-00000000fc01": { kind: "seeded" },
    "00000000-0000-4000-8000-00000000fc02": { kind: "seeded" },
  },
  "tests/ai-calls-spend-pg.test.ts": {
    "00000000-0000-4000-8000-00000000ad01": { kind: "seeded" },
    "00000000-0000-4000-8000-00000000ad02": { kind: "seeded" },
  },
  /* Two owners, both written under: `rate_limit_events.owner_id` really does
     reference `auth.users(id)` (drizzle/20260905172650), so a made-up uuid can
     spend no allowance at all — and the "not somebody else's allowance" case
     needs a *second* reader who can actually write. `seedAuthUser` at module
     scope, `onConflictDoNothing`. 2026-09-05. */
  "tests/fetch-allowance.test.ts": {
    "00000000-0000-4000-8000-00000000fd01": { kind: "seeded" },
    "00000000-0000-4000-8000-00000000fd02": { kind: "seeded" },
  },
  /* One extra owner beside `TEST_OWNER`, and the case it exists for is the
     sharpest in the file: an article belonging to somebody else must be a 404
     rather than a fetch. Seeding a *real* second reader is what puts that in
     front of the Postgres owner filter instead of in front of a slug that
     simply does not exist. `seedAuthUser` in `beforeAll`. 2026-09-05. */
  "tests/link-preview-route.test.ts": {
    "00000000-0000-4000-8000-00000000fe01": { kind: "seeded" },
  },
  /* Arrived in the hinge, 2026-09-05, and the guard asked for it the moment it
     did. `mintUpload` wrote to the filesystem store while `SPIDERYARN_STORE` was
     unset — a directory has no foreign keys, so this uuid needed no row behind
     it. It writes through `pgUploadStore` now and `uploads_owner_fk` refuses
     without one; `seedAuthUser` in `beforeAll`, deleted again in `afterAll`. */
  "tests/upload-acquire.test.ts": {
    "33333333-3333-4333-8333-333333333333": { kind: "seeded" },
  },
  /* The HTML sibling of the file above, and its own uuid for the same reason:
     tests/fixture-ids.test.ts refuses two files sharing one, and vitest runs
     both against one database. `seedAuthUser` in `beforeAll`, deleted in
     `afterAll`, because `uploads_owner_fk` refuses a row without it. */
  "tests/an-uploaded-html-file-becomes-an-article.test.ts": {
    "33333333-3333-4333-8333-333333333344": { kind: "seeded" },
  },
  /* Stage 3b's own reader. `seedAuthUser` in `beforeAll`, and every row it
     writes — the billing account, the ingest events — hangs off the
     `auth.users` foreign key, so there is nothing here that would work without
     the row. */
  "tests/billing-quota-adjustment.test.ts": {
    "0b1113b0-0000-4000-8000-00000000e3b0": { kind: "seeded" },
  },
  /* Stage 5's reader. `seedAuthUser` in `beforeEach`, and every row it writes —
     the articles, the billing account, the ingest events — hangs off the
     `auth.users` foreign key. */
  "tests/billing-half-units.test.ts": {
    "0b110a1f-0000-4000-8000-0000000000a1": { kind: "seeded" },
  },
  "tests/billing-quota-race.test.ts": {
    "0b111a99-0000-4000-8000-00000000c0da": { kind: "seeded" },
  },
  "tests/db-referee-criteria.test.ts": {
    "7ac042a4-7c19-44a6-ab6d-448acc5909b8": { kind: "seeded" },
  },
  "tests/db-schema.test.ts": {
    "11111111-1111-1111-1111-111111111111": { kind: "seeded" },
    "22222222-2222-2222-2222-222222222222": { kind: "seeded" },
  },
  /* Arrived in stage G, 2026-09-05, when the file moved from a walk of 300
     temporary directories to 300 rows. Written under, heavily: it inserts 300
     articles and their revisions, and the owner is its own rather than the
     ambient one precisely so that a peer's fixture article cannot join the shelf
     it counts. `seedAuthUser` in `beforeAll`; every row deleted again in
     `afterAll`. */
  "tests/library-log-volume.test.ts": {
    "00000000-0000-4000-8000-00000000106f": { kind: "seeded" },
  },
  /* Both arrived with the stage B conversion, 2026-09-04, and both are written
     under: each of them owns abandoned jobs, and the file's sharpest case is
     Bob's page load *not* settling Alice's. On the filesystem queue this pair
     was explicitly declared never to become `auth.users` rows; that sentence is
     what the conversion falsified. */
  "tests/list-reconciles-expired.test.ts": {
    "00000000-0000-4000-8000-00000000c3a1": { kind: "seeded" },
    "00000000-0000-4000-8000-00000000c3a2": { kind: "seeded" },
  },
  /* Both arrived with the stage B conversion, 2026-09-04, and both are written
     under: `enqueue` inserts Alice's job row and every refusal below is Bob
     being told `null` by a `where owner_id = $1`. On the filesystem queue
     neither needed a row at all, which is the change this pair records. */
  "tests/owner-jobs.test.ts": {
    "00000000-0000-4000-8000-0000000000a7": { kind: "seeded" },
    "00000000-0000-4000-8000-0000000000a8": { kind: "seeded" },
  },
  "tests/referee-criteria-store.test.ts": {
    "3f0a17c6-9d54-4b8e-9a2f-5c1b7e0d4a63": { kind: "seeded" },
  },
  "tests/store-reader-parity.test.ts": {
    "00000000-0000-4000-8000-000000005e11": { kind: "seeded" },
  },
  "tests/store-realtime-sessions.test.ts": {
    "00000000-0000-4000-8000-00000000ac0f": { kind: "seeded" },
    "00000000-0000-4000-8000-00000000ac2f": { kind: "seeded" },
  },

  /* ---- seeded, one level of indirection past the scan ------------------ */

  "tests/feedback-store.test.ts": {
    "00000000-0000-4000-8000-00000000fb01": {
      kind: "seeded",
      why:
        "`ALICE`, seeded in `beforeAll` through the file's own `seedOwner(id, email)` wrapper, " +
        "which is what calls `seedAuthUser`. The scan resolves a seed call's arguments and one " +
        "enclosing `for (… of […])`, and stops there rather than following a local function — so " +
        "this pair is declared rather than observed, and the declaration is the evidence.",
    },
    "00000000-0000-4000-8000-00000000fb02": {
      kind: "seeded",
      why:
        "`BOB`, the second owner, through the same `seedOwner` wrapper. Two owners because the " +
        "file's subject is that one reader's feedback is invisible to the other, and both sides " +
        "of that have to hold real rows for the reads to mean anything.",
    },
  },

  /* ---- no row needed, and why -------------------------------------------- */

  "tests/billing-tiers.test.ts": {
    "b1111111-0000-4000-8000-000000000001": {
      kind: "no-row-needed",
      why:
        "the owner id handed to `standingFor` and `tiersToOffer`, both pure — this file builds " +
        "billing rows and tier rows as plain objects and asserts what they are offered. Nothing " +
        "here opens a database, so the id is never on the writing side of the auth.users key. " +
        "If this file ever gains a Postgres lane, the same owner starts being written under and " +
        "this verdict has to become `seeded`.",
    },
  },

  "tests/export-route.test.ts": {
    "0e5c0001-0000-4000-8000-0000000000b9": {
      kind: "no-row-needed",
      why:
        "`OUTSIDER` is only ever the `sub` of a request, so the export must 404 for somebody who " +
        "does not own the article; nothing is written under it. **And the 404 is not the only " +
        "evidence** — the same suite runs the owner through the same path for a 200, and removing " +
        "the ownership predicate was observed to answer 200 for the outsider too. So seeding a " +
        "row would neither strengthen nor weaken the claim. It becomes wrong the moment the file " +
        "inserts anything owned by `OUTSIDER`.",
    },
  },
  "tests/find-article.test.ts": {
    "75dcc8e4-56a0-4f74-88e4-f92d1431abb8": {
      kind: "no-row-needed",
      why:
        "`OUTSIDER` reaches Postgres only through `setRequestOwner`, to show `ownedSlug` filters " +
        "on the owner and not on the slug. Every insert in the file belongs to " +
        "`currentOwnerId()`, which the private lane provides.",
    },
  },
  "tests/asset-route.test.ts": {
    "0e5c0001-0000-4000-8000-0000000000a5": {
      kind: "no-row-needed",
      why:
        "`OUTSIDER` is a request `sub` and nothing else — the asset route must not serve another " +
        "reader's picture. The same shape as `illustrated-route`'s below, for the same reason: a " +
        "`where` clause needs no row.",
    },
  },
  "tests/illustrated-route.test.ts": {
    "0e5c0001-0000-4000-8000-0000000000c7": {
      kind: "no-row-needed",
      why:
        "`OUTSIDER` is a request `sub` and nothing else — the illustrated route must not serve " +
        "another reader's article. Its own comment says it is the same shape as `export-route`'s, " +
        "and it is: a `where` clause needs no row.",
    },
  },
  "tests/owner-isolation.test.ts": {
    "00000000-0000-4000-8000-0000000000a1": {
      kind: "no-row-needed",
      why:
        "**`ALICE` is a request-context identity, not the owner of anything persisted.** The file " +
        "has two separate jobs and this pair belongs to the first: that the `AsyncLocalStorage` " +
        "box hands back whoever the request set, nests correctly, and throws outside a scope. Its " +
        "persisted fixture is owned by the ambient owner, which the lane provides.",
    },
    "00000000-0000-4000-8000-0000000000b2": {
      kind: "no-row-needed",
      why:
        "`BOB`, the other half of the request-context pair above — used to prove the box changes " +
        "answer between two nested scopes and back again. Nothing is stored under it.",
    },
    "00000000-0000-4000-8000-0000000000b1": {
      kind: "no-row-needed",
      why:
        "`OUTSIDER` is the reader whose queries must find nothing: the file's second job is that " +
        "every path from a slug to an article carries an owner predicate. Reads only, so no " +
        "foreign key is reached.",
    },
  },
  "tests/pipeline-slug-claim.test.ts": {
    "00000000-0000-4000-8000-0000000000b3": {
      kind: "no-row-needed",
      why:
        "`OUTSIDER` is a request owner used to show that claiming a slug somebody else owns is " +
        "refused **before** any write happens. The refusal is the assertion, so there is nothing " +
        "under the foreign key to seed.",
    },
  },
  "tests/public-visibility-pg.test.ts": {
    "00000000-0000-4000-8000-0000000000ec": {
      kind: "no-row-needed",
      why:
        "**Not read-only, and the first version of this reason said it was.** `OUTSIDER` is the " +
        "`as:` of a `PUT /api/article/:slug/visibility` that must answer 404 rather than 403. " +
        "What makes it safe is not that it never writes but that the `UPDATE` carries " +
        "`owner_id = OUTSIDER` in its `WHERE`: it matches no row, writes nothing, and never puts " +
        "the id in a column. An `INSERT` under it would need a real row.",
    },
  },
  "tests/source-store.test.ts": {
    "00000000-0000-4000-8000-0000000000c8": {
      kind: "no-row-needed",
      why:
        "`OUTSIDER` appears once, inside a `setRequestOwner` around a read that must not find the " +
        "source. The store never writes a row owned by it.",
    },
  },
  "tests/store-ai-calls.test.ts": {
    "00000000-0000-4000-8000-00000000ac01": {
      kind: "no-row-needed",
      why:
        "**A false positive the scan cannot avoid, which is why it is declared here rather than " +
        "excused in a regex.** The literal on the `ownerId:` line is `row()`'s default, and " +
        "`row()` is shared by the file's two halves: the filesystem-ledger half writes it to a " +
        "JSONL file with no foreign key anywhere, and the Postgres half overrides it with " +
        "`currentOwnerId()` on every fixture. `ai_calls_owner_id_users_id_fk` is real, so the " +
        "constraint exists — nothing reaches it with this id.",
    },
  },
  "tests/store-jobs-parity.test.ts": {
    "00000000-0000-4000-8000-0000000000b5": {
      kind: "no-row-needed",
      why:
        "**The pair that made this map pair-keyed.** `STRANGER` is read-only: it is handed to " +
        "`claim` and to the owner-scoped reads to show that a job belonging to somebody else is " +
        "neither claimable nor visible, and every row the file writes belongs to `OWNER` or " +
        "`OWNER_B`, which it seeds per run. The file-keyed version of this guard called the whole " +
        "file covered because those two are seeded, and would have gone on saying so if " +
        "`STRANGER` started owning a row. If it ever does, this entry becomes `seeded` and the " +
        "seed goes in beside the other two.",
    },
  },
  "tests/store-pg-referee-claims.test.ts": {
    "00000000-0000-4000-8000-0000000000f4": {
      kind: "no-row-needed",
      why:
        "`OUTSIDER` is a request owner for the one case that asks whether a claim is visible to " +
        "somebody who did not make it. The claims themselves are written under " +
        "`currentOwnerId()`.",
    },
  },
  "tests/store-uploads-parity.test.ts": {
    "00000000-0000-4000-8000-00000000d107": {
      kind: "no-row-needed",
      why:
        "`STRANGER` is passed to `read` and to `claim({ owner })`, both of which must answer as " +
        "though the upload did not exist. `claim` is an `UPDATE` and therefore a write, but " +
        "`eq(uploads.ownerId, options.owner)` is in its `WHERE` — no row matches, nothing is " +
        "written, and the id never lands in a column.",
    },
  },
  /* Both arrived with the stage B conversion, 2026-09-04, and the pair is here
     rather than split across the sections above because this map is keyed by
     file: one entry, two verdicts, which is the shape Sol's blocking finding
     asked for. */
  "tests/upload-records.test.ts": {
    "11111111-1111-4111-8111-111111111111": { kind: "seeded" },
    "22222222-2222-4222-8222-222222222222": {
      kind: "no-row-needed",
      why:
        "`SOMEBODY_ELSE` is only ever asked *as*, never written under: `readUpload(id, him)` must " +
        "answer null and `claimUpload(id, { owner: him })` must answer `unknown`. `claim` is an " +
        "`UPDATE` and so a write, but the owner is in its `WHERE` — the same argument " +
        "`store-uploads-parity`'s `STRANGER` carries above, and the same thing that makes it " +
        "wrong the moment this file mints an upload of his.",
    },
  },
};

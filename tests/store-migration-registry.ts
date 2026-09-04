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
 * - **`ledger-redirect`** — `selected()` in [`src/store/ai-calls.ts`](../src/store/ai-calls.ts)
 *   returns `fsCostStore` whenever `NODE_ENV === "test"`, whatever the flag
 *   says. Any suite that drives a request through `handleApi` therefore writes
 *   ledger rows to a file. Stage C collapses that to `export const costStore =
 *   guardedLedger`.
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
 * - **`shared-symbol`** — [`src/store/pg-chat.ts`](../src/store/pg-chat.ts)
 *   imports `requireTail` and `CHAT_SWEPT` from `src/store/fs.ts`. A surviving
 *   Postgres adapter depends on a condemned module; those two symbols have to
 *   move house before `fs.ts` can go, and that move resolves the reach.
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
 * All but one are files that **did not exist when the witness ran**, at
 * 2026-09-03T09:19Z, and arrived over the following day; re-running witness 2
 * is what upgrades them, and the list grows whenever a suite lands between two
 * runs. The exception is
 * `tests/slug.test.ts`, which is here on the grep's authority: it
 * reads a condemned file's *source text*, which is invisible to an import walk
 * and executes nothing, so both witnesses are structurally blind to it and only
 * a human verdict covers it.
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
      "The Postgres artefact store's own suite, which borrows `PATHS` from the filesystem adapter " +
      "so that the two agree about what an artefact of each kind is called. A constant, read and " +
      "never called. The names have to move somewhere neutral before `artifacts-fs.ts` goes, and " +
      "then this file is Postgres-only — the same move `pg-chat.ts`'s two symbols need.",
  },

  "tests/a-claim-that-lost-its-draft.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "step-context-paths", "condemned-symbol-import"],
    reason:
      "Pins `JobDraftGone` — a claimant whose draft is deleted mid-step must end the job rather " +
      "than log `lost the claim`. It already pins the flag to postgres and takes the run lock; " +
      "every filesystem touch is the ledger the redirect hands it plus the `dir` string `runStep` " +
      "computes before calling the step. **But it imports `DATA_ROOT_ENV` from `data-root.ts` to " +
      "point itself at a scratch root, so stage G has to touch it** — the store use is incidental, " +
      "the import is not.",
  },
  "tests/acquire-extract-blocks-end-to-end.test.ts": {
    category: "store-agnostic-fake",
    reason:
      "Asks whether stages 1, 2 and 3 *join* — that the manifest stage 1 returns is the one stage " +
      "2 resolves. It runs `fsArtifacts` under a scratch `SPIDERYARN_DATA_ROOT` purely because a " +
      "store is needed for `previousBlocksFrom` and `assertIdsCarried`; nothing in the claim is " +
      "about where the artefacts landed.",
  },
  "tests/all-skipped-publication-log.test.ts": {
    category: "database-integration",
    reason:
      "The coordinator must not put a Drizzle error's bound parameters — a job's steps array and " +
      "the article's title — into a log line. Its own header says `no database at all, " +
      "deliberately`, so the whole fixture is the real `fsJobStore` and `fsStoreSession`; the rule " +
      "is the coordinator's and survives, but the only store that can carry it will be Postgres.",
  },
  "tests/all-skipped-publication-refusal.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "step-context-paths"],
    reason:
      "An all-skipped claim whose publication is refused must end the job rather than hang it. " +
      "Runs against Postgres by hoisted flag with a real draft and a real lineage conflict; the " +
      "four filesystem sites are the test ledger and `contextPaths`, neither of which it asked for.",
  },
  "tests/api.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "Its subject is `candidateDirs` — the rule that `data/<slug>/` answers a slug and `example/` " +
      "answers only its own. That rule exists solely because the filesystem reader has two places " +
      "to look, and `src/api.ts` is what `fsArticleReader` is made of, so the describe block dies " +
      "with the adapter it protects.",
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
    category: "store-agnostic-fake",
    reason:
      "Counts notes, supplement blocks and markers across the committed corpus after a real " +
      "`runExtract` and `splitIntoBlocks`. It needs somewhere to put the blocks so the projection " +
      "can be read back, and a temp-directory artefact store is the cheapest somewhere; the three " +
      "fields it is about are carried by the DTO, not by the store.",
  },
  "tests/blocks-baseline.test.ts": {
    category: "store-agnostic-fake",
    reason:
      "Stage 3 must get the previous run's blocks from a store rather than from a path, and must " +
      "tell absent from unreadable. It runs the same five mutations against both stores; the " +
      "filesystem arm is a constructed store handed straight to `previousBlocksFrom`, so a narrow " +
      "fake substitutes for it without touching the claim.",
  },
  "tests/candidates-route.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "fixture-loader"],
    reason:
      "Already converted: it pins `postgres` before any import specifically so the " +
      "`chat_threads_kind` CHECK is in play, and seeds through `scratchArticleInPg`. Its three " +
      "filesystem sites are the seeder's copy step and one ledger row from the stubbed model call.",
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
    category: "database-integration",
    reason:
      "The live ticket must hand back the history and the id of the current tail **from one read**, " +
      "and must not seed a voice model with block ids. It copies `example/` into `data/<slug>/` " +
      "for the article and reads the conversation back through the filesystem chat store; both " +
      "halves need a Postgres fixture instead.",
  },
  "tests/chat-live-turn.test.ts": {
    category: "database-integration",
    reason:
      "What a second tab does to a live stream — a stale retry must not abort the answer and then " +
      "409, and a stop naming a replaced answer must not kill the replacement. Everything under " +
      "test is in `src/routes.ts`; the `cp(example/ → data/)` fixture and `loadThreads` read-back " +
      "are the only filesystem parts.",
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
    category: "database-integration",
    reason:
      "The one write path whose contents a browser dictates: which claims in a spoken exchange the " +
      "route believes, which it replaces, and the 409 that is the endpoint's whole idempotency. " +
      "Reads back through `loadThreads` off a copied `example/`, so the fixture and the read-back " +
      "both move.",
  },
  "tests/claim-session-files.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "Exists to say that with the flag unset none of Postgres happens — it removes `DATABASE_URL` " +
      "so any Postgres call would throw loudly. Its subject is the `if (STORE !== \"postgres\")` " +
      "line in `claimSession` that the hinge deletes, so it goes in the same commit as that line " +
      "and not before.",
  },
  "tests/claim-session-postgres.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["ledger-redirect", "step-context-paths", "condemned-symbol-import"],
    reason:
      "The flip's acceptance test: `claimSession` picks the Postgres session and a job published " +
      "through it reaches the shelf. It gives every claim its own empty scratch root and asserts " +
      "the roots are **still empty** afterwards — so its filesystem contact is an assertion that " +
      "nothing was written there, which is the opposite of a dependency. **Those assertions are " +
      "load-bearing and it imports `DATA_ROOT_ENV` to make them**, so stage G must re-express them " +
      "rather than delete them: with no filesystem store there is no root to prove empty, and the " +
      "claim quietly stops being tested.",
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
  "tests/cost-store-under-test.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "Its single assertion is that `selected()` hands back the **filesystem** ledger under the " +
      "test harness whatever the flag says. That is the redirect stage C deletes, so this file " +
      "dies with stage C rather than with stage G — it is the one adapter test on a different " +
      "clock from the rest, and the plan already names its replacement.",
  },
  "tests/data-root.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "`chooseDataRoot`, `findRepoRoot` and the deliberate throw when a deployment has no job in " +
      "scope. `src/store/data-root.ts` is itself on the condemned list, so this is the adapter " +
      "test for a module rather than for a store object — and its `/var` and warm-`/tmp` arguments " +
      "have nowhere to go once no path is computed at all.",
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
      "`previousGlossaryFrom`; the Postgres arm already carries the same cases.",
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
  "tests/illustrated-step-registration.test.ts": {
    category: "store-agnostic-fake",
    reason:
      "Asks the `illustrated` step's registration as effects: that its fingerprint is the Sketch " +
      "rather than the article, and that it refuses rather than illustrating a stale scene. It " +
      "writes the product through a temp-directory store only so `stampFor` has something to " +
      "answer from.",
  },
  "tests/job-failure.test.ts": {
    category: "store-agnostic-fake",
    reason:
      "Which ingest failures are worth another go — and most cases throw the failure for real " +
      "rather than recognising a sentence. The store is a temp directory the real stage is pointed " +
      "at so it can get far enough to fail; `failureKindOf` never asks where anything was written.",
  },
  "tests/jobs-commit-path.test.ts": {
    category: "database-integration",
    reason:
      "Pins the path as well as the result: it wraps the session the runner actually builds, so a " +
      "runner that went round `commit` fails here rather than passing quietly. The real `blocks` " +
      "stage, the real `fsJobStore` and a real artefact write are all fixture — the claim is about " +
      "`session.commit`, which is where the transaction lives under Postgres.",
  },
  "tests/jobs-fs-load.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "The two behaviours that live only in `data/_jobs/`'s cold-start reader: stamping an " +
      "ownerless record with this installation's owner, and bringing a job's enqueue ticket back " +
      "with it. Both are properties of a directory being read at process start, which Postgres " +
      "does not have and does not need.",
  },
  "tests/jobs-walk.test.ts": {
    category: "database-integration",
    reason:
      "*Claim once, keep the same attempt while walking, release only on handoff or terminal " +
      "settlement* — five mutations to `advanceJobWith`, each watched red. It fakes the artefact " +
      "store and keeps the job store **real**, because every claim about a claim is a claim about " +
      "the store; that real store has to become `pgJobStore`.",
  },
  "tests/jobs.test.ts": {
    category: "database-integration",
    reason:
      "The queue's arithmetic — ordering, forcing, `sameWork`, `freeSlug` — plus the write path " +
      "around the one bug that ever took a running server down. Twenty-six filesystem sites across " +
      "three adapters, and it is the largest single conversion in the whole inventory.",
  },
  "tests/late-step-on-a-cold-instance.test.ts": {
    category: "store-agnostic-fake",
    reason:
      "The 2026-08-30 production failure written down: a single-step job on a deployed instance " +
      "has an empty scratch directory, so a late step must read the article from the store and not " +
      "from `ctx.dir`. The store is given the article and `ctx.dir` deliberately is not — which is " +
      "precisely the shape a narrow `ArtifactReads` fake wants.",
  },
  "tests/list-reconciles-expired.test.ts": {
    category: "database-integration",
    reason:
      "`listJobs` must settle expired leases in the same call it answers from, scoped to the reader " +
      "who asked, and cost nothing when no job is running — the reader who closed the tab is the " +
      "one `/advance` can never reach. It leaves the flag unset so it cannot skip itself green, " +
      "which is the property the conversion has to preserve some other way.",
  },
  "tests/live-session-routes.test.ts": {
    category: "database-integration",
    reason:
      "The order at the ticket — OpenAI mints, we journal, and only then does the token go out — " +
      "plus owner-scoped lookup and a retried report that must not become a second row. It " +
      "redirects both the realtime journal and the ledger into a temp directory by env var, so it " +
      "needs a Postgres journal and a real owner row instead.",
  },
  "tests/load-article-serialisation.test.ts": {
    category: "database-integration",
    reason:
      "Asks **Postgres** whether the loader's `serialise` flag reaches the lock, by holding the key " +
      "on a connection of its own and seeing which load waits — and must not take the run lock " +
      "itself, or both arms pass with the lock doing nothing. Like the loader's own suite it is " +
      "stage D's to edit, not collateral.",
  },
  "tests/metadata-visibility-fs.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "One assertion, and it is that the filesystem store leaves `sharing` **absent** rather than " +
      "guessing `private` — written down because `private` shipped for an hour with a reasoned " +
      "comment defending it. The whole statement is about a store with no `visibility` column, so " +
      "it goes when that store goes.",
  },
  "tests/one-article-for-one-address.test.ts": {
    category: "database-integration",
    reason:
      "The repair branch in `enqueue` after `jobs_active_source` refuses the second insert — it " +
      "re-runs the whole allocation rather than adopting the holder's slug, because the loser's " +
      "`reservesName` is stale the moment it is refused. It runs on files only so there is no " +
      "database to be unavailable; the branch is store-independent and the Postgres arbitration " +
      "already has a home.",
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
      "The declaration agrees with the paths, the paths round-trip the artefacts, and a truncated " +
      "file stops reporting itself finished — the bug where `stepIsDone` asked whether files " +
      "*exist*. Every claim is about `PATHS`, `pathFor` and `has()` parsing, which are the " +
      "filesystem adapter's own surface.",
  },
  "tests/pipeline-slug-claim-files.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "The `STORE !== \"postgres\"` halves of `articleExists` and `urlForSlug`, answering from " +
      "`data/<slug>/meta.json` under a scratch root. Two files rather than two describes because " +
      "`STORE` is a module-load constant — and the hinge deletes exactly the branch this one " +
      "guards.",
  },
  "tests/quiz-mark-route.test.ts": {
    category: "database-integration",
    reason:
      "A mark is bound to the batch the reader was shown: a stale `batchId` is a 409, a " +
      "source-stale quiz is checked first, an unknown `questionId` is a 404 and never a " +
      "fall-forward, and every refusal lands before a single SSE header. The article and the quiz " +
      "are a copied `example/` directory it rewrites in place, which is what has to move.",
  },
  "tests/quiz-step-registration.test.ts": {
    category: "store-agnostic-fake",
    reason:
      "The two registration bugs that write a perfectly good artefact and redden nothing — stamp " +
      "fields spelled with the in-memory names, and a `STAMP_SOURCE` row saying `null`. It runs " +
      "the real stage and then asks the store what stamp it recorded, so any store that records " +
      "stamps will do.",
  },
  "tests/referee-claims-omitted.test.ts": {
    category: "database-integration",
    reason:
      "`claimsOmitted` was computed by the validator, printed by the panel, and never carried " +
      "between the two. It exists as a separate file so the model mock does not cost " +
      "`referee-claims-routes.test.ts` its no-model guarantee; its fixture is a hand-written " +
      "`data/<slug>/blocks.json` that has to become a Postgres article.",
  },
  "tests/referee-claims-routes.test.ts": {
    category: "database-integration",
    reason:
      "Says *the claims routes are wired to the store and the guard runs before the stream opens* " +
      "— and this is the family whose absence let Claims ship filesystem-only and answer 501 in " +
      "production for a day. Converting it is the postmortem's own remedy, and its no-model " +
      "property has to survive the move.",
  },
  "tests/referee-criteria-routes.test.ts": {
    category: "database-integration",
    reason:
      "Four criteria routes, asserting that the validators are actually reached — a validator " +
      "nobody calls passes its own tests perfectly. Same `data/<slug>/` fixture and same 501 " +
      "exposure as its Claims sibling, and the same requirement that no case may open a stream.",
  },
  "tests/referee-criteria-store.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "Three things of different kinds: `withCriterion` as a pure decision, a **filesystem** round " +
      "trip with a negative valence in it, and parity against Postgres. The middle one is the " +
      "adapter's own, and the negative-valence journey it completes is only worth walking twice " +
      "while two adapters exist.",
  },
  "tests/referee-mirror-route.test.ts": {
    category: "database-integration",
    reason:
      "Makes Mirror reachable, and stubs global `fetch` because the earlier argument for costing " +
      "nothing rested on `OPENROUTER_API_KEY` being absent, which `.env.local` makes false. The " +
      "comments and criteria it reads are filesystem stores under a throwaway `data/` slug.",
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
      "The wire and nothing else: `src/injection-scan.ts` had 82 passing tests and no production " +
      "caller for a day, so this asks whether a real article reaches the scan and the payload " +
      "comes back. The article is a `data/<slug>/` fixture and `loadSource` is the filesystem " +
      "reader; both change, the coverage claim does not.",
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
  "tests/retry-is-only-for-a-failed-job.test.ts": {
    category: "database-integration",
    reason:
      "Retry spends money and the client had never been asked — a completed forced PDF refresh " +
      "could be re-retried indefinitely. Its last case reads the new job's force flags **out of " +
      "`data/_jobs/`**, which is deliberate (only that is what a later request sees) and is exactly " +
      "the assertion that has to be re-pointed at the jobs table.",
  },
  "tests/routes.test.ts": {
    category: "database-integration",
    reason:
      "The HTTP surface itself, and the broadest reach in the inventory: twenty-three sites across " +
      "the article reader, comments, searches, shelf, reader profile and library search. It copies " +
      "`example/` under a throwaway slug and asserts through `loadComments`, `loadShelf` and " +
      "`loadRuns`, so both the fixture and every read-back move together.",
  },
  "tests/second-job-queues.test.ts": {
    category: "database-integration",
    reason:
      "Greg's *always append to the per-article queue* — a second, different job on one article " +
      "answers 202 with a new id rather than the old `ARTICLE_IS_BUSY` 409. The status code and " +
      "body are the route's, so it must keep going through `handleApi`; what changes is that " +
      "`fsJobStore` and `forgetForTests` become the Postgres queue and a real cleanup.",
  },
  "tests/shelf.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "Archive, rename and open-counting against real files under `data/`, `because that is what " +
      "the code under test actually reads` — `src/shelf.ts` is what `fsShelfStore` is made of. " +
      "The one claim worth keeping is *a renamed title survives a re-extraction*, and Postgres " +
      "keeps it in a column rather than in an override file.",
  },
  "tests/source-store.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "Three sections, and only the middle one is condemned: a grep that the route reaches the " +
      "seam, the **filesystem** adapter doing what the route used to do under a scratch root, and " +
      "the Postgres adapter refusing a dangling reference rather than reporting the article " +
      "sourceless. Section 2 goes with the adapter; 1 and 3 stay.",
  },
  "tests/stage-stamp-agreement.test.ts": {
    category: "store-agnostic-fake",
    reason:
      "For every article-reading stage, the `sourceHash` written into the artefact must equal the " +
      "`inputHash` its `stamp` computes — nothing anywhere else compares the two definitions, and " +
      "a disagreement re-buys a model call on every job for ever. `no network, no directory reads " +
      "— the store is the only thing either side is given`, which is the fake's whole job " +
      "description.",
  },
  "tests/stage2c-raw-bytes.test.ts": {
    category: "store-agnostic-fake",
    reason:
      "Stage 1 hands stage 2 a content address, and every case names its own `fsBlobs(dir)` so " +
      "that *absent* is a fact about a directory the test made rather than about whatever " +
      "`.env.local` said. `fsBlobs` is out of scope for this migration; the `createFsArtifactStore` " +
      "beside it is the replaceable part.",
  },
  "tests/step-failure-seam.test.ts": {
    category: "database-integration",
    reason:
      "An error nobody wrote a reader sentence for must reach neither `step.error` nor `job.error` " +
      "— both fields, because the band and the card render different ones and a DOM test of either " +
      "would stay green. It reads the persisted values off the file the queue wrote rather than " +
      "off `getJob`, and that deliberate choice is what has to be re-founded on the jobs table.",
  },
  "tests/store-ai-calls.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "Both ledgers, and the assertion it exists for is that `credits_used_nanos` comes back a " +
      "`number` rather than the string `node-pg` hands back for `int8`. The `fsCostStore` half " +
      "goes with `ai-calls-fs.ts`; the Postgres half and `totalRows` are the survivors, and the " +
      "two SQL sums it holds against each other are worth keeping intact through the edit.",
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
      "A re-extraction must not take the reader's paid-for artefacts with it — free on a " +
      "directory, and the reason `beginRevision` copies the published revision into the draft. It " +
      "keeps a real `data/` directory alongside the Postgres article so both stores answer the " +
      "same question; that filesystem half is what the edit removes.",
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
  "tests/store-chat-tail-guard.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "`expectedTailId` has to be checked *with* the edit rather than before it, or a `begin` lands " +
      "in the gap and the edit deletes it. Its own header says `this file is the filesystem side` " +
      "and names where the Postgres side lives, so it is the adapter's copy of a two-copy claim.",
  },
  "tests/store-comments-parity.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "The two comment operations the placement parity walk does not cover: `create` refusing a " +
      "re-score under a stored id, and `beginAnswer` carrying the placement across a store that " +
      "**rebuilds the row field by field**. Both failures are the filesystem writer's shape, and " +
      "there is nothing left to compare once there is one store.",
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
    /* It landed on 2026-09-03, after the witness ran, so the verdict rests on
       the import graph and the file's own docstring until witness 2 is re-run. */
    evidence: "static-only",
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
      "The two job stores under one set of cases, and it is honest about the filesystem adapter " +
      "being one process — its single-running rule and attempt tokens are variables in memory. " +
      "The refusals are the valuable half and every one of them survives in the Postgres arm; the " +
      "parity framing does not.",
  },
  "tests/store-parity-referee.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "Written after Claims shipped with one adapter and returned 501 in production, to compare " +
      "the two stores step by step through every referee write. It is the parity file that would " +
      "have caught that, and parity is precisely the property that stops existing at the hinge.",
  },
  "tests/store-parity.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "*The test the whole migration rests on* — every read compared as the wire form the client " +
      "receives, with every revision deleted first so a carried column cannot fake a match. Its " +
      "filesystem arm is the reference the Postgres arm is checked against, and deleting it before " +
      "the adapter goes would remove the only cross-check on the very last conversions.",
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
      "The experimental switch across two genuinely different implementations — `coalesce(…, " +
      "now())` inside an upsert against a decision made in a write queue, with no shared code for " +
      "a test to lean on. It also creates its own `auth.users` row rather than writing the " +
      "development owner's profile, which is the habit the conversions should copy.",
  },
  "tests/store-reader-state-parity.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "Chat, searches and lookups compared as a **scripted sequence** rather than an end state, " +
      "with ids normalised to `#0`, `#1` by first appearance so an ordering bug shows up as a " +
      "renumbering. Both halves of every comparison are stores; one of them is going away.",
  },
  "tests/store-realtime-sessions.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "Three *a second write must not undo the first* rules — duplicate `issue`, earliest " +
      "`markConnected`, first `close` — held across both journals. Its Postgres half currently " +
      "always skips because `20260902150952_realtime_sessions_and_usage.sql` is unapplied " +
      "everywhere, so today it is a filesystem-only suite wearing a parity coat.",
  },
  "tests/store-roundtrip.test.ts": {
    category: "database-integration",
    reason:
      "`data/` → Postgres → `data/` with nothing lost, which is the rollback nobody has ever run. " +
      "Its export target is `src/store/export.ts`, which survives — what dies is the *source* " +
      "side, where the corpus is read in through a filesystem artefact store, and the comparison " +
      "needs a new left-hand side rather than a new claim.",
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
      "The claim race under two implementations with no shared code — `open(…, \"wx\")` atomic at " +
      "the kernel against a conditional `UPDATE` and `rowCount` — plus the `null`-versus-absent " +
      "shape that would serialise onto a wire whose client type forbids it. The shape assertion " +
      "belongs to the surviving adapter; the race comparison does not.",
  },
  "tests/store-wiring.test.ts": {
    category: "store-agnostic-fake",
    reason:
      "What `src/routes.ts` **hands** the store: the attempt token a Postgres `finish` refuses to " +
      "go without, and the sweep's `keep` set of bare row ids rather than composite keys. It " +
      "wraps the real filesystem store as a spy substrate and asserts the call, so the substrate " +
      "is interchangeable and the assertions are not.",
  },
  "tests/term-lookup.test.ts": {
    category: "database-integration",
    reason:
      "`lookUpTerm` is store-independent orchestration now, and most of this file drives it " +
      "through `src/store/index.js` — the wiring a route actually reaches — rather than a " +
      "hand-built one that could be right while the wiring is wrong. That wiring is what changes " +
      "store, and the four guards plus the citation filter come along unaltered.",
  },
  "tests/the-query-string-does-not-decide-the-route.test.ts": {
    category: "database-integration",
    reason:
      "A query string must not decide whether a route exists — `?summary=1` hid a shipped branch " +
      "for five days. The pair of cases needs a thread that **really exists**, which is the only " +
      "reason a store is involved at all, and it must come from `chatStore` either way.",
  },
  "tests/two-servers-one-queue.test.ts": {
    category: "filesystem-adapter-behaviour",
    reason:
      "Reproduces the eleven concurrent `hierarchy` runs of 2026-08-30 with `vi.resetModules()` " +
      "and two imports, because the filesystem fence is a variable in one module's memory and a " +
      "dev-server restart makes a second copy. Its own header says the Postgres adapter's absence " +
      "is the point — one `update … where status = 'queued'` cannot have this bug — so the file " +
      "is about a hazard the migration abolishes.",
  },
  "tests/tweets.test.ts": {
    category: "store-agnostic-fake",
    reason:
      "The deterministic half of stage 5c — character counting, numbering the model's array, " +
      "staleness against the blocks, and how many posts to ask for. The store appears only so " +
      "`stepIsDone` has a stamp to read; nothing here is a claim about storage.",
  },
  "tests/upload-acquire.test.ts": {
    category: "database-integration",
    reason:
      "The first place that has the bytes, so the checks are built to fail honestly: a magic-byte " +
      "refusal on a right-sized plausible file, and a checksum refusal on a **same-length** " +
      "substitution. It drives the real upload record lifecycle, which selects its adapter by " +
      "flag, so the whole harness lands on Postgres at the hinge.",
  },
  "tests/upload-records.test.ts": {
    category: "database-integration",
    reason:
      "One upload attempt's life — claiming exactly once so a double-click cannot buy two " +
      "transcriptions, an expired grant reading as expired without a rewrite, and a second refusal " +
      "staying silent. It writes into the real `data/_uploads/` and cleans up by id; `src/upload-" +
      "records.ts` picks its own adapter, so the flag's death moves this file without changing a " +
      "claim.",
  },
  "tests/uploads-api.test.ts": {
    category: "database-integration",
    reason:
      "*Never accept a client-supplied object path* — the assertions are about what a request may " +
      "**name**, not about status codes, since a 400 for the wrong reason still passes. Its " +
      "`minted` list exists because a previous version swept records another suite was about to " +
      "read, and that isolation problem gets sharper, not softer, on a shared database.",
  },

  /* ---- Static-only: the dynamic witness never saw these ------------------- */

  "tests/an-upload-is-queued-only-once-its-bytes-arrive.test.ts": {
    category: "database-integration",
    evidence: "static-only",
    reason:
      "Arrived after the witness ran. The readiness gate: `POST /api/jobs {uploadId}` must HEAD " +
      "the staging object before it claims anything, because the reader now reaches " +
      "`/add/upload/<id>` at byte zero and a reload of it used to queue a job over a file that " +
      "was not there — which `acquireUpload` refuses terminally. It drives the real route, the " +
      "real upload records and the real blob store, so it moves with `src/upload-records.ts` and " +
      "`src/store/blobs.ts` and needs neither changed.",
  },
  "tests/article-cache-call-site.test.ts": {
    category: "database-integration",
    evidence: "static-only",
    reason:
      "Arrived after the witness ran. Asks the only question that would have gone red on the " +
      "conditional-cache postmortem: run a two-mode job through the real walk and read the " +
      "`StepContext.cacheArticle` each step is actually handed. It hoists `delete " +
      "process.env.SPIDERYARN_STORE` and drives `fsJobStore`, `fsArtifacts` and `fsStoreSession`, " +
      "so it is the same conversion as `jobs-walk.test.ts` and inherits the same owner-row cost.",
  },
  "tests/glossary-delete-then-rebuild.test.ts": {
    category: "shared-mechanism-collateral",
    mechanisms: ["step-context-paths"],
    evidence: "static-only",
    reason:
      "Arrived after the witness ran, with the glossary-delete work off `dev`. It drives a real " +
      "claim, `openPgStoreSession`, `advanceJobWith` and a real publication, then reads back on " +
      "another connection — entirely Postgres, and its static reach into `artifacts-fs` is " +
      "`src/jobs.ts`, which is `runStep` computing paths. Re-run witness 2 to confirm.",
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
    evidence: "static-only",
    reason:
      "Arrived after the witness ran, with the page-cap move " +
      "(docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md § Stage 4). It drives the " +
      "real `fetch` step through both of its halves — real upload records, the real blob store, " +
      "`fsArtifacts` — to prove an over-long PDF is refused before anything is stored and the " +
      "upload record ends `rejected`. It moves with `src/upload-records.ts` and " +
      "`src/store/blobs.ts`, like `upload-acquire.test.ts` whose harness it follows. The URL half " +
      "mocks `src/fetch.js` for `fetchDocument` only, because `fetchDocument` refuses loopback.",
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

  "tests/slug.test.ts": {
    category: "store-agnostic-fake",
    evidence: "static-only",
    reason:
      "Its subject is `assertSlug` being deliberately looser than `isSlug`, and it is here for a " +
      "reason no graph walk can see: one case `readFileSync`s **`src/store/jobs-fs.ts` as source " +
      "text** to check the `_`-prefixed path it builds. So it goes red purely because a file was " +
      "deleted, with nothing about slugs having changed — the oracle moves wherever that rule " +
      "moves. Never executes a condemned function, which is why the dynamic witness files it " +
      "under ran-and-touched-nothing.",
  },
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
  "tests/all-skipped-publication-refusal.test.ts": "private-postgres",
  /* **Storage, not Postgres — and a lane all the same.** GPT Sol found four
     files in the unit lane reaching the real shared Supabase bucket over HTTP
     (2026-09-04). This one PUTs a staging object and has the route HEAD it
     back. `private-postgres` is the only lane that both leaves `SUPABASE_URL`
     alone and serialises, so two of these files cannot collide inside one run.
     `LANES_BEYOND_THE_SCAN` below carries the per-file reason. */
  "tests/an-upload-is-queued-only-once-its-bytes-arrive.test.ts": "private-postgres",
  "tests/article-rows-snapshot.test.ts": "private-postgres",
  "tests/billing-admission.test.ts": "private-postgres",
  "tests/billing-checkout.test.ts": "private-postgres",
  /* Stage 3b's, arriving from this worktree rather than from `dev`, and caught
     by the same guard for the same reason. It calls `pgReady`, seeds its own
     owner and its own two tiers, and its oracle is rows it writes itself — so
     the private lane is right and nothing in it needs the shared stack. */
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
  "tests/chat-route.test.ts": "private-postgres",
  "tests/checkpoints-durable-resume.test.ts": "private-postgres",
  "tests/claim-session-postgres.test.ts": "private-postgres",
  "tests/comment-referee-mark.test.ts": "private-postgres",
  "tests/comment-sweep.test.ts": "private-postgres",
  "tests/corpus-lock.test.ts": "private-postgres",
  "tests/db-error-scrub.test.ts": "private-postgres",
  "tests/db-referee-criteria.test.ts": "private-postgres",
  "tests/db-schema-drift.test.ts": "private-postgres",
  "tests/db-schema.test.ts": "private-postgres",
  "tests/db-transaction-errors.test.ts": "private-postgres",
  "tests/enqueue-owns-the-article.test.ts": "private-postgres",
  "tests/export-route.test.ts": "private-postgres",
  "tests/feedback-store.test.ts": "private-postgres",
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
  "tests/load-article-serialisation.test.ts": "private-postgres",
  "tests/lock-lifecycle.test.ts": "private-postgres",
  "tests/migration-reconciliations.test.ts": "private-postgres",
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
  "tests/public-visibility-pg.test.ts": "private-postgres",
  /* Storage, not Postgres — see `an-upload-is-queued-…` above. This is the
     worst of the four: it removes and re-plants **one deterministic canonical
     key** with deliberately corrupt bytes, so two concurrent runs can destroy
     each other's oracle. */
  "tests/raw-source-store.test.ts": "private-postgres",
  "tests/referee-criteria-store.test.ts": "private-postgres",
  "tests/referee-routes-postgres.test.ts": "private-postgres",
  "tests/remember-route.test.ts": "private-postgres",
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
  "tests/run-lock.test.ts": "private-postgres",
  "tests/running-slot.test.ts": "private-postgres",
  "tests/source-store.test.ts": "private-postgres",
  "tests/store-ai-calls.test.ts": "private-postgres",
  "tests/store-artefacts-pg.test.ts": "private-postgres",
  "tests/store-block-roles-pg.test.ts": "private-postgres",
  "tests/store-carry-forward.test.ts": "private-postgres",
  "tests/store-chat-pg.test.ts": "private-postgres",
  "tests/store-checkpoints.test.ts": "private-postgres",
  "tests/store-comments-parity.test.ts": "private-postgres",
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
  "tests/store-reader-state-parity.test.ts": "private-postgres",
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
  "tests/store-writes-land-in-postgres.test.ts": "private-postgres",
  /* Storage, not Postgres — see `an-upload-is-queued-…` above. */
  "tests/upload-acquire.test.ts": "private-postgres",
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
  "tests/upload-acquire.test.ts":
    "Reaches Supabase Storage, not Postgres. It derives canonical keys from fixed " +
    "fixture bytes and writes them, which is the same shared-name collision as " +
    "raw-source-store.test.ts, one step milder. GPT Sol, 2026-09-04.",
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
  /* Stage 3b's own reader. `seedAuthUser` in `beforeAll`, and every row it
     writes — the billing account, the ingest events — hangs off the
     `auth.users` foreign key, so there is nothing here that would work without
     the row. */
  "tests/billing-quota-adjustment.test.ts": {
    "0b1113b0-0000-4000-8000-00000000e3b0": { kind: "seeded" },
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
};

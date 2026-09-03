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
 * two completeness guards. **`STORE_MIGRATION` is finalised here in stage A.
 * `TEST_LANES` is empty and is filled in stage T-C**, after the database
 * factory exists — because deciding a lane means testing an assumption about a
 * clean database, which cannot be done before there is one.
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
 * ## `evidence`, and why four entries carry it
 *
 * `"dynamic"` — the default — means **the instrumented run watched this file
 * execute a condemned function**, so its name is in the witness's `touched`
 * map. `"static-only"` means it is not, and the verdict rests on the import
 * graph plus the file's own docstring, which is weaker evidence. The guard
 * holds the two apart, so this field cannot quietly become decorative.
 *
 * Three of the four are files that **did not exist when the witness ran**, at
 * 2026-09-03T09:19Z, and arrived from `dev` inside the next ninety minutes;
 * re-running witness 2 is what upgrades them. The fourth,
 * `tests/slug.test.ts`, is different and is here on the grep's authority: it
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
    category: "database-integration",
    reason:
      "Anchor validation at the route, asserted before a byte of the stream goes out. Its own " +
      "header says the foreign key is deliberately left to `chat-anchor.test.ts` because `this " +
      "harness writes to the filesystem store, which has no such thing` — so the harness is what " +
      "changes, and the Postgres twin already exists to copy from.",
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
    category: "database-integration",
    reason:
      "The ingest queue was completely open — any authenticated Bob could list, fetch, cancel, " +
      "retry or advance Alice's jobs. Its header's reason for needing no database is that *jobs " +
      "never reach Postgres*, which is the sentence this migration falsifies, so every case has to " +
      "be re-founded on the Postgres queue.",
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

  /* ---- Static-only: the dynamic witness never saw these three ------------- */

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
 * **Empty on purpose, and stage T-C fills it.** Assigning a lane means testing
 * an assumption about a clean database, and there is no clean database until
 * the factory in T-B exists. Guessing now would produce a map that looks
 * authoritative and was never checked against anything.
 *
 * The names below are 260903e's; T-C owns the final spelling. `shared-services`
 * is the one that proves the two maps are not one map: `tests/auth-user-
 * seeding.test.ts`, `tests/seed-admin-signin.test.ts` and
 * `tests/admin-store.test.ts` all belong to it because GoTrue reads the
 * `postgres` database whatever the SQL does — and the store verdict above has
 * nothing to say about any of them.
 */
export type TestLane = "private-postgres" | "shared-services" | "unit";

/** Stage T-C fills this. See the note above before adding the first entry. */
export const TEST_LANES: Readonly<Record<string, TestLane>> = {};

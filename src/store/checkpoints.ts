/**
 * **The checkpoint store: work a failed attempt already paid for.**
 *
 * `labels-progress.json` and `pdf-chunks/<key>.json` exist so that a run which
 * dies eight batches into a book costs one batch rather than eight. Landing D
 * of docs/plans/260827aa-delete-the-importer.md takes the `data/<slug>/` directory they
 * live in away, so they need a home that is not a path. This is the interface,
 * and there is one implementation of it — [checkpoints-pg.ts](checkpoints-pg.ts).
 *
 * ## For three days nothing called it, and that cost something
 *
 * Written 2026-08-29 with two adapters. **Neither got a caller until
 * 2026-09-01**, while the two stages that really do checkpoint went on
 * hand-rolling theirs to disk: `src/labels.ts` wrote `labels-progress.json` and
 * `src/pdf-read.ts` wrote `pdf-chunks/`, both straight into `data/<slug>/`.
 * Putting them on this seam was **landing D2**
 * (docs/plans/260827aa-delete-the-importer.md); it landed, and both go through
 * `read`/`write` here now. This paragraph said *"and it is still unbuilt"* for
 * three days after it was.
 *
 * On 2026-09-01 the filesystem adapter was deleted with the rest of the
 * filesystem store (docs/plans/260831b-finish-the-database-move.md § Stage 4). It had
 * written nothing, ever — no `data/<slug>/checkpoints/` directory has existed
 * on any machine — and `scripts/checkpoints-sweep.ts` had been sweeping that
 * empty directory shape while 300 KB of real checkpoints sat one level up,
 * invisible to it. **That is the argument for D2**, stated as a fact rather than
 * a plan: a seam nobody writes through does not merely sit unused, it takes the
 * retention, the healing and the whole-or-absent guarantee out of reach of the
 * two callers that need them, and the two callers keep their own copies of each.
 *
 * Everything below still holds. Comments naming "the filesystem adapter" are
 * kept where the *reasoning* is what matters — a rule's origin is worth knowing
 * even when the thing that caused it has gone — and are marked as history.
 *
 * ## The one thing that would have made it useless
 *
 * **A checkpoint is addressed by the article and the question, never by the
 * revision.** A retry is a new job ([`../jobs.ts`](../jobs.ts)) and a new job
 * begins a new draft revision, so a checkpoint keyed on the revision is written
 * on every run and read on none. Nothing errors, nothing warns, every lookup
 * simply misses, and the only symptom is a larger bill —
 * docs/reusable/silent-success.md, and docs/plans/260827aa-delete-the-importer.md
 * § *B3's key is not the revision, and that would have made the table useless*.
 *
 * `articleId` is stable across every attempt, so the store binds one at
 * construction. `revisionId` appears nowhere in this file and must not.
 *
 * ## What the store knows about a key: nothing
 *
 * The key is a content address the caller computes — for labels, a digest over
 * the prompt version, the model, the outline, the block ids, the sibling
 * grouping and the rendered prose; for a PDF chunk, a digest over the source
 * hash, the pages, the context, the prompt fingerprint, the reader model and
 * the token ceiling. What makes an entry reusable is that the question is
 * identical; what makes it unusable is that the question changed. Those are the
 * same sentence, which is why nothing here ever invalidates anything.
 *
 * That puts one rule on the **caller**, and the store cannot enforce it:
 *
 * > **Every input the work depends on has to be in the key.** Including the
 * > reader's own, if there ever is one.
 *
 * Neither existing key has a person in it, and that is correct today because
 * neither piece of work depends on one — `pdf-chunks`' `reader.id` is the
 * *model*'s id (`PdfReader.id`, `model/promptVersion`), not a human's, which is
 * worth saying because the name reads the other way. A future checkpoint over
 * something shaped by `reader_profiles` would have to hash the profile in, or
 * two attempts at different times would answer each other's question. Rows are
 * per-article and an article has one owner, so this is a correctness rule
 * rather than a privacy one — but it stops being only that the day anything
 * un-scopes these rows.
 *
 * ## Whole or absent, never half
 *
 * A killed process must not leave an entry that parses into nonsense. In
 * Postgres a row cannot be half-written. On the filesystem it takes a temp file
 * and a `rename`, and the reason it matters is on the record:
 * docs/postmortems/260828e-pdf-chunk-cache-corrupt-entry.md, where a half-written chunk
 * made one article permanently unreadable and nothing could clear it.
 *
 * **Whole is not the same as usable, and a broken entry has to be replaceable.**
 * A store that keeps whichever entry arrived first cannot heal — see
 * § Concurrency below, which is where that went wrong.
 *
 * **The store does not check the shape of a value**, only that it was written
 * whole and parses. What a batch entry or a chunk reading *is* belongs to the
 * caller — `usableCheckpoint` in [`../labels.ts`](../labels.ts) and `checkChunk`
 * in [`../pdf-read.ts`](../pdf-read.ts) are the real gates and are stricter than
 * anything a store could be. So `read` is generic and the value comes back
 * exactly as it went in: the same deal `JSON.parse` offers, and the caller
 * validates.
 *
 * ## Outside the transaction, deliberately
 *
 * Preserving the work of a **failed** attempt is the entire point, and a
 * checkpoint rolled back with the attempt is worthless. So neither adapter
 * takes a transaction, and the Postgres one uses `getDb()` — the pool — so a
 * write lands on a different connection from any transaction the coordinator is
 * holding. There is no `tx` parameter anywhere in this file, and adding one
 * would silently undo it.
 *
 * ## Concurrency, and why the last write wins
 *
 * Two processes can advance the same article (the browser-driven advance
 * endpoint lets them), so this is designed for rather than hoped about.
 *
 * **The last write wins**, both adapters — the newest answer replaces whatever
 * was under the key. The first version of this file did the opposite, and that
 * was a bug found in review; the reasoning is worth keeping because the wrong
 * answer sounded better.
 *
 * The argument for first-write-wins was that two attempts answering one
 * content-addressed question produce interchangeable answers, so keeping the
 * first is the stable choice. Both halves are true and the conclusion does not
 * follow, because of one fact about the callers:
 *
 * > **`write` is only ever called by a caller that has just failed to read.**
 *
 * Both of them read first and buy only on a miss. So a write is never a second
 * opinion about an entry that is already good — it is always somebody reporting
 * that what was there was *not usable*, and paying to find out. Keeping the
 * older value therefore discards exactly the writes that were made **because**
 * the stored one was worthless, and the caller pays again on the next run, and
 * the run after that, for ever. Nothing errors; the bill goes up.
 *
 * That is not hypothetical: an entry a killed process left half-written reads
 * as a miss (below), so it was re-bought and then *preserved* on every single
 * attempt — and the mtime bump refreshed its age, so the sweep, the one thing
 * that would eventually have removed it, was taught it was hot instead. It
 * turned the loud permanent failure in
 * docs/postmortems/260828e-pdf-chunk-cache-corrupt-entry.md into a quiet permanent
 * charge, which is worse.
 *
 * **And nothing was lost by giving it up**, which is the part that was hardest
 * to see. Whole-or-absent is bought by writing to a temp file and renaming, not
 * by refusing to overwrite; the only thing refusing bought was preventing one
 * valid answer from replacing another valid answer, and those are
 * interchangeable by construction. The hazard the refusal guarded against did
 * not exist. `src/pdf-read.ts` has been doing last-write-wins with a plain
 * `rename` all along, so this is what the filesystem already does rather than a
 * new behaviour.
 *
 * **And there is no `delete`.** `labels.ts` today mints a random `runId`, stamps
 * every write with it, and has `clearCheckpoint` refuse to delete a file that
 * is not its own. That machinery exists because the unit of deletion — a file
 * holding every batch — was larger than the unit of work. One row per entry
 * removes the hazard rather than guarding it, so D drops the `runId` with the
 * file. Cleanup is `sweepCheckpoints` below; see § Retention there.
 */

/**
 * Which checkpoint. **Not a `StepName`**: `labels` is not a step — the
 * `revision_step_runs_step` CHECK rejects it, because `labels.json` is one of
 * the `hierarchy` step's outputs — and two different checkpoints sharing one step's
 * name would share a key space for no reason. Closed, and matched by a CHECK on
 * the table, so a typo cannot open a namespace nothing ever reads.
 *
 * **Two of these belong to the same step, and that is the point of the split.**
 * `hierarchy-structure` is stage 4's one big call — the tree — and
 * `hierarchy-labels` is the batches that follow it. They were one namespace's
 * worth of work and are two questions: on a 142-page paper the structure call is
 * 508 seconds and about two dollars, the batches are 34 rows, and a run that
 * dies in the batches must not buy the tree again. Adding a namespace is a
 * migration, because the CHECK on the table is the other copy of this list.
 */
export type CheckpointNamespace = "hierarchy-labels" | "hierarchy-structure" | "pdf-chunk";

/** Every namespace, for the CHECK, the tests and anything that has to enumerate. */
export const CHECKPOINT_NAMESPACES: readonly CheckpointNamespace[] = [
  "hierarchy-labels",
  "hierarchy-structure",
  "pdf-chunk",
];

/**
 * What a key may be, and it is narrower than "any string" for one reason,
 * **which is now historical**: the filesystem adapter used it as a **file
 * name**. That adapter is gone (see the header), and the rule stays — it is a
 * CHECK on a live table (`checkpoints_key_format`), so relaxing it costs a
 * migration and buys nothing; and a key narrow enough to be a file name is a
 * key nothing can be surprised by later.
 *
 * - No dot at all, so `..` and `.` cannot be spelt. A traversal is impossible by
 *   construction rather than by a second check that could be edited away.
 * - No `/` or `\`, for the same reason.
 * - **Lower case only.** macOS filesystems are case-insensitive, so `AB` and
 *   `ab` are one file and two rows — a divergence that would show up as one
 *   store working and the other quietly not.
 * - 128 characters. Both existing keys are 16 hex characters.
 *
 * The same expression is a CHECK on the table (`checkpoints_key_format`), so
 * the database refuses what this refuses. Three copies of one rule is the
 * `raw_sources` precedent and it is deliberate: the alternative is a key that is
 * legal in one store and not the other.
 *
 * ## The regex is wider than the key space, on purpose
 *
 * **Every key either caller actually mints is 16 lower-case hex characters** —
 * `createHash("sha256")…digest("hex").slice(0, 16)`, in both `batchFingerprint`
 * (src/labels.ts) and the chunk key (src/pdf-read.ts), and both are asserted
 * against this rule by the tests that own them. This expression allows a good
 * deal more than that so a third checkpoint is not forced into hex.
 *
 * Which is the rule, then: **the regex is the contract, hex is the practice.**
 * Anything a future caller mints must pass the regex; nothing may assume a key
 * *is* hex, or 16 characters, or fixed-length.
 *
 * GPT Sol noted that it also accepts Windows reserved basenames — `con`, `nul`,
 * `com1`, and `con.json` is reserved too. **Deliberately not handled.** This
 * runs on macOS and on Vercel's Linux; there is no Windows path and adding
 * reserved-name handling would be dead code that reads like a live rule. A
 * 16-character hex digest cannot collide with any of them, and a future caller
 * that mints short readable keys is the one that would have to think about it.
 */
export const CHECKPOINT_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/;

/**
 * The article a store is bound to. Both fields, because the two adapters need
 * different halves and every call site has both.
 *
 * `slug` is not decoration on the Postgres side: it is the mandatory assertion.
 * Every method takes a slug and checks it against this one, so a store built for
 * article A and called for article B throws **before** it reads or writes
 * anything. The same argument as `JobDraftRef` in
 * [artifacts-pg.ts](artifacts-pg.ts), which a review asked for there.
 */
export interface CheckpointArticleRef {
  slug: string;
  /** `articles.id`, which is what the store keys on. */
  articleId: string;
}

/**
 * **Two methods, and each has exactly one reason to exist.**
 *
 * - `read` — the whole point. Batched and plural because both callers know
 *   every key they want before they start: `labels.ts` computes a fingerprint
 *   per batch from its plan, and `pdf-read.ts` computes a key per chunk from
 *   its chunk list. One round trip rather than N, and no method that takes a
 *   single key, because a caller with one key passes an array of one.
 * - `write` — singular, because surviving a crash *mid-run* is the point: each
 *   entry lands the moment its call comes back, not at the end.
 *
 * There is no `delete`, no `has` and no `describe`. `has` would be `read` with
 * the answer thrown away, and a caller that wanted one would then read anyway.
 * The sweep is retention (below) and is not per-article, so it is a free
 * function on each adapter rather than a method nothing per-article calls.
 */
export interface CheckpointStore {
  /**
   * The entries that exist, by key. **A missing key is simply absent from the
   * map** — a miss and an unreadable entry are the same answer here, because
   * both mean *buy it again*, which is the only thing a caller can do about
   * either.
   *
   * Reading also stamps `last_used_at`, so this is not a pure read. That is
   * what makes the sweep able to tell a hot entry from a dead one.
   *
   * The value is returned as it was written. **The caller validates its shape**
   * — see the header.
   */
  read<T>(
    slug: string,
    namespace: CheckpointNamespace,
    keys: readonly string[],
  ): Promise<Map<string, T>>;

  /**
   * Record one finished piece of work. **The last write wins**: whatever was
   * under this key is replaced, because the caller only writes after failing to
   * read, so this value is the better-informed one. See the header.
   *
   * Throws on a key `CHECKPOINT_KEY_RE` refuses, on a slug that is not the
   * bound one, and on a value that will not serialise (`checkpointJson`).
   */
  write(
    slug: string,
    namespace: CheckpointNamespace,
    key: string,
    value: unknown,
  ): Promise<void>;
}

/**
 * **The store refusing its own arguments** — a bad key, the wrong slug, an
 * undeclared namespace, a value that will not serialise.
 *
 * Its own class for one reason, and it is the same reason `ChatConflict`,
 * `StaleAttemptError` and `IllegalTransition` have theirs: `guardDbStore`
 * scrubs everything a store throws into *"this app asked its database for
 * something it would not do"*, because a failed Drizzle query carries every
 * bound parameter in its message. None of these ever reached the database.
 * Scrubbing them would blame the database for a wiring bug, log
 * `database call failed` for a call that was never made, and throw away the one
 * sentence saying which rule was broken — so they are on the allowlist in
 * [db-errors.ts](db-errors.ts) instead.
 *
 * **Safe to let out**, which is what earns the allowlist entry: these messages
 * carry a key (a digest), a slug (already in the URL) and a type name. Never a
 * value, because a value is a transcription of the reader's own document.
 */
export class CheckpointRequestError extends Error {}

/**
 * The refusal both adapters share, so they cannot drift into refusing different
 * things. Sync, and before any I/O — a store built for one article and called
 * for another must not have touched anything by the time it throws.
 */
export function assertCheckpointRequest(
  bound: CheckpointArticleRef,
  slug: string,
  namespace: CheckpointNamespace,
  keys: readonly string[],
): void {
  if (slug !== bound.slug) {
    throw new CheckpointRequestError(
      `This checkpoint store is bound to ${JSON.stringify(bound.slug)} and was asked about ` +
        `${JSON.stringify(slug)}. Build one per article; see src/store/checkpoints.ts.`,
    );
  }
  if (!CHECKPOINT_NAMESPACES.includes(namespace)) {
    throw new CheckpointRequestError(
      `${JSON.stringify(namespace)} is not a checkpoint namespace. ` +
        `One of: ${CHECKPOINT_NAMESPACES.join(", ")}.`,
    );
  }
  for (const key of keys) {
    if (!CHECKPOINT_KEY_RE.test(key)) {
      /* The key itself is a digest and carries no prose, so quoting it is safe
         — and without it the message cannot say which of forty keys was wrong. */
      throw new CheckpointRequestError(
        `${JSON.stringify(key)} is not a usable checkpoint key. Keys are lower-case ` +
          "[a-z0-9_-], 1 to 128 characters, no dots. See CHECKPOINT_KEY_RE in " +
          "src/store/checkpoints.ts.",
      );
    }
  }
}

/**
 * A checkpoint value as JSON, or a refusal — **the one place either adapter
 * turns a value into bytes**, so the two cannot disagree about what is
 * writable.
 *
 * `JSON.stringify(undefined)` returns `undefined`: not a string, and not an
 * error. A template literal then turns that into the nine characters
 * `undefined`. The filesystem adapter wrote that file happily while Postgres
 * refused the same value, because `jsonb` cannot hold it — so the two stores
 * disagreed about whether a write was legal. On the filesystem the result was
 * worse than a refusal would have been: the file exists, will not parse, and is
 * read back as a miss for ever. Found by GPT Sol, 2026-08-29.
 *
 * The same `undefined` return covers a bare function or symbol, and a `toJSON`
 * that returns nothing. A `BigInt` throws from `JSON.stringify` itself and
 * comes out of here as that `TypeError`, which is already a refusal.
 *
 * **The value is never quoted in the message** — it is a transcription of the
 * reader's own document. src/parse-json.ts makes the same argument at length.
 */
export function checkpointJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  if (json === undefined) {
    throw new CheckpointRequestError(
      "A checkpoint value must serialise to JSON, and this one does not — it is " +
        `${value === undefined ? "undefined" : typeof value}. ` +
        "See checkpointJson in src/store/checkpoints.ts.",
    );
  }
  return json;
}

/* ------------------------------------------------------------- retention -- */

/**
 * **How long a checkpoint lives, decided out loud.**
 *
 * Nothing has ever deleted a PDF chunk, on success or on failure, so today's
 * answer is *unbounded, by silence*. This is the answer instead.
 *
 * An entry is dead when nothing will ever ask its question again — when the
 * prompt version moves, the model moves, or the text moves. All three are in
 * the key, so a dead entry stops being read the instant it dies and there is
 * nothing to invalidate. What is left is only *storage*, and the sweep is a
 * proxy: if nothing has asked in ninety days, probably nothing will.
 *
 * **Ninety days**, and the number is a judgement rather than a measurement.
 * Long enough that coming back to an article next quarter still hits; short
 * enough that a year of superseded prompt versions does not accumulate. It is
 * one constant and changing it costs nothing.
 *
 * **`last_used_at`, not `created_at`, and that is the half that had to exist
 * from the first migration.** A cache entry hit every week is not old, however
 * long ago it was written; sweeping on `created_at` would delete exactly the
 * entries that were earning their keep. Adding the column later would not help,
 * because the first sweep after it was added could not know which rows were
 * hot. So the column is here on day one and `read` bumps it.
 *
 * **Nothing schedules this yet, and that is safe** for a reason worth writing
 * down: every row costs a paid model call to create, so the table cannot grow
 * faster than the bill. The measured sizes are ~20 KB a PDF chunk and 47.8 KB
 * for the largest labels file; `MAX_PAGES` bounds the chunk count, so the
 * worst case for one article moved with it — the low hundreds of KB at 100
 * pages, and single-digit MB now that it is 250 (src/pdf-read.ts, 2026-09-04).
 * That is 2.5× a number the argument had a lot of room over, so the conclusion
 * is unchanged; it is written out because the *next* raise is the one to check
 * it against. Deleting an article takes its rows with it
 * (`on delete cascade`), which is the only removal with a deadline, and it is
 * automatic. So the sweep is housekeeping, and housekeeping that nobody runs is
 * a growing table rather than a broken one. Run it with
 * `npx tsx scripts/checkpoints-sweep.ts --days 90`; it prints what it would
 * delete unless told `--delete`.
 */
export const CHECKPOINT_RETENTION_DAYS = 90;

/** The cutoff `CHECKPOINT_RETENTION_DAYS` names, from a given moment. */
export function checkpointCutoff(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/* --------------------------------------------------- and no selector here -- */

/**
 * **There is deliberately no `createCheckpointStore(ref)` that picks by
 * `SPIDERYARN_STORE`,** and that is a decision rather than an omission.
 *
 * This module has to stay a **leaf**. In landing D `src/labels.ts` and
 * `src/pdf-read.ts` import it, and `src/db/schema.ts` type-imports `LabelsFile`
 * from `src/labels.ts` — so a selector here, importing the Postgres adapter,
 * would close `checkpoints → checkpoints-pg → db/schema → labels → checkpoints`.
 * `npm run cycles` is a gate rather than advice, so that is a red build. It is
 * the same reason [ai-calls.ts](ai-calls.ts) and [live.ts](live.ts) are their
 * own files.
 *
 * So the constructor is exported from its own module and the caller imports it:
 * `scripts/checkpoints-sweep.ts` does it for the sweep, and D2's coordinator
 * will do it for the stages — which is the right place anyway, since a stage
 * should be handed a bound store rather than build one, exactly as it is handed
 * an `ArtifactStore`.
 *
 * **With one adapter left there is nothing to select**, so this section is now
 * about the *shape* rather than the switch: the leaf property is what keeps the
 * cycle closed, and it would come back the moment anything here imported the
 * adapter.
 */

/* -------------------------------------------------------- and no store at all -- */

/**
 * **A checkpoint store that remembers nothing**, for the callers that have no
 * article row to key on.
 *
 * There are two, and neither is production. `fsStoreSession`
 * ([session.ts](session.ts)) runs against `data/<slug>/` on a laptop with
 * `SPIDERYARN_STORE` unset, where there is no `articles` row and therefore no
 * `articleId` — the one thing this store must be keyed on. And the stage
 * command lines (`npm run pdf`, `npm run labels`, `npm run hierarchy`) are in the
 * same position for the same reason.
 *
 * **So the filesystem path keeps working and stops resuming**, and those are
 * two different sentences. Every article it produces is byte-for-byte what it
 * was; what it loses is the discount on a *second* attempt after a killed one,
 * which used to come from `data/<slug>/pdf-chunks/` and `labels-progress.json`.
 * That is a laptop paying twice for a run it interrupted, not an article coming
 * out wrong — and it is bounded by the deletion of the filesystem store
 * (docs/plans/260831b-finish-the-database-move.md), after which there is no caller
 * left. The alternative was to resurrect `checkpoints-fs.ts`, deleted on
 * 2026-09-01 having never written a byte, to serve a path that is going away.
 *
 * **It is not silent about it**, though for two days it was: this paragraph
 * used to rest on `LabelRun.resumed` and on `PdfExtractResult.usage` being
 * non-zero on a second run, and both are things a reader of the log would have
 * had to *infer*, from figures that were suppressed at zero. Since 2026-09-04
 * both callers log `{ asked, found }` at `info` on every read
 * (src/pdf-read.ts § `storedChunks`, src/labels.ts), so a *Postgres* run that
 * came back with this store by mistake is a line saying it asked for forty and
 * found none, rather than an absence somebody has to notice.
 * docs/reusable/silent-success.md,
 * docs/postmortems/260904a-a-retry-minted-a-fresh-name-so-the-checkpoints-could-never-be-found.md.
 *
 * **And it still refuses what the real store refuses.** A namespace that is not
 * declared, or a key the CHECK would reject, throws here exactly as it would in
 * Postgres — so a caller that mints a bad key finds out from `npm test` on a
 * laptop rather than from production. Only the slug assertion is missing, and
 * only because there is no article to bind to.
 */
export function nullCheckpointStore(): CheckpointStore {
  const check = (namespace: CheckpointNamespace, keys: readonly string[]): void => {
    /* A slug that matches itself, so the shared refusal can be reused whole
       rather than half-copied — the two would drift, and the half that drifted
       would be the one only the laptop runs. */
    assertCheckpointRequest({ slug: "", articleId: "" }, "", namespace, keys);
  };
  return {
    async read<T>(
      _slug: string,
      namespace: CheckpointNamespace,
      keys: readonly string[],
    ): Promise<Map<string, T>> {
      check(namespace, keys);
      return new Map<string, T>();
    },
    async write(
      _slug: string,
      namespace: CheckpointNamespace,
      key: string,
      value: unknown,
    ): Promise<void> {
      check(namespace, [key]);
      /* Checked and thrown away. A value that will not serialise is a bug in the
         caller either way, and finding it only under Postgres is finding it
         late. */
      checkpointJson(value);
    },
  };
}

/**
 * Nothing a database said may leave the store.
 *
 * ## What this is defending against
 *
 * `drizzle-orm` builds a failed query's error like this
 * (`node_modules/drizzle-orm/errors.js`):
 *
 *     Failed query: insert into "comments" … values ($1, $2, $3)
 *     params: <every bound value>
 *
 * The SQL half is ours and harmless. **The params half is the article**: the
 * reader's selected quote on `create`, the model's whole answer on the patch
 * that finishes a comment. And `err.cause` is the `pg` driver's own error,
 * whose message quotes the offending value back at you as well
 * (`invalid input syntax for type integer: "…"`).
 *
 * From there it went three ways at once, because src/routes.ts does all three
 * with the same object: `send(res, 500, { error: err.message })` to the client,
 * `errorFields(err)` to the log, and — on the comment and search completion
 * paths — `patch = { status: "error", error: err.message }` into the row. The
 * third is the worst: the next query then *binds* a string that already
 * contains the answer, and Drizzle flattens it in again one level deeper.
 *
 * Pino's redaction cannot reach any of it. `redact` matches key paths, and by
 * this point the values are text inside `message` and `stack`.
 *
 * ## The rule
 *
 * From docs/plans/error-boundary.md, which is GPT Sol's:
 *
 * > No arbitrary `Error`, and no arbitrary string, may cross an HTTP, SSE, log,
 * > or persisted-error boundary.
 *
 * The full version of that is a closed `PublicFailure` type at every egress,
 * and it is not built. This is the half that can be built at one seam: every
 * error leaving a Postgres store is replaced here with one of the two sentences
 * in src/messages.ts, and the original never gets past this file.
 *
 * ## Why it scrubs *everything* rather than only Drizzle's errors
 *
 * The narrow version — detect `DrizzleQueryError`, translate that, pass the
 * rest through — is the one that keeps needing a fifth round. It is a list, and
 * the whole history in docs/plans/error-boundary.md is of lists that were
 * complete when they were written. A store that one day throws
 * `new Error(\`bad row \${JSON.stringify(row)}\`)` is not on anybody's list.
 *
 * So the direction is inverted, the same way `SAFE_ERROR_PROPS` in src/log.ts
 * is: **an allowlist of what may pass through unchanged**, and everything else
 * is translated.
 *
 * Four things pass:
 *
 * 1. **An error carrying a numeric `status`.** That is this codebase's mark for
 *    "I chose this failure and I chose its wording" — a 404 for a slug with no
 *    article, a 501 from `notMigrated`. Translating those would tell a reader
 *    who mistyped a slug that the app is broken.
 * 2. **`ChatConflict`.** src/routes.ts answers 409 on `instanceof`, so eating it
 *    would turn a stale second tab into a server fault. Nothing routed through
 *    the guard throws one yet — the Postgres chat store is not wired into
 *    src/store/index.ts — and it is handled here anyway, because the day it is
 *    wired is not the day anybody will remember this paragraph.
 * 3. **`StaleAttemptError`.** The same shape, found the same way — GPT Sol's
 *    review, 2026-08-27, of the change that put `pgJobStore` behind this guard.
 *    `advanceJob` in src/jobs.ts asks `err instanceof StaleAttemptError` to
 *    answer *busy, ask again* when the claim moved to another instance mid-step.
 *    Scrubbing it would turn an ordinary lost race into a 500 on the reader's
 *    ingest card, and it would do it only under `postgres` and only under
 *    contention — the hardest possible thing to reproduce.
 * 4. **`IllegalTransition`.** Found by tests/store-uploads-parity.test.ts the
 *    moment `pgUploadStore` went behind this guard: the two upload adapters
 *    stopped agreeing about what an illegal state change says, because only one
 *    of them has a database and so only one of them came through here. It is a
 *    caller's bug either way, and the whole point of it is to name the
 *    transition that was asked for.
 * 5. **`ProductRefused`.** The same shape again, and found the same way — by
 *    asking a guarded store for the message it actually produced, 2026-08-30.
 *    `checkProduct` (src/store/session.ts) refuses a step's product **before**
 *    the transaction opens, so none of its four refusals has been near a
 *    database; the transactional session goes through this wrapper, so all four
 *    came out as *"this app asked its database for something it would not
 *    do"*. That is a false sentence about a real bug, and it drops the half
 *    that says which artefact was missing — which is the whole content of the
 *    refusal, and the thing whoever is converting a stage needs.
 *
 * What the four have in common is the test to apply to a fifth: the type is
 * **closed** and its message is built from values *we* chose. `StaleAttemptError`
 * interpolates a job id, which is a uuid we minted, and `IllegalTransition` two
 * members of a five-literal union. The moment a candidate's
 * message can contain a URL, a title, a quote or a model's answer, it does not
 * belong on this list however well-behaved its class is.
 *
 * The cost is real and is worth saying out loud: a plain bug in a Postgres store
 * (a `TypeError`, say) now reaches the log without its message. **The stack
 * survives** — the frames are kept and only the message line is dropped — so
 * the file and line are still there, which is most of what a `TypeError` was
 * going to tell you. The alternative was keeping free text on the safe side of
 * a boundary because it is *probably* safe, which is the argument that has been
 * wrong four times.
 *
 * ## What is kept
 *
 * The SQLSTATE, as `code`, because that is on `SAFE_ERROR_PROPS` in src/log.ts
 * and so it lands in the log line without anybody adding a field. It is five
 * characters chosen by Postgres — `23503` says a foreign key refused the row —
 * and it carries nothing about what the row contained.
 *
 * The rest of the diagnostics (table, constraint, routine, the error's class
 * name) go out as a log line from here rather than riding on the error, because
 * they are *fields*, and a field is a thing redaction and allowlists can reason
 * about. Nothing free-form is among them: `detail`, `hint`, `where` and
 * `internalQuery` are all dropped, because the first two quote row values and
 * the last two quote query text.
 *
 * See also: docs/project/logging.md, docs/project/copy.md,
 * docs/plans/error-boundary.md.
 */

import { ChatConflict } from "../chat.js";
import { CheckpointRequestError } from "./checkpoints.js";
import { log } from "../log.js";
import { STORAGE_BUSY, STORAGE_FAILED } from "../messages.js";
import { StaleAttemptError } from "./jobs.js";
import { ProductRefused } from "./artifacts.js";
import { IllegalTransition } from "./uploads.js";

const logger = log("store");

/**
 * SQLSTATE classes and codes that mean "this may well work next time".
 *
 * Everything not here is treated as permanent, which is the safe direction:
 * telling a reader to try again when the same write will be refused again is
 * the mistake docs/project/copy.md is built around.
 *
 * - `08` — connection exception, the pooler or the network.
 * - `40` — serialisation failure and deadlock. One of two writers loses; the
 *   loser retrying is exactly the intended remedy.
 * - `53` — out of memory, disk or connections.
 * - `55P03` — lock not available.
 * - `57` — admin shutdown, cancelled query, crash recovery.
 * - `25006` — read-only transaction, which on a managed host means a failover
 *   is in progress rather than that the schema is wrong.
 */
const TRANSIENT_CLASSES = new Set(["08", "40", "53", "57"]);
const TRANSIENT_CODES = new Set(["55P03", "25006"]);

/** Node's own transient connection failures, which carry no SQLSTATE. */
const TRANSIENT_ERRNOS = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
]);

/**
 * A SQLSTATE is exactly five of `[0-9A-Z]`. Anything else is somebody's errno.
 *
 * **Takes `undefined` deliberately, because its own caller hands it one.**
 * `chain.find(...)` returns `undefined` when nothing in the chain carries a
 * SQLSTATE — a plain `Error`, or a `pg` connection failure that never reached
 * Postgres — and the guard clause below is what stops this whole file throwing
 * a `TypeError` of its own instead of classifying the failure.
 *
 * It did exactly that until 2026-08-26, and the tests were satisfied: they
 * asked whether the sentinel was gone, and a crash inside the scrubber removes
 * it perfectly. What went with it was the classification, the `[db-*]` code and
 * the diagnostic log. Found by a GPT Sol review; the tests now assert the
 * sentence rather than the absence.
 */
function sqlstateOf(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

/**
 * The error and everything behind it, as a list.
 *
 * Bounded at four, because a `cause` chain can be circular and this runs inside
 * a `catch` — an unbounded walk here would replace the failure being reported
 * with a stack overflow, which is the trap `safeError` in src/log.ts already
 * carries a note about.
 */
function chainOf(err: unknown, depth = 0): unknown[] {
  if (depth > 3 || err === null || typeof err !== "object") return [];
  return [err, ...chainOf((err as { cause?: unknown }).cause, depth + 1)];
}

/**
 * **Did this fail because a named unique index refused it?**
 *
 * Asked of the whole `cause` chain, not of the outermost error, and that is the
 * whole reason this is a function rather than `err.code === "23505"` written at
 * the call site. Drizzle's wrapper carries **neither the SQLSTATE nor the
 * constraint name** — from the top a unique violation looks like nothing at all
 * — so the obvious check compiles, reads correctly, and never matches. Written
 * after `pgJobStore.claim` did exactly that and let `jobs_only_one_running`
 * escape as a 500 where it should have been an ordinary `busy`. (That index was
 * dropped on 2026-08-30; the reading mistake it taught did not go with it.)
 *
 * By **name**, never by code alone: `jobs` carries several unique indexes and
 * they all raise 23505 while meaning completely different things — "this slug
 * already has a job in flight" is not "this draft is already claimed". Catching
 * the code would turn each into whichever one the call site expected.
 */
/**
 * Did a `FOR UPDATE NOWAIT` find the row already locked?
 *
 * `55P03` is `lock_not_available`, and it is **an answer rather than a failure**
 * — the same reading `violatesConstraint` exists for, one SQLSTATE along. A
 * claimant that asks for the queue lock and is told somebody else has it should
 * back off, which is exactly what it does when told `busy`.
 *
 * By code and not by name, because unlike 23505 there is only one thing this can
 * mean at the one place that asks for it: src/store/pg-jobs.ts § `claim` is the
 * only `NOWAIT` in the repo. Note that `55P03` is already in `TRANSIENT_CODES`
 * above, which is the same judgement made for retries; this is the caller-facing
 * half of it.
 */
export function lockUnavailable(err: unknown): boolean {
  return chainOf(err).some((link) => sqlstateOf(link) === "55P03");
}

export function violatesConstraint(err: unknown, constraint: string): boolean {
  return chainOf(err).some(
    (link) =>
      sqlstateOf(link) === "23505" &&
      (link as { constraint?: unknown }).constraint === constraint,
  );
}

/**
 * Whether waiting and asking again could plausibly give a different answer.
 *
 * Asked of the **whole chain**, not of the outermost error. Drizzle's wrapper
 * carries neither a SQLSTATE nor an errno: a connection that dropped mid-query
 * looks like nothing at all from the top, and would have been called permanent.
 */
function isTransient(chain: readonly unknown[]): boolean {
  return chain.some((link) => {
    const sqlstate = sqlstateOf(link);
    if (sqlstate) {
      return TRANSIENT_CODES.has(sqlstate) || TRANSIENT_CLASSES.has(sqlstate.slice(0, 2));
    }
    const code = (link as { code?: unknown }).code;
    return typeof code === "string" && TRANSIENT_ERRNOS.has(code);
  });
}

/**
 * A class name, if it is one, and nothing otherwise.
 *
 * `err.name` is writable, so this is not free — a thrower can put anything
 * there. The pattern is what makes it a field rather than free text: an
 * identifier-shaped name goes to the log, a sentence does not.
 */
function classNameOf(err: unknown): string | undefined {
  const name = (err as { name?: unknown }).name;
  return typeof name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : undefined;
}

/**
 * The frames, without the line that carries the message.
 *
 * A `stack` is `"<name>: <message>\n    at …"`, and the message half of that is
 * the whole problem. Keeping the frames costs nothing and is what makes a
 * scrubbed error still worth reading: it points at the query that failed.
 */
function framesOf(err: unknown): string | undefined {
  const stack = (err as { stack?: unknown }).stack;
  if (typeof stack !== "string") return undefined;
  const at = stack.search(/^\s+at /m);
  return at === -1 ? undefined : stack.slice(at);
}

/** May this error go out as it is? See the header — it is an allowlist. */
function mayPassThrough(err: unknown): boolean {
  if (err instanceof ChatConflict) return true;
  /* The checkpoint store refusing its own arguments — a bad key, the wrong
     slug, a value that will not serialise. None of these reached the database,
     so scrubbing them would blame it for a wiring bug and drop the sentence
     saying which rule was broken. src/store/checkpoints.ts. */
  if (err instanceof CheckpointRequestError) return true;
  if (err instanceof StaleAttemptError) return true;
  if (err instanceof IllegalTransition) return true;
  /* A step's product refused before the commit ever opened a transaction —
     `checkProduct` in src/store/session.ts. Its message names a step and the
     artefact kinds it declared, both closed unions of ours. See the header. */
  if (err instanceof ProductRefused) return true;
  return typeof (err as { status?: unknown }).status === "number";
}

/**
 * Whatever the store threw, as something safe to send, log and store.
 *
 * **Deliberately not exported.** A translate-this-error function on offer is a
 * function somebody calls at the fourth site and forgets at the fifth, which is
 * the habit this file replaces. The only way to use it is to wrap the store.
 */
function scrubDbError(where: string, err: unknown): unknown {
  if (mayPassThrough(err)) return err;

  const chain = chainOf(err);
  /* The SQLSTATE lives on the `pg` error underneath Drizzle's wrapper, so it is
     found by walking rather than by reading the error that was thrown. */
  const driver = chain.find((link) => sqlstateOf(link) !== undefined);
  const sqlstate = sqlstateOf(driver);
  const failure = isTransient(chain) ? STORAGE_BUSY : STORAGE_FAILED;

  const scrubbed = new Error(failure.message);
  scrubbed.name = "StoreFailure";
  const frames = framesOf(err);
  if (frames) scrubbed.stack = `${scrubbed.name}: ${scrubbed.message}\n${frames}`;
  /* Only when it is a SQLSTATE. `err.code` on a `pg` connection failure can be
     `ENOENT` (a unix socket that is not there), and src/routes.ts reads exactly
     that value to answer 404 — so copying it blindly would turn "the database
     is down" into "no such article". */
  if (sqlstate) Object.assign(scrubbed, { code: sqlstate });

  /* The diagnostics, as fields, from the one place that still has them. Every
     value here is chosen by Postgres or by our own schema — a SQLSTATE, a
     constraint name, a table name, the C function that raised it. Deliberately
     absent: `message`, `detail`, `hint`, `where`, `internalQuery`, `params`. */
  const d = (driver ?? {}) as Record<string, unknown>;
  logger.error(
    {
      where,
      sqlstate,
      errorType: classNameOf(err),
      driverType: driver === undefined ? undefined : classNameOf(driver),
      table: typeof d.table === "string" ? d.table : undefined,
      constraint: typeof d.constraint === "string" ? d.constraint : undefined,
      column: typeof d.column === "string" ? d.column : undefined,
      routine: typeof d.routine === "string" ? d.routine : undefined,
      transient: failure === STORAGE_BUSY,
    },
    "database call failed",
  );

  return scrubbed;
}

/**
 * The mark a guarded store carries, and the question a test can ask of it.
 *
 * **Why a brand rather than a grep.** The rule this file is about — every
 * Postgres store is wrapped — was kept by three call sites and broken by three
 * others, and the three that broke it looked exactly like ordinary code. A
 * source scan can say "this file mentions `guardDbStore`"; only the object
 * itself can say "I am wrapped". `tests/store-guarded.test.ts` asks the objects.
 *
 * Non-enumerable and a symbol, so nothing that walks a store's properties — the
 * wrapper below included — can see it or copy it by accident.
 */
const GUARDED = Symbol.for("spideryarn.guardedDbStore");

/** Whether this object came out of `guardDbStore`, and under what name. */
export function isGuardedStore(store: unknown): string | undefined {
  if (store === null || typeof store !== "object") return undefined;
  const mark = (store as Record<symbol, unknown>)[GUARDED];
  return typeof mark === "string" ? mark : undefined;
}

/**
 * A store whose methods cannot leak, whatever they throw.
 *
 * Wrapping the object rather than each method is the point. A guard you have to
 * remember to apply is a guard that is missing from the method somebody adds
 * next year, and this migration has a written history of exactly that
 * (docs/plans/simplification-audit.md, Rule 1: *grep the genre, not the list*).
 *
 * The two casts inside are the price of doing it once: the wrapper has to take
 * every method shape in `contracts.ts` at the same time, so it is written
 * against `(...args: unknown[])` and cast back to `T` on the way out, which is
 * what keeps the caller's types exact. The alternative is one wrapper per
 * store, which is five copies of the same six lines and five chances to forget.
 */
export function guardDbStore<T extends object>(what: string, store: T): T {
  const guarded: Record<string, unknown> = {};
  /* The mark `isGuardedStore` reads. Non-enumerable so that it is invisible to
     `Object.entries` — including this function's own loop, so wrapping a
     wrapped store stays harmless — and to anything that copies or serialises a
     store. A symbol rather than a string key for the same reason. */
  Object.defineProperty(guarded, GUARDED, { value: what, enumerable: false });
  let wrapped = 0;
  for (const [key, value] of Object.entries(store)) {
    if (typeof value !== "function") {
      guarded[key] = value;
      continue;
    }
    wrapped += 1;
    const call = (value as (...args: unknown[]) => unknown).bind(store);
    const where = `${what}.${key}`;
    guarded[key] = (...args: unknown[]): unknown => {
      try {
        const result = call(...args);
        /* `.then(undefined, …)` rather than `.catch(…)`, so a store that
           returns a thenable which is not a `Promise` still works. Sync throws
           are caught by the `try`, which is not redundant: a store method may
           validate its arguments before it ever awaits. */
        return result instanceof Object && typeof (result as Promise<unknown>).then === "function"
          ? (result as Promise<unknown>).then(undefined, (err: unknown) => {
              throw scrubDbError(where, err);
            })
          : result;
      } catch (err) {
        throw scrubDbError(where, err);
      }
    };
  }
  /* `Object.entries` sees **own enumerable** properties, and a class's methods
     are neither — they live on the prototype. So a store written as a `class`
     instead of an object literal would come back through here with every method
     missing, and the guard would report success having wrapped nothing. Every
     store is a literal today; this is the line that makes tomorrow's class a
     loud failure at boot rather than a `TypeError` on one route.
     docs/reusable/silent-success.md. */
  if (wrapped === 0) {
    throw new Error(
      `guardDbStore found no methods on ${what}. If it is a class instance, its methods are on the ` +
        "prototype, where Object.entries cannot see them — and an unguarded store can put the " +
        "article into a 500. See src/store/db-errors.ts.",
    );
  }
  return guarded as T;
}

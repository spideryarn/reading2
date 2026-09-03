/**
 * One failure, one diagnostic — even when a store has been guarded twice.
 *
 * ## Why this file exists
 *
 * `docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md`
 * moves `guardDbStore` off the `guarded()` helper in `src/store/index.ts` and
 * onto each Postgres adapter's own export, so that a store is wrapped where it
 * is *built* rather than where it happens to be selected. That move is only
 * safe if wrapping twice is a no-op, because for one commit some stores are
 * wrapped at both ends.
 *
 * **We believed it was, and it was not.** The docstring inside `guardDbStore`
 * said *"so wrapping a wrapped store stays harmless"*, which is narrowly true —
 * it is about the non-enumerable mark not being re-enumerated by the wrapper's
 * own `Object.entries` loop — and it was read as a general guarantee twice on
 * the day the plan was written, once by this repo's own plan and once by a
 * reviewer. Probed with a fake `23505`, a doubly-wrapped store produced **two**
 * `database call failed` log lines for one rejected call, and the second was
 * degraded: no `table`, no `constraint`, no `routine`, and `errorType:
 * "StoreFailure"` — a line reporting a database failure while naming our own
 * wrapper as the thing that failed.
 *
 * **The first version of this paragraph then said the caller-facing contract
 * survived intact, and that was false.** What survives a second scrub is the
 * SQLSTATE — it is copied onto the scrubbed error as `code`, so the 404/409
 * mapping (docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md) really
 * was never at risk, and probing with a `23505` is what made the defect look
 * purely cosmetic. An **errno** does not survive, by design: `scrubDbError`
 * copies `code` only when it is a SQLSTATE, because an `ENOENT` would otherwise
 * become a 404. So a second scrub found nothing transient and turned
 * `STORAGE_BUSY` into `STORAGE_FAILED` — `kind: "retry"` into `kind: "bug"`,
 * which src/jobs.ts persists as `bug` and which removes the reader's Retry
 * button. GPT Sol measured exactly that on the parent commit, 2026-09-03, and
 * the last two describes in this file are what pin it.
 *
 * Be precise about the code as it stands, which is the other way to get this
 * wrong: the downgrade **cannot happen now**. Two things stop it, and they are
 * not symmetric — the `SCRUBBED` mark on the error covers both shapes on its
 * own, and the early return in `guardDbStore` covers only the same object
 * wrapped twice, where what it uniquely buys is handing that same object back.
 * Measured by disabling each in turn, 2026-09-03; the describe below the errno
 * tests says which test goes red for which.
 *
 * ## No database
 *
 * Nothing here connects. `guardDbStore` is a wrapper around an object, and the
 * errors are hand-built in the shapes `pg` and Drizzle produce, so this runs on
 * a fresh clone.
 */

import { describe, expect, it, vi } from "vitest";

/**
 * The log level, raised before any import — the same trap
 * `tests/helpers/log-capture.ts` documents. `level()` in `src/log.ts` is read
 * once at that module's load and vitest sets `NODE_ENV=test`, which makes it
 * `silent`; a silent logger writes nothing, and "exactly one log line" is
 * satisfied perfectly by zero. `error`, because the line under test is an
 * `error`. A more verbose level from the command line is left alone.
 */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  if (previousLevel === undefined || ["silent", "fatal"].includes(previousLevel)) {
    process.env.LOG_LEVEL = "error";
  }
  return { previousLevel };
});

import { guardDbStore, isGuardedStore } from "../src/store/db-errors.js";
import { STORAGE_BUSY, STORAGE_FAILED } from "../src/messages.js";
import { logLinesWhile } from "./helpers/log-capture.js";

/* Straight back after the imports: vitest reuses a worker across files and does
   not reset `process.env` between them, and src/log.ts has read it by now. */
if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
else process.env.LOG_LEVEL = HOISTED.previousLevel;

/**
 * A unique violation as `pg` actually delivers one, under Drizzle's wrapper.
 *
 * `23505` on purpose: it is the code `src/comments.ts` and `src/store/pg-jobs.ts`
 * read to tell an id clash from a fault, so if double wrapping ever did break
 * the SQLSTATE it would break a 409 in production and nothing else.
 */
function uniqueViolation(): Error {
  return new Error("Failed query: insert into \"comments\" … \nparams: …", {
    cause: Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      table: "comments",
      constraint: "comments_pkey",
      routine: "_bt_check_unique",
    }),
  });
}

/**
 * A connection that dropped mid-query, as `pg` delivers one: **an errno and no
 * SQLSTATE at all**, under Drizzle's wrapper.
 *
 * This is the shape that makes the two tests below different from the `23505`
 * ones above. A SQLSTATE survives a second scrub — it is copied onto the
 * scrubbed error as `code`, so a second pass finds it again — but an errno is
 * not, and deliberately never was: `scrubDbError` copies `code` only when it is
 * a SQLSTATE, because an `ENOENT` from a missing unix socket would otherwise
 * become the route's 404. So a second scrub would see an error with nothing
 * transient about it, and `STORAGE_BUSY` would become `STORAGE_FAILED`: `kind:
 * "retry"` becomes `kind: "bug"`, which `src/jobs.ts` persists as `bug` and
 * which takes the Retry button off the reader's card. A caller-facing
 * downgrade, not a cosmetic one.
 */
function connectionDropped(): Error {
  return new Error("Failed query: select … \nparams: …", {
    cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
  });
}

/** A store of one method, which throws whatever it is given. */
function throwing(err: unknown) {
  return {
    async run(): Promise<void> {
      throw err;
    },
  };
}

/** How many `database call failed` lines the logger wrote while `body` ran. */
async function diagnosticsWhile(body: () => Promise<void>): Promise<number> {
  const written = await logLinesWhile(body);
  return written.split("database call failed").length - 1;
}

/**
 * **The half the early return cannot reach: two guarded stores, one failure.**
 *
 * Guarding at the export (stage D'1b) made this shape real for the first time.
 * `pgShelfStore.patch` calls `pgArticleReader.listArticles` through `entryFor`,
 * and `pgArticleReader.articleMetadata` calls `pgReaderStore.readProfile` — two
 * *different* objects, each wrapped, so `guardDbStore`'s "already guarded, hand
 * it back" cannot help. Measured against the running local database on
 * 2026-09-03 with a non-uuid owner, and it produced exactly the two lines the
 * file above was written to abolish:
 *
 *     where: "reader.listArticles"  sqlstate: 22P02  routine: string_to_uuid
 *     where: "shelf.patch"          sqlstate: 22P02  errorType: "StoreFailure"
 *
 * The second names our own wrapper as the failing thing and has lost the
 * routine. The remedy is at the other end from the early return: a scrubbed
 * error is already safe by construction — its message is one of the two
 * sentences in src/messages.ts — so it passes the *next* guard unchanged, and
 * the diagnostic stays where the failure actually happened.
 */
describe("a guarded store calling another guarded store", () => {
  it("logs once, at the seam that actually failed", async () => {
    /* The inner store is the one with the database under it; the outer one is
       an ordinary store that happens to call it, which is what `pg-shelf.ts`
       and `pg.ts` both are. */
    const inner = guardDbStore("reader", throwing(uniqueViolation()));
    const outer = guardDbStore("shelf", {
      async patch(): Promise<void> {
        await inner.run();
      },
    });

    const written = await logLinesWhile(async () => {
      await outer.patch().catch(() => undefined);
    });

    expect(written.split("database call failed").length - 1).toBe(1);
    expect(written).toContain('"where":"reader.run"');
    expect(written).not.toContain('"errorType":"StoreFailure"');
  });

  it("and the reader still gets the SQLSTATE the route reads", async () => {
    const inner = guardDbStore("reader", throwing(uniqueViolation()));
    const outer = guardDbStore("shelf", {
      async patch(): Promise<void> {
        await inner.run();
      },
    });

    const err = (await outer.patch().catch((e: unknown) => e)) as Error & { code?: unknown };
    expect(err.name).toBe("StoreFailure");
    expect(err.code).toBe("23505");
    /* And nothing the database said came with it — the whole point of the file
       this one sits beside. */
    expect(err.message).not.toContain("params");
    expect(err.message).not.toContain("comments");
  });
});

describe("guarding a store that is already guarded", () => {
  it("hands back the very same object", () => {
    /* Identity, not merely "behaves the same". The mark carries the name of the
       seam that wrapped it, and a second wrapper would relabel every diagnostic
       with the outer name — so the inner name surviving is the observable half
       of the same fact. */
    const once = guardDbStore("inner", throwing(uniqueViolation()));
    const twice = guardDbStore("outer", once);

    expect(twice).toBe(once);
    expect(isGuardedStore(twice)).toBe("inner");
  });

  it("logs one diagnostic for one failure, not two", async () => {
    /* The defect this file was written for. Before the early return, this was
       2: `inner.run` with the real SQLSTATE, table and constraint, then
       `outer.run` with none of them and `errorType: "StoreFailure"`. */
    const twice = guardDbStore("outer", guardDbStore("inner", throwing(uniqueViolation())));

    const lines = await diagnosticsWhile(async () => {
      await twice.run().catch(() => undefined);
    });

    expect(lines).toBe(1);
  });

  it("still logs the one diagnostic when wrapped only once", async () => {
    /* The positive control, and it is not ceremony: an early return written
       one condition too wide — or a logger left at `silent` by the hoist above
       — makes the assertion above pass by logging nothing at all, which is the
       shape of success this repo keeps writing postmortems about. */
    const once = guardDbStore("inner", throwing(uniqueViolation()));

    const lines = await diagnosticsWhile(async () => {
      await once.run().catch(() => undefined);
    });

    expect(lines).toBe(1);
  });

  it("keeps the SQLSTATE the route reads, through either number of wrappers", async () => {
    /* The half we had right, pinned so that a future change to the early return
       cannot quietly take it away. `src/routes.ts` answers 409 on a `23505`
       the comment store re-reads, and that mapping is the durable fix from
       docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md. */
    const once = guardDbStore("inner", throwing(uniqueViolation()));
    const twice = guardDbStore("outer", once);

    for (const store of [once, twice]) {
      const err = (await store.run().catch((e: unknown) => e)) as Error & { code?: unknown };
      expect(err.name).toBe("StoreFailure");
      expect(err.code).toBe("23505");
    }
  });
});

/**
 * **The half a SQLSTATE test cannot see: a blip must still read as a blip.**
 *
 * Everything above uses `23505`, which is a *permanent* failure whose only
 * observable is the `code` — so a second scrub degrades its log line and
 * nothing else. An errno is the opposite: it is the transient half, it is
 * carried by nothing that survives a scrub, and the thing it decides is the
 * sentence the reader gets. Measured by GPT Sol on the parent of `e8f27caa`,
 * with both protections absent: one wrapper gave `STORAGE_BUSY`, two gave
 * `STORAGE_FAILED`.
 *
 * **Two protections stop it today, and they are not symmetric.** Measured here
 * by disabling each in turn, 2026-09-03:
 *
 * - Disable the `SCRUBBED` pass-through and the *second* test below goes red,
 *   the first stays green. The early return covers the same object wrapped
 *   twice and nothing else — it is an identity check on one object, and two
 *   *different* guarded stores are invisible to it.
 * - Disable the early return and **both of these stay green**: the mark alone
 *   carries the classification forward through either shape. The only test that
 *   goes red is *"hands back the very same object"*, which is what the early
 *   return uniquely buys.
 *
 * So the first test is not redundant, but nor is it the one holding the line:
 * it pins that the narrower belt agrees with the mark.
 */
describe("a transient failure that carries an errno rather than a SQLSTATE", () => {
  it("is still a blip after the same store is wrapped twice", async () => {
    const twice = guardDbStore("outer", guardDbStore("inner", throwing(connectionDropped())));

    const err = (await twice.run().catch((e: unknown) => e)) as Error;

    expect(err.name).toBe("StoreFailure");
    /* The whole sentence from src/messages.ts, not a substring typed here: the
       failure mode being pinned is *the other sentence*, and `toContain` on a
       word both of them share would be satisfied by it. */
    expect(err.message).toBe(STORAGE_BUSY.message);
  });

  it("is still a blip when one guarded store calls another", async () => {
    const inner = guardDbStore("reader", throwing(connectionDropped()));
    const outer = guardDbStore("shelf", {
      async patch(): Promise<void> {
        await inner.run();
      },
    });

    const err = (await outer.patch().catch((e: unknown) => e)) as Error;

    expect(err.name).toBe("StoreFailure");
    expect(err.message).toBe(STORAGE_BUSY.message);
  });
});

/**
 * **What the `SCRUBBED` mark is allowed to mean.**
 *
 * The mark says *this file made this error, and nobody has touched it since*.
 * That is a strong claim, and the file leans its whole idempotence story on it:
 * an error carrying the mark goes out of a second guard **unread**. Until
 * 2026-09-03 neither half of the claim was true.
 *
 * - The mark was `Symbol.for(...)`, which is the *global* symbol registry —
 *   any module in the process can ask for the same symbol by name. GPT Sol
 *   built an error carrying it and free text, and the guard handed it back
 *   untouched.
 * - `SCRUBBED in err` follows the prototype chain, so an ordinary
 *   `Object.create(scrubbedError)` inherits the mark and can carry its own
 *   message over the top.
 * - Nothing stopped a guarded outer store catching an inner store's scrubbed
 *   error, rewriting `message` or `stack` or hanging a field on it, and
 *   rethrowing. Sol got `SENTINEL-mutated` and `SENTINEL-extra` across.
 *
 * No path in this repo does any of that today, which is why these are
 * regression tests rather than a postmortem. But "no caller does the dangerous
 * thing" is the argument this file exists because it stopped believing, so the
 * marker is module-private and the scrubbed error is frozen, and the mutating
 * store below now fails loudly (a `TypeError` on a frozen object, which the
 * outer guard scrubs like any other bug) instead of quietly succeeding.
 */
describe("an error that only claims this file already scrubbed it", () => {
  /** Everything a scrubbed error could put on a wire, in a log, or in a row. */
  const everyStringOn = (err: unknown): string => {
    if (err === null || typeof err !== "object") return String(err);
    const e = err as Error & Record<string, unknown>;
    return [e.name, e.message, e.stack ?? "", JSON.stringify(e)].join("\n");
  };

  /**
   * A guarded store whose method catches a *real* scrubbed error from a guarded
   * inner store and throws whatever `meddle` makes of it.
   */
  const outerThat = (meddle: (err: unknown) => unknown) => {
    const inner = guardDbStore("reader", throwing(uniqueViolation()));
    return guardDbStore("shelf", {
      async patch(): Promise<void> {
        try {
          await inner.run();
        } catch (err) {
          throw meddle(err);
        }
      },
    });
  };

  it("does not get through by carrying a forged marker", async () => {
    /* The registry, used exactly as any other module could. If this passes the
       guard, the marker is not a marker — it is a password everybody knows. */
    const forged = new Error("SENTINEL-forged");
    Object.defineProperty(forged, Symbol.for("spideryarn.scrubbedDbError"), {
      value: true,
      enumerable: false,
    });

    const err = (await guardDbStore("probe", throwing(forged))
      .run()
      .catch((e: unknown) => e)) as Error;

    expect(everyStringOn(err)).not.toContain("SENTINEL");
    expect(err.message).toBe(STORAGE_FAILED.message);
  });

  it("does not get through by inheriting the marker from a real one", async () => {
    /* `in` is not `hasOwn`, and this is the difference. No symbol is forged
       here at all: the child simply has a scrubbed error for a prototype. */
    const outer = outerThat((err) =>
      Object.assign(Object.create(err as object), { message: "SENTINEL-inherited" }),
    );

    const err = (await outer.patch().catch((e: unknown) => e)) as Error;

    expect(everyStringOn(err)).not.toContain("SENTINEL");
    expect(err.message).toBe(STORAGE_FAILED.message);
  });

  it("does not get through after its message is rewritten", async () => {
    const outer = outerThat((err) => {
      (err as Error).message = "SENTINEL-mutated";
      return err;
    });

    const err = (await outer.patch().catch((e: unknown) => e)) as Error;

    expect(everyStringOn(err)).not.toContain("SENTINEL");
    expect(err.message).toBe(STORAGE_FAILED.message);
  });

  it("does not get through after a field is hung on it", async () => {
    /* An enumerable own property is the worst of the three: `JSON.stringify` of
       an error keeps exactly those, which is how Drizzle's `params` reached a
       response body in the first place. */
    const outer = outerThat((err) => Object.assign(err as object, { extra: "SENTINEL-extra" }));

    const err = (await outer.patch().catch((e: unknown) => e)) as Error;

    expect(everyStringOn(err)).not.toContain("SENTINEL");
    expect(err.message).toBe(STORAGE_FAILED.message);
  });

  it("does not get through after its stack is rewritten", async () => {
    /* The one `Object.freeze` alone does not cover, and it is worth knowing
       why: V8 gives an `Error` an own *accessor* `stack`, and freezing an
       accessor leaves its setter working. So `scrubDbError` redefines `stack`
       as a non-writable data property before it freezes. Probed on node 26,
       2026-09-03. */
    const outer = outerThat((err) => {
      (err as Error).stack = "StoreFailure: SENTINEL-stack";
      return err;
    });

    const err = (await outer.patch().catch((e: unknown) => e)) as Error;

    expect(everyStringOn(err)).not.toContain("SENTINEL");
    expect(err.message).toBe(STORAGE_FAILED.message);
  });
});

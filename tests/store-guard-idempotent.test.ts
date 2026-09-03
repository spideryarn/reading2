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
 * The caller-facing contract did survive: the SQLSTATE is preserved through
 * both layers, so the 404/409 mapping
 * (docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md) was never at
 * risk. The defect is duplicated and misleading diagnostics — which in a
 * codebase whose chronic failure is checks that agree with the bug
 * (docs/reusable/silent-success.md) is not acceptable noise.
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

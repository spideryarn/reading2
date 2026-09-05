/**
 * The `schema` block in `GET /api/health`, tested at the handler.
 *
 * Written because GPT Sol's review of the built code pointed out that every
 * existing health test would pass unchanged **if the schema integration were
 * deleted entirely** — nothing asserted the block, the warning, or the 503. A
 * feature no test would miss is a feature nothing is holding in place.
 *
 * The database is mocked here on purpose. tests/db-schema-drift.test.ts proves
 * the query against a real Postgres; what is unproven, and what this file is
 * for, is the wiring: that a result becomes a `schema` block, that a rejection
 * becomes `schema.error` and a 503 rather than a clean empty answer, that a
 * filesystem store skips it, and that the cache really does coalesce.
 *
 * Every module is re-imported per test because the cache is module-level state.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The error lines the handler wrote. See the longer note in tests/health.test.ts
 * for why this is a mock and not a spy on stdout: src/log.ts is silent under
 * test and writes to fd 1 directly, so nothing observable from here would be.
 */
const logged = vi.fn();

vi.mock("../src/log.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/log.js")>();
  const silent = {
    debug() {},
    info() {},
    warn() {},
    error: logged,
    child() {
      return silent;
    },
  };
  return { ...actual, log: () => silent };
});

/** Rows as `information_schema` would give them for one healthy table. */
function row(column: string, extra: Record<string, unknown> = {}) {
  return {
    schema_usable: true,
    table_name: "jobs",
    column_name: column,
    is_nullable: "YES",
    column_default: null,
    is_generated: "NEVER",
    is_identity: "NO",
    selectable: true,
    ...extra,
  };
}

/** Every column the code declares, so a mocked healthy database is complete. */
async function healthyRows() {
  const { declaredTables } = await import("../src/db/schema-drift.js");
  return declaredTables().flatMap((t) =>
    t.columns.map((c) =>
      row(c.name, {
        table_name: t.table,
        is_nullable: c.notNull ? "NO" : "YES",
        column_default: c.hasDefault ? "something" : null,
      }),
    ),
  );
}

type Call = { status: number; body: Record<string, any> };

/** Load a fresh handler with `getDb` and `STORE` mocked, then call it. */
async function callHealth(opts: {
  execute?: () => Promise<unknown>;
}): Promise<{
  call: () => Promise<Call>;
  executeCalls: () => number;
  schemaQueries: () => number;
}> {
  vi.resetModules();

  /**
   * Every statement the handler ran, as text.
   *
   * **Counted per query rather than in total**, because this endpoint now makes
   * two independent reads — the schema drift check here, and the migration
   * ledger check that lets the remote box tell whether a deployment's code and
   * its schema are in step. A single total would go red the next time a third
   * one is added, and — worse — a bare `toBe(1)` would go *green* if the schema
   * query stopped running and something else ran twice. Naming which query is
   * being counted is what keeps this a test of the schema cache.
   */
  const queries: string[] = [];
  let executeCalls = 0;
  const execute =
    opts.execute ??
    (async () => ({ rows: await healthyRows() }));

  vi.doMock("../src/db/client.js", () => ({
    getDb: () => ({
      execute: async (...args: unknown[]) => {
        executeCalls += 1;
        /* `sql.raw` keeps the text in `queryChunks[0].value`; going through
           JSON rather than reaching into drizzle's internals means this keeps
           working whatever shape the chunk is, and simply matches nothing if
           the shape changes — which the positive controls below would catch. */
        queries.push(JSON.stringify(args[0] ?? ""));
        return execute(...(args as []));
      },
    }),
  }));

  vi.doMock("../src/store/index.js", () => ({
    listArticles: async () => [{ slug: "a" }],
  }));

  const { health } = await import("../src/vercel-health.js");

  const schemaQueries = () => queries.filter((q) => q.includes("information_schema")).length;

  const call = async (): Promise<Call> => {
    const req = {
      method: "GET",
      url: "/api/health",
      headers: {},
      on(event: string, cb: () => void) {
        if (event === "end") cb();
        return this;
      },
    } as unknown as IncomingMessage;

    let status = 0;
    let payload = "";
    const res = {
      statusCode: 200,
      setHeader() {},
      end(text: string) {
        status = (this as { statusCode: number }).statusCode;
        payload = text;
      },
    } as unknown as ServerResponse;

    await health(req, res);
    return { status, body: JSON.parse(payload) };
  };

  return { call, executeCalls: () => executeCalls, schemaQueries };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  logged.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.doUnmock("../src/db/client.js");
  vi.doUnmock("../src/store/index.js");
});

describe("the schema block", () => {
  it("reports a clean database and adds no warning of its own", async () => {
    const { call } = await callHealth({});
    const { body } = await call();
    expect(body.schema).toMatchObject({ missing: [], requiredExtra: [], defaultLost: [] });
    expect(body.warnings.filter((w: string) => w.includes("column"))).toEqual([]);
  });

  it("names a missing column and fails the check", async () => {
    const rows = (await healthyRows()).filter(
      (r) => !(r.table_name === "jobs" && r.column_name === "profile"),
    );
    const { call } = await callHealth({ execute: async () => ({ rows }) });
    const { status, body } = await call();

    expect(body.schema.missing).toEqual(["jobs.profile"]);
    expect(body.warnings.join(" ")).toContain("jobs.profile");
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
  });

  it("turns a failed query into schema.error and a 503, never a clean empty answer", async () => {
    /* The failure this whole file exists to rule out: a query that throws and a
       report that says "nothing missing" are the same shape unless something
       distinguishes them. docs/reusable/silent-success.md. */
    const { call } = await callHealth({
      execute: async () => {
        throw new Error("permission denied for schema spideryarn");
      },
    });
    const { status, body } = await call();

    expect(body.schema.error).toContain("permission denied");
    expect(body.schema.missing).toBeUndefined();
    expect(status).toBe(503);
    /* And the operator gets the whole of it. The caller's copy is truncated to
       200 characters, which is only safe while the untruncated one is somewhere
       — the same bargain the store check makes in tests/health.test.ts. */
    const errors = logged.mock.calls.map(([fields]) => (fields as { err?: Error })?.err?.message ?? "");
    expect(errors.join(" ")).toContain("permission denied for schema spideryarn");
  });

  it("truncates the error rather than handing a stranger the whole driver message", async () => {
    const { call } = await callHealth({
      execute: async () => {
        throw new Error("x".repeat(500));
      },
    });
    const { body } = await call();
    expect(body.schema.error.length).toBe(200);
  });

  /* A case stood here until 2026-09-05 saying the schema check was **absent** —
     not null — on a filesystem store, and that it touched no database. Its
     subject went with the flag; the check is unconditional now. */

  it("coalesces concurrent callers onto one query", async () => {
    /* The cache alone does not do this — it is written after the await, so a
       burst on a cold cache all miss and all query. The existing store check
       had exactly this bug, found in an earlier review. */
    const { call, schemaQueries } = await callHealth({});
    await Promise.all(Array.from({ length: 25 }, () => call()));
    expect(schemaQueries()).toBe(1);
  });

  it("asks again once the cache has expired", async () => {
    const { call, schemaQueries } = await callHealth({});
    await call();
    expect(schemaQueries()).toBe(1);
    /* CACHE_MS is 30s. A check that never re-asks would report a database fixed
       an hour ago as still broken. */
    vi.advanceTimersByTime(31_000);
    await call();
    expect(schemaQueries()).toBe(2);
  });
});

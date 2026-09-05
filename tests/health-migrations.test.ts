/**
 * The `migrations` block in `GET /api/health`, tested at the handler.
 *
 * `tests/migration-digest.test.ts` owns the arithmetic — what a digest is, and
 * which way two ledgers differ. What is unproven without this file is the
 * **wiring**, which is the half that would pass unchanged if the whole
 * integration were deleted: that a ledger read becomes a `migrations` block,
 * that a build needing an unapplied migration *warns* and therefore 503s, that
 * a database merely running ahead of an old build stays **silent**, and that an
 * unreadable ledger becomes an error rather than an empty one.
 *
 * That last pair is the point of the whole feature. Get the direction wrong and
 * this endpoint 503s a healthy site on every single deploy, because
 * `npm run deploy` migrates before it pushes — so the deployment still serving
 * traffic always spends a minute behind the schema.
 *
 * docs/plans/260902a-remote-box-runs-production-migrations-without-a-human-in-the-loop.md
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

type Call = { status: number; body: Record<string, any>; warnings: string[] };

/**
 * A handler whose ledger query answers `rows`, and whose schema query answers
 * healthily — so anything this file reports comes from the migration block and
 * not from drift next door.
 */
async function callHealth(opts: {
  ledger?: () => Promise<{ rows: unknown[] }>;
  expected?: { tag: string; hash: string; created_at: number }[];
}): Promise<() => Promise<Call>> {
  vi.resetModules();

  const { declaredTables } = await import("../src/db/schema-drift.js");
  const healthyRows = declaredTables().flatMap((t) =>
    t.columns.map((c) => ({
      schema_usable: true,
      table_name: t.table,
      column_name: c.name,
      is_nullable: c.notNull ? "NO" : "YES",
      column_default: c.hasDefault ? "something" : null,
      is_generated: "NEVER",
      is_identity: "NO",
      selectable: true,
    })),
  );

  vi.doMock("../src/db/client.js", () => ({
    getDb: () => ({
      execute: async (...args: unknown[]) => {
        const text = JSON.stringify(args[0] ?? "");
        if (text.includes("__drizzle_migrations")) {
          return opts.ledger ? await opts.ledger() : { rows: [] };
        }
        return { rows: healthyRows };
      },
    }),
  }));

  vi.doMock("../src/store/index.js", () => ({
    listArticles: async () => [{ slug: "a" }],
  }));

  /* The build stamp for the migrations this artefact needs. There is no
     `define` under test, so the handler reads an empty list unless a test says
     otherwise — which is why every case here sets it explicitly. */
  vi.stubGlobal("__SPIDERYARN_EXPECTED_MIGRATIONS__", opts.expected ?? []);

  const { health } = await import("../src/vercel-health.js");

  return async (): Promise<Call> => {
    const req = {
      method: "GET",
      url: "/api/health",
      headers: {},
      on(event: string, cb: () => void) {
        if (event === "end") cb();
        return this;
      },
    } as unknown as IncomingMessage;

    let status = 200;
    let raw = "";
    const res = {
      set statusCode(v: number) {
        status = v;
      },
      get statusCode() {
        return status;
      },
      setHeader() {},
      end(chunk?: string) {
        raw = chunk ?? "";
      },
    } as unknown as ServerResponse;

    await health(req, res);
    const body = JSON.parse(raw) as Record<string, any>;
    return { status, body, warnings: (body.warnings as string[]) ?? [] };
  };
}

const ledgerRow = (created_at: number, hash: string) => ({ created_at, hash });
const needs = (created_at: number, hash: string, tag: string) => ({ created_at, hash, tag });

beforeEach(() => {
  logged.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the migrations block", () => {
  it("reports both sides, so a reader can compare without a database", async () => {
    const call = await callHealth({
      expected: [needs(1, "aa", "0001_a")],
      ledger: async () => ({ rows: [ledgerRow(1, "aa")] }),
    });
    const { body } = await call();

    expect(body.migrations.expected.count).toBe(1);
    expect(body.migrations.applied.count).toBe(1);
    expect(body.migrations.expected.digest).toBe(body.migrations.applied.digest);
    expect(body.migrations.missing).toEqual([]);
    expect(body.migrations.ahead).toBe(0);
  });

  /** The state the whole feature exists to make visible. */
  it("names the unapplied migration, warns, and 503s", async () => {
    const call = await callHealth({
      expected: [needs(1, "aa", "0001_a"), needs(2, "bb", "0048_the_new_one")],
      ledger: async () => ({ rows: [ledgerRow(1, "aa")] }),
    });
    const { body, status, warnings } = await call();

    expect(body.migrations.missing).toEqual(["0048_the_new_one"]);
    expect(warnings.join(" ")).toContain("0048_the_new_one");
    expect(status).toBe(503);
  });

  /**
   * **The regression that would make this feature unshippable.**
   *
   * Migrations are applied before the push, so the deployment serving traffic
   * is always briefly behind. If that warned, every deploy would 503 a working
   * site — and a check that cries wolf on every deploy gets turned off.
   */
  it("stays silent when the database has moved ahead of this build", async () => {
    const call = await callHealth({
      expected: [needs(1, "aa", "0001_a")],
      ledger: async () => ({ rows: [ledgerRow(1, "aa"), ledgerRow(2, "bb")] }),
    });
    const { body, warnings } = await call();

    expect(body.migrations.ahead).toBe(1);
    expect(body.migrations.missing).toEqual([]);

    /* Scoped to migrations rather than asserting no warnings at all: this test
       environment has no OPENROUTER_API_KEY or Supabase keys, so the endpoint
       is legitimately unhappy about other things. The claim being made here is
       only that the migration check contributed nothing — and the case above
       proves it is capable of contributing, which is what stops this passing
       vacuously. */
    expect(warnings.filter((w) => /migration/i.test(w))).toEqual([]);
  });

  /**
   * The grant this needs is the one most likely to be absent, and its refusal
   * must not read as "nothing has ever been applied" — opposite facts.
   */
  it("reports a refused ledger as an error rather than an empty one", async () => {
    const call = await callHealth({
      expected: [needs(1, "aa", "0001_a")],
      ledger: async () => {
        throw new Error("permission denied for schema spideryarn_migrations");
      },
    });
    const { body, status, warnings } = await call();

    expect(body.migrations.error).toContain("permission denied");
    expect(body.migrations.applied).toBeUndefined();
    /* And crucially NOT reported as the build's migration being missing, which
       is what an empty-ledger reading would have produced. */
    expect(body.migrations.missing).toBeUndefined();
    expect(warnings.join(" ")).toContain("could not be read");
    expect(status).toBe(503);

    const errors = logged.mock.calls.map(([f]) => (f as { err?: Error })?.err?.message ?? "");
    expect(errors.join(" ")).toContain("permission denied");
  });

  it("truncates a driver message rather than handing a stranger all of it", async () => {
    const call = await callHealth({
      ledger: async () => {
        throw new Error("x".repeat(500));
      },
    });
    const { body } = await call();
    expect(body.migrations.error.length).toBe(200);
  });

  /* A case stood here until 2026-09-05 saying the migration report was **absent**
     — not null — on a filesystem store, because there was no ledger to read and
     "not checked" must not read as "checked and in step". The store it named is
     gone and the report is now unconditional, so the state it described cannot
     be reached. docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § F. */
});

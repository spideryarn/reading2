import { afterEach, beforeEach, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ rows: [] as { s: unknown }[], query: 0, end: vi.fn() }));

vi.mock("../src/env.js", () => ({ resolveTargetUrl: () => "postgres://stub/report" }));
vi.mock("../src/db/ssl.js", () => ({ sslDecisionFor: () => ({ ssl: false }), withoutPassword: () => "stub" }));
vi.mock("pg", () => ({ Pool: class { end = database.end; } }));
vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: () => ({
    transaction: async (run: (tx: unknown) => Promise<void>) => run({
      execute: async () => {
        const rows = [ [{ ro: "on" }], database.rows, [], [{ presses: 0 }] ][database.query++];
        if (!rows) throw new Error("unexpected report query");
        return { rows };
      },
    }),
  }),
}));

const passed = { result: "passed", attempts: 1, retriedAfterFlag: false, stored: 1 };
const paragraphs = [
  { text: "What it asks.", ids: ["spya-aaaaaa"] },
  { text: "Why it matters.", ids: ["spya-bbbbbb"] },
];

function row(middle?: unknown) {
  return {
    version: "simple/2", promptVersion: "simple-prompt/7", generator: "stub",
    slug: "s", sourceHash: "h", generatedAt: "2026-10-03T09:00:00Z", elapsedMs: 1, profileHash: null,
    levels: { brief: paragraphs, fuller: [...paragraphs, paragraphs[0]], ...(middle === undefined ? {} : { simple: paragraphs }) },
    check: {
      checker: "simple-check/1", requestedModel: "stub",
      levels: { brief: passed, fuller: passed, ...(middle === undefined ? {} : { simple: middle }) },
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  database.query = 0;
  database.end.mockClear();
});
afterEach(() => vi.restoreAllMocks());

async function report(rows: unknown[]) {
  database.rows = rows.map((s) => ({ s }));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await import("../scripts/simple-check-report.js");
  expect(database.end).toHaveBeenCalledOnce();
  return log.mock.calls.map(([line]) => String(line)).join("\n");
}

it("counts valid historical middle-level flags alongside new two-level records", async () => {
  const flagged = { result: "flagged", attempts: 2, retriedAfterFlag: true, stored: 2, flags: [{ paragraph: 1, why: "changed the claim" }] };
  const text = await report([row(flagged), row()]);
  expect(text).toContain("Stored summaries with a check record: 2 (5 levels)");
  expect(text).toMatch(/first check flagged a level:\s+1 of 5 answered/);
  expect(text).toMatch(/retried after a flag:\s+1 /);
});

it.each([
  "not a check",
  { ...passed, attempts: 99 },
  { result: "unchecked", attempts: 1, retriedAfterFlag: false, stored: 1, failure: "unknown" },
  { result: "unchecked", failure: { toString: null } },
  { result: "flagged", attempts: 2, retriedAfterFlag: true, stored: 2, flags: [{ paragraph: 2, why: "outside the stored text" }] },
  null,
])("reports an invalid historical middle check as unusable rather than counting it: %j", async (middle) => {
  const text = await report([row(middle), row()]);
  expect(text).toContain("Stored summaries with a check record: 1 (2 levels)");
  expect(text).toContain("1 record(s) that do not read as a whole check");
  expect(text).toMatch(/first check flagged a level:\s+0 of 2 answered/);
});

it("reports a historical level with its check missing as an incomplete record", async () => {
  const incomplete = row(passed);
  delete incomplete.check.levels.simple;
  const text = await report([incomplete, row()]);
  expect(text).toContain("Stored summaries with a check record: 1 (2 levels)");
  expect(text).toContain("1 record(s) that do not read as a whole check");
});

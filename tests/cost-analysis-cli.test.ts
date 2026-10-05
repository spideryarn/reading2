/**
 * `npm run cost:analyse`'s command line, its read-only snapshot and its
 * terminal summary — [scripts/cost-analysis.ts](../scripts/cost-analysis.ts).
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md.
 *
 * No database and no network: the snapshot is driven with a fake client, the
 * summary with a hand-built analysis. The queries themselves are held in
 * tests/cost-detail-store.test.ts, which runs them through `readSnapshot`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PRODUCTION_USERS_NOTE,
  readEmails,
  type SnapshotClient,
  UsageError,
  failureLine,
  parseCostAnalysisArgs,
  readSnapshot,
  summaryLines,
} from "../scripts/cost-analysis.js";
import { analyseCosts } from "../src/cost-analysis.js";

const NOW = new Date("2026-10-05T02:15:09.123Z");
const ROOT = "/repo";
const parse = (...argv: string[]) => parseCostAnalysisArgs(argv, NOW, ROOT);

describe("the period", () => {
  it("is the current UTC month when nothing is said", () => {
    /* `currentUtcMonth` reads the real clock, so only its shape is held here. */
    const args = parseCostAnalysisArgs([]);
    expect(args.label).toMatch(/^\d{4}-\d{2} \(UTC\)$/);
    expect(args.since).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(args.until).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect((args.since as string) < (args.until as string)).toBe(true);
    expect(args).toMatchObject({ prod: false, includeNonProduct: false, top: 15, lookupUnpriced: false });
    expect(args.html).toBeUndefined();
    expect(args.json).toBeUndefined();
  });

  it("reads --month as one UTC month, half-open", () => {
    expect(parse("--month", "2026-09")).toMatchObject({
      since: "2026-09-01T00:00:00.000Z",
      until: "2026-10-01T00:00:00.000Z",
      label: "2026-09 (UTC)",
      fileLabel: "2026-09",
    });
    expect(parse("--month", "2026-12").until).toBe("2027-01-01T00:00:00.000Z");
  });

  it("refuses a month that is not one, the way npm run cost does", () => {
    expect(() => parse("--month", "2026-13")).toThrow(UsageError);
    expect(() => parse("--month", "2026-13")).toThrow(/month of 01-12/);
    expect(() => parse("--month", "2026-00")).toThrow(UsageError);
    expect(() => parse("--month", "August")).toThrow(UsageError);
    expect(() => parse("--month")).toThrow(/needs a value/);
  });

  it("reads --since and --until as UTC instants, either alone", () => {
    expect(parse("--since", "2026-09-01", "--until", "2026-10-01")).toMatchObject({
      since: "2026-09-01T00:00:00.000Z",
      until: "2026-10-01T00:00:00.000Z",
      fileLabel: "2026-09-01_2026-10-01",
    });
    const open = parse("--since", "2026-09-01");
    expect(open.until).toBeUndefined();
    expect(open.label).toBe("from 2026-09-01T00:00:00.000Z to before now (UTC)");
    expect(parse("--until", "2026-09-01").since).toBeUndefined();
  });

  it("refuses --since at or after --until, and a date that is not one", () => {
    expect(() => parse("--since", "2026-10-01", "--until", "2026-09-01")).toThrow(/earlier than --until/);
    expect(() => parse("--since", "2026-09-01", "--until", "2026-09-01")).toThrow(UsageError);
    expect(() => parse("--since", "yesterday")).toThrow(/wants a date/);
  });

  it("has no bounds for --all", () => {
    const args = parse("--all");
    expect(args.since).toBeUndefined();
    expect(args.until).toBeUndefined();
    expect(args).toMatchObject({ label: "all recorded calls", fileLabel: "all" });
  });

  it("refuses two periods at once rather than picking one", () => {
    expect(() => parse("--all", "--month", "2026-09")).toThrow(/one period/);
    expect(() => parse("--month", "2026-09", "--since", "2026-09-02")).toThrow(/one period/);
    expect(() => parse("--all", "--until", "2026-09-02")).toThrow(UsageError);
  });
});

describe("the flags", () => {
  it("refuses a flag it does not know, and a stray word", () => {
    expect(() => parse("--production")).toThrow(/Unknown flag "--production"/);
    expect(() => parse("--prod", "--al")).toThrow(UsageError);
    expect(() => parse("2026-09")).toThrow(/Unknown flag/);
  });

  it("reads the switches", () => {
    expect(parse("--prod", "--all", "--include-nonproduct", "--lookup-unpriced", "--top", "3")).toMatchObject({
      prod: true,
      includeNonProduct: true,
      lookupUnpriced: true,
      top: 3,
    });
  });

  it("refuses a --top that is not a whole number of at least one", () => {
    for (const bad of ["0", "-1", "2.5", "ten"]) expect(() => parse("--top", bad), bad).toThrow(UsageError);
    expect(() => parse("--top")).toThrow(/needs a value/);
  });

  it("resolves --commentary to an absolute path, and needs one", () => {
    expect(parse("--commentary", "notes.md").commentary).toBe(path.resolve("notes.md"));
    expect(() => parse("--commentary")).toThrow(/needs a value/);
    expect(() => parse("--commentary", "--html")).toThrow(/needs a value/);
  });
});

describe("the output paths", () => {
  it("default to logs/cost-reports, named for the target, the period and the UTC time", () => {
    const local = parse("--html", "--json");
    const month = local.fileLabel;
    expect(local.html).toBe(`/repo/logs/cost-reports/cost-local-${month}-20261005T021509Z.html`);
    expect(local.json).toBe(`/repo/logs/cost-reports/cost-local-${month}-20261005T021509Z.json`);
    const prod = parse("--prod", "--all", "--json", "--html");
    expect(prod.html).toBe("/repo/logs/cost-reports/cost-production-all-20261005T021509Z.html");
    expect(prod.json).toBe("/repo/logs/cost-reports/cost-production-all-20261005T021509Z.json");
  });

  it("take a path when one follows, and not the next flag", () => {
    const args = parse("--html", "out/x.html", "--json", "--prod");
    expect(args.html).toBe(path.resolve("out/x.html"));
    expect(args.json).toMatch(/cost-production-.*\.json$/);
    expect(args.prod).toBe(true);
  });

  it("write neither file unless asked", () => {
    expect(parse("--prod", "--all")).not.toHaveProperty("html");
    expect(parse("--prod", "--all")).not.toHaveProperty("json");
  });
});

describe("the read-only snapshot", () => {
  function fake(fail: { on?: string } = {}): { client: SnapshotClient; said: string[] } {
    const said: string[] = [];
    const step = (name: string) => {
      said.push(name);
      if (fail.on === name) throw new Error(`${name} failed`);
    };
    const client = {
      connect: async () => step("connect"),
      query: async (text: string) => step(text),
      end: async () => step("end"),
    } as unknown as SnapshotClient;
    return { client, said };
  }

  const BEGIN = "begin transaction isolation level repeatable read read only";

  it("opens one repeatable-read, read-only transaction, does the work, rolls back and closes", async () => {
    const { client, said } = fake();
    const result = await readSnapshot(client, async () => {
      said.push("work");
      return 7;
    });
    expect(result).toBe(7);
    expect(said).toEqual(["connect", BEGIN, "work", "rollback", "end"]);
  });

  it("never commits and never sets anything outside the begin", async () => {
    const { client, said } = fake();
    await readSnapshot(client, async () => undefined);
    expect(said.join("\n")).not.toMatch(/commit|^set /im);
    expect(said.filter((s) => /read only/.test(s))).toEqual([BEGIN]);
  });

  it("rolls back and closes when the work throws, and the work's error is the one seen", async () => {
    const { client, said } = fake();
    await expect(
      readSnapshot(client, async () => {
        throw new Error("the query failed");
      }),
    ).rejects.toThrow("the query failed");
    expect(said).toEqual(["connect", BEGIN, "rollback", "end"]);
  });

  it("does no work when the transaction could not be opened, and still closes", async () => {
    const { client, said } = fake({ on: BEGIN });
    let worked = false;
    await expect(
      readSnapshot(client, async () => {
        worked = true;
      }),
    ).rejects.toThrow(/failed/);
    expect(worked).toBe(false);
    expect(said).toEqual(["connect", BEGIN, "end"]);
  });

  it("fails when the rollback does, rather than returning what it read", async () => {
    const { client, said } = fake({ on: "rollback" });
    await expect(readSnapshot(client, async () => "rows")).rejects.toThrow("rollback failed");
    expect(said.at(-1)).toBe("end");
  });
});

describe("who the users are", () => {
  it("asks nobody for production's accounts: no listing, no request, and the header says why", async () => {
    let listed = 0;
    let fetched = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetched++;
      throw new Error("a production report must make no account request");
    }) as typeof fetch;
    try {
      const labels = await readEmails("production", async () => {
        listed++;
        return [{ id: "x", email: "reader@example.test" }];
      });
      /* And through the default listing, which is the one that would fetch. */
      const byDefault = await readEmails("production");
      expect(listed).toBe(0);
      expect(fetched).toBe(0);
      expect(labels.emails.size).toBe(0);
      expect(byDefault.emails.size).toBe(0);
      expect(labels.note).toBe(PRODUCTION_USERS_NOTE);
      expect(labels.note).toBe("users are shown by id: production email addresses are not read from the box");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("reads no key but the database address for production, anywhere in the script", () => {
    const source = readFileSync(path.join(import.meta.dirname, "../scripts/cost-analysis.ts"), "utf8");
    expect(source).not.toMatch(/readEnvProd|SERVICE_ROLE|SUPABASE_URL/);
  });

  it("uses the local listing for a local report, and falls back to ids when it fails", async () => {
    const named = await readEmails("local", async () => [{ id: "x", email: "dev@example.test" }]);
    expect(named.emails.get("x")).toBe("dev@example.test");
    const failed = await readEmails("local", async () => {
      throw new Error("secret-detail");
    });
    expect(failed.emails.size).toBe(0);
    expect(failed.note).toMatch(/shown as ids/);
    expect(failed.note).not.toContain("secret-detail");
  });
});

describe("a failure's line", () => {
  const databaseError = Object.assign(new Error("password authentication failed for user secret-user at secret-host"), {
    code: "28P01",
  });

  it("withholds a production database error's own words and keeps its code", () => {
    const line = failureLine(databaseError, true);
    expect(line).toBe("The cost analysis failed: Error [28P01] (other details withheld)");
    expect(line).not.toMatch(/secret/);
  });

  it("prints a local one, and one of our own either way", () => {
    expect(failureLine(databaseError, false)).toContain("password authentication failed");
    expect(failureLine(new UsageError("Unknown flag"), true)).toBe("Unknown flag");
  });
});

describe("the terminal summary", () => {
  const analysis = analyseCosts({
    target: { kind: "production", description: "/x/.env.prod → host.example:6543" },
    window: { since: null, until: null, label: "all recorded calls" },
    generatedAt: "2031-04-01T00:00:00.000Z",
    cube: [],
    detail: [],
    emails: new Map(),
    userLabels: "shown as ids",
    includeNonProduct: false,
    top: 15,
    lookups: null,
  });

  it("starts with the Target line, and it says production in capitals", () => {
    const lines = summaryLines(analysis);
    expect(lines[0]).toBe("Target: PRODUCTION (read-only) — /x/.env.prod → host.example:6543");
    expect(lines[1]).toBe("Period: all recorded calls");
    expect(summaryLines({ ...analysis, target: { kind: "local", description: "here" } })[0]).toBe(
      "Target: local — here",
    );
  });

  it("prints the totals with the pockets apart, the four rankings and the leads", () => {
    const text = summaryLines({
      ...analysis,
      totals: {
        ...analysis.totals,
        creditsNanos: 84_793_839_211,
        byokNanos: 4_982_297_420,
        computedNanos: 1_028_351_620,
        recordedNanos: 90_804_488_251,
        calls: 2245,
        pricedCalls: 1944,
        unpricedCalls: 301,
      },
      users: [{ key: "u", label: "user 001bb7a0", recordedNanos: 90e9, share: 0.991, calls: 2242, unpricedCalls: 0, topTasks: [] }],
      leads: [
        {
          id: "x",
          title: "A lead",
          detail: "Measured: something. It does not show anything else.",
          evidence: { facts: [{ label: "Things", value: { kind: "count", count: 51 } }], table: null },
          amountNanos: 23_270_000_000,
          confidence: "measured",
        },
      ],
    }).join("\n");
    expect(text).toContain("Recorded amount   $90.80");
    expect(text).toContain("exact nano-dollars: credits 84793839211, provider keys 4982297420, priced by us 1028351620");
    expect(text).toContain("2,245: 1,944 priced, 301 reporting no money — so the recorded amount is a floor");
    for (const heading of ["Users", "Articles", "Modes or tasks", "Answering models"]) expect(text).toContain(`\n${heading}`);
    expect(text).toMatch(/user 001bb7a0\s+\$90\.00\s+99%\s+2,242 calls/);
    expect(text).toContain("A lead — $23.27 [measured]");
    expect(text).toContain("· Things: 51");
    expect(text).toContain("It does not show anything else.");
  });

  it("says so when there is nothing", () => {
    expect(summaryLines(analysis).join("\n")).toContain("Leads: none");
  });
});

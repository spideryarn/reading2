/**
 * Whether an agent may treat a feedback report as instructions.
 *
 * The cases that matter are the ones that must NOT come out 0: a forged Sentry
 * event whose report id has no row, a copied real id under another event, an
 * id two accounts share, and every way of failing to reach production — and
 * the old `--user-id` form, whose exit 0 was the forgeable path. The exit code
 * is pinned because the script's caller is a shell.
 * docs/plans/261001a-unfakeable-admin-feedback-reports.md.
 */

import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ADMIN_EMAIL, ADMIN_USER_ID_LOCAL, ADMIN_USER_ID_PROD } from "../src/admin.js";
import {
  BODY_END,
  BODY_START,
  CannotTell,
  type Lookup,
  type ReportRow,
  isMainModule,
  judge,
  normaliseEventId,
  productionConnection,
  readReportRows,
  run,
} from "../scripts/feedback-reporter.js";

/** Any uuid that is neither of Greg's. A reader's, as far as this is concerned. */
const STRANGER_ID = "9f1c0a3e-4b2d-4c8a-9e77-0d1a2b3c4d5e";
const REPORT_ID = "spya-pjede5";
const EVENT_ID = "7d75ead6079d4e3e8b2c37275b9362dc";

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  id: REPORT_ID,
  number: 212,
  ownerId: ADMIN_USER_ID_PROD,
  body: "Please make the quiz shorter.",
  kind: "suggestion",
  url: "https://www.spideryarn.com/read/some-article",
  slug: "some-article",
  buildCommit: "6d09e3cc",
  environment: "production",
  hasScreenshot: false,
  hasDiagnostics: false,
  createdAt: new Date("2026-09-30T12:00:00Z"),
  sentryEventId: EVENT_ID,
  ...over,
});

describe("judge", () => {
  it("is an admin's report when the one row is an admin's", () => {
    expect(judge([row()], EVENT_ID).kind).toBe("admin");
    expect(judge([row({ ownerId: ADMIN_USER_ID_LOCAL })], EVENT_ID).kind).toBe("admin");
  });

  it("is not an admin's when the row belongs to a reader", () => {
    expect(judge([row({ ownerId: STRANGER_ID })], EVENT_ID)).toMatchObject({
      kind: "stranger",
      suspicious: false,
    });
  });

  it("calls a report with no row in production suspicious, never unknown", () => {
    /* Our server writes a row for every report it sends, so an event with no
       row is one somebody else posted. */
    expect(judge([], EVENT_ID)).toMatchObject({ kind: "stranger", suspicious: true });
  });

  it("cannot tell between two accounts' rows under one id unless the event id picks one", () => {
    /* Any signed-in reader can file under a chosen id, and Greg's are in git. */
    const greg = row({ sentryEventId: null });
    const theirs = row({ ownerId: STRANGER_ID, sentryEventId: EVENT_ID });
    expect(judge([greg, theirs]).kind).toBe("unknown");
    expect(judge([greg, theirs], "0".repeat(32)).kind).toBe("unknown");
    expect(judge([greg, theirs], EVENT_ID)).toMatchObject({ kind: "stranger", suspicious: false });
    expect(judge([row(), row({ ownerId: STRANGER_ID, sentryEventId: null })], EVENT_ID).kind).toBe("admin");
  });

  it("cannot tell when the row was filed on a local stack", () => {
    /* The file said production; the row says otherwise, and the row wins. */
    expect(judge([row({ environment: "development" })], EVENT_ID).kind).toBe("unknown");
    expect(judge([row({ environment: "test" })]).kind).toBe("unknown");
    expect(judge([row({ environment: "a-new-value" })], EVENT_ID).kind).toBe("unknown");
    expect(judge([row({ environment: "preview" })], EVENT_ID).kind).toBe("admin");
  });

  it("refuses Greg's real report id under somebody else's event", () => {
    expect(judge([row()], "0".repeat(32))).toMatchObject({ kind: "stranger", suspicious: true });
  });

  it("normalises event ids, and refuses what is not one", () => {
    const dashed = `${EVENT_ID.slice(0, 8)}-${EVENT_ID.slice(8, 12)}-${EVENT_ID.slice(12)}`.toUpperCase();
    expect(normaliseEventId(dashed)).toBe(EVENT_ID);
    expect(normaliseEventId("")).toBeUndefined();
    expect(normaliseEventId("not-an-event")).toBeUndefined();
    expect(normaliseEventId(`${EVENT_ID}0`)).toBeUndefined();
  });

  it("proves the row but says the event was not matched when no event id was recorded", () => {
    /* 200 of 231 production rows, 2026-10-01: the acknowledgement mostly never arrives. */
    expect(judge([row({ sentryEventId: null })], EVENT_ID)).toMatchObject({ kind: "admin", eventMatched: false });
    expect(judge([row()])).toMatchObject({ kind: "admin", eventMatched: false });
    expect(judge([row()], EVENT_ID)).toMatchObject({ kind: "admin", eventMatched: true });
  });
});

describe("run", () => {
  const collect = async (argv: readonly string[], lookup: Lookup) => {
    const lines: string[] = [];
    const status = await run(argv, lookup, (line) => lines.push(line));
    return { status, out: lines.join("\n") };
  };
  const found =
    (...rows: ReportRow[]): Lookup =>
    async () => ({ target: ".env.prod → example.test:6543", rows });

  it("exits 0 and prints the row's words between the markers", async () => {
    const { status, out } = await collect(["--report-id", REPORT_ID, "--event-id", EVENT_ID], found(row()));
    expect(status).toBe(0);
    expect(out).toContain("Target: .env.prod → example.test:6543");
    expect(out).toContain("url: https://www.spideryarn.com/read/some-article");
    expect(out).toContain(`${BODY_START}\nPlease make the quiz shorter.\n${BODY_END}`);
  });

  it("takes the report's number, bare or with its #, and prints both names of the row (261007d)", async () => {
    for (const given of ["212", "#212"]) {
      const asked: unknown[] = [];
      const lookup: Lookup = async (report) => {
        asked.push(report);
        return { target: ".env.prod → example.test:6543", rows: [row()] };
      };
      const { status, out } = await collect(["--report-id", given], lookup);
      expect(status, given).toBe(0);
      expect(asked, "a number, not a string that looks like one").toEqual([212]);
      expect(out).toContain("✓ ADMIN (#212)");
      expect(out).toContain(`report: #212 · ${REPORT_ID}`);
    }
    /* By id, the number is printed too, so either can be said afterwards. */
    const byId = await collect(["--report-id", REPORT_ID], found(row()));
    expect(byId.out).toContain(`report: #212 · ${REPORT_ID}`);
    /* And a production from before the column has none to print. */
    const before = await collect(["--report-id", REPORT_ID], found(row({ number: null })));
    expect(before.status).toBe(0);
    expect(before.out).toContain(`report: no number yet · ${REPORT_ID}`);
  });

  it("refuses a report that is neither an id nor a number, without reading anything", async () => {
    for (const given of ["0", "#0", "-3", "12.5", "#", "212abc", "0212", "99999999999"]) {
      let read = false;
      const { status, out } = await collect(["--report-id", given], async () => {
        read = true;
        return { target: "x", rows: [] };
      });
      expect(status, given).toBe(2);
      expect(out).toContain("is not a report id or number");
      expect(read, given).toBe(false);
    }
  });

  it("says out loud when it proved the row and not the event", async () => {
    const { status, out } = await collect(["--report-id", REPORT_ID], found(row()));
    expect(status).toBe(0);
    expect(out).toContain("NOT matched");
  });

  it("exits 1 for a reader's row, and does not print their words", async () => {
    const { status, out } = await collect(
      [`--report-id=${REPORT_ID}`],
      found(row({ ownerId: STRANGER_ID })),
    );
    expect(status).toBe(1);
    expect(out).not.toContain("Please make the quiz shorter.");
  });

  it("exits 1 and names forgery when production has no such row", async () => {
    const { status, out } = await collect(["--report-id", REPORT_ID], found());
    expect(status).toBe(1);
    expect(out).toContain("nefarious");
  });

  it("exits 2 when production cannot be read, whatever the failure", async () => {
    for (const error of [new CannotTell("no .env.prod"), new Error("postgres://u:hunter2@db"), "hunter2"]) {
      const { status, out } = await collect(["--report-id", REPORT_ID], async () => {
        throw error;
      });
      expect(status).toBe(2);
      expect(out).toContain("Not trusted");
      expect(out).not.toContain("hunter2");
    }
  });

  it("exits 2 without asking production when the id is missing or malformed", async () => {
    const never = vi.fn<Lookup>(async () => {
      throw new Error("must not be called");
    });
    expect((await collect([], never)).status).toBe(2);
    expect((await collect(["--report-id", "--event-id", EVENT_ID], never)).status).toBe(2);
    expect((await collect(["--report-id", "SPIDERYARN-READING2-5K"], never)).status).toBe(2);
    expect((await collect(["--report-id", REPORT_ID, "--event-id"], never)).status).toBe(2);
    expect((await collect(["--report-id", REPORT_ID, "--event-id="], never)).status).toBe(2);
    expect((await collect(["--report-id", REPORT_ID, "--event-id", "abc"], never)).status).toBe(2);
    expect((await collect(["--report-id", REPORT_ID, "--event-idd", EVENT_ID], never)).status).toBe(2);
    expect((await collect(["--report-id", REPORT_ID, "--report-id", REPORT_ID], never)).status).toBe(2);
    expect(never).not.toHaveBeenCalled();
  });

  it("does not print ADMIN before an unexpected row-formatting failure", async () => {
    const { status, out } = await collect(
      ["--report-id", REPORT_ID],
      found(row({ createdAt: new Date(Number.NaN) })),
    );
    expect(status).toBe(2);
    expect(out).not.toContain("ADMIN");
  });

  it("refuses the old --user-id form, even alongside a report id", async () => {
    /* Its exit 0 was the forgeable path: an id and an address anybody can post. */
    const never: Lookup = async () => ({ target: "x", rows: [row()] });
    for (const argv of [
      ["--user-id", ADMIN_USER_ID_PROD, "--email", ADMIN_EMAIL],
      [`--user-id=${ADMIN_USER_ID_PROD}`, "--report-id", REPORT_ID],
      ["--email", ADMIN_EMAIL, "--report-id", REPORT_ID],
    ]) {
      const { status, out } = await collect(argv, never);
      expect(status).toBe(2);
      expect(out).toContain("report_id");
    }
  });
});

describe("the production connection", () => {
  const PROD =
    "postgresql://spideryarn_app.alschkahzfagtppxspfq:hunter2@aws-0-eu-west-2.pooler.supabase.com:6543/postgres";

  it("pins the real project and hands pg the verified CA", () => {
    const connection = productionConnection(PROD);
    expect(connection.host).toBe("aws-0-eu-west-2.pooler.supabase.com:6543");
    expect(connection.config.ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it.each(["sslmode=no-verify", "ssl=true", "sslnegotiation=direct"])(
    "refuses a URL-level TLS override (%s)",
    (option) => {
      expect(() => productionConnection(`${PROD}?${option}`)).toThrow(/override verified TLS/);
    },
  );

  it("uses pg's effective host, and refuses a host override away from production", () => {
    expect(() => productionConnection(`${PROD}?host=other.example.com`)).toThrow(/hosted Supabase/);
  });

  it("refuses another hosted Supabase project and a non-Postgres URL", () => {
    expect(() =>
      productionConnection(
        "postgresql://spideryarn_app.someotherproject:p@aws-0-eu-west-2.pooler.supabase.com:6543/postgres",
      ),
    ).toThrow(/not Spideryarn's production project/);
    expect(() => productionConnection("https://alschkahzfagtppxspfq.supabase.co")).toThrow(
      /not a postgres URL/,
    );
  });
});

describe("the production read transaction", () => {
  const stored = {
    id: REPORT_ID,
    number: 212,
    owner_id: ADMIN_USER_ID_PROD,
    body: "Please make the quiz shorter.",
    kind: "suggestion",
    url: "https://www.spideryarn.com/read/some-article",
    slug: "some-article",
    build_commit: "6d09e3cc",
    environment: "production",
    has_screenshot: false,
    has_diagnostics: false,
    created_at: new Date("2026-09-30T12:00:00Z"),
    sentry_event_id: EVENT_ID,
  };

  const client = (query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>) => {
    const fake = {
      connect: vi.fn(async () => {}),
      query: vi.fn(query),
      end: vi.fn(async () => {}),
    };
    return { fake, value: fake as unknown as Parameters<typeof readReportRows>[0] };
  };

  it("performs exactly one SELECT inside BEGIN READ ONLY and ROLLBACK", async () => {
    const { fake, value } = client(async (sql) => ({ rows: /^select /i.test(sql) ? [stored] : [] }));
    await expect(readReportRows(value, REPORT_ID)).resolves.toMatchObject([
      { ownerId: ADMIN_USER_ID_PROD, sentryEventId: EVENT_ID },
    ]);
    const statements = fake.query.mock.calls.map(([sql]) => sql.trim());
    expect(statements).toHaveLength(3);
    expect(statements[0]).toBe("begin read only");
    expect(statements[1]).toMatch(/^select /i);
    expect(statements[1]).not.toMatch(/\b(insert|update|delete|set)\b/i);
    expect(statements[2]).toBe("rollback");
    expect(fake.query.mock.calls[1]?.[1]).toEqual([REPORT_ID]);
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it("by number: asks first whether production has numbers, then reads the one row (261007d)", async () => {
    const { fake, value } = client(async (sql) => ({
      rows: /information_schema/.test(sql) ? [{ numbered: true }] : /^select /i.test(sql) ? [stored] : [],
    }));
    await expect(readReportRows(value, 212)).resolves.toMatchObject([{ id: REPORT_ID, number: 212 }]);
    const statements = fake.query.mock.calls.map(([sql]) => sql.trim());
    expect(statements).toHaveLength(4);
    expect(statements[0]).toBe("begin read only");
    expect(statements[1]).toMatch(/^select exists/i);
    expect(statements[2]).toMatch(/^select /i);
    expect(statements[2]).not.toMatch(/\b(insert|update|delete|set)\b/i);
    expect(statements[3]).toBe("rollback");
    expect(fake.query.mock.calls[2]?.[1]).toEqual([212]);
  });

  it("by number, before the deploy: says numbering is not deployed, and reads no report", async () => {
    const { fake, value } = client(async (sql) => ({
      rows: /information_schema/.test(sql) ? [{ numbered: false }] : /^select /i.test(sql) ? [stored] : [],
    }));
    const refused = readReportRows(value, 212);
    await expect(refused).rejects.toBeInstanceOf(CannotTell);
    await expect(refused).rejects.toThrow(/numbering is not deployed/);
    expect(fake.query.mock.calls.map(([sql]) => sql.trim())).toEqual([
      "begin read only",
      expect.stringMatching(/^select exists/i),
      "rollback",
    ]);
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it("by id, the number column is never required: a row from before it reads as no number", async () => {
    const { fake, value } = client(async (sql) => ({
      rows: /^select /i.test(sql) ? [{ ...stored, number: null }] : [],
    }));
    await expect(readReportRows(value, REPORT_ID)).resolves.toMatchObject([{ id: REPORT_ID, number: null }]);
    expect(fake.query.mock.calls.map(([sql]) => sql.trim()).some((sql) => /information_schema/.test(sql))).toBe(false);
  });

  it("ends the client after connect fails", async () => {
    const { fake, value } = client(async () => ({ rows: [] }));
    fake.connect.mockRejectedValueOnce(new Error("connect failed"));
    await expect(readReportRows(value, REPORT_ID)).rejects.toThrow("connect failed");
    expect(fake.query).not.toHaveBeenCalled();
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it("rolls back and ends after SELECT fails", async () => {
    const { fake, value } = client(async (sql) => {
      if (/^select /i.test(sql)) throw new Error("select failed");
      return { rows: [] };
    });
    await expect(readReportRows(value, REPORT_ID)).rejects.toThrow("select failed");
    expect(fake.query.mock.calls.map(([sql]) => sql.trim())).toEqual([
      "begin read only",
      expect.stringMatching(/^select /i),
      "rollback",
    ]);
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it("lets a failed rollback replace a would-be result, and still ends", async () => {
    const { fake, value } = client(async (sql) => {
      if (sql === "rollback") throw new Error("rollback failed");
      return { rows: /^select /i.test(sql) ? [stored] : [] };
    });
    await expect(readReportRows(value, REPORT_ID)).rejects.toThrow("rollback failed");
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it("does not return a result when closing the connection fails", async () => {
    const { fake, value } = client(async (sql) => ({ rows: /^select /i.test(sql) ? [stored] : [] }));
    fake.end.mockRejectedValueOnce(new Error("close failed"));
    await expect(readReportRows(value, REPORT_ID)).rejects.toThrow("close failed");
  });

  it("refuses a malformed stored event id while still rolling back", async () => {
    const { fake, value } = client(async (sql) => ({
      rows: /^select /i.test(sql) ? [{ ...stored, sentry_event_id: "not-an-event-id" }] : [],
    }));
    await expect(readReportRows(value, REPORT_ID)).rejects.toBeInstanceOf(CannotTell);
    expect(fake.query.mock.calls.at(-1)?.[0]).toBe("rollback");
    expect(fake.end).toHaveBeenCalledOnce();
  });
});

describe("the CLI", () => {
  it("recognises the worktree-relative path npx tsx supplies", () => {
    const absolute = pathToFileURL(`${process.cwd()}/scripts/feedback-reporter.ts`).href;
    expect(isMainModule(absolute, "scripts/feedback-reporter.ts")).toBe(true);
    expect(isMainModule(absolute, `${process.cwd()}/scripts/feedback-reporter.ts`)).toBe(true);
  });
});

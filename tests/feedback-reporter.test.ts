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

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADMIN_EMAIL, ADMIN_USER_ID_LOCAL, ADMIN_USER_ID_PROD } from "../src/admin.js";
import {
  BODY_END,
  BODY_START,
  CannotTell,
  type Lookup,
  type ReportRow,
  judge,
  normaliseEventId,
  run,
} from "../scripts/feedback-reporter.js";

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../scripts/feedback-reporter.ts", import.meta.url));

/** Any uuid that is neither of Greg's. A reader's, as far as this is concerned. */
const STRANGER_ID = "9f1c0a3e-4b2d-4c8a-9e77-0d1a2b3c4d5e";
const REPORT_ID = "spya-pjede5";
const EVENT_ID = "7d75ead6079d4e3e8b2c37275b9362dc";

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
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
    for (const error of [new CannotTell("no .env.prod"), new Error("ECONNREFUSED"), "a string"]) {
      const { status, out } = await collect(["--report-id", REPORT_ID], async () => {
        throw error;
      });
      expect(status).toBe(2);
      expect(out).toContain("Not trusted");
    }
  });

  it("exits 2 without asking production when the id is missing or malformed", async () => {
    const never: Lookup = async () => {
      throw new Error("must not be called");
    };
    expect((await collect([], never)).status).toBe(2);
    expect((await collect(["--report-id", "--event-id", EVENT_ID], never)).status).toBe(2);
    expect((await collect(["--report-id", "SPIDERYARN-READING2-5K"], never)).status).toBe(2);
    expect((await collect(["--report-id", REPORT_ID, "--event-id"], never)).status).toBe(2);
    expect((await collect(["--report-id", REPORT_ID, "--event-id="], never)).status).toBe(2);
    expect((await collect(["--report-id", REPORT_ID, "--event-id", "abc"], never)).status).toBe(2);
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

describe("the CLI", () => {
  it("is wired: the old form exits 2 from a shell, without touching a database", () => {
    const result = spawnSync(TSX, [SCRIPT, "--user-id", ADMIN_USER_ID_PROD], {
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("CANNOT TELL");
  });
});

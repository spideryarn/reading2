/**
 * **The email that tells a reader their feedback is live** — the pure parts of
 * scripts/feedback-shipped-emails.ts, run as the last step of `npm run deploy`.
 * The ledger against a real database is tests/feedback-shipped-emails-ledger.test.ts.
 * docs/plans/261002f-email-readers-when-their-feedback-ships.md.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { AFTER_THE_FACT_CHECKS, afterTheFactSummary, codeMayNotHaveShipped } from "../scripts/deploy-checks.js";
import { GENERATED_PATH, renderModule } from "../scripts/feedback-endings.js";
import {
  planShippedEmails,
  parseCliArgs,
  type Queryable,
  ledgerOutcome,
  runShippedEmails,
  type ShippedRow,
  shippedEmail,
  shippedIdsIn,
  STEP_NAME,
} from "../scripts/feedback-shipped-emails.js";
import { ADMIN_USER_ID_PROD } from "../src/admin.js";
import type { FeedbackEnding } from "../src/feedback-ending-values.js";

const map = (endings: Record<string, FeedbackEnding>) => renderModule(new Map(Object.entries(endings).sort()));
const NOW = new Date("2026-10-02T15:00:00Z");
const READER = "0000f5e1-0000-4000-8000-000000000001";
const OTHER = "0000f5e1-0000-4000-8000-000000000002";
const row = (over: Partial<ShippedRow> & { reportId: string }): ShippedRow => ({
  ownerId: READER,
  kind: "suggestion",
  createdAt: new Date("2026-10-02T10:00:09Z"),
  email: "reader@example.com",
  ledger: null,
  ledgerAttempts: null,
  ...over,
});

describe("the shipped map", () => {
  it("reads the real committed map", () => {
    /* The positive control: the parser understands the file the deploy will hand it. */
    expect(shippedIdsIn(readFileSync(GENERATED_PATH, "utf8")).length).toBeGreaterThan(10);
  });

  it("is the shipped ids only", () => {
    expect(shippedIdsIn(map({ "spya-bbbbbb": "shipped", "spya-aaaaaa": "shipped", "spya-cccccc": "awaiting" }))).toEqual([
      "spya-aaaaaa",
      "spya-bbbbbb",
    ]);
  });

  it("reads the map with its comments beside it, and the older map without (261007d)", () => {
    /* The deploy hands this the file as it was at a commit, so both shapes are live. */
    const endings = new Map<string, FeedbackEnding>([["spya-aaaaaa", "shipped"], ["spya-bbbbbb", "declined"]]);
    const comment = 'Declined. "spya-cccccc": "shipped", is only a sentence here';
    const withComments = renderModule(endings, new Map([["spya-bbbbbb", comment]]));
    expect(withComments).toContain("FEEDBACK_NOTE_COMMENTS");
    expect(shippedIdsIn(withComments)).toEqual(["spya-aaaaaa"]);
    const older = withComments.slice(0, withComments.indexOf("\nexport const FEEDBACK_NOTE_COMMENTS"));
    expect(older).not.toContain("FEEDBACK_NOTE_COMMENTS");
    expect(shippedIdsIn(older)).toEqual(["spya-aaaaaa"]);
  });

  it("refuses a map it cannot read rather than answer none", () => {
    expect(() => shippedIdsIn("export const FEEDBACK_NOTE_ENDINGS = {};\n")).toThrow(/no report endings/);
    /* Partial drift: one line in a new shape among good ones still throws. */
    expect(() => shippedIdsIn(`${map({ "spya-aaaaaa": "shipped" })}  "spya-bbbbbb": { ending: "shipped" },\n`)).toThrow(
      /does not understand/,
    );
  });
});

describe("the command line", () => {
  it("refuses missing values and unknown or duplicate flags", () => {
    for (const args of [
      ["--send", "--retry"],
      ["--send", "--sha"],
      ["--send", "--cap"],
      ["--send", "--unknown"],
      ["--send", "--send"],
    ]) {
      expect(() => parseCliArgs(args)).toThrow(/invalid command line/);
    }
  });

  it("parses a deliberately targeted send", () => {
    expect(parseCliArgs(["--send", "--sha", "abc123", "--cap", "4", "--retry", `${READER}/spya-good01`])).toEqual({
      send: true,
      sha: "abc123",
      cap: 4,
      retry: { ownerId: READER, reportId: "spya-good01" },
    });
  });
});

describe("who gets a letter", () => {
  it("skips an admin, a shared id, a sent or stuck row and an account with no address", () => {
    const plan = planShippedEmails(
      ["spya-admin1", "spya-shared", "spya-gone00", "spya-noaddr", "spya-sent00", "spya-stuck0", "spya-fail00", "spya-good01"],
      [
        row({ reportId: "spya-admin1", ownerId: ADMIN_USER_ID_PROD }),
        row({ reportId: "spya-shared" }),
        row({ reportId: "spya-shared", ownerId: OTHER }),
        row({ reportId: "spya-noaddr", ownerId: OTHER, email: null }),
        row({ reportId: "spya-sent00", ledger: "sent" }),
        row({ reportId: "spya-stuck0", ledger: "sending" }),
        row({ reportId: "spya-fail00", ledger: "failed" }),
        row({ reportId: "spya-good01" }),
      ],
      { now: NOW },
    );
    expect(plan.refused).toBeUndefined();
    expect(Object.fromEntries(plan.skipped)).toEqual({
      "an admin's": ["spya-admin1"],
      "id shared by several owners": ["spya-shared"],
      "no confirmed address": ["spya-noaddr"],
      "already emailed": ["spya-sent00"],
      "a send that may have gone, or was interrupted — needs a person": ["spya-stuck0"],
    });
    expect(plan.noRow).toBe(1);
    /* A definite failure goes again. */
    expect(plan.letters.map((l) => l.reportId)).toEqual(["spya-fail00", "spya-good01"]);
    expect(plan.letters[1]?.email.idempotencyKey).toMatch(/^feedback-shipped\/[0-9a-f]{64}$/);
    expect(plan.letters[1]?.email.idempotencyKey).not.toContain(READER);
    expect(plan.letters[1]?.email.idempotencyKey).not.toContain("spya-good01");
  });

  it("a retry names one report, and may take a stuck one", () => {
    const rows = [row({ reportId: "spya-stuck0", ledger: "sending" }), row({ reportId: "spya-good01" })];
    const plan = planShippedEmails(["spya-stuck0", "spya-good01"], rows, {
      now: NOW,
      retry: { ownerId: READER, reportId: "spya-stuck0" },
    });
    expect(plan.letters.map((l) => l.reportId)).toEqual(["spya-stuck0"]);
    /* Never one that has been sent, and never somebody else's. */
    expect(
      planShippedEmails(["spya-sent00"], [row({ reportId: "spya-sent00", ledger: "sent" })], {
        now: NOW,
        retry: { ownerId: READER, reportId: "spya-sent00" },
      }).letters,
    ).toEqual([]);
    expect(
      planShippedEmails(["spya-good01"], rows, { now: NOW, retry: { ownerId: OTHER, reportId: "spya-good01" } }).letters,
    ).toEqual([]);
  });

  it("sends nothing at all past the cap", () => {
    const rows = [row({ reportId: "spya-aaaaa1" }), row({ reportId: "spya-aaaaa2", ownerId: OTHER })];
    const plan = planShippedEmails(["spya-aaaaa1", "spya-aaaaa2"], rows, { now: NOW, cap: 1 });
    expect(plan.letters).toEqual([]);
    expect(plan.refused).toMatch(/more than the cap of 1/);
  });
});

describe("recording an attempted letter", () => {
  it("keeps provider idempotency conflicts out of automatic retry", () => {
    for (const providerError of ["concurrent_idempotent_requests", "invalid_idempotent_request"] as const) {
      expect(ledgerOutcome({ kind: "failed", reason: `Resend answered 409 ${providerError}`, providerError })).toEqual({
        status: "sending",
        detail: `may have gone: Resend answered 409 ${providerError}`,
      });
    }
  });

  it("reports a shipped id that has no feedback row", async () => {
    const said: string[] = [];
    const result = await runShippedEmails(map({ "spya-gone00": "shipped" }), { send: true }, {
      db: { query: async () => ({ rows: [] }) },
      send: async () => ({ kind: "sent", id: "must not run" }),
      say: (line) => said.push(line),
      now: NOW,
    });
    expect(result).toEqual({ sent: 0, problems: [] });
    expect(said.join("\n")).toContain("spya-gone00");
  });

  it("does not claim success when completion no longer owns the ledger row", async () => {
    let query = 0;
    const db: Queryable = {
      query: async () => {
        query++;
        if (query === 1) {
          return {
            rows: [
              {
                owner_id: READER,
                id: "spya-good01",
                kind: "suggestion",
                created_at: NOW,
                email: "reader@example.com",
                ledger: null,
              },
            ],
          };
        }
        if (query === 2 || query === 3) return { rows: [{ attempts: 1 }] };
        return { rows: [] };
      },
    };
    const result = await runShippedEmails(map({ "spya-good01": "shipped" }), { send: true }, {
      db,
      send: async () => ({ kind: "sent", id: "fake" }),
      say: () => {},
      now: NOW,
    });

    expect(result.sent).toBe(0);
    expect(result.problems.join("\n")).toMatch(/ledger/);
  });
});

describe("the letter", () => {
  const at = new Date("2026-10-02T10:00:09Z");

  it("follows the report's kind, and never says fixed", () => {
    expect(shippedEmail("problem", at, NOW).text).toContain(
      "On 2 October you told us about a problem through the Feedback button in Spideryarn. We've shipped a change in response to it, and it is now live.",
    );
    expect(shippedEmail("suggestion", at, NOW).text).toContain("you sent us a suggestion");
    expect(shippedEmail(null, at, NOW).text).toContain("you sent us feedback");
    for (const kind of ["problem", "suggestion", null] as const) expect(shippedEmail(kind, at, NOW).text).not.toMatch(/fixed/i);
  });

  it("says where to look and how to answer", () => {
    const letter = shippedEmail(null, at, NOW);
    expect(letter.subject).toBe("A change based on your feedback is now live on Spideryarn");
    expect(letter.text).toContain("Feedback → Earlier");
    expect(letter.text).toContain("just reply to this email");
  });

  it("names the year only when it is not this one, in London time", () => {
    /* 23:30 UTC on 31 Dec 2025 is still 2025 in London (GMT). */
    expect(shippedEmail("suggestion", new Date("2025-12-31T23:30:00Z"), NOW).text).toContain("On 31 December 2025");
    /* 23:30 UTC on 1 Oct is 00:30 on 2 Oct in London (BST). */
    expect(shippedEmail("suggestion", new Date("2026-10-01T23:30:00Z"), NOW).text).toContain("On 2 October you");
  });
});

describe("in the deploy", () => {
  it("is an after-the-fact check: a failed letter never says the code may not have shipped", () => {
    expect(AFTER_THE_FACT_CHECKS).toContain(STEP_NAME);
    expect(codeMayNotHaveShipped([STEP_NAME])).toBe(false);
  });

  it("does not claim that no earlier gate was forced", () => {
    expect(afterTheFactSummary([STEP_NAME]).join("\n")).toBe(
      "Deployed, and its live functional checks passed. The failures listed here happened after it was live\n" +
        "(feedback shipped emails) — any forced gates are listed above; this is not a reason to roll back.",
    );
  });
});

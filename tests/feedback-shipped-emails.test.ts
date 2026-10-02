/**
 * **The email that tells a reader their feedback is live** — the pure parts of
 * scripts/feedback-shipped-emails.ts, run as the last step of `npm run deploy`.
 * The ledger against a real database is tests/feedback-shipped-emails-ledger.test.ts.
 * docs/plans/261002f-email-readers-when-their-feedback-ships.md.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { AFTER_THE_FACT_CHECKS, codeMayNotHaveShipped } from "../scripts/deploy-checks.js";
import { GENERATED_PATH, renderModule } from "../scripts/feedback-endings.js";
import {
  planShippedEmails,
  type ShippedRow,
  shippedEmail,
  shippedIdsIn,
  STEP_NAME,
} from "../scripts/feedback-shipped-emails.js";
import { ADMIN_USER_ID_PROD } from "../src/admin.js";
import type { FeedbackEnding } from "../src/feedback-ending-values.js";

const map = (endings: Record<string, FeedbackEnding>) => renderModule(new Map(Object.entries(endings).sort()));
const NOW = new Date("2026-10-02T15:00:00Z");
const READER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const row = (over: Partial<ShippedRow> & { reportId: string }): ShippedRow => ({
  ownerId: READER,
  kind: "suggestion",
  createdAt: new Date("2026-10-02T10:00:09Z"),
  email: "reader@example.com",
  ledger: null,
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

  it("refuses a map it cannot read rather than answer none", () => {
    expect(() => shippedIdsIn("export const FEEDBACK_NOTE_ENDINGS = {};\n")).toThrow(/no report endings/);
    /* Partial drift: one line in a new shape among good ones still throws. */
    expect(() => shippedIdsIn(`${map({ "spya-aaaaaa": "shipped" })}  "spya-bbbbbb": { ending: "shipped" },\n`)).toThrow(
      /does not understand/,
    );
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
    expect(plan.letters[1]?.email.idempotencyKey).toBe(`feedback-shipped/${READER}/spya-good01`);
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
});

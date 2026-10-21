/**
 * **A long PDF costs one slot per 50 pages** — the arithmetic, without a
 * database. The ledger half is tests/billing-long-documents-db.test.ts.
 *
 * > 3 hmmm, tricky. Ok, let's go with 50 instead of 100 pages per slot.
 * >
 * > — Greg, 2026-10-20 (reply `spya-km9brn` to q-x8gdr3)
 *
 * docs/plans/261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md.
 */
import { describe, expect, it } from "vitest";

import {
  admitsHighPower,
  admitsIngest,
  admitsIngestOf,
  admitsUpgrade,
  articles as inArticles,
  budgetFor,
  points,
  PRIVATE_INGEST_COST,
  PUBLIC_INGEST_COST,
} from "../src/billing/points.js";
import { describePlan } from "../src/billing-plan.js";
import { PAGES_PER_SLOT, slotsForPages, uploadLimits } from "../src/uploads.js";

describe("slotsForPages: one slot per 50 pages, rounded up", () => {
  it("prices the boundaries the plan names", () => {
    expect(PAGES_PER_SLOT).toBe(50);
    const cases: [number, number][] = [
      [1, 1],
      [50, 1],
      [51, 2],
      [100, 2],
      [101, 3],
      [150, 3],
      [250, 5],
      [300, 6],
      [301, 7],
      [350, 7],
      [351, 8],
      [400, 8],
    ];
    for (const [pages, slots] of cases) expect([pages, slotsForPages(pages)]).toEqual([pages, slots]);
  });

  it("refuses a count that is not a page count, rather than pricing it at one", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => slotsForPages(bad)).toThrow();
  });

  it("refuses a count past eight slots: the database cannot hold it, so it is a bug upstream", () => {
    expect(() => slotsForPages(401)).toThrow();
  });
});

describe("admitsIngestOf: the ingest wall, weighted", () => {

  it("is admitsIngest at one slot, everywhere", () => {
    const budget = budgetFor(inArticles(3));
    for (let used = 0; used <= 900; used += 2) {
      expect(admitsIngestOf(points(used), budget, 1)).toBe(admitsIngest(points(used), budget));
    }
  });

  it("Greg's pair at 50 pages: two slots left admit 100 pages and refuse 101", () => {
    const budget = budgetFor(inArticles(3));
    const used = points(budget - 2 * PRIVATE_INGEST_COST); // 1 of 3 used, so 2 left
    expect(admitsIngestOf(used, budget, slotsForPages(100))).toBe(true);
    expect(admitsIngestOf(used, budget, slotsForPages(101))).toBe(false);
  });

  it("six slots left: 300 pages admits and 301 is refused", () => {
    const budget = budgetFor(inArticles(20));
    const used = points(budget - 6 * PRIVATE_INGEST_COST);
    expect(admitsIngestOf(used, budget, slotsForPages(300))).toBe(true);
    expect(admitsIngestOf(used, budget, slotsForPages(301))).toBe(false);
  });

  it("a free account cannot import a PDF over 150 pages", () => {
    const budget = budgetFor(inArticles(3));
    expect(admitsIngestOf(points(0), budget, slotsForPages(150))).toBe(true);
    expect(admitsIngestOf(points(0), budget, slotsForPages(151))).toBe(false);
  });

  it("refuses a slot count outside 1..8 rather than admitting it", () => {
    for (const bad of [0, 9, 1.5]) expect(() => admitsIngestOf(points(0), points(10_000), bad)).toThrow();
  });
});

describe("the other two weighted walls", () => {
  it("Read this on a long minimal paper reserves its slots, less the credit", () => {
    const budget = budgetFor(inArticles(3));
    /* A 120-page paper is three slots: 600 − 2 at 2 used fits a free account. */
    expect(admitsUpgrade(points(2), budget, 2, 3)).toBe(true);
    expect(admitsUpgrade(points(202), budget, 2, 3)).toBe(false);
    expect(admitsUpgrade(points(2), budget, 2)).toBe(admitsUpgrade(points(2), budget, 2, 1));
  });

  it("High-powered AI on a long article costs its slots again, still whole", () => {
    const budget = budgetFor(inArticles(20));
    const used = points(budget - 6 * PRIVATE_INGEST_COST);
    expect(admitsHighPower(used, budget, PRIVATE_INGEST_COST, 6)).toBe(true);
    expect(admitsHighPower(used, budget, PRIVATE_INGEST_COST, 7)).toBe(false);
    /* Public halves it, per slot. */
    expect(admitsHighPower(used, budget, PUBLIC_INGEST_COST, 8)).toBe(true);
  });
});

describe("/profile counts articles added and the slots they use apart", () => {
  const free = {
    kind: "free" as const,
    limit: 3,
    used: 1,
    usedSlots: 3,
    sharedHalfPrice: 0,
    atLimit: true,
    highPower: 0,
    minimal: 0,
    remaining: 0,
  };

  it("one 150-page article reads as one article added, using 3 of 3", () => {
    const copy = describePlan(free);
    expect(copy.headline).toBe("Free — 1 article added, using 3 of your 3");
    expect(copy.headline).not.toMatch(/3 articles added/);
  });

  it("a paid plan says the same, this month", () => {
    const copy = describePlan({
      ...free,
      kind: "paid",
      limit: 20,
      tierId: "reader",
      tierName: "Reader",
      periodEnd: "2026-11-01T00:00:00.000Z",
      endsAt: null,
      periodAllowance: 20,
      trial: false,
      atLimit: false,
    });
    expect(copy.headline).toBe("Reader — 1 article added, using 3 of your 20 this month");
  });

  it("an account with no long document reads exactly as before", () => {
    const { usedSlots: _, ...plain } = free;
    expect(describePlan({ ...plain })).toEqual(describePlan({ ...plain, usedSlots: 1 }));
    expect(describePlan(plain).headline).toBe("Free — 1 of 3 articles used");
  });
});

describe("the limits line", () => {
  it("says every 50 pages counts as one article", () => {
    expect(uploadLimits()).toMatch(/every 50 pages counts as one article\.$/);
  });
});

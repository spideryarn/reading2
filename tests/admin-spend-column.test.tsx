/**
 * The spend column on `/admin/users` —
 * [src/web/admin-columns.tsx](../src/web/admin-columns.tsx) and the two fields
 * in [src/admin.ts](../src/admin.ts) that stop its number overclaiming.
 *
 * Greg asked for this column explicitly on 2026-09-02, and GPT Sol withdrew its
 * objection on two conditions:
 *
 * > It does need a defined period — e.g. "current UTC month" — and a visible
 * > partial/unpriced marker. A bare currency number would overclaim.
 *
 * Both conditions are behaviour rather than documentation, so both are tested
 * here. The third test is about the formatter, which is a deliberate second copy
 * of `formatNanos` and therefore a thing that can silently drift.
 */

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { type AdminUser, formatSpendNanos } from "../src/admin.js";
import { formatNanos } from "../src/ai-spend.js";
import { ADMIN_CHIP_ORDER, adminColumns } from "../src/web/admin-columns.js";

const NOW = Date.parse("2026-09-02T12:00:00.000Z");

function user(over: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "ac500000-0000-4000-8000-000000000001",
    email: "reader@example.test",
    createdAt: "2026-08-01T10:00:00.000Z",
    providers: ["google"],
    articles: 3,
    archived: 0,
    uploads: 0,
    questions: 0,
    chats: 0,
    searches: 0,
    opens: 0,
    spendNanos: 1_234_500_000,
    spendCalls: 42,
    spendUnpricedCalls: 0,
    spendMonth: "2026-09",
    /* Not what this file is about, but `AdminUser` requires them: a reader with
       no `billing_accounts` row is on the free tier with nothing used. */
    plan: "free",
    ingests: 0,
    ingestLimit: 3,
    ingestWindow: "lifetime",
    ...over,
  };
}

/**
 * The spend column, narrowed to the two members these tests read.
 *
 * `SortableColumn` is TanStack's `ColumnDef` union, on which `accessorFn` exists
 * only in the accessor arms and `cell` is a template rather than a plain
 * function — so a cast is the honest way in. It is narrowing rather than lying:
 * the column below this cast is the one written five lines away in
 * admin-columns.tsx, with both members present.
 */
function spendColumn() {
  const column = adminColumns(NOW).find((c) => c.id === "spend");
  if (!column) throw new Error("there is no spend column");
  return column as unknown as {
    accessorFn: (u: AdminUser, index: number) => number;
    cell: (ctx: { row: { original: AdminUser } }) => ReactElement;
    meta?: { hint: string };
  };
}

/** What one row of it draws. */
function cellFor(u: AdminUser): string {
  /* Only `row.original` is read, which is the whole of what the cell touches —
     a full TanStack row object here would be scaffolding pretending to be
     coverage. */
  return renderToStaticMarkup(spendColumn().cell({ row: { original: u } }));
}

describe("the number", () => {
  it("draws the money and sorts by it", () => {
    expect(spendColumn().accessorFn(user(), 0)).toBe(1_234_500_000);
    expect(cellFor(user())).toContain("$1.2345");
  });

  it("draws an em dash, not $0.0000, for an account that made no calls", () => {
    /* A zero with a currency sign on it reads as a measurement, and "we
       recorded nothing for this person" is the one thing it is not — the same
       distinction `pocket()` in scripts/ai-cost.ts refuses to blur. The sort
       still treats it as zero, because for ranking who is expensive it is one. */
    const quiet = user({ spendNanos: 0, spendCalls: 0 });
    expect(cellFor(quiet)).toContain("—");
    expect(cellFor(quiet)).not.toContain("$");
    expect(spendColumn().accessorFn(quiet, 0)).toBe(0);
  });
});

describe("the two conditions the column shipped under", () => {
  it("names its period on every cell, from the row rather than the browser's clock", () => {
    /* A currency figure with no window is a number two people will read
       differently. It comes off the row so that a page left open across a month
       boundary says which month the *server* measured, not which one the tab
       thinks it is. */
    expect(cellFor(user({ spendMonth: "2026-08" }))).toContain("2026-08 (UTC)");
    expect(cellFor(user({ spendNanos: 0, spendCalls: 0, spendMonth: "2026-08" }))).toContain(
      "2026-08 (UTC)",
    );
  });

  it("shows a visible marker when some of the calls behind the figure reported nothing", () => {
    /* Not an edge case: on 2026-09-02 the local ledger had 207 of 243 rows
       reporting no cost at all, and a confident `$1.63` drawn over that would
       be the page lying quietly. */
    const short = user({ spendUnpricedCalls: 7 });
    const drawn = cellFor(short);
    expect(drawn).toContain("7 unpriced");
    expect(drawn).toContain("short by an unknown amount");
  });

  it("says nothing about unpriced calls when there are none", () => {
    /* A `0 unpriced` on every row is noise that teaches the eye to skip the
       marker, which costs exactly the signal it was added for. The same rule
       `table()` in scripts/ai-cost.ts follows. */
    expect(cellFor(user({ spendUnpricedCalls: 0 }))).not.toContain("unpriced");
  });

  it("says in its hint that this is not our own eval and CLI spend", () => {
    expect(spendColumn().meta?.hint).toMatch(/eval|CLI/);
    expect(ADMIN_CHIP_ORDER).toContain("spend");
  });
});

describe("the browser's formatter and the server's", () => {
  it("agree, digit for digit", () => {
    /* `formatSpendNanos` is a deliberate second copy of `formatNanos`, forced by
       a bundle boundary: src/ai-spend.ts opens with `node:async_hooks`, so
       importing one function from it would pull the ledger and the gateway
       request shapes into the client bundle — the accident
       tests/client-imports.test.ts exists for. A copy is acceptable; a copy
       nothing checks is not. A report and a page showing different dollars for
       the same account would be argued about for an hour before anybody
       suspected the formatter. */
    for (const nanos of [0, 1, 99, 100_000, 1_234_500_000, 21_523_500, 9_000_000_000, 1e15]) {
      expect(formatSpendNanos(nanos)).toBe(formatNanos(nanos));
    }
  });

  it("does not round a real cost down to a free-looking zero", () => {
    /* Four decimals turn a hundredth of a cent into `$0.0000`, which reads as
       free. `formatNanos` was caught doing exactly that on a live probe five
       minutes after the column it reads was proved right. */
    expect(formatSpendNanos(99)).not.toBe("$0.0000");
    expect(formatSpendNanos(0)).toBe("$0.0000");
  });
});

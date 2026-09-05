/**
 * **The quota query sends values as parameters, not as text.**
 *
 * One assertion, and it exists because the change that would break it looks
 * completely ordinary in a diff: rewriting a `sql` template into string
 * concatenation to "make it readable" produces a query that works perfectly on
 * every input anybody tests it with. Nothing else in the suite would notice.
 *
 * It matters here more than in most places, because the period bounds derive
 * from Stripe subscription data rather than from anything we wrote — so the
 * question is not whether *we* would put a quote in a date, it is whether the
 * statement is built in a way where it could ever matter.
 *
 * No database: this asks the query builder what it would send, which is the
 * thing under test. See src/store/pg-billing.ts.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { articles } from "../src/billing/half-units.js";
import { FREE } from "../src/billing/tiers.js";
import type { Entitlement } from "../src/billing/tiers.js";
import { usageSql } from "../src/store/pg-billing.js";

const dialect = new PgDialect();

/** The shape an injection would need if these were being pasted into a string. */
const HOSTILE_OWNER = "'; drop table spideryarn.ingest_events; --";

const PAID: Entitlement = {
  tier: "paid",
  tierId: "reader",
  limit: articles(100),
  periodStart: new Date("2026-09-01T00:00:00Z"),
  periodEnd: new Date("2026-10-01T00:00:00Z"),
};

describe("the usage query", () => {
  it("binds the owner id rather than writing it into the statement", () => {
    const { sql, params } = dialect.sqlToQuery(usageSql(HOSTILE_OWNER, FREE));
    expect(sql).not.toContain("drop table");
    expect(sql).toContain("$1");
    expect(params).toContain(HOSTILE_OWNER);
  });

  it("binds the period bounds too, which is the half that comes from Stripe", () => {
    const { sql, params } = dialect.sqlToQuery(usageSql(HOSTILE_OWNER, PAID));
    expect(sql).not.toContain("2026-09-01");
    expect(sql).not.toContain("drop table");
    /* Five values: the owner, and the two bounds **twice** — the charged
       predicate is built once per counted column, one for the rows at full price
       and one for the rows whose article is public and costs half. Duplicated
       binds rather than a duplicated *statement*, which is the property this
       file is actually about. */
    expect(params).toHaveLength(5);
    expect(params).toContain("2026-09-01T00:00:00.000Z");
    expect(params).toContain("2026-10-01T00:00:00.000Z");
  });

  /* The two tiers really do ask different questions, or the half-open period
     test in the race suite would be checking nothing. */
  it("drops the period bounds entirely for the free tier, whose period is all of time", () => {
    const free = dialect.sqlToQuery(usageSql("owner", FREE));
    const paid = dialect.sqlToQuery(usageSql("owner", PAID));
    expect(free.params).toHaveLength(1);
    expect(paid.params).toHaveLength(5);
    expect(free.sql).not.toContain("timestamptz");
    expect(paid.sql).toContain("timestamptz");
  });

  /**
   * **The half-price join, and the direction it fails in.**
   *
   * A charged row whose article cannot be resolved — every row charged before
   * `ingest_events.article_id` existed, and any row whose article was later
   * deleted — must be charged **full** price. That is a `left join` plus a
   * `coalesce`, and both halves are load-bearing: an inner join would drop those
   * rows out of the count altogether, which is the ledger forgetting an ingest,
   * and a bare `visibility = 'public'` without the coalesce would be `null` for
   * them, which is neither branch and so counts in neither column.
   */
  it("resolves an unresolvable row as private, over a left join", () => {
    const { sql } = dialect.sqlToQuery(usageSql("owner", PAID));
    expect(sql).toContain("left join spideryarn.articles a on a.id = e.article_id");
    expect(sql).toContain("coalesce(a.visibility, 'private') = 'public'");
  });

  it("counts in-flight reservations with no age limit, which is the bypass fix", () => {
    /* Spelled out rather than implied: a `reserved_at > now() - interval …`
       clause here is the six-hour bypass this design removed, and it would come
       back looking like a tidy-up. docs/project/billing.md. */
    const { sql } = dialect.sqlToQuery(usageSql("owner", PAID));
    expect(sql).toContain("released_at is null");
    expect(sql).not.toMatch(/interval/i);
    expect(sql).not.toMatch(/reserved_at\s*>/);
  });
});

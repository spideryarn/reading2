/**
 * The price table on the website says what the database charges.
 *
 * `src/web/Plans.tsx` is rendered on `/`, `/features` and `/pricing`, and its
 * numbers are **copy rather than configuration** — a deliberate trade so a
 * signed-out page needs no fetch, made when the plans were written and explained
 * in that file's header. The cost of the trade is a second copy of every number,
 * and `docs/project/billing.md` advertises raising a quota as *one `UPDATE`*,
 * which touches the database and not the table.
 *
 * So this is the thing that notices. Greg asked on 2026-09-03 for a pricing page
 * that "would keep up to date automatically, but failing that we can just
 * document to update it". Documenting it is what the header already did; this is
 * the half that cannot be forgotten, because a quota changed in the database and
 * not here now goes red and names the file.
 *
 * **It reads the source rather than rendering it.** No jsdom, no React: the
 * question is whether these digits appear in that file, and a renderer would add
 * a large dependency between the fact and the assertion without making the
 * answer any better. The cost is that it cannot tell a price in the table from
 * the same number in a comment, which is a false *pass* rather than a false
 * failure — it can miss a stale row, never invent one. That is the right way
 * round for a guard nobody watches.
 *
 * The free allowance is checked too, from `FREE_LIFETIME_INGESTS` rather than
 * the tiers table, because free is the absence of a subscription and has no row.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { FREE_LIFETIME_INGESTS, offerableTiers } from "../src/billing/tiers.js";
import { loadEnvLocal } from "../src/env.js";
import { readTiers } from "../src/store/pg-tiers.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const PLANS = readFileSync("src/web/Plans.tsx", "utf8");

/** The symbol Stripe's own `Intl` formatting uses, for the currencies we sell. */
const SYMBOL: Record<string, string> = { usd: "$", gbp: "£", eur: "€" };

/** `1000` minor units of USD as the table writes it: `$10`. Whole units only. */
function asWritten(currency: string, minorUnits: number): string {
  const symbol = SYMBOL[currency];
  if (!symbol) throw new Error(`no symbol known for ${currency} — add one, or stop selling in it`);
  /* `billing_tiers.test.ts` already pins that every amount is a whole unit, so a
     fraction here means that invariant broke rather than that this needs to
     handle pence. Say so rather than quietly formatting it. */
  if (minorUnits % 100 !== 0) {
    throw new Error(`${currency} ${minorUnits} is not a whole unit — tests/billing-tiers.test.ts`);
  }
  return `${symbol}${minorUnits / 100}`;
}

describe("the website's price table", () => {
  it("states the free allowance the code enforces", () => {
    expect(PLANS).toContain(`${FREE_LIFETIME_INGESTS}, for life`);
  });
});

/* -------------------------------------------------------------------------- */

const { reachable } = await pgReady({
  suite: "tests/plans-match-tiers.test.ts",
  tables: ["spideryarn.billing_tiers", "spideryarn.billing_tier_prices"],
});
const dbIt = reachable ? it : it.skip;

describe("the website's price table, against the real rows", () => {
  dbIt("names every tier that is on sale", async () => {
    for (const tier of offerableTiers(await readTiers())) {
      /* The table's own spelling: "Reader", not "Spideryarn Reader". Asserting
         on the bare word would pass on the product name alone, so this asks for
         the row as the table writes it — the plan word at the start of a cell. */
      expect(PLANS, `no row for the "${tier.id}" tier`).toMatch(
        new RegExp(`>\\s*${tier.productName.replace(/^Spideryarn /, "")}\\s*<`),
      );
    }
  });

  dbIt("quotes each tier's monthly allowance", async () => {
    for (const tier of offerableTiers(await readTiers())) {
      expect(PLANS, `"${tier.id}" allows ${tier.ingestsPerPeriod} a month and the table does not say so`).toContain(
        `${tier.ingestsPerPeriod} a month`,
      );
    }
  });

  dbIt("quotes every price, in every currency we sell in", async () => {
    for (const tier of offerableTiers(await readTiers())) {
      for (const [currency, minorUnits] of Object.entries(tier.amounts)) {
        const written = asWritten(currency, minorUnits);
        expect(
          PLANS,
          `"${tier.id}" costs ${written} and the table does not say so — ` +
            "raising a price is one UPDATE and one edit to src/web/Plans.tsx",
        ).toContain(written);
      }
    }
  });

  dbIt("offers nothing the table does not, so no row is left behind", async () => {
    const sold = offerableTiers(await readTiers()).map((t) => t.productName.replace(/^Spideryarn /, ""));
    /* The other direction: a tier deleted or deactivated leaves a row on the
       website advertising something nobody can buy, which the checks above
       cannot see because they only walk what is on sale. */
    const rows = [...PLANS.matchAll(/<td className=\{cell\}>([A-Z][a-z]+)<\/td>/g)].map((m) => m[1]);
    for (const row of rows) {
      if (row === "Free") continue;
      expect(sold, `the table advertises "${row}" and no active tier sells it`).toContain(row);
    }
  });
});

/**
 * The decisions in `npm run db:seed-dev`, driven through every state.
 *
 * No database and no network: [`scripts/seed-dev-rules.ts`](../scripts/seed-dev-rules.ts)
 * is pure for exactly this reason, and `scripts/db-seed-dev.ts` does its work at
 * import time, so importing *that* here would seed a database rather than read a
 * rule.
 */
import { describe, expect, it } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import {
  DEV_SHELF_SLUGS,
  NEVER_SEEDED,
  planSlug,
  unopenable,
  storeVerdict,
} from "../scripts/seed-dev-rules.js";

const US = ADMIN_USER_ID_LOCAL;

describe("which articles the dev shelf gets", () => {
  it("never seeds the two corpus fixtures kept for what they lack", () => {
    /* `constitution` has no labels.sourceHash, so publishRevision refuses it and
       a run that tried would throw — or, worse under a lenient publish option,
       leave an unpublished row that the next run retries for ever. `noema`
       publishes fine but has no raw.json, so there is no original behind it. */
    for (const slug of Object.keys(NEVER_SEEDED)) {
      expect(DEV_SHELF_SLUGS as readonly string[]).not.toContain(slug);
    }
  });

  it("is a few articles, not the whole corpus", () => {
    expect(DEV_SHELF_SLUGS.length).toBeGreaterThan(0);
    expect(DEV_SHELF_SLUGS.length).toBeLessThan(5);
    expect(new Set(DEV_SHELF_SLUGS).size).toBe(DEV_SHELF_SLUGS.length);
  });
});

describe("planSlug", () => {
  it("loads a slug this database has never seen", () => {
    expect(planSlug("writes", undefined, US).action).toBe("load");
  });

  it("skips a slug that already opens, so a re-run writes no second revision", () => {
    const plan = planSlug("writes", { ownerId: US, readable: true, archived: false }, US);
    expect(plan.action).toBe("skip");
  });

  /**
   * The one that matters. `beginRevision` writes the `articles` row before there
   * is anything in it, so a seed that died halfway leaves a slug with
   * `current_revision_id` null. Keyed on the row rather than on the shelf, every
   * later run would call that "already seeded" and the shelf would stay empty for
   * ever while each run reported success.
   */
  it("RETRIES a row that exists but cannot be opened", () => {
    const plan = planSlug("writes", { ownerId: US, readable: false, archived: false }, US);
    expect(plan.action).toBe("load");
    expect(plan.why).toMatch(/did not finish/);
  });

  it("leaves another owner's slug alone and names the owner", () => {
    /* `articles.slug` is globally unique, so this cannot be loaded for us — and
       stealing it is a decision `npm run db:reown` makes, not this. */
    const plan = planSlug("writes", { ownerId: DEV_OWNER_ID, readable: true, archived: false }, US);
    expect(plan.action).toBe("refuse");
    expect(plan.why).toContain(DEV_OWNER_ID);
  });

  it("refuses another owner's half-finished row too, rather than trying to finish it", () => {
    expect(planSlug("writes", { ownerId: DEV_OWNER_ID, readable: false, archived: false }, US).action).toBe("refuse");
  });

  /**
   * **Archived is reported, never a reason to skip on its own.** It was a skip
   * branch of its own until GPT Sol pointed out that treating `archived_at` as
   * proof of health lets an archived-and-broken article exit green while it is
   * absent from both the active shelf and the archived one. Health is
   * `readable`; archived only changes the wording.
   */
  it("skips an archived article that still opens", () => {
    const plan = planSlug("writes", { ownerId: US, readable: true, archived: true }, US);
    expect(plan.action).toBe("skip");
    expect(plan.why).toMatch(/archived/);
  });

  it("RELOADS an archived article that does not open, rather than calling it seeded", () => {
    const plan = planSlug("writes", { ownerId: US, readable: false, archived: true }, US);
    expect(plan.action).toBe("load");
    expect(plan.why).toMatch(/archived/);
  });

  it("does not mistake our own article for somebody else's over uuid case", () => {
    /* Postgres renders a uuid lower-cased. A constant typed in upper case that
       compared unequal against our own row would report every seeded article as
       another owner's, and the seed would then do nothing for ever. */
    const plan = planSlug("writes", { ownerId: US.toUpperCase(), readable: true, archived: false }, US.toLowerCase());
    expect(plan.action).toBe("skip");
  });
});

describe("unopenable", () => {
  it("is empty when everything we seeded opens", () => {
    expect(unopenable(["writes", "todo"], ["writes", "todo", "old-thing"])).toEqual([]);
  });

  /**
   * The state a count cannot see, and the one a *shelf* cannot see either: the
   * library read trusts a cached `block_count`, so an article with no block rows
   * is still listed. Only opening it says otherwise.
   */
  it("names the seeded slug that will not open, however full the shelf is", () => {
    const opened = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"];
    expect(unopenable(["writes", "todo"], opened)).toEqual(["writes", "todo"]);
  });

  it("expects nothing when everything was refused, so a refused run does not double-report", () => {
    expect(unopenable([], ["anything"])).toEqual([]);
  });
});

describe("storeVerdict", () => {
  it("is happy only when the dev server will read what this wrote", () => {
    expect(storeVerdict("postgres").ok).toBe(true);
  });

  it("warns when the store is unset, because unset means files", () => {
    /* The trap the whole command falls into silently: the seed works, the rows
       are in Postgres, and the browser reads data/ and shows an empty shelf. */
    const verdict = storeVerdict(undefined);
    expect(verdict.ok).toBe(false);
    expect(verdict.lines[0]).toMatch(/unset/);
    expect(verdict.lines.join(" ")).toContain("SPIDERYARN_STORE=postgres");
  });

  it("warns when the store is explicitly files", () => {
    expect(storeVerdict("files").ok).toBe(false);
  });

  it("does not tell the reader to put the store in .env.local", () => {
    /* It did until 2026-09-02, and following that advice turned 40 test files
       and 146 tests red: `.env.local` is applied over `process.env`
       (src/env.ts), so a value there overrides every test that sets
       SPIDERYARN_STORE itself, and the shadowing warning is suppressed under
       NODE_ENV=test so it happens in silence. The remedy is `npm run dev`.
       This asserts the advice, because the advice is the thing that broke. */
    for (const store of [undefined, "files"]) {
      const advice = storeVerdict(store).lines.join(" ");
      /* Every mention of .env.local must be a prohibition. Matching on "put …
         .env.local" alone is not enough — it catches "DO NOT put … .env.local"
         too, which is the sentence we want. */
      for (const m of advice.matchAll(/[^.]*\.env\.local/gi)) {
        expect(m[0]).toMatch(/DO NOT/);
      }
      expect(advice).toMatch(/\.env\.local/);
      expect(advice).toContain("npm run dev");
    }
  });
});

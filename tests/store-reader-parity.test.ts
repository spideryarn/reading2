/**
 * **The reader store, asked the questions the switch is subtle about.**
 *
 * Two arms until 2026-09-05, when the filesystem store was deleted
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § G).
 * The cases are unchanged and all six now run against Postgres alone; only the
 * `stores` array lost an entry. The promise they hold is subtle enough that
 * prose alone will not hold it:
 *
 *  - **on twice must not move the date.** Postgres does it with
 *    `coalesce(experimental_since, now())` inside `on conflict do update`, and
 *    the two `now()`s inside one millisecond compare equal — so the case that
 *    checks it waits 20ms rather than trusting the clock.
 *  - **the profile and the switch live on one row**, so each write has to leave
 *    the other alone. The filesystem writer used to build the whole file from
 *    its single argument, which was correct with one field in it and would have
 *    deleted the switch the day a second arrived — with both writes reporting
 *    success. That is the accident `keeps both when the two writes are started
 *    at once` below was written for, and it has no second home in the tree.
 *    docs/reusable/silent-success.md.
 *
 * docs/project/experimental-features.md; docs/plans/experimental-features-toggle.md.
 *
 * ## Whose row Postgres writes to
 *
 * **Not the development owner's.** That row is Greg's own profile on his own
 * laptop, and a suite that writes it and tidies up afterwards is exactly what
 * wiped his profile twice in one session (src/profile.ts § `fileFor`). So this
 * file creates an `auth.users` row of its own, uses that, and deletes both rows
 * afterwards: it only ever touches what it made.
 *
 * It **skips loudly** without a migrated database, and it skips on the column
 * this whole file is about — so an unmigrated laptop is told to run
 * `npm run db:migrate` rather than shown a confusing missing-column error.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { readerProfiles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import type { ReaderStore } from "../src/store/contracts.js";
import { pgReaderStore } from "../src/store/pg-reader.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/* At module load, so the skip is a real vitest skip rather than a green tick
   for having checked nothing. tests/helpers/pg-ready.ts. */
await pgReady({
  suite: "tests/store-reader-parity.test.ts",
  columns: [{ table: "spideryarn.reader_profiles", column: "experimental_since" }],
});

/**
 * This suite's own reader, and nobody else's.
 *
 * `reader_profiles.owner_id` references `auth.users(id)`, so the row has to
 * exist before anything can be written for it, and it is deleted again at the
 * end. A `4` in the third group and an `8` in the fourth keeps it a well-formed
 * v4 uuid, like the synthetic owners in tests/owner-isolation.test.ts.
 *
 * **This id belongs to this file alone**, which tests/fixture-ids.test.ts
 * enforces and caught within one run: the first spelling was already
 * `store-export-isolation.test.ts`'s, and vitest runs files in parallel against
 * one database — so this suite's teardown would have deleted that one's owner
 * out from under it, and the failures would have landed in the *other* file.
 */
const OWNER = "00000000-0000-4000-8000-000000005e11" as OwnerId;

/**
 * Run `body` inside a request scope owned by this suite's reader.
 *
 * `pgReaderStore` reads `currentOwnerId()`, so every case needs one. It was a
 * two-branch helper while the filesystem arm existed — that store read
 * `SPIDERYARN_READER_FILE` from the environment instead — and the wrapper is
 * what let each case be written once and mean the same thing twice. The shape
 * is kept, because the cases below are still written against it.
 */
function on(_store: ReaderStore, body: () => Promise<void>): Promise<void> {
  return runInRequest(async () => {
    setRequestOwner(OWNER);
    await body();
  });
}

/**
 * The `auth.users` row this suite's owner needs.
 *
 * `on conflict do nothing`, so a re-run after a crashed one is fine. The columns
 * are the shared helper's: four of Supabase's have no default and GoTrue reads
 * them as non-null strings, so a row that leaves them out makes the Auth
 * service 500 for the whole database — tests/helpers/seed-auth-user.ts.
 */
async function seedOwner(): Promise<void> {
  await seedAuthUser(getDb(), {
    id: OWNER,
    email: "reader-parity@example.invalid",
    onConflictDoNothing: true,
  });
}

afterAll(async () => {
  const db = getDb();
  await db.delete(readerProfiles).where(eq(readerProfiles.ownerId, OWNER));
  await db.execute(sql`delete from auth.users where id = ${OWNER}`);
  await closeDb();
});

/* One entry since 2026-09-05, and it is deliberately still an array: the
   cases are written against `store` and read the same either way, so the shape
   records that this was a parity suite rather than pretending it never was. */
const stores: [string, ReaderStore][] = [["Postgres", pgReaderStore]];

for (const [name, store] of stores) {
  describe(name, () => {
    beforeAll(seedOwner);

    /* Every case starts from off and unwritten, so none of them depends on the
       order the others ran in — and so a failure names the case that failed
       rather than the one before it. */
    beforeEach(async () => {
      await on(store, async () => {
        await store.writeExperimental(false);
        await store.writeProfile(null);
      });
    });

    it("is off until it is switched on", async () => {
      await on(store, async () => {
        expect(await store.readExperimental()).toBeNull();
      });
    });

    it("answers with a real date once it is on", async () => {
      await on(store, async () => {
        const since = await store.writeExperimental(true);
        expect(since).toBeTypeOf("string");
        expect(Number.isNaN(Date.parse(since as string))).toBe(false);
        expect(await store.readExperimental()).toBe(since);
      });
    });

    it("keeps the first date when it is switched on again", async () => {
      await on(store, async () => {
        const first = await store.writeExperimental(true);
        /* A real gap, so a re-stamp would be *visible*: two `now()`s inside the
           same millisecond compare equal, and this would pass against an
           implementation that restamps every time. */
        await new Promise((r) => setTimeout(r, 20));
        expect(await store.writeExperimental(true)).toBe(first);
        expect(await store.readExperimental()).toBe(first);
      });
    });

    it("clears it, and a later on is honestly a new date", async () => {
      await on(store, async () => {
        const first = await store.writeExperimental(true);
        expect(await store.writeExperimental(false)).toBeNull();
        await new Promise((r) => setTimeout(r, 20));
        expect(await store.writeExperimental(true)).not.toBe(first);
      });
    });

    it("keeps both when the two writes are started at once", async () => {
      /* **The concurrent version of the case above**, which is the one that
         tells you *where* the safety comes from. On the filesystem it is the
         write queue, and a read taken outside it would let each write build its
         merge from the same "before" and the second one win with a stale copy of
         the first's field. In Postgres each statement names one column. Neither
         mechanism is visible in a sequential test. GPT Sol, 2026-08-31. */
      await on(store, async () => {
        const [, since] = await Promise.all([
          store.writeProfile("A physicist."),
          store.writeExperimental(true),
        ]);
        expect(await store.readProfile()).toBe("A physicist.");
        expect(await store.readExperimental()).toBe(since);
      });
    });

    it("leaves the profile alone when the switch changes, and the other way round", async () => {
      await on(store, async () => {
        await store.writeProfile("A physicist.");
        const since = await store.writeExperimental(true);
        expect(await store.readProfile()).toBe("A physicist.");

        await store.writeProfile("A physicist, still.");
        expect(await store.readExperimental()).toBe(since);
      });
    });
  });
}

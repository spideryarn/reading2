/**
 * **The database factory's own tests** — stage T-B of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
 *
 * The subject is [scripts/db-test-create.ts](../scripts/db-test-create.ts), and
 * the reason this file is longer than it looks like it needs to be is that
 * **every safety property here has to be watched failing**. 260903e's spike
 * reported "0 errors" from a grep over restore output; a grep is not a restore
 * that would have stopped, and a check nobody has seen fail is not evidence.
 * docs/reusable/silent-success.md.
 *
 * So the checks are broken on purpose rather than reasoned about:
 *
 * | the property | how it is made to fail here |
 * |---|---|
 * | the restore is fail-fast | a truncated archive, and a valid archive replayed into a database that already has its objects |
 * | the baseline is asserted, not assumed | `auth.users` really dropped from a real clone, and a `spideryarn` schema really planted in one |
 * | the scavenger cannot take a live run | a real connection held open inside a real candidate |
 * | the scavenger cannot take a young run | the default threshold against a clone made seconds ago |
 * | nothing outside the prefix is droppable | `postgres` named explicitly, in both the pure chooser and the real drop |
 *
 * **The pure halves are separate on purpose.** `archiveProblems`,
 * `baselineProblems` and `chooseScavengeVictims` take data rather than a
 * database, so the cases that must never happen can be exercised without
 * arranging a six-hour-old database or a corrupt Supabase stack — and the
 * integration tests then prove the real probes feed them the truth.
 *
 * This file creates and drops real databases on the **local** stack, and
 * nothing else: `baseUrl()` refuses a non-local `DATABASE_URL` outright, and
 * every drop goes through the `spideryarn_test_` prefix fence. The scavenger
 * tests pass `only: [name]`, so they can never consider a database another
 * agent's run is using — this box is shared, and that is not a thing to leave
 * to a threshold.
 */

import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { SHARED_LANE_KEEPS, unscrubbedNames } from "./helpers/scrub-secrets.js";

import {
  archiveList,
  archiveProblems,
  assertMintedName,
  assertSameCluster,
  baselineProblems,
  baseUrl,
  chooseScavengeVictims,
  clusterMismatch,
  createEmptyDatabase,
  createTestDatabase,
  dropStaleTestDatabase,
  dropTestDatabase,
  dumpSharedSchema,
  eventTriggersIn,
  findPostgresContainer,
  ledgerProblems,
  parseTestDatabaseName,
  psqlAsSuperuser,
  restoreInto,
  REVIEWED_EVENT_TRIGGERS,
  scavengeCandidates,
  scavengeTestDatabases,
  targetProblem,
  TEST_DB_PREFIX,
  testDatabaseName,
  urlForDatabase,
  type Baseline,
} from "../scripts/db-test-create.js";

/* Long, because each of these builds a database and some of them migrate it —
   4–5s of real work apiece on an idle box, and this box is never idle. */
const SLOW = 180_000;

/* ------------------------------------------------------------------- pure */

describe("naming a test database", () => {
  it("mints per-run names that carry a UTC creation time", () => {
    const when = new Date(Date.UTC(2026, 8, 3, 12, 4, 34));
    const name = testDatabaseName(when);
    expect(name.startsWith(`${TEST_DB_PREFIX}260903120434_`)).toBe(true);
    expect(parseTestDatabaseName(name)?.toISOString()).toBe(when.toISOString());
  });

  it("is unique per call, which is what 'per run, not per worktree' means", () => {
    const when = new Date(Date.UTC(2026, 8, 3, 12, 4, 34));
    expect(testDatabaseName(when)).not.toBe(testDatabaseName(when));
  });

  it("mints a name Postgres will not truncate", () => {
    /* The quiet version of the opposite failure is two runs sharing one
       database because Postgres cut the uuid off at 63 **bytes** and said
       nothing. There is no configurable prefix any more, so this is now a
       property of the parts rather than a guard against a caller — assert it
       anyway, because a longer stamp or a second uuid is one edit away. */
    expect(Buffer.byteLength(testDatabaseName(), "utf8")).toBeLessThanOrEqual(63);
  });

  it("gives no creation time to a name that is not one of ours", () => {
    /* `spideryarn_test_spike` is the name 260903e's spike left on this box —
       it matches the prefix and must still never be scavenged. (Dropped by
       hand on 2026-09-03, since the scavenger by design will not take it.) */
    expect(parseTestDatabaseName("spideryarn_test_spike")).toBeNull();
    expect(parseTestDatabaseName("spideryarn_test_260903120434_nothex")).toBeNull();
    expect(parseTestDatabaseName("postgres")).toBeNull();
  });

  it("rejects a stamp that is not a real instant rather than rolling it forward", () => {
    const hex = "0".repeat(32);
    /* Month 13. Date.UTC would happily make this January 2027. */
    expect(parseTestDatabaseName(`${TEST_DB_PREFIX}261301120434_${hex}`)).toBeNull();
  });
});

/**
 * A `pg_restore -l` table of contents, in the shape the real one has.
 *
 * Line formats taken from a real archive of this stack on 2026-09-03 rather
 * than from memory — a fixture invented from the checks it feeds would agree
 * with them whatever they did.
 */
function archiveShape(triggers: readonly string[] = REVIEWED_EVENT_TRIGGERS): string {
  return [
    "25; 2615 16457 SCHEMA - auth supabase_admin",
    "245; 1259 16458 TABLE auth users supabase_auth_admin",
    "3; 3079 16406 EXTENSION - pgcrypto ",
    "4; 3079 16395 EXTENSION - uuid-ossp ",
    ...triggers.map((t, i) => `${3744 + i}; 3466 ${16571 + i} EVENT TRIGGER - ${t} supabase_admin`),
  ].join("\n");
}

describe("archiveProblems", () => {
  const good = archiveShape();

  it("passes a real archive's table of contents", () => {
    expect(archiveProblems(good)).toEqual([]);
  });

  it("catches an archive that carries the app schemas the migrator must create", () => {
    const withApp = `${good}\n300; 2615 99999 SCHEMA - spideryarn postgres`;
    expect(archiveProblems(withApp)).toEqual([
      "the archive carries spideryarn, which the migrator must create",
    ]);
  });

  it("tells spideryarn from spideryarn_migrations", () => {
    const withLedger = `${good}\n301; 2615 99998 SCHEMA - spideryarn_migrations postgres`;
    expect(archiveProblems(withLedger)).toEqual([
      "the archive carries spideryarn_migrations, which the migrator must create",
    ]);
  });

  it("catches a missing auth.users even when the word 'users' is all over the archive", () => {
    /* The needle used to be /\busers\b/, which these two lines satisfy while
       the table itself is absent. */
    const noTable = good
      .replace("245; 1259 16458 TABLE auth users supabase_auth_admin", "")
      .concat("\n4521; 0 0 COMMENT auth TABLE users supabase_auth_admin")
      .concat("\n4523; 0 0 ACL auth TABLE users supabase_auth_admin");
    expect(archiveProblems(noTable)).toContain("the archive has no auth.users table");
  });

  it("catches a missing extension", () => {
    expect(archiveProblems(good.replace(/EXTENSION - pgcrypto /, ""))).toContain(
      "the archive declares no pgcrypto extension",
    );
  });

  it("calls an empty table of contents what it is", () => {
    expect(archiveProblems("   ")).toEqual(["the archive's table of contents is empty"]);
  });
});

describe("baselineProblems", () => {
  const ok: Baseline = {
    schemasPresent: [],
    tablesPresent: ["auth.users"],
    extensionsPresent: ["pgcrypto", "uuid-ossp", "plpgsql", "supabase_vault"],
  };

  it("passes a clone that is empty of the app and full of Supabase", () => {
    expect(baselineProblems(ok)).toEqual([]);
  });

  it("catches a missing auth.users", () => {
    expect(baselineProblems({ ...ok, tablesPresent: [] })).toEqual([
      "auth.users is missing — migrations declare foreign keys into it and will fail",
    ]);
  });

  it("catches a missing extension", () => {
    expect(baselineProblems({ ...ok, extensionsPresent: ["plpgsql"] })).toEqual([
      "extension pgcrypto is missing",
      "extension uuid-ossp is missing",
    ]);
  });

  it("catches app schemas the migrator should have been the one to create", () => {
    expect(baselineProblems({ ...ok, schemasPresent: ["spideryarn"] })[0]).toMatch(
      /spideryarn exists in the clone/,
    );
  });
});

describe("chooseScavengeVictims", () => {
  const now = new Date(Date.UTC(2026, 8, 3, 18, 0, 0));
  const named = (hoursAgo: number, sessions = 0) => ({
    name: testDatabaseName(new Date(now.getTime() - hoursAgo * 3_600_000)),
    sessions,
  });

  it("drops one that is old and empty", () => {
    const old = named(9);
    expect(chooseScavengeVictims([old], { now }).dropped).toEqual([old.name]);
  });

  it("spares one that is old but still has somebody inside it", () => {
    const busy = named(9, 1);
    const report = chooseScavengeVictims([busy], { now });
    expect(report.dropped).toEqual([]);
    expect(report.spared[0]?.why).toMatch(/1 session\(s\) are still inside it/);
  });

  it("spares one that is empty but young", () => {
    const young = named(0.1);
    const report = chooseScavengeVictims([young], { now });
    expect(report.dropped).toEqual([]);
    expect(report.spared[0]?.why).toMatch(/old, and the threshold is/);
  });

  it("spares a name it cannot date, however old the stack is", () => {
    const report = chooseScavengeVictims([{ name: "spideryarn_test_spike", sessions: 0 }], { now });
    expect(report.dropped).toEqual([]);
    expect(report.spared[0]?.why).toMatch(/no readable creation time/);
  });

  it("will not drop a database outside the prefix even when told to by name", () => {
    const report = chooseScavengeVictims([{ name: "postgres", sessions: 0 }], {
      now,
      only: ["postgres"],
      olderThanMs: 0,
    });
    expect(report.dropped).toEqual([]);
    expect(report.spared[0]?.why).toMatch(/not one of ours/);
  });

  it("clamps a reckless threshold to a floor when no database is named", () => {
    /* Ten minutes old, threshold asked for as zero. On a box ten worktrees
       share, "drop everything with no connections" can catch a live run
       between two test files. The floor is what stops that; `only` is the
       deliberate act that lifts it. */
    const tenMinutes = named(1 / 6);
    expect(chooseScavengeVictims([tenMinutes], { now, olderThanMs: 0 }).dropped).toEqual([]);
    expect(
      chooseScavengeVictims([tenMinutes], { now, olderThanMs: 0, only: [tenMinutes.name] }).dropped,
    ).toEqual([tenMinutes.name]);
  });

  it("ignores candidates outside an explicit `only` list", () => {
    const a = named(9);
    const b = named(9);
    expect(chooseScavengeVictims([a, b], { now, only: [a.name] }).dropped).toEqual([a.name]);
  });

  /**
   * `NaN` compares false against everything, so `age < NaN` is false for every
   * candidate — a threshold nobody meant would read as "all of these are
   * stale". Same for an `Invalid Date`, where `now - born` is NaN.
   */
  it("refuses a threshold that would silently mark everything stale", () => {
    const old = named(9);
    expect(() => chooseScavengeVictims([old], { now, olderThanMs: Number.NaN })).toThrow(
      /finite number of milliseconds/,
    );
    expect(() => chooseScavengeVictims([old], { now, olderThanMs: -1 })).toThrow(
      /finite number of milliseconds/,
    );
    expect(() =>
      chooseScavengeVictims([old], { now, olderThanMs: Number.POSITIVE_INFINITY }),
    ).toThrow(/finite number of milliseconds/);
  });

  it("refuses an Invalid Date for `now`", () => {
    expect(() => chooseScavengeVictims([named(9)], { now: new Date("not a date") })).toThrow(
      /Invalid Date/,
    );
  });
});

/**
 * **Both drop paths are wired to the guard, and neither opens a connection to
 * find that out.**
 *
 * The shapes themselves are enumerated against `assertMintedName` below; what
 * these two prove is that the two exported entry points actually consult it —
 * a guard nothing calls is the purest form of a check that cannot fail. Both
 * throw before `poolFor`, which is why they are out here rather than behind the
 * integration gate.
 *
 * Nobody is attacking this box. It matters because this is the one file in the
 * repo whose job is dropping databases, on a stack every worktree shares, and
 * CLAUDE.md's rule is that nothing mechanical stops you.
 */
describe("the two drop paths", () => {
  it("both refuse a name outside the prefix, without connecting", async () => {
    await expect(dropTestDatabase("postgres")).rejects.toThrow(/refusing to drop "postgres"/);
    await expect(dropStaleTestDatabase("postgres")).rejects.toThrow(/refusing to drop "postgres"/);
  });

  it("both refuse a name that would break out of the quoted identifier", async () => {
    const bad = `${TEST_DB_PREFIX}a"; select 1; --`;
    await expect(dropTestDatabase(bad)).rejects.toThrow(/not a name this file mints/);
    await expect(dropStaleTestDatabase(bad)).rejects.toThrow(/not a name this file mints/);
  });
});

/**
 * The validator on its own, with no database anywhere near it.
 *
 * This used to be a positive control inside the `dropTestDatabase` block that
 * called the real function on a minted name — which reached Postgres, outside
 * the integration gate, and failed on a box with no stack (GPT Sol saw
 * `1 failed | 25 passed | 12 skipped`). A validator's positive control belongs
 * on the validator: it answers "does this guard reject everything?", which is
 * the question, and it answers it without a connection.
 */
describe("assertMintedName", () => {
  it("accepts a name the factory actually minted", () => {
    expect(() => assertMintedName(testDatabaseName(), "drop")).not.toThrow();
    expect(() =>
      assertMintedName(`${TEST_DB_PREFIX}260903120434_${"0".repeat(32)}`, "create"),
    ).not.toThrow();
  });

  it("refuses anything outside the prefix", () => {
    expect(() => assertMintedName("postgres", "drop")).toThrow(/not one of ours/);
    expect(() => assertMintedName("spideryarn_byok_check", "drop")).toThrow(/not one of ours/);
  });

  /**
   * **The hole GPT Sol found in the version that took a prefix**, kept as a
   * test now that the parameter is gone.
   *
   * `parseTestDatabaseName(name, prefix)` stripped the caller's prefix before
   * validating the rest, and the only guard on a prefix was that it began with
   * `spideryarn_test_`. So `spideryarn_test_x"; select 1; --` was a legal
   * prefix, a name built on it passed the whole shape check, and the injection
   * had simply moved. With one fixed prefix these are just names, and the shape
   * check sees all of them.
   */
  it("refuses the names the configurable prefix used to let through", () => {
    for (const bad of [
      `${TEST_DB_PREFIX}x"; select 1; --260903120434_${"0".repeat(32)}`,
      `${TEST_DB_PREFIX}a"; select 1; --`,
      `${TEST_DB_PREFIX}a"`,
      `${TEST_DB_PREFIX}a b`,
      `${TEST_DB_PREFIX}a\\`,
      `${TEST_DB_PREFIX}é`,
      `${TEST_DB_PREFIX}a\nb`,
      `${TEST_DB_PREFIX}spike`,
      `${TEST_DB_PREFIX}260903120434_NOTHEX${"0".repeat(26)}`,
    ]) {
      expect(() => assertMintedName(bad, "drop")).toThrow(/not a name this file mints/);
    }
  });
});

describe("clusterMismatch", () => {
  it("says nothing when the two identifiers agree", () => {
    expect(clusterMismatch("supabase_db_x", "7680206532414074919", "7680206532414074919")).toBeNull();
  });

  it("names both identifiers when they do not", () => {
    /* Real numbers, from the two Supabase stacks on this box on 2026-09-03. */
    const why = clusterMismatch("supabase_db_hellozenno", "7680206532414074919", "7681270865315942443");
    expect(why).toMatch(/is not the server DATABASE_URL reaches/);
    expect(why).toContain("7680206532414074919");
    expect(why).toContain("7681270865315942443");
  });

  it("refuses to call two blanks a match", () => {
    /* The shape that would make this check vacuous: both probes returning
       nothing, which `a === b` calls agreement. */
    expect(clusterMismatch("supabase_db_x", "", "")).not.toBeNull();
  });
});

describe("targetProblem", () => {
  const want = "postgresql://postgres:postgres@127.0.0.1:54362/spideryarn_test_260903120434_abc";

  it("says nothing when the migrator reached exactly this database", () => {
    /* The real line, password-stripped, as scripts/db-migrate.ts prints it. */
    const out = "Target: postgresql://postgres@127.0.0.1:54362/spideryarn_test_260903120434_abc\n✓ migrations applied\n";
    expect(targetProblem(out, want)).toBeNull();
  });

  it("catches the 2026-08-27 accident — success reported against another database", () => {
    const out = "Target: postgresql://postgres@127.0.0.1:54362/postgres\n✓ migrations applied\n";
    expect(targetProblem(out, want)).toMatch(/migrated 127\.0\.0\.1:54362\/postgres/);
  });

  it("catches a different host or port on the same database name", () => {
    const out = "Target: postgresql://postgres@db.example.supabase.co:5432/spideryarn_test_260903120434_abc\n";
    expect(targetProblem(out, want)).toMatch(/db\.example\.supabase\.co/);
  });

  it("is not satisfied by the name appearing somewhere else in the output", () => {
    /* What the first version of this check did: two independent substring
       searches, either of which a log line could satisfy. */
    const out =
      "Applying 1 migration(s) to spideryarn_test_260903120434_abc\n" +
      "Target: postgresql://postgres@127.0.0.1:54362/postgres\n";
    expect(targetProblem(out, want)).not.toBeNull();
  });

  it("calls a missing Target line what it is", () => {
    expect(targetProblem("✓ migrations applied\n", want)).toMatch(/printed no Target: line/);
  });
});

describe("ledgerProblems", () => {
  const expected = [
    { tag: "0000_a", hash: "aaa" },
    { tag: "0001_b", hash: "bbb" },
    { tag: "0002_c", hash: "ccc" },
  ];

  it("passes a ledger holding exactly the journal", () => {
    expect(ledgerProblems(expected, ["ccc", "aaa", "bbb"])).toEqual([]);
  });

  /**
   * **The case a count cannot see**, and the reason this stopped being one.
   * Three rows, three journal entries, and one migration never applied.
   */
  it("catches one missing and another duplicated, which count(*) calls fine", () => {
    const applied = ["aaa", "bbb", "bbb"];
    expect(applied.length).toBe(expected.length);
    expect(ledgerProblems(expected, applied)).toEqual([
      "0001_b appears 2 times in the ledger",
      "0002_c is in the journal and not in the ledger",
    ]);
  });

  it("catches a ledger row the journal knows nothing about", () => {
    expect(ledgerProblems(expected, ["aaa", "bbb", "ccc", "zzz"])).toEqual([
      "the ledger holds a migration the journal does not: zzz",
    ]);
  });
});

describe("eventTriggersIn", () => {
  it("reads the names out of a real table of contents", () => {
    const list = [
      "3744; 3466 16571 EVENT TRIGGER - issue_graphql_placeholder supabase_admin",
      "3745; 3466 16572 EVENT TRIGGER - pgrst_ddl_watch supabase_admin",
      "245; 1259 16458 TABLE auth users supabase_auth_admin",
    ].join("\n");
    expect(eventTriggersIn(list)).toEqual(["issue_graphql_placeholder", "pgrst_ddl_watch"]);
  });

  it("stops a run when the shared stack has grown a trigger nobody reviewed", () => {
    const list = archiveShape([...REVIEWED_EVENT_TRIGGERS, "issue_something_new"]);
    expect(archiveProblems(list).join(" ")).toMatch(
      /event trigger\(s\) nobody has reviewed: issue_something_new/,
    );
  });

  it("notices one that has gone away", () => {
    const list = archiveShape(REVIEWED_EVENT_TRIGGERS.filter((t) => t !== "pgrst_ddl_watch"));
    expect(archiveProblems(list).join(" ")).toMatch(/missing event trigger pgrst_ddl_watch/);
  });
});

/* ------------------------------------------------------------ integration */

/**
 * **Opt-in, and nothing below this line runs without it.**
 *
 * 260903e § Stage B says in as many words that this stage changes nothing about
 * the default `npm test` — *"the factory can be wrong here without making the
 * tree red for anybody else"*. It was not honouring that: `vitest.config.ts`
 * collects every test file under `tests/`, this one included, so an ordinary
 * `npm test` was creating and dropping databases on a stack eight worktrees
 * share. GPT Sol, 2026-09-03.
 *
 * So the database half is gated on an explicit variable, **in addition to** the
 * reachability probe, and the probe itself does not run without it — otherwise
 * a default run would still be opening a connection and shelling out to Docker
 * to decide how to skip.
 *
 * Until T-D gives this a lane of its own:
 *
 *     SPIDERYARN_TEST_DB_FACTORY=1 npx vitest run tests/db-test-create.test.ts
 *
 * `REQUIRE_POSTGRES=1` still turns an unreachable stack into a failure rather
 * than a skip — but only for a run that opted in. It deliberately does **not**
 * opt in by itself: `scripts/check.ts` sets it, and a gate that started
 * creating databases because somebody ran `npm run check` is the change this
 * variable exists to prevent.
 */
const OPT_IN = "SPIDERYARN_TEST_DB_FACTORY";
const optedIn = process.env[OPT_IN] === "1";

const probe = await (async (): Promise<{ ok: boolean; why: string }> => {
  if (!optedIn) return { ok: false, why: `${OPT_IN} is not set` };
  try {
    const base = baseUrl();
    const container = await findPostgresContainer(base);
    await assertSameCluster(container, base);
    return { ok: true, why: "" };
  } catch (err) {
    return { ok: false, why: (err as Error).message.split("\n")[0] ?? "unknown" };
  }
})();

if (!optedIn) {
  /* One line, not silence, and not a failure: an ordinary `npm test` opting out
     of these is the designed behaviour rather than a machine problem. */
  process.stderr.write(
    `\n  ⚠ the test-database factory's integration tests need ${OPT_IN}=1 — see this file's header\n`,
  );
} else if (!probe.ok) {
  process.stderr.write(
    `\n  ⚠ the test-database factory's integration tests are skipping: ${probe.why}\n`,
  );
}

const live = probe.ok ? describe : describe.skip;

/** Databases these tests made, dropped at the end even if an assertion threw. */
const made = new Set<string>();
afterAll(async () => {
  for (const name of made) await dropTestDatabase(name).catch(() => {});
});

async function build(options: Parameters<typeof createTestDatabase>[0] = {}) {
  const db = await createTestDatabase(options);
  made.add(db.name);
  return db;
}

live("creating one", () => {
  it(
    "hands back a private, migrated database that is not the shared one",
    async () => {
      const db = await build();
      const client = new Client({ connectionString: db.url });
      await client.connect();
      try {
        /* The positive control 260903e insists on: had the redirect silently
           failed, everything below would still pass against `postgres`. */
        const where = await client.query<{ db: string }>("select current_database() as db");
        expect(where.rows[0]?.db).toBe(db.name);
        expect(where.rows[0]?.db).not.toBe("postgres");

        const schema = await client.query<{ ok: boolean }>(
          "select to_regclass('spideryarn.jobs') is not null as ok",
        );
        expect(schema.rows[0]?.ok).toBe(true);

        /* Schema-only, so the clone carries no reader's data — which is also
           the thing stage T-C is about to discover half the suite assumes. */
        const users = await client.query<{ n: string }>(
          "select count(*)::text as n from auth.users",
        );
        expect(users.rows[0]?.n).toBe("0");
      } finally {
        await client.end();
      }
      await db.drop();
      made.delete(db.name);
      expect((await scavengeCandidates()).map((c) => c.name)).not.toContain(db.name);
    },
    SLOW,
  );

  it(
    "leaves the shared database's app schema alone",
    async () => {
      /* Cheap, and it is the thing that would matter most if any of this were
         wrong: the factory must never have touched `postgres`. */
      const client = new Client({ connectionString: baseUrl() });
      await client.connect();
      try {
        const r = await client.query<{ ok: boolean }>(
          "select to_regclass('spideryarn.jobs') is not null as ok",
        );
        expect(r.rows[0]?.ok).toBe(true);
      } finally {
        await client.end();
      }
    },
    SLOW,
  );
});

live("the restore is fail-fast", () => {
  it(
    "refuses a truncated archive instead of restoring most of it",
    async () => {
      await expect(
        build({ migrate: false, dumpOverride: (dump) => dump.subarray(0, 5_000) }),
      ).rejects.toThrow(/pg_restore/);
    },
    SLOW,
  );

  it(
    "refuses, and leaves nothing behind, when the target is not empty",
    async () => {
      /* The realistic shape: nothing wrong with the dump, everything wrong with
         the target. Measured 2026-09-03 — `pg_restore` exits 1 either way, so
         the exit code is what *detects* this; what the two flags buy is that
         the clone is left empty rather than half-restored and plausible.
         Without --single-transaction this same restore creates
         `storage.buckets` on its way past the conflict. */
      const container = await findPostgresContainer();
      const name = testDatabaseName();
      const url = await createEmptyDatabase(name);
      made.add(name);
      await psqlAsSuperuser(container, name, "create schema auth");

      const dump = await dumpSharedSchema(container);
      await expect(restoreInto(container, name, dump)).rejects.toThrow(/pg_restore exited/);

      const after = new Client({ connectionString: url });
      await after.connect();
      try {
        const r = await after.query<{ ok: boolean }>(
          "select to_regclass('storage.buckets') is not null as ok",
        );
        expect(r.rows[0]?.ok).toBe(false);
      } finally {
        await after.end();
      }
    },
    SLOW,
  );

  it(
    "refuses bytes that are not an archive at all",
    async () => {
      await expect(
        build({ migrate: false, dumpOverride: () => Buffer.from("not an archive") }),
      ).rejects.toThrow(/pg_restore -l exited/);
    },
    SLOW,
  );
});

live("the baseline is checked against the clone, not assumed", () => {
  it(
    "catches auth.users actually missing from a real clone",
    async () => {
      await expect(
        build({
          migrate: false,
          /* `postgres` is not a superuser here and does not own `auth.users`,
             so an ordinary connection dies of "must be owner of table users"
             before the check under test is reached — a control that fails of
             its own arrangements. Hence the superuser escape hatch. */
          afterRestore: ({ container, name }) =>
            psqlAsSuperuser(container, name, "drop table auth.users cascade"),
        }),
      ).rejects.toThrow(/auth\.users is missing/);
    },
    SLOW,
  );

  it(
    "catches a spideryarn schema that arrived before the migrator did",
    async () => {
      await expect(
        build({
          migrate: false,
          afterRestore: ({ container, name }) =>
            psqlAsSuperuser(container, name, "create schema spideryarn"),
        }),
      ).rejects.toThrow(/spideryarn exists in the clone/);
    },
    SLOW,
  );

  it(
    "reads the real archive of the real shared database and finds nothing wrong with it",
    async () => {
      const container = await findPostgresContainer();
      const list = await archiveList(container, await dumpSharedSchema(container));
      expect(archiveProblems(list)).toEqual([]);
      /* And the exclusions really excluded something — `-N drizzle` in the
         spike excluded nothing at all and nobody noticed, because "no
         spideryarn in the archive" is what both a working exclusion and a
         wrongly-named one produce. This says the schemas are there to exclude. */
      const shared = new Client({ connectionString: baseUrl() });
      await shared.connect();
      try {
        const r = await shared.query<{ n: string }>(
          "select nspname as n from pg_namespace where nspname in ('spideryarn','spideryarn_migrations')",
        );
        expect(r.rows.map((x) => x.n).sort()).toEqual(["spideryarn", "spideryarn_migrations"]);
      } finally {
        await shared.end();
      }
    },
    SLOW,
  );
});

live("the scavenger", () => {
  it(
    "will not drop a database somebody is connected to, and drops it once they leave",
    async () => {
      const db = await build({ migrate: false });
      const client = new Client({ connectionString: db.url });
      await client.connect();

      try {
        /* `olderThanMs: 0` takes age out of the question entirely, so the only
           thing that can spare this database is the session below. `only`
           makes that safe on a box other agents are running on. */
        const held = await scavengeTestDatabases({ only: [db.name], olderThanMs: 0 });
        expect(held.dropped).toEqual([]);
        expect(held.spared.find((s) => s.name === db.name)?.why).toMatch(/still inside it/);

        /* And it is genuinely still there — the report is not the evidence. */
        expect((await scavengeCandidates()).map((c) => c.name)).toContain(db.name);
      } finally {
        await client.end();
      }

      const freed = await scavengeTestDatabases({ only: [db.name], olderThanMs: 0 });
      expect(freed.dropped).toEqual([db.name]);
      expect((await scavengeCandidates()).map((c) => c.name)).not.toContain(db.name);
      made.delete(db.name);
    },
    SLOW,
  );

  /**
   * **The one guard that does not depend on a sample.**
   *
   * The scan and the re-read are both observations taken before the drop, so
   * either can be stale by the time it lands — GPT Sol's sequence: A is old and
   * momentarily idle, both checks see zero, A connects, `WITH (FORCE)`
   * terminates it. This arranges exactly that state, by connecting *after* both
   * observations would have been taken and calling the drop directly, and
   * requires Postgres itself to refuse.
   */
  it(
    "cannot drop a database somebody connected to after the checks were taken",
    async () => {
      const db = await build({ migrate: false });
      const late = new Client({ connectionString: db.url });
      await late.connect();
      try {
        const outcome = await dropStaleTestDatabase(db.name);
        /* `in-use` rather than `failed`, and that distinction is the whole
           point: only `in-use` licenses a caller to reason about who was
           inside. `scripts/db-test-create.ts` § `DropOutcome`. */
        expect(outcome.kind).toBe("in-use");
        expect(outcome.kind === "in-use" && outcome.why).toMatch(
          /somebody connected to it before the drop landed/,
        );
        /* And it is genuinely still there — the report is not the evidence. */
        expect((await scavengeCandidates()).map((c) => c.name)).toContain(db.name);
        /* The connection survived it, which is the thing FORCE would have taken. */
        const alive = await late.query<{ ok: number }>("select 1 as ok");
        expect(alive.rows[0]?.ok).toBe(1);
      } finally {
        await late.end();
      }
    },
    SLOW,
  );

  it(
    "does drop it once the late connection goes",
    async () => {
      const db = await build({ migrate: false });
      const outcome = await dropStaleTestDatabase(db.name);
      expect(outcome).toEqual({ kind: "dropped" });
      expect((await scavengeCandidates()).map((c) => c.name)).not.toContain(db.name);
      made.delete(db.name);
    },
    SLOW,
  );

  it(
    "spares a database made seconds ago, under the ordinary threshold",
    async () => {
      const db = await build({ migrate: false });
      const report = await scavengeTestDatabases({ only: [db.name] });
      expect(report.dropped).toEqual([]);
      expect(report.spared.find((s) => s.name === db.name)?.why).toMatch(/old, and the threshold/);
      expect((await scavengeCandidates()).map((c) => c.name)).toContain(db.name);
    },
    SLOW,
  );

  it(
    "an ordinary sweep of this box drops nothing it should not",
    async () => {
      const db = await build({ migrate: false });
      const before = (await scavengeCandidates()).map((c) => c.name);
      const report = await scavengeTestDatabases({ dryRun: true });
      /* Every survivor is either young, occupied or undateable, and this run's
         own database is one of them. Nothing here should be dropping another
         agent's work. */
      expect(report.spared.map((s) => s.name)).toContain(db.name);
      for (const name of report.dropped) {
        expect(parseTestDatabaseName(name)).not.toBeNull();
        expect(before).toContain(name);
      }
    },
    SLOW,
  );
});

live("the URL it hands back", () => {
  it("names the clone and nothing else about the connection", () => {
    const url = urlForDatabase("spideryarn_test_x");
    expect(new URL(url).pathname).toBe("/spideryarn_test_x");
    expect(new URL(url).host).toBe(new URL(baseUrl()).host);
  });
});

/**
 * **The shared lane's worker holds no real secret but the local stack's own.**
 * tests/setup/shared-db.ts replaces every other secret-named value and pins the names, so that a
 * failing assertion over this worker's environment has nothing real to print
 * (docs/postmortems/260910d-an-assertion-over-a-whole-environment-prints-every-secret-when-it-fails.md).
 * Here because this file is in the shared lane by contract rather than by circumstance; the unit
 * lane's probe is tests/test-workers-hold-no-secrets.test.ts. Names only.
 */
describe("the shared lane's worker environment", () => {
  it("holds no real secret-named value outside SHARED_LANE_KEEPS", () => {
    const extra = unscrubbedNames(process.env).filter(
      (name) => !(SHARED_LANE_KEEPS as readonly string[]).includes(name),
    );
    expect(extra, "secret-named variables holding a real value").toEqual([]);
  });
});

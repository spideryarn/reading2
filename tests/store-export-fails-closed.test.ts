/**
 * **`db:export` must refuse a Postgres it has no matching bucket for.**
 *
 * This is the rollback tool. It reads article rows out of Postgres and writes
 * `data/<slug>/` back to disk, and a revision row holds a *reference* to the
 * source document rather than the document — so the bytes come from wherever
 * `blobStore()` points. That choice is made by the presence of two credentials
 * and nothing else (src/store/blobs.ts § Why selection does not read
 * `SPIDERYARN_STORE`), and `blobStore()` falls back to `data/_blobs/` silently
 * when either is missing.
 *
 * So: point `DATABASE_URL` at a database whose rows name objects in a Supabase
 * bucket, leave `SUPABASE_SERVICE_ROLE_KEY` unset, and the export reads a
 * filesystem directory that has never held those objects. It omits every source
 * document, or reports them missing. **Either way it writes a directory that
 * looks like a complete backup and is not** — and it does it in the one tool
 * anybody reaches for after losing something.
 * [silent-success.md](../docs/reusable/silent-success.md).
 *
 * `scripts/db-export.ts` used to import `src/store/export.js` directly, so the
 * boot-time refusals in `src/store/index.ts` never ran: that file is only
 * imported by the server. Belief 13 of
 * docs/plans/260827aa-delete-the-importer.md § What has to be true before this is
 * believable.
 *
 * ## Why a child process, and why the environment is built the way it is
 *
 * The refusal has to fire **through the thing a person types**, not through a
 * function this file imports. A guard living in a module the script bypasses is
 * the exact bug under test, so an in-process test of `postgresBlobStore` would
 * pass whether or not `scripts/db-export.ts` ever calls it.
 *
 * The env dance in `run()` is not ceremony. `src/env.ts` makes **`.env.local`
 * beat anything inherited from the shell**, so a child spawned with
 * `SUPABASE_SERVICE_ROLE_KEY` deleted gets Greg's real key put back underneath
 * it and every case here would pass — or fail — for a reason that has nothing
 * to do with the code. What still wins is a value *this process set for itself
 * after startup*, which `src/env.ts` can tell apart from an inherited one by
 * snapshotting `process.env` at module load. Hence the order in the child:
 * import `src/env.js` first so the snapshot is taken, then assign, then run the
 * script. Every name this test depends on is set explicitly, in both
 * directions, and `""` is how "absent" is spelled — `configured()` and the
 * `?.trim()` checks read it as absent, and unlike `delete` it survives
 * `.env.local`. The same problem the deleted `tests/store-selection.test.ts`
 * had about the store flag, which is why `src/env.ts` keeps that snapshot.
 *
 * No database is needed and none is reached: all three refusals fire before the
 * first query.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** This project's local stack, per `supabase/config.toml`. A matching pair. */
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54362/postgres";
const LOCAL_API = "http://127.0.0.1:54361";
/** Two hosted projects that are not each other. */
const REMOTE_DB = "postgresql://postgres.aaaaaaaaaaaaaaaaaaaa:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres";
const OTHER_API = "https://bbbbbbbbbbbbbbbbbbbb.supabase.co";

/**
 * The tail every refusal from the shared constructor carries.
 *
 * One substring rather than three, because the control below has to assert its
 * *absence* — and a control that cannot go red is testing nothing.
 */
const REFUSAL = "See src/store/blobs.ts";

/** The four names that decide this, and nothing else from the shell. */
type Env = { DATABASE_URL: string; SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string };

interface Run {
  status: number | null;
  stderr: string;
  stdout: string;
  /** What landed in `--out`. A refusal must leave it empty. */
  written: string[];
}

function run(overrides: Env): Run {
  const out = mkdtempSync(path.join(tmpdir(), "db-export-closed-"));

  const body = `(async () => {
    /* Snapshot the environment BEFORE overriding, so \`.env.local\` cannot put
       Greg's real credentials back over the top. See the header. */
    await import(${JSON.stringify(path.join(ROOT, "src/env.ts"))});
    Object.assign(process.env, ${JSON.stringify(overrides)});
    process.argv = [process.argv[0], "db-export", "--out", ${JSON.stringify(out)}];
    await import(${JSON.stringify(path.join(ROOT, "scripts/db-export.ts"))});
  })();`;

  const env: NodeJS.ProcessEnv = { ...process.env };
  /* Deleted here and assigned in the child, which is the whole trick: gone at
     spawn means the snapshot holds `undefined`, so the child's own assignment
     differs from it and wins over `.env.local`. */
  for (const name of ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) delete env[name];

  const child = spawnSync(TSX, ["-e", body], { env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return {
    status: child.status,
    stderr: child.stderr ?? "",
    stdout: child.stdout ?? "",
    written: readdirSync(out),
  };
}

/**
 * **Each case spawns `tsx scripts/db-export.ts`, so vitest's 5s default is not a
 * timeout — it is a load test.**
 *
 * Every one of these failed on 2026-08-28 at `Test timed out in 5000ms`, taking
 * 11-19s apiece, with a load average of 108 and 56 vitest workers alive across
 * six sessions sharing this laptop. Nothing was wrong: the same file passes with
 * a realistic ceiling. But a red that says "timed out" reads like a hang, and
 * chasing it cost half an hour that a number here would have saved.
 *
 * Three `tsx` starts per case, each compiling the script and its imports. That
 * is seconds of honest work even on an idle machine, and there is no upper bound
 * on how slow a busy one gets. So: generous, because the cost of being generous
 * is only paid when something really is stuck, and the cost of being tight is
 * paid by whoever is unlucky.
 */
const SPAWNS_A_PROCESS = 60_000;

describe("db:export against Postgres with no matching bucket", () => {
  it("refuses when the service key is missing — the commonest version", () => {
    /* A `.env.local` with `SUPABASE_URL` set and the key absent. This is the
       one the URL-only check in src/store/index.ts let straight through until
       GPT Sol found it, 2026-08-27, and it is the one a laptop falls into. */
    const r = run({ DATABASE_URL: LOCAL_DB, SUPABASE_URL: LOCAL_API, SUPABASE_SERVICE_ROLE_KEY: "" });
    expect(r.status, r.stderr).not.toBe(0);
    expect(r.stderr).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(r.stderr).toContain(REFUSAL);
    // Fail closed means nothing on disk, not a directory that half worked.
    expect(r.written).toEqual([]);
  }, SPAWNS_A_PROCESS);

  it("refuses when neither credential is set", () => {
    const r = run({ DATABASE_URL: LOCAL_DB, SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" });
    expect(r.status, r.stderr).not.toBe(0);
    expect(r.stderr).toContain("SUPABASE_URL");
    expect(r.stderr).toContain(REFUSAL);
    expect(r.written).toEqual([]);
  }, SPAWNS_A_PROCESS);

  it("refuses a bucket in a different Supabase project from the database", () => {
    /* Both credentials present and both perfectly valid — the failure is that
       they name two projects. The row lands in one and the source document is
       looked for in the other, so every export finds nothing.
       tests/store-project-pair.test.ts owns the parsing; this owns the refusal
       arriving at the CLI. */
    const r = run({
      DATABASE_URL: REMOTE_DB,
      SUPABASE_URL: OTHER_API,
      SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key",
    });
    expect(r.status, r.stderr).not.toBe(0);
    // The message must name both, because each half looks right on its own.
    expect(r.stderr).toContain("aaaaaaaaaaaaaaaaaaaa");
    expect(r.stderr).toContain("bbbbbbbbbbbbbbbbbbbb");
    expect(r.stderr).toContain(REFUSAL);
    expect(r.written).toEqual([]);
    // And it refused before touching the database, which is remote and fake.
    expect(r.stderr).not.toMatch(/ENOTFOUND|ECONNREFUSED|getaddrinfo/);
  }, SPAWNS_A_PROCESS);

  it("does not refuse a matching pair", () => {
    /* The control. Without it, a constructor that threw unconditionally would
       satisfy all three tests above — the guard would be indistinguishable from
       a broken export. The local database may or may not be running, and this
       deliberately does not care: it asserts only that the *credentials*
       refusal is absent. */
    const r = run({
      DATABASE_URL: LOCAL_DB,
      SUPABASE_URL: LOCAL_API,
      SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key",
    });
    expect(r.stderr).not.toContain(REFUSAL);
  }, SPAWNS_A_PROCESS);
});

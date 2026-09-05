/**
 * **`SPIDERYARN_STORE=files` must kill the program, and this is the only test
 * that can say so.**
 *
 * ## Why it exists, which is the whole point of it
 *
 * The hinge of 2026-09-05 removed the last `STORE === "postgres"` comparison
 * from `src/store/index.ts` — and with it the last `import` of
 * [`src/store/live.ts`](../src/store/live.ts), the module that defines the
 * tombstone. The tombstone throws at module load, so a module nothing loads
 * throws nothing. **For the length of that commit the refusal was not in the
 * program at all**, and a build with `SPIDERYARN_STORE=files` in its environment
 * — which is exactly what Vercel Preview and Production have today — booted
 * clean, logged *"serving article reads from Postgres"* and served Postgres
 * while the environment said otherwise. The one failure the flag was kept alive
 * to prevent.
 *
 * **And its own tests were green throughout**, because they `import
 * { refuseTheStoreFlag }` and call it. A guard nothing loads, checked by a test
 * that loads it by hand, is [silent-success.md](../docs/reusable/silent-success.md)
 * arriving inside the thing written to stop it: the natural check shares an
 * assumption with the bug — *that the function is reachable at all*.
 *
 * So the shape of this file is not incidental. **It imports what a deployment
 * imports, in a child process, and asserts the child dies.** Calling the
 * function is what the test that missed this already does
 * ([`store-selection.test.ts`](store-selection.test.ts), which still owns the
 * *behaviour* — accepts, refuses, the date in the message). This one owns the
 * *wiring*, and it is the half that cannot be replaced by anything in-process:
 * a module is evaluated once, and every root below is already loaded in this
 * worker.
 *
 * ## And it has to be *every* root, which is the second half of the same story
 *
 * The first fix put the side-effect import in `src/store/index.ts` — the reader
 * wiring hub, and the obvious front door. **It closed the reported symptom and
 * not the class.** `scripts/stage.ts` imports `src/jobs.ts`, `src/db/client.ts`,
 * blobs and uploads directly and never touches `store/index.ts`; `src/jobs.ts`
 * binds `pgJobStore` without going near it; `evals/cost/run.ts` has its own
 * graph. Measured on 2026-09-05, production-shaped, `SPIDERYARN_STORE=files`:
 *
 * ```
 * src/store/index.js  -> exit 1  "the filesystem store was removed"
 * src/jobs.js         -> exit 0  BYPASSED_THE_TOMBSTONE
 * src/store/pg.js     -> exit 0  BYPASSED_THE_TOMBSTONE
 * src/db/client.js    -> exit 0  BYPASSED_THE_TOMBSTONE
 * SPIDERYARN_STORE=files … tsx evals/cost/run.ts --list  -> exit 0, printed the corpus
 * ```
 *
 * Those are not toy paths: `scripts/stage.ts` runs pipeline steps against a
 * reader's real articles, and `evals/cost/run.ts` spends money.
 *
 * **The import belongs at the narrowest boundary everything must cross**, which
 * is [`src/db/client.ts`](../src/db/client.ts) — `getDb` is exported from
 * exactly one place, `new Pool` / `pg` / `drizzle-orm/node-postgres` appear in
 * exactly one file, and every module in `src/` that reaches Postgres imports
 * `getDb` from it. A front door is whichever door you happened to walk through.
 *
 * So the table below is the point of this file. One root proving the refusal
 * proves nothing about the others, which is exactly how the first fix looked
 * complete.
 *
 * ## Why the child needs coherent credentials
 *
 * Because `src/store/index.ts` also refuses at import when `DATABASE_URL` and
 * `SUPABASE_URL` name different Supabase projects, and a child that died of
 * *that* would pass every assertion below while proving nothing about the flag.
 * The values are this project's own local ports from `supabase/config.toml`
 * (pinned by `tests/store-project-pair.test.ts`), so the pair is coherent and
 * the only thing left to die of is the flag. Nothing connects: `getDb()` is
 * called inside store methods, and `postgresBlobStore` builds a client without
 * reaching the network.
 *
 * ## Two controls, and neither is optional
 *
 * **That the child can boot at all**: the same child with the flag **unset**
 * must exit 0. Without it, "the child died" is satisfied by a typo in the import
 * path, a missing dependency, or a credential the pair check refuses — the whole
 * family of ways a red-first control lies.
 *
 * **That the child is in a deployment's environment**: the last case gives it a
 * deliberately mismatched `SUPABASE_URL` and requires it to die on the pair.
 * `src/store/index.ts` switches that check off under `VITEST` or
 * `NODE_ENV=test`, and the runner sets `VITEST` in every worker — so if the
 * clearing below ever stopped working, every case here would be measuring a
 * process in the *test's* configuration rather than a server's, and nothing else
 * in the file would notice, because the flag is refused before the pair check
 * either way.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

/** Long: a `tsx` cold start compiles `src/store/index.ts` and its whole graph. */
const SLOW = 120_000;

/**
 * This project's own local stack, from `supabase/config.toml`.
 *
 * Spelled out rather than read from `.env.local`, because the point is a
 * coherent pair and a developer's file is not guaranteed to be one — and
 * because a child that inherited the real credentials would be a child that
 * could reach a real project.
 */
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54362/postgres";
const API_URL = "http://127.0.0.1:54361";

interface Child {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Import `src/store/index.ts` the way a server does, with `store` as the flag.
 *
 * **`NODE_ENV=production` and no `VITEST`**, because both of those switch the
 * blob boot check off (src/store/index.ts says why) and this has to be the
 * environment a deployment is in rather than the one a test is in.
 *
 * **`SPIDERYARN_ENV_PINNED`**, because `loadEnvLocal()` applies `.env.local`
 * over an inherited value and a developer's file naming this variable would
 * erase the very thing under test — silently, since the override warning is
 * itself suppressed under some environments. Pinning is `src/env.ts`'s own
 * answer to that, and using it here keeps this file honest on any machine.
 */
function importTheStore(
  store: string | undefined,
  module = "src/store/index.ts",
  supabaseUrl: string = API_URL,
): Child {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: DB_URL,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key-and-never-used",
    SPIDERYARN_ENV_PINNED: "SPIDERYARN_STORE,DATABASE_URL,SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY",
    /* The runner sets this in every worker and it is inherited by children;
       leaving it would switch off the very branch a deployment runs. */
    VITEST: undefined,
    VITEST_WORKER_ID: undefined,
  };
  if (store === undefined) delete env.SPIDERYARN_STORE;
  else env.SPIDERYARN_STORE = store;

  /* **It prints on the way out.** A child that imported the module and lived is
     the failure under test, and `exit 0` alone would be indistinguishable from a
     child that never started. */
  const body = `void (async () => { await import(${JSON.stringify(
    path.join(ROOT, module),
  )}); console.log("BYPASSED_THE_TOMBSTONE"); })();`;

  const child = spawnSync(TSX, ["-e", body], {
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: child.status, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
}

/**
 * **Every module a deployment, a CLI or an eval can start from.**
 *
 * Not a list of front doors — a list of *independent roots*, each of which
 * reaches Postgres without necessarily reaching the others. `store/index.ts` is
 * the reader hub, `jobs.ts` is the queue (which deliberately does **not** import
 * the hub, to avoid a cycle), `pg.ts` is an adapter reached directly by
 * `pg-shelf.ts`, `upload-records.ts` and `ai-calls.ts` are the two other seams
 * bound outside the hub for the same cycle reason, and `db/client.ts` is the
 * boundary all five cross.
 *
 * Adding a root here is cheap; leaving one out is how the first fix passed.
 */
const ROOTS = [
  "src/db/client.ts",
  "src/store/index.ts",
  "src/jobs.ts",
  "src/store/pg.ts",
  "src/upload-records.ts",
  "src/store/ai-calls.ts",
] as const;

describe("a deployment that still says SPIDERYARN_STORE=files", () => {
  it.each(ROOTS)(
    "dies when %s is the first thing imported",
    (module) => {
      const child = importTheStore("files", module);
      const said = `${child.stdout}\n${child.stderr}`;
      expect(child.status, said).not.toBe(0);
      expect(said).not.toContain("BYPASSED_THE_TOMBSTONE");
      expect(said).toContain("the filesystem store was removed on 2026-09-05");
    },
    SLOW,
  );

  it(
    "dies at import rather than serving Postgres under another name",
    () => {
      const child = importTheStore("files");
      const said = `${child.stdout}\n${child.stderr}`;
      /* **Non-zero, and the sentence.** A status alone would be satisfied by
         any throw in that import graph; the sentence is what says it was this
         one. And the date, because that is the part the operator holding a
         Vercel environment variable actually needs. */
      expect(child.status, said).not.toBe(0);
      expect(said).toContain("the filesystem store was removed on 2026-09-05");
      expect(said).toContain("there is one store; unset this");
      /* It must die **before** the store is wired: this line is what a booted
         server prints, and printing it means the refusal came too late to be
         one. */
      expect(said).not.toContain("serving article reads from Postgres");
    },
    SLOW,
  );

  it(
    "dies on a typo the same way, because a typo is somebody who thinks they opted in",
    () => {
      const child = importTheStore("postgress");
      const said = `${child.stdout}\n${child.stderr}`;
      expect(child.status, said).not.toBe(0);
      expect(said).toContain('SPIDERYARN_STORE is "postgress"');
    },
    SLOW,
  );

  /**
   * **The control.** Same child, same credentials, no flag — it must boot.
   *
   * Without this, every assertion above is satisfied by a child that could not
   * start at all: a wrong path, a missing dependency, a credential the pair
   * check refuses. "It died" and "it never ran" are the same observation from
   * outside, and only this tells them apart.
   */
  it(
    "boots with the flag unset, so the refusals above are about the flag",
    () => {
      const child = importTheStore(undefined);
      const said = `${child.stdout}\n${child.stderr}`;
      expect(child.status, said).toBe(0);
      expect(said).toContain("serving article reads from Postgres");
    },
    SLOW,
  );

  /** And `postgres` is the value production carries today; it must pass too. */
  it(
    "boots on `postgres`, which is what Vercel still has set",
    () => {
      const child = importTheStore("postgres");
      const said = `${child.stdout}\n${child.stderr}`;
      expect(child.status, said).toBe(0);
      expect(said).toContain("serving article reads from Postgres");
    },
    SLOW,
  );

  /**
   * **The reviewer's own repro, run as a command rather than as an import.**
   *
   * `evals/cost/run.ts --list` printed the corpus and exited 0 with
   * `SPIDERYARN_STORE=files` — a command that spends money, continuing into
   * Postgres while the environment said otherwise. It is here because a list of
   * modules is a claim about the import graph, and this is a claim about a
   * thing somebody types. `--list` does no work and calls no model.
   */
  it(
    "refuses `npm run eval:cost -- --list`, which is a command that spends money",
    () => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: "production",
        SPIDERYARN_STORE: "files",
        SPIDERYARN_ENV_PINNED: "SPIDERYARN_STORE",
        VITEST: undefined,
        VITEST_WORKER_ID: undefined,
      };
      const child = spawnSync(TSX, [path.join(ROOT, "evals/cost/run.ts"), "--list"], {
        env,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
      const said = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
      expect(child.status, said).not.toBe(0);
      expect(said).toContain("the filesystem store was removed on 2026-09-05");
      /* The corpus line it used to print. Its absence is what says the refusal
         came before the work rather than after it. */
      expect(said).not.toContain("short-html");
    },
    SLOW,
  );

  /**
   * **The control on the environment**, and it earns its four seconds.
   *
   * Everything above rests on the child being in a *deployment's* environment
   * rather than a test's: `src/store/index.ts` switches its credential-pair
   * check off under `VITEST` or `NODE_ENV=test`, and the runner sets `VITEST` in
   * every worker and children inherit it. `importTheStore` clears it — and
   * nothing above would notice if that stopped working, because the flag is
   * refused *before* the pair check either way.
   *
   * So: same child, no flag, and a `SUPABASE_URL` on the wrong port. It must die
   * on the pair. If it exits 0 the boot check is switched off, which means the
   * environment is a test's and every case above is measuring the wrong process.
   */
  it(
    "is really in a deployment's environment, not the runner's",
    () => {
      const child = importTheStore(undefined, "src/store/index.ts", "http://127.0.0.1:2");
      const said = `${child.stdout}\n${child.stderr}`;
      expect(child.status, said).not.toBe(0);
      expect(said).toContain("not the same local");
    },
    SLOW,
  );
});

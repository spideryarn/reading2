/**
 * **The store must boot when the Supabase credentials are only in
 * `.env.local`** — and this is the one test that can watch it happen.
 *
 * ## The failure it executes
 *
 * `src/store/index.ts` checks the Supabase credentials in its **module body**,
 * via `postgresBlobStore` (src/store/blobs.ts). ESM evaluates a module's static
 * imports before the importing module's own first statement, so an entry point
 * that imports the store statically and calls `loadEnvLocal()` afterwards calls
 * it too late: the check has already read an environment `.env.local` never
 * reached, and the process dies at boot with *"there is no Supabase Storage
 * configured"*.
 *
 * That was covered by accident until 2026-09-06. `src/db/client.ts` opened with
 * `import "../store/live.js"` — the `SPIDERYARN_STORE` tombstone — and that
 * module called `loadEnvLocal()` as it evaluated. Stage I of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * deleted the tombstone and took the load with it, and
 * `scripts/live-spike.ts`, `evals/deepen/run.ts` and
 * `evals/cost/interactions.ts` all died. The fix is a module-scope
 * `loadEnvLocal();` in `src/db/client.ts` — the narrowest boundary every path
 * to Postgres crosses. Found by GPT Sol's review of stage I (F1).
 *
 * ## Why it has to be a child process
 *
 * **No test in the unit lane can execute this.** `src/store/index.ts` skips the
 * credential check under `process.env.VITEST` or `NODE_ENV=test`, and the runner
 * sets both — deliberately, because the unit lane poisons `DATABASE_URL` and
 * `SUPABASE_URL` to two different loopback ports and that is precisely the split
 * brain the check refuses (tests/setup/unit-no-database.ts). A module is also
 * evaluated once per worker, and this one is already loaded by the time any
 * suite runs. So the environment has to be a *deployment's*, in a process of its
 * own, imported fresh.
 *
 * `tests/one-store-only.test.ts` asserts the `loadEnvLocal()` line is still
 * there, at module scope, by reading the AST. That is a claim about the source;
 * this is the outcome. Neither replaces the other — the source guard is what
 * fails fast and names the line, this is what proves the line does the job.
 *
 * **Shaped after the deleted `tests/store-flag-refused-at-boot.test.ts`**
 * (in git at 870bcb83), which spawned `tsx` children and required them to die.
 * Same harness, opposite verdict: that file proved a refusal fired, this proves
 * a boot succeeds.
 *
 * ## The three cases, and why the second and third are not optional
 *
 * A child that reaches the marker proves the fix works *only if* a child that
 * should not reach it does not. Otherwise a boot check quietly switched off —
 * `VITEST` leaking in, `NODE_ENV` left at `test`, the whole block deleted —
 * looks exactly like a working fix. That is the failure class this repo keeps
 * writing postmortems about (docs/reusable/silent-success.md), and it is the
 * one that produced this test's own subject.
 *
 * The third case is the control on the second: **an empty string in the
 * environment does not withhold a credential**, and if you assume it does, the
 * negative control passes for a reason that has nothing to do with the boot
 * check. See `withheld` below, where that is measured rather than argued.
 *
 * Needs no database: nothing here connects. `getDb()` is called inside store
 * methods and `postgresBlobStore` builds a Supabase client without reaching the
 * network. It does need a `.env.local` holding the credentials, and it says so
 * loudly rather than skipping — see the first case.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseEnvFile } from "../src/env.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const ENV_LOCAL = path.join(ROOT, ".env.local");

/** Long: a `tsx` cold start compiles `src/store/index.ts` and its whole graph. */
const SLOW = 120_000;

/**
 * What the child prints once the import has returned.
 *
 * **It prints on the way out, rather than exiting 0 quietly.** A status of 0
 * alone is also what a child that never started produces — a wrong path, a
 * missing binary — and those are the ways a green-first test lies.
 */
const MARKER = "STORE_BOOTED_WITHOUT_INHERITED_CREDENTIALS";

/**
 * The three names the boot check needs, and the fourth that has to agree with
 * them.
 *
 * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are what `postgresBlobStore`
 * requires; `SUPABASE_ANON_KEY` is here because the brief for this test named
 * it and removing it costs nothing. `DATABASE_URL` is separate below because it
 * is not a credential this checks for — it is the other half of the *pair*
 * check, and a child left holding the unit lane's poisoned value would die on
 * the mismatch instead, which would pass every "it did not boot" assertion
 * while proving nothing.
 */
const CREDENTIALS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"] as const;

interface Child {
  status: number | null;
  said: string;
}

/**
 * Import `src/store/index.ts` the way a deployment does, in a fresh process.
 *
 * **`NODE_ENV=production` and no `VITEST`**, because either of those switches
 * the credential check off (src/store/index.ts says why) and the whole point is
 * to be in the environment a server is in rather than the one a test is in.
 *
 * **Every Supabase name and `DATABASE_URL` deleted, and `SPIDERYARN_ENV_PINNED`
 * with them.** The unit lane sets all three: two poisoned URLs and a pin telling
 * `.env.local` not to overwrite them (tests/setup/unit-no-database.ts). A child
 * inheriting the pin cannot read its credentials out of `.env.local` at all,
 * which is the state this function exists to distinguish from — so the pin goes,
 * and each case that wants something withheld says so itself.
 */
function bootTheStore(mutate: (env: NodeJS.ProcessEnv) => void = () => {}): Child {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  /* Deleted rather than set to `undefined`: Node drops undefined values when it
     builds the child's environment, but "absent" is the property under test and
     it should be visible in this function rather than in Node's spawn rules. */
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  delete env.SPIDERYARN_ENV_PINNED;
  delete env.DATABASE_URL;
  for (const name of CREDENTIALS) delete env[name];
  mutate(env);

  const body = `void (async () => { await import(${JSON.stringify(
    path.join(ROOT, "src/store/index.ts"),
  )}); console.log(${JSON.stringify(MARKER)}); })();`;

  const child = spawnSync(TSX, ["-e", body], {
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: child.status, said: `${child.stdout ?? ""}\n${child.stderr ?? ""}` };
}

/**
 * Make `.env.local` unable to supply the credentials, for a child that must
 * fail.
 *
 * **An empty string is not enough, and that is measured.** `applyEnvFile`
 * (src/env.ts) skips a name only when the current value differs from the
 * snapshot it took at *its own* module load — "this process set it on purpose".
 * A child's snapshot is taken after it inherited the environment, so an empty
 * string it was born with reads as "the shell said so" and `.env.local` wins.
 * Run 2026-09-06 with the three names set to `""` and nothing else changed: the
 * child booted, reached the marker, and `src/env.ts` printed *".env.local
 * overrode SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY from the
 * shell environment"*. The third case below is that run, kept as a test so the
 * claim cannot rot.
 *
 * `SPIDERYARN_ENV_PINNED` is the mechanism that does work, because it is a
 * string in the environment rather than a comparison against a snapshot, and so
 * survives `spawn` — src/env.ts § `PINNED`.
 */
function withheld(env: NodeJS.ProcessEnv): void {
  for (const name of CREDENTIALS) env[name] = "";
  env.SPIDERYARN_ENV_PINNED = CREDENTIALS.join(",");
}

describe("the store boots on credentials that are only in .env.local", () => {
  /**
   * **The precondition, said out loud rather than skipped around.**
   *
   * Every case below turns on `.env.local` holding what the environment does
   * not. On a machine where it does not, they would pass or fail for reasons
   * that have nothing to do with `loadEnvLocal()` — so this fails first, and
   * names what is missing.
   *
   * **Key names only.** These are secrets; whether a name is present is the
   * whole question and no value is needed to answer it, so none is read into a
   * message.
   */
  it("has a .env.local holding the credentials the cases below depend on", () => {
    let text: string;
    try {
      text = readFileSync(ENV_LOCAL, "utf8");
    } catch {
      throw new Error(
        `${ENV_LOCAL} is missing. This suite spawns a production-shaped child with the ` +
          "Supabase credentials absent from its environment and requires it to find them in " +
          "that file; without one there is nothing to find. See docs/project/setup-dev.md.",
      );
    }
    const present = new Set(Object.keys(parseEnvFile(text)));
    const absent = [...CREDENTIALS, "DATABASE_URL"].filter((name) => !present.has(name));
    expect(
      absent,
      "names missing from .env.local — no value was read, only whether the name is there",
    ).toEqual([]);
  });

  /**
   * **The case, and the one the mutation test drives.** Comment out
   * `loadEnvLocal();` at module scope in `src/db/client.ts` and this goes red
   * with the boot error; put it back and it goes green. Measured both ways on
   * 2026-09-06.
   */
  it(
    "imports src/store/index.ts with the Supabase credentials absent from its environment",
    () => {
      const child = bootTheStore();
      expect(child.said).toContain(MARKER);
      expect(child.status, child.said).toBe(0);
      /* The line a booted store logs. Its presence says the import got past the
         wiring rather than merely past the check. */
      expect(child.said).toContain("serving article reads from Postgres");
    },
    SLOW,
  );

  /**
   * **The negative control**, and without it the case above is satisfied by a
   * boot check that is not running at all.
   *
   * Same child, same everything, except that `.env.local` is forbidden to supply
   * the three names (`withheld` says how, and why the obvious way does not
   * work). It must die, before the marker, on the sentence
   * `postgresBlobStore` throws. If this ever goes green, the check has been
   * switched off or deleted and the case above is measuring nothing.
   */
  it(
    "dies when nothing can supply them, so the case above is about loadEnvLocal and not about a check that stopped running",
    () => {
      const child = bootTheStore(withheld);
      expect(child.said).not.toContain(MARKER);
      expect(child.status, child.said).not.toBe(0);
      expect(child.said).toContain("there is no Supabase Storage configured");
      /* It must die **before** the store is wired: this is what a booted store
         prints, and printing it would mean the refusal came too late to be one. */
      expect(child.said).not.toContain("serving article reads from Postgres");
    },
    SLOW,
  );

  /**
   * **The control on the control**, pinning the precedence rule the negative
   * control depends on.
   *
   * `withheld` uses `SPIDERYARN_ENV_PINNED` and not just empty strings, because
   * empty strings do not withhold anything: `.env.local` beats an inherited
   * value, and a child cannot tell an inherited empty string from a deliberate
   * one (src/env.ts § *The one thing `INHERITED` cannot do*). This is that
   * measurement, held as a test — so that if the precedence rule ever changes,
   * *this* goes red and says so, rather than the negative control silently
   * starting to pass for the wrong reason.
   */
  it(
    "boots with the credentials set to empty strings and not pinned, because .env.local beats an inherited value",
    () => {
      const child = bootTheStore((env) => {
        for (const name of CREDENTIALS) env[name] = "";
      });
      expect(child.said).toContain(MARKER);
      expect(child.status, child.said).toBe(0);
    },
    SLOW,
  );
});

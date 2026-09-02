/**
 * `npm run dev` must serve from Postgres, and must refuse to boot without it.
 *
 * **Why this file exists at all.** Both halves of that guarantee live outside
 * TypeScript — one in a `package.json` script, one in `vite.config.ts`, neither
 * imported by any other test. So deleting either would leave the whole suite
 * green while quietly restoring the hole that
 * docs/plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md
 * exists to close: the filesystem queue cannot fence two servers over one
 * checkout, and that cost about a third of all the AI spend we have ever
 * recorded. GPT Sol asked for this test by name, 2026-09-02.
 *
 * **The first case runs the shell rather than matching the string**, which is
 * the point. What matters is not how the script is spelled but what `sh` does
 * with it: unset must become `postgres`, and an explicit value must survive. A
 * regex over `${SPIDERYARN_STORE:-postgres}` would pass just as happily for
 * `SPIDERYARN_STORE=postgres`, which is the hard-set form we deliberately
 * rejected.
 *
 * The second case is a source guard, and is honest about being one: a boot
 * probe inside a Vite config cannot be imported and called from here. It pins
 * the pieces whose removal would be silent.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(new URL(rel, new URL("..", import.meta.url)), "utf8");

const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

/**
 * Run a script's leading `VAR=…` assignment and report what the child saw.
 *
 * npm runs scripts through `sh`, so this asks the same shell the same question,
 * with `SPIDERYARN_STORE` either absent from the environment or set.
 */
function storeSeenBy(script: string, preset?: string): string {
  const assignment = /^(SPIDERYARN_STORE=\S+)\s/.exec(script)?.[1];
  if (!assignment) throw new Error(`no SPIDERYARN_STORE assignment at the head of: ${script}`);

  const { SPIDERYARN_STORE: _dropped, ...rest } = process.env;
  return execFileSync("sh", ["-c", `${assignment} printenv SPIDERYARN_STORE`], {
    cwd: repoRoot,
    encoding: "utf8",
    env: preset === undefined ? rest : { ...rest, SPIDERYARN_STORE: preset },
  }).trim();
}

describe("npm run dev defaults to the Postgres store", () => {
  for (const name of ["dev", "dev:pretty"]) {
    it(`${name} serves from Postgres when nothing has said otherwise`, () => {
      expect(storeSeenBy(pkg.scripts[name] ?? "")).toBe("postgres");
    });

    it(`${name} is a default, not an override — an explicit files still wins`, () => {
      expect(storeSeenBy(pkg.scripts[name] ?? "", "files")).toBe("files");
    });
  }

  /* Not `dev`'s business, and stated so the next person does not "fix" it:
     `vite preview` has no npm script, so it is still `files` unless told. */
  it("leaves every other entry point alone", () => {
    expect(pkg.scripts.test).not.toContain("SPIDERYARN_STORE");
    expect(pkg.scripts.build).not.toContain("SPIDERYARN_STORE");
  });
});

describe("a database that does not answer stops the dev server at boot", () => {
  const config = read("vite.config.ts");

  it("probes before the API is mounted, not on the first request", () => {
    expect(config).toMatch(/async function createApiMiddleware[\s\S]{0,120}await assertStoreReachable\(\)/);
  });

  it("probes only in Postgres mode, and bounds the wait", () => {
    const body = /async function assertStoreReachable[\s\S]*?\n}\n/.exec(config)?.[0] ?? "";
    expect(body).toContain('STORE !== "postgres"');
    expect(body).toMatch(/select 1/);
    // A pool with no connectionTimeoutMillis can hang forever on a blackholed
    // address; without this the helpful message is never reached.
    expect(body).toMatch(/setTimeout|timeout/i);
  });

  it("names the way out, in the place that actually works", () => {
    // `.env.local` beats the command line by design (src/env.ts), so telling
    // somebody to type a prefix would be advice that silently does nothing.
    expect(config).toContain("npm run db:start");
    expect(config).toContain(".env.local");
  });
});

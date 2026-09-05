/**
 * `npm run dev` must refuse to boot when the database does not answer.
 *
 * **Why this file exists at all.** That guarantee lives outside TypeScript — in
 * `vite.config.ts`, imported by no other test — so deleting it would leave the
 * whole suite green while quietly restoring the hole that
 * docs/plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md
 * exists to close: two servers over one checkout that cannot fence each other,
 * which cost about a third of all the AI spend we have ever recorded. GPT Sol
 * asked for this test by name, 2026-09-02.
 *
 * ## Half of it went with the flag, and this is what that half was
 *
 * Until 2026-09-05 the file was named for its other half: `npm run dev` carried
 * `SPIDERYARN_STORE=${SPIDERYARN_STORE:-postgres}`, and two cases ran that
 * assignment through `sh` — because what mattered was not how the script was
 * spelled but what the shell did with it: unset had to become `postgres`, and an
 * explicit value had to survive. There is one store since the hinge, and no
 * assignment in any script, so those cases have nothing left to ask. The
 * variable's remaining behaviour is the tombstone, and
 * `tests/store-selection.test.ts` is where that is asserted.
 *
 * What is left is a **source guard**, and it is honest about being one: a boot
 * probe inside a Vite config cannot be imported and called from here. It pins
 * the pieces whose removal would be silent.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, new URL("..", import.meta.url)), "utf8");

describe("a database that does not answer stops the dev server at boot", () => {
  const config = read("vite.config.ts");

  it("probes before the API is mounted, not on the first request", () => {
    expect(config).toMatch(/async function createApiMiddleware[\s\S]{0,120}await assertStoreReachable\(\)/);
  });

  it("asks the database a real question, and bounds the wait", () => {
    const body = /async function assertStoreReachable[\s\S]*?\n}\n/.exec(config)?.[0] ?? "";
    /* Non-empty, or every assertion under it passes over a regex that stopped
       matching — the vacuous-collector shape in docs/reusable/silent-success.md. */
    expect(body.length).toBeGreaterThan(200);
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

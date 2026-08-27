/**
 * **No secret-shaped key may reach the browser.**
 *
 * `VITE_`-prefixed variables are compiled into the bundle by Vite, verbatim, at
 * build time. The publishable key belongs there and grants nothing on its own;
 * the secret key (`sb_secret_…`) and the legacy `service_role` key bypass row
 * level security entirely, and either one in a `VITE_` variable is a
 * one-character mistake away — the names differ by a word.
 *
 * ## Two things the obvious version of this check gets wrong
 *
 * `grep -rc "service_role" dist/` prints a count per file and **exits 1 when it
 * finds nothing**, so in a checklist read by eye the passing case looks like a
 * failure and the failing case looks like a pass.
 *
 * And a legacy service-role key does not contain the string `service_role` in
 * the clear: it is a JWT, and the role is inside the base64 payload. So this
 * decodes anything JWT-shaped rather than searching for a word. GPT Sol,
 * 2026-08-26.
 *
 * This runs against the source of truth this test *can* see — the environment
 * and `dist/` if it has been built. The deployed bundle is checked separately
 * and from outside, by `scripts/check-production-gate.sh`, because a local
 * `dist/` is not what production is serving.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findSecretsInBundle } from "../scripts/deploy-checks.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");

/**
 * **One implementation, shared with the deploy script.**
 *
 * There were two copies of this rule, and on 2026-08-27 the *other* one shipped
 * with the bug this one had already fixed and written up: a bare
 * `includes("sb_secret_")`, which matches supabase-js's own
 * `key.startsWith("sb_secret_")` and so reported a leaked key in the live
 * production bundle. Two copies of a security rule is one copy and one liability
 * — see scripts/deploy-checks.ts, where the rule now lives, and the note there
 * about why the trailing key material is required.
 *
 * The labels differ from that module's on purpose: these name what a *test*
 * found, and pinning the exact wording of somebody else's message is how a test
 * comes to fail over a rewording.
 */
function secretsIn(text: string): string[] {
  return findSecretsInBundle(text).map((what) =>
    what.includes("sb_secret") ? "sb_secret_ key" : "legacy service_role JWT",
  );
}

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesIn(full) : [full];
  });
}

describe("no secret reaches the browser", () => {
  it("finds none in any VITE_ environment variable", () => {
    const offenders = Object.entries(process.env)
      .filter(([name]) => name.startsWith("VITE_"))
      .flatMap(([name, value]) => secretsIn(value ?? "").map((what) => `${name}: ${what}`));
    expect(offenders).toEqual([]);
  });

  /**
   * **Genuinely skipped, not quietly passed.**
   *
   * The first version returned early with a `console.warn` when `dist/` was
   * missing, which vitest reports as a green tick — a check that had nothing to
   * look at, reporting success, in the one file whose entire subject is checks
   * that report success while doing nothing. `skipIf` makes the run say
   * "skipped". GPT Sol, 2026-08-27.
   */
  it.skipIf(!existsSync(DIST))("finds none in a built bundle, when there is one", () => {
    const dist = DIST;
    const offenders = filesIn(dist)
      .filter((f) => /\.(js|mjs|css|html|map)$/.test(f))
      .flatMap((f) => secretsIn(readFileSync(f, "utf8")).map((what) => `${path.relative(ROOT, f)}: ${what}`));
    expect(offenders).toEqual([]);
  });

  /**
   * **And it must be a bundle of THIS source.**
   *
   * A `dist/` from three weeks ago passes the test above without objecting, and
   * the green tick then means "no secret reached a bundle nobody is shipping".
   * That is not nothing, but it is not what anybody reads it as.
   *
   * Only a warning when the build is stale, deliberately: `npm test` must not
   * start demanding a build, or people will stop running one of them. What it
   * must not do is stay silent. The real check on what production is actually
   * serving is `scripts/check-production-gate.sh`, which downloads the served
   * JavaScript — this can only ever be a local proxy for it.
   */
  it.skipIf(!existsSync(DIST))("says so if that bundle is older than the source", () => {
    const newest = (dir: string) =>
      filesIn(dir).reduce((max, f) => Math.max(max, statSync(f).mtimeMs), 0);
    const built = newest(DIST);
    const source = newest(path.join(ROOT, "src"));
    if (source > built) {
      const days = Math.round((source - built) / 86_400_000);
      console.warn(
        `[no-secrets] dist/ is older than src/ by ~${days} day(s). The bundle checked ` +
          "above is not built from the current source. Run `npm run build`.",
      );
    }
    /* The assertion is that we could tell — not that it is fresh. A test that
       failed on a stale build would fail for everybody who has not built today,
       and would be turned off within a week. */
    expect(Number.isFinite(built) && built > 0).toBe(true);
  });

  /* The detector, proved against the thing it is looking for. Both of these are
     made up: `sb_secret_` plus filler, and a JWT payload we build here. */
  it("would catch either kind", () => {
    expect(secretsIn("sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz")).toContain("sb_secret_ key");
    /* And the SDK's own prefix check, which is what the first version of this
       detector flagged on a real build, is not a key. */
    expect(secretsIn('e.startsWith("sb_secret_")')).toEqual([]);
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    const fake = `eyJhbGciOiJIUzI1NiJ9.${payload}.abcdefghij`;
    expect(secretsIn(fake)).toContain("legacy service_role JWT");
    /* And the key that is *supposed* to be there is not flagged. */
    expect(secretsIn("sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH")).toEqual([]);
  });
});

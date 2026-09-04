/**
 * The build stamp: where a commit comes from, and what counts as two artefacts
 * agreeing about it.
 *
 * The interesting half is `sameCommit`, and specifically that `"unknown"` never
 * matches itself. Two artefacts that both failed to work out what they were
 * would otherwise compare equal, and the deploy check whose whole job is to
 * prove they came from the sha you pushed would pass over a pair that has no
 * idea. Every assertion here is written the way docs/reusable/silent-success.md
 * asks for: the broken case first, so the check is seen to fail.
 *
 * See scripts/build-stamp.ts and docs/plans/260827v-deploy-pipeline.md.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { missingClientEnv, resolveBuildStamp, sameCommit } from "../scripts/build-stamp.js";

const SHA = "1f032e20f723883f4eecd218b06701c754d320a5";
const OTHER = "d5a9d513a6d298147c81938873096dbad09e6d26";

describe("resolveBuildStamp", () => {
  it("prefers the explicit override over everything else", () => {
    const stamp = resolveBuildStamp({
      SPIDERYARN_BUILD_COMMIT: SHA,
      VERCEL_GIT_COMMIT_SHA: OTHER,
    } as NodeJS.ProcessEnv);
    expect(stamp.commit).toBe(SHA);
    expect(stamp.source).toBe("SPIDERYARN_BUILD_COMMIT");
  });

  it("falls back to Vercel's own variable", () => {
    const stamp = resolveBuildStamp({ VERCEL_GIT_COMMIT_SHA: OTHER } as NodeJS.ProcessEnv);
    expect(stamp.commit).toBe(OTHER);
    expect(stamp.source).toBe("VERCEL_GIT_COMMIT_SHA");
  });

  /* A variable set to whitespace is the shape a dashboard field takes when
     somebody clears it badly, and `Boolean(" ")` is true. The same trap
     src/vercel-health.ts had to be fixed for. */
  it("treats a blank variable as absent rather than as a commit", () => {
    const stamp = resolveBuildStamp({
      SPIDERYARN_BUILD_COMMIT: "   ",
      VERCEL_GIT_COMMIT_SHA: OTHER,
    } as NodeJS.ProcessEnv);
    expect(stamp.commit).toBe(OTHER);
  });

  /* Run inside this repo, so git answers. The point is not the value — it is
     that the fallback is reached at all when no variable is set, since that is
     the path every local `npm run build` takes. */
  it("asks git when nothing in the environment knows", () => {
    const stamp = resolveBuildStamp({} as NodeJS.ProcessEnv);
    expect(stamp.source).toBe("git");
    expect(stamp.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("stamps a parsable time", () => {
    const stamp = resolveBuildStamp({ VERCEL_GIT_COMMIT_SHA: SHA } as NodeJS.ProcessEnv);
    expect(Number.isNaN(Date.parse(stamp.builtAt))).toBe(false);
  });
});

describe("sameCommit", () => {
  /* The one that matters. Everything else here is arithmetic. */
  it("says no when both sides are unknown", () => {
    expect(sameCommit("unknown", "unknown")).toBe(false);
  });

  it("says no when either side is missing", () => {
    expect(sameCommit(SHA, null)).toBe(false);
    expect(sameCommit(undefined, SHA)).toBe(false);
    expect(sameCommit(SHA, "")).toBe(false);
  });

  it("says no for two different commits", () => {
    expect(sameCommit(SHA, OTHER)).toBe(false);
  });

  it("says yes for the same commit, whatever the case or surrounding space", () => {
    expect(sameCommit(SHA, ` ${SHA.toUpperCase()} `)).toBe(true);
  });

  it("matches an abbreviated sha against a full one", () => {
    expect(sameCommit(SHA.slice(0, 7), SHA)).toBe(true);
    expect(sameCommit(SHA, SHA.slice(0, 12))).toBe(true);
  });

  /* Below seven characters a prefix match stops being evidence — `1f03` would
     match a meaningful share of any repository's history. */
  it("refuses a prefix too short to mean anything", () => {
    expect(sameCommit(SHA.slice(0, 6), SHA)).toBe(false);
  });

  it("does not match a prefix of the wrong commit", () => {
    expect(sameCommit(OTHER.slice(0, 8), SHA)).toBe(false);
  });
});

describe("missingClientEnv", () => {
  const good = {
    VITE_SUPABASE_URL: "https://x.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  } as NodeJS.ProcessEnv;

  it("says nothing when both are set", () => {
    expect(missingClientEnv(good)).toEqual([]);
  });

  /* The blank page: the bundle throws at module load and reports nothing
     anywhere, while every server-side check stays green. */
  it("names both when neither is set", () => {
    expect(missingClientEnv({} as NodeJS.ProcessEnv)).toEqual([
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
    ]);
  });

  it("names the one that is missing", () => {
    expect(missingClientEnv({ ...good, VITE_SUPABASE_URL: undefined })).toEqual(["VITE_SUPABASE_URL"]);
  });

  /* A dashboard field cleared badly leaves a space, and `Boolean(" ")` is true —
     the same trap src/vercel-health.ts had to be fixed for. */
  it("counts a whitespace-only value as missing", () => {
    expect(missingClientEnv({ ...good, VITE_SUPABASE_PUBLISHABLE_KEY: "  " })).toEqual([
      "VITE_SUPABASE_PUBLISHABLE_KEY",
    ]);
  });
});

/**
 * **The stamp only reaches the client if `define` carries it**, and nothing
 * else in this suite would notice its removal.
 *
 * `src/web/build-stamp.ts` reads both constants behind a `typeof` guard, so
 * deleting either line from `vite.config.ts` does not fail a type-check, does
 * not fail a render test — the page simply, quietly, stops saying when it was
 * built. That is precisely the shape docs/reusable/silent-success.md is about,
 * and this is the cheapest check that sees it: the source of the config, read
 * as text.
 *
 * Text rather than importing the config, because loading it runs
 * `resolveBuildStamp()` and `loadEnvLocal()` for a question about two lines.
 */
describe("the client define block", () => {
  const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  const block = config.slice(config.indexOf("define: {"));

  it("compiles the commit into the bundle", () => {
    expect(block).toContain("__SPIDERYARN_BUILD_COMMIT__: JSON.stringify(stamp.commit)");
  });

  it("compiles the build time in too, which /admin draws its age from", () => {
    expect(block).toContain("__SPIDERYARN_BUILD_TIME__: JSON.stringify(stamp.builtAt)");
  });
});

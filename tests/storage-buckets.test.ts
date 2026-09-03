/**
 * The bucket check's target, its repair, and the gate that finally runs it.
 *
 * **Every case here is the state that actually happened**, not a synthetic one:
 * production's `sources` bucket said `{application/pdf, text/html}` while
 * `supabase/config.toml` declared five types, every `image/jpeg` upload threw a
 * 415, and the check written to catch exactly that could not be aimed at
 * production — it read `.env.local`, printed a tick about the Docker container
 * and exited 0. docs/plans/260903j-illustrated-415-and-one-click-paint.md and
 * docs/postmortems/260903f-the-bucket-allowlist-drifted-again-on-production.md.
 *
 * So the target selection is tested as hard as the judgement is. It is now
 * load-bearing for a **write**: `--prod --apply` that fell back to `.env.local`
 * would PATCH the laptop and print that production was repaired.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { bucketDrift, declaredBuckets } from "../scripts/deploy-checks.js";
import type { DeclaredBucket, RunningBucket } from "../scripts/deploy-checks.js";
import {
  bucketPutBody,
  chooseStorage,
  narrowings,
  storageBucketProblems,
  targetLine,
  whyNotProductionStorage,
} from "../scripts/storage-buckets.js";

const REPO = path.join(import.meta.dirname, "..");
const CONFIG = readFileSync(path.join(REPO, "supabase", "config.toml"), "utf8");

/** The `sources` bucket exactly as production reported it on 2026-09-03. */
const PRODUCTION_SOURCES: RunningBucket = {
  id: "sources",
  public: false,
  file_size_limit: 52_428_800,
  allowed_mime_types: ["application/pdf", "text/html"],
};

const PROD_ENV = {
  file: "/Users/greg/dev/spideryarn/reading2/.env.prod",
  values: {
    SUPABASE_URL: "https://alschkahzfagtppxspfq.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "prod-service-key",
  },
};

const LOCAL_ENV = {
  SUPABASE_URL: "http://127.0.0.1:54361",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-key",
};

/* ------------------------------------------------------------------ */

describe("the drift that was really there, against the file that was really there", () => {
  it("reports the three image types production would not accept", () => {
    /* Not a fixture pair: the declaration is read out of the repository's own
       supabase/config.toml, and the running bucket is what the project
       answered. A test written from two hand-made lists could agree with its
       author about a file it had never read. */
    const declared = declaredBuckets(CONFIG);
    const problems = bucketDrift(declared, [PRODUCTION_SOURCES]);
    expect(problems).toEqual([
      'bucket "sources" does not accept image/gif, image/jpeg, image/png',
    ]);
  });

  it("is silent about the same bucket once it has been repaired", () => {
    const sources = declaredBuckets(CONFIG).find((b) => b.name === "sources");
    expect(sources, "supabase/config.toml no longer declares sources").toBeDefined();
    const repaired: RunningBucket = {
      ...PRODUCTION_SOURCES,
      allowed_mime_types: [...(sources?.allowedMimeTypes ?? [])],
    };
    expect(bucketDrift(declaredBuckets(CONFIG), [repaired])).toEqual([]);
  });
});

describe("which project the command is about to touch", () => {
  it("--prod takes the production project, and NOT the one in .env.local", () => {
    /* The whole bug in one assertion. `loadEnvLocal()` has already put
       `.env.local`'s values into `process.env` by the time this is called — that
       is deliberate and correct (src/env.ts) — so a `--prod` that read the
       environment would quietly report on, and with --apply write to, the
       Docker container. */
    const target = chooseStorage({ prod: true, env: LOCAL_ENV, found: PROD_ENV });
    expect(target?.url).toBe("https://alschkahzfagtppxspfq.supabase.co");
    expect(target?.url).not.toContain("127.0.0.1");
    expect(target?.key).toBe("prod-service-key");
    expect(target?.from).toBe(PROD_ENV.file);
  });

  it("without --prod it is the local project, and says so", () => {
    const target = chooseStorage({ prod: false, env: LOCAL_ENV, found: PROD_ENV });
    if (!target) throw new Error("the local project is configured and should have been chosen");
    expect(target.url).toBe("http://127.0.0.1:54361");
    expect(targetLine(target)).toContain("http://127.0.0.1:54361");
  });

  it("refuses --prod when there is no .env.prod, rather than falling back", () => {
    expect(() => chooseStorage({ prod: true, env: LOCAL_ENV, found: null })).toThrow(/\.env\.prod/);
  });

  it("refuses a .env.prod that points at the laptop", () => {
    /* A `.env.prod` naming a local project is how `--apply` writes to the
       Docker container while printing that production was repaired. */
    const local = { file: "/x/.env.prod", values: { ...LOCAL_ENV } };
    expect(() => chooseStorage({ prod: true, env: {}, found: local })).toThrow(/not a production project/);
  });

  it("refuses --prod when .env.prod is missing the key", () => {
    const half = { file: "/x/.env.prod", values: { SUPABASE_URL: PROD_ENV.values.SUPABASE_URL } };
    expect(() => chooseStorage({ prod: true, env: LOCAL_ENV, found: half })).toThrow(
      /has no SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("skips rather than throws when nothing at all is configured", () => {
    expect(chooseStorage({ prod: false, env: {}, found: null })).toBeNull();
  });

  it("classifies production positively, so what it cannot read it refuses", () => {
    expect(whyNotProductionStorage("https://abc123.supabase.co")).toBeNull();
    expect(whyNotProductionStorage("http://abc123.supabase.co")).toContain("not https");
    expect(whyNotProductionStorage("https://local%68ost")).toContain("localhost");
    expect(whyNotProductionStorage("https://abc123.supabase.co.attacker.net")).toContain(
      "attacker.net",
    );
    expect(whyNotProductionStorage("not a url")).toContain("not a parsable URL");
  });

  it("never puts the service key in the line it prints", () => {
    const line = targetLine({ url: "https://p.supabase.co", key: "sb-secret", from: "/x/.env.prod" });
    expect(line).not.toContain("sb-secret");
    expect(line).toContain("Target: https://p.supabase.co");
  });
});

describe("what a repair would take away", () => {
  const declared = (over: Partial<DeclaredBucket> = {}): DeclaredBucket => ({
    name: "sources",
    public: false,
    fileSizeLimit: 52_428_800,
    allowedMimeTypes: ["application/pdf", "text/html", "image/png", "image/jpeg", "image/gif"],
    ...over,
  });

  it("says nothing about the repair production actually needs", () => {
    /* Widening only: every type the bucket accepts today it still accepts
       afterwards. This is the case that must NOT need a second flag, or the
       repair is a two-flag command on the day somebody is under pressure. */
    expect(narrowings(declared(), PRODUCTION_SOURCES)).toEqual([]);
  });

  it("catches a type the write would stop accepting", () => {
    const wider: RunningBucket = {
      ...PRODUCTION_SOURCES,
      allowed_mime_types: ["application/pdf", "text/html", "image/webp"],
    };
    expect(narrowings(declared(), wider)[0]).toContain("stop accepting image/webp");
  });

  it("counts a bucket that currently accepts anything", () => {
    const anything: RunningBucket = { ...PRODUCTION_SOURCES, allowed_mime_types: null };
    expect(narrowings(declared(), anything)[0]).toContain("accepts any type now");
  });

  it("counts a visibility change in either direction", () => {
    expect(narrowings(declared(), { ...PRODUCTION_SOURCES, public: true })[0]).toContain(
      "would become private",
    );
    expect(narrowings(declared({ public: true }), PRODUCTION_SOURCES)[0]).toContain(
      "would become public",
    );
  });

  it("counts a size limit going down but not one going up", () => {
    expect(narrowings(declared(), { ...PRODUCTION_SOURCES, file_size_limit: null })[0]).toContain(
      "size limit would drop",
    );
    expect(
      narrowings(declared({ fileSizeLimit: null }), PRODUCTION_SOURCES),
    ).toEqual([]);
  });

  it("sends the file's values, under the names Storage uses", () => {
    expect(bucketPutBody(declared())).toEqual({
      public: false,
      file_size_limit: 52_428_800,
      allowed_mime_types: [
        "application/pdf",
        "text/html",
        "image/png",
        "image/jpeg",
        "image/gif",
      ],
    });
  });
});

describe("the deploy gate", () => {
  it("fails on the drift production really had, and names the repair", async () => {
    const { target, problems } = await storageBucketProblems({
      configToml: CONFIG,
      found: PROD_ENV,
      fetchRunning: async () => [PRODUCTION_SOURCES],
    });
    expect(target).toContain("https://alschkahzfagtppxspfq.supabase.co");
    expect(problems[0]).toContain("does not accept image/gif, image/jpeg, image/png");
    expect(problems.join("\n")).toContain("check-buckets.ts --prod --apply");
  });

  it("passes on a project that matches", async () => {
    const sources = declaredBuckets(CONFIG).find((b) => b.name === "sources");
    const { problems } = await storageBucketProblems({
      configToml: CONFIG,
      found: PROD_ENV,
      fetchRunning: async () => [
        { ...PRODUCTION_SOURCES, allowed_mime_types: [...(sources?.allowedMimeTypes ?? [])] },
      ],
    });
    expect(problems).toEqual([]);
  });

  it("fails rather than skips when it cannot reach the project", async () => {
    /* A gate that cannot see the thing it is gating is not a gate. */
    const { problems } = await storageBucketProblems({
      configToml: CONFIG,
      found: PROD_ENV,
      fetchRunning: async () => {
        throw new Error("GET /storage/v1/bucket failed (401): Invalid JWT");
      },
    });
    expect(problems[0]).toContain("401");
  });

  it("fails rather than skips when the commit has no config file", async () => {
    const { problems } = await storageBucketProblems({
      configToml: null,
      found: PROD_ENV,
      fetchRunning: async () => [PRODUCTION_SOURCES],
    });
    expect(problems[0]).toContain("not in this commit");
  });

  it("fails rather than skips when there is no .env.prod to name production", async () => {
    const { problems } = await storageBucketProblems({
      configToml: CONFIG,
      found: null,
      fetchRunning: async () => [PRODUCTION_SOURCES],
    });
    expect(problems[0]).toContain(".env.prod");
  });
});

describe("scripts/deploy.ts actually runs it", () => {
  /* **Source text, and it is the weakest evidence in this file** — but
     `scripts/deploy.ts` runs `main()` at import, so a test cannot drive it.
     Everything that decides anything therefore lives in storage-buckets.ts,
     where the tests above exercise it for real, and this asserts only the one
     thing left: that the deploy calls it, before it pushes. Deleting the call
     reddens this. */
  const SOURCE = readFileSync(path.join(REPO, "scripts", "deploy.ts"), "utf8");

  it("imports the shared check rather than growing a second copy", () => {
    expect(SOURCE).toContain('from "./storage-buckets.js"');
    expect(SOURCE).toContain("storageBucketProblems");
  });

  it("calls it in main(), before the push", () => {
    const called = SOURCE.indexOf("await storageBuckets(");
    const pushed = SOURCE.indexOf('run("git", ["push", "origin"');
    expect(called, "scripts/deploy.ts never calls storageBuckets()").toBeGreaterThan(-1);
    expect(pushed).toBeGreaterThan(-1);
    expect(called, "the bucket gate runs after the push, which is not a gate").toBeLessThan(pushed);
  });

  it("records it as a check, so a drift is a failure and not a note", () => {
    expect(SOURCE).toContain('record("storage buckets match supabase/config.toml"');
  });
});

/**
 * Does the Storage project in your environment match `supabase/config.toml`?
 *
 *     npx tsx scripts/check-buckets.ts
 *     SUPABASE_URL=<remote> SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/check-buckets.ts
 *
 * Exits non-zero when it does not.
 *
 * ## Why this is not obvious, and why it needed a postmortem
 *
 * **Declaring a bucket in `config.toml` does not change one that already
 * exists.** The CLI seeds a bucket that is missing; nothing in this repo ever
 * reconciles one that is there. So the file and the running system drift
 * silently, and on 2026-08-27 they did: `text/html` was added to the `sources`
 * allowlist, the bucket kept saying `{application/pdf}`, and every HTML fetch
 * threw a 415 for seven hours —
 * docs/postmortems/the-config-file-is-not-the-bucket.md.
 *
 * Read-only: one `GET /storage/v1/bucket`. Pointing it at production is the
 * intended use, not the accident to prevent. It does **not** repair the drift,
 * because a bucket setting is a security control on the browser's signed-grant
 * path and widening one should be a decision rather than a side effect of
 * running a check.
 *
 * The judgement is `bucketDrift` in scripts/deploy-checks.ts, which is pure and
 * has been seen to say yes against every kind of difference — this file only
 * fetches and prints.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { bucketDrift, declaredBuckets } from "./deploy-checks.js";
import type { RunningBucket } from "./deploy-checks.js";
import { loadEnvLocal } from "../src/env.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    /* Not an error. A laptop with no Supabase container is a configuration
       somebody chose, and the filesystem blob store is right for it — but the
       skip has to be loud, because a check that says nothing quietly is
       indistinguishable from a check that passed. */
    console.log(
      "No SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — skipping. There is no Storage project to\n" +
        "compare against, and this check has therefore proved nothing.",
    );
    return;
  }

  const declared = declaredBuckets(
    await readFile(path.join(ROOT, "supabase", "config.toml"), "utf8"),
  );
  if (declared.length === 0) {
    throw new Error(
      "supabase/config.toml declares no buckets. Either the file moved or the parser stopped " +
        "reading it — scripts/deploy-checks.ts, declaredBuckets.",
    );
  }

  const res = await fetch(`${url}/storage/v1/bucket`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  if (!res.ok) {
    throw new Error(`GET /storage/v1/bucket failed (${res.status})`);
  }
  const body: unknown = await res.json();
  if (!Array.isArray(body)) {
    throw new Error(
      `GET /storage/v1/bucket returned ${typeof body}, not a list. Refusing to compare against ` +
        "something this does not understand.",
    );
  }
  const running = body as RunningBucket[];

  console.log(`Declared: ${declared.map((b) => b.name).join(", ")}`);
  console.log(`Running:  ${running.map((b) => b.id).join(", ") || "(none)"}\n`);

  const problems = bucketDrift(declared, running);
  if (problems.length === 0) {
    console.log("✓ every declared bucket matches the running project");
    return;
  }
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(
    `\n${problems.length} difference(s). Editing supabase/config.toml does not change a bucket\n` +
      "that already exists — see docs/postmortems/the-config-file-is-not-the-bucket.md.",
  );
  process.exitCode = 1;
}

void main();

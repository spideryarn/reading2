/**
 * Does the Storage project match `supabase/config.toml`? And, on request, make it.
 *
 *     npx tsx scripts/check-buckets.ts                      # the local project
 *     npx tsx scripts/check-buckets.ts --prod               # production, read-only
 *     npx tsx scripts/check-buckets.ts --prod --apply       # production, repaired
 *
 * Exits non-zero when they disagree and `--apply` was not asked for.
 *
 * ## `SUPABASE_URL=<remote> … npx tsx scripts/check-buckets.ts` does NOT work
 *
 * This file's header documented exactly that invocation until 2026-09-03, and
 * it was wrong in the worst available way. `loadEnvLocal()` lets `.env.local`
 * **beat the shell** — deliberately, and the reason is a good one (src/env.ts
 * § `.env.local` beats what the shell inherited) — so on any machine with a
 * `.env.local` that command talked to the Docker container, printed
 * `✓ every declared bucket matches the running project`, and exited 0. Anybody
 * who ran it to ask whether production had drifted was told it had not, while
 * production's `sources` bucket had been refusing every image upload with a 415
 * since 2026-08-27. Use `--prod`, which reads `.env.prod` and prints the project
 * it reached.
 *
 * It does not work in the other direction either, and now says so: on a machine
 * whose `.env.local` or shell *does* hold remote credentials, that command used
 * to make the default, unflagged mode a **write** to a hosted project. Without
 * `--prod` this command refuses anything that is not the container on this
 * machine — `whyNotLocalStorage` in scripts/storage-buckets.ts.
 *
 * ## Why this is not obvious, and why it needed a postmortem
 *
 * **Declaring a bucket in `config.toml` does not change one that already
 * exists.** The CLI seeds a bucket that is missing; nothing else in this repo
 * reconciles one that is there. So the file and the running system drift
 * silently, and on 2026-08-27 they did: `text/html` was added to the `sources`
 * allowlist, the bucket kept saying `{application/pdf}`, and every HTML fetch
 * threw a 415 for seven hours —
 * docs/postmortems/260828a-the-config-file-is-not-the-bucket.md. It then
 * happened again on production with the three image types, which is
 * docs/plans/260903j-illustrated-415-and-one-click-paint.md.
 *
 * ## `--apply` writes, and that is a decision somebody types
 *
 * The old header said repair was deliberately absent because *"widening an
 * allowlist is a security decision, not a side effect of running a check"*. That
 * is still true, and a flag **is** that decision — while the alternative is a
 * `curl` reconstructed from a doc under pressure, which is how these settings
 * drifted in the first place. Read-only is still the default, and a repair that
 * would take something away needs `--allow-narrowing` as well (see `narrowings`
 * in scripts/storage-buckets.ts for why the two directions are not one command).
 *
 * The judgement is `bucketDrift` in scripts/deploy-checks.ts, which is pure and
 * has been seen to say yes against every kind of difference; the target and the
 * writing are scripts/storage-buckets.ts, which `scripts/deploy.ts` shares so
 * the deploy gate and this command cannot disagree about what production is.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { bucketDrift, declaredBuckets } from "./deploy-checks.js";
import type { DeclaredBucket, RunningBucket } from "./deploy-checks.js";
import {
  chooseStorage,
  fetchBuckets,
  narrowings,
  putBucket,
  targetLine,
  type StorageTarget,
} from "./storage-buckets.js";
/* Generic despite the file it lives in: the trap it closes is that
   `--prodd` is not an error, it is silently the safe-looking default, and this
   command's `--apply` makes that worse rather than better. */
import { refuseUnknownArgs } from "./stripe-target.js";
import { loadEnvLocal, readEnvProd } from "../src/env.js";

const ROOT = path.resolve(import.meta.dirname, "..");

const PROD = process.argv.includes("--prod");
const APPLY = process.argv.includes("--apply");
const ALLOW_NARROWING = process.argv.includes("--allow-narrowing");

function describe(bucket: RunningBucket): string {
  const types = bucket.allowed_mime_types
    ? [...bucket.allowed_mime_types].join(", ")
    : "(any type)";
  return (
    `${bucket.public ? "public" : "private"}, ` +
    `${bucket.file_size_limit ?? "no"} byte limit, ` +
    `accepts ${types}`
  );
}

async function main(): Promise<number> {
  refuseUnknownArgs(process.argv, ["--prod", "--apply", "--allow-narrowing"]);
  loadEnvLocal();

  let target: StorageTarget | null;
  try {
    target = chooseStorage({ prod: PROD, env: process.env, found: PROD ? readEnvProd() : null });
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  if (!target) {
    /* Not an error. A laptop with no Supabase container is a configuration
       somebody chose, and the filesystem blob store is right for it — but the
       skip has to be loud, because a check that says nothing quietly is
       indistinguishable from a check that passed. */
    console.log(
      "No SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — skipping. There is no Storage project to\n" +
        "compare against, and this check has therefore proved nothing.",
    );
    return APPLY ? 2 : 0;
  }

  /* **Above the verdict, in every mode, safe ones included.** A target line that
     only appeared when something was dangerous would not be read on the one day
     it said something surprising. AGENTS.md: read the `Target:` line, not the
     success line. Never the key. */
  console.log(targetLine(target));

  const declared = declaredBuckets(await readFile(path.join(ROOT, "supabase", "config.toml"), "utf8"));
  if (declared.length === 0) {
    throw new Error(
      "supabase/config.toml declares no buckets. Either the file moved or the parser stopped " +
        "reading it — scripts/deploy-checks.ts, declaredBuckets.",
    );
  }

  const running = await fetchBuckets(target.url, target.key);

  console.log(`Declared: ${declared.map((b) => b.name).join(", ")}`);
  console.log(`Running:  ${running.map((b) => b.id).join(", ") || "(none)"}\n`);

  const problems = bucketDrift(declared, running);
  if (problems.length === 0) {
    console.log("✓ every declared bucket matches the running project");
    return 0;
  }
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(
    `\n${problems.length} difference(s). Editing supabase/config.toml does not change a bucket\n` +
      "that already exists — see docs/postmortems/260828a-the-config-file-is-not-the-bucket.md.",
  );

  if (!APPLY) {
    console.error("\nRepair it by running this again with --apply.");
    return 1;
  }
  return await apply(target, declared, running);
}

/**
 * Make each drifted bucket match its declaration, printing the before and after.
 *
 * The before/after is the point rather than a courtesy: it is the only evidence
 * that the write did what the flag said, and reading the bucket back afterwards
 * (`putBucket`) is the only evidence that the API honoured the fields rather
 * than dropping ones it did not recognise.
 */
async function apply(
  target: StorageTarget,
  declared: readonly DeclaredBucket[],
  running: readonly RunningBucket[],
): Promise<number> {
  console.log("\n--apply\n");
  const byId = new Map(running.map((b) => [b.id, b]));
  let failed = false;

  for (const want of declared) {
    const have = byId.get(want.name);
    if (!have) {
      /* Deliberately not created here. `--apply` repairs a bucket that exists;
         creating one is a POST with a different blast radius, it is what
         `supabase start` does locally from the same file, and on production it
         should be somebody's deliberate act rather than a side effect of a
         repair flag. */
      console.error(`  ✗ ${want.name}: does not exist. --apply repairs a bucket, it does not create one.`);
      failed = true;
      continue;
    }
    if (bucketDrift([want], [have]).length === 0) {
      console.log(`  · ${want.name}: already matches, left alone`);
      continue;
    }

    const losses = narrowings(want, have);
    if (losses.length > 0 && !ALLOW_NARROWING) {
      console.error(`  ✗ ${want.name}: this would take something away —`);
      for (const loss of losses) console.error(`        ${loss}`);
      console.error(
        "      Somebody may have widened the bucket by hand to get production working, in which\n" +
          "      case supabase/config.toml is the stale side and applying it breaks uploads that\n" +
          "      work right now. Decide which is right, then re-run with --allow-narrowing.",
      );
      failed = true;
      continue;
    }

    console.log(`  before  ${want.name}: ${describe(have)}`);
    const after = await putBucket(target, want);
    console.log(`  after   ${want.name}: ${describe(after)}`);

    const remaining = bucketDrift([want], [after]);
    for (const problem of remaining) console.error(`  ✗ still wrong: ${problem}`);
    if (remaining.length > 0) failed = true;
    else console.log(`  ✓ ${want.name} now matches supabase/config.toml`);
  }

  return failed ? 1 : 0;
}

/* A CLI whose whole job is to be believed cannot end in a stack trace: the
   question at that moment is "did it look at the right project and what did it
   find", and an unhandled rejection answers neither. Exit 2 is "could not run",
   as in scripts/check-owner-identity.ts. */
try {
  process.exitCode = await main();
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 2;
}

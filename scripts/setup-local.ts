/**
 * Everything a fresh checkout needs before the app will run, in one command.
 *
 *     npm run setup
 *
 * ## Why this exists
 *
 * Because the steps were real, in order, and written down in three different
 * docs — and a box was built without two of them. `docs/plans/260831x-remote-box-dev-environment.md`
 * records what that cost: a freshly migrated database has no owner row, so every
 * insert carrying an `owner_id` died on a foreign key with an error that named
 * neither the constraint nor the fix, and 41 test files failed. The fix was one
 * command nobody knew to run.
 *
 * Greg, 2026-08-31:
 *
 * > And make sure all this stuff is documented/scripted so that if I try and
 * > create a new box for Spideryarn, it's pretty much all automatic and correct
 * > next time.
 *
 * So the sequence is here rather than in prose. It is the same on a laptop and
 * on the box — there is deliberately nothing box-specific in it, because a setup
 * path that only the box uses is one only the box can break.
 *
 * ## What it deliberately does not do
 *
 * **No `npm ci`.** You cannot run this script without having installed already,
 * so a step that installs would be one that never runs. It is the line above this
 * command in the docs, not inside it.
 *
 * **Nothing to production.** Every step below is local by construction:
 * `db:start` is Docker, `db:migrate` refuses a non-localhost `DATABASE_URL`
 * without an explicit opt-in, and `db:seed-owner` refuses any target that is not
 * this repo's own stack. This script adds no way around any of that.
 *
 * **It does not fetch article fixtures.** `data/` and `output/` are gitignored,
 * and about nineteen test files want an article that is not in git — the other
 * hole 260831x found. That is a real gap and it is not this script's to fill;
 * it is recorded there rather than papered over here.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { loadEnvLocal } from "../src/env.js";

/** Resolved from this file, not `process.cwd()`, so it works from a subdirectory. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Step {
  what: string;
  args: string[];
  /** Printed when it fails — what a human should try next. */
  ifItFails: string;
}

/**
 * The order matters and every one of these has been the missing step for
 * somebody. Each is its own npm script, so any of them can be re-run alone —
 * this adds a sequence, not a new way to do any of it.
 */
const STEPS: Step[] = [
  {
    what: "start the local Supabase stack",
    args: ["run", "db:start"],
    ifItFails:
      "Docker is not running. On the laptop: `open -a OrbStack`. On the box Docker\n" +
      "  is a systemd service — `systemctl status docker`. docs/project/supabase-local.md.",
  },
  {
    what: "apply the migrations in drizzle/",
    args: ["run", "db:migrate"],
    ifItFails:
      "The Supabase CLI cannot see our migrations, so this is the only thing that\n" +
      "  creates the `spideryarn` schema. Check DATABASE_URL in .env.local.",
  },
  {
    what: "seed the accounts, and check one of them can sign in",
    args: ["run", "db:seed-owner"],
    ifItFails:
      "Read the message above — this step refuses rather than guessing, and every\n" +
      "  refusal it has says what to do. docs/project/supabase-local.md § Signing in.",
  },
];

const bold = (s: string) => styleText("bold", s);
const dim = (s: string) => styleText("dim", s);

console.log(bold(`spideryarn setup — ${STEPS.length} steps, in ${repoRoot}\n`));

for (const [i, step] of STEPS.entries()) {
  console.log(bold(`[${i + 1}/${STEPS.length}] ${step.what}`));
  console.log(dim(`        npm ${step.args.join(" ")}`));
  /* `inherit`, so each step's own output is the output. Wrapping these in a
     progress spinner would hide the one thing worth reading — `db:seed-owner`
     prints a generated password exactly once. */
  const result = spawnSync("npm", step.args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(styleText("red", `\n✗ setup stopped at step ${i + 1}: ${step.what}`));
    console.error(`  ${step.ifItFails}`);
    /* Stop rather than carry on. Every step here depends on the one above it, so
       continuing would turn one clear failure into three confusing ones. */
    process.exit(1);
  }
  console.log("");
}

/**
 * **The one thing setup cannot do for you**, and the reason it is said here
 * rather than left in a doc.
 *
 * `SPIDERYARN_OWNER_ID` decides who owns rows written outside a request — the
 * CLI, the pipeline. Unset, that is the seeded row-owner nobody signs in as, so
 * everything you ingest lands on a shelf you will never see, and *nothing looks
 * wrong*: the ingest succeeds, the article is in the database, and the library
 * is empty. That absence is exactly the kind of failure that needs a check
 * rather than a reader (docs/reusable/silent-success.md).
 *
 * It cannot be fixed from in here. The value belongs in `.env.local`, which
 * `gjd-remote push-env` **rebuilds** from the laptop's copy — so a line written
 * on the box by this script would be destroyed by the next push, and would have
 * looked fine in between. Saying so is the honest thing this can do.
 *
 * A warning and not a failure: a machine that has never ingested anything is not
 * broken, and stopping setup over a variable somebody may deliberately leave
 * blank is how a command becomes something people work around.
 */
loadEnvLocal();
const owner = process.env.SPIDERYARN_OWNER_ID;
if (owner === ADMIN_USER_ID_LOCAL) {
  console.log(styleText("green", "✓ setup complete"));
  /* **Says what it checked, and not a word more.** It said "one shelf" until
     2026-09-01, which was a claim about the DATABASE made on the strength of an
     environment variable: set the variable on a database that still holds rows
     under the old owner — the exact dangerous intermediate state — and it printed
     a green "one shelf" over a library that was still empty. GPT Sol's fifth
     finding. Reading the database from here would mean connecting to it, which
     this script deliberately does not do; `npm run db:reown` counts, and its dry
     run is free. */
  console.log(dim("  SPIDERYARN_OWNER_ID matches the account you sign in as."));
  console.log(dim("  That is the environment, not the database — `npm run db:reown` says whether"));
  console.log(dim("  any rows are still under the old owner, and moves nothing without --apply."));
} else {
  console.log(styleText("green", "✓ setup complete"), dim("— with one thing left to do"));
  console.log(
    styleText("yellow", `  SPIDERYARN_OWNER_ID is ${owner ? `${owner}, not` : "unset. Set it to"}`),
  );
  console.log(
    styleText("yellow", `  ${ADMIN_USER_ID_LOCAL} — the account you sign in as (src/admin.ts).`),
  );
  console.log(dim("  Without it the CLI and the pipeline write to a shelf nobody signs in as, and the"));
  console.log(dim("  library reads empty however much has been ingested. Put it in .env.local on the"));
  console.log(dim("  LAPTOP: push-env rebuilds the box's copy from that one."));
  console.log(dim("  If this database already has rows: npx tsx scripts/db-reown.ts --apply"));
  console.log(dim("  docs/project/supabase-local.md § One shelf, and how to get there"));
}
console.log(dim("  npm run dev    then sign in — `npm run db:admin-password` has the credentials"));

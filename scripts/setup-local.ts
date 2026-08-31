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

console.log(styleText("green", "✓ setup complete"));
console.log(dim("  npm run dev    then sign in — `npm run db:admin-password` has the credentials"));

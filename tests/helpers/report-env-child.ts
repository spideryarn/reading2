/**
 * **A child process that says which environment it ended up with.**
 *
 * The other half of `tests/unit-lane-has-no-database.test.ts`'s subprocess
 * control. The unit lane's poisons are assignments in a setup file, and an
 * assignment cannot cross `spawn`: the child inherits the poisoned value
 * *before* it loads `src/env.ts`, so the poison becomes part of the child's own
 * `INHERITED` snapshot and `.env.local` reads it as "the shell said so". GPT
 * Sol reproduced that shape reviewing T-D, 2026-09-04; `PINNED` in
 * [`src/env.ts`](../../src/env.ts) is the fix, and this file is how it is
 * watched rather than assumed.
 *
 * **A real child running the real loader**, not a simulation: `tsx` starts it,
 * `loadEnvLocal()` is the first thing it does, and what it prints is whatever
 * `process.env` then holds. Anything short of that — calling `applyEnvFile`
 * with a hand-built environment, say — would be re-asserting the rule rather
 * than observing it, and the whole failure is that the rule is right and the
 * evidence for it does not survive the boundary.
 *
 * **Passwords are stripped before printing.** The value this exists to catch is
 * the real `DATABASE_URL`, which carries the local password, and a control that
 * has to print a secret to prove its point is one nobody can run in anger. The
 * host, port and database name are what identify it, and they survive.
 */
import { loadEnvLocal } from "../../src/env.js";

loadEnvLocal();

/** A URL with its password removed, or the raw string if it will not parse. */
function safe(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const url = new URL(value);
    url.password = "";
    return url.toString();
  } catch {
    return value;
  }
}

process.stdout.write(
  `${JSON.stringify({
    DATABASE_URL: safe(process.env.DATABASE_URL),
    SUPABASE_URL: safe(process.env.SUPABASE_URL),
  })}\n`,
);

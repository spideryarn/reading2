/**
 * **Which Stripe account and which database the next command is about to touch.**
 *
 * Shared by `stripe-setup.ts` and `stripe-check.ts`, which are the only two
 * commands that talk to Stripe and Postgres in the same breath — and therefore
 * the only two that can get the *combination* wrong.
 *
 * ## The accident this exists to prevent
 *
 * Both scripts call `loadEnvLocal()`, which by design lets `.env.local` beat
 * the shell (src/env.ts, and the reason is a good one). So the obvious way to
 * reach production —
 *
 *     DATABASE_URL=<production> STRIPE_SECRET_KEY=sk_live_… npm run stripe:setup
 *
 * — does not: `.env.local` replaces both on the way past. The Stripe half fails
 * loudly, because a test key with `VERCEL_ENV=production` trips
 * `stripeConfigProblem()`. **The database half fails silently**, and that is the
 * one that matters: live products and prices get created, `stripe_price_id` is
 * written to the laptop's Postgres, the script prints "Price ids are on the
 * billing_tiers rows", and production has nothing to sell.
 * docs/plans/260903h-stripe-scripts-reach-production.md.
 *
 * So the target is a flag rather than a variable, and the values come from
 * `.env.prod` — see `readEnvProd` in src/env.ts for why a file beats two
 * command-line variables here.
 *
 * ## Everything prints a target line
 *
 * Including the sandbox runs, which are the overwhelming majority and are
 * perfectly safe. A line that only appears when something is dangerous is a
 * line nobody has ever read, so it would not be read on the one day it says
 * something surprising — and the recipe that started all this told its reader
 * to "read the `Target:` line" of a script that printed none.
 */
import { parse } from "pg-connection-string";

import { withoutPassword } from "../src/db/ssl.js";
import { loadEnvLocal, readEnvProd } from "../src/env.js";
import { projectMismatch } from "../src/store/blobs.js";

/** The values a Stripe command needs, and they must come from the same place. */
const NEEDED = ["DATABASE_URL", "STRIPE_SECRET_KEY"] as const;

/**
 * Refuse an argument neither script knows.
 *
 * `process.argv.includes("--prod")` is the whole of the parsing, and a typo in
 * a flag it does not find is **silently the safe-looking default**:
 * `npm run stripe:setup -- --apply --prodd` applies to the sandbox while the
 * operator believes they are applying to live. That is not a wrong answer, it
 * is a wrong question answered confidently. GPT Sol, 2026-09-03.
 *
 * @param known every flag the calling script understands
 * @throws naming the argument, because the failure is that somebody cannot see
 *   the difference between what they typed and what they meant.
 */
export function refuseUnknownArgs(argv: readonly string[], known: readonly string[]): void {
  const strays = argv.slice(2).filter((a) => !known.includes(a));
  if (strays.length > 0) {
    throw new Error(`unknown argument${strays.length > 1 ? "s" : ""}: ${strays.join(", ")}. Known: ${known.join(", ")}.`);
  }
}

/**
 * Point this process at production, or leave it pointed at the sandbox.
 *
 * Call it **before** anything reads `process.env` or opens the pool —
 * `getDb()` and `stripeClient()` both read at first use, so the assignments
 * here are seen as long as they happen first.
 *
 * @param prod whether `--prod` was passed
 * @throws when `--prod` was asked for and cannot be honoured. Refusing is the
 *   whole job: a missing `.env.prod` that fell back to the laptop would look
 *   exactly like a successful production run.
 */
export function aimAtTarget(prod: boolean): void {
  /* First, because it memoises: every assignment below has to happen after it
     to survive, and doing it here means neither caller can get that wrong. */
  loadEnvLocal();
  if (!prod) return;

  const found = readEnvProd();
  const values = productionValues(found);
  for (const name of NEEDED) process.env[name] = values[name];

  /* What makes `expectedLivemode()` true, so the live-key guard in
     src/billing/stripe.ts agrees with the key we just loaded instead of
     rejecting it. Set here rather than asked of the caller: two things that
     must match should not be two things to type. */
  process.env.VERCEL_ENV = "production";

  console.log(`Reading production values from ${found?.file}`);
}

/**
 * The refusals, over an injected `.env.prod` — the part worth testing.
 *
 * Split from `aimAtTarget` for the reason `chooseTargetUrl` is split from
 * `resolveTargetUrl` in src/env.ts: the effect reads the real filesystem and
 * writes the real `process.env`, so a test driven through it would be testing
 * this machine. **Every branch here refuses**, and a refusal that does not fire
 * is invisible — the run just quietly uses the laptop and says it went fine.
 *
 * @throws with a sentence naming the file, because "which `.env.prod`" is a
 *   real question in a worktree.
 */
export function productionValues(
  found: { file: string; values: Record<string, string> } | null,
): Record<string, string> {
  if (!found) {
    throw new Error(
      "--prod needs a .env.prod, and there is none in this checkout or the primary one. " +
        "See docs/project/database.md.",
    );
  }

  const missing = NEEDED.filter((name) => !found.values[name]);
  if (missing.length > 0) {
    throw new Error(`--prod: ${found.file} has no ${missing.join(" and no ")}.`);
  }

  const url = found.values.DATABASE_URL as string;
  const notProd = whyNotProduction(url);
  if (notProd) {
    throw new Error(
      `--prod: DATABASE_URL in ${found.file} is not a production database — ${notProd} ` +
        `(${withoutPassword(url) ?? "unparsable"}).`,
    );
  }

  /* Corroboration from the same file, using the check that already exists for
     this pair (src/store/blobs.ts). It answers a question the host cannot: that
     the database really is the Supabase project the rest of `.env.prod`
     describes. Only when `SUPABASE_URL` is there — these two scripts do not
     touch Storage, so requiring it would invent a way for `--prod` to fail that
     has nothing to do with Stripe. */
  const disagree = projectMismatch(url, found.values.SUPABASE_URL);
  if (disagree) throw new Error(`--prod: ${found.file} disagrees with itself — ${disagree}`);

  return found.values;
}

/**
 * Why this connection string is not a production database, or `null`.
 *
 * **Positively classified, and that is the whole point of the function.** The
 * first version asked `isLocalDatabaseUrl(url)` and refused when it said yes.
 * That helper fails *closed for its own question* — "is this the throwaway
 * container", where `false` means "treat it as remote", which is the safe
 * answer for its two existing callers. Used the other way up, its fail-closed
 * became **fail-open**: every URL it could not classify — one carrying a
 * `?host=` override, one that will not parse — came back `false` and was
 * accepted as production. GPT Sol found it, 2026-09-03, with
 *
 *     postgres://u:p@remote.example.com:6543/db?host=127.0.0.1
 *
 * which `pg` connects to loopback and which the old guard waved through. So
 * this one names what production *is* and refuses everything else, and the two
 * functions stay separate rather than one growing a polarity flag.
 *
 * It answers "would `pg` dial a hosted Supabase database over TLS", and nothing
 * more. It does not know whether that database is *ours* — `projectMismatch`
 * corroborates that from `SUPABASE_URL`, and the account check in
 * src/billing/stripe.ts covers the Stripe half.
 */
export function whyNotProduction(url: string): string | null {
  /* **`pg`'s own parser, not `new URL`.** The version before this one read
     `new URL(url).hostname` and refused a list of local spellings. `pg` does
     not use that hostname: `pg-connection-string` percent-decodes it, resolves
     a `?host=` override into it, and accepts forms WHATWG does not. So
     `local%68ost` came out of `new URL` as `local%68ost`, matched nothing on
     the list, and was accepted — while `pg` connected to `localhost`. Measured
     by GPT Sol, 2026-09-03, on the second review of this file:

         postgresql://postgres.abc:p@local%68ost:5432/postgres?sslmode=disable

     passed both this guard and `projectMismatch`. `postgresql:///postgres`,
     `LOCALHOST`, `2130706433`, `0x7f000001` and `socket:/tmp/…` were the other
     confirmed ways through. Asking the library that actually dials is the only
     version of this check that cannot drift from what happens next. */
  const effective = parse(url);
  const host = (effective.host ?? "").toLowerCase().replace(/\.$/, "");

  if (!/^postgres(ql)?:\/\//i.test(url)) return "it is not a postgres:// URL";
  if (host === "") return "it names no host, so pg would open a local socket";
  /* **An allowlist, which is what "positive" has to mean here.** The previous
     version listed what to refuse and called itself positive classification; it
     was a blacklist, and a blacklist over a syntax with this many spellings is
     a list of the cases somebody thought of. Production is always a hosted
     Supabase database, so that is the shape to require — and the pattern is
     anchored, because `…pooler.supabase.com.attacker.net` ends with the string
     you would otherwise have matched. */
  if (!HOSTED_SUPABASE.test(host)) {
    return `pg would connect to ${host}, which is not a hosted Supabase database`;
  }
  /* `sslmode=disable` in the connection string overrides the `ssl` object
     src/db/ssl.ts builds (pg/lib/connection-parameters.js), so a production URL
     carrying it would talk to the pooler in clear text. */
  if (effective.ssl === false) return "it disables TLS";
  return null;
}

/**
 * A hosted Supabase database, either spelling: the shared poolers
 * (`aws-0-eu-west-2.pooler.supabase.com`) and a project's direct host
 * (`db.<ref>.supabase.co`). Anchored at both ends — see above.
 */
const HOSTED_SUPABASE = /^(?:[a-z0-9-]+\.pooler\.supabase\.com|db\.[a-z0-9]+\.supabase\.co)$/;

/**
 * The one line to read before letting a command continue.
 *
 * Host, port and user, because those are what distinguish the laptop from
 * production and none of them is a secret. Never the password: `withoutPassword`
 * parses rather than pattern-matches, and returns nothing at all if it cannot —
 * a redactor that falls back to printing the original is not a redactor.
 */
export function targetLine(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "Target: no DATABASE_URL is set";
  return `Target: ${withoutPassword(url) ?? "(a DATABASE_URL that is not a parsable URL)"}`;
}

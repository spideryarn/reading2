/**
 * Will signing in with Google give Greg his own shelf, or an empty one?
 *
 *     npx tsx scripts/check-owner-identity.ts           # before the first Google sign-in
 *     npx tsx scripts/check-owner-identity.ts --after  # after it, and this one can fail
 *
 * Exit 0 all is well, 1 the owner is wrong or unlinked when it should be
 * linked, 2 the check could not run.
 *
 * ## Why this is a question at all
 *
 * Every row in this database carries `owner_id`, and every query filters on it
 * (docs/project/auth.md § Whose data is it). The owner of the existing articles
 * is a **specific uuid** — a real account created through the Auth admin API on
 * 2026-08-26, before there was any way to sign in (docs/project/database.md
 * § An owner exists before any row does).
 *
 * A first Google sign-in either lands on that same uuid or on a new one. If it
 * lands on a new one the site works perfectly and the shelf is empty, and the
 * obvious conclusion — *the migration lost my articles* — is wrong. That is the
 * worst of the failure modes around this change, because nothing reports it:
 * every query succeeds and matches nothing. docs/reusable/silent-success.md.
 *
 * GPT Sol raised it reviewing docs/plans/260827i-google-sign-in-production.md, and it is
 * the one thing in that review that could not be settled by reading a spec.
 *
 * What decides it: Supabase links a new provider identity to an existing user
 * when the email matches and **the existing user's email is confirmed**. That
 * account was created with `email_confirm: true`, so the link should happen —
 * but "should" is what this script exists to replace. Run it before the first
 * Google sign-in and again after: `google` must join the providers of the
 * *existing* row, and no second row with the same email may appear.
 *
 * ## Why it uses the admin API and not a query
 *
 * `auth.users` is not readable by the application's database user. Measured,
 * not assumed: the first version of this script ran that query against
 * production and got `42501 permission denied for schema auth`. Supabase owns
 * that schema and the app has no business in it — which is the right answer,
 * and it is why this reaches for `SUPABASE_SERVICE_ROLE_KEY` from `.env.prod`.
 *
 * **That key is a superuser for the whole project.** It appears nowhere in the
 * output. Nothing here writes: two GETs and a count.
 *
 * This file's header said for an afternoon that an agent could not run it,
 * because the classifier had refused a hand-written `curl` carrying that key.
 * That was one refusal generalised into a rule, and it was wrong: running the
 * script is not blocked, and it works. Left here because inventing a
 * restriction is the same error as ignoring one, and it also stopped a real
 * finding being made hours earlier — see `providers=—` below.
 *
 * ## It reads `.env.prod`, and that is not the usual arrangement
 *
 * Everything else here goes through `loadEnvLocal()`, which deliberately lets
 * `.env.local` beat the shell (src/env.ts, and the reason is a good one). That
 * makes "export the production URL and run it" quietly wrong: `.env.local`
 * would win and this would report on the Docker container instead. `.env.prod`
 * is otherwise "read by nothing" (docs/project/database.md), so it is read
 * explicitly, and the guard below refuses anything local.
 *
 * That reader was private to this file until 2026-09-03, when `stripe-setup`
 * and `stripe-check` needed the same escape hatch to go live. It is now
 * `readEnvProd` in src/env.ts — beside the rule it excepts, and one parser
 * rather than three.
 */

import { sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal, readEnvProd } from "../src/env.js";

/* Must come first: it memoises, so every later assignment survives it. */
loadEnvLocal();

/* `readEnvProd` rather than the private reader this file used to carry: it is
   now shared with the Stripe scripts, it parses the file once instead of once
   per name, and it handles an `export ` prefix and single-quoted values, which
   the regex here did not. It also finds the primary checkout's copy when this
   is running in a worktree, where there is none. */
const prod = readEnvProd();

function fromProd(name: string): string | undefined {
  return prod?.values[name];
}

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

for (const name of ["DATABASE_URL", "SPIDERYARN_OWNER_ID"]) {
  const value = fromProd(name);
  if (value) process.env[name] = value;
}

const databaseUrl = process.env.DATABASE_URL ?? "";
const supabaseUrl = fromProd("SUPABASE_URL") ?? "";
const serviceKey = fromProd("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const expected = process.env.SPIDERYARN_OWNER_ID;

if (databaseUrl === "" || supabaseUrl === "" || serviceKey === "") {
  die(
    prod
      ? `Need DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in ${prod.file}. See docs/project/database.md.`
      : "There is no .env.prod in this checkout or the primary one. See docs/project/database.md.",
  );
}
if (/(?:127\.0\.0\.1|localhost)/.test(databaseUrl) || /(?:127\.0\.0\.1|localhost)/.test(supabaseUrl)) {
  die("Those point at the local stack. This script is about the production shelf.");
}

type AdminUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  identities?: { provider: string }[];
};

/**
 * Every user, following the pages.
 *
 * **Paged rather than `per_page=200` and hope.** The first version asked for one
 * page and then asserted "no second account with this email" over it, which is
 * a claim about *all* users made from a slice of them — the shape that makes a
 * check agree with you by default. Sol's finding. The cap below is a
 * runaway-loop guard, not a limit anybody is expected to hit; it dies rather
 * than truncating, because a quiet truncation is the bug being fixed.
 */
async function users(): Promise<AdminUser[]> {
  const all: AdminUser[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    });
    const text = await res.text();
    if (!res.ok) die(`Auth admin API said ${res.status}: ${text.slice(0, 400)}`);
    const body = JSON.parse(text) as { users?: AdminUser[] };
    if (!Array.isArray(body.users)) {
      die(`Unexpected answer from the admin API: ${text.slice(0, 400)}`);
    }
    all.push(...body.users);
    if (body.users.length < 200) return await withIdentities(all);
  }
  die("More than 10,000 users, which cannot be right for this project. Refusing to guess.");
}

/**
 * Fill in each user's identities, one request each.
 *
 * **The list endpoint does not return them**, and the first version of this
 * script read `identities` straight off it. That field comes back `null` for
 * every row, so the providers column printed `—` for everybody — including an
 * account Google had made ninety seconds earlier. It was not saying "no
 * provider"; it was saying nothing at all, in the shape of an answer.
 *
 * Measured rather than reasoned about, once it looked wrong:
 *
 *     GET /admin/users        -> identities: null
 *     GET /admin/users/{id}   -> identities: ["google"]
 *
 * The verdict this script printed was right anyway, off the second row and the
 * mismatched email — which is the part worth being uncomfortable about. A check
 * whose stated evidence is empty and whose conclusion is correct is the exact
 * thing docs/reusable/silent-success.md is about, and it was in the check
 * written to catch that pattern.
 *
 * N requests rather than reading `app_metadata.providers` off the list, which
 * is free and nearly always agrees: `auth.identities` is the table the linking
 * actually happens in, and this script exists to answer a question about
 * linking. The projects here have single-figure user counts.
 */
async function withIdentities(users: AdminUser[]): Promise<AdminUser[]> {
  const filled: AdminUser[] = [];
  for (const u of users) {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${u.id}`, {
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) die(`Auth admin API said ${res.status} reading user ${u.id}.`);
    const one = (await res.json()) as AdminUser;
    filled.push({ ...u, identities: one.identities ?? [] });
  }
  return filled;
}

async function articleCounts(): Promise<Map<string, number>> {
  const rows = await getDb().execute<{ owner: string; n: number }>(
    sql`select owner_id::text as owner, count(*)::int as n from spideryarn.articles group by owner_id`,
  );
  return new Map((rows.rows ?? []).map((r) => [r.owner, r.n]));
}

/**
 * What the run is for, which decides what counts as a failure.
 *
 * **Two modes, and the exit code is the whole reason.** The first version
 * printed its verdict and exited 0 whatever it found, so the *same command*
 * before and after a sign-in could not tell "google has not linked yet, as
 * expected" from "google did not link, which is the bug". A check whose status
 * never varies is a check nothing can be built on. Sol's finding.
 */
const mode = process.argv.includes("--after") ? "after" : "before";

async function main(): Promise<number> {
  console.log(`SPIDERYARN_OWNER_ID = ${expected ?? "<unset>"}   (mode: ${mode})\n`);

  const [list, counts] = await Promise.all([users(), articleCounts()]);

  for (const u of list) {
    const providers = (u.identities ?? []).map((i) => i.provider).join(", ") || "—";
    const n = counts.get(u.id) ?? 0;
    const marks = [u.id === expected ? "← SPIDERYARN_OWNER_ID" : "", n > 0 ? `${n} article(s)` : ""]
      .filter(Boolean)
      .join("  ");
    console.log(
      `  ${u.id}  ${(u.email ?? "<no email>").padEnd(26)} ` +
        `confirmed=${String(Boolean(u.email_confirmed_at)).padEnd(5)} ` +
        `providers=${providers.padEnd(18)} ${marks}`,
    );
  }
  if (list.length === 0) console.log("  no users at all");

  const stranded = [...counts].filter(([owner]) => !list.some((u) => u.id === owner));
  for (const [owner, n] of stranded) {
    console.log(`  ${owner}  <not a user in this project>          ${n} article(s)`);
  }

  const owner = list.find((u) => u.id === expected);
  const sameEmail = owner ? list.filter((u) => u.email === owner.email) : [];
  console.log();

  if (!expected) {
    console.log("No SPIDERYARN_OWNER_ID in .env.prod, so there is nothing to compare against.");
    return 2;
  }
  if (!owner) {
    console.log(`SPIDERYARN_OWNER_ID ${expected} is not a user in this project.`);
    return 1;
  }
  if (sameEmail.length > 1) {
    console.log(
      `TWO accounts share ${owner.email}: ${sameEmail.map((u) => u.id).join(" and ")}.\n` +
        "That is the failure this script is for — the sign-in made a new user instead of linking,\n" +
        `and the shelf on the new one is empty. Nothing is lost; the rows are on ${expected}, and\n` +
        "the repair is an owner_id update per table.",
    );
    return 1;
  }
  if (!owner.email_confirmed_at) {
    console.log(
      "The owner's email is NOT confirmed. Supabase links a Google identity to an existing\n" +
        "account only when the existing email is confirmed — so signing in with Google would\n" +
        "create a SECOND account, with an empty shelf. Confirm it before signing in.",
    );
    return 1;
  }

  const linked = (owner.identities ?? []).some((i) => i.provider === "google");
  const providers = (owner.identities ?? []).map((i) => i.provider).join(", ") || "none";

  if (linked) {
    console.log(`The owner has a google identity, so Google sign-in lands on ${expected}. Good in either mode.`);
    return 0;
  }
  if (mode === "after") {
    console.log(
      `NOT LINKED. The owner is ${owner.email} with providers: ${providers}, and no google among\n` +
        "them — yet this was run with --after, meaning a Google sign-in was supposed to have\n" +
        "happened. Either it did not complete, or it completed on a different email address.",
    );
    return 1;
  }
  console.log(
    `The owner is ${owner.email}, confirmed, providers: ${providers}.\n` +
      "A Google sign-in on that address should link to this account rather than make a new one.\n" +
      "Afterwards, run:  npx tsx scripts/check-owner-identity.ts --after",
  );
  return 0;
}

let code = 2;
try {
  code = await main();
} finally {
  await closeDb();
}
process.exit(code);

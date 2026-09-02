/**
 * Create the local development accounts in `auth.users`.
 *
 *     npm run db:seed-owner
 *
 * **Two rows, not one, since 2026-08-31** — the owner every `owner_id` points
 * at, and the account Greg signs in as. `scripts/seed-accounts.ts` is the list
 * and the reason there are two; this file is only how they get written.
 *
 * **Why this has to exist at all.** Every table in `spideryarn` carries
 * `owner_id uuid not null references auth.users(id)`, from day one and on
 * purpose — docs/project/database.md. Supabase owns `auth.users`, so there is
 * nothing our migrations can put in it. Without a row here, the very first
 * `insert into articles` fails on the foreign key.
 *
 * **And why the second row.** A fresh stack — a `db:reset`, a new clone, the
 * Hetzner box — has nobody to sign in as, so there is no session and no way to
 * get one that does not go through Google in a browser on that machine.
 * docs/plans/260831ab-seed-local-admin-user-for-remote-box.md is the whole of it.
 * The account is seeded with a password, so signing in is the email form that is
 * already on the landing page.
 *
 * **The ids are fixed, not random.** Fixed because the alternative rots: GoTrue
 * hands out a random id, that id goes in `.env.local` or in `src/admin.ts`, and
 * then `npm run db:reset` throws the user away and every id that named it points
 * at nobody. A constant survives a reset, is identical on a fresh clone and on
 * the box, and can therefore live in a constant rather than in a setup step.
 *
 * **This is a local convenience and must not become the production answer.**
 * In production `ownerId` is the session user, resolved per request (src/owner.ts),
 * and the administrator is an account that already exists. The guard below
 * refuses to run against a non-local Supabase for that reason, and there is no
 * `ALLOW_REMOTE` escape hatch.
 *
 * Written through GoTrue's admin API rather than as an `insert` into
 * `auth.users`. That table has a dozen not-null columns whose meanings are
 * Supabase's business and change between versions; hand-rolling the insert works
 * right up until it doesn't, and then fails somewhere else entirely.
 */

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

import { ADMIN_EMAIL_LOCAL } from "../src/admin.js";
import { loadEnvLocal } from "../src/env.js";
import {
  type PasswordVerdict,
  type SeededAccount,
  SEEDED_ACCOUNTS,
  parseStatusEnv,
  planAccountEmail,
  staleIdentities,
  readOrCreateAdminPassword,
  readPasswordVerdict,
  refuseMismatchedStack,
  refuseNonLocalSeed,
} from "./seed-accounts.js";

loadEnvLocal();

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const refusal = refuseNonLocalSeed(url, process.env);
if (refusal || !url || !serviceKey) {
  console.error(
    refusal ??
      "SUPABASE_SERVICE_ROLE_KEY must be set.\n" +
        "  Local: npm run db:start, then it comes from .env.local.\n" +
        "  See docs/project/supabase-local.md.",
  );
  process.exit(1);
}

/**
 * **Ask a second source before writing anything.**
 *
 * The hostname check above reads `SUPABASE_URL`, and so does every other step in
 * this run — so all of them agree with each other whatever is really on the
 * other end of that port. `refuseMismatchedStack` compares against what the
 * Supabase CLI says about *this repo's* containers, which no amount of port
 * forwarding can change. See its comment; GPT Sol raised the case, 2026-08-31.
 *
 * Resolved from this file's own location rather than `process.cwd()`: the CLI
 * finds `supabase/config.toml` relative to where it is run, and running this
 * from a subdirectory would otherwise silently describe a different project (or
 * none). Scripts here are run by `tsx` from source and never bundled, so the
 * module's location is the repo — src/assets.ts is where that assumption goes
 * wrong, and it does not apply to `scripts/`.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
let statusEnv: string;
try {
  /* `supabase`, not `npx supabase`. Every other database command in
     package.json calls it directly, and `npx` on a machine without it installed
     will go and *fetch* a CLI — an unpinned one, at the moment we are trying to
     establish what is trustworthy. Sol's third finding on the built code. */
  statusEnv = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: repoRoot,
    encoding: "utf8",
    /* stderr captured rather than discarded: "Docker is not running", "no such
       file: supabase/config.toml" and a timeout all fail identically here, and
       the fix is different for each. */
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
} catch (err) {
  const detail = (err as { stderr?: Buffer | string }).stderr?.toString().trim() ?? "";
  console.error(
    "could not run `supabase status` to confirm which stack this is.\n" +
      "  Run: npm run db:start — see docs/project/supabase-local.md.\n" +
      "  Refusing rather than trusting SUPABASE_URL, which is the value in doubt." +
      (detail ? `\n  The CLI said: ${detail.split("\n").slice(0, 3).join(" / ")}` : ""),
  );
  process.exit(1);
}
const mismatch = refuseMismatchedStack({ url, serviceKey }, parseStatusEnv(statusEnv));
if (mismatch) {
  console.error(mismatch);
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

/**
 * The key the browser holds — and **not** the service-role key as a fallback.
 *
 * The point of signing in below is to exercise the reader's own path. A
 * service-role fallback would make that sentence false while the check went on
 * passing, which is the shape this whole file is defended against. So: refuse.
 * Sol's fourth finding on the built code, 2026-08-31.
 */
/**
 * This machine's administrator password, made on the first run.
 *
 * Read once, here, rather than per account: two reads could disagree if the file
 * were replaced between them, and the second one would then set a password the
 * caller never saw.
 */
const admin = readOrCreateAdminPassword(homedir());

const anonKey: string = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
if (!anonKey) {
  console.error(
    "SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY must be set — this checks the\n" +
      "  seeded account by signing in the way the browser does, and the service-role\n" +
      "  key would not be that check. `npm run db:status` prints both.",
  );
  process.exit(1);
}

/**
 * Try to sign in. Returns the token's `sub`, or the HTTP status if it failed.
 *
 * Used twice and for two different questions: **before** touching an existing
 * account, to find out whether it needs touching at all, and **after** the whole
 * run, as the verdict. Same function both times, so the check that decides and
 * the check that reports cannot disagree.
 */
async function signInAs(
  email: string,
  password: string,
): Promise<{ sub: string | undefined; status: number; errorCode: string; verdict?: PasswordVerdict }> {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    /* The decision lives in `readPasswordVerdict`, which is pure and tested —
       see its comment for why it is not a status-code check. */
    const { verdict, errorCode } = readPasswordVerdict(
      response.status,
      response.headers.get("x-sb-error-code"),
      await response.text(),
    );
    return { sub: undefined, status: response.status, errorCode, verdict };
  }
  const body = (await response.json()) as { access_token?: string };
  const payload = body.access_token?.split(".")[1];
  if (!payload) return { sub: undefined, status: response.status, errorCode: "" };
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  return { sub: claims.sub, status: response.status, errorCode: "" };
}

interface AdminUser {
  id: string;
  email?: string;
  /** One per sign-in method. Present on the single-user GET, not on the list. */
  identities?: { provider?: string; identity_data?: { email?: string } }[];
}

/** The user at this id, or nothing. A 404 is an answer, not a failure. */
async function findById(id: string): Promise<AdminUser | undefined> {
  const response = await fetch(`${url}/auth/v1/admin/users/${id}`, { headers });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`looking up ${id} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as AdminUser;
}

/**
 * The user holding this address, or nothing — **paged to exhaustion**.
 *
 * GoTrue's list defaults to 50 a page and says nothing when it truncates, which
 * is how a page listing "everyone" came to be missing people
 * (supabase/auth-js#538, and tests/admin-accounts.test.ts is about exactly this).
 * Here a short page would report "no such address" and send the run on to create
 * a duplicate, so it pages rather than asking for a big number and hoping.
 */
async function findByEmail(email: string): Promise<AdminUser | undefined> {
  const want = email.trim().toLowerCase();
  for (let page = 1; page <= 100; page++) {
    const response = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
    if (!response.ok) {
      throw new Error(`listing users failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { users?: AdminUser[] };
    const users = body.users ?? [];
    const hit = users.find((user) => user.email?.trim().toLowerCase() === want);
    if (hit) return hit;
    if (users.length === 0) return undefined;
  }
  throw new Error("paged 100 times without exhausting the user list — refusing to guess");
}

/**
 * Make the account for the first time.
 *
 * Split out of `ensureAccount` rather than inlined, because that function's job
 * is now to *decide* — which of the four plans applies — and the decision reads
 * better without three fetches in the middle of it.
 */
async function createAccount(account: SeededAccount, password: string | undefined): Promise<void> {
  const { id, email } = account;
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id, email, email_confirm: true, ...(password ? { password } : {}) }),
  });
  if (response.ok) {
    console.log(`✓ created ${email} (${id}) — ${account.why}`);
    return;
  }
  /* **A conflict is a peer, not a failure.** Two agents share this tree and
     both may run the setup; the loser of that race must not take the run down
     with "already registered". Re-read rather than assume: what matters is
     that the account that now exists is the one we wanted, and only the
     database can say. */
  if (response.status === 409 || response.status === 422) {
    const now = await findById(id);
    if (now && now.email?.trim().toLowerCase() === email.trim().toLowerCase()) {
      console.log(`✓ created by a concurrent run: ${email} (${id})`);
      return;
    }
  }
  throw new Error(`creating ${email} failed: ${response.status} ${await response.text()}`);
}

/**
 * **Catch up a machine seeded before the address changed.**
 *
 * Only reached on a `"rename"` plan, which `planAccountEmail` gives for exactly
 * one id holding exactly one listed old address on a stack two separate fences
 * have agreed is local — its comment is the argument for why writing an address
 * onto an account this run did not create is safe *here* and would not be
 * anywhere else.
 *
 * Cheap as well as safe: measured on GoTrue v2.195.0, 2026-09-02, an admin email
 * change leaves the password alone and leaves open sessions valid. Its neighbour
 * below is the opposite — a password write revokes every session — which is why
 * that one is done only when it must be and this one can simply happen.
 */
async function renameTo(account: SeededAccount, was: string | undefined): Promise<void> {
  const { id, email } = account;
  const response = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!response.ok) {
    throw new Error(
      `renaming ${was ?? id} to ${email} failed: ${response.status} ${await response.text()}`,
    );
  }
  /* Said out loud rather than done quietly. Somebody who has been signing in as
     the old address needs one line about why it has stopped existing, and this
     is the only place that line can appear. */
  console.log(`✓ renamed ${was} to ${email} (${id}) — same account, same password`);

  /**
   * **And say what the rename did not reach.**
   *
   * A row that began as a Google sign-in keeps a `google` identity holding the
   * address Google gave it, because the `PUT` updates only the `email` one — so
   * leaving this silent would make the line above claim more than it did.
   *
   * **A fresh `GET`, not the `PUT`'s own response body**, and that distinction
   * is the whole of whether this works. Measured, 2026-09-02: after renaming
   * `probe-old@` to `probe-new@`, the `PUT` response still showed the `email`
   * identity on the old address while a `GET` a moment later showed it updated.
   * Reading the response would therefore have reported a stale identity on
   * **every** rename — a check that cries wolf every time, which is worse than
   * no check, because the one run where it means something reads exactly like
   * the others.
   *
   * A warning, never a failure, and nothing is deleted. Removing an identity
   * signs that method out for good and is Greg's call.
   */
  const after = await findById(id);
  const left = staleIdentities(after?.identities, account.renamableFrom);
  if (left.length > 0) {
    console.log(`  note: the ${left.join(" and ")} identity still holds ${was}.`);
    console.log("  Sign-in and ownership do not read it, but Studio and the profile page show it.");
    console.log("  Removing it is destructive and is not done here — ask Greg.");
  }
}

/**
 * Make one account exist, at its id, with its password. Idempotent.
 *
 * The two refusals are the interesting part, and both are cases where carrying
 * on would look like success:
 *
 * - **The address on an id we do not expect.** Almost certainly an account made
 *   by hand, or by a Google sign-in before this script seeded anything. Rows
 *   already written point at one of the two ids, and for the administrator the
 *   *other* one is not an administrator — so this says which is which rather
 *   than picking.
 * - **Our id holding somebody else's address.** Rarer and worse: we would be
 *   about to set a password on an account that is not ours.
 */
async function ensureAccount(account: SeededAccount): Promise<void> {
  const { id, email } = account;
  const password = account.signsIn ? admin.password : undefined;
  const byEmail = await findByEmail(email);
  if (byEmail && byEmail.id !== id) {
    throw new Error(
      `a user with email ${email} exists but has id ${byEmail.id},\n` +
        `  not the expected ${id}.\n  ${account.mismatchAdvice}`,
    );
  }

  const byId = await findById(id);
  const plan = planAccountEmail(byId, account);
  if (plan === "refuse") {
    throw new Error(
      `the id ${id} is already held by ${byId?.email ?? "an account with no address"},\n` +
        `  not by ${email}. Refusing to touch it.` +
        (account.renamableFrom.length
          ? `\n  (It would have been renamed from ${account.renamableFrom.join(" or ")} without asking.)`
          : ""),
    );
  }

  /* Before the password block below, not after, because everything past this
     point signs in *at the new address*: a rename left until later would
     falsify its own precondition, and the run would report a wrong password on
     an account whose password is fine. */
  if (plan === "rename") await renameTo(account, byId?.email);

  if (plan === "create") return await createAccount(account, password);

  if (!password) {
    console.log(`✓ already present: ${email} (${id})`);
    return;
  }

  /**
   * **Only set the password if it is not already right**, and this is the whole
   * of why `ensureAccount` signs in before it writes.
   *
   * GoTrue's admin password update calls `Logout` for that user — measured here
   * on 2026-08-31, not inferred: a refresh token that answered 200 before an
   * unconditional `PUT` answered 400 after it. So a seed that set the password
   * on every run would sign every open browser out, and this command is one the
   * docs tell you to run after **every** `db:reset`. GPT Sol, 2026-08-31.
   *
   * The three outcomes are kept apart because they want different answers:
   * already correct (do nothing), rejected (set it), anything else (stop). A
   * network wobble read as "wrong password" would revoke the sessions this is
   * here to protect.
   */
  const before = await signInAs(email, password);
  if (before.sub === id) {
    console.log(`✓ already present, password already correct: ${email} (${id})`);
    return;
  }
  if (before.sub) {
    /* Signed in, as somebody else. The email lookup above should have caught
       this, so reaching here means the two disagree — stop rather than write. */
    throw new Error(
      `signing in as ${email} succeeded but returned ${before.sub}, not ${id}.\n` +
        "  The address lookup and the sign-in disagree about who this is. Refusing to write.",
    );
  }
  /* **A verdict on the password, or nothing.** `readPasswordVerdict` is where
     that decision lives and why; measured on GoTrue v2.195.0, 2026-08-31, a
     wrong password, an account with no password at all, and an address nobody
     holds are all `400 invalid_credentials`, so "wrong" covers every case where
     writing is the right answer. Everything else stops here. */
  if (before.verdict !== "wrong") {
    throw new Error(
      `checking the password for ${email} answered ${before.status} ` +
        `(${before.errorCode || "no error_code"}), which is not a verdict on the password.\n` +
        "  Refusing to set it: doing so would revoke every open session for that account.\n" +
        "  A 429 here is the sign-in rate limit — wait five minutes and re-run.",
    );
  }

  const response = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!response.ok) {
    throw new Error(`setting the password for ${email} failed: ${response.status} ${await response.text()}`);
  }
  console.log(`✓ already present, password set: ${email} (${id}) — open sessions were revoked`);
}

/**
 * Actually sign in, and say who came back.
 *
 * **The verdict of the run, so it is not left to be discovered later.** Every
 * call above can return 200 while leaving an account nobody can sign in as: a
 * password set on a user whose only identity is `google`, a confirmation GoTrue
 * decided was still outstanding, a `password_requirements` setting that rejected
 * the value. Each of those looks exactly like success from the admin API.
 *
 * It reads the token's `sub` rather than stopping at "a token came back",
 * because a token for the wrong account is the failure that would pass the
 * shorter check. The sign-in uses the **publishable/anon key**, the one the
 * browser holds, on the same `grant_type=password` endpoint the sign-in form
 * uses — the point is to exercise the reader's path, not a privileged one.
 */
async function assertCanSignIn(account: SeededAccount): Promise<void> {
  const { email, id } = account;
  if (!account.signsIn) return;
  const password = admin.password;
  const { sub, status, errorCode } = await signInAs(email, password);
  if (!sub) {
    throw new Error(
      `${email} was seeded, but signing in as it answered ${status} ${errorCode}.\n` +
        "  The account exists and cannot be used, which is the failure this check is for.",
    );
  }
  if (sub !== id) {
    throw new Error(
      `signing in as ${email} worked, but the token is for ${sub}, not ${id}.\n` +
        "  src/admin.ts gates on the id, so that session is not an administrator.",
    );
  }
  console.log(`✓ signed in as ${email}, token sub is ${id}`);
}

/**
 * Every refusal above is a sentence somebody has to act on, so it is printed as
 * one rather than thrown at the terminal.
 *
 * A top-level `throw` from an ESM script prints the message wrapped in a stack
 * trace and a Node version banner, which buries the two lines that say what to
 * do — and the wrong-id refusal is five lines of instructions. The exit status
 * is the same; only the reading is different.
 */
try {
  for (const account of SEEDED_ACCOUNTS) {
    await ensureAccount(account);
  }
  for (const account of SEEDED_ACCOUNTS) {
    await assertCanSignIn(account);
  }
  /* The password is printed **only** on the run that created it, and its
     location on every run. Printing it every time would scatter it through
     terminal scrollback, CI logs and tmux history on a box several agents
     share; never printing it would leave somebody with no way to sign in. */
  if (admin.created) {
    console.log(`\n  A password was generated for ${ADMIN_EMAIL_LOCAL}. It is shown once:\n`);
    console.log(`      ${admin.password}\n`);
  }
  console.log(`  Sign in as ${ADMIN_EMAIL_LOCAL}. The password is in ${admin.path}`);
  console.log("  and `npm run db:admin-password` prints it again.");
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

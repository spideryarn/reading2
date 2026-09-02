/**
 * What `npm run db:seed-owner` puts in `auth.users`, and the fence that keeps it
 * off anything that is not a local stack.
 *
 * No network, ever, so the rules that matter can be tested without a Supabase
 * running: tests/seed-accounts.test.ts. One function does touch the filesystem —
 * `readOrCreateAdminPassword` — and it takes its directory as an argument rather
 * than resolving one at import time, so a test can point it at a temp dir. A path
 * fixed at module load cannot be redirected in a `beforeAll`, and the test then
 * writes to the real file and says nothing about it.
 * Split out of scripts/db-seed-owner.ts for exactly the reason
 * scripts/gjd-remote-env.ts was split out of scripts/gjd-remote.ts: that file
 * does its work at import time, so a test that imported it would seed a database
 * rather than read a rule.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { ADMIN_EMAIL, ADMIN_EMAIL_LOCAL, ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { DEV_OWNER_EMAIL, DEV_OWNER_ID } from "../src/owner.js";

/**
 * Where the seeded administrator's password lives.
 *
 * ## Why a generated secret in a file, and not a constant in git
 *
 * The first version of this was a constant — `spideryarn-local-dev` — on the
 * argument that a local stack's credentials are already public strings and the
 * firewall is the only real boundary. Both halves of that are true, and GPT Sol
 * agreed the incremental risk was small. It still put **one permanent, universal
 * credential for Greg's privileged account into every clone and every box**, one
 * that secret-scanning and rotation can never help with because it is
 * deliberately published. Greg's call, 2026-08-31: generate it instead.
 *
 * What that buys, and it is the whole list:
 *
 * - **No unset state**, which is what ruled out an environment variable. The file
 *   is created on the first seed; there is nothing to configure and nothing to
 *   forget.
 * - **It survives `npm run db:reset`**, because it is not in the database — so a
 *   reset does not change the password, which is the case that would otherwise
 *   sign every browser out weekly.
 * - **It survives a box rebuild.** `/home` is bind-mounted from the persistent
 *   volume (infra/hetzner/README.md), and this lives under `$HOME`.
 * - **Each machine's is its own**, so one leaked password is one machine.
 *
 * What it costs: the password cannot be written down in a doc. `npm run
 * db:admin-password` prints it, and the seed prints it once on creation.
 *
 * ## Outside the repo, deliberately
 *
 * Not `.env.local` — `gjd-remote push-env` **rebuilds** that file from an
 * allowlist, so a value written there by the box would be destroyed by the next
 * push from the laptop, and a value pushed from the laptop would make both
 * machines share one credential again. Not anywhere under the repo either: a
 * `.gitignore` is one `git add -f` from being wrong, and this tree is shared by
 * several agents committing by pathspec.
 */
export const ADMIN_PASSWORD_DIRNAME = ".config/spideryarn";
export const ADMIN_PASSWORD_BASENAME = "local-admin-password";

/** The file, under a home directory. Resolved when called, never at import. */
export function adminPasswordPath(home: string): string {
  return path.join(home, ADMIN_PASSWORD_DIRNAME, ADMIN_PASSWORD_BASENAME);
}

/**
 * A new password: 24 random bytes, base64url.
 *
 * Long enough that the local stack's rate limit makes guessing irrelevant, and
 * `base64url` so it survives being pasted into a form, a shell, or a JSON body
 * without an escaping question — `+`, `/` and `=` are exactly the characters
 * that make a password get mangled somewhere in between.
 */
export function newAdminPassword(): string {
  return randomBytes(24).toString("base64url");
}

/** What a password file that cannot be trusted looks like. Pure, so it is tested. */
export function passwordFileIsUsable(contents: string): boolean {
  /* Short means a truncated or failed earlier write rather than a real secret.
     Regenerating is right; refusing would leave somebody stuck with a file they
     did not knowingly create. */
  return contents.trim().length >= 16;
}

export interface AdminPassword {
  password: string;
  path: string;
  /** True when this call made it — the one moment it is worth printing. */
  created: boolean;
}

/**
 * The password for this machine, making one the first time.
 *
 * `0600`, and re-applied on every read rather than only on creation: a file
 * created correctly can be loosened later by a stray `chmod -R`, and the whole
 * point of the move away from a constant was that this one is worth protecting.
 */
export function readOrCreateAdminPassword(home: string): AdminPassword {
  const file = adminPasswordPath(home);
  if (existsSync(file)) {
    const contents = readFileSync(file, "utf8");
    if (passwordFileIsUsable(contents)) {
      chmodSync(file, 0o600);
      return { password: contents.trim(), path: file, created: false };
    }
  }
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const password = newAdminPassword();
  /* mode on writeFileSync applies only when the file is created, so an existing
     unusable one keeps its old mode — hence the explicit chmod after. */
  writeFileSync(file, `${password}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return { password, path: file, created: true };
}

/**
 * This machine's sign-in, for anything that has to sign in **without a human** —
 * `npm run db:admin-password` prints it, `scripts/browser-sign-in.ts` types it
 * into the form.
 *
 * **It never creates one**, unlike `readOrCreateAdminPassword` above, and the
 * difference is the whole reason this is a second function rather than a flag.
 * A generated password for an account that does not exist reads as *"the
 * password is wrong"* rather than *"run the seed"* — and it would then be the
 * password the next seed sets, so the confusion outlives the run that caused it.
 *
 * A refusal rather than a throw, because the two callers want different things
 * done with it: one prints it and exits 1, the other raises it into a Playwright
 * failure. Both need the same sentences, and a sentence that lives in one caller
 * is one the other gets wrong.
 */
export type AdminCredentials =
  | { ok: true; email: string; password: string; path: string }
  | { ok: false; why: string };

export function readAdminCredentials(home: string): AdminCredentials {
  const file = adminPasswordPath(home);
  if (!existsSync(file)) {
    return {
      ok: false,
      why:
        `no password file at ${file}.\n` +
        "  This machine has not been seeded yet. Run: npm run db:seed-owner\n" +
        "  (it makes one, prints it once, and creates the account it belongs to).",
    };
  }
  const contents = readFileSync(file, "utf8");
  if (!passwordFileIsUsable(contents)) {
    return {
      ok: false,
      why:
        `the password file at ${file} is empty or too short to be a password.\n` +
        "  Delete it and run: npm run db:seed-owner — which will make a new one and\n" +
        "  set it on the account. Every open session for that account ends.",
    };
  }
  return { ok: true, email: ADMIN_EMAIL_LOCAL, password: contents.trim(), path: file };
}

/** One row `db:seed-owner` guarantees, and what it is for. */
export interface SeededAccount {
  /** Fixed, never generated. See `SEEDED_ACCOUNTS`. */
  id: string;
  email: string;
  /**
   * Somebody is expected to *sign in* as this account, so it gets a password
   * from this machine's file. False means the row exists only to satisfy a
   * foreign key, and giving it a credential would be one that exists for no
   * reason.
   */
  signsIn: boolean;
  /** One line, printed by the script, so a run says what it made and why. */
  why: string;
  /**
   * What to do when this address turns up on an id we did not expect.
   *
   * Per account, because the two answers are genuinely different and a shared
   * sentence gets one of them wrong. That is not hypothetical: the Hetzner box
   * already holds an admin address on an id nothing recognises, so this is the
   * first message somebody reads there.
   */
  mismatchAdvice: string;
  /**
   * Addresses this account **used to** be called, newest first.
   *
   * Our id holding one of these is a machine seeded before the rename, not a
   * collision — so the seed writes the new address on and carries on, rather
   * than refusing and waiting for a human. Empty means the account has never
   * been called anything else, and any other address at our id is a refusal.
   *
   * See `planAccountEmail` for why this is safe to act on unasked.
   */
  renamableFrom: readonly string[];
}

/**
 * The two local accounts, and the reason there are two.
 *
 * They are different people and merging them would be a real change:
 *
 * - **The owner** is what rows written *outside* a request belong to — the CLI,
 *   the pipeline, `db:import`. src/owner.ts.
 * - **The administrator** is who signs in. `/api/admin/*` gates on a uuid rather
 *   than an email address (src/admin.ts explains why at length), so signing up
 *   through the email form gets the right address on a random id and is refused
 *   by the page it was meant to open — a silent lockout that has already
 *   happened once in production (docs/postmortems/260828f-admin-id-was-the-local-one.md).
 *   Seeding the id `src/admin.ts` already names is what avoids it.
 *
 * **Every id here is fixed rather than minted**, so it survives `npm run
 * db:reset`, is the same on a laptop and on the remote box, and can therefore be
 * written down in a constant at all.
 */
export const SEEDED_ACCOUNTS: readonly SeededAccount[] = [
  {
    id: DEV_OWNER_ID,
    email: DEV_OWNER_EMAIL,
    signsIn: false,
    why: "the owner every owner_id points at, for rows written outside a request",
    mismatchAdvice:
      "Rows already written point at one id or the other, so do not just delete it.\n" +
      "  Set SPIDERYARN_OWNER_ID to the id above and leave the account alone.",
    renamableFrom: [],
  },
  {
    id: ADMIN_USER_ID_LOCAL,
    email: ADMIN_EMAIL_LOCAL,
    signsIn: true,
    why: "the account Greg signs in as, and the one /api/admin/* recognises",
    /* **The one rename this repo performs unasked**, and only here. Every
       machine seeded between 2026-08-31 and 2026-09-02 has Greg's real
       production address on this local row, which is the confusion the rename
       exists to end — so it has to happen without him running anything.
       `planAccountEmail` is the fence. */
    renamableFrom: [ADMIN_EMAIL],
    mismatchAdvice:
      "This is the SIGN-IN account, so SPIDERYARN_OWNER_ID has nothing to do with it —\n" +
      "  /api/admin/* recognises the ids in src/admin.ts and no others, so the account\n" +
      "  above can sign in and will be refused the admin page with no explanation.\n" +
      "  Either delete it (check first that it owns no rows) and re-run this, or add its\n" +
      "  id to ADMIN_USER_IDS in src/admin.ts, which is a deliberate, reviewable edit.",
  },
];

/**
 * What to do about the address on our id. Pure, so tests/seed-accounts.test.ts
 * can exercise every branch with no GoTrue running.
 *
 * - `create` — nothing at that id yet.
 * - `keep` — it is already called what we want.
 * - `rename` — it holds an address this account used to be called
 *   (`renamableFrom`), so a machine seeded before the rename catches up on its
 *   next `npm run db:seed-owner` and nobody has to be told.
 * - `refuse` — anything else, which is somebody else's account at our id.
 *
 * ## Why renaming unasked is safe here and would not be anywhere else
 *
 * Writing an address onto an account you did not create is, in general, account
 * takeover. Four things make this the narrow exception rather than the rule,
 * and all four have to hold:
 *
 * - **The stack is local, twice over.** `refuseNonLocalSeed` checks the parsed
 *   hostname and `refuseMismatchedStack` asks the Supabase CLI which containers
 *   these actually are — so this cannot run against production, where Greg's
 *   real `greg@gregdetre.com` lives.
 * - **It is one id, fixed in git.** Only `ADMIN_USER_ID_LOCAL` has anything in
 *   `renamableFrom`. Note what that does *not* say: it establishes **where the
 *   row is, not where it came from**. GPT Sol was right to push on this, and the
 *   known case proves the point — the laptop's row was made by a Google sign-in
 *   before any of this existed (260831ab), not by a seed, and nothing here can
 *   tell one from the other. So the assumption, said plainly rather than left
 *   implicit: *a local stack is a single-purpose fixture whose fixed ids belong
 *   to this repo.* A restored dump, or a stack deliberately shared with somebody
 *   else, breaks that assumption and this would rename their row.
 * - **It is one *from* address, also fixed in git.** Not "any address", not a
 *   pattern — the literal previous value, listed.
 * - **It destroys nothing.** Measured on GoTrue v2.195.0, 2026-09-02: an admin
 *   email change leaves the password alone, leaves open sessions valid, and the
 *   new address signs in immediately. Unlike the password write above it, which
 *   revokes every session and is therefore done only when it must be. Nothing is
 *   overwritten either — see `staleIdentities`, which is about what the rename
 *   deliberately leaves behind.
 *
 * Compared **case-insensitively and trimmed**, because an address is not
 * case-sensitive in the part that matters and GoTrue stores what it was given.
 * A case difference read as "somebody else" would refuse for ever.
 */
export type EmailPlan = "create" | "keep" | "rename" | "refuse";

export function planAccountEmail(
  /** The row at our id, or `undefined` if there is none. */
  row: { email?: string } | undefined,
  account: Pick<SeededAccount, "email" | "renamableFrom">,
): EmailPlan {
  if (!row) return "create";
  const norm = (value: string) => value.trim().toLowerCase();
  /* An account with no address at all is not one of ours and not renamable —
     it is a row somebody made by hand, and guessing is how this goes wrong. */
  const held = row.email === undefined ? undefined : norm(row.email);
  if (held === undefined) return "refuse";
  if (held === norm(account.email)) return "keep";
  if (account.renamableFrom.some((was) => norm(was) === held)) return "rename";
  return "refuse";
}

/**
 * Which of an account's identities still carry an address it used to be called.
 *
 * **Renaming `auth.users.email` does not rename an identity**, and GPT Sol
 * caught the rename being described as more thorough than it is. GoTrue keeps a
 * row per sign-in method: the admin `PUT` updates the `email` one, but a
 * `google` identity left over from a browser sign-in keeps the address Google
 * gave it, inside `identity_data`. A machine whose local row began as a Google
 * sign-in is therefore renamed on the surface and still holding the old address
 * underneath — visible in Studio, and enough to make `AccountSection.tsx` say
 * "via google".
 *
 * Returns the provider names so the caller can say which. **It deletes
 * nothing**: removing an identity is destructive and is Greg's call, not a setup
 * script's.
 */
export function staleIdentities(
  identities: readonly { provider?: string; identity_data?: { email?: string } }[] | undefined,
  renamableFrom: readonly string[],
): string[] {
  if (!identities || renamableFrom.length === 0) return [];
  const old = new Set(renamableFrom.map((value) => value.trim().toLowerCase()));
  return identities
    .filter((identity) => {
      const email = identity.identity_data?.email;
      return typeof email === "string" && old.has(email.trim().toLowerCase());
    })
    .map((identity) => identity.provider ?? "an unnamed provider");
}

/**
 * Refuse to seed anything but a local stack. Returns the refusal, or `undefined`
 * to proceed.
 *
 * **A fence against an accident, not against a determined operator** — the same
 * honesty `assertPushableName` in scripts/gjd-remote-env.ts is written with.
 * A local port forwarded to a remote project is indistinguishable from a local
 * stack from in here, and nothing available at this layer can tell them apart.
 * What it does stop is the realistic version: a `.env.local` that has drifted
 * onto production values, or a `SUPABASE_URL=` typed on the command line.
 *
 * **Checked on the parsed hostname, never on a substring.** The regex this
 * replaced was `^https?://(127\.0\.0\.1|localhost)[:/]`, and
 * `http://localhost:8000@evil.example/` satisfies it while addressing
 * `evil.example` — userinfo before the `@` is not the host. scripts/seed-local-session.ts
 * had already learned this; this copy had not.
 */
export function refuseNonLocalSeed(
  rawUrl: string | undefined,
  env: Record<string, string | undefined>,
): string | undefined {
  if (env.NODE_ENV === "production" || env.VERCEL) {
    return (
      "refusing to seed: this process thinks it is production (NODE_ENV/VERCEL).\n" +
      "  These accounts are development fixtures with a password in git."
    );
  }
  if (!rawUrl) {
    return (
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n" +
      "  Local: npm run db:start, then they come from .env.local.\n" +
      "  See docs/project/supabase-local.md."
    );
  }
  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    return `SUPABASE_URL is not a URL: ${rawUrl}`;
  }
  const isLocal = host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  if (isLocal) return undefined;
  return (
    `SUPABASE_URL does not point at a local host: ${host}\n` +
    "  This seeds development accounts — one of them with a password that is in\n" +
    "  git — and must only ever run against the local Docker stack. In production\n" +
    "  the owner is the logged-in user and the administrator already exists."
  );
}

/**
 * `supabase status -o env` → key/value.
 *
 * Its own lines only. The CLI also prints a "Stopped services" line and an
 * update notice, and a parser that took every line would invent entries from
 * whatever prose upstream adds next.
 */
export function parseStatusEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m?.[1]) continue;
    const raw = m[2] ?? "";
    const unquoted = raw.length >= 2 && raw[0] === '"' && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    out.set(m[1], unquoted);
  }
  return out;
}

/**
 * Is the thing at `SUPABASE_URL` **this repo's own local stack**? Returns the
 * refusal, or `undefined` to proceed.
 *
 * ## Why the hostname is not enough on its own
 *
 * `refuseNonLocalSeed` reads `SUPABASE_URL` — and so does everything else in the
 * run. Seed through that URL, sign in through that URL, verify through that URL,
 * and all three agree with each other no matter what is actually on the other
 * end. A loopback proxy or an `ssh -L` forwarding 54361 to a cloud project is
 * indistinguishable from a local stack to every one of them, and a
 * `.env.local` carrying that project's service key completes the picture. GPT
 * Sol raised exactly this against the plan, 2026-08-31, and it is the
 * "check that agrees with the bug" shape from
 * docs/reusable/silent-success.md.
 *
 * So this asks a **different source**: the Supabase CLI, which reads the Docker
 * containers for this repo's project rather than our environment. A proxy cannot
 * make the CLI describe it.
 *
 * ## The two comparisons catch different things, and neither is redundant
 *
 * - **The address** catches another *local* stack. The old app runs its own on
 *   54341 while ours is on 54361 (docs/project/supabase-local.md § The ports),
 *   and no hostname check can tell those apart.
 * - **The service-role key** catches a tunnel to a *cloud* project, which is the
 *   case a local address cannot rule out. Worth being exact about what this
 *   compares, because it is less than it looks: our legacy key decodes to
 *   `{"iss":"supabase-demo","role":"service_role"}` — the CLI's fixed demo
 *   string, identical on every default local install on earth. So it does **not**
 *   distinguish one local stack from another; the address does that. What it
 *   does distinguish is a real project, whose keys are its own.
 *
 * Between them: an address that is not ours is refused, and ours-with-somebody
 * else's credential is refused. What neither can catch is a cloud project
 * tunnelled onto our exact port *and* addressed with the demo key — and that
 * combination cannot write anything, because the real project would refuse the
 * demo key on the first admin call.
 *
 * The key is compared and never printed, in either direction.
 */
export function refuseMismatchedStack(
  seen: { url: string; serviceKey: string },
  status: Map<string, string>,
): string | undefined {
  const apiUrl = status.get("API_URL");
  const serviceKey = status.get("SERVICE_ROLE_KEY");
  if (!apiUrl || !serviceKey) {
    return (
      "could not read the local stack's own identity from `supabase status`.\n" +
      "  Run: npm run db:start — and see docs/project/supabase-local.md.\n" +
      "  Refusing rather than falling back to SUPABASE_URL, which is the value in doubt."
    );
  }
  /**
   * Compared as **origins with loopback folded together**, not as strings.
   *
   * `refuseNonLocalSeed` above accepts `localhost`, `127.0.0.1` and `[::1]` as
   * the same machine — they are — while the CLI always prints `127.0.0.1`. A
   * literal comparison would therefore accept `SUPABASE_URL=http://localhost:54361`
   * at the first gate and refuse it here, telling somebody with a perfectly
   * ordinary `.env.local` that something other than the local stack is answering.
   * GPT Sol caught this on the built code, 2026-08-31.
   *
   * The **port** is what carries the meaning, since that is what tells our stack
   * from the old app's on 54341, and it is compared exactly.
   */
  const origin = (raw: string): string | undefined => {
    try {
      const u = new URL(raw);
      const host = u.hostname === "localhost" || u.hostname === "[::1]" ? "127.0.0.1" : u.hostname;
      return `${host}:${u.port}`;
    } catch {
      return undefined;
    }
  };
  const theirs = origin(apiUrl);
  const ours = origin(seen.url);
  if (!theirs || !ours || theirs !== ours) {
    return (
      `SUPABASE_URL is ${seen.url}, but this repo's local stack is at ${apiUrl}.\n` +
      "  Something other than the local stack is answering on that address — a\n" +
      "  forwarded port, or a .env.local that has drifted. Refusing to seed it."
    );
  }
  if (serviceKey !== seen.serviceKey) {
    return (
      "SUPABASE_SERVICE_ROLE_KEY is not the key this repo's local stack issues.\n" +
      "  The address matches and the credential does not, which is what a tunnel to\n" +
      "  another project looks like. Refusing to seed it."
    );
  }
  return undefined;
}

/**
 * Is a failed password grant a **verdict on the password**, or something else?
 *
 * Pure, and split out of the script for one reason: this is the
 * highest-consequence decision in the whole change and it lived inside a file
 * that does its work at import time, so nothing could test it. GPT Sol's first
 * finding on the built code, 2026-08-31.
 *
 * `"wrong"` is the only answer that lets the caller write, and writing revokes
 * every open session for that account — measured on GoTrue v2.195.0, and the
 * reason the caller asks at all. So everything unfamiliar is `"unknown"`, which
 * means stop: the rate limit (`sign_in_sign_ups = 30` per five minutes,
 * supabase/config.toml) is the realistic one, and reading a 429 as "wrong
 * password" would sign Greg out for the sake of a password that was already
 * right.
 *
 * The **`x-sb-error-code` header first**, body second. GoTrue sets that header
 * on its structured errors, and a body is not always JSON — anything sitting in
 * front of the stack can answer with an HTML error page, and a regex over that
 * is guesswork.
 */
export type PasswordVerdict = "wrong" | "unknown";

export function readPasswordVerdict(
  status: number,
  header: string | null,
  body: string,
): { verdict: PasswordVerdict; errorCode: string } {
  const fromHeader = (header ?? "").trim();
  const fromBody = /"error_code"\s*:\s*"([a-z_]+)"/.exec(body)?.[1] ?? "";
  const errorCode = fromHeader || fromBody;
  /* Both halves required. A 400 whose code we do not recognise is not a verdict,
     and `invalid_credentials` on a status we did not expect is not one either. */
  const wrong = status === 400 && errorCode === "invalid_credentials";
  return { verdict: wrong ? "wrong" : "unknown", errorCode };
}

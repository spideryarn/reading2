/**
 * What `gjd-remote push-env` is allowed to put on the box, and how it is
 * written. Pure functions only — no ssh, no filesystem — so the rule that
 * matters can be tested without a server: tests/gjd-remote-env.test.ts.
 *
 * Split out of scripts/gjd-remote.ts for exactly that reason. That file runs
 * main() on import, and an entrypoint guard is a bad thing to depend on.
 */
import { createHash } from "node:crypto";
import { isLocalDatabaseUrl } from "../src/db/ssl.js";

/**
 * THE ALLOWLIST. Every key that may reach the box, named.
 *
 * An allowlist, not a blocklist, and the difference is the whole point: with a
 * blocklist the next secret Greg adds to `.env.local` travels to the box by
 * default, and nobody finds out. Here, a new key is skipped and reported until
 * somebody deliberately adds it to this list.
 *
 * What is on it: the local Supabase stack's fixed demo credentials, the Google
 * OAuth pair that only works against that local stack, and the model-provider
 * keys the pipeline needs to do anything at all.
 *
 * Deliberately NOT on it, and neither may be added without Greg saying so:
 *  - HETZNER_CLOUD_API_TOKEN — it can destroy this very box. A box that holds
 *    the credential for its own deletion is one bad agent away from gone.
 *  - SUPABASE_ACCESS_TOKEN — a Supabase *management* PAT. `.env.example` says
 *    in its own comment that it can create and delete projects, which includes
 *    the production one. Nothing on the box needs it: the Supabase MCP is
 *    pointed at the LOCAL stack on a loopback address, which is what makes the
 *    box able to do without this key at all. It has no --read-only mode — an
 *    earlier version of this comment said it did — so two of its eleven tools
 *    write; they just cannot write anywhere that matters.
 *
 * And one that is not here to be added by symmetry: **the local administrator's
 * password**. It is generated per machine into `~/.config/spideryarn/`
 * (scripts/seed-accounts.ts) rather than kept in `.env.local`, so there is
 * nothing for this file to carry — and pushing it would undo the one thing that
 * design buys, which is that one leaked credential is one machine.
 *
 * The box is shared by many autonomous agents running as one user with
 * passwordless sudo, so "on the box" means "reachable by all of them".
 */
/**
 * **The two names that may never travel, whoever asks.**
 *
 * The reasoning is in the docblock above — each of these can destroy
 * infrastructure, and the box is shared by autonomous agents running as one
 * user with passwordless sudo. Written down as a value, rather than left as
 * prose plus an absence from `ALLOWLIST`, because Spideryarn's allowlist is not
 * the only consumer any more: `gjd-remote push-env` from a repo with no typed
 * allowlist builds its checklist from whatever is in that repo's `.env.local`,
 * and needs to know which rows can never be ticked
 * (scripts/gjd-remote-envpolicy.ts). An absence cannot be imported.
 *
 * A hard guard, not a default: `applyGuards` re-checks it after the user has
 * made their selection, so a tick on one of these is refused by name rather
 * than merely discouraged in the UI. Greg's product call, 2026-09-02, recorded
 * in docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md.
 */
export const FORBIDDEN_NAMES: readonly string[] = [
  "HETZNER_CLOUD_API_TOKEN",
  "SUPABASE_ACCESS_TOKEN",
];

/**
 * Allowlisted keys whose VALUE must point at the throwaway container, not just
 * whose name is on the list above.
 *
 * The allowlist matches names, and a name says nothing about where it points:
 * `DATABASE_URL` is spelled the same whether it is the local Docker stack or
 * the one production database we have no staging copy of. So the banner
 * `buildEnvPayload` writes — "production credentials are deliberately absent" —
 * was a claim nothing enforced, and it would have gone quietly false the first
 * afternoon somebody pointed `.env.local` at production and then ran a push.
 * Now the banner is true by construction rather than by habit. Found by GPT
 * Sol, 2026-08-31.
 *
 * `isLocalDatabaseUrl` rather than a fresh test, deliberately: "local" must not
 * mean one thing to the migrator's guard and another to this one, and that
 * function already fails closed on a URL it cannot parse and already survives a
 * loopback address hidden in a password (src/db/ssl.ts).
 */
export const MUST_BE_LOCAL: readonly string[] = ["DATABASE_URL", "SUPABASE_URL", "VITE_SUPABASE_URL"];

/**
 * Is this value a postgres connection string at all?
 *
 * Asked separately from `isLocalDatabaseUrl`, which answers "yes" only for a
 * loopback host and fails closed on everything else — including "this is not a
 * URL", "this is an API key" and "this is the word `true`". Feeding every value
 * in a `.env.local` straight to that function would therefore report the whole
 * file as production. So the question is split in two: **is this a database
 * URL**, and only then, **does it point at the throwaway container**.
 *
 * Only the scheme is read, and the value is never returned or logged.
 */
export function isPostgresUrl(value: string): boolean {
  try {
    const scheme = new URL(value).protocol;
    return scheme === "postgres:" || scheme === "postgresql:";
  } catch {
    return false;
  }
}

/**
 * **The one locality rule**, asked by name AND by value.
 *
 * Two callers, and they must not be able to disagree: `buildEnvPayload` below
 * refuses a payload with it, and `push-env`'s checklist greys a row out with it
 * (`valueGuard` in scripts/gjd-remote.ts). A checklist that let a row be ticked
 * and a payload that then refused it would be the same rule written twice, and
 * the reader would meet it for the first time after answering the questions.
 *
 * Two ways in, because either alone has a hole. **By NAME** is Spideryarn's
 * `MUST_BE_LOCAL`, which catches `SUPABASE_URL` — an http URL that
 * `isPostgresUrl` will never recognise. **By VALUE** is the hard guard the plan
 * asks for on repos that have no typed list at all: hellozenno spells its
 * production database `DATABASE_URL_PROD`, and no name list this repo writes
 * will ever have heard of it. A postgres URL is a postgres URL whatever it is
 * called.
 *
 * `"not-applicable"` rather than `"local"` for a value that is neither, so a
 * caller cannot read "this is not a database URL" as "this database URL is
 * fine".
 */
export function localityVerdict(name: string, value: string): "not-applicable" | "local" | "not-local" {
  const byName = MUST_BE_LOCAL.includes(name);
  const byValue = isPostgresUrl(value);
  if (!byName && !byValue) return "not-applicable";
  return isLocalDatabaseUrl(value) ? "local" : "not-local";
}

export const ALLOWLIST: readonly string[] = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET",
  /* Who owns rows written OUTSIDE a request — the CLI, the pipeline, db:import.
     Here so that a fresh box lands them on the shelf Greg sees when he signs in,
     rather than on the seeded row-owner nobody signs in as. Without it the box's
     library is empty however much has been ingested, and a line typed on the box
     would be destroyed by the next push, because this file REBUILDS .env.local
     rather than merging into it. src/owner.ts, and Greg's call 2026-08-31. */
  "SPIDERYARN_OWNER_ID",
  /* Which store serves article reads (src/store/live.ts). It defaults to
     `files` for a CLI script or a test — but `npm run dev` itself defaults to
     `postgres` since 2026-09-02, so a box that has never been told still gets a
     working dev server. Setting it explicitly still matters for the box's other
     processes: everything written by the pipeline and by `npm run db:seed-dev`
     sits in Postgres, and a CLI script left on `files` would not see it. Here so
     that setting it once on the laptop fixes every box, since this file
     REBUILDS .env.local rather than merging into it, and a line typed on the box
     is destroyed by the next push. A name on this list sends nothing on its own;
     only a value that is actually set travels. */
  "SPIDERYARN_STORE",
  /* The TEST-MODE Stripe secret, for the payments work
     (docs/plans/260902i-stripe-payments-and-subscription-tiers.md). Only ever
     `sk_test_…`: buildEnvPayload refuses any live-mode Stripe secret by its
     prefix, whatever name it travels under, the way the Supabase-JWT check
     works. STRIPE_WEBHOOK_SECRET is deliberately NOT here — the local one is
     minted per machine by `stripe listen`, so the laptop's value would be
     wrong on the box, like the admin password. Greg's call, 2026-09-02. */
  "STRIPE_SECRET_KEY",
  /* The prices the paid tiers are sold at, one variable per tier. Not secrets —
     they are in the Checkout URL every customer sees — and a box without them
     cannot run a checkout at all, so they travel with the key rather than being
     typed on each box. **A new tier means a new name here**; the list they come
     from is PAID_TIERS in src/billing/tiers.ts, and
     docs/project/billing.md § Adding a tier or a currency is the checklist. */
  "STRIPE_PRICE_READER",
  "STRIPE_PRICE_RESEARCHER",
];

/**
 * Is this value a live-mode Stripe secret?
 *
 * Stripe encodes the mode in the key itself — `sk_test_…`/`rk_test_…` against
 * `sk_live_…`/`rk_live_…` — so, as with `supabaseJwtIssuer`, the SHAPE of the
 * value decides, not the name it sits under: a live key pasted into the wrong
 * variable is still a live key. Publishable keys (`pk_live_…`) are public by
 * construction and none of this function's business.
 */
export function isLiveStripeSecret(value: string): boolean {
  return /^(?:sk|rk)_live_/.test(value);
}

/** Only this name, ever. See assertPushableName. */
export const ENV_BASENAME = ".env.local";

/**
 * Refuse anything that is not literally `.env.local`.
 *
 * This is a guard against an accident — a stray `--file ../.env.prod`, a
 * tab-completion that went one entry too far — not against someone determined
 * to copy a file to another name first. The allowlist above is what actually
 * stops a production credential travelling; this is the cheap outer fence.
 */
export function assertPushableName(basename: string): string | undefined {
  if (basename === ENV_BASENAME) return undefined;
  return (
    `refusing to push '${basename}' — push-env only ever copies ${ENV_BASENAME}.\n` +
    `  There is no flag for this. .env.prod holds production database credentials,\n` +
    `  and the box runs autonomous agents as one user with passwordless sudo.`
  );
}

/**
 * Key → value from a .env file's bytes.
 *
 * ONE parser, used for the laptop's file AND for reading the box's copy back.
 * Two parsers is how a diff quietly lies: each side agrees with itself, and the
 * value that crossed the seam is never the thing compared.
 *
 * A quoted value may run over several lines (a PEM key does). Consuming those
 * continuation lines matters more than getting the value exactly right — a
 * parser that stops at the newline goes on to read `-----END` as a key name and
 * invents entries that were never in the file.
 */
export function parseEnv(text: string): Map<string, string> {
  return scanEnv(text).values;
}

export type EnvScan = {
  values: Map<string, string>;
  /**
   * Every way this file could quietly LOSE an allowed key, one line each.
   *
   * Not a style report. The allowlist means a malformed file cannot send
   * anything it should not — that half was checked and holds — but it can
   * still send FEWER keys than it looks like it is sending, and the push then
   * replaces the box's file with the short version and prints a green tick.
   * A duplicate takes the later value, an unclosed quote eats every line after
   * it, and a line the pattern does not match is simply skipped.
   *
   * Never contains any of the file's content: a malformed line is named by its
   * NUMBER, because whatever is on it may well be the secret.
   */
  problems: string[];
};

/** The parse, with what it had to overlook. parseEnv() is this without the
 *  second half — there is one scanner so the two can never disagree. */
export function scanEnv(text: string): EnvScan {
  const values = new Map<string, string>();
  const problems: string[] = [];
  // A byte-order mark would otherwise glue itself to the first key's name.
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m?.[1]) {
      problems.push(`line ${i + 1}: not a KEY=value line and not a comment, so nothing on it was read`);
      continue;
    }
    const key = m[1];
    if (values.has(key)) {
      problems.push(`line ${i + 1}: ${key} is set more than once — only the last value would be sent`);
    }
    const rest = m[2] ?? "";
    const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : "";
    if (!quote) {
      values.set(key, rest.trim());
      continue;
    }
    const opened = i + 1;
    let body = rest.slice(1);
    let end = closingQuote(body, quote);
    while (end < 0 && i + 1 < lines.length) {
      body += `\n${lines[++i]}`;
      end = closingQuote(body, quote);
    }
    if (end < 0) {
      problems.push(
        `line ${opened}: ${key}'s opening ${quote} is never closed, so it swallowed the ` +
          `${i - opened + 1} line(s) after it and any keys on them`,
      );
    }
    const raw = end < 0 ? body : body.slice(0, end);
    // Single quotes are literal, double quotes carry escapes — the same rule
    // serialiseEnv writes by, so a value survives the round trip unchanged.
    values.set(key, quote === "'" ? raw : unescapeDouble(raw));
  }
  return { values, problems };
}

function closingQuote(body: string, quote: string): number {
  for (let j = 0; j < body.length; j++) {
    if (quote === '"' && body[j] === "\\") {
      j++;
      continue;
    }
    if (body[j] === quote) return j;
  }
  return -1;
}

function unescapeDouble(s: string): string {
  return s.replace(/\\(.)/g, (_, c: string) =>
    c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c,
  );
}

/** Bare where it is safe, double-quoted where it is not. The inverse of the
 *  double-quote branch of parseEnv, and the push verifies the round trip. */
export function serialiseValue(value: string): string {
  if (value !== "" && /^[A-Za-z0-9_@%+=:,./?&#~^*!$()[\]{}<>|;-]+$/.test(value)) return value;
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
  return `"${escaped}"`;
}

export type EnvPayload = {
  /** The exact bytes to write on the box. */
  text: string;
  /** Where the list of names came from, for a message that has to say. Copied
   *  off the allowance, so a refusal cannot name the wrong list. */
  sourceOfNames: string;
  /** Allowlisted keys that were present locally, in allowlist order. */
  pushed: Map<string, string>;
  /** Present locally, not on the allowlist — reported, never sent. */
  skipped: string[];
  /** On the allowlist, absent locally — reported, because a missing key is
   *  usually a laptop that has drifted rather than a deliberate omission. */
  missing: string[];
  /** Ways the local file could have lost a key on the way in. Refused, not
   *  reported: see EnvScan.problems. */
  problems: string[];
};

/**
 * Who issued this, if it is a Supabase JWT at all?
 *
 * Returns the `iss` claim, `"not-a-jwt"` for anything that is not one, and
 * `"unreadable"` for something JWT-shaped whose payload will not decode —
 * which must NOT come out as "fine", for the same reason `isLocalDatabaseUrl`
 * fails closed: "I cannot tell what this is" is not "yes, it is the local one".
 *
 * Only the header/payload structure and the `iss` claim are ever looked at, and
 * neither the value nor the project ref is ever returned or logged.
 */
export function supabaseJwtIssuer(value: string): string {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] === "" || parts[1] === "") return "not-a-jwt";
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return "unreadable";
  }
  if (typeof payload !== "object" || payload === null) return "unreadable";
  const claims = payload as Record<string, unknown>;
  /* Not every JWT is Supabase's. One without these claims is somebody else's
     token and none of this function's business. */
  if (!("iss" in claims) && !("role" in claims) && !("ref" in claims)) return "not-a-jwt";
  const iss = claims["iss"];
  return typeof iss === "string" ? iss : "unreadable";
}

/**
 * **Which names may travel, and the one line of the banner that says so.**
 *
 * The list used to be `ALLOWLIST`, full stop, and that was Spideryarn's: a list
 * of key NAMES, where another repo's `DATABASE_URL` is not this one's. There
 * are two sources for it now and the file on the box has to say which one it
 * was built from, because "only allowlisted keys are here" is a false claim
 * about a file whose keys came off a checklist somebody ticked.
 *
 * `SPIDERYARN_ALLOWANCE` below is the typed one. The other is assembled by
 * `push-env` from the names the reader approved
 * (scripts/gjd-remote-envpolicy.ts), and its `source` names the policy file.
 */
export type EnvAllowance = {
  /** The names that may be written, in the order they should be written in. */
  names: readonly string[];
  /** How the banner finishes the sentence "Only the keys … are here". */
  source: string;
};

/** This repo's own policy: the hand-written list at the top of this file. */
export const SPIDERYARN_ALLOWANCE: EnvAllowance = {
  names: ALLOWLIST,
  source: "on the allowlist in scripts/gjd-remote-env.ts",
};

/**
 * Build the bytes for the box, from a local `.env.local` and an allowance.
 *
 * The allowance is a REQUIRED argument rather than a default, deliberately.
 * Defaulting it to Spideryarn's list would mean a caller that forgot it pushed
 * another repo's file under this repo's policy — which is silent, wrong, and
 * exactly the accident the per-repo work exists to prevent. There is no reading
 * of "no allowance given" that is safe enough to guess at.
 */
export function buildEnvPayload(localText: string, allowance: EnvAllowance): EnvPayload {
  const { values: local, problems } = scanEnv(localText);
  const allowed = new Set(allowance.names);
  const pushed = new Map<string, string>();
  const missing: string[] = [];
  for (const key of allowance.names) {
    const value = local.get(key);
    if (value === undefined) missing.push(key);
    else pushed.set(key, value);
  }
  const skipped = [...local.keys()].filter((k) => !allowed.has(k)).sort();

  /* Refused, not warned about. A push that went ahead with a note would put
     production on a box shared by autonomous agents, under a header saying it
     had not. The KEY is named and the value never is — the host would usually
     be harmless, but "usually" is not a rule this file can apply to a string it
     has not parsed. */
  /* A loopback URL is not the whole story. A production SUPABASE_SERVICE_ROLE_KEY
     bypasses every policy in the database it belongs to, and it would sail past
     a check that only reads URLs. The local stack's keys say so themselves —
     they are JWTs with `iss: supabase-demo` and no project `ref`, where a hosted
     project's carry `iss: supabase` and its ref — so this needs no list of
     known-bad values and no secret leaves the file. Keyed off the SHAPE rather
     than the key name, so a Supabase JWT added to the allowlist under any name
     is covered the day it is added. GPT Sol, 2026-08-31. */
  for (const [key, value] of pushed) {
    const verdict = supabaseJwtIssuer(value);
    if (verdict === "not-a-jwt") continue;
    if (verdict !== "supabase-demo") {
      problems.push(
        `${key} is a Supabase key issued by something other than the local stack, and only the ` +
          `local stack's keys go on the box. (Its issuer, not its value, is what was read.)`,
      );
    }
  }

  /* Same reasoning, Stripe edition: the mode is in the key's own prefix, so a
     live-mode secret is refused whatever variable name it is under. Only test
     keys belong on a box shared by autonomous agents. */
  for (const [key, value] of pushed) {
    if (isLiveStripeSecret(value)) {
      problems.push(
        `${key} is a LIVE-mode Stripe secret, and only test-mode keys go on the box. ` +
          `(Its prefix, not its value, is what was read.)`,
      );
    }
  }

  /* By name for the three Spideryarn spells out, and BY VALUE for everything
     else — a postgres URL under a name no list here has heard of is still a
     postgres URL. That second arm is what makes this rule mean anything for a
     repo with no typed allowlist: hellozenno's production database is called
     DATABASE_URL_PROD, which `MUST_BE_LOCAL` will never match and a reader
     might well tick. `localityVerdict` is the one rule; the checklist greys the
     row out with the same call. */
  for (const [key, value] of pushed) {
    if (localityVerdict(key, value) !== "not-local") continue;
    problems.push(
      MUST_BE_LOCAL.includes(key)
        ? `${key} does not point at the local stack, and this only ever sends local ones. ` +
            `Point it back at 127.0.0.1, or edit MUST_BE_LOCAL in scripts/gjd-remote-env.ts on purpose.`
        : `${key} is a database URL that does not point at 127.0.0.1, and only local ones go on ` +
            `the box. (Its host, not its value, is what was read.)`,
    );
  }

  // No timestamp in the banner: it would make every push a change even when
  // nothing changed, and the file's mtime already says when.
  const header = [
    `# Written by \`gjd-remote push-env\` from the laptop's ${ENV_BASENAME}.`,
    `# Only the keys ${allowance.source} are here, and`,
    `# every Supabase target in them is the LOCAL stack — checked, not assumed.`,
    `# Paid model-provider keys ARE here; what is absent is production data.`,
    `# Edits made on the box are overwritten by the next push.`,
    ``,
  ];
  const body = [...pushed].map(([k, v]) => `${k}=${serialiseValue(v)}`);
  return {
    text: `${[...header, ...body].join("\n")}\n`,
    sourceOfNames: allowance.source,
    pushed,
    skipped,
    missing,
    problems,
  };
}

/** Compared, never printed. A short value would not survive being shown as a
 *  hash, so no hash is ever shown — only key names are. */
export function valueHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type KeyDiff = { added: string[]; removed: string[]; changed: string[]; unchanged: number };

/** What changed between what is on the box and what we are about to send —
 *  by KEY NAME only. */
export function diffKeys(before: Map<string, string>, after: Map<string, string>): KeyDiff {
  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  for (const [k, v] of after) {
    const old = before.get(k);
    if (old === undefined) added.push(k);
    else if (valueHash(old) !== valueHash(v)) changed.push(k);
    else unchanged++;
  }
  const removed = [...before.keys()].filter((k) => !after.has(k));
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort(), unchanged };
}

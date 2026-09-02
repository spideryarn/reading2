/**
 * The rules `npm run db:seed-owner` follows, tested without a Supabase.
 *
 * Two claims are worth a test here and the rest is arithmetic:
 *
 * 1. **The seed and the gate cannot drift apart.** The administrator is seeded
 *    at a uuid and `/api/admin/*` recognises a uuid, and if those two ever stop
 *    being the same value the symptom is Greg signing in successfully and being
 *    shown the shelf — the silent lockout src/admin.ts describes and
 *    docs/postmortems/260828f-admin-id-was-the-local-one.md is about.
 * 2. **The fence is on the host, not on a substring.** See the userinfo case.
 */
import { describe, expect, it } from "vitest";

import { ADMIN_EMAIL, ADMIN_EMAIL_LOCAL, ADMIN_USER_ID_LOCAL, isAdmin } from "../src/admin.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import { mkdtempSync, chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  adminEmailPath,
  SEEDED_ACCOUNTS,
  adminPasswordPath,
  planAccountEmail,
  staleIdentities,
  newAdminPassword,
  passwordFileIsUsable,
  readAdminCredentials,
  readOrCreateAdminPassword,
  parseStatusEnv,
  readPasswordVerdict,
  refuseMismatchedStack,
  refuseNonLocalSeed,
  writeAdminEmail,
} from "../scripts/seed-accounts.js";

const NOTHING_SET = {} as Record<string, string | undefined>;

describe("what gets seeded", () => {
  it("seeds an account the admin gate actually recognises", () => {
    const admin = SEEDED_ACCOUNTS.find((a) => a.id === ADMIN_USER_ID_LOCAL);
    expect(admin).toBeDefined();
    expect(admin?.id).toBe(ADMIN_USER_ID_LOCAL);
    /* The claim that matters: not "the constant equals itself" but "the gate
       says yes to what the seed writes". */
    expect(isAdmin(admin?.id)).toBe(true);
  });

  it("expects a sign-in for the administrator and none for the row-owner", () => {
    const admin = SEEDED_ACCOUNTS.find((a) => a.id === ADMIN_USER_ID_LOCAL);
    const owner = SEEDED_ACCOUNTS.find((a) => a.id === DEV_OWNER_ID);
    expect(admin?.signsIn).toBe(true);
    /* Nothing signs in as the row-owner, so a credential on it would be one that
       exists for no reason. */
    expect(owner?.signsIn).toBe(false);
  });

  it("has no two accounts sharing an id or an address", () => {
    expect(new Set(SEEDED_ACCOUNTS.map((a) => a.id)).size).toBe(SEEDED_ACCOUNTS.length);
    expect(new Set(SEEDED_ACCOUNTS.map((a) => a.email)).size).toBe(SEEDED_ACCOUNTS.length);
  });

  /**
   * **Greg's real address is not what a local stack is called**, which is the
   * whole of the 2026-09-02 rename. Written as a property rather than as
   * `toBe("dev-admin@…")` so that changing the fixture address again does not
   * need this test edited — the claim is "not a real person's", not "this
   * string".
   */
  it("gives no seeded account a real person's address", () => {
    for (const account of SEEDED_ACCOUNTS) {
      expect(account.email).not.toBe(ADMIN_EMAIL);
      /* `.local` is reserved for mDNS (RFC 6762), so it is not a domain anybody
         can hold. Not a claim that nothing will send to it — the local stack
         runs Mailpit, which would accept one. This asserts the two things it
         can: not the known real address, and on the fixture domain. */
      expect(account.email.endsWith("@spideryarn.local")).toBe(true);
    }
  });

});

describe("the administrator's password file", () => {
  const home = () => mkdtempSync(path.join(tmpdir(), "seed-accounts-"));

  it("generates something long, unguessable and safe to paste anywhere", () => {
    const a = newAdminPassword();
    /* supabase/config.toml sets minimum_password_length = 6; this clears it by a
       mile. The character check is the one that would bite quietly: `+`, `/` and
       `=` are exactly what gets mangled between a shell, a JSON body and a form,
       and the failure would look like a wrong password. */
    expect(a.length).toBeGreaterThanOrEqual(24);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(newAdminPassword());
  });

  it("creates one 0600, and gives back the same one next time", () => {
    const dir = home();
    const first = readOrCreateAdminPassword(dir);
    expect(first.created).toBe(true);
    expect(first.path).toBe(adminPasswordPath(dir));
    expect(statSync(first.path).mode & 0o777).toBe(0o600);

    const second = readOrCreateAdminPassword(dir);
    /* The property the whole design rests on: `npm run db:reset` must not change
       the password, because the seed would then set the new one and revoke every
       open session. The file is outside the database, so a reset cannot. */
    expect(second.password).toBe(first.password);
    expect(second.created).toBe(false);
  });

  it("tightens a file somebody has loosened, rather than trusting it", () => {
    const dir = home();
    const { path: file } = readOrCreateAdminPassword(dir);
    chmodSync(file, 0o644);
    readOrCreateAdminPassword(dir);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("replaces a file that is empty or truncated", () => {
    const dir = home();
    const { path: file, password } = readOrCreateAdminPassword(dir);
    for (const junk of ["", "   \n", "short"]) {
      writeFileSync(file, junk);
      const again = readOrCreateAdminPassword(dir);
      expect(again.created, junk).toBe(true);
      expect(again.password, junk).not.toBe(password);
      expect(passwordFileIsUsable(readFileSync(file, "utf8"))).toBe(true);
      /* And a replacement is locked down too — writeFileSync's `mode` applies
         only when it creates the file, so an existing 0644 one would keep it. */
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });
});

/**
 * Catching up a machine that was seeded before the address changed.
 *
 * The interesting property is not that a rename happens but that it is the ONLY
 * thing that happens: every address other than the one listed in
 * `renamableFrom` is still a refusal, and the owner row — which lists none — can
 * never be renamed at all.
 */
describe("planAccountEmail", () => {
  const admin = SEEDED_ACCOUNTS.find((a) => a.id === ADMIN_USER_ID_LOCAL)!;
  const owner = SEEDED_ACCOUNTS.find((a) => a.id === DEV_OWNER_ID)!;

  it("creates when nothing is at the id", () => {
    expect(planAccountEmail(undefined, admin)).toBe("create");
  });

  it("leaves an account that is already called the right thing alone", () => {
    expect(planAccountEmail({ email: ADMIN_EMAIL_LOCAL }, admin)).toBe("keep");
  });

  it("renames the pre-2026-09-02 row rather than refusing and waiting for a human", () => {
    /* The case every existing laptop and box is in. Without this the seed dies
       on `the id … is already held by …`, and setup stops at step 3 on every
       machine that already worked. */
    expect(planAccountEmail({ email: ADMIN_EMAIL }, admin)).toBe("rename");
  });

  it("does not mistake a case difference for somebody else", () => {
    expect(planAccountEmail({ email: ADMIN_EMAIL.toUpperCase() }, admin)).toBe("rename");
    expect(planAccountEmail({ email: ` ${ADMIN_EMAIL_LOCAL.toUpperCase()} ` }, admin)).toBe("keep");
  });

  it("refuses an address that is neither ours nor one we used to have", () => {
    expect(planAccountEmail({ email: "someone@example.com" }, admin)).toBe("refuse");
  });

  it("refuses a row with no address rather than guessing it is ours", () => {
    expect(planAccountEmail({}, admin)).toBe("refuse");
  });

  it("will not rename the row-owner, which has never been called anything else", () => {
    expect(owner.renamableFrom).toEqual([]);
    expect(planAccountEmail({ email: ADMIN_EMAIL }, owner)).toBe("refuse");
  });

  it("never lists its own destination as an address to rename from", () => {
    /* The dangerous inversion: `renamableFrom` containing the address we are
       moving TO would make the plan circular. Named for exactly what it checks —
       it says nothing about a live row at the destination, which is
       `findByEmail`'s job in scripts/db-seed-owner.ts and not testable here. */
    for (const account of SEEDED_ACCOUNTS) {
      expect(account.renamableFrom).not.toContain(account.email);
    }
  });
});

/**
 * What the rename deliberately leaves behind.
 *
 * GoTrue keeps one identity per sign-in method and the admin `PUT` updates only
 * the `email` one, so a row that began as a Google sign-in stays renamed on the
 * surface and old underneath. GPT Sol found the gap; this is the reporting for
 * it, and it reports rather than deletes.
 */
describe("staleIdentities", () => {
  const admin = SEEDED_ACCOUNTS.find((a) => a.id === ADMIN_USER_ID_LOCAL)!;

  it("says nothing when every identity has caught up", () => {
    const identities = [{ provider: "email", identity_data: { email: ADMIN_EMAIL_LOCAL } }];
    expect(staleIdentities(identities, admin.renamableFrom)).toEqual([]);
  });

  it("names the provider still holding the old address", () => {
    /* The laptop's shape: a Google sign-in made the row before any of this
       existed, so `google` keeps the address Google gave it. */
    const identities = [
      { provider: "email", identity_data: { email: ADMIN_EMAIL_LOCAL } },
      { provider: "google", identity_data: { email: ADMIN_EMAIL } },
    ];
    expect(staleIdentities(identities, admin.renamableFrom)).toEqual(["google"]);
  });

  it("is empty for an account that was never called anything else", () => {
    const identities = [{ provider: "google", identity_data: { email: ADMIN_EMAIL } }];
    /* The owner row lists no old address, so nothing about it can be stale — and
       a function that reported one anyway would send somebody hunting. */
    expect(staleIdentities(identities, [])).toEqual([]);
  });

  it("survives GoTrue omitting the parts it does not always send", () => {
    expect(staleIdentities(undefined, admin.renamableFrom)).toEqual([]);
    expect(staleIdentities([{ provider: "email" }], admin.renamableFrom)).toEqual([]);
    expect(staleIdentities([{ identity_data: { email: ADMIN_EMAIL } }], admin.renamableFrom))
      .toEqual(["an unnamed provider"]);
  });
});

/**
 * The half of the password file that must NEVER write.
 *
 * `readAdminCredentials` is what `npm run db:admin-password` prints and what
 * `scripts/browser-sign-in.ts` types into the form, and both of them run on
 * machines that may never have been seeded. If it created a password the way its
 * sibling does, the caller would be handed a perfectly good-looking credential
 * for an account that does not exist — which reads as "the password is wrong"
 * rather than "run the seed", and then becomes the password the next seed sets.
 */
describe("readAdminCredentials", () => {
  /** Its own temp home each time, so no test can read another's file. */
  const home = () => mkdtempSync(path.join(tmpdir(), "read-admin-credentials-"));

  it("reads the seeded sign-in, and does not invent one", () => {
    const dir = home();
    const made = readOrCreateAdminPassword(dir);
    const found = readAdminCredentials(dir);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.password).toBe(made.password);
    expect(found.email).toBe(ADMIN_EMAIL_LOCAL);
    expect(found.path).toBe(adminPasswordPath(dir));
  });

  it("refuses an unseeded machine rather than creating a file", () => {
    const dir = home();
    const found = readAdminCredentials(dir);
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.why).toContain("npm run db:seed-owner");
    /* The claim, not the message: nothing was written. A refusal that left a
       password file behind would make the SECOND run succeed, against an account
       that still does not exist. */
    expect(existsSync(adminPasswordPath(dir))).toBe(false);
  });

  it("prefers the address this MACHINE recorded over this checkout's constant", () => {
    /* The bug this exists for: on 2026-09-02 the constant was renamed, and every
       checkout behind that commit went on typing the old address at a database
       that no longer had it. A checkout standing anywhere reads the same file. */
    const dir = home();
    readOrCreateAdminPassword(dir);
    writeAdminEmail(dir, "whatever-this-machine-actually-has@spideryarn.local");

    const found = readAdminCredentials(dir);

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.email).toBe("whatever-this-machine-actually-has@spideryarn.local");
    expect(found.email).not.toBe(ADMIN_EMAIL_LOCAL);
  });

  it("falls back to the constant on a machine seeded before the file existed", () => {
    const dir = home();
    readOrCreateAdminPassword(dir);
    /* No email file — every machine seeded before 2026-09-02. Old behaviour. */
    const found = readAdminCredentials(dir);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.email).toBe(ADMIN_EMAIL_LOCAL);
  });

  it("ignores a recorded value that is not an address", () => {
    const dir = home();
    readOrCreateAdminPassword(dir);
    writeFileSync(adminEmailPath(dir), "\n");
    const found = readAdminCredentials(dir);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.email).toBe(ADMIN_EMAIL_LOCAL);
  });

  it("keeps the recorded address readable only by its owner", () => {
    const dir = home();
    writeAdminEmail(dir, ADMIN_EMAIL_LOCAL);
    expect(statSync(adminEmailPath(dir)).mode & 0o777).toBe(0o600);
  });

  it("offers the checkout's constant as a second candidate when they differ", () => {
    /* The recorded address is a hint. If it is stale — a seed that renamed the
       row and could not write, or two seeds racing — the caller still has the
       constant to fall back on, so the file can never be worse than no file. */
    const dir = home();
    readOrCreateAdminPassword(dir);
    writeAdminEmail(dir, "recorded@spideryarn.local");

    const found = readAdminCredentials(dir);

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.email).toBe("recorded@spideryarn.local");
    expect(found.alsoTry).toBe(ADMIN_EMAIL_LOCAL);
  });

  it("offers no second candidate when the record agrees with the constant", () => {
    const dir = home();
    readOrCreateAdminPassword(dir);
    writeAdminEmail(dir, ADMIN_EMAIL_LOCAL);
    const found = readAdminCredentials(dir);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.alsoTry).toBeUndefined();
  });

  it("THROWS when it cannot record the address, rather than reporting success", () => {
    /* The failure that makes the file worse than the constant: the seed renames
       the row, cannot overwrite an older address here, swallows it, and every
       reader then prefers the stale one. Silent is the one thing this must not
       be. GPT Sol, finding 1. */
    const dir = home();
    const conf = path.join(dir, ".config", "spideryarn");
    mkdirSync(conf, { recursive: true });
    chmodSync(conf, 0o500);
    try {
      expect(() => writeAdminEmail(dir, ADMIN_EMAIL_LOCAL)).toThrow();
    } finally {
      chmodSync(conf, 0o700);
    }
  });

  it("ignores a torn half-written address", () => {
    const dir = home();
    readOrCreateAdminPassword(dir);
    writeFileSync(adminEmailPath(dir), "dev-admin@");
    const found = readAdminCredentials(dir);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.email).toBe(ADMIN_EMAIL_LOCAL);
  });

  it("refuses a truncated file, and still writes nothing", () => {
    const dir = home();
    const { path: file } = readOrCreateAdminPassword(dir);
    writeFileSync(file, "short");
    const found = readAdminCredentials(dir);
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.why).toContain("npm run db:seed-owner");
    expect(readFileSync(file, "utf8")).toBe("short");
  });
});

describe("refuseNonLocalSeed", () => {
  it("allows the local stack, however it is spelled", () => {
    for (const url of [
      "http://127.0.0.1:54361",
      "http://localhost:54361",
      "http://[::1]:54361",
      "https://localhost:54361/",
    ]) {
      expect(refuseNonLocalSeed(url, NOTHING_SET), url).toBeUndefined();
    }
  });

  it("refuses a real project", () => {
    expect(refuseNonLocalSeed("https://alschkahzfagtppxspfq.supabase.co", NOTHING_SET)).toMatch(
      /does not point at a local host/,
    );
  });

  it("refuses a host that only LOOKS local before the @", () => {
    /* The regex this replaced was
         /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/
       and this URL satisfies it — `localhost:8000` is userinfo, and the host is
       evil.example. A seed that believed it was local would have written a
       password that is in git into somebody else's project. */
    const sneaky = "http://localhost:8000@evil.example/";
    expect(/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(sneaky)).toBe(true);
    expect(refuseNonLocalSeed(sneaky, NOTHING_SET)).toMatch(/evil\.example/);
  });

  it("refuses when the process thinks it is production, whatever the URL says", () => {
    expect(refuseNonLocalSeed("http://127.0.0.1:54361", { NODE_ENV: "production" })).toMatch(
      /production/,
    );
    expect(refuseNonLocalSeed("http://127.0.0.1:54361", { VERCEL: "1" })).toMatch(/production/);
  });

  it("refuses an unset or unparseable URL rather than proceeding", () => {
    expect(refuseNonLocalSeed(undefined, NOTHING_SET)).toMatch(/SUPABASE_URL/);
    expect(refuseNonLocalSeed("not a url", NOTHING_SET)).toMatch(/not a URL/);
  });
});

/**
 * The bytes `supabase status -o env` really prints, on this stack, on
 * 2026-08-31 — noise lines and quoting included, values replaced.
 *
 * Written from a captured run rather than from what the flag ought to produce:
 * the values are double-quoted (which a naive parser keeps, so every comparison
 * then fails), and the CLI puts an update notice and a "Stopped services" line
 * in the same stream. A fixture that tidied either away would test a parser
 * against a format nothing emits.
 */
const REAL_STATUS = `Stopped services: [supabase_imgproxy_spideryarn2 supabase_pooler_spideryarn2]
ANON_KEY="anon-key-here"
API_URL="http://127.0.0.1:54361"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54362/postgres"
SERVICE_ROLE_KEY="service-key-here"
STUDIO_URL="http://127.0.0.1:54363"
A new version of Supabase CLI is available: v2.116.0 (currently installed v2.115.0)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started`;

const MINE = { url: "http://127.0.0.1:54361", serviceKey: "service-key-here" };

describe("parseStatusEnv", () => {
  it("unquotes the values and ignores the CLI's prose", () => {
    const env = parseStatusEnv(REAL_STATUS);
    expect(env.get("API_URL")).toBe("http://127.0.0.1:54361");
    expect(env.get("SERVICE_ROLE_KEY")).toBe("service-key-here");
    /* The two prose lines must contribute nothing. `A new version of…` is the
       one that looks most like a key. */
    expect([...env.keys()].sort()).toEqual([
      "ANON_KEY",
      "API_URL",
      "DB_URL",
      "SERVICE_ROLE_KEY",
      "STUDIO_URL",
    ]);
  });
});

describe("refuseMismatchedStack", () => {
  it("agrees when the URL and the key are the ones this repo's stack issues", () => {
    expect(refuseMismatchedStack(MINE, parseStatusEnv(REAL_STATUS))).toBeUndefined();
  });

  it("accepts the same loopback address spelled differently", () => {
    /* `refuseNonLocalSeed` accepts localhost and [::1]; the CLI always prints
       127.0.0.1. Comparing as strings would let an ordinary `.env.local` past
       the first gate and be refused by this one. GPT Sol, on the built code. */
    for (const url of ["http://localhost:54361", "http://[::1]:54361", "http://127.0.0.1:54361/"]) {
      expect(refuseMismatchedStack({ ...MINE, url }, parseStatusEnv(REAL_STATUS)), url).toBeUndefined();
    }
  });

  it("refuses a local address that is not this stack's", () => {
    /* 54341 is the OLD app's local Supabase, which really does run on this
       machine at the same time — docs/project/supabase-local.md § The ports. A
       hostname check cannot tell it from ours; this can. */
    const drifted = { ...MINE, url: "http://127.0.0.1:54341" };
    expect(refuseMismatchedStack(drifted, parseStatusEnv(REAL_STATUS))).toMatch(/54341/);
  });

  it("refuses the right address with a credential from somewhere else", () => {
    /* The tunnel case: 127.0.0.1:54361 forwarded to a cloud project, with that
       project's service key in .env.local. Every hostname check in the run says
       local, and the key is what gives it away — a real project's keys are its
       own, where every default *local* stack shares the CLI's demo string. So
       this comparison separates local from cloud, and the address comparison
       above separates local from local. */
    const tunnelled = { ...MINE, serviceKey: "some-other-projects-service-key" };
    const refusal = refuseMismatchedStack(tunnelled, parseStatusEnv(REAL_STATUS));
    expect(refusal).toMatch(/not the key this repo's local stack issues/);
    /* And it must not print either key while saying so. */
    expect(refusal).not.toContain("some-other-projects-service-key");
    expect(refusal).not.toContain("service-key-here");
  });

  it("refuses rather than falls back when the CLI said nothing useful", () => {
    expect(refuseMismatchedStack(MINE, parseStatusEnv("Cannot connect to the Docker daemon"))).toMatch(
      /could not read the local stack/,
    );
  });
});

/**
 * The highest-consequence decision in this change: may the seed overwrite the
 * password?
 *
 * Only `"wrong"` lets it write, and writing revokes every open session for that
 * account. So the interesting cases are all the ways a reply can *look* like a
 * bad password without being a verdict on one.
 */
describe("readPasswordVerdict", () => {
  const sb = (code: string) => JSON.stringify({ code: 400, error_code: code, msg: "…" });

  it("calls a genuinely wrong password wrong, from the header or the body", () => {
    /* Measured on GoTrue v2.195.0, 2026-08-31: a wrong password, an account with
       no password at all, and an address nobody holds are all this. */
    expect(readPasswordVerdict(400, "invalid_credentials", "").verdict).toBe("wrong");
    expect(readPasswordVerdict(400, null, sb("invalid_credentials")).verdict).toBe("wrong");
  });

  it("refuses to call the rate limit a wrong password", () => {
    /* The realistic one. `sign_in_sign_ups = 30` per five minutes in
       supabase/config.toml, and the limiter answers before the password handler
       runs — so a run during a busy test suite could otherwise sign Greg out
       over a password that was already right. */
    const rate = readPasswordVerdict(429, "over_request_rate_limit", "");
    expect(rate.verdict).toBe("unknown");
    expect(rate.errorCode).toBe("over_request_rate_limit");
  });

  it("refuses every other way a reply can fail", () => {
    for (const [status, header, body] of [
      [400, "user_banned", ""],
      [401, null, ""],
      [500, null, "<html>502 Bad Gateway</html>"],
      [503, null, ""],
      /* The right code on a status we did not expect is not a verdict either —
         both halves are required, so neither can carry the decision alone. */
      [200, "invalid_credentials", ""],
      [500, "invalid_credentials", ""],
    ] as [number, string | null, string][]) {
      expect(readPasswordVerdict(status, header, body).verdict, `${status} ${header}`).toBe("unknown");
    }
  });

  it("prefers the header, and does not read a body that is not JSON", () => {
    expect(readPasswordVerdict(400, "user_banned", sb("invalid_credentials")).verdict).toBe("unknown");
    expect(readPasswordVerdict(400, null, "not json at all").verdict).toBe("unknown");
  });
});

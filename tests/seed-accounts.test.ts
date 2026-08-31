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

import { ADMIN_EMAIL, ADMIN_USER_ID_LOCAL, isAdmin } from "../src/admin.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import { mkdtempSync, chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  SEEDED_ACCOUNTS,
  adminPasswordPath,
  newAdminPassword,
  passwordFileIsUsable,
  readOrCreateAdminPassword,
  parseStatusEnv,
  readPasswordVerdict,
  refuseMismatchedStack,
  refuseNonLocalSeed,
} from "../scripts/seed-accounts.js";

const NOTHING_SET = {} as Record<string, string | undefined>;

describe("what gets seeded", () => {
  it("seeds an account the admin gate actually recognises", () => {
    const admin = SEEDED_ACCOUNTS.find((a) => a.email === ADMIN_EMAIL);
    expect(admin).toBeDefined();
    expect(admin?.id).toBe(ADMIN_USER_ID_LOCAL);
    /* The claim that matters: not "the constant equals itself" but "the gate
       says yes to what the seed writes". */
    expect(isAdmin(admin?.id)).toBe(true);
  });

  it("expects a sign-in for the administrator and none for the row-owner", () => {
    const admin = SEEDED_ACCOUNTS.find((a) => a.email === ADMIN_EMAIL);
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

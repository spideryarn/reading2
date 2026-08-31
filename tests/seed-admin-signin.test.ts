/**
 * The seeded administrator can actually sign in, and is actually the administrator.
 *
 * ## Why this is not covered by the tests either side of it
 *
 * `tests/admin.test.ts` asks whether `isAdmin` says yes to a constant.
 * `tests/routes.test.ts` drives `/api/admin/*` with `acceptAny`, a verifier that
 * says yes to the string `test-token`. Both are green on a machine where nobody
 * can sign in at all, because **neither of them ever mints a real token**. The
 * value that crosses the seam — a JWT issued by GoTrue for the account
 * `scripts/db-seed-owner.ts` writes — is exercised by nothing.
 *
 * That seam has three joints and each can break on its own:
 *
 * 1. GoTrue will issue a token for the seeded email and password at all — which
 *    is not obvious, because on Greg's laptop that row was made by a Google
 *    sign-in and its only identity is `google`.
 * 2. `verifyWithSupabase` accepts it, against the live JWKS.
 * 3. The `sub` in it is an id `src/admin.ts` recognises, so `/api/admin/*`
 *    answers 200 rather than 403.
 *
 * Break any one and the symptom is Greg signing in on the Hetzner box and being
 * shown the shelf, which is the silent lockout
 * docs/postmortems/260828f-admin-id-was-the-local-one.md is about.
 * docs/plans/260831ab-seed-local-admin-user-for-remote-box.md.
 *
 * ## The skip, and the one thing that is a failure rather than a skip
 *
 * No Supabase, or an unseeded database, is a machine that has not been set up —
 * it skips, loudly, naming the command. But **an account that exists and cannot
 * be signed in as is a red**, not a skip: that is precisely the regression this
 * file is for, and letting it opt itself out would be the shape
 * docs/reusable/silent-success.md warns about.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

import { describe, expect, it } from "vitest";

import { ADMIN_USER_ID_LOCAL, isAdmin } from "../src/admin.js";
import { verifyWithSupabase } from "../src/auth.js";
import { loadEnvLocal } from "../src/env.js";
import { handleApi } from "../src/routes.js";
import { adminPasswordPath, passwordFileIsUsable, SEEDED_ACCOUNTS } from "../scripts/seed-accounts.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const ADMIN = SEEDED_ACCOUNTS.find((a) => a.id === ADMIN_USER_ID_LOCAL);

/**
 * This machine's administrator password — **read, never created.**
 *
 * The seed's own helper would make one, and a test that generated a password
 * would then be asking whether a credential it had just invented works, which it
 * cannot. An absent file means this machine has not been seeded, and that is a
 * skip with the command in it.
 */
function seededPassword(): string | undefined {
  const file = adminPasswordPath(homedir());
  if (!existsSync(file)) return undefined;
  const contents = readFileSync(file, "utf8");
  return passwordFileIsUsable(contents) ? contents.trim() : undefined;
}

/** The auth half of the probe: is there a stack, and has it been seeded? */
async function authReady(): Promise<{ ready: boolean; why: string }> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { ready: false, why: "no SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY" };
  if (!seededPassword()) {
    return { ready: false, why: "no local admin password on this machine. Run: npm run db:seed-owner" };
  }
  try {
    const health = await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(10_000) });
    if (!health.ok) return { ready: false, why: `GoTrue answered ${health.status}. Run: npm run db:start` };
    const who = await fetch(`${url}/auth/v1/admin/users/${ADMIN_USER_ID_LOCAL}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (who.status === 404) {
      return { ready: false, why: "the administrator is not seeded. Run: npm run db:seed-owner" };
    }
    if (!who.ok) return { ready: false, why: `admin lookup answered ${who.status}` };
  } catch {
    return { ready: false, why: "nothing answered on SUPABASE_URL. Run: npm run db:start" };
  }
  return { ready: true, why: "" };
}

const auth = await authReady();
/* stderr, not console.warn: vitest's console interception swallows a warning
   made at module load by a file whose tests then all skip — the whole reason
   tests/helpers/pg-ready.ts writes to stderr. */
if (!auth.ready && process.env.SUPABASE_URL) {
  process.stderr.write(`tests/seed-admin-signin.test.ts skipped: ${auth.why}\n`);
}

/* The route half needs the database too, because /api/admin/users counts rows. */
const { reachable } = await pgReady({
  suite: "tests/seed-admin-signin.test.ts",
  tables: ["spideryarn.articles"],
});

const liveIt = it.skipIf(!auth.ready);

/**
 * The route cases need the database. They do **not** need the Postgres store,
 * and requiring it was a mistake worth naming.
 *
 * `/api/admin/users` answers 501 on the filesystem store — `adminOnFiles` in
 * src/store/index.ts refuses rather than returning an empty list, deliberately.
 * The first version of this file therefore skipped the route cases unless
 * `SPIDERYARN_STORE=postgres`, which meant that under a plain `npm test` the
 * real token never crossed the real gate at all: the one joint this file exists
 * for was the one it did not test. GPT Sol, on the built code, 2026-08-31.
 *
 * A 501 is *past* the gate — reaching `adminOnFiles` at all means the admin
 * check said yes — so it is the right assertion to make there. What the store
 * changes is only which success looks like success.
 */
const onPostgres = process.env.SPIDERYARN_STORE === "postgres";
const expectedForAdmin = onPostgres ? 200 : 501;
const routeIt = it.skipIf(!auth.ready || !reachable);

/* Three network round trips against a stack the whole suite is hammering. Same
   reasoning as tests/admin-store.test.ts: five seconds here is a load test. */
const SLOW = 20_000;

/** Sign in the way the browser does — the anon key, the password grant. */
async function signIn(): Promise<{ status: number; token: string | undefined }> {
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    /* The real file on THIS machine, because that is the claim: the account the
       seed made here can be signed in as. The probe above has already checked it
       is there, so this is a read. */
    body: JSON.stringify({ email: ADMIN?.email, password: seededPassword() }),
  });
  if (!response.ok) return { status: response.status, token: undefined };
  const body = (await response.json()) as { access_token?: string };
  return { status: response.status, token: body.access_token };
}

/**
 * `GET /api/admin/users` through `handleApi` **with no verifier argument** —
 * the real one. That is the point of these cases: every other admin route test
 * injects `acceptAny`, which is why none of them can see this.
 */
async function adminUsers(token: string | undefined): Promise<{ status: number; text: string }> {
  const req = Object.assign((async function* () {})(), {
    method: "GET",
    url: "/api/admin/users",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  const handled = await handleApi(req, res);
  if (!handled) throw new Error("handleApi did not claim /api/admin/users");
  return { status, text };
}

describe("the seeded administrator", () => {
  liveIt(
    "can sign in with the password db:seed-owner sets",
    async () => {
      const { status, token } = await signIn();
      expect(status).toBe(200);
      expect(token).toBeTruthy();
    },
    SLOW,
  );

  liveIt(
    "gets a token the real verifier accepts, for an id the admin gate recognises",
    async () => {
      const { token } = await signIn();
      const verdict = await verifyWithSupabase(token ?? "");
      /* Asserted rather than narrowed with a cast: an `unavailable` verdict here
         means the JWKS was unreachable, and a cast would report that as a bad
         token. */
      expect(verdict.ok).toBe(true);
      if (!verdict.ok) return;
      expect(verdict.claims.sub).toBe(ADMIN_USER_ID_LOCAL);
      expect(isAdmin(verdict.claims.sub)).toBe(true);
    },
    SLOW,
  );

  routeIt(
    `is let through /api/admin/users by the real gate (${onPostgres ? "200" : "501, on the filesystem store"})`,
    async () => {
      const { token } = await signIn();
      const { status, text } = await adminUsers(token);
      /* The body rides along in the assertion so a refusal says *which* refusal
         it was, rather than failing on a bare number. */
      expect({ status, text: text.slice(0, 200) }).toMatchObject({ status: expectedForAdmin });
    },
    SLOW,
  );

  /**
   * The control, and the case above means nothing without it.
   *
   * A route that had lost its gate entirely would answer that token 200 and
   * satisfy every assertion here. This is the same URL with no credential at
   * all: it must be refused, so the 200 next door is evidence about the token
   * rather than about a door standing open.
   */
  /**
   * The controls, and the case above means nothing without them.
   *
   * A route that had lost its gate entirely would answer that token and satisfy
   * every assertion here. Two refusals rather than one: no credential at all
   * proves the door is shut, and a **well-formed but bogus** bearer token proves
   * it is shut against arbitrary credentials rather than only against silence —
   * Sol's point, and it is a different claim.
   */
  routeIt(
    "and the same request with no token at all is refused",
    async () => {
      expect((await adminUsers(undefined)).status).toBe(401);
    },
    SLOW,
  );

  routeIt(
    "and a token that is not one of ours is refused",
    async () => {
      expect((await adminUsers("not.a.real.token")).status).toBe(401);
    },
    SLOW,
  );
});

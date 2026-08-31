/**
 * **The gate.** Who is making this request, and are they allowed to?
 *
 * One function, called once, at the top of `handleApi`'s `try` — see
 * src/routes.ts. Everything below it can assume a person.
 *
 * ## What this is for, which is not user accounts
 *
 * There is one user. The gate exists because **a public site plus online
 * ingest plus no login is an open proxy and an open wallet**: anyone can make
 * the server fetch an arbitrary URL, and anyone can spend `OPENROUTER_API_KEY`
 * two model calls at a time — the one key every paid call in the app is on
 * since 2026-08-27 (docs/project/ai-gateway.md). That is not hypothetical — on
 * 2026-08-26, before this file existed, an anonymous `POST /api/jobs` against
 * the production hostname returned 202 and created a running job. See
 * docs/plans/auth-ui-and-production.md.
 *
 * ## Why `getClaims` and not `getUser`, and never `getSession`
 *
 * Both projects sign tokens with **asymmetric ES256 keys**, so `getClaims`
 * verifies the signature locally against a cached JWKS — no network call per
 * request, and no second crypto library. `getUser` would be a round trip to
 * Supabase on every single API call. `getSession` reads storage and returns
 * whatever is in it *without checking a signature at all*; the SDK's own types
 * carry a security notice about it. It is a browser convenience and it has no
 * business on a server.
 *
 * And the one that is worse than all of them:
 *
 *     JSON.parse(atob(token.split(".")[1])).email      // ← never
 *
 * That gives you an email. It also gives an attacker any email they type,
 * because it decodes rather than verifies. `tests/auth.test.ts` signs a token
 * with a key we made up and asserts this file refuses it, which is the test
 * that would notice if someone ever wrote the line above.
 *
 * ## The publishable key, not the secret one
 *
 * `getClaims` needs no privilege — it fetches a public key set and does
 * arithmetic. Handing it the secret key would work, and would put a
 * database-bypassing credential into a code path that runs on every request,
 * for no benefit at all.
 *
 * ## Every message in here is fixed prose
 *
 * `logRequest` in src/routes.ts writes an error's message into a `reason`
 * field, and docs/project/logging.md is emphatic that redaction matches key
 * paths and never text. So nothing here interpolates the token, the header,
 * the SDK's own error, the `sub`, or the email address. A test asserts it.
 */

import type { IncomingMessage } from "node:http";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { log } from "./log.js";
import type { OwnerId } from "./owner.js";

/** Somebody Supabase will vouch for. */
export interface AuthedUser {
  id: OwnerId;
  email: string;
}

/**
 * **The mark that says "this came out of `requireUser`", and nothing else can
 * wear it.**
 *
 * A `unique symbol` in module scope, used **only as a type** — nothing writes it
 * as a property, and `verified` below says why the property version was not
 * enough. What it does is make `VerifiedUser` a type no other file can satisfy:
 * an object literal cannot be given this key, and `as` cannot conjure it.
 *
 * Added on 2026-08-28 for docs/plans/public-read-only-access.md, on GPT Sol's
 * answer 2. Making the authenticated dispatcher take a required `AuthedUser`
 * parameter — the obvious version — prevents *omission* and nothing else: any
 * `{ id, email }` satisfies it, so it does not encode the one fact that
 * matters, which is where the value came from.
 */
declare const VERIFIED_USER: unique symbol;

/**
 * **Provenance by identity, not by property**, and the difference is the whole
 * of GPT Sol's finding 1 on the built code, 2026-08-28.
 *
 * The first version added a symbol-keyed property and `assertVerifiedUser` read
 * it back. Reading a property asks *"does this answer yes"*, which is a much
 * weaker question than *"is this the object we made"* — and all three of Sol's
 * cases were run against the code here before this was changed:
 *
 * - a `Proxy` whose `get` trap returns `true` for any symbol key — **accepted**;
 * - `Object.create(realUser)`, inheriting the brand and then overwriting `id` —
 *   **accepted**, with the new id;
 * - a genuinely branded user whose `id` was reassigned after verification —
 *   **allowed**, because `defineProperty` locked the symbol and left `id`
 *   writable.
 *
 * The forged or altered id then reaches `setRequestOwner` in src/routes.ts,
 * which is the value every store read filters on.
 *
 * A `WeakSet` answers the right question: membership is object identity, so a
 * proxy is a different object, an heir is a different object, and neither can
 * be added because this set is not exported. `Object.freeze` closes the third
 * case, which no membership test could.
 *
 * ## What this defends against, honestly
 *
 * **The attacker is our own future code, not a stranger.** Nobody outside this
 * process can construct an object and hand it to a dispatcher, and no request
 * shape produces one. What this prevents is a refactor six months from now that
 * builds a user-shaped object for a test seam, a cache or a "system" caller and
 * passes it in — and a line that reassigns `user.id` between the gate and
 * `setRequestOwner`, which would be a one-character bug with the blast radius of
 * the whole isolation.
 *
 * A smaller claim than "unforgeable", and the honest one. It is also exactly
 * what the brand is for: the failure this codebase has actually had was not an
 * intruder, it was the gate proving a person existed and then throwing the
 * identity away.
 */
const verified = new WeakSet<object>();

/**
 * A user the gate produced, as opposed to one somebody built.
 *
 * This is the type `serveAuthenticatedApi` takes (src/routes.ts). The public
 * dispatcher runs before `requireUser` and therefore cannot produce one, so
 * "an authenticated route reached without authentication" stops being a rule
 * somebody has to keep and becomes a thing that does not typecheck.
 */
export type VerifiedUser = AuthedUser & {
  readonly [VERIFIED_USER]: true;
};

/**
 * **And the same check at runtime**, because the type alone is a compile-time
 * promise and this boundary is worth more than that.
 *
 * `as never`, `as any`, plain JavaScript, and a stale build all get past the
 * type. None of them gets past this. Sol asked for it by name, and the test it
 * makes possible — call the authenticated dispatcher with `undefined as never`
 * and watch it throw *before any handler or store spy runs* — is the whole
 * reason the split is worth doing rather than merely tidy.
 *
 * 500, not 401: nobody's credentials are in question. A caller reached the
 * authenticated dispatcher without going through the gate, which is a broken
 * invariant in our own code, and src/owner.ts raises exactly the same kind of
 * error for the same kind of reason.
 */
export function assertVerifiedUser(value: unknown): asserts value is VerifiedUser {
  if (value === null || typeof value !== "object" || !verified.has(value)) {
    throw Object.assign(
      new Error(
        "The authenticated API was dispatched with a user that did not come from " +
          "requireUser(). See src/auth.ts § VerifiedUser.",
      ),
      { status: 500 },
    );
  }
}

/**
 * Everything the gate needs to know about a token, or why not.
 *
 * A seam rather than a direct call, because six test files drive `handleApi`
 * with hand-built requests and none of them can mint a real ES256 token
 * without a running Supabase. They hand this in instead and go on being about
 * routes. The default is the real one, so forgetting to inject cannot make a
 * production build permissive.
 */
export type Verifier = (token: string) => Promise<VerifyResult>;

export type VerifyResult =
  | { ok: true; claims: { sub: string; email?: string; role?: string; is_anonymous?: boolean } }
  /** The token is bad. 401, and the reader should sign in again. */
  | { ok: false; kind: "bad-token" }
  /**
   * We could not find out whether the token is bad — the key set was
   * unreachable or unparseable.
   *
   * **503, not 401**, and the difference is not pedantry. A 401 tells a client
   * with a perfectly good session to throw it away and refresh, which cannot
   * help, and it reports our outage as their mistake. GPT Sol, 2026-08-26.
   */
  | { ok: false; kind: "unavailable" };

/** An error carrying the HTTP status it should be reported as. Mirrors src/routes.ts. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/** uuid-shaped, and nothing else will do for something that becomes an `OwnerId`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let client: SupabaseClient | null = null;

/**
 * The server-side Supabase client, made once.
 *
 * `persistSession: false` and `autoRefreshToken: false` because there is no
 * session here to persist — this client exists to verify other people's
 * tokens, and a server that quietly kept one user's session in module scope
 * would be a much worse bug than a missing one.
 */
function supabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  /* The publishable key if it is there, the legacy anon key if it is not. Both
     work; the fallback exists so that rotating the dashboard and deploying do
     not have to happen in the same minute. */
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    /* Fail closed and say which slot is empty. An auth module that starts up
       with no configuration and lets everyone through is the canonical
       fail-open; see docs/reusable/silent-success.md. */
    throw httpError(
      503,
      "Sign-in is not configured on this server. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

/**
 * The real verifier: check the signature and the expiry against the JWKS.
 *
 * Telling "bad token" from "cannot reach the key set" is the whole reason this
 * returns a shape rather than a boolean. The SDK reports both as an
 * `AuthError`, so the discrimination is on what kind — anything that smells of
 * the network or of a missing key set is `unavailable`.
 */
export const verifyWithSupabase: Verifier = async (token) => {
  let result: Awaited<ReturnType<SupabaseClient["auth"]["getClaims"]>>;
  try {
    result = await supabase().auth.getClaims(token);
  } catch (err) {
    /* A throw out of `getClaims` is not a verdict on the token — it is fetch
       failing, or JSON not parsing. Logged (never the token itself) because
       this one is ours to fix, and returned as `unavailable` so the reader is
       not told to sign in again over our outage. */
    log("auth").error({ err: (err as Error).name }, "could not reach the JWT key set");
    return { ok: false, kind: "unavailable" };
  }

  if (result.error || !result.data) {
    if (isUnavailable(result.error as { name: string; status?: number } | null)) {
      log("auth").error(
        { err: result.error?.name, status: (result.error as { status?: number })?.status },
        "could not verify against the JWT key set",
      );
      return { ok: false, kind: "unavailable" };
    }
    return { ok: false, kind: "bad-token" };
  }

  const claims = result.data.claims as VerifyResult extends { ok: true; claims: infer C }
    ? C
    : never;
  return { ok: true, claims };
};

/**
 * Is this error us failing, or the token being bad?
 *
 * **Classified by status, not by class name**, and the first version got this
 * wrong in a way that does not fail open but is still a bug. It mapped every
 * `AuthApiError` to "unavailable", and Supabase uses `AuthApiError` for **4xx
 * token failures too** — including the ones `getClaims` hits when it falls back
 * to `getUser`. So a genuinely bad token could come back 503.
 *
 * That still refuses the request. What it breaks is the client: a 503 does not
 * trigger `apiFetch`'s refresh-and-retry, and polling code sits there retrying
 * an error that will never clear instead of sending the reader to sign in
 * again. GPT Sol, 2026-08-27; confirmed by reading `AuthApiError`, which
 * carries a `status`.
 *
 * So: 5xx and anything with no status at all (a network throw, a DNS failure)
 * is ours. 4xx is the token's.
 */
function isUnavailable(error: { name: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  // Its whole purpose is to say "try again", so it never means a bad token.
  if (error.name === "AuthRetryableFetchError") return true;
  const status = error.status;
  /* No status is a fetch that never got an answer — our side, or the network
     between us and the key set. A verifier that could not run has not decided
     anything about the token. */
  if (typeof status !== "number") return true;
  return status >= 500;
}

/**
 * Is this signed-in person allowed in?
 *
 * **Today: yes, anyone Supabase will vouch for.** Greg, 2026-08-26, twice:
 *
 * > We can get rid of the allowlist once we've added authentication. I'll
 * > accept the risk
 *
 * A function rather than an inline `true` so that narrowing it later is an edit
 * here and nowhere else.
 *
 * **What that decision was made about was model spend**, and there is a second
 * consequence nobody had raised at the time: `currentOwnerId()` in src/owner.ts
 * is still process-wide and the reads do not filter by owner, so every admitted
 * person sees the *same* shelf rather than their own. That is written up in
 * docs/plans/auth-ui-and-production.md § The gate says who you are, and it is
 * Greg's call rather than this file's. Until he has made it, this stays as he
 * left it — and the one line that changes it is right here.
 */
function isAllowed(_claims: { sub: string; email: string }): boolean {
  return true;
}

/**
 * The person making this request, or a thrown `httpError`.
 *
 * Never returns a user it is not sure about, and has no branch that returns
 * `null` and lets the caller decide — a caller that forgets to check is the
 * exact bug this file exists to prevent.
 */
export async function requireUser(
  req: IncomingMessage,
  verify: Verifier = verifyWithSupabase,
): Promise<VerifiedUser> {
  const header = req.headers?.authorization ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw httpError(401, "You need to be signed in to do that. [auth-none]");
  }

  const result = await verify(token);

  if (!result.ok) {
    if (result.kind === "unavailable") {
      /* Not 401. See VerifyResult — telling a good session it is bad, because
         our key set was briefly unreachable, sends the reader round a refresh
         loop that cannot succeed. */
      throw httpError(
        503,
        "We couldn't check your sign-in just now. Try again in a moment. [auth-down]",
      );
    }
    throw httpError(401, "Your sign-in has expired or isn't valid. Sign in again. [auth-bad]");
  }

  const { claims } = result;

  /* **The claims are checked, not just the signature.** `getClaims` verifies
     the signature and the expiry and runtime-checks none of this, so "the
     signature checked out" is a strictly weaker statement than "this is one of
     our users, signed in as a person".

     `role` in particular: a legacy `anon` key is a validly signed JWT carrying
     `"role":"anon"` and no `sub`, and it is sitting in the browser bundle of
     every Supabase app in the world. It must not be a login. */
  if (
    typeof claims.sub !== "string" ||
    !UUID.test(claims.sub) ||
    claims.role !== "authenticated" ||
    claims.is_anonymous === true
  ) {
    throw httpError(401, "That sign-in isn't one we can use. Sign in again. [auth-claims]");
  }

  /* Every route downstream expects to be able to say who acted, and an identity
     with no address is not one we can use. */
  if (typeof claims.email !== "string" || claims.email === "") {
    throw httpError(401, "That account has no email address on it. [auth-noemail]");
  }

  const user: AuthedUser = { id: claims.sub as OwnerId, email: claims.email };

  if (!isAllowed({ sub: user.id, email: user.email })) {
    throw httpError(
      403,
      "Spideryarn is still in private beta, and this account isn't on the list yet. [auth-beta]",
    );
  }

  /* **Frozen first, then remembered, and both last.** Not at the top of the
     function and not on the claims: the whole content of the mark is
     "everything in this function said yes", so anywhere earlier would be a
     promise about a check that had not run yet.

     `freeze` before `add` reads in the right order but is not the load-bearing
     part — what is, is that both happen before the value escapes. A caller
     holding a reference is the only thing that could change `id` afterwards,
     and `setRequestOwner` is one frame away. */
  Object.freeze(user);
  verified.add(user);
  return user as VerifiedUser;
}

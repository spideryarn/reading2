/**
 * `GET /api/health` — what this deployment actually is, as opposed to what we
 * believe we configured. Called by src/vercel.ts; not a route in
 * src/routes.ts, because it reports on the *deployment* rather than on the
 * application, and it has to work when the application does not.
 *
 * ## Why this exists
 *
 * Everything it checks fails **quietly**, and none of it is visible from the
 * reading view:
 *
 * 1. **Which store is serving reads.** `SPIDERYARN_STORE` unset — or misspelt —
 *    means `files`, and on Vercel `files` means an empty shelf: a 200 with
 *    nothing in it, identical to a working site with no articles yet.
 * 2. **Whether TLS verifies the server.** `sslDecisionFor` degrades to
 *    `encrypted-unverified` when the CA certificate is not found. The
 *    connection still works and is still encrypted; it just stops checking who
 *    it is talking to.
 * 3. **Whether `req.url` survived Vercel's routing.** Every route in
 *    src/routes.ts is matched against it, and several against the query string
 *    too. If the platform ever rewrites the path, they all 404 at once and the
 *    cause appears in no application log.
 * 4. **Whether `DATABASE_URL` quietly overrode the TLS decision.** `pg`
 *    discards an explicit `ssl` object entirely if the connection string
 *    carries `sslmode`, `sslrootcert`, `sslcert` or `sslkey` — so the CA can be
 *    loaded, reported as verified here, and not used. GPT Sol found this in
 *    review, 2026-08-26.
 *
 * ## `ok` is deliberately hard to please
 *
 * An earlier version returned 200 whenever nothing threw, which meant it went
 * green with the wrong store, with unverified TLS, and with an empty database —
 * the three things it exists to catch. So anything in `warnings` fails it. A
 * health check that passes when the deployment is wrong is worse than no health
 * check, because it is the thing you point at to argue nothing is wrong.
 * docs/reusable/silent-success.md.
 *
 * It reports the *names* of environment variables that are set, never a value —
 * docs/project/logging.md.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { sslDecisionFor } from "./db/ssl.js";
import { STORE, listArticles } from "./store/index.js";

/** Set, or not. Values never appear — only whether the slot is filled. */
const EXPECTED = [
  "DATABASE_URL",
  "SPIDERYARN_STORE",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PGSSLROOTCERT",
  "NODEJS_HELPERS",
  "LOG_LEVEL",
] as const;

/**
 * The four `pg` reads out of a connection string that make it ignore the `ssl`
 * object handed to `new Pool` — see node-postgres, "Usage with connectionString".
 */
const SSL_URL_KEYS = ["sslmode", "sslrootcert", "sslcert", "sslkey"];

export async function health(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const warnings: string[] = [];

  const env: Record<string, boolean> = {};
  for (const name of EXPECTED) env[name] = Boolean(process.env[name]);

  const url = process.env.DATABASE_URL;

  /* Three answers, not two, and the middle one — encrypted but unverified — is
     the one worth seeing. `why` carries the path it looked for, which is the
     whole diagnosis when the certificate did not make it into the bundle. */
  let ssl: { mode: string; why: string } | { error: string };
  if (!url) {
    ssl = { error: "DATABASE_URL is not set" };
  } else {
    try {
      const decision = sslDecisionFor(url);
      ssl = { mode: decision.mode, why: decision.why };
      if (decision.mode !== "verified") {
        warnings.push(`TLS mode is ${decision.mode}, not verified: ${decision.why}`);
      }
    } catch (err) {
      ssl = { error: (err as Error).message };
    }

    /* Checked here rather than trusted, because this is the case where every
       other signal on this page says "verified" and the socket disagrees. */
    let query: URLSearchParams | undefined;
    try {
      query = new URL(url).searchParams;
    } catch {
      warnings.push("DATABASE_URL does not parse as a URL");
    }
    const overrides = SSL_URL_KEYS.filter((k) => query?.has(k));
    if (overrides.length) {
      warnings.push(
        `DATABASE_URL carries ${overrides.join(", ")} — pg will discard the CA loaded above`,
      );
    }
  }

  /* The real read path, not a `select 1`. A `select 1` proves the pool can
     connect, which is the half that was never in doubt; listing the shelf
     proves the schema is applied, the runtime role can see it, and the rows are
     there. Those are the three that are actually missing on a fresh project. */
  let store: { name: string; articles: number } | { name: string; error: string };
  try {
    const articles = await listArticles({ archived: false });
    store = { name: STORE, articles: articles.length };
    if (articles.length === 0) {
      warnings.push("the shelf is empty — nothing has been imported, or the query found nothing");
    }
  } catch (err) {
    store = { name: STORE, error: (err as Error).message };
  }

  if (STORE !== "postgres") {
    warnings.push(`SPIDERYARN_STORE is '${STORE}', so reads come from a filesystem this host has no durable copy of`);
  }

  const failed = "error" in store || "error" in ssl;
  const ok = !failed && warnings.length === 0;

  res.statusCode = ok ? 200 : 503;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(
    JSON.stringify(
      {
        ok,
        warnings,
        /* Echoed so that "did the path survive routing?" is answerable without
           a second deployment. Query string included: several routes in
           src/routes.ts match against the full url, so a query parameter the
           platform added on our behalf would 404 them. */
        sawUrl: req.url ?? null,
        node: process.version,
        region: process.env.VERCEL_REGION ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        store,
        ssl,
        env,
      },
      null,
      2,
    ),
  );
}

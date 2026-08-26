/**
 * `GET /api/health` — what this deployment actually is, as opposed to what we
 * believe we configured.
 *
 * The leading underscore keeps it out of Vercel's function detection: files in
 * `api/` whose names start with `_` are helpers, not endpoints. The endpoint is
 * `api/[...path].ts`, which calls this.
 *
 * ## Why this exists
 *
 * Three of the things that have to be true in production fail *quietly* rather
 * than loudly, and all three are invisible from the reading view:
 *
 * 1. **Which store is serving reads.** `SPIDERYARN_STORE` unset means `files`,
 *    and on Vercel `files` means an empty shelf — a 200 with nothing in it,
 *    identical to a working site with no articles yet. That is exactly the
 *    failure docs/reusable/silent-success.md is about.
 * 2. **Whether TLS verifies the server.** `sslDecisionFor` degrades to
 *    `encrypted-unverified` when the CA certificate is not in the bundle. The
 *    connection still works and is still encrypted; it just stops checking who
 *    it is talking to. Nothing errors, so nothing tells you.
 * 3. **Whether `req.url` survived Vercel's routing.** Everything in
 *    src/routes.ts routes on it. If the deployment ever starts rewriting paths,
 *    every route 404s at once and the cause is not in any application log.
 *
 * It reports the *names* of environment variables that are set, never a value —
 * see docs/project/logging.md on what must never leave this process.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { sslDecisionFor } from "../src/db/ssl.js";
import { STORE, listArticles } from "../src/store/index.js";

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
  "LOG_LEVEL",
] as const;

export async function health(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const env: Record<string, boolean> = {};
  for (const name of EXPECTED) env[name] = Boolean(process.env[name]);

  /* Reported as a mode string rather than a boolean because there are three
     answers, not two, and the middle one — encrypted but unverified — is the
     one worth seeing. `why` carries the path it looked for, which is the whole
     diagnosis when the certificate did not make it into the bundle. */
  let ssl: { mode: string; why: string } | { error: string };
  const url = process.env.DATABASE_URL;
  if (!url) {
    ssl = { error: "DATABASE_URL is not set" };
  } else {
    try {
      const decision = sslDecisionFor(url);
      ssl = { mode: decision.mode, why: decision.why };
    } catch (err) {
      ssl = { error: (err as Error).message };
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
  } catch (err) {
    store = { name: STORE, error: (err as Error).message };
  }

  const ok = "articles" in store && (!("error" in ssl) ? true : false);

  res.statusCode = ok ? 200 : 503;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(
    JSON.stringify(
      {
        ok,
        /* Echoed so that "did the path survive routing?" is answerable without
           a second deployment. See the header. */
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

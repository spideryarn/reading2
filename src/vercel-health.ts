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
 * 4. **Whether a request body survives the platform.** `readBody` in
 *    src/routes.ts consumes the raw stream with `for await (const chunk of req)`.
 *    Vercel's request helpers read the stream first and replay it through
 *    `req.on("data")` — *not* through the async iterator — so with helpers on,
 *    every POST body arrives empty and every route reports a missing field
 *    rather than an error. `NODEJS_HELPERS=0` turns the helpers off. GPT Sol
 *    found this in review, 2026-08-26; a POST to this endpoint is how you check
 *    it is still true after a platform change. See § POST below.
 * 5. **Whether `DATABASE_URL` quietly overrode the TLS decision.** `pg`
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
/**
 * How much of a body this probe will read from an unauthenticated caller.
 *
 * Generous for the thing it is for — the check is "did any bytes arrive at
 * all", and `{"hello":"world"}` is eighteen of them — and small enough that
 * nobody can use a public endpoint to make us hold memory. Deliberately its own
 * constant rather than an import of `MAX_BODY_BYTES` from src/routes.ts: this
 * file has to keep working when that module cannot even load.
 */
const MAX_PROBE_BYTES = 8 * 1024;

const SSL_URL_KEYS = ["sslmode", "sslrootcert", "sslcert", "sslkey"];

/**
 * `POST /api/health` — did the body get here?
 *
 * Deliberately the **same loop** `readBody` uses in src/routes.ts, not a
 * `req.body` lookup or a `data` listener. A check that reads the body a
 * different way from the code it is vouching for can pass while the real path
 * fails, which is the whole failure mode being checked for here.
 *
 *     curl -X POST .../api/health -d '{"hello":"world"}'
 *
 * `bytes: 0` on a request that had a body means the stream was consumed before
 * we got it — put `NODEJS_HELPERS=0` back.
 */
async function bodyCheck(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    /* Stop reading rather than throw: this endpoint's job is to report what
       arrived, and "more than we were willing to read" is a report. A throw
       here would be answered by src/vercel.ts's last-resort catch as a plain
       500, which says nothing. */
    if (size > MAX_PROBE_BYTES) {
      truncated = true;
      break;
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");

  let parsed = false;
  try {
    JSON.parse(raw);
    parsed = true;
  } catch {
    /* Not an error here. This endpoint reports what arrived; whether it was JSON
       is one of the things being reported. */
  }

  const declared = Number(req.headers["content-length"] ?? "0");
  const lost = declared > 0 && chunks.length === 0;

  res.statusCode = lost ? 503 : 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(
    JSON.stringify(
      {
        ok: !lost,
        bytes: raw.length,
        truncated,
        contentLength: declared,
        parsedAsJson: parsed,
        helpersDisabled: process.env.NODEJS_HELPERS === "0",
        ...(lost
          ? {
              problem:
                "The request declared a body and the stream yielded nothing. Something read it " +
                "before this handler did — set NODEJS_HELPERS=0 on the Vercel project.",
            }
          : {}),
      },
      null,
      2,
    ),
  );
}

export async function health(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    /* **This is the one route the gate does not cover**, because src/vercel.ts
       answers it before `handleApi` is ever called — a probe that reports on the
       deployment has to work when the application does not.
     *
     * Which makes what it does with a non-GET the whole of its attack surface,
     * and until 2026-08-27 that was: read the entire request body, from anyone,
     * with no cap. `MAX_BODY_BYTES` lives in src/routes.ts and is not in this
     * path, so
     *
     *     curl -X DELETE https://host/api/health --data-binary @something-huge
     *
     * was an unauthenticated request that read as much as anybody cared to
     * send. Found by GPT Sol reviewing the auth plan; it is not caused by the
     * gate, and it became the gate's business the moment we wrote down that
     * everything except health is covered.
     *
     * So: **POST only, capped, and every other method is 405.** The body probe
     * is a real diagnostic — it is how `NODEJS_HELPERS=0` gets verified after a
     * platform change — so it stays, narrowed to the one method that means
     * "here is a body". */
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD, POST");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ error: "Only GET, HEAD and POST are allowed here." }));
      return;
    }
    await bodyCheck(req, res);
    return;
  }

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

/**
 * `GET /api/health` — what this deployment actually is, as opposed to what we
 * believe we configured. Called by src/vercel.ts; not a route in
 * src/routes.ts, because it reports on the *deployment* rather than on the
 * application, and it has to work when the application does not.
 *
 * That independence is about src/routes.ts and the gate in front of it, not
 * about imports in general. The two errors this file catches are logged through
 * [src/log.ts](log.ts) like everything else in a request path — src/vercel.ts
 * imports the logger before it imports this module, so there is no case where
 * the logger is missing and this handler is running.
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

import { sql } from "drizzle-orm";

import { getDb } from "./db/client.js";
import { sslDecisionFor } from "./db/ssl.js";
import {
  ACTUAL_SCHEMA_SQL,
  compareSchema,
  declaredTables,
  driftWarnings,
  readActualSchema,
} from "./db/schema-drift.js";
import { errorFields, log } from "./log.js";
import { STORE, listArticles } from "./store/index.js";

/**
 * Compiled in by vite.api.config.ts. Not `process.env` — the whole value of a
 * stamp is that the running environment cannot change it after the fact.
 */
declare const __SPIDERYARN_BUILD_COMMIT__: string;
declare const __SPIDERYARN_BUILD_TIME__: string;
declare const __SPIDERYARN_BUILD_SOURCE__: string;
declare const __SPIDERYARN_BUILD_DEPLOYMENT__: string | null;

/**
 * What this artefact says about itself: the commit that compiled it, when, and
 * how it worked that out.
 *
 * **`typeof` rather than a plain read**, because there is no `define` outside
 * the API build — `npm run dev` mounts src/routes.ts directly and never loads
 * this module, but a test that imports it would otherwise die on a
 * `ReferenceError` rather than see the honest answer, which is that nothing
 * built it.
 *
 * ## Why a missing stamp is reported here and not warned about
 *
 * This file's own header says a boolean nobody reads is not a check. This is
 * the exception, and it is worth being explicit about why rather than letting
 * it look like the same mistake:
 *
 * **the reader is `scripts/deploy.ts`**, which compares this against the sha it
 * just pushed. That is a real assertion, and it is the only place the
 * comparison can be made, because this handler does not know what anybody
 * *intended* to deploy — only what it is. A handler that warned on `unknown`
 * would 503 every `vercel deploy` from a working directory, which is a
 * deliberate escape hatch (docs/project/deployment.md § From the working tree)
 * and produces no git metadata by construction. Failing the deployment you
 * meant to make, over a field describing how it was made, is worse than not
 * checking.
 */
const build = {
  commit: typeof __SPIDERYARN_BUILD_COMMIT__ === "string" ? __SPIDERYARN_BUILD_COMMIT__ : null,
  builtAt: typeof __SPIDERYARN_BUILD_TIME__ === "string" ? __SPIDERYARN_BUILD_TIME__ : null,
  source: typeof __SPIDERYARN_BUILD_SOURCE__ === "string" ? __SPIDERYARN_BUILD_SOURCE__ : null,
  /* The deployment this function was BUILT for, which is not the same as the
     one serving the request: a commit can be deployed twice, and every
     commit-based check passes over the wrong one of the two. */
  deploymentId:
    typeof __SPIDERYARN_BUILD_DEPLOYMENT__ === "string" ? __SPIDERYARN_BUILD_DEPLOYMENT__ : null,
};

/**
 * What this deployment needs, and what stops working without each one.
 *
 * **`breaks` is the half that makes this a check rather than a report.** Until
 * 2026-08-27 this was a flat list of names rendered to booleans, and nothing
 * ever compared one against anything: production ran for a day with
 * `SUPABASE_SERVICE_ROLE_KEY` unset while this endpoint answered
 * `{"ok":true,"warnings":[]}` and printed `"SUPABASE_SERVICE_ROLE_KEY": false`
 * in the same response. A boolean nobody reads is not a check, and this file's
 * own header is about exactly that mistake.
 *
 * `breaks: null` means one of two things — nothing needs it (`LOG_LEVEL` has a
 * default in src/log.ts), or **something else in this handler already says it
 * better**: a missing `DATABASE_URL` is reported by the `ssl` block with its
 * reason attached, and a missing `PGSSLROOTCERT` surfaces as `TLS mode is …,
 * not verified`, which is truer, since the certificate can also be present and
 * unused. Warning twice about one fault trains whoever reads the list to skim
 * it, and then the next real line gets skimmed too.
 *
 * Three things GPT Sol's review of the first version of this table caught,
 * each of which made it lie in one direction or the other:
 *
 *  - **`or` exists because a required *need* is not always a required *name*.**
 *    src/auth.ts takes `SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_ANON_KEY` — either
 *    works, and the fallback is deliberate so that rotating the key and
 *    deploying need not happen in the same minute. Demanding the anon key by
 *    name would 503 a deployment whose sign-in works perfectly.
 *  - **`valid` exists because presence is not correctness.** `NODEJS_HELPERS`
 *    has to be the exact string `0`; set to `1`, request bodies arrive empty
 *    and every other line here still reads green. The first version of this
 *    table called it "a platform flag no code in this repo reads", which is
 *    true and beside the point — the platform reads it.
 *  - **The consequences were wrong the first time, and then went wrong again**,
 *    which is the point: a wrong consequence is worse than none, because it
 *    sends you to the wrong file. This pair said `ANTHROPIC_API_KEY` was the
 *    *pipeline* and `OPENROUTER_API_KEY` was everything reader-facing. True when
 *    written; false from 2026-08-27, when the pipeline moved onto OpenRouter
 *    (docs/project/ai-gateway.md). Left unfixed it would have warned about a key
 *    nothing reads, and — worse — told somebody staring at a dead ingest queue
 *    that the missing `OPENROUTER_API_KEY` only affected the reading view.
 *    **A `breaks` clause is a claim about other code, so it goes stale silently
 *    when that code moves.** Nothing here can notice; only a person can.
 */
interface Expected {
  /** Always reported in `env`, warned about only when `breaks` is set. */
  name: string;
  /** A second name that satisfies the same need. Reported too; either suffices. */
  or?: string;
  /** What stops working without it, as a clause. `null` to report only. */
  breaks: string | null;
  /** Set when the value itself has to be right, not merely present. */
  valid?: { ok(value: string): boolean; must: string };
  /** `vercel` for platform settings that mean nothing on a laptop. */
  where?: "vercel";
}

const EXPECTED: readonly Expected[] = [
  { name: "DATABASE_URL", breaks: null },
  /* Not because nothing needs it, but because the refusal is already louder
     than a warning here could be: src/store/index.ts throws at *import* when a
     filesystem store is live in production, and this module imports it — so a
     wrong `SPIDERYARN_STORE` means `health()` never runs at all rather than
     running and complaining. The `STORE !== "postgres"` warning further down
     is therefore a local-development signal, not a production one. The first
     version of this comment claimed that warning covered the production case;
     it cannot. GPT Sol's review, 2026-08-27. */
  { name: "SPIDERYARN_STORE", breaks: null },
  /* **`ANTHROPIC_API_KEY` was here until 2026-08-31, and it is gone rather than
     demoted.** It went `breaks: null` on 2026-08-27, when the seven pipeline
     stages moved onto OpenRouter's Anthropic-compatible endpoint
     (docs/project/ai-gateway.md), and the comment then said it was still worth
     *seeing* in the report while `.env.example` carried it.

     That is no longer true of a *deployment*. The last thing in the repo that
     wants the key is one eval — the PDF bake-off's transport arms, which
     compare Anthropic-direct against OpenRouter and are the reason the key
     exists at all — and an eval runs on a laptop. So the report was offering a
     production operator a name they cannot use and cannot need, one line above
     the key that really does break everything, which is the mistake this list's
     own header is about. The pair below is still the worked example of why a
     `breaks` clause goes stale silently; the fix the second time was to stop
     making the claim. `tests/health.test.ts` pins the absence. */
  {
    name: "OPENROUTER_API_KEY",
    breaks:
      "every model call in the app fails — the whole pipeline, so nothing can be ingested or re-extracted, and explain, chat, search, PDF reading and embeddings for anyone already reading",
  },
  { name: "SUPABASE_URL", breaks: "sign-in, and the bucket raw source bytes are written to" },
  {
    name: "SUPABASE_PUBLISHABLE_KEY",
    or: "SUPABASE_ANON_KEY",
    breaks: "sign-in is refused for everybody — src/auth.ts fails closed",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    /* Both halves, because the first is the one somebody reports and the second
       is the one that loses data. src/store/blobs.ts `configured()` gates both:
       `uploadGrants()` returns null and the upload is refused, and `blobStore()`
       falls back to `fsBlobs()` — a serverless filesystem that does not outlive
       the request. Only the first of those says anything at all. */
    breaks:
      "PDF upload is refused, and raw source bytes fall back to a disk this host does not keep",
  },
  {
    /* Baked into the client bundle at build time, so reading it here proves
       less than it looks like it does — see the note in `health` below. Absent
       is still conclusive, and absent is the case that has actually happened. */
    name: "VITE_SUPABASE_URL",
    breaks: "the reading view throws at module load — a blank page, while every line here stays green",
  },
  {
    name: "VITE_SUPABASE_PUBLISHABLE_KEY",
    breaks: "the reading view throws at module load — a blank page, while every line here stays green",
  },
  { name: "PGSSLROOTCERT", breaks: null },
  {
    name: "NODEJS_HELPERS",
    where: "vercel",
    valid: { ok: (v) => v === "0", must: 'be exactly "0"' },
    breaks: "request bodies arrive empty, and only POST /api/health notices",
  },
  { name: "LOG_LEVEL", breaks: null },
];

/**
 * Which variables are set, and a warning for each one that is needed and is not.
 *
 * Its own function rather than a block inside `health` because `health` was
 * already at the edge of the complexity budget and this pushed it over — but
 * also because the two are asking different questions. `health` asks "is this
 * deployment serving reads"; this asks "is it configured to do the things it
 * claims". They fail independently and one is worth reading without the other.
 *
 * Appends to `warnings` rather than returning them, so that the ordering in
 * the response follows the order the checks are written in.
 */
function checkEnv(warnings: string[]): Record<string, boolean> {
  /* Reported for all of them; warned about only for the ones with a `breaks`.
     Every missing one is named rather than stopping at the first, because these
     get fixed in a dashboard one at a time and a second deployment to discover
     the second missing variable is the avoidable half of the cost.

     **The two `VITE_` names are the weakest lines here and are worth reading as
     such.** They are compiled into the client bundle at build time, so what
     this sees is the *current project setting*, not what the running bundle was
     built with — add them and never redeploy, and this goes green over a blank
     page. Absent is still conclusive and absent is the case that has actually
     happened, so the check earns its place; it just cannot be leant on the way
     the server-side ones can. A build-stamped sentinel is the real answer.
     GPT Sol's review, 2026-08-27. */
  const env: Record<string, boolean> = {};
  for (const expected of EXPECTED) {
    const names = expected.or ? [expected.name, expected.or] : [expected.name];
    for (const name of names) env[name] = value(name) !== null;

    if (!expected.breaks) continue;
    if (expected.where === "vercel" && !process.env.VERCEL) continue;

    const found = names.map(value).find((v) => v !== null);
    if (found === undefined) {
      warnings.push(`${names.join(" or ")} is not set — ${expected.breaks}`);
    } else if (expected.valid && !expected.valid.ok(found)) {
      /* The value is never echoed. That it is wrong, and what it has to be, is
         the whole diagnosis; the value itself may be a secret. */
      warnings.push(`${expected.name} must ${expected.valid.must} — ${expected.breaks}`);
    }
  }

  return env;}

/**
 * A variable's value, or `null` if it is absent or blank.
 *
 * **Trimmed, because `" "` is not a credential.** `Boolean(process.env[name])`
 * treats a single space as configured, and so does `configured()` in
 * src/store/blobs.ts — so a stray space in a dashboard field would take this
 * endpoint green while every Supabase call failed on an invalid key. It does
 * not catch the literal strings `"undefined"` or `"false"`, which are a real
 * shape of this mistake and which nothing here can distinguish from a secret;
 * see the note on that in docs/project/deployment.md.
 */
function value(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

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

/**
 * How long a store check is reused for. Long enough that a loop of requests
 * costs one query; short enough that somebody watching a deploy is not
 * confused by a stale answer.
 */
const CACHE_MS = 30_000;

type StoreCheck = { name: string; articles: number } | { name: string; error: string };

let cached: { at: number; value: StoreCheck; warnings: string[] } | null = null;

/**
 * The check that is currently running, so that concurrent callers wait on it
 * rather than each starting their own.
 *
 * **The cache alone does not stop the flood it was written to stop.** It is
 * written *after* `await listArticles()`, so a hundred requests arriving
 * together on a cold cache all see `null`, all start the expensive query, and
 * the cache is set a hundred times — the amplifier the cache exists to remove,
 * fully intact. The test that vouched for it awaited three requests one after
 * another, which is the one arrival pattern that cannot show the bug.
 *
 * Found by GPT Sol's review, 2026-08-27. Cleared in a `finally` so a rejection
 * cannot wedge every later request onto one failed promise.
 */
let inFlight: Promise<StoreCheck> | null = null;

/**
 * The store check, at most once every `CACHE_MS`.
 *
 * The warnings it produced are cached with it — recomputing them from a cached
 * value would be a second place that has to agree with the first about what an
 * empty shelf means.
 */
async function cachedStoreCheck(warnings: string[]): Promise<StoreCheck> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) {
    warnings.push(...cached.warnings);
    return cached.value;
  }

  /* Someone else is already asking. Wait for their answer and take their
     warnings, rather than starting a second identical query. */
  if (inFlight) {
    const value = await inFlight;
    warnings.push(...(cached?.warnings ?? []));
    return value;
  }

  const mine: string[] = [];
  const run = async (): Promise<StoreCheck> => {
  let value: StoreCheck;
  try {
    const articles = await listArticles({ archived: false });
    value = { name: STORE, articles: articles.length };
    if (articles.length === 0) {
      mine.push("the shelf is empty — nothing has been imported, or the query found nothing");
    }
  } catch (err) {
    /* The whole error to the log, a bounded amount to the caller. This endpoint
       is unauthenticated and a driver's message can name a role or a host —
       and at the same time it is the *only* diagnostic a broken deployment has,
       so removing it entirely would be trading a real tool for a small
       exposure. Truncated rather than hidden, with the full text one
       `vercel logs` away.

       The error object goes in whole rather than a `message` string, so that
       `safeError` in src/log.ts decides what of it is safe to write down —
       stack and an allowlist of properties, and nothing a future error class
       decides to carry. Pulling `.message` out here would put it in a place
       redaction can never reach (logging.md, rule 3). */
    const message = (err as Error).message ?? "";
    log("health").error(errorFields(err), "store check failed");
    value = { name: STORE, error: message.slice(0, 200) };
  }

  cached = { at: Date.now(), value, warnings: mine };
  return value;
  };

  inFlight = run();
  try {
    const value = await inFlight;
    warnings.push(...mine);
    return value;
  } finally {
    inFlight = null;
  }
}

/* ------------------------------------------------------------------ */
/* Schema drift                                                        */
/* ------------------------------------------------------------------ */

type SchemaCheck =
  | {
      tables: number;
      missing: string[];
      requiredExtra: string[];
      defaultLost: string[];
      nullabilityMismatch: string[];
    }
  | { error: string };

let schemaCached: { at: number; value: SchemaCheck; warnings: string[] } | null = null;
let schemaInFlight: Promise<SchemaCheck> | null = null;

/**
 * Does this database have the columns this build selects?
 *
 * **The last backstop, not the first listener.** By the time this speaks, the
 * deployment is already serving; the check that is supposed to stop a bad
 * deploy is `npm run db:check` in front of the build. This one exists for the
 * drift that arrives *without* a deploy — a migration applied by hand, a
 * restored snapshot, a revoked grant — and for saying plainly what the 500s
 * mean when the gate has been skipped. GPT Sol's review, findings 1 and 6.
 *
 * Cached and coalesced exactly like `cachedStoreCheck` above, and for the same
 * reason: this endpoint is public and unauthenticated, so any query behind it
 * is an amplifier unless a hundred simultaneous callers share one answer.
 *
 * A failure becomes `error`, never an empty column list — "the query did not
 * run" and "the database has no columns" must not arrive looking the same,
 * which is the whole of docs/reusable/silent-success.md.
 */
async function cachedSchemaCheck(warnings: string[]): Promise<SchemaCheck> {
  const now = Date.now();
  if (schemaCached && now - schemaCached.at < CACHE_MS) {
    warnings.push(...schemaCached.warnings);
    return schemaCached.value;
  }

  if (schemaInFlight) {
    const value = await schemaInFlight;
    warnings.push(...(schemaCached?.warnings ?? []));
    return value;
  }

  const mine: string[] = [];
  const run = async (): Promise<SchemaCheck> => {
    let value: SchemaCheck;
    try {
      const result = await getDb().execute(sql.raw(ACTUAL_SCHEMA_SQL));
      const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
      const report = compareSchema(declaredTables(), readActualSchema(rows));
      value = {
        tables: report.declaredTables,
        missing: report.missingOrInaccessible,
        requiredExtra: report.requiredButUndeclared,
        defaultLost: report.defaultLost,
        nullabilityMismatch: report.nullabilityMismatch,
      };
      mine.push(...driftWarnings(report));
    } catch (err) {
      /* Same bargain as the store check: the whole error object to the log, a
         bounded message to an unauthenticated caller. */
      const message = (err as Error).message ?? "";
      log("health").error(errorFields(err), "schema check failed");
      value = { error: message.slice(0, 200) };
    }
    schemaCached = { at: Date.now(), value, warnings: mine };
    return value;
  };

  schemaInFlight = run();
  try {
    const value = await schemaInFlight;
    warnings.push(...mine);
    return value;
  } finally {
    schemaInFlight = null;
  }
}

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
      /* **413, not a successful truncated report.** The first version broke out
         of the loop and answered 200 with `truncated: true`, which is a storage
         cap rather than a transport one: it still accepted the whole stream and
         it still told the sender they had succeeded. GPT Sol, 2026-08-27. */
      truncated = true;
      res.statusCode = 413;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(
        JSON.stringify({
          ok: false,
          error: `This probe reads at most ${MAX_PROBE_BYTES} bytes.`,
        }),
      );
      /* Stop reading. Whatever is still coming is the sender's problem now. */
      req.destroy();
      return;
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

  const env = checkEnv(warnings);

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
     there. Those are the three that are actually missing on a fresh project.

     **But it is behind a cache, because this endpoint is public.** `listArticles`
     is not one cheap query — src/store/pg.ts loads articles and revisions and
     then does per-article work — so an anonymous caller could ask for it in a
     loop and make us do an expanding amount of database work per request, HEAD
     included. Caching does not weaken the check: nothing this reports changes
     between one second and the next, and a deployment that has just been fixed
     is worth waiting `CACHE_MS` to see. GPT Sol, 2026-08-27. */
  const store = await cachedStoreCheck(warnings);

  if (STORE !== "postgres") {
    warnings.push(`SPIDERYARN_STORE is '${STORE}', so reads come from a filesystem this host has no durable copy of`);
  }

  /* Only when Postgres is actually serving reads. On a filesystem store there
     is no schema to drift, and `getDb()` would throw for want of a
     DATABASE_URL — an error that would read as drift rather than as "this
     deployment does not use a database". The `STORE` warning above already
     covers that case, and covers it better. */
  const schema = STORE === "postgres" ? await cachedSchemaCheck(warnings) : undefined;

  const failed = "error" in store || "error" in ssl || (schema !== undefined && "error" in schema);
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
        /* What Vercel believes it deployed, read at request time. Kept beside
           `build` rather than replaced by it: this one is the platform's
           opinion, `build` is the artefact's own, and they can differ. */
        commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        build,
        store,
        /* Absent rather than null on a filesystem store, so that "not checked"
           and "checked and found nothing" cannot be confused in the output. */
        ...(schema === undefined ? {} : { schema }),
        ssl,
        env,
      },
      null,
      2,
    ),
  );
}

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
 * 1. **Whether the store is answering, and with anything in it.** This point
 *    used to be about *which* store: `SPIDERYARN_STORE` unset — or misspelt —
 *    meant the filesystem one, and on Vercel that meant an empty shelf, a 200
 *    with nothing in it, indistinguishable from a working site with no articles
 *    yet. There has been one store since 2026-09-05 and no variable to misspell
 *    since 2026-09-06, so what is left is the second half of that failure: an
 *    empty shelf still looks exactly like a healthy new deployment, and
 *    `cachedStoreCheck` below is what warns about it.
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

import { expectedLivemode, isLiveSecret } from "./billing/stripe.js";
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
import {
  compareMigrations,
  migrationDigest,
  type AppliedMigration,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  type ExpectedMigration,
  type MigrationDigest,
} from "./migration-digest.js";
import { listArticles } from "./store/index.js";

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
  /**
   * Only required when this *other* variable is set — silent otherwise.
   *
   * For the half-configured case, which is the one that bites: a feature whose
   * absence is a legitimate deployment choice, but whose *partial* presence is
   * always a mistake. `breaks: null` cannot say this, because it is a statement
   * about absence being fine unconditionally.
   */
  with?: string;
}

const EXPECTED: readonly Expected[] = [
  { name: "DATABASE_URL", breaks: null },
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
  /**
   * **A second inference bill, and the only one no report can total.**
   *
   * `src/live.ts` needs it to mint a browser token for live conversation mode.
   * That call goes to OpenAI directly — OpenRouter has no realtime API to route
   * to — so it is a **separate account** from `OPENROUTER_API_KEY`, is **not**
   * covered by the spend cap set on the OpenRouter account, and `npm run cost`
   * cannot see a penny of it: the audio is a WebRTC connection from the reader's
   * browser and no row is ever written (`UNMETERED_SPEND` in
   * src/spend-declarations.ts).
   *
   * **`breaks: null`, so it is reported and not warned about.** Whether a
   * deployment wants live conversation is a product decision this file cannot
   * make, and a warning on every deployment that has not enabled it is the noise
   * this list's own header is about. What an operator gets is the name, beside
   * the other credentials, which is more than it had: until 2026-09-02 the one
   * key whose spend nothing can see was also the one key nothing wrote down —
   * not here, and not in `.env.example`.
   */
  { name: "OPENAI_API_KEY", breaks: null },
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
  /**
   * **Payments, and the one variable whose *presence* is the danger.**
   *
   * `breaks: null` because a deployment with no Stripe configured is a
   * perfectly good deployment — everyone stays on the free tier and nothing
   * else notices. What is never fine is a key from the *wrong mode*, so this
   * pair carries a `valid` clause, which is checked whether or not there is a
   * `breaks` (see `checkEnv`). A production deployment on `sk_test_…` would
   * accept card `4242…`, write `active` subscription rows and grant real quota
   * for money that does not exist, and every "is it set" check above would
   * stay green throughout. The prefix is the mode, so the value answers the
   * question — src/billing/stripe.ts, and the same reasoning guards the shared
   * dev box in scripts/gjd-remote-env.ts.
   */
  {
    name: "STRIPE_SECRET_KEY",
    breaks: null,
    valid: {
      ok: (v) => isLiveSecret(v) === expectedLivemode(),
      /* **One sentence covering both directions, because `must` is evaluated
         once at module load and `ok` is evaluated per request.** A message
         built from `expectedLivemode()` here would be frozen to whatever the
         environment was when this file was imported, and would then confidently
         name the wrong mode — which is worse than naming neither, since it
         sends an operator to change the variable that is already right. */
      must:
        "match this deployment's mode — sk_live_… in production, sk_test_… everywhere else. " +
        "A test key in production accepts test cards and grants real subscriptions",
    },
  },
  /**
   * **The other half of "Stripe is configured", and the half no script could
   * see.** `stripe:check` reads the Stripe account — endpoint registered,
   * enabled, subscribed to `HANDLED_EVENTS` — and is blind to whether the
   * *deployment* holds the secret to verify a delivery with. Until 2026-09-03
   * neither was set on production, and docs/project/billing.md names
   * `vercel env ls production` as the only instrument for that half. This makes
   * it something the deploy gate does.
   *
   * **`with`, because half-configured is the fault, not unconfigured.**
   * `STRIPE_SECRET_KEY` is `breaks: null` since a deployment with no Stripe is
   * a perfectly good deployment — everyone stays free. A secret key *and* no
   * webhook secret is nobody's deliberate choice.
   *
   * **What a green line here does not tell you.** Absence is conclusive;
   * presence is not. The likelier future fault is a secret that is present and
   * *wrong* — the endpoint recreated or rotated in the dashboard and Vercel
   * never updated — and then every delivery is a 400, entitlement stops
   * flowing exactly as it would have, and this reads green. Health cannot sign
   * a delivery, so it cannot check the value. The instrument for that class is
   * Stripe's side: the endpoint's recent delivery-failure count. Same caveat
   * as the two `VITE_` names above. Fable's review, 2026-09-04.
   */
  {
    name: "STRIPE_WEBHOOK_SECRET",
    with: "STRIPE_SECRET_KEY",
    breaks:
      "src/billing/webhook.ts refuses every Stripe delivery with 503 rather than skipping " +
      "verification, so a reader who closes the tab before returning from Checkout is never " +
      "granted what they paid for, cancellations and renewals land only when the next ingest " +
      "finds the period stale, and invoice.finalization_failed is never logged at all",
  },
  /* **No `STRIPE_PRICE_*` here, and its absence is deliberate.** It was
     reported until 2026-09-02, when tiers and their Stripe price ids moved into
     the `billing_tiers` table so they could be changed without a deploy
     (docs/project/billing.md). Reporting a variable nothing reads is the
     mistake this list's own header is about: it offers an operator a name they
     cannot use, one line above the key that really does matter. Whether the
     tiers are configured is a database question now, not an environment one. */

  /* ---------------------------------------------------------------- *
   * **The six below arrived together on 2026-09-07, from a sweep
   * rather than from an incident.**
   *
   * A one-off sweep walked every `process.env` and `import.meta.env` read
   * under `src/` and asked which were accounted for here. It resolved 50
   * distinct names — including ones reached through a `const`, a record,
   * a helper's call sites and an environment passed into a function — and
   * **36 were in neither this table nor any deliberate exclusion**, which
   * is the drift
   * docs/postmortems/260827b-health-check-green-while-uploads-dead.md is
   * about, measured rather than argued. Thirty were things a deployment
   * has no opinion about (platform variables, Vite build constants,
   * per-run model overrides); these six are the ones an operator staring
   * at a deployment would want to see.
   *
   * **There is no test holding this line, and that is the state of it.**
   * The check was built and twice refused in review — nine established
   * ways for a read to be silently skipped rather than refused, which in
   * a check whose whole job is not to fail open is disqualifying. So
   * these six entries are the *findings* of a sweep, not the output of a
   * gate, and the next name to arrive will drift exactly as the last one
   * did. The design that would hold it, the cheaper alternative of making
   * the reads literal instead, and the nine attacks any rebuild must go
   * red on first, are in
   * docs/plans/260907e-small-uncontested-postmortem-preventions-batch.md
   * § Stage 4.
   *
   * **Every one is `breaks: null`, and that is a rule rather than a
   * coincidence.** A `breaks` clause warns on a deployment that does not
   * set the variable, and none of these six was added because somebody
   * decided production requires it — they were added because a static
   * check found them unaccounted for. Promoting one is a judgement about
   * production and belongs to a person; `SPIDERYARN_OWNER_ID` below is
   * the standing candidate.
   * ---------------------------------------------------------------- */

  /**
   * **The postmortem's own named example — the drift it was written about.**
   *
   * `environmentOwnerId()` (src/owner.ts:271) *throws* without it when
   * `NODE_ENV === "production"` or `VERCEL` is set — there is no development
   * owner in production, and the alternative was an `auth.users` foreign key
   * violation three layers away from the actual fault.
   *
   * So this is the one entry here with a real case for a `breaks` clause, and
   * it does not have one yet on purpose: a sweep found it, and a sweep is not
   * entitled to decide that a deployment must warn. Worth promoting — the
   * consequence would be *"jobs written before articles carried an owner cannot
   * be listed, and every request that stamps one throws"*.
   */
  { name: "SPIDERYARN_OWNER_ID", breaks: null },
  /* **`SPIDERYARN_BASE_URL` was here for a few hours on 2026-09-07 and is
     not, and the reason is worth more than the entry was.** It is where
     Stripe returns a reader after Checkout, and the production table in
     docs/project/deployment.md lists it under "**must stay unset here**, and
     it is listed so nobody adds it" — production answers `PUBLIC_ORIGIN`
     before it reads any variable (src/billing/checkout.ts:150), and a preview
     falls back to `VERCEL_URL`. A line reporting a setting production is
     documented as forbidden to have is not neutral: it is an invitation to
     set it. It belongs to a developer's own machine, which is what it is.
     GPT Sol, F14. */
  /**
   * **The client bundle's error reporting** (src/web/monitoring.ts:72), and
   * the first thing in this table read through `import.meta.env` rather than
   * `process.env`.
   *
   * Compiled in at build time exactly like the two `VITE_SUPABASE_` names
   * above, with the same caveat: what this sees is the current project
   * setting, not what the running bundle was built with. Unset,
   * `initClientMonitoring()` returns without starting anything and nothing
   * anywhere says so — the same silence as the server's `SENTRY_DSN`, on the
   * half of the app the reader actually looks at.
   */
  { name: "VITE_SENTRY_DSN", breaks: null },
  /**
   * **What the client's Sentry events are labelled with**, falling back to
   * `import.meta.env.MODE` (src/web/monitoring.ts:79).
   *
   * **It looks platform-set and is not**, which is the only reason it is worth
   * a line. Vercel writes `VERCEL_ENV`; Vite exposes only names beginning
   * `VITE_`, and nothing here bridges the two — so a person has to set this on
   * the project or every client error from every deployment arrives labelled
   * with the build mode instead. Nothing else in the repo mentions it: this
   * entry is the only place it is written down.
   */
  { name: "VITE_VERCEL_ENV", breaks: null },
  /**
   * Error reporting (src/monitoring.ts:175). Unset, `initMonitoring()` returns
   * without starting anything and nothing anywhere says so — the failure is
   * silence, which is what makes it worth a line in a report.
   */
  { name: "SENTRY_DSN", breaks: null },
  /**
   * How many Postgres connections this process may hold (src/db/client.ts:97),
   * defaulting to 5. Reported because the failure mode of a wrong value is not
   * slowness here but *other instances* being refused a connection by the
   * shared pooler, which surfaces somewhere unrelated and reads as a database
   * fault.
   */
  { name: "DATABASE_POOL_MAX", breaks: null },
  /**
   * How many ingest jobs run at once (`jobConcurrency()`, src/jobs.ts),
   * defaulting to 3. A value that is not a positive whole number is ignored
   * rather than obeyed — `0` would stop every ingest in the account and read
   * exactly like the queue being wedged — so what an operator needs from this
   * line is whether anything is set at all.
   */
  { name: "SPIDERYARN_JOB_CONCURRENCY", breaks: null },
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

    const found = names.map(value).find((v) => v !== null);

    /* **A wrong value is warned about even where a missing one is not**, and
       the asymmetry is deliberate: `breaks: null` says "this deployment may
       legitimately not want this", which is a statement about *absence*. A
       variable somebody has actually set, to something this file knows is
       wrong, is nobody's deliberate choice. That distinction earns its keep on
       `STRIPE_SECRET_KEY`: a test-mode key on the production deployment takes
       test cards and grants real subscriptions, and it is *present*, so every
       check that asks "is it set" goes green over it
       (docs/reusable/silent-success.md). The value is never echoed — that it
       is wrong, and what it has to be, is the whole diagnosis. */
    if (found !== undefined && expected.valid && !expected.valid.ok(found)) {
      warnings.push(
        `${expected.name} must ${expected.valid.must}${expected.breaks ? ` — ${expected.breaks}` : ""}`,
      );
      continue;
    }

    if (!expected.breaks) continue;
    if (expected.where === "vercel" && !process.env.VERCEL) continue;
    /* Suppresses only the *absence* warning, exactly like `where` above — a
       companion that is itself unset means this whole feature is switched off,
       and a switched-off feature is not a broken deployment. The `env` map
       above still reports it either way, so it stays visible while silent. */
    if (expected.with && value(expected.with) === null) continue;
    if (found === undefined) warnings.push(`${names.join(" or ")} is not set — ${expected.breaks}`);
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
    value = { name: "postgres", articles: articles.length };
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
    value = { name: "postgres", error: message.slice(0, 200) };
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

/* ------------------------------------------------------------------ */
/* Migrations: what this build needs, and what the database has        */
/* ------------------------------------------------------------------ */

declare const __SPIDERYARN_EXPECTED_MIGRATIONS__: ExpectedMigration[];

/**
 * The migrations the commit that compiled this artefact expects to be applied.
 *
 * Same `typeof` guard and same reasoning as the build stamp above: there is no
 * `define` outside the API build, so in dev and under test this is empty and
 * every comparison below says "nothing expected" rather than throwing.
 */
const expectedMigrations: ExpectedMigration[] =
  typeof __SPIDERYARN_EXPECTED_MIGRATIONS__ === "undefined" ? [] : __SPIDERYARN_EXPECTED_MIGRATIONS__;

type MigrationCheck =
  /* The rows as well as their digest: the digest is what a caller compares
     cheaply, the rows are what `compareMigrations` needs to say which way the
     two sides differ. Computing the digest here keeps the cache holding one
     consistent pair rather than two things that could be derived apart. */
  { applied: MigrationDigest; appliedRows: AppliedMigration[] } | { error: string };

let migrationsCached: { at: number; value: MigrationCheck } | null = null;
let migrationsInFlight: Promise<MigrationCheck> | null = null;

/**
 * Read the migration ledger as the **app role**, so that anything with an HTTPS
 * client can compare a deployment's schema against its code.
 *
 * The point is what it does *not* need: no production database password, no
 * `postgres` role, no Supabase token. The remote box can therefore tell that it
 * must not push — see
 * docs/plans/260902a-remote-box-runs-production-migrations-without-a-human-in-the-loop.md
 * — while remaining completely unable to apply a migration.
 *
 * It needs two grants, and the second one alone is not enough:
 *
 *     grant usage on schema spideryarn_migrations to spideryarn_app;
 *     grant select on spideryarn_migrations.__drizzle_migrations to spideryarn_app;
 *
 * Without the `usage`, the answer is `permission denied for schema
 * spideryarn_migrations` — which `scripts/deploy-checks.ts` already records as
 * the correct answer to the wrong question, and which must land in `error`
 * rather than being read as an empty ledger. An empty ledger and an unreadable
 * one mean opposite things: the first says nothing has ever been applied.
 *
 * Cached and coalesced exactly like the two checks above it, because this
 * endpoint is public and unauthenticated.
 */
async function cachedMigrationCheck(): Promise<MigrationCheck> {
  const now = Date.now();
  if (migrationsCached && now - migrationsCached.at < CACHE_MS) return migrationsCached.value;
  if (migrationsInFlight) return migrationsInFlight;

  const run = async (): Promise<MigrationCheck> => {
    let value: MigrationCheck;
    try {
      const result = await getDb().execute(
        sql.raw(
          `select hash, created_at from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} order by created_at asc`,
        ),
      );
      const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
      const appliedRows = rows.map((r) => ({
        hash: String(r.hash),
        created_at: Number(r.created_at),
      }));
      value = { applied: migrationDigest(appliedRows), appliedRows };
    } catch (err) {
      const message = (err as Error).message ?? "";
      log("health").error(errorFields(err), "migration ledger check failed");
      value = { error: message.slice(0, 200) };
    }
    migrationsCached = { at: Date.now(), value };
    return value;
  };

  migrationsInFlight = run();
  try {
    return await migrationsInFlight;
  } finally {
    migrationsInFlight = null;
  }
}

export type MigrationReport =
  | { expected: MigrationDigest; error: string }
  | { expected: MigrationDigest; applied: MigrationDigest; missing: string[]; ahead: number };

/**
 * What this build needs, what the database has, and which way they differ.
 *
 * **Both directions are reported and only one of them warns**, which is the
 * detail that decides whether this check survives contact with a real deploy:
 *
 *  - `missing` — the build selects columns a migration was meant to create and
 *    the database has no record of it. Requests fail. This warns, and a warning
 *    is what makes this endpoint answer 503.
 *  - `ahead` — the database holds migrations this build has never heard of.
 *    **Normal, and silent.** `npm run deploy` migrates *before* it pushes, so
 *    for the minute between the migration landing and the new build going live,
 *    the deployment actually serving traffic is exactly this. A check that
 *    called it unhealthy would 503 a working site on every single deploy, and a
 *    check that cries wolf on every deploy gets turned off.
 *
 * `missing` carries **tags**, not hashes, because the database does not store
 * tags and a reader who is told only that something is out of step has to go to
 * a database they may not be able to reach. The build has the names; this is
 * the one place they can be joined.
 */
async function migrationReport(warnings: string[]): Promise<MigrationReport> {
  const expected = migrationDigest(expectedMigrations);
  const check = await cachedMigrationCheck();

  if ("error" in check) {
    /* Not silently an empty ledger. "Nothing has ever been applied" and "we are
       not allowed to look" are opposite facts, and the grant this needs is
       exactly the one likely to be absent — see cachedMigrationCheck. */
    warnings.push(`the migration ledger could not be read: ${check.error}`);
    return { expected, error: check.error };
  }

  const { missing, ahead } = compareMigrations(expectedMigrations, check.appliedRows);
  if (missing.length > 0) {
    warnings.push(
      `${missing.length} migration(s) this build needs are not applied: ${missing.map((m) => m.tag).join(", ")}`,
    );
  }
  return { expected, applied: check.applied, missing: missing.map((m) => m.tag), ahead };
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

  /* Unconditional since 2026-09-05. Both this and the migration report below
     used to be gated on `STORE === "postgres"`, and beside them was a warning
     saying reads were coming off a filesystem this host has no durable copy of.
     There is one store; all three went with the flag. */
  const schema = await cachedSchemaCheck(warnings);

  /**
   * **Reported in both directions, and only one of them is a fault.**
   *
   * `missing` — this build needs a migration the database has no record of — is
   * the state where requests fail, and it warns, which makes this endpoint 503.
   *
   * `ahead` is the opposite and is **normal**: `npm run deploy` applies
   * migrations before it pushes, so for the minute between the migration
   * landing and the new build going live, the deployment still serving traffic
   * is one whose code predates the newest row. Warning about that would 503 a
   * perfectly healthy site on every single deploy, which is how a check gets
   * ignored and then removed. It is reported as a number so it is visible, and
   * it is deliberately silent.
   */
  const migrations = await migrationReport(warnings);

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
        /* Same rule, and the field anything can read without a database
           credential to tell whether this deployment's code and its schema are
           in step. docs/plans/260902a-remote-box-runs-production-migrations-without-a-human-in-the-loop.md */
        ...(migrations === undefined ? {} : { migrations }),
        ssl,
        env,
      },
      null,
      2,
    ),
  );
}

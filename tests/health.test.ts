/**
 * `/api/health` — **the one route a stranger can reach**, so the only one whose
 * cost and whose candour are anybody's business but ours.
 *
 * GPT Sol's review of the built auth code, 2026-08-27, item 2:
 *
 * > The application handlers are gated, but `vercel.ts` handles `/api/health`
 * > before the gate. GET and HEAD call `listArticles()` … That is not a cheap
 * > health query … An anonymous caller can repeatedly cause an expanding N+1
 * > workload.
 *
 * and item 10, on the tests that existed at the time:
 *
 * > There are no health endpoint tests covering public cost, raw diagnostics,
 * > HEAD, method behavior or oversized bodies.
 *
 * There are now. Four properties, and each of them was a real hole rather than
 * a hypothetical: the store check is cached so a flood costs one query per
 * window; the body probe answers 413 rather than a cheerful truncated 200; a
 * verb nobody implemented is 405 rather than a surprise; and a database error
 * reaches the caller trimmed, with the full text going to the server's own log
 * where it belongs.
 *
 * ## What is deliberately not asserted
 *
 * That the endpoint is *fast*. It is allowed to be slow the first time — it
 * talks to Postgres. What it is not allowed to be is slow *every* time, which
 * is what the cache test is about, and that is a count of calls rather than a
 * clock. A timing assertion here would be flaky on a loaded laptop and would
 * teach whoever hit it to raise the number.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pgReady } from "./helpers/pg-ready.js";

/** What `listArticles` was asked, and how often. The whole point of the cache. */
const listArticles = vi.fn(async () => [] as unknown[]);

vi.mock("../src/store/index.js", () => ({
  listArticles,
  STORE: "postgres",
}));

/**
 * Every error line the handler wrote, so the other half of the trim — that the
 * operator still gets the whole thing — stays assertable.
 *
 * **Mocked rather than read off stdout, and that is not laziness.** src/log.ts
 * is `silent` under `NODE_ENV=test` on purpose, and its destination is a
 * SonicBoom writing to fd 1 with `fs.writeSync` — so a spy on
 * `process.stdout.write` sees nothing whatever the logger does, and would go
 * green the day the handler stopped logging. tests/log.test.ts owns the rest of
 * the chain: it runs a real subprocess and asserts that an `err` reaches stdout
 * with its message and stack. What is left for here is that the handler hands
 * the logger the error at all, and hands it the *error* rather than a string.
 */
const logged = vi.fn();

vi.mock("../src/log.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/log.js")>();
  const silent = {
    debug() {},
    info() {},
    warn() {},
    error: logged,
    child() {
      return silent;
    },
  };
  return { ...actual, log: () => silent };
});

const { health } = await import("../src/vercel-health.js");

/** A request the handler can consume, body and all. */
function request(method: string, body?: string): IncomingMessage {
  const payload = body === undefined ? [] : [Buffer.from(body)];
  return Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url: "/api/health", headers: {}, destroy: vi.fn() },
  ) as unknown as IncomingMessage;
}

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  raw: string;
}

function reply(): { res: ServerResponse; read(): Reply } {
  let status = 200;
  let raw = "";
  const headers: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    end(chunk?: string) {
      raw = chunk ?? "";
    },
  } as unknown as ServerResponse;
  return {
    res,
    read: () => ({
      status,
      headers,
      raw,
      body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
    }),
  };
}

async function call(method: string, body?: string): Promise<Reply> {
  const { res, read } = reply();
  await health(request(method, body), res);
  return read();
}

/**
 * **The cache lives in the module, so it outlives the test.**
 *
 * `beforeEach` clearing the spy is not enough: the second test would see a
 * warm cache from the first, call nothing, and "0 calls" would read as the
 * cache working when it is really the fixture leaking. So the clock walks
 * forward ten minutes between tests, which expires it for real — and every
 * test below can then assume a cold start without saying so.
 */
let clock = Date.UTC(2026, 7, 27, 12, 0, 0);

beforeEach(() => {
  listArticles.mockClear();
  listArticles.mockResolvedValue([]);
  clock += 10 * 60_000;
  vi.useFakeTimers();
  vi.setSystemTime(clock);
});

/**
 * **This file needs a database, and until 2026-09-04 nothing here said so.**
 *
 * It calls no `pgReady(`, builds no pool and imports no `pg`; it reaches
 * Postgres through the health handler's own `getDb()`, reading the migration
 * ledger. So the lane scan could not see it, and it spent its life quietly
 * using whatever database the box happened to have — found by T-D's poisoned
 * `DATABASE_URL`, four failures, *"the migration ledger could not be read"*.
 *
 * Giving it the private lane fixed *which* database it uses and not the case
 * where there is none: with the stack off, `npm test` is supposed to skip the
 * Postgres suites, and this file **failed** instead, four ways. GPT Sol found
 * that reviewing T-D, and it was right — the stage promised not to change what
 * Docker-off does.
 *
 * The gate is here rather than around the whole file because 24 of the 28 cases
 * do not care: they assert that a *specific* warning is present, and an extra
 * one about the ledger does not disturb them. The four below assert the warning
 * list is **empty**, which is a claim about the machine as much as about the
 * environment under test, and it is false on a laptop with no Postgres.
 *
 * The table named is the one the handler actually reads. `pgReady` is also what
 * makes `REQUIRE_POSTGRES=1` turn this skip into a failure, so `npm run check`
 * still cannot go green having not run these.
 */
const { reachable: ledgerReadable } = await pgReady({
  suite: "the health endpoint's four 'nothing left to warn about' cases",
  tables: ["spideryarn_migrations.__drizzle_migrations"],
});

describe("what an anonymous caller can make the server do", () => {
  /**
   * **The amplifier.** `listArticles()` is not one query — it walks every
   * article, then does per-article block and comment work. Ungated and
   * uncached, a loop over `curl` is a database load generator that costs the
   * caller nothing.
   *
   * The fix is a 30-second window, so the answer to "how expensive is a flood"
   * stops being "linear in the flood".
   */
  it("does not run the store check once per request", async () => {
    await call("GET");
    await call("GET");
    await call("GET");
    expect(listArticles).toHaveBeenCalledTimes(1);
  });

  /** And it is a cache rather than a one-shot: it does refresh eventually. */
  it("does run it again once the window has passed", async () => {
    await call("GET");
    expect(listArticles).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    await call("GET");
    expect(listArticles).toHaveBeenCalledTimes(2);
  });

  /**
   * HEAD used to be exactly as expensive as GET while returning no body — the
   * cheapest possible way to spend somebody else's database.
   */
  it("costs no more for a HEAD than for a GET", async () => {
    await call("HEAD");
    await call("GET");
    expect(listArticles).toHaveBeenCalledTimes(1);
  });
});

describe("what it says back", () => {
  /**
   * A database error is a connection string, a hostname, sometimes an SSL
   * certificate subject. The operator needs all of it; a stranger needs to know
   * that something is wrong and nothing else.
   */
  it("does not hand a stranger the whole database error", async () => {
    const secret =
      "connect ECONNREFUSED 10.1.2.3:5432 — password authentication failed for user " +
      "postgres.abcdefghijklmnop ".repeat(20);
    listArticles.mockRejectedValue(new Error(secret));
    logged.mockClear();

    const answer = await call("GET");

    /* The whole thing must not be in there, and what IS in there is bounded.
       Asserted on the error field rather than on the whole response, because
       the rest of the body is runtime, region and commit — real diagnostics
       that are meant to be there, and folding them into one length budget
       makes this test fail the next time somebody adds a field. */
    expect(answer.raw).not.toContain(secret);
    const reported = JSON.stringify((answer.body.store as { error?: string }).error ?? "");
    expect(reported.length).toBeLessThanOrEqual(220);
    /* The operator still gets it — trimming the response is only safe if the
       full text is somewhere. If this ever stops being true the trim above
       becomes data loss rather than discretion. */
    expect(logged).toHaveBeenCalled();
    /* Read off `err.message`, never `JSON.stringify(args)`. An `Error`'s message
       is not an enumerable own property, so stringifying the call arguments
       gives `[{"err":{}}]` — a string that contains none of the words below and
       would fail here for a reason that has nothing to do with the handler.
       The same trap in reverse is why errorFields exists at all
       (tests/log.test.ts, "exists because JSON.stringify(new Error(...)) is {}"). */
    const errors = logged.mock.calls.map(([fields]) => (fields as { err?: Error })?.err?.message ?? "");
    expect(errors.join(" ")).toContain("ECONNREFUSED");
    /* The whole error object, not a message plucked out of it: `safeError` in
       src/log.ts can only apply its allowlist to something it is handed whole,
       and a string assembled here would sail past redaction. */
    expect(logged.mock.calls[0]?.[0]).toHaveProperty("err", expect.any(Error));
  });

  it("says which store is live, because that is the first question", async () => {
    const answer = await call("GET");
    expect((answer.body.store as { name: string }).name).toBe("postgres");
  });

  it("is not cached by anything in between", async () => {
    const answer = await call("GET");
    expect(answer.headers["cache-control"]).toContain("no-store");
  });
});

describe("verbs and bodies", () => {
  it("turns away a verb it does not implement", async () => {
    const answer = await call("DELETE");
    expect(answer.status).toBe(405);
  });

  /**
   * **413, not a cheerful truncated 200.**
   *
   * The first version read the whole chunk, noticed it was over the cap, and
   * answered 200 with `truncated: true` — a storage cap wearing a transport
   * cap's name. It accepted everything and told the sender they had succeeded.
   * GPT Sol, 2026-08-27.
   */
  it("refuses a body larger than it is willing to read", async () => {
    const answer = await call("POST", "x".repeat(9 * 1024));
    expect(answer.status).toBe(413);
    expect(answer.body.ok).toBe(false);
  });

  /** And an ordinary body still works, or the cap above proves nothing. */
  it("accepts one that fits", async () => {
    const answer = await call("POST", JSON.stringify({ hello: "world" }));
    expect(answer.status).toBe(200);
    expect(answer.body.bytes).toBeGreaterThan(0);
  });
});

/**
 * **The check that was green about the thing it exists to catch.**
 *
 * 2026-08-27: production ran for a day with `SUPABASE_SERVICE_ROLE_KEY` never
 * added to the Vercel project. `src/store/blobs.ts` reads it through
 * `configured()`, and both callers degrade *quietly* when it is absent —
 * `uploadGrants()` returns null, so a reader's PDF upload is refused, and
 * `blobStore()` falls back to `fsBlobs()`, writing raw source bytes to a
 * serverless filesystem that does not survive the request. Neither says
 * anything. `/api/health` answered `{"ok":true,"warnings":[]}` throughout,
 * while reporting `"SUPABASE_SERVICE_ROLE_KEY": false` two lines further down
 * in the same response.
 *
 * That is the exact shape of docs/reusable/silent-success.md, and this file's
 * own header already says a health check that passes when the deployment is
 * wrong "is worse than no health check, because it is the thing you point at
 * to argue nothing is wrong". `EXPECTED` was a *report*, and a boolean nobody
 * compares against anything is not a check.
 *
 * So: the ones the deployment cannot work without produce a warning, which
 * fails the endpoint. The ones that are merely nice to have stay quiet, or the
 * warning list becomes noise and the next real one gets skimmed past.
 */
describe("the environment a deployment needs", () => {
  /**
   * Everything required, so a test can remove exactly one and blame it.
   *
   * **Every name is stubbed explicitly, including the ones a laptop happens to
   * have.** vite.config.ts calls `loadEnvLocal()` and vitest inherits that, so
   * `.env.local` is in `process.env` while these run — which meant the green
   * control below passed on this machine without `VITE_SUPABASE_URL` ever being
   * set by the fixture, and would have failed on a fresh checkout that has no
   * `.env.local`. A fixture that reads the developer's environment is not a
   * fixture. Left in the same order as `EXPECTED` so the two stay comparable.
   */
  function completeEnv(): void {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@db.example.com:5432/postgres");
    vi.stubEnv("SPIDERYARN_STORE", "postgres");
    /* No `ANTHROPIC_API_KEY` — it left `EXPECTED` on 2026-08-31 and the test
       below is the one that stubs it, deliberately, to prove it is ignored. */
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon-test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-test");
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-test");
    vi.stubEnv("PGSSLROOTCERT", "certs/supabase-ca.crt");
    vi.stubEnv("LOG_LEVEL", "info");
    /* Only checked when `VERCEL` is set, and it is not here unless a test says
       so — but stubbed anyway so that a machine with it in the environment
       cannot change what these tests mean. */
    vi.stubEnv("NODEJS_HELPERS", "0");
    vi.stubEnv("VERCEL", "");
    /* Payments. `VERCEL_ENV` is what decides which Stripe mode is correct
       (src/billing/stripe.ts), so it is pinned here for the same reason as
       `VERCEL` above: otherwise a machine that has it set changes what every
       test in this block means. */
    vi.stubEnv("VERCEL_ENV", "");
    /* No STRIPE_PRICE_* — tiers live in `billing_tiers` since 2026-09-02, so
       there is no such variable to stub. */
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
    /* Required *because* the line above sets a secret key — the `with` on its
       EXPECTED entry. A deployment with neither is fine; one with only a
       secret key cannot verify a single delivery. */
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_fixture");
  }

  /** Only the warnings, since ssl and store have their own tests above. */
  function warningsFrom(answer: Reply): string[] {
    return (answer.body.warnings as string[]) ?? [];
  }

  /**
   * **A non-empty shelf, so that the only warnings left are the env ones.**
   *
   * Without this the "shelf is empty" warning is in the list on every call,
   * and the two assertions below that read `ok === false` pass whether or not
   * the code under test does anything at all — which is how the first draft of
   * this block ran green against the unfixed handler. docs/reusable/silent-success.md
   * again, one level up: the *test* succeeding for a reason of its own.
   */
  beforeEach(() => {
    listArticles.mockResolvedValue([{ slug: "one" }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("says so when the key that silently disables uploads is missing", async () => {
    completeEnv();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const answer = await call("GET");

    expect(warningsFrom(answer).join(" ")).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(answer.body.ok).toBe(false);
  });

  /* Not a duplicate of the one above: that asserts the *name* reaches the
     operator, this asserts the *consequence* does. "SUPABASE_SERVICE_ROLE_KEY
     is not set" is a fact you can already see in the env block; what nobody
     can see is that the bytes are going somewhere that will not keep them. */
  it("says what breaks, not merely which name is empty", async () => {
    completeEnv();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const said = warningsFrom(await call("GET")).join(" ");

    expect(said).toMatch(/upload|blob|bytes/i);
  });

  /**
   * **The half-configured deployment, which is the shape that has bitten.**
   * Production ran with neither Stripe variable set on 2026-09-03, and
   * `stripe:check` could not see it: that script reads the Stripe *account*,
   * where the endpoint is registered and correct, and knows nothing about what
   * the deployment holds. src/vercel-health.ts § `STRIPE_WEBHOOK_SECRET`.
   */
  it("warns when Stripe has a secret key but no webhook secret", async () => {
    completeEnv();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");

    const answer = await call("GET");

    /* **The whole clause, not `toContain` on the bare name.** A substring match
       here passes against an entry named `STRIPE_WEBHOOK_SECRET_MUTATED`, which
       checks a variable nothing reads — so the first version of this test went
       green under exactly the mutation it exists to catch. */
    expect(warningsFrom(answer).join(" ")).toMatch(/STRIPE_WEBHOOK_SECRET is not set/);
    /* Not merely listed — anything in `warnings` has to fail the endpoint, or
       the deploy gate in scripts/deploy-checks.ts sails past it. */
    expect(answer.body.ok).toBe(false);
  });

  /* A deployment with no Stripe at all is a perfectly good deployment —
     everyone stays on the free tier — so the pair being absent together is
     silence, not a warning. This is the case that `breaks: null` alone could
     not express, and the reason the `with` field exists. */
  it("says nothing about the webhook secret when Stripe is not configured at all", async () => {
    completeEnv();
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");

    const said = warningsFrom(await call("GET")).join(" ");

    expect(said).not.toContain("STRIPE_WEBHOOK_SECRET");
  });

  /* `value()` trims, so a stray space in a Vercel dashboard field is not a
     credential. Without this the endpoint would go green while every delivery
     was refused with 503 — the precise failure the trimming exists to stop. */
  it("treats a blank webhook secret as no webhook secret", async () => {
    completeEnv();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "   ");

    const said = warningsFrom(await call("GET")).join(" ");

    expect(said).toMatch(/STRIPE_WEBHOOK_SECRET is not set/);
  });

  it("names every missing one, rather than stopping at the first", async () => {
    completeEnv();
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("SUPABASE_URL", "");

    const said = warningsFrom(await call("GET")).join(" ");

    expect(said).toContain("OPENROUTER_API_KEY");
    expect(said).toContain("SUPABASE_URL");
  });

  it("says the one key now stops ingest as well as reading", async () => {
    /* The consequence clause is a claim about *other* code, so it goes stale in
       silence when that code moves — and this one did, on 2026-08-27, when the
       seven pipeline stages left api.anthropic.com. Until it was updated, the
       report told somebody staring at a dead ingest queue that a missing
       `OPENROUTER_API_KEY` only cost them the reading view. */
    completeEnv();
    vi.stubEnv("OPENROUTER_API_KEY", "");

    const said = warningsFrom(await call("GET")).join(" ");

    expect(said).toMatch(/ingest|pipeline/i);
  });

  it("reports OPENAI_API_KEY, the one credential whose spend nothing else can see", async () => {
    /* **It was in neither `.env.example` nor this list until 2026-09-02**, while
       being required by src/live.ts — so the one key that buys audio by the
       minute on a *separate* OpenAI bill, outside the OpenRouter account cap,
       was the one key nothing documented and nothing reported.

       Reported, not warned about. Whether a given deployment wants live
       conversation is a product decision this file cannot make, and a warning on
       every deployment that has not enabled it is exactly the noise this
       describe block's header is about. What the operator gets is the name, in
       the env block, where the other credentials are. */
    completeEnv();

    const answer = await call("GET");

    const env = (answer.body as { env?: Record<string, boolean> }).env ?? {};
    expect(Object.keys(env)).toContain("OPENAI_API_KEY");
  });

  it("does not mention ANTHROPIC_API_KEY at all, in the env block or the warnings", async () => {
    /* **The absence is the assertion, and it has to cover both halves.**
       The version of this test before 2026-08-31 checked only that the key was
       not *warned* about, which was true while it sat in `EXPECTED` with
       `breaks: null` — and stayed true, unfalsifiably, once the row was deleted.
       A test that cannot go red for either state is testing nothing.

       Now nothing on a deployment wants the key: the pipeline moved to
       OpenRouter on 2026-08-27, and the last caller is an eval that runs on a
       laptop (docs/project/ai-gateway.md). Offering an operator a name they
       cannot use, one line above the key that really does break everything, is
       how the real warnings get skimmed. Put the row back and this reddens on
       the env block. */
    completeEnv();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");

    const answer = await call("GET");
    const env = (answer.body as { env?: Record<string, boolean> }).env ?? {};

    expect(Object.keys(env)).not.toContain("ANTHROPIC_API_KEY");
    expect(warningsFrom(answer).join(" ")).not.toContain("ANTHROPIC_API_KEY");
  });

  /* The other half. A warning list that fires on things nobody has to set is
     a list that gets ignored, and then the real one is skimmed past too. */
  it.skipIf(!ledgerReadable)("stays quiet about one that is merely nice to have", async () => {
    completeEnv();
    vi.stubEnv("LOG_LEVEL", "");

    const answer = await call("GET");

    expect(warningsFrom(answer).join(" ")).not.toContain("LOG_LEVEL");
    /* Stronger than "does not mention LOG_LEVEL": with a full environment and
       a populated shelf there is nothing left to complain about, so the whole
       list must be empty and the endpoint green. If this ever fails, something
       new is warning and the assertion above would not have caught it. */
    expect(warningsFrom(answer)).toEqual([]);
    expect(answer.body.ok).toBe(true);
  });


  /* GPT Sol's review, 2026-08-27, finding 1: the first version of this table
     demanded `SUPABASE_ANON_KEY` by name, which would have 503'd a deployment
     whose sign-in works — src/auth.ts takes the publishable key first and only
     falls back to the anon key. A required *need* is not a required *name*. */
  it.skipIf(!ledgerReadable)("takes either key sign-in accepts, rather than one by name", async () => {
    completeEnv();
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test");

    const answer = await call("GET");

    expect(warningsFrom(answer)).toEqual([]);
    expect(answer.body.ok).toBe(true);
  });

  it("complains only when neither of the two is there", async () => {
    completeEnv();
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");

    const said = warningsFrom(await call("GET")).join(" ");

    expect(said).toContain("SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY");
  });

  /* Finding 5. `Boolean(process.env[name])` called this configured, and so does
     `configured()` in src/store/blobs.ts — so a stray space in a dashboard
     field would take this endpoint green while every Supabase call failed. */
  it("does not count a stray space as a credential", async () => {
    completeEnv();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "   ");

    const answer = await call("GET");

    expect(warningsFrom(answer).join(" ")).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect((answer.body.env as Record<string, boolean>).SUPABASE_SERVICE_ROLE_KEY).toBe(false);
  });

  /* Finding 2. Presence is not correctness: set to "1" the variable is there
     and request bodies still arrive empty, with every other line green. */
  it("checks the value of the one variable whose value is the setting", async () => {
    completeEnv();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODEJS_HELPERS", "1");

    const said = warningsFrom(await call("GET")).join(" ");

    expect(said).toContain("NODEJS_HELPERS");
    expect(said).toMatch(/bodies/i);
  });

  it.skipIf(!ledgerReadable)("says nothing about a platform flag on a machine that is not the platform", async () => {
    completeEnv();
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODEJS_HELPERS", "");

    expect(warningsFrom(await call("GET"))).toEqual([]);
  });

  /* Finding 3. The weakest check here, kept because absent is conclusive and
     absent is what actually happens — a deploy whose client vars were never
     set renders a blank page while every server-side line stays green. */
  it("notices the client configuration that makes the reading view a blank page", async () => {
    completeEnv();
    vi.stubEnv("VITE_SUPABASE_URL", "");

    const said = warningsFrom(await call("GET")).join(" ");

    expect(said).toContain("VITE_SUPABASE_URL");
    expect(said).toMatch(/blank page/i);
  });

  /**
   * **The variable whose *presence* is the danger, so the usual pair of tests
   * is the wrong pair.**
   *
   * Everything else in this block is warned about when it is missing. Stripe is
   * the other way round: a deployment with no payments configured is fine and
   * must stay quiet, while a key from the wrong *mode* is set, non-empty, and
   * catastrophic — production on `sk_test_…` takes card `4242…`, writes
   * `active` subscription rows and grants real quota, with every "is it set"
   * line green (docs/reusable/silent-success.md). So `breaks` is null and
   * `valid` does the work, which is why `checkEnv` checks `valid` even when
   * there is no `breaks`.
   */
  it.skipIf(!ledgerReadable)("stays quiet about a deployment that simply has no payments", async () => {
    completeEnv();
    vi.stubEnv("STRIPE_SECRET_KEY", "");

    const answer = await call("GET");

    expect(warningsFrom(answer)).toEqual([]);
    expect(answer.body.ok).toBe(true);
    /* Still *reported*, so an operator can see it is unset without guessing. */
    expect(Object.keys(answer.body.env as Record<string, boolean>)).toContain("STRIPE_SECRET_KEY");
  });

  it("refuses a TEST-mode Stripe key on the production deployment", async () => {
    completeEnv();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_wouldacceptfakecards");

    const answer = await call("GET");
    const said = warningsFrom(answer).join(" ");

    expect(said).toContain("STRIPE_SECRET_KEY");
    expect(said).toMatch(/test cards/);
    expect(answer.body.ok).toBe(false);
    /* The value is a credential; only its prefix was ever read. */
    expect(said).not.toContain("sk_test_wouldacceptfakecards");
  });

  it("refuses a LIVE-mode Stripe key anywhere else", async () => {
    completeEnv();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_wouldchargerealcards");

    const answer = await call("GET");
    const said = warningsFrom(answer).join(" ");

    expect(said).toContain("STRIPE_SECRET_KEY");
    expect(answer.body.ok).toBe(false);
    expect(said).not.toContain("sk_live_wouldchargerealcards");
  });

  /**
   * The failure the mode-independent wording exists to prevent. `EXPECTED` is
   * a module-level constant, so anything computed in it is frozen at import;
   * the first version built `must` from `expectedLivemode()` and therefore
   * told a production operator to install a *test* key, because this test file
   * imports the module with `VERCEL_ENV` unset. Detection was right and the
   * instruction was backwards, which is the worse of the two halves to get
   * wrong.
   */
  it("gives the same instruction whichever mode the key was wrong in", async () => {
    completeEnv();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_x");
    const outside = warningsFrom(await call("GET")).join(" ");

    completeEnv();
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    const inside = warningsFrom(await call("GET")).join(" ");

    expect(outside).toContain("sk_live_… in production");
    expect(inside).toContain("sk_live_… in production");
  });

  /* The regression guard proper: this is the literal response production
     served, and it must not be servable again. */
  it("cannot report ok while a required variable is empty", async () => {
    completeEnv();
    vi.stubEnv("SUPABASE_ANON_KEY", "");

    const answer = await call("GET");

    expect(answer.body.ok).toBe(false);
    expect(answer.status).toBe(503);
    expect((answer.body.env as Record<string, boolean>).SUPABASE_ANON_KEY).toBe(false);
  });

});

/**
 * Finding 6 of the same review, and the one the existing cache test could not
 * have found: it awaited three requests **one after another**, which is the one
 * arrival pattern where a cache written after the await still works.
 */
describe("a flood that arrives all at once", () => {
  it("runs the expensive query once, not once per concurrent caller", async () => {
    /* A query that does not resolve until every caller has arrived. Without
       this, `await` inside the loop would let each one finish before the next
       began, and the test would pass against the broken code. */
    let release: (v: unknown[]) => void = () => {};
    listArticles.mockReturnValue(
      new Promise<unknown[]>((resolve) => {
        release = resolve;
      }),
    );

    const flood = Array.from({ length: 25 }, () => call("GET"));
    release([{ slug: "one" }]);
    await Promise.all(flood);

    expect(listArticles).toHaveBeenCalledTimes(1);
  });

});

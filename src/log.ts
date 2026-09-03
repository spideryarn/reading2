/**
 * The logger. One per component, JSON to stdout, and nothing else.
 *
 * Read [logging.md](../docs/project/logging.md) before changing anything in
 * here — particularly the three ways this file deliberately differs from the
 * same file in the original version of this app, which used Pino too.
 *
 * ## What this is for, and what it is not for
 *
 * **Logging is what the server says to whoever is running it.** The `console.log`
 * calls in the pipeline stages' `main()` functions are a *user interface* — a
 * person at a terminal watching `npm run hierarchy` — and they are staying exactly as
 * they are. Do not convert them. See logging.md § The CLI output is not logging.
 *
 * ## The rules that are load-bearing
 *
 * 1. **No transports, ever.** `pino({ transport: … })` spawns a worker thread.
 *    A Vercel function freezes at response time and the worker's buffered
 *    writes never land — so the lines you lose are the ones at the end of a
 *    request, which are the ones you wanted. Pretty output in development is a
 *    shell pipe (`npm run dev:pretty`), which cannot leak into production
 *    because it is not in the program.
 * 2. **`sync: true`.** Measured, not assumed: on pino 10.3.1 the default
 *    destination already survives an immediate `process.exit(0)`. Stating it
 *    turns a guarantee that is currently incidental into one that is written
 *    down.
 * 3. **Nothing sensitive in the message string.** `redact` — the path list is
 *    in [log-redaction.ts](log-redaction.ts) — matches
 *    *paths in the object*, never values and never `msg`. So
 *    `log.info({ url }, "fetching")` can be redacted and
 *    `log.info(\`fetching ${url}\`)` can never be.
 * 4. **No module-level "current request".** Vercel's Fluid Compute runs several
 *    requests concurrently in one instance, so a module-level `currentLogger`
 *    would attribute lines to the wrong article, intermittently. Make a child
 *    and pass it down — that is what `child()` is for.
 * 5. **A log call never throws, and never has to be wrapped in a `try`.** This
 *    is the one rule the code keeps rather than the reader — see `wrap`. It
 *    matters because the alternative is a logger that can turn a working
 *    request into a failed one.
 * 6. **Only an allowlist of an error's own properties is written down**, so a
 *    future error class carrying something private does not silently leak it.
 *    See `SAFE_ERROR_PROPS`. The corollary is that `message` *is* logged, so
 *    **do not interpolate untrusted content into an error you throw.**
 */
import pino from "pino";
import { REDACT } from "./log-redaction.js";

/**
 * Where a level is decided, and the one thing to know: **`silent` under test.**
 *
 * Vitest sets `NODE_ENV=test`, and without this every test run that touches a
 * route prints a wall of JSON around the assertions. `LOG_LEVEL` overrides it,
 * which is how you debug a failing test: `LOG_LEVEL=debug npx vitest run x`.
 */
function level(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  if (process.env.NODE_ENV === "test") return "silent";
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

/**
 * The root logger. Almost nothing should use this directly — use `log()`.
 *
 * `base` carries `service` because this will not be the only thing writing to
 * the Vercel project's log stream for ever, and one field now is cheaper than
 * telling two streams apart later.
 */
/**
 * Diagnostic properties an error may carry into the log. **Everything else on
 * a thrown object is dropped**, and that is the point of this list existing.
 *
 * Pino's standard error serialiser copies an `Error`'s *enumerable own
 * properties* onto the line. That is a sensible default and it was a leak here:
 * `FetchFailure` (src/fetch.ts) carries a `url`, so one `log.error({ err })` on
 * a failed fetch emitted
 *
 *     "err":{…,"url":"https://user:pw@host/article?token=SECRET"}
 *
 * — credentials, query string and all. `redact` could not help: its paths are
 * configured up front and `err.url` was not among them, and no list of paths
 * can anticipate what property some future error class will decide to carry.
 *
 * So the direction is inverted. An allowlist drops the property nobody thought
 * about, which is always the one that leaks. Found by GPT/Codex reviewing this
 * change; the URL-with-credentials line above is copied from a real run.
 */
const SAFE_ERROR_PROPS = ["code", "status", "statusCode", "errno", "syscall", "retryable"];

/**
 * The `err` key, with only the parts that are safe to write down.
 *
 * **`message` and `stack` are kept, and that makes error messages part of the
 * log's privacy surface.** There is no structural way around it — a message is
 * free text and the only thing that can keep it clean is the code that builds
 * it. Hence the rule in logging.md: do not interpolate untrusted content into
 * an error you intend to throw. `cause` is followed, but not for ever.
 */
function safeError(err: unknown, depth = 0): Record<string, unknown> {
  if (!(err instanceof Error)) return { type: "NonError", message: describe(err) };
  const out: Record<string, unknown> = {
    type: err.name,
    message: err.message,
    stack: err.stack,
  };
  for (const key of SAFE_ERROR_PROPS) {
    const value = (err as unknown as Record<string, unknown>)[key];
    const kind = typeof value;
    if (kind === "string" || kind === "number" || kind === "boolean") out[key] = value;
  }
  // Bounded, because a `cause` chain can be circular — and an unbounded walk
  // here would turn a logged error into a stack overflow, which is a far worse
  // failure than the one being reported.
  if (err.cause !== undefined && depth < 3) out.cause = safeError(err.cause, depth + 1);
  return out;
}

/**
 * Say what something is, when it is not an `Error` and cannot be trusted.
 *
 * **Never `JSON.stringify`.** That was the first version and it had two faults,
 * both found in review. It *throws* on a circular object and on a `BigInt` — and
 * it throws from inside a `catch`, so the original failure is replaced by
 * "Converting circular structure to JSON" and the real one is gone. And for a
 * plain object it moved the whole thing into a message string, where redaction
 * can never reach it: `throw { apiKey: "…" }` was logged verbatim.
 *
 * A type name is worth less than the object, and it cannot do either of those.
 */
function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "object") {
    const name = (value as object).constructor?.name ?? "Object";
    return `non-Error thrown: ${name}`;
  }
  // Symbols and BigInts both refuse implicit conversion, so this stays inside
  // a try rather than trusting the template literal.
  try {
    return `non-Error thrown: ${String(value)}`;
  } catch {
    return `non-Error thrown: ${typeof value}`;
  }
}

/**
 * Where the lines go. Errors from the destination are swallowed deliberately:
 * an unhandled `error` event on a stream throws, and a logger that can throw is
 * a logger that can turn a working request into a failed one — see `wrap`.
 */
const destination = pino.destination({ sync: true });
destination.on("error", () => {});

const root = pino(
  {
    level: level(),
    base: { service: "spideryarn", env: process.env.NODE_ENV ?? "development" },
    timestamp: pino.stdTimeFunctions.isoTime,
    // The label, not the number. `"level":"warn"` is greppable in a Vercel log
    // view; `"level":40` sends you to a table.
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT, censor: "[redacted]" },
    serializers: { err: safeError },
  },
  destination,
);

/** The components that log, as a closed set rather than free-form strings. */
export type Component =
  | "http" // src/routes.ts — one line per API request
  | "jobs" // src/jobs.ts — the queue and job lifecycle
  | "pipeline" // src/pipeline.ts — one line per step, with what it cost
  | "store" // src/api.ts, src/comments.ts, src/chat.ts, src/searches.ts
  /* src/auth.ts — and only ever about OUR side failing. A refused token is not
     logged here: it is an ordinary 401, and the `http` line already says so.
     Nothing in this component may carry a token, a `sub` or an email address;
     redaction below matches key paths and never text. */
  | "auth"
  /* src/vercel-health.ts — GET /api/health, which is not a route in
     src/routes.ts because it reports on the DEPLOYMENT rather than on the
     application. Its lines are the other half of a deliberate bargain: that
     endpoint is public, so a driver's error reaches the caller truncated to 200
     characters and the whole of it comes here. Nothing else in the file logs —
     everything it has to say, it says in the response.

     Also src/cold-start.ts: two lines per function instance saying what loading
     `api-dist/vercel.js` cost. Same arm on purpose — a cold start is a property
     of the deployment and of nothing a reader did, no request is really its
     subject, and a sixteenth component for two lines an instance would be a
     filter nobody would think to build. */
  | "health"
  | "model"; // src/explain.ts, src/converse.ts, src/search.ts — a reader waiting

/**
 * What a caller gets. Deliberately smaller than `pino.Logger`.
 *
 * Four levels and `child`, because that is all this project uses, and a
 * narrower surface is a narrower thing to keep true through `wrap` below.
 */
export interface Log {
  debug(obj: object, msg?: string): void;
  debug(msg: string): void;
  info(obj: object, msg?: string): void;
  info(msg: string): void;
  warn(obj: object, msg?: string): void;
  warn(msg: string): void;
  error(obj: object, msg?: string): void;
  error(msg: string): void;
  child(bindings: object): Log;
}

/**
 * A logger that cannot throw. **This is rule 5, and it is structural.**
 *
 * Every other rule in this file is a rule a person has to keep. This one is
 * kept by the code, because the failure it prevents is the worst one available
 * to a logger: a log call that throws is a log call that changes what the
 * program does.
 *
 * The shapes that failure takes are all real, and none is hypothetical:
 *
 * - `src/comments.ts` writes a comment to disk and *then* logs. A throw there
 *   leaves the comment written and returns a rejected promise, so the reader is
 *   told their note failed to save while it sits on disk.
 * - `runJob`'s catch logs before it persists the job as failed. A throw there
 *   stops the failure ever being recorded — the logging of an error destroying
 *   the record of that error.
 * - `logRequest` runs in a `finally`. A throw there replaces both a successful
 *   return and any exception on its way out.
 *
 * The alternative was a `try` at every one of those call sites, which is the
 * same rule written thirty times and forgotten on the thirty-first. Pino's
 * synchronous destination is not documented as non-throwing — SonicBoom throws
 * on a destroyed destination — so this is not defensive padding.
 *
 * Nothing is reported when a log line is lost. There is nowhere to report it
 * *to*: the reporting channel is the thing that just failed.
 */
function wrap(logger: pino.Logger): Log {
  const at =
    (level: "debug" | "info" | "warn" | "error") =>
    (a: object | string, b?: string): void => {
      try {
        if (typeof a === "string") logger[level](a);
        else logger[level](a, b);
      } catch {
        // Deliberately empty. See above: there is no second channel.
      }
    };
  return {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    child: (bindings: object) => {
      try {
        return wrap(logger.child(bindings));
      } catch {
        return wrap(logger);
      }
    },
  } as Log;
}

/**
 * A logger for one component: `log("jobs").info({ slug }, "queued")`.
 *
 * A closed union rather than a string because a typo in a component name is
 * invisible — the line is written, it just never matches the filter you built
 * around the name you meant. The compiler is the only thing that catches that.
 *
 * Children are cheap; make one per request or per job and pass it down rather
 * than storing it anywhere module-level (rule 4 above).
 */
export function log(component: Component): Log {
  return wrap(root.child({ component }));
}

/**
 * Whatever was thrown, under the `err` key, for `safeError` to narrow.
 *
 * A bare `throw "nope"` would otherwise serialise to nothing useful, which is
 * the exact failure this project keeps finding
 * (docs/reusable/silent-success.md) — the line is written, the information is
 * not in it.
 *
 * It hands the value straight through rather than converting it. The earlier
 * version built an `Error` here whose message was `JSON.stringify(err)`, which
 * threw on circular objects and on `BigInt`, and smuggled `{ apiKey: … }` into
 * a message string where redaction cannot reach. All of that now belongs to
 * `safeError`, which is one place instead of every call site.
 */
export function errorFields(err: unknown): { err: unknown } {
  return { err };
}

/**
 * Milliseconds since `started`, for a `ms` field.
 *
 * Trivial, and here rather than inline so that every duration in the logs is
 * the same unit and the same name. Two fields called `ms` and `duration` are
 * two fields nobody can chart together.
 */
export function since(started: number): number {
  return Date.now() - started;
}

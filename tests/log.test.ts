/**
 * The logger — src/log.ts. What actually comes out of stdout.
 *
 * Every rule in that file's header is a claim about *bytes*, not about
 * configuration, and each one fails silently when it breaks: a redaction path
 * that stops matching still writes a line, a level that stops resolving to
 * `silent` still passes every test in the suite (it just buries them in JSON),
 * and `JSON.stringify(new Error("x")) === "{}"` writes an `err` key with
 * nothing in it. That is the family in docs/reusable/silent-success.md — the
 * natural check (read the config, see `apiKey` in the list) shares its
 * assumption with the code, so it agrees with the bug.
 *
 * So these tests read the emitted line and nothing else. They assert on the
 * **absence of the secret string**, which is a different and stronger claim
 * than the presence of `[redacted]`: a key that vanished entirely, or a
 * redaction that ran on a copy, would satisfy the second and not the first.
 *
 * ## Why a child process
 *
 * `src/log.ts` builds its logger at import time — the level comes from the
 * environment then, and `pino.destination({ sync: true })` writes to **file
 * descriptor 1** with `fs.writeSync`, not through `process.stdout.write`. So
 * stubbing `process.stdout` would capture nothing and prove nothing, and
 * re-importing the module cannot change a level that was already read. A child
 * process gives us the real module, at a real level, and the real bytes it put
 * on fd 1 — a measurement that cannot share an assumption with the code.
 *
 * The cost is honest: ~1s per scenario, five scenarios. Lines are batched into
 * one child per environment rather than one child per assertion.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { errorFields, since } from "../src/log.js";

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));

/**
 * The module under test, as a path because we run it rather than import it.
 *
 * Overridable so that the suite can be pointed at a deliberately broken copy —
 * `LOG_TEST_MODULE=/tmp/log-with-apiKey-removed.ts npx vitest run
 * tests/log.test.ts` must go red. That is "test the test" from
 * silent-success.md, and it is one command rather than an edit to real source.
 * It steers the child process only: the handful of in-process tests at the
 * bottom import the real module and ignore it.
 */
const LOG_MODULE =
  process.env.LOG_TEST_MODULE ?? fileURLToPath(new URL("../src/log.ts", import.meta.url));

/** Distinct values per key, so no assertion can pass on another key's secret. */
const SECRETS = {
  apiKey: "sk-apikey-AAAA",
  api_key: "sk-apikey-BBBB",
  authorization: "Bearer-CCCC",
  cookie: "sid=DDDD",
  password: "pw-EEEE",
  token: "tok-FFFF",
  access_token: "at-GGGG",
  refresh_token: "rt-HHHH",
  email: "reader-IIII@example.com",
};
const NESTED_EMAIL = "nested-JJJJ@example.com";
const HEADER_AUTH = "Bearer-KKKK";
const HEADER_COOKIE = "sid=LLLL";
const BOUND_PARAM = "param-MMMM";
/** One value used twice: once in an object, once in a message string. */
const HOLE = "sk-hole-NNNN";
const ARTICLE_URL = "https://example.com/an-article";
/**
 * Two values that must never survive, both from failures GPT/Codex found.
 *
 * `ERROR_URL` is the `FetchFailure` shape: an `Error` subclass carrying an
 * enumerable `url`, which pino's default error serialiser copied onto the line
 * complete with credentials and query string. `SECRET_IN_THROWN_OBJECT` is a
 * `throw { … }` whose contents the first `errorFields` moved wholesale into an
 * `Error.message`, where path-based redaction can never reach.
 */
const ERROR_URL = "https://user:pw-OOOO@example.com/private?token=secret-PPPP";
const SECRET_IN_THROWN_OBJECT = "teapot-QQQQ";

/**
 * Runs `src/log.ts` in a child process and returns whatever landed on fd 1.
 *
 * `LOG_LEVEL` is deleted before the scenario's own environment is applied:
 * otherwise `LOG_LEVEL=debug npx vitest run tests/log.test.ts` — the documented
 * way to debug a failing test — would quietly turn the "silent under test" case
 * green-for-the-wrong-reason, or red, depending on the level you happened to
 * pick. A test's environment has to be the test's, not the shell's.
 */
function emit(scenario: { NODE_ENV: string; LOG_LEVEL?: string }, body: string): string {
  const script = `import(${JSON.stringify(LOG_MODULE)}).then(({ log, errorFields }) => {\n${body}\n});`;
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.LOG_LEVEL;
  env.NODE_ENV = scenario.NODE_ENV;
  if (scenario.LOG_LEVEL) env.LOG_LEVEL = scenario.LOG_LEVEL;

  const child = spawnSync(TSX, ["-e", script], { env, encoding: "utf8" });
  if (child.status !== 0) {
    throw new Error(`logger child exited ${child.status}:\n${child.stderr}`);
  }
  return child.stdout;
}

type Line = { raw: string; obj: Record<string, unknown> };

function parse(stdout: string): Line[] {
  return stdout
    .split("\n")
    .filter((raw) => raw.trim() !== "")
    .map((raw) => ({ raw, obj: JSON.parse(raw) as Record<string, unknown> }));
}

/** The one line with this `msg`, or a failure — never a silently-empty match. */
function lineFor(lines: Line[], msg: string): Line {
  const found = lines.filter((line) => line.obj.msg === msg);
  const [first] = found;
  if (!first || found.length !== 1) {
    throw new Error(`expected exactly one line with msg ${JSON.stringify(msg)}, got ${found.length}`);
  }
  return first;
}

const q = (value: unknown) => JSON.stringify(value);

/** Every line the "it logs" scenarios share. Deliberately one child, many lines. */
const BODY = [
  `log("jobs").info({`,
  Object.entries(SECRETS)
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${q(value)},`)
    .join("\n"),
  `  user: { name: "Greg", email: ${q(NESTED_EMAIL)} },`,
  `  headers: { authorization: ${q(HEADER_AUTH)}, cookie: ${q(HEADER_COOKIE)} },`,
  `  params: [${q(BOUND_PARAM)}],`,
  `  url: ${q(ARTICLE_URL)},`,
  `}, "every redacted path");`,
  `log("model").info({ apiKey: ${q(HOLE)} }, "the secret in a field");`,
  `log("model").info("the secret in a message: " + ${q(HOLE)});`,
  `log("pipeline").error(errorFields(new Error("boom")), "a real Error");`,
  `log("store").error(errorFields("nope"), "a thrown string");`,
  `log("store").error(errorFields({ code: 418, detail: ${q(SECRET_IN_THROWN_OBJECT)} }), "a thrown object");`,
  // An error class that carries its own enumerable properties, one of which is
  // a URL with credentials in it. This is the FetchFailure shape (src/fetch.ts)
  // and it is the leak GPT/Codex found: pino's default error serialiser copies
  // every enumerable own property onto the line.
  `const carrier = Object.assign(new Error("could not reach it"), {`,
  `  code: "dns", retryable: false, url: ${q(ERROR_URL)},`,
  `});`,
  `log("jobs").error(errorFields(carrier), "an error carrying a url");`,
  // Circular and BigInt: both threw from the first version of errorFields, from
  // inside a catch, replacing the real failure with a serialisation error.
  `const circular = { note: "hello" }; circular.self = circular;`,
  `log("jobs").error(errorFields(circular), "a circular throw");`,
  `log("jobs").error(errorFields({ big: 10n }), "a bigint throw");`,
  `log("http").warn({ ms: 12 }, "a warning");`,
  `log("http").debug({}, "a debug line");`,
].join("\n");

const EXPECTED_LINES = 11;

describe("what reaches stdout", () => {
  let lines: Line[] = [];

  beforeAll(() => {
    lines = parse(emit({ NODE_ENV: "development" }, BODY));
  }, 60_000);

  /* First, because every assertion below is about the contents of a collection
     that would pass vacuously if it were empty — and "no secret in zero lines"
     is exactly the shape of a test that can never fail. */
  it("emits one line per call, so the assertions below have something to inspect", () => {
    expect(lines).toHaveLength(EXPECTED_LINES);
  });

  it("keeps every redacted value out of the bytes", () => {
    const line = lineFor(lines, "every redacted path");
    const secrets = [
      ...Object.values(SECRETS),
      NESTED_EMAIL,
      HEADER_AUTH,
      HEADER_COOKIE,
      BOUND_PARAM,
    ];
    for (const secret of secrets) {
      /* The absence of the value, not the presence of "[redacted]". A key that
         disappeared, or a censor applied to a copy of the object, would pass
         the second check and fail this one. */
      expect(line.raw, `secret ${secret} reached stdout`).not.toContain(secret);
    }
    /* And the line really was written, with the non-secret fields intact —
       otherwise "the secret is absent" is true of a logger that logs nothing. */
    expect(line.obj.msg).toBe("every redacted path");
    expect(line.raw).toContain("Greg");
  });

  it("leaves url alone, which is a decision and not a gap", () => {
    /* src/log.ts: an article URL is the most useful field when a fetch fails,
       and this is a one-reader beta. If someone adds "url" to REDACT, this
       goes red and the decision gets re-made deliberately. */
    expect(lineFor(lines, "every redacted path").raw).toContain(ARTICLE_URL);
  });

  it("cannot redact a secret in the message string — rule 3, pinned", () => {
    /* `redact` is path-based: it matches the *position* of a key in the logged
       object, and `msg` is not one. The same string is therefore censored in a
       field and printed in full in a message. This test asserts the limitation
       rather than the fix, because that is the whole reason for the "nothing
       sensitive in the message string" rule — and if the behaviour ever
       changes, the rule should be re-read rather than silently outlived. */
    expect(lineFor(lines, "the secret in a field").raw).not.toContain(HOLE);
    expect(lineFor(lines, `the secret in a message: ${HOLE}`).raw).toContain(HOLE);
  });

  it("keeps the stack of a real Error", () => {
    const err = lineFor(lines, "a real Error").obj.err as { message: string; stack: string };
    expect(err.message).toBe("boom");
    expect(err.stack).toContain("Error: boom");
    expect(err.stack).toMatch(/\n\s+at /);
  });

  it("puts something readable in err when the thrown thing is not an Error", () => {
    /* The failure this exists to prevent: JSON.stringify of an Error is "{}" —
       see the in-process test below — and a bare `throw "nope"` has no message
       property at all. Either way the line gets written and the information
       does not reach it. */
    const thrownString = lineFor(lines, "a thrown string");
    expect((thrownString.obj.err as { message: string }).message).toBe("nope");
    expect(thrownString.raw).not.toContain(`"err":{}`);

    /* A thrown *object* names its type and stops there. The earlier version
       JSON-stringified it into the message, which is why this asserts the
       secret is ABSENT: that message string is somewhere redaction can never
       look, so "it was only in the message" is not a mitigation. */
    const thrownObject = lineFor(lines, "a thrown object");
    expect(thrownObject.raw).not.toContain(SECRET_IN_THROWN_OBJECT);
    expect((thrownObject.obj.err as { message: string }).message).toContain("non-Error");
  });

  it("drops an error's own properties unless they are on the allowlist", () => {
    /* The leak GPT/Codex found, pinned. `FetchFailure` carries a `url`, pino's
       default error serialiser copies every enumerable own property, and
       `redact` cannot help because its paths are fixed up front and nobody had
       thought of `err.url`.

       Asserted on the BYTES, and on the credential and the token separately —
       a check for the whole URL would pass if only half of it survived. */
    const line = lineFor(lines, "an error carrying a url");
    expect(line.raw).not.toContain(ERROR_URL);
    expect(line.raw).not.toContain("pw-OOOO");
    expect(line.raw).not.toContain("secret-PPPP");

    // …while the diagnostics that made the error worth logging are still there.
    const err = line.obj.err as Record<string, unknown>;
    expect(err.code).toBe("dns");
    expect(err.retryable).toBe(false);
    expect(err.message).toBe("could not reach it");
  });

  it("survives a circular object and a BigInt instead of throwing over them", () => {
    /* Both of these threw from inside `errorFields` in the first version, and
       both threw from *inside a catch block* — so the original failure was
       replaced by "Converting circular structure to JSON" and lost. The proof
       that they no longer throw is that these lines exist at all: the child
       process would have died before writing the two after them. */
    expect(lineFor(lines, "a circular throw").obj.err).toBeTruthy();
    expect(lineFor(lines, "a bigint throw").obj.err).toBeTruthy();
    expect(lineFor(lines, "a warning")).toBeTruthy();
    expect(lineFor(lines, "a debug line")).toBeTruthy();
  });

  it("writes the level as a label, never a number", () => {
    const warning = lineFor(lines, "a warning");
    expect(warning.raw).toContain(`"level":"warn"`);
    expect(warning.raw).not.toContain(`"level":40`);
    for (const line of lines) {
      expect(typeof line.obj.level, line.raw).toBe("string");
    }
  });

  it("carries service, env and component on every line", () => {
    for (const line of lines) {
      expect(line.obj.service).toBe("spideryarn");
      expect(line.obj.env).toBe("development");
    }
    expect(lineFor(lines, "a warning").obj.component).toBe("http");
    expect(lineFor(lines, "a real Error").obj.component).toBe("pipeline");
  });
});

/**
 * The level rules, measured as output rather than as a resolved level.
 *
 * `level()` is not exported, and testing it would be testing the cause. What
 * matters is whether anything comes out.
 */
describe("how much comes out, and when", () => {
  const NOISY = [
    `log("http").info({}, "an info line");`,
    `log("http").debug({}, "a debug line");`,
    `log("http").error({}, "an error line");`,
  ].join("\n");

  it("says nothing at all under test", () => {
    /* The one that guards a real risk: if this breaks, every `npm test` run
       fills with JSON around the assertions and nobody can read a failure.
       Zero bytes is the honest check — a resolved level of "silent" is the
       configuration, not the effect. */
    expect(emit({ NODE_ENV: "test" }, NOISY)).toBe("");
  }, 60_000);

  it("lets LOG_LEVEL override the silence, which is how you debug a test", () => {
    const lines = parse(emit({ NODE_ENV: "test", LOG_LEVEL: "debug" }, NOISY));
    expect(lines.map((line) => line.obj.msg)).toEqual([
      "an info line",
      "a debug line",
      "an error line",
    ]);
    expect(lineFor(lines, "a debug line").raw).toContain(`"level":"debug"`);
  }, 60_000);

  it("drops debug in production and keeps info", () => {
    const lines = parse(emit({ NODE_ENV: "production" }, NOISY));
    expect(lines.map((line) => line.obj.msg)).toEqual(["an info line", "an error line"]);
    expect(lines.every((line) => line.obj.env === "production")).toBe(true);
  }, 60_000);
});

describe("errorFields", () => {
  it("exists because JSON.stringify(new Error(...)) is {}", () => {
    /* Not a test of our code — a test of the premise our code is built on. If
       a future Node makes Error enumerable, this goes red and the helper's
       reason for existing needs re-reading. */
    expect(JSON.stringify(new Error("x"))).toBe("{}");
  });

  it("passes a real Error through untouched, so pino's serialiser sees it", () => {
    const original = new Error("boom");
    expect(errorFields(original).err).toBe(original);
  });

  it("hands the thrown value straight through, converting nothing", () => {
    /* It deliberately does NOT build an Error here any more. The earlier
       version set the message to `JSON.stringify(err)`, which threw on a
       circular object and on a BigInt — from inside a catch, so the original
       failure was replaced by "Converting circular structure to JSON" — and
       moved `{ apiKey: … }` into a message string where redaction cannot
       reach. Narrowing is `safeError`'s job now, and the emitted-bytes tests
       above are what check it. */
    const original = new Error("boom");
    expect(errorFields(original).err).toBe(original);
    const thrown = { code: 418 };
    expect(errorFields(thrown).err).toBe(thrown);
    expect(errorFields("nope").err).toBe("nope");
  });
});

describe("since", () => {
  it("counts milliseconds, so every duration in the logs is one unit", () => {
    expect(since(Date.now() - 5_000)).toBeGreaterThanOrEqual(5_000);
    expect(since(Date.now())).toBeLessThan(1_000);
  });
});

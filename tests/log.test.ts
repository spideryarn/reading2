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
 * One thing is read from the source rather than from the output, and it is
 * worth naming because it is the exception: `redactedPaths()` parses the
 * `REDACT` array out of `src/log.ts` to find out *which* paths to try. That is
 * a list of questions to ask, not an answer — every claim about what the logger
 * does is still measured from the bytes. The alternative was a copy of the list
 * kept in this file, which is a copy that goes stale silently.
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
 * The cost is honest: a few hundred milliseconds per scenario, six of them.
 * Lines are batched into one child per environment rather than one child per
 * assertion — two of the six are scenarios that end the process on purpose and
 * cannot share a child with anything.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

/**
 * Every path `src/log.ts` redacts — read out of the file, not copied into here.
 *
 * A hand-written copy of the list drifts the first day somebody adds a
 * nineteenth path: the suite still passes, because it is a test of the list it
 * was handed rather than of the list the logger uses. That is the vacuous-test
 * shape from silent-success.md — coverage measured against the wrong thing
 * agrees with the gap. Reading the array out of the source keeps the two the
 * same list, so a new path immediately gets a sentinel logged at it and has to
 * make that sentinel vanish.
 *
 * It parses text, and that is the honest cost of not exporting `REDACT`. The
 * module's public surface should not grow a member that exists only for a test,
 * and the array is a plain literal that has not moved since it was written.
 * Line comments are stripped first because there are several inside the array;
 * a double-quoted word inside one of those comments would fool this, which is
 * what "the parse found a plausible list" below exists to catch — a parse that
 * silently returns nothing is exactly a collector that matches nothing.
 */
function redactedPaths(): string[] {
  const source = readFileSync(LOG_MODULE, "utf8");
  const literal = /const REDACT = \[([\s\S]*?)\n\];/.exec(source)?.[1];
  if (literal === undefined) {
    throw new Error(`could not find the REDACT array in ${LOG_MODULE}`);
  }
  return [...literal.replace(/\/\/.*$/gm, "").matchAll(/"([^"]+)"/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
}

const REDACT_PATHS = redactedPaths();

/**
 * One sentinel per configured path. Distinct, so that no assertion can pass on
 * another path's value, and each one carries its own path so that a failure
 * names the leak rather than making you count commas.
 */
const PATH_SECRETS: ReadonlyArray<readonly [string, string]> = REDACT_PATHS.map((path, i) => [
  path,
  `redacted-${i}-${path.replace(/\W/g, "-")}-ZZZZ`,
]);

/** `{"a.b": v}` → `{ a: { b: v } }`, merging paths that share a prefix. */
function nest(into: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split(".");
  const leaf = parts.pop();
  // Only reachable from an empty path, which would mean the parse above went
  // wrong — so it says so rather than quietly building a fixture with a hole.
  if (leaf === undefined) throw new Error(`empty redact path in ${LOG_MODULE}`);
  let node = into;
  for (const part of parts) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[leaf] = value;
}

/** One object carrying a sentinel at every path `REDACT` names. */
const PATH_FIXTURE = ((): Record<string, unknown> => {
  const fixture: Record<string, unknown> = {};
  for (const [path, secret] of PATH_SECRETS) nest(fixture, path, secret);
  return fixture;
})();

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
function emit(
  scenario: { NODE_ENV: string; LOG_LEVEL?: string },
  body: string,
  // For the scenarios that end the process themselves. A child that exits on a
  // signal has no status to check, and one that calls `process.exit(0)` has an
  // ordinary one — so this only turns the check off, it never relaxes it.
  opts: { killsItself?: boolean } = {},
): string {
  const script = `import(${JSON.stringify(LOG_MODULE)}).then(({ log, errorFields }) => {\n${body}\n});`;
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.LOG_LEVEL;
  env.NODE_ENV = scenario.NODE_ENV;
  if (scenario.LOG_LEVEL) env.LOG_LEVEL = scenario.LOG_LEVEL;

  const child = spawnSync(TSX, ["-e", script], { env, encoding: "utf8" });
  if (!opts.killsItself && child.status !== 0) {
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
  // The same claim again, but derived from the module's own list rather than
  // from the hand-written one above — and its control, which is what stops the
  // derived half passing because the fixture came out empty. See the two tests
  // named after these messages.
  `log("jobs").info(${q(PATH_FIXTURE)}, "every configured redact path");`,
  `log("jobs").info({ notRedacted: ${q(PATH_FIXTURE)} }, "the same values somewhere unredacted");`,
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

/**
 * How many lines `BODY` puts on fd 1 — hand-counted on purpose.
 *
 * It is the vacuity guard for everything below: nearly every assertion here is
 * about the *absence* of a string from a collection, and a collection that came
 * back empty satisfies all of them at once. Deriving this from `BODY` would
 * make it agree with whatever went wrong, so it is a number a person wrote
 * down. If you add a log call to `BODY`, add one here too — and if that feels
 * annoying, that is the check doing its job.
 */
const EXPECTED_LINES = 13;

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

  it("found a plausible list of redacted paths to test against", () => {
    /* Runs first of the derived pair, because `redactedPaths` parses text and
       a regex that stops matching returns `[]` rather than complaining. Zero
       paths would make the next test pass while inspecting nothing at all.
       These are shape checks, not a second copy of the list: a count, and one
       path that has been in `REDACT` since the file was written. */
    expect(REDACT_PATHS.length).toBeGreaterThan(10);
    expect(REDACT_PATHS).toContain("apiKey");
    expect(REDACT_PATHS.every((path) => /^[\w$]+(\.[\w$]+)*$/.test(path))).toBe(true);
  });

  it("keeps out a secret at every path the module configures, not just the ones listed here", () => {
    /* The test above it covers a hand-picked object in realistic shapes, which
       is worth having and cannot stay complete: five paths were configured and
       never exercised for a while, `req.headers.authorization` among them —
       nested one level deeper than the `headers.*` pair, so the tests that
       passed said nothing about it.

       This one builds its fixture out of the module's own `REDACT` array, so
       "every path is covered" is true by construction rather than by somebody
       remembering. Add a path to `REDACT` and a sentinel appears at it here. */
    const line = lineFor(lines, "every configured redact path");
    for (const [path, secret] of PATH_SECRETS) {
      expect(line.raw, `${path} reached stdout as ${secret}`).not.toContain(secret);
    }
    expect(line.obj.msg).toBe("every configured redact path");
  });

  it("proves those sentinels would otherwise have been visible", () => {
    /* The control for the test above, and the reason it is not vacuous. Every
       assertion there is an absence, and a fixture builder that quietly
       produced `{}` — a bad path split, a rename, an empty parse — satisfies
       all of them. So the identical values are logged again one level down,
       under a key nothing redacts, and here they must ALL be present.

       It doubles as a second statement of rule 3's neighbour: `redact` paths
       are absolute, so `apiKey` at the top level is censored and the same key
       one level in is not. If a wildcard path is ever added this goes red,
       which is the right moment to re-read that decision rather than discover
       it later. */
    const line = lineFor(lines, "the same values somewhere unredacted");
    for (const [path, secret] of PATH_SECRETS) {
      expect(line.raw, `${path}'s sentinel never reached the line at all`).toContain(secret);
    }
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

/**
 * What happens to a line written just before the process stops.
 *
 * This is rule 2 in `src/log.ts` — `pino.destination({ sync: true })` — and the
 * reason it is a rule is Vercel: **a function freezes at response time**, so a
 * line sitting in a buffer waiting for the next turn of the event loop is a
 * line nobody ever reads. The lines lost are the ones at the end of a request,
 * which are the ones you wanted.
 *
 * The two tests below are deliberately a pair, because only the second one can
 * tell a synchronous destination from an asynchronous one. Read them together
 * before adding a third.
 */
describe("a line written just before the end", () => {
  const FIVE_LINES = [
    `const l = log("http");`,
    `for (let i = 0; i < 5; i++) l.info({ i }, "before the end " + i);`,
  ].join("\n");

  it("lands when the process exits in the same tick", () => {
    /* **This one stays green with `sync: true` removed, and saying so is the
       point of the comment.** Measured, 2026-08-25 on pino 10.3.1: when `sync`
       is false pino hands the destination to `on-exit-leak-free`, which
       registers a `process.on("exit")` handler that calls `flushSync()`.
       `process.exit(0)` fires that event, so the buffer is flushed on the way
       out and all five lines land either way — even eight megabytes of them.

       So it proves the guarantee (a line logged immediately before an orderly
       exit is not lost) without proving what provides it. That is worth
       pinning, and it is exactly the shape silent-success.md warns about if it
       is read as evidence for the setting: the check agrees with the bug,
       because a natural exit flushes both kinds of destination. The next test
       is the one that does not. */
    const lines = parse(
      emit({ NODE_ENV: "development" }, `${FIVE_LINES}\nprocess.exit(0);`, {
        killsItself: true,
      }),
    );
    expect(lines.map((line) => line.obj.msg)).toEqual([
      "before the end 0",
      "before the end 1",
      "before the end 2",
      "before the end 3",
      "before the end 4",
    ]);
  }, 60_000);

  it("lands even when nothing gets to run on the way out — this is what sync: true buys", () => {
    /* `sync: true` means the bytes are on file descriptor 1 by the time the
       log call returns, rather than in a buffer that some later flush will
       deal with. The way to see that difference is to take the later flush
       away, so the child SIGKILLs itself in the same tick: a signal that
       cannot be caught, that runs no `exit` handler, and that is the closest
       thing available here to a function frozen mid-request.

       Red-then-green, measured against a copy of `src/log.ts` with `sync: true`
       removed (2026-08-25, pino 10.3.1, macOS):

           sync: true          5 5 5 5 5 5 5 5   (lines received, eight runs)
           pino.destination({}) 1 1 1 1 1 1 1 1

       One rather than zero, because the first write is dispatched immediately
       and the other four are still in SonicBoom's buffer. Not a race: their
       release callback needs a turn of the event loop that never arrives. */
    const lines = parse(
      emit({ NODE_ENV: "development" }, `${FIVE_LINES}\nprocess.kill(process.pid, "SIGKILL");`, {
        killsItself: true,
      }),
    );
    expect(lines).toHaveLength(5);
    expect(lines.map((line) => line.obj.msg)).toContain("before the end 4");
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

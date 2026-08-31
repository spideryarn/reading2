/**
 * What a malformed JSON file puts in the log — src/parse-json.ts.
 *
 * **V8's own `JSON.parse` error message quotes the input back at you.** That is
 * the whole reason this file exists, and it is not a hypothetical:
 *
 *     JSON.parse("ZQCOMMENTS the reader's own sentence…")
 *     → SyntaxError: Unexpected token 'Z', "ZQCOMMENTS"... is not valid JSON
 *
 * Every artefact this app stores is either the article's prose or the reader's
 * own writing, so those quoted characters are exactly the thing
 * docs/project/logging.md § What never gets logged says never goes in a line.
 * And a `SyntaxError` reaches the log twice over — `safeError` in src/log.ts
 * keeps `message` *and* `stack`, and the message is embedded in the stack.
 *
 * Two details make it worse than "about ten characters", both measured on
 * node v26.7.0 rather than assumed:
 *
 * - Up to twenty characters the input is quoted **in full**, with no ellipsis.
 *   A short corrupt file, or a short model refusal, is echoed whole.
 * - It fires when the content is malformed *from the start*, which is precisely
 *   what a truncated write and a model that answered in prose both look like.
 *
 * The other message shape — `Expected ':' after property name … at position 37`
 * — leaks nothing at all, because it is positional. So the target is narrow:
 * keep the offset, drop the quotation.
 *
 * ## Why these tests assert on absence, in a child process
 *
 * They assert the sentinel is **absent from the emitted bytes**, which is a
 * stronger claim than "the helper was called" — a helper that ran on a copy, or
 * a call site that was missed in one of six files, satisfies the second and not
 * the first. Same reasoning as tests/log.test.ts, and the same mechanism for the
 * same reason: src/log.ts builds its logger at import time, is `silent` when
 * `NODE_ENV=test`, and writes to file descriptor 1 with `fs.writeSync` rather
 * than through `process.stdout.write`. Stubbing `process.stdout` in-process
 * would capture nothing and prove nothing.
 *
 * Each sentinel is exactly ten characters and unique, because ten is what V8
 * quotes once the input is long enough to truncate. A sentinel that shared a
 * prefix with another could let one site's assertion pass on another site's
 * bytes.
 */
import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MalformedJson, parseJsonFrom, readJsonOrNull, stripFence } from "../src/parse-json.js";

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Two throwaway directories under the gitignored `data/`, removed afterwards.
 *
 * Two rather than one, because `data/` is shared with every other suite and
 * `listArticles` walks the whole of it on every call — so a corrupt artefact
 * left lying there fails `tests/library.test.ts` in a *different worker*, which
 * is a flaky test blaming the wrong file.
 *
 * `STORE_SLUG` is `_`-prefixed, which is how src/api.ts already says "not an
 * article" (`data/_jobs/` is the queue's). `listArticles` skips those by name,
 * so the three corrupt reader-state files in it are invisible to the shelf.
 *
 * `ARTICLE_SLUG` cannot use that trick, because `loadArticle` requires a real
 * slug (`isSlug` in src/ingest.ts forbids `_`). So it is a **complete, valid
 * copy of `example/` with only `arc.json` corrupted** — chosen because
 * `describeDir` reads blocks.json, tree.json and meta.json and never reads
 * arc.json, while `loadArticle` reads all four. The shelf therefore sees an
 * ordinary article and the parse only blows up on the path being tested.
 */
const STORE_SLUG = "_test-parse-json";
const STORE_DIR = path.join(ROOT, "data", STORE_SLUG);
const ARTICLE_SLUG = "test-parse-json-article";
const ARTICLE_DIR = path.join(ROOT, "data", ARTICLE_SLUG);
const EXAMPLE = path.join(ROOT, "example");

/** A module of `src/`, as a quoted absolute path for the child's `import()`. */
const src = (name: string) => JSON.stringify(path.join(ROOT, "src", name));

/**
 * Ten characters each — the number V8 quotes — and no two sharing a prefix.
 *
 * They stand in for what each file really holds: the article's own text in
 * `blocks.json`, the reader's questions in `comments.json`, their conversation
 * in `chat.json`, what they went looking for in `searches.json`, and whatever a
 * model said back.
 *
 * `arc` is `arc.json` read by `loadArticle` in src/api.ts; `blocks` is the
 * `blocks.json` that `readArticleFromDir` parses for the arc command line.
 */
const LEAK = {
  arc: "ZQARCJSONA",
  blocks: "ZQBLOCKSAA",
  comments: "ZQCOMMENTS",
  chat: "ZQCHATBBBB",
  searches: "ZQSEARCHES",
  model: "ZQMODELDDD",
} as const;

/**
 * A file that is malformed from its first byte and long enough to be truncated.
 *
 * Both halves matter. Malformed from the start is what picks the "Unexpected
 * token" message shape rather than the harmless positional one, and over twenty
 * characters is what makes V8 quote a ten-character prefix instead of the lot —
 * so the sentinel lands at exactly the offset the assertions look for.
 */
const corrupt = (sentinel: string) =>
  `${sentinel} and then the rest of the private text, cut off mid-`;

/**
 * How many lines the six scenarios put on fd 1, counted rather than guessed.
 *
 * The four store loaders each log for themselves *and* rethrow, so the step
 * wrapper below logs each of them a second time — which is the doubling
 * logging.md warns about, visible here as arithmetic. The two stage scenarios
 * log once, from the wrapper, because neither stage file touches the logger.
 *
 * It exists to stop the assertions being vacuous: "the sentinel is absent" is
 * satisfied perfectly by a child that crashed before printing anything.
 */
const EXPECTED_LINES = 4 * 2 + 1 + 1;

let stdout = "";

beforeAll(async () => {
  await mkdir(STORE_DIR, { recursive: true });
  await Promise.all([
    // Reader state, plus a blocks.json for the stage scenario to read. None of
    // it is visible to `listArticles`, because the directory is `_`-prefixed.
    writeFile(path.join(STORE_DIR, "blocks.json"), corrupt(LEAK.blocks), "utf8"),
    writeFile(path.join(STORE_DIR, "comments.json"), corrupt(LEAK.comments), "utf8"),
    writeFile(path.join(STORE_DIR, "chat.json"), corrupt(LEAK.chat), "utf8"),
    writeFile(path.join(STORE_DIR, "searches.json"), corrupt(LEAK.searches), "utf8"),
  ]);

  // A whole valid article, with one optional artefact corrupted. See the note
  // on ARTICLE_SLUG: this is what keeps the shelf working while the read under
  // test still fails.
  await cp(EXAMPLE, ARTICLE_DIR, { recursive: true });
  await writeFile(path.join(ARTICLE_DIR, "arc.json"), corrupt(LEAK.arc), "utf8");

  /* One child, six scenarios, because a child costs a few hundred milliseconds
     and none of these needs its own environment.

     The two stage scenarios log the way src/jobs.ts logs a failed step —
     `errorFields(err)` on the error that came out of the stage — because that is
     the reachable path. Neither stage file calls the logger itself, and that is
     the trap this whole class hides in: an error is a value that travels, and
     where it is thrown is not where it is written down. */
  /* An async IIFE, not top-level await: `tsx -e` compiles to CJS, where a
     top-level await is a build error rather than a test failure — and a build
     error here would fail the fixture check below for a reason that has nothing
     to do with what is being measured. */
  const body = `void (async () => {
    const { log, errorFields } = await import(${src("log.ts")});
    const jobs = log("jobs");
    const step = async (name, run) => {
      try { await run(); } catch (err) {
        jobs.error({ ...errorFields(err), step: name }, "step failed: " + name);
      }
    };

    const { loadArticle } = await import(${src("api.ts")});
    const { loadComments } = await import(${src("comments.ts")});
    const { loadThreads } = await import(${src("chat.ts")});
    const { loadRuns } = await import(${src("searches.ts")});
    const { generateArc } = await import(${src("arc.ts")});
    const { readArticleFromDir } = await import(${src("article-input.ts")});
    const { parseJsonFrom, stripFence } = await import(${src("parse-json.ts")});

    // These four log for themselves, then rethrow.
    await step("read", () => loadArticle(${JSON.stringify(ARTICLE_SLUG)}));
    await step("comments", () => loadComments(${JSON.stringify(STORE_SLUG)}));
    await step("chat", () => loadThreads(${JSON.stringify(STORE_SLUG)}));
    await step("searches", () => loadRuns(${JSON.stringify(STORE_SLUG)}));

    /* A stage reading an artefact — as \`npx tsx src/arc.ts <dir>\` does it.
       \`generateArc\` no longer opens anything itself (the pipeline hands it an
       article the store read); the read moved to \`readArticleFromDir\`, whose
       very first statement parses blocks.json. So this still never reaches a
       model or needs a key, and it is still the reachable path — the CLI is now
       the caller that meets a corrupt blocks.json. */
    await step("arc", async () =>
      generateArc({ article: await readArticleFromDir(${JSON.stringify(STORE_DIR)}) }),
    );

    /* A stage reading a *model's* answer — the same leak from the other side.
       Called through \`stripFence\` then \`parseJsonFrom\`, which is exactly what
       every stage's own private \`parseJson\` does (src/glossary.ts, src/arc.ts,
       src/toc.ts, src/tweets.ts, src/quotes.ts — none of them exports it). It
       used to go through src/summarise.ts, the one that did; that module is
       gone (docs/plans/gist-only-summaries.md) and this is the same two calls
       without the wrapper. */
    await step("glossary-answer", async () =>
      parseJsonFrom(stripFence(${JSON.stringify(corrupt(LEAK.model))}), "the glossary response"),
    );
  })();`;

  const env: NodeJS.ProcessEnv = { ...process.env };
  // The suite's own LOG_LEVEL must not decide what this test measures, and
  // "test" would make the logger silent — which would turn every assertion
  // below green while proving nothing at all.
  delete env.LOG_LEVEL;
  env.NODE_ENV = "development";

  const child = spawnSync(TSX, ["-e", body], { env, encoding: "utf8" });
  stdout = child.stdout;

  /* A child that wrote nothing would pass every "does not contain" assertion
     below, which is the vacuous-test shape in docs/reusable/silent-success.md.
     So the fixture proves it is measuring something before anything measures
     it: six lines went in, six lines have to come out. */
  const lines = stdout.split("\n").filter((l) => l.trim() !== "");
  if (lines.length !== EXPECTED_LINES) {
    throw new Error(
      `expected ${EXPECTED_LINES} log lines from the child, got ${lines.length}` +
        `\n--- fixture ${STORE_DIR}: ${(await readdir(STORE_DIR)).join(", ")}` +
        `\n--- fixture ${ARTICLE_DIR}: ${(await readdir(ARTICLE_DIR)).join(", ")}` +
        `\n--- stdout ---\n${stdout}\n--- stderr ---\n${child.stderr}`,
    );
  }
}, 60_000);

afterAll(async () => {
  await rm(STORE_DIR, { recursive: true, force: true });
  await rm(ARTICLE_DIR, { recursive: true, force: true });
});

describe("a malformed artefact in the log", () => {
  it.each(Object.entries(LEAK))("does not quote the contents of %s", (_name, sentinel) => {
    expect(stdout).not.toContain(sentinel);
  });

  it("still says which artefact it was, so the line is worth having", () => {
    // Absence on its own is satisfied by logging nothing. The line has to keep
    // naming the file, which is the only reason anybody reads it.
    expect(stdout).toContain("comments.json");
    expect(stdout).toContain("blocks.json");
    expect(stdout).toContain("chat.json");
    expect(stdout).toContain("searches.json");
  });
});

/**
 * The helper itself. These are in-process because they are about the error's
 * shape rather than about bytes on a file descriptor.
 */
describe("parseJsonFrom", () => {
  it("parses valid JSON unchanged", () => {
    expect(parseJsonFrom<{ a: number }>('{"a":1}', "x.json")).toEqual({ a: 1 });
  });

  it("names the source and drops the quoted content", () => {
    const err = grab(() => parseJsonFrom("ZQHELPERAA is not JSON at all", "comments.json for abc"));
    expect(err).toBeInstanceOf(MalformedJson);
    expect(err.message).toContain("comments.json for abc");
    expect(err.message).not.toContain("ZQHELPERAA");
  });

  it("does not carry the original error as `cause`", () => {
    // src/log.ts follows `cause` chains deliberately, so wrapping the
    // SyntaxError — the reflex fix — would put the quotation straight back in
    // the log under a different key. This is the assertion that stops that.
    const err = grab(() => parseJsonFrom("ZQHELPERBB nope", "x.json"));
    expect(err.cause).toBeUndefined();
    expect(JSON.stringify({ message: err.message, stack: err.stack })).not.toContain("ZQHELPERBB");
  });

  it("keeps the byte offset, which is positional and gives nothing away", () => {
    const err = grab(() => parseJsonFrom('{"a" 1}', "x.json"));
    expect(err.message).toMatch(/position 5/);
  });

  it("says a truncated file is truncated, rather than guessing", () => {
    // Genuinely cut off — an unterminated string, which is what a killed
    // process mid-`writeFile` leaves behind. V8 answers "Unexpected end of JSON
    // input" here, which is the one message shape that says *why* rather than
    // showing you the text.
    const err = grab(() => parseJsonFrom('{"a": "ZQHELPERCC', "x.json"));
    expect(err.message).not.toContain("ZQHELPERCC");
    expect(err.message).toMatch(/cut off|ends part-way/i);
  });

  it("says an empty file is empty", () => {
    expect(grab(() => parseJsonFrom("   ", "x.json")).message).toMatch(/empty/i);
  });

  it("distinguishes a response that was never JSON from one that broke part-way", () => {
    // The diagnosis a developer actually wants from a model that answered in
    // prose — without the prose. See src/parse-json.ts on what was traded away.
    const prose = grab(() => parseJsonFrom("I'm sorry, ZQHELPERDD", "the summary response"));
    expect(prose.message).toMatch(/does not begin/i);
    expect(prose.message).not.toContain("ZQHELPERDD");
  });

  it("carries a greppable code rather than relying on the wording", () => {
    // `code` is on src/log.ts's SAFE_ERROR_PROPS allowlist, so it survives into
    // the line; the message wording is not a thing to build a filter on.
    expect(grab(() => parseJsonFrom("nope", "x.json")).code).toBe("malformed_json");
  });
});

/** The error a thunk threw, or a failure saying it threw nothing. */
function grab(run: () => unknown): MalformedJson {
  try {
    run();
  } catch (err) {
    if (err instanceof MalformedJson) return err;
    throw err;
  }
  throw new Error("expected a MalformedJson, but nothing was thrown");
}

/* -------------------------------------------------------------- stripFence --
   Eight stage files each had their own fence-stripper, in two spellings:
   `.replace(/```$/, "").trim()` and `.replace(/\s*```$/, "")`. Before unifying
   them, both were run against every awkward input below and agreed on all of
   them, so the divergence was accidental and this is a pure dedup.

   The comparison is kept here rather than thrown away, because the claim it
   supports ("no behaviour change") is the only thing standing between this and
   a silent regression. `OLD_A` and `OLD_B` are the two spellings exactly as
   they were in the tree; if a future edit to `stripFence` moves it away from
   either, the tests below say so with the input that separated them. */

const F = "```";
const OLD_A = (raw: string) =>
  raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
const OLD_B = (raw: string) =>
  raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

/** Every input the two spellings were compared on. */
const AWKWARD: ReadonlyArray<readonly [string, string]> = [
  ["a bare fence", `${F}\n{"a":1}\n${F}`],
  ["a json fence", `${F}json\n{"a":1}\n${F}`],
  ["an uppercase JSON fence", `${F}JSON\n{"a":1}\n${F}`],
  ["CRLF line endings", `${F}json\r\n{"a":1}\r\n${F}`],
  ["backticks inside a string", `${F}json\n{"a":"see ${F} here"}\n${F}`],
  ["a missing close fence", `${F}json\n{"a":1}`],
  ["prose before", `Here you go:\n${F}json\n{"a":1}\n${F}`],
  ["prose after", `${F}json\n{"a":1}\n${F}\nHope that helps!`],
  ["no fence at all", `{"a":1}`],
  ["a fence with no newlines", `${F}json {"a":1} ${F}`],
  ["trailing spaces after the close", `${F}json\n{"a":1}\n${F}   `],
  ["a fourth backtick on the close", `${F}json\n{"a":1}\n${F}\``],
  ["leading whitespace before the fence", `  \n ${F}json\n{"a":1}\n${F}`],
  ["nothing at all", ""],
  ["only a fence", F],
  ["a fence around nothing", `${F}json\n\n${F}`],
  ["an indented close fence", `${F}json\n{"a":1}\n  ${F}`],
  ["a fence line inside a string", `${F}json\n{"a":"x\\n${F}\\ny"}\n${F}`],
];

describe("stripFence", () => {
  it("agrees with both spellings it replaced, on every awkward input", () => {
    for (const [name, input] of AWKWARD) {
      expect(stripFence(input), `${name}: differs from the .trim() spelling`).toBe(OLD_A(input));
      expect(stripFence(input), `${name}: differs from the \\s* spelling`).toBe(OLD_B(input));
    }
  });

  it("the comparison above can actually fail", () => {
    /* Without this the loop is a claim about a function compared with itself.
       A stripper that only trims agrees with `stripFence` on "no fence at all"
       and disagrees everywhere a fence exists — so if this ever stops throwing,
       the loop above has stopped comparing anything.
       docs/reusable/silent-success.md § Test the test. */
    const onlyTrims = (raw: string) => raw.trim();
    const fenced = AWKWARD.filter(([, input]) => input.includes(F) && input.trim() !== F);
    expect(fenced.length).toBeGreaterThan(10);
    for (const [name, input] of fenced) {
      expect(onlyTrims(input), `${name} should have been changed by stripping`).not.toBe(
        stripFence(input),
      );
    }
  });

  it("takes the fence off and leaves the JSON parseable", () => {
    expect(JSON.parse(stripFence(`${F}json\n{"a":1}\n${F}`))).toEqual({ a: 1 });
    expect(JSON.parse(stripFence(`{"a":1}`))).toEqual({ a: 1 });
  });

  it("leaves prose before the object alone, because parseHits needs it there", () => {
    /* src/search.ts is the one caller that hunts for the first `{` itself, and
       it can only do that if this has not already thrown the prose away. */
    expect(stripFence(`Here you go:\n${F}json\n{"a":1}\n${F}`)).toContain("Here you go:");
  });
});

/* ---------------------------------------------------------- readJsonOrNull -- */

describe("readJsonOrNull", () => {
  it("reads a JSON artefact", async () => {
    const dir = path.join(STORE_DIR, "read-json-or-null");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "ok.json");
    await writeFile(file, JSON.stringify({ a: 1 }));
    expect(await readJsonOrNull<{ a: number }>(file)).toEqual({ a: 1 });
  });

  it("answers null for missing and for corrupt alike", async () => {
    const dir = path.join(STORE_DIR, "read-json-or-null");
    await mkdir(dir, { recursive: true });
    const corrupt = path.join(dir, "corrupt.json");
    await writeFile(corrupt, '{"a": "ZQREADJSON');
    expect(await readJsonOrNull(corrupt)).toBeNull();
    expect(await readJsonOrNull(path.join(dir, "absent.json"))).toBeNull();
  });

  it("throws nothing, so V8's quotation of the file never reaches a log", async () => {
    /* The whole justification for a bare `JSON.parse` living in this module.
       The marker is what a corrupt artefact's first characters would be, and
       the point is that nothing anywhere can be handed them. */
    const dir = path.join(STORE_DIR, "read-json-or-null");
    await mkdir(dir, { recursive: true });
    const corrupt = path.join(dir, "quoted.json");
    await writeFile(corrupt, "ZQREADJSONLEAK is not JSON at all");
    await expect(readJsonOrNull(corrupt)).resolves.toBeNull();
  });
});

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
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MalformedJson,
  objectEnd,
  parseJsonAnswer,
  parseJsonFrom,
  readJsonOrNull,
  stripFence,
} from "../src/parse-json.js";

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * One throwaway directory under the gitignored `data/`, removed afterwards.
 *
 * `STORE_SLUG` is `_`-prefixed, which is how the reader-state modules already
 * say "not an article" (`data/_jobs/` is the queue's). `assertSlug` in
 * src/slug.ts admits the prefix precisely so that reader state can be asked
 * about such a name, and it names `loadComments("_test-parse-json")` — this
 * directory — as the reason it stays looser than `isSlug`.
 *
 * **There were two directories until 2026-09-05**, and the second was a
 * complete copy of `example/` with `arc.json` corrupted, because `loadArticle`
 * in `src/api.ts` demanded a real slug and walked a real article. That file was
 * the *filesystem article reader* and was deleted with the filesystem store
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * the stage-G section), so the copy went with it.
 *
 * **The fourth store loader changed twice on the same day**, and the second
 * change is the one worth knowing about. It was briefly `loadClaimsRun`, which
 * was itself deleted hours later when `src/referee-claims-store.ts` went — the
 * whole filesystem claims store. It is `loadShelf` now, which has live callers:
 * `tests/helpers/seed-reader-state.ts` and `tests/store-parity.test.ts` read a
 * fixture's `shelf.json` through it to seed the columns Postgres keeps.
 *
 * **That is the property this file is careful about.** The claim here is about
 * what reaches a *log line*, so it has to be driven by something that logs —
 * a direct call to `parseJsonFrom` satisfies "the helper was called" and not
 * "the sentinel is absent from the bytes on fd 1". Each of the four loaders
 * below is a function something still calls, and if a later group deletes one,
 * the honest repair is to repoint the scenario at another live caller that logs
 * — not to drop the case, and not to demote it to a unit test.
 */
const STORE_SLUG = "_test-parse-json";
const STORE_DIR = path.join(ROOT, "data", STORE_SLUG);

/** A module of `src/`, as a quoted absolute path for the child's `import()`. */
const src = (name: string) => JSON.stringify(path.join(ROOT, "src", name));

/** The same, for a module of `tests/helpers/`. */
const helper = (name: string) => JSON.stringify(path.join(ROOT, "tests", "helpers", name));

/**
 * Ten characters each — the number V8 quotes — and no two sharing a prefix.
 *
 * They stand in for what each file really holds: the article's own text in
 * `blocks.json`, the reader's questions in `comments.json`, their conversation
 * in `chat.json`, what they went looking for in `searches.json`, and whatever a
 * model said back.
 *
 * `shelf` is `shelf.json` read by `loadShelf` in src/shelf.ts — the title a
 * reader typed over the extractor's, which is short, is theirs, and is the one
 * V8 would quote back **whole**, because under twenty characters there is no
 * ellipsis. `blocks` is the `blocks.json` that `readArticleFromDir` parses for
 * an eval (tests/helpers/article-from-dir.ts).
 */
const LEAK = {
  shelf: "ZQSHELFAAA",
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
    writeFile(path.join(STORE_DIR, "shelf.json"), corrupt(LEAK.shelf), "utf8"),
  ]);

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

    const { loadShelf } = await import(${src("shelf.ts")});
    const { loadComments } = await import(${src("comments.ts")});
    const { loadThreads } = await import(${src("chat.ts")});
    const { loadRuns } = await import(${src("searches.ts")});
    const { generateArc } = await import(${src("arc.ts")});
    const { readArticleFromDir } = await import(${helper("article-from-dir.ts")});
    const { parseJsonFrom, stripFence } = await import(${src("parse-json.ts")});

    // These four log for themselves, then rethrow.
    await step("shelf", () => loadShelf(${JSON.stringify(STORE_SLUG)}));
    await step("comments", () => loadComments(${JSON.stringify(STORE_SLUG)}));
    await step("chat", () => loadThreads(${JSON.stringify(STORE_SLUG)}));
    await step("searches", () => loadRuns(${JSON.stringify(STORE_SLUG)}));

    /* A stage reading an artefact off a folder — which is what an eval does.
       \`generateArc\` no longer opens anything itself (the pipeline hands it an
       article the store read); the read moved to \`readArticleFromDir\`, whose
       very first statement parses blocks.json. So this still never reaches a
       model or needs a key. The eight stage CLIs that used to be this caller
       were deleted on 2026-09-01 and the function moved to
       tests/helpers/article-from-dir.ts, where the evals reach it; what is
       being measured — a corrupt blocks.json must not reach a log — is
       unchanged, and \`evals/quiz.ts\` and \`evals/sketch/run.ts\` are the two
       live callers it now stands for. */
    await step("arc", async () =>
      generateArc({ article: await readArticleFromDir(${JSON.stringify(STORE_DIR)}) }),
    );

    /* A stage reading a *model's* answer — the same leak from the other side.
       Called through \`stripFence\` then \`parseJsonFrom\`, which is exactly what
       every stage's own private \`parseJson\` does (src/glossary.ts, src/arc.ts,
       src/hierarchy.ts, src/tweets.ts, src/quotes.ts — none of them exports it). It
       used to go through src/summarise.ts, the one that did; that module is
       gone (docs/plans/260831s-gist-only-summaries.md) and this is the same two calls
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
        `\n--- stdout ---\n${stdout}\n--- stderr ---\n${child.stderr}`,
    );
  }
}, 60_000);

afterAll(async () => {
  await rm(STORE_DIR, { recursive: true, force: true });
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
    expect(stdout).toContain("shelf.json");
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

  it("says a complete document with material after it is exactly that", () => {
    /* Stage 3 of docs/plans/260903k. *"It breaks at position 5409 of 13547
       characters"* is what the hierarchy failure said, and it is
       indistinguishable from a syntax error part-way through a document — so it
       sent that diagnosis chasing a token ceiling for half an hour, when in
       fact the tree was whole and 8,138 characters of something else followed
       it. Nothing keeps the response (§ `raw_response` is gone, src/db/schema.ts),
       so this sentence is the whole of what a future debugger gets. */
    const err = grab(() => parseJsonFrom('{"a":1} and then ZQHELPEREE', "the model's answer"));
    expect(err.message).toMatch(/complete/i);
    expect(err.message).not.toMatch(/breaks at position/);
    /* And the branch answers its question with a `JSON.parse` of its own, whose
       error quotes the prefix. That error must go nowhere: no `cause`, nothing
       in the message, nothing in the stack — the same guarantee as
       `readJsonOrNull`, for the same reason. */
    expect(err.cause).toBeUndefined();
    expect(JSON.stringify({ message: err.message, stack: err.stack })).not.toContain("ZQHELPEREE");
  });

  it("does not mistake a syntax error part-way through for material after the end", () => {
    /* The precision guard on the branch above. A sentence that fired on
       anything carrying an offset would be worse than the one it replaced,
       because it would be confidently wrong rather than merely vague. */
    const err = grab(() => parseJsonFrom('{"a" 1, "b": 2} extra', "the model's answer"));
    expect(err.message).toMatch(/breaks at position/);
    expect(err.message).not.toMatch(/complete/i);
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
    /* `parseHits` in src/search.ts and `parseJsonAnswer` in src/parse-json.ts
       both hunt for the first `{` themselves, and neither can do that if this
       has already thrown the prose away. */
    expect(stripFence(`Here you go:\n${F}json\n{"a":1}\n${F}`)).toContain("Here you go:");
  });
});

/* ------------------------------------------------------------- objectEnd -- */

describe("objectEnd", () => {
  it("stops at the first structure's own close, ignoring everything after it", () => {
    expect(objectEnd(`{"a":1}`)).toBe(6);
    expect(objectEnd(`{"a":1} and then some prose {`)).toBe(6);
    expect(objectEnd(`[1,2,3] and then some prose`)).toBe(6);
    expect(objectEnd(`{"a":{"b":[1]}}x`)).toBe(14);
  });

  it("does not count braces inside a string, which is the whole reason it exists", () => {
    /* A naive depth count, or a `lastIndexOf("}")`, gets both of these wrong —
       and the second one is what a gist quoting the article looks like. */
    expect(objectEnd(`{"gist":"} not the end","n":2} after`)).toBe(29);
    expect(objectEnd(`{"gist":"say \\"}\\" out loud","n":2} after`)).toBe(34);
  });

  it("answers -1 when the structure never closes, which is the cut-off case", () => {
    expect(objectEnd(`{"a": "unterminated`)).toBe(-1);
    expect(objectEnd(`{"a":[1,2`)).toBe(-1);
  });
});

/* -------------------------------------------------------- parseJsonAnswer --
   Eleven stages used to spell `parseJsonFrom(stripFence(raw), …)`, which
   assumes the model's JSON *is* the whole response. On 2026-09-03 the
   hierarchy and timeline steps both died in production because it is not:
   prose before the fence in one, 8,138 characters after a complete tree in the
   other. docs/plans/260903k-model-json-answer-extraction-in-the-shared-parse-seam.md. */

/** The two production shapes, and the neighbours they sit between. */
const WRAPPED: ReadonlyArray<readonly [string, string]> = [
  // The timeline failure: the fence is not at index 0, so nothing is stripped
  // and the first character is a letter.
  ["prose before a fenced document", `Here you go:\n${F}json\n{"a":1}\n${F}`],
  // The hierarchy failure: the close fence is not at the very end, so it
  // survives `stripFence` and lands after a complete document.
  ["a close fence followed by prose", `${F}json\n{"a":1}\n${F}\nHope that helps!`],
  ["a complete document followed by prose", `{"a":1}\n\nLet me know if I can help.`],
  ["a fourth backtick on the close fence", `${F}json\n{"a":1}\n${F}\``],
  ["prose on both sides of the fence", `Sure:\n${F}\n{"a":1}\n${F}\nThat's the lot.`],
];

describe("parseJsonAnswer", () => {
  it.each(WRAPPED)("digs the document out of %s", (_name, raw) => {
    expect(parseJsonAnswer<{ a: number }>(raw, "the model's answer")).toEqual({ a: 1 });
  });

  it("does not let a brace inside a string value end the document early", () => {
    /* The case that makes string-aware scanning necessary rather than
       decorative: every gist, quote and glossary definition is article prose,
       and article prose contains braces. A depth counter that ignored strings
       would cut this document off at the `}` inside the gist. */
    const raw = `{"gist":"a } and a { in the prose","n":2}\n\nDone.`;
    expect(parseJsonAnswer(raw, "the model's answer")).toEqual({
      gist: "a } and a { in the prose",
      n: 2,
    });
  });

  it("parses everything that parsed before, and identically", () => {
    /* The compatibility floor. `AWKWARD` is the eighteen inputs `stripFence`
       was pinned against; every one of them that `JSON.parse(stripFence(…))`
       accepts today must come out of `parseJsonAnswer` with the same value. */
    for (const [name, input] of PARSED_BEFORE) {
      expect(parseJsonAnswer(input, "the model's answer"), `${name}: changed`).toEqual(
        JSON.parse(stripFence(input)),
      );
    }
  });

  it("actually does more than the two lines it replaces", () => {
    /* Test the test — docs/reusable/silent-success.md. The floor above is
       satisfied perfectly by a function that is still just
       `parseJsonFrom(stripFence(raw), …)`, so this says the opposite thing:
       there are inputs the old spelling threw on and this one reads. */
    expect(PARSED_BEFORE.length).toBeGreaterThan(8);
    for (const [name, raw] of WRAPPED) {
      expect(() => JSON.parse(stripFence(raw)), `${name}: the old spelling handled this`).toThrow();
    }
  });

  it("still throws MalformedJson on a genuine syntax error, with no content", () => {
    const err = grab(() =>
      parseJsonAnswer(`${F}json\n{"a" 1, "note":"ZQANSWERAA"}\n${F}`, "the model's answer"),
    );
    expect(err).toBeInstanceOf(MalformedJson);
    expect(err.message).toContain("the model's answer");
    expect(err.message).not.toContain("ZQANSWERAA");
    // src/log.ts follows `cause` chains, so a wrapped SyntaxError would put
    // V8's quotation back into the line. Same assertion as for `parseJsonFrom`.
    expect(err.cause).toBeUndefined();
    expect(JSON.stringify({ message: err.message, stack: err.stack })).not.toContain("ZQANSWERAA");
  });

  it("still says a truncated answer was cut off, rather than something else", () => {
    /* The token ceiling, which is a real and different failure: the stages
       check `stop_reason` first, but a stream that stopped for any other
       reason mid-object arrives here. Extraction must not turn "it never
       closed" into "it broke at an offset". */
    const err = grab(() =>
      parseJsonAnswer(`${F}json\n{"events": [{"when": "ZQANSWERBB`, "the model's answer"),
    );
    expect(err.message).toMatch(/cut off|ends part-way/i);
    expect(err.message).not.toContain("ZQANSWERBB");
  });

  it("says an answer that was never JSON was never JSON", () => {
    const err = grab(() => parseJsonAnswer("I'm sorry, ZQANSWERCC", "the model's answer"));
    expect(err.message).toMatch(/does not begin/i);
    expect(err.message).not.toContain("ZQANSWERCC");
  });

  /* ------------------------------------------------ ambiguity is a failure --
     The rule these five share: **an answer this cannot read unambiguously
     throws, and never picks.** Picking the first document is the easy version
     and it is the one that had to be deleted — see `parseJsonAnswer` in
     src/parse-json.ts § Why the third one, and docs/reusable/silent-success.md.
     A refusal costs the reader a Retry click; a wrong pick corrupts an artefact
     and says nothing. */

  it("refuses two complete documents rather than choosing between them", () => {
    // Deliberately not `{ a: 1 }`. This test replaces one that asserted
    // exactly that, which a cross-family review rejected before it shipped.
    grab(() => parseJsonAnswer(`{"a":1}\n\nOr perhaps:\n{"a":2}`, "the model's answer"));
  });

  it("refuses a discarded first attempt followed by the real answer", () => {
    /* The counterexample that decided the policy, in the stage where it does
       most damage. src/timeline.ts treats zero events as a legitimate result,
       so "take the first document" stores an article with no timeline, tells
       nobody, and the reader never learns the answer was thrown away. */
    const raw = `I first considered {"events":[]}.\nFinal answer:\n{"events":[{"when":"1787"}]}`;
    const err = grab(() => parseJsonAnswer(raw, "the model's answer"));
    expect(err).toBeInstanceOf(MalformedJson);
    /* And the sentence has to be worth reading, because nothing keeps the
       response: this shape reaches `diagnose` as a complete document plus
       trailing material, which is exactly what it is. */
    expect(err.message).not.toContain("1787");
  });

  it("refuses one complete document followed by a truncated second one", () => {
    // The other half of the same shape: `{"events":[]}` is whole and `{"events":[`
    // is not, so a first-document rule would store the empty one as the answer.
    grab(() => parseJsonAnswer(`{"events":[]}\nActually:\n{"events":[`, "the model's answer"));
  });

  it("refuses a valid JSON fragment in the preamble ahead of the real document", () => {
    /* Not the same shape as the two above: here the fragment is a plausible
       *example*, not a rejected attempt. Both have to fail, and for the same
       reason — nothing in the response says which one the model meant. */
    const raw = `The shape is {"a":0} — here is the answer:\n${F}json\n{"a":1}\n${F}`;
    const err = grab(() => parseJsonAnswer(raw, "the model's answer"));
    expect(err).toBeInstanceOf(MalformedJson);
  });

  it("refuses an unclosed brace in the preamble, rather than guessing which brace opens the answer", () => {
    /* The policy stated as a test name, because the alternative is tempting:
       walk on to the *next* `{` and try again. That is an unbounded number of
       parses of a whole answer, and every extra candidate is another chance to
       return something the model did not mean. `objectEnd` says -1 here — the
       scan from the stray brace never balances — and -1 is a refusal. */
    const raw = `Note that the shape is {like this\n${F}json\n{"a":1}\n${F}`;
    expect(grab(() => parseJsonAnswer(raw, "the model's answer"))).toBeInstanceOf(MalformedJson);
  });

  it("refuses an array-rooted document rather than returning an object from inside it", () => {
    /* The same class as the bug this whole change fixes, one level down, and it
       survived the first version of the fix. The answer here is the ARRAY; the
       first `{` is inside it, `objectEnd` closes on that inner object, and no
       second `{` exists to trip the ambiguity check — so the helper handed back
       `{"a":1}`, a sub-value of the intended document, successfully.
       `[{"a":1},{"a":2}]` threw only by luck, because it happens to contain a
       second `{`. A `[` before the first `{` is now a refusal. */
    const raw = `${F}json\n[{"a":1}]\n${F}\n\nNote.`;
    expect(grab(() => parseJsonAnswer(raw, "the model's answer"))).toBeInstanceOf(MalformedJson);
  });

  it("leaves a bare array root exactly as it was, since step one parses the response whole", () => {
    // No trailing material, so extraction is never reached and today's
    // behaviour stands. The refusal above is about *digging into* an array.
    expect(parseJsonAnswer(`[{"a":1}]`, "the model's answer")).toEqual([{ a: 1 }]);
  });

  it("still reads a document followed by prose containing a footnote marker", () => {
    /* The other half of a deliberate asymmetry: a `[` **before** the first `{`
       is a refusal, a `[` **after** the span is ignored. A model's closing
       remark about an article is full of `[1]`, and refusing on those would
       throw away the main shape this change exists to read. */
    expect(parseJsonAnswer(`{"a":1}\n\nSee [1] and [2] for the sources.`, "x")).toEqual({ a: 1 });
  });

  it("does not go hunting for a root array, because no caller asks for one", () => {
    /* All eleven prompts ask for a root object — `{"arc":…}`, `{"root":…}`,
       `{"labels":…}`, `{"tweets":…}`. Scanning for `[` as well would buy
       nothing and would latch onto the `[1]` of a footnote marker in a
       preamble, which articles are full of. A bare array with nothing around it
       still parses, because step one parses the response whole. */
    expect(parseJsonAnswer(`[1,2,3]`, "the arc response")).toEqual([1, 2, 3]);
    const trailing = grab(() => parseJsonAnswer(`[1,2,3]\nThat's it.`, "the arc response"));
    expect(trailing).toBeInstanceOf(MalformedJson);
    const footnote = grab(() =>
      parseJsonAnswer(`See [1] below.\n${F}json\n[1,2,3]\n${F}`, "the arc response"),
    );
    expect(footnote).toBeInstanceOf(MalformedJson);
  });
});

/* --------------------------------------------------- the caller inventory --
   Every test above exercises the helper. **None of them can notice a stage
   that never started calling it** — the eleventh file, left on the two lines
   that failed in production, passes every assertion in this file by not being
   mentioned in it. So this asserts on the source, which is the only place the
   answer lives. docs/reusable/silent-success.md § the check that shares an
   assumption with the code. */

/** The eleven stages that ask a model for JSON. */
const STAGES = [
  "arc",
  "glossary",
  "hierarchy",
  "ideas",
  "illustrated",
  "labels",
  "quiz",
  "quotes",
  "sketch",
  "timeline",
  "tweets",
] as const;

describe("the stages that parse a model's JSON", () => {
  it.each(STAGES)("src/%s.ts reads the answer with parseJsonAnswer", async (stage) => {
    const source = await readFile(path.join(ROOT, "src", `${stage}.ts`), "utf8");
    /* `[<(]`, because six of the eleven pass a type argument —
       `parseJsonAnswer<{ ideas?: unknown }>(raw, …)`. A plain
       `toContain("parseJsonAnswer(")` failed on exactly those six, which is
       what this test is for. */
    expect(source).toMatch(/parseJsonAnswer[<(]/);
    /* The specific two lines this whole change exists to remove. A stage that
       still spells them is a stage that still dies on a model's preamble,
       whatever the helper does. */
    expect(source).not.toMatch(/parseJsonFrom[<(][^)]*stripFence\(/);
  });

  it("would notice a stage that had not moved", async () => {
    /* Test the test. `src/search.ts` is the twelfth caller of the same
       machinery and deliberately does NOT go through the helper — it keeps its
       own three-way error mapping — so it must fail the loop's first
       assertion; and the pattern in the second has to match the line it is
       looking for. If either stops holding, the loop above has stopped
       discriminating and would pass on a stage that never moved. */
    const search = await readFile(path.join(ROOT, "src", "search.ts"), "utf8");
    expect(search).not.toMatch(/parseJsonAnswer[<(]/);
    expect(`  return parseJsonFrom(stripFence(raw), "x");`).toMatch(
      /parseJsonFrom[<(][^)]*stripFence\(/,
    );
  });
});

/** Every `AWKWARD` input the two lines this replaces already accepted. */
const PARSED_BEFORE = AWKWARD.filter(([, input]) => {
  try {
    JSON.parse(stripFence(input));
    return true;
  } catch {
    return false;
  }
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

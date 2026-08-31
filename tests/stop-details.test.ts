/**
 * `stop_details` — the provider's own words about a refusal, and where they must
 * not end up.
 *
 * Anthropic answers a blocked request with `stop_reason: "refusal"` and a
 * `stop_details` object beside it. Seven pipeline stages — arc, glossary, ideas,
 * labels, toc, tweets — see that object, and until 2026-08-26 every one of
 * them threw `` `Model refused: ${JSON.stringify(message.stop_details)}` ``.
 * A thrown message is not a private thing: src/jobs.ts logs a failed step with
 * `errorFields`, which keeps `message` and `stack`, and copies the same string
 * onto the job, which src/web/AddArticle.tsx renders on the progress card. So a
 * whole provider object had a straight path to both the log and the screen, out
 * of a request that carried the entire article.
 *
 * It leaked nothing on the day it was written, and that is the interesting part.
 * `RefusalStopDetails` in the installed SDK holds a policy category and nothing
 * else, so the review question — "does this put anything private in the
 * message?" — answered *no*, correctly, and would keep answering *no* right up
 * until the SDK added a field. Nothing here would change and no test would fail.
 * That is docs/reusable/silent-success.md exactly: the check agrees with the
 * code because it shares an assumption with it.
 *
 * ## What these tests actually do
 *
 * They do not read the SDK's field list, and they must not — a test pinned to
 * today's fields goes red on an SDK bump that changed nothing that matters, and
 * stays green for any field it did not think of. Instead the stream handed to
 * the stages **already contains the field that does not exist yet**: a poisoned
 * `stop_details` carrying an unknown key whose value is a ten-character
 * sentinel. Then the only claim made is about bytes — the sentinel is absent
 * from what the logger put on file descriptor 1, and absent from every request
 * that went back out. Same reasoning as tests/log.test.ts and
 * tests/parse-json.test.ts, and the same child process for the same reason:
 * src/log.ts builds its logger at import time, is `silent` under
 * `NODE_ENV=test`, and writes to fd 1 with `fs.writeSync` rather than through
 * `process.stdout.write`, so stubbing `process.stdout` in-process would capture
 * nothing and prove nothing.
 *
 * ## The control, which is the whole point
 *
 * "The sentinel is absent" is satisfied perfectly by a stream that never
 * delivered `stop_details` at all, by an SDK that stopped putting it on the
 * message, and by a stage that failed for some unrelated reason first. All
 * three are silent — the suite stays green while measuring nothing.
 *
 * So the child runs a seventh call that is **the deleted code**: a bare SDK
 * request against the same stubbed stream, whose error message is built the old
 * way, logged the way src/jobs.ts logs one. Its sentinel has to be *present*.
 * If it ever goes missing, the six absences below became free, and this test
 * says so in the same run rather than in six months.
 *
 * The per-site evidence is the message code. Every stage line has to carry
 * `[ai-model-refused]`, which only `MODEL_REFUSED` produces and which nothing
 * reaches except through the `stop_reason === "refusal"` branch. A stage that
 * threw ENOENT before it ever called a model would also contain no sentinel,
 * and this is what tells the two apart.
 *
 * ## And a second, cheaper guard
 *
 * The behavioural half covers the six stages that exist. The source scan at the
 * bottom covers the seventh nobody has written yet: **no code under `src/` may
 * read `stop_details` at all.** Zero, not a count — docs/plans/260826p-error-boundary.md
 * on why a counting test is the wrong shape, having found "three sites, then
 * six, then seven". If a future stage wants `stop_details?.type` in a log, that
 * is a decision worth making on purpose, and the way to make it is to come here
 * and change this test.
 */
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** A module of `src/`, as a quoted absolute path for the child's `import()`. */
const src = (name: string) => JSON.stringify(path.join(ROOT, "src", name));

/**
 * Ten characters each, and no one of them a substring of another.
 *
 * Each stands for the field the SDK has not added yet — the value that would
 * ride out of `stop_details` and into a log line if any of these stages went
 * back to stringifying the object. `control` is the same value travelling the
 * old way on purpose.
 */
const LEAK = {
  toc: "ZQTOCAAAAA",
  arc: "ZQARCBBBBB",
  tweets: "ZQTWEETSCC",
  glossary: "ZQGLOSSDDD",
  labels: "ZQLABELFFF",
  ideas: "ZQIDEASHHH",
  control: "ZQCTRLGGGG",
} as const;

/**
 * The **seven** stages, in the order the child runs them.
 *
 * `ideas` was missing until 2026-08-28 and the file called itself six — so the
 * one stage added after this harness was written was the one stage never checked
 * for the leak the harness exists to catch. GPT Sol pointed it out twice.
 */
const STAGES = ["toc", "arc", "tweets", "glossary", "ideas", "labels"] as const;

/**
 * One line per stage, plus the control. Counted rather than guessed, so that a
 * child which died halfway cannot pass every "does not contain" assertion by
 * printing nothing — the vacuous shape docs/reusable/silent-success.md is about.
 *
 * None of the six stage files calls the logger itself; every line here is
 * written by the `step` wrapper in the child, which is how src/jobs.ts writes
 * one. A leak found in an *outgoing* request would add an eighth line and fail
 * this count as well as its own assertion, which is the intended noise.
 */
const EXPECTED_LINES = STAGES.length + 1;

let stdout = "";
let stderr = "";
let dir = "";

beforeAll(async () => {
  /* A throwaway copy of `example/`, which already holds a real blocks.json,
     tree.json and meta.json — everything these stages read before they call a
     model. Under the OS temp directory rather than `data/`, because nothing
     walks it: the stages here are all given their directory explicitly, so
     none of them needs to be findable by slug. */
  dir = await mkdtemp(path.join(tmpdir(), "stop-details-"));
  await cp(path.join(ROOT, "example"), dir, { recursive: true });

  const body = `void (async () => {
    const { log, errorFields } = await import(${src("log.ts")});
    const jobs = log("jobs");

    const LEAK = ${JSON.stringify(LEAK)};
    const DIR = ${JSON.stringify(dir)};

    /* Which sentinel the next refusal carries. Reassigned before each site, so
       that a leak names the stage that leaked rather than "one of six". */
    let sentinel = "";

    /* An Anthropic streaming refusal, built by hand.

       The shape is the SDK's own: message_start, one text block, then a
       message_delta carrying \`stop_reason\` and \`stop_details\` together —
       which is where the SDK picks the object up (\`snapshot.stop_details =
       event.delta.stop_details\` in lib/MessageStream.js).

       \`future_field\` is the reason this file exists. It is not a field the
       installed SDK has; it is the field some later version will add, standing
       in for whatever it turns out to carry. Nothing downstream should ever be
       in a position to notice it. */
    const refusal = () => {
      const ev = (type, data) => "event: " + type + "\\ndata: " + JSON.stringify(data) + "\\n\\n";
      return ev("message_start", {
          type: "message_start",
          message: {
            id: "msg_stopdetails", type: "message", role: "assistant",
            model: "claude-test", content: [],
            stop_reason: null, stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        })
        + ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })
        + ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "{" } })
        + ev("content_block_stop", { type: "content_block_stop", index: 0 })
        + ev("message_delta", {
            type: "message_delta",
            delta: {
              stop_reason: "refusal",
              stop_sequence: null,
              stop_details: { type: "refusal", refusal_type: "cyber", future_field: sentinel + " and then the rest of it" },
            },
            usage: { output_tokens: 2 },
          })
        + ev("message_stop", { type: "message_stop" });
    };

    /* Installed before anything that talks to the SDK is imported. Also the
       only place that can see an outgoing request, which is the other
       direction the sentinel can travel: a stage that hands a failed call's
       error message back to the model as a repair instruction would let a
       stringified \`stop_details\` leave the building that way without ever
       reaching a log.

       Only the sentinel is written down when that happens — never the body,
       which is the article. */
    globalThis.fetch = async (_url, init) => {
      const sent = typeof init?.body === "string" ? init.body : "";
      if (sentinel && sent.includes(sentinel)) {
        jobs.error({ step: "outbound" }, "stop_details reached an outgoing request: " + sentinel);
      }
      return new Response(refusal(), { status: 200, headers: { "content-type": "text/event-stream" } });
    };

    const { generateToc } = await import(${src("toc.ts")});
    const { generateArc } = await import(${src("arc.ts")});
    const { generateTweets } = await import(${src("tweets.ts")});
    const { generateGlossary } = await import(${src("glossary.ts")});
    const { readArticleFromDir } = await import(${src("article-input.ts")});
    const { generateIdeas } = await import(${src("ideas.ts")});
    const { generateLabels } = await import(${src("labels.ts")});
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { collectSpend } = await import(${src("ai-spend.ts")});

    const fs = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const blocks = JSON.parse(await fs.readFile(nodePath.join(DIR, "blocks.json"), "utf8")).blocks;
    const tree = JSON.parse(await fs.readFile(nodePath.join(DIR, "tree.json"), "utf8"));

    /* Read once here rather than inside the steps: this simulation is about what
       a *refusal* does, so a stage that threw on its own inputs before making a
       call would report "step failed" for the wrong reason and the absence of a
       leak would be measuring nothing. src/article-input.ts. */
    const article = await readArticleFromDir(DIR);

    /* Exactly how src/jobs.ts records a step that threw — and exactly one line
       either way, so that a stage which stopped failing is visible as a line
       saying so rather than as a missing line. */
    const step = async (name, run) => {
      sentinel = LEAK[name];
      try {
        /* Inside a spend collector, because src/jobs.ts runs every step inside
           one — and a model call made outside one now says so on its own warn
           line, which would be six extra lines here and a failed count. Opening
           it makes the simulation truer as well as quieter. */
        await collectSpend(() => run());
        jobs.info({ step: name }, "step did not fail: " + name);
      } catch (err) {
        jobs.error({ ...errorFields(err), step: name }, "step failed: " + name);
      }
    };

    await step("toc", () => generateToc({ blocks, slug: "stop-details" }));
    await step("arc", () => generateArc({ article }));
    await step("tweets", () => generateTweets({ article }));
    await step("glossary", () => generateGlossary({ article, previous: null }));
    await step("ideas", () => generateIdeas({ article, previous: null }));
    await step("labels", () => generateLabels({ tree, blocks, slug: "stop-details" }));

    /* The control: the code that was deleted, run against the same stream and
       logged the same way. Its sentinel has to come out the other side, or the
       six absences above were measuring nothing. */
    sentinel = LEAK.control;
    const message = await new Anthropic({ logLevel: "off" }).messages.stream({
      model: "claude-test",
      max_tokens: 16,
      messages: [{ role: "user", content: "irrelevant" }],
    }).finalMessage();
    const old = new Error("Model refused: " + JSON.stringify(message.stop_details));
    jobs.error({ ...errorFields(old), step: "control" }, "step failed: control");
  })();`;

  const env: NodeJS.ProcessEnv = { ...process.env };
  /* The suite's own LOG_LEVEL must not decide what this measures, and "test"
     would make the logger silent — which turns every assertion below green
     while proving nothing. */
  delete env.LOG_LEVEL;
  env.NODE_ENV = "development";
  /* A key the SDK will accept, because the constructor throws without one and
     that throw would be indistinguishable from a stage refusing. Nothing is
     sent anywhere: `fetch` is stubbed above.

     Two of them, because the six stages and the control now reach the SDK by
     different routes. The stages go through `messagesClient()` in
     src/messages-stream.ts, which reads `OPENROUTER_API_KEY` and throws
     `NOT_CONFIGURED` without it — a throw that carries `[ai-not-set-up]` and
     would fail the `[ai-model-refused]` assertions below while looking exactly
     like a stage that never reached the refusal branch. The control builds a
     bare `new Anthropic(...)`, which wants `ANTHROPIC_API_KEY`. Both are
     nonsense strings and neither leaves the process. */
  env.ANTHROPIC_API_KEY = "test-key-not-a-real-one";
  env.OPENROUTER_API_KEY = "test-key-not-a-real-one";
  delete env.ANTHROPIC_AUTH_TOKEN;

  const child = spawnSync(TSX, ["-e", body], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  stdout = child.stdout ?? "";
  stderr = child.stderr ?? "";

  const lines = stdout.split("\n").filter((l) => l.trim() !== "");
  if (lines.length !== EXPECTED_LINES) {
    throw new Error(
      `expected ${EXPECTED_LINES} log lines from the child, got ${lines.length}` +
        `\n--- fixture ${dir}: ${(await readdir(dir)).join(", ")}` +
        `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    );
  }
}, 120_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** The child's lines, parsed, keyed by the `step` field each one carries. */
function lineFor(step: string): Record<string, unknown> {
  const found = stdout
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .find((l) => l.step === step);
  if (!found) throw new Error(`no log line for step ${step}\n${stdout}`);
  return found;
}

describe("a refused generation in the log", () => {
  it.each(STAGES)("does not write down what the provider said, in %s", (stage) => {
    expect(stdout).not.toContain(LEAK[stage]);
  });

  it("would have written it down the old way, so the absences above mean something", () => {
    /* The control. If this ever fails, the stream stopped delivering
       `stop_details`, or the SDK stopped putting it on the message, or this
       file's hand-built SSE drifted from the SDK's shape — and every
       assertion above became free. Read a failure here as "these tests have
       stopped testing anything", not as "something leaked". */
    expect(stdout).toContain(LEAK.control);
  });

  it.each(STAGES)(
    "still says a refusal is what happened, in %s",
    (stage) => {
      /* Absence proves nothing on its own — a stage that died on a missing
         file before it ever called a model contains no sentinel either. The
         bracketed code is what separates the two: only MODEL_REFUSED produces
         it, and nothing reaches MODEL_REFUSED except the refusal branch these
         tests are about. See docs/project/copy.md on why the code is what a
         test pins rather than the sentence. */
      const err = lineFor(stage).err as { message?: string };
      expect(err?.message ?? "").toContain("[ai-model-refused]");
    },
  );

});

/**
 * The second guard: nothing under `src/` may read `stop_details` in code.
 *
 * Cheap, and it covers the stage that has not been written yet — which the
 * behavioural half above cannot, because it can only drive the stages that
 * exist. Comments are stripped first, because the six sites each carry a
 * comment explaining why they do *not* touch the object, and those must stay.
 */

/**
 * Given the index of an opening quote, the index just past the closing one.
 *
 * Strings are tracked so that a `//` inside one — `"https://example.com"` —
 * is not mistaken for the start of a comment, which would strip the rest of
 * the line and could hide the very thing being looked for.
 */
function endOfString(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

/** Strip `//` and block comments, keeping string contents as code. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      // Keep a newline so line-based reading of the result stays sane.
      out += "\n";
      continue;
    }
    const c = source[i] as string;
    if (c === "'" || c === '"' || c === "`") {
      const end = endOfString(source, i);
      out += source.slice(i, end);
      i = end;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Every `.ts`/`.tsx` file under `src/`, as absolute paths. */
async function sourceFiles(): Promise<string[]> {
  const root = path.join(ROOT, "src");
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => path.join(e.parentPath ?? root, e.name));
}

describe("the source itself", () => {
  it("strips comments without eating code", () => {
    /* The scan below is only as good as this function, and a stripper that
       returned "" would make it pass for ever. So it is checked against the
       three cases that would break it: a `//` inside a string, a block
       comment, and a line comment. */
    const stripped = stripComments(
      [
        'const url = "https://example.com/x"; // trailing comment',
        "/* block mentioning stop_details */",
        "const kept = message.stop_reason;",
        "// const dropped = message.stop_details;",
      ].join("\n"),
    );
    expect(stripped).toContain("https://example.com/x");
    expect(stripped).toContain("message.stop_reason");
    expect(stripped).not.toContain("stop_details");
    expect(stripped).not.toContain("trailing comment");
  });

  it("lets the one exception read only .type, and never carry the object anywhere", async () => {
    /* The exception is a hole in a privacy rule, so it is worth spelling out how
       small it is. `stop_details` is the provider's own words about a request
       that carried the whole article; what may leave `wasRefused` is a boolean. */
    const file = path.join(ROOT, "src", "messages-stream.ts");
    const code = stripComments(await readFile(file, "utf8"));

    const reads = code.match(/stop_details/g) ?? [];
    expect(reads.length).toBe(1);

    /* Never stringified, never logged, never thrown, never spread into an
       object that goes somewhere else — the four ways the old
       `Model refused: ${JSON.stringify(...)}` reached a screen. */
    expect(code).not.toMatch(/JSON\.stringify\s*\(\s*[^)]*stop_details/);
    expect(code).not.toMatch(/stop_details[^\n]*(log|throw|Error\()/);

    /* And the function's contract is a boolean, so nothing downstream can widen
       it by accident. */
    expect(code).toContain("export function wasRefused(message: Anthropic.Message): boolean");
  });

  it("reads no stop_details anywhere in src/", async () => {
    const files = await sourceFiles();
    /* Non-vacuity, twice over: the scan has to have found files, and it has to
       still be able to see ordinary code in them. A `readdir` that returned
       nothing, or a stripper that flattened everything, both look exactly like
       a clean bill of health. */
    expect(files.length).toBeGreaterThan(30);

    const offenders: string[] = [];
    let sawStopReason = 0;
    for (const file of files) {
      const code = stripComments(await readFile(file, "utf8"));
      if (code.includes("stop_reason")) sawStopReason += 1;
      /* **One deliberate exception, added 2026-08-27.** The rule used to be
         "nowhere in src/", and that was right while `stop_reason` alone could
         answer the question. Going through OpenRouter made it ambiguous — its
         Messages reference shows `stop_details.type: "refusal"` beside
         `stop_reason: "end_turn"` — so `wasRefused` reads the one field and
         returns a boolean. The rule becomes *only the central discriminator may
         look, and only at `.type`*, which the next test pins. */
      if (path.basename(file) === "messages-stream.ts") continue;
      if (code.includes("stop_details")) offenders.push(path.relative(ROOT, file));
    }
    expect(sawStopReason).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

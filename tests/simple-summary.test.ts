/**
 * **Simple's validation, and the one request it sends** —
 * docs/plans/260930i-simple-summaries-eli15-sub-mode.md § The artefact, and
 * the two levels and the reader since
 * docs/plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md.
 *
 * Every bullet of the plans' validation lists has a case here. Each one is a
 * way the stage would be wrong quietly: a paragraph with no door back to the
 * piece, a digest where an orientation was asked for, or one good level stored
 * beside a missing one, looks exactly like one that works
 * (docs/reusable/silent-success.md).
 */
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Article } from "../src/article-input.js";
import { SHAPE, stampOf, whyUnusable } from "../src/store/artifacts.js";
import { SIMPLE_LIMITS, type Block, type BlockId, type SimpleLevel } from "../src/types.js";
import {
  ANSWER_TOKENS,
  SIMPLE_SYSTEMS,
  SIMPLE_PROMPT_VERSION,
  SIMPLE_SUMMARY_OUTPUT_SCHEMA,
  SIMPLE_VERSION,
  buildSimpleSummary,
  simplePromptVersion,
  emptyDropped,
  generateSimpleSummary,
  inputFingerprint,
  renderPrompt,
} from "../src/simple-summary.js";
import { HIGH_POWER_MODEL, modelFor, STAGE_EFFORT } from "../src/models.js";
import {
  parseCheckVerdicts,
  SIMPLE_CHECK_ENABLED,
  SIMPLE_CHECK_SYSTEM,
  SIMPLE_CHECK_VERSION,
} from "../src/simple-check.js";
import { isUsableSimpleSummary } from "../src/types.js";
import { hashProfile, PROFILE_RULES, renderProfile } from "../src/profile.js";

/* ------------------------------------------------------- the stubbed model -- */

/** One answer for every call, or one per level — told apart by the level's system prompt. */
let answer: string | Partial<Record<SimpleLevel, string | string[]>> = "";
let stop: string = "end_turn";
let waitForAbort: SimpleLevel | null = null;
/** When the stub streams "begin" (plan 261001j), and whether they ever do. */
let startGate: Promise<void> = Promise.resolve();
let neverStart = false;
/** A level whose call fails outright, before its stream begins. */
let failCall: SimpleLevel | null = null;
/** When every stub call answers. */
let finalGate: Promise<void> = Promise.resolve();
const abortSettled = new Set<SimpleLevel>();
const sent: { task: string; body: unknown; options: unknown; aborted: () => boolean }[] = [];

const levelOf = (body: unknown): SimpleLevel => {
  const text = (body as { system?: { text?: string }[] }).system?.[1]?.text ?? "";
  return text.includes("eighteen-year-old") ? "fuller" : text.includes("twelve-year-old") ? "brief" : "simple";
};

/** A level the case does not name gets a good answer, so each case is about the level it names. */
/** A list is handed out one answer per call, in order — a level asked twice gets the second. */
const answerFor = (level: SimpleLevel): string => {
  if (typeof answer === "string") return answer;
  const given = answer[level];
  if (Array.isArray(given)) return (given.length > 1 ? given.shift() : given[0]) ?? "";
  return given ?? JSON.stringify({ paragraphs: GOOD[level] });
};

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: (task: string, body: unknown, options: unknown) => {
      const signal = (options as { signal?: AbortSignal }).signal;
      sent.push({
        task,
        body: JSON.parse(JSON.stringify(body)),
        options: JSON.parse(JSON.stringify(options)),
        aborted: () => signal?.aborted ?? false,
      });
      const level = levelOf(body);
      const text = answerFor(level);
      const message = {
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "stub",
        content: [{ type: "text", text, citations: null }],
        stop_reason: stop,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return {
        onText: () => undefined,
        /* The stream "begins" when the gate opens; `neverStart` is a call that
           fails before it begins, so the hook never fires. */
        onStart: (listener: () => void) => {
          if (neverStart) return;
          void startGate.then(listener);
        },
        aborted: () => false,
        finalMessage: () => {
          if (level === failCall) return Promise.reject(new Error("upstream 502"));
          if (level !== waitForAbort) return finalGate.then(() => message);
          return new Promise((_, reject) => {
            const finish = () => {
              /* Deliberately later than the failing sibling's rejection. A
                 bare Promise.all returns before this and makes the test red. */
              setTimeout(() => {
                abortSettled.add(level);
                reject(Object.assign(new Error("aborted sibling"), { name: "AbortError" }));
              }, 0);
            };
            if (signal?.aborted) finish();
            else signal?.addEventListener("abort", finish, { once: true });
          });
        },
      };
    },
  };
});

/* ----------------------------------------------------- the stubbed checker -- */

/**
 * What the checker says to one call, given the user message it was sent: a
 * string is the answer's content, an Error is the call itself failing. The
 * default passes every paragraph, so the cases above are about the writer.
 */
let checkerReply: (user: string) => string | Error = (user) => okFor(user);
const checks: { job: string; body: unknown; signal: AbortSignal | undefined }[] = [];

/** How many paragraphs one checker message carries. */
const paragraphsIn = (user: string) => (user.match(/^PARAGRAPH \d+$/gm) ?? []).length;
const verdicts = (...v: ("ok" | "contradicts")[]) =>
  JSON.stringify({
    verdicts: v.map((verdict, i) => ({ n: i + 1, verdict, ...(verdict === "contradicts" ? { why: `turned round ${i + 1}` } : {}) })),
  });
const okFor = (user: string) => verdicts(...Array.from({ length: paragraphsIn(user) }, () => "ok" as const));
/** Flags the first paragraph, and passes the rest. */
const flagFirst = (user: string) =>
  verdicts("contradicts", ...Array.from({ length: paragraphsIn(user) - 1 }, () => "ok" as const));

vi.mock("../src/ai-call.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/ai-call.js")>();
  return {
    ...real,
    openRouterJson: async (job: string, body: unknown, options?: { signal?: AbortSignal }) => {
      checks.push({ job, body: JSON.parse(JSON.stringify(body)), signal: options?.signal });
      const user = (body as { messages: { role: string; content: string }[] }).messages.find((m) => m.role === "user")
        ?.content;
      const reply = checkerReply(user ?? "");
      if (reply instanceof Error) throw reply;
      return {
        json: { choices: [{ message: { content: reply } }], usage: { prompt_tokens: 100, completion_tokens: 10 } },
        answeredBy: "stub-checker",
        generationId: null,
      };
    },
  };
});

beforeEach(() => {
  checkerReply = okFor;
  checks.length = 0;
  answer = "";
  stop = "end_turn";
  waitForAbort = null;
  startGate = Promise.resolve();
  neverStart = false;
  failCall = null;
  finalGate = Promise.resolve();
  abortSettled.clear();
  sent.length = 0;
});

/* --------------------------------------------------------------- fixtures -- */

const block = (id: string, text: string, extra: Partial<Block> = {}): Block => ({
  id: id as BlockId,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
  ...extra,
});

const INTRO = block("spya-aaaaaa", "This paper asks whether a model can learn to read.");
const WHY = block("spya-bbbbbb", "Reading matters because most of what we know is written down.");
const RESULT = block("spya-cccccc", "The model read 38% faster, in this sample only.");
const METHOD = block("spya-dddddd", "We trained it on ten thousand pages.");
/* A supplement: never sent, so an id naming it is an invented one. */
const NOTE = block("spya-eeeeee", "Funding: a grant.", { treatment: "supplement" });

const BLOCKS = [INTRO, WHY, RESULT, METHOD, NOTE];
const EVIDENCE = BLOCKS.filter((b) => b.treatment !== "supplement");

const para = (text: string, ...ids: string[]) => ({ text, ids });

/** A good Fuller level, for the cases that are about Simple. */
const FULLER = [
  para("It asks whether a model can learn to read, and how.", INTRO.id),
  para("Reading matters because most knowledge is written.", WHY.id),
  para("Trained on ten thousand pages, it read 38% faster in this sample.", RESULT.id, METHOD.id),
];
/** A good Simple level, for the cases that are about Fuller. */
const SIMPLE = [para("It asks whether a model can read.", INTRO.id), para("It read faster.", RESULT.id)];
/** A good Brief level. */
const BRIEF = [para("Can a model read?", INTRO.id), para("It read faster.", RESULT.id)];
/** A good answer at every level. */
const GOOD: Record<SimpleLevel, ReturnType<typeof para>[]> = { brief: BRIEF, simple: SIMPLE, fuller: FULLER };

const opts = (dropped = emptyDropped(), profile: string | null = null) => ({
  slug: "s",
  evidence: EVIDENCE,
  sourceHash: "h",
  elapsedMs: 1,
  dropped,
  power: "standard" as const,
  profile,
});

/** Each level's answer, as its own call returns it. */
const answerOf = (paragraphs: unknown) => ({ paragraphs });

function build(simple: unknown, dropped = emptyDropped(), fuller: unknown = FULLER) {
  return buildSimpleSummary({ brief: answerOf(BRIEF), simple: answerOf(simple), fuller: answerOf(fuller) }, opts(dropped));
}

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

/* ------------------------------------------------------------ validation -- */

describe("buildSimpleSummary", () => {
  it("keeps every level whole, in the model's order, stamped with SIMPLE_VERSION", () => {
    const out = build([
      para("It asks whether a model can read.", INTRO.id),
      para("It matters because most knowledge is written.", WHY.id),
      para("It read 38% faster, in this sample.", RESULT.id, METHOD.id),
    ]);
    expect(out.levels.simple).toEqual([
      { text: "It asks whether a model can read.", ids: [INTRO.id] },
      { text: "It matters because most knowledge is written.", ids: [WHY.id] },
      { text: "It read 38% faster, in this sample.", ids: [RESULT.id, METHOD.id] },
    ]);
    expect(out.levels.fuller).toEqual(FULLER);
    expect(out.version).toBe(SIMPLE_VERSION);
    expect(out.version).toBe("simple/2");
    expect(out.sourceHash).toBe("h");
    expect(out.profileHash).toBeNull();
    expect(SHAPE.simple.ok(out)).toBe(true);
  });

  it("records the profile it was written for as its hash, never the words", () => {
    const profile = renderProfile({ profile: "I build software.", purpose: "Methods." });
    if (!profile) throw new Error("fixture needs a profile");
    const out = buildSimpleSummary({ brief: answerOf(BRIEF), simple: answerOf(SIMPLE), fuller: answerOf(FULLER) }, opts(emptyDropped(), profile));
    expect(out.profileHash).toBe(hashProfile(profile));
    expect(JSON.stringify(out)).not.toContain("I build software");
  });

  it("fails on an answer missing any level, naming it — all or none", () => {
    expect(() => buildSimpleSummary({ simple: answerOf(SIMPLE), fuller: answerOf(FULLER) }, opts())).toThrow(
      /"brief" answer has no `paragraphs` array/,
    );
    const missing = /"simple" answer has no `paragraphs` array/;
    expect(() => buildSimpleSummary({ brief: answerOf(BRIEF), fuller: answerOf(FULLER) }, opts())).toThrow(missing);
    expect(() => buildSimpleSummary({ brief: answerOf(BRIEF), simple: answerOf(SIMPLE) }, opts())).toThrow(
      /"fuller" answer has no `paragraphs` array/,
    );
    expect(() => buildSimpleSummary({ brief: answerOf(BRIEF), simple: null, fuller: answerOf(FULLER) }, opts())).toThrow(missing);
    expect(() => buildSimpleSummary({ brief: answerOf(BRIEF), simple: { summary: "x" }, fuller: answerOf(FULLER) }, opts())).toThrow(missing);
  });

  it("fails the whole run when only Fuller is bad", () => {
    expect(() => build(SIMPLE, emptyDropped(), [para("Only one.", INTRO.id)])).toThrow(
      /Only 1 of the model's 1 "fuller" paragraphs/,
    );
  });

  it("fails on more paragraphs than a level allows rather than cutting", () => {
    const five = [INTRO, WHY, RESULT, METHOD, INTRO].map((b, i) => para(`Paragraph ${i}.`, b.id));
    expect(() => build(five)).toThrow(/5 "simple" paragraphs and the limit is 4/);
    /* Five is Fuller's ceiling, not a failure there; six is. */
    expect(build(SIMPLE, emptyDropped(), five).levels.fuller).toHaveLength(5);
    const six = [...five, para("Six.", WHY.id)];
    expect(() => build(SIMPLE, emptyDropped(), six)).toThrow(/6 "fuller" paragraphs and the limit is 5/);
  });

  it("fails over a level's word ceiling rather than cutting", () => {
    const max = SIMPLE_LIMITS.simple.maxWords;
    expect(() => build([para(words(max), INTRO.id), para("And one more.", WHY.id)])).toThrow(
      new RegExp(`${max + 3} "simple" words and the limit is ${max}`),
    );
    /* At the ceiling exactly is fine. */
    expect(build([para(words(max - 2), INTRO.id), para("Two words.", WHY.id)]).levels.simple).toHaveLength(2);
    /* Fuller has its own, higher ceiling: Simple's is not a failure there. */
    const fullerMax = SIMPLE_LIMITS.fuller.maxWords;
    expect(fullerMax).toBeGreaterThan(max);
    const roomy = [para(words(max), INTRO.id), para("Two.", WHY.id), para("Three.", RESULT.id)];
    expect(build(SIMPLE, emptyDropped(), roomy).levels.fuller).toHaveLength(3);
    const over = [para(words(fullerMax), INTRO.id), para("Two.", WHY.id), para("Three.", RESULT.id)];
    expect(() => build(SIMPLE, emptyDropped(), over)).toThrow(/"fuller" words and the limit is/);
  });

  it("drops and counts an unknown id, a supplement's id and a non-string id", () => {
    const dropped = emptyDropped();
    const out = build(
      [para("One.", "spya-zzzzzz", INTRO.id), { text: "Two.", ids: [NOTE.id, 42, WHY.id] }],
      dropped,
    );
    expect(out.levels.simple.map((p) => p.ids)).toEqual([[INTRO.id], [WHY.id]]);
    expect(dropped.unknownIds).toBe(3);
  });

  it("dedupes ids before capping them at three, and counts both", () => {
    const dropped = emptyDropped();
    const out = build(
      [para("One.", INTRO.id, INTRO.id, WHY.id, RESULT.id, METHOD.id, METHOD.id), para("Two.", WHY.id)],
      dropped,
    );
    expect(out.levels.simple[0]?.ids).toEqual([INTRO.id, WHY.id, RESULT.id]);
    expect(dropped.duplicateIds).toBe(2);
    expect(dropped.overCap).toBe(1);
  });

  it("drops a paragraph with no surviving id — every paragraph is a door, at either level", () => {
    const dropped = emptyDropped();
    const out = build(
      [
        para("About.", INTRO.id),
        para("Why it matters, resting on nothing.", "spya-zzzzzz"),
        { text: "No ids at all." },
        para("Key idea.", RESULT.id),
      ],
      dropped,
      [...FULLER, para("A fourth, resting on nothing.", "spya-yyyyyy")],
    );
    expect(out.levels.simple.map((p) => p.text)).toEqual(["About.", "Key idea."]);
    expect(out.levels.fuller).toEqual(FULLER);
    expect(dropped.unanchored).toBe(3);
  });

  it("drops an empty paragraph and a non-object, and counts them", () => {
    const dropped = emptyDropped();
    const out = build([para("  ", INTRO.id), "a string", para("About.", INTRO.id), para("Why.", WHY.id)], dropped);
    expect(out.levels.simple).toHaveLength(2);
    expect(dropped.empty).toBe(1);
    expect(dropped.malformed).toBe(1);
  });

  it("fails with fewer surviving paragraphs than a level needs, saying why", () => {
    expect(() => build([para("About.", INTRO.id), para("Why.", "spya-zzzzzz")])).toThrow(
      /Only 1 of the model's 2 "simple" paragraphs.*1 with no usable passage/,
    );
    expect(() => build([])).toThrow(/Only 0 of the model's 0/);
  });
});

/* --------------------------------------------------- the store boundary -- */

describe("the store boundary", () => {
  it("refuses a level with the wrong paragraph count, and a missing level", () => {
    const one = [para("Only one.", INTRO.id)];
    const five = [INTRO, WHY, RESULT, METHOD, INTRO].map((b, i) => para(`Paragraph ${i}.`, b.id));
    const stored = build(SIMPLE);
    expect(whyUnusable("simple", stored)).toBeNull();
    expect(whyUnusable("simple", { ...stored, levels: { brief: BRIEF, simple: one, fuller: FULLER } })).toBe('no usable "levels"');
    expect(whyUnusable("simple", { ...stored, levels: { brief: BRIEF, simple: five, fuller: FULLER } })).toBe('no usable "levels"');
    expect(whyUnusable("simple", { ...stored, levels: { brief: BRIEF, simple: SIMPLE, fuller: SIMPLE } })).toBe('no usable "levels"');
    expect(whyUnusable("simple", { ...stored, levels: { brief: BRIEF, simple: SIMPLE } })).toBe('no usable "levels"');
    expect(whyUnusable("simple", { ...stored, levels: null })).toBe('no usable "levels"');
  });

  it("reads every simple/1 row as unusable, even one with valid-looking levels", () => {
    const stored = build(SIMPLE);
    expect(whyUnusable("simple", { ...stored, version: "simple/1", paragraphs: SIMPLE })).toBe('no usable "levels"');
  });

  it("refuses a simple/2 row without its required profile provenance", () => {
    const { profileHash: _missing, ...malformed } = build(SIMPLE);
    expect(whyUnusable("simple", malformed)).toBe('no usable "levels"');
  });

  it("refuses malformed stored paragraphs and the same word ceiling", () => {
    for (const simple of [
      [para("", INTRO.id), para("Two.", WHY.id)],
      [para("One.", INTRO.id, INTRO.id), para("Two.", WHY.id)],
      [para("One.", INTRO.id, WHY.id, RESULT.id, METHOD.id), para("Two.", WHY.id)],
      [para(words(SIMPLE_LIMITS.simple.maxWords), INTRO.id), para("One more.", WHY.id)],
    ]) {
      expect(whyUnusable("simple", { ...build(SIMPLE), levels: { brief: BRIEF, simple, fuller: FULLER } })).toBe('no usable "levels"');
    }
  });
});

/* ------------------------------------------------------------ the request -- */

let example: Article;
beforeAll(async () => {
  const { readArticleFromDir } = await import("./helpers/article-from-dir.js");
  example = await readArticleFromDir(path.resolve(import.meta.dirname, "..", "example"));
});

const PROFILE = renderProfile({
  profile: "CTO; background in cognitive science and machine learning.",
  purpose: "How the model was trained.",
});

describe("the request", () => {
  const article = (): Article => ({ ...example, slug: "simple-test", blocks: BLOCKS });
  const good = () => ({
    simple: JSON.stringify(answerOf(SIMPLE)),
    fuller: JSON.stringify(answerOf(FULLER)),
  });
  const userMessage = (i = 0) =>
    (sent[i]?.body as { messages?: { content: string }[] } | undefined)?.messages?.[0]?.content ?? "";
  const run = (profile: string | null = null, power: "standard" | "high" = "standard") =>
    generateSimpleSummary({ power, article: article(), profile });

  it("fails on malformed JSON and stores nothing", async () => {
    answer = "{ this is not json";
    await expect(run()).rejects.toThrow();
  });

  it("fails on an empty successful answer", async () => {
    answer = "";
    await expect(run()).rejects.toThrow();
  });

  it("fails on a refusal", async () => {
    stop = "refusal";
    answer = "";
    await expect(run()).rejects.toThrow();
  });

  it("fails on a max_tokens stop rather than parsing half an answer", async () => {
    stop = "max_tokens";
    answer = good();
    await expect(run()).rejects.toThrow();
  });

  it("makes one call per level, side by side, each with its own system prompt and the same article", async () => {
    answer = good();
    const out = await run();
    expect(sent).toHaveLength(3);
    expect(sent.map((c) => c.task)).toEqual(["simple", "simple", "simple"]);
    const systems = sent.map((c) => (c.body as { system: { text: string }[] }).system);
    expect(systems[0]?.[0]).toEqual(systems[1]?.[0]);
    expect(new Set(systems.map((s) => s[1]?.text))).toEqual(new Set(Object.values(SIMPLE_SYSTEMS)));
    const outputConfigs = sent.map(
      (c) => (c.body as { output_config?: { effort?: string; format?: unknown } }).output_config,
    );
    expect(outputConfigs).toHaveLength(3);
    expect(outputConfigs.every((config) => config?.effort === "high")).toBe(true);
    expect(outputConfigs.every((config) => config?.format !== undefined)).toBe(true);
    expect(outputConfigs.map((config) => config?.format)).toEqual(
      Array.from({ length: 3 }, () => ({ type: "json_schema", schema: SIMPLE_SUMMARY_OUTPUT_SCHEMA })),
    );
    expect(out.simpleSummary.levels).toEqual(GOOD);
  });

  it("fails the whole run when one level's call fails, aborts the others, and waits for them to settle", async () => {
    waitForAbort = "brief";
    answer = { simple: JSON.stringify(answerOf(SIMPLE)), fuller: JSON.stringify(answerOf([para("One.", INTRO.id)])) };
    await expect(run()).rejects.toThrow(/"fuller" paragraphs/);
    /* The sibling's signal is aborted, and the run did not return while its
       finalMessage (and therefore its spend record) was still pending. */
    expect(sent.every((c) => c.aborted())).toBe(true);
    expect(abortSettled).toEqual(new Set(["brief"]));
  });

  it("asks a level again, once, when its answer fails validation, and keeps the second", async () => {
    const overCeiling = answerOf([para(words(SIMPLE_LIMITS.brief.maxWords + 1), INTRO.id), para("Two.", WHY.id)]);
    answer = { brief: [JSON.stringify(overCeiling), JSON.stringify(answerOf(BRIEF))] };
    const out = await run();
    expect(out.simpleSummary.levels.brief).toEqual(BRIEF);
    expect(out.calls).toBe(4);
    expect(sent.filter((c) => levelOf(c.body) === "brief")).toHaveLength(2);
    expect(
      sent.every(
        (c) =>
          (c.body as { output_config?: { effort?: string; format?: unknown } }).output_config?.effort === "high" &&
          JSON.stringify(
            (c.body as { output_config?: { effort?: string; format?: unknown } }).output_config?.format,
          ) === JSON.stringify({ type: "json_schema", schema: SIMPLE_SUMMARY_OUTPUT_SCHEMA }),
      ),
    ).toBe(true);
    /* The rejected attempt's tokens were spent, so they are counted. */
    expect(out.outputTokens).toBe(4);
  });

  it("does not ask a third time: a level that fails twice fails the run", async () => {
    answer = { fuller: ["{ not json", JSON.stringify(answerOf([para("One.", INTRO.id)]))] };
    await expect(run()).rejects.toThrow(/"fuller" paragraphs/);
    expect(sent.filter((c) => levelOf(c.body) === "fuller")).toHaveLength(2);
  });

  it("does not retry a refusal", async () => {
    stop = "refusal";
    answer = "";
    await expect(run()).rejects.toThrow();
    expect(sent).toHaveLength(3);
  });

  it("reports what it dropped on the run, and does not store it", async () => {
    answer = {
      simple: JSON.stringify(answerOf([para("About.", INTRO.id, "spya-zzzzzz"), para("Why.", WHY.id, WHY.id)])),
      fuller: JSON.stringify(answerOf(FULLER)),
    };
    const out = await run();
    expect(out.dropped.unknownIds).toBe(1);
    expect(out.dropped.duplicateIds).toBe(1);
    expect(out.words.simple).toBe(2);
    expect(out.words.fuller).toBeGreaterThan(out.words.simple);
    expect("dropped" in out.simpleSummary).toBe(false);
  });

  it("sends Ideas' article bytes and an exact request fingerprint, at high effort, under its own task", async () => {
    const noMeta: Article = { ...example, meta: null };
    const [first, second, third] = noMeta.blocks.filter((b) => b.treatment !== "supplement");
    if (!first || !second || !third) throw new Error("fixture needs three body blocks");
    answer = {
      brief: JSON.stringify(answerOf([para("About.", first.id), para("Why.", second.id)])),
      simple: JSON.stringify(answerOf([para("About.", first.id), para("Why.", second.id)])),
      fuller: JSON.stringify(answerOf([para("About.", first.id), para("Why.", second.id), para("How.", third.id)])),
    };
    const out = await generateSimpleSummary({ power: "standard", article: noMeta, cacheArticle: true, profile: null });

    answer = JSON.stringify({ ideas: [] });
    const { generateIdeas } = await import("../src/ideas.js");
    await generateIdeas({ power: "standard", article: noMeta, previous: null, cacheArticle: true }).catch(() => undefined);

    const [call, , , ideasCall] = sent;
    if (!call || !ideasCall) throw new Error("expected three calls");
    const body = call.body as {
      max_tokens: number;
      system: unknown[];
      output_config: { effort: string };
    };
    expect(body.system[0]).toEqual((ideasCall.body as { system: unknown[] }).system[0]);
    expect(body.output_config.effort).toBe("high");
    expect(body.max_tokens).toBe(out.maxTokens);
    expect(body.max_tokens).toBeGreaterThanOrEqual(ANSWER_TOKENS);
    expect(STAGE_EFFORT.simple).toBe("high");
    expect(out.simpleSummary.sourceHash).toBe(inputFingerprint(noMeta.blocks, noMeta.tree, null));
  });

  it("with no profile, sends the constant ask byte for byte and records no profile", async () => {
    answer = good();
    const out = await run();
    expect(userMessage(0)).toBe("Write the plain-words orientation for this article.");
    expect(userMessage(1)).toBe(userMessage(0));
    expect(userMessage(0)).toBe(renderPrompt(null));
    expect(out.simpleSummary.profileHash).toBeNull();
  });

  it("puts the reader after the ask, in the shared profile section, and never in a system prompt", async () => {
    if (!PROFILE) throw new Error("fixture needs a profile");
    answer = good();
    const out = await run(PROFILE);
    /* Sol's plan review, P2-8: a blank line between the ask and the section. */
    const expected =
      `${renderPrompt(null)}\n\n=== WHO IS READING THIS ===\n\n${PROFILE}\n\n` +
      "Let this change what you lead with and how much you explain. It changes nothing\n" +
      "about what the article says, and nothing about its proportions. Do not address\n" +
      "the reader and do not mention this.";
    expect(userMessage(0)).toBe(expected);
    expect(userMessage(1)).toBe(expected);
    for (const call of sent) {
      const system = (call.body as { system: { text: string }[] }).system;
      expect(system.map((s) => s.text).join("\n")).not.toContain("cognitive science");
    }
    expect(out.simpleSummary.profileHash).toBe(hashProfile(PROFILE));
  });

  it("carries the shared profile rules in the constant half of both levels", () => {
    expect(SIMPLE_SYSTEMS.simple).toContain(PROFILE_RULES);
    expect(SIMPLE_SYSTEMS.fuller).toContain(PROFILE_RULES);
  });

  it("gives two profiles different requests and the same sourceHash — the stamp cannot see a profile", async () => {
    const other = renderProfile({ profile: "A historian.", purpose: null });
    if (!PROFILE || !other) throw new Error("fixture needs two profiles");
    answer = good();
    const a = await run(PROFILE);
    const b = await run(other);
    const none = await run(null);
    expect(userMessage(0)).not.toBe(userMessage(3));
    expect(a.simpleSummary.profileHash).not.toBe(b.simpleSummary.profileHash);
    /* What `STEPS.simple.stamp` computes: the same function, with no profile. */
    const stamp = inputFingerprint(BLOCKS, example.tree, example.meta);
    expect(a.simpleSummary.sourceHash).toBe(stamp);
    expect(b.simpleSummary.sourceHash).toBe(stamp);
    expect(none.simpleSummary.sourceHash).toBe(stamp);
  });

  it("sends high power to the gateway and stamps the model that wrote the artefact", async () => {
    answer = good();
    const out = await run(null, "high");
    expect(sent).toHaveLength(3);
    for (const call of sent) expect(call.options).toMatchObject({ power: "high" });
    expect(out.model).toBe(HIGH_POWER_MODEL);
    expect(out.simpleSummary.generator).toBe(HIGH_POWER_MODEL);
  });

  it("does not go stale when only a supplement block, which the request omits, changes", () => {
    const changed = BLOCKS.map((b) => (b.id === NOTE.id ? { ...b, text: "Another grant." } : b));
    expect(inputFingerprint(changed, example.tree, example.meta)).toBe(
      inputFingerprint(BLOCKS, example.tree, example.meta),
    );
    const edited = BLOCKS.map((b) => (b.id === RESULT.id ? { ...b, text: "It read 40% faster." } : b));
    expect(inputFingerprint(edited, example.tree, example.meta)).not.toBe(
      inputFingerprint(BLOCKS, example.tree, example.meta),
    );
  });

  it("pitches Simple at fifteen and Fuller at eighteen, and both keep the plain-words rule", () => {
    expect(SIMPLE_SYSTEMS.simple).toContain("fifteen-year-old");
    expect(SIMPLE_SYSTEMS.fuller).toContain("eighteen-year-old");
    expect(SIMPLE_SYSTEMS.simple).not.toContain("eighteen-year-old");
    for (const level of ["simple", "fuller"] as const) expect(SIMPLE_SYSTEMS[level]).toContain("PLAIN WORDS");
  });
});

/* ------------------------------------------------------ the fidelity guard -- */

describe("the fidelity guard (plan 261001i)", () => {
  const article = (): Article => ({ ...example, slug: "simple-test", blocks: BLOCKS });
  const run = (extra: { guard?: boolean; signal?: AbortSignal } = {}) =>
    generateSimpleSummary({ power: "standard", article: article(), profile: null, ...extra });
  const messagesOf = (i: number) =>
    (checks[i]?.body as { messages?: { role: string; content: string }[] } | undefined)?.messages ?? [];
  const userOf = (i: number) => messagesOf(i).find((m) => m.role === "user")?.content ?? "";
  const isBrief = (user: string) => user.includes("Can a model read?") || user.includes("Could a model learn");
  const writerCalls = (level: SimpleLevel) => sent.filter((c) => levelOf(c.body) === level).length;
  /** A second Brief that a checker can tell from the first. */
  const BRIEF_AGAIN = [para("Could a model learn to read?", INTRO.id), para("It read faster.", RESULT.id)];
  const passed = { result: "passed", attempts: 1, retriedAfterFlag: false, stored: 1 };
  /* A good answer at every level unless the case says otherwise. */
  beforeEach(() => {
    answer = {};
  });

  it("checks every level once, on its own job, each paragraph with only its own cited passages", async () => {
    const out = await run();
    expect(checks).toHaveLength(3);
    expect(checks.map((c) => c.job)).toEqual(["simple-check", "simple-check", "simple-check"]);
    for (const c of checks) expect((c.body as { model: string }).model).toBe(modelFor("simple-check", "standard"));
    expect(messagesOf(0)[0]).toEqual({
      role: "system",
      content: SIMPLE_CHECK_SYSTEM,
    });
    const brief = checks.map((_, i) => userOf(i)).find(isBrief) ?? "";
    /* BRIEF cites INTRO and RESULT: their words go, and nothing else's. */
    expect(brief).toContain(`PARAGRAPH 1\nCan a model read?\n\nITS PASSAGES\n[${INTRO.id}] ${INTRO.text}`);
    expect(brief).toContain(`PARAGRAPH 2\nIt read faster.\n\nITS PASSAGES\n[${RESULT.id}] ${RESULT.text}`);
    expect(brief).not.toContain(WHY.text);
    expect(brief).not.toContain(METHOD.text);
    expect(out.simpleSummary.check).toEqual({
      checker: SIMPLE_CHECK_VERSION,
      requestedModel: modelFor("simple-check", "standard"),
      levels: { brief: passed, simple: passed, fuller: passed },
    });
    expect(sent).toHaveLength(3);
  });

  it("asks a flagged level again and stores the second when it passes", async () => {
    answer = { brief: [JSON.stringify(answerOf(BRIEF)), JSON.stringify(answerOf(BRIEF_AGAIN))] };
    checkerReply = (user) => (user.includes("Can a model read?") ? flagFirst(user) : okFor(user));
    const out = await run();
    expect(writerCalls("brief")).toBe(2);
    expect(out.simpleSummary.levels.brief).toEqual(BRIEF_AGAIN);
    expect(out.simpleSummary.check?.levels.brief).toEqual({ result: "passed", attempts: 2, retriedAfterFlag: true, stored: 2 });
    expect(out.simpleSummary.check?.levels.simple).toEqual(passed);
    expect(checks).toHaveLength(4);
    expect(out.calls).toBe(4);
  });

  it("stores the second attempt when it is flagged too, and records its flags — the press is not lost", async () => {
    answer = { brief: [JSON.stringify(answerOf(BRIEF)), JSON.stringify(answerOf(BRIEF_AGAIN))] };
    checkerReply = (user) => (isBrief(user) ? flagFirst(user) : okFor(user));
    const out = await run();
    expect(writerCalls("brief")).toBe(2);
    expect(out.simpleSummary.levels.brief).toEqual(BRIEF_AGAIN);
    expect(out.simpleSummary.check?.levels.brief).toEqual({
      result: "flagged",
      attempts: 2,
      retriedAfterFlag: true,
      stored: 2,
      flags: [{ paragraph: 0, why: "turned round 1" }],
    });
    expect(checks).toHaveLength(4);
    expect(out.calls).toBe(4);
    expect(out.checkCalls).toBe(4);
  });

  it("does not buy a third writer call when validation spent the first attempt", async () => {
    const overCeiling = answerOf([para(words(SIMPLE_LIMITS.brief.maxWords + 1), INTRO.id), para("Two.", WHY.id)]);
    answer = { brief: [JSON.stringify(overCeiling), JSON.stringify(answerOf(BRIEF))] };
    checkerReply = (user) => (isBrief(user) ? flagFirst(user) : okFor(user));
    const out = await run();
    expect(writerCalls("brief")).toBe(2);
    expect(out.simpleSummary.levels.brief).toEqual(BRIEF);
    expect(out.simpleSummary.check?.levels.brief).toEqual({
      result: "flagged",
      attempts: 2,
      retriedAfterFlag: false,
      stored: 2,
      flags: [{ paragraph: 0, why: "turned round 1" }],
    });
    /* The invalid answer was never checked: only valid text is. */
    expect(checks).toHaveLength(3);
  });

  it("stores a level unchecked when the checker call fails, and does not spend the writer retry", async () => {
    checkerReply = (user) => (isBrief(user) ? new Error("upstream 502") : okFor(user));
    const out = await run();
    expect(writerCalls("brief")).toBe(1);
    expect(out.simpleSummary.levels.brief).toEqual(BRIEF);
    expect(out.simpleSummary.check?.levels.brief).toEqual({
      result: "unchecked",
      attempts: 1,
      retriedAfterFlag: false,
      stored: 1,
      failure: "call",
    });
    expect(out.simpleSummary.check?.levels.fuller).toEqual(passed);
  });

  it.each([
    ["prose", () => "Looks fine to me."],
    ["too few verdicts", () => verdicts("ok")],
    ["a verdict it does not know", (user: string) => okFor(user).replace('"ok"', '"maybe"')],
    ["an empty answer", () => ""],
  ])("treats an unreadable answer (%s) as a checker failure, not a pass", async (_, reply) => {
    checkerReply = (user) => (isBrief(user) ? reply(user) : okFor(user));
    const out = await run();
    expect(writerCalls("brief")).toBe(1);
    expect(out.simpleSummary.check?.levels.brief).toEqual({
      result: "unchecked",
      attempts: 1,
      retriedAfterFlag: false,
      stored: 1,
      failure: "unreadable",
    });
  });

  it("records an unchecked retry after a flag as unchecked, and says a flag bought it", async () => {
    answer = { brief: [JSON.stringify(answerOf(BRIEF)), JSON.stringify(answerOf(BRIEF_AGAIN))] };
    checkerReply = (user) =>
      user.includes("Can a model read?") ? flagFirst(user) : isBrief(user) ? new Error("timeout") : okFor(user);
    const out = await run();
    expect(out.simpleSummary.levels.brief).toEqual(BRIEF_AGAIN);
    expect(out.simpleSummary.check?.levels.brief).toEqual({
      result: "unchecked",
      attempts: 2,
      retriedAfterFlag: true,
      stored: 2,
      failure: "call",
    });
    expect(writerCalls("brief")).toBe(2);
    expect(checks).toHaveLength(4);
    expect(out.calls).toBe(4);
    expect(out.checkCalls).toBe(4);
  });

  it("keeps the flagged first attempt when the retry it bought fails validation — the press is not lost", async () => {
    answer = { brief: [JSON.stringify(answerOf(BRIEF)), "{ not json"] };
    checkerReply = (user) => (isBrief(user) ? flagFirst(user) : okFor(user));
    const out = await run();
    expect(writerCalls("brief")).toBe(2);
    expect(out.simpleSummary.levels.brief).toEqual(BRIEF);
    expect(out.simpleSummary.check?.levels.brief).toEqual({
      result: "flagged",
      attempts: 2,
      retriedAfterFlag: true,
      stored: 1,
      retryFailure: "validation",
      flags: [{ paragraph: 0, why: "turned round 1" }],
    });
  });

  it("keeps the flagged first attempt when the retry's call is refused", async () => {
    answer = { brief: [JSON.stringify(answerOf(BRIEF)), JSON.stringify(answerOf(BRIEF_AGAIN))] };
    checkerReply = (user) => {
      if (isBrief(user)) stop = "refusal";
      return isBrief(user) ? flagFirst(user) : okFor(user);
    };
    const out = await run();
    expect(out.simpleSummary.levels.brief).toEqual(BRIEF);
    expect(out.simpleSummary.check?.levels.brief).toMatchObject({
      result: "flagged",
      stored: 1,
      retriedAfterFlag: true,
      retryFailure: "call",
    });
    /* The refused response was still a writer request with reported usage. */
    expect(out.calls).toBe(4);
    expect(out.inputTokens).toBe(4);
    expect(out.outputTokens).toBe(4);
  });

  it("switched off: no checker call, no retry for a flag, and no record", async () => {
    checkerReply = flagFirst;
    const out = await run({ guard: false });
    expect(checks).toHaveLength(0);
    expect(sent).toHaveLength(3);
    expect("check" in out.simpleSummary).toBe(false);
    expect(out.checkCalls).toBe(0);
  });

  it("is on unless switched off", () => {
    expect(SIMPLE_CHECK_ENABLED).toBe(true);
  });

  it("reports the checker's calls and tokens beside the writer's, never summed into them", async () => {
    const out = await run();
    expect(out.calls).toBe(3);
    expect(out.outputTokens).toBe(3);
    expect(out.checkCalls).toBe(3);
    expect(out.checkInputTokens).toBe(300);
    expect(out.checkOutputTokens).toBe(30);
  });

  it("an aborted job stops at the check rather than storing an unchecked level", async () => {
    const job = new AbortController();
    checkerReply = (user) => {
      job.abort();
      return new Error(`aborted ${paragraphsIn(user)}`);
    };
    await expect(run({ signal: job.signal })).rejects.toThrow();
  });

  it("hands the checker the job's signal, so a cancelled press stops checking", async () => {
    const job = new AbortController();
    await run({ signal: job.signal });
    job.abort();
    expect(checks).toHaveLength(3);
    for (const c of checks) expect(c.signal?.aborted).toBe(true);
  });

  it("reads a row with no record as usable — written before the guard, or with it off", async () => {
    const out = await run({ guard: false });
    expect(isUsableSimpleSummary(out.simpleSummary)).toBe(true);
    const checked = await run();
    expect(isUsableSimpleSummary(checked.simpleSummary)).toBe(true);
  });
});

/* ------------------------------------------------- one cache, three levels -- */

describe("the staggered fan-out (plan 261001j)", () => {
  /* The same ids as the small fixture, with enough words to clear the cache floor. */
  const FILLER = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
  const LONG = BLOCKS.map((b) => (b.treatment === "supplement" ? b : { ...b, text: `${b.text} ${FILLER}` }));
  /* Roughly 700 tokens: cacheable by Opus, below Sonnet's measured floor. */
  const MIDDLE = BLOCKS.map((b) => (b.treatment === "supplement" ? b : { ...b, text: `${b.text} ${"x".repeat(600)}` }));
  const run = (
    blocks: Block[],
    extra: { cacheArticle?: boolean; power?: "standard" | "high"; signal?: AbortSignal; guard?: boolean } = {},
  ) =>
    generateSimpleSummary({ power: "standard", article: { ...example, slug: "simple-test", blocks }, profile: null, guard: false, ...extra });
  const marked = (i: number) =>
    "cache_control" in ((sent[i]?.body as { system?: Record<string, unknown>[] } | undefined)?.system?.[0] ?? {});
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const gate = () => {
    let open = () => {};
    const promise = new Promise<void>((r) => {
      open = r;
    });
    return { promise, open };
  };
  beforeEach(() => {
    answer = {};
  });

  it("on a long article, writes Fuller first with the article marked, and the others once it has begun", async () => {
    const start = gate();
    const final = gate();
    startGate = start.promise;
    finalGate = final.promise;
    const pending = run(LONG);
    await tick();
    expect(sent.map((c) => levelOf(c.body))).toEqual(["fuller"]);
    start.open();
    await tick();
    expect(sent.map((c) => levelOf(c.body)).sort()).toEqual(["brief", "fuller", "simple"]);
    final.open();
    const out = await pending;
    expect([0, 1, 2].map(marked)).toEqual([true, true, true]);
    expect(out.simpleSummary.levels.brief).toEqual(BRIEF);
  });

  it("does not leave the others waiting when the first never says it has begun", async () => {
    neverStart = true;
    const out = await run(LONG);
    expect(sent).toHaveLength(3);
    expect(out.simpleSummary.levels.fuller).toEqual(FULLER);
  });

  it("keeps a validation retry on the shared cache and stores the same result", async () => {
    answer = { simple: ["{ not json", JSON.stringify(answerOf(SIMPLE))] };
    const out = await run(LONG);
    expect(sent).toHaveLength(4);
    expect(sent.map((_, i) => marked(i))).toEqual([true, true, true, true]);
    expect(out.simpleSummary.levels.simple).toEqual(SIMPLE);
  });

  it("keeps a guard retry on the shared cache and stores the checked replacement", async () => {
    const replacement = [para("Could a model learn to read?", INTRO.id), para("It read faster.", RESULT.id)];
    answer = { brief: [JSON.stringify(answerOf(BRIEF)), JSON.stringify(answerOf(replacement))] };
    let firstBrief = true;
    checkerReply = (user) => {
      if (firstBrief && user.includes("Can a model read?")) {
        firstBrief = false;
        return flagFirst(user);
      }
      return okFor(user);
    };
    const out = await run(LONG, { guard: true });
    expect(sent).toHaveLength(4);
    expect(sent.map((_, i) => marked(i))).toEqual([true, true, true, true]);
    expect(out.simpleSummary.levels.brief).toEqual(replacement);
    expect(out.simpleSummary.check?.levels.brief).toMatchObject({ retriedAfterFlag: true, stored: 2 });
  });

  /* Sol's plan review, P1: the wait used to end on the failure itself, and the
     other two could open (billable) calls before the press was aborted. */
  it("opens no other call when the first call fails before it begins", async () => {
    neverStart = true;
    failCall = "fuller";
    await expect(run(LONG)).rejects.toThrow();
    await tick();
    expect(sent.map((c) => levelOf(c.body))).toEqual(["fuller"]);
  });

  it.each(["refusal", "max_tokens"])(
    "opens no other call when Fuller ends without starting and reports %s",
    async (reason) => {
      neverStart = true;
      stop = reason;
      await expect(run(LONG)).rejects.toThrow();
      await tick();
      expect(sent.map((c) => levelOf(c.body))).toEqual(["fuller"]);
    },
  );

  it("fails as before, without hanging, when the first fails before it begins", async () => {
    neverStart = true;
    answer = { fuller: ["{ not json", "{ still not json"] };
    await expect(run(LONG)).rejects.toThrow();
  });

  it("below the cache floor, asks all three at once and marks nothing — there is no cache to share", async () => {
    startGate = gate().promise;
    const pending = run(BLOCKS);
    await tick();
    expect(sent).toHaveLength(3);
    expect([0, 1, 2].map(marked)).toEqual([false, false, false]);
    await pending;
  });

  it("does not let cacheArticle mark a prefix below the model's physical cache floor", async () => {
    await run(BLOCKS, { cacheArticle: true });
    expect([0, 1, 2].map(marked)).toEqual([false, false, false]);
  });

  it("uses Opus's lower cache floor for both marking and staggering", async () => {
    await run(MIDDLE, { cacheArticle: true });
    expect(sent).toHaveLength(3);
    expect([0, 1, 2].map(marked)).toEqual([false, false, false]);

    sent.length = 0;
    const start = gate();
    const final = gate();
    startGate = start.promise;
    finalGate = final.promise;
    const pending = run(MIDDLE, { power: "high", cacheArticle: true });
    await tick();
    expect(sent.map((c) => levelOf(c.body))).toEqual(["fuller"]);
    expect(marked(0)).toBe(true);
    start.open();
    final.open();
    await pending;
  });

  it("opens no call when the job was already aborted", async () => {
    const job = new AbortController();
    job.abort();
    await expect(run(LONG, { signal: job.signal })).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
});

describe("parseCheckVerdicts", () => {
  it("reads one verdict per paragraph, in order, and the reason for a flag", () => {
    expect(parseCheckVerdicts(verdicts("ok", "contradicts", "ok"), 3)).toEqual([
      { verdict: "ok" },
      { verdict: "contradicts", why: "turned round 2" },
      { verdict: "ok" },
    ]);
  });

  it("finds the JSON inside a fence or a sentence", () => {
    expect(parseCheckVerdicts(`Here:\n\`\`\`json\n${verdicts("ok")}\n\`\`\``, 1)).toEqual([{ verdict: "ok" }]);
  });

  it("refuses a count that does not match, an unknown verdict, numbering out of order, and non-JSON", () => {
    expect(parseCheckVerdicts(verdicts("ok"), 2)).toBeNull();
    expect(parseCheckVerdicts('{"verdicts":[{"n":1,"verdict":"fine"}]}', 1)).toBeNull();
    expect(parseCheckVerdicts('{"verdicts":[{"n":2,"verdict":"ok"},{"n":1,"verdict":"ok"}]}', 2)).toBeNull();
    expect(parseCheckVerdicts("no", 1)).toBeNull();
    expect(parseCheckVerdicts("", 1)).toBeNull();
  });

  it("reads a verdict without its number by position, as the measured probe did", () => {
    /* The probe behind the 24-of-30 figure ignored `n`; refusing an answer
       without it would turn a check that was measured into an unchecked level. */
    expect(parseCheckVerdicts('{"verdicts":[{"verdict":"ok"},{"verdict":"contradicts","why":"x"}]}', 2)).toEqual([
      { verdict: "ok" },
      { verdict: "contradicts", why: "x" },
    ]);
  });

  it("gives a flag with no reason an empty one rather than refusing it", () => {
    expect(parseCheckVerdicts('{"verdicts":[{"n":1,"verdict":"contradicts"}]}', 1)).toEqual([
      { verdict: "contradicts", why: "" },
    ]);
  });
});

/* ------------------------------------------------ the prompt's own stamp -- */

/**
 * **The prompt has a version of its own, and the shape keeps `simple/2`** —
 * plan 261001p, GPT Sol's plan review P1-3. A wording change must be able to
 * mark a summary outdated without making it unreadable, which bumping the shape
 * version would.
 */
describe("the prompt version (plan 261001p)", () => {
  it("stamps today's prompt beside the unchanged shape version", () => {
    const out = build([para("It asks whether a model can read.", INTRO.id), para("It matters.", WHY.id)]);
    expect(out.version).toBe("simple/2");
    expect(out.promptVersion).toBe(SIMPLE_PROMPT_VERSION);
    expect(simplePromptVersion(out)).toBe(SIMPLE_PROMPT_VERSION);
    /* Pipeline freshness and artefact copies read this generic stamp. If they
       see the shape's `simple/2` here, a new summary is permanently
       not-current and a copy carrying its real prompt stamp is refused. */
    expect(stampOf(out).promptVersion).toBe(SIMPLE_PROMPT_VERSION);
  });

  it("reads a row from before the field as the first prompt: usable, and outdated", () => {
    const out = build([para("It asks whether a model can read.", INTRO.id), para("It matters.", WHY.id)]);
    const { promptVersion: _, ...legacy } = out;
    expect(isUsableSimpleSummary(legacy)).toBe(true);
    expect(simplePromptVersion(legacy)).toBe("simple-prompt/1");
    expect(simplePromptVersion(legacy)).not.toBe(SIMPLE_PROMPT_VERSION);
  });

  it("refuses an empty prompt version rather than reading it as the first", () => {
    const out = build([para("It asks whether a model can read.", INTRO.id), para("It matters.", WHY.id)]);
    expect(isUsableSimpleSummary({ ...out, promptVersion: "" })).toBe(false);
  });

  it("pins the changed ask, not merely its new stamp", () => {
    expect(SIMPLE_SYSTEMS.brief).toContain("About 80 words");
    for (const system of Object.values(SIMPLE_SYSTEMS)) {
      expect(system).toContain("PAPERWORK IS NOT THE PIECE");
      expect(system).toContain("any implication it\n  states itself");
      expect(system).toContain("Never advice or a consequence it does not give");
    }
  });
});

/* ------------------------------------------------------- the pipeline step -- */

describe("the step", () => {
  /* Plan 261001p: Simple is written on the high-power model whatever the
     article's own setting, because on the PID paper Sonnet swapped the paper's
     terms in 5 levels of 18 and Opus in none of 36. */
  it("writes on the high-power model for an article whose power is standard", async () => {
    const { STEPS } = await import("../src/pipeline.js");
    const { memoryArtefacts } = await import("./helpers/memory-artefacts.js");
    const { nullCheckpointStore } = await import("../src/store/checkpoints.js");
    const store = memoryArtefacts();
    store.plant("simple-step", "hierarchy", "blocks", { blocks: BLOCKS });
    store.plant("simple-step", "hierarchy", "tree", example.tree);
    answer = {};
    const result = await STEPS.simple.run(
      {
        power: "standard",
        slug: "simple-step",
        report: () => undefined,
        signal: new AbortController().signal,
        cacheArticle: false,
      },
      store,
      nullCheckpointStore(),
    );
    expect(sent).toHaveLength(3);
    for (const call of sent) expect(call.options).toMatchObject({ power: "high" });
    expect(result.parts?.simple).toMatchObject({ generator: HIGH_POWER_MODEL });
  });
});

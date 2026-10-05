/**
 * **A Summary write is Brief and Fuller, and nothing else** —
 * docs/plans/261004f-stop-writing-the-simple-summary-level.md.
 *
 * Greg, 2026-10-04: *"we've removed that middle level of Summary, and we're
 * not going to add it back"*. Until then one press wrote a third level nobody
 * was shown, and its failure failed the other two.
 *
 * Three things here would be wrong quietly: a third call still made (it costs,
 * and shows nowhere), a row stored before the change reading as absent (the
 * reader's summary is gone and the next open pays for it again), and Brief's
 * or Fuller's prompt moving while the prompt version stays put.
 */
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Article } from "../src/article-input.js";
import {
  SIMPLE_PROMPT_VERSION,
  SIMPLE_SYSTEMS,
  SIMPLE_VERSION,
  buildSimpleSummary,
  emptyDropped,
  generateSimpleSummary,
  inputFingerprint,
} from "../src/simple-summary.js";
import { STEPS, stepIsDone, type StepContext } from "../src/pipeline.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";
import { CAPABLE_MODEL } from "../src/models.js";
import { whyUnusable } from "../src/store/artifacts.js";
import { isUsableSimpleSummary, SIMPLE_LEVELS, SIMPLE_LIMITS, type Block, type BlockId } from "../src/types.js";

/* ------------------------------------------------------- the stubbed model -- */

const sent: { task: string; level: string }[] = [];
/** A level whose every answer fails validation, so the case is about who is asked. */
let broken: string | null = null;
/** A level whose answer waits for this before it arrives. */
let held: { level: string; until: Promise<void> } | null = null;

/** Which level a request is for, read off its system prompt as the reader's age. */
const levelOf = (body: unknown): string => {
  const text = (body as { system?: { text?: string }[] }).system?.[1]?.text ?? "";
  if (text.includes("eighteen-year-old")) return "fuller";
  if (text.includes("twelve-year-old")) return "brief";
  return text.includes("fifteen-year-old") ? "simple" : "unknown";
};

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: (task: string, body: unknown) => {
      const level = levelOf(body);
      sent.push({ task, level });
      const text = level === broken ? "{ not json" : JSON.stringify({ paragraphs: GOOD[level] ?? [] });
      return {
        onText: () => undefined,
        onStart: (listener: () => void) => void Promise.resolve().then(listener),
        aborted: () => false,
        attempts: () => 1,
        finalMessage: () =>
          (held?.level === level ? held.until : Promise.resolve()).then(() => ({
            id: "msg_stub",
            type: "message",
            role: "assistant",
            model: "stub",
            content: [{ type: "text", text, citations: null }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          })),
      };
    },
  };
});

const checks: string[] = [];

vi.mock("../src/ai-call.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/ai-call.js")>();
  return {
    ...real,
    openRouterJson: async (job: string, body: unknown) => {
      checks.push(job);
      const user =
        (body as { messages: { role: string; content: string }[] }).messages.find((m) => m.role === "user")?.content ?? "";
      const n = (user.match(/^PARAGRAPH \d+$/gm) ?? []).length;
      return {
        json: {
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({ verdicts: Array.from({ length: n }, (_, i) => ({ n: i + 1, verdict: "ok" })) }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        },
        answeredBy: "stub-checker",
        generationId: null,
      };
    },
  };
});

beforeEach(() => {
  sent.length = 0;
  checks.length = 0;
  broken = null;
  held = null;
});

/* --------------------------------------------------------------- fixtures -- */

const block = (id: string, text: string): Block => ({
  id: id as BlockId,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

const INTRO = block("spya-aaaaaa", "This paper asks whether a model can learn to read.");
const WHY = block("spya-bbbbbb", "Reading matters because most of what we know is written down.");
const RESULT = block("spya-cccccc", "The model read 38% faster, in this sample only.");
const BLOCKS = [INTRO, WHY, RESULT];

const para = (text: string, ...ids: string[]) => ({ text, ids, sentences: [{ text, id: null as string | null }] });

const FULLER = [
  para("It asks whether a model can learn to read, and how.", INTRO.id),
  para("Reading matters because most knowledge is written.", WHY.id),
  para("It read 38% faster in this sample.", RESULT.id),
];
const BRIEF = [para("Can a model read?", INTRO.id), para("It read faster.", RESULT.id)];
/** The middle level as a row from before 2026-10-04 stored it. */
const OLD_SIMPLE = [para("It asks whether a model can read.", INTRO.id), para("It read faster.", RESULT.id)];
const GOOD: Record<string, ReturnType<typeof para>[]> = { brief: BRIEF, fuller: FULLER, simple: OLD_SIMPLE };

const ARTICLE: Article = {
  slug: "two-levels",
  blocks: BLOCKS,
  tree: { nodes: [] } as unknown as Article["tree"],
  meta: { title: "Can a model read?" } as Article["meta"],
} as Article;

const stamp = {
  slug: "s",
  evidence: BLOCKS,
  sourceHash: "h",
  elapsedMs: 1,
  dropped: emptyDropped(),
  power: "standard" as const,
  profile: null,
};

const passed = { result: "passed", attempts: 1, retriedAfterFlag: false, stored: 1 } as const;

/**
 * A row as the three-level writer stored it: `levels` and `check.levels` each
 * with `simple`. Written out by hand, not through today's builder, so it is the
 * old shape whatever the builder does now.
 */
function oldRow(simple: unknown = OLD_SIMPLE) {
  return {
    version: "simple/2",
    promptVersion: "simple-prompt/7",
    generator: "stub-model",
    slug: "s",
    sourceHash: "h",
    generatedAt: "2026-10-03T09:00:00.000Z",
    elapsedMs: 1,
    profileHash: null,
    levels: { brief: BRIEF, simple, fuller: FULLER },
    check: { checker: "simple-check/1", requestedModel: "stub", levels: { brief: passed, simple: passed, fuller: passed } },
  };
}

/* ------------------------------------------------------------------ cases -- */

describe("the levels a write produces", () => {
  it("names Brief and Fuller, and no middle level", () => {
    expect([...SIMPLE_LEVELS]).toEqual(["brief", "fuller"]);
    expect(Object.keys(SIMPLE_LIMITS).sort()).toEqual(["brief", "fuller"]);
    expect(Object.keys(SIMPLE_SYSTEMS).sort()).toEqual(["brief", "fuller"]);
  });

  it("makes one writer call and one check for each of the two, and stores exactly those", async () => {
    const out = await generateSimpleSummary({ article: ARTICLE, profile: null, power: "standard", guard: true });
    expect(sent.map((c) => c.level).sort()).toEqual(["brief", "fuller"]);
    expect(out.calls).toBe(2);
    expect(checks).toEqual(["simple-check", "simple-check"]);
    expect(out.checkCalls).toBe(2);
    expect(Object.keys(out.simpleSummary.levels).sort()).toEqual(["brief", "fuller"]);
    expect(Object.keys(out.simpleSummary.check?.levels ?? {}).sort()).toEqual(["brief", "fuller"]);
    expect(Object.keys(out.words).sort()).toEqual(["brief", "fuller"]);
    expect(isUsableSimpleSummary(out.simpleSummary)).toBe(true);
    expect(whyUnusable("simple", out.simpleSummary)).toBeNull();
  });

  it("builds from Brief and Fuller alone", () => {
    const out = buildSimpleSummary({ brief: { paragraphs: BRIEF }, fuller: { paragraphs: FULLER } }, { ...stamp, dropped: emptyDropped() });
    expect(out.levels).toEqual({ brief: BRIEF, fuller: FULLER });
    expect(out.version).toBe(SIMPLE_VERSION);
  });

  it("still fails as a whole when either of the two is lost", async () => {
    broken = "brief";
    await expect(generateSimpleSummary({ article: ARTICLE, profile: null, power: "standard", guard: false })).rejects.toThrow();
  });
});

describe("each level is announced when it is final (plan 261004f, stage 2)", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("says Brief is ready while Fuller is still being written, with the paragraphs that are then stored", async () => {
    let release = () => {};
    held = { level: "fuller", until: new Promise<void>((r) => (release = r)) };
    const seen: { level: string; paragraphs: unknown }[] = [];
    const pending = generateSimpleSummary({
      article: ARTICLE,
      profile: null,
      power: "standard",
      guard: true,
      onLevel: (level, paragraphs) => seen.push({ level, paragraphs }),
    });
    for (let i = 0; i < 20 && seen.length === 0; i++) await tick();
    /* Fuller's answer has not arrived, and Brief has been written and checked. */
    expect(seen.map((s) => s.level)).toEqual(["brief"]);
    expect(checks).toHaveLength(1);
    release();
    const out = await pending;
    expect(seen.map((s) => s.level)).toEqual(["brief", "fuller"]);
    expect(seen[0]?.paragraphs).toEqual(out.simpleSummary.levels.brief);
    expect(seen[1]?.paragraphs).toEqual(out.simpleSummary.levels.fuller);
  });

  it("does not announce a level that fails, and a listener that throws does not lose the write", async () => {
    broken = "brief";
    const seen: string[] = [];
    await expect(
      generateSimpleSummary({ article: ARTICLE, profile: null, power: "standard", guard: false, onLevel: (level) => seen.push(level) }),
    ).rejects.toThrow();
    expect(seen).not.toContain("brief");

    broken = null;
    const out = await generateSimpleSummary({
      article: ARTICLE,
      profile: null,
      power: "standard",
      guard: false,
      onLevel: () => {
        throw new Error("the listener broke");
      },
    });
    expect(Object.keys(out.simpleSummary.levels).sort()).toEqual(["brief", "fuller"]);
  });
});

describe("a row stored while there were three levels", () => {
  it("still reads: its Brief and Fuller are usable and its middle level is ignored", () => {
    const row = oldRow();
    expect(isUsableSimpleSummary(row)).toBe(true);
    expect(whyUnusable("simple", row)).toBeNull();
    /* Nothing strips it: the stored JSON is not rewritten. */
    expect((row.levels as Record<string, unknown>).simple).toEqual(OLD_SIMPLE);
  });

  it("is not made unusable by a middle level that is over its old limits", () => {
    /* One paragraph, where the old minimum was two. Before the level went this
       made the whole row unusable, Brief and Fuller with it. */
    expect(isUsableSimpleSummary(oldRow([para("Only one.", INTRO.id)]))).toBe(true);
    expect(isUsableSimpleSummary(oldRow("not a list"))).toBe(true);
  });

  it("is still unusable when Brief or Fuller is", () => {
    const row = oldRow();
    expect(isUsableSimpleSummary({ ...row, levels: { ...row.levels, brief: [] } })).toBe(false);
    expect(isUsableSimpleSummary({ ...row, levels: { simple: OLD_SIMPLE, fuller: FULLER } })).toBe(false);
    expect(isUsableSimpleSummary({ ...row, check: { ...row.check, levels: { simple: passed, fuller: passed } } })).toBe(false);
  });
});

describe("Brief's and Fuller's prompts", () => {
  /* A change to either prompt changes its hash here and wants a version bump.
     When the middle level went (stage 1) neither moved, so the version did not.
     `/8` is stage 2's longer Fuller: Fuller's hash moved and **Brief's is the
     one `/7` shipped**, which is what "Brief unchanged" means.
     `/9` (plan 261005b) made the length follow the piece's, in four bands;
     `SIMPLE_SYSTEMS` is the standard band's pair, and **neither hash moved**:
     an article of 2,500 to 14,999 words is asked exactly what `/8` asked. */
  it("are the bytes `simple-prompt/8` shipped, for a piece of standard length", () => {
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    expect(SIMPLE_PROMPT_VERSION).toBe("simple-prompt/9");
    expect(sha(SIMPLE_SYSTEMS.brief)).toBe("d492501b13ddd81832463165032a53d486727e65072299eb6da23b76a5bd9595");
    expect(sha(SIMPLE_SYSTEMS.fuller)).toBe("740415e381ea4524317fef9ba6a83e514bafedfb3d13fae9c269f1b57636e2ba");
  });
});

describe("an unforced Summary preserves usable words for the same article", () => {
  const ctx: StepContext = {
    slug: "s", power: "standard", cacheArticle: false,
    signal: new AbortController().signal, report: () => {}, preview: () => {},
  };
  function storedRow() {
    const store = memoryArtefacts();
    const tree = { ...ARTICLE.tree, nodes: {} };
    const row = { ...oldRow(), generator: CAPABLE_MODEL, sourceHash: inputFingerprint(BLOCKS, tree, ARTICLE.meta) };
    store.plant("s", "structure", "blocks", { blocks: BLOCKS });
    store.plant("s", "structure", "tree", tree);
    store.plant("s", "extract", "meta", { ...ARTICLE.meta, slug: "s" });
    return { store, row };
  }
  it("skips a stored summary from a different model generation", async () => {
    const { store, row } = storedRow();
    row.generator = "anthropic/claude-sonnet-4";
    store.plant("s", "simple", "simple", row);
    expect(await store.has("s", "simple", ["simple"])).toBe(true);
    expect(await stepIsDone(STEPS.simple, ctx, store)).toBe(true);
    store.plant("s", "simple", "simple", { ...row, sourceHash: "article-moved" });
    expect(await stepIsDone(STEPS.simple, ctx, store)).toBe(false);
  });
  it("skips a legacy row without a promptVersion", async () => {
    const { store, row } = storedRow();
    const { promptVersion: _missing, ...legacy } = row;
    store.plant("s", "simple", "simple", legacy);
    expect(await stepIsDone(STEPS.simple, ctx, store)).toBe(true);
  });
});

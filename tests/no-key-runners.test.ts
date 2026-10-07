/**
 * With no `OPENROUTER_API_KEY`, each of the seven streaming runners says the
 * reader's sentence, makes no request, and the gateway says the operator's
 * sentence once.
 *
 * ## Why this file exists
 *
 * Until 2026-10-04 each runner opened with its own copy of the same block: load
 * `.env.local`, read the key, log, throw `NOT_CONFIGURED`. The key it read was
 * never used again, because the call goes through src/ai-call.ts and `apiKey()`
 * there reads the key itself and throws the same sentence. The seven copies
 * were deleted (plan 261004c § R3), which moved the throw from before each
 * runner's `try` to inside it.
 *
 * So the first block below is a **characterisation test**: it was green on the
 * tree with the seven pre-checks and must stay green without them. If a
 * runner's `catch` ever rewrites the gateway's error, the exact-message
 * assertion here is what goes red.
 *
 * The second block is what changed: the operator's half used to be seven
 * different lines, one per feature, and is now one fixed line from the gateway.
 * It was red before the change, because none of the seven old lines was that
 * sentence.
 *
 * `LOG_LEVEL` is raised inside `vi.hoisted` for the reason
 * tests/helpers/log-capture.ts gives: the logger reads its level once, at load,
 * and `NODE_ENV=test` otherwise makes it silent, which would satisfy "logged
 * once" never and "logged nothing else" always.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "info";
  return { previousLevel };
});

import { openRouterJson } from "../src/ai-call.js";
import { collectSpend } from "../src/ai-spend.js";
import { converse } from "../src/converse.js";
import { explainStream } from "../src/explain.js";
import { NOT_CONFIGURED } from "../src/messages.js";
import { markAnswerStream } from "../src/quiz-mark.js";
import { runClaimsStream } from "../src/referee-claims-run.js";
import { runCriterionStream } from "../src/referee-criteria-run.js";
import { mirrorStream } from "../src/referee-mirror.js";
import { hiddenCheckStream } from "../src/referee-hidden-check.js";
import { grouped } from "../src/scan-groups.js";
import { findPassagesStream } from "../src/search.js";
import type { Block, BlockId, Comment, Meta } from "../src/types.js";
import { logLinesWhile } from "./helpers/log-capture.js";

const TEXT = "Participants were randomised by a computer-generated sequence held off site.";
const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks: Block[] = [
  {
    id: "spya-k3m9qt" as BlockId,
    tag: "p",
    kind: "text",
    text: TEXT,
    words: TEXT.split(/\s+/).length,
    html: `<p>${TEXT}</p>`,
    gistable: true,
  },
];
/* The Mirror answers a set with nothing to send without calling a model at
   all, so it needs one real comment to reach the gateway. */
const COMMENT: Comment = {
  id: "spya-c00001",
  blockId: "spya-k3m9qt" as BlockId,
  quote: "randomised",
  start: TEXT.indexOf("randomised"),
  createdAt: "2026-09-02T00:00:00.000Z",
  status: "none",
  body: "This does not say who held the sequence.",
};

/** The seven, each with the smallest request that gets as far as the gateway. */
const RUNNERS: Record<string, () => AsyncIterable<unknown>> = {
  "src/converse.ts": () =>
    converse({ power: "standard", meta, blocks, history: [], question: "why?", slug: "example" }),
  "src/explain.ts": () =>
    explainStream({ power: "standard", meta, blocks, blockId: "spya-k3m9qt", quote: "randomised" }),
  "src/quiz-mark.ts": () =>
    markAnswerStream({
      meta,
      blocks,
      question: "What does the piece claim?",
      referenceAnswer: "It claims a thing.",
      evidence: [],
      answer: "I think it claims a thing.",
      power: "standard",
    }),
  "src/search.ts": () => findPassagesStream({ power: "standard", meta, blocks, criterion: "randomisation" }),
  "src/referee-claims-run.ts": () => runClaimsStream({ power: "standard", meta, blocks }),
  "src/referee-criteria-run.ts": () =>
    runCriterionStream({
      power: "standard",
      meta,
      blocks,
      criterion: "Are the controls adequate?",
      config: { kind: "single" },
    }),
  "src/referee-mirror.ts": () => mirrorStream({ power: "standard", blocks, comments: [COMMENT] }),
  /* One flagged row, because a check over none is no model call at all. */
  "src/referee-hidden-check.ts": () =>
    hiddenCheckStream({
      power: "standard",
      groups: grouped([{ kind: "colour-on-background", where: "body > p", text: "Hidden words.", detail: "color: #fff" }]),
    }),
};

async function drain(events: AsyncIterable<unknown>): Promise<void> {
  for await (const event of events) void event;
}

/** The fixed words `apiKey()` logs. Nothing is interpolated into them. */
const OPERATOR_LINE = "OPENROUTER_API_KEY is not set, so every model call on this wire will fail";

/** How many times `needle` occurs in `haystack`. */
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

let fetchMock: ReturnType<typeof vi.fn>;
let keyBefore: string | undefined;
beforeEach(() => {
  keyBefore = process.env.OPENROUTER_API_KEY;
  /* Deleted, not set to "": the hazard the old pre-checks carried was a
     `loadEnvLocal()` that could put a real key back, and a real key plus a
     `fetch` that was not stubbed is a paid call. The stub below is the second
     guard: whatever happens to the key, nothing here reaches a network. */
  delete process.env.OPENROUTER_API_KEY;
  fetchMock = vi.fn(async () => {
    throw new Error("a runner with no key must not call fetch");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (keyBefore === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = keyBefore;
});
afterAll(() => {
  if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = HOISTED.previousLevel;
});

describe("a runner with no key (characterisation: green before and after the pre-checks went)", () => {
  it.each(Object.keys(RUNNERS))("%s rejects with exactly NOT_CONFIGURED, asks nothing and records nothing", async (file) => {
    let thrown: unknown;
    const { report } = await collectSpend(async () => {
      try {
        await drain(RUNNERS[file]!());
      } catch (err) {
        thrown = err;
      }
    });
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(NOT_CONFIGURED.message);
    expect(fetchMock).not.toHaveBeenCalled();
    /* No attempt, no record: a row for a call that never left the process is a
       phantom in the bill (src/ai-call.ts § `prepare`). */
    expect(report.calls).toHaveLength(0);
    expect(report.pending).toHaveLength(0);
    /* The key is still gone. A library that reloaded `.env.local` here would
       have put one back. */
    expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
  });
});

describe("the operator's half is said once, by the gateway", () => {
  it.each(Object.keys(RUNNERS))("%s: one line naming the variable, in the gateway's fixed words", async (file) => {
    const logged = await logLinesWhile(async () => {
      await expect(drain(RUNNERS[file]!())).rejects.toThrow(NOT_CONFIGURED.message);
    });
    expect(count(logged, OPERATOR_LINE)).toBe(1);
    /* And no second line naming it in other words, which is what a runner's
       own pre-check coming back would look like. */
    expect(count(logged, "OPENROUTER_API_KEY")).toBe(1);
  });

  it("the non-streamed seam says it once too", async () => {
    const logged = await logLinesWhile(async () => {
      await expect(openRouterJson("pdf", { model: "google/gemini-3.1-flash-lite" })).rejects.toThrow(
        NOT_CONFIGURED.message,
      );
    });
    expect(count(logged, OPERATOR_LINE)).toBe(1);
    expect(count(logged, "OPENROUTER_API_KEY")).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an empty key is a missing key", async () => {
    process.env.OPENROUTER_API_KEY = "";
    const logged = await logLinesWhile(async () => {
      await expect(drain(RUNNERS["src/search.ts"]!())).rejects.toThrow(NOT_CONFIGURED.message);
    });
    expect(count(logged, OPERATOR_LINE)).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

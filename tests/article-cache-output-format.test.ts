/**
 * **The cache format table against the requests the stages actually send.**
 *
 * `ARTICLE_OUTPUT_FORMAT` is part of the cache key, but it is necessarily a
 * hand-maintained table: the request belongs to each generator while cache
 * grouping belongs to the pipeline. A complete `Record` catches a missing row,
 * not a truthful one. If a stage adopts a schema and its row stays `null`, it
 * silently pays the 1.25x cache-write premium beside stages whose request can
 * never share its entry.
 *
 * Drive every `ArticleStage` to its real `streamMessage` seam and compare the
 * body there. The stream throws after recording the request because no answer
 * is needed to inspect the cache key, and inventing eleven parseable answers
 * would test the fixture rather than this contract.
 */
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Article } from "../src/article-input.js";
import { generateArc } from "../src/arc.js";
import { generateCrossrefs } from "../src/crossrefs.js";
import { generateFaq } from "../src/faq.js";
import { generateGlossary } from "../src/glossary.js";
import { generateIdeas } from "../src/ideas.js";
import { type ArticleStage, STAGE_EFFORT } from "../src/models.js";
import { ARTICLE_OUTPUT_FORMAT } from "../src/pipeline.js";
import { generateQuiz } from "../src/quiz.js";
import { generateQuotes } from "../src/quotes.js";
import { generateRelations } from "../src/relations.js";
import { generateSimpleSummary } from "../src/simple-summary.js";
import { generateSketch } from "../src/sketch.js";
import { generateTimeline } from "../src/timeline.js";
import { generateTweets } from "../src/tweets.js";

type RequestBody = { output_config?: { effort?: string; format?: unknown } };

const sent: { task: string; body: RequestBody }[] = [];

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: (task: string, body: RequestBody) => {
      sent.push({ task, body: structuredClone(body) });
      throw new Error("request captured");
    },
  };
});

let article: Article;

beforeAll(async () => {
  const { readArticleFromDir } = await import("./helpers/article-from-dir.js");
  article = await readArticleFromDir(path.resolve(import.meta.dirname, "..", "example"));
});

beforeEach(() => {
  sent.length = 0;
});

const RUNNERS = {
  arc: () => generateArc({ article, power: "standard" }),
  tweets: () => generateTweets({ article, power: "standard" }),
  glossary: () => generateGlossary({ article, previous: null, power: "standard" }),
  quotes: () => generateQuotes({ article, previous: null, power: "standard" }),
  ideas: () => generateIdeas({ article, previous: null, power: "standard" }),
  sketch: () => generateSketch({ article, power: "standard" }),
  timeline: () => generateTimeline({ article, previous: null, power: "standard" }),
  quiz: () => generateQuiz({ article, power: "standard" }),
  faq: () => generateFaq({ article, power: "standard" }),
  relations: () => generateRelations({ article, power: "standard" }),
  crossrefs: () => generateCrossrefs({ article, power: "standard" }),
  simple: () => generateSimpleSummary({ article, profile: null, guard: false, power: "standard" }),
} satisfies Record<ArticleStage, () => Promise<unknown>>;

const STAGES = Object.keys(STAGE_EFFORT) as ArticleStage[];
const STAGES_GAINING_SCHEMAS = [
  "arc",
  "tweets",
  "glossary",
  "timeline",
  "quiz",
  "faq",
  "relations",
  "crossrefs",
  "simple",
] as const satisfies readonly ArticleStage[];

describe("ARTICLE_OUTPUT_FORMAT", () => {
  it.each(STAGES)("matches the request sent by %s", async (stage) => {
    const failure = await RUNNERS[stage]().then(
      () => "the generator returned without sending a request",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(sent.length, `${stage} sent no request: ${failure}`).toBeGreaterThan(0);
    expect(new Set(sent.map((call) => call.task))).toEqual(new Set([stage]));
    for (const call of sent) {
      expect(call.body.output_config?.format ?? null).toEqual(ARTICLE_OUTPUT_FORMAT[stage]);
    }
  });

  it.each(STAGES_GAINING_SCHEMAS)("sends %s with its schema and effort together", async (stage) => {
    await RUNNERS[stage]().catch(() => undefined);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.body.output_config?.format).toMatchObject({ type: "json_schema" });
    expect(sent[0]?.body.output_config?.effort).toBe(STAGE_EFFORT[stage]);
  });
});

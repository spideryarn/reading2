/**
 * **High-powered AI, the model half** — docs/plans/260930f-high-powered-ai-per-article.md.
 *
 * One switch moves an article's capable-tier calls from Sonnet 5 to Opus 5.5.
 * What these hold, each because it fails quietly if it is wrong:
 *
 * - **Every capable task moves and nothing else does.** A quick-tier job on Opus
 *   costs twenty times what it should and nobody reads a difference.
 * - **An environment override still wins.** A comparison run is on purpose.
 * - **Freshness sees one generation; checkpoints see two.** A toggle must not
 *   make an article's work look stale (and pay to redo it), and it must not let
 *   an Opus run reuse a Sonnet answer and call it Opus.
 * - **Effort parity.** Opus's default effort is `medium` where Sonnet's is
 *   `high`, so a call that takes the default would think *less* on the model
 *   that is meant to think more. Both wires send `high` explicitly to it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AiRequestBody, CHAT_REASONING, type ChatJob, openRouterJson } from "../src/ai-call.js";
import { investigateContextHash, type InvestigateContext } from "../src/citation-investigate-context.js";
import { type LookupContext, lookupContextHash } from "../src/citation-lookup.js";
import { messagesWireBody } from "../src/messages-stream.js";
import {
  CAPABLE_MODEL,
  CAPABLE_GENERATION_KEY,
  CAPABLE_MODEL_OPENROUTER,
  DISPLAY_NAME,
  generationKey,
  generatorFor,
  HIGH_POWER_MODEL,
  HIGH_POWER_MODEL_OPENROUTER,
  modelFor,
  PIPELINE_TASKS,
  QUICK_MODEL_OPENROUTER,
  resolveModel,
  sameGenerator,
  TASK_TIER,
  type Task,
} from "../src/models.js";
import { sameStamp } from "../src/store/artifacts.js";

const ALL_TASKS = Object.keys(TASK_TIER) as Task[];

afterEach(() => {
  delete process.env.SPIDERYARN_CHAT_MODEL;
});

describe("which model a task sends at each power", () => {
  it("moves every capable-tier task to Opus at high power", () => {
    const capable = ALL_TASKS.filter((t) => TASK_TIER[t] === "capable");
    /* Not vacuous: the table is nearly all capable. */
    expect(capable.length).toBeGreaterThan(20);
    for (const task of capable) {
      expect(modelFor(task, "high"), task).toBe(HIGH_POWER_MODEL_OPENROUTER);
      expect(modelFor(task, "standard"), task).toBe(CAPABLE_MODEL_OPENROUTER);
    }
  });

  it("leaves every quick-tier task where it is", () => {
    const quick = ALL_TASKS.filter((t) => TASK_TIER[t] === "quick");
    expect(quick.length).toBeGreaterThan(0);
    for (const task of quick) {
      expect(modelFor(task, "high"), task).toBe(QUICK_MODEL_OPENROUTER);
      expect(modelFor(task, "high"), task).toBe(modelFor(task, "standard"));
    }
  });

  it("lets an environment override win at high power, and says so", () => {
    process.env.SPIDERYARN_CHAT_MODEL = "someone/else-9";
    expect(resolveModel("chat", "high")).toEqual({
      id: "someone/else-9",
      provider: "openrouter",
      wire: "chat",
      source: "override",
    });
  });

  it("has a display name for both spellings, and one name for them", () => {
    expect(DISPLAY_NAME[HIGH_POWER_MODEL]).toBe("claude-opus-5-5");
    expect(DISPLAY_NAME[HIGH_POWER_MODEL_OPENROUTER]).toBe("claude-opus-5-5");
  });

  it("stamps the name, never the address", () => {
    expect(generatorFor("standard")).toBe(CAPABLE_MODEL);
    expect(generatorFor("high")).toBe(HIGH_POWER_MODEL);
  });
});

describe("freshness treats standard and high as one generation", () => {
  it("equates the four spellings and nothing else", () => {
    for (const a of [CAPABLE_MODEL, CAPABLE_MODEL_OPENROUTER, HIGH_POWER_MODEL, HIGH_POWER_MODEL_OPENROUTER]) {
      for (const b of [CAPABLE_MODEL, CAPABLE_MODEL_OPENROUTER, HIGH_POWER_MODEL, HIGH_POWER_MODEL_OPENROUTER]) {
        expect(sameGenerator(a, b), `${a} ~ ${b}`).toBe(true);
      }
      expect(sameGenerator(a, "someone/else-9")).toBe(false);
      expect(sameGenerator(a, QUICK_MODEL_OPENROUTER)).toBe(false);
    }
  });

  it("keeps the canonical key byte-identical to what stored citation hashes used", () => {
    /* Every existing lookup and investigation was hashed over the wire id. A
       canonical value of anything else would detach all of them on deploy. It
       is a durable fingerprint token in its own right, not an alias for the
       current capable model constant: the latter will move on the next model
       upgrade, while stored hashes cannot be rewritten by `generationKey`. */
    expect(CAPABLE_GENERATION_KEY).toBe("anthropic/claude-sonnet-5");
    expect(generationKey(CAPABLE_MODEL_OPENROUTER)).toBe(CAPABLE_GENERATION_KEY);
    expect(generationKey(HIGH_POWER_MODEL_OPENROUTER)).toBe(CAPABLE_GENERATION_KEY);
    expect(generationKey("someone/else-9")).toBe("someone/else-9");
  });

  it("sameStamp calls an Opus artefact current against a Sonnet expectation, and vice versa", () => {
    const base = { inputHash: "abc", promptVersion: "x/1" };
    expect(sameStamp({ ...base, model: HIGH_POWER_MODEL }, { ...base, model: CAPABLE_MODEL })).toBe(true);
    expect(sameStamp({ ...base, model: CAPABLE_MODEL }, { ...base, model: HIGH_POWER_MODEL })).toBe(true);
    /* And still refuses a model that is really different. */
    expect(sameStamp({ ...base, model: "someone/else-9" }, { ...base, model: CAPABLE_MODEL })).toBe(false);
    /* The other fields still decide. */
    expect(sameStamp({ ...base, inputHash: "zzz", model: HIGH_POWER_MODEL }, { ...base, model: CAPABLE_MODEL })).toBe(
      false,
    );
  });

  const LOOKUP: LookupContext = {
    title: "A cited work",
    authors: "Somebody",
    year: "2001",
    reference: "Somebody (2001). A cited work.",
    why: "It is the evidence for the second claim.",
    passage: "As Somebody showed…",
    anchor: null,
  };

  it("lookupContextHash is the same at either power and different for another model (Sol F1)", () => {
    const standard = lookupContextHash(LOOKUP, modelFor("citations-find", "standard"));
    expect(lookupContextHash(LOOKUP, modelFor("citations-find", "high"))).toBe(standard);
    expect(lookupContextHash(LOOKUP, "someone/else-9")).not.toBe(standard);
  });

  const INVESTIGATE: InvestigateContext = {
    title: "A cited work",
    authors: "Somebody",
    year: "2001",
    reference: "Somebody (2001). A cited work.",
    url: "https://example.org/work",
    linkFrom: "article",
    why: "It is the evidence for the second claim.",
    passages: ["As Somebody showed…"],
  };

  it("investigateContextHash is the same at either power and different for another model (Sol F1)", () => {
    const at = (model: string) => investigateContextHash(INVESTIGATE, "article-key", null, null, model);
    const standard = at(modelFor("citation-investigate", "standard"));
    expect(at(modelFor("citation-investigate", "high"))).toBe(standard);
    expect(at("someone/else-9")).not.toBe(standard);
  });
});

describe("effort parity on the messages wire", () => {
  const ADAPTIVE = {
    max_tokens: 16,
    thinking: { type: "adaptive" as const },
    messages: [{ role: "user" as const, content: "irrelevant" }],
  };

  it("sends high to Opus where the call would otherwise take the default", () => {
    const wire = messagesWireBody("illustrated", ADAPTIVE, "high") as unknown as Record<string, unknown>;
    expect(wire.model).toBe(HIGH_POWER_MODEL_OPENROUTER);
    expect(wire.output_config).toEqual({ effort: "high" });
  });

  it("keeps an effort the call chose", () => {
    const wire = messagesWireBody(
      "arc",
      { ...ADAPTIVE, output_config: { effort: "medium" } },
      "high",
    ) as unknown as Record<string, unknown>;
    expect(wire.output_config).toEqual({ effort: "medium" });
  });

  it("changes nothing at standard power", () => {
    const wire = messagesWireBody("illustrated", ADAPTIVE, "standard") as unknown as Record<string, unknown>;
    expect(wire.model).toBe(CAPABLE_MODEL_OPENROUTER);
    expect(wire).not.toHaveProperty("output_config");
  });

  it("puts every pipeline task's high-power model on the wire", () => {
    for (const task of PIPELINE_TASKS) {
      expect((messagesWireBody(task, ADAPTIVE, "high") as { model: string }).model, task).toBe(
        HIGH_POWER_MODEL_OPENROUTER,
      );
    }
  });
});

describe("effort parity on the chat wire", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          headers: new Headers(),
          text: async () => JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function sent(job: ChatJob, model: string): Promise<Record<string, unknown>> {
    fetchMock.mockClear();
    await openRouterJson(job, { model } as AiRequestBody);
    const init = fetchMock.mock.calls[0]?.[1] as { body: string };
    return JSON.parse(init.body) as Record<string, unknown>;
  }

  it("sends high to Opus on a provider-default row", async () => {
    expect("providerDefault" in CHAT_REASONING.explain).toBe(true);
    expect((await sent("explain", HIGH_POWER_MODEL_OPENROUTER)).reasoning).toEqual({ effort: "high" });
  });

  it("still sends nothing on a provider-default row to Sonnet", async () => {
    expect(await sent("explain", CAPABLE_MODEL_OPENROUTER)).not.toHaveProperty("reasoning");
  });

  it("keeps a row's own effort on Opus", async () => {
    expect((await sent("referee-claims", HIGH_POWER_MODEL_OPENROUTER)).reasoning).toEqual({ effort: "medium" });
  });
});

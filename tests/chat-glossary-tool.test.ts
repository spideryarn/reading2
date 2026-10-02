/**
 * Chat sees that the reader added a term, but not the private web answer that
 * caused the addition (plan 261002f). `article_glossary` goes through the
 * owner's combined glossary, so this boundary needs a direct check: a future
 * formatter must not innocently start printing every `lookup` it receives.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  loadGlossary: null as null | (() => Promise<unknown>),
}));

vi.mock("../src/store/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/index.js")>(
    "../src/store/index.js",
  );
  return {
    ...actual,
    loadGlossary: async () => {
      if (!store.loadGlossary) throw new Error("test did not set loadGlossary");
      return store.loadGlossary();
    },
  };
});

import { runTool } from "../src/chat-tools.js";
import type { Block, GlossaryResponse, Meta } from "../src/types.js";

const ctx = {
  slug: "piece",
  meta: { slug: "piece", title: "A piece" } as Meta,
  blocks: [] as Block[],
  power: "standard" as const,
};

beforeEach(() => {
  store.loadGlossary = null;
});

describe("article_glossary with a reader-added term", () => {
  it("shows the name and an added note, but not the lookup answer", async () => {
    store.loadGlossary = async () =>
      ({
        glossary: {
          entries: [
            {
              id: "spya-add234",
              name: "Attention head",
              kind: "term",
              aliases: [],
              blocks: ["spya-bck234"],
              added: true,
              lookup: {
                answer: "Private answer text that chat must not receive.",
                citations: [{ url: "https://example.test/private", title: "Private source" }],
                searches: 1,
                model: "a-model",
                at: "2026-10-02T00:00:00.000Z",
              },
            },
          ],
        },
        stale: false,
        outdated: false,
      }) as unknown as GlossaryResponse;

    const result = await runTool("article_glossary", {}, ctx);
    expect(result.content).toContain("Attention head");
    expect(result.content).toContain("the reader looked this term up and added it themselves");
    expect(result.content).not.toContain("Private answer text");
    expect(result.content).not.toContain("example.test/private");
  });
});

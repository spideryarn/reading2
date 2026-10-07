/**
 * **`runTool` refuses a tool the turn's kind was not offered, before it runs
 * anything** — GPT Sol's F1 on
 * docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md.
 *
 * The guide is offered five article tools (`GUIDE_TOOLS`). The offer is not the
 * gate: a model can ask for a tool it was never shown, and an article can ask
 * it to. So every name a guide turn may not run is called here as the model
 * would call it, and the test asserts that no fetch went out and no store was
 * read — not merely that the answer says "no such tool".
 *
 * The store and the fetcher are spies, so the positive control (an offered
 * tool does reach the store) proves the spies are wired.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ store: [] as string[], fetch: [] as string[] }));

vi.mock("../src/store/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/index.js")>("../src/store/index.js");
  const spy = (name: string) => async () => {
    calls.store.push(name);
    throw new Error(`a guide turn reached the store: ${name}`);
  };
  return {
    ...actual,
    chatStore: { ...actual.chatStore, load: spy("chatStore.load") },
    commentStore: { ...actual.commentStore, load: spy("commentStore.load") },
    librarySearch: { ...actual.librarySearch, searchLibrary: spy("librarySearch.searchLibrary") },
    loadArticle: spy("loadArticle"),
    loadCitations: spy("loadCitations"),
    loadGlossary: async () => {
      calls.store.push("loadGlossary");
      return null;
    },
  };
});

vi.mock("../src/fetch.js", async () => {
  const actual = await vi.importActual<typeof import("../src/fetch.js")>("../src/fetch.js");
  return {
    ...actual,
    fetchDocument: async (url: string) => {
      calls.fetch.push(url);
      throw new Error("a guide turn reached the fetcher");
    },
  };
});

import { CHAT_TOOLS, READER_NOTES_TOOL, runTool, toolsFor } from "../src/chat-tools.js";
import type { Meta, ThreadKind } from "../src/types.js";

const meta = { title: "A piece" } as unknown as Meta;
const ctx = (kind: ThreadKind | undefined) => ({
  slug: "a-piece",
  meta,
  blocks: [],
  power: "standard" as const,
  kind,
  threadId: "spya-gdeab2",
});

let realFetch: typeof fetch;
beforeEach(() => {
  calls.store.length = 0;
  calls.fetch.length = 0;
  realFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    calls.fetch.push(String(input instanceof Request ? input.url : input));
    return Promise.reject(new Error("a guide turn reached fetch"));
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Every tool any kind has, with arguments a model might send for it. */
const ARGS: Record<string, Record<string, unknown>> = {
  read_web_page: { url: "https://example.com/elsewhere" },
  search_library: { query: "entropy" },
  read_library_passage: { slug: "another-piece", blockId: "spya-k3m9qt" },
  reader_notes: {},
};

describe("a guide turn", () => {
  const offered = new Set(toolsFor("guide").map((t) => t.function.name));
  const refused = [...CHAT_TOOLS, READER_NOTES_TOOL]
    .map((t) => t.function.name)
    .filter((name) => !offered.has(name));

  it("is refused exactly the tools that leave the article", () => {
    expect(refused.sort()).toEqual(["read_library_passage", "read_web_page", "reader_notes", "search_library"]);
  });

  it.each(refused)("runs nothing for %s: no fetch, no store read, and is told there is no such tool", async (name) => {
    const out = await runTool(name, ARGS[name] ?? {}, ctx("guide"));
    expect(out.detail).toBe("no such tool");
    expect(out.content).toContain(`There is no tool called "${name}"`);
    const offeredList = out.content.split("The tools you have are:")[1] ?? "";
    expect(offeredList).toContain("article_glossary");
    expect(offeredList).not.toContain("read_web_page");
    expect(calls.fetch).toEqual([]);
    expect(calls.store).toEqual([]);
  });

  /* The positive control: the spies are wired, so an empty list above means
     nothing ran rather than nothing was watched. */
  it("still runs a tool it was offered", async () => {
    await runTool("article_glossary", {}, ctx("guide"));
    expect(calls.store).toEqual(["loadGlossary"]);
  });
});

describe("every other kind", () => {
  /* The gate is for every kind, not the guide's alone. A chat still reaches
     the fetcher for read_web_page — it is offered it. */
  it("reaches a tool it was offered", async () => {
    await runTool("read_web_page", ARGS.read_web_page ?? {}, ctx("chat"));
    expect(calls.fetch.length + calls.store.length).toBeGreaterThan(0);
  });

  it("refuses a name that is no tool at all, before anything runs", async () => {
    const out = await runTool("delete_everything", {}, ctx("chat"));
    expect(out.detail).toBe("no such tool");
    expect(calls.fetch).toEqual([]);
    expect(calls.store).toEqual([]);
  });

  it.each(["learn", "tutorial", "candidates", undefined] as const)(
    "%s is still refused reader_notes and reads nothing",
    async (kind) => {
      const out = await runTool("reader_notes", {}, ctx(kind));
      expect(out.detail).toBe("no such tool");
      expect(calls.store).toEqual([]);
    },
  );
});

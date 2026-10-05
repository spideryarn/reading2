// @vitest-environment jsdom
/**
 * **What each argument row does when pressed** — the runners the reading view
 * and the Metadata page build from the controllers they already own. Plan
 * 261003f, Stage 1.
 *
 *  - **Jump** goes to `findLiteral`'s first hit through the jump it is handed,
 *    once; with none it keeps the bar open and says so, rather than shutting
 *    over a press that went nowhere.
 *  - **Tags** go through the shelf row's controller (F4), and a refused save
 *    keeps the bar open with the server's sentence.
 *  - **Bookmark** refuses a block the article lacks before it writes.
 *  - **Glossary ask** leaves a one-shot hand-off and opens the band **without
 *    arming generate-on-open** (F1): nothing is armed, nothing is posted here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../src/types.js";
import {
  bookmarkRunner,
  chatExecutor,
  glossaryRunners,
  jumpFirstRunner,
  readingExecutor,
  tagRunners,
} from "../src/web/command-runners.js";
import {
  pendingGlossaryAsk,
  resetGlossaryAskForTests,
  takeGlossaryAsk,
} from "../src/web/glossary-ask-handoff.js";
import { pendingActivation, resetActivations } from "../src/web/activation.js";
import { searchDraftFor } from "../src/web/search-draft.js";

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

const BLOCKS: Block[] = [
  block("spya-aaaaaz", "An opening that says nothing much."),
  block("spya-aaabaz", "Here the free energy principle is named."),
  block("spya-aaacaz", "And free energy again, later."),
];

afterEach(() => {
  resetGlossaryAskForTests();
  resetActivations();
});

describe("jump to the first place it says X", () => {
  it("jumps once, to the first block that says it, and closes", async () => {
    const jump = vi.fn();
    const outcome = await jumpFirstRunner(BLOCKS, jump)({ id: "jump-first", words: "Free Energy" });
    expect(jump).toHaveBeenCalledTimes(1);
    expect(jump).toHaveBeenCalledWith("spya-aaabaz");
    expect(outcome).toEqual({ kind: "close" });
  });

  it("keeps the bar open, and says so, when the article does not say it", async () => {
    const jump = vi.fn();
    const outcome = await jumpFirstRunner(BLOCKS, jump)({ id: "jump-first", words: "dopamine" });
    expect(jump).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: "stay", message: "“dopamine” isn't in this article." });
  });

  it("does not claim a single letter is absent: it asks for more", async () => {
    const jump = vi.fn();
    const outcome = await jumpFirstRunner(BLOCKS, jump)({ id: "jump-first", words: "a" });
    expect(jump).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("stay");
    if (outcome.kind === "stay") expect(outcome.message).not.toContain("isn't in this article");
  });
});

describe("tags", () => {
  it("adds and removes through the controller it is handed, and closes", async () => {
    const edit = vi.fn(async () => ["to read"]);
    const runners = tagRunners({ edit });
    expect(await runners["tag-add"]({ id: "tag-add", tag: "to read" })).toEqual({ kind: "close" });
    expect(await runners["tag-remove"]({ id: "tag-remove", tag: "old" })).toEqual({ kind: "close" });
    expect(edit.mock.calls).toEqual([[{ add: ["to read"] }], [{ remove: ["old"] }]]);
  });

  it("keeps the bar open with the server's sentence when the save is refused", async () => {
    const edit = vi.fn(async () => {
      throw new Error("An article can carry at most 30 tags.");
    });
    const outcome = await tagRunners({ edit })["tag-add"]({ id: "tag-add", tag: "x" });
    expect(outcome.kind).toBe("stay");
    if (outcome.kind === "stay") expect(outcome.message).toContain("An article can carry at most 30 tags.");
  });
});

describe("bookmark", () => {
  it("writes through the memoised bookmarker it is handed, and closes", async () => {
    const bookmark = vi.fn(async () => true);
    const outcome = await bookmarkRunner(BLOCKS, bookmark)({ id: "bookmark", blockId: "spya-aaabaz" });
    expect(bookmark).toHaveBeenCalledWith("spya-aaabaz");
    expect(outcome).toEqual({ kind: "close" });
  });

  it("refuses a block the article lacks, before writing anything", async () => {
    const bookmark = vi.fn(async () => true);
    const outcome = await bookmarkRunner(BLOCKS, bookmark)({ id: "bookmark", blockId: "spya-zzzzzz" });
    expect(bookmark).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("stay");
  });

  it("stays open when the write is not confirmed", async () => {
    const outcome = await bookmarkRunner(BLOCKS, async () => false)({ id: "bookmark", blockId: "spya-aaabaz" });
    expect(outcome.kind).toBe("stay");
  });
});

describe("the glossary", () => {
  const terms = [{ id: "spya-adq5wr", name: "Free energy", aliases: [] }];

  it("opens a visible term through the reader's own opener", async () => {
    const openTerm = vi.fn();
    const runners = glossaryRunners({ slug: "a-piece", terms, ready: true, openTerm, openGlossary: vi.fn() });
    expect(await runners["glossary-open"]({ id: "glossary-open", termId: "spya-adq5wr" })).toEqual({
      kind: "close",
    });
    expect(openTerm).toHaveBeenCalledWith("spya-adq5wr");
  });

  it("does not open a term that is not in the visible list", async () => {
    const openTerm = vi.fn();
    const runners = glossaryRunners({ slug: "a-piece", terms, ready: true, openTerm, openGlossary: vi.fn() });
    const outcome = await runners["glossary-open"]({ id: "glossary-open", termId: "spya-adq6xm" });
    expect(openTerm).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("stay");
  });

  it("leaves a one-shot hand-off and opens Glossary without arming a run (F1)", async () => {
    const openGlossary = vi.fn();
    const runners = glossaryRunners({ slug: "a-piece", terms, ready: true, openTerm: vi.fn(), openGlossary });
    const ask = runners["glossary-ask"];
    expect(ask).toBeDefined();
    expect(await ask?.({ id: "glossary-ask", term: "attention head" })).toEqual({ kind: "close" });
    expect(openGlossary).toHaveBeenCalledTimes(1);
    /* No press recorded: generate-on-open has nothing to spend. */
    expect(pendingActivation("a-piece", "glossary")).toBeNull();

    const held = pendingGlossaryAsk("a-piece");
    expect(held).not.toBeNull();
    expect(pendingGlossaryAsk("another-piece")).toBeNull();
    /* One-shot: the first take has it, the second finds nothing. */
    expect(takeGlossaryAsk("a-piece", held ?? -1)).toBe("attention head");
    expect(takeGlossaryAsk("a-piece", held ?? -1)).toBeNull();
    expect(pendingGlossaryAsk("a-piece")).toBeNull();
  });

  it("offers no ask until the read is ready", () => {
    const runners = glossaryRunners({
      slug: "a-piece",
      terms,
      ready: false,
      openTerm: vi.fn(),
      openGlossary: vi.fn(),
    });
    expect(runners["glossary-ask"]).toBeUndefined();
  });

  it("refuses a hand-off taken with somebody else's nonce", async () => {
    const runners = glossaryRunners({ slug: "a-piece", terms, ready: true, openTerm: vi.fn(), openGlossary: vi.fn() });
    await runners["glossary-ask"]?.({ id: "glossary-ask", term: "x" });
    const held = pendingGlossaryAsk("a-piece") ?? -1;
    expect(takeGlossaryAsk("a-piece", held + 1)).toBeNull();
    expect(takeGlossaryAsk("another-piece", held)).toBeNull();
    expect(takeGlossaryAsk("a-piece", held)).toBe("x");
  });
});

/**
 * **The reading view's executor, as one value** — what Reader.tsx hands the
 * Dock. Absent means not offered: a visitor has a jump and nothing else, and
 * the bookmark waits for the comments read (F6).
 */
describe("the reading view's executor", () => {
  const terms = [{ id: "spya-adq5wr", name: "Free energy", aliases: [] }];
  const glossary = (ready: boolean) => ({ ready, terms, openTerm: vi.fn(), openGlossary: vi.fn() });

  it("gives a visitor the jump and nothing that reads, writes or spends", () => {
    const executor = readingExecutor({ slug: "a-piece", blocks: BLOCKS, jump: vi.fn() });
    expect(Object.keys(executor.runners)).toEqual(["jump-first"]);
    expect(executor.sources.glossary).toBeUndefined();
  });

  it("gives the owner the glossary it was handed, and the ask only once the read is ready", () => {
    const waiting = readingExecutor({ slug: "a-piece", blocks: BLOCKS, jump: vi.fn(), glossary: glossary(false) });
    expect(Object.keys(waiting.runners).sort()).toEqual(["glossary-open", "jump-first"]);
    expect(waiting.sources.glossary).toEqual({ ready: false, terms });

    const ready = readingExecutor({ slug: "a-piece", blocks: BLOCKS, jump: vi.fn(), glossary: glossary(true) });
    expect(Object.keys(ready.runners).sort()).toEqual(["glossary-ask", "glossary-open", "jump-first"]);
    expect(ready.sources.glossary).toEqual({ ready: true, terms });
  });

  it("has a bookmark runner only when it is handed the bookmarker", async () => {
    const bookmark = vi.fn(async () => true);
    const executor = readingExecutor({ slug: "a-piece", blocks: BLOCKS, jump: vi.fn(), bookmark });
    expect(await executor.runners.bookmark?.({ id: "bookmark", blockId: "spya-aaabaz" })).toEqual({ kind: "close" });
    expect(bookmark).toHaveBeenCalledWith("spya-aaabaz");
  });

  it("jumps through the jump it was handed", async () => {
    const jump = vi.fn();
    const executor = readingExecutor({ slug: "a-piece", blocks: BLOCKS, jump });
    await executor.runners["jump-first"]?.({ id: "jump-first", words: "free energy" });
    expect(jump).toHaveBeenCalledWith("spya-aaabaz");
  });

  /* Plan 261005i: the bar's *Quick search “X”* row is the bar box's own Enter
     — the words in the article's draft, an `enter` handoff sealed with them,
     then Search mode — and it is the owner's, like the box (Dock.tsx §
     `hasQuickSearch`). */
  it("has a quick search only when it is handed Search's opener, and it does the bar box's Enter", () => {
    const slug = "a-piece-quick-search";
    const order: string[] = [];
    const draft = searchDraftFor(slug);
    const openQuickSearch = vi.fn(() => {
      order.push(`open with ${JSON.stringify(draft.handoff())}`);
    });
    const executor = readingExecutor({ slug, blocks: BLOCKS, jump: vi.fn(), openQuickSearch });
    expect(executor.quickSearch?.("the limits of free will")).toEqual({ kind: "close" });
    expect(draft.text()).toBe("the limits of free will");
    expect(draft.handoff()).toEqual({ type: "enter", text: "the limits of free will" });
    // The handoff is left before the band is opened, so the band mounts onto it.
    expect(order).toEqual(['open with {"type":"enter","text":"the limits of free will"}']);
    expect(openQuickSearch).toHaveBeenCalledTimes(1);
    draft.clearHandoffs();
  });

  it("gives a visitor no quick search, and chat's chips none either", () => {
    const visitor = readingExecutor({ slug: "a-piece", blocks: BLOCKS, jump: vi.fn() });
    expect(visitor.quickSearch).toBeUndefined();
    const owner = readingExecutor({ slug: "a-piece", blocks: BLOCKS, jump: vi.fn(), openQuickSearch: vi.fn() });
    const chat = chatExecutor({ reading: owner, blocks: BLOCKS, jump: vi.fn(), tags: { edit: vi.fn() }, find: vi.fn() });
    expect(chat.quickSearch).toBeUndefined();
  });
});

/* Stage 2: what a chat chip's press reaches. The reading view's own runners —
   the same bookmark function, not a second one (F6) — plus the tags, a find,
   and the jump of the surface the chat is drawn in. */
describe("chat's executor", () => {
  const reading = (bookmark?: (id: string) => Promise<boolean>) =>
    readingExecutor({
      slug: "a-piece",
      blocks: BLOCKS,
      jump: vi.fn(),
      glossary: { ready: true, terms: [], openTerm: vi.fn(), openGlossary: vi.fn() },
      bookmark,
    });

  it("keeps the reading view's runners and its glossary, and adds the tags and the find", () => {
    const base = reading(vi.fn(async () => true));
    const chat = chatExecutor({ reading: base, blocks: BLOCKS, jump: vi.fn(), tags: { edit: vi.fn() }, find: vi.fn() });
    expect(Object.keys(chat.runners).sort()).toEqual(
      ["bookmark", "find", "glossary-ask", "glossary-open", "jump-first", "tag-add", "tag-remove"].sort(),
    );
    expect(chat.runners.bookmark).toBe(base.runners.bookmark);
    expect(chat.runners["glossary-ask"]).toBe(base.runners["glossary-ask"]);
    expect(chat.sources).toBe(base.sources);
  });

  it("has no bookmark where the reading view has none", () => {
    const chat = chatExecutor({ reading: reading(), blocks: BLOCKS, jump: vi.fn(), tags: { edit: vi.fn() }, find: vi.fn() });
    expect(chat.runners.bookmark).toBeUndefined();
  });

  it("jumps through its own surface's jump, not the bar's", async () => {
    const base = reading();
    const jump = vi.fn();
    const chat = chatExecutor({ reading: base, blocks: BLOCKS, jump, tags: { edit: vi.fn() }, find: vi.fn() });
    expect(await chat.runners["jump-first"]?.({ id: "jump-first", words: "free energy" })).toEqual({ kind: "close" });
    expect(jump).toHaveBeenCalledWith("spya-aaabaz");
  });

  it("opens the search on the words, once", async () => {
    const find = vi.fn();
    const chat = chatExecutor({ reading: reading(), blocks: BLOCKS, jump: vi.fn(), tags: { edit: vi.fn() }, find });
    expect(await chat.runners.find?.({ id: "find", words: "free energy" })).toEqual({ kind: "close" });
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith("free energy");
  });

  it("writes a tag through the controller it was handed", async () => {
    const edit = vi.fn(async () => ["to read"]);
    const chat = chatExecutor({ reading: reading(), blocks: BLOCKS, jump: vi.fn(), tags: { edit }, find: vi.fn() });
    await chat.runners["tag-add"]?.({ id: "tag-add", tag: "to read" });
    expect(edit).toHaveBeenCalledWith({ add: ["to read"] });
  });
});

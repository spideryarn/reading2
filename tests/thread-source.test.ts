/**
 * **Where a row in Chat's list came from**, and what the list and its filter
 * are made of. Report `spya-hyfqkq`; plan
 * docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md, D5.
 *
 * The rules are in one pure function, in this order: a stored origin, then a
 * Learn kind, then an anchor, then a plain chat. The order is what these
 * tests hold, because two of the rules can be true of one conversation.
 */
import { describe, expect, it } from "vitest";

import type { ChatAnchor, ThreadKind, ThreadOrigin } from "../src/types.js";
import { CHAT_FROM_WORDS, chatFromParam } from "../src/web/params.js";
import { LEARN_SUB_MODES } from "../src/web/sub-modes.js";
import {
  CHAT_FROM_LABEL,
  chatFrom,
  listedInChat,
  narrowed,
  originBack,
  sourcesIn,
  threadSource,
} from "../src/web/thread-source.js";

const CLAIM: ThreadOrigin = { mode: "sources-claims", blockId: "spya-bbbbbb", quote: "RNA can transfer a memory" };
const BLOCK: ChatAnchor = { blockId: "spya-cccccc" };
const QUOTED: ChatAnchor = { blockId: "spya-cccccc", quote: "the felt quality", start: 4 };

const t = (kind: ThreadKind, over: { origin?: ThreadOrigin; anchor?: ChatAnchor } = {}) => ({ kind, ...over });

describe("threadSource", () => {
  it("names a stored origin first, even on a conversation that also has an anchor", () => {
    expect(threadSource(t("chat", { origin: CLAIM, anchor: BLOCK }))).toEqual({
      from: "sources",
      mode: "sources",
      label: "Started from a claim in Sources › Claims",
      quote: "RNA can transfer a memory",
    });
  });

  it("names Learn and its sub-mode for each of Learn's three kinds, in the sub-mode's own words", () => {
    expect(threadSource(t("learn"))).toEqual({
      from: "learn",
      mode: "learn",
      label: `From Learn › ${LEARN_SUB_MODES.recall.label}`,
      learn: "recall",
    });
    expect(threadSource(t("tutorial"))).toMatchObject({
      from: "learn",
      label: `From Learn › ${LEARN_SUB_MODES.tutorial.label}`,
      learn: "tutorial",
    });
    expect(threadSource(t("explore"))).toMatchObject({
      from: "learn",
      label: `From Learn › ${LEARN_SUB_MODES.explore.label}`,
      learn: "explore",
    });
    expect(threadSource(t("learn"))?.label).toBe("From Learn › Recall");
  });

  it("says an anchored chat is about a passage, and quotes the passage when the anchor has its words", () => {
    expect(threadSource(t("chat", { anchor: BLOCK }))).toEqual({
      from: "passage",
      mode: null,
      label: "About a passage",
    });
    expect(threadSource(t("chat", { anchor: QUOTED }))).toEqual({
      from: "passage",
      mode: null,
      label: "About a passage",
      quote: "the felt quality",
    });
  });

  /* A stored origin keeps its old mode word as data (`citations`, `debate`)
     until the deep rename; what it shows is Sources' icon and filter,
     with the sub-mode in the tooltip (GPT Sol's F5 on plan 261009l). */
  it("names a glossary entry and a cited work, each under its own mode's icon and word", () => {
    expect(threadSource(t("chat", { origin: { mode: "glossary", itemId: "spya-ttm222", quote: "qualia" } }))).toEqual({
      from: "glossary",
      mode: "glossary",
      label: "Started from a glossary entry",
      quote: "qualia",
    });
    expect(
      threadSource(t("chat", { origin: { mode: "bibliography", itemId: "spya-ttm333", quote: "Consciousness Explained" } })),
    ).toEqual({
      from: "sources",
      mode: "sources",
      label: "Started from a cited work in Sources › Bibliography",
      quote: "Consciousness Explained",
    });
  });

  it("names an idea under Ideas' icon and word", () => {
    expect(threadSource(t("chat", { origin: { mode: "ideas", itemId: "spya-idd222", quote: "Attention suffices" } }))).toEqual({
      from: "ideas",
      mode: "ideas",
      label: "Started from an idea",
      quote: "Attention suffices",
    });
  });

  it("says nothing for a plain chat", () => {
    expect(threadSource(t("chat"))).toBeNull();
  });
});

describe("what Chat lists", () => {
  it("is every kind but Candidates", () => {
    const listed = (["chat", "learn", "tutorial", "explore", "candidates"] as const).filter((kind) =>
      listedInChat(t(kind)),
    );
    expect(listed).toEqual(["chat", "learn", "tutorial", "explore"]);
  });
});

describe("the filter", () => {
  const all = [
    { id: "a", ...t("chat") },
    { id: "b", ...t("tutorial") },
    { id: "c", ...t("chat", { origin: CLAIM }) },
    { id: "d", ...t("learn") },
    { id: "e", ...t("chat", { anchor: QUOTED }) },
  ];

  it("puts each conversation under one word, and Learn's three kinds under the same one", () => {
    expect(all.map(chatFrom)).toEqual(["chats", "learn", "sources", "learn", "passage"]);
    expect(chatFrom(t("explore"))).toBe("learn");
  });

  it("offers the sources that are present, once each, in a fixed order", () => {
    expect(sourcesIn(all)).toEqual(["chats", "sources", "learn", "passage"]);
    expect(sourcesIn([all[1], all[3]].filter((x) => x !== undefined))).toEqual(["learn"]);
    expect(sourcesIn([])).toEqual([]);
  });

  it("puts a glossary chat under its word, and a cited-work chat under Sources' with the claims", () => {
    const g = { id: "g", ...t("chat", { origin: { mode: "glossary", itemId: "spya-ttm222", quote: "qualia" } }) };
    const c = { id: "c2", ...t("chat", { origin: { mode: "bibliography", itemId: "spya-ttm333", quote: "A work" } }) };
    const i = { id: "i", ...t("chat", { origin: { mode: "ideas", itemId: "spya-idd222", quote: "An idea" } }) };
    expect(sourcesIn([...all, c, g])).toEqual(["chats", "sources", "glossary", "learn", "passage"]);
    expect(sourcesIn([...all, i, c, g])).toEqual(["chats", "sources", "glossary", "ideas", "learn", "passage"]);
    expect(narrowed([...all, i, c, g], "ideas").map((x) => x.id)).toEqual(["i"]);
    expect(narrowed([...all, c, g], "glossary").map((x) => x.id)).toEqual(["g"]);
    expect(narrowed([...all, c, g], "sources").map((x) => x.id)).toEqual(["c", "c2"]);
    const lens = { id: "l", ...t("chat", { origin: { mode: "reception", lens: "how it relates to Nagel" } }) };
    expect(narrowed([...all, c, lens], "sources").map((x) => x.id)).toEqual(["c", "c2", "l"]);
  });

  it("narrows to one source, and to everything when there is no choice", () => {
    expect(narrowed(all, null).map((x) => x.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(narrowed(all, "chats").map((x) => x.id)).toEqual(["a"]);
    expect(narrowed(all, "learn").map((x) => x.id)).toEqual(["b", "d"]);
    expect(narrowed(all, "sources").map((x) => x.id)).toEqual(["c"]);
    expect(narrowed(all, "passage").map((x) => x.id)).toEqual(["e"]);
  });

  it("has a label for every word the URL can carry", () => {
    expect(Object.keys(CHAT_FROM_LABEL).sort()).toEqual([...CHAT_FROM_WORDS].sort());
    expect(CHAT_FROM_LABEL.chats).toBe("Chats");
    expect(CHAT_FROM_LABEL.learn).toBe("Learn");
    expect(CHAT_FROM_LABEL.sources).toBe("Sources");
    expect(CHAT_FROM_LABEL.glossary).toBe("Glossary");
    expect(CHAT_FROM_LABEL.ideas).toBe("Ideas");
    expect([...CHAT_FROM_WORDS]).toEqual(["chats", "sources", "glossary", "ideas", "learn", "passage"]);
  });

  it("reads `?chatfrom=` as one of those words, and anything else as All", () => {
    for (const word of CHAT_FROM_WORDS) expect(chatFromParam.parse(word)).toBe(word);
    expect(chatFromParam.parse("all")).toBeNull();
    expect(chatFromParam.parse("recall")).toBeNull();
    expect(chatFromParam.parse("")).toBeNull();
    /* The old words are lifted on arrival (router.ts § `liftLegacySources`),
       so the parser itself need not know them. */
    expect(chatFromParam.parse("reception")).toBeNull();
  });
});

/**
 * **The way back's words** (plan 261009k, stage 2): which mode a press opens,
 * whose icon the line wears, and the sentence it says.
 */
describe("originBack", () => {
  it("names the item and its mode, for every item origin", () => {
    expect(originBack(CLAIM)).toEqual({
      mode: "sources",
      view: "claims",
      modeLabel: "Claims",
      quote: "RNA can transfer a memory",
      text: "Back to “RNA can transfer a memory” in Claims",
    });
    expect(originBack({ mode: "glossary", itemId: "spya-ttm222", quote: "qualia" }).text).toBe(
      "Back to “qualia” in Glossary",
    );
    expect(originBack({ mode: "bibliography", itemId: "spya-ttm333", quote: "A work" })).toMatchObject({
      mode: "sources",
      view: "bibliography",
      text: "Back to “A work” in Bibliography",
    });
    expect(originBack({ mode: "ideas", itemId: "spya-dea222", quote: "An idea" })).toMatchObject({
      mode: "ideas",
      text: "Back to “An idea” in Ideas",
    });
  });

  it("calls an angle the reader's, with no quote: it is not an item in the article", () => {
    expect(originBack({ mode: "reception", lens: "how it relates to Nagel" })).toEqual({
      mode: "sources",
      view: "reception",
      modeLabel: "Reception",
      quote: null,
      text: "Back to your angle in Reception",
    });
  });
});

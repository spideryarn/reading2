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
      place: "Claims",
      quote: "RNA can transfer a memory",
    });
  });

  it("names Learn and its sub-mode for each of Learn's two kinds, in the sub-mode's own words", () => {
    expect(threadSource(t("learn"))).toEqual({
      from: "learn",
      mode: "learn",
      label: `From Learn › ${LEARN_SUB_MODES.recall.label}`,
      place: "Recall",
      learn: "recall",
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
     until the deep rename; what it shows is Sources' icon and filter, with the
     sub-mode in the row and tooltip (GPT Sol's F5 on plan 261009l). */
  it("names a glossary entry and a cited work, each under its own mode's icon and word", () => {
    expect(threadSource(t("chat", { origin: { mode: "glossary", itemId: "spya-ttm222", quote: "qualia" } }))).toEqual({
      from: "glossary",
      mode: "glossary",
      label: "Started from a glossary entry",
      place: "Glossary",
      quote: "qualia",
    });
    expect(
      threadSource(t("chat", { origin: { mode: "bibliography", itemId: "spya-ttm333", quote: "Consciousness Explained" } })),
    ).toEqual({
      from: "sources",
      mode: "sources",
      label: "Started from a cited work in Sources › Bibliography",
      place: "Bibliography",
      quote: "Consciousness Explained",
    });
  });

  it("names an idea under Ideas' icon and word", () => {
    expect(threadSource(t("chat", { origin: { mode: "ideas", itemId: "spya-idd222", quote: "Attention suffices" } }))).toEqual({
      from: "ideas",
      mode: "ideas",
      label: "Started from an idea",
      place: "Ideas",
      quote: "Attention suffices",
    });
  });

  /* Report spya-twsm7t: the list says *Investigate*, not only Sources' icon. */
  it("names a question from Investigate as the reader's, under Sources' icon, placed in Investigate", () => {
    expect(threadSource(t("chat", { origin: { mode: "reception", lens: "Is it borne out?" } }))).toEqual({
      from: "sources",
      mode: "sources",
      place: "Investigate",
      label: "Started from a question in Sources › Investigate",
      quote: "Is it borne out?",
      voice: "reader",
    });
  });

  /* Plan 261024i, stage 2: a mark discussed in chat says *Quiz*, under
     Learn's icon and filter, and has no `learn`, so it opens in Chat. */
  it("names a quiz mark's chat as Quiz's, under Learn, and leaves it a chat", () => {
    const mark: ThreadOrigin = {
      mode: "quiz",
      batchId: "spya-bat111",
      itemId: "spya-qqq111",
      attemptId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
      quote: "What does the author mean by order?",
    };
    expect(threadSource(t("chat", { origin: mark }))).toEqual({
      from: "learn",
      mode: "learn",
      label: "Started from a mark in Learn › Quiz",
      place: "Quiz",
      quote: "What does the author mean by order?",
    });
    expect(chatFrom(t("chat", { origin: mark }))).toBe("learn");
  });

  it("places no passage chat and no plain chat", () => {
    expect(threadSource(t("chat", { anchor: QUOTED }))?.place).toBeUndefined();
    expect(threadSource(t("chat"))?.place).toBeUndefined();
  });

  it("says nothing for a plain chat", () => {
    expect(threadSource(t("chat"))).toBeNull();
  });
});

describe("what Chat lists", () => {
  it("is every kind but Candidates", () => {
    const listed = (["chat", "learn", "explore", "candidates"] as const).filter((kind) =>
      listedInChat(t(kind)),
    );
    expect(listed).toEqual(["chat", "learn", "explore"]);
  });
});

describe("the filter", () => {
  const all = [
    { id: "a", ...t("chat") },
    { id: "b", ...t("explore") },
    { id: "c", ...t("chat", { origin: CLAIM }) },
    { id: "d", ...t("learn") },
    { id: "e", ...t("chat", { anchor: QUOTED }) },
  ];

  it("puts each conversation under one word, and Learn's two kinds under the same one", () => {
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
    expect(originBack({ mode: "glossary", itemId: "spya-ttm222", quote: "qualia" })).toEqual({
      mode: "glossary",
      modeLabel: "Glossary",
      quote: "qualia",
      text: "Back to “qualia” in Glossary",
    });
    expect(originBack({ mode: "bibliography", itemId: "spya-ttm333", quote: "A work" })).toEqual({
      mode: "sources",
      view: "bibliography",
      modeLabel: "Bibliography",
      quote: "A work",
      text: "Back to “A work” in Bibliography",
    });
    expect(originBack({ mode: "ideas", itemId: "spya-dea222", quote: "An idea" })).toEqual({
      mode: "ideas",
      modeLabel: "Ideas",
      quote: "An idea",
      text: "Back to “An idea” in Ideas",
    });
  });

  it("goes back to a quiz mark in Quiz, under Learn", () => {
    expect(
      originBack({
        mode: "quiz",
        batchId: "spya-bat111",
        itemId: "spya-qqq111",
        attemptId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
        quote: "Why order?",
      }),
    ).toEqual({
      mode: "learn",
      view: "quiz",
      modeLabel: "Quiz",
      quote: "Why order?",
      text: "Back to “Why order?” in Quiz",
    });
  });

  /* Lands on Investigate, where *Your questions* lists every lens chat, since plan
     261020n moved Reception's angle box there. */
  it("calls a question the reader's, with no quote, and goes back to Investigate: it is not an item in the article", () => {
    expect(originBack({ mode: "reception", lens: "how it relates to Nagel" })).toEqual({
      mode: "sources",
      view: "investigate",
      modeLabel: "Investigate",
      quote: null,
      text: "Back to your question in Investigate",
    });
  });
});

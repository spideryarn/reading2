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
  sourcesIn,
  threadSource,
} from "../src/web/thread-source.js";

const CLAIM: ThreadOrigin = { mode: "debate", blockId: "spya-bbbbbb", quote: "RNA can transfer a memory" };
const BLOCK: ChatAnchor = { blockId: "spya-cccccc" };
const QUOTED: ChatAnchor = { blockId: "spya-cccccc", quote: "the felt quality", start: 4 };

const t = (kind: ThreadKind, over: { origin?: ThreadOrigin; anchor?: ChatAnchor } = {}) => ({ kind, ...over });

describe("threadSource", () => {
  it("names a stored origin first, even on a conversation that also has an anchor", () => {
    expect(threadSource(t("chat", { origin: CLAIM, anchor: BLOCK }))).toEqual({
      from: "debate",
      mode: "debate",
      label: "Started from a claim in Debate",
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
    expect(all.map(chatFrom)).toEqual(["chats", "learn", "debate", "learn", "passage"]);
    expect(chatFrom(t("explore"))).toBe("learn");
  });

  it("offers the sources that are present, once each, in a fixed order", () => {
    expect(sourcesIn(all)).toEqual(["chats", "debate", "learn", "passage"]);
    expect(sourcesIn([all[1], all[3]].filter((x) => x !== undefined))).toEqual(["learn"]);
    expect(sourcesIn([])).toEqual([]);
  });

  it("narrows to one source, and to everything when there is no choice", () => {
    expect(narrowed(all, null).map((x) => x.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(narrowed(all, "chats").map((x) => x.id)).toEqual(["a"]);
    expect(narrowed(all, "learn").map((x) => x.id)).toEqual(["b", "d"]);
    expect(narrowed(all, "debate").map((x) => x.id)).toEqual(["c"]);
    expect(narrowed(all, "passage").map((x) => x.id)).toEqual(["e"]);
  });

  it("has a label for every word the URL can carry", () => {
    expect(Object.keys(CHAT_FROM_LABEL).sort()).toEqual([...CHAT_FROM_WORDS].sort());
    expect(CHAT_FROM_LABEL.chats).toBe("Chats");
    expect(CHAT_FROM_LABEL.learn).toBe("Learn");
    expect(CHAT_FROM_LABEL.debate).toBe("Debate");
  });

  it("reads `?chatfrom=` as one of those words, and anything else as All", () => {
    for (const word of CHAT_FROM_WORDS) expect(chatFromParam.parse(word)).toBe(word);
    expect(chatFromParam.parse("all")).toBeNull();
    expect(chatFromParam.parse("recall")).toBeNull();
    expect(chatFromParam.parse("")).toBeNull();
  });
});

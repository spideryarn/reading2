/**
 * **An answer's mention of an earlier conversation, as a link to it** — the
 * pure half: which conversations may be linked, what a bracketed id becomes,
 * and the address a press goes to. Plan
 * docs/plans/261024u-chat-links-the-earlier-conversation-it-mentions.md, from
 * Greg's report spya-t7cq2s.
 */
import { describe, expect, it } from "vitest";
import type { ChatThread, ThreadKind } from "../src/types.js";
import { splitCitations, type ThreadLink } from "../src/web/citations.js";
import { threadHref, threadLinks } from "../src/web/thread-links.js";

const thread = (id: string, kind: ThreadKind, title = `about ${id}`): ChatThread => ({
  id,
  kind,
  title,
  createdAt: "2026-10-24T10:00:00.000Z",
  updatedAt: "2026-10-24T10:00:00.000Z",
  messages: [],
});

describe("threadLinks — what an answer may link to", () => {
  const links = threadLinks(
    [
      thread("spya-chat23", "chat", "What is access consciousness?"),
      thread("spya-curr23", "chat"),
      thread("spya-gde234", "guide"),
      thread("spya-rcp234", "learn"),
      thread("spya-exp234", "explore"),
      thread("spya-cnd234", "candidates"),
    ],
    "spya-curr23",
  );

  it("lists the reader's conversations but the one on screen and Referee's Candidates", () => {
    expect([...links.keys()].sort()).toEqual(["spya-chat23", "spya-exp234", "spya-gde234", "spya-rcp234"]);
  });

  it("sends each kind to the band that draws it, under the name the list gives it", () => {
    expect(links.get("spya-chat23")).toEqual({
      id: "spya-chat23",
      title: "What is access consciousness?",
      target: { band: "here" },
    });
    expect(links.get("spya-gde234")).toMatchObject({ title: "Guide", target: { band: "chat" } });
    expect(links.get("spya-rcp234")).toMatchObject({ title: "Learn › Recall", target: { band: "learn", view: "recall" } });
    expect(links.get("spya-exp234")).toMatchObject({ target: { band: "learn", view: "explore" } });
  });
});

describe("threadHref — the address a press goes to", () => {
  const chat: ThreadLink = { id: "spya-chat23", title: "t", target: { band: "here" } };

  it("keeps the article where it is and the mode as it is, naming the conversation", () => {
    expect(threadHref("/read/x?at=spya-bck234&margin=1&thread=spya-curr23", chat)).toBe(
      "/read/x?at=spya-bck234&margin=1&thread=spya-chat23",
    );
    expect(threadHref("/read/x?mode=chat&thread=spya-curr23&chatfrom=quiz", chat)).toBe(
      "/read/x?mode=chat&thread=spya-chat23",
    );
    expect(threadHref("/read/x", chat)).toBe("/read/x?thread=spya-chat23");
  });

  it("opens the guide in Chat's band and a Learn conversation in its part of Learn", () => {
    expect(threadHref("/read/x?at=spya-bck234&thread=spya-curr23", { ...chat, target: { band: "chat" } })).toBe(
      "/read/x?at=spya-bck234&mode=chat&thread=spya-chat23",
    );
    expect(
      threadHref("/read/x?mode=chat&learn=quiz&guide=1&thread=spya-curr23", {
        ...chat,
        target: { band: "learn", view: "explore" },
      }),
    ).toBe("/read/x?mode=learn&learn=explore&thread=spya-chat23");
  });
});

describe("splitCitations — a conversation id among the citations", () => {
  const BLOCKS = new Map([["spya-bck234", "a paragraph"]]);
  const LINK: ThreadLink = { id: "spya-chat23", title: "t", target: { band: "here" } };
  const THREADS = new Map([[LINK.id, LINK]]);
  const split = (para: string, threads: ReadonlyMap<string, ThreadLink> = THREADS) =>
    splitCitations(para, BLOCKS, undefined, threads);

  it("draws a listed conversation's id, bracketed or bare, as a link to it", () => {
    expect(split("Your earlier conversation [spya-chat23] covered it.")).toEqual([
      { kind: "text", text: "Your earlier conversation " },
      { kind: "thread", links: [LINK] },
      { kind: "text", text: " covered it." },
    ]);
    expect(split("See spya-chat23.")[1]).toEqual({ kind: "thread", links: [LINK] });
  });

  it("splits a bracket holding a passage and a conversation into one of each", () => {
    expect(split("So [spya-bck234 spya-chat23].")).toEqual([
      { kind: "text", text: "So " },
      { kind: "cite", ids: ["spya-bck234"] },
      { kind: "thread", links: [LINK] },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves an id that is not one of the reader's conversations as the characters the model wrote", () => {
    expect(split("Elsewhere [spya-zzzz23].")).toEqual([{ kind: "text", text: "Elsewhere [spya-zzzz23]." }]);
    expect(split("Here [spya-chat23].", new Map())).toEqual([{ kind: "text", text: "Here [spya-chat23]." }]);
  });

  it("leaves a whole run as text when a passage and a conversation share an id", () => {
    const clash = new Map([["spya-bck234", { ...LINK, id: "spya-bck234" }], [LINK.id, LINK]]);
    expect(split("So [spya-bck234 spya-chat23].", clash)).toEqual([
      { kind: "text", text: "So [spya-bck234 spya-chat23]." },
    ]);
  });
});

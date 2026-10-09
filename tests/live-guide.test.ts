/**
 * **The guide, spoken** — plan
 * docs/plans/261009i-the-guide-greets-in-chat-takes-live-and-a-bar-row.md,
 * stage 1 (Greg, 2026-10-09, `spya-x38nge`: *"Why doesn't the Guide chat have
 * a live conversation option?"*).
 *
 * A live session in a guide thread is the reading companion's voice rules plus
 * the guide's section, with the guide's tools. What could go silently wrong:
 *
 *  - the guide section is missing, so the spoken guide is a content companion
 *    that talks about the piece instead of the reading — nothing errors;
 *  - a `[cmd:…]` token reaches a voice model, which then reads brackets aloud;
 *  - the guide is offered the web, which the typed guide is not;
 *  - a chat or Learn session picks up the guide's section by accident.
 */
import { describe, expect, it } from "vitest";

import { GUIDE_TOOLS } from "../src/chat-tools.js";
import { withoutCommandButtons } from "../src/command-token.js";
import { spokenModeWords } from "../src/guide.js";
import { LIVE_SYSTEM, SHOW_PASSAGE_TOOL, SPOKEN_GUIDE, liveInstructions, liveSeedItems, liveSession, liveTools } from "../src/live.js";
import { gptLiveBackendInstructions, gptLiveSession, gptLiveVoiceInstructions } from "../src/live-gpt.js";
import type { Block, ChatMessage, Meta, Tree, TreeNode } from "../src/types.js";

const meta = { slug: "piece", title: "A Piece", byline: "Someone" } as Meta;
const blocks = [
  { id: "spya-aaa111", tag: "p", kind: "prose", text: "The rainstorm does not compute.", words: 5, html: "<p/>" },
] as unknown as Block[];
const root = {
  id: "n-root",
  depth: 0,
  parent: null,
  children: [],
  range: ["spya-aaa111", "spya-aaa111"],
  title: "The whole piece",
  gist: "Rainstorms do not compute.",
} as unknown as TreeNode;
const tree = { rootId: root.id, nodes: { [root.id]: root } } as unknown as Tree;

const names = (tools: unknown[]): string[] => tools.map((t) => (t as { name: string }).name).sort();

describe("the spoken mode words", () => {
  const words = spokenModeWords();

  it("names the modes, and has no token a voice could read aloud", () => {
    expect(words).toContain("Summary");
    expect(words).toContain("Structure");
    expect(words).not.toContain("[cmd:");
    expect(words).not.toMatch(/Opens at once|Button:/);
  });
});

describe("a Realtime session in a guide", () => {
  const text = liveInstructions({ meta, blocks, kind: "guide" });

  it("is the companion's voice rules plus the guide section and the mode names", () => {
    expect(text).toContain(LIVE_SYSTEM);
    expect(text).toContain(SPOKEN_GUIDE);
    expect(text).toContain(spokenModeWords());
    expect(text).not.toContain("[cmd:");
  });

  it("puts the article last, after the guide's rules", () => {
    expect(text.indexOf(SPOKEN_GUIDE)).toBeLessThan(text.indexOf("THE ARTICLE"));
  });

  it("is offered the guide's tools and show_passage, and nothing from the web", () => {
    const expected = [SHOW_PASSAGE_TOOL.name, ...GUIDE_TOOLS.map((t) => t.function.name)].sort();
    expect(names(liveTools("guide"))).toEqual(expected);
    expect(names(liveSession({ meta, blocks, kind: "guide" }).tools as unknown[])).toEqual(expected);
  });

  it("leaves a chat and a Learn session exactly as they were", () => {
    for (const kind of ["chat", "learn", undefined] as const) {
      const plain = liveInstructions({ meta, blocks, kind });
      expect(plain).not.toContain(SPOKEN_GUIDE);
      expect(plain).toBe(liveInstructions({ meta, blocks }));
      expect(names(liveTools(kind))).toEqual(names(liveTools()));
    }
  });
});

describe("a GPT-Live session in a guide", () => {
  it("tells the voice and the backend they are the guide, and offers the guide's tools", () => {
    const voice = gptLiveVoiceInstructions({ meta, blocks, tree, kind: "guide" });
    const backend = gptLiveBackendInstructions({ meta, blocks, kind: "guide" });
    expect(voice).toContain(SPOKEN_GUIDE);
    expect(voice).toContain(spokenModeWords());
    expect(backend).toContain(SPOKEN_GUIDE);
    expect(voice).not.toContain("[cmd:");
    const session = gptLiveSession({ meta, blocks, tree, history: [], kind: "guide" });
    const tools = (session.delegation as { responses: { tools: unknown[] } }).responses.tools;
    expect(names(tools)).toEqual(names(liveTools("guide")));
  });

  it("leaves a chat's GPT-Live session as it was", () => {
    const voice = gptLiveVoiceInstructions({ meta, blocks, tree, kind: "chat" });
    expect(voice).not.toContain(SPOKEN_GUIDE);
    expect(voice).toBe(gptLiveVoiceInstructions({ meta, blocks, tree }));
    expect(gptLiveBackendInstructions({ meta, blocks, kind: "chat" })).toBe(gptLiveBackendInstructions({ meta, blocks }));
  });
});

describe("a guide's typed history, seeded into a voice", () => {
  const answer = [
    "Start with the Methods [spya-aaa111].",
    "",
    "[cmd:mode:submode%3Asummary%3Abrief]",
    "Or search for it: [cmd:quick-search:imaging]",
  ].join("\n");
  const history = [
    { id: "spya-q00001", role: "user", text: "Where first? [cmd:find:x]", createdAt: "2026-10-09T00:00:00Z", status: "done" },
    { id: "spya-a00001", role: "assistant", text: answer, createdAt: "2026-10-09T00:00:01Z", status: "done" },
  ] as ChatMessage[];

  it("takes the buttons out of the guide's words, and leaves the reader's alone", () => {
    const seed = liveSeedItems(history, "guide");
    expect(seed[1]?.text).toBe("Start with the Methods.\n\nOr search for it:");
    expect(seed[0]?.text).toBe("Where first? [cmd:find:x]");
  });

  it("drops a line that held only a button, and keeps prose untouched", () => {
    expect(withoutCommandButtons("a\n[cmd:mode:x]\nb")).toBe("a\nb");
    expect(withoutCommandButtons("no tokens here\n\n")).toBe("no tokens here\n\n");
  });
});

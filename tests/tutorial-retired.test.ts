/**
 * **Tutorial is retired: Recall took it in on 2026-10-20.** What used to be
 * tests/tutorial-kind.test.ts held Tutorial as a kind of its own; this holds
 * that it is gone everywhere a kind is listed, and that the parts of it that
 * moved into Recall are there. docs/plans/261020m-recall-and-tutorial-become-one-recall.md.
 *
 * Elsewhere: the migration (tests/tutorial-fold-migration.test.ts), a file's
 * fold (tests/chat-kind-from-file.test.ts), the wire alias
 * (tests/learn-route.test.ts § an old tab's Tutorial turn), the old address
 * (tests/learn-tutorial-old-addresses.test.ts), the offline cache
 * (tests/chat-retired-kinds.test.ts) and the command bar's search word
 * (tests/command-bar-sub-modes.test.tsx).
 */
import { describe, expect, it } from "vitest";

import { buildConverseMessages } from "../src/converse.js";
import { requestKind } from "../src/routes.js";
import type { Block, ChatMessage, Meta } from "../src/types.js";
import {
  isLearnKind,
  isSingleThreadKind,
  isThreadKind,
  LEARN_KINDS,
  RETIRED_THREAD_KINDS,
  SINGLE_THREAD_KINDS,
  THREAD_KINDS,
} from "../src/types.js";
import { LEARN_VIEWS } from "../src/web/params.js";
import { LEARN_SUB_MODES } from "../src/web/sub-modes.js";

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});
const meta = { title: "Being You", byline: "Anil Seth" } as unknown as Meta;
const base = {
  meta,
  blocks: [block("spya-aaaaaa", "A simulated rainstorm leaves nobody wet.")],
  history: [] as ChatMessage[],
  question: "I haven't read it yet",
};

describe("the kind is gone", () => {
  it("from every list of kinds, and is a retired word that means Recall", () => {
    expect(isThreadKind("tutorial")).toBe(false);
    expect(THREAD_KINDS).not.toContain("tutorial");
    expect(SINGLE_THREAD_KINDS).toEqual(["learn", "explore", "guide"]);
    expect(LEARN_KINDS).toEqual(["learn", "explore"]);
    expect(isSingleThreadKind("tutorial" as never)).toBe(false);
    expect(isLearnKind("tutorial" as never)).toBe(false);
    expect(RETIRED_THREAD_KINDS.tutorial).toBe("learn");
  });

  it("from Learn's views and chips", () => {
    expect(LEARN_VIEWS).toEqual(["recall", "explore", "quiz"]);
    expect(Object.keys(LEARN_SUB_MODES)).toEqual(["recall", "explore", "quiz"]);
  });

  it("is read as Recall on the wire, and nothing else is aliased", () => {
    expect(requestKind("tutorial")).toBe("learn");
    expect(requestKind("learn")).toBe("learn");
    expect(requestKind("remember")).toBe("remember");
    expect(requestKind(undefined)).toBeUndefined();
  });
});

describe("what Recall took from it", () => {
  /* Greg, `spya-hw8mhz`, 2026-10-03, about Tutorial's: the reader should not
     have to say they have not read it; they are told it is fine. The
     invitation and the placeholder (src/web/ChatPanel.tsx) say it the same way. */
  it("tells the reader it is fine not to have read it, below the breakpoint", () => {
    const greeting = String(buildConverseMessages({ ...base, kind: "learn" })[2]?.content);
    expect(greeting).toMatch(/it's fine if you haven't read it yet, or haven't finished/i);
    expect(greeting).not.toMatch(/haven't you read|say you haven't/i);
  });

  it("says so on the chip too, and the old name still finds it in the bar", () => {
    expect(LEARN_SUB_MODES.recall.description).toMatch(/not read it yet/i);
    expect(LEARN_SUB_MODES.recall.aliases).toContain("tutorial");
  });
});

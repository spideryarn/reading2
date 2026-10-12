/**
 * **Every typed conversation but the guide can search the web, and each is told
 * when** — plan docs/plans/261011t-web-search-in-every-chat-kind-and-reading-a-given-address.md,
 * after Greg's `spya-drbkvc`:
 *
 * > I think we should allow web searches in all of the chat modes because very
 * > often users are going to wanting to be situating this article relative to
 * > other stuff on the web
 *
 * Recall and Tutorial always had the tool; their prompts kept them in the
 * article, and "where does this piece sit?" was not a reason to leave it. The
 * guide has no search, and now says Chat can look it up.
 */
import { describe, expect, it } from "vitest";

import { toolsFor } from "../src/chat-tools.js";
import { buildConverseMessages, webSearchTool } from "../src/converse.js";
import { guideModeKeys } from "../src/guide.js";
import { checkNextStep } from "../src/next-steps.js";
import { THREAD_KINDS, type Block, type ChatMessage, type Meta, type ThreadKind } from "../src/types.js";

const blocks: Block[] = [
  {
    id: "spya-aaaaaa",
    tag: "p",
    kind: "text",
    text: "A simulated rainstorm leaves nobody wet.",
    words: 6,
    html: "<p>A simulated rainstorm leaves nobody wet.</p>",
    gistable: true,
  },
];
const meta = { title: "Being You", byline: "Anil Seth" } as unknown as Meta;
const systemOf = (kind: ThreadKind) =>
  String(
    buildConverseMessages({ meta, blocks, history: [] as ChatMessage[], question: "q", kind })[0]?.content,
  );
/* Prompts wrap at 80 columns; a phrase may straddle a line break. */
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("web search", () => {
  /* The guide is the exception, and for now on purpose: given search, it
     searched and then called offer_next_steps with no words, and the results
     died with that round (plan 261011t § The guide; q-w26r6u). */
  it("is offered to every kind of conversation but the guide", () => {
    for (const kind of THREAD_KINDS) {
      if (kind === "guide") expect(webSearchTool(kind)).toBeNull();
      else expect(webSearchTool(kind), kind).not.toBeNull();
    }
  });

  it("is Chat's to do when the guide is asked about the world, and the guide says so", () => {
    const guide = flat(systemOf("guide"));
    expect(guide).toContain("Chat can do what you cannot: search the web and open a page");
    /* Since plan 261012f, as a chat step carrying their question, rather than Chat's list. */
    expect(guide).toMatch(/offer a chat step carrying their question/);
    expect(checkNextStep({ kind: "chat", words: "What have others said about it?" })).toEqual({ kind: "chat", words: "What have others said about it?" });
    expect(checkNextStep({ kind: "mode", mode: "mode:chat" }, guideModeKeys())).toEqual({
      kind: "mode",
      mode: "mode:chat",
    });
  });
});

describe("Recall and Tutorial", () => {
  for (const kind of ["learn", "tutorial"] as const) {
    it(`${kind}: asking where the piece stands is a reason to search`, () => {
      const system = flat(systemOf(kind));
      expect(system).toContain("they ask where the piece stands");
      expect(system).toMatch(/how it relates to other work/);
      expect(system).toMatch(/ALWAYS search the web/);
      expect(system).toMatch(/search their library as well, but never instead/);
    });
  }

  /* On purpose: Recall tests the reader's memory of this piece, and a model
     that goes off unprompted to fact-check the author turns that into a
     seminar on whether the piece is right. The new reason is the reader's
     question; this rule is about the model's own initiative. */
  it("Recall still does not check the article against the world unprompted", () => {
    expect(flat(systemOf("learn"))).toContain(
      "Do NOT search, unprompted, to check the article against the world",
    );
  });
});

/* Every kind but the guide already read a page the reader handed over, 2 of 2
   times in the plan's baseline, so no wording changed for it. The guide's page
   tool waits on Greg with its search (q-w26r6u). */
describe("an address the reader gives", () => {
  it("can be read in every kind but the guide", () => {
    for (const kind of THREAD_KINDS) {
      const names = toolsFor(kind).map((t) => t.function.name);
      if (kind === "guide") expect(names, kind).not.toContain("read_web_page");
      else expect(names, kind).toContain("read_web_page");
    }
  });
});

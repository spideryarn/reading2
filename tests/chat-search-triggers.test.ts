/**
 * **The bullet that talked the model out of the search — report 1X.**
 *
 * > I added a Comment, asking about evidence for a claim, hoping that it would
 * > automatically know to and be able to automatically search the web. It didn't
 * > seem to do that :(
 *
 * The plumbing was not the fault. `require_parameters: true` is set, the tool
 * reaches the wire (tests/chat-tools.test.ts asserts on the serialised body),
 * and production logged the actual turn at 10:00:23Z as
 * `rounds:2, tools:2, searches:0` — two of *our* tools, no web search. It was
 * offered the search and chose not to take it.
 *
 * Why is in the wording. `SYSTEM` gave search one bullet and then followed it
 * with
 *
 * > DO NOT reach for a tool to do something the article in front of you already
 * > answers. It is all here.
 *
 * *"What is the evidence for this claim?"* is precisely the question that looks
 * like something the article already answers — the article states the claim, so
 * the claim is in front of you. Meanwhile src/explain.ts, the path Greg was
 * **not** on, gives the same model a titled section, **WEB RESEARCH: LEAN
 * TOWARDS SEARCHING**, telling it to reach for the tool BY DEFAULT. The chat
 * prompt talked it out of the search the explain prompt would have talked it
 * into, and that asymmetry is the bug.
 *
 * So two changes, and one thing that must NOT change:
 *
 *  1. the evidence case is named as a trigger, in `explain.ts`'s own vocabulary
 *     rather than a second one invented here;
 *  2. the anti-search bullet is narrowed to *what a paragraph plainly says*;
 *  3. **the existing "USE web search unless you are genuinely sure" bullet
 *     stays exactly as strong.** Strengthening search and adding report 1S's
 *     pedagogical addendum pull in opposite directions, and the addendum is
 *     deliberately silent about where an answer comes from
 *     (tests/help-prompt.test.ts pins that half). If this bullet is ever
 *     softened to make room for it, the two will have cancelled out.
 *
 * A wording test, and it is worth having as one: the prompt is the mechanism
 * here, and *"the model declined a search it was offered"* is not something an
 * integration test can hold still.
 */
import { describe, expect, it } from "vitest";
import { buildConverseMessages } from "../src/converse.js";
import type { Block, ChatMessage, Meta } from "../src/types.js";

const blocks: Block[] = [
  {
    id: "spya-k3m9qt",
    tag: "p",
    kind: "text",
    text: "Bigger brains make better thinkers, the study found.",
    words: 8,
    html: "<p>Bigger brains make better thinkers, the study found.</p>",
    gistable: true,
  },
];

const meta = { title: "A piece", byline: "Somebody" } as unknown as Meta;

/** Chat's system prompt, which is the first message and nothing else. */
const chatSystem = String(
  buildConverseMessages({
    meta,
    blocks,
    history: [] as ChatMessage[],
    question: "what is the evidence for this claim?",
  })[0]?.content ?? "",
);

describe("the evidence case is named as a reason to search", () => {
  it("says that asking whether a claim holds up is a question about the world", () => {
    expect(chatSystem).toContain("QUESTION ABOUT THE WORLD");
  });

  it("quotes the question a reader actually asks", () => {
    expect(chatSystem).toContain("What is the evidence for this?");
  });

  /* Borrowed from explain.ts's WEB RESEARCH: LEAN TOWARDS SEARCHING rather than
     invented, so the two prompts say the same thing in the same words. Two
     vocabularies for one instruction is two places to drift. */
  it("borrows explain.ts's `BY DEFAULT` and its aim-the-search advice", () => {
    expect(chatSystem).toContain("BY DEFAULT");
    expect(chatSystem).toContain("Use the article to aim the search");
  });
});

describe("the counter-pressure is narrowed, not removed", () => {
  it("no longer discourages a tool for anything the article touches on", () => {
    expect(
      chatSystem,
      "This is the sentence that answered 1X — `DO NOT reach for a tool to do something " +
        "the article in front of you already answers`. A reader asking whether a claim " +
        "holds up is asking about the world, not about paragraph four.",
    ).not.toContain("the article in front of you already");
  });

  it("still discourages looking up what a paragraph plainly says", () => {
    expect(chatSystem).toContain("what a paragraph plainly says");
    expect(chatSystem).toContain("no tool at all");
  });
});

describe("the encouragement that was already there is untouched", () => {
  /* The one place 1S and 1X pull against each other. If a later edit softens
     this to make room for the pedagogical addendum, the two changes cancel and
     nothing on screen says so. */
  it("still says to use web search unless the model is genuinely sure", () => {
    expect(chatSystem).toContain("USE web search unless you are genuinely sure");
    expect(chatSystem).toContain("being unsure and not checking is the worst outcome here");
  });
});

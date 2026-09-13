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

/**
 * **Report 3D, 2026-09-12: the broader question, and where each claim came from.**
 *
 * > asking a question with the comments panel has the full power of Chat, but is
 * > really crystal clear about what is and what is not from the article and
 * > always provides sort of evidentiary links back.
 *
 * The search was offered and declined again, for a question none of the 1X
 * triggers named: how a passage sits in its field, what others think, what has
 * happened since. The baseline searched on 0 of 4 such cells.
 * docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md.
 */
const messages = buildConverseMessages({
  meta,
  blocks,
  history: [] as ChatMessage[],
  question: "how does this fit the wider debate?",
  anchor: { blockId: "spya-k3m9qt" },
});
const finalUser = String(messages.at(-1)?.content ?? "");

/* Whitespace collapsed, so a pin survives the prompt being reflowed. */
const flatten = (s: string) => s.replace(/\s+/g, " ");
const flat = flatten(chatSystem);

/** One SYSTEM section, flattened: its heading up to the next blank-line heading. */
function section(heading: string): string {
  const start = chatSystem.indexOf(`\n${heading}\n`);
  if (start < 0) return "";
  const rest = chatSystem.slice(start + heading.length + 2);
  const next = rest.search(/\n\n[A-Z][A-Z ,—'-]+\n\n/);
  return flatten(next < 0 ? rest : rest.slice(0, next));
}

describe("where a passage stands is a question about the world too", () => {
  it("names the broader question as a reason to search, by default", () => {
    expect(flat).toContain("WHERE A PASSAGE STANDS IS A QUESTION ABOUT THE WORLD");
    for (const q of [
      "How does this fit the wider debate?",
      "is this view mainstream?",
      "what do others say?",
      "what has happened since?",
      "what else is known about this person, or this work?",
    ]) {
      expect(flat).toContain(q);
    }
    expect(flat).toContain("it cannot tell you where it stands");
  });

  it("leaves how much to search to the model", () => {
    expect(flat).toContain("How much to search is your judgement");
  });
});

describe("where each claim came from", () => {
  const where = section("WHERE EACH CLAIM CAME FROM");

  it("is a section of the system prompt, above the cache breakpoint", () => {
    expect(where, "no WHERE EACH CLAIM CAME FROM section in SYSTEM").not.toBe("");
    expect(finalUser).not.toContain("WHERE EACH CLAIM CAME FROM");
  });

  it("names all four origins, the library included", () => {
    expect(where).toContain("The article → its block id");
    expect(where).toContain("The web → a link to the page it came from");
    expect(where).toContain("The reader's library →");
    expect(where).toContain("name that article by its title");
    expect(where).toContain("never present one as a citation into this article");
    expect(where).toContain('Your own reasoning or synthesis → say so: "My inference is');
  });

  it("does not let general knowledge stand as an unlinked source", () => {
    expect(where).toContain("General knowledge is not an unlinked source");
    expect(where).toContain("searched and linked, or said plainly to be unverified");
  });

  it("keeps the web out of a sentence that cites the article", () => {
    expect(where).toContain("A sentence that carries a block id is a claim about what the");
    expect(where).toContain("Nothing from the web rides in it.");
  });

  it("replaces the one-line bullet it grew out of", () => {
    expect(flat).not.toContain("Say where something came from");
  });
});

describe("a page is linked once per run of claims, not once per answer", () => {
  /* "Link a page once" and "mark each web claim where it is made" could not
     both be obeyed for two separated claims from one page (Sol F4). */
  it("says to link in the first sentence of each run, and repeat only to keep a source", () => {
    expect(flat).not.toContain("Link a page once");
    expect(flat).toContain("in the first sentence of each run of claims drawn from it");
    expect(flat).toContain("would otherwise lose its source");
    expect(flat).toContain("A wall of links reads as a search result, not an answer.");
  });
});

describe("the citations list is named among the tools", () => {
  /* SYSTEM lists the tools in words, not by id, so a tool the prose never
     mentions is one the model has only its description to find it by. Report
     3F; docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md. */
  it("says the model can read the works this article cites", () => {
    expect(flat).toContain("this article's glossary, and the works it cites");
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

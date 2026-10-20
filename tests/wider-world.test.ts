/**
 * **Where `widerWorld` lands in each prompt that carries it, and which variant.**
 *
 * The section is shared (src/wider-world.ts) but its position is not: Recall
 * must still end on its nudge and hint (Tutorial, until it was folded into
 * Recall on 2026-10-20, on its task), Quiz may not
 * open with a verdict, and Chat already has `CLAIM_ORIGINS`. These pin the
 * variant each prompt asked for and its place against the rule it must not
 * break, because a later tidy-up that moves one section past another changes
 * what the model does without changing a word. GPT Sol's plan review, F1 and
 * the checked details. docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md.
 */
import { describe, expect, it } from "vitest";

import { hasOutsideMarker } from "../evals/wider-world-screen.js";
import { buildConverseMessages } from "../src/converse.js";
import { QUIZ_MARK_SYSTEM } from "../src/quiz-mark.js";
import {
  THREAD_KINDS,
  type Block,
  type ChatMessage,
  type Meta,
  type ThreadKind,
} from "../src/types.js";
import { WIDER_WORLD_HEADING, widerWorld } from "../src/wider-world.js";

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
const flat = (s: string) => s.replace(/\s+/g, " ");

const SEARCHES = "Never search to find out whether there is an objection to raise";
const PRIVATE = "Never put the reader's words";
const CANNOT = "You cannot search here";
const OWN_LABELS = "Keep the three sources apart in the sentence itself";
const POINTS_AT_ORIGINS = "Mark where it came from, as WHERE EACH CLAIM CAME FROM says";
const NEVER_AGAINST = "The world disagreeing with the piece is never the reader getting the piece wrong";
const WORLD_SECTION = `${WIDER_WORLD_HEADING} The article is what you and the reader are working through`;

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("widerWorld", () => {
  it("can search: it may check a doubt, never hunt for one, and keeps the reader's words out of a query", () => {
    const s = flat(widerWorld({ search: "can", placement: "P." }));
    expect(s).toContain(SEARCHES);
    expect(s).toContain(PRIVATE);
    expect(s).not.toContain(CANNOT);
  });

  it("cannot search: memory is said to be memory, and no search rules appear", () => {
    const s = flat(widerWorld({ search: "cannot", placement: "P." }));
    expect(s).toContain(CANNOT);
    expect(s).not.toContain(SEARCHES);
  });

  it("points at CLAIM_ORIGINS instead of restating the labels when asked", () => {
    expect(flat(widerWorld({ search: "can", origins: "claim-origins", placement: "P." }))).toContain(
      POINTS_AT_ORIGINS,
    );
    expect(flat(widerWorld({ search: "can", placement: "P." }))).toContain(OWN_LABELS);
  });

  it("ends with the prompt's own placement", () => {
    expect(widerWorld({ search: "can", placement: "PLACEMENT-MARK" }).trimEnd()).toMatch(/PLACEMENT-MARK$/);
  });

  it("leaves stopping to each prompt's placement rule", () => {
    expect(flat(widerWorld({ search: "can", placement: "Continue with the mode's closing task." }))).not.toContain(
      "put what the article says and the note side by side, and stop",
    );
  });

  it("recognises the memory label the eval actually elicited", () => {
    expect(hasOutsideMarker("One date to check, from my memory rather than the piece: it is later.")).toBe(true);
  });
});

describe("in each prompt", () => {
  it("is in only Chat and Recall among conversation kinds, exactly once", () => {
    const expected = {
      chat: 1,
      learn: 1,
      explore: 0,
      candidates: 0,
      guide: 0,
    } satisfies Record<ThreadKind, number>;
    for (const kind of THREAD_KINDS) {
      expect(count(flat(systemOf(kind)), WORLD_SECTION), kind).toBe(expected[kind]);
    }
    expect(count(flat(QUIZ_MARK_SYSTEM), WORLD_SECTION)).toBe(1);
  });

  it("Chat: after CLAIM_ORIGINS, pointing at it", () => {
    const s = flat(systemOf("chat"));
    expect(s.indexOf("WHERE EACH CLAIM CAME FROM")).toBeLessThan(s.indexOf(WIDER_WORLD_HEADING));
    expect(s).toContain(POINTS_AT_ORIGINS);
    expect(s).toContain(SEARCHES);
  });

  it("Recall: ranked under the entitlement rules, and the nudge stays last before the hint", () => {
    const s = flat(systemOf("learn"));
    const entitled = s.indexOf("WHAT YOU ARE AND ARE NOT ENTITLED TO SAY");
    const tone = s.indexOf("TONE", entitled);
    const worldBullet = s.indexOf("THE WORLD IS NOT THE ARTICLE");
    const worldSection = s.indexOf(WORLD_SECTION);
    expect(entitled).toBeGreaterThan(-1);
    expect(worldBullet).toBeGreaterThan(entitled);
    expect(worldBullet).toBeLessThan(tone);
    expect(worldBullet).toBeLessThan(worldSection);
    expect(s.indexOf("CITING THE ARTICLE — THE ONE RULE THAT MATTERS")).toBeLessThan(worldSection);
    expect(s).toMatch(/then your question, which is still the last sentence before\s+the hint/);
    expect(s).toContain(OWN_LABELS);
    expect(s).toContain(SEARCHES);
    expect(s).toContain(PRIVATE);
    expect(s).toContain(NEVER_AGAINST);
  });

  it("Quiz marking: cannot search, article first, and no advert for Chat", () => {
    const s = flat(QUIZ_MARK_SYSTEM);
    const worldSection = s.indexOf(WORLD_SECTION);
    expect(s).toContain(CANNOT);
    expect(s).not.toContain(SEARCHES);
    expect(s).toContain("what the article says first, as WHAT TO SAY says");
    expect(s).toContain("Do not tell them where to check it");
    expect(s.indexOf("WHAT TO SAY, AND IN WHAT ORDER")).toBeLessThan(worldSection);
    expect(s.indexOf("CITING THE ARTICLE — THE ONE RULE THAT MATTERS")).toBeLessThan(worldSection);
    expect(s).toContain("unless WHEN THE ARTICLE IS NOT THE LAST WORD calls for its separate outside note");
    expect(s).toContain(NEVER_AGAINST);
  });
});

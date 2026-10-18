/**
 * **Where `widerWorld` lands in each prompt that carries it, and which variant.**
 *
 * The section is shared (src/wider-world.ts) but its position is not: Recall
 * must still end on its nudge and hint, Tutorial on its task, Quiz may not
 * open with a verdict, and Chat already has `CLAIM_ORIGINS`. These pin the
 * variant each prompt asked for and its place against the rule it must not
 * break, because a later tidy-up that moves one section past another changes
 * what the model does without changing a word. GPT Sol's plan review, F1 and
 * the checked details. docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md.
 */
import { describe, expect, it } from "vitest";

import { buildConverseMessages } from "../src/converse.js";
import { QUIZ_MARK_SYSTEM } from "../src/quiz-mark.js";
import type { Block, ChatMessage, Meta, ThreadKind } from "../src/types.js";
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
});

describe("in each prompt", () => {
  it("is in Chat, Recall, Tutorial and Quiz marking exactly once, and not in Explore", () => {
    for (const kind of ["chat", "learn", "tutorial"] as const) {
      expect(count(systemOf(kind), WIDER_WORLD_HEADING), kind).toBe(1);
    }
    expect(count(QUIZ_MARK_SYSTEM, WIDER_WORLD_HEADING)).toBe(1);
    /* Explore has its own, wider THE WIDER WORLD; two would be two rules. */
    expect(count(systemOf("explore"), WIDER_WORLD_HEADING)).toBe(0);
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
    expect(entitled).toBeGreaterThan(-1);
    expect(worldBullet).toBeGreaterThan(entitled);
    expect(worldBullet).toBeLessThan(tone);
    expect(s).toContain("then the nudge, which is still the last sentence before the hint");
    expect(s).toContain(OWN_LABELS);
    expect(s).toContain(SEARCHES);
    expect(s).toContain(PRIVATE);
    expect(s).toContain(NEVER_AGAINST);
  });

  it("Tutorial: the task stays last", () => {
    const s = flat(systemOf("tutorial"));
    expect(s).toContain("then the task, which is still last");
    expect(s).toContain(SEARCHES);
    expect(s).toContain(PRIVATE);
  });

  it("Quiz marking: cannot search, article first, and no advert for Chat", () => {
    const s = flat(QUIZ_MARK_SYSTEM);
    expect(s).toContain(CANNOT);
    expect(s).not.toContain(SEARCHES);
    expect(s).toContain("what the article says first, as WHAT TO SAY says");
    expect(s).toContain("Do not tell them where to check it");
    expect(s.indexOf("WHAT TO SAY, AND IN WHAT ORDER")).toBeLessThan(s.indexOf(WIDER_WORLD_HEADING));
    expect(s).toContain(NEVER_AGAINST);
  });
});

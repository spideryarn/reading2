/**
 * **Four sentences, and they must not become one.**
 *
 * The worked example of the failure is Notion: unpublishing a page makes every
 * old link land on a plain *"page could not be found"*, so *never existed*,
 * *was unshared* and *you may not see it* are all answered identically and the
 * visitor learns nothing. The products that get it right name the cause — Loom
 * says *"Due to the privacy settings for this video, it cannot be played here
 * at this time"*; Google Docs pairs *"View only"* with *"Request edit access"*.
 * docs/research/public-access-how-others-do-it.md.
 *
 * Three of ours live in the reading view and one is a whole page, so no single
 * component renders all four and could be tested for telling them apart. That
 * is why `visitorGap` is a pure function, and this is the test it exists for.
 *
 * **The assertions are about the `kind`, not the prose**, following the rule
 * docs/project/copy.md sets for the failure messages: copy should stay
 * rewritable without turning a test red, and a test that pins a sentence
 * quietly makes the sentence permanent. The one place a string is checked is
 * the distinctness sweep at the bottom, which asserts that the four differ from
 * each other rather than that any of them says a particular thing.
 */
import { describe, expect, it } from "vitest";
import type { PublicArtefacts } from "../src/public-types.js";
import { MODES, type Mode } from "../src/web/params.js";
import {
  anAccountWouldHelp,
  COMMENTS_GAP,
  markedModes,
  TWEETS_GAP,
  visitorGap,
  visitorSentence,
  type VisitorGap,
} from "../src/web/visitor.js";

const NOTHING_BUILT: PublicArtefacts = {
  arc: false,
  tweets: false,
  glossary: false,
  summary: false,
  ideas: false,
};
const EVERYTHING_BUILT: PublicArtefacts = {
  arc: true,
  tweets: true,
  glossary: true,
  summary: true,
  ideas: true,
};

describe("what a visitor is told, mode by mode", () => {
  it("gives the table of contents away, which is the whole feature", () => {
    // The tree, the zoom, the spine — all drawn from the payload the visitor
    // already holds, and none of it costs anything to serve.
    expect(visitorGap("toc", EVERYTHING_BUILT)).toBeNull();
    expect(visitorGap("toc", NOTHING_BUILT)).toBeNull();
    expect(visitorGap("toc", null)).toBeNull();
  });

  it("tells an artefact that was never built apart from one we do not carry yet", () => {
    expect(visitorGap("glossary", NOTHING_BUILT)).toEqual({
      kind: "not-built",
      noun: expect.any(String),
    });
    expect(visitorGap("glossary", EVERYTHING_BUILT)).toEqual({
      kind: "not-yet-public",
      noun: expect.any(String),
    });
  });

  /**
   * **A missing answer is not a claim about somebody's article.**
   *
   * `available` is `null` when the metadata request did not land. Reading that
   * as "nobody has built a glossary" would put a statement about the world in
   * front of a visitor on the strength of a network failure — the exact shape
   * docs/reusable/silent-success.md keeps writing up.
   */
  it("does not turn a failed metadata fetch into 'nobody built one'", () => {
    for (const mode of ["glossary", "summary", "ideas"] as const) {
      expect(visitorGap(mode, null)?.kind).toBe("not-yet-public");
    }
  });

  it("names the modes that spend as signed-in-only, whatever the flags say", () => {
    for (const mode of ["chat", "search", "review", "diagram"] as const) {
      for (const flags of [NOTHING_BUILT, EVERYTHING_BUILT, null]) {
        expect(visitorGap(mode, flags)).toEqual({
          kind: "signed-in-only",
          feature: expect.any(String),
        });
      }
    }
  });

  /**
   * The property that keeps this true when somebody adds a ninth mode.
   *
   * `markedModes` derives from `MODES`, so a mode nobody thought about here is
   * marked rather than quietly live — the fail-closed direction. Written as a
   * sweep of every member rather than a list, so the list cannot go stale.
   */
  it("answers for every mode there is, and only `toc` is free", () => {
    for (const mode of MODES) {
      const gap = visitorGap(mode, EVERYTHING_BUILT);
      if (mode === "toc") expect(gap).toBeNull();
      else expect(gap).not.toBeNull();
    }
    expect([...markedModes(EVERYTHING_BUILT)].sort()).toEqual(
      MODES.filter((m: Mode) => m !== "toc")
        .slice()
        .sort(),
    );
  });
});

describe("the sentences themselves", () => {
  /** One of each kind, so the sweeps below cover the whole union. */
  const ALL: VisitorGap[] = [
    visitorGap("glossary", NOTHING_BUILT) as VisitorGap,
    visitorGap("glossary", EVERYTHING_BUILT) as VisitorGap,
    visitorGap("chat", null) as VisitorGap,
    COMMENTS_GAP,
    TWEETS_GAP,
  ];

  it("covers every kind the union has", () => {
    expect(new Set(ALL.map((g) => g.kind))).toEqual(
      new Set(["not-built", "not-yet-public", "signed-in-only", "readers-own"]),
    );
  });

  it("says something different for each kind", () => {
    /* By kind rather than by member, because `TWEETS_GAP` and a not-yet-public
       glossary are deliberately the same sentence about different nouns. */
    const byKind = new Map(ALL.map((g) => [g.kind, visitorSentence(g)]));
    expect(new Set(byKind.values()).size).toBe(byKind.size);
    for (const sentence of byKind.values()) {
      expect(sentence.length).toBeGreaterThan(20);
      /* No bracketed support code. These are not failures — nothing went wrong
         — and `kindOfMessage` would then be asked to classify a sentence with
         no `FailureKind`. src/messages.ts § A shared document. */
      expect(sentence).not.toMatch(/\[[a-z-]+\]/);
    }
  });

  /**
   * **The offer is withheld where it would not be kept.**
   *
   * An artefact that exists but is not yet carried on a shared link waits on us
   * shipping slice 1b, not on the visitor doing anything — so putting "make a
   * free account" beside it would be a promise broken the moment they took it.
   * Comments are the same: they belong to whoever added the article, and an
   * account does not change that.
   */
  it("offers an account only where an account is the fix", () => {
    expect(anAccountWouldHelp(visitorGap("glossary", NOTHING_BUILT) as VisitorGap)).toBe(true);
    expect(anAccountWouldHelp(visitorGap("chat", null) as VisitorGap)).toBe(true);
    expect(anAccountWouldHelp(visitorGap("glossary", EVERYTHING_BUILT) as VisitorGap)).toBe(false);
    expect(anAccountWouldHelp(COMMENTS_GAP)).toBe(false);
  });
});

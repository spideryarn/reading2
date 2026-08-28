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
  tweetsGap,
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

/**
 * **Exactly one artefact built, and it is the only shape that can catch a
 * crossed wire.**
 *
 * The two fixtures above correlate everything — all `false` or all `true` — so
 * a mode reading the *wrong* flag gives the identical answer for both and every
 * test in this file stays green. GPT Sol named that mutation exactly:
 * *"map `ideas.has` to `summary`"*.
 *
 * A single mixed fixture is not enough either, and I wrote one before checking:
 * the flags are booleans, so any two artefacts that happen to share a value are
 * still freely swappable. `summary` and `ideas` were both `false` in it, which
 * is precisely the pair Sol named — the control passed, and the comment
 * claiming *"no single swap produces the same table"* was simply false.
 *
 * One fixture per artefact is the shape that works: with only `ideas` built,
 * any mode reading anything other than `ideas` answers *not built* where the
 * truth is *not carried yet*.
 */
function only(built: keyof PublicArtefacts): PublicArtefacts {
  return {
    arc: built === "arc",
    tweets: built === "tweets",
    glossary: built === "glossary",
    summary: built === "summary",
    ideas: built === "ideas",
  };
}

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
      expect(visitorGap(mode, null)?.kind).toBe("availability-unknown");
    }
  });

  /**
   * **And the fifth state must not swallow the fourth.**
   *
   * `availability-unknown` was `not-yet-public` until 2026-08-28, whose
   * sentence begins *"There is"* — so a network failure was rendered as a claim
   * about somebody's article. Folding them back together would be the same bug
   * under a new name, so this compares the two **sentences** rather than
   * counting kinds: a union can grow a member that says nothing new.
   */
  it("says a different thing when it does not know than when it does", () => {
    const known = visitorSentence(visitorGap("glossary", EVERYTHING_BUILT) as VisitorGap);
    const unsure = visitorSentence(visitorGap("glossary", null) as VisitorGap);

    expect(known).not.toBe(unsure);
    // The one that knows may claim the piece has it; the one that does not, may not.
    expect(known).toContain("There is");
    expect(unsure).not.toContain("There is");
  });

  it("names the modes that spend as the owner's, whatever the flags say", () => {
    for (const mode of ["chat", "search", "review", "diagram"] as const) {
      for (const flags of [NOTHING_BUILT, EVERYTHING_BUILT, null]) {
        expect(visitorGap(mode, flags)).toEqual({
          kind: "owners-only",
          feature: expect.any(String),
        });
      }
    }
  });

  /**
   * **The tweets page derives its gap rather than asserting one.**
   *
   * It was a constant saying `not-yet-public`, so `/read/:slug/tweets` told a
   * visitor *"There is a tweet thread for this piece"* about an article whose
   * own wire response said `tweets: false`. GPT Sol, 2026-08-28.
   */
  /**
   * **Each mode reads its own flag and nobody else's.**
   *
   * Swept per artefact rather than asserted once: with only `X` built, the mode
   * for `X` must say *not carried yet* and every other artefact mode must say
   * *nobody built one*. A crossed wire fails on at least one row whichever pair
   * was crossed.
   */
  it.each(["glossary", "summary", "ideas"] as const)(
    "reads its own flag when only %s is built",
    (built) => {
      const flags = only(built);
      for (const mode of ["glossary", "summary", "ideas"] as const) {
        expect(visitorGap(mode, flags)?.kind, `${mode} when only ${built} is built`).toBe(
          mode === built ? "not-yet-public" : "not-built",
        );
      }
      // And the tweets page, which is not a mode but reads the same table.
      expect(tweetsGap(flags).kind).toBe("not-built");
    },
  );

  it("reads the tweets flag when only tweets is built", () => {
    expect(tweetsGap(only("tweets")).kind).toBe("not-yet-public");
    for (const mode of ["glossary", "summary", "ideas"] as const) {
      expect(visitorGap(mode, only("tweets"))?.kind).toBe("not-built");
    }
  });

  it("asks the flags about the tweet thread too", () => {
    expect(tweetsGap(NOTHING_BUILT).kind).toBe("not-built");
    expect(tweetsGap(EVERYTHING_BUILT).kind).toBe("not-yet-public");
    expect(tweetsGap(null).kind).toBe("availability-unknown");
  });

  /**
   * The property that keeps this true when somebody adds a ninth mode.
   *
   * `markedModes` derives from `MODES`, so a mode nobody thought about here is
   * marked rather than quietly live — the fail-closed direction. Written as a
   * sweep of every member rather than a list, so the list cannot go stale.
   */
  it("answers for every mode there is, and `toc` and `outline` are free", () => {
    for (const mode of MODES) {
      const gap = visitorGap(mode, EVERYTHING_BUILT);
      /* `outline` is the second free mode, added 2026-08-28: like the table of
         contents it draws from the tree in the payload the visitor already holds
         and reaches no artefact, so it is named here deliberately rather than
         falling through the fail-closed default. docs/plans/outline-mode.md. */
      if (mode === "toc" || mode === "outline") expect(gap).toBeNull();
      else expect(gap).not.toBeNull();
    }
    expect([...markedModes(EVERYTHING_BUILT).keys()].sort()).toEqual(
      MODES.filter((m: Mode) => m !== "toc" && m !== "outline")
        .slice()
        .sort(),
    );
    /* And each entry carries the sentence the band will show, so the bar's
       tooltip cannot drift away from it — the drift a browser pass found on
       2026-08-28, when the two said the same fact a few words apart. */
    for (const [mode, sentence] of markedModes(EVERYTHING_BUILT)) {
      expect(sentence).toBe(visitorSentence(visitorGap(mode, EVERYTHING_BUILT) as VisitorGap));
    }
  });
});

describe("the sentences themselves", () => {
  /** One of each kind, so the sweeps below cover the whole union. */
  const ALL: VisitorGap[] = [
    visitorGap("glossary", NOTHING_BUILT) as VisitorGap,
    visitorGap("glossary", EVERYTHING_BUILT) as VisitorGap,
    visitorGap("glossary", null) as VisitorGap,
    visitorGap("chat", null) as VisitorGap,
    COMMENTS_GAP,
  ];

  it("covers every kind the union has", () => {
    expect(new Set(ALL.map((g) => g.kind))).toEqual(
      new Set([
        "not-built",
        "not-yet-public",
        "availability-unknown",
        "owners-only",
        "readers-own",
      ]),
    );
  });

  it("says something different for each kind", () => {
    /* By kind rather than by member, because a not-yet-public tweet thread and
       a not-yet-public glossary are deliberately the same sentence about
       different nouns. */
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
    /* And least of all where we do not know there is anything to offer. */
    expect(anAccountWouldHelp(visitorGap("glossary", null) as VisitorGap)).toBe(false);
    expect(anAccountWouldHelp(COMMENTS_GAP)).toBe(false);
  });
});

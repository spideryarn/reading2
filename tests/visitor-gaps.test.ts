/**
 * **Three sentences, and they must not become one.**
 *
 * The worked example of the failure is Notion: unpublishing a page makes every
 * old link land on a plain *"page could not be found"*, so *never existed*,
 * *was unshared* and *you may not see it* are all answered identically and the
 * visitor learns nothing. The products that get it right name the cause — Loom
 * says *"Due to the privacy settings for this video, it cannot be played here
 * at this time"*; Google Docs pairs *"View only"* with *"Request edit access"*.
 * docs/research/260828a-public-access-how-others-do-it.md.
 *
 * They live in the reading view, in the comments drawer and on a page of their
 * own, so no single component renders them all and could be tested for telling
 * them apart. That is why `visitorGap` is a pure function, and this is the test
 * it exists for.
 *
 * ## What slice 1b changed here, and why this file asserts policy rather than
 * membership
 *
 * There were five members and there are three. `not-yet-public` said *it exists
 * and a shared link does not carry it yet*, and a shared link carries all four
 * artefacts now; `availability-unknown` said *we could not find out*, and the
 * second request that could fail is gone. So the interesting answer for an
 * artefact is `null` — nothing stands in the way — and the sweeps below are
 * about **what the policy is**, never about how many members the union has. A
 * union can grow a member that says nothing new, and a count would go green on
 * exactly that.
 *
 * **The assertions are about the `kind`, not the prose**, following the rule
 * docs/project/copy.md sets for the failure messages: copy should stay
 * rewritable without turning a test red, and a test that pins a sentence
 * quietly makes the sentence permanent. The one place strings are checked is
 * the distinctness sweep at the bottom, which asserts that the three differ
 * from each other rather than that any of them says a particular thing.
 */
import { describe, expect, it } from "vitest";
import { ownersOnly } from "../src/messages.js";
import type { PublicArticle, PublicArtefacts } from "../src/public-types.js";
import { artefactsIn, artefactsOf } from "../src/web/public-artefacts.js";
import { MODES, type Mode } from "../src/web/params.js";
import {
  anAccountWouldHelp,
  COMMENTS_GAP,
  markedModes,
  notBuiltGap,
  visitorGap,
  visitorSentence,
  type VisitorGap,
} from "../src/web/visitor.js";

const NOTHING_BUILT: PublicArtefacts = {
  arc: false,
  tweets: false,
  glossary: false,
  ideas: false,
  quotes: false,
};
const EVERYTHING_BUILT: PublicArtefacts = {
  arc: true,
  tweets: true,
  glossary: true,
  ideas: true,
  quotes: true,
};

/**
 * **Exactly one artefact built, and it is the only shape that can catch a
 * crossed wire.**
 *
 * The two fixtures above correlate everything — all `false` or all `true` — so
 * a mode reading the *wrong* flag gives the identical answer for both and every
 * test in this file stays green. GPT Sol named that mutation exactly:
 * *"map `ideas.has` to `quotes`"*.
 *
 * A single mixed fixture is not enough either, and I wrote one before checking:
 * the flags are booleans, so any two artefacts that happen to share a value are
 * still freely swappable. Two of them were both `false` in it, which
 * is precisely the pair Sol named — the control passed, and the comment
 * claiming *"no single swap produces the same table"* was simply false.
 *
 * One fixture per artefact is the shape that works: with only `ideas` built,
 * any mode reading anything other than `ideas` answers *not built* where the
 * truth is *here it is*.
 */
function only(built: keyof PublicArtefacts): PublicArtefacts {
  return {
    arc: built === "arc",
    tweets: built === "tweets",
    quotes: built === "quotes",
    glossary: built === "glossary",
    ideas: built === "ideas",
  };
}

describe("what a visitor is told, mode by mode", () => {
  it("gives the table of contents away, which is the whole feature", () => {
    // The tree, the zoom, the spine — all drawn from the payload the visitor
    // already holds, and none of it costs anything to serve.
    expect(visitorGap("hierarchy", EVERYTHING_BUILT)).toBeNull();
    expect(visitorGap("hierarchy", NOTHING_BUILT)).toBeNull();
  });

  /**
   * **The slice, in one assertion.** An artefact this piece has is not a gap at
   * all: the visitor opens the band and reads it. An artefact nobody built is
   * the one artefact sentence left.
   */
  it("gives away an artefact the piece has, and names the one it does not", () => {
    expect(visitorGap("glossary", EVERYTHING_BUILT)).toBeNull();
    expect(visitorGap("glossary", NOTHING_BUILT)).toEqual({
      kind: "not-built",
      noun: expect.any(String),
    });
  });

  /**
   * **`timeline` is in this list deliberately, not by falling through.**
   *
   * `visitorGap`'s fall-through is fail-closed, so a mode nobody names is
   * owners-only anyway — which is exactly why naming it matters: *private
   * because somebody decided* and *private because somebody forgot* are
   * indistinguishable in the code, and this is the first. Greg, 2026-08-31:
   * making it public-readable "could be a follow-up", and wants a general
   * design for every mode rather than a fifth hand-written table.
   * docs/plans/260831i-timeline-mode.md § Making a mode public-readable.
   *
   * Note it is here rather than under the artefact sweep below: there is no
   * `PublicArtefacts` flag for a timeline, so the honest sentence is *this
   * belongs to whoever added the article*, never *nobody built one* — which we
   * could not know from a payload that carries no timeline either way.
   */
  it("names the modes that spend as the owner's, whatever the flags say", () => {
    for (const mode of ["chat", "search", "remember", "diagram", "timeline", "referee"] as const) {
      for (const flags of [NOTHING_BUILT, EVERYTHING_BUILT]) {
        expect(visitorGap(mode, flags)).toEqual({
          kind: "owners-only",
          feature: expect.any(String),
        });
      }
    }
  });

  /**
   * **No live mode falls through, and the sentence is the proof.**
   *
   * `visitorGap`'s last line is fail-closed by design and stays: a mode added
   * next month is owners-only until somebody says otherwise. But it hands
   * `ownersOnly` the bare mode id, and that function's contract is a *product
   * noun* — "capitalised, because it names a control the visitor just pressed"
   * — so anything reaching it reads to a visitor as *"referee is for whoever
   * added this article…"*, lower-case, in the band and in the dock tooltip.
   * That is what `referee` did until 2026-09-02.
   * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § C2.
   *
   * So the guard is: **the noun in the sentence is never the mode id**. Derived
   * from `MODES` rather than listed, like `markedModes` itself, so the next
   * mode is checked whether or not whoever adds it remembers this file. It
   * pins no prose — `ownersOnly` stays rewritable — only that the word poured
   * into it is one somebody chose.
   */
  it("never shows a visitor a bare mode id where a product noun belongs", () => {
    for (const mode of MODES) {
      for (const flags of [NOTHING_BUILT, EVERYTHING_BUILT]) {
        const gap = visitorGap(mode, flags);
        if (gap?.kind !== "owners-only") continue;
        expect(gap.feature, mode).not.toBe(mode);
        expect(gap.feature, mode).toBe(gap.feature[0]?.toUpperCase() + gap.feature.slice(1));
      }
    }
  });

  /**
   * Referee by name, because it is the mode that was wrong and a sweep that
   * only forbids the mode id would go green on any other capitalised word.
   */
  it("calls referee Referee", () => {
    expect(visitorSentence(visitorGap("referee", EVERYTHING_BUILT) as VisitorGap)).toBe(
      ownersOnly("Referee"),
    );
  });

  /** The owner's own annotations, which sharing an article does not share. */
  it("keeps the comments with whoever added the article", () => {
    expect(COMMENTS_GAP.kind).toBe("readers-own");
    expect(anAccountWouldHelp(COMMENTS_GAP)).toBe(false);
  });

  /**
   * **Each mode reads its own flag and nobody else's.**
   *
   * Swept per artefact rather than asserted once: with only `X` built, the mode
   * for `X` must be free and every other artefact mode must say *nobody built
   * one*. A crossed wire fails on at least one row whichever pair was crossed.
   */
  it.each(["glossary", "quotes", "ideas"] as const)(
    "reads its own flag when only %s is built",
    (built) => {
      const flags = only(built);
      for (const mode of ["glossary", "quotes", "ideas"] as const) {
        expect(visitorGap(mode, flags)?.kind ?? null, `${mode} when only ${built} is built`).toBe(
          mode === built ? null : "not-built",
        );
      }
    },
  );

  it("does not let the tweets flag stand in for a mode's", () => {
    for (const mode of ["glossary", "quotes", "ideas"] as const) {
      expect(visitorGap(mode, only("tweets"))?.kind).toBe("not-built");
    }
  });

  /**
   * **The tweet thread's own answer is not a mode's**, and it is not decided
   * here.
   *
   * `VisitorTweetsPage` branches on the artefact key itself — it has to, since
   * it renders the thread when there is one — and takes its sentence from
   * `notBuiltGap`. There is no `tweetsGap` beside that branch any more, because
   * a policy function returning a value TypeScript cannot narrow on would have
   * been a second answer to a question already decided, which is the shape GPT
   * Sol caught on 2026-08-28. What this asserts is the half that lives here:
   * the sentence exists and it is about a tweet thread.
   * tests/public-network-trace.test.tsx drives both branches on the page.
   */
  it("has a sentence for a thread nobody wrote", () => {
    expect(notBuiltGap("tweets")).toEqual({ kind: "not-built", noun: expect.any(String) });
    expect(visitorSentence(notBuiltGap("tweets"))).toContain("tweet thread");
  });

  /**
   * **`markedModes` excludes what a visitor can now have**, which is the
   * property slice 1b turned round.
   *
   * Before it, every mode but `toc` was marked and the only question was which
   * excuse to show. Now a marked button means the reader really cannot open the
   * band — and the sweep is written as a derivation from `MODES` rather than a
   * list, so an eleventh mode is covered whether or not whoever adds it
   * remembers.
   */
  it("marks only what a visitor cannot have, and derives that from MODES", () => {
    /* Nothing built: everything but the table of contents is marked, which is
       the old behaviour and still right for an article with no artefacts. */
    /* `outline` joins `hierarchy` as a mode a visitor always gets: like the
       table of contents it is drawn from the tree in the payload they already
       hold and reaches no artefact at all. docs/plans/260828aw-outline-mode.md.

       **And `summary` joined them on 2026-08-31.** It used to be gated on a
       `summary.json`; the generated ladder is gone and the panel draws the
       tree's own gists, so there is nothing left for a visitor to be missing.
       docs/plans/260831s-gist-only-summaries.md.

       `plain` is the fourth, and the least expensive of them: it reaches no
       artefact *and* renders no band — it is the article and nothing else, so
       there is nothing a visitor could be short of.
       docs/plans/plain-mode-and-the-way-out.md. */
    const ALWAYS_FREE: Mode[] = ["plain", "hierarchy", "outline", "summary"];
    expect([...markedModes(NOTHING_BUILT).keys()].sort()).toEqual(
      MODES.filter((m: Mode) => !ALWAYS_FREE.includes(m))
        .slice()
        .sort(),
    );
    /* Everything built: the artefact modes drop out, and what is left is
       the six that spend a model call. `timeline` is the fifth since
       2026-08-31 — it has no `PublicArtefacts` flag to drop out on, so it stays
       marked however much has been built — and `referee` is the sixth, the same
       night, for the same reason.

       `referee` reached this list through `visitorGap`'s fail-closed
       fall-through until 2026-09-02, and this comment used to call that the
       arrangement working rather than an omission. It was both: the policy was
       right and the *sentence* was not, because the fall-through has only the
       mode id to name the button with. It has a `COSTS` entry now, and the
       sweep above forbids any live mode going back to falling through.
       docs/plans/260831an-referee-mode-for-peer-reviewers.md. */
    expect([...markedModes(EVERYTHING_BUILT).keys()].sort()).toEqual(
      ["chat", "diagram", "referee", "remember", "search", "timeline"].sort(),
    );
    /* And one at a time, so a mode reading the wrong flag shows up. */
    for (const built of ["glossary", "ideas", "quotes"] as const) {
      expect([...markedModes(only(built)).keys()], built).not.toContain(built);
    }
  });

  it("answers for every mode there is, and gives away only what it should", () => {
    for (const mode of MODES) {
      const gap = visitorGap(mode, EVERYTHING_BUILT);
      if (
        mode === "plain" ||
        mode === "hierarchy" ||
        mode === "outline" ||
        mode === "glossary" ||
        mode === "summary" ||
        mode === "ideas" ||
        mode === "quotes"
      ) {
        expect(gap, mode).toBeNull();
      } else {
        expect(gap, mode).not.toBeNull();
      }
    }
    /* And each marked entry carries the sentence the band will show, so the
       bar's tooltip cannot drift away from it — the drift a browser pass found
       on 2026-08-28, when the two said the same fact a few words apart. */
    for (const [mode, sentence] of markedModes(NOTHING_BUILT)) {
      expect(sentence).toBe(visitorSentence(visitorGap(mode, NOTHING_BUILT) as VisitorGap));
    }
  });
});

describe("the sentences themselves", () => {
  /** One of each kind, so the sweeps below cover the whole union. */
  const ALL: VisitorGap[] = [
    visitorGap("glossary", NOTHING_BUILT) as VisitorGap,
    visitorGap("chat", NOTHING_BUILT) as VisitorGap,
    COMMENTS_GAP,
  ];

  it("covers every kind the union has", () => {
    expect(new Set(ALL.map((g) => g.kind))).toEqual(
      new Set(["not-built", "owners-only", "readers-own"]),
    );
  });

  it("says something different for each kind", () => {
    /* By kind rather than by member, because a missing tweet thread and a
       missing glossary are deliberately the same sentence about different
       nouns. */
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
   * **Every artefact gets its own noun**, so the four sentences are about four
   * different things rather than one thing said four times.
   */
  it("names each artefact distinctly", () => {
    const nouns = (["tweets", "glossary", "quotes", "ideas"] as const).map(
      (what) => (notBuiltGap(what) as { noun: string }).noun,
    );
    expect(new Set(nouns).size).toBe(nouns.length);
  });

  /**
   * **The offer is withheld where it would not be kept.**
   *
   * Comments belong to whoever added the article, and an account does not
   * change that until docs/plans/260827ai-public-read-only-access.md § Stage 3. The two
   * entries that used to be withheld for the other reason — *we are the ones
   * who have not shipped it* — went with their union members in slice 1b, which
   * is why there is one `false` here and there were three.
   */
  it("offers an account only where an account is the fix", () => {
    expect(anAccountWouldHelp(visitorGap("glossary", NOTHING_BUILT) as VisitorGap)).toBe(true);
    expect(anAccountWouldHelp(visitorGap("chat", NOTHING_BUILT) as VisitorGap)).toBe(true);
    expect(anAccountWouldHelp(COMMENTS_GAP)).toBe(false);
  });
});

/**
 * **Which artefacts the payload turned out to have** — the derivation that
 * replaced `GET /api/public/metadata/:slug` in the client.
 *
 * It is two lines of code and it is the hinge of the whole slice: everything
 * above takes `PublicArtefacts`, and this is where those five booleans now come
 * from. The one way to get it wrong is the one the empty case below pins.
 */
describe("what the payload says it has", () => {
  const BARE: PublicArticle = {
    meta: { slug: "a-piece", title: "A piece" },
    blocks: [],
    /* Absent, and that is the third state: this article has never been through the
       `assets` step, so the reader hot-links exactly as before. src/assets.ts. */
    assets: undefined,
    tree: { version: "t", generator: "t", slug: "a-piece", rootId: "n0", nodes: {} },
  };

  it("reads a present key as yes and an absent one as no", () => {
    expect(artefactsIn(BARE)).toEqual({
      arc: false,
      tweets: false,
      glossary: false,
      ideas: false,
      quotes: false,
    });
    expect(
      artefactsIn({
        ...BARE,
        glossary: { entries: [{ id: "t", name: "T", kind: "concept", aliases: [], blocks: [] }] },
      }),
    ).toMatchObject({ glossary: true, quotes: false });
  });

  /**
   * **An artefact that is empty is one that exists**, and this is the case a
   * truthiness or a length test collapses.
   *
   * `{entries: []}` would mean somebody ran the step and it found no terms — a
   * ready but empty artefact, which the panel says out loud rather than
   * claiming nobody has built one.
   *
   * **The fixture below is a state no article can be in.** All four builders
   * throw rather than write an empty result (src/glossary.ts § buildGlossary
   * and its three siblings), and no stored artefact is empty. So this test
   * pins behaviour that is insurance against those throws being relaxed, not
   * behaviour any reader reaches — said here because a test whose fixture the
   * pipeline forbids will otherwise read as proof that the state occurs.
   * docs/plans/260827ai-public-read-only-access.md § The state that cannot happen.
   */
  it("counts an empty artefact as built", () => {
    const empty: PublicArticle = { ...BARE, glossary: { entries: [] }, ideas: { ideas: [] } };
    expect(artefactsIn(empty)).toMatchObject({ glossary: true, ideas: true });
    /* And the gap that follows from it: nothing stands in the way, so the band
       opens and says the list is empty rather than that nobody built one. */
    expect(visitorGap("glossary", artefactsIn(empty))).toBeNull();
    expect(visitorGap("quotes", artefactsIn(empty))?.kind).toBe("not-built");
  });

  /**
   * **The lift carries the four artefacts and nothing else.**
   *
   * `PublicArticle` extends `PublicArtefactSet`, so handing the whole payload
   * down would typecheck — and would leave the prose, the blocks and the tree
   * sitting there at runtime for the first `as` to reach. This is the same
   * construct-rather-than-spread rule the server DTOs follow.
   */
  it("lifts the artefacts out without the article coming with them", () => {
    const full: PublicArticle = { ...BARE, glossary: { entries: [] } };
    expect(Object.keys(artefactsOf(full))).toEqual(["glossary"]);
    expect(artefactsOf(BARE)).toEqual({});
  });
});

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
 * ## One test went with the fall-through, 2026-09-02
 *
 * *"never shows a visitor a bare mode id where a product noun belongs"* existed
 * because `visitorGap` ended in a fail-closed fall-through that had only the
 * mode id to hand `ownersOnly` — which is how a visitor came to read *"referee
 * is for whoever added this article"*. There is no fall-through: the policy is
 * a total `Record<Mode, VisitorPolicy>`, an unlisted mode does not compile, and
 * the owner-facing word is `MODE_LABEL[mode]`, so restating that here would
 * assert the implementation back at itself. What it was really protecting — that
 * the visitor reads a product noun — is *"calls referee Referee"* below, which
 * checks the whole sentence against the wording somebody chose. The sweeps over
 * `MODES` are unaffected; two of them remain.
 * docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md § T1.3.
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
  timeline: false,
  sketch: false,
};
const EVERYTHING_BUILT: PublicArtefacts = {
  arc: true,
  tweets: true,
  glossary: true,
  ideas: true,
  quotes: true,
  timeline: true,
  sketch: true,
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
    timeline: built === "timeline",
    sketch: built === "sketch",
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
   * **`timeline` left this list on 2026-09-04**, and the paragraph that stood
   * here is worth keeping in outline because it explains what changed.
   *
   * It was owners-only *deliberately* rather than by falling through, and the
   * reason given was that there was no `PublicArtefacts` flag for a timeline —
   * so the honest sentence was *this belongs to whoever added the article*,
   * never *nobody has built one*, which we could not know from a payload that
   * carried no timeline either way. Greg had said making it public-readable
   * "could be a follow-up".
   *
   * The payload carries it now, so the flag exists and the honest sentence is
   * the artefact one. Timeline is asserted under the artefact sweep below
   * instead, with the glossary and the quotes.
   * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 1.
   *
   * **`search` left the same day**, and it is the more interesting of the two
   * because it did *not* become an artefact mode. It is `available`: an article
   * nobody has searched is an empty panel rather than a boundary, which is the
   * call GPT Sol talked this plan into — *"No saved items yet is content inside
   * an accessible panel, not something preventing access."* So it is asserted
   * under the free sweep below, with `diagram`, and what stops a visitor
   * spending is the `SearchAccess` union rather than this table.
   * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4.
   */
  it("names the modes that spend as the owner's, whatever the flags say", () => {
    for (const mode of ["chat", "remember", "referee"] as const) {
      for (const flags of [NOTHING_BUILT, EVERYTHING_BUILT]) {
        expect(visitorGap(mode, flags)).toEqual({
          kind: "owners-only",
          feature: expect.any(String),
        });
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
    /* **Five since 2026-09-04.** `diagram` joined the four that cost nothing
       whatever has been built: its picture is drawn from the tree in the
       payload every reader already holds, which is the same bargain `outline`
       and `summary` make. It is unlike them in needing a component to enforce
       it — DiagramPanel.tsx § DiagramAccess — because the panel *can* buy, and
       the visitor arm is what stops it.
       docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 2. */
    /* **`search` joined this list on 2026-09-04.** Free in the sense this list
       means it — a visitor's band mounts no hook and issues no request — even
       though the runs on it cost the owner a model call each. What a visitor
       gets is the answers somebody already paid for, which is the same bargain
       `diagram` makes with the Sketch. */
    /* **`structure` joined on 2026-09-07**, on the plainest version of this
       bargain there is: its columns are an arrangement of the tree in the
       payload every reader already holds, mount no hook and issue no request.
       **And `outline` left the list on 2026-09-10**, by becoming Structure's
       narrow face rather than a mode — a list that was free on the terms above
       (it reads the arc from the payload and skips that rung without it) and is
       still free, under Structure's name.
       docs/plans/260910g-structure-mode-subsumes-outline.md. */
    const ALWAYS_FREE: Mode[] = [
      "plain",
      "hierarchy",
      "structure",
      "summary",
      "diagram",
      "search",
    ];
    expect([...markedModes(NOTHING_BUILT).keys()].sort()).toEqual(
      MODES.filter((m: Mode) => !ALWAYS_FREE.includes(m))
        .slice()
        .sort(),
    );
    /* Everything built: the artefact modes drop out, and what is left is
       the five that spend a model call. `timeline` was among them until
       2026-09-04 — it had no `PublicArtefacts` flag to drop out on, so it
       stayed marked however much had been built. It has one now, so it drops
       out here with the glossary and the quotes, and is asserted one-at-a-time
       below. docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 1.

       `referee` reached this list through `visitorGap`'s fail-closed
       fall-through until 2026-09-02, and this comment used to call that the
       arrangement working rather than an omission. It was both: the policy was
       right and the *sentence* was not, because the fall-through has only the
       mode id to name the button with. It has an `owners-only` row in the total
       `POLICY` record now, and there is no fall-through left to reach.
       docs/plans/260831an-referee-mode-for-peer-reviewers.md. */
    /* `debate` joined them on 2026-09-05 and is the one entry here that is
       expected to leave again: it is owners-only only until Stage 4 builds the
       public projection its rows must not bypass, at which point it drops out
       with the glossary and the quotes and this line loses a word.
       src/web/visitor.ts § POLICY.debate. */
    /* `citations` joined on 2026-09-11, owners-only for Debate's reason and
       expected to leave the same way once a public projection exists —
       src/web/visitor.ts § POLICY.citations. */
    expect([...markedModes(EVERYTHING_BUILT).keys()].sort()).toEqual(
      ["chat", "citations", "debate", "referee", "remember"].sort(),
    );
    /* And one at a time, so a mode reading the wrong flag shows up. */
    for (const built of ["glossary", "ideas", "quotes", "timeline"] as const) {
      expect([...markedModes(only(built)).keys()], built).not.toContain(built);
    }
  });

  it("answers for every mode there is, and gives away only what it should", () => {
    for (const mode of MODES) {
      const gap = visitorGap(mode, EVERYTHING_BUILT);
      if (
        mode === "plain" ||
        mode === "hierarchy" ||
        /* Same tree, in columns or (Outline's) nested list, and it reaches no
           artefact that could be missing — so a visitor is short of nothing
           and there is no gap to report.
           docs/plans/260910g-structure-mode-subsumes-outline.md. */
        mode === "structure" ||
        mode === "glossary" ||
        mode === "summary" ||
        mode === "ideas" ||
        mode === "quotes" ||
        mode === "timeline" ||
        /* Free since 2026-09-04: the picture is drawn from the tree in the
           payload, and the panel's visitor arm buys nothing.
           docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 2. */
        mode === "diagram" ||
        /* And the same day: the saved runs come in the payload, and the visitor
           arm of `SearchAccess` carries none of the four verbs.
           docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4. */
        mode === "search"
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
  ];

  it("covers every kind the union has", () => {
    expect(new Set(ALL.map((g) => g.kind))).toEqual(new Set(["not-built", "owners-only"]));
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
   * **Both kinds are fixed by an account, and there is no longer a third that
   * is not.**
   *
   * This test had three `false`s once, then one, and now none. Two went with
   * their union members in slice 1b; the last, `readers-own`, went on
   * 2026-09-08, because *a shared link carries the piece, never anybody's notes
   * about it* stopped being true on 2026-09-04 (260904c § Stage 3).
   *
   * **It is not vacuous now that the map answers `true` twice.** The values are
   * data rather than types, and the thing worth catching is somebody flipping
   * one: a `false` here withholds the sign-up offer from a signed-out visitor
   * at exactly the moment they have found the thing an account would give them
   * (PublicChrome.tsx § `offerAnAccount`). What the compiler covers instead is
   * a *new* kind, which cannot be added without deciding — visitor.ts §
   * `FIXED_BY_AN_ACCOUNT` says why the map was not collapsed to `return true`.
   */
  it("offers an account for every gap a visitor can meet", () => {
    expect(anAccountWouldHelp(visitorGap("glossary", NOTHING_BUILT) as VisitorGap)).toBe(true);
    expect(anAccountWouldHelp(visitorGap("chat", NOTHING_BUILT) as VisitorGap)).toBe(true);
  });
});

/**
 * **Which artefacts the payload turned out to have** — the derivation that
 * replaced a second request, to a public metadata endpoint, in the client —
 * and outlived it: that route was deleted on 2026-09-02.
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
    navLabelStatus: "ready",
    comments: [],
    searches: [],
    tree: { version: "t", generator: "t", slug: "a-piece", rootId: "n0", nodes: {} },
  };

  it("reads a present key as yes and an absent one as no", () => {
    expect(artefactsIn(BARE)).toEqual({
      arc: false,
      tweets: false,
      glossary: false,
      ideas: false,
      quotes: false,
      timeline: false,
      sketch: false,
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

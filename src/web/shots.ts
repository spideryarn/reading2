/**
 * Every screenshot the site pages show, in one record: which file, how big it
 * is, and what a reader who cannot see it is told.
 *
 * **Each shot declares its own width and height**, and tests/landing-assets.test.ts
 * reads this file and checks every entry against the bytes on disk — both that
 * the file exists (Vite's `*.png` wildcard module type-checks whether or not
 * it does) and that the numbers match its header, because an `<img>` with
 * `width: 100%` uses them only to reserve the right aspect ratio, and reserving
 * the wrong one is jank nobody can name. The regex in that test matches
 * `file:`, `w:`, `h:` in that order; keep them so.
 *
 * **How these were made, 2026-09-03.** Headless system Chrome driven by
 * Playwright, 1440×900 at 2×, of real articles in a local library — *The
 * Mythology of AI Consciousness* by Anil Seth for most of them, and Feynman's
 * *Cargo Cult Science* for the four landscape shots retaken that afternoon. The
 * capture scripts were session scratch and were not kept; a retake is a fresh
 * playwright-core script against system Chrome, signed in as the local admin,
 * following the alt text below for what each shot shows. Then
 * `pngquant --quality 65-92 --speed 1` and a downscale to about twice the width
 * they are drawn at. PNG rather than JPEG: small light text on a near-black
 * ground rings around every glyph as a JPEG, and a UI screenshot has few enough
 * flat colours that quantised PNG is smaller anyway.
 *
 * **Retaken on 2026-10-02**, because every landscape shot from that day showed a
 * mode bar offering Hierarchy and Outline, two modes that no longer exist, and
 * one carried a `toc/3` debug pill: `structure` (the hero, in place of
 * `outline`), `glossary`, `meaning`, `library`, the two below, and `sketch` in
 * place of `diagram`, whose force picture showed four kinds where there are
 * five. `skim` is new. Each is on a different article where it could be.
 * The band-only portraits (`ideas`, `quotes`, `learn`, `quiz`,
 * `meaningPanel`) show no bar and were still true, so they stayed.
 * docs/plans/261002b-bring-the-signed-out-home-page-features-and-design-up-to-date.md.
 *
 * **Every landscape shot is 2160 wide since that retake, and that is the
 * width to keep.** The pages draw a landscape shot at 1152px (SiteBits.tsx §
 * Showcase), so 1440 was 1.25× and visibly soft; 2160 is about 1.9×. The
 * portrait panels are drawn at ~360px and are 720 wide.
 *
 * **What cost the afternoon, so it does not cost the next one** — the whole
 * recipe is in docs/project/marketing-pages.md, but three things in particular:
 * the mode bar's controls are `role="radio"` and not `button` (Dock.tsx), so
 * `getByRole("button")` finds nothing; the `?mode=` must be named, because
 * a bare article URL opens in Plain and photographs as prose with no band;
 * and an on-demand mode renders an empty "nobody has found the terms for this
 * one yet" state on a bare URL visit — the run only starts when the mode-bar
 * control is actually pressed, and pressing it while already in that mode
 * toggles the band shut instead.
 *
 * Imported rather than dropped in `public/` so Vite hashes them and a redeploy
 * cannot serve a stale one.
 */
import askShot from "./assets/ask-in-place.png";
import glossaryShot from "./assets/glossary-card.png";
import ideasShot from "./assets/ideas.png";
import libraryShot from "./assets/library.png";
import quizShot from "./assets/quiz.png";
import quotesShot from "./assets/quotes.png";
import refereeShot from "./assets/referee-criteria.png";
import learnShot from "./assets/learn.png";
import meaningPanelShot from "./assets/search-meaning-panel.png";
import meaningShot from "./assets/search-meaning.png";
import sketchShot from "./assets/sketch.png";
import skimShot from "./assets/skim.png";
import structureShot from "./assets/structure.png";

export interface Shot {
  src: string;
  file: string;
  w: number;
  h: number;
  alt: string;
}

export const SHOTS = {
  glossary: {
    src: glossaryShot,
    file: "glossary-card.png",
    w: 2160,
    h: 1350,
    alt: "The prose of Feynman's “Cargo Cult Science” with its key terms underlined, the glossary's definitions in the panel beside it, and a card open over the text explaining who Robert Millikan was.",
  },
  structure: {
    src: structureShot,
    file: "structure.png",
    w: 2160,
    h: 1350,
    alt: "Structure mode beside the prose of an essay: its nine parts in one column, the part being read opened up with its summary, and that part's five sections in a second column.",
  },
  skim: {
    src: skimShot,
    file: "skim.png",
    w: 2160,
    h: 1350,
    alt: "Skim mode: a route of quotes through an essay, the first stop open with its quote, the terms it uses and the idea it bears on, and the same passage marked in the prose with a Next stop button below it.",
  },
  meaning: {
    src: meaningShot,
    file: "search-meaning.png",
    w: 2160,
    h: 1350,
    alt: "A search by meaning for why intelligence is not the same as consciousness: five scored passages in the panel, and the same sentences marked in the prose.",
  },
  meaningPanel: {
    src: meaningPanelShot,
    file: "search-meaning-panel.png",
    w: 720,
    h: 1469,
    alt: "The search panel in 'meaning' mode, listing the passages that match a description, each with a confidence score.",
  },
  ideas: {
    src: ideasShot,
    file: "ideas.png",
    w: 720,
    h: 982,
    alt: "The Ideas panel: the propositions the piece assumes and the ones it introduces.",
  },
  quotes: {
    src: quotesShot,
    file: "quotes.png",
    w: 720,
    h: 1469,
    alt: "The Quotes panel: the article's own sentences worth keeping, in order.",
  },
  sketch: {
    src: sketchShot,
    file: "sketch.png",
    w: 720,
    h: 918,
    alt: "Diagram mode's Sketch: the argument of an essay drawn as a flowchart, from an opening question down to two boxed columns, under the five diagram kinds.",
  },
  ask: {
    src: askShot,
    file: "ask-in-place.png",
    w: 2160,
    h: 1406,
    alt: "A sentence of an essay selected and marked in the prose, and beside it the question the reader asked about it and the model's answer, which ties the remark to the rest of the piece.",
  },
  learn: {
    src: learnShot,
    file: "learn.png",
    w: 720,
    h: 1428,
    alt: "Learn mode, waiting for the reader to say what they took from the piece.",
  },
  quiz: {
    src: quizShot,
    file: "quiz.png",
    w: 720,
    h: 1469,
    alt: "Quiz mode: short-answer questions generated from the article, one at a time.",
  },
  referee: {
    src: refereeShot,
    file: "referee-criteria.png",
    w: 2160,
    h: 810,
    alt: "Referee mode's Criteria view: the reviewer's question about whether the evidence for the central claim is strong, four numbered passages with a note on each, and one of them marked in the essay's prose.",
  },
  library: {
    src: libraryShot,
    file: "library.png",
    w: 2160,
    h: 1192,
    alt: "The library: a search box, sort and topic chips, and three articles on the shelf, each with its one-line gist.",
  },
} as const satisfies Record<string, Shot>;

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
 * Playwright, 1440×900 at 2× (scripts in the plan,
 * docs/plans/260902k-website-copy-homepage-and-features.md), of real articles
 * in a local library — *The Mythology of AI Consciousness* by Anil Seth for
 * most of them. Then `pngquant --quality 65-92 --speed 1` and a downscale to
 * about twice the width they are drawn at. PNG rather than JPEG: small light
 * text on a near-black ground rings around every glyph as a JPEG, and a UI
 * screenshot has few enough flat colours that quantised PNG is smaller anyway.
 *
 * Imported rather than dropped in `public/` so Vite hashes them and a redeploy
 * cannot serve a stale one.
 */
import askShot from "./assets/ask-in-place.png";
import diagramShot from "./assets/diagram.png";
import glossaryShot from "./assets/glossary-card.png";
import ideasShot from "./assets/ideas.png";
import libraryShot from "./assets/library.png";
import outlineShot from "./assets/outline.png";
import quizShot from "./assets/quiz.png";
import quotesShot from "./assets/quotes.png";
import refereeShot from "./assets/referee-criteria.png";
import rememberShot from "./assets/remember.png";
import meaningPanelShot from "./assets/search-meaning-panel.png";
import meaningShot from "./assets/search-meaning.png";
import zoomShot from "./assets/zoom-columns.png";

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
    w: 1440,
    h: 878,
    alt: "The article's prose with its key terms underlined, and a card open over one of them explaining what the author means by it.",
  },
  outline: {
    src: outlineShot,
    file: "outline.png",
    w: 1440,
    h: 900,
    alt: "A table of contents beside the prose, detailed near the section being read and sparser further away.",
  },
  zoom: {
    src: zoomShot,
    file: "zoom-columns.png",
    w: 1440,
    h: 900,
    alt: "Columns of increasingly detailed summary beside the article's own prose.",
  },
  meaning: {
    src: meaningShot,
    file: "search-meaning.png",
    w: 1440,
    h: 900,
    alt: "A search by meaning with its matching passages marked in the prose and painted as a lane in the narrow strip beside it.",
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
  diagram: {
    src: diagramShot,
    file: "diagram.png",
    w: 720,
    h: 1469,
    alt: "The force diagram: the article's sections as dots, joined where they share distinctive words, with the current section marked.",
  },
  ask: {
    src: askShot,
    file: "ask-in-place.png",
    w: 1440,
    h: 560,
    alt: "A sentence selected in the prose, and beside it the model's explanation of it, citing the surrounding passages.",
  },
  remember: {
    src: rememberShot,
    file: "remember.png",
    w: 720,
    h: 1428,
    alt: "Remember mode, waiting for the reader to say what they took from the piece.",
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
    w: 1440,
    h: 900,
    alt: "Referee mode on a paper, with the reviewer's own criteria listed and their matching passages marked in the prose.",
  },
  library: {
    src: libraryShot,
    file: "library.png",
    w: 1440,
    h: 900,
    alt: "The library: every article on one shelf.",
  },
} as const satisfies Record<string, Shot>;

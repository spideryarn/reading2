/**
 * **Every picture Help shows, in one record**: which file, how big it is, and
 * how it was taken, so the next person can take it again.
 * docs/plans/261007l-help-screenshots-and-gifs.md; the rules are
 * docs/project/help-page.md § Pictures.
 *
 * A page puts a picture in with one line, alone in its paragraph, its path
 * relative to the page's own file so GitHub shows it too:
 *
 *     ![What is in it, for somebody who cannot see it](images/spine-marks.png "The caption under it.")
 *
 * and help-markdown.tsx draws it as a `<figure>`, looking the name up here.
 *
 * ## Why every field
 *
 * - `w` and `h` are the file's pixels. **Every picture is shot at 2×**, so it
 *   is drawn at half that, and the `<img>` reserves that box before it loads
 *   (src/web/tailwind.css § images says why a wrong pair is worse than jank).
 *   tests/help-images.test.ts checks both against the file's header.
 * - `shows`, `article`, `window` and `taken` are **the retake recipe**. The
 *   site's own shots (src/web/shots.ts) learned on 2026-10-02 that a picture
 *   whose recipe was session scratch costs an afternoon to redo. `article` is
 *   always one on the public shelf: Help never shows a reader's own.
 *
 * ## Imported one by one, not globbed
 *
 * As help-pages.ts does the pages and shots.ts the site's pictures: Vite
 * hashes each import, so a redeploy cannot serve a stale picture, and a
 * missing file fails the build rather than drawing a broken image. The test
 * checks the other direction: a file in the folder with no entry here, and an
 * entry no page uses, are both red.
 *
 * Beside the code and not under docs/, for help-pages.ts's reason:
 * `.vercelignore` prunes docs/.
 */

import addingArticlesPng from "./pages/images/adding-articles.png";
import bottomBarPng from "./pages/images/bottom-bar.png";
import commandBarPng from "./pages/images/command-bar.png";
import commentMarginPng from "./pages/images/comment-margin.png";
import glossaryCardPng from "./pages/images/glossary-card.png";
import gutterPng from "./pages/images/gutter.png";
import helpModeInfoPng from "./pages/images/help-mode-info.png";
import modeBibliographyPng from "./pages/images/mode-bibliography.png";
import modeChatPng from "./pages/images/mode-chat.png";
import modeSourcesClaimsPng from "./pages/images/mode-sources-claims.png";
import modeFaqPng from "./pages/images/mode-faq.png";
import modeIllustratedPng from "./pages/images/mode-illustrated.png";
import modeLearnPng from "./pages/images/mode-learn.png";
import modeMarginaliaPng from "./pages/images/mode-marginalia.png";
import modePlainPng from "./pages/images/mode-plain.png";
import modeRefereePng from "./pages/images/mode-referee.png";
import modeGlossaryPng from "./pages/images/mode-glossary.png";
import modeIdeasPng from "./pages/images/mode-ideas.png";
import modeQuotesPng from "./pages/images/mode-quotes.png";
import modeSearchPng from "./pages/images/mode-search.png";
import modeSketchPng from "./pages/images/mode-sketch.png";
import modeSkimPng from "./pages/images/mode-skim.png";
import modeStructurePng from "./pages/images/mode-structure.png";
import modeSummaryPng from "./pages/images/mode-summary.png";
import modeTimelinePng from "./pages/images/mode-timeline.png";
import moreOpenPng from "./pages/images/more-open.png";
import passageLinkPng from "./pages/images/passage-link.png";
import phonePng from "./pages/images/phone.png";
import readingViewPng from "./pages/images/reading-view.png";
import jumpBackGif from "./pages/images/jump-back.gif";
import jumpBackStillPng from "./pages/images/jump-back-still.png";
import skimStepsGif from "./pages/images/skim-steps.gif";
import skimStepsStillPng from "./pages/images/skim-steps-still.png";
import spineWalkGif from "./pages/images/spine-walk.gif";
import spineWalkStillPng from "./pages/images/spine-walk-still.png";

export interface HelpImage {
  /** The hashed address Vite gives the file. */
  readonly src: string;
  /** The file's pixels. Drawn at half: every picture is shot at 2×. */
  readonly w: number;
  readonly h: number;
  /** What the picture shows: what to point the browser at when it is retaken. */
  readonly shows: string;
  /** The article in it, title and slug, always one on the public shelf; or "none". */
  readonly article: string;
  /** The window it was taken in, "1440×900 at 2×". */
  readonly window: string;
  /** The day, yyyy-mm-dd. */
  readonly taken: string;
  /**
   * **A GIF's still**, and only a GIF's: a PNG of its most telling frame, the
   * same size, shown instead to a reader whose system asks for reduced motion.
   * The site's reduced-motion rule (tailwind.css) shortens CSS animations; it
   * cannot stop a GIF, and a GIF loops for ever. `file` is its name in the
   * same folder; tests/help-images.test.ts checks both.
   */
  readonly still?: { readonly src: string; readonly file: string };
}

/** By file name under src/web/help/pages/images/. */
export const HELP_IMAGES: Readonly<Record<string, HelpImage>> = {
  "reading-view.png": {
    src: readingViewPng,
    w: 1344,
    h: 840,
    shows: "The whole reading view with Structure open, scrolled to pure prose; the full window, downscaled to 1344 wide.",
    article: "Cargo Cult Science (cargocult-spya-rz663q)",
    window: "1440×900 at 2×, downscaled",
    taken: "2026-10-07",
  },
  "bottom-bar.png": {
    src: bottomBarPng,
    w: 1344,
    h: 36,
    shows: "The bottom bar alone, Plain open, on the admin’s own copy of a public article.",
    article: "Great Hackers (gh-spya-whnhkx)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "spine-walk.gif": {
    src: spineWalkGif,
    w: 1200,
    h: 980,
    shows:
      "?mode=plain; the pointer onto the spine, then slowly down it across five sections so the card follows. Clip x0 y110 w600 h490 CSS, a frame every ~120ms, scripts/frames-to-gif.ts --delay 120 --colours 128. The still is the “What hackers choose at home” card.",
    article: "Great Hackers (gh-spya-whnhkx)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
    still: { src: spineWalkStillPng, file: "spine-walk-still.png" },
  },
  "skim-steps.gif": {
    src: skimStepsGif,
    w: 1320,
    h: 740,
    shows:
      "?mode=skim on the route already planned; → pressed twice, so the outlined stop moves twice. Page zoom 0.92 so the prose and Next stop fit; clip x640 y250 w660 h370 CSS. The still is the “first principle” stop.",
    article: "Cargo Cult Science (cargocult-spya-rz663q)",
    window: "1440×900 at 2×, page zoom 0.92",
    taken: "2026-10-07",
    still: { src: skimStepsStillPng, file: "skim-steps-still.png" },
  },
  "jump-back.gif": {
    src: jumpBackGif,
    w: 1344,
    h: 780,
    shows:
      "?mode=plain; a click on the spine jumps to another section and “↩ back to …” appears, then pressing it returns. A narrow window so the button and the prose share 672 CSS px; clip x0 y470 w672 h390 CSS. The still is the button just after the jump.",
    article: "Great Hackers (gh-spya-whnhkx)",
    window: "760×900 at 2×",
    taken: "2026-10-07",
    still: { src: jumpBackStillPng, file: "jump-back-still.png" },
  },
  "gutter.png": {
    src: gutterPng,
    w: 1344,
    h: 496,
    shows: "Pointing at one paragraph so its margin controls show; cropped to the paragraph and the margin.",
    article: "Great Hackers (gh-spya-whnhkx)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "passage-link.png": {
    src: passageLinkPng,
    w: 1344,
    h: 284,
    shows: "Hovering a paragraph’s link icon until its tooltip shows; cropped to the heading, the paragraph’s top and the tooltip.",
    article: "Great Hackers (gh-spya-whnhkx)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "command-bar.png": {
    src: commandBarPng,
    w: 1100,
    h: 760,
    shows: "⌘K over the reading view, nothing typed; cropped to the bar’s first eleven rows.",
    article: "Great Hackers (gh-spya-whnhkx)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "adding-articles.png": {
    src: addingArticlesPng,
    w: 1344,
    h: 228,
    shows: "The Add an article box on the shelf, cropped to the box alone; the row of earlier imports under it hidden with CSS so no title shows.",
    article: "none (the shelf, cropped to the box)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "comment-margin.png": {
    src: commentMarginPng,
    w: 1344,
    h: 304,
    shows: "A comment made for the shot on a public article (and deleted after) on “7.6 percent”, with its row beside the article.",
    article: "How to Make Pittsburgh a Startup Hub (pgh-spya-vkvqjq)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "phone.png": {
    src: phonePng,
    w: 780,
    h: 1308,
    shows: "The reading view in Plain at phone size, cropped from the article text down to the dock.",
    article: "How to Make Pittsburgh a Startup Hub (pgh-spya-vkvqjq)",
    window: "390×844 at 2×",
    taken: "2026-10-07",
  },
  "more-open.png": {
    src: moreOpenPng,
    w: 728,
    h: 730,
    shows: "The bottom bar’s More list open, Ideas open behind it; cropped to the list and the bar.",
    article: "Cargo Cult Science (cargocult-spya-rz663q)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "help-mode-info.png": {
    src: helpModeInfoPng,
    w: 922,
    h: 832,
    shows: "Quotes open, pointing at the band’s (i) until its card shows; cropped to the card.",
    article: "Cargo Cult Science (cargocult-spya-rz663q)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-structure.png": {
    src: modeStructurePng,
    w: 1344,
    h: 760,
    shows: "?mode=structure, the band alone, Fisheye.",
    article: "How to Make Pittsburgh a Startup Hub (pgh-spya-vkvqjq)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-summary.png": {
    src: modeSummaryPng,
    w: 1088,
    h: 880,
    shows: "?mode=summary, Brief, the band alone.",
    article: "Claude’s Constitution (claudes-constitution-spya-cr8bzk)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "glossary-card.png": {
    src: glossaryCardPng,
    w: 1160,
    h: 704,
    shows: "Pointing at an underlined term (Millikan) until its card shows, over pure prose.",
    article: "Cargo Cult Science (cargocult-spya-rz663q)",
    window: "1440×900 at 2×",
    taken: "2026-10-09",
  },
  "mode-glossary.png": {
    src: modeGlossaryPng,
    w: 1088,
    h: 1042,
    shows: "?mode=glossary, the band alone, prioritised; cropped after the second entry.",
    article: "Cargo Cult Science (cargocult-spya-rz663q)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-quotes.png": {
    src: modeQuotesPng,
    w: 1088,
    h: 1138,
    shows: "?mode=quotes, in order, the band alone; cropped after the fourth quote.",
    article: "Cargo Cult Science (cargocult-spya-rz663q)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-search.png": {
    src: modeSearchPng,
    w: 1088,
    h: 840,
    shows: "?mode=search, a words search for “science”, the band alone; cropped after the sixth row.",
    article: "Cargo Cult Science (cargocult-spya-rz663q)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-bibliography.png": {
    src: modeBibliographyPng,
    w: 1088,
    h: 860,
    shows: "?mode=sources (Bibliography, prioritised), the chip row and the band alone; clip x12 y44 w544 h430 CSS, cropped after the second work.",
    article: "The Scaling Hypothesis (scaling-hypothesis)",
    window: "1440×900 at 2×",
    taken: "2026-10-09",
  },
  "mode-skim.png": {
    src: modeSkimPng,
    w: 1344,
    h: 382,
    shows: "?mode=skim, the first stop of a planned route: the band and the prose beside it, cropped to the stop.",
    article: "Cargo Cult Science (cargocult-spya-rz663q)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-sketch.png": {
    src: modeSketchPng,
    w: 1088,
    h: 1400,
    shows: "?mode=diagram on its Sketch chip, the band alone.",
    article: "Utility of phrenology (fowler-phrenology)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-timeline.png": {
    src: modeTimelinePng,
    w: 1088,
    h: 828,
    shows: "?mode=timeline, the band alone, top of the list.",
    article: "Utility of phrenology (fowler-phrenology)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-ideas.png": {
    src: modeIdeasPng,
    w: 1088,
    h: 740,
    shows: "?mode=ideas, the band alone.",
    article: "Cargo Cult Science (cargocult-spya-rz663q)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-faq.png": {
    src: modeFaqPng,
    w: 1088,
    h: 1076,
    shows:
      "?mode=faq, prioritised, the band alone after one run of Find the questions; clip x12 y44 w544 h538 CSS, cropped after the second question.",
    article: "Cargo Cult Science (cargocult-spya-rz663q)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-learn.png": {
    src: modeLearnPng,
    w: 1088,
    h: 1120,
    shows:
      "?mode=learn, Recall, after one turn. Typed: “Graham’s idea is that Pittsburgh shouldn’t chase startups directly, but should make itself a place smart young people want to live. I think he said the main thing Pittsburgh has going for it is Carnegie Mellon’s research money.” (the last sentence is the planted mistake). Clip x12 y44 w544 h560 CSS, the band alone.",
    article: "How to Make Pittsburgh a Startup Hub (pgh-spya-vkvqjq)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-chat.png": {
    src: modeChatPng,
    w: 1088,
    h: 880,
    shows:
      "?mode=chat, one question: “Does Graham give real evidence that great hackers are that much more productive, or does he just assert it?” Clip x12 y44 w544 h440 CSS, the band alone: the question and the top of the answer.",
    article: "Great Hackers (gh-spya-whnhkx)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-sources-claims.png": {
    src: modeSourcesClaimsPng,
    w: 1088,
    h: 896,
    shows:
      "?mode=sources&sources=claims on a listed claims list, the chip row and the band alone, two claims each with its Cited in this paragraph line; clip x12 y44 w544 h448 CSS.",
    article: "The Scaling Hypothesis (scaling-hypothesis)",
    window: "1440×900 at 2×",
    taken: "2026-10-09",
  },
  "mode-referee.png": {
    src: modeRefereePng,
    w: 1088,
    h: 1356,
    shows:
      "?mode=referee, Criteria, the Strength of evidence preset and Run this criterion; the panel scrolled so the criterion is at its top, clip x12 y92 w544 h678 CSS, the band alone.",
    article: "Batch Normalization (arxiv-1502-spya-tqwbn2)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-marginalia.png": {
    src: modeMarginaliaPng,
    w: 1344,
    h: 556,
    shows:
      "With Ideas and FAQ already made, ?mode=plain, then the bottom bar’s Marginalia; scrollTo(0, 2456); clip x412 y0 w1008 h417 CSS so prose and column are both in, downscaled from 2016 to 1344 wide. The introduces stamp comes from Ideas; the shut question comes from FAQ.",
    article: "Cargo Cult Science (cargocult-spya-rz663q)",
    window: "1440×900 at 2×, downscaled",
    taken: "2026-10-07",
  },
  "mode-plain.png": {
    src: modePlainPng,
    w: 1180,
    h: 556,
    shows:
      "With Glossary already made, ?mode=plain, scrolled to the first occurrence of Millikan; clip x412 y90 w590 h278 CSS, the prose alone.",
    article: "Cargo Cult Science (cargocult-spya-rz663q)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
  "mode-illustrated.png": {
    src: modeIllustratedPng,
    w: 1088,
    h: 1432,
    shows:
      "With Sketch already drawn, ?mode=diagram, the Illustrated chip once painted, first plate The Funnel and the Fan selected; clip x12 y40 w544 h716 CSS, the band alone, down to the first item of What it depicts.",
    article: "Utility of phrenology (fowler-phrenology)",
    window: "1440×900 at 2×",
    taken: "2026-10-07",
  },
};

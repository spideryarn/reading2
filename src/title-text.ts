/**
 * **The article title in a tab, composed once for both the sides that write
 * it.**
 *
 * Two things put a title into `<title>`, half a second apart. The server
 * composes a head for `/read/<slug>` before the bundle has loaded, so that a
 * pasted link previews as something (src/public/page-head.ts); React then
 * mounts and assigns `document.title` from `pageTitle()`
 * (src/web/page-title.ts). Whatever these two disagree about is a **visible
 * change in the tab at mount** — the reader watches the title they were given
 * turn into a different one.
 *
 * They did disagree, and nobody had decided that they should. The server ran
 * the title through `headText` (src/html.ts): internal runs of whitespace
 * collapsed, control characters became a space, bidi overrides were dropped.
 * The client only trimmed the ends and cut to length. So an article titled
 * `Two  spaces` was served as `Two spaces` and then rewritten to `Two  spaces`
 * in front of the reader. GPT Sol's review of stage 2 slice 1 found it; it was
 * pinned as a known divergence and put to Greg, who left the choice here
 * (2026-08-30).
 *
 * **The choice: the server's normalisation wins, and the client's clamp wins.**
 * Each side keeps the rule it had the better reason for.
 *
 *  - *Normalising* is not a preference. An RLO in a title reverses display
 *    order (`A‮gnp.exe` shows as `A exe.png`) and a newline in a `<title>`
 *    renders differently in every consumer of it. The server had to do it
 *    because its output is published into caches we cannot clear, and there is
 *    no argument for the tab being the one place a bidi override survives.
 *  - *Clamping with a word-boundary ellipsis* is what a reader wants in a tab,
 *    a bookmark and a history entry: `…` says "there was more". The server had
 *    the hard cut because `headText` serves `og:title` as well, and an ellipsis
 *    in metadata is a claim that the title contained one.
 *
 * So this file composes with `normaliseText` and with `clamp`, and both callers
 * import the result rather than restating it. The `og:` and `twitter:` tags
 * keep the hard `headText` clamp at their own limits — that difference is
 * between *a tab* and *a card*, which are different sinks read by different
 * things, and not between two copies of one rule.
 *
 * ## Why it is here rather than in src/web/
 *
 * src/web/page-title.ts imports React, and a module reached by
 * src/public/routes.ts may not import anything under src/web/ — the public
 * import graph is asserted closed (tests/public-imports.test.ts). The standing
 * answer in this repo for a thing two sides need is to move it into a module
 * that imports almost nothing, which is what this is: src/html.js for the
 * normaliser, and src/modes.js and src/read-address.js for the two vocabularies
 * a title is built from. All three are themselves leaves.
 * tests/client-imports.test.ts lists every one of them and **checks** that they
 * are pure rather than trusting the claim — which matters, because this
 * paragraph said "src/html.js and no more" for half a day after `modes.js`
 * arrived. GPT Sol, 2026-08-30.
 *
 * See docs/project/page-titles.md for the rules behind the composition, and
 * docs/plans/260827ai-public-read-only-access.md § Stage 2 for the server half.
 */
import { normaliseText } from "./html.js";
import { DEFAULT_MODE, type Mode } from "./modes.js";
import type { ArticleView } from "./read-address.js";

/** The product. `reading2` is the directory and the repo; this is the name. */
export const APP_NAME = "Spideryarn";

/**
 * The strapline. It appears on the two homepages and nowhere else — the shelf
 * with nothing chosen on it, and the landing page a signed-out reader gets
 * instead. See `segments` in src/web/page-title.ts for why it is on no other.
 */
export const TAGLINE = "AI-assisted reading";

/**
 * Between segments.
 *
 * A middot rather than an em dash or a pipe: it is already this app's
 * separator (the fact lines on the library card and the metadata page use it),
 * it is the narrowest of the three so it spends the fewest of a tab's very few
 * pixels, and unlike `-` it can never be confused with a hyphen inside a title
 * that has one. No evidence anywhere says one separator is more legible than
 * another; consistency with the rest of the app is the whole argument.
 */
export const SEP = " · ";

/**
 * How much of a leading title we keep.
 *
 * Nothing forces this. No browser has a character limit, and every place that
 * truncates does it by **pixels** rather than characters — Firefox caps a tab
 * at 225px, Chrome shrinks tabs until only the favicon is left, Google cuts a
 * search result at about 600px. The familiar "50-60 characters" is SEO folklore
 * converged on by blogs, not a vendor number, and it is the wrong *unit*
 * besides. So a clamp cannot make a title fit a tab, and this one does not try.
 *
 * It is for the places that do *not* truncate: the history list, a bookmark,
 * the window switcher, and the text somebody gets when they paste a link into a
 * chat. A 180-character academic paper title there pushes everything after it
 * off the end of the useful world.
 *
 * 64 is therefore a judgment call rather than a measurement, and it is
 * deliberately generous — comfortably more than any tab shows, so clamping
 * never costs a reader something the tab would have shown them.
 */
export const CLAMP = 64;

/**
 * Cut at a word boundary, with an ellipsis, or return the text unchanged.
 *
 * Word boundary rather than mid-word because the cut is doing the reader a
 * favour and a truncation that lands inside a word looks like corruption. If
 * there is no space to cut at in the last third of the budget — one very long
 * word, or a language that does not space its words — it cuts where it must,
 * which is still better than not clamping.
 *
 * **Counted in code points, not in UTF-16 units**, which is why the text is
 * split into an array first rather than sliced. `"…".slice(0, 64)` will happily
 * cut an emoji in half and leave a lone surrogate, which renders as `�` — a
 * clamp whose whole job is to look deliberate, producing the one character that
 * looks like corruption. GPT Sol found it, 2026-08-27.
 *
 * Code points, not graphemes: a combining accent or a flag can still be split,
 * and doing better needs `Intl.Segmenter`. Not worth a segmenter for a title
 * that is already being cut with an ellipsis on it — but that is the next step
 * if this ever matters.
 *
 * **The result can be one code point longer than `max`**, because the ellipsis
 * is appended rather than counted. That is deliberate and it is why the two
 * clamps are not interchangeable: `headText(t, 64)` is a promise about a
 * length, and this is a promise about legibility.
 */
export function clamp(text: string, max = CLAMP): string {
  const points = [...text];
  if (points.length <= max) return text;
  const cut = points.slice(0, max).join("");
  const space = cut.lastIndexOf(" ");
  // Only honour a space in the last third; otherwise a title whose first word
  // is long would be clamped down to that one word.
  const at = space > cut.length * 0.66 ? cut.slice(0, space) : cut;
  return `${at.trimEnd()}…`;
}

/**
 * **An article's own title, as the leading segment of a page title.**
 *
 * Normalise, then clamp — in that order, and the order is not cosmetic. A
 * clamp before normalising would count invisible bidi characters and collapsing
 * whitespace against the budget, so two titles that display identically would
 * be cut in different places.
 *
 * `||` and not `??`: a title of `"   "` normalises to `""`, which is as
 * titleless as `null`, and `Untitled · Spideryarn` is a better tab than a
 * stranded separator. src/public/page-head.ts says `Untitled` in `og:title`
 * for the same reason.
 */
export function articleTitle(title: string | null): string {
  return clamp(normaliseText(title ?? "")) || "Untitled";
}

/**
 * **The whole of what `<title>` says for one article** — its own title, then
 * the app's name.
 *
 * This exact string is what src/public/page-head.ts writes into the served
 * document and what src/web/page-title.ts assigns to `document.title` a moment
 * later, so the tab does not change at mount. tests/page-head.test.ts asserts
 * the two are character for character equal over a corpus built to break them;
 * that test is only worth anything because both sides call *this* function
 * rather than each restating it. A helper the tests use and the code does not
 * is a helper that can be right while the code is wrong.
 *
 * **The mode is part of it**, and the default one is left out — the rule
 * `readTitle` in src/web/page-title.ts has always followed, now applied on both
 * sides. A reader with the same article open in three modes gets three tabs they
 * can tell apart, and `Hierarchy` in nearly every tab would distinguish nearly
 * nothing while costing eleven characters of a string that is already being cut.
 * An unrecognised `?mode=` is not this function's problem: the caller resolves
 * it to the default first, with `isMode` in src/modes.ts, exactly as `modeParam`
 * does on the client.
 *
 * Not the card title: `og:title` drops the ` · Spideryarn` suffix and the mode
 * with it. A card already carries `og:site_name`, so repeating the app name
 * spends the visible half of the card saying one word twice — and a shared link
 * is about the article, not about which panel the person who shared it happened
 * to have open.
 */
export function documentTitle(
  title: string | null,
  mode: Mode = DEFAULT_MODE,
  view: ArticleView = "article",
): string {
  /* **The view wins over the mode, and that is `readTitle`'s rule rather than a
     new one**: the metadata and tweets pages are pages beside the article, and
     the mode is a band inside the reading view that neither of them has. A
     `/read/x?about=1&mode=glossary` becomes `x · Metadata · Spideryarn` on both
     sides, with the mode dropped. */
  const label =
    view !== "article"
      ? `${VIEW_LABEL[view]}${SEP}`
      : mode === DEFAULT_MODE
        ? ""
        : `${MODE_LABEL[mode]}${SEP}`;
  return `${articleTitle(title)}${SEP}${label}${APP_NAME}`;
}

/**
 * The two of an article's three views that are pages beside the article rather
 * than the article itself. Named as the Dock names them, so the tab and the
 * button you pressed to get there agree.
 *
 * Beside `MODE_LABEL` and for the same reason: the server composes this title
 * too. `/read/x?about=1` is one path segment, so it reaches the composer, and
 * `main.tsx` then rewrites it to the metadata page — see
 * `redirectsToMetadata` in src/read-address.ts.
 */
export const VIEW_LABEL: Record<Exclude<ArticleView, "article">, string> = {
  metadata: "Metadata",
  tweets: "Tweets",
};

/**
 * **Which of the middle-band modes, by the name the Dock uses**, so that the tab
 * and the button the reader pressed to get there say the same word.
 *
 * It said "the fourteen middle-band modes" until 2026-09-07, and the number came
 * out rather than being incremented: nothing counts the modes, and a count in a
 * comment is one of the eight places promoting Quotes had to edit arithmetic
 * (docs/project/new-mode.md § Moving a mode in or out of the switch).
 *
 * Here rather than in src/web/page-title.ts because the server composes this
 * title too — `/read/<slug>?mode=glossary` is served with `· Glossary` already
 * in it, and without that the tab said one thing and React said another a second
 * later, which is the fault this whole file exists to close. GPT Sol found that
 * one on review, 2026-08-30: the fuzz could not see it because every generated
 * case left `mode` absent, and the missing dimension was title *state* rather
 * than title *characters*.
 */
export const MODE_LABEL: Record<Mode, string> = {
  plain: "Plain",
  hierarchy: "Hierarchy",
  summary: "Summary",
  glossary: "Glossary",
  ideas: "Ideas",
  quotes: "Quotes",
  timeline: "Timeline",
  search: "Search",
  referee: "Referee",
  diagram: "Diagram",
  chat: "Chat",
  remember: "Remember",
  debate: "Debate",
  structure: "Structure",
  citations: "Citations",
};

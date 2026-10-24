/**
 * **Stage 2's read: Readability over one page's bytes, writing nothing** —
 * `readArticle`, `readArticleWithProvenance`, the capability floor, and the DOM
 * prep they share.
 *
 * Moved out of src/extract.ts on 2026-10-24 so that it is a leaf below both of
 * its callers. src/read-parts.ts reads each page of a multi-page article with
 * `readArticle`, and src/extract.ts's `runExtract` calls `readParts`; while the
 * read lived in extract.ts the two files imported each other, and
 * `npm run cycles` went red (docs/postmortems/261024m-import-cycles-closed-by-a-new-caller.md).
 * Keep it that way: nothing here may import src/extract.ts or src/read-parts.ts.
 * src/extract.ts re-exports everything public here, so existing importers did
 * not move.
 *
 * Nothing here is top-level `await`, for the reason src/extract.ts gives.
 */
/* jsdom on first use rather than at module scope — src/jsdom-lazy.ts says why.
   `readArticle` below stays synchronous. */
import { jsdom } from "./jsdom-lazy.js";
import { Readability } from "@mozilla/readability";
import { canonicaliseCallouts, type CalloutStats } from "./callouts.js";
import { ChallengePage, challengeIn } from "./challenge-page.js";
import { removePlatformFurniture } from "./furniture.js";
import { latexmlAuthorNames, latexmlTitleText, latexmlUntitled, prepareLatexml, untitledLatexmlMarkup } from "./latexml.js";
import { READER_COMMENTS_KEY, removeReaderComments } from "./reader-comments.js";
import { canonicaliseMaths } from "./maths-import.js";
import { canonicaliseNotes, type NoteStats } from "./notes.js";
import {
  type KeptStructure,
  type ProtectOptions,
  controlOptionsFor,
  keptWithdrawn,
  notForPrintText,
  proseRetention,
  protectAuthoredStructure,
} from "./protect.js";
/* The namespace and its scrub — src/reserved.ts is the only file allowed to
   name one of these attributes. See `stampSourceIds`. */
import { ownIdsOfDocument } from "./article-registry.js";
import type { WorkId } from "./bibliographic.js";
import { metaAuthors } from "./meta-authors.js";
import { RESERVED_ATTRS, scrubReserved } from "./reserved.js";
import { type OpeningRecord, markHidden, openingHeading, pageOpening } from "./front-matter-authors.js";
import type { Author } from "./types.js";

/** Counts from the named pre-Readability removal passes, by their fixed audit keys. */
export type ExtractRemovals = Readonly<Record<string, number>>;

/**
 * **Un-hide `aria-hidden="true"` before Readability looks at the page.**
 *
 * Readability's visibility check (`Readability.js:2701`) skips any node marked
 * `aria-hidden="true"`, along with `[hidden]` and inline `display: none`. That
 * is right for an off-screen menu and wrong for a **collapsed section of the
 * article**: an accordion is closed, not absent, and a reader would see the text
 * by clicking on it. Readability cannot click.
 *
 * Measured over the fifteen pages in evals/extraction/fixtures/ (run
 * `npx tsx evals/extraction/corpus.mts`), removing the attribute does exactly
 * two things and is byte-for-byte inert on the other thirteen:
 *
 * 1. **anthropic.com/constitution: 39,355 characters come back** — a quarter of
 *    the article. Three `ExpandableSection` divs holding *Claude's three types
 *    of principals*, the verification passage and the hard constraints. Real
 *    body text, collapsed by default, invisible to every stage after this one.
 * 2. **Wikipedia: non-empty accessible names come back on 188 formula images.**
 *    Wikipedia writes each formula twice — MathML inside `style="display: none"`
 *    for assistive tech, and a fallback `<img aria-hidden="true">` for eyes.
 *    Readability drops the MathML (inline `display: none`, which this does NOT
 *    touch) and keeps the image, so the attribute ends up pointing at an
 *    accessible twin that no longer exists, leaving all 188 with no accessible
 *    name. Checked through the real sanitiser, not inferred: 208 images
 *    reach the reading view, 188 of them carrying `alt` text, and `aria-hidden`
 *    goes 188 → 0. **Stated no further than that**, at GPT Sol's insistence: not
 *    "audible", not "an accessibility win". The `alt` is raw TeX
 *    (`{\displaystyle {\text{Loss}}=-\sum …`), and no browser accessibility
 *    inspection and no screen reader were run.
 *
 * **`[hidden]` is deliberately not touched**, though the first version of this
 * removed it too. Across the same fifteen pages it changed exactly one, arxiv.org
 * abs, and what it added was 95 characters of *furniture*: "View a PDF of the
 * paper titled …", a screen-reader label for a link. That is the whole measured
 * effect, and it is a regression — caught only because the arm was compared
 * document-against-document rather than by counting recovered characters, which
 * scored it as a gain. The distinction that matters: `hidden` is the HTML spec's
 * own "not currently relevant" and authors mean it, whereas `aria-hidden` is an
 * accessibility annotation, and the visual/assistive split is exactly where
 * readable text gets marked invisible to a parser.
 *
 * Inline `display: none` is left alone for the same reason — it is a stronger
 * claim, and stripping it on Wikipedia would restore 188 MathML formulas *beside*
 * the 188 images that already render them.
 *
 * **What this is known to let in, and the corpus cannot see.** A navigation
 * drawer hidden by external CSS only — `aria-hidden="true"` on the container, no
 * `[hidden]`, no inline `display: none` — is admitted when it sits *inside* the
 * article container; outside it, link density sinks it either way. GPT Sol's
 * counter-example, reproduced, and at thirty items it is 1,370 characters. None
 * of the fifteen fixtures contains the pattern, so "byte-identical on thirteen"
 * says nothing about how often it happens. Pinned as behaviour rather than as a
 * safety claim in tests/extract-unhide.test.ts, so changing the rule changes an
 * expectation instead of changing nothing. Backing this out is deleting one call.
 *
 * The design not taken, and the one to revisit if that pattern turns up: strip
 * the attribute, parse, then **restore it** on surviving nodes — Sol's argument,
 * that extraction and accessibility are separate decisions and this conflates
 * them. Blanket restore is also wrong (it would re-hide the 39,355 recovered
 * characters from the accessibility tree), so the real design is a three-way
 * rule: keep the removal on recovered content regions, restore on decorative or
 * duplicate leaves, special-case a fallback image whose accessible twin did not
 * survive. That is more than this change is worth today.
 *
 * Exported because evals/extraction/inventory.mts scores this arm and must score
 * the code that ships, not a second copy of it.
 */
export function unhideCollapsedSections(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll('[aria-hidden="true"]'))) {
    el.removeAttribute("aria-hidden");
  }
}

/**
 * Stage 2 — Readability over already-fetched HTML, and the artefacts that fall
 * out of it.
 *
 * `html` is passed in rather than fetched here so that this stage is a pure
 * function of bytes we already hold: re-running it costs nothing and asks
 * nobody's server for anything. The queue relies on that.
 */
/**
 * **Everything stage 2 does to a page before anything is written down** — the
 * DOM prep and the Readability call, with no filesystem, no metadata and no
 * side effect.
 *
 * Split out of `runExtract` on 2026-08-31 because two eval instruments were
 * re-deriving it and got it wrong. `evals/extraction/probe.mts` and
 * `tidy.mts` each did `unhide → Readability → split`, missing
 * `canonicaliseNotes` — and the cost of that omission was not theoretical:
 * `acx_footnotes.html` reports **18 stranded footnote-marker blocks** through
 * the instruments' version and **zero** through this one, because
 * canonicalisation is precisely what turns those markers into notes. An
 * instrument measuring a pipeline that does not exist reported a failure the
 * real pipeline had already fixed, and nothing could have caught it except
 * running the two side by side. Found by GPT Sol's review.
 *
 * So the order below is the contract, not an implementation detail, and it has
 * exactly one home. `canonicaliseCallouts` joined it on 2026-08-31 for the same
 * reason `canonicaliseNotes` is here: it has to run before Readability, which
 * deletes the element a callout is named on (src/callouts.ts).
 *
 * `article` is `null` when Readability declines the page — the caller decides
 * whether that is an error (`runExtract`: yes) or a row in a table (an eval:
 * no). It is deliberately not thrown from here.
 *
 * `refusal` is the same arrangement for the capability floor below: non-null
 * means *this is too little text to build anything from*, `article` is whatever
 * Readability handed back anyway, and it is the caller's business what to do
 * about it.
 *
 * **Since 2026-10-06 `refusal` can also be a `ChallengePage`** — the document is
 * a site's bot check (src/challenge-page.ts) — and it **wins over both older
 * findings**: a bot check that is also short is reported as a bot check, and
 * so is one Readability declines. So `article: null` can now arrive beside a
 * non-null `refusal`, and a caller that wants the most specific answer asks
 * about `refusal` first, as `runExtract` does. See `refusalFor`.
 */
export function readArticle(
  html: string,
  /** `null` for a document with no address — see `sourceDom`. */
  url: string | null,
): {
  article: ReturnType<Readability["parse"]>;
  /**
   * Every author the page's metadata declares, or `null` to leave the byline to
   * Readability — src/meta-authors.ts. Kept apart from `article` so an eval
   * asking what Readability said still gets what Readability said.
   */
  authors: Author[] | null;
  /**
   * The page's text from its main heading on, read before Readability, as
   * records: what the general authors pass reads (src/front-matter-authors.ts).
   */
  opening: OpeningRecord[];
  /** Whether `opening` starts at the page's main heading (`openingHeading`) rather than the top of its scope. */
  openingHeaded: boolean;
  /** The identifiers the page declares for itself — src/article-registry.ts § `ownIdsOfDocument`. */
  ownIds: WorkId[];
  /**
   * A LaTeXML paper with no title of its own, so its `<title>` (and
   * Readability's `title`) is LaTeXML's guess — src/latexml.ts §
   * `latexmlUntitled`. `runExtract` does not use it.
   */
  untitled: boolean;
  /**
   * A LaTeXML document title as the page draws it, line breaks as spaces —
   * src/latexml.ts § `latexmlTitleText`. `runExtract` may put back the break's
   * space or a prefix Readability demonstrably cut at a colon.
   */
  drawnTitle: ReturnType<typeof latexmlTitleText>;
  refusal: TooLittleTextToRead | ChallengePage | null;
  notes: NoteStats;
  callouts: CalloutStats;
  /** What the named pre-Readability removers deleted, per audit key. */
  removed: ExtractRemovals;
  /**
   * What `protectAuthoredStructure` stamped, per rule — see src/protect.ts.
   *
   * A `…-rolled-back` key in place of the stamped one means the rescue was
   * withdrawn and `article` is the control extraction: `armThatKeptTheProse`.
   */
  kept: KeptStructure;
} {
  const shipped = armThatKeptTheProse(readingArm(html, url, {}), (opts) => readingArm(html, url, opts));
  return {
    article: shipped.article,
    authors: shipped.authors,
    opening: shipped.opening,
    openingHeaded: shipped.openingHeaded,
    ownIds: shipped.ownIds,
    untitled: shipped.untitled,
    drawnTitle: shipped.drawnTitle,
    refusal: refusalFor(shipped),
    notes: shipped.notes,
    callouts: shipped.callouts,
    removed: shipped.removed,
    kept: shipped.kept,
  };
}

/**
 * **One run of stage 2 on the shipping path**, so that the treatment arm and the
 * control arm are the same code with a different `ProtectOptions` rather than
 * two similar paragraphs that can drift apart.
 *
 * `notes`, `callouts` and `removed` come back from both arms and are identical
 * in both: all three run before `protectAuthoredStructure` in `prepareDocument`,
 * on the same input, so whichever arm ships, its copies are the right ones.
 */
function readingArm(
  html: string,
  url: string | null,
  protect: ProtectOptions,
): ProtectedArm & {
  article: ReturnType<Readability["parse"]>;
  /** What the source said it was, before anything rewrote it — `refusalFor`. */
  challenge: ChallengePage | null;
  authors: Author[] | null;
  opening: OpeningRecord[];
  openingHeaded: boolean;
  ownIds: WorkId[];
  untitled: boolean;
  drawnTitle: ReturnType<typeof latexmlTitleText>;
  notes: NoteStats;
  callouts: CalloutStats;
  removed: ExtractRemovals;
} {
  /* **A `VirtualConsole` with nothing attached to it**, and this is not tidiness.
     JSDOM's default forwards its own errors straight to `console`, and one of
     them quotes the page: a malformed `@import` produces `Could not parse CSS
     @import URL "<whatever the page said>" relative to base URL "<the full
     source URL, query string included>"`. That is fetched-page-controlled text
     and a possibly private URL on the server's stderr, going round Pino,
     `errorFields` and redaction alike — none of which can reach a string
     somebody else's library printed.

     Ordinary CSS parse failures print a fixed sentence and are harmless; it is
     the `@import` branch that carries the page's own words. Dropping the lot is
     right anyway: we are here for the article text, and JSDOM's opinion of a
     stylesheet is not something anybody running this needs.

     Found by a GPT Sol review that reproduced it, 2026-08-26 — the fourth round
     of the same class, and the first one where the leak was a dependency's
     rather than ours. See docs/project/logging.md. */
  const dom = sourceDom(html, url);
  /* On the document as it arrived, and it has to be: `prepareDocument` rewrites
     it and Readability deletes every `<script>`. `provenanceArm` has the same
     line in the same place. */
  const challenge = challengeIn(dom.window.document);
  /* A LaTeXML title block's names, before `prepareDocument` rewrites the block
     into one row per author (src/latexml.ts § 6). `metaAuthors` still reads the
     `<meta>` tags where it always has, below, and falls back to these names. */
  const titleBlockNames = latexmlAuthorNames(dom.window.document);
  /* Whether it has a title of its own, before anything rewrites it. A fetched
     page needs source-address proof. An upload has no address and
     may use the weaker markup signal only to distrust its own title; the
     source-gated LaTeXML rewrites above remain source-gated. */
  const untitled = url === null ? untitledLatexmlMarkup(dom.window.document) : latexmlUntitled(dom.window.document);
  /* And the title as drawn, before anything rewrites the title block. */
  const drawnTitle = latexmlTitleText(dom.window.document);
  /* And what the page hides from its reader, before `prepareDocument` un-hides
     collapsed sections for Readability: the opening below leaves it out. */
  markHidden(dom.window.document);
  const { notes, callouts, removed, kept } = prepareDocument(dom.window.document, protect);
  /* Before the parse, and it has to be: Readability mutates the document it is
     given, and `keepClasses: false` takes the `noprint` class off whatever
     survives. See `notForPrintText` (src/protect.ts). */
  const notForPrint = notForPrintText(dom.window.document);
  /* Before the parse for the same reason: every author the page declares,
     which Readability collapses to one — src/meta-authors.ts. */
  const authors = metaAuthors(dom.window.document, titleBlockNames);
  /* And the same again: the page's own DOI or arXiv id, off its meta tags and its address. */
  const ownIds = ownIdsOfDocument(dom.window.document, url);
  /* Before the parse, which drops a short author list as not prose and takes
     the byline element out of the page: src/front-matter-authors.ts. */
  const opening = pageOpening(dom.window.document);
  const openingHeaded = openingHeading(dom.window.document) !== null;
  const article = new Readability(dom.window.document).parse();
  return {
    article,
    challenge,
    authors,
    opening,
    openingHeaded,
    ownIds,
    untitled,
    drawnTitle,
    notes,
    callouts,
    removed,
    kept,
    notForPrint,
    content: () => bodyOf(article?.content ?? ""),
  };
}

/**
 * **What the prose-retention fallback needs of an arm, and nothing else** — so
 * the two entry points can hand it two different kinds of extraction and get
 * the same decision.
 *
 * `content` is a function rather than an `Element` because on the shipping path
 * it costs a JSDOM parse of Readability's output, and the fallback runs on three
 * of the thirty-five corpus fixtures. Eager, it would be a parse on every page
 * for a comparison almost no page makes.
 */
interface ProtectedArm {
  readonly kept: KeptStructure;
  /** Readability's output, as something `proseRetention` can query. */
  readonly content: () => Element;
  /** This arm's document before Readability saw it — see `notForPrintText`. */
  readonly notForPrint: readonly string[];
}

/**
 * **Every rescue is checked before it ships, and a bad one is taken back** —
 * once, for both read paths.
 *
 * § *The fallback* in src/protect.ts is why there is one at all, and
 * `proseRetention` there is the criterion. This is the arithmetic round it: ask
 * `controlOptionsFor` which rules fired, run the same stage again with exactly
 * those switched off, and ship whichever arm still has the author's prose in it.
 *
 * **It is one function on purpose.** `readArticle` had it and
 * `readArticleWithProvenance` did not, which meant the eval harness's *shipped*
 * arm would inspect the extraction we threw away on the first page that rolled
 * back — measured by GPT Sol on 2026-09-08 at 1,323 characters and four prose
 * markers against 3,805 and none. Two copies of a decision is two copies to keep
 * in step; one generic function is the version that cannot diverge, and
 * tests/extract-protect.test.ts § *the two read paths* pins the two outputs
 * byte-for-byte on a page that rolls back.
 *
 * **The `kept` that ships is the treatment's, rewritten** (`keptWithdrawn`), not
 * the control's: the control stamped nothing, so its own `kept` would say
 * nothing happened on a page where a rescue was made and withdrawn.
 */
function armThatKeptTheProse<T extends ProtectedArm>(treatment: T, runControl: (opts: ProtectOptions) => T): T {
  const opts = controlOptionsFor(treatment.kept);
  if (opts === null) return treatment;
  const control = runControl(opts);
  const check = proseRetention(control.content(), treatment.content(), control.notForPrint);
  if (check.retained) return treatment;
  return { ...control, kept: keptWithdrawn(treatment.kept) };
}

/**
 * The body of a fragment of HTML, so `proseRetention` has something to query.
 *
 * `null` for the URL on purpose: this parses Readability's *output*, which has
 * no address of its own and resolves nothing.
 */
function bodyOf(fragment: string): Element {
  return sourceDom(fragment, null).window.document.body;
}

/**
 * **Readability's own threshold, and the number is the library's rather than
 * ours** — `DEFAULT_CHAR_THRESHOLD`, 500, in
 * node_modules/@mozilla/readability/Readability.js.
 *
 * Below it Readability has already concluded the parse *failed*: it pushes the
 * pass onto `_attempts`, drops a flag and tries again, and when it runs out of
 * flags it hands back **the longest of its failures** rather than nothing at
 * all. So a short return is all but always a parse the library disowned rather
 * than a short article — see `visibleLength` for the one hair's-breadth case
 * where that "all but" is doing work — and stage 2 published it anyway. `medium_about.html` became an
 * article titled "Medium" with 185 characters in it, and a published article
 * spends a paying reader's slot where a failed ingest is free
 * (src/store/pg-session.ts § the settlement: `done` charges, every other ending
 * releases).
 *
 * **Do not tune this to the corpus.** Measured across all 36 fixtures on
 * 2026-09-06, the two walls are 130 (`pmc_article`) and 185 (`medium_about`),
 * the shortest genuine page is 1,798 (`arxiv_abs`) and the next 3,901
 * (`mkdocs_tabs`); nothing lies in between. That is 2.7× headroom over the
 * tallest wall and 3.6× under the shortest real page, and it is evidence that
 * the library's number is safe here rather than a reason to move it.
 * `tests/extract-capability-floor.test.ts` pins it from **above** as well as
 * below, because tightening it is the mistake with no symptom.
 *
 * docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md § C1a.
 */
export const MIN_ARTICLE_CHARS = 500;

/**
 * **Readability's own measure, computed the same way** — `_getInnerText(el,
 * true)`, which is `textContent.trim()` with runs of whitespace collapsed
 * (Readability.js § `REGEXPS.normalize`).
 *
 * `article.length` is *not* it: that is the raw `textContent.length`, which on
 * `arxiv_abs` is 2,321 against 1,798 of text a reader would see. Collapsing is
 * what makes the number in the reader's sentence a number about what they were
 * looking at.
 *
 * **The same formula, on a slightly later document — and that is deliberate but
 * it is not an identity.** Readability takes its own reading *before*
 * `_postProcessContent`, which then runs `_simplifyNestedElements` and drops
 * empty `DIV`/`SECTION` wrappers; removing one removes whitespace, so the text
 * we measure can be a character or two shorter than the length the library
 * compared. GPT Sol reproduced the boundary case: a page the library measured at
 * exactly 500 and accepted, returning 499 here and refused. So this is **not**
 * "we never override Readability" to the character — within a hair of the
 * threshold the two can disagree, and we refuse.
 *
 * That is the right way round and worth stating rather than fixing: the question
 * this floor asks is *is there enough text in the article we would publish*, and
 * the post-processed document is that article. Reading the library's private
 * decision instead would mean subclassing it to catch `_attempts`, which is a
 * lot of coupling to move an edge case by one character. GPT Sol, 2026-09-06.
 */
function visibleLength(text: string | null | undefined): number {
  return (text ?? "").trim().replace(/\s{2,}/g, " ").length;
}

/**
 * **The capability floor** — the one shared decision, called by both read paths.
 *
 * It is a helper rather than a line in each of them, and that is the whole
 * design: `readArticle` and `readArticleWithProvenance` are separate entry
 * points that do not call each other, `runExtract` uses the first and the eval
 * harness's `shippedOf` (evals/extraction/arms.mts) uses the second directly.
 * Put this in `runExtract`'s catch or in src/pipeline.ts and production looks
 * correct while `Candidate.refused` stays permanently false and the harness's
 * `notAnArticle` support proves nothing — Sol P1-C03 arriving as a concrete
 * seam, and the exact silent success docs/reusable/silent-success.md describes.
 *
 * **It decides nothing about any piece of content**, which is why it is allowed
 * where the plan forbids shape rules. Every failed shape rule in this project
 * decided what some text *was* — junk, marker, nav — and a wrong decision
 * silently deleted a real article's words. This one says only that the whole
 * page has too little text for this product to build anything from, which is
 * equally true of a genuine 300-character page, and that is the point. Fable,
 * 2026-09-06, quoted in the plan.
 *
 * **Not a bot-wall detector.** That is C1, a registry of conclusive markup
 * (src/challenge-page.ts, since 2026-10-06), and this knows nothing about
 * *what* the page is. `refusalFor` below asks that question first.
 */
export function capabilityFloor(
  article: { textContent: string | null | undefined } | null,
): TooLittleTextToRead | null {
  /* Readability declining outright is `ReadabilityRefused`'s branch, not this
     one: two different findings deserve two different sentences, and a floor
     that also answered for `null` would swallow it. */
  if (!article) return null;
  const chars = visibleLength(article.textContent);
  return chars < MIN_ARTICLE_CHARS ? new TooLittleTextToRead(chars) : null;
}

/**
 * **Stage 2's verdict on one arm, and the order is the decision**: what the
 * page *is* before how much of it there is.
 *
 * One helper for both read paths, for the reason `capabilityFloor`'s header
 * gives — `readArticle` and `readArticleWithProvenance` do not call each other,
 * and a verdict written into one of them leaves production and the eval
 * harness disagreeing with nothing to show it.
 *
 * **The bot check wins** over the floor here and over `ReadabilityRefused` in
 * `runExtract`, because it is the more specific finding and the more useful
 * sentence: *"this is a bot check, open it in your own browser"* tells the
 * reader what to do, where *"too little text"* and *"no article"* send them to
 * look at an address that is fine.
 *
 * The verdict is taken by `readingArm` and `provenanceArm` on the pristine
 * source and carried here, rather than thrown from `sourceDom`, which also
 * parses Readability's output and the provenance copy (GPT Sol, 2026-10-06).
 * Both arms of the prose-retention fallback read the same bytes, so whichever
 * one ships carries the same answer.
 */
function refusalFor(arm: {
  challenge: ChallengePage | null;
  article: { textContent: string | null | undefined } | null;
}): TooLittleTextToRead | ChallengePage | null {
  return arm.challenge ?? capabilityFloor(arm.article);
}

/**
 * The JSDOM every reader of a fetched page gets, and the `VirtualConsole` is the
 * whole reason it is a function.
 *
 * **A `VirtualConsole` with nothing attached to it**, and this is not tidiness.
 * JSDOM's default forwards its own errors straight to `console`, and one of them
 * quotes the page: a malformed `@import` produces `Could not parse CSS @import
 * URL "<whatever the page said>" relative to base URL "<the full source URL,
 * query string included>"`. That is fetched-page-controlled text and a possibly
 * private URL on the server's stderr, going round Pino, `errorFields` and
 * redaction alike — none of which can reach a string somebody else's library
 * printed.
 *
 * Ordinary CSS parse failures print a fixed sentence and are harmless; it is the
 * `@import` branch that carries the page's own words. Dropping the lot is right
 * anyway: we are here for the article text, and JSDOM's opinion of a stylesheet
 * is not something anybody running this needs.
 *
 * Found by a GPT Sol review that reproduced it, 2026-08-26 — the fourth round of
 * the same class, and the first one where the leak was a dependency's rather
 * than ours. See docs/project/logging.md.
 */
function sourceDom(
  html: string,
  /**
   * **The base relative links resolve against, or `null` for a document that
   * has no address** — an uploaded HTML file, since 2026-09-07
   * (docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md).
   *
   * Omitting the option is not the same as passing something harmless. `""`
   * throws `TypeError: Invalid URL` out of the JSDOM constructor, where nothing
   * here would catch it; `"about:blank"` is what JSDOM defaults to anyway, so
   * spelling it here would only look like a decision. What omission buys is
   * that `document.baseURI` stays `about:blank`, `new URL(relative, base)`
   * throws inside Readability's own `toAbsoluteURI`, and the relative URI is
   * left exactly as the document wrote it — which `src/assets.ts` already knows
   * how to refuse. And a document carrying `<base href="…">` resolves properly
   * with no help from us, because that element *is* the document's base URL.
   */
  url: string | null,
): InstanceType<ReturnType<typeof jsdom>["JSDOM"]> {
  const { JSDOM, VirtualConsole } = jsdom();
  return new JSDOM(html, { ...(url === null ? {} : { url }), virtualConsole: new VirtualConsole() });
}

/**
 * **Is this page, as it arrived, a bot check src/challenge-page.ts knows?**
 *
 * For stage 1, which asks only to decide whether a refused paper's free copy is
 * worth looking for (src/pipeline.ts § `fetchByAddress`, plan 261018j S2).
 * Parsed by `sourceDom`, so with the silent `VirtualConsole` its header
 * explains. Stage 2's `readingArm` stays the refusal: this decides nothing
 * about what is stored.
 */
export function isChallengePage(html: string, url: string | null): boolean {
  return challengeIn(sourceDom(html, url).window.document) !== null;
}

/**
 * **Everything done to the DOM before Readability sees it**, in the order that
 * is the contract.
 *
 * One home for the order, for the reason `readArticle`'s own header gives: two
 * eval instruments re-derived it, both left `canonicaliseNotes` out, and both
 * reported 18 stranded footnote markers the real pipeline does not produce.
 * `readArticleWithProvenance` below is a third caller and would have been a
 * third chance to get it wrong.
 */
function prepareDocument(
  doc: Document,
  /** Passed straight to `protectAuthoredStructure` — see `readArticle`'s fallback. */
  protect: ProtectOptions = {},
): {
  notes: NoteStats;
  callouts: CalloutStats;
  removed: ExtractRemovals;
  kept: KeptStructure;
} {
  unhideCollapsedSections(doc);
  /* **The two reserved stamps with no writer on the shipping web path, scrubbed
     where a stranger's markup arrives.** `pdfFigure` is written only by
     `renderHtml` (src/pdf-read.ts), and `sourceRef` only by the extraction eval's
     provenance instrument below. Both are now explicitly allowed through the
     sanitiser with the rest of the `data-spya-*` namespace, so neither may be
     left for that later pass to remove.

     A forged PDF marker already resolves to nothing, because the ref folds in a raw
     PDF's sha256 and a web article has no raw PDF and therefore no `pdfFigures`
     entry to match. This is belt to that braces, and it is one line. */
  scrubReserved(doc, [RESERVED_ATTRS.pdfFigure, RESERVED_ATTRS.sourceRef]);
  /* **The one step that deletes furniture because of what the publisher called
     it** — other things here remove elements, but only this one does it as a
     policy about furniture (the comment-thread pass below deletes by name too,
     but a thread, not furniture). What it may delete, and why that licence is narrow
     enough to spend, is on `removePlatformFurniture` (src/furniture.ts). It is
     not a general furniture pass: everything else stays and waits for stage D.

     First of the three recognisers **by preference, not by need.** The
     preference is that `a.headerlink` is a fragment anchor and `ul.reflinks`
     holds them, which is the shape `canonicaliseNotes` starts from, and there
     is nothing to be gained by offering it PLOS's button strips and Sphinx's
     pilcrows to consider — though the note pass goes on to require a marker
     label and a publisher topology neither would satisfy (src/notes.ts). So
     this was measured rather than argued: run last instead of first, over every
     fixture this pass touches plus `acx_footnotes` and `tufte` — the two the
     note pass does most to — the removal counts, the `NoteStats`, the
     `CalloutStats` and Readability's output HTML are byte-identical on all
     nine. 2026-09-06. */
  const furniture = removePlatformFurniture(doc);
  /* **A blog's comment thread, taken out whole by the name its engine gave the
     container** — so Readability's short-page retry cannot hand the thread back
     as the article. Beside the furniture pass and before protect, so both arms
     of protect's fallback see the same page and `removed` is the same in both.
     src/reader-comments.ts. */
  const comments = removeReaderComments(doc);
  const removed = comments > 0 ? { ...furniture, [READER_COMMENTS_KEY]: comments } : furniture;
  /* Before Readability, and it has to be: Readability's `keepClasses: false`
     takes the identifying classes off, and the sanitiser downstream of it
     deletes the `<label>`/`<input>` that Tufte's sidenotes are made of. By stage
     3 there is nothing left to recognise a note by. See src/notes.ts. */
  const notes = canonicaliseNotes(doc);
  /* After the notes, and for the same reason as the notes: Readability deletes
     the element a callout is named on. Order between the two does not matter —
     neither reads what the other writes — so it is simply the later arrival.
     src/callouts.ts. */
  const callouts = canonicaliseCallouts(doc);
  /* **A LaTeXML page's own shapes (arXiv's HTML, ar5iv), put into the shapes
     the rest of the pipeline already reads**: an aligned equation into one
     display formula, an SVG plot in an `<object>` into an `<img>`, a code
     listing into a `<pre>`, a boxed passage out of the SVG that frames it, and
     a title block into one row per author.
     Before `canonicaliseMaths`, and it has to be: the aligned equation is
     joined from each cell's TeX annotation, which that pass consumes, and a
     boxed passage's formulas sit under an `<svg>`, where that pass converts
     nothing. After the note and callout recognisers, so neither sees a changed
     input. src/latexml.ts. */
  prepareLatexml(doc);
  /* **A formula's TeX source, kept as the one form maths is stored in** — before
     the sanitiser deletes the `<annotation>` holding it. After the recognisers
     that read the publisher's own shapes, so none of them sees a changed input
     (K6 of the 3b plan review), and before `protectAuthoredStructure`, which
     stays last for its own reason, below. src/maths-import.ts. */
  canonicaliseMaths(doc);
  /* **Last, and the order is the safe one rather than an arbitrary one.**
     Nothing else in this pass reads a class token we invent — the note and
     callout recognisers know their shapes by the publisher's own class names —
     so running last means our token cannot influence either of them, and that
     is true by construction rather than by measurement. Readability is the only
     reader of what this writes, and it has not run yet. src/protect.ts. */
  const kept = protectAuthoredStructure(doc, protect);
  return { notes, callouts, removed, kept };
}

/**
 * **Give every element in the source a number, so the output can say where it
 * came from.**
 *
 * A counter in document order, not a hash: this identity lives for one eval run
 * and is never written down, so the cheapest thing that is unique is the right
 * one. Returns how many elements were stamped, which is the denominator every
 * coverage figure is over.
 *
 * The scrub first is the namespace's standing obligation
 * ([src/reserved.ts](reserved.ts)): the attribute is ours and therefore
 * forgeable, and a page that got one past us would have its own markup dressed
 * as something we vouched for — here, as the source of a passage it is not.
 *
 * **"Every element" means every element `querySelectorAll("*")` reaches**, which
 * is not quite everything: a `<template>`'s content lives in its own document
 * fragment and is not stamped, so an output node that came from one would
 * resolve to its nearest stamped ancestor rather than to itself. Left that way
 * deliberately — Readability does not lift `<template>` content into an article,
 * so the case is theoretical — but the claim is narrowed here rather than left
 * for somebody to discover. GPT Sol, 2026-09-05.
 *
 * Exported for the tests and for `evals/extraction/provenance.mts`, which scores
 * the coverage. **Nothing on a request path may call this**, and nothing does.
 */
export function stampSourceIds(doc: Document): number {
  scrubReserved(doc, [RESERVED_ATTRS.sourceRef]);
  let n = 0;
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    n += 1;
    el.setAttribute(RESERVED_ATTRS.sourceRef, `s${n}`);
  }
  return n;
}

/**
 * **The provenance arm's output with the stamps taken back off — and nothing
 * else touched.**
 *
 * This exists so that "the instrument did not change what it measured" is a
 * *byte* comparison against `readArticle`'s own string, rather than a comparison
 * of whitespace-normalised text. The first version of that check compared
 * `textContent` with `/\s+/gu → " "` applied, and GPT Sol reproduced the hole on
 * 2026-09-05 by prepending `"\n\n"` to the extracted HTML: the mutation changed
 * the output and **the check still said yes**. Anything an instrument can do to
 * a document that whitespace-normalised text cannot see — a wrapper element, an
 * attribute, a reordering — is exactly the class of damage that matters here,
 * because Readability weights `class` and `id` when it scores a node.
 *
 * `innerHTML` on a clone rather than `scrubReserved` on the live node, because
 * the caller goes on to count stamps afterwards. It removes **only** the one
 * attribute; if the stamped run differs from the stock run in any other way, the
 * strings differ and the row is invalid.
 */
export function withoutSourceRefs(content: Element): string {
  const clone = content.cloneNode(true) as Element;
  clone.removeAttribute(RESERVED_ATTRS.sourceRef);
  for (const el of Array.from(clone.querySelectorAll(`[${RESERVED_ATTRS.sourceRef}]`))) {
    el.removeAttribute(RESERVED_ATTRS.sourceRef);
  }
  return clone.innerHTML;
}

/**
 * Where an output node came from, and **how confident that answer is**.
 *
 * Readability generates wrapper nodes of its own — a `<div>` or a `<p>` it built
 * rather than kept — and on markup degenerate enough it rebuilds the document
 * wholesale. 260827ab measured the direct hit rate at 92.7%, 99.8% and **40.9%**
 * on three pages, the last being Paul Graham's, and treating that 40.9% as
 * "the rest is unknowable" would throw away most of a page that is largely
 * recoverable. So there is a fallback, and it is reported rather than hidden:
 *
 * | `how` | meaning |
 * |---|---|
 * | `direct` | the node itself carries the stamp — the only answer that is certain |
 * | `descendant` | a generated wrapper; the id is its first stamped descendant's, in document order |
 * | `ancestor` | a generated leaf; the id is its nearest stamped ancestor's |
 * | `none` | nothing near it is stamped — say so rather than guess |
 *
 * **Descendant beats ancestor**, because it is the narrower claim: a wrapper
 * round one paragraph is that paragraph, whereas an ancestor may be the whole
 * article. A caller that needs certainty filters on `how === "direct"`; a caller
 * measuring recall takes all three and reports the split, which is what the
 * instrument does.
 */
export function sourceRefOf(node: Element): {
  id: string | null;
  how: "direct" | "descendant" | "ancestor" | "none";
} {
  const own = node.getAttribute(RESERVED_ATTRS.sourceRef);
  if (own) return { id: own, how: "direct" };
  const below = node.querySelector(`[${RESERVED_ATTRS.sourceRef}]`);
  if (below) return { id: below.getAttribute(RESERVED_ATTRS.sourceRef), how: "descendant" };
  const above = node.parentElement?.closest(`[${RESERVED_ATTRS.sourceRef}]`);
  if (above) return { id: above.getAttribute(RESERVED_ATTRS.sourceRef), how: "ancestor" };
  return { id: null, how: "none" };
}

/**
 * **Stage 2 again, with the provenance kept** — for instruments, never for the
 * pipeline.
 *
 * Readability's `serializer` option decides what `article.content` is; the
 * default takes `innerHTML`, and the identity function hands back the **DOM
 * node** instead, stamps and all. That turns "what did extraction drop?" from a
 * text-matching problem — 260827ab's list of eight ways that went wrong, of
 * which the worst is that a hidden *duplicate* of a paragraph is invisible to a
 * substring test — into a set difference over ids.
 *
 * **Two documents, because Readability mutates the one it is given.** The
 * stamped source has to survive the parse for an output id to be looked up in
 * it, so the source is stamped, serialised, and re-parsed for Readability. The
 * cost is one extra parse per page in an eval, and the alternative — mapping ids
 * through a document Readability has already pruned — answers a different
 * question.
 *
 * `runExtract` does not call this and must not: the shipping path stays
 * byte-for-byte what it was, which `tests/extract-provenance.test.ts` checks by
 * comparing the two side by side rather than by asserting it.
 */
export function readArticleWithProvenance(
  html: string,
  url: string,
): {
  article: ReturnType<Readability<Element>["parse"]>;
  /**
   * **The capability floor's verdict, the same one the shipping path gets** —
   * `capabilityFloor` is called here as well as in `readArticle` because the two
   * are separate entry points and neither calls the other. Without this the
   * harness's `Candidate.refused` is permanently false on the very pages the
   * floor exists for, and `notAnArticle` scores a refusal that never happens.
   *
   * And the bot-check verdict, which wins over it — `refusalFor`.
   */
  refusal: TooLittleTextToRead | ChallengePage | null;
  notes: NoteStats;
  callouts: CalloutStats;
  /**
   * What the named pre-Readability removers deleted, per audit key.
   *
   * **Removed before the source is stamped**, which is the fact the gates rest
   * on: `prepareDocument` runs first, so a deleted control is absent from the
   * stamped source *and* from Readability's output, and the order and
   * provenance gates never see a hole. Confirmed by running the corpus rather
   * than assumed — C4a, 2026-09-06.
   */
  removed: ExtractRemovals;
  /**
   * What `protectAuthoredStructure` stamped, per rule (src/protect.ts).
   *
   * **Stamped before the source is stamped with ids**, the same ordering fact
   * `removed` rests on — and here it is doubly harmless, because the pass adds
   * a class token and moves nothing: the stamped source and Readability's
   * output are the same nodes in the same order either way.
   *
   * **The prose-retention fallback runs here too**, through the same
   * `armThatKeptTheProse` the shipping path uses. It used not to, on the
   * argument that no corpus fixture rolls back — and GPT Sol measured the
   * divergence on the fallback's own committed construction on 2026-09-08:
   * `readArticle` returned four prose markers and
   * `a-table-called-header-rolled-back`, this returned none and
   * `a-table-called-header`, 1,323 serialised characters against 3,805. An
   * instrument whose *shipped* arm inspects the extraction we discarded is
   * measuring a pipeline that does not exist, which is the failure
   * `readArticle`'s own header already records once. So the cost — a second
   * provenance-stamped run of the two-document dance below, on the pages a rule
   * stamped and no others — is paid.
   */
  kept: KeptStructure;
  /** The stamped source, as Readability was handed it and before it pruned anything. */
  source: Document;
  /**
   * **The bytes of that source at the moment Readability was handed its copy** —
   * so that "the source survived the parse" is a comparison rather than an
   * assertion about a document nothing touched.
   *
   * The claim the whole mapping rests on is that `source` is still the *source*:
   * every id an output node resolves to is looked up in it, and a document
   * Readability had pruned would answer `none` for exactly the passages an
   * instrument exists to find. Checking that by counting `source`'s own elements
   * against `stampedElements` is nearly true by construction — GPT Sol's point,
   * 2026-09-05 — because both are read off the same object. This is the other
   * half of the pair, taken before the parse, and it is what actually goes red
   * when somebody "simplifies" the two documents below into one.
   */
  sourceHtml: string;
  /** How many source elements carry a stamp — the denominator for coverage. */
  stampedElements: number;
} {
  const shipped = armThatKeptTheProse(provenanceArm(html, url, {}), (opts) => provenanceArm(html, url, opts));
  return {
    article: shipped.article,
    refusal: refusalFor(shipped),
    notes: shipped.notes,
    callouts: shipped.callouts,
    removed: shipped.removed,
    kept: shipped.kept,
    source: shipped.source,
    sourceHtml: shipped.sourceHtml,
    stampedElements: shipped.stampedElements,
  };
}

/**
 * **One provenance-stamped run of stage 2**, the instrument's counterpart to
 * `readingArm` — and, like it, one body of code that both arms of the fallback
 * go through.
 *
 * `source`, `sourceHtml` and `stampedElements` belong to *this* arm, so a page
 * that rolls back hands the caller the control arm's stamped source. That is the
 * point rather than a detail: every output id is looked up in `source`, and the
 * source of an extraction we discarded would answer for a document nobody read.
 */
function provenanceArm(
  html: string,
  url: string,
  protect: ProtectOptions,
): ProtectedArm & {
  article: ReturnType<Readability<Element>["parse"]>;
  /** The same verdict `readingArm` takes, at the same point — `refusalFor`. */
  challenge: ChallengePage | null;
  notes: NoteStats;
  callouts: CalloutStats;
  removed: ExtractRemovals;
  source: Document;
  sourceHtml: string;
  stampedElements: number;
} {
  const prepared = sourceDom(html, url);
  /* Before the document is prepared, as on the shipping path. */
  const challenge = challengeIn(prepared.window.document);
  const { notes, callouts, removed, kept } = prepareDocument(prepared.window.document, protect);
  /* Before Readability, for the reason `readingArm` gives. `stampSourceIds`
     below only adds an attribute, so either side of it would do; before it is
     where the same line sits on the other path. */
  const notForPrint = notForPrintText(prepared.window.document);
  const stampedElements = stampSourceIds(prepared.window.document);
  const sourceHtml = prepared.window.document.documentElement.outerHTML;
  const forReadability = sourceDom(prepared.serialize(), url);
  const article = new Readability<Element>(forReadability.window.document, {
    serializer: (el) => el as Element,
  }).parse();
  return {
    article,
    challenge,
    notes,
    callouts,
    removed,
    kept,
    source: prepared.window.document,
    sourceHtml,
    stampedElements,
    notForPrint,
    /* Already a DOM node — the serializer above is the identity — so unlike
       `readingArm` there is nothing to parse. `bodyOf("")` stands in for the
       page Readability declined, which has no prose to lose either way. */
    content: () => article?.content ?? bodyOf(""),
  };
}

/**
 * **There is too little text on this page to build anything from** — the
 * capability floor's refusal, beside `ReadabilityRefused` in src/extract.ts.
 *
 * `ReadabilityRefused` is *the library found no article at all*. This is *the
 * library found something, disowned it, and handed back its longest failure
 * anyway* — see `MIN_ARTICLE_CHARS`. Two branches, two sentences, two codes,
 * because a code names a branch and whoever is helping a reader should be able
 * to tell them apart from four characters.
 *
 * **Its own type rather than a reworded message**, and `ReadabilityRefused`'s
 * docstring in src/extract.ts is why: the pipeline classified that one by matching
 * `/^Readability could not parse this page\./` against `err.message` until
 * 2026-09-03, which rots the day somebody rewords the sentence and — being a
 * prefix — could never prove that the whole of a matching message came from
 * here. `instanceof` says it in the type system and says it exactly.
 *
 * `chars` is on the error rather than only in its message for the same reason:
 * src/pipeline.ts puts the count in the reader's sentence, and parsing a number
 * back out of prose is the shape this file has already paid for once.
 *
 * The message is for the log. What the reader is shown is
 * `documentHadTooLittleText` in src/messages.ts, which says none of this.
 */
export class TooLittleTextToRead extends Error {
  /** Readability's own measure of the page — see `visibleLength`. */
  readonly chars: number;
  constructor(chars: number) {
    super(
      `Readability returned ${chars} characters, below its own ${MIN_ARTICLE_CHARS}-character ` +
        "threshold, so it had already concluded this parse failed.",
    );
    this.name = "TooLittleTextToRead";
    this.chars = chars;
  }
}

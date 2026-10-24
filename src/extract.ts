/**
 * Stage 2 — Readability over a page somebody else fetched.
 *
 * Produces two artefacts and **writes neither**: the standalone page that stage
 * 3 reads and stamps ids into, and the metadata, which is what everything
 * downstream knows the article *by* — its title, who wrote it, where it came
 * from and when. Both are returned; the store puts them where that store keeps
 * things (`output/<slug>.html` and `data/<slug>/meta.json` on a filesystem,
 * columns on `article_revisions` in Postgres). See
 * docs/project/content-extraction.md and docs/project/library.md.
 *
 * Stage 1 is src/fetch.ts and is somebody else's problem, deliberately: getting
 * bytes off the open web safely is a subject of its own (docs/project/fetching.md).
 * The CLI below calls it; the queue calls it as a separate step and keeps what
 * it got, so a bad extraction can be retried without asking the publisher again.
 *
 * **Two callers, one code path.** `npm run extract -- <url>` runs `main()`
 * below; the ingest queue (src/pipeline.ts) calls `runExtract` directly, in the
 * server process. They must not drift, so the CLI is a thin
 * argv wrapper around the same two functions and nothing else.
 *
 * Nothing here is top-level `await`, deliberately — for the reason spelled out
 * at `main()` in src/blocks.ts. With one, this module becomes an async module,
 * and importing it would also *run* it.
 */
import { escapeHtml, plainTitle } from "./html.js";
import { ruleTitleTidier, type TitleTidier } from "./title-tidy.js";
import type { CalloutStats } from "./callouts.js";
import { ChallengePage } from "./challenge-page.js";
import { latexmlTitleText } from "./latexml.js";
import { loadMathsRenderer } from "./maths-server.js";
import type { NoteStats } from "./notes.js";
import type { KeptStructure } from "./protect.js";
import type { WorkId } from "./bibliographic.js";
import { authorsForByline, chooseByline } from "./meta-authors.js";
import { sanitizeHtml } from "./sanitize.js";
import type { FrontMatterAuthorsReader } from "./front-matter-authors.js";
import type { OpeningTitleReader } from "./opening-title.js";
import { type PageSource, readParts } from "./read-parts.js";
import type { ExtractRemovals } from "./read-article.js";
import { addressDay, datelineDay } from "./page-date.js";
import type { Meta } from "./types.js";

/* **The read itself is src/read-article.ts since 2026-10-24** — `readArticle`,
   `readArticleWithProvenance`, the capability floor and the DOM prep — a leaf
   both this file and src/read-parts.ts import, so that the two do not import
   each other. Re-exported here so every importer of stage 2 still finds it in
   one place. */
export {
  type ExtractRemovals,
  capabilityFloor,
  isChallengePage,
  MIN_ARTICLE_CHARS,
  readArticle,
  readArticleWithProvenance,
  sourceRefOf,
  stampSourceIds,
  TooLittleTextToRead,
  unhideCollapsedSections,
  withoutSourceRefs,
} from "./read-article.js";

/**
 * Text going into markup, made text again.
 *
 * Readability hands back `title`, `byline`, `siteName` and `lang` as strings it
 * took the *textContent* of, and that reads as safe. It is not: textContent
 * decodes entities, so a page whose `<title>` says
 * `Real&lt;/title&gt;&lt;img src=x onerror=…&gt;` gives us back a string with a
 * real `</title>` and a real `<img>` in it, and writing that into a template
 * puts them back in the document. Verified against real Readability output in
 * tests/extract-sanitize.test.ts. (The byline and the site name were written
 * into the page too until 2026-10-07, and the byline was a working
 * `<img onerror>`; `debugPage` below says why they are no longer written.)
 *
 * All five characters, not the three that "look like markup". `"` is what holds
 * `lang` inside its attribute, and the source page's `lang` is the only one of
 * these that lands in an attribute rather than in text.
 *
 * **The function itself moved to [`src/html.ts`](html.ts)** on 2026-08-29,
 * unchanged, when stage 2 of the public-link work needed a third caller: a
 * serverless function composing a `<head>` before the bundle loads. This copy
 * and the one still in `pdf-read.ts` had already drifted apart by one character
 * class, which is the argument for a shared module rather than a fourth copy.
 */

/**
 * The standalone, styled debug page. Not what the reading view renders — and
 * that is exactly why it was the last unsanitised thing in the pipeline.
 *
 * Stage 3 sanitises before it mints ids, and it rewrites this same file, so for
 * a while the argument was that the window is only between the two commands.
 * The window is where the file is *for*: `npm run extract -- <url>` prints the
 * path and the next thing anybody does is open it. Readability is not a
 * sanitiser and says so; `<img onerror>` and `<span onmouseover>` come through
 * it intact, and an `onerror` on a bogus src fires on load with no click.
 *
 * Sanitising the **content string** rather than the assembled document, for two
 * reasons. It is the canonical DOMPurify call and the one that gets the
 * scrutiny (src/sanitize.ts says why the string path won here). And the
 * template's own `<style>` is in the `<head>`, which the policy forbids in
 * source markup — running the whole page through would leave a debug page that
 * still opens and has lost its looks, which is how that mistake would survive.
 *
 * The result is concatenated into `<body>`, an ordinary element context. Never
 * move it inside `<xmp>`, `<noscript>` or any other raw-text element: re-parsing
 * sanitised output in one of those is CVE-2026-65914's shape, and
 * docs/project/security.md has the rule.
 *
 * Stage 3 is unaffected. It sanitises whatever it is handed, so a body that
 * arrives clean is a no-op for it and blocks.json comes out identical — pinned
 * in tests/extract-sanitize.test.ts rather than assumed, because the two stages
 * share this file and stage 3 writes block ids back into it.
 *
 * **The body is the article and nothing else, since 2026-10-07.** Until then it
 * opened with a header of ours: `<h1>{title}</h1>` and a `.meta` line of byline,
 * site name and `~N min read`. Stage 3 splits this body into blocks, so the
 * header became blocks 0 and 1 of every web article, and the reading view,
 * whose masthead already shows all of it from `meta`, said the title twice.
 * The title is still in `<head><title>`, which stage 3 does not read. Do not
 * put chrome back in the body: whatever is in it is the author's words to every
 * stage after this one. **New extractions only.** An article extracted before
 * that day keeps its stored page and its two header blocks until it is
 * extracted again.
 * docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md
 * (reader report spya-t6cdve).
 */
type Maybe = string | null | undefined;
function debugPage(article: { title: Maybe; lang: Maybe; content: Maybe }): string {
  const text = (s: Maybe) => escapeHtml(s ?? "");
  return `<!doctype html>
<html lang="${text(article.lang) || "en"}">
<head>
<meta charset="utf-8">
<title>${text(article.title) || "Untitled"}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body {
    max-width: 700px;
    margin: 3rem auto;
    padding: 0 1.5rem;
    font-family: Georgia, "Times New Roman", serif;
    line-height: 1.6;
    color: #222;
    background: #fdfdfb;
  }
  img { max-width: 100%; height: auto; }
  figure { margin: 1.5rem 0; }
  figcaption { font-size: 0.85rem; color: #777; font-family: -apple-system, sans-serif; }
  a { color: #0645ad; }
  pre { overflow-x: auto; background: #f4f4f4; padding: 1rem; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1rem; color: #555; }
</style>
</head>
<body>
${sanitizeHtml(article.content ?? "")}
</body>
</html>`;
}

/* **`defaultOutFile` and `slugForOutFile` went on 2026-09-05**, with the
   command line that was their only caller. They turned a URL into
   `output/<slug>.html` and an output filename back into a slug, and the reason
   the second read the *filename* rather than the URL was that an explicit
   `outFile` on a command line is the only place the two can differ. There is no
   such filename any more: `runExtract` takes its slug directly, and the article
   is addressed by slug everywhere after it. */

export interface ExtractResult {
  slug: string;
  meta: Meta;
  /**
   * The DOI or arXiv id the page declares for itself, for the step to ask a
   * registry about (src/article-registry.ts). Beside `meta` and not in it: a
   * candidate is not a fact until the registry's title agrees.
   */
  ownIds: WorkId[];
  /**
   * The day in the page's address, when its markup and dateline gave none.
   * Beside `meta` and not in it, for the same reason as `ownIds`: it is the
   * weakest evidence there is, so the step applies it only after the registry
   * has left the article with no day and no year — src/page-date.ts §
   * `withAddressDay`.
   */
  addressDay?: string;
  /**
   * **The whole standalone page, and it *is* the `extractedHtml` artefact.**
   *
   * Not Readability's `article.content` — the page `debugPage` builds around it,
   * `<!doctype>`, `<head>`, styles and all. That is what this stage has always
   * left at `output/<slug>.html`, and stage 3 reads that file and rewrites it
   * with the block ids stamped in (src/blocks.ts). So the artefact and the
   * thing a person opens to see what extraction did are one document, which is
   * a slightly surprising fact worth stating rather than tidying: making the
   * artefact the bare body would change every block stage 3 cuts, on every
   * article, in the same commit that moved where it is stored.
   */
  extractedHtml: string;
  /** Readability's own character count, for the log line. */
  length: number | null;
  excerpt: string | null;
  /** What the footnote canonicalisation did — see src/notes.ts. */
  notes: NoteStats;
  /** What the callout pass found — see src/callouts.ts. */
  callouts: CalloutStats;
  /**
   * **What the named pre-Readability removers deleted, per audit key** —
   * platform chrome by selector (src/furniture.ts), and a reader-comment thread
   * by the rule name in src/reader-comments.ts.
   *
   * It rides here rather than on `Meta` for a reason worth stating: `Meta` is
   * persisted as *columns* on `article_revisions` (src/store/pg.ts §
   * `metaFrom`, src/store/artifacts-pg.ts § `metaColumns`), so putting it there
   * is a migration, two mapping functions and the export round-trip — for a
   * field whose only reader, stage D's audit line, does not exist yet. Stage D
   * is where that trade stops being premature.
   */
  removed: ExtractRemovals;
  /**
   * **What stage 2 told Readability to keep, per rule** — the other half of the
   * audit line, and the mirror of `removed` above (src/protect.ts).
   *
   * It rides here for exactly the reason `removed` does, and the same trade is
   * still premature. A rule that stamped nothing is absent rather than zero,
   * which `KeptStructure` explains.
   */
  kept: KeptStructure;
}

/**
 * **A metadata string with the page's layout taken back out of it.**
 *
 * Readability's `_checkByline` returns `node.textContent.trim()` — an outer trim
 * and nothing else — so a byline the publisher set over several source lines
 * arrives with those lines still in it. Real examples, all from pages we hold:
 *
 * - `"By \n \n Natalie Wolchover\n \n \nDecember 17, 2024"` — Quanta
 * - `"Affiliation: Google Brain\n\nEmail: noam@google.com"` — the ar5iv fixture
 * - `"Eric Steven Raymond\n    Thyrsus Enterprises\n    <esr@thyrsus.com>"` —
 *   the hacker-howto fixture
 *
 * `meta.byline` is rendered on the library card and in the masthead, where a
 * newline is either a line break nobody asked for or one silently swallowed by
 * the layout. Collapsing is the same thing `extractText` does to prose in stage
 * 3 and for the same reason: **a newline in the markup is not a newline in the
 * sentence.** Except where it is not even a space — `CJK_SEGMENT_BREAK` below.
 *
 * **It inserts nothing**, and that is a decision. The trawl reported
 * `"Visual Journalism teamBBC News"` as "byline and site name concatenated with
 * no separator"; it is not. `byline` and `siteName` are separate fields, stored
 * separately and rendered with a ` · ` between them, and BBC hands us
 * `siteName: "BBC News"` on its own. The run-together string is **one**
 * Readability byline, built from two adjacent spans in BBC's own contributor
 * markup — a contributor's name and their role, set with no whitespace between
 * them, which reproduces on live pages today as
 * `"James GallagherHealth and science correspondent"`. Inserting a space at a
 * case change would rewrite `McNulty`, `DeSantis` and every name of that shape.
 * If it is worth fixing it is a markup recogniser in stage 2, not a string rule
 * here — *rule on markup, model on meaning*, and it is stage C's problem.
 *
 * **Applied where the artefact is built, not inside `readArticle`.** An eval
 * instrument asking `readArticle` what Readability said should get what
 * Readability said; the pipeline storing a `Meta` should get the tidy form. One
 * function, exported, so a second copy cannot drift from this one.
 *
 * **For a single-line metadata field and nothing else.** It flattens every line
 * break it finds, which is right for a byline on a library card and wrong for
 * anything a reader is meant to read — prose goes through `extractText` in
 * src/blocks.ts, which has a `<pre>` branch precisely because flattening is not
 * always harmless. Do not reach for this one because the name is generic.
 */
export function tidyMetaText(raw: Maybe): string | undefined {
  const tidy = (raw ?? "").replace(CJK_SEGMENT_BREAK, "").replace(/\s+/gu, " ").trim();
  return tidy || undefined;
}

/**
 * **A line break between two CJK characters renders as nothing, so it collapses
 * to nothing.**
 *
 * `/\s+/gu → " "` is the right rule for a script that separates its words with
 * spaces and the wrong one for a script that does not: a Japanese publisher who
 * sets a contributor's name and their role on two source lines hands Readability
 * a newline between two ideographs, and flattening it yields `"田中太郎 記者"` —
 * a word gap the page never showed anybody, in a name. This is the CSS Text 3
 * segment-break transformation, which is what a browser does with the same
 * bytes, so following it is matching the page rather than inventing a rule.
 *
 * **Only a *break*, and only between two CJK characters.** A space the publisher
 * actually typed stays a space; a break with Latin on either side keeps its
 * space, because there the gap is what the reader saw. Han, Hiragana, Katakana
 * and Hangul, plus CJK punctuation and the fullwidth forms — the scripts whose
 * line breaking works this way, not everything non-Latin. RTL text and bidi
 * controls are deliberately untouched: Arabic and Hebrew space their words.
 *
 * GPT Sol, 2026-09-05, who found the inserted space and checked the RTL half.
 */
const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\u3000-\\u303F\\uFF00-\\uFF60";
const CJK_SEGMENT_BREAK = new RegExp(`(?<=[${CJK}])[^\\S\\n]*\\n\\s*(?=[${CJK}])`, "gu");

/**
 * An ISO-8601 date, optionally with a time, optionally with a zone.
 *
 * Deliberately narrow. Readability's `publishedTime` comes off
 * `<meta property="article:published_time">` or JSON-LD `datePublished`, both of
 * which are ISO by convention — but it is whatever the page said, and a page can
 * say `"Last updated Tuesday"`.
 */
const ISO_DATE =
  /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Readability's `publishedTime`, kept if it is a date and dropped if it is prose.
 *
 * **Kept in the publisher's own zone rather than converted to UTC**, which is
 * the one decision in this function. `new Date(s).toISOString()` looks like the
 * obvious normalisation and it moves the calendar day: a piece published at 8pm
 * on 31 December in New York becomes 1 January, and the calendar day is exactly
 * what this field is for — Timeline reads the year off the front of it to date
 * every "on July 7" the article never gives a year for
 * (docs/plans/260831i-timeline-mode.md § The reference frame). A day that shifts by
 * zone is a year that shifts at the boundary. The only normalising done here is
 * of spelling, never of instant: a space separator becomes `T`, and `+0000`
 * becomes `+00:00`.
 *
 * **An unrecognised string is dropped, not guessed at.** `Date.parse` will
 * happily take `"July 7, 2026"` and interpret it in the *server's* local zone,
 * so a date we cannot read as ISO is worse than no date: the no-frame path is
 * already the common one and is honest, where a silently wrong frame would
 * misdate every year-less event in the piece and look like a fact.
 *
 * Whatever comes back is the publisher's claim, not a verified one.
 */
export function publicationDate(raw: Maybe): string | undefined {
  const m = ISO_DATE.exec((raw ?? "").trim());
  if (!m) return undefined;
  const [, day, time, zone] = m;
  /* A well-formed shape is not a real date — `2026-02-31` matches the pattern.
     Round-tripping the day through Date is the cheap check, and it is done on
     the day alone (which parses as UTC, per the ECMAScript date-only rule) so
     that no zone arithmetic can move it. */
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(`${day}T`)) {
    return undefined;
  }
  if (!time) return day;
  /* `+0000` and `+00:00` are the same offset in two of ISO 8601's spellings,
     and two spellings of one fact is a fingerprint that changes when nothing
     did. The extended form is what everything else here writes. */
  const offset =
    zone && zone !== "Z" && !zone.includes(":")
      ? `${zone.slice(0, 3)}:${zone.slice(3)}`
      : zone;
  return `${day}T${time}${offset ?? ""}`;
}

/**
 * **Readability looked at the page and found no article in it.**
 *
 * A type rather than a sentence, since 2026-09-03. The pipeline has to classify
 * this — it is `blocked`, because Retry never re-runs the step that fetched the
 * bytes, so the second attempt hands Readability byte-for-byte the page it has
 * already refused — and it recognised it by matching
 * `/^Readability could not parse this page\./` against `err.message`. That
 * worked, and it was the wrong shape twice over: a prose match rots the day
 * somebody rewords the sentence, and, being a **prefix**, it could not prove
 * that the whole of a matching message came from here. The pipeline then wanted
 * to forward that message to Sentry as ours, and could not honestly say so.
 * docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md § Readability
 * is the exception.
 *
 * The message stays what it was, because the log is still where it is read and
 * tests/job-failure.test.ts still asserts a diagnostic that names the library.
 * What the reader is shown is `documentHasNoArticle` in src/messages.ts, which
 * says none of this — and which is a *pair* of sentences, because a reader who
 * uploaded the file has no address to be sent back to.
 */
/**
 * Re-exported so the three refusals stage 2 can throw are importable from the
 * stage that throws them. It is defined beside its registry, in
 * src/challenge-page.ts.
 */
export { ChallengePage };

export class ReadabilityRefused extends Error {
  constructor() {
    super("Readability could not parse this page.");
    this.name = "ReadabilityRefused";
  }
}

/**
 * Stage 2 over already-fetched HTML — **and it writes nothing.**
 *
 * It took `outFile` and `dataDir` until 2026-08-31 and wrote the page and
 * `meta.json` itself. Both artefacts are returned now and the store decides
 * where they land — `output/<slug>.html` plus `data/<slug>/meta.json` on the
 * filesystem, columns on `article_revisions` in Postgres. The two write
 * destinations were the last thing in this stage that assumed a disk.
 * docs/plans/260831b-finish-the-database-move.md § Stage 2c.
 *
 * `slug` is passed in rather than derived, which is the one call-site change
 * worth noticing. It used to come from the output filename via
 * `slugForOutFile`, on the reasoning that the basename is what stages 3 and 4
 * would name this article — true, and now moot: there is no filename here to
 * derive it from, and every caller already knows the slug. The command line
 * that could pass an explicit filename is gone too.
 */
/** The cheap test before loading temml: a `<math>` or a MathJax script anywhere in the raw page. */
const MIGHT_HOLD_MATHS = /<math[\s>]|math\/tex/iu;

/**
 * **A LaTeXML paper's title as its heading draws it, line breaks as spaces**,
 * over Readability's — only when the page's `<title>` agreed with the heading
 * (src/latexml.ts § `latexmlTitleText`) and Readability's title is either that
 * `<title>` or its exact suffix after `: `. So what changes is a space
 * LaTeXML's `<title>` deleted (`Evaluating AGENTS.md:Are …`, report
 * spya-whpceg) or the prefix Readability cut off as a site's name (`Tree of
 * Thoughts:`). A title Readability took from metadata is left as it was,
 * unless it is exactly that suffix: then the page states the whole title
 * twice, and that is shelved. Kept free of Readability's list of metadata
 * keys on purpose (plan 261024b § After the code review).
 * docs/plans/261024b-an-arxiv-title-keeps-the-space-its-line-break-stood-for.md.
 */
function asDrawn(title: string | null | undefined, drawn: ReturnType<typeof latexmlTitleText>): string | null | undefined {
  if (!drawn || typeof title !== "string") return title;
  const readabilityTitle = title.replace(/\s+/g, " ").trim();
  return readabilityTitle === drawn.head ||
    (readabilityTitle !== "" && drawn.head.endsWith(`: ${readabilityTitle}`))
    ? drawn.drawn
    : title;
}

/**
 * An untitled LaTeXML paper's title when nothing could read one off its
 * opening: `arXiv:2308.08708` from the page's own ids, or `null` for the slug.
 * Plan 261017a.
 */
function untitledPlaceholder(ownIds: readonly WorkId[]): string | null {
  const arxiv = ownIds.find((id) => id.startsWith("arxiv:"));
  return arxiv ? `arXiv:${arxiv.slice("arxiv:".length)}` : null;
}

export async function runExtract(opts: {
  html: string;
  /**
   * **`null` for a document the reader uploaded**, which has no address at all —
   * docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md.
   *
   * It is used for exactly two things and they want the same answer: as the
   * base relative links resolve against (`sourceDom`), and as `meta.url`. A
   * placeholder would have been wrong in both — a fake base silently resolves
   * relative links to an origin nobody named, and a fake `meta.url` reads as an
   * address to the masthead, the metadata page and every dedup check. Absent is
   * what `Meta.url` already allows, because an uploaded PDF has been arriving
   * without one since 2026-08-27.
   */
  url: string | null;
  slug: string;
  /**
   * What tidies the title for the shelf. Import hands in the model's
   * (src/title-tidy-model.ts); absent, the rule alone, and no call.
   */
  titleTidier?: TitleTidier;
  /**
   * What reads the declared authors' affiliations off the page's opening, on
   * any site (src/front-matter-authors.ts, plan 261010d). Import hands in the
   * cheap model's; absent, no call. Asked only when the page declares its
   * authors and gives none of them an affiliation.
   */
  frontMatterAuthors?: FrontMatterAuthorsReader;
  /**
   * What reads the title off the page's opening when the page's `<title>` is
   * known not to be it: a LaTeXML paper with no title of its own
   * (src/opening-title.ts, plan 261017a). Import hands in the cheap model's;
   * absent, or no answer, the title is the paper's arXiv id where available,
   * else the slug.
   */
  titleFromOpening?: OpeningTitleReader;
  /**
   * **The pages after this one, when the piece arrived as several** (stage 1
   * followed them: src/follow-pages.ts, plan 261024p). Each is read on its own
   * and joined by `readParts` (src/read-parts.ts); absent or empty, this is
   * the one page it always was.
   */
  parts?: readonly PageSource[];
}): Promise<ExtractResult> {
  const { slug } = opts;
  const parts = opts.parts ?? [];
  /* Before the DOM pass that asks whether each formula would draw: this is the
     temml load the built function can trace (src/maths-server.ts). Only for a
     page that could hold a formula — most do not, and need not pay for it. */
  if (MIGHT_HOLD_MATHS.test(opts.html) || parts.some((p) => MIGHT_HOLD_MATHS.test(p.html))) await loadMathsRenderer();

  /* Every page is parsed with a silent `VirtualConsole`, so a fetched page cannot
     write itself to stderr: src/read-article.ts § `sourceDom` says why. */
  const { article, authors: declaredAuthors, opening, openingHeaded, ownIds, untitled, drawnTitle, refusal, notes, callouts, removed, kept } = readParts(
    { html: opts.html, url: opts.url },
    parts,
  );
  /* **Before the `!article` check, so it wins over `ReadabilityRefused` too.**
     A bot check Readability happens to decline is still a bot check, and that
     is the sentence with a move in it. src/challenge-page.ts. */
  if (refusal instanceof ChallengePage) {
    throw refusal;
  }
  if (!article) {
    throw new ReadabilityRefused();
  }
  /* **The caller that decides the floor is an error**, which is what
     `readArticle`'s header means by handing the verdict back rather than
     throwing it. An eval wants the row; this is the path that publishes, and
     publishing 185 characters of somebody's 404 page as an article is what
     spends a reader's slot on nothing. */
  if (refusal) {
    throw refusal;
  }

  /* The metadata is the article's identity — the only place the source URL, the
     byline and the fetch date survive past this stage (src/store/pg.ts reads it).
     Rebuilt on every run: re-extracting is how you refresh a page, and the
     fetch date should follow. */
  /* Readability has been handing `publishedTime` back all along and this stage
     dropped it on the floor. It is the reference frame for every year-less date
     in the piece — the field's note in src/types.ts says why it is not
     `fetchedAt`, and `publicationDate` above why it is not converted to UTC. */
  /* When the markup states none, the line printed under the title
     (src/page-date.ts, plan 261024a). The address's day is weaker evidence
     than the registry's, so it goes back beside `meta` as `addressDay`. */
  const fetchedAt = new Date().toISOString();
  const publishedAt = publicationDate(article.publishedTime) ?? datelineDay(opening, openingHeaded, fetchedAt);
  /* The page's own line breaks taken back out — `tidyMetaText` above says why,
     and why it stops there rather than guessing at a missing separator. The
     page's declared author list replaces it where it has dropped somebody,
     because Readability keeps only the last of a repeated tag —
     src/meta-authors.ts. */
  /* **Affiliations for the declared names**, read off the page's opening by
     one cheap call (src/front-matter-authors.ts, plan 261010d), on any site.
     Only when the page declares its authors — `citation_author`, `dc.creator`
     or an arXiv paper's LaTeXML markup — and gives none an affiliation: a page
     that declares affiliations has said what it has to say, and a page that
     declares nobody is not asked to have a model choose its authors. The
     reader returns the same names, in the same order, or nothing. After every
     refusal above, so a page refused as too short never pays. */
  const authors =
    opts.frontMatterAuthors && declaredAuthors?.length && declaredAuthors.every((a) => a.affiliations.length === 0)
      ? ((await opts.frontMatterAuthors(opening, declaredAuthors.map((a) => a.name))) ?? declaredAuthors)
      : declaredAuthors;
  const byline = chooseByline(authors?.map((a) => a.name) ?? null, tidyMetaText(article.byline));
  const declared = authorsForByline(authors, byline);
  /* **Plain text, once, before it branches** into `meta.title`, the page's
     `<title>` and the job's title. (Until 2026-10-07 also an `<h1>` of ours in
     the page's body, which stage 3 turned into a block: `debugPage`.) A page's
     `<title>` or `og:title` can say `&lt;i&gt;Drosophila&lt;/i&gt;`, which
     Readability decodes into literal tags.
     docs/plans/260929e-outside-titles-become-plain-text-at-ingest.md. */
  /* **Not the page's `<title>` when it is known to be somebody else's guess**:
     a LaTeXML paper with no `\title`, whose `<title>` names a numbered part
     of it (`1Indicator Properties`, report spya-mx3wz0). The title is then
     read off the page's own opening, or is a placeholder: the paper's own
     arXiv id where the page gives one, else the slug. A placeholder is
     plainly one, and LaTeXML's guess looks like a title. Plan 261017a. */
  const declaredTitle = untitled
    ? ((await opts.titleFromOpening?.(opening)) ?? untitledPlaceholder(ownIds))
    : asDrawn(article.title, drawnTitle);
  const title = typeof declaredTitle === "string" ? plainTitle(declaredTitle) : declaredTitle;
  const meta: Meta = {
    slug,
    /* **Tidied for the shelf, and only here** — capitals, a site's name on the
       end, the original kept beside it: by the tidier handed in (import's is a
       small model, src/title-tidy-model.ts, plan 261005j) or by the rule
       (src/title-tidy.ts, plan 261005g). The page's `<title>` below keeps
       `title` as the author set it. */
    ...(title
      ? await (opts.titleTidier ?? ruleTitleTidier)(title, {
          body: article.textContent,
          lang: article.lang,
          siteName: article.siteName,
        })
      : { title: slug }),
    ...(byline ? { byline } : {}),
    /* The same list, structured: names and the affiliations the page declares
       for each, for the masthead and the Metadata page to show one at a time.
       Absent rather than `[]` when the page declares nobody, and absent when
       the byline names people the list does not — `authorsForByline`.
       Plan 260929d § 2. */
    ...(declared ? { authors: declared } : {}),
    ...(article.siteName ? { siteName: article.siteName } : {}),
    ...(article.lang ? { lang: article.lang } : {}),
    /* **Spread rather than assigned**, since 2026-09-07, for the same reason
       every optional field above is: `url: undefined` and no `url` key are
       different artefacts, and the round-trip test compares them. An uploaded
       document has no address and must not carry one. */
    ...(opts.url === null ? {} : { url: opts.url }),
    fetchedAt,
    ...(publishedAt ? { publishedAt } : {}),
    ...(article.excerpt ? { excerpt: article.excerpt } : {}),
  };

  const fromAddress = publishedAt === undefined ? addressDay(opts.url, fetchedAt) : undefined;
  return {
    slug,
    meta,
    ownIds,
    ...(fromAddress === undefined ? {} : { addressDay: fromAddress }),
    /* **No byline goes into the page any more** (2026-10-07, `debugPage`).
       While one did, it had to be the byline chosen above and not
       Readability's, which on a LaTeXML page was a cited author or the word
       "and"
       (docs/investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md).
       `meta.byline` is now the only place it is written. */
    extractedHtml: debugPage({ ...article, title }),
    length: article.length ?? null,
    excerpt: article.excerpt ?? null,
    notes,
    callouts,
    removed,
    kept,
  };
}

/**
 * **`npm run extract` used to be here, and it is `scripts/stage.ts` now.**
 *
 * It took a URL, fetched the page itself, ran `runExtract` and wrote
 * `output/<slug>.html` and `data/<slug>/meta.json` by hand — two paths off
 * `process.cwd()`, which under Postgres are files nothing reads.
 *
 * `npm run extract -- <slug> [--force]` re-runs stage 2 on an article you
 * already have, through the queue, into a draft revision that is published when
 * the job settles. The contract is in `scripts/stage.ts`. It cannot take a URL
 * any more: making an article from an address is `npm run ingest`.
 *
 * `defaultOutFile` and `slugForOutFile` went with it — an explicit output path
 * was a thing only a command line had.
 */

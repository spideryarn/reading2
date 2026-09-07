/**
 * **The arms** — the shipped extraction, and twelve ways of being wrong that a
 * scorer must not confuse with it.
 *
 * The degenerate arms are not straw men. Each is a policy somebody has
 * actually proposed or shipped, or an adversary a reviewer actually built, and
 * each scores *well* on at least one number that has been quoted as evidence in
 * this repo:
 *
 * | arm | what it is, and who proposed it | what it scores well on |
 * |---|---|---|
 * | `raw-body` | keep the page. The zero-work baseline | recall — it drops nothing at all |
 * | `first-20-percent` | truncation, which is failure mode **T** | precision — everything it keeps is article |
 * | `article-plus-rail` | the un-hide arm's worst case: a nav drawer admitted inside the article container | recall, and `droppedChars` **improves** |
 * | `restore-everything` | maximal recovery — every prose-bearing element of the page, in order | recall, perfectly |
 * | `drop-every-short-block` | 260830at's ≤6-character rule, which scored **246/246** on a corpus that could not defeat it | its own marker count |
 * | `needle-collage` | return the manifest's own `mustContain` strings and nothing else | **every declared assertion, perfectly** |
 * | `duplicate-paragraph` | say one of the article's paragraphs twice | every declared assertion, and every text metric |
 * | `region-padded-collage` | delete the article and refill the space with genuine stamped elements from off it | **every metric, both gates and every assertion — until 2026-09-05** |
 *
 * `restore-everything` is the arm every recovery-shaped number in `corpus.mts`
 * and `inventory.mts` would call perfect, and `drop-every-short-block` is the arm
 * that already got a clean score once.
 *
 * **The last three are GPT Sol's, and they are why this file has been rewritten
 * twice.** Reviewing stage B on 2026-09-05 he built the collage against
 * `aaronson`: three strings, all copied from the page, **182 characters against
 * the shipped 32,918 — 0.55% of the article — and every exercised metric scored
 * 1.00, both gates passed, and the runner labelled it `acceptable`.**
 * Duplicating a paragraph was equally invisible.
 *
 * Reviewing the repair the same afternoon he built `region-padded-collage`, and
 * it is the sharper one: **no fabricated nodes at all.** The required passages
 * trimmed to their exact source text, five genuine figures, two genuine
 * blockquotes, and then the page's own comment thread as padding until it
 * cleared `minArticleChars: 30000`. **178 characters of the post retained,
 * 0.542%**; 30,052 characters returned; every metric 1.00; both gates green over
 * 91 nodes; every assertion held; no regression. Provenance proves text came
 * from somewhere on the page, and could not tell 5,560 words of post from the
 * 52,776 words of comment under it.
 *
 * All three are in the list, `tests/extraction-scorer.test.ts` requires **every**
 * arm here to lose on a named metric or gate on every fixture it is exercised
 * on, and [score.mts](score.mts) asks the same of all fifteen and exits
 * non-zero. See `HARMLESS_HERE` for the two exemptions and their arguments.
 *
 * ## Every arm is a transform of one stamped source document
 *
 * Each `run` returns the output twice: `html`, which every metric reads, and
 * `stampedHtml`, the same document with `data-spya-src` still on every node it
 * inherited from the source. That second form is what makes the attribution and
 * order gates *decisive* rather than a text match — an arm that fabricates a node
 * has nothing to resolve, and an arm that says a paragraph twice claims one
 * source id twice. Before 2026-09-05 the gates had only the text form, and the
 * collage passed both.
 *
 * The cost is that `raw-body` and `restore-everything` now start from the
 * **prepared** document — `prepareDocument`'s note and callout canonicalisation
 * has run — rather than from the raw bytes. That is the document Readability is
 * actually handed, so it is the fairer baseline as well as the stampable one,
 * but it is a change in what those two arms are and it is recorded here.
 *
 * @see [scorecard.mts](scorecard.mts) — what they are scored with
 * @see [../../src/extract.ts](../../src/extract.ts) § `readArticleWithProvenance`
 * @see [../../docs/plans/260830at-readability-tidy-pass.md](../../docs/plans/260830at-readability-tidy-pass.md) — the 246/246
 */
import { JSDOM, VirtualConsole } from "jsdom";

import { readArticleWithProvenance, sourceRefOf, withoutSourceRefs } from "../../src/extract.js";
import { RESERVED_ATTRS, scrubReserved } from "../../src/reserved.js";
import type { Candidate } from "./corruptions.mjs";
import type { AssertionManifest } from "./manifest.mjs";
import { contentRoot, gistableChars, regionTextById } from "./scorecard.mjs";

/**
 * **What an arm is allowed to know about the page it is attacking.**
 *
 * The manifest is in here for one reason: `needle-collage` is the adversary that
 * reads the answer sheet. An eval whose worst case cannot see the assertions it
 * is defeating is an eval that has not met its worst case.
 */
export interface ArmContext {
  manifest: AssertionManifest | null;
  /**
   * The page's URL, which `run` already receives and `precondition` did not.
   * `region-padded-collage` needs the *prepared, stamped* source to ask what is
   * off the article, and that is keyed by URL — so a precondition that cannot
   * reach it would have to answer from the raw bytes, where the stamps the
   * question is about do not exist yet.
   */
  url: string;
}

export interface Arm {
  name: string;
  /** One line, for the runner's table. */
  what: string;
  /**
   * **Does this page give the arm anything to act on?**
   *
   * The exposure predicate, and it is a function rather than a comment because
   * 260827ab's "zero regressions across fourteen pages" was a safety claim about
   * an arm the corpus could not exercise. An arm whose precondition holds on no
   * fixture is reported `not exercised`, never `no regressions`.
   */
  precondition: (raw: string, shipped: Candidate, ctx: ArmContext) => boolean;
  run: (raw: string, url: string, ctx: ArmContext) => Candidate;
}

const parse = (html: string, url?: string): Document =>
  new JSDOM(html, { virtualConsole: new VirtualConsole(), ...(url ? { url } : {}) }).window
    .document;

const INVISIBLE = ["script", "style", "noscript", "template", "svg", "head", "title"];

/** The same fragment with the one instrument attribute taken back off it. */
export function stampsOff(html: string): string {
  const doc = parse(`<!doctype html><body>${html}</body>`);
  scrubReserved(doc, [RESERVED_ATTRS.sourceRef]);
  return doc.body.innerHTML;
}

/**
 * **One stamped extraction per page**, held while the runner works through that
 * page's arms and dropped when it moves on.
 *
 * Seven arms times two calls each is fourteen `readArticleWithProvenance` runs
 * per fixture, and each is two JSDOM parses of the whole page plus a Readability
 * pass. On `gutenberg-pride` — 732,000 characters — that took the corpus run past
 * ten minutes, which is a run nobody runs. One entry is enough because the runner
 * finishes a fixture before starting the next; correctness never depends on a
 * hit, only on `readArticleWithProvenance` being a pure function of its inputs,
 * which it is.
 */
let stampedCache: { key: string; value: ReturnType<typeof readArticleWithProvenance> } | null = null;
function stamped(raw: string, url: string): ReturnType<typeof readArticleWithProvenance> {
  /**
   * **The whole input, not a fingerprint of it.**
   *
   * The key was URL + byte length + the first 256 characters, and GPT Sol handed
   * it two different documents of the same length with the same URL and prefix:
   * the second call got the first document's tail back. The committed corpus's
   * unique URLs hide it, which is exactly what makes it worth removing — a
   * synthetic test or a stage C reuse would meet it with no warning at all.
   *
   * This is the same bug `regionTextById` had and fixed in round 3, and its
   * comment there says the reason in one line: *a fingerprint that can collide is
   * a silently wrong answer, which is the one thing this file is about.* One
   * entry, so holding the string costs one page.
   */
  const key = `${url}\u0000${raw}`;
  if (stampedCache?.key === key) return stampedCache.value;
  const value = readArticleWithProvenance(raw, url);
  stampedCache = { key, value };
  return value;
}

/**
 * **Stage 2, run so that its output remembers where it came from.**
 *
 * `withoutSourceRefs` is what `provenance.mts`'s `inert` column compares against
 * the shipping `readArticle` byte for byte on all 35 fixtures, so `html` here is
 * the shipped extraction exactly — the stamps buy provenance and change nothing.
 */
const shippedOf = (raw: string, url: string): Candidate => {
  const { article, refusal } = stamped(raw, url);
  /**
   * **The capability floor is a refusal here too, and this line is the whole
   * reason it lives in a shared helper.**
   *
   * `shippedOf` calls `readArticleWithProvenance` directly and never goes
   * through `runExtract`, so a floor written into `runExtract`'s catch would
   * leave `refused` false on exactly the pages it exists for — production
   * correct, `notAnArticle` scoring a refusal that never happened, and nothing
   * to see. src/extract.ts § `capabilityFloor`.
   *
   * `refusal` and not `!article?.content`: Readability hands back a parse it has
   * disowned rather than nothing, so on `medium-about` the article is present,
   * titled "Medium", and 185 characters long.
   */
  if (!article?.content || (refusal && !floorSuspended)) {
    return { html: "", title: null, byline: null, refused: true };
  }
  return {
    html: withoutSourceRefs(article.content),
    stampedHtml: article.content.innerHTML,
    title: article.title ?? null,
    byline: article.byline ?? null,
    refused: false,
  };
};

/**
 * **The one door past the capability floor, and the corpus never opens it.**
 *
 * Refusing `pmc-article` cost the instrument something real: the arm
 * `drop-every-short-block` applied to that page is the corpus's **only
 * real-page witness** for partial flattening — the shape GPT Sol's ninth review
 * of stage B found the order gate condemning, and the one case in
 * `tests/extraction-scorer.test.ts` that is not hand-built by whoever was fixing
 * the bug. With the shipped extraction empty, the arm has nothing to flatten and
 * the oracle quietly turns into an assertion about `""`.
 *
 * So one test asks its question — *can the SCORER see this?* — with the floor
 * held open. That is a different question from *should we publish this?*, which
 * is the floor's and is answered `no` everywhere else, `score.mts` included:
 * nothing in the runner calls this, and the corpus's rows for the two walls
 * stay refused.
 *
 * **Not a way to score a wall.** A candidate obtained through here carries the
 * provenance stamps of a page production refuses, so the gates will report on
 * output no reader can ever get. Read `shippedOf` above and use that.
 *
 * The shape of it — a scoped mutation seam rather than a parameter — is the one
 * `withPlacementFloor` in shapes.mts already established, and for the same
 * reason: an arm's `run` takes bytes and a URL, and threading a flag through
 * every arm to reach one test would be the larger change.
 *
 * **Synchronous only, and it says so rather than hoping** — the other half of
 * that precedent, and it would be worse here. `finally` runs when the callback
 * *returns*, so an `async` one would drop the suspension at its first `await`
 * and every line after it would run at the shipped floor while appearing to run
 * with the floor held open. In `withPlacementFloor` that costs a wrong verdict;
 * here it would silently score `""`, which is the assertion-about-nothing this
 * seam exists to prevent. Every arm's `run` is synchronous, so a thenable is
 * refused rather than documented.
 */
let floorSuspended = false;
export function withoutTheCapabilityFloor<T>(fn: () => T): T {
  floorSuspended = true;
  try {
    const out = fn();
    if (out !== null && typeof (out as { then?: unknown } | null)?.then === "function") {
      throw new Error(
        "withoutTheCapabilityFloor was given an asynchronous callback — the floor is restored " +
          "when the callback returns, so anything after an await would run with the floor back " +
          "in place while appearing to run without it",
      );
    }
    return out;
  } finally {
    floorSuspended = false;
    /* The per-page cache holds a parse, not a verdict, so nothing of the
       suspension survives in it — but the next caller must not inherit a
       candidate built under it, and `stamped()` is keyed on the bytes alone. */
    stampedCache = null;
  }
}

/**
 * **The document every arm is a transform of, as HTML** — and it is what the
 * gates have to be scored against, not the fetched bytes.
 *
 * `prepareDocument` runs before Readability and rewrites the page: it moves each
 * footnote into a notes container and marks callouts (`src/extract.ts` § the
 * order is the contract). So a block of the shipped output can be a run of text
 * the *raw* file never had contiguously — `ar5iv-attention`'s author line ends
 * `"Ashish Vaswani Thanks: Equal contribution…"` because the note was
 * canonicalised into it — and a footnote can arrive after the section it used to
 * sit in. Scored against `raw`, that read as 37 blocks of invented text and a
 * dozen reorderings on pages where nothing was wrong.
 *
 * **The honest limit, said out loud:** these gates therefore cannot see text
 * `prepareDocument` itself invents. They ask what stage 2's *extraction* did to
 * the document stage 2 was handed, which is the question the arms are about.
 * `tests/extract-provenance.test.ts` is what watches the preparation.
 */
export const preparedSourceHtml = (raw: string, url: string): string =>
  stamped(raw, url).sourceHtml;

/**
 * The prepared, stamped source document — the one Readability is handed.
 *
 * **Freshly parsed from its own bytes**, because two arms below strip elements
 * out of it and `stamped()` hands every caller the same `Document`: mutating the
 * cached one would leave the next arm working on the last arm's leftovers, and
 * `raw-body` and `restore-everything` both call `stripInvisible`.
 */
const stampedSource = (raw: string, url: string): Document =>
  parse(stamped(raw, url).sourceHtml, url);

/**
 * Run a DOM transform over the stamped output and hand back both forms, so the
 * scored document and the provenance-checked document cannot drift apart: one is
 * the other with a single attribute removed.
 */
function transformed(base: Candidate, stamped: string): Candidate {
  return { ...base, stampedHtml: stamped, html: stampsOff(stamped) };
}

function onShipped(
  raw: string,
  url: string,
  fn: (doc: Document, shipped: Candidate) => void,
): Candidate {
  const shipped = shippedOf(raw, url);
  const doc = parse(`<!doctype html><body>${shipped.stampedHtml ?? ""}</body>`);
  fn(doc, shipped);
  return transformed(shipped, doc.body.innerHTML);
}

/**
 * The deepest elements that carry prose and are not themselves made of blocks —
 * the same rule `inventory.mts` § `candidates` arrived at after two wrong
 * versions, both of which printed confident numbers. Kept in step with it by
 * hand rather than imported, because that one walks a *source* document and this
 * one has to build a new one; where they disagree, that file is the authority
 * and carries the reasoning.
 */
const INLINE = new Set([
  "a", "abbr", "b", "bdi", "bdo", "big", "br", "cite", "code", "data", "del", "dfn", "em",
  "font", "i", "img", "ins", "kbd", "mark", "q", "s", "samp", "small", "span", "strike",
  "strong", "sub", "sup", "time", "tt", "u", "var", "wbr", "ruby", "rt", "rp",
]);
const MIN_BLOCK_CHARS = 20;

function proseElements(doc: Document): Element[] {
  const out: Element[] = [];
  const big = (t: string | null): boolean => (t ?? "").replace(/\s+/g, " ").trim().length >= MIN_BLOCK_CHARS;
  const walk = (el: Element): void => {
    if (INVISIBLE.includes(el.tagName.toLowerCase())) return;
    const kids = Array.from(el.children).filter(
      (c) => !INVISIBLE.includes(c.tagName.toLowerCase()),
    );
    const blockKids = kids.filter((c) => !INLINE.has(c.tagName.toLowerCase()) && big(c.textContent));
    if (!blockKids.length) {
      if (big(el.textContent)) out.push(el);
      return;
    }
    for (const c of kids) walk(c);
  };
  if (doc.body) walk(doc.body);
  return out;
}

function stripInvisible(doc: Document): void {
  for (const tag of INVISIBLE) for (const el of Array.from(doc.querySelectorAll(tag))) el.remove();
}

/** 260830at's rule, as written: a gistable block of six characters or fewer goes. */
export const SHORT_BLOCK_CHARS = 6;

/* ------------------------------------------------- padding from off the page ---- */

/** `s41` → 41. The stamp counter runs in source document order, so it IS the position. */
const stampPosition = (el: Element): number =>
  Number.parseInt((el.getAttribute(RESERVED_ATTRS.sourceRef) ?? "s0").slice(1), 10);

/** Elements a padding arm would plausibly reach for: prose containers, not wrappers. */
const PADDABLE = new Set(["p", "li", "dd", "blockquote", "figure", "pre"]);

const normText = (t: string | null): string => (t ?? "").replace(/\s+/g, " ").trim();

/**
 * **How much prose this page has that is NOT the article.** The exposure
 * predicate for `region-padded-collage`: a page with nothing off the article to
 * pad with cannot exercise that arm, and saying "no regressions" about an arm
 * the page cannot run is 260827ab's fourteen-page accordion answer again.
 */
function offRegionProse(raw: string, ctx: ArmContext): { chars: number; elements: number } {
  const region = ctx.manifest?.articleRegion;
  if (!region) return { chars: 0, elements: 0 };
  const sourceHtml = stamped(raw, ctx.url).sourceHtml;
  const inRegion = regionTextById(sourceHtml, region);
  const doc = parse(sourceHtml);
  let chars = 0;
  let elements = 0;
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    if (!PADDABLE.has(el.tagName.toLowerCase())) continue;
    if (inRegion.has(el.getAttribute(RESERVED_ATTRS.sourceRef) ?? "")) continue;
    const t = normText(el.textContent);
    if (t.length < 100) continue;
    chars += t.length;
    elements += 1;
  }
  return { chars, elements };
}

/**
 * **The elements `region-padding-only` will actually insert**, and the
 * precondition asks this rather than `offRegionProse`.
 *
 * The first version asked one question and inserted on another — the run also
 * demands a stamp and no stamped descendant, so that no source id is claimed
 * twice and `sourceOrder` stays green. On `ar5iv-attention` those extra
 * conditions left nothing, and the arm came out **exercised and inert**: the
 * run's table showed it against the fixture with no regression, which reads
 * exactly like an arm the card failed to notice. An exposure predicate that does
 * not ask the question the arm answers is the same bug as no exposure predicate.
 */
function offRegionPaddable(raw: string, url: string, shipped: Candidate, ctx: ArmContext): Element[] {
  const region = ctx.manifest?.articleRegion;
  if (!region || !shipped.stampedHtml) return [];
  const sourceHtml = stamped(raw, url).sourceHtml;
  const inRegion = regionTextById(sourceHtml, region);
  const forbidden = (ctx.manifest?.mustNotContain ?? []).map((n) => normText(n.text));
  /* **Nothing the output already has.** A source element that is in the shipped
     extraction cannot be padded in beside itself: it would arrive under an id
     the output has already used, and `sourceOrder` would call it a duplicate.
     Being caught by the order gate would say nothing about padding. */
  const already = new Set(
    Array.from(
      parse(`<!doctype html><body>${shipped.stampedHtml}</body>`)
        .querySelectorAll(`[${RESERVED_ATTRS.sourceRef}]`),
    ).map((el) => el.getAttribute(RESERVED_ATTRS.sourceRef) ?? ""),
  );
  const idsOf = (el: Element): string[] => [
    el.getAttribute(RESERVED_ATTRS.sourceRef) ?? "",
    ...Array.from(el.querySelectorAll(`[${RESERVED_ATTRS.sourceRef}]`)).map(
      (k) => k.getAttribute(RESERVED_ATTRS.sourceRef) ?? "",
    ),
  ];
  const doc = parse(sourceHtml, url);
  stripInvisible(doc);
  const out: Element[] = [];
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    if (!PADDABLE.has(el.tagName.toLowerCase())) continue;
    if (el.getAttribute(RESERVED_ATTRS.sourceRef) === null) continue;
    const ids = idsOf(el);
    if (ids.some((id) => inRegion.has(id) || already.has(id))) continue;
    /* Nested paddables would claim their parent's ids a second time. */
    if (out.some((x) => x.contains(el))) continue;
    const t = normText(el.textContent);
    if (t.length < 100 || forbidden.some((f) => t.includes(f))) continue;
    out.push(el);
  }
  return out.sort((a, b) => stampPosition(a) - stampPosition(b));
}

export const SHIPPED_ARM = "shipped";

export const ARMS: Arm[] = [
  {
    name: SHIPPED_ARM,
    what: "stage 2 as it ships — readArticle, which is prepareDocument then Readability",
    precondition: () => true,
    run: shippedOf,
  },
  {
    name: "raw-body",
    what: "the whole prepared <body>, scripts and styles removed. The zero-work baseline",
    precondition: () => true,
    run: (raw, url) => {
      const doc = stampedSource(raw, url);
      stripInvisible(doc);
      const stamped = doc.body?.innerHTML ?? "";
      return {
        html: stampsOff(stamped), stampedHtml: stamped,
        title: doc.title || null, byline: null, refused: false,
      };
    },
  },
  {
    name: "first-20-percent",
    what: "the shipped extraction, truncated to its first fifth. Failure mode T",
    /* Truncating a four-element article to its first fifth is not the failure
       this arm stands for, it is an empty document. Below five top-level pieces
       the arm has nothing to demonstrate and says so. */
    precondition: (_raw, shipped) =>
      contentRoot(parse(`<!doctype html><body>${shipped.html}</body>`)).children.length >= 5,
    run: (raw, url) =>
      onShipped(raw, url, (doc) => {
        const kids = Array.from(contentRoot(doc).children);
        for (const el of kids.slice(Math.max(1, Math.ceil(kids.length * 0.2)))) el.remove();
      }),
  },
  {
    name: "article-plus-rail",
    what: "the article, plus THE PAGE'S OWN nav, header and footer, glued inside the container",
    /**
     * **The page's own furniture, not an invented rail**, and the first draft of
     * this arm got that wrong in a way worth recording.
     *
     * It used to append `navRail()` — thirty synthetic link labels. That arm is
     * undetectable on any real fixture, because a manifest can only name strings
     * that are on the page, so no `mustNotContain` needle could ever match
     * invented text and the whole card stayed flat. The arm looked harmless
     * because the instrument could not see it, which is the shape this stage
     * exists to refuse.
     *
     * Taking the page's own `<nav>`, `<header>` and `<footer>` fixes both halves
     * at once: it is what the trawl actually observed — furniture admitted into
     * the article container, about 20 of the 52 pages — and it is text a manifest
     * is allowed to name, because it really is on the page.
     */
    precondition: (raw) => parse(raw).querySelectorAll("nav, header, footer").length > 0,
    run: (raw, url) => {
      const shipped = shippedOf(raw, url);
      const doc = stampedSource(raw, url);
      stripInvisible(doc);
      const furniture = Array.from(doc.querySelectorAll("nav, header, footer"))
        .filter((el) => !el.closest("nav, header, footer")?.parentElement?.closest("nav, header, footer"))
        .map((el) => el.outerHTML)
        .join("");
      return transformed(shipped, `${shipped.stampedHtml ?? ""}${furniture}`);
    },
  },
  {
    name: "restore-everything",
    what: "every prose-bearing element of the page, in source order. Maximal recall",
    precondition: () => true,
    run: (raw, url) => {
      const doc = stampedSource(raw, url);
      stripInvisible(doc);
      const stamped = proseElements(doc)
        .map((el) => el.outerHTML)
        .join("");
      return {
        html: stampsOff(stamped), stampedHtml: stamped,
        title: doc.title || null, byline: null, refused: false,
      };
    },
  },
  {
    name: "drop-every-short-block",
    what: `260830at's rule: every leaf block of ${SHORT_BLOCK_CHARS} characters or fewer, deleted`,
    /* The precondition IS the point. On a page with no short block the rule is
       inert, and "no regressions" from an inert rule is 260830at's 246/246 in
       one line. */
    precondition: (_raw, shipped) =>
      Array.from(parse(`<body>${shipped.html}</body>`).querySelectorAll("*")).some(
        (el) =>
          el.children.length === 0 &&
          (el.textContent ?? "").trim().length > 0 &&
          (el.textContent ?? "").trim().length <= SHORT_BLOCK_CHARS,
      ),
    run: (raw, url) =>
      onShipped(raw, url, (doc) => {
        for (const el of Array.from(doc.querySelectorAll("*"))) {
          if (el.children.length) continue;
          const t = (el.textContent ?? "").trim();
          if (t.length > 0 && t.length <= SHORT_BLOCK_CHARS) el.remove();
        }
      }),
  },
  {
    name: "needle-collage",
    what: "the manifest's own mustContain strings, verbatim, and NOTHING ELSE",
    /**
     * **The adversary that reads the answer sheet**, built by GPT Sol against
     * `aaronson` while reviewing stage B: three strings copied from the page,
     * 182 characters against the shipped 32,918. Every exercised metric 1.00,
     * both gates green, `assertionsPassed: true`, and the runner wrote
     * `acceptable` into the manifest.
     *
     * It is here because it is the exact shape of the thing the manifest tier
     * cannot see by construction — an arm that satisfies every declared
     * assertion while deleting 99.45% of the article — and the corpus has to be
     * able to catch it by some route that is not the assertions themselves.
     *
     * **What catches it, corrected 2026-09-05.** The note here used to say the
     * attribution gate was one of the two routes. It was not: the arm supplied
     * no `stampedHtml`, so the *weak text form* ran, and the weak form's whole
     * weakness is that a node fabricated out of copied page text is text that is
     * on the page — `aaronson`, `arxiv-abs` and `constitution` all read `ok/ok`
     * on it in the run of that morning. The routes that actually caught it were
     * `structureFidelity` and `minArticleChars`.
     *
     * It supplies its output as `stampedHtml` now, and the difference is not a
     * dodge. `stampedHtml` means *"here is my output; ask it where each node
     * came from"*, and this arm's answer is **nowhere** — every node resolves to
     * `how: "none"`, which is what a fabricated node is. Withholding it said
     * something weaker and quite different: "do not ask." The absence is for a
     * candidate that is not an arm's DOM at all — one built by hand in a test,
     * or a corruption applied to one.
     */
    precondition: (_raw, _shipped, ctx) => (ctx.manifest?.mustContain.length ?? 0) > 0,
    run: (raw, url, ctx) => {
      const shipped = shippedOf(raw, url);
      const html = (ctx.manifest?.mustContain ?? [])
        .map((n) => `<p>${n.text}</p>`)
        .join("");
      /* The same string as `stampedHtml`, carrying no stamps, because that is
         the truth about it: these nodes came from a JSON file, not from the
         page, and the attribution gate exists to say so. */
      return { html, stampedHtml: html, title: shipped.title, byline: shipped.byline, refused: false };
    },
  },
  {
    name: "region-padded-collage",
    what:
      "genuine stamped source elements: the needles, the structural floors, and then " +
      "PADDING FROM OFF THE ARTICLE until the length floor is cleared",
    /**
     * **GPT Sol's second adversary, and the arm that made `articleRegion` exist.**
     *
     * Reviewing the rebuilt stage B on 2026-09-05 he built it by hand against
     * `aaronson`: the three required passages trimmed to their exact source
     * text, five genuine figures, two genuine comment-thread blockquotes for the
     * structural floor, and then **later comment paragraphs** — real elements of
     * the real page, perfectly stamped — until it cleared `minArticleChars:
     * 30000`.
     *
     * - genuine post text retained: **178 characters, 0.542%**
     * - output: **30,052 characters, almost entirely the comment thread**
     * - every exercised metric **1.00**, both gates **passed** (91 nodes each),
     *   every assertion **held**, `detects(shipped, arm)` **false**
     *
     * Nothing was wrong with the gates. Provenance proves that text came from
     * somewhere on the page, and this page is 5,560 words of post under 52,776
     * words of comment thread — so a length floor counting gistable characters of
     * *output* could be filled with whatever was lying around on it.
     *
     * Both length measures count the declared **article region** now, by stamp:
     * `minArticleChars`, and the `articleRecall` metric. `scorecard.mts` §
     * `articleReturned`.
     *
     * The generic form below is *weaker* than Sol's hand-built one in one
     * respect — it does not trim each needle-bearing element down to the needle
     * — and that is deliberate: it keeps more of the article than his did, so
     * what stops this stops his.
     */
    precondition: (raw, _shipped, ctx) => {
      const region = ctx.manifest?.articleRegion;
      if (!region || ctx.manifest?.minArticleChars === undefined) return false;
      /* The page has to have enough material off the article to pad with.
         `arxiv-abs` and `shakespeare-hamlet` do not, and an arm with nothing to
         pad from is `not exercised` — never `no regressions`. */
      return offRegionProse(raw, ctx).chars >= ctx.manifest.minArticleChars;
    },
    run: (raw, url, ctx) => {
      const shipped = shippedOf(raw, url);
      const manifest = ctx.manifest!;
      const sourceHtml = stamped(raw, url).sourceHtml;
      const inRegion = regionTextById(sourceHtml, manifest.articleRegion!);
      const doc = parse(sourceHtml, url);
      stripInvisible(doc);
      const all = Array.from(doc.querySelectorAll("*"));
      const forbidden = manifest.mustNotContain.map((n) => normText(n.text));

      const keep: Element[] = [];
      const add = (el: Element | undefined | null): void => {
        if (!el) return;
        if (keep.some((x) => x === el || x.contains(el) || el.contains(x))) return;
        keep.push(el);
      };
      /* 1. every required needle, in the deepest genuine element that says it */
      for (const n of manifest.mustContain) {
        add(all.filter((el) => normText(el.textContent).includes(normText(n.text))).at(-1));
      }
      /* 2. every declared structural floor, from the page's own elements — and
            it does not care whether they are the article's, which is the point */
      for (const [tag, floor] of Object.entries(manifest.structure ?? {})) {
        const want = floor.exactly ?? floor.atLeast ?? 0;
        const have = (): number =>
          keep.reduce(
            (n, el) => n + (el.matches(tag) ? 1 : 0) + el.querySelectorAll(tag).length,
            0,
          );
        for (const el of Array.from(doc.querySelectorAll(tag))) {
          if (have() >= want) break;
          add(el);
        }
      }
      const htmlOf = (): string =>
        keep
          .slice()
          .sort((a, b) => stampPosition(a) - stampPosition(b))
          .map((el) => el.outerHTML)
          .join("");
      /* 3. pad to the length floor with prose from off the article.
            **Counted incrementally**, because the obvious form — re-serialise
            and re-block the whole candidate at the top of every iteration —
            walks tens of thousands of elements doing a JSDOM parse apiece and
            ran the test worker out of memory at 4 GB. The running total is
            normalised text length, which over-counts a little against
            `gistableChars`; the exact figure is taken once at the end. */
      let sofar = gistableChars(stampsOff(htmlOf()));
      for (const el of all) {
        if (sofar >= manifest.minArticleChars!) break;
        if (!PADDABLE.has(el.tagName.toLowerCase())) continue;
        if (inRegion.has(el.getAttribute(RESERVED_ATTRS.sourceRef) ?? " ")) continue;
        const t = normText(el.textContent);
        if (t.length < 100 || forbidden.some((f) => t.includes(f))) continue;
        const before = keep.length;
        add(el);
        if (keep.length > before) sofar += t.length;
      }
      const stampedHtml = htmlOf();
      return {
        html: stampsOff(stampedHtml), stampedHtml,
        title: shipped.title, byline: shipped.byline, refused: false,
      };
    },
  },
  {
    name: "drop-generated-nodes",
    what:
      "the shipped extraction with every LEAF Readability generated removed — genuine article " +
      "prose, deleted, in the nodes that had no source element of their own",
    /**
     * **GPT Sol's third review, finding 1, and it was invisible.**
     *
     * `articleReturned` credited only *directly* stamped nodes, so text in a
     * node Readability built itself was never in the numerator — and text that
     * is not in the numerator cannot be removed from it. On `pg-greatwork`,
     * where the essay is 599 `<br>`s in one `<td>` and Readability makes every
     * paragraph itself:
     *
     * - shipped gistable output **66,449** characters
     * - this arm deletes **53,784** of them, 216 leaf nodes, 81% of the output
     * - `articleChars` **6,330** and `articleRecall` **0.1153** — *unchanged, to
     *   the digit* — both gates green, `detects` found nothing
     *
     * § B said ignoring generated nodes "under-counts in the safe direction
     * because the floors come from a measured run". That is false and is
     * retracted: a floor cannot catch the deletion of text its numerator never
     * counted. An ancestor-resolved node is credited against its ancestor's own
     * text now (`scorecard.mts` § `articleReturned`), and this arm is what says
     * so on every run.
     */
    precondition: (_raw, shipped) => {
      if (!shipped.stampedHtml) return false;
      const doc = parse(`<!doctype html><body>${shipped.stampedHtml}</body>`);
      let chars = 0;
      for (const el of Array.from(doc.querySelectorAll("*"))) {
        if (el.children.length) continue;
        const t = normText(el.textContent);
        if (!t) continue;
        if (sourceRefOf(el).how === "direct") continue;
        chars += t.length;
      }
      /* A page whose extraction Readability did not have to build is a page this
         arm has nothing to act on — `not exercised`, never `no regressions`. */
      return chars >= 500;
    },
    run: (raw, url) =>
      onShipped(raw, url, (doc) => {
        for (const el of Array.from(doc.querySelectorAll("*"))) {
          if (!el.isConnected || el.children.length) continue;
          if (!normText(el.textContent)) continue;
          if (sourceRefOf(el).how === "direct") continue;
          el.remove();
        }
      }),
  },
  {
    name: "repeat-one-generated-node",
    what:
      "one genuine node Readability GENERATED, repeated inside its own stamped ancestor until " +
      "the output is as long as the article — the same characters, over and over",
    /**
     * **GPT Sol's fourth review, and it is the hole the generated-node repair
     * opened.**
     *
     * Crediting a generated node against its nearest stamped ancestor closed the
     * deletion hole and opened a crediting one: several output nodes resolve to
     * the same ancestor, and `articleReturned` summed each one's `cover.covered`
     * into that ancestor's total, capped only at the ancestor's length. It never
     * asked *which part* of the ancestor each cover had matched.
     *
     * On `pg-greatwork`, 197 copies of one genuine generated paragraph, its
     * stamped ancestor kept so every copy still resolves to it:
     *
     * - **410 distinct characters, 0.75% of the 54,900-character region**
     * - `articleRecall` **0.9881**, `regionPrecision` **0.9817**
     * - attribution **passed** over 200 nodes, source order **passed**
     * - and the card's own basis line said **"1 of 108 stamped region elements
     *   came back"** — the diagnostic and the metric disagreeing by two orders
     *   of magnitude with nothing comparing them
     *
     * The credit is the **union of source intervals** now, so saying a paragraph
     * 197 times is worth what saying it once is worth: 0.9881 → **0.0110**.
     *
     * **There is deliberately no duplicate GATE for generated nodes**, and that
     * is measured rather than assumed. Across the whole corpus exactly one
     * repeated `(ancestor, own text)` pair exists on a correct extraction, and
     * it is `pg-greatwork`'s footnote markers: 28 generated nodes whose own text
     * is `"["`. A rule saying "a generated node may not say the same thing
     * twice" would fail a correct extraction 28 times, which is the false red
     * this file has been burned by before. Repeated text being worth no more
     * than the text is the true statement, and the union is what enforces it.
     */
    precondition: (_raw, shipped) => {
      if (!shipped.stampedHtml) return false;
      const doc = parse(`<!doctype html><body>${shipped.stampedHtml}</body>`);
      return Array.from(doc.querySelectorAll("*")).some(
        (el) => sourceRefOf(el).how === "ancestor" && normText(el.textContent).length > 100,
      );
    },
    run: (raw, url, ctx) => {
      const shipped = shippedOf(raw, url);
      const doc = parse(`<!doctype html><body>${shipped.stampedHtml ?? ""}</body>`);
      const all = Array.from(doc.querySelectorAll("*"));
      /* Whitespace removed, because that is the unit `articleReturned` counts in
         — sizing the repeats on the collapsed length instead made the output
         come out 15% short of the region and the arm stopped being an attack on
         the crediting. */
      const ownOf = (el: Element): string => {
        let out = "";
        for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) out += n.textContent ?? "";
        return out.replace(/\s+/gu, "");
      };
      /* The stamped ancestor that the most generated text resolves to. */
      const groups = new Map<string, Element[]>();
      for (const el of all) {
        const { id, how } = sourceRefOf(el);
        if (how !== "ancestor" || !id || !ownOf(el)) continue;
        groups.set(id, [...(groups.get(id) ?? []), el]);
      }
      const [id, kids] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
      const ancestor = all.find((el) => el.getAttribute(RESERVED_ATTRS.sourceRef) === id)!;
      /**
       * Sized so the repeats come to about the region's own length — which is
       * what put `regionPrecision` up beside `articleRecall` in Sol's version
       * and is what makes this an attack on the crediting rather than on the
       * length floors.
       */
      const region = ctx.manifest?.articleRegion
        ? regionTextById(stamped(raw, url).sourceHtml, ctx.manifest.articleRegion)
        : new Map<string, string>();
      const regionChars = [...region.values()].reduce((n, t) => n + t.length, 0) || 50_000;
      const donor = kids.sort((a, b) => ownOf(b).length - ownOf(a).length)[0]!;
      /* Capped, because the arm's point is that the same characters are counted
         many times and not that the corpus run can be made to allocate: a page
         with a 40-character generated node and a 600,000-character region would
         ask for fifteen thousand copies and then run `coverOf` on every one of
         them. 400 is far more than enough to make the crediting bug visible, and
         on the one fixture that exercises this arm the sizing lands at 116. */
      const repeats = Math.min(
        400,
        Math.max(2, Math.round(regionChars / Math.max(1, ownOf(donor).length))),
      );
      /* Shallow clone, so the ancestor keeps its stamp and loses its own text. */
      const shell = ancestor.cloneNode(false) as Element;
      for (let i = 0; i < repeats; i++) shell.append(donor.cloneNode(true));
      const stampedHtml = shell.outerHTML;
      return {
        html: stampsOff(stampedHtml), stampedHtml,
        title: shipped.title, byline: shipped.byline, refused: false,
      };
    },
  },
  {
    name: "reverse-generated-nodes",
    what:
      "every run of nodes Readability GENERATED, emitted backwards — every character genuine, " +
      "every character returned exactly once, and the piece destroyed",
    /**
     * **Found here rather than by review, on 2026-09-06.**
     *
     * The order rules judged only *directly* stamped nodes, so on a page where
     * Readability builds most of the output there was almost nothing left for
     * them to look at. Reversing **188 generated nodes** on `pg-greatwork`:
     *
     * - `articleRecall` **0.9237 — identical to the shipped card** —
     *   `regionPrecision` 0.9237, `requiredRecall` and structure 1.00
     * - **both gates green**, every assertion held, `detects` **nothing**
     * - and the reader holds Paul Graham's essay with its paragraphs backwards
     *
     * It is the exact complement of `repeat-one-generated-node`: that one returns
     * the same characters many times, this one returns every character once and
     * in the wrong order. Neither is visible to a measure of how much text came
     * back, which is why the gates exist.
     *
     * `scorecard.mts` § `provenanceForm` now walks generated nodes forward
     * through their ancestor's own text, with the repeat/reordering distinction
     * that keeps `pg-greatwork`'s 28 `"["` footnote markers green. This arm fails
     * `sourceOrder` over 324 judged nodes, up from 108.
     *
     * **`assertionsPassed` stays true on it**, and that is the design rather than
     * a gap: a reordering is not a declared assertion, it is a gate. What catches
     * it is `detects`, on `sourceOrder`.
     */
    precondition: (_raw, shipped) => {
      if (!shipped.stampedHtml) return false;
      const doc = parse(`<!doctype html><body>${shipped.stampedHtml}</body>`);
      return Array.from(doc.querySelectorAll("*")).some((parent) => {
        const kids = Array.from(parent.children).filter(
          (el) => sourceRefOf(el).how === "ancestor" && normText(el.textContent).length > 40,
        );
        return kids.length >= 3;
      });
    },
    run: (raw, url) =>
      onShipped(raw, url, (doc) => {
        for (const parent of Array.from(doc.querySelectorAll("*"))) {
          const kids = Array.from(parent.children).filter(
            (el) => sourceRefOf(el).how === "ancestor" && normText(el.textContent).length > 40,
          );
          if (kids.length < 3) continue;
          for (const el of kids.slice().reverse()) parent.append(el);
        }
      }),
  },
  {
    name: "region-padding-only",
    what:
      "the WHOLE shipped extraction, with every off-article paragraph of the page inserted " +
      "in source order — addition without deletion",
    /**
     * **GPT Sol's third review, finding 2: an arm that deletes nothing.**
     *
     * `region-padded-collage` deletes the article and refills the space, and
     * `articleRecall` catches it on the first paragraph. This one keeps the
     * article whole and merely *adds*, which `articleRecall` cannot see by
     * construction — it is a recall measure, and an arm that returns the whole
     * page scores 1.00 on it.
     *
     * Reproduced on `aaronson`, 2026-09-05: the complete post plus **595 genuine,
     * ordered, stamped comment paragraphs**, 231,371 characters against a correct
     * 32,820 — seven times the article — every assertion holding, both gates
     * passing, `articleRecall` unchanged at 0.9998, `detects` finding **nothing**.
     * § B said the article/output pair covered this. That pair was printed beside
     * the row and never read by anything; printing a number next to another
     * number is not a check.
     *
     * `regionPrecision` is the number that moves, and it is a metric now.
     *
     * **Inserted in source order on purpose.** Appending the thread at the end
     * would fail `sourceOrder` — `aaronson`'s shipped output ends on the comment
     * policy at `s3245`, after the whole thread — and being caught by the order
     * gate would prove nothing about padding. Each paragraph goes after the last
     * top-level child whose stamps it follows, which is where the page has it.
     */
    precondition: (raw, shipped, ctx) => {
      if (!shipped.stampedHtml || !ctx.manifest?.articleRegion) return false;
      const pad = offRegionPaddable(raw, ctx.url, shipped, ctx);
      return pad.reduce((n, el) => n + normText(el.textContent).length, 0) >= 2000;
    },
    run: (raw, url, ctx) => {
      const shipped = shippedOf(raw, url);
      const doc = parse(`<!doctype html><body>${shipped.stampedHtml ?? ""}</body>`);
      const root = doc.body.firstElementChild ?? doc.body;
      /* Each top-level child of the output spans a range of source stamps. A
         padded paragraph may only go in a GAP between two of them: dropping one
         into the middle of a range would fail `sourceOrder`, and being caught by
         the order gate would say nothing about padding. */
      const span = (el: Element): { from: number; to: number } => {
        const ids = [stampPosition(el), ...Array.from(
          el.querySelectorAll(`[${RESERVED_ATTRS.sourceRef}]`),
        ).map(stampPosition)].filter((n) => n > 0);
        return ids.length ? { from: Math.min(...ids), to: Math.max(...ids) } : { from: 0, to: 0 };
      };
      const slots = Array.from(root.children).map((el) => ({ el, ...span(el) }));
      for (const el of offRegionPaddable(raw, url, shipped, ctx)) {
        const { from: at, to: end } = span(el);
        /* Only into a GAP between two of the output's own children: dropping a
           paragraph into the middle of one's stamp range would fail
           `sourceOrder`, and being caught by the order gate would say nothing
           about padding. */
        if (slots.some((s) => s.from <= end && at <= s.to)) continue;
        const after = slots.filter((s) => s.to < at).at(-1);
        const clone = doc.importNode(el, true) as Element;
        if (after) after.el.after(clone);
        else root.prepend(clone);
        /* The clone becomes a slot of its own, so the next paragraph lands after
           it rather than in front of it and the run stays in source order. */
        const i = after ? slots.indexOf(after) + 1 : 0;
        slots.splice(i, 0, { el: clone, from: at, to: end });
      }
      const stampedHtml = doc.body.innerHTML;
      return {
        html: stampsOff(stampedHtml), stampedHtml,
        title: shipped.title, byline: shipped.byline, refused: false,
      };
    },
  },
  {
    name: "duplicate-paragraph",
    what: "the shipped extraction with its longest paragraph said twice",
    /**
     * **Duplication, which a membership test cannot see** — bug 3 in
     * `scorecard.mts`'s header, and the harm un-hiding is likeliest to do. Every
     * `mustContain` needle is still present, no `mustNotContain` needle appears,
     * every structural floor still holds, and the reader is told the same thing
     * twice. GPT Sol's second adversary, 2026-09-05: on the conformance page it
     * left every manifest metric and both gates green.
     *
     * The order gate catches it, because the copy claims a source id the
     * original already claimed.
     */
    precondition: (_raw, shipped) =>
      Array.from(parse(`<body>${shipped.html}</body>`).querySelectorAll("p")).some(
        (el) => (el.textContent ?? "").trim().length > 200,
      ),
    run: (raw, url) =>
      onShipped(raw, url, (doc) => {
        const longest = Array.from(doc.querySelectorAll("p")).sort(
          (a, b) => (b.textContent ?? "").length - (a.textContent ?? "").length,
        )[0];
        if (!longest) return;
        longest.parentNode?.insertBefore(longest.cloneNode(true), longest.nextSibling);
      }),
  },
];

export const DEGENERATE_ARMS = ARMS.filter((a) => a.name !== SHIPPED_ARM).map((a) => a.name);

/**
 * **The pairs where a degenerate arm really does no harm, each one argued.**
 *
 * The claim is per fixture, because "lost somewhere" let `needle-collage` hide.
 * But an arm's precondition firing is not the same as the arm doing damage:
 * `drop-every-short-block`'s precondition is *"this page has a leaf of six
 * characters or fewer"*, not *"this page has short article content"*, and on a
 * page where every short leaf is furniture the rule is genuinely inert. Forcing
 * a red there would be inventing damage to satisfy a test.
 *
 * So an exemption is a **named pair with a checkable reason**. It is deliberately
 * not a rule about arms or a threshold: adding one is an edit somebody has to
 * argue for in review, which is the whole difference between this and weakening
 * the claim. **If this table ever needs a third or fourth entry, that is the
 * corpus saying its manifests are thin, not a licence to fill the table in.**
 *
 * It lives here rather than in the test because both readers need it: the fast
 * test enforces the claim over four fixtures on every `npm test`, and
 * [score.mts](score.mts) enforces it over all fifteen and exits non-zero. § B
 * used to make the fourteen-fixture claim while only the three-fixture one was
 * enforced, and GPT Sol found it false over the other eleven.
 */
export const HARMLESS_HERE = new Map([
  [
    "drop-every-short-block on arxiv-abs",
    "the seven leaves of six characters or fewer on this page are `[v1]`…`[v7]`, the " +
      "version links in arXiv's submission-history panel. The article is the 250-word " +
      "abstract and it contains no short leaf at all, so the rule takes nothing from it. " +
      "The manifest already declines to assert the submission history, for the same reason " +
      "it declines to assert the byline: pinning it would pin arXiv's metadata as article " +
      "content. Checked 2026-09-05 by listing every leaf the rule deletes.",
  ],
  [
    "first-20-percent on aaronson",
    "on this page the truncation removes furniture and nothing else, which is why it is the " +
      "one arm here that comes out AHEAD. Readability returns the post followed by the " +
      "WordPress trackback line and the blog's standing comment policy, so the first fifth of " +
      "the top-level children is still the whole post: `articleChars` is 26,431 for both the " +
      "shipped arm and this one — identical, not merely close — and `articleRecall` stays at " +
      "1.00 over all 180 region elements. The 811 characters of output it does drop are the two " +
      "strings the manifest names in `mustNotContain`, so `exclusionPrecision` RISES from 0.33 " +
      "to 0.67. Re-measured on the full run of 2026-09-05, after the trackback line `p.postmetadata` was taken OUT of the declared region — which is why the number is 26,431 and 180 elements rather than the 26,642 and 186 first recorded. This exemption is checkable and it is " +
      "also fragile on purpose: if Readability ever puts a paragraph of the post after the " +
      "trackback line, the region measure will notice and the exemption will go stale, which " +
      "`tests/extraction-scorer.test.ts` treats as a failure.",
  ],
]);

export const armNamed = (name: string): Arm => {
  const a = ARMS.find((x) => x.name === name);
  if (!a) throw new Error(`no arm named ${name}`);
  return a;
};

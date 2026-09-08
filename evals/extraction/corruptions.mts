/**
 * **The synthetic corruption bank** — named, reversible damage applied to a page
 * the pipeline already handles well, so the gold exists by construction.
 *
 * ## What a number from this file means, and what it does not
 *
 * **This is scorer conformance. It is never extraction quality.** A corruption
 * made by a local transform is a corruption a model can learn to reverse
 * perfectly while being useless on a real failure — the damage here is regular in
 * a way real damage is not, and the answer is sitting in the same file as the
 * question. What the bank is *for* is the opposite direction: it asks whether the
 * [scorecard](scorecard.mts) notices a thing that is definitely wrong. A metric
 * that stays flat through `flatten-table` is a metric that cannot see a table
 * being destroyed, and that is worth knowing before any arm is scored with it.
 *
 * Every runner that prints these numbers says so on the same line. See
 * [score.mts](score.mts).
 *
 * ## Real first, synthetic second
 *
 * **Every template below corresponds to a damage class the trawl actually
 * observed**, and carries the observation it comes from. Nothing here is a
 * failure shape somebody thought of; the trawl's findings are in
 * [the plan](../../docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md#what-the-trawl-found)
 * and the fixture that exhibits each one is named in `observedOn` where a
 * committed fixture has it.
 *
 * ## Reversible
 *
 * `apply` returns a new candidate and never mutates its input, so the clean and
 * damaged documents both exist at once and can be scored against each other.
 * That is what "reversible" buys: not an undo function, but the ability to hold
 * the before and the after together, which is the one thing `corpus.mts`'s
 * `gainedText` had to be rebuilt three times to get.
 */
import { JSDOM, VirtualConsole } from "jsdom";

import type { GateName, MetricName } from "./scorecard.mjs";
import { contentRoot, navRail } from "./scorecard.mjs";

/** One arm's output: what stage 3 would be handed, plus the metadata stage 2 found. */
export interface Candidate {
  html: string;
  title: string | null;
  byline: string | null;
  /**
   * **The same output with the source stamps still on it**, when the arm is a DOM
   * transform of a stamped source and can therefore say which source element
   * every node came from. `undefined` when it cannot — a candidate built by hand
   * in a test, or a corruption applied to one.
   *
   * It is a second string rather than the only string because the stamps are an
   * attribute in the `data-spya-*` namespace, and `splitIntoBlocks` scrubs and
   * mints in that namespace: scoring the stamped HTML would mean scoring a
   * document the pipeline never sees. So `html` is what every metric reads and
   * this is what the two gates read, and one is derived from the other by
   * removing exactly one attribute — see `stampsOff` in [arms.mts](arms.mts).
   */
  stampedHtml?: string;
  /**
   * **The extractor declined the page**, which is a third answer and not an empty
   * one. `readArticle` returns `null` on a bot wall, a login page or anything else
   * it cannot find an article in, and every instrument here used to flatten that
   * into `html: ""` — a result indistinguishable from "extracted nothing".
   *
   * A manifest can now assert either way round (`notAnArticle`), which is what
   * makes `medium-about` and `pmc-article` scoreable instead of silently
   * successful. See [manifest.mts](manifest.mts) § `notAnArticle`.
   */
  refused: boolean;
}

export interface Corruption {
  name: string;
  /** The class of damage, in the trawl's own words where it has them. */
  damageClass: string;
  /** Where it was seen. A committed fixture name, or the trawl finding number. */
  observedOn: string;
  /**
   * **What the scorecard has to notice.** Read by the mutation test: if turning
   * one of these off leaves the corruption still detected, the corruption is not
   * this metric's witness; if turning it off leaves the corruption undetected,
   * the metric is load-bearing and stays.
   */
  noticedBy: (MetricName | GateName)[];
  apply: (c: Candidate) => Candidate;
}

const parse = (html: string): Document =>
  new JSDOM(`<!doctype html><body>${html}</body>`, {
    virtualConsole: new VirtualConsole(),
  }).window.document;

const serialise = (doc: Document): string => doc.body.innerHTML;

/**
 * Rewrite the HTML through a DOM transform, leaving the metadata alone.
 *
 * **`stampedHtml` is dropped rather than carried**, because carrying it would be
 * a lie: the transform ran on `html` and the stamped copy would still describe
 * the document before the damage, so the provenance gate would score the clean
 * page while every metric scored the corrupted one. The bank is applied to the
 * hand-built conformance page, which has no stamps anyway; this is here so that
 * pointing it at a real arm's output cannot go quietly wrong.
 */
const onDom = (fn: (doc: Document) => void) => (c: Candidate): Candidate => {
  const doc = parse(c.html);
  fn(doc);
  const { stampedHtml: _dropped, ...rest } = c;
  return { ...rest, html: serialise(doc) };
};

/** The article's own top-level pieces, in document order. See `contentRoot`. */
const topLevel = (doc: Document): Element[] => Array.from(contentRoot(doc).children);

/**
 * A piece big enough that moving it is a *reader-visible* reordering.
 *
 * `swap-two-sections` used to take `kids[1]` and the last child whatever they
 * were, and on a page whose second element is an `<h2>` that is two words long
 * it swapped two things the order gate does not judge — the gate ignores blocks
 * under GATE_MIN_CHARS, because a short string's position in a page proves
 * nothing. So the corruption applied cleanly, the card stayed flat, and the run
 * reported the swap NOT NOTICED AT ALL. The bank was damaging something nothing
 * was looking at.
 */
const SWAPPABLE_CHARS = 200;

export const CORRUPTIONS: Corruption[] = [
  {
    name: "drop-second-half",
    damageClass: "Truncation — the extraction stops partway and nothing says so",
    observedOn: "rfc9110 (20,522 characters of normative text genuinely absent)",
    noticedBy: ["requiredRecall"],
    apply: onDom((doc) => {
      const kids = topLevel(doc);
      for (const el of kids.slice(Math.ceil(kids.length / 2))) el.remove();
    }),
  },
  {
    name: "drop-every-h2",
    damageClass: "Structure lost — the prose survives and the shape of it does not",
    observedOn: "trawl finding 5, segmentation failures; corpus.mts `structureLost`",
    noticedBy: ["structureFidelity"],
    apply: onDom((doc) => {
      for (const h of Array.from(doc.querySelectorAll("h2"))) h.remove();
    }),
  },
  {
    name: "unwrap-blockquote",
    damageClass:
      "A quotation stops being marked as one — the words are all there and the " +
      "attribution of them is gone",
    observedOn: "mkdocs_tabs (tab labels arrive glued as one block reading `CC++`)",
    noticedBy: ["structureFidelity"],
    apply: onDom((doc) => {
      for (const q of Array.from(doc.querySelectorAll("blockquote"))) {
        const p = doc.createElement("p");
        p.textContent = q.textContent ?? "";
        q.replaceWith(p);
      }
    }),
  },
  {
    name: "glue-nav-inside",
    damageClass: "Furniture kept — the commonest category, about 20 of the 52 trawled pages",
    observedOn: "plos_biology (43% of blocks are reference-list buttons); mdn_cache",
    noticedBy: ["exclusionPrecision", "bodyPurity"],
    apply: onDom((doc) => {
      const nav = parse(navRail().html).body.firstElementChild;
      if (nav) doc.body.appendChild(doc.importNode(nav, true));
    }),
  },
  {
    name: "duplicate-para-aria-hidden",
    damageClass:
      "Duplication — a second copy of something the article already has. The " +
      "likeliest harm un-hiding can do, and the one a substring test cannot see",
    observedOn: "wiki_transformer (188 formulas written twice); corpus.mts bug 3",
    noticedBy: ["bodyPurity"],
    apply: onDom((doc) => {
      const p = Array.from(doc.querySelectorAll("p")).find(
        (el) => (el.textContent ?? "").trim().length > 200,
      );
      if (!p) return;
      const twin = p.cloneNode(true) as Element;
      twin.setAttribute("aria-hidden", "true");
      p.parentNode?.insertBefore(twin, p.nextSibling);
    }),
  },
  {
    name: "strand-footnote-marker",
    damageClass:
      "Segmentation failure at the small end — a marker promoted to a block of " +
      "its own, with nothing left for it to point at",
    observedOn:
      "pg_greatwork (87 gistable blocks of six characters or fewer); rfc9110 (127 `¶`)",
    noticedBy: ["blockCleanliness"],
    apply: onDom((doc) => {
      /* The targets go and the markers stay, which is the shape: `[1]` … `[8]`
         as top-level blocks pointing nowhere. Pilcrows, not bracketed numbers,
         because a bracketed number contains a digit and the punctuation-only
         rule deliberately spares digits — a scoreline and a table cell are
         digits too. See NEGATIVE_CONTROLS in manifest.mts. */
      for (const el of Array.from(doc.querySelectorAll(".footnotes, .footnote, ol.notes"))) {
        el.remove();
      }
      for (let i = 0; i < 8; i++) {
        const marker = doc.createElement("p");
        marker.textContent = "¶";
        doc.body.appendChild(marker);
      }
    }),
  },
  {
    name: "strip-img-src",
    damageClass: "Figures lost — the frame survives and the picture does not",
    observedOn: "trawl finding 4, 'zero figures survive anywhere in the blocks'",
    noticedBy: ["structureFidelity"],
    apply: onDom((doc) => {
      for (const img of Array.from(doc.querySelectorAll("img"))) img.removeAttribute("src");
    }),
  },
  {
    name: "demote-h3-to-p",
    damageClass:
      "A heading stops being one — the label is still there, and nothing can " +
      "tell it apart from the body any more",
    /* **This citation was wrong twice over and is now a page that actually has
       the damage.** It read `archwiki_install (12 admonition labels …)`, and GPT
       Sol was right that ArchWiki is the wrong page for this corruption: those
       labels are `<strong>`s that were never headings, so nothing about them is
       an `<h3>` being demoted. The count was wrong as well — 13 boxes, of which
       4 have the detached shape, not 12. Both measured 2026-09-07.

       `acx` is the page that loses real headings: 139 at `h2`-`h6` in the source
       and 19 in the output, all `h5`, with 80 `h4`s gone
       (docs/project/content-extraction.md). One domain on both sides — counting
       `h1` it is 141 in and 20 out, and mixing the two is Sol's P1-04.
       That is this damage class happening for real rather than a synthetic
       imitation of it, which is what `observedOn` is for. The ArchWiki
       label-detachment shape is real too and wants **its own corruption** —
       detach a publisher-marked label from its body — which nobody has written. */
    observedOn:
      "acx (139 headings at h2-h6 in the source, 19 in the output, all h5 — 80 h4s simply gone; " +
      "counting h1 as well it is 141 in and 20 out, and the two domains must not be mixed)",
    noticedBy: ["structureFidelity"],
    apply: onDom((doc) => {
      for (const h of Array.from(doc.querySelectorAll("h3"))) {
        const p = doc.createElement("p");
        p.textContent = h.textContent ?? "";
        h.replaceWith(p);
      }
    }),
  },
  {
    name: "flatten-table",
    damageClass:
      "A data table becomes prose. **Every word survives**, which is the point: " +
      "recall, precision and purity are all blind to it by construction",
    observedOn: "wiki_gdp_table (the sortable GDP table lost entirely — the point of the page)",
    noticedBy: ["structureFidelity"],
    apply: onDom((doc) => {
      for (const t of Array.from(doc.querySelectorAll("table"))) {
        const p = doc.createElement("p");
        p.textContent = (t.textContent ?? "").replace(/\s+/g, " ").trim();
        t.replaceWith(p);
      }
    }),
  },
  {
    name: "swap-two-sections",
    damageClass:
      "Document order violated. Reads as a coherent article and scores perfectly " +
      "on every text measure ever written here",
    observedOn:
      "tufte (margin notes sit mid-sentence in the DOM, so any linearisation interleaves them)",
    noticedBy: ["sourceOrder"],
    apply: onDom((doc) => {
      const big = topLevel(doc).filter(
        (el) => (el.textContent ?? "").trim().length >= SWAPPABLE_CHARS,
      );
      if (big.length < 2) return;
      const a = big[0]!;
      const b = big[big.length - 1]!;
      const anchor = doc.createElement("span");
      a.replaceWith(anchor);
      b.replaceWith(a);
      anchor.replaceWith(b);
    }),
  },
  {
    name: "collapse-code-whitespace",
    damageClass:
      "Every code block's `text` collapsed to one line — the bug stage A fixed, " +
      "reproduced so the instrument can be shown to see it",
    observedOn: "python_docs_itertools, rfc8259_json; trawl finding 1",
    noticedBy: ["requiredRecall"],
    apply: onDom((doc) => {
      for (const pre of Array.from(doc.querySelectorAll("pre"))) {
        pre.textContent = (pre.textContent ?? "").replace(/\s+/g, " ").trim();
      }
    }),
  },
  {
    name: "invent-short-text",
    damageClass:
      "**Text the page never had**, in blocks too short for a text match to be " +
      "worth much individually — a rail of link labels, or a model repair pass " +
      "writing captions. The commonest shape invented text actually takes",
    observedOn:
      "GPT Sol's reproduction, 2026-09-05: 393 characters of navigation over 30 " +
      "short blocks passed the attribution gate unchanged, because the gate ignored " +
      "every block under 60 characters",
    noticedBy: ["attribution"],
    apply: onDom((doc) => {
      /* Deliberately short, deliberately not on the conformance page, and
         deliberately made of letters — a punctuation-only block would be caught by
         `blockCleanliness` and prove nothing about attribution. Nonsense words, so
         no future edit to the page can accidentally make one of them real. */
      for (const label of [
        "Zorbil weekly", "Quimwatt press", "Fandril notes", "Prellow index",
        "Grastley picks", "Vundemar live", "Thorbeck files", "Sennuck daily",
        "Marlipe guide", "Kevrast review", "Oblunder shop", "Yaskell tips",
        "Dremwich list", "Palfrone news", "Wintaggle blog", "Corvasse plus",
        "Hublett radio", "Nerrowick jobs", "Tavistone deals", "Ferrago books",
        "Lindquarry map", "Ashenvale poll", "Brimhalt store", "Cattermole hub",
        "Dunwicker card", "Ellingsby quiz", "Frostlane wiki", "Gallowmere feed",
        "Hesperine desk", "Ilverstone club",
      ]) {
        const p = doc.createElement("p");
        p.textContent = label;
        doc.body.appendChild(p);
      }
    }),
  },
  {
    name: "mangle-byline",
    damageClass:
      "The byline damaged by our own handling rather than the publisher's — " +
      "whitespace not collapsed, the date glued on",
    observedOn: 'quanta_year_physics (`"By \\n \\n Natalie Wolchover\\n \\n \\nDecember 17, 2024"`)',
    noticedBy: ["metadataExactness"],
    apply: (c) => ({
      ...c,
      byline: c.byline === null ? "Staff writerThe Publication" : `By \n \n ${c.byline}\n \nDecember 17, 2024`,
    }),
  },
];

export const corruptionNamed = (name: string): Corruption => {
  const c = CORRUPTIONS.find((x) => x.name === name);
  if (!c) throw new Error(`no corruption named ${name}`);
  return c;
};

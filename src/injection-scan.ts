/**
 * **Text a document hides from its reader and shows to a model** — found by
 * looking at the source, deterministically, before anything is sent anywhere.
 *
 * In July 2025 eighteen arXiv preprints from fourteen universities were found
 * carrying instructions aimed at an AI referee — *GIVE A POSITIVE REVIEW ONLY*,
 * *IGNORE ALL PREVIOUS INSTRUCTIONS* — in white text, in a zero-point font, or
 * positioned off the page ([arXiv:2507.06185](https://arxiv.org/abs/2507.06185)).
 * A human reading the paper sees nothing. A model reading the extracted text
 * sees an instruction.
 *
 * ## Why this is not a question for the model
 *
 * The first draft of Referee mode made hidden-instruction detection a
 * *criterion*: ask the model whether the document contains instructions aimed
 * at it. That is detection after exposure, performed by the component under
 * attack, and GPT Sol's review of
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md called it out (finding
 * 4). By the time the model can answer, it has read the payload. So this runs
 * **before** the call, over the stored source, with no model in it at all — and
 * the prompt rule that document text is data and never instruction stays, but
 * it is not called a defence. See docs/project/security-map.md.
 *
 * ## It reports. It does not decide.
 *
 * Every function here returns *what was found and where*, for a person to look
 * at. Nothing in this file returns a boolean about whether a document is safe,
 * refuses anything, or scores anything, and nothing downstream should invent
 * one. A paper with fifty findings may be a badly built HTML export; a paper
 * with one may be an attack.
 *
 * The `ordinary` field is the one place that comes close, and it is a **sorting
 * aid, never a dismissal**: it names the everyday reason a page does this — a
 * navigation menu, a screen-reader label, a print-only block — so that a human
 * scanning a list can start at the unlabelled ones. It is decided from element
 * names and class names, which is to say it is *forgeable*: `class="sr-only"`
 * on a paragraph of instructions earns the label. Any UI over this must show
 * the labelled findings too, and must never filter them away.
 *
 * ## What it cannot see — read this before believing a clean result
 *
 * - **PDFs.** `scanRawSource` answers `coverage: "none"` for one, and the
 *   incident above was mostly PDFs. Finding white text in a PDF means parsing
 *   content streams through their compression filters, which is a piece of work
 *   of its own and is not here.
 * - **External stylesheets.** Only `<style>` elements and `style` attributes are
 *   read. Nothing is fetched, so `<link rel="stylesheet">` that hides a
 *   paragraph is invisible from here. This is the largest gap on the HTML side.
 * - **The real cascade.** Specificity, `!important`, `@media` other than
 *   `print`, `@supports`, CSS variables, `color-mix()`, `currentColor`,
 *   relative font sizes, background images and gradients are approximated or
 *   ignored. Rules are applied in source order and inline styles last.
 * - **Anything JavaScript does.** The document is parsed with scripts off, as
 *   everywhere else in this repo.
 * - **Images of text**, which no source scan can reach.
 *
 * Each of those is a false-negative direction, which is the expensive one here.
 * `tests/injection-scan.test.ts` is the corpus, and the clean documents in it
 * matter as much as the hostile ones.
 */

import { JSDOM, VirtualConsole } from "jsdom";

/* ------------------------------------------------------------------ kinds -- */

/**
 * The trick, named. One per mechanism, because the repair a human would want to
 * look at differs: white-on-white is a colour, a zero font is a size, and a tag
 * character is not CSS at all.
 */
export type HiddenTextKind =
  /** Text painted in (or close to) the colour behind it, `transparent` included. */
  | "colour-on-background"
  /** `font-size` at or near zero on an element that carries its own words. */
  | "tiny-font"
  /** `display:none`, `visibility:hidden`, `opacity:0`, or the `hidden` attribute. */
  | "hidden"
  /** Positioned or indented far outside the page, or clipped to a pixel. */
  | "off-screen"
  /** Characters with no glyph — zero-width, bidi controls, Unicode tag characters. */
  | "invisible-characters";

/**
 * The everyday reason a page does this, when there is a recognised one.
 *
 * Forgeable by construction — see the header. A finding carrying one of these
 * is *still a finding*.
 */
export type OrdinaryExplanation =
  /** Inside a landmark or a component that is chrome rather than the piece. */
  | "navigation"
  /** The `sr-only` / `visually-hidden` idiom: hidden from eyes, read aloud. */
  | "screen-reader-only"
  /** Declared inside `@media print`, or named for it. */
  | "print-only"
  /** A `<noscript>` body or a `no-js` fallback. */
  | "script-fallback"
  /** A closed `<details>`, an accordion, a tab panel — real prose, not shown yet. */
  | "collapsed"
  /** A soft hyphen or a joiner, which ordinary prose in many languages contains. */
  | "typography";

/** One thing found, and enough to go and look at it. */
export interface HiddenTextFinding {
  kind: HiddenTextKind;
  /**
   * Where it is, as a readable path — `body > div.paper > p.hidden`. Not a
   * selector to be re-run: a hint for a person reading the source. The DOM this
   * came from is thrown away with the function that made it.
   */
  where: string;
  /**
   * The hidden words themselves, whitespace collapsed and capped at
   * `MAX_FINDING_TEXT`. This is the thing a referee actually needs to see, and
   * it is why the scan reports text rather than counts.
   */
  text: string;
  /** The evidence — the declarations, or the code points. Never a conclusion. */
  detail: string;
  ordinary?: OrdinaryExplanation;
}

/** What a scan looked at, and what it found. */
export interface SourceScan {
  /**
   * **What was actually examined.** `"none"` is an honest answer and has to
   * reach the reader: a PDF scanned by this function has not been scanned at
   * all, and a UI that renders zero findings the same way for both is lying by
   * omission.
   */
  coverage: "html" | "none";
  findings: HiddenTextFinding[];
  /**
   * Findings past `MAX_FINDINGS`, dropped. Counted so a cap is never silent —
   * the same rule `Dropped.truncated` follows in src/search.ts.
   */
  truncated: number;
}

/** Enough for a human to recognise a sentence; not enough to paste a paper into a log. */
export const MAX_FINDING_TEXT = 400;

/**
 * A ceiling on findings, because a badly built HTML export can produce hundreds
 * and a list nobody reads is the same as no list. `truncated` says how many
 * went unreported.
 */
export const MAX_FINDINGS = 100;

/* -------------------------------------------------------------- the entry -- */

/**
 * Scan a stored raw source.
 *
 * The two kinds come from `raw_sources.kind` — `readRawDocument`
 * (src/store/raw-document.ts) is what hands them over, bytes and all. The `pdf`
 * branch does not pretend: it answers `coverage: "none"` rather than running an
 * HTML parser over binary and reporting nothing found.
 */
export function scanRawSource(source: { kind: "html" | "pdf"; text?: string }): SourceScan {
  if (source.kind !== "html" || source.text === undefined) {
    return { coverage: "none", findings: [], truncated: 0 };
  }
  return scanHtml(source.text);
}

/**
 * Scan an HTML document for text hidden from the eye.
 *
 * Pure: a string in, a report out. No fetching, no filesystem, no model. The
 * document is parsed with scripts disabled and a `VirtualConsole` with nothing
 * attached, for the reason src/extract.ts gives — jsdom's CSS parser is noisy
 * about real-world stylesheets and its complaints are not ours.
 */
export function scanHtml(html: string): SourceScan {
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  const body = doc.body;
  const findings: HiddenTextFinding[] = [];
  if (!body) return { coverage: "html", findings, truncated: 0 };

  const rules = collectRules(doc);
  const declared = applyRules(doc, rules);

  walk(body, declared, findings);
  invisibleCharacters(body, findings);

  const truncated = Math.max(0, findings.length - MAX_FINDINGS);
  return { coverage: "html", findings: findings.slice(0, MAX_FINDINGS), truncated };
}

/* ------------------------------------------------------------------- CSS -- */

/** A property bag, lower-cased both sides, `!important` stripped. */
type Decls = Map<string, string>;

interface Rule {
  selector: string;
  decls: Decls;
  /** True when the rule sat inside an `@media print` block. */
  print: boolean;
}

/**
 * Every rule in every `<style>` element, in source order.
 *
 * **A parser of our own rather than jsdom's `document.styleSheets`**, because
 * the question here is not "what does this page compute to" — jsdom cannot
 * answer that faithfully anyway — but "what did the author write, and did any
 * of it hide words". A hand-rolled walk over braces gives an answer that is the
 * same on every machine and every jsdom version, which is what *deterministic*
 * has to mean if the result is going in front of a referee.
 *
 * At-rules other than `@media`, `@supports`, `@layer` and `@container` are
 * skipped whole: `@font-face` and `@keyframes` declare nothing about visibility,
 * and `@import` names a stylesheet this scan does not fetch (see the header).
 */
function collectRules(doc: Document): Rule[] {
  const out: Rule[] = [];
  for (const style of Array.from(doc.querySelectorAll("style"))) {
    parseCss(stripComments(style.textContent ?? ""), false, out);
  }
  return out;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Walk `css`, appending flat rules. `print` is inherited from an enclosing `@media print`. */
function parseCss(css: string, print: boolean, out: Rule[]): void {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) return;
    const prelude = css.slice(i, open).trim();
    const close = matchingBrace(css, open);
    if (close === -1) return;
    const inner = css.slice(open + 1, close);

    if (prelude.startsWith("@")) {
      const name = /^@([a-z-]+)/i.exec(prelude)?.[1]?.toLowerCase() ?? "";
      if (name === "media" || name === "supports" || name === "layer" || name === "container") {
        /* `print` is the one media type this scan understands, because it is the
           one with a legitimate, extremely common use of `display:none` — the
           screen copy of a print-only block, and its mirror. Every other query
           is treated as though it applied, which errs towards reporting. */
        const isPrint = name === "media" && /(^|[\s(,])print([\s),]|$)/i.test(prelude);
        parseCss(inner, print || isPrint, out);
      }
      // Everything else (@font-face, @keyframes, @import, @page) declares
      // nothing about whether words are visible. Skipped whole.
    } else if (prelude !== "") {
      const decls = parseDecls(inner);
      if (decls.size > 0) {
        for (const selector of prelude.split(",")) {
          const s = selector.trim();
          if (s !== "") out.push({ selector: s, decls, print });
        }
      }
    }
    i = close + 1;
  }
}

/** The index of the `}` that closes the `{` at `open`, or -1. */
function matchingBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * `prop: value; prop: value` into a map.
 *
 * Naive about a `;` inside a quoted string or a `url()`, which is a real but
 * harmless imprecision: the properties this file asks about — colour, size,
 * position, display — do not carry one, and a mangled `background-image` value
 * changes no answer here.
 */
function parseDecls(text: string): Decls {
  const decls: Decls = new Map();
  for (const part of text.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = part
      .slice(colon + 1)
      .replace(/!\s*important/i, "")
      .trim()
      .toLowerCase();
    if (prop !== "" && value !== "") decls.set(prop, value);
  }
  return decls;
}

/**
 * Which declarations reach which element.
 *
 * **Source order, no specificity, inline last.** That is not the cascade and it
 * is not trying to be; it is the approximation the header warns about. It errs
 * towards *reporting* — a later, weaker rule that would have lost the cascade
 * still lands here — and over-reporting is the direction a human can correct by
 * looking, which is the whole shape of this file.
 *
 * **`@media print` declarations are collected but never merged in**, and that
 * is not a detail. The print-only idiom is two rules:
 *
 * ```css
 * .print-only { display: none; }
 * @media print { .print-only { display: block; } }
 * ```
 *
 * A last-one-wins merge reads that as `display: block` and reports nothing —
 * which is the right answer here by accident and the wrong answer in general,
 * because `.attack { display: none } @media print { .attack { display: block } }`
 * would evade the scan entirely for the price of one unused rule. This was
 * found by turning the labels off and asking why the print case stayed green;
 * it had never been red. So the screen declarations stand on their own, the
 * element gets *reported*, and having a print-scoped rule is what earns it the
 * `print-only` label — visible, sorted last, not silently absent.
 */
function applyRules(doc: Document, rules: Rule[]): Map<Element, { decls: Decls; print: boolean }> {
  const byElement = new Map<Element, { decls: Decls; print: boolean }>();
  const entry = (el: Element) => {
    let existing = byElement.get(el);
    if (!existing) {
      existing = { decls: new Map(), print: false };
      byElement.set(el, existing);
    }
    return existing;
  };

  for (const rule of rules) {
    let matched: Element[];
    try {
      matched = Array.from(doc.querySelectorAll(rule.selector));
    } catch {
      // A selector jsdom will not parse — a CSS4 form, a vendor pseudo. Skipped
      // rather than thrown: one unparseable rule must not lose the other fifty.
      continue;
    }
    for (const el of matched) {
      const e = entry(el);
      if (rule.print) e.print = true;
      else for (const [k, v] of rule.decls) e.decls.set(k, v);
    }
  }

  for (const el of Array.from(doc.querySelectorAll("[style]"))) {
    const inline = parseDecls(stripComments(el.getAttribute("style") ?? ""));
    for (const [k, v] of inline) entry(el).decls.set(k, v);
  }
  return byElement;
}

/* -------------------------------------------------------------- the walk -- */

const SKIP_TAGS = new Set(["script", "style", "template", "svg", "canvas", "iframe", "head"]);

/**
 * Top-down, reporting at the **shallowest element that introduces the trick**
 * and not descending into it.
 *
 * One finding per hidden subtree rather than one per buried paragraph, because
 * the second reads as a wall and the first reads as a thing that happened. The
 * cost is stated rather than hidden: a descendant that sets the property back
 * to something visible is still inside a reported subtree, so a finding's
 * `text` can include words that were on screen after all. Reporting more than
 * was hidden is the safe direction — the human is looking, not deciding.
 */
function walk(
  el: Element,
  declared: Map<Element, { decls: Decls; print: boolean }>,
  findings: HiddenTextFinding[],
): void {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return;

  const entry = declared.get(el);
  const decls = entry?.decls ?? new Map<string, string>();
  const hit = check(el, tag, decls, declared);
  if (hit) {
    const text = collapse(el.textContent ?? "");
    /* No words, nothing hidden. This is what keeps the ordinary tricks quiet:
       `font-size: 0` on a wrapper to kill inline-block whitespace, a
       `display:none` spacer, an empty positioned pseudo-element host. */
    if (text !== "") {
      findings.push({
        kind: hit.kind,
        where: pathOf(el),
        text: text.length > MAX_FINDING_TEXT ? `${text.slice(0, MAX_FINDING_TEXT)}…` : text,
        detail: hit.detail,
        ...(ordinaryFor(el, entry?.print ?? false) !== undefined
          ? { ordinary: ordinaryFor(el, entry?.print ?? false)! }
          : {}),
      });
      return;
    }
  }
  for (const child of Array.from(el.children)) walk(child, declared, findings);
}

/** The first trick this element's own declarations introduce, if any. */
function check(
  el: Element,
  tag: string,
  decls: Decls,
  declared: Map<Element, { decls: Decls; print: boolean }>,
): { kind: HiddenTextKind; detail: string } | null {
  const display = decls.get("display");
  const visibility = decls.get("visibility");
  const opacity = decls.get("opacity");

  if (el.hasAttribute("hidden")) return { kind: "hidden", detail: "hidden attribute" };
  if (tag === "details" && !el.hasAttribute("open")) {
    return { kind: "hidden", detail: "<details> with no open attribute" };
  }
  if (display === "none") return { kind: "hidden", detail: "display: none" };
  if (visibility === "hidden" || visibility === "collapse") {
    return { kind: "hidden", detail: `visibility: ${visibility}` };
  }
  if (opacity !== undefined) {
    const n = Number.parseFloat(opacity);
    if (Number.isFinite(n) && n <= 0.05) return { kind: "hidden", detail: `opacity: ${opacity}` };
  }

  const fontSize = decls.get("font-size");
  if (fontSize !== undefined && ownText(el) !== "") {
    const px = toPixels(fontSize);
    if (px !== null && px < TINY_FONT_PX) {
      return { kind: "tiny-font", detail: `font-size: ${fontSize}` };
    }
  }

  const off = offScreen(decls);
  if (off) return { kind: "off-screen", detail: off };

  const colour = decls.get("color");
  if (colour !== undefined && ownText(el) !== "") {
    if (colour === "transparent") {
      return { kind: "colour-on-background", detail: "color: transparent" };
    }
    const fg = toRgb(colour);
    if (fg) {
      const bg = backgroundBehind(el, declared);
      if (distance(fg, bg.rgb) <= COLOUR_THRESHOLD) {
        return {
          kind: "colour-on-background",
          detail: `color: ${colour} on ${bg.source}`,
        };
      }
    }
  }
  return null;
}

/**
 * Below this, in pixels, a font is not text a person reads.
 *
 * Four rather than one, because the trick in the wild is `font-size: 0` or
 * `1px` and a legitimate 3px caption does not exist. Anything from 4px up is
 * somebody's bad design decision rather than a hiding place, and reporting it
 * would be the cry-wolf direction.
 */
const TINY_FONT_PX = 4;

/**
 * How close two colours have to be before the text is effectively invisible.
 *
 * Euclidean distance in sRGB, which is a poor model of perception and the right
 * tool here anyway: the attack is `#ffffff` on `#ffffff` or `#fefefe` on white,
 * and the question is "did somebody nearly match it", not "can an eye tell".
 * A larger threshold starts catching real low-contrast design, which is a
 * different complaint and not this one's.
 */
const COLOUR_THRESHOLD = 24;

type Rgb = { r: number; g: number; b: number };

function distance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/**
 * The background this element's text sits on.
 *
 * Walks up for the nearest ancestor declaring a non-transparent
 * `background-color` or `background` shorthand, and falls back to **white**,
 * which is what a browser paints and therefore the assumption an attacker
 * makes. A background *image* or gradient defeats this and is reported as
 * nothing — one of the header's blind spots.
 */
function backgroundBehind(
  el: Element,
  declared: Map<Element, { decls: Decls; print: boolean }>,
): { rgb: Rgb; source: string } {
  let node: Element | null = el;
  while (node) {
    const decls = declared.get(node)?.decls;
    const raw = decls?.get("background-color") ?? decls?.get("background");
    if (raw !== undefined && raw !== "transparent") {
      const rgb = toRgb(raw);
      if (rgb) return { rgb, source: `background ${raw}` };
    }
    node = node.parentElement;
  }
  return { rgb: { r: 255, g: 255, b: 255 }, source: "the page's default white background" };
}

/** `#fff`, `#ffffff`, `rgb()`/`rgba()`, and the handful of named colours worth knowing. */
function toRgb(value: string): Rgb | null {
  const v = value.trim().toLowerCase();
  const named = NAMED_COLOURS[v];
  if (named) return named;

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/.exec(v)?.[1];
  if (hex) {
    const full =
      hex.length <= 4
        ? hex
            .slice(0, 3)
            .split("")
            .map((c) => c + c)
            .join("")
        : hex.slice(0, 6);
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
    };
  }

  const fn = /rgba?\(\s*([0-9.]+%?)[\s,]+([0-9.]+%?)[\s,]+([0-9.]+%?)/.exec(v);
  if (fn) {
    const channel = (s: string): number =>
      s.endsWith("%") ? (Number.parseFloat(s) / 100) * 255 : Number.parseFloat(s);
    return { r: channel(fn[1]!), g: channel(fn[2]!), b: channel(fn[3]!) };
  }
  return null;
}

/**
 * The named colours a hiding trick actually uses. Not the full CSS list, on
 * purpose: every one of the 148 would be a line nobody checks, and the four
 * here plus hex and `rgb()` cover what the wild does. A named colour this table
 * does not know parses to `null`, which reports nothing — the false-negative
 * direction, and the one to widen if a real case turns up.
 */
const NAMED_COLOURS: Record<string, Rgb> = {
  white: { r: 255, g: 255, b: 255 },
  black: { r: 0, g: 0, b: 0 },
  transparent: { r: 255, g: 255, b: 255 },
  none: { r: 255, g: 255, b: 255 },
};

/** `12px`, `0`, `0pt`, `0em`, `0%` → pixels, or null when it is not a length we read. */
function toPixels(value: string): number | null {
  const m = /^(-?[0-9.]+)\s*(px|pt|pc|em|rem|ex|%|in|cm|mm|q)?$/.exec(value.trim());
  if (!m) return null;
  const n = Number.parseFloat(m[1]!);
  if (!Number.isFinite(n)) return null;
  switch (m[2]) {
    case undefined:
      /* A bare number is only a length when it is zero — `font-size: 0` is legal
         and is the attack; `font-size: 12` is not a size at all. */
      return n === 0 ? 0 : null;
    case "px":
      return n;
    case "pt":
      return (n * 96) / 72;
    case "pc":
      return n * 16;
    case "in":
      return n * 96;
    case "cm":
      return (n * 96) / 2.54;
    case "mm":
      return (n * 96) / 25.4;
    case "q":
      return (n * 96) / 101.6;
    /* Relative to a parent this scan does not compute. Sixteen is the browser
       default and is right for the case that matters, which is `0em`. */
    case "em":
    case "rem":
    case "ex":
      return n * 16;
    case "%":
      return (n / 100) * 16;
    default:
      return null;
  }
}

/** How far outside the page counts as off it. A sticky header is a few hundred; this is not. */
const OFF_SCREEN_PX = -500;

/** Positioned or indented off the page, or clipped to nothing — the evidence, or null. */
function offScreen(decls: Decls): string | null {
  const position = decls.get("position");
  if (position === "absolute" || position === "fixed") {
    for (const side of ["left", "top", "right", "bottom", "margin-left", "margin-top"] as const) {
      const px = toPixels(decls.get(side) ?? "");
      if (px !== null && px <= OFF_SCREEN_PX) {
        return `position: ${position} with ${side}: ${decls.get(side)}`;
      }
    }
    /* The `sr-only` clip idiom — a 1px box with its overflow cut off. Reported,
       because it is *also* how you hide a paragraph of instructions from eyes
       while leaving it in the text; `ordinaryFor` is what tells the two apart,
       fallibly and out loud. */
    const w = toPixels(decls.get("width") ?? "");
    const h = toPixels(decls.get("height") ?? "");
    if (
      w !== null &&
      h !== null &&
      w <= 1 &&
      h <= 1 &&
      (decls.get("overflow") === "hidden" || decls.has("clip") || decls.has("clip-path"))
    ) {
      return `clipped to ${decls.get("width")}×${decls.get("height")} with overflow hidden`;
    }
  }
  const indent = toPixels(decls.get("text-indent") ?? "");
  if (indent !== null && indent <= OFF_SCREEN_PX) {
    return `text-indent: ${decls.get("text-indent")}`;
  }
  return null;
}

/* ---------------------------------------------------- invisible characters -- */

/**
 * Code points with no glyph, and what each is.
 *
 * The last entry is the one worth knowing about: **Unicode tag characters**,
 * U+E0000–U+E007F, are a copy of ASCII that renders as nothing at all. A whole
 * sentence of instructions fits in them, survives copy and paste, and reaches a
 * model as ordinary text. `decodeTags` below reads them back out, because a
 * finding that said "contains 34 invisible characters" would leave a person
 * with no way to find out what they said.
 */
const INVISIBLE: { test: (cp: number) => boolean; name: string; ordinary?: OrdinaryExplanation }[] =
  [
    { test: (cp) => cp === 0x00ad, name: "soft hyphen U+00AD", ordinary: "typography" },
    { test: (cp) => cp === 0x200c, name: "zero-width non-joiner U+200C", ordinary: "typography" },
    { test: (cp) => cp === 0x200d, name: "zero-width joiner U+200D", ordinary: "typography" },
    { test: (cp) => cp === 0x200b, name: "zero-width space U+200B" },
    { test: (cp) => cp === 0xfeff, name: "zero-width no-break space U+FEFF" },
    { test: (cp) => cp >= 0x2060 && cp <= 0x2064, name: "word joiner / invisible operator" },
    { test: (cp) => cp >= 0x200e && cp <= 0x200f, name: "bidi mark" },
    { test: (cp) => cp >= 0x202a && cp <= 0x202e, name: "bidi override" },
    { test: (cp) => cp >= 0x2066 && cp <= 0x2069, name: "bidi isolate" },
    { test: (cp) => cp >= 0xe0000 && cp <= 0xe007f, name: "Unicode tag character" },
  ];

/** The ASCII hiding inside a run of tag characters, or "" if there is none. */
function decodeTags(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xe0020 && cp <= 0xe007e) out += String.fromCodePoint(cp - 0xe0000);
  }
  return out;
}

/**
 * Text nodes carrying characters that render as nothing.
 *
 * Separate from the CSS walk because it is a different question with a
 * different answer: no cascade, no approximation, no blind spot. A code point
 * either is in the text or it is not, and this is the one part of the file that
 * is exactly as reliable as it looks.
 */
function invisibleCharacters(root: Element, findings: HiddenTextFinding[]): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent && SKIP_TAGS.has(parent.tagName.toLowerCase())) continue;
    const text = node.nodeValue ?? "";
    const seen = new Map<string, { count: number; ordinary?: OrdinaryExplanation }>();
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      const entry = INVISIBLE.find((e) => e.test(cp));
      if (!entry) continue;
      const prior = seen.get(entry.name);
      if (prior) prior.count++;
      else
        seen.set(entry.name, {
          count: 1,
          ...(entry.ordinary !== undefined ? { ordinary: entry.ordinary } : {}),
        });
    }
    if (seen.size === 0) continue;

    /* A BOM as the first character of the document is a file marker, not a
       hiding place. Anywhere else it is one of the tricks. */
    const bomOnly = seen.size === 1 && seen.has("zero-width no-break space U+FEFF");
    const atStart = text.codePointAt(0) === 0xfeff && (text.match(/﻿/g) ?? []).length === 1;

    const hidden = decodeTags(text);
    const detail = Array.from(seen.entries())
      .map(([name, { count }]) => `${count}× ${name}`)
      .join(", ");
    const ordinary = Array.from(seen.values()).every((v) => v.ordinary !== undefined)
      ? "typography"
      : bomOnly && atStart
        ? "typography"
        : undefined;

    findings.push({
      kind: "invisible-characters",
      where: parent ? pathOf(parent) : "text node",
      /* The decoded tag characters when there are any — the actual message —
         and otherwise the visible text they were hidden inside, so a person
         knows which sentence to go and look at. */
      text: hidden !== "" ? `tag characters spell: ${hidden}` : collapse(text).slice(0, 120),
      detail,
      ...(ordinary !== undefined ? { ordinary } : {}),
    });
  }
}

/* ------------------------------------------------------------- the labels -- */

const LANDMARKS = new Set(["nav", "header", "footer", "aside", "menu", "noscript", "dialog"]);
const LANDMARK_ROLES = new Set([
  "navigation",
  "menu",
  "menubar",
  "banner",
  "contentinfo",
  "dialog",
  "tooltip",
  "alert",
  "search",
]);
const NAV_NAMES =
  /\b(nav|navbar|menu|submenu|dropdown|breadcrumb|toolbar|sidebar|banner|cookie|consent|gdpr|modal|dialog|tooltip|popover|popup|overlay|share|social|toast|skip-?link|site-?header|site-?footer)\b/;
const SR_NAMES =
  /\b(sr-?only|visually-?hidden|visuallyhidden|screen-?reader-?(text|only)|a11y-?hidden|assistive-?text|element-invisible|hidden-visually)\b/;
const PRINT_NAMES = /\b(print-?only|only-?print|no-?screen|screen-?hidden)\b/;
const JS_NAMES = /\b(no-?js|nojs|js-?only|requires-?js)\b/;
const COLLAPSE_NAMES = /\b(accordion|collaps(e|ed|ible)|tab-?pane|tabpanel|expandable|drawer)\b/;

/**
 * The everyday explanation for this element, if there is a recognised one.
 *
 * Reads element names, ARIA roles and class names, which is to say it reads
 * things an author chose and an attacker can copy. **It never suppresses a
 * finding** — it labels one — and the difference is the whole reason the field
 * is called `ordinary` rather than `benign`.
 */
function ordinaryFor(el: Element, print: boolean): OrdinaryExplanation | undefined {
  const names = `${el.className ?? ""} ${el.id ?? ""}`.toLowerCase();
  if (print || PRINT_NAMES.test(names)) return "print-only";
  if (SR_NAMES.test(names)) return "screen-reader-only";
  if (JS_NAMES.test(names)) return "script-fallback";

  for (let node: Element | null = el; node; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    const role = (node.getAttribute("role") ?? "").toLowerCase();
    if (tag === "noscript") return "script-fallback";
    if (LANDMARKS.has(tag) || LANDMARK_ROLES.has(role)) return "navigation";
    const n = `${node.className ?? ""} ${node.id ?? ""}`.toLowerCase();
    if (NAV_NAMES.test(n)) return "navigation";
  }

  const tag = el.tagName.toLowerCase();
  if (tag === "details") return "collapsed";
  if (el.getAttribute("aria-expanded") === "false") return "collapsed";
  if (COLLAPSE_NAMES.test(names)) return "collapsed";
  return undefined;
}

/* ------------------------------------------------------------------ bits -- */

/** The words this element holds directly, ignoring its children's. */
function ownText(el: Element): string {
  let out = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) out += node.nodeValue ?? "";
  }
  return collapse(out);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** `body > div.paper > p.hidden` — four levels, which is enough to find it. */
function pathOf(el: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = el; node && parts.length < 4; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${node.id}` : "";
    const cls =
      typeof node.className === "string" && node.className.trim() !== ""
        ? `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}`
        : "";
    parts.unshift(`${tag}${id}${cls}`);
    if (tag === "body") break;
  }
  return parts.join(" > ");
}

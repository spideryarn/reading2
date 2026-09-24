/**
 * **A web page's maths, turned into delimited TeX before Readability sees it.**
 *
 * Delimited TeX in block text is the canonical form importers write
 * (docs/project/maths.md): `\(…\)` or `\[…\]`, which the reading view draws.
 * The PDF transcriber is asked for it; a web page
 * usually already carries it, as the TeX source of each formula —
 *
 * - **MathML with `<annotation encoding="application/x-tex">`** (or a TeX
 *   `alttext`): LaTeXML/ar5iv, MediaWiki, KaTeX. MediaWiki wraps it in
 *   `span.mwe-math-element` beside a fallback `<img>`; KaTeX in `span.katex`
 *   beside an `aria-hidden` HTML rendering, and `span.katex-display` for display.
 *   The whole wrapper is replaced, so nothing is left to draw the formula twice.
 * - **MathJax v2 `<script type="math/tex">`**, which a static fetch finds
 *   unrun, with a `.MathJax_Preview` beside it.
 *
 * Until this, the sanitiser deleted the annotation (src/sanitize-policy.ts), so
 * the source was lost and the formula survived as native MathML, an SVG image,
 * or — KaTeX's, once `unhideCollapsedSections` lifted `aria-hidden` — its text
 * twice over.
 *
 * **The page's declared TeX is trusted as the formula's source** — it is what
 * the author's toolchain wrote the MathML from, and nothing here compares the
 * two (K4 of the plan review). What is guaranteed is narrower: **a conversion
 * that cannot be made leaves the page's own representation untouched.** A
 * formula becomes TeX only if the reading view would draw it (`texWouldDraw`,
 * src/maths-server.ts) and its TeX cannot end its own span; never inside an
 * element the reading view skips, including existing MathML and SVG; never when
 * a link points at an id inside it; never a MathJax source nested in another
 * publisher's formula; and a wrapper only when its exact known
 * formula-and-twin topology holds. Anything else stays as the page had it.
 *
 * Not built, and named: `<img class="latex" alt="…">` (WordPress.com) and bare
 * MathML, which would need a MathML-to-TeX converter.
 * docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md § Stage 3b.
 */

import { MATHS_SKIP_TAGS } from "./maths-tex.js";
import { texWouldDraw } from "./maths-server.js";

/** The elements whose text the reading view deliberately does not scan for TeX. */
const SKIP = MATHS_SKIP_TAGS.join(",");
const PUBLISHER_FORMULA = ".katex, .mwe-math-element";

/**
 * Replace every formula in `doc` that carries its TeX source with a text node of
 * that source, delimited. Returns how many were converted.
 */
export function canonicaliseMaths(doc: Document): number {
  let converted = 0;
  for (const math of [...doc.querySelectorAll("math")]) {
    /* Replacing an outer formula can detach a nested candidate that was already
       copied into this snapshot. It is no longer a formula in the document. */
    if (!math.isConnected) continue;
    const tex = texOfMathML(math);
    if (tex === null) continue;
    const wrapper = outermost(math);
    if (wrapper === null) continue;
    const display =
      math.getAttribute("display") === "block" ||
      wrapper.matches(".katex-display, .mwe-math-element-block");
    if (replace(wrapper, tex, display)) converted++;
  }
  for (const script of [...doc.querySelectorAll("script[type]")]) {
    const type = script.getAttribute("type")?.trim() ?? "";
    const mathJax = /^math\/tex(?:\s*;\s*mode\s*=\s*(display|inline))?$/iu.exec(type);
    if (!mathJax) continue;
    const display = mathJax[1]?.toLowerCase() === "display";
    const preview = script.previousElementSibling;
    if (
      preview?.classList.contains("MathJax_Preview") &&
      (preview.matches("a") || preview.querySelector("a") !== null || isLinkTarget(preview))
    ) {
      continue;
    }
    if (!replace(script, script.textContent ?? "", display)) continue;
    converted++;
    if (preview?.classList.contains("MathJax_Preview")) preview.remove();
  }
  return converted;
}

/** The TeX source a `<math>` carries: its x-tex annotation, else its `alttext`. */
function texOfMathML(math: Element): string | null {
  for (const annotation of math.querySelectorAll("annotation")) {
    /* A nested `<math>` owns its own annotation. Treating that as the outer
       formula's source would replace the outer formula and delete its siblings. */
    if (annotation.closest("math") !== math) continue;
    if (/^application\/x-tex$/iu.test(annotation.getAttribute("encoding") ?? "")) {
      return annotation.textContent;
    }
  }
  return math.getAttribute("alttext");
}

/**
 * The element to replace: the formula's publisher wrapper if it has one, so its
 * fallback image or HTML rendering goes too, else the `<math>` itself.
 *
 * **A wrapper only when it holds nothing but the formula and its twin** (K3 of
 * the plan review): `.katex` = `.katex-mathml` + `.katex-html`, `.katex-display`
 * = one `.katex`, `.mwe-math-element` = its MathML span + a fallback `<img>`.
 * Anything else inside is authored content we would delete, so the answer is
 * `null` and the formula is left alone. So is a wrapper that is itself a link.
 */
function outermost(math: Element): Element | null {
  const publisher = math.closest(PUBLISHER_FORMULA);
  if (!publisher) return math;
  if (publisher.parentElement?.closest(PUBLISHER_FORMULA)) return null;
  const isKatex = publisher.classList.contains("katex");
  const isWiki = publisher.classList.contains("mwe-math-element");
  if (isKatex === isWiki) return null;
  if (isKatex) {
    const katex = publisher;
    const mathml = math.closest(".katex-mathml");
    if (mathml?.parentElement !== katex || !onlyElement(mathml, math)) return null;
    const twins = [...katex.children];
    if (
      twins.length !== 2 ||
      twins[0] !== mathml ||
      !twins[1]?.classList.contains("katex-html") ||
      !onlyWhitespaceBetween(katex)
    ) {
      return null;
    }
    const display = katex.parentElement;
    if (display?.classList.contains("katex-display")) {
      return onlyElement(display, katex) ? display : null;
    }
    return katex;
  }
  if (isWiki) {
    const wiki = publisher;
    const mathml = math.closest(".mwe-math-mathml-inline, .mwe-math-mathml-display");
    if (mathml?.parentElement !== wiki || !onlyElement(mathml, math)) return null;
    const children = [...wiki.children];
    return children.length === 2 &&
      children[0] === mathml &&
      children[1]?.tagName.toLowerCase() === "img" &&
      onlyWhitespaceBetween(wiki)
      ? wiki
      : null;
  }
  return null;
}

/** No direct child text except whitespace, and `el` is not itself a link. */
function onlyWhitespaceBetween(el: Element): boolean {
  if (el.tagName.toLowerCase() === "a") return false;
  for (const node of el.childNodes) {
    if (node.nodeType === 3 && (node.textContent ?? "").trim()) return false;
  }
  return true;
}

/** `child` is the sole direct element child, with no authored text beside it. */
function onlyElement(el: Element, child: Element): boolean {
  return onlyWhitespaceBetween(el) && el.children.length === 1 && el.firstElementChild === child;
}

/**
 * Does anything in the document link to an id inside `el`? Converting it would
 * delete the link's target — stage 3 repoints fragment links to our ids by the
 * author's id (src/blocks.ts § retargetAnchors) — so it is left alone (K3).
 */
function isLinkTarget(el: Element): boolean {
  const ids = [el, ...el.querySelectorAll("[id], [name]")]
    .flatMap((node) => [node.getAttribute("id"), node.getAttribute("name")])
    .filter((id): id is string => !!id);
  if (!ids.length) return false;
  const targets = new Set(
    [...el.ownerDocument.querySelectorAll('a[href^="#"]')].map((a) => {
      const fragment = (a.getAttribute("href") ?? "").slice(1);
      try {
        return decodeURIComponent(fragment);
      } catch {
        return fragment;
      }
    }),
  );
  return ids.some((id) => targets.has(id));
}

/** Swap `el` for `\(tex\)` / `\[tex\]`, if the reading view would draw it. */
function replace(el: Element, raw: string, display: boolean): boolean {
  /* The parent, not `el`: a MathJax `<script>` is itself in the skip list. */
  if (el.parentElement?.closest(SKIP)) return false;
  /* A MathJax source nested in another publisher's formula is part of that
     formula's fallback machinery, not a second independent formula. */
  if (el.tagName.toLowerCase() === "script" && el.parentElement?.closest(PUBLISHER_FORMULA)) {
    return false;
  }
  if (isLinkTarget(el)) return false;
  const tex = withoutStyleWrapper(raw.trim());
  const [open, close] = display ? ["\\[", "\\]"] : ["\\(", "\\)"];
  /* The reading view ends a span at the first closer it meets, escaped or not
     (src/maths-tex.ts § `enclosed`) — `\\]` included. A line break with
     spacing, `\\[0.4em]`, holds no closer and is fine. */
  if (!tex || tex.includes(close)) return false;
  if (!texWouldDraw(tex, display)) return false;
  el.replaceWith(el.ownerDocument.createTextNode(`${open}${tex}${close}`));
  return true;
}

/**
 * `{\displaystyle x}` → `x`. MediaWiki wraps every formula in one, which would
 * draw inline maths at display size; the reading view decides that from the
 * delimiter. Only when the braces close at the very end.
 */
function withoutStyleWrapper(tex: string): string {
  const match = /^\{\\(?:displaystyle|textstyle)\s*([\s\S]*)\}$/u.exec(tex);
  if (!match) return tex;
  const inner = match[1]!;
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\") i++;
    else if (inner[i] === "{") depth++;
    else if (inner[i] === "}" && --depth < 0) return tex;
  }
  return depth === 0 ? inner.trim() : tex;
}

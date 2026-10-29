/**
 * **No `:has()` above the article walks the article.**
 *
 * A `:has()` whose subject is `:root`, `html`, `body`, `#root` or `.reader` is
 * answered by searching that element's subtree — and on the reading view that
 * subtree is the whole article. Chrome asks it again after almost any DOM
 * change, so a keystroke in the Feedback box cost over a second on a book at
 * 6× (plan 261029k, postmortem 261029c,
 * docs/project/performance.md § Style recalculation scales with the article).
 * Say such a fact from the state that renders it, as an attribute on `<html>`
 * (src/web/root-flags.ts).
 *
 * What is allowed on those subjects is a **bounded** argument: every arm of
 * the `:has()` list starts with `>`, `+` or `~` and contains no descendant
 * combinator anywhere, nested `:is()`/`:where()`/`:not()` included —
 * `.reader:has(> table.zoom)` looks at the reader's children and nothing
 * deeper. The check is on every arm, not on the first character: GPT Sol's
 * plan review pointed out that `:has(> .x, .deep)` and `:has(> body .deep)`
 * both start with `>` and both walk the document.
 *
 * Over `allSheets()`, every stylesheet the client loads, so a new sheet is in
 * scope without anybody adding it here.
 */
import { describe, expect, it } from "vitest";
import { allSheets, stripComments } from "./helpers/stylesheets.js";

/** Strings and attribute brackets blanked to `_`, so their contents cannot look like syntax. Same length. */
function blankLiterals(css: string): string {
  return css
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => "_".repeat(m.length))
    .replace(/\[[^\]]*\]/g, (m) => `[${"_".repeat(m.length - 2)}]`);
}

/** Index of the `)` matching the `(` at `open`. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Split at commas that are not inside parentheses. */
function topLevelSplit(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

const COMPOUND_END = /[\s>+~,{};]/;
const LOGICAL = /:(?:not|is|where|matches)$/i;

/**
 * **The compound selector a `:has(` at `at` belongs to**, with its own and any
 * other `:has()`/`:not()` arguments removed — the text that says what the
 * subject is. Steps out of `:not(`/`:is(`/`:where(` when the `:has()` is a
 * whole argument of one (`:root:not(:has(x))`, `:is(.a, :has(x))`): its
 * subject is then the compound outside.
 */
function subjectOf(text: string, at: number): string {
  let start = at;
  let from = at;
  for (;;) {
    let depth = 0;
    while (start > 0) {
      const c = text[start - 1]!;
      if (c === ")") depth++;
      else if (c === "(") {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && COMPOUND_END.test(c)) break;
      start--;
    }
    /* Whitespace before a `,` or a `(` is not a combinator. */
    let k = start;
    while (k > 0 && /\s/.test(text[k - 1]!)) k--;
    const c = text[k - 1];
    /* The paren this compound is directly inside, if any: `(` itself, or the one round a list after a `,`. */
    let paren = -1;
    if (c === "(") paren = k - 1;
    else if (c === ",") {
      let d = 0;
      for (let j = k - 1; j > 0; j--) {
        const q = text[j - 1]!;
        if (q === ")") d++;
        else if (q === "(") {
          if (d === 0) {
            paren = j - 1;
            break;
          }
          d--;
        } else if (d === 0 && /[{};]/.test(q)) break;
      }
    }
    if (paren !== -1 && LOGICAL.test(text.slice(0, paren))) {
      from = closing(text, paren) + 1;
      start = text.slice(0, paren).search(LOGICAL);
      continue;
    }
    break;
  }
  /* Forward to the end of the outermost compound. */
  let end = from;
  let depth = 0;
  while (end < text.length) {
    const c = text[end]!;
    if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && COMPOUND_END.test(c)) break;
    end++;
  }
  let compound = text.slice(start, end);
  /* Drop the arguments of `:has()` and `:not()`: what they name is not the subject. */
  for (;;) {
    const m = /:(?:has|not)\(/i.exec(compound);
    if (!m) break;
    const close = closing(compound, m.index + m[0].length - 1);
    if (close === -1) break;
    compound = compound.slice(0, m.index) + compound.slice(close + 1);
  }
  return compound;
}

const DIRECT_SHELL = /:root(?![\w-])|#root(?![\w-])|\.reader(?![\w-])|(?:^|[,\s])(?:html|body)(?![\w-])/i;

/** The last compound in a complex selector: the element the selector matches. */
function finalCompound(selector: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]!;
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && (/[>+~]/.test(c) || /\s/.test(c))) {
      start = i + 1;
      while (start < selector.length && /\s/.test(selector[start]!)) start++;
    }
  }
  return selector.slice(start).trim();
}

/**
 * Whether this compound can match one of the document-wide subjects.
 *
 * Look through `:is()`/`:where()` by the element each arm actually matches,
 * not every word they contain: `:where(#root .card):has(...)` is a card query,
 * while `:is(.card, #root):has(...)` really can query the root. `:not()` was
 * removed by `subjectOf` because its argument says what the subject is not.
 */
function isShellSubject(compound: string): boolean {
  let outside = "";
  for (let i = 0; i < compound.length; ) {
    const logical = /:(?:is|where|matches)\(/iy;
    logical.lastIndex = i;
    const m = logical.exec(compound);
    if (!m) {
      outside += compound[i];
      i++;
      continue;
    }
    const open = i + m[0].length - 1;
    const close = closing(compound, open);
    if (close === -1) return false;
    const inner = compound.slice(open + 1, close);
    if (topLevelSplit(inner).some((arm) => isShellSubject(finalCompound(arm)))) return true;
    outside += " ".repeat(close + 1 - i);
    i = close + 1;
  }
  return DIRECT_SHELL.test(outside);
}

/** The headers of the blocks containing `at`, outside first. */
function blockHeadersAt(text: string, at: number): string[] {
  const stack: string[] = [];
  let boundary = 0;
  for (let i = 0; i < at; i++) {
    const c = text[i]!;
    if (c === "{") {
      stack.push(text.slice(boundary, i).trim());
      boundary = i + 1;
    } else if (c === "}") {
      stack.pop();
      boundary = i + 1;
    } else if (c === ";") {
      boundary = i + 1;
    }
  }
  return stack;
}

/**
 * The selector of the rule around `at`, with nested `&` selectors resolved.
 * At-rules do not take part. This distinguishes
 * `:root { &:has(...) {} }` from `.card { &:has(...) {} }` without treating
 * every nested component query as document-wide.
 */
function parentSelectorAt(text: string, at: number): string | null {
  let resolved: string | null = null;
  for (const header of blockHeadersAt(text, at)) {
    if (!header || header.startsWith("@")) continue;
    if (resolved === null) resolved = header;
    else if (header.includes("&")) resolved = header.replaceAll("&", `:is(${resolved})`);
    else resolved = `:is(${resolved}) ${header}`;
  }
  return resolved;
}

/** Whether `:scope` at this point names a document shell or the reader. */
function shellScopeAt(text: string, at: number): boolean {
  for (const header of blockHeadersAt(text, at).reverse()) {
    if (!/^@scope\b/i.test(header)) continue;
    const open = header.indexOf("(");
    if (open === -1) return true;
    const close = closing(header, open);
    if (close === -1) return false;
    return topLevelSplit(header.slice(open + 1, close)).some((arm) =>
      isShellSubject(finalCompound(arm)),
    );
  }
  return false;
}

function shellSubjectOf(text: string, at: number): boolean {
  let subject = subjectOf(text, at);
  if (subject.includes("&")) {
    const parent = parentSelectorAt(text, at);
    if (parent !== null) subject = subject.replaceAll("&", `:is(${parent})`);
  }
  if (/:scope(?![\w-])/i.test(subject) && shellScopeAt(text, at)) return true;
  return isShellSubject(subject);
}

/** Is this one relative selector bounded — a leading `>`/`+`/`~` and no descendant combinator anywhere? */
function armIsBounded(arm: string): boolean {
  const tight = arm
    .trim()
    .replace(/\s*([>+~,()])\s*/g, "$1")
    .replace(/\s+/g, " ");
  if (!/^[>+~]/.test(tight)) return false;
  if (tight.includes(" ")) return false;
  /* A nested `:has()` is bounded only if its own arms are. */
  const lower = tight.toLowerCase();
  for (let at = lower.indexOf(":has("); at !== -1; at = lower.indexOf(":has(", at + 1)) {
    const open = at + ":has".length;
    const inner = tight.slice(open + 1, closing(tight, open));
    if (!topLevelSplit(inner).every(armIsBounded)) return false;
  }
  return true;
}

interface Finding {
  path: string;
  selector: string;
}

/** `:has()` used as a feature query is not matched against the document. */
function insideSupportsSelector(text: string, at: number): boolean {
  const boundary = Math.max(text.lastIndexOf("{", at), text.lastIndexOf("}", at), text.lastIndexOf(";", at)) + 1;
  const prefix = text.slice(boundary, at);
  if (!/^\s*@supports\b/i.test(prefix)) return false;
  const lower = text.toLowerCase();
  for (let fn = lower.lastIndexOf("selector(", at); fn >= boundary; fn = lower.lastIndexOf("selector(", fn - 1)) {
    const open = fn + "selector".length;
    if (closing(text, open) > at) return true;
  }
  return false;
}

/** Every `:has()` on a document-shell or `.reader` subject with an unbounded arm. */
function documentWideHas(sheets: { path: string; css: string }[]): Finding[] {
  const found: Finding[] = [];
  for (const sheet of sheets) {
    const text = blankLiterals(stripComments(sheet.css));
    const lower = text.toLowerCase();
    for (let at = lower.indexOf(":has("); at !== -1; at = lower.indexOf(":has(", at + 1)) {
      if (insideSupportsSelector(text, at)) continue;
      const open = at + ":has".length;
      const close = closing(text, open);
      if (close === -1) continue;
      if (!shellSubjectOf(text, at)) continue;
      const arms = topLevelSplit(text.slice(open + 1, close));
      if (arms.every(armIsBounded)) continue;
      const from = Math.max(text.lastIndexOf("}", at), text.lastIndexOf("{", at), text.lastIndexOf(";", at)) + 1;
      const to = text.indexOf("{", close);
      found.push({ path: sheet.path, selector: text.slice(from, to === -1 ? close + 1 : to).trim().replace(/\s+/g, " ") });
    }
  }
  return found;
}

const sheet = (css: string) => [{ path: "x.css", css }];
const flagged = (css: string) => documentWideHas(sheet(css)).length > 0;

describe("the check itself", () => {
  /* Every shape the stylesheets used until 2026-10-29, copied from them. */
  it.each([
    ":root:not(:has(:where(.reader) > .controls)) { a: b }",
    ":root:has(:where(.reader) > .controls):has(:where(.reader) > .controls:focus-within, :where(.reader.band-covers) .mode-band) { a: b }",
    ":root:has(\n    :where(.reader.band-covers) .mode-band,\n    :where(.reader) .mode-band:where(.outln, .struct)\n  ) .controls { a: b }",
    ":root:has(.install-hint) { a: b }",
    ':root:has(.dock-drawer, .dock:focus-within, .dock-more-trigger[data-state="open"]) { a: b }',
    ".dock.dock-enter[data-skip-arrived],\n:root:has(.dock[data-skip-arrived]) .install-hint.dock-enter { a: b }",
    "@media (max-width: 731px) { :root:has(:where(.reader) > .controls > .crumbs) { a: b } }",
    ".reader.band-covers:has(.mode-band) .masthead { display: none; }",
    ".reader.band-covers:has(.mode-band, .marg-narrow) .small-screen-hint { display: none; }",
    ".reader:has(table.zoom.overflowing)::after { a: b }",
  ])("flags %s", (css) => {
    expect(flagged(css)).toBe(true);
  });

  /* GPT Sol's two that start with `>` and still walk, and the other shells. */
  it.each([
    ":root:has(> .x, .deep) { a: b }",
    ":root:has(> body .deep) { a: b }",
    ":root:has(> :is(.a .b)) { a: b }",
    ":root:has(> .x:has(.deep)) { a: b }",
    "html:has(.x) { a: b }",
    "body:has(.x) { a: b }",
    "#root:has(.x) { a: b }",
    ":is(.a, :root):has(.x) { a: b }",
    ":root[data-a]:has(.x) { a: b }",
    ":root:is(.a, :has(.x)) { a: b }",
    "HTML:HAS(.x) { a: b }",
    ":ROOT { &:Has(.x) { a: b } }",
    "@scope (.reader) { :scope:has(.x) { a: b } }",
  ])("flags %s", (css) => {
    expect(flagged(css)).toBe(true);
  });

  it.each([
    ".reader:has(> table.zoom.overflowing)::after { a: b }",
    ".reader:has(> table.only-prose):not(.text-alone) .masthead-inner { a: b }",
    ":root:has(> body > .x, + .y, ~ .z) { a: b }",
    ".mode-band.faq.has-about:not(:has(> .gloss-sort)) > .tl-scroll { a: b }",
    ".chat-live:has(.chat-live-btn.on) .chat-live-label { a: b }",
    ":root[data-bar-stuck] :where(.reader) > .controls:has(> .crumbs) { a: b }",
    '.reader-x:has(.y) { a: b }',
    '.a[title=":root:has(.x)"] { a: b }',
    "/* :root:has(.install-hint) */ .a { a: b }",
    ":where(#root .card):has(.x) { a: b }",
    ".card { &:has(.x) { a: b } }",
    ":root .card { &:has(.x) { a: b } }",
    "@supports selector(:root:has(.x)) { .a { a: b } }",
    "@scope (.card) { :scope:has(.x) { a: b } }",
  ])("passes %s", (css) => {
    expect(flagged(css)).toBe(false);
  });
});

describe("the stylesheets", () => {
  it("are all read", () => {
    const paths = allSheets().map((s) => s.path);
    for (const p of ["shell.css", "dock.css", "narrow-window.css", "crumbs.css", "table.css", "tokens.css"]) {
      expect(paths.some((x) => x.endsWith(`/${p}`)), p).toBe(true);
    }
  });

  it("have no `:has()` on the root or the reader that searches below its children", () => {
    expect(documentWideHas(allSheets())).toEqual([]);
  });
});

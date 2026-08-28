/**
 * Turn a block's stored `html` into (a) the same normalised character stream the
 * pipeline stored as `block.text`, and (b) the inline markup laid over it as ranges.
 *
 * We need both because every decoration in this playground is a *range over the
 * text*: a glossary occurrence, a quoted comment anchor, an annotated key sentence.
 * The article's own `<a>` and `<em>` are just more ranges over the same stream, so
 * the renderer can split at every boundary and never has to reason about nesting.
 *
 * The check that keeps this honest is `parseInline(html).text === block.text`, run
 * over every block by build.mjs. If our whitespace collapsing ever drifts from the
 * pipeline's, every quote offset silently lands a character or two off, and the
 * page would still look plausible.
 */

const ENTITIES = { amp: '&', quot: '"', nbsp: ' ', lt: '<', gt: '>', apos: "'", '#39': "'" };

const VOID = new Set(['img', 'br', 'hr', 'source', 'input']);

function decode(s) {
  return s.replace(/&(#?[a-zA-Z0-9]+);/g, (m, name) => {
    if (name in ENTITIES) return ENTITIES[name];
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return m;
  });
}

function parseAttrs(s) {
  const attrs = {};
  for (const m of s.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g)) attrs[m[1]] = decode(m[2]);
  return attrs;
}

/**
 * @returns {{ tag: string, attrs: object, text: string, ranges: Array<{start:number,end:number,tag:string,attrs:object}> }}
 */
export function parseInline(html) {
  const tokens = [];
  const re = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m.index > last) tokens.push({ t: 'text', s: html.slice(last, m.index) });
    tokens.push({ t: m[1] ? 'close' : 'open', tag: m[2].toLowerCase(), raw: m[3] });
    last = re.lastIndex;
  }
  if (last < html.length) tokens.push({ t: 'text', s: html.slice(last) });

  let text = '';
  let pendingSpace = false; // collapse whitespace runs, including runs split by a tag
  const ranges = [];
  const stack = [];
  let outerTag = null;
  let outerAttrs = {};
  let depth = 0;

  const push = (raw) => {
    const decoded = decode(raw);
    for (const ch of decoded) {
      // `\s` rather than `[ \n\t\r]`, because `\s` includes U+00A0 and the source HTML carries
      // literal non-breaking spaces as well as `&nbsp;`. The pipeline's own normaliser collapses
      // them; eleven of the 141 blocks differ on exactly this, and every difference is invisible.
      if (/\s/.test(ch)) {
        if (text.length > 0) pendingSpace = true;
        continue;
      }
      if (pendingSpace) { text += ' '; pendingSpace = false; }
      text += ch;
    }
  };

  for (const tok of tokens) {
    if (tok.t === 'text') { push(tok.s); continue; }
    if (tok.t === 'open') {
      const attrs = parseAttrs(tok.raw);
      if (depth === 0 && outerTag === null) { outerTag = tok.tag; outerAttrs = attrs; depth++; continue; }
      if (VOID.has(tok.tag)) { ranges.push({ start: text.length, end: text.length, tag: tok.tag, attrs }); continue; }
      stack.push({ start: text.length, tag: tok.tag, attrs });
      depth++;
      continue;
    }
    // close
    if (stack.length === 0) { depth--; continue; }
    const open = stack.pop();
    depth--;
    ranges.push({ start: open.start, end: text.length, tag: open.tag, attrs: open.attrs });
  }
  while (stack.length) {
    const open = stack.pop();
    ranges.push({ start: open.start, end: text.length, tag: open.tag, attrs: open.attrs });
  }

  return { tag: outerTag ?? 'p', attrs: outerAttrs, text: text.trimEnd(), ranges: ranges.sort((a, b) => a.start - b.start) };
}

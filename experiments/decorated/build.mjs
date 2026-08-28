/**
 * Build the Decorated-mode playground: one self-contained HTML file you can open
 * with file://, no server, no build step, nothing imported from src/.
 *
 *   node experiments/decorated/build.mjs
 *
 * WHY IT IS A SEPARATE PAGE. This is a place to try decorations before deciding
 * which of them deserve to exist. Wiring them into the reading view first would
 * mean arguing about the URL state, the band, and the layer budget for every one,
 * including the fifteen we throw away. The ideas, their sources and the three
 * disagreements between them: docs/research/decorated-mode-ideas.md.
 *
 * WHERE THE DECORATIONS COME FROM. Everything on the page is real: the article is
 * the stored blocks, and every layer is driven by an artefact the pipeline already
 * produces (tree, labels, arc, summary, glossary, ideas, comments) or by
 * annotations.json — a judgement pass over the same article, written to a schema in
 * this directory. Nothing here is lorem ipsum, so a layer that looks bad on this
 * page looks bad for a real reason.
 *
 * THE ONE RULE. Not one of the author's words is removed, reordered or rewritten.
 * Decorations may restyle the prose and may add matter around it. `verify.mjs`
 * checks the first half of that claim against the source blocks.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseInline } from './inline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const SLUG = 'noema-mythology-of-conscious-ai';
const DATA = join(REPO, 'data', SLUG);

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const meta = read(join(DATA, 'meta.json'));
const blocks = read(join(DATA, 'blocks.json')).blocks;
const tree = read(join(DATA, 'tree.json'));
const labels = read(join(DATA, 'labels.json')).labels;
const arc = read(join(DATA, 'arc.json')).entries;
const summary = read(join(DATA, 'summary.json')).entries;
const glossary = read(join(DATA, 'glossary.json')).entries;
const ideas = read(join(DATA, 'ideas.json')).ideas;
const comments = read(join(DATA, 'comments.json')).comments;
const annotations = read(join(HERE, 'annotations.json')).blocks;

const byId = new Map(blocks.map((b) => [b.id, b]));
const order = new Map(blocks.map((b, i) => [b.id, i]));

const problems = [];
const note = (kind, detail) => problems.push(`${kind}: ${detail}`);

// ---------------------------------------------------------------- ranges --
//
// Every decoration that touches the prose is a range over the block's normalised
// text: the article's own <a> and <em>, a glossary occurrence, a comment anchor,
// an annotated key sentence. Collecting them all into one list and splitting at
// every boundary is what lets layers overlap without anyone reasoning about
// nesting — and it is why `parseInline` has to agree with the pipeline exactly.

/**
 * Fold the characters that a model reliably retypes wrong, WITHOUT changing the
 * string's length, so an offset in the folded text is the same offset in the
 * original. Curly apostrophe to straight, curly quotes to straight, en/em dash to
 * hyphen, non-breaking space to space. Every substitution is one character for one.
 */
function fold(s) {
  return s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ');
}

/**
 * Find `quote` in `text`, preferring the offset the artefact recorded.
 *
 * Two passes, and the second one reports itself. A model asked to quote a passage
 * back will retype an apostrophe as often as not, and three of this article's ten
 * idea occurrences and one of its fifteen comments miss on exactly that. A silent
 * fallback would make the page look perfect and hide the fact that the app's own
 * marking layer is quietly dropping those occurrences today.
 */
function locate(text, quote, hint, what) {
  if (!quote) return -1;
  if (typeof hint === 'number' && text.slice(hint, hint + quote.length) === quote) return hint;
  let i = text.indexOf(quote);
  if (i === -1) {
    const loose = fold(text).indexOf(fold(quote));
    if (loose !== -1) {
      note('quote matched only after folding punctuation', `${what} · ${JSON.stringify(quote.slice(0, 50))}`);
      return loose;
    }
    note('quote not found', `${what} · ${JSON.stringify(quote.slice(0, 60))}`);
  } else if (typeof hint === 'number' && Math.abs(i - hint) > 2) {
    // Not an error — `start` is advisory — but a big drift usually means the quote
    // was retyped rather than copied, and the second occurrence is the wrong one.
    note('quote offset drifted', `${what} · recorded ${hint}, found ${i}`);
  }
  return i;
}

/**
 * Find a glossary surface as a whole word, and return how much of it to underline.
 *
 * The right-hand boundary allows an inflection — "Turing machine" has to match
 * "Turing machines", and the underline has to cover the "s" or it looks like a
 * typesetting error. Without this, two of this article's nineteen terms match
 * nothing at all in blocks the glossary itself says they occur in.
 */
const WORD = /[\p{L}\p{N}]/u;
function findWord(text, needle) {
  const hay = fold(text).toLowerCase();
  const pin = fold(needle).toLowerCase();
  let i = hay.indexOf(pin);
  while (i !== -1) {
    const before = i === 0 ? '' : hay[i - 1];
    if (!WORD.test(before)) {
      let len = pin.length;
      for (const suffix of ["'s", '’s', 'es', 's']) {
        if (hay.startsWith(suffix.toLowerCase(), i + len)) { len += suffix.length; break; }
      }
      const after = hay[i + len] ?? '';
      if (!WORD.test(after)) return { at: i, len };
    }
    i = hay.indexOf(pin, i + 1);
  }
  return null;
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Split `text` at every range boundary and emit one element per atomic segment,
 * carrying the classes of every range covering it.
 *
 * A link that a decoration cuts in half becomes two <a> elements pointing at the
 * same href. That is the price of not nesting, and on a page whose whole purpose
 * is overlapping layers it is the cheaper side of the trade.
 */
function renderRanges(text, ranges) {
  const cuts = new Set([0, text.length]);
  for (const r of ranges) {
    if (r.start >= 0 && r.end > r.start) { cuts.add(r.start); cuts.add(r.end); }
  }
  const points = [...cuts].sort((a, b) => a - b);
  let out = '';
  for (let i = 0; i < points.length - 1; i++) {
    const [s, e] = [points[i], points[i + 1]];
    const here = ranges.filter((r) => r.start <= s && r.end >= e && r.end > r.start);
    const body = esc(text.slice(s, e));
    if (here.length === 0) { out += body; continue; }
    const link = here.find((r) => r.href);
    const classes = here.flatMap((r) => r.classes ?? []);
    const attrs = Object.assign({}, ...here.map((r) => r.attrs ?? {}));
    const attrStr = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
    const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
    // `<a>` when a link covers the segment; the emphasis tags the author used stay
    // real elements so copy-paste and screen readers keep them.
    const em = here.some((r) => r.em);
    let inner = em ? `<em>${body}</em>` : body;
    if (link) out += `<a href="${esc(link.href)}" target="_blank" rel="noreferrer"${cls}${attrStr}>${inner}</a>`;
    else out += `<span${cls}${attrStr}>${inner}</span>`;
  }
  return out;
}

// ------------------------------------------------------- per-block layers --

/** Glossary occurrences, and which one is the term's first appearance. */
function glossaryRanges() {
  const perBlock = new Map();
  for (const entry of glossary) {
    const surfaces = [entry.name, ...(entry.aliases ?? [])].sort((a, b) => b.length - a.length);
    const hostBlocks = (entry.blocks ?? []).slice().sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    let first = true;
    for (const blockId of hostBlocks) {
      const block = byId.get(blockId);
      if (!block) { note('glossary block missing', `${entry.name} → ${blockId}`); continue; }
      let best = null;
      for (const s of surfaces) {
        const found = findWord(block.text, s);
        if (found && (!best || found.at < best.at)) best = found;
      }
      if (!best) { note('glossary surface not in block', `${entry.name} → ${blockId}`); continue; }
      const list = perBlock.get(blockId) ?? [];
      list.push({
        start: best.at,
        end: best.at + best.len,
        classes: ['gloss', `gloss-${entry.kind}`, first ? 'gloss-first' : ''].filter(Boolean),
        attrs: { 'data-gloss': entry.id },
      });
      perBlock.set(blockId, list);
      first = false;
    }
  }
  return perBlock;
}

/** Idea occurrences: the propositions the piece leans on without arguing for. */
function ideaRanges() {
  const perBlock = new Map();
  for (const idea of ideas) {
    for (const occ of idea.occurrences ?? []) {
      const block = byId.get(occ.blockId);
      if (!block) { note('idea block missing', `${idea.id} → ${occ.blockId}`); continue; }
      const i = locate(block.text, occ.quote, occ.start, `idea ${idea.id} in ${occ.blockId}`);
      if (i === -1) continue;
      const list = perBlock.get(occ.blockId) ?? [];
      list.push({
        start: i,
        end: i + occ.quote.length,
        classes: ['idea', `idea-${idea.provenance}`],
        attrs: { 'data-idea': idea.id },
      });
      perBlock.set(occ.blockId, list);
    }
  }
  return perBlock;
}

/** The reader's own marks. The only layer allowed the orange. */
function commentRanges() {
  const perBlock = new Map();
  for (const c of comments) {
    const block = byId.get(c.blockId);
    if (!block) { note('comment block missing', c.id); continue; }
    const i = locate(block.text, c.quote, c.start, `comment ${c.id} in ${c.blockId}`);
    if (i === -1) continue;
    const list = perBlock.get(c.blockId) ?? [];
    list.push({
      start: i,
      end: i + c.quote.length,
      classes: ['mark', c.answer ? 'mark-answered' : 'mark-plain'],
      attrs: { 'data-comment': c.id },
    });
    perBlock.set(c.blockId, list);
  }
  return perBlock;
}

/** The judgement pass: key sentence, hinge, hedge, number, strong, quiet. */
function annotationRanges() {
  const perBlock = new Map();
  for (const [blockId, ann] of Object.entries(annotations)) {
    const block = byId.get(blockId);
    if (!block) { note('annotated block missing', blockId); continue; }
    const list = [];
    for (const span of ann.spans ?? []) {
      const i = locate(block.text, span.quote, undefined, `span ${span.kind} in ${blockId}`);
      if (i === -1) continue;
      list.push({ start: i, end: i + span.quote.length, classes: [`sp-${span.kind}`] });
    }
    if (list.length) perBlock.set(blockId, list);
  }
  return perBlock;
}

// ------------------------------------------------------------- structure --

/**
 * Section seams from the tree. Depth 1 and 2 both get a heading; where the author
 * wrote one we show theirs, and where they did not we show ours and say so. The
 * article has four author headings across 8,300 words and twenty-two generated
 * ones, which is the whole argument for this layer.
 */
function seams() {
  const at = new Map(); // blockId → [{depth, title, generated, node}]
  const visit = (id) => {
    const n = tree.nodes[id];
    if (!n) return;
    if (n.depth >= 1 && n.depth <= 2 && n.title) {
      const list = at.get(n.range[0]) ?? [];
      list.push({
        depth: n.depth,
        title: n.title,
        gist: n.gist,
        generated: !n.sourceHeading,
        id: n.id,
        range: n.range,
      });
      at.set(n.range[0], list);
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(tree.rootId);
  return at;
}

/** Which tree node (at a given depth) each block belongs to. */
function spanIndex(entries) {
  const map = new Map();
  for (const e of entries) {
    const from = order.get(e.range[0]);
    const to = order.get(e.range[1]);
    if (from === undefined || to === undefined) { note('range endpoint missing', JSON.stringify(e.range)); continue; }
    for (let i = from; i <= to; i++) map.set(blocks[i].id, e);
  }
  return map;
}

// ---------------------------------------------------------------- render --

const glossHits = glossaryRanges();
const ideaHits = ideaRanges();
const commentHits = commentRanges();
const annHits = annotationRanges();
const seamsAt = seams();
const arcAt = spanIndex(arc);

const CONNECTIVE_GLYPH = {
  therefore: '∴',
  but: '⊥',
  because: '∵',
  'for-example': 'e.g.',
  'and-also': '+',
  'zoom-in': '⌄',
  'zoom-out': '⌃',
  contrast: '⇄',
  restates: '=',
  'new-thread': '§',
};

/**
 * Break one sentence at its clause boundaries and set it as verse.
 *
 * The words, all of them, in their order, with nothing added — only the pace
 * changed. A line break is an instruction to the reading voice, which is exactly
 * what a thesis sentence wants and what prose-skimming destroys.
 *
 * The split points are the author's own punctuation: em dashes, semicolons, colons,
 * and commas that carry a clause rather than a list. We never invent a boundary.
 */
function lineate(sentence) {
  const parts = [];
  let cursor = 0;
  const re = /(\s+—\s+|;\s+|:\s+|,\s+(?=(?:and|but|or|so|which|whether|because|if|when|that)\b))/g;
  let m;
  while ((m = re.exec(sentence))) {
    parts.push(sentence.slice(cursor, m.index + m[0].length));
    cursor = m.index + m[0].length;
  }
  parts.push(sentence.slice(cursor));
  // NOT trimmed. Concatenated, the lines have to reproduce the sentence character
  // for character, because with the layer switched off they are inline spans and
  // the reader is looking at the author's sentence. `verify.mjs` checks exactly this.
  return parts.filter((p) => p.length > 0);
}

/** Ranges that overlap [from,to), clamped and shifted into that window's frame. */
function clip(ranges, from, to) {
  return ranges
    .filter((r) => r.end > from && r.start < to)
    .map((r) => ({ ...r, start: Math.max(r.start, from) - from, end: Math.min(r.end, to) - from }));
}

function renderProse(block, opts = {}) {
  const parsed = parseInline(block.html);
  if (parsed.text !== block.text) note('parse drift', block.id);

  const ranges = [];
  for (const r of parsed.ranges) {
    if (r.tag === 'a' && r.attrs.href) ranges.push({ start: r.start, end: r.end, href: r.attrs.href, classes: ['lnk'] });
    if (r.tag === 'em' || r.tag === 'i') ranges.push({ start: r.start, end: r.end, em: true });
  }
  for (const src of [glossHits, ideaHits, commentHits, annHits]) {
    for (const r of src.get(block.id) ?? []) ranges.push(r);
  }

  const verse = opts.lineate;
  if (!verse) return renderRanges(parsed.text, ranges);

  const { start, end } = verse;
  const lines = lineate(parsed.text.slice(start, end));
  const body = lines.map((l) => `<span class="lin">${esc(l)}</span>`).join('');
  return (
    renderRanges(parsed.text.slice(0, start), clip(ranges, 0, start)) +
    `<span class="lineated">${body}</span>` +
    renderRanges(parsed.text.slice(end), clip(ranges, end, parsed.text.length))
  );
}

function renderMedia(block) {
  // Figures, images, the pull-quotes the author's own editor set, the rule, the
  // embedded video. Passed through as the pipeline stored them.
  return block.html;
}

/**
 * Which blocks get their thesis sentence set as verse.
 *
 * Three of 108, and they have to be the right three: the sentences the essay exists
 * to deliver. `role: "thesis"` from the judgement pass, and only where that block
 * also has a key sentence to break.
 */
const lineationTargets = new Map();
for (const [id, ann] of Object.entries(annotations)) {
  if (ann.role !== 'thesis') continue;
  const key = (ann.spans ?? []).find((s) => s.kind === 'key');
  const block = byId.get(id);
  if (!key || !block) continue;
  const at = block.text.indexOf(key.quote);
  if (at === -1) continue;
  lineationTargets.set(id, { start: at, end: at + key.quote.length });
}
if (lineationTargets.size === 0) note('lineation', 'no thesis block had a key span — the verse layer will be empty');

/**
 * A glossary entry carries EITHER `background` — what you'd need to know from
 * outside the piece, which is what a person or a work gets — OR `senseHere`, the
 * sense this piece uses, which is what a concept gets. Twelve of the nineteen
 * entries here have only the second. The distinction is worth keeping in the
 * decoration rather than flattening: "who this is" and "what this piece means by
 * it" are different offers to a reader.
 */
function gloss(entry) {
  return entry.background ?? entry.senseHere ?? '';
}

/** First occurrence of each glossary term, so the gutter can gloss it unasked. */
const firstUse = new Map(); // blockId → [entry]
for (const entry of glossary) {
  const hosts = (entry.blocks ?? []).slice().sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const host = hosts.find((b) => byId.has(b));
  if (!host) continue;
  const list = firstUse.get(host) ?? [];
  list.push(entry);
  firstUse.set(host, list);
}

/** Assumption stamps: which ideas surface in which block. */
const ideasAt = new Map();
for (const idea of ideas) {
  for (const occ of idea.occurrences ?? []) {
    const list = ideasAt.get(occ.blockId) ?? [];
    if (!list.some((i) => i.id === idea.id)) list.push(idea);
    ideasAt.set(occ.blockId, list);
  }
}

/** The last block of each depth-1 section, where the recall gate goes. */
const gateAfter = new Map();
for (const nodeId of tree.nodes[tree.rootId].children ?? []) {
  const n = tree.nodes[nodeId];
  const s = summary.find((e) => e.range[0] === n.range[0] && e.range[1] === n.range[1] && e.depth === 1);
  if (!s) { note('gate', `no depth-1 summary for ${nodeId}`); continue; }
  gateAfter.set(n.range[1], { node: n, summary: s });
}

let html = '';
let lastArc = null;
const spineTicks = [];
let openSection = false; // the next text block starts a section — rubricate it

for (const block of blocks) {
  const ann = annotations[block.id];
  const weight = ann?.weight ?? null;

  for (const seam of seamsAt.get(block.id) ?? []) {
    if (seam.depth === 1) openSection = true;
    // A seam over a span the author DID title carries only the rule and the air.
    // Its heading is the very next block, and printing the title here too would
    // put the author's own words on the page twice — which is the one thing this
    // page promises not to do, and it looked like a styling choice rather than a
    // duplication until the built page was read back.
    html += `<div class="seam seam-d${seam.depth}${seam.generated ? ' seam-ours' : ' seam-theirs'}" data-node="${seam.id}">`;
    if (seam.generated) {
      html += `<h${seam.depth + 1} class="seam-title">${esc(seam.title)}</h${seam.depth + 1}>`;
      html += `<span class="seam-mark" title="Spideryarn wrote this heading; the author did not">not the author's</span>`;
    }
    if (seam.gist) html += `<p class="seam-gist">${esc(seam.gist)}</p>`;
    html += `</div>`;
  }

  const a = arcAt.get(block.id);
  if (a && a !== lastArc) {
    lastArc = a;
    html += `<div class="arc-turn"><p>${esc(a.text)}</p></div>`;
  }

  const isText = block.kind === 'text' || block.kind === 'caption';
  const rubricate = openSection && isText && block.gistable !== false && block.tag === 'p';
  if (rubricate) openSection = false;

  const classes = ['blk', `blk-${block.kind}`, `blk-${block.tag}`];
  if (weight !== null) classes.push(`w${weight}`);
  if (ann?.role) classes.push(`role-${ann.role}`);
  if (block.gistable === false) classes.push('boiler');
  if (rubricate) classes.push('section-open');

  const attrs = [
    `id="${block.id}"`,
    `class="${classes.join(' ')}"`,
    `data-label="${esc(labels[block.id] ?? '')}"`,
  ];
  if (ann?.role) attrs.push(`data-role-label="${ann.role}"`);
  if (ann?.connective) attrs.push(`data-connective="${ann.connective}"`);
  if (ann?.question) attrs.push(`data-question="${esc(ann.question)}"`);
  if (ann?.difficulty !== undefined) attrs.push(`data-difficulty="${ann.difficulty}"`);
  if (ann?.defines) attrs.push(`data-defines="${esc(ann.defines)}"`);

  spineTicks.push({ id: block.id, weight, kind: block.kind, words: block.words ?? 0, difficulty: ann?.difficulty ?? 0 });

  html += `<section ${attrs.join(' ')}>`;

  // The machine's gutter, on the left. Never a hue, never inline.
  html += `<div class="gutter">`;
  if (ann?.connective) {
    html += `<span class="conn conn-${ann.connective}" title="${esc(ann.connective)}">${CONNECTIVE_GLYPH[ann.connective] ?? '·'}</span>`;
  }
  if (labels[block.id]) html += `<span class="gist">${esc(labels[block.id])}</span>`;
  if (ann?.question) html += `<span class="q">${esc(ann.question)}</span>`;
  // The gloss arrives beside the word the first time the article uses it, unasked.
  // A tooltip cannot do this: you have to already suspect you need it.
  for (const entry of firstUse.get(block.id) ?? []) {
    html += `<span class="gloss-note" data-gloss="${entry.id}"><b>${esc(entry.name)}</b>${esc(gloss(entry))}</span>`;
  }
  // The assumption stamp. Not a summary of the paragraph — a naming of what the
  // paragraph needs you to grant it.
  for (const idea of ideasAt.get(block.id) ?? []) {
    html += `<button class="idea-stamp" data-idea="${idea.id}">${idea.provenance === 'assumed' ? 'assumes' : 'introduces'} · ${esc(idea.name)}</button>`;
  }
  html += `</div>`;

  html += `<div class="body">`;
  if (isText) {
    const tag = block.tag === 'p' ? 'p' : block.tag;
    html += `<${tag} class="prose">${renderProse(block, { lineate: lineationTargets.get(block.id) })}</${tag}>`;
  } else {
    html += renderMedia(block);
  }
  html += `</div>`;

  // The reader's margin, on the right. The only place the orange appears.
  const myComments = comments.filter((c) => c.blockId === block.id);
  html += `<div class="margin">`;
  for (const c of myComments) {
    html += `<button class="note" data-comment="${c.id}" title="${esc(c.quote)}">${c.answer ? '●' : '○'}</button>`;
  }
  html += `</div>`;

  html += `</section>`;

  // The gate. At the end of a major section, you say what you took from it; only
  // then does our summary open. Recall first, answer key second — the one ordering
  // that makes a summary strengthen the reading instead of replacing it.
  const gate = gateAfter.get(block.id);
  if (gate) {
    html += `<div class="gate" data-node="${gate.node.id}">`;
    html += `<p class="gate-prompt">You have just read <b>${esc(gate.node.title)}</b>. In a sentence, what was its point? Nobody marks this.</p>`;
    html += `<textarea rows="1" placeholder="…"></textarea>`;
    html += `<button class="gate-reveal" disabled>show what we'd have said</button>`;
    html += `<div class="gate-answer">${esc(gate.summary.short)}</div>`;
    html += `</div>`;
  }
}

// ------------------------------------------------------------- the shell --

const payload = {
  meta,
  glossary: Object.fromEntries(glossary.map((g) => [g.id, g])),
  ideas: Object.fromEntries(ideas.map((i) => [i.id, i])),
  comments: Object.fromEntries(comments.map((c) => [c.id, c])),
  spine: spineTicks,
  tree: tree.nodes,
  rootId: tree.rootId,
  arc,
  summary,
};

const css = readFileSync(join(HERE, 'page.css'), 'utf8');
const js = readFileSync(join(HERE, 'page.js'), 'utf8');
const shell = readFileSync(join(HERE, 'shell.html'), 'utf8');

const out = shell
  .replace('/*CSS*/', () => css)
  .replace('<!--ARTICLE-->', () => html)
  .replace('/*DATA*/', () => JSON.stringify(payload))
  .replace('/*JS*/', () => js)
  .replace(/\{\{TITLE\}\}/g, () => esc(meta.title));

writeFileSync(join(HERE, 'decorated.html'), out);

console.log(`wrote experiments/decorated/decorated.html — ${(out.length / 1024).toFixed(0)} KB`);
console.log(`${blocks.length} blocks · ${Object.keys(annotations).length} annotated · ${glossary.length} terms · ${ideas.length} ideas · ${comments.length} comments`);
if (problems.length) {
  console.log(`\n${problems.length} problems:`);
  for (const p of problems.slice(0, 40)) console.log('  ' + p);
  if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
} else {
  console.log('\nno problems — every quote, range endpoint and block reference resolved');
}

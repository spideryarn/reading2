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

/**
 * Two of the span kinds are POINT marks, and the judgement pass returned clauses.
 *
 * A hedge is "may be", "arguably", "it seems likely" — three or four words, dotted,
 * with a raised query. Asked for those, the model returned the whole hedged claim,
 * up to 194 characters of it. A number is "86 billion neurons"; it returned "won the
 * 2025 annual Berggruen Prize Essay Competition". At that length the decoration stops
 * being a mark on a word and becomes a highlight of a sentence — which is both a
 * different decoration and the one the reading-science review argued hardest against.
 *
 * So we narrow them here rather than draw them wrong, and we say how many. Where a
 * quote has no hedging phrase and no numeral in it at all, the span is dropped: a
 * mark we cannot place is worse than no mark, because it looks placed.
 */
// The lexicon was grown against the article, not guessed: every phrase here was one
// the first version dropped. It is deliberately about MARKERS of uncertainty rather
// than the claims they qualify — "may be", not "may be possible in the near future".
const HEDGE =
  /\b(?:may(?:be)?|might|arguably|perhaps|possibly|probably|plausibl\w*|at least|it seems|seem(?:s|ed)?|appears?|suggest\w*|likely|unlikely|uncertain\w*|apparently|harder to say|hard to say|one possibility|possibilit\w*|minority view|knock-down|tend(?:s|ed)? to|roughly|not (?:at all )?clear|not completely|generally|in some sense|to some extent|as far as we know|(?:I|we) don[’']t (?:have|know)|could\b)/i;
// `\d[\d,.]*s?` so that "1950s" matches: a trailing letter defeats a plain `\b`.
const NUMERAL =
  /\b(?:\d[\d,.]*s?(?:\s?(?:%|percent|billion|million|thousand|trillion))?|one|two|three|four|five|six|seven|eight|nine|ten|dozens?|hundreds?|thousands?|millions?|billions?)\b/i;
// Whatever the lexicon matches, a point mark stays a point mark.
const MAX_POINT_MARK = 34;

/** Shrink a quote to the phrase that actually earns the mark. */
function narrow(kind, quote) {
  if (kind === 'hedge' || kind === 'number') {
    const m = (kind === 'hedge' ? HEDGE : NUMERAL).exec(quote);
    if (!m) return null;
    // The marker plus the words that make it read as a phrase rather than a stub:
    // "may be possible" rather than "may", "the 1950s, he seeded" rather than "1950s".
    const words = kind === 'hedge' ? 2 : 2;
    const after = quote.slice(m.index + m[0].length).match(new RegExp(`^(?:\\s+\\S+){0,${words}}`));
    const len = Math.min(m[0].length + (after ? after[0].length : 0), MAX_POINT_MARK);
    return { at: m.index, len };
  }
  return { at: 0, len: quote.length };
}

const SPAN_TIP = {
  hedge: [
    'A hedge',
    'The author is qualifying this rather than asserting it — "may", "arguably", "it seems". Readers routinely remember hedged claims as flat ones, and this essay is about what we do and do not know, so the wavy rule and the raised query are here to slow you down on exactly these words.',
  ],
  number: [
    'A figure the argument leans on',
    'Set in lining tabular figures and underlined, so you can find it again on a second pass. Every other numeral on the page is old-style, which is why dates stop shouting.',
  ],
  hinge: [
    'A hinge',
    'The words where the argument changes direction. Small caps and a hairline above — the treatment a printed critical edition would use — because these are the phrases you lose first when skimming.',
  ],
};

/** The judgement pass: key sentence, hinge, hedge, number, strong, quiet. */
function annotationRanges() {
  const perBlock = new Map();
  let narrowed = 0;
  let dropped = 0;
  for (const [blockId, ann] of Object.entries(annotations)) {
    const block = byId.get(blockId);
    if (!block) { note('annotated block missing', blockId); continue; }
    const list = [];
    for (const span of ann.spans ?? []) {
      const i = locate(block.text, span.quote, undefined, `span ${span.kind} in ${blockId}`);
      if (i === -1) continue;
      const fit = narrow(span.kind, span.quote);
      if (!fit) {
        dropped++;
        note('span dropped', `${span.kind} in ${blockId} had no ${span.kind === 'hedge' ? 'hedging phrase' : 'numeral'} in it · ${JSON.stringify(span.quote.slice(0, 50))}`);
        continue;
      }
      if (fit.len !== span.quote.length) narrowed++;
      // The three kinds that visibly change the author's words — a wavy rule and a
      // raised query, small caps, a hairline under a figure — carry their own tip.
      // The other three are ink and weight, which explain themselves once the layer
      // is named, and a tooltip on every emphasised sentence would fire all the way
      // down the page while somebody is trying to read.
      const attrs = SPAN_TIP[span.kind] ? { 'data-tip-title': SPAN_TIP[span.kind][0], 'data-tip': SPAN_TIP[span.kind][1] } : undefined;
      list.push({ start: i + fit.at, end: i + fit.at + fit.len, classes: [`sp-${span.kind}`], attrs });
    }
    if (list.length) perBlock.set(blockId, list);
  }
  if (narrowed) note('spans narrowed', `${narrowed} hedge/number spans shrunk from a clause to the phrase that earns the mark`);
  if (dropped) note('spans dropped', `${dropped} in total`);
  return perBlock;
}

/* ------------------------------------------------- the skim path -------- */
/*
 * Greg, on the first build: *"It doesn't do enough to emphasise the sections that
 * are worth reading vs can be skipped (perhaps with spans rather than at block
 * level)."*
 *
 * He is right, and the diagnosis is right too. The relief we had was block-level:
 * a whole paragraph got more air and fuller ink, which says "this one matters" and
 * says nothing at all about the four sentences inside it. But a paragraph is not
 * the unit a reader skims in. Sentences are.
 *
 * So every prose block is cut into sentences and each sentence is graded:
 *
 *   2  the skim path — read these and you have the argument
 *   1  supporting — read these and you have the argument's reasons
 *   0  skippable — a careful reader can pass over it and lose nothing
 *
 * The grade is DERIVED from the judgement pass rather than asked for separately,
 * which keeps one source of truth: a sentence is on the skim path because it holds
 * the key sentence or a hinge, not because a second model was asked a second time.
 *
 * The floor is --ink-5 and it is load-bearing. Grade 0 is "you may skip this", never
 * "this is not here" — the reading-science review's objection to fading is that
 * faint becomes deleted, and a floor plus a hard rule against ever hiding a sentence
 * is the whole answer to it.
 */

// Not every full stop ends a sentence. These are the ones that appear in this
// article; a stop we mis-split only puts a grade boundary in a silly place, since
// the ranges still cover the text contiguously and no character can be lost.
const ABBREV = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc|cf|Fig|No|pp|Jr|Sr|Inc|Ltd)|\be\.g|\bi\.e|\b[A-Z])\.$/;

function sentences(text) {
  const out = [];
  let start = 0;
  const re = /[.!?]["”’')\]]*\s+/g;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (ABBREV.test(text.slice(start, end).trimEnd())) continue;
    out.push({ start, end });
    start = end;
  }
  if (start < text.length) out.push({ start, end: text.length });
  return out;
}

const skimTally = { 2: 0, 1: 0, 0: 0 };

function skimRanges() {
  const perBlock = new Map();
  for (const [blockId, ann] of Object.entries(annotations)) {
    const block = byId.get(blockId);
    if (!block || block.kind !== 'text' || block.tag !== 'p') continue;

    const marks = [];
    for (const span of ann.spans ?? []) {
      const i = locate(block.text, span.quote, undefined, `skim ${span.kind} in ${blockId}`);
      if (i !== -1) marks.push({ kind: span.kind, start: i, end: i + span.quote.length });
    }

    const list = [];
    sentences(block.text).forEach((s, idx) => {
      const len = s.end - s.start;
      const touching = (kind) =>
        marks.some((m) => m.kind === kind && m.start < s.end && m.end > s.start);
      // How much of this sentence a `quiet` span covers. A parenthetical inside a
      // sentence does not make the sentence skippable; one that IS the sentence does.
      const quiet = marks
        .filter((m) => m.kind === 'quiet')
        .reduce((n, m) => n + Math.max(0, Math.min(m.end, s.end) - Math.max(m.start, s.start)), 0);
      const unmarked = !marks.some((m) => m.start < s.end && m.end > s.start);

      let grade;
      if (touching('key') || touching('hinge') || (ann.weight === 3 && touching('strong'))) grade = 2;
      else if (quiet / len > 0.6) grade = 0;
      else if (ann.weight === 0) grade = 0;
      // An unmarked sentence that is not the paragraph's first is elaboration: the
      // judgement pass found nothing in it worth naming, and the sentence that tells
      // you whether you want the rest of the paragraph is the one before it.
      //
      // The cut-off is weight ≤ 2, which is a choice worth seeing the numbers for.
      // At ≤ 1 the grades come out 33% / 57% / 10% and the page has a bright path
      // through a uniform grey; at ≤ 2 they come out 33% / 36% / 31% and it has
      // three visible tones, which is the thing being tested. The most load-bearing
      // paragraphs — weight 3 — are excluded either way, so no sentence of the
      // thirteen paragraphs the essay most needs can ever be called skippable.
      else if (ann.weight <= 2 && unmarked && idx > 0) grade = 0;
      else grade = 1;

      skimTally[grade]++;
      list.push({ start: s.start, end: s.end, classes: ['sent', `sent-g${grade}`] });
    });
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
const skimHits = skimRanges();
const seamsAt = seams();
const arcAt = spanIndex(arc);

/**
 * The gutter chip: what this paragraph does to the one before it.
 *
 * These used to be logic symbols — ∴ ⊥ ∵ ⌄ ⌃ ⇄ § — and Greg's first question on
 * seeing the page was "what do these mean?", which is the only review a glyph set
 * ever gets. Two things were wrong. The symbols were opaque (⊥ is the falsum sign,
 * not "but"), and the only explanation was a `title` attribute carrying the raw key,
 * so the answer to "what is this?" was "and-also".
 *
 * A symbol that needs a tooltip in a reading interface has already failed, so the
 * chip now carries a short WORD and the tooltip carries the sentence. The word is
 * the answer; the tip is the reason. Two of them are still signs (`+` and `=`), kept
 * because nobody has ever had to be taught either.
 */
const CONNECTIVE = {
  therefore: ['so', 'Therefore. This paragraph draws its conclusion from the one before it.'],
  but: ['but', 'But. This paragraph pushes back on what you just read.'],
  because: ['why', 'Because. This paragraph gives the reason for the one before it.'],
  'for-example': ['e.g.', 'For example. This paragraph is an instance of the claim above it.'],
  'and-also': ['+', 'And also. More of the same line of thought, no change of direction.'],
  'zoom-in': ['closer', 'Zooming in. The same subject, at more detail than the paragraph before.'],
  'zoom-out': ['wider', 'Zooming out. Stepping back from the detail you have just been given.'],
  contrast: ['vs', 'Contrast. Something set against what came before, without denying it.'],
  restates: ['=', 'Restates. The same point again, in different words.'],
  'new-thread': ['new', 'New thread. This starts something the paragraph before it did not lead to.'],
};

/**
 * What each rhetorical role means, in the reader's terms rather than ours. Shown as
 * a hairline label beside the block under the x-ray, and as a tooltip on the label
 * — because "implication" beside a paragraph is a word, not an explanation.
 */
const ROLE_TIP = {
  thesis: 'The thesis. One of the few paragraphs the whole essay exists to deliver.',
  claim: 'A claim. Something asserted here, which the surrounding paragraphs support.',
  evidence: 'Evidence. Offered in support of a claim made nearby.',
  example: 'An example. An instance of a claim rather than an argument for it.',
  anecdote: 'An anecdote. A story doing the work of an example.',
  definition: 'A definition. The piece is fixing what a term will mean from here on.',
  implication: 'An implication. What follows if the preceding claims hold.',
  conclusion: 'A conclusion. The argument arriving somewhere.',
  objection: 'An objection. A case against the argument, put by the author.',
  rebuttal: 'A rebuttal. The answer to an objection.',
  concession: 'A concession. The author granting a point that costs them something.',
  question: 'A question. Posed here and answered later; worth holding on to.',
  transition: 'A transition. Moving between parts rather than advancing the argument.',
  context: 'Context. Background you need before the argument can land.',
  aside: 'An aside. Interesting, and not load-bearing.',
  meta: 'Apparatus of the publication — credits, prizes, reading time. Not the essay.',
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
  for (const src of [skimHits, glossHits, ideaHits, commentHits, annHits]) {
    for (const r of src.get(block.id) ?? []) ranges.push(r);
  }

  const verse = opts.lineate;
  if (!verse) return renderRanges(parsed.text, ranges);

  const { start, end } = verse;
  const lines = lineate(parsed.text.slice(start, end));
  const body = lines.map((l) => `<span class="lin">${esc(l)}</span>`).join('');
  const tip =
    ' data-tip-title="The author\'s sentence, set as verse"' +
    ' data-tip="Broken at their own punctuation — every dash, semicolon and colon they wrote. Not one word added, removed or moved; only the pace. Line breaks are instructions to the reading voice."';
  return (
    renderRanges(parsed.text.slice(0, start), clip(ranges, 0, start)) +
    `<span class="lineated"${tip}>${body}</span>` +
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
      // The "not the author's" badge used to be printed beside every one of the
      // twenty-two generated headings. Greg: *"For the headings we've added, move
      // 'Not the author's' to a tooltip."* The provenance still has to be legible
      // without hovering, so it stays in the TYPE — ours are sans, small caps, one
      // ink step down, where the author's four are serif at full ink — and the
      // sentence saying so moves into the tip. A badge repeated twenty-two times
      // stops being read by the third one anyway.
      html += `<h${seam.depth + 1} class="seam-title" data-tip-title="Our heading, not the author's"`;
      html += ` data-tip="Spideryarn wrote this one. The author left this stretch untitled — four headings in 8,300 words — so we name the span the tree found. Their own headings are set in the serif at full ink.">`;
      html += `${esc(seam.title)}</h${seam.depth + 1}>`;
    }
    if (seam.gist) html += `<p class="seam-gist">${esc(seam.gist)}</p>`;
    html += `</div>`;
  }

  const a = arcAt.get(block.id);
  if (a && a !== lastArc) {
    lastArc = a;
    html += `<div class="arc-turn"><p data-tip-title="The argument turns here"`;
    html += ` data-tip="From arc.json — one sentence per stretch saying where in the ARGUMENT you are, not what the section says. This marker is left in the flow at the point the answer changes.">`;
    html += `${esc(a.text)}</p></div>`;
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
  if (ann?.connective) attrs.push(`data-connective="${ann.connective}"`);
  if (ann?.question) attrs.push(`data-question="${esc(ann.question)}"`);
  if (ann?.difficulty !== undefined) attrs.push(`data-difficulty="${ann.difficulty}"`);
  if (ann?.defines) attrs.push(`data-defines="${esc(ann.defines)}"`);

  spineTicks.push({ id: block.id, weight, kind: block.kind, words: block.words ?? 0, difficulty: ann?.difficulty ?? 0 });

  html += `<section ${attrs.join(' ')}>`;

  // The rhetorical role, as a real element rather than a `::after`. It was a
  // pseudo-element, which looked tidier and could not carry a tooltip — and "an
  // implication" beside a paragraph is a word, not an explanation.
  if (ann?.role) {
    html += `<span class="role-tag" data-tip-title="What this paragraph is doing"`;
    html += ` data-tip="${esc(ROLE_TIP[ann.role] ?? ann.role)} Hold X anywhere on the page to see the roles of every paragraph at once.">`;
    html += `${esc(ann.role)}</span>`;
  }

  // The machine's gutter, on the left. Never a hue, never inline.
  html += `<div class="gutter">`;
  if (ann?.connective) {
    const [word, tip] = CONNECTIVE[ann.connective] ?? ['·', 'Its relation to the paragraph before it.'];
    html += `<span class="conn conn-${ann.connective}" data-tip-title="This paragraph, and the one before" data-tip="${esc(tip)}">${esc(word)}</span>`;
  }
  if (labels[block.id]) {
    html += `<span class="gist" data-tip-title="One line for this paragraph"`;
    html += ` data-tip="Spideryarn's, from labels.json — what the paragraph says, in about ten words. Every one of the 141 blocks has one.">`;
    html += `${esc(labels[block.id])}</span>`;
  }
  if (ann?.question) {
    html += `<span class="q" data-tip-title="The question this answers"`;
    html += ` data-tip="Written in your voice rather than the author's. Reading a paragraph to answer a question is a different act from reading it to absorb one.">`;
    html += `${esc(ann.question)}</span>`;
  }
  // The gloss arrives beside the word the first time the article uses it, unasked.
  // A tooltip cannot do this: you have to already suspect you need it.
  for (const entry of firstUse.get(block.id) ?? []) {
    html += `<span class="gloss-note" data-gloss="${entry.id}"><b>${esc(entry.name)}</b>${esc(gloss(entry))}</span>`;
  }
  // The assumption stamp. Not a summary of the paragraph — a naming of what the
  // paragraph needs you to grant it.
  for (const idea of ideasAt.get(block.id) ?? []) {
    const verb = idea.provenance === 'assumed' ? 'assumes' : 'introduces';
    const tip =
      idea.provenance === 'assumed'
        ? 'This paragraph needs you to grant this, and never argues for it. Click for what it is and why the argument needs it.'
        : 'This paragraph puts this proposition into play; the rest of the essay leans on it. Click for why.';
    html += `<button class="idea-stamp" data-idea="${idea.id}" data-tip-title="An assumption underneath" data-tip="${esc(tip)}">${verb} · ${esc(idea.name)}</button>`;
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
    const tip = c.answer
      ? 'You asked about this passage and got an answer back. Click to read it.'
      : 'You bookmarked this passage and asked nothing. Click to see what you marked.';
    html += `<button class="note" data-comment="${c.id}" data-tip-title="${c.answer ? 'Your question' : 'Your bookmark'}" data-tip="${esc(tip)}">${c.answer ? '●' : '○'}</button>`;
  }
  html += `</div>`;

  html += `</section>`;

  // The gate. At the end of a major section, you say what you took from it; only
  // then does our summary open. Recall first, answer key second — the one ordering
  // that makes a summary strengthen the reading instead of replacing it.
  const gate = gateAfter.get(block.id);
  if (gate) {
    html += `<div class="gate" data-node="${gate.node.id}">`;
    html += `<p class="gate-prompt" data-tip-title="Say it before you are told it"`;
    html += ` data-tip="Free recall followed by feedback is the best-evidenced cheap thing you can do to a reading. Nothing here is scored and nothing is sent anywhere — the value is entirely in having tried to say it first, which is what turns a summary from a substitute for reading into an answer key.">`;
    html += `You have just read <b>${esc(gate.node.title)}</b>. In a sentence, what was its point? Nobody marks this.</p>`;
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
  labels,
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

// The skim path's shape, printed every build. A grading that came out 3% / 94% / 3%
// would render as a page with no skim path on it and would look, on screen, exactly
// like a grading that worked — so the distribution is a number rather than a glance.
{
  const total = skimTally[2] + skimTally[1] + skimTally[0];
  const pc = (n) => `${((n / total) * 100).toFixed(0)}%`;
  console.log(
    `skim path: ${total} sentences · ${skimTally[2]} carry the argument (${pc(skimTally[2])}) · ` +
      `${skimTally[1]} support it (${pc(skimTally[1])}) · ${skimTally[0]} skippable (${pc(skimTally[0])})`,
  );
  if (skimTally[2] === 0 || skimTally[0] === 0) note('skim', 'a grade nobody got — the layer will look like it is off');
}

// Tooltip coverage, for the same reason. Greg's first question about the page was
// what a gutter glyph meant, and the answer to "did we fix that" should be a count.
{
  const tips = (out.match(/data-tip="/g) ?? []).length;
  console.log(`tooltips: ${tips} explained marks on the page`);
}
if (problems.length) {
  console.log(`\n${problems.length} problems:`);
  for (const p of problems.slice(0, 40)) console.log('  ' + p);
  if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
} else {
  console.log('\nno problems — every quote, range endpoint and block reference resolved');
}

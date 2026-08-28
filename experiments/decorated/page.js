/*
 * Decorated mode — the small amount of behaviour the CSS cannot do.
 *
 * Almost every layer on this page is CSS reacting to a class on <html> and to data
 * the build put in the markup. What is left needs the reader's position or the
 * reader's pointer, and that is all this file is: the panel that toggles layers,
 * the spine, the arc rail, the hover cards, and the dwell timer behind read-first.
 *
 * No framework, no build step, no dependencies. It runs from file://.
 */

const D = window.DECOR;
const root = document.documentElement;

/* ------------------------------------------------------------- the panel --
 *
 * The manifest is the actual argument of this page: each layer, what it costs, and
 * — where a review said so — that somebody thought it was a bad idea. A playground
 * whose panel only lists the flattering ones is a demo.
 */

const LAYERS = [
  ['Structure', [
    ['L-seams', 'Our headings', 'The author wrote four headings in 8,300 words. The tree has twenty-six spans that wanted one, so we write the rest — set in the sans, in small caps, labelled "not the author\'s". A reader must never have to wonder who wrote a heading.'],
    ['L-overtures', 'Section overtures', 'Under each of our headings, the one-sentence gist of the span. Skippable by design: it sits in the apparatus voice, not the prose voice.'],
    ['L-spine', 'The spine', 'The whole article as one object down the left edge. Tick length is how load-bearing the block is, so the argument\'s peaks are visible from the top. Orange pips are your own marks.'],
    ['L-rubric', 'Rubrication', 'What a scribe did before bold existed: the opening of each section in a different treatment — a two-line initial and small caps — so the eye can find where things start.'],
  ]],
  ['The argument', [
    ['L-arc', 'The arc rail', 'One sticky sentence saying where in the ARGUMENT you are, not what the section says. The cheapest external store for the thing that decays fastest across an hour-long essay.'],
    ['L-turns', 'Turn markers', 'The same sentences left in the flow where the argument actually turns, set between rules like a printed fleuron.'],
    ['L-gutter', 'The turn gutter', 'One glyph per paragraph for its logical relation to the one before: ∴ therefore, ⊥ but, ∵ because, ⌄ zoom in. The dull ones are faded — thirty-four paragraphs in a row of "+ and also" is the truth about most prose.'],
    ['L-roles', 'Rhetorical x-ray', 'A hairline beside each paragraph saying what it is DOING — claim, evidence, concession, rebuttal — rather than what it says. Readers who understand every sentence still lose track of this.'],
    ['L-ideas', 'The assumptions', 'ideas.json, the artefact nothing else uses: the propositions the essay needs you to grant, most never argued for. Dotted under the exact words, stamped in the gutter, and clicking says why the argument needs it.'],
  ]],
  ['The sentences', [
    ['L-topography', 'Salience relief', 'Greg\'s seed idea as continuous relief rather than a highlighter: load-bearing paragraphs get more air and fuller ink, minor ones less, and the one sentence carrying each paragraph gets weight. Never below a legible floor.'],
    ['L-size', '…and by size too', 'Greg asked for critical sentences to be bigger. Reading science says varying size within a text column disrupts saccade targeting. Both are on this page; this switch is the disagreement.', 'contested'],
    ['L-quiet', 'Fade the skippable', 'The parentheticals and credentials a careful reader can skip, one ink step down. The same review calls this de-facto deletion. Judge it with the prose in front of you.', 'contested'],
    ['L-hedge', 'Mark the hedges', '"May be possible", "arguably", "some researchers think" — dotted, with a raised query. The one decoration here that makes reading slower on purpose, because this essay is about what we do and do not know.'],
    ['L-numbers', 'Figures that behave', 'Old-style numerals in running prose so dates stop shouting; lining tabular figures on the quantities that carry an argument, boxed in a hairline so you can find them again.'],
    ['L-lineate', 'The thesis as verse', 'The three sentences the essay exists to deliver, broken at the author\'s own punctuation and set with hanging indents. Not one word added, removed or moved — only the pace. The most audacious thing available inside the rule.'],
  ]],
  ['The terms, and you', [
    ['L-gloss', 'Glossary underlines', 'Every occurrence underlined; the FIRST occurrence marked differently, because that is the only place the reader can still be taught something.'],
    ['L-marginalia', 'Glosses in the margin', 'On first use the definition arrives in the gutter unasked, at the height of the word — what a printed gloss does and a tooltip cannot, since a tooltip needs you to already suspect you need it.'],
    ['L-gists', 'A line per paragraph', 'labels.json for all 141 blocks. Honest test: does a second article down the left margin help you, or does it replace the first?', 'contested'],
    ['L-questions', 'The question it answers', 'Each paragraph\'s question in the margin, in the reader\'s voice. Reading to answer a question is a different act from reading to absorb one.'],
    ['L-comments', 'Your own marks', 'Fifteen real bookmarks and notes. The only hue on the page: nothing a model decided is ever orange.'],
    ['L-gate', 'The section gate', 'At the end of each section, say what you took from it before our summary will open. Free recall then feedback is the best-evidenced cheap intervention there is — and it turns a summary from a substitute for reading into the answer key.'],
  ]],
  ['The strange ones', [
    ['L-readfirst', 'Earn the ink', 'The apparatus does not exist until you have been beside the paragraph long enough to have read it. Decoration becomes a second reading rather than a shortcut past the first. Turn this on and scroll slowly.'],
    ['L-gravity', 'Argument gravity', 'Each paragraph leans a few pixels: toward the measure when it supports what came before, away when it pushes back. Nothing is stated; the page just develops a physical tension where the argument has one. Probably a bad idea.'],
  ]],
];

const PRESETS = {
  all: LAYERS.flatMap(([, rows]) => rows.map((r) => r[0])),
  none: [],
  quiet: ['L-seams', 'L-arc', 'L-gutter', 'L-gloss', 'L-ideas', 'L-comments', 'L-topography', 'L-spine', 'L-hedge', 'L-numbers'],
  loud: ['L-seams', 'L-overtures', 'L-spine', 'L-rubric', 'L-arc', 'L-turns', 'L-gutter', 'L-roles', 'L-ideas', 'L-topography', 'L-size', 'L-quiet', 'L-hedge', 'L-numbers', 'L-lineate', 'L-gloss', 'L-marginalia', 'L-gists', 'L-questions', 'L-comments', 'L-gate'],
};

const panel = document.getElementById('panel');
const panelBody = document.getElementById('panel-body');
const panelToggle = document.getElementById('panel-toggle');

for (const [group, rows] of LAYERS) {
  const h = document.createElement('p');
  h.className = 'panel-group';
  h.textContent = group;
  panelBody.append(h);
  for (const [id, name, blurb, flag] of rows) {
    const row = document.createElement('div');
    row.className = 'layer-row';
    const on = root.classList.contains(id);
    row.innerHTML =
      `<label><input type="checkbox" data-layer="${id}"${on ? ' checked' : ''}>` +
      `<span><b>${name}</b>${flag ? ` <span class="flag">${flag}</span>` : ''}` +
      `<span class="blurb">${blurb}</span></span></label>`;
    panelBody.append(row);
  }
}

panelBody.addEventListener('change', (e) => {
  const box = e.target.closest('input[data-layer]');
  if (!box) return;
  root.classList.toggle(box.dataset.layer, box.checked);
  save();
});

for (const btn of panel.querySelectorAll('[data-preset]')) {
  btn.addEventListener('click', () => {
    const want = new Set(PRESETS[btn.dataset.preset]);
    for (const box of panelBody.querySelectorAll('input[data-layer]')) {
      box.checked = want.has(box.dataset.layer);
      root.classList.toggle(box.dataset.layer, box.checked);
    }
    save();
  });
}

const open = (yes) => {
  panel.hidden = !yes;
  panelToggle.hidden = yes;
  panelToggle.setAttribute('aria-expanded', String(yes));
};
panelToggle.addEventListener('click', () => open(true));
document.getElementById('panel-close').addEventListener('click', () => open(false));

// Which layers you had on, kept between reloads. Wrapped because storage throws
// outright in a private window rather than merely returning null.
function save() {
  try {
    const on = [...panelBody.querySelectorAll('input[data-layer]:checked')].map((b) => b.dataset.layer);
    localStorage.setItem('decorated.layers', JSON.stringify(on));
  } catch {}
}
try {
  const saved = JSON.parse(localStorage.getItem('decorated.layers') ?? 'null');
  if (Array.isArray(saved)) {
    for (const box of panelBody.querySelectorAll('input[data-layer]')) {
      box.checked = saved.includes(box.dataset.layer);
      root.classList.toggle(box.dataset.layer, box.checked);
    }
  }
} catch {}

/* -------------------------------------------------------------- the spine --
 *
 * 141 ticks, one per block, sized by how load-bearing the block is. No text, so it
 * costs no reading — which is the whole argument for putting the shape of an
 * 8,300-word essay somewhere permanently visible.
 */

const spineInner = document.getElementById('spine-inner');
const withNotes = new Set(Object.values(D.comments).map((c) => c.blockId));
const tickFor = new Map();
for (const t of D.spine) {
  const el = document.createElement('a');
  el.className = 'tick' + (withNotes.has(t.id) ? ' has-note' : '');
  el.href = '#' + t.id;
  el.dataset.w = t.weight ?? 1;
  el.style.flexGrow = String(Math.max(1, t.words || 6));
  el.title = t.id;
  spineInner.append(el);
  tickFor.set(t.id, el);
}

/* ------------------------------------------------------- position, and arc --
 *
 * One observer drives three things — the arc rail, the spine's marker, and the
 * gutter's brightening — because they are all answers to the same question, and
 * three observers would answer it at three slightly different moments.
 */

const arcRail = document.getElementById('arc-rail');
const arcText = document.getElementById('arc-text');
const blocks = [...document.querySelectorAll('.blk')];
const arcFor = new Map();
{
  const ids = D.spine.map((s) => s.id);
  for (const entry of D.arc) {
    const from = ids.indexOf(entry.range[0]);
    const to = ids.indexOf(entry.range[1]);
    for (let i = from; i >= 0 && i <= to; i++) arcFor.set(ids[i], entry.text);
  }
}

let current = null;
const visible = new Set();

const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) visible.add(e.target);
      else visible.delete(e.target);
    }
    // The topmost visible block is "where you are". Using the topmost rather than
    // the most-visible keeps the rail from flapping between two long paragraphs.
    let top = null;
    for (const el of visible) if (!top || el.offsetTop < top.offsetTop) top = el;
    if (!top || top === current) return;
    current?.classList.remove('here');
    tickFor.get(current?.id)?.classList.remove('now');
    current = top;
    current.classList.add('here');
    tickFor.get(current.id)?.classList.add('now');
    const text = arcFor.get(current.id);
    arcRail.hidden = !text;
    if (text && arcText.textContent !== text) arcText.textContent = text;
  },
  { rootMargin: '-10% 0px -60% 0px', threshold: 0 },
);
for (const b of blocks) io.observe(b);

/* --------------------------------------------------------- earn the ink --
 *
 * A block is "read" once it has been in the reading band for long enough that you
 * could have read it — scaled by its length, because two seconds is plenty for a
 * caption and nothing at all for a 120-word paragraph.
 *
 * It is a dwell timer, not a comprehension check. It cannot tell reading from
 * staring. It does not have to: the point is only that the apparatus arrives after
 * the prose rather than before it.
 */

const wordsFor = new Map(D.spine.map((s) => [s.id, s.words || 10]));
const timers = new Map();
const readObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const el = e.target;
      if (el.classList.contains('read')) continue;
      if (e.isIntersecting) {
        if (timers.has(el)) continue;
        // ~300 wpm, floored at three quarters of a second.
        const ms = Math.max(750, (wordsFor.get(el.id) / 300) * 60000);
        timers.set(el, setTimeout(() => { el.classList.add('read'); timers.delete(el); }, ms));
      } else {
        clearTimeout(timers.get(el));
        timers.delete(el);
      }
    }
  },
  { rootMargin: '-20% 0px -45% 0px', threshold: 0 },
);
for (const b of blocks) readObserver.observe(b);

/* --------------------------------------------------------------- cards --
 *
 * Glossary terms, assumptions and your own notes all open the same panel, anchored
 * to whatever you touched. `popover` gets the top layer, the light-dismiss and the
 * escape key for free — this used to be a component.
 */

const card = document.getElementById('card');

function showCard(anchor, html) {
  card.innerHTML = html;
  card.showPopover();
  const r = anchor.getBoundingClientRect();
  const w = card.offsetWidth;
  const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  const below = r.bottom + 8;
  const fits = below + card.offsetHeight < window.innerHeight - 8;
  card.style.left = left + 'px';
  card.style.top = (fits ? below : Math.max(8, r.top - card.offsetHeight - 8)) + 'px';
  card.style.position = 'fixed';
  card.style.margin = '0';
}

const escape = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-gloss]');
  if (g) {
    const entry = D.glossary[g.dataset.gloss];
    if (entry) {
      showCard(g, `<span class="kind">${escape(entry.kind)}</span><h4>${escape(entry.name)}</h4><p>${escape(entry.background)}</p>`);
      return;
    }
  }
  const i = e.target.closest('[data-idea]');
  if (i) {
    const idea = D.ideas[i.dataset.idea];
    if (idea) {
      showCard(
        i,
        `<span class="kind">${escape(idea.provenance)} · an idea the piece needs</span>` +
          `<h4>${escape(idea.name)}</h4><p>${escape(idea.statement)}</p>` +
          `<p class="why">${escape(idea.whyYouNeedIt)}</p>`,
      );
      return;
    }
  }
  const c = e.target.closest('[data-comment]');
  if (c) {
    const note = D.comments[c.dataset.comment];
    if (note) {
      showCard(
        c,
        `<span class="kind">your ${note.answer ? 'question' : 'bookmark'}</span>` +
          `<h4>“${escape(note.quote)}”</h4>` +
          (note.answer ? `<p>${escape(note.answer)}</p>` : '<p class="why">Saved, unanswered. Saving costs nothing.</p>'),
      );
    }
  }
});

// Hover opens a glossary card too, but only after a beat, so brushing past a
// hundred underlined terms while scrolling does not strobe the page.
let hoverTimer = null;
document.addEventListener('pointerover', (e) => {
  const g = e.target.closest('.gloss');
  clearTimeout(hoverTimer);
  if (!g) return;
  hoverTimer = setTimeout(() => {
    const entry = D.glossary[g.dataset.gloss];
    if (entry) showCard(g, `<span class="kind">${escape(entry.kind)}</span><h4>${escape(entry.name)}</h4><p>${escape(entry.background)}</p>`);
  }, 420);
});

/* ---------------------------------------------------------- the gate --
 *
 * Type something — anything — and the answer key unlocks. Nothing is scored and
 * nothing is sent anywhere; the value is in having tried to say it first.
 */

for (const gate of document.querySelectorAll('.gate')) {
  const box = gate.querySelector('textarea');
  const btn = gate.querySelector('.gate-reveal');
  box.addEventListener('input', () => { btn.disabled = box.value.trim().length < 12; });
  btn.addEventListener('click', () => { gate.classList.add('open'); btn.disabled = true; btn.textContent = 'that is what we\'d have said'; });
}

/* ----------------------------------------------------------- the copy --
 *
 * The other half of the promise. `user-select: none` in the stylesheet keeps the
 * apparatus out of a selection; this keeps the author's own text intact on the way
 * to the clipboard.
 *
 * The verse layer is why it is needed: its lines are `display: block`, so the
 * browser serialises them with newlines the author never wrote. Any decoration that
 * makes a run of inline text into blocks has the same problem, which is why this
 * normalises whitespace across the whole selection rather than special-casing the
 * one layer that does it today.
 */
document.addEventListener('copy', (e) => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const frag = sel.getRangeAt(0).cloneContents();
  // Belt and braces: `user-select: none` should have kept these out already, but a
  // selection made with the keyboard, or a browser that disagrees, would carry them.
  for (const el of frag.querySelectorAll('.gutter, .margin, .seam, .arc-turn, .gate, .idea-stamp, .gloss-note')) {
    el.remove();
  }
  const text = (frag.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  e.clipboardData.setData('text/plain', text);
  e.preventDefault();
});

/* ------------------------------------------------------------ keyboard -- */

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'l') { open(panel.hidden); e.preventDefault(); }
  // Hold X for the x-ray: the rhetorical layer as a momentary thing you ask for,
  // which is how it stays inside the no-persistent-highlighter rule.
  if (e.key === 'x' && !e.repeat) root.classList.add('L-roles');
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'x' && !panelBody.querySelector('[data-layer="L-roles"]').checked) root.classList.remove('L-roles');
});

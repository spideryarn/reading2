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
    ['L-seams', 'Our headings', 'The author wrote four headings in 8,300 words. The tree has twenty-six spans that wanted one, so we write the rest. Ours are sans and small caps where theirs are serif at full ink, and hovering one says in words that it is not the author\'s. A reader must never have to wonder who wrote a heading.'],
    ['L-overtures', 'Section overtures', 'Under each of our headings, the one-sentence gist of the span. Skippable by design: it sits in the apparatus voice, not the prose voice.'],
    ['L-spine', 'The spine', 'The whole article as one object down the left edge. Tick length is how load-bearing the block is, so the argument\'s peaks are visible from the top. Orange pips are your own marks.'],
    ['L-rubric', 'Rubrication', 'What a scribe did before bold existed: the opening line of each section in small caps, so a reader who lands mid-page can see they are at the top of a section rather than the middle of one. The drop cap that used to come with it is gone — it said nothing the rule and the heading had not already said.'],
  ]],
  ['The argument', [
    ['L-arc', 'The arc rail', 'One sticky sentence saying where in the ARGUMENT you are, not what the section says. The cheapest external store for the thing that decays fastest across an hour-long essay.'],
    ['L-turns', 'Turn markers', 'The same sentences left in the flow where the argument actually turns, set between rules like a printed fleuron.'],
    ['L-gutter', 'The turn gutter', 'One word per paragraph for its logical relation to the one before: so, but, why, closer, wider, vs. It used to be logic symbols, and the only question anyone asked about them was what they meant. The dull ones are faded — thirty-four paragraphs in a row of "+ and also" is the truth about most prose.'],
    ['L-roles', 'Rhetorical x-ray', 'A hairline beside each paragraph saying what it is DOING — claim, evidence, concession, rebuttal — rather than what it says. Readers who understand every sentence still lose track of this.'],
    ['L-ideas', 'The assumptions', 'ideas.json, the artefact nothing else uses: the propositions the essay needs you to grant, most never argued for. Dashed under the exact words, stamped in the gutter, and clicking says why the argument needs it.'],
  ]],
  ['The sentences', [
    ['L-skim', 'The skim path', 'Sentence by sentence, not paragraph by paragraph: the ones carrying the argument at full ink, the workings a step down, the genuinely skippable at the floor. Read only the bright ones and you should still have the argument. Hold S to see it without switching it on.'],
    ['L-topography', 'Salience relief', 'Greg\'s seed idea as continuous relief rather than a highlighter: load-bearing paragraphs get more air and fuller ink, minor ones less, and the one sentence carrying each paragraph gets weight. Never below a legible floor.'],
    ['L-size', '…and by size too', 'Greg asked for critical sentences to be bigger. Reading science says varying size within a text column disrupts saccade targeting. Both are on this page; this switch is the disagreement.', 'contested'],
    ['L-quiet', 'Fade the skippable', 'The parentheticals and credentials a careful reader can skip, one ink step down. The same review calls this de-facto deletion. Judge it with the prose in front of you.', 'contested'],
    ['L-hedge', 'Mark the hedges', '"May be possible", "arguably", "some researchers think" — a wavy rule and a raised query. The one decoration here that makes reading slower on purpose, because this essay is about what we do and do not know.'],
    ['L-numbers', 'Figures that behave', 'Old-style numerals in running prose so dates stop shouting; lining tabular figures on the quantities that carry an argument, boxed in a hairline so you can find them again.'],
    ['L-lineate', 'The thesis as verse', 'The three sentences the essay exists to deliver, broken at the author\'s own punctuation and set with hanging indents. Not one word added, removed or moved — only the pace. The most audacious thing available inside the rule.'],
  ]],
  ['The terms, and you', [
    ['L-gloss', 'Glossary underlines', 'Dotted, as in the reading view — the same convention, so nobody has to learn a second one — with the first occurrence in a fuller ink, because that is the only place a reader can still be taught something. Hover for the card.'],
    ['L-marginalia', 'Glosses in the margin', 'On first use the definition arrives in the gutter unasked, at the height of the word — what a printed gloss does and a tooltip cannot, since a tooltip needs you to already suspect you need it.'],
    ['L-gists', 'A line per paragraph', 'labels.json for all 141 blocks. Honest test: does a second article down the left margin help you, or does it replace the first?', 'contested'],
    ['L-questions', 'The question it answers', 'Each paragraph\'s question in the margin, in the reader\'s voice. Reading to answer a question is a different act from reading to absorb one.'],
    // The count is read from the data rather than written down: it said "fifteen"
    // for a day while someone annotated the article up to twenty-seven, and a blurb
    // that is quietly wrong about the page it describes is worse than no blurb.
    ['L-comments', 'Your own marks', `${Object.keys(D.comments).length} real bookmarks and notes. The only hue on the page: nothing a model decided is ever orange.`],
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
  quiet: ['L-seams', 'L-arc', 'L-gutter', 'L-gloss', 'L-ideas', 'L-comments', 'L-skim', 'L-spine', 'L-hedge', 'L-numbers'],
  loud: ['L-seams', 'L-overtures', 'L-spine', 'L-rubric', 'L-arc', 'L-turns', 'L-gutter', 'L-roles', 'L-ideas', 'L-skim', 'L-topography', 'L-size', 'L-quiet', 'L-hedge', 'L-numbers', 'L-lineate', 'L-gloss', 'L-marginalia', 'L-gists', 'L-questions', 'L-comments', 'L-gate'],
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

/* ------------------------------------------------------------ the legend --
 *
 * Twenty conventions is more than anyone will discover by hovering them one at a
 * time, and a reader who does not know a mark exists will never hover it. So they
 * are listed once, at the top of the panel, and each sample is drawn by the real
 * rules rather than described in words.
 */

const MARKS = [
  ['<span class="gloss">consciousness</span>', 'A glossary term', 'Dotted, the same as the reading view. Hover for who or what it is. The first occurrence is drawn in a fuller ink, because that is the only place you can still be taught something.'],
  ['<span class="idea">it must be so</span>', 'An assumption', 'Dashed. Words the argument needs you to grant, mostly never argued for. Click for what it is and why the essay needs it.'],
  ['<span class="sp-hedge">may be</span>', 'A hedge', 'Wavy, with a raised query. The author is qualifying rather than asserting, and readers routinely remember the qualified as the flat.'],
  ['<span class="lnk">the paper</span>', 'A link', 'Solid, and the author\'s own. Nothing we added is ever solid-underlined.'],
  ['<span class="sp-hinge">and yet</span>', 'A hinge', 'Small caps under a hairline: the words where the argument changes direction.'],
  ['<span class="sp-number">1950</span>', 'A figure', 'Lining and underlined where the argument leans on it; every other numeral is old-style, so dates stop shouting.'],
  ['<span class="conn">but</span>', 'A turn chip', 'In the gutter, one per paragraph: what this paragraph does to the one before it. Hover for the sentence.'],
  ['<span class="g2">bright</span> · <span class="g0">faint</span>', 'The skim path', 'Sentence by sentence: bright carries the argument, faint can be skipped. Nothing is ever hidden — the faintest step is still readable prose.'],
  ['<span class="dot">●</span> <span class="dot">○</span>', 'Yours', 'The only colour on the page. Filled means you asked and got an answer; hollow is a bookmark.'],
];

{
  const wrap = document.createElement('div');
  wrap.className = 'legend';
  const h = document.createElement('p');
  h.className = 'panel-group';
  h.textContent = 'What the marks mean';
  wrap.append(h);
  for (const [sample, name, what] of MARKS) {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `<span class="legend-sample">${sample}</span><p><b>${name}.</b> ${what}</p>`;
    wrap.append(row);
  }
  panelBody.prepend(wrap);
}

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
  // A tick used to carry its block id as a `title`, which answered a question
  // nobody has. What a reader wants from the spine is what is down there.
  const label = D.labels?.[t.id];
  el.dataset.tipTitle = ['skippable', 'minor', 'carries weight', 'load-bearing'][t.weight ?? 1] ?? 'the article';
  el.dataset.tip = label ? label + ' — click to jump there.' : 'Click to jump there.';
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

/*
 * A glossary entry carries EITHER `background` — who a person is, what a work is —
 * OR `senseHere`, the sense this piece gives a concept, and about half carry both.
 * Ten of the nineteen entries here have no `background` at all.
 *
 * This card used to print `entry.background` and nothing else, so those ten said the
 * word "undefined" where the definition goes. The builder had a `gloss()` helper for
 * exactly this and the renderer never used it — the fix landed on one side of the
 * seam. Both halves are worth showing anyway: "who this is" and "what this piece
 * means by it" are different offers, and flattening them loses the second.
 */
function glossCard(entry) {
  let html = `<span class="kind">${escape(entry.kind)}</span><h4>${escape(entry.name)}</h4>`;
  if (entry.background) html += `<p>${escape(entry.background)}</p>`;
  if (entry.senseHere) html += `<p class="why">In this piece: ${escape(entry.senseHere)}</p>`;
  if (!entry.background && !entry.senseHere) html += `<p class="why">No definition stored for this term.</p>`;
  return html;
}

document.addEventListener('click', (e) => {
  // Anything opened by a click stays open until it is dismissed; see the hover
  // handler below for the other half of this.
  //
  // `clearTimeout` first, and it is load-bearing. The pointer has to arrive at the
  // word before it can be clicked, so a hover timer is always already armed when
  // this runs — and 420ms later it would fire `cardPinned = false` and re-open the
  // card unpinned, silently undoing the pin on a card the reader deliberately
  // clicked. The pin looked set at the moment of the click and came undone half a
  // second afterwards, which is why it took instrumenting the flag to see it.
  if (e.target.closest('[data-gloss], [data-idea], [data-comment]')) {
    clearTimeout(hoverTimer);
    cardPinned = true;
  }
  const g = e.target.closest('[data-gloss]');
  if (g) {
    const entry = D.glossary[g.dataset.gloss];
    if (entry) {
      showCard(g, glossCard(entry));
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

/*
 * Hover opens a glossary card too, but only after a beat, so brushing past a hundred
 * underlined terms while scrolling does not strobe the page.
 *
 * A hovered card LEAVES when the pointer does; a clicked one stays until it is
 * dismissed. That distinction was missing, and the result was a card that opened on
 * a brush past a word and then sat over the article indefinitely while the reader
 * went somewhere else — light-dismiss will close it, but only if you happen to
 * click, and nothing tells you that. The card is a destination when you asked for
 * it and a nuisance when you did not.
 *
 * The grace period matters: the pointer has to be able to travel from the word to
 * the card without the card vanishing under it on the way.
 */
let hoverTimer = null;
let cardPinned = false;

function closeCardIfUnpinned() {
  if (cardPinned) return;
  try { card.hidePopover(); } catch {}
}

document.addEventListener('pointerover', (e) => {
  const g = e.target.closest('.gloss');
  clearTimeout(hoverTimer);
  if (g) {
    hoverTimer = setTimeout(() => {
      const entry = D.glossary[g.dataset.gloss];
      if (!entry) return;
      cardPinned = false;
      showCard(g, glossCard(entry));
    }, 420);
    return;
  }
  // Over the card itself is still "over the card" — reading it must not close it.
  if (e.target.closest('#card')) return;
  hoverTimer = setTimeout(closeCardIfUnpinned, 260);
});

// A click is a request, so it pins. `toggle` fires on light-dismiss and on Escape,
// which is where the pin gets cleared — otherwise the next hover would inherit it.
card.addEventListener('toggle', (e) => { if (e.newState === 'closed') cardPinned = false; });

/* ---------------------------------------------------------- the tips --
 *
 * Everything this page adds to the article can say what it is. Anything carrying
 * `data-tip` gets a caption on hover, and `data-tip-title` gives it a heading.
 *
 * Deliberately not `title`. A native tooltip takes about a second to appear, cannot
 * be styled, wraps at the browser's whim, and — the thing that actually mattered
 * here — was carrying the raw data. The gutter chips had `title="and-also"`, which
 * is not an explanation, it is the key we look the explanation up under.
 *
 * The tip never covers the mark it explains: below-right by default, flipped above
 * when there is no room below, clamped into the viewport on both axes. It leaves on
 * pointer-out, on scroll and on Escape, and it is `pointer-events: none` so it can
 * never sit between the pointer and the thing under it.
 */

const tip = document.getElementById('tip');
let tipTimer = null;
let tipFor = null;

function hideTip() {
  clearTimeout(tipTimer);
  tip.classList.remove('on');
  tipFor = null;
}

function showTip(el) {
  const body = el.dataset.tip;
  if (!body) return;
  const title = el.dataset.tipTitle;
  tip.innerHTML = (title ? `<b>${escape(title)}</b>` : '') + escape(body);
  tip.classList.add('on');
  tipFor = el;

  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const pad = 8;
  const left = Math.min(Math.max(pad, r.left), window.innerWidth - w - pad);
  const below = r.bottom + 6;
  const top = below + h < window.innerHeight - pad ? below : Math.max(pad, r.top - h - 6);
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

document.addEventListener('pointerover', (e) => {
  const el = e.target.closest('[data-tip]');
  // Clear FIRST, then decide. Ordered the other way, coming back to the element you
  // just left inside the grace period took the early return and left the pending
  // hide timer armed, so the tip vanished while the pointer was sitting on the mark.
  clearTimeout(tipTimer);
  if (el && el === tipFor) return;
  if (!el) {
    // A short grace period, so crossing a two-pixel gap between two chips does not
    // flash the tip out and back in.
    tipTimer = setTimeout(hideTip, 120);
    return;
  }
  tipTimer = setTimeout(() => showTip(el), 260);
});

// Keyboard reachability, for the marks that are real buttons.
document.addEventListener('focusin', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el) showTip(el);
  else hideTip();
});

window.addEventListener('scroll', hideTip, { passive: true });

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
  if (e.key === 'Escape') hideTip();
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'l') { open(panel.hidden); e.preventDefault(); }
  // Hold X for the x-ray: the rhetorical layer as a momentary thing you ask for,
  // which is how it stays inside the no-persistent-highlighter rule.
  if (e.key === 'x' && !e.repeat) root.classList.add('L-roles');
  // Hold S for the skim path. Same idea, and it is the better way to use this one:
  // you ask where to go next, you do not read in it.
  if (e.key === 's' && !e.repeat) root.classList.add('skim-peek');
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'x' && !panelBody.querySelector('[data-layer="L-roles"]').checked) root.classList.remove('L-roles');
  if (e.key === 's') root.classList.remove('skim-peek');
});

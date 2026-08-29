/**
 * The one claim this page makes: not a word of the article has been removed,
 * reordered or changed. Everything else is a matter of taste; this is a matter of
 * fact, and a decorator that quietly drops a clause would look exactly like one
 * that does not.
 *
 *   node experiments/decorated/verify.mjs
 *
 * It reads the BUILT page back — not the builder's intentions — pulls the text out
 * of each block's body, and compares it to the stored block. Then it corrupts a
 * copy and runs the same comparison again, because a check nobody has watched fail
 * is not evidence. Both results are printed.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseInline } from './inline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const SLUG = 'noema-mythology-of-conscious-ai';

const blocks = JSON.parse(readFileSync(join(REPO, 'data', SLUG, 'blocks.json'), 'utf8')).blocks;
const page = readFileSync(join(HERE, 'decorated.html'), 'utf8');

/** Every `<section id="spya-…">` in the page, with just its `.body` markup. */
function bodies(html) {
  const out = new Map();
  const re = /<section id="(spya-[a-z0-9]+)"[^>]*>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(html))) {
    const inner = m[2];
    const start = inner.indexOf('<div class="body">');
    const end = inner.indexOf('<div class="margin">');
    if (start === -1 || end === -1) continue;
    out.set(m[1], inner.slice(start + '<div class="body">'.length, end));
  }
  return out;
}

/** The same normalisation the pipeline used, applied to arbitrary markup. */
function textOf(markup) {
  return parseInline(`<x>${markup}</x>`).text;
}

function compare(html) {
  const found = bodies(html);
  const bad = [];
  let checked = 0;
  for (const block of blocks) {
    const markup = found.get(block.id);
    if (markup === undefined) { bad.push(`${block.id}: not on the page at all`); continue; }
    const want = parseInline(block.html).text;
    const got = textOf(markup);
    checked++;
    if (got !== want) {
      let i = 0;
      while (i < got.length && i < want.length && got[i] === want[i]) i++;
      bad.push(
        `${block.id}: diverges at ${i}\n    stored: ${JSON.stringify(want.slice(Math.max(0, i - 30), i + 40))}` +
          `\n    page:   ${JSON.stringify(got.slice(Math.max(0, i - 30), i + 40))}`,
      );
    }
  }
  return { checked, bad };
}

const real = compare(page);
console.log(`the page as built: ${real.checked} blocks compared, ${real.bad.length} altered`);
for (const b of real.bad) console.log('  ' + b);

/*
 * The other direction, and the one that was actually wrong.
 *
 * "No word removed or changed" is only half the promise. Printing the author's own
 * heading a second time, as our own generated heading, adds words — and it looks
 * like a styling decision, not a duplication, until you read the built page back.
 * Every span the author titled had its title on the page twice.
 */
const authorText = new Set(blocks.map((b) => parseInline(b.html).text.trim()).filter(Boolean));

function echoedHeadings(html) {
  const out = [];
  for (const m of html.matchAll(/<h[1-6] class="seam-title">([\s\S]*?)<\/h[1-6]>/g)) {
    const title = m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
    if (authorText.has(title)) out.push(title);
  }
  return out;
}

// And the apparatus must be unselectable, or it leaves in the reader's clipboard
// inside a quotation with the author's name on it.
const MUST_BE_UNSELECTABLE = ['.gutter', '.margin', '.seam-title', '.seam-gist', '.arc-turn', '.gate', '.idea-stamp', '.gloss-note'];

function selectableApparatus(html) {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  return MUST_BE_UNSELECTABLE.filter(
    (sel) => !new RegExp(`[^}]*\\${sel}[^{]*\\{[^}]*user-select:\\s*none`).test(css),
  );
}

const echoed = echoedHeadings(page);
console.log(`\nour headings that repeat an author heading: ${echoed.length} (expected 0)`);
for (const t of echoed) console.log('  ' + JSON.stringify(t));
if (echoed.length) process.exitCode = 1;

const selectable = selectableApparatus(page);
console.log(`apparatus selectors missing user-select:none: ${selectable.length} (expected 0)`);
for (const s of selectable) console.log('  ' + s);
if (selectable.length) process.exitCode = 1;

// Controls for both, because neither had ever been watched failing. Each
// re-introduces the exact bug that was live an hour ago: the first reprinted every
// author heading as ours, the second let the whole apparatus into the clipboard.
const authorHeading = blocks.find((b) => b.kind === 'heading' && b.tag === 'h2').text;
const echoControl = echoedHeadings(page.replace('<main id="stream">', `<main id="stream"><h2 class="seam-title">${authorHeading}</h2>`));
const selectControl = selectableApparatus(page.replace(/user-select: none;/g, 'user-select: auto;'));
console.log(
  `\ncontrols — heading echo re-introduced: ${echoControl.length} found (expected at least 1); ` +
    `user-select stripped: ${selectControl.length} of ${MUST_BE_UNSELECTABLE.length} now selectable`,
);
if (echoControl.length === 0 || selectControl.length !== MUST_BE_UNSELECTABLE.length) {
  console.log('  ONE OF THESE CHECKS IS BROKEN — its clean run above means nothing.');
  process.exitCode = 1;
}

// The control. Delete four words from one paragraph of a copy — the exact thing the
// rule forbids and the thing an eyeball scrolling past would never catch — and run
// the identical comparison. If this comes back clean, the check above proves nothing.
//
// The four words have to come from a TEXT NODE. The first version of this matched
// four lower-case words anywhere in a window of the markup, and when every sentence
// acquired a wrapper and several marks acquired `data-tip="…"`, the window filled up
// with English prose sitting inside attributes. It found its four words in a
// tooltip, deleted them, and the comparison came back clean — because deleting words
// from an attribute changes nothing about the article. The check reported that IT
// was broken, which is the only reason this was noticed at all: the control had
// stopped being able to damage the thing it was meant to damage.
const victim = blocks.find((b) => b.kind === 'text' && b.words > 60);
const damaged = deleteFourWords(page, victim.id);

/** Remove four consecutive words from the victim block's rendered text, not its markup. */
function deleteFourWords(html, id) {
  const open = html.indexOf(`<section id="${id}"`);
  const bodyAt = html.indexOf('<div class="body">', open);
  const end = html.indexOf('<div class="margin">', bodyAt);
  if (open === -1 || bodyAt === -1 || end === -1) throw new Error(`the control could not find ${id} on the page`);
  const region = html.slice(bodyAt, end);
  // Every stretch between a `>` and the next `<` is text the reader sees. Attribute
  // values never are, and that is the whole distinction the old version missed.
  for (const m of region.matchAll(/>([^<>]{40,})</g)) {
    const words = /[a-z]+ [a-z]+ [a-z]+ [a-z]+ /.exec(m[1]);
    if (!words) continue;
    const at = bodyAt + m.index + 1 + words.index;
    return html.slice(0, at) + html.slice(at + words[0].length);
  }
  throw new Error(`the control could not find four plain words of text to delete in ${id}`);
}
const control = compare(damaged);
console.log(`\nthe control — same check, four words deleted: ${control.bad.length} altered ` + `(expected at least 1)`);
if (control.bad.length === 0) {
  console.log('  THE CHECK IS BROKEN. It cannot see a missing clause, so its clean run above means nothing.');
  process.exitCode = 1;
} else {
  console.log('  ' + control.bad[0].split('\n')[0]);
}

if (real.bad.length > 0) process.exitCode = 1;
if (real.bad.length === 0 && control.bad.length > 0) {
  console.log(`\nEvery word of the article survives the decoration: ${real.checked} blocks, character for character.`);
}

/*
 * Third check: every mark this page adds can say what it is.
 *
 * Greg's first question about the built page was "there are a bunch of weird little
 * symbols in boxes without tooltips — what do they mean?", and the honest answer was
 * that the only explanation was a `title` attribute carrying the raw key: the answer
 * to "what is this?" was "and-also". This check is the standing version of that
 * question. A mark either carries `data-tip`, or it carries a card handle
 * (`data-gloss`, `data-idea`, `data-comment`) that opens something richer. A mark
 * carrying neither is a private convention, and a page full of those is a puzzle.
 */
const MUST_EXPLAIN = [
  'conn', 'role-tag', 'gist', 'q', 'sp-hedge', 'sp-number', 'sp-hinge',
  'gloss', 'idea', 'note', 'idea-stamp', 'seam-title', 'lineated', 'gate-prompt',
];

function unexplained(html) {
  const seen = new Map(MUST_EXPLAIN.map((c) => [c, { total: 0, bare: 0 }]));
  for (const m of html.matchAll(/<[a-z][a-z0-9]*\b[^>]*>/g)) {
    const tag = m[0];
    const cls = /\sclass="([^"]*)"/.exec(tag);
    if (!cls) continue;
    const classes = new Set(cls[1].split(/\s+/));
    const explained = /\sdata-(tip|gloss|idea|comment)=/.test(tag);
    for (const want of MUST_EXPLAIN) {
      if (!classes.has(want)) continue;
      const row = seen.get(want);
      row.total++;
      if (!explained) row.bare++;
    }
  }
  return seen;
}

// Scan the page's MARKUP, not its scripts. page.js is inlined verbatim, and it
// contains a legend whose samples are written as `<span class="gloss">…</span>`
// string literals — the check found those and reported one bare mark of six
// different kinds. The finding was about the checker, not the page, which is the
// standard way a text-scanning check goes wrong.
const markup = page.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');

const explain = unexplained(markup);
const missing = [...explain].filter(([, r]) => r.total === 0 || r.bare > 0);
console.log(`\nmarks that cannot say what they are: ${missing.length} of ${MUST_EXPLAIN.length} kinds (expected 0)`);
for (const [cls, r] of missing) {
  console.log(`  .${cls}: ${r.total === 0 ? 'not on the page at all' : `${r.bare} of ${r.total} bare`}`);
}
if (missing.length) process.exitCode = 1;

// And its control: take the tips away and every one of them should go bare. A check
// that still passes with the thing it checks for deleted is measuring something else.
const tipControl = unexplained(markup.replace(/ data-tip="/g, ' data-notip="').replace(/ data-tip-title="/g, ' data-notiptitle="'));
const stillFine = [...tipControl].filter(([, r]) => r.bare === 0);
// These four keep a `data-gloss` / `data-idea` / `data-comment` handle when the tips
// are stripped, so they stay explained on purpose and the control must not flag them.
const byCard = ['gloss', 'idea', 'note', 'idea-stamp'];
const unexpected = stillFine.filter(([cls]) => !byCard.includes(cls));
console.log(
  `control — tips stripped: ${MUST_EXPLAIN.length - stillFine.length} kinds went bare, ` +
    `${byCard.length} kept a card handle by design`,
);
if (unexpected.length) {
  console.log(`  THE CHECK IS BROKEN — ${unexpected.map(([c]) => '.' + c).join(', ')} passed without any tip at all.`);
  process.exitCode = 1;
}

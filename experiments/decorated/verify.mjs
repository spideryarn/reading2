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
const victim = blocks.find((b) => b.kind === 'text' && b.words > 60);
const section = new RegExp(`(<section id="${victim.id}"[\\s\\S]*?<div class="body">[\\s\\S]{200,400}?)([a-z]+ [a-z]+ [a-z]+ [a-z]+ )`);
if (!section.test(page)) throw new Error(`the control could not find four plain words to delete in ${victim.id}`);
const damaged = page.replace(section, '$1');
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

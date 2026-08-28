/**
 * The whole fixture corpus, stock Readability against **what stage 2 actually
 * ships** — no model, no money, no network.
 *
 * The `unhidden` arm stopped being a proposal on 2026-08-28: it calls
 * `unhideCollapsedSections` from src/extract.ts, the same function `runExtract`
 * calls, imported rather than copied so the two cannot drift. So this run is now
 * the regression guard for a shipped change, and the `stock` column is the
 * counterfactual.
 *
 *   CORPUS=<dir> npx tsx evals/extraction/corpus.mts
 *
 * This is the run docs/plans/readability-repair-pass.md needs before anything
 * ships: every number in that plan came from three pages, one of which failed,
 * and "one in three" is not a prevalence estimate. It answers two questions the
 * three-page corpus cannot:
 *
 *   1. How often does Readability lose a serious amount of an article?
 *   2. Does un-hiding `aria-hidden` REGRESS a page it was already handling?
 *
 * Question 2 is the one the free fix was shipped on, and it is answered only as
 * far as these pages go: the pattern that would break un-hiding is in none of
 * them. Un-hiding is
 * exactly the change that could drag in a hidden mobile nav, a modal or a
 * screen-reader-only duplicate, and a fix measured only on the page it was
 * invented for is a fix measured on nothing.
 *
 * **It nearly went wrong in the opposite direction.** The first fourteen fixtures
 * contained no collapsed accordion at all, so the arm was inert and the run
 * printed "0 regressions, 0 wins" — a safety claim about code that never ran.
 * That is why there is a fifteenth, and why `gainedText` below prints text rather
 * than counting characters.
 *
 * **The fixture HTML is committed**, under `fixtures/`, with a sha256 apiece —
 * Greg's call, 2026-08-28, and the right one: a URL is not a fixture. Every page
 * here can be edited, paywalled or deleted by somebody else, and an eval whose
 * inputs move is an eval whose old numbers mean nothing. 5.8 MB buys the ability
 * to compare a number next year against the same document.
 *
 * `fixtures/verify.mts` hashes them, and with `--refetch` asks the web whether
 * the pages still serve those bytes. **A mismatch is a new fixture version,
 * never a quietly updated hash.**
 */
import { inventoryFile } from "./inventory.mjs";
import { JSDOM, VirtualConsole } from "jsdom";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { isMain } from "../../src/is-main.js";

/**
 * The corpus, chosen to fill the failure-mode slots in the plan's table rather
 * than to be a sample of the web — which is why the prevalence figure below is
 * an upper bound on an *enriched* set and not an estimate for ordinary reading.
 * Every one was fetched over plain HTTP with no browser spoofing and returned
 * 200 with its article text in the initial bytes.
 */
export const CORPUS: { name: string; file: string; url: string; slot: string }[] = [
  { name: "pg-greatwork", file: "pg_greatwork.html", slot: "N/S/T",
    url: "https://www.paulgraham.com/greatwork.html" },
  { name: "man-open", file: "man_open.html", slot: "S/B",
    url: "https://man7.org/linux/man-pages/man2/open.2.html" },
  { name: "rfc9110", file: "rfc9110.html", slot: "T/S",
    url: "https://www.rfc-editor.org/rfc/rfc9110.html" },
  { name: "whatwg-parsing", file: "whatwg.html", slot: "T/S",
    url: "https://html.spec.whatwg.org/multipage/parsing.html" },
  { name: "wikipedia-transformer", file: "wiki_transformer.html", slot: "S/D/B",
    url: "https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)" },
  { name: "ar5iv-attention", file: "ar5iv.html", slot: "S/T",
    url: "https://ar5iv.labs.arxiv.org/html/1706.03762" },
  { name: "arxiv-abs", file: "arxiv_abs.html", slot: "W",
    url: "https://arxiv.org/abs/1706.03762" },
  { name: "aaronson", file: "aaronson.html", slot: "B/W",
    url: "https://scottaaronson.blog/?p=7784" },
  { name: "acx", file: "acx.html", slot: "B",
    url: "https://www.astralcodexten.com/p/your-book-review-the-educated-mind" },
  { name: "gwern-scaling", file: "gwern.html", slot: "D/S",
    url: "https://gwern.net/scaling-hypothesis" },
  { name: "tufte-css", file: "tufte.html", slot: "D",
    url: "https://edwardtufte.github.io/tufte-css/" },
  { name: "mdn-cache-control", file: "mdn_cache.html", slot: "B/D/S",
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control" },
  { name: "gutenberg-pride", file: "gutenberg.html", slot: "T/B",
    url: "https://www.gutenberg.org/cache/epub/1342/pg1342-images.html" },
  { name: "cornell-17-107", file: "cornell.html", slot: "W/B",
    url: "https://www.law.cornell.edu/uscode/text/17/107" },
  /* **The fifteenth, added last and for a reason worth stating.** The first
     fourteen were chosen for the failure-mode table, and between them they
     contained not one collapsed `aria-hidden` accordion — so the un-hide arm was
     INERT on the whole corpus, and "zero regressions in fourteen pages" was a
     safety claim about a change that had nothing to act on. A corpus that cannot
     exercise the arm it exists to judge is measuring the wrong thing quietly.
     This page is where the failure mode was found in the first place: a quarter
     of it lives inside three closed accordions. */
  { name: "constitution", file: "constitution.html", slot: "T",
    url: "https://www.anthropic.com/constitution" },
];

/**
 * **This threshold was wrong in both directions and is kept as a warning.**
 *
 * It was stated up front — 5% of the page, in a run of 1,500+ characters — which
 * is the right discipline and did not save it, because the quantity it measures
 * is *absence*, and absence is not failure:
 *
 * - **Scott Aaronson's blog: 279,955 characters "lost", correctly.** They are the
 *   comment thread. The largest number the corpus produces is Readability doing
 *   its job, and the threshold called it SERIOUS.
 * - **RFC 9110: 20,522 characters of normative specification text genuinely
 *   absent**, verified string by string — and only 4.6% of a 446,000-character
 *   page, so the threshold called it fine.
 *
 * No percentage separates those two, because the difference between them is not
 * a quantity. It is *what the missing text is*, which needs either a gold or a
 * judgement — and that is the honest argument for the model rung, which is not
 * repair but telling correct removal from wrong removal. See the plan.
 *
 * So the column below is labelled `absent`, not `lost`, and the run reports it
 * without a verdict attached.
 */
const NOTABLE_FRACTION = 0.05;
const NOTABLE_RUN = 1500;

interface Arm {
  droppedChars: number; ratio: number; biggestGap: number; coverage: number;
  title: string | null;
  /** Tags whose count fell, as `math 0/188`. Failure mode S, which characters cannot show. */
  structureLost: string[];
}

/** Worth a human's eye — NOT a claim that anything went wrong. See above. */
function notable(a: Arm, rawChars: number): boolean {
  return a.droppedChars / Math.max(1, rawChars) >= NOTABLE_FRACTION && a.biggestGap >= NOTABLE_RUN;
}

/**
 * **The passages the un-hidden arm has and stock does not, as text a human reads.**
 *
 * This exists because of an instrument bug that scored a regression as a win, and
 * it has now been wrong three times in the same direction — every one of them a
 * number that rewards *recovery* being read as a number that rewards *quality*:
 *
 * 1. The first un-hide arm removed `[hidden]` as well as `aria-hidden`, which on
 *    arxiv.org/abs recovered 95 characters of "View a PDF of the paper titled …".
 *    `droppedChars` went DOWN, so nothing fired.
 * 2. This function was added to fix that, and its warning was printed only when
 *    the row was not already flagged as helping — and "helping" is recovered
 *    characters, and furniture is characters. A nav drawer inside the article
 *    container clears the bar and swallowed its own warning.
 * 3. And then: a **duplicate**. A hidden second copy of a paragraph the article
 *    already contains adds 1,700 characters, and a substring test against the
 *    stock text finds every word of it already present. Zero gains reported,
 *    `droppedChars` unchanged at 0, silence. GPT Sol built all three.
 *
 * The third is not an edge case here. `aria-hidden` is *the* attribute publishers
 * put on a duplicated copy of something — the visual twin of a screen-reader
 * label, a second rendering of a formula — so a duplicate is the likeliest harm
 * this arm can do, and it was the one thing the instrument could not see.
 *
 * **So the comparison counts occurrences, not membership.** A passage is a gain
 * if it appears more times in the un-hidden article than in the stock one, which
 * makes brand-new text the `0 → 1` case of the same rule. `unaccounted` below is
 * the backstop for whatever this still cannot name.
 *
 * It does not judge. It prints, and the run says READ THEM. Seeing "Claude's
 * three types of principals" next to "View a PDF of the paper titled" settles it
 * in a second, and no threshold ever would.
 *
 * **Passages, not blocks, and the difference is not pedantry.** This selects
 * elements from a fixed tag list, drops anything under `FLOOR` characters, and
 * drops an element whose ancestor is already reported — so a nested `<li>` is
 * counted once, inside its outermost reported container, and the console line
 * shows that container's first 110 characters rather than the child's. Stage 3's
 * idea of a block is [`src/blocks.ts`](../../src/blocks.ts) and is not this: on
 * the constitution, 96 stage-3 blocks against 76 passages here. Quote it as
 * passages, and read the JSON for the full text.
 *
 * What it still cannot see, and these are the reasons to read the run rather than
 * the count: an addition under `FLOOR` characters; text inserted *inside* an
 * existing paragraph, which is detected but reported as the whole paragraph
 * rather than as the insertion; and anything in a tag not on the list.
 */
const FLOOR = 40;
const GAIN_TAGS = "p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th, caption, figcaption, dt, dd";

const norm = (t: string): string => t.replace(/\s+/g, " ").trim();

/** How many times `needle` occurs in `hay`. Overlapping matches are not a concern for prose. */
function occurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

interface Gains {
  passages: string[];
  /**
   * Characters of text the un-hidden arm has that `passages` does not account
   * for. **The backstop**, and the thing to look at when it is large: the arm
   * changed the article by more than the instrument can name, which is how all
   * three bugs above looked from the outside before anyone knew what they were.
   */
  unaccounted: number;
}

export function gainedText(stockHtml: string, unhidHtml: string): Gains {
  if (stockHtml === unhidHtml) return { passages: [], unaccounted: 0 };
  const parse = (h: string): { doc: Document; text: string } => {
    const doc = new JSDOM(`<body>${h}</body>`, { virtualConsole: new VirtualConsole() }).window.document;
    return { doc, text: norm(doc.body.textContent ?? "") };
  };
  const before = parse(stockHtml);
  const after = parse(unhidHtml);

  /* De-nested first, so a `<li>` wrapping a `<p>` is one candidate and not two.
     Document order puts an ancestor before its descendants, so a single forward
     pass with `contains` is enough — and `contains` cannot match a sibling, so
     nothing beside a reported element is suppressed. */
  const candidates: { el: Element; text: string }[] = [];
  for (const el of Array.from(after.doc.querySelectorAll(GAIN_TAGS))) {
    const text = norm(el.textContent ?? "");
    if (text.length < FLOOR) continue;
    if (candidates.some((c) => c.el.contains(el))) continue;
    candidates.push({ el, text });
  }

  /* By multiplicity: brand-new text is the 0 → 1 case, a duplicated copy is the
     1 → 2 case, and only the excess is reported. */
  const seen = new Map<string, number>();
  const passages: string[] = [];
  let accounted = 0;
  for (const c of candidates) {
    const used = seen.get(c.text) ?? 0;
    seen.set(c.text, used + 1);
    if (used + 1 <= occurrences(before.text, c.text)) continue;
    passages.push(c.text);
    accounted += c.text.length;
  }
  return { passages, unaccounted: Math.max(0, after.text.length - before.text.length - accounted) };
}

async function main(): Promise<void> {
  /* Defaults to the committed fixtures; CORPUS overrides it for a scratch set. */
  const dir = process.env.CORPUS ?? path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures");
  const rows: Record<string, unknown>[] = [];
  console.log(
    `${"fixture".padEnd(22)} ${"slot".padEnd(6)} ${"raw ch".padStart(8)} ` +
    `${"stock lost".padStart(11)} ${"un-hid lost".padStart(12)}  verdict`,
  );
  for (const c of CORPUS) {
    const file = path.join(dir, c.file);
    if (!existsSync(file)) { console.log(`${c.name.padEnd(22)} — file missing, skipped`); continue; }
    const stock = await inventoryFile(file, c.url);
    const unhid = await inventoryFile(file, c.url, { unhide: true });
    const arm = (i: typeof stock): Arm => ({
      droppedChars: i.totals.droppedChars, ratio: i.ratio,
      biggestGap: i.gaps[0]?.chars ?? 0, coverage: i.totals.coverage, title: i.title,
      structureLost: Object.entries(i.structure)
        .filter(([, v]) => v.kept < v.present * 0.9)
        .map(([t, v]) => `${t} ${v.kept}/${v.present}`),
    });
    const a = arm(stock);
    const b = arm(unhid);
    const raw = stock.rawTextChars;
    const gained = gainedText(stock.articleHtml, unhid.articleHtml);

    /* **A regression is the fix LOSING text it was not losing before** — and
       only that. The `|| b.ratio > a.ratio + 0.15` half that used to be here,
       meant to catch the fix dragging in the whole page, fired on the one page
       where the fix works: recovering a quarter of the constitution moves the
       ratio 0.737 → 0.942 by definition, so the run printed "un-hide helps" and
       "!! UN-HIDE REGRESSES" on the same line. A guard that cannot fire on
       success is not a guard, it is a synonym. What replaced it is `gained`
       below, which prints the added text instead of scoring it. */
    const regressed = b.droppedChars > a.droppedChars + 200;
    /* **A quantity, not a verdict.** It says a thousand-odd characters came back,
       and says nothing whatever about whether they belong in the article — the
       runner cannot know that, and the moment this was allowed to mean "good" it
       started hiding the additions it was meant to surface. Read as: worth the
       most attention, not proven right. */
    const recoveredALot = a.droppedChars - b.droppedChars > 1000;
    const verdict =
      (notable(a, raw) ? "look" : "  ") +
      /* **Unconditional**, and it took a GPT Sol review to make it so. This
         used to read `gained.length && !helped`, on the reasoning that a page
         the fix helped needed no warning — which is the original bug wearing a
         different hat, since "helped" is computed from recovered characters and
         furniture is characters. Sol built the counter-example and it
         reproduces: a `<div aria-hidden="true">` of navigation *inside* the
         article container is admitted, and at 30 items it clears the 1,000-
         character bar, so the runner printed "un-hide helps" and swallowed the
         warning. Anything gained gets read, whatever else the row says. */
      (gained.passages.length ? `  un-hide adds ${gained.passages.length} passage(s) — READ THEM` : "") +
      /* **The backstop for the next one.** All three instrument bugs looked
         identical from here: the article changed and no flag fired. This one
         fires on the change itself, so a difference the passage rule cannot
         name still gets a human. It stays quiet on Wikipedia, where the text
         is byte-identical and only an attribute moved. */
      (gained.unaccounted > 200 ? `  !! ${gained.unaccounted} chars CHANGED AND UNACCOUNTED FOR` : "") +
      (regressed ? "  !! UN-HIDE REGRESSES" : "") +
      (a.coverage < 0.8 ? `  (coverage ${(a.coverage * 100).toFixed(0)}% — number unreliable)` : "") +
      (a.title === null ? "  parse() returned nothing" : "") +
      (a.structureLost.length ? `  structure: ${a.structureLost.join(", ")}` : "");

    console.log(
      `${c.name.padEnd(22)} ${c.slot.padEnd(6)} ${raw.toLocaleString().padStart(8)} ` +
      `${a.droppedChars.toLocaleString().padStart(11)} ${b.droppedChars.toLocaleString().padStart(12)}  ${verdict}`,
    );
    /* Ten, not three. Three was chosen to keep the table tidy and meant the run
       showed a tenth of what it stored, while the prose said it "prints the
       blocks". The count in the verdict is the whole number either way. */
    for (const g of gained.passages.slice(0, 10)) {
      console.log(`${" ".repeat(24)}+ ${JSON.stringify(g.slice(0, 110))}`);
    }
    if (gained.passages.length > 10) {
      console.log(`${" ".repeat(24)}  … and ${gained.passages.length - 10} more — the full text is in the JSON`);
    }
    rows.push({
      ...c, rawTextChars: raw, stock: a, unhidden: b,
      notable: notable(a, raw), recoveredALot, regressed,
      identical: stock.articleHtml === unhid.articleHtml,
      gainedPassages: gained.passages.length,
      unaccountedChars: gained.unaccounted,
      gained: gained.passages,
    });
  }

  const bad = rows.filter((r) => r.notable).length;
  const reg = rows.filter((r) => r.regressed).length;
  const gaining = rows.filter((r) => (r.gainedPassages as number) > 0).length;
  const structural = rows.filter((r) => (r.stock as Arm).structureLost.length).length;
  console.log(
    `\n${bad}/${rows.length} have ${NOTABLE_FRACTION * 100}%+ of the page absent in a run of ` +
    `${NOTABLE_RUN}+ characters — worth a look, NOT a count of failures (see the note on ` +
    `\`notable\`: the biggest of them is a comment thread correctly dropped).`,
  );
  console.log(`${structural}/${rows.length} lose 10%+ of some structural element — tables, formulas, code.`);
  console.log(
    `Un-hiding adds text on ${gaining}/${rows.length} and loses text on ${reg}. ` +
      "The first ten additions per page are printed above, truncated, and NOT scored — recovered " +
      "furniture and recovered article body are the same number of characters. The full text is " +
      "in the JSON.",
  );
  console.log(
    "\nThis is an ENRICHED set — every fixture was chosen because it looked hard — so none of " +
    "these fractions is a prevalence estimate for ordinary reading. And the regression count " +
    "does NOT settle un-hiding on its own: the pattern that breaks it — a nav drawer hidden by " +
    "external CSS, inside the article container — is in none of these fifteen pages. See " +
    "fixtures/README.md, 'the case that is missing'.",
  );
  const out = "evals/results/extraction-corpus.json";
  await writeFile(out, `${JSON.stringify(rows, null, 2)}\n`, "utf-8");
  console.log(`\nWritten to ${out}`);
}

/* **Compared as resolved paths, not by suffix**, and this file needed it the
   moment it grew an importer: `fixtures/verify.mts` imports CORPUS to know what
   to hash, and with a bare `void main()` the import RAN the whole fifteen-page
   corpus first. Nothing failed and nothing looked wrong — it just did several
   seconds of Readability before printing a hash table. Exactly the accident
   src/extract.ts and src/blocks.ts both carry a note about. */
if (isMain(import.meta.url)) void main();

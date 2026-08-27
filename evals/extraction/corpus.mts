/**
 * The whole fixture corpus, stock Readability against rung 0 — no model, no
 * money, no network.
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
 * Question 2 is the one that decides whether the free fix ships. Un-hiding is
 * exactly the change that could drag in a hidden mobile nav, a modal or a
 * screen-reader-only duplicate, and a fix measured only on the page it was
 * invented for is a fix measured on nothing.
 *
 * **The fixture HTML is not committed** — 6 MB of other people's pages, and the
 * corpus decision is Greg's (see the plan). The manifest below is, so the set
 * is reproducible from the URLs.
 */
import { inventoryFile } from "./inventory.mjs";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The corpus, chosen to fill the failure-mode slots in the plan's table rather
 * than to be a sample of the web — which is why the prevalence figure below is
 * an upper bound on an *enriched* set and not an estimate for ordinary reading.
 * Every one was fetched over plain HTTP with no browser spoofing and returned
 * 200 with its article text in the initial bytes.
 */
const CORPUS: { name: string; file: string; url: string; slot: string }[] = [
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

async function main(): Promise<void> {
  const dir = process.env.CORPUS;
  if (!dir) {
    console.error("Set CORPUS=<dir holding the fetched .html files>. See the header.");
    process.exit(1);
  }
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

    /* A regression is the fix LOSING text it was not losing before, or dragging
       in so much that the ratio jumps — both directions, because un-hiding can
       fail either way and only one of them is obvious. */
    const regressed = b.droppedChars > a.droppedChars + 200 || b.ratio > a.ratio + 0.15;
    const helped = a.droppedChars - b.droppedChars > 1000;
    const verdict =
      (notable(a, raw) ? "look" : "  ") +
      (helped ? "  un-hide helps" : "") +
      (regressed ? "  !! UN-HIDE REGRESSES" : "") +
      (a.coverage < 0.8 ? `  (coverage ${(a.coverage * 100).toFixed(0)}% — number unreliable)` : "") +
      (a.title === null ? "  parse() returned nothing" : "") +
      (a.structureLost.length ? `  structure: ${a.structureLost.join(", ")}` : "");

    console.log(
      `${c.name.padEnd(22)} ${c.slot.padEnd(6)} ${raw.toLocaleString().padStart(8)} ` +
      `${a.droppedChars.toLocaleString().padStart(11)} ${b.droppedChars.toLocaleString().padStart(12)}  ${verdict}`,
    );
    rows.push({ ...c, rawTextChars: raw, stock: a, unhidden: b, notable: notable(a, raw), helped, regressed });
  }

  const bad = rows.filter((r) => r.notable).length;
  const reg = rows.filter((r) => r.regressed).length;
  const help = rows.filter((r) => r.helped).length;
  const structural = rows.filter((r) => (r.stock as Arm).structureLost.length).length;
  console.log(
    `\n${bad}/${rows.length} have ${NOTABLE_FRACTION * 100}%+ of the page absent in a run of ` +
    `${NOTABLE_RUN}+ characters — worth a look, NOT a count of failures (see the note on ` +
    `\`notable\`: the biggest of them is a comment thread correctly dropped).`,
  );
  console.log(`${structural}/${rows.length} lose 10%+ of some structural element — tables, formulas, code.`);
  console.log(`Un-hiding helps ${help} and regresses ${reg}.`);
  console.log(
    "\nThis is an ENRICHED set — every fixture was chosen because it looked hard — so none of " +
    "these fractions is a prevalence estimate for ordinary reading. The number that decides " +
    "whether un-hiding ships is the regression count.",
  );
  const out = "evals/results/extraction-corpus.json";
  await writeFile(out, `${JSON.stringify(rows, null, 2)}\n`, "utf-8");
  console.log(`\nWritten to ${out}`);
}

void main();

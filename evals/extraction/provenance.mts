/**
 * **Can an output node say which source element it came from?** — measured, per
 * fixture, with no model and no network.
 *
 *   npx tsx evals/extraction/provenance.mts
 *   npx tsx evals/extraction/provenance.mts --json out.json
 *
 * Every instrument in this directory that wants to say what Readability threw
 * away has so far answered by matching text, and
 * [260827ab](../../docs/plans/260827ab-readability-repair-pass.md) spent a whole
 * section on the eight ways that was confidently wrong. The worst of them: a
 * hidden *duplicate* of a paragraph the article already has is invisible to a
 * substring test, because every word of it is already in the stock text — and
 * `aria-hidden` is precisely the attribute publishers put on a duplicate.
 *
 * Readability takes a `serializer` option; the identity function makes
 * `article.content` a **DOM node** rather than a string. Stamp every source
 * element first ([`stampSourceIds`](../../src/extract.ts)) and the output
 * carries its own provenance, so the question becomes a set difference over ids.
 *
 * ## The two numbers this prints, and why there are two
 *
 * 260827ab measured the direct hit rate on three pages at 92.7%, 99.8% and
 * **40.9%**. That third page is Paul Graham's, his markup is degenerate enough
 * that Readability rebuilds the document, and it is real. So `direct` — the node
 * itself carries the stamp, the only certain answer — is reported beside
 * `mapped`, which adds the documented fallback in
 * [`sourceRefOf`](../../src/extract.ts): a generated wrapper takes its first
 * stamped descendant's id, a generated leaf its nearest stamped ancestor's.
 *
 * **Read `direct` when you need certainty and `mapped` when you need recall.**
 * A page with a low `direct` is not a page whose provenance is unusable; it is a
 * page where the text matcher is the better of the two instruments, and the
 * right move there is to run both and report where they disagree.
 *
 * ## And the check that has to come first
 *
 * Readability weights `class` and `id` when it scores a node, so putting an
 * attribute on every element in the document is not obviously free. `inert`
 * below takes the stamped run's **serialised HTML**, removes the one attribute
 * this instrument adds, and compares it byte-for-byte with what the shipping
 * `readArticle` returns for the same bytes — **an instrument whose own presence
 * changed the measurement would be worthless**. Anything but `yes` in that
 * column invalidates the row.
 *
 * It compared whitespace-normalised *text* until 2026-09-05, which is a weaker
 * claim than the column's name: GPT Sol prepended `"\n\n"` to the extracted HTML
 * and the column still said `yes`.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALL_FIXTURES } from "./corpus.mjs";
import {
  readArticle,
  readArticleWithProvenance,
  sourceRefOf,
  withoutSourceRefs,
} from "../../src/extract.js";
import { isMain } from "../../src/is-main.js";

export interface ProvenanceRow {
  name: string;
  /** Elements in the stamped source document. */
  sourceElements: number;
  /** Elements in what Readability returned. */
  outputElements: number;
  /** Carrying a stamp themselves — the certain answer. */
  direct: number;
  /** Resolved through a stamped descendant of a generated wrapper. */
  viaDescendant: number;
  /** Resolved through the nearest stamped ancestor. */
  viaAncestor: number;
  /** Nothing near it is stamped. */
  unmapped: number;
  /**
   * **Distinct source ids the mapped output nodes resolve to**, and it is here
   * because `mapped` alone flatters the fallback.
   *
   * An ancestor mapping is a weak claim: fifty generated nodes inside one
   * `<div>` all resolve to that `<div>`, and a recall figure counts fifty
   * successes. This is the number that says so — where it is far below `mapped`,
   * the fallback is answering "somewhere inside this" rather than "this".
   */
  distinctIds: number;
  /** The most output nodes any single source id is claimed by. */
  worstFanout: number;
  /** Extracted **HTML** byte-identical with the stamps removed and without them. */
  inert: boolean;
  /** Readability declined the page. */
  refused: boolean;
}

const pct = (n: number, d: number): string =>
  d === 0 ? "  n/a" : `${((100 * n) / d).toFixed(1).padStart(5)}%`;

export function provenanceOf(name: string, rawHtml: string, url: string): ProvenanceRow {
  const blank = {
    name, sourceElements: 0, outputElements: 0, direct: 0, viaDescendant: 0,
    viaAncestor: 0, unmapped: 0, distinctIds: 0, worstFanout: 0, inert: true, refused: false,
  };
  const { article, source, sourceHtml, stampedElements } = readArticleWithProvenance(rawHtml, url);
  if (!article?.content) return { ...blank, sourceElements: stampedElements, refused: true };

  /* The inertness check runs the *shipping* function on the same bytes, so what
     is compared is the stamped arm against the code that actually runs — not
     against a second copy of it.

     **Byte-for-byte over the serialised HTML**, since 2026-09-05. It used to
     compare whitespace-normalised `textContent`, and GPT Sol reproduced the hole
     by prepending `"\n\n"` to the extracted HTML: the mutation landed and the
     column still said `yes`. `withoutSourceRefs` removes the one attribute this
     instrument adds and nothing else, so any other difference — an element, an
     attribute, an ordering, a space — invalidates the row, which is the whole
     point of having the column. */
  const stock = readArticle(rawHtml, url).article;
  const inert = withoutSourceRefs(article.content) === (stock?.content ?? null);

  const out = Array.from(article.content.querySelectorAll("*"));
  const row = { ...blank, sourceElements: stampedElements, outputElements: out.length, inert };
  const claims = new Map<string, number>();
  for (const el of out) {
    const { id, how } = sourceRefOf(el);
    if (how === "direct") row.direct += 1;
    else if (how === "descendant") row.viaDescendant += 1;
    else if (how === "ancestor") row.viaAncestor += 1;
    else row.unmapped += 1;
    if (id) claims.set(id, (claims.get(id) ?? 0) + 1);
  }
  row.distinctIds = claims.size;
  row.worstFanout = Math.max(0, ...claims.values());
  /* **The source has to still be the *source*, not what Readability left of it**
     — every mapped id is looked up in it, so a pruned document would silently
     answer `none` for exactly the passages an instrument is here to find.

     Against `sourceHtml`, the bytes taken **before** the parse, rather than
     against `stampedElements`, which is read off the same object and is nearly
     true by construction (GPT Sol, 2026-09-05). Hand Readability this document
     instead of the re-parsed copy and the scripts, the styles and half the
     furniture go, and this is what says so. */
  if (source.documentElement.outerHTML !== sourceHtml) {
    throw new Error(`${name}: the stamped source did not survive the parse`);
  }
  return row;
}

async function main(): Promise<void> {
  const jsonAt = process.argv.indexOf("--json");
  const dir = path.join("evals", "extraction", "fixtures");
  const rows: ProvenanceRow[] = [];

  console.log(
    "fixture".padEnd(24) +
      "  source   output   direct   +desc    +anc  unmapped   mapped  distinct  fanout  inert",
  );
  for (const entry of ALL_FIXTURES) {
    const raw = await readFile(path.join(dir, entry.file), "utf-8");
    const row = provenanceOf(entry.name, raw, entry.url);
    rows.push(row);
    const mapped = row.direct + row.viaDescendant + row.viaAncestor;
    console.log(
      entry.name.padEnd(24) +
        `  ${String(row.sourceElements).padStart(6)}` +
        `  ${String(row.outputElements).padStart(6)}` +
        `  ${pct(row.direct, row.outputElements)}` +
        `  ${String(row.viaDescendant).padStart(5)}` +
        `  ${String(row.viaAncestor).padStart(5)}` +
        `  ${String(row.unmapped).padStart(8)}` +
        `  ${pct(mapped, row.outputElements)}` +
        `  ${String(row.distinctIds).padStart(8)}` +
        `  ${String(row.worstFanout).padStart(6)}` +
        `  ${row.inert ? "yes" : "NO"}${row.refused ? "  (refused)" : ""}`,
    );
  }

  const live = rows.filter((r) => !r.refused && r.outputElements > 0);
  const sum = (f: (r: ProvenanceRow) => number) => live.reduce((n, r) => n + f(r), 0);
  const outputs = sum((r) => r.outputElements);
  console.log(
    `\n${live.length} fixtures, ${outputs} output elements: ` +
      `${pct(sum((r) => r.direct), outputs)} direct, ` +
      `${pct(sum((r) => r.direct + r.viaDescendant + r.viaAncestor), outputs)} mapped, ` +
      `${sum((r) => r.unmapped)} unmapped.`,
  );
  const worst = [...live].sort((a, b) => a.direct / a.outputElements - b.direct / b.outputElements)[0];
  if (worst) {
    console.log(
      `worst direct rate: ${worst.name} at ${pct(worst.direct, worst.outputElements)} ` +
        `(${pct(worst.direct + worst.viaDescendant + worst.viaAncestor, worst.outputElements)} mapped)`,
    );
  }
  const noisy = rows.filter((r) => !r.inert);
  console.log(
    noisy.length === 0
      ? "stamping is inert on every fixture."
      : `STAMPING IS NOT INERT ON: ${noisy.map((r) => r.name).join(", ")} — every row above is suspect.`,
  );

  if (jsonAt !== -1) {
    const out = process.argv[jsonAt + 1]!;
    await writeFile(out, `${JSON.stringify(rows, null, 2)}\n`, "utf-8");
    console.log(`\nWritten to: ${path.resolve(out)}`);
  }
}

if (isMain(import.meta.url)) await main();

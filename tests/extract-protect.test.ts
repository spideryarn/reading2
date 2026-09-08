/**
 * Stage 2 stamps two class tokens on a handful of elements before Readability
 * sees the page, and **every claim about it here is made through the real
 * pipeline** — `runExtract` from src/extract.ts, and `splitIntoBlocks` from
 * src/blocks.ts wherever the claim is about blocks.
 *
 * That is not a preference. A test that called `protectAuthoredStructure` on a
 * DOM and read the DOM back would pass on markup that fails in production: the
 * stamp is only worth anything if Readability then keeps the element, and
 * Readability is exactly the thing such a test does not run. It is the trap
 * tests/notes-canonical.test.ts names, and § *How every recogniser is proved*
 * in
 * docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md lists
 * it as one of the failures this repository actually has: *"the recogniser runs
 * in its unit test but was never wired into `prepareDocument`."*
 *
 * ## What is pinned, and why each rung
 *
 * Each rule carries an **exposure ladder** — source candidates → elements
 * stamped → survivors after Readability → blocks affected → the assertion that
 * changes — and every rung is asserted, not just the last. The reason is
 * specific rather than ritual: `wiki_gdp_table`'s document *total* of 238 rows
 * hid a per-table discrepancy for a day, so the parts are asserted as well
 * (223 + 14 + 1).
 *
 * Each rule also carries a **counterfactual** through `withProtectionDisabled`,
 * and the counterfactual asserts that the two arms *differ* — a control that
 * produced the same card as the treatment would make every green tick above it
 * a tick about nothing.
 *
 * **Rule A's rescue is also checked before it ships**, and the check has its own
 * ladder: `proseRetention` on its own inputs, the swept 12/24/40-row page where
 * it decides, and `a-table-called-header-rolled-back` in `kept` when it fires —
 * a withdrawal nobody can see would be worse than the loss it prevents.
 *
 * The two synthetic cases at the bottom are the ones the corpus cannot supply:
 * **no fixture has the score topology** in which a `positive` class token on a
 * table wins candidacy and deletes the prose either side of it. That is the P0
 * a GPT Sol review reproduced before this shipped, and it is why there are two
 * tokens rather than one.
 *
 * No network, no model, no database.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { describe, expect, it } from "vitest";

import { ALL_FIXTURES } from "../evals/extraction/corpus.mjs";
import { splitIntoBlocks } from "../src/blocks.js";
import { TooLittleTextToRead, runExtract } from "../src/extract.js";
import {
  KEEP_COLUMN,
  KEEP_CONTENT,
  OK_MAYBE_ITS_A_CANDIDATE,
  RULES,
  UNLIKELY_CANDIDATES,
  UNLIKELY_EXCEPT_HEADER,
  proseRetention,
  protectAuthoredStructure,
  protectionIsDisabled,
  withProtectionDisabled,
} from "../src/protect.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../evals/extraction/fixtures");

/** Readability's own table, off the prototype — the oracle the copies are checked against. */
const LIVE_REGEXPS = (Readability.prototype as unknown as { REGEXPS: Record<string, RegExp | undefined> })
  .REGEXPS;

const dom = (html: string): Document =>
  new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document;

/* ------------------------------------------------------------------ *
 * One run of the corpus, both arms, shared by every test below.
 * ------------------------------------------------------------------ */

/**
 * What one extraction of one fixture came to. `html` is kept only for the five
 * fixtures the detailed tests need — 70 whole pages in memory is a cost with no
 * buyer.
 */
interface Arm {
  chars: number;
  bytes: number;
  digest: string;
  kept: Record<string, number>;
  html: string | null;
}

/** Both arms of one fixture, or the typed refusal both arms raised. */
type Row =
  | { readonly kind: "extracted"; readonly on: Arm; readonly off: Arm }
  | { readonly kind: "refused"; readonly onRefusal: TooLittleTextToRead; readonly offRefusal: TooLittleTextToRead };

/**
 * The five fixtures whose output is kept whole. Everything else is compared by
 * length and content digest, which is a byte comparison by another name and
 * costs a few hundred bytes rather than a few hundred kilobytes.
 */
const DETAILED = new Set(["ar5iv-attention", "wiki-gdp-table", "plos-biology", "wiki-ar-ai", "wikipedia-transformer"]);

/** The two pages that are a bot wall rather than an article, in both arms. */
const WALLS = ["medium-about", "pmc-article"];

/**
 * **A digest, so "byte-identical" is a comparison of bytes rather than of
 * lengths.** Two different pages of the same length are not a hypothetical
 * here: the arms differ by an inserted table, and a length check would pass on
 * a swap.
 */
function digestOf(s: string): string {
  /* FNV-1a over the UTF-16 code units. Deliberately not a crypto hash: this is
     a change detector between two strings produced in the same process, and
     `node:crypto` would be a second thing to explain. */
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

async function armOf(html: string, url: string, slug: string, keepHtml: boolean): Promise<Arm | TooLittleTextToRead> {
  try {
    const r = await runExtract({ html, url, slug });
    return {
      chars: r.length ?? -1,
      bytes: r.extractedHtml.length,
      digest: digestOf(r.extractedHtml),
      kept: r.kept as Record<string, number>,
      html: keepHtml ? r.extractedHtml : null,
    };
  } catch (e) {
    /* **The typed refusal, and only that one.** Catching every exception into a
       sentinel is what the first draft's spike did, and it turns a crash on one
       arm into a row that reads like a deliberate refusal. */
    if (e instanceof TooLittleTextToRead) return e;
    throw e;
  }
}

/**
 * **Both arms of all 35 fixtures, run once and in sequence.**
 *
 * Sequence is required rather than tidy: `withProtectionDisabled` is module
 * state, so two extractions in flight at once in different arms would see each
 * other's flag and each would report on an instrument it was not running.
 */
async function runCorpus(): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  for (const f of ALL_FIXTURES) {
    const html = await readFile(path.join(FIXTURES, f.file), "utf8");
    const keep = DETAILED.has(f.name);
    const on = await armOf(html, f.url, f.name, keep);
    const off = await withProtectionDisabled(() => armOf(html, f.url, f.name, keep));
    const onRefused = on instanceof TooLittleTextToRead;
    const offRefused = off instanceof TooLittleTextToRead;
    /* **Both or neither.** A fixture that refused in one arm alone would be
       this pass changing whether a page is publishable at all, which it must
       never do — and it would leave the row below a half-truth, so it is a
       throw rather than a flag. `expect` is not used here: this runs at import
       rather than inside a test, where vitest's assertion context does not
       exist. */
    if (onRefused !== offRefused) {
      throw new Error(`${f.name}: refused in one arm only (on=${onRefused}, off=${offRefused})`);
    }
    if (on instanceof TooLittleTextToRead && off instanceof TooLittleTextToRead) {
      out.set(f.name, { kind: "refused", onRefusal: on, offRefusal: off });
      continue;
    }
    if (on instanceof TooLittleTextToRead || off instanceof TooLittleTextToRead) {
      throw new Error(`${f.name}: unreachable — the two arms disagree about refusing`);
    }
    out.set(f.name, { kind: "extracted", on, off });
  }
  return out;
}

/**
 * Started at import and awaited by each test below. Roughly three minutes: 70
 * runs of stage 2 over pages up to a megabyte, and running it once is what
 * keeps that from being six.
 *
 * The bare `.catch` attaches a handler to the original promise so a failure
 * inside `runCorpus` is reported by whichever test awaits it first, rather than
 * as an unhandled rejection with no test's name on it.
 */
const CORPUS: Promise<Map<string, Row>> = runCorpus();
CORPUS.catch(() => undefined);

/** Long enough for the shared corpus run, which the first test to await pays for. */
const CORPUS_TIMEOUT = { timeout: 900_000 };

async function extracted(name: string): Promise<{ on: Arm; off: Arm }> {
  const row = (await CORPUS).get(name);
  expect(row, `${name} is not in ALL_FIXTURES`).toBeDefined();
  expect(row!.kind, `${name} refused`).toBe("extracted");
  const e = row as { kind: "extracted"; on: Arm; off: Arm };
  return { on: e.on, off: e.off };
}

/** The html of a `DETAILED` fixture, with the null-check spelled once. */
function pageOf(arm: Arm): string {
  expect(arm.html, "this fixture is not in DETAILED, so its html was not kept").not.toBeNull();
  return arm.html!;
}

/* ------------------------------------------------------------------ *
 * The regexes, and what the two tokens do to them.
 * ------------------------------------------------------------------ */

describe("the copied regexes, pinned against the library they were copied from", () => {
  /**
   * **A dependency bump that moved either regex would otherwise degrade
   * quietly**: rule A would stop firing, four tables would go back to being
   * deleted, and every other test in this file would still be green because
   * they assert what the pipeline does rather than what it should.
   */
  it("matches @mozilla/readability's own source, character for character", () => {
    /* Asserted to exist first: `undefined === undefined` is a parity test that
       cannot fail, which is the class of bug this whole stage is about. */
    expect(LIVE_REGEXPS.unlikelyCandidates).toBeInstanceOf(RegExp);
    expect(LIVE_REGEXPS.okMaybeItsACandidate).toBeInstanceOf(RegExp);
    expect(UNLIKELY_CANDIDATES.source).toBe(LIVE_REGEXPS.unlikelyCandidates!.source);
    expect(OK_MAYBE_ITS_A_CANDIDATE.source).toBe(LIVE_REGEXPS.okMaybeItsACandidate!.source);
    /* **And the flags, which `.source` does not carry.** A version that dropped
       `i` from `unlikelyCandidates` would leave both sources identical and
       change which class attributes match — GPT Sol's finding, 2026-09-08. Two
       regexes are the same regex only if both halves agree. */
    expect(UNLIKELY_CANDIDATES.flags).toBe(LIVE_REGEXPS.unlikelyCandidates!.flags);
    expect(OK_MAYBE_ITS_A_CANDIDATE.flags).toBe(LIVE_REGEXPS.okMaybeItsACandidate!.flags);
  });

  it("gives `spya-keep-column` a rescue and no weight at all", () => {
    /**
     * The whole of rule A's mechanism, and the whole of its safety. `column`
     * puts it in `okMaybeItsACandidate`, which defeats the deletion at
     * Readability.js:1127; being in neither `positive` nor `negative` means
     * `_getClassWeight` returns exactly what it returned before, so the table's
     * candidacy is untouched.
     */
    expect(LIVE_REGEXPS.positive).toBeInstanceOf(RegExp);
    expect(LIVE_REGEXPS.negative).toBeInstanceOf(RegExp);
    expect(LIVE_REGEXPS.okMaybeItsACandidate!.test(KEEP_COLUMN)).toBe(true);
    expect(LIVE_REGEXPS.positive!.test(KEEP_COLUMN)).toBe(false);
    expect(LIVE_REGEXPS.negative!.test(KEEP_COLUMN)).toBe(false);
    /* And it must not itself be an unlikely term, or the stamp would be the
       deletion it is trying to prevent. */
    expect(LIVE_REGEXPS.unlikelyCandidates!.test(KEEP_COLUMN)).toBe(false);
  });

  it("gives `spya-keep-content` the 25 points rule B runs on", () => {
    expect(LIVE_REGEXPS.positive!.test(KEEP_CONTENT)).toBe(true);
    expect(LIVE_REGEXPS.negative!.test(KEEP_CONTENT)).toBe(false);
    expect(LIVE_REGEXPS.unlikelyCandidates!.test(KEEP_CONTENT)).toBe(false);
  });

  it("keeps the two tokens different, which is the P0", () => {
    /* If somebody ever makes these the same string, the table case below goes
       red — but this says why in one line rather than in a 4,000-character
       diff. */
    expect(KEEP_COLUMN).not.toBe(KEEP_CONTENT);
    expect(LIVE_REGEXPS.positive!.test(KEEP_COLUMN)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Rule A — the exposure ladder, per fixture.
 * ------------------------------------------------------------------ */

/**
 * **The unlikely terms one at a time, `header` left out** — read off the live
 * library rather than off `UNLIKELY_EXCEPT_HEADER`, so the ladder's first rung
 * is still computed a different way from the rule it is checking.
 *
 * A list of whole alternatives cannot destroy an overlapping term the way a
 * substitution can, because no term is ever taken out of the string being
 * tested: `headerelated` is asked *does it contain `related`* and the answer is
 * yes. Every alternative in that regex is a literal with no metacharacter in it,
 * which the last test in this file asserts as well.
 */
const UNLIKELY_TERMS_BESIDES_HEADER = LIVE_REGEXPS.unlikelyCandidates!.source
  .split("|")
  .filter((term) => term !== "header")
  .map((term) => new RegExp(term, "i"));

/**
 * **Rung one of the ladder, computed with Readability's own regexes rather than
 * ours** — how many `<table>`s the source has, how many of them line 1119 would
 * delete, and how many of those say `header` and nothing else unlikely.
 *
 * **`headerSole` used to remove `/header/gi` from the string and re-test**, which
 * is the exact substitution the adversarial set proved wrong three hundred lines
 * below, and GPT Sol found it still living here on 2026-09-08: on `headerelated`
 * the helper said *sole* and the shipped rule said *not sole*, so the rung
 * claiming to expose the rule contradicted it. The ladder is only worth climbing
 * if each rung is computed independently **and correctly**; this one now asks
 * each surviving term whether it is in the original string.
 */
function sourceCandidates(html: string): { tables: number; doomed: number; headerSole: number } {
  const tables = Array.from(dom(html).querySelectorAll("table"));
  const doomed = tables.filter((t) => {
    const m = `${t.className} ${t.id}`;
    return LIVE_REGEXPS.unlikelyCandidates!.test(m) && !LIVE_REGEXPS.okMaybeItsACandidate!.test(m);
  });
  const headerSole = doomed.filter((t) => {
    const m = `${t.className} ${t.id}`;
    return !UNLIKELY_TERMS_BESIDES_HEADER.some((term) => term.test(m));
  });
  return { tables: tables.length, doomed: doomed.length, headerSole: headerSole.length };
}

describe("the exposure ladder's first rung, checked against the rule it exposes", () => {
  /**
   * **RED before the fix**, and it is the helper that was wrong rather than the
   * pass: `"headerelated".replace(/header/gi, " ")` is `" elated"`, which says
   * nothing unlikely, so the old helper counted the table as *header-sole* while
   * `protectAuthoredStructure` — asking the original string — declined it. A
   * ladder whose bottom rung disagrees with the top is a ladder that cannot
   * catch the rule drifting.
   */
  it("counts `headerelated` as not header-sole, which is what the shipped rule says", () => {
    const page = (cls: string) =>
      `<!doctype html><html><body><table class="${cls}"><tr><th>Region</th><td>x</td></tr></table></body></html>`;
    expect(sourceCandidates(page("headerelated"))).toEqual({ tables: 1, doomed: 1, headerSole: 0 });
    /* The old algorithm, kept here as the thing being ruled out rather than
       described — this is what the helper used to compute. */
    expect(LIVE_REGEXPS.unlikelyCandidates!.test("headerelated".replace(/header/gi, " "))).toBe(false);
    /* And the same four strings the adversarial set uses, so the two agree. */
    for (const cls of ["headerss", "headeremark", "headereplies"]) {
      expect(sourceCandidates(page(cls)).headerSole, cls).toBe(0);
    }
    /* Not vacuous: a genuinely header-sole class counts. */
    expect(sourceCandidates(page("sticky-header-multi"))).toEqual({ tables: 1, doomed: 1, headerSole: 1 });
  });
});

const rowsPerTable = (html: string): number[] =>
  Array.from(dom(html).querySelectorAll("table")).map((t) => t.querySelectorAll("tr").length);

type Blocks = ReturnType<typeof splitIntoBlocks>["blocks"];

/**
 * Blocks that exist in one arm and not the other, **compared by what a reader
 * would see** — kind, tag and text. Not `html`, which carries a freshly minted
 * block id on every run, so every block would differ from every block and the
 * comparison would say nothing.
 */
function blocksOnlyIn(a: string, b: string): Blocks {
  const key = (x: Blocks[number]) => `${x.kind}|${x.tag}|${x.text}`;
  const theirs = new Set(splitIntoBlocks(b).blocks.map(key));
  return splitIntoBlocks(a).blocks.filter((x) => !theirs.has(key(x)));
}

describe("rule A — the four tables Readability deleted for saying they have headers", CORPUS_TIMEOUT, () => {
  it("wiki_gdp_table: 8 tables, 2 doomed, 2 stamped, 3 out, 223 + 14 + 1 rows", async () => {
    const { on, off } = await extracted("wiki-gdp-table");
    const source = await readFile(path.join(FIXTURES, "wiki_gdp_table.html"), "utf8");

    /* 1. Source candidates. */
    expect(sourceCandidates(source)).toEqual({ tables: 8, doomed: 2, headerSole: 2 });
    /* 2. Elements stamped. */
    expect(on.kept).toEqual({ [RULES.headerNamedTable]: 2 });
    expect(off.kept).toEqual({});
    /* 3. Survivors after Readability — and the parts, not only the total.
          **The document total is the number that hid a discrepancy for a day**:
          the diagnosis said 239 and the truth is 238, because the regional
          table's fifteenth source row is `<tr class="mw-empty-elt">` and **our
          own furniture pass deletes it** before Readability sees the page
          (`ENTRIES` in src/furniture.ts, `.mw-empty-elt` with `isEmptyOfWords`;
          it takes 30 elements off this fixture). This comment and the doc both
          used to blame Readability, which GPT Sol corrected on 2026-09-08:
          the post-`prepareDocument` source has 14 rows in that table, so there
          was never anything left for Readability to drop. */
    expect(rowsPerTable(pageOf(off))).toEqual([1]);
    expect(rowsPerTable(pageOf(on))).toEqual([1, 223, 14]);
    expect(rowsPerTable(pageOf(on)).reduce((a, b) => a + b, 0)).toBe(238);
    /* **The one table that survived without this pass is not a table.** It is
       the map-legend swatch grid inside a `<figcaption>` — zero content tables
       survive that page unaided, not one. */
    const legend = dom(pageOf(off)).querySelector("table");
    expect(legend?.closest("figure")).not.toBeNull();
    expect(legend?.querySelectorAll("th")).toHaveLength(0);
    /* 4. Blocks affected. */
    const onBlocks = splitIntoBlocks(pageOf(on)).blocks;
    const offBlocks = splitIntoBlocks(pageOf(off)).blocks;
    expect(offBlocks).toHaveLength(79);
    expect(onBlocks).toHaveLength(79);
    expect(onBlocks.filter((b) => b.html.includes("<table")).length).toBe(3);
    expect(offBlocks.filter((b) => b.html.includes("<table")).length).toBe(1);
    /* 5. The assertion that changes. Two of the three differing blocks are the
          recovered tables; the third is the masthead's "~N min read", which
          moves because `article.length` moved. */
    const gained = blocksOnlyIn(pageOf(on), pageOf(off));
    expect(gained.filter((b) => b.text.startsWith("GDP forecast or estimate")).map((b) => b.tag)).toEqual([
      "table",
      "table",
    ]);
    expect(gained).toHaveLength(3);
    expect(on.chars).toBe(19_165);
    expect(off.chars).toBe(11_434);
  });

  it("ar5iv: 7 → 9 tables, 42 → 60 rows, and the recovered table lands where it belongs", async () => {
    const { on, off } = await extracted("ar5iv-attention");
    const source = await readFile(path.join(FIXTURES, "ar5iv.html"), "utf8");

    expect(sourceCandidates(source)).toEqual({ tables: 9, doomed: 2, headerSole: 2 });
    expect(on.kept).toEqual({ [RULES.headerNamedTable]: 2 });
    expect(off.kept).toEqual({});

    const onDoc = dom(pageOf(on));
    const offDoc = dom(pageOf(off));
    expect(offDoc.querySelectorAll("table")).toHaveLength(7);
    expect(onDoc.querySelectorAll("table")).toHaveLength(9);
    expect(offDoc.querySelectorAll("tr")).toHaveLength(42);
    expect(onDoc.querySelectorAll("tr")).toHaveLength(60);
    /* The two that came back are Table 1 (6 rows) and Table 2 (12 rows), and
       the profile says so in place rather than as a difference of totals. */
    expect(rowsPerTable(pageOf(off))).toEqual([1, 2, 1, 2, 1, 22, 13]);
    expect(rowsPerTable(pageOf(on))).toEqual([1, 2, 1, 2, 6, 1, 12, 22, 13]);

    /**
     * **Landing is correct for free**, and this is the rung that says so.
     * Nothing is re-attached: the table was deleted before the candidate was
     * chosen, so declining to delete it puts it back exactly where the author
     * had it — inside its own `<figure>`, after its `<figcaption>`.
     */
    const layer = Array.from(onDoc.querySelectorAll("table")).find((t) =>
      (t.textContent ?? "").includes("Layer Type"),
    );
    expect(layer).toBeDefined();
    expect(layer!.previousElementSibling?.tagName).toBe("FIGCAPTION");
    expect((layer!.previousElementSibling?.textContent ?? "").trim()).toMatch(/^Table 1:/);
    expect(layer!.parentElement?.tagName).toBe("FIGURE");
    /**
     * **And here the plan is wrong, so the measurement is written down
     * instead.** It records the landing as the sequence *"figcaption: Table 1…
     * / table: Layer Type… / h2: 5 Training"*. The first two are adjacent and
     * always were; the third is not. Three paragraphs of § 4's own prose sit
     * between the figure and the next heading — *"As noted in Table 1…"*, the
     * convolution paragraph and the interpretability one — which is where the
     * author put them. The claim worth making is that the table landed inside
     * its own figure in section 4 and the next heading after it is § 5, and
     * that is what is asserted.
     */
    /* Document order rather than sibling order: the `<h2>` opens the next
       `<section>`, so it is not a sibling of the figure and a `nextElementSibling`
       walk runs out three paragraphs early. */
    const flow = Array.from(onDoc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, figure"));
    const at = flow.indexOf(layer!.closest("figure")!);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(flow.slice(at, at + 5).map((el) => el.tagName)).toEqual(["FIGURE", "P", "P", "P", "H2"]);
    expect((flow[at + 1]?.textContent ?? "").trim()).toMatch(/^As noted in Table 1/);
    expect((flow[at + 4]?.textContent ?? "").trim()).toBe("5 Training");

    /* And at block granularity: the same 151 blocks, two of which now carry
       their table, plus the masthead's reading-time line. */
    const onBlocks = splitIntoBlocks(pageOf(on)).blocks;
    expect(onBlocks).toHaveLength(151);
    expect(splitIntoBlocks(pageOf(off)).blocks).toHaveLength(151);
    const gained = blocksOnlyIn(pageOf(on), pageOf(off));
    expect(gained).toHaveLength(3);
    expect(gained.filter((b) => /^Table [12]:/.test(b.text)).map((b) => b.tag)).toEqual(["figure", "figure"]);
    expect(gained.filter((b) => /^Table [12]:/.test(b.text)).every((b) => b.html.includes("<table"))).toBe(true);
    expect(on.chars).toBe(41_528);
    expect(off.chars).toBe(40_430);
  });

  it("never lets either token reach the reader", async () => {
    /* `keepClasses` defaults to false, so Readability strips it with every
       other class. Asserted rather than assumed, because the token is ours and
       an article carrying it in the reading view would be a leak of an
       implementation detail into somebody's saved HTML. */
    for (const name of ["wiki-gdp-table", "ar5iv-attention", "plos-biology"]) {
      const { on } = await extracted(name);
      expect(pageOf(on).includes("spya-keep"), name).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Rule B — the PLOS correction notice.
 * ------------------------------------------------------------------ */

describe("rule B — the correction notice a reader was never told about", CORPUS_TIMEOUT, () => {
  it("plos_biology: one notice, two elements stamped, and 348 characters back", async () => {
    const { on, off } = await extracted("plos-biology");
    const source = await readFile(path.join(FIXTURES, "plos_biology.html"), "utf8");

    /* 1. Source candidates: one outer div, and it has the citation child that
          makes it the measured topology. */
    const sourceDoc = dom(source);
    expect(sourceDoc.querySelectorAll("div.amendment.amendment-correction")).toHaveLength(1);
    expect(
      sourceDoc.querySelector("div.amendment.amendment-correction")!.querySelectorAll("div.amendment-citation"),
    ).toHaveLength(1);
    /* 2. Elements stamped — two, because stamping either alone recovers
          nothing. */
    expect(on.kept).toEqual({ [RULES.correctionNotice]: 2 });
    expect(off.kept).toEqual({});
    /* 3. Survivors: what a reader can now see, and could not before. */
    for (const said of ["Correction", "10 Apr 2018", "10.1371/journal.pbio.1002626", "View correction"]) {
      expect(pageOf(on).includes(said), `on: ${said}`).toBe(true);
      expect(pageOf(off).includes(said), `off: ${said}`).toBe(false);
    }
    /* 4. Blocks affected: exactly two, and they are the heading and the
          citation. */
    expect(splitIntoBlocks(pageOf(off)).blocks).toHaveLength(103);
    expect(splitIntoBlocks(pageOf(on)).blocks).toHaveLength(105);
    const gained = blocksOnlyIn(pageOf(on), pageOf(off));
    expect(gained.map((b) => `${b.kind}/${b.tag}`)).toEqual(["heading/h2", "text/p"]);
    expect(gained[0]!.text.trim()).toBe("Correction");
    expect(gained[1]!.text.trim()).toMatch(/^10 Apr 2018:/);
    /* 5. The number.
       **The plan's absolute figures are wrong and the measurement wins.** It
       records 28,112 → 28,460; the pipeline as it stands says 28,004 → 28,352.
       The *delta* is 348 in both, so what has drifted is the baseline rather
       than this rule's effect. */
    expect(off.chars).toBe(28_004);
    expect(on.chars).toBe(28_352);
    expect(on.chars - off.chars).toBe(348);
  });
});

/* ------------------------------------------------------------------ *
 * The standing negatives.
 * ------------------------------------------------------------------ */

describe("the two Wikipedia sidebars, which are the fixtures that caught the broad rule", CORPUS_TIMEOUT, () => {
  /**
   * **These are not decoration.** The first draft of rule A stamped
   * `<table class="sidebar sidebar-collapse nomobile nowraplinks hlist">` in
   * `wiki_ar_ai.html` — 61 links and a taxonomy of topic links — and reported
   * it as a recovery nobody had counted; `wiki_transformer.html` is the same
   * shape, saved only by the `role="navigation"` its Arabic twin lacks. Two of
   * the first draft's three "interesting" results were one bug wearing two
   * hats, and these two assertions are what stop it coming back.
   */
  for (const [name, file, tables] of [
    ["wiki-ar-ai", "wiki_ar_ai.html", 10],
    ["wikipedia-transformer", "wiki_transformer.html", 13],
  ] as const) {
    it(`${name}: the sidebar trips Readability, is declined here, and the page is byte-identical`, async () => {
      const { on, off } = await extracted(name);
      const source = await readFile(path.join(FIXTURES, file), "utf8");
      /* The candidate is real — this negative is not green by vacuity. One
         table does trip line 1119, and `header` is not the reason. */
      expect(sourceCandidates(source)).toEqual({ tables, doomed: 1, headerSole: 0 });
      expect(on.kept).toEqual({});
      expect(off.kept).toEqual({});
      expect(on.bytes).toBe(off.bytes);
      expect(on.digest).toBe(off.digest);
      expect(pageOf(on)).toBe(pageOf(off));
    });
  }
});

/* ------------------------------------------------------------------ *
 * The candidate-scoring boundary cases. Synthetic, because the corpus
 * has no page with this score topology.
 * ------------------------------------------------------------------ */

const BEFORE =
  "PROSE-BEFORE. The committee met in Braemar on a wet Tuesday and spent the whole morning " +
  "arguing about the figures below, which nobody had checked and everybody had quoted. " +
  "The argument turned on whether the second column was measured in the same year as the " +
  "first, and on whether the fourth had been revised after publication. It had.";
const AFTER =
  "PROSE-AFTER. What the table does not show is the revision history, which is kept in a " +
  "separate ledger and has never been published. The clerk who kept it retired in March " +
  "and took the ledger with her, and the committee has been reconstructing it from memory " +
  "and from the minutes of meetings that were themselves reconstructed.";

/**
 * A table Readability deletes at line 1127, with genuine prose either side and
 * **cells long enough to be scored** — `_grabArticle` skips any element under 25
 * characters, so a table of short cells never becomes a candidate at all and
 * the boundary this case exists to find is never approached.
 */
function braemar(tableClass: string): string {
  const cell = (i: number, c: number) =>
    `Reported figure for region ${i + 1}, column ${c}, as revised by the clerk in March ${1990 + i}`;
  const rows = Array.from(
    { length: 12 },
    (_, i) => `<tr><td>${cell(i, 1)}</td><td>${cell(i, 2)}</td><td>${cell(i, 3)}</td><td>${cell(i, 4)}</td></tr>`,
  ).join("");
  return `<!doctype html><html><head><title>The Braemar figures</title></head><body><div id="wrapper">
<h1>The Braemar figures</h1>
<p>${BEFORE}</p>
<table class="${tableClass}"><caption>Table 1: receipts by region</caption>
<tr><th>Region</th><th>1994</th><th>1995</th><th>Note</th></tr>${rows}</table>
<p>${AFTER}</p>
</div></body></html>`;
}

interface Card {
  chars: number;
  tables: number;
  rows: number;
  before: boolean;
  after: boolean;
  kept: Record<string, number>;
}

async function cardOf(html: string, url: string, slug: string, disabled = false): Promise<Card> {
  const run = () => runExtract({ html, url, slug });
  const r = disabled ? await withProtectionDisabled(run) : await run();
  const d = dom(r.extractedHtml);
  return {
    chars: r.length ?? -1,
    tables: d.querySelectorAll("table").length,
    rows: d.querySelectorAll("tr").length,
    before: r.extractedHtml.includes("PROSE-BEFORE"),
    after: r.extractedHtml.includes("PROSE-AFTER"),
    kept: r.kept as Record<string, number>,
  };
}

const braemarCard = (cls: string, disabled = false) =>
  cardOf(braemar(cls), "https://example.invalid/braemar", "braemar", disabled);

describe("the candidate-scoring boundary, which is why there are two tokens", { timeout: 60_000 }, () => {
  const PLAIN = "wikitable sortable sticky-header-multi";

  it("without the pass the table is deleted and the prose survives", async () => {
    expect(await braemarCard(PLAIN, true)).toEqual({
      chars: 665,
      tables: 0,
      rows: 0,
      before: true,
      after: true,
      kept: {},
    });
  });

  it("`spya-keep-column` keeps the table a table and keeps the prose either side", async () => {
    expect(await braemarCard(PLAIN)).toEqual({
      chars: 4419,
      tables: 1,
      rows: 13,
      before: true,
      after: true,
      kept: { [RULES.headerNamedTable]: 1 },
    });
  });

  it("`spya-keep-content` on the same table is WORSE — it eats the prose either side", async () => {
    /**
     * **The P0, reproduced rather than described.** The page arrives already
     * carrying the wrong token — which is also why this pass declines to stamp
     * it: `content` matches `okMaybeItsACandidate`, so `header` is no longer the
     * sole reason and rule A steps back. The 25 points of class weight promote
     * the table to top candidate, Readability rewrites it as a `<div>`, and both
     * prose regions go with the siblings it did not take.
     *
     * Merging the two tokens back into one makes this test go red, which is
     * exactly what it is for.
     */
    const wrong = await braemarCard(`${PLAIN} ${KEEP_CONTENT}`);
    expect(wrong).toEqual({ chars: 3726, tables: 0, rows: 0, before: false, after: false, kept: {} });
    /* Said as a comparison as well as as a card, because "worse" is the claim. */
    const right = await braemarCard(PLAIN);
    expect(wrong.chars).toBeLessThan(right.chars);
    expect(right.before && right.after).toBe(true);
    expect(wrong.before || wrong.after).toBe(false);
  });
});

/**
 * Rule B's own boundary case: a `positive` token is the thing that deletes
 * prose when it lands on the wrong element, so the topology rule B *does* stamp
 * has to be shown not doing that.
 */
function correctedPaper(cls: string, withCitation: boolean): string {
  const p = (n: number) =>
    `<p>PROSE-${n}. The trial was registered in March and the protocol was published in April, ` +
    `and between those two dates the primary endpoint changed from mortality at ninety days to ` +
    `mortality at twenty-eight days, which nobody mentioned in the paper itself. The registry ` +
    `records the change and the date; the paper records neither, and the difference is ${n} pages.</p>`;
  const citation = withCitation
    ? `<div class="amendment-citation"><p><span class="amendment-date">10 Apr 2018:</span>
       The Staff (2018) Correction: a trial endpoint. Journal 16(4): e1002626.
       <a href="https://doi.org/10.1371/journal.pbio.1002626">https://doi.org/10.1371/journal.pbio.1002626</a>
       <a href="/article?id=10.1371/journal.pbio.1002626">NOTICE-LINK</a></p></div>`
    : `<p><a href="https://doi.org/10.1371/x">https://doi.org/10.1371/x</a></p>`;
  return `<!doctype html><html><head><title>A corrected paper</title></head><body>
<div class="article-content"><h1>A corrected paper</h1>
<div class="${cls}">
  <a data-toc="amendment-0" title="Correction" id="amendment-0" name="amendment-0"></a>
  <h2>NOTICE-HEADING</h2>
  ${citation}
</div>
${p(1)}${p(2)}${p(3)}${p(4)}
</div></body></html>`;
}

async function noticeCard(cls: string, withCitation: boolean, disabled = false) {
  const html = correctedPaper(cls, withCitation);
  const run = () => runExtract({ html, url: "https://example.invalid/paper", slug: "paper" });
  const r = disabled ? await withProtectionDisabled(run) : await run();
  return {
    chars: r.length ?? -1,
    heading: r.extractedHtml.includes("NOTICE-HEADING"),
    prose: [1, 2, 3, 4].filter((n) => r.extractedHtml.includes(`PROSE-${n}.`)).length,
    kept: r.kept as Record<string, number>,
  };
}

const AMENDMENT = "amendment amendment-correction toc-section";

describe("rule B's boundary — 25 points of weight, and not one paragraph paid for it", { timeout: 60_000 }, () => {
  it("without the pass, the notice goes and the prose stays", async () => {
    expect(await noticeCard(AMENDMENT, true, true)).toEqual({ chars: 1415, heading: false, prose: 4, kept: {} });
  });

  it("with the pass, the notice comes back and all four prose regions are still there", async () => {
    /* The half of the P0 that applies to a `positive` token: it recovers the
       notice **without** becoming the preferred candidate and dropping its
       neighbours, which a bigger positive-weighted div would. */
    expect(await noticeCard(AMENDMENT, true)).toEqual({
      chars: 1598,
      heading: true,
      prose: 4,
      kept: { [RULES.correctionNotice]: 2 },
    });
  });

  it("declines the outer div when there is no citation child — both or neither", async () => {
    expect(await noticeCard(AMENDMENT, false)).toEqual({ chars: 1415, heading: false, prose: 4, kept: {} });
  });

  it("declines a class token that merely starts the same way", async () => {
    /* `class~=`, never a substring: `amendment-correction-withdrawn` is a
       different thing that a publisher is free to coin. */
    expect(await noticeCard("amendment-correction-withdrawn", true)).toEqual({
      chars: 1415,
      heading: false,
      prose: 4,
      kept: {},
    });
  });

  it("declines a bare `.correction`, because there is no registry", async () => {
    /* `correction`, `erratum` and `retraction` were proposed and rejected:
       candidate selection is global, so a wrong positive stamp can delete an
       author's prose somewhere else on the page. */
    expect(await noticeCard("correction", true)).toEqual({ chars: 1415, heading: false, prose: 4, kept: {} });
  });
});

/* ------------------------------------------------------------------ *
 * The corpus residual, both arms.
 * ------------------------------------------------------------------ */

describe("the residual — what this pass does to the other 32 fixtures", CORPUS_TIMEOUT, () => {
  /**
   * **Both arms are run.** The first draft's spike did not: for a zero-stamp
   * fixture it assigned the treatment result *from* the control and compared
   * three counts, which is a check that cannot fail, in a stage whose subject is
   * checks that cannot fail. So the control here is a second real extraction
   * with the pass disabled, and the comparison is of bytes.
   */
  it("stamps exactly three fixtures and leaves the other thirty-two alone", async () => {
    const corpus = await CORPUS;
    expect(corpus.size).toBe(35);
    const stamped = [...corpus].filter(([, r]) => r.kind === "extracted" && Object.keys(r.on.kept).length > 0);
    expect(stamped.map(([n]) => n).sort()).toEqual(["ar5iv-attention", "plos-biology", "wiki-gdp-table"]);
    /**
     * **The plan says five, and five is wrong.** It reasons *"30 zero-stamp
     * fixtures, because five fixtures are stamped, not four"*; the measurement
     * is three stamped, two refused and thirty compared. The 30 is right and
     * its arithmetic is not.
     */
    expect(stamped).toHaveLength(3);
  });

  it("is byte-identical on all thirty zero-stamp fixtures that extract at all", async () => {
    const corpus = await CORPUS;
    const compared: string[] = [];
    const differed: string[] = [];
    for (const [name, row] of corpus) {
      if (row.kind !== "extracted") continue;
      if (Object.keys(row.on.kept).length > 0) continue;
      compared.push(name);
      /* Bytes, not counts: length and digest together, and the whole string for
         the two fixtures whose html is kept. */
      if (row.on.bytes !== row.off.bytes || row.on.digest !== row.off.digest) differed.push(name);
      expect(row.off.kept, name).toEqual({});
    }
    expect(differed).toEqual([]);
    expect(compared).toHaveLength(30);
  });

  it("refuses the two bot walls with the typed refusal, in both arms", async () => {
    /* Named rather than caught into a sentinel: an exception that is not this
       one is re-thrown by `armOf`, so a crash cannot be read as a refusal. */
    const corpus = await CORPUS;
    for (const name of WALLS) {
      const row = corpus.get(name);
      expect(row?.kind, name).toBe("refused");
      const r = row as { kind: "refused"; onRefusal: TooLittleTextToRead; offRefusal: TooLittleTextToRead };
      expect(r.onRefusal, name).toBeInstanceOf(TooLittleTextToRead);
      expect(r.offRefusal, name).toBeInstanceOf(TooLittleTextToRead);
    }
    expect(WALLS).toHaveLength(2);
  });

  it("leaves the mutation seam where it found it", async () => {
    /* A case that threw inside `withProtectionDisabled` would leave the pass
       disabled, and every assertion after it would be an assertion about a
       pipeline that does not ship. */
    await CORPUS;
    expect(protectionIsDisabled()).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The adversarial set.
 * ------------------------------------------------------------------ */

/**
 * **Written by a different agent than the one who wrote src/protect.ts, and
 * written to break it** — the standing rule after a review found that a
 * recogniser's negative fixtures had all been written by whoever was fixing the
 * bug, so they demonstrated a fix rather than sampled a space.
 *
 * Everything above is the builder's own case. Nothing here duplicates it. Three
 * of these went red against the pass as shipped and named their defect in the
 * comment; the rest are constructions the pass declined correctly, kept because
 * a negative nobody wrote down is a negative the next draft is free to lose.
 *
 * The prose markers are `ADV-PROSE-n` rather than the `PROSE-BEFORE`/`-AFTER`
 * above, so a page from this block cannot be scored by a helper from that one.
 */

const ADV_P = (n: number) =>
  `<p>ADV-PROSE-${n}. The committee met in Braemar on a wet Tuesday and spent the whole morning arguing ` +
  `about the figures below, which nobody had checked and everybody had quoted, and the argument turned ` +
  `on whether the ${n}th column was measured in the same year as the first. It was not.</p>`;

/**
 * The Braemar page again, parameterised. **Two paragraphs each side rather than
 * one, and that is load-bearing**: with one, the control arm's article comes to
 * 402 characters, Readability disowns the parse under its own 500-character
 * threshold and retries with `FLAG_STRIP_UNLIKELYS` off — so the table survives
 * in the arm that is supposed to be showing what happens without it, and both
 * arms print the same number for opposite reasons.
 */
function advBraemar(cls: string, rows = 12, paras = 2): string {
  const cell = (i: number, c: number) =>
    `Reported figure for region ${i + 1}, column ${c}, as revised by the clerk in March ${1990 + (i % 30)}`;
  const body = Array.from(
    { length: rows },
    (_, i) => `<tr><td>${cell(i, 1)}</td><td>${cell(i, 2)}</td><td>${cell(i, 3)}</td><td>${cell(i, 4)}</td></tr>`,
  ).join("");
  const above = Array.from({ length: paras }, (_, i) => ADV_P(i + 1)).join("");
  const below = Array.from({ length: paras }, (_, i) => ADV_P(paras + i + 1)).join("");
  return `<!doctype html><html><head><title>The Braemar figures</title></head><body><div id="wrapper">
<h1>The Braemar figures</h1>
${above}
<table class="${cls}"><caption>Table 1: receipts by region</caption>
<tr><th>Region</th><th>1994</th><th>1995</th><th>Note</th></tr>${body}</table>
${below}
</div></body></html>`;
}

interface AdvCard {
  chars: number;
  kept: Record<string, number>;
  tables: number;
  prose: number;
}

async function advCard(html: string, disabled = false): Promise<AdvCard> {
  const run = () => runExtract({ html, url: "https://example.invalid/adv", slug: "adv" });
  const r = disabled ? await withProtectionDisabled(run) : await run();
  return {
    chars: r.length ?? -1,
    kept: r.kept as Record<string, number>,
    tables: dom(r.extractedHtml).querySelectorAll("table").length,
    prose: (r.extractedHtml.match(/ADV-PROSE-\d/g) ?? []).length,
  };
}

describe("the adversarial set — rule A's `sole reason` test", { timeout: 120_000 }, () => {
  /**
   * **RED before the fix.** The rule used to neutralise `header` by replacing
   * it with a space and re-testing, on the argument that a space cannot be part
   * of any unlikely term so nothing can be glued into existence. That argument
   * is sound and it answers the wrong question: the danger is not creation, it
   * is **destruction of an overlapping term**. `header` ends in `r`, and
   * `related`, `remark`, `replies` and `rss` all begin with one, so each of
   * these strings contains a second and entirely genuine unlikely term that
   * shares that letter — and taking `header` out took the second term with it.
   *
   * `headerelated` was the expensive one. The pass stamped a `<table>` the
   * publisher had labelled `related`, Readability then kept it, and on this
   * page it won candidacy: the measured card was 3,726 characters of flattened
   * `<tr>`s with **all four paragraphs of prose deleted**, against 801
   * characters and four paragraphs with the pass switched off. Not a stamp that
   * kept some junk — a stamp that cost the reader the article.
   */
  it("declines a class where `header` overlaps a second, genuine unlikely term", async () => {
    /* The bug in one line: the old substitution could not see `related`. */
    expect("headerelated".replace(/header/gi, " ")).toBe(" elated");
    expect(UNLIKELY_CANDIDATES.test(" elated")).toBe(false);

    for (const cls of ["headerelated", "headerss", "headeremark", "headereplies"]) {
      /* The second term is really there — the case is not green by vacuity. */
      expect(UNLIKELY_EXCEPT_HEADER.test(cls), cls).toBe(true);
      const on = await advCard(advBraemar(cls));
      const off = await advCard(advBraemar(cls), true);
      expect(on.kept, cls).toEqual({});
      /* Nothing stamped **and** nothing changed: `kept: {}` alone would pass on
         a pass that stamped and then reported nothing. */
      expect(on, cls).toEqual(off);
      expect(on.prose, cls).toBe(4);
    }

    /* The positive control, in the same harness and the same run, because four
       greens are also what a rule that had simply stopped firing produces. */
    const control = await advCard(advBraemar("wikitable sortable sticky-header-multi"));
    expect(control.kept).toEqual({ [RULES.headerNamedTable]: 1 });
    expect(control.tables).toBe(1);
    expect(control.prose).toBe(4);
  });

  /**
   * **The failure mode of the replacement is silence**, which is why it is
   * pinned by hand as well as by behaviour: `String.replace` on a needle that
   * is not there returns the string unchanged and raises nothing, so a
   * dependency bump that reordered `unlikelyCandidates` would leave
   * `UNLIKELY_EXCEPT_HEADER` identical to `UNLIKELY_CANDIDATES`, rule A would
   * decline every table forever, and the only symptom would be four tables
   * quietly going missing again.
   */
  it("pins the derivation of `UNLIKELY_EXCEPT_HEADER` against a silent no-op", () => {
    expect(UNLIKELY_EXCEPT_HEADER.source).not.toBe(UNLIKELY_CANDIDATES.source);
    /* Exactly one occurrence — *exactly*, not at least: two would mean the
       replacement removed one of them and left the other. */
    expect(UNLIKELY_CANDIDATES.source.split("|header|")).toHaveLength(2);
    expect(UNLIKELY_EXCEPT_HEADER.flags).toBe("i");
    for (const declined of ["header", "HEADER", "ltx_guessed_headers", "sticky-header-multi"]) {
      expect(UNLIKELY_EXCEPT_HEADER.test(declined), declined).toBe(false);
    }
    for (const kept of ["sidebar", "related", "rss", "remark", "replies", "footer", "menu", "pager"]) {
      expect(UNLIKELY_EXCEPT_HEADER.test(kept), kept).toBe(true);
    }
  });

  /**
   * **The reverse direction, and it is impossible rather than merely unobserved.**
   * The old comment worried that removing `header` might glue two halves into a
   * term neither was. It could not: every alternative in `unlikelyCandidates`
   * is free of whitespace, so a space can never be part of one. Asserted here
   * rather than reasoned about, because reasoning about a regex to check a
   * regex is the natural check that shares the code's assumption.
   */
  it("cannot invent an unlikely term that was not in the source string", () => {
    const terms = UNLIKELY_CANDIDATES.source.split("|");
    expect(terms.length).toBeGreaterThan(20);
    for (const t of terms) expect(/\s/.test(t), t).toBe(false);
  });
});

/**
 * A page whose qualifying table can be put inside another table or left at the
 * top level, with everything else held constant.
 *
 * `wrappers` is how many `<div>`s sit between the layout table's cell and the
 * data table, and it is the whole of the depth case: at zero the data table's
 * ancestors are `td, tr, tbody, table` — the fourth level, the last one
 * Readability's `_hasAncestorTag` looks at — and each wrapper pushes the layout
 * table one level further out of that window.
 */
function advNestedTable(nested: boolean, wrappers = 0): string {
  const inner =
    `<table class="sticky-header-multi"><caption>Table 1: receipts by region</caption>` +
    `<tr><th>Region</th><th>Receipts</th></tr>` +
    Array.from(
      { length: 8 },
      (_, i) =>
        `<tr><td>Reported figure for region ${i + 1}, as revised by the clerk in March ${1990 + i}</td>` +
        `<td>Reported figure for region ${i + 1}, column two, revised the same March</td></tr>`,
    ).join("") +
    `</table>`;
  const padded = `${"<div>".repeat(wrappers)}${inner}${"</div>".repeat(wrappers)}`;
  const placed = nested ? `<table class="layout"><tr><td>${padded}</td></tr></table>` : inner;
  return `<!doctype html><html><head><title>The Braemar figures</title></head><body><div id="wrapper">
<h1>The Braemar figures</h1>
${ADV_P(1)}${ADV_P(2)}
${placed}
${ADV_P(3)}${ADV_P(4)}
</div></body></html>`;
}

/**
 * `advCard` plus *"did the data table itself survive?"*, which the plain table
 * count cannot answer on a page that also has a layout table.
 */
async function advNestedCard(html: string, disabled = false) {
  const run = () => runExtract({ html, url: "https://example.invalid/adv", slug: "adv" });
  const r = disabled ? await withProtectionDisabled(run) : await run();
  return {
    kept: r.kept as Record<string, number>,
    receipts: Array.from(dom(r.extractedHtml).querySelectorAll("table")).filter((t) =>
      (t.textContent ?? "").includes("receipts by region"),
    ).length,
    prose: (r.extractedHtml.match(/ADV-PROSE-\d/g) ?? []).length,
  };
}

describe("the adversarial set — what rule A counts", { timeout: 120_000 }, () => {
  /**
   * **RED before the fix.** Readability's line 1119 carries
   * `!this._hasAncestorTag(node, "table")` and `!…(node, "code")`, so the
   * deletion this rule exists to defeat cannot reach a table nested inside
   * either. The pass stamped one anyway and reported
   * `{"a-table-called-header": 1}` — a rescue that rescued nothing, in the one
   * field a reader of the library would use to find out what this pass did.
   * The stamp itself was harmless; the number was not.
   */
  it("declines a qualifying table Readability could never have deleted", async () => {
    const nested = await advCard(advNestedTable(true));
    const plain = await advCard(advNestedTable(false));
    expect(nested.kept).toEqual({});
    /* Not vacuous: the identical table one level up is stamped. */
    expect(plain.kept).toEqual({ [RULES.headerNamedTable]: 1 });
    /* And declining to count it is not declining to keep it — the nested table
       survives either way, which is the whole reason the stamp was pointless. */
    expect(nested.tables).toBeGreaterThan(0);
  });

  /**
   * **RED before the fix, and the reader loses a table for it.** The guard above
   * was `table.parentElement?.closest("table, code")`, which walks to the root;
   * Readability's `_hasAncestorTag` defaults to `maxDepth = 3` and returns false
   * once `depth > maxDepth`, so it inspects **four** ancestor levels and no more
   * (Readability.js:2217, and the call at line 1121 passes no depth). GPT Sol
   * reproduced the consequence on 2026-09-08 and it is reproduced here: put one
   * `<div>` between the layout cell and the data table and the layout table
   * falls out of Readability's window, so Readability deletes the data table —
   * while the unbounded check declined to stamp it, on the claim that
   * Readability could not.
   *
   * The two rows below are the whole finding. Same page, one wrapper apart:
   * without the depth mirror the second row read `kept: {}, receipts: 0`.
   */
  it("mirrors the four levels Readability looks at, rather than walking to the root", async () => {
    /* Shallow: `td, tr, tbody, table` — the fourth level is the last one
       Readability checks, so it does see the table ancestor and never reaches
       the deletion. Declined, and the table survives unaided. */
    const shallow = await advNestedCard(advNestedTable(true, 0));
    expect(shallow.kept).toEqual({});
    expect(shallow.receipts).toBe(1);
    expect(await advNestedCard(advNestedTable(true, 0), true)).toEqual(shallow);

    /* Beyond the window: one wrapper further out. Readability cannot see the
       layout table, so the deletion at line 1119 applies and this rule's stamp
       is the only thing that stops it. */
    const deep = await advNestedCard(advNestedTable(true, 1));
    expect(deep.kept).toEqual({ [RULES.headerNamedTable]: 1 });
    expect(deep.receipts).toBe(1);
    expect(deep.prose).toBe(4);
    /* The counterfactual, which is what makes the stamp a rescue rather than a
       decoration: with the pass off, the same page loses the table. */
    const deepOff = await advNestedCard(advNestedTable(true, 1), true);
    expect(deepOff.kept).toEqual({});
    expect(deepOff.receipts).toBe(0);
    expect(deepOff.prose).toBe(4);
  });

  /**
   * `hasItsOwnHeaderMarkup` says "of its own" and means it. Three constructions
   * that look like a declaration of structure and are not; all three were
   * declined as shipped, and they are kept because the next draft of that
   * function is free to lose any of them.
   */
  it("declines markup that only looks like the table's own header markup", async () => {
    const page = (table: string) =>
      `<!doctype html><html><head><title>t</title></head><body><div id="wrapper"><h1>t</h1>` +
      `${ADV_P(1)}${ADV_P(2)}${table}${ADV_P(3)}${ADV_P(4)}</div></body></html>`;
    const rows = Array.from(
      { length: 8 },
      (_, i) => `<tr><td>Reported figure for region ${i + 1}, as revised by the clerk in March</td></tr>`,
    ).join("");

    /* A `<th>` that lives in a `<template>`: its content is a separate document
       fragment, so `querySelectorAll` never reaches it. */
    const template = page(`<table class="sticky-header-multi"><template><tr><th>Region</th></tr></template>${rows}</table>`);
    /* A `<caption>` belonging to a nested table — the shape a layout table
       wraps round a data one, which is why the caption is taken from the direct
       children rather than from `querySelector`. */
    const borrowed = page(
      `<table class="sticky-header-multi"><tr><td><table><caption>Inner</caption><tr><td>x</td></tr></table></td></tr>${rows}</table>`,
    );
    /* A `<caption>` with no text in it at all. */
    const wordless = page(`<table class="sticky-header-multi"><caption> \n </caption>${rows}</table>`);

    for (const [name, html] of [
      ["a th inside a template", template],
      ["a nested table's caption", borrowed],
      ["a caption of whitespace", wordless],
    ] as const) {
      expect((await advCard(html)).kept, name).toEqual({});
    }
    /* The control: the same table with one `<th>` of its own is stamped, so the
       three greens above are about "of its own" rather than about the page. */
    const control = page(`<table class="sticky-header-multi"><tr><th>Region</th></tr>${rows}</table>`);
    expect((await advCard(control)).kept).toEqual({ [RULES.headerNamedTable]: 1 });
  });

  /**
   * **Recorded rather than fixed, and the reasoning matters more than the
   * case.** `.trim()` removes Unicode whitespace and U+200B is not whitespace,
   * so a `<caption>` holding one zero-width space is a "non-empty caption" and
   * a table of pure navigation qualifies on it. That is a forgery, and it buys
   * the page nothing: the same table with `class="site-header column"` — a
   * string any page may write — is kept by Readability itself with no help from
   * here, so there is no capability to take away. Narrowing the caption test
   * would add a rule and defend nothing. If somebody later makes
   * `hasItsOwnHeaderMarkup` stricter, this is the case that changes.
   */
  it("accepts a caption of one zero-width space, which is a forgery that buys nothing", async () => {
    const rows = Array.from(
      { length: 8 },
      (_, i) => `<tr><td><a href="/s/${i}">Go to section ${i + 1} of this website</a></td></tr>`,
    ).join("");
    const page = (cls: string, caption: string) =>
      `<!doctype html><html><head><title>t</title></head><body><div id="wrapper"><h1>t</h1>` +
      `${ADV_P(1)}${ADV_P(2)}<table class="${cls}">${caption}${rows}</table>${ADV_P(3)}${ADV_P(4)}</div></body></html>`;

    expect((await advCard(page("site-header", "<caption>​</caption>"))).kept).toEqual({
      [RULES.headerNamedTable]: 1,
    });
    /* The same page saying `column` in its own class attribute keeps the table
       with nothing stamped — the reason this is not a new surface. */
    const forged = await advCard(page("site-header column", "<caption>​</caption>"));
    expect(forged.kept).toEqual({});
    expect(forged.tables).toBe(1);
  });
});

describe("the adversarial set — the size at which a rescue would cost prose", { timeout: 120_000 }, () => {
  /**
   * **The claim in src/protect.ts's own header used to be too strong**, and this
   * is the measurement that made it say less. Its table reads
   * *"`spya-keep-column` | the table is a table, both prose regions survive"*,
   * against `spya-keep-content` losing them. That is a reading of one page with
   * twelve body rows. Take the same page to twenty-four and the weightless
   * token produces the same catastrophic card: table flattened into a `<div>`,
   * every paragraph gone.
   *
   * **The first version of this test then pinned that as accepted behaviour**,
   * on the argument that it is the library's arithmetic rather than ours: the
   * identical page with `class="wikitable sortable"` loses the same four
   * paragraphs at the same row count, and nothing is stamped on it. GPT Sol
   * rejected the argument on 2026-09-08 and it is not defended here. The
   * mechanism is the library's; **the action is ours**, and it takes the real
   * header-named page from *"prose, missing table"* to *"flattened table,
   * missing prose"* — the same failure class the `positive` token was rejected
   * for at twelve rows. So the rescue is now checked before it ships
   * (`proseRetention`, src/protect.ts) and withdrawn when it costs a paragraph.
   *
   * What this test asserts, at all three row counts, is therefore both halves:
   * **the treatment keeps the table where it can, and keeps every paragraph the
   * control had, always.** The unmarked page is still measured beside it, and
   * still loses its prose at 24 and 40 — that is what the library does to a page
   * nobody stamped, and the point is that we no longer do it to a page we did.
   *
   * Swept rather than sampled, because the whole defect of the original claim
   * was that it was a sample of one.
   */
  it("keeps the table where it can and the prose always, at 12, 24 and 40 rows", async () => {
    const HEADER_NAMED = "wikitable sortable sticky-header-multi";
    const UNREMARKABLE = "wikitable sortable";

    for (const rows of [12, 24, 40]) {
      const stamped = await advCard(advBraemar(HEADER_NAMED, rows));
      const unmarked = await advCard(advBraemar(UNREMARKABLE, rows));
      const control = await advCard(advBraemar(HEADER_NAMED, rows), true);
      expect(unmarked.kept, `${rows} rows`).toEqual({});

      /* **Every paragraph the control had, at every size.** This is the
         assertion the whole fallback exists to make true, and it is the one
         that was false before it. */
      expect(stamped.prose, `${rows} rows`).toBe(4);
      expect(control.prose, `${rows} rows`).toBe(4);

      if (rows === 12) {
        /* Small enough that the table does not win candidacy: the rescue stands,
           and the reader gets the table *and* the prose. */
        expect(stamped.kept, `${rows} rows`).toEqual({ [RULES.headerNamedTable]: 1 });
        expect(stamped.tables, `${rows} rows`).toBe(1);
        expect(control.tables, `${rows} rows`).toBe(0);
        expect(stamped.chars, `${rows} rows`).toBe(unmarked.chars);
      } else {
        /* Big enough that the rescued table would eat the page. The stamp is
           taken back, `kept` says so, and what ships is the control extraction —
           asserted as an equality with the control arm rather than as a
           description of it. */
        expect(stamped.kept, `${rows} rows`).toEqual({ [RULES.headerNamedTableRolledBack]: 1 });
        expect(stamped.tables, `${rows} rows`).toBe(0);
        expect(stamped.chars, `${rows} rows`).toBe(control.chars);
        /* And the page nobody stamped still goes the way it always did — longer
           than what we ship, with none of the prose in it, which is why the
           criterion cannot be a length comparison. */
        expect(unmarked.prose, `${rows} rows`).toBe(0);
        expect(unmarked.chars, `${rows} rows`).toBeGreaterThan(stamped.chars);
      }
    }
  });

  /**
   * The fallback's own instrument, exercised directly rather than through a
   * page, because two of its three decisions are invisible from outside: a run
   * that moved between elements is not lost, and a short one is not counted.
   */
  it("counts prose retention by containment, not by length or by element", () => {
    const body = (html: string) => dom(`<!doctype html><html><body>${html}</body></html>`).body;
    const long = (n: number) =>
      `Paragraph ${n} of the committee's report, which runs on for long enough to be prose rather ` +
      `than a label, and says nothing anybody will remember.`;

    /* Re-wrapped and merged: same text, different elements, nothing lost. */
    expect(
      proseRetention(body(`<p>${long(1)}</p><p>${long(2)}</p>`), body(`<div><p>${long(1)} ${long(2)}</p></div>`)),
    ).toEqual({ runs: 2, lost: 0, retained: true });
    /* Deleted: the failure this exists to catch. */
    expect(proseRetention(body(`<p>${long(1)}</p><p>${long(2)}</p>`), body(`<p>${long(1)}</p>`))).toEqual({
      runs: 2,
      lost: 1,
      retained: false,
    });
    /* **Longer is not better**, which is the trap: a treatment of nothing but
       table rows outweighs the control and retains none of it. */
    const rows = Array.from({ length: 40 }, (_, i) => `<tr><td>Row ${i} of the receipts table</td></tr>`).join("");
    const flattened = proseRetention(body(`<p>${long(1)}</p>`), body(`<table>${rows}</table>`));
    expect(flattened.retained).toBe(false);
    expect(body(`<table>${rows}</table>`).textContent!.length).toBeGreaterThan(long(1).length);
    /* Under the floor: a line of site chrome is not a paragraph of the article,
       and counting it as one withdrew a real recovery on `wiki_gdp_table`. */
    expect(proseRetention(body("<p>From Wikipedia, the free encyclopedia</p>"), body("<p>Something else</p>"))).toEqual(
      { runs: 0, lost: 0, retained: true },
    );
    /* Whitespace is normalised rather than compared. */
    expect(proseRetention(body(`<p>${long(1)}</p>`), body(`<p>\n   ${long(1).replace(/ /g, "\n  ")}\n</p>`))).toEqual({
      runs: 1,
      lost: 0,
      retained: true,
    });
  });
});

/* ------------------------------------------------------------------ *
 * The adversarial set — rule B's topology.
 * ------------------------------------------------------------------ */

const ADV_CITATION = `<div class="amendment-citation"><p><span class="amendment-date">10 Apr 2018:</span>
   The Staff (2018) Correction: a trial endpoint. Journal 16(4): e1002626.
   <a href="https://doi.org/10.1371/journal.pbio.1002626">https://doi.org/10.1371/journal.pbio.1002626</a>
   <a href="/article?id=10.1371/journal.pbio.1002626">ADV-NOTICE-LINK</a></p></div>`;

const ADV_AMENDMENT = "amendment amendment-correction toc-section";

const advPaper = (notice: string) =>
  `<!doctype html><html><head><title>A corrected paper</title></head><body>
<div class="article-content"><h1>A corrected paper</h1>
${notice}
${ADV_P(1)}${ADV_P(2)}${ADV_P(3)}${ADV_P(4)}
</div></body></html>`;

describe("the adversarial set — rule B's topology", { timeout: 120_000 }, () => {
  /**
   * **RED before the fix.** `querySelector` used to reach through a nested
   * `div.amendment.amendment-correction`, so an outer notice and the inner one
   * inside it could resolve to the *same* citation element — and `notice += 2`
   * per outer div then counted that element once per notice that found it. Two
   * inner notices under one outer reported **6 for 5 elements stamped**, in a
   * field whose own documentation says the unit is elements stamped. A count
   * that overstates what a pass did is the exact shape of
   * docs/reusable/silent-success.md, and it is worse here than a wrong number
   * elsewhere because `kept` is the instrument this pass is judged by.
   *
   * **The number moved from 5 to 4 when the citation lookup became
   * `:scope >`** (see the case below). The outer notice has no citation child of
   * its own any more — only two inner notices that have theirs — so it is
   * declined, and four elements are stamped rather than five. The test is kept
   * as it was otherwise: the count under test comes back from the pipeline and
   * the number it is compared against is read off the DOM, which is the only
   * reason a lying count is visible here at all.
   */
  it("counts elements stamped rather than notices found, when notices nest", async () => {
    const html = advPaper(
      `<div class="${ADV_AMENDMENT}"><h2>ADV-NOTICE-HEADING</h2>
         <div class="${ADV_AMENDMENT}"><h3>One</h3>${ADV_CITATION}</div>
         <div class="${ADV_AMENDMENT}"><h3>Two</h3>${ADV_CITATION}</div>
       </div>`,
    );
    const through = await advCard(html);

    /**
     * **The oracle is computed a different way**, which is the only reason this
     * test can see a lying count at all: the number under test comes back from
     * the pipeline, and the number it is compared against is read off the DOM
     * by asking how many elements actually carry the token. Reading `kept`
     * twice would agree with itself.
     */
    const d = dom(html);
    const direct = protectAuthoredStructure(d);
    const actuallyStamped = d.querySelectorAll(`.${KEEP_CONTENT}`).length;
    expect(actuallyStamped).toBe(4);
    /* Which four: the two inner notices and their two citations. The outer div
       is declined for having no citation child of its own. */
    expect(d.querySelectorAll(`div.amendment-citation.${KEEP_CONTENT}`)).toHaveLength(2);
    expect(direct).toEqual({ [RULES.correctionNotice]: actuallyStamped });
    expect(through.kept).toEqual({ [RULES.correctionNotice]: actuallyStamped });
    /* Nothing was paid for it: all four paragraphs are still there. */
    expect(through.prose).toBe(4);
  });

  /**
   * **Flipped on 2026-09-08, and the flip is the finding.** This used to assert
   * that a notice whose citation sits inside an unrelated `<aside>` *is*
   * stamped, on the reasoning that narrowing to a direct child would decline a
   * publisher who wraps the citation one div deeper, and that no construction
   * here made the width cost anything.
   *
   * GPT Sol named what that was: a deferral wearing a test. PLOS writes
   * `div.amendment-citation` as a **direct child**
   * (evals/extraction/fixtures/plos_biology.html), that is the only topology
   * anybody has measured, and a `positive` token can displace an author's prose
   * from anywhere on the page — so *"three constructions did not break it"* is
   * not evidence for stamping a shape nobody has seen. The rule is now
   * `:scope > div.amendment-citation`, and the wrapped shape is declined.
   *
   * **What would widen it again**: a real publisher fixture whose citation is
   * one div deeper, with treatment and control measured on it the way the
   * topologies below are. Then this case flips back and takes an adversarial
   * one with it.
   */
  it("declines a notice whose citation is buried in an unrelated descendant", async () => {
    const buried = await advCard(
      advPaper(
        `<div class="${ADV_AMENDMENT}"><h2>ADV-NOTICE-HEADING</h2>
           <aside class="unrelated"><h3>Elsewhere</h3>${ADV_CITATION}</aside></div>`,
      ),
    );
    expect(buried.kept).toEqual({});
    /* Not a green tick about nothing: the same notice with the citation as a
       direct child is stamped, on the same page. */
    const direct = await advCard(
      advPaper(`<div class="${ADV_AMENDMENT}"><h2>ADV-NOTICE-HEADING</h2>${ADV_CITATION}</div>`),
    );
    expect(direct.kept).toEqual({ [RULES.correctionNotice]: 2 });
    expect(buried.prose).toBe(4);
  });

  /**
   * Three shapes built to make rule B's 25 points cost an author a paragraph,
   * none of which did. The builder's own boundary case puts the notice among
   * four sibling paragraphs; these take away the shared parent those paragraphs
   * score into, make the article short, and make it linky — the three things
   * that ought to let a positive-weighted sibling win. Kept as pinned
   * negatives: they are the cases somebody would otherwise have to think of
   * again.
   */
  it("does not cost a paragraph when the notice is given every advantage", async () => {
    const notice = `<div class="${ADV_AMENDMENT}"><h2>ADV-NOTICE-HEADING</h2>${ADV_CITATION}
      <p>The correction restated the endpoint and the committee accepted it in full, without comment.</p></div>`;
    /* Each paragraph in its own wrapper, so no container accumulates their score. */
    const scattered = `<!doctype html><html><head><title>t</title></head><body><div class="article-content">
<h1>t</h1>${notice}${[1, 2, 3, 4].map((n) => `<div class="sect"><h2>§${n}</h2>${ADV_P(n)}</div>`).join("")}
</div></body></html>`;
    /* Linky prose, which is what `_cleanConditionally` punishes. */
    const linky = `<!doctype html><html><head><title>t</title></head><body><div class="article-content">
<h1>t</h1>${notice}${[1, 2, 3, 4]
      .map(
        (n) =>
          `<div class="sect"><p>ADV-PROSE-${n}. See <a href="/a${n}">the registry entry for this trial</a> and ` +
          `<a href="/b${n}">the protocol as published in April that year</a> for the endpoint history, which ` +
          `the paper itself does not give and which the committee has been reconstructing from the minutes ` +
          `of meetings that were themselves reconstructed after the clerk retired in March.</p></div>`,
      )
      .join("")}</div></body></html>`;
    /* The notice last rather than first, so it is not simply the first thing. */
    const trailing = `<!doctype html><html><head><title>t</title></head><body><div class="article-content">
<h1>t</h1>${ADV_P(1)}${ADV_P(2)}${ADV_P(3)}${ADV_P(4)}${notice}</div></body></html>`;

    for (const [name, html] of [
      ["scattered", scattered],
      ["linky", linky],
      ["trailing", trailing],
    ] as const) {
      const card = await advCard(html);
      expect(card.kept, name).toEqual({ [RULES.correctionNotice]: 2 });
      expect(card.prose, name).toBe(4);
    }
  });
});

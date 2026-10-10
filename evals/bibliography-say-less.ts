/**
 * **What does a Citations row say about a work, and where did each word come
 * from?** Plan 261003j, Greg's report spya-zmdb7y: the row should say no more
 * about a paper than the article's bibliography supports.
 *
 * Free and deterministic: it reads stored lists, calls no model. For every
 * stored list among the slugs given (or every local article that has one) it
 * counts, per row:
 *
 *  - the words of `why` — a sentence the model wrote, the only words on a
 *    default row that are neither the article's nor a registry's;
 *  - how many of `why`'s content words are nowhere in the paragraphs that cite
 *    the work — a lexical proxy for "it adds something", and only a proxy: a
 *    paraphrase scores high here while adding nothing, so read the rows too;
 *  - whether the words of the title, the authors and the year are anywhere in
 *    the article's text or the row's stored entry. A lexical flag, not an
 *    attribution check: it pools the whole article, so it catches a name the
 *    article never says and cannot see a name given to the wrong work. Every
 *    flag is listed under its article to be read by hand.
 *
 *   npx tsx evals/bibliography-say-less.ts [slug …] [--rows=N]
 */
import { loadEnvLocal } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import type { CitedWork } from "../src/types.js";
import type { Block } from "../src/types.js";
import { capEntry } from "../src/citation-entry.js";
import type { NumberedReferenceList } from "../src/citation-reference-list.js";
import { emptyDrops, noScoreDrops, toDrafts } from "../src/bibliography.js";

/** Replay the actual draft reader, including HTML entries and the PDF list. */
export function replayGuard(works: readonly CitedWork[], blocks: readonly Block[], list: NumberedReferenceList | null) {
  const drops = emptyDrops();
  const raw = works.map((w) => {
    const entries = w.entry && list
      ? [...list.entries].filter(([, entry]) => capEntry(entry) === w.entry)
      : [];
    return {
      title: w.title,
      authors: w.authors,
      year: w.year,
      why: w.why,
      reference: w.reference ? { block: w.reference.blockId, quote: w.reference.quote } : undefined,
      mentions: w.mentions.map((m) => ({ block: m.blockId, quote: m.quote })),
      ...(entries.length === 1 ? { entry: entries[0]![0] } : {}),
    };
  });
  const kept = toDrafts(raw, blocks, drops, noScoreDrops(), list);
  /* A missing row is a failed replay, not evidence its metadata was grounded. */
  if (kept.length !== works.length) throw new Error(`Guard replay anchored ${kept.length} of ${works.length} stored rows`);
  return { drops, kept };
}

const STOP = new Set(
  "a an and are as at be by for from has have in is it its of on or that the their this to was were which with not but than into about over how what who when where why can may more most also such these those been being they them he she we our you your".split(
    " ",
  ),
);

/** Lower-cased words, accents and punctuation folded away. */
export function wordsOf(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

function contentWords(text: string): string[] {
  return wordsOf(text).filter((w) => w.length > 2 && !STOP.has(w));
}

/** The share of `words` that are in `pool`; 1 for no words. */
export function shareIn(words: readonly string[], pool: ReadonlySet<string>): number {
  if (words.length === 0) return 1;
  return words.filter((w) => pool.has(w)).length / words.length;
}

export interface RowMeasure {
  id: string;
  whyWords: number;
  /** `why`'s content words absent from every citing paragraph, as a share. */
  whyNovel: number;
  /** Title words found in the article's text or the row's entry. */
  titleGrounded: number;
  authorsGrounded: number;
  yearGrounded: boolean | null;
}

export function measureRow(work: CitedWork, blocks: ReadonlyMap<string, Block>, articleWords: ReadonlySet<string>): RowMeasure {
  const citing = new Set<string>();
  const ids = new Set<string>([work.firstCited, ...(work.citedAt ?? [])]);
  if (work.reference) ids.add(work.reference.blockId);
  for (const m of work.mentions ?? []) ids.add(m.blockId);
  for (const id of ids) for (const w of wordsOf(blocks.get(id)?.text ?? "")) citing.add(w);

  const grounded = new Set(articleWords);
  for (const w of wordsOf(work.entry ?? "")) grounded.add(w);

  const why = contentWords(work.why);
  const authors = wordsOf(work.authors ?? "").filter((w) => w !== "et" && w !== "al");
  const year = work.year ? wordsOf(work.year) : null;
  return {
    id: work.id,
    whyWords: wordsOf(work.why).length,
    whyNovel: 1 - shareIn(why, citing),
    titleGrounded: shareIn(wordsOf(work.title), grounded),
    authorsGrounded: shareIn(authors, grounded),
    yearGrounded: year === null ? null : year.every((w) => grounded.has(w) || grounded.has(w.replace(/[a-z]$/, ""))),
  };
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
  const store = await import("../src/store/index.js");
  const { closeDb } = await import("../src/db/client.js");
  const { BibliographyListNotFound } = await import("../src/store/bibliography-list-not-found.js");
  const args = process.argv.slice(2);
  const rows = Number(args.find((a) => a.startsWith("--rows="))?.slice(7) ?? 0);
  let slugs = args.filter((a) => !a.startsWith("--"));

  await runAsOwner(environmentOwnerId(), async () => {
    if (slugs.length === 0) slugs = (await store.listArticles()).map((a) => a.slug);
    console.log("slug\tworks\twhy words/row\twhy words total\twhy novel\ttitle<1\tauthors<1\tyear not in article\tguard drops authors\tguard drops year");
    let lists = 0;
    for (const slug of slugs) {
      /* Only "no list was made" is skipped: a failed read is not an empty
         corpus, and must not print as one (GPT Sol's plan review, P5). */
      let found: Awaited<ReturnType<typeof store.loadBibliography>>;
      try {
        found = await store.loadBibliography(slug);
      } catch (err) {
        if (err instanceof BibliographyListNotFound) continue;
        throw err;
      }
      const works = found.bibliography.citations;
      if (works.length === 0) continue;
      lists++;
      const { blocks, meta } = await store.loadArticle(slug);
      let referenceList: NumberedReferenceList | null = null;
      if (meta?.source === "pdf") {
        const source = await store.loadSource(slug);
        if (source === null || source.kind !== "pdf") throw new Error(`Cannot replay PDF bibliography for ${slug}`);
        const { pass0, pageLines } = await import("../src/pdf.js");
        const { MAX_PAGES } = await import("../src/uploads.js");
        const { referenceListFrom } = await import("../src/citation-reference-list.js");
        const pass = await pass0(source.bytes, { maxPages: MAX_PAGES });
        if (!pass.isScan) referenceList = referenceListFrom(pass.pages.flatMap((p) => pageLines(pass, p.page)));
      }
      const byId = new Map(blocks.map((b) => [b.id as string, b]));
      const articleWords = new Set(blocks.flatMap((b) => wordsOf(b.text)));
      const measured = works.map((w) => measureRow(w, byId, articleWords));
      /* What the same extracted rows would keep today. A fresh model run may
         extract different fields; this is a replay, not a prediction of it. */
      const { drops, kept } = replayGuard(works, blocks, referenceList);
      const dropped: string[] = [];
      for (const [i, w] of works.entries()) {
        if (w.authors && !kept[i]!.authors) dropped.push(`authors "${w.authors}" — ${w.title}`);
        if (w.year && !kept[i]!.year) dropped.push(`year "${w.year}" — ${w.title}`);
      }
      console.log(
        [
          slug,
          works.length,
          mean(measured.map((m) => m.whyWords)).toFixed(1),
          measured.reduce((a, m) => a + m.whyWords, 0),
          mean(measured.map((m) => m.whyNovel)).toFixed(2),
          measured.filter((m) => m.titleGrounded < 1).length,
          measured.filter((m) => m.authorsGrounded < 1).length,
          measured.filter((m) => m.yearGrounded === false).length,
          drops.authorsUnfound,
          drops.yearUnfound,
        ].join("\t"),
      );
      for (const d of dropped) console.log(`  - the guard would drop ${d}`);
      for (const w of works.slice(0, rows)) {
        const m = measured.find((x) => x.id === w.id);
        console.log(`  · ${w.title} — ${w.authors ?? ""} ${w.year ?? ""}\n    why: ${w.why}\n    novel ${m?.whyNovel.toFixed(2)} title ${m?.titleGrounded.toFixed(2)} authors ${m?.authorsGrounded.toFixed(2)} year ${m?.yearGrounded}`);
      }
      for (const m of measured.filter((x) => x.titleGrounded < 1 || x.authorsGrounded < 1 || x.yearGrounded === false)) {
        const w = works.find((x) => x.id === m.id);
        console.log(`  ! ${w?.title} | ${w?.authors ?? ""} | ${w?.year ?? ""} — title ${m.titleGrounded.toFixed(2)} authors ${m.authorsGrounded.toFixed(2)} year ${m.yearGrounded}`);
      }
    }
    if (lists === 0) console.log("(no stored citations list among these articles)");
  });
  await closeDb();
}

if (isMain(import.meta.url)) await main();

/**
 * **What does stage 2 + stage 3 actually do to this URL?** — one page in, one
 * row of numbers out, no model and no money.
 *
 *   npx tsx evals/extraction/probe.mts <url> [<url> …]
 *   npx tsx evals/extraction/probe.mts --file evals/extraction/fixtures/pg_greatwork.html --url https://…
 *   npx tsx evals/extraction/probe.mts --json out.json <url> …
 *
 * This exists because the corpus runner
 * ([corpus.mts](corpus.mts)) answers "did un-hiding change anything" across the
 * committed fixtures, and the question in front of us is different: **is this
 * candidate page worth committing as a fixture at all?** Fetching, extracting
 * and eyeballing is what a person does by hand a dozen times and gets subtly
 * wrong on the eleventh.
 *
 * ## The three numbers, and why the third is new
 *
 * 1. **Recall** — `droppedChars`, from [inventory.mts](inventory.mts)'s
 *    `compare()`. What Readability left behind. This is the failure the
 *    repair-pass plan started on and it turned out to be the rarer one.
 * 2. **Structure** — kept-over-present per tag, also from `compare()`. The
 *    plan's headline finding: 13 of 15 fixtures lose 10%+ of some structural
 *    element, and the prose around a discarded formula reads perfectly, so
 *    nothing else notices.
 * 3. **Shatter** — and this one is not in the corpus runner at all. It runs the
 *    **real stage-3 splitter** over the extracted HTML and counts blocks that
 *    carry almost no text but are marked `gistable`, i.e. blocks the ToC, the
 *    summaries and the granularity-zoom tree will treat as content.
 *
 * The third was added on 2026-08-30 because Paul Graham's *How to Do Great
 * Work* — a page already on the shelf, and one the corpus scores as losing
 * **nothing** — produces **328 blocks of which 87 are gistable and hold six
 * characters or fewer**: `[1]`…`[29]` footnote markers promoted to top-level
 * blocks, `<p>` holding a bare `[`, `<a>` holding a bare number. Recall says the
 * page is perfect. Structure says the page is perfect. The reader gets an
 * eighty-seven-item table of contents of punctuation.
 *
 * (An earlier draft of this comment said 330 and 88, from `data/greatwork/
 * blocks.json` — a *different* artefact, written by the full pipeline including
 * the sanitiser. Quoting one number and running another is how a comment starts
 * disagreeing with the code beneath it; these are this file's own.)
 *
 * So a page can pass both existing measures and still arrive broken, which is
 * the whole reason to measure a third thing.
 *
 * ## What it does not do
 *
 * It does not fetch the way [src/fetch.ts](../../src/fetch.ts) does — plain
 * `fetch`, browser-ish User-Agent, follow redirects, **no JavaScript**. That is
 * deliberate and it matches how the fixtures were captured
 * ([fixtures/README.md](fixtures/README.md)): what is measured has to be what
 * stage 2 is really handed. A page whose text only appears after hydration is
 * stage 1's problem and this script will report it, honestly, as a page with
 * almost no text.
 *
 * It also does not judge. Every number here is an anomaly signal — see
 * [the plan](../../docs/plans/readability-repair-pass.md#what-the-ratio-is-and-is-not)
 * on why extracted-over-raw is not a quality score.
 */
import { readArticle } from "../../src/extract.js";
import { writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { compare, STRUCTURE } from "./inventory.mjs";
import { FIXTURE_UA } from "./corpus.mjs";
import { splitIntoBlocks } from "../../src/blocks.js";
import { isMain } from "../../src/is-main.js";

/** The fixtures' own User-Agent, so a probe of a live URL and the committed
 *  capture of it are the same document. See FIXTURE_UA in corpus.mts. */
const UA = FIXTURE_UA;

/**
 * A block this short is not a passage a reader takes in as one thing. Six
 * characters admits `[12]`, `[`, `25`, `¶`, `→` and excludes anything that
 * could be a real sentence. Blocks marked non-gistable (media) are excluded
 * before the count — an `<img>` legitimately has no text.
 */
const SHATTER_CHARS = 6;

/**
 * **The count above is two different things and the first run of it proved so.**
 * Across the sixteen fixtures a ≤6-character gistable block catches `[1]`, `¶`,
 * `▲`, `—`, `[` and a bare `25` — all junk — and also `h2:"Code"`,
 * `h3:"Text"`, `h2:"Syntax"` and `dt:"Normal"`, which are a real heading and a
 * real definition term. Reporting one number would have called Tufte CSS's own
 * section headings a defect.
 *
 * So the split, and it is deliberately drawn where certainty is:
 *
 * - **`markerBlocks`** — no letter anywhere in the text. `[1]`, `¶`, `[`, `25`,
 *   `▲`, `—`, `{1}`. Nothing that contains no letter is prose a reader takes in
 *   as one thing, so this number needs no judgement and is the one to trust.
 * - **`tinyBlocks`** — ≤6 characters, has a letter, and is **not** a heading.
 *   `http`, `[edit]`, `{v}`, `dt:"Age"`. Suspicious, not certain: a definition
 *   list's term is legitimately two characters long. Read the examples.
 *
 * Headings are excluded from the second because a short heading is the normal
 * case, not the broken one. `[edit]` survives the exclusion because Wikipedia's
 * section-edit links land as `<p>`, not as headings — which is exactly the
 * defect, nineteen times on one page.
 */
const hasLetter = (s: string): boolean => /\p{L}/u.test(s);

export interface Probe {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
  rawBytes: number;
  title: string | null;
  rawTextChars: number;
  articleTextChars: number;
  ratio: number;
  droppedChars: number;
  droppedBlocks: number;
  /** The single longest run of consecutive dropped blocks — where truncation shows. */
  biggestGap: { blocks: number; chars: number; snippet: string } | null;
  /** Only the tags the page actually has, and only where under 90% survived. */
  structureLosses: { tag: string; kept: number; present: number }[];
  blocks: number;
  shatteredBlocks: number;
  shatterExamples: string[];
  /** Of the shattered ones, those with no letter at all — junk beyond argument. */
  markerBlocks: number;
  markerExamples: string[];
  /** Short, has a letter, is not a heading. Suspicious; read the examples. */
  tinyBlocks: number;
  tinyExamples: string[];
  /** Longest single block. A whole essay in one block is the opposite failure. */
  longestBlockChars: number;
  /**
   * **Would stage 2 publish this at all?** — the capability floor's verdict, in
   * characters, or `null` where it does not fire.
   *
   * A probe is how a page is sized up before anybody adds it to the corpus or to
   * the shelf, and every number above describes what Readability produced.
   * Without this line those numbers read as a working extraction on a page the
   * pipeline refuses: `medium_about.html` probes as eleven blocks of successful
   * output. GPT Sol, reviewing C1a. src/extract.ts § `capabilityFloor`.
   */
  refusedAtChars: number | null;
}

/**
 * Stage 2, through `readArticle` in [src/extract.ts](../../src/extract.ts) —
 * **the production transform itself, not a re-derivation of it.**
 *
 * This used to be four lines here doing `unhide → Readability`, and the missing
 * `canonicaliseNotes` made `acx_footnotes.html` report 18 stranded footnote
 * markers that the real pipeline does not produce. The function is shared now so
 * the two cannot drift again.
 *
 * No sanitising: the splitter does its own, and the question here is what
 * Readability did, not what our policy then removes.
 */
function extract(
  rawHtml: string,
  url: string,
): { html: string; title: string | null; refusedAtChars: number | null } {
  const { article, refusal } = readArticle(rawHtml, url);
  /* The extraction is still measured in full — the numbers are what a probe is
     for, and on a refused page they are the interesting ones. Only the verdict
     is added beside them. */
  return {
    html: article?.content ?? "",
    title: article?.title ?? null,
    refusedAtChars: refusal?.chars ?? null,
  };
}

export function probeHtml(rawHtml: string, url: string): Probe {
  const { html, title, refusedAtChars } = extract(rawHtml, url);
  const cmp = compare(rawHtml, html, url);

  const structureLosses = STRUCTURE.map((tag) => ({
    tag,
    ...(cmp.structure[tag] ?? { present: 0, kept: 0 }),
  }))
    .filter((s) => s.present > 0 && s.kept / s.present < 0.9)
    .map((s) => ({ tag: s.tag, kept: s.kept, present: s.present }));

  /* The real splitter, not a re-implementation of it. If stage 3 changes how it
     promotes an inline span to a block, this number has to move with it. */
  /* **No `try`/`catch` here, and there used to be one.** It turned any splitter
     exception into zero blocks, zero markers, zero tiny — a page that reads as
     flawless on every count this script reports. A broken splitter looking
     perfectly clean is the exact shape docs/reusable/silent-success.md is about,
     and the instrument had it built in. A page Readability declined returns an
     empty string, which splits to an empty list honestly; a page that throws is
     a failure and now says so. */
  const blocks = splitIntoBlocks(html).blocks;
  const shattered = blocks.filter(
    (b) => b.gistable && b.text.trim().length <= SHATTER_CHARS,
  );
  const markers = shattered.filter((b) => !hasLetter(b.text));
  const tiny = shattered.filter((b) => hasLetter(b.text) && b.kind !== "heading");
  const show = (bs: typeof blocks, n: number): string[] =>
    bs.slice(0, n).map((b) => `${b.tag}:${JSON.stringify(b.text.trim())}`);

  const gap = cmp.gaps[0];
  return {
    url,
    ok: true,
    rawBytes: Buffer.byteLength(rawHtml),
    title,
    rawTextChars: cmp.rawTextChars,
    articleTextChars: cmp.articleTextChars,
    ratio: cmp.ratio,
    droppedChars: cmp.totals.droppedChars,
    droppedBlocks: cmp.totals.dropped,
    biggestGap: gap
      ? { blocks: gap.blocks, chars: gap.chars, snippet: gap.snippet.slice(0, 90) }
      : null,
    structureLosses,
    blocks: blocks.length,
    shatteredBlocks: shattered.length,
    shatterExamples: show(shattered, 8),
    markerBlocks: markers.length,
    markerExamples: show(markers, 6),
    tinyBlocks: tiny.length,
    tinyExamples: show(tiny, 6),
    longestBlockChars: blocks.reduce((m, b) => Math.max(m, b.text.length), 0),
    refusedAtChars,
  };
}

export async function probeUrl(url: string): Promise<Probe> {
  const blank: Probe = {
    url, ok: false, rawBytes: 0, title: null, rawTextChars: 0, articleTextChars: 0,
    ratio: 0, droppedChars: 0, droppedBlocks: 0, biggestGap: null, structureLosses: [],
    blocks: 0, shatteredBlocks: 0, shatterExamples: [], markerBlocks: 0, markerExamples: [],
    refusedAtChars: null,
    tinyBlocks: 0, tinyExamples: [], longestBlockChars: 0,
  };
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  } catch (err) {
    return { ...blank, error: (err as Error).message.slice(0, 120) };
  }
  if (!res.ok) return { ...blank, status: res.status, error: `HTTP ${res.status}` };
  const html = await res.text();
  /* res.url, not the argument: a redirect changes what relative links resolve
     against, and the fixture is whatever we actually got. */
  return { ...probeHtml(html, res.url), status: res.status };
}

function line(p: Probe): string {
  if (!p.ok) return `  ✗ ${p.url}\n      ${p.error}`;
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
  const parts = [
    `  ${p.url}`,
    `      ${p.title ?? "(no title)"}`,
    `      raw ${p.rawBytes.toLocaleString()} B · text ${p.rawTextChars.toLocaleString()} → ` +
      `${p.articleTextChars.toLocaleString()} ch (ratio ${p.ratio.toFixed(3)})`,
    `      dropped ${p.droppedBlocks} blocks / ${p.droppedChars.toLocaleString()} ch` +
      (p.biggestGap
        ? `  · biggest gap ${p.biggestGap.blocks} blocks, ${p.biggestGap.chars.toLocaleString()} ch: ${JSON.stringify(p.biggestGap.snippet)}`
        : ""),
  ];
  if (p.refusedAtChars !== null) {
    /* Above the rest, because it changes what every number under it means: this
       page produces no article at all. */
    parts.push(
      `      STAGE 2 REFUSES THIS PAGE — ${p.refusedAtChars} characters of article text, under ` +
        "the floor, so nothing below would ever reach a reader",
    );
  }
  parts.push(
    /* **The numbers are KEPT, and the label used to say "lost".** `h2 0/6 (0%)`
       means zero of the page's six h2s survived, which is total loss — and on
       2026-09-07 a careful reader took that same line to mean "zero lost of
       six", concluded every heading survived, and recommended deleting a true
       claim from docs/project/content-extraction.md on the strength of it. The
       instrument was right and read as its own opposite, which is a defect in
       the instrument. Spell the direction out at every number; the width is
       cheap and being misread is not. */
    p.structureLosses.length
      ? `      structure: ` +
        p.structureLosses
          .map((s) => `${s.tag} ${s.kept} of ${s.present} kept (${pct(s.kept, s.present)})`)
          .join(", ")
      : `      structure: every tag over 90% kept`,
  );
  parts.push(
    `      blocks ${p.blocks} · longest ${p.longestBlockChars.toLocaleString()} ch` +
      `\n      markers ${p.markerBlocks}` +
      (p.markerBlocks ? ` — ${p.markerExamples.join(" ")}` : "") +
      `\n      tiny ${p.tinyBlocks}` +
      (p.tinyBlocks ? ` — ${p.tinyExamples.join(" ")}` : ""),
  );
  return parts.join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let jsonOut: string | null = null;
  const urls: string[] = [];
  let fileArg: string | null = null;
  let urlArg: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--json") jsonOut = argv[++i] ?? null;
    else if (a === "--file") fileArg = argv[++i] ?? null;
    else if (a === "--url") urlArg = argv[++i] ?? null;
    else urls.push(a);
  }

  const out: Probe[] = [];
  if (fileArg) {
    const html = await readFile(fileArg, "utf8");
    out.push(probeHtml(html, urlArg ?? "https://example.com/"));
  }
  for (const u of urls) out.push(await probeUrl(u));

  if (!out.length) {
    console.log("usage: npx tsx evals/extraction/probe.mts <url> …  |  --file <html> [--url <url>]");
    process.exitCode = 1;
    return;
  }
  for (const p of out) console.log(line(p) + "\n");
  if (jsonOut) {
    await writeFile(jsonOut, JSON.stringify(out, null, 2));
    console.log(`wrote ${jsonOut}`);
  }
}

if (isMain(import.meta.url)) void main();

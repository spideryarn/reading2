/**
 * **Does a PDF's article get its own title, or the journal's?** — and does the
 * pass that fixes that eat any of the article on the way?
 *
 *   npx tsx evals/pdf/titles.mts transcribe [--samples=3] [--only=slug,slug]
 *   npx tsx evals/pdf/titles.mts score [--arms=incumbent,ladder,tidy,overdelete]
 *
 * Written for docs/plans/260905b-pdf-front-matter-and-the-title-it-stole.md,
 * after a 142-page Elsevier paper was ingested as *"Progress in Biophysics and
 * Molecular Biology"*.
 *
 * ## Why it is two commands
 *
 * **The transcription is bought once and every arm runs over it.** A three-page
 * fixture costs about $0.017 and takes a minute; the arms are then offline
 * arithmetic apart from `tidy`'s own small call, which is cached too. Paying per
 * arm would also mean comparing arms that read *different* transcriptions — and
 * the fault being measured is model variance on a genuinely ambiguous line, so
 * two arms that disagree because they were handed different records tell you
 * nothing about either.
 *
 * That is also why `--samples` defaults to more than one. Re-running the
 * extractor on the first three pages of the reported document produced the
 * **right** title, first try. A fix checked against one sample of a stochastic
 * process has not been checked. Three is what the budget buys and it is still
 * only a smoke test: at a true success rate of 0.5, three perfect runs happen
 * 12.5% of the time (GPT Sol, 2026-09-05). **The document is the unit**, not the
 * run — 54 runs over 18 documents are not 54 observations — so the report leads
 * with per-document rates.
 *
 * ## Why it scores in two directions
 *
 * The obvious score — *right title, and fewer publisher lines rendered* — is
 * maximised by an arm that hides **everything** on the front pages. Nothing
 * existing would catch that: `src/pdf-score.ts` counts every record whether it
 * renders or not, so an abstract retyped as hidden keeps recall at 1.0.
 *
 * So each fixture carries `mustKeep` as well as `furniture`, and the report
 * gives retention beside removal. And there is an `overdelete` arm that sets
 * every record aside: **the eval must fail it**. An eval that cannot fail a
 * deliberately broken arm is not measuring what it claims to
 * (docs/reusable/silent-success.md).
 *
 * ## Why the fixtures are three pages, and why that is not enough on its own
 *
 * `FURNITURE_PAGES = 3` in src/pdf.ts: a line has to appear on three or more
 * pages of *the document supplied* before pass 0 calls it a running header. A
 * one-page fixture has an empty furniture set and exercises a different code
 * path from the one that failed in production.
 *
 * But a three-page cut is not a small copy of the document either. A header on
 * pages 1, 4 and 5 is furniture in the real PDF and absent from the cut's set,
 * and cutting can drop the info-dictionary `Title`, which is rung 1 of the
 * ladder. So every fixture keeps `pass0-full.json` — the **full document's**
 * `metaTitle` and furniture — and the arms reason with that while the model sees
 * only three pages.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageCli } from "../../src/cli-ledger.js";
import { PDF_READER_MODEL } from "../../src/models.js";
import {
  assemble,
  type FrontMatterAnswer,
  frontMatterWindow,
  openRouterFrontMatterReader,
  promptFor,
  withFrontMatterHidden,
} from "../../src/pdf-frontmatter.js";
import {
  openRouterReader,
  promptFingerprint,
  runPdfExtract,
  titleFrom,
} from "../../src/pdf-read.js";
import { foldLine, type Pass0, pass0, type PdfRecord, RENDERED } from "../../src/pdf.js";
import { nullCheckpointStore } from "../../src/store/checkpoints.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, "titles");

/** One fixture, as `titles/expected.json` declares it. */
export interface Fixture {
  slug: string;
  /** The gold: the article's real title, as printed. */
  title: string;
  /** The authors as printed, or null where the document names none. */
  byline?: string | null;
  /** What this one is chosen to break. */
  breaks: string;
  /** The strings a naive extractor is likely to take instead — the must-drop half. */
  furniture: string[];
  /** Short verbatim snippets that MUST survive into the reading view — the must-keep half. */
  mustKeep?: string[];
  pages: number;
  sourcePages?: number;
  metaTitle?: string | null;
  hasTextLayer?: boolean;
  notes?: string;
}

/** The full document's own facts, measured before it was cut. */
interface Pass0Full {
  metaTitle: string | null;
  furniture: string[];
  isScan: boolean;
  pages: number;
  sha256?: string;
}

/** What one paid transcription leaves behind, so the arms need never buy another. */
interface Sample {
  slug: string;
  sample: number;
  /** Which prompt wrote it. A prompt change is a different bank of records. */
  prompt: string;
  model: string;
  at: string;
  transcript: PdfRecord[];
  /** What the shipped ladder made of it at the time it was bought. */
  shippedTitle: string;
  recall: number | null;
  quality: string[];
  usage: { input: number; output: number };
}

// ─────────────────────────────────────────────────────────────── the corpus

export async function readFixtures(only?: string[]): Promise<Fixture[]> {
  const manifest = path.join(CORPUS, "expected.json");
  if (!existsSync(manifest)) {
    throw new Error(
      `No corpus at ${manifest}. See docs/plans/260905b-pdf-front-matter-and-the-title-it-stole.md.`,
    );
  }
  const parsed = JSON.parse(await readFile(manifest, "utf8")) as { fixtures: Fixture[] };
  if (!only?.length) return parsed.fixtures;
  const wanted = new Set(only);
  const found = parsed.fixtures.filter((f) => wanted.has(f.slug));
  const missing = [...wanted].filter((s) => !found.some((f) => f.slug === s));
  if (missing.length) throw new Error(`no such fixture: ${missing.join(", ")}`);
  return found;
}

const sourceOf = (slug: string) => path.join(CORPUS, slug, "source.pdf");
const sampleAt = (slug: string, prompt: string, n: number) =>
  path.join(CORPUS, slug, `records-${prompt}-${n}.json`);
const tidyAt = (slug: string, prompt: string, n: number, reader: string) =>
  path.join(CORPUS, slug, `tidy-${prompt}-${reader.replace(/[^a-z0-9]+/gi, "-")}-${n}.json`);

/**
 * The `Pass0` the arms reason with: the **cut's** pages and text, because that is
 * what the model was shown, but the **full document's** `metaTitle` and
 * furniture, because those are facts about the document a reader uploaded.
 *
 * A fixture with no `pass0-full.json` gets the cut's own, and the report says so
 * rather than letting the two kinds of fixture look alike.
 */
async function passFor(fixture: Fixture): Promise<{ pass: Pass0; whole: boolean }> {
  const cut = await pass0(sourceOf(fixture.slug));
  const at = path.join(CORPUS, fixture.slug, "pass0-full.json");
  if (!existsSync(at)) return { pass: cut, whole: false };
  const full = JSON.parse(await readFile(at, "utf8")) as Pass0Full;
  return {
    pass: {
      ...cut,
      metaTitle: full.metaTitle,
      furniture: new Set(full.furniture.map(foldLine)),
    },
    whole: true,
  };
}

// ──────────────────────────────────────────────────────── buying the records

/**
 * Transcribe each fixture `samples` times and keep the records.
 *
 * **`nullCheckpointStore` and `frontMatter: null`, both on purpose.** A
 * checkpoint would hand sample 2 sample 1's answer, and the whole point of a
 * second sample is that the model may say something different. And the bank is
 * always bought with the tidy pass off, so `tidy` can be an *arm* over the same
 * records rather than a second transcription nothing can be compared with.
 */
export async function transcribe(fixtures: Fixture[], samples: number): Promise<void> {
  const prompt = promptFingerprint();
  const tokens = { input: 0, output: 0 };
  for (const fixture of fixtures) {
    for (let n = 1; n <= samples; n++) {
      const out = sampleAt(fixture.slug, prompt, n);
      if (existsSync(out)) {
        console.log(`  ·    ${fixture.slug} #${n} — already bought`);
        continue;
      }
      const started = Date.now();
      const result = await runPdfExtract({
        slug: `${fixture.slug}-${n}`,
        bytes: new Uint8Array(await readFile(sourceOf(fixture.slug))),
        checkpoints: nullCheckpointStore(),
        reader: openRouterReader(),
        frontMatter: null,
        filename: `${fixture.slug}.pdf`,
      });
      const sample: Sample = {
        slug: fixture.slug,
        sample: n,
        prompt,
        model: PDF_READER_MODEL,
        at: new Date().toISOString(),
        transcript: result.transcript,
        shippedTitle: result.meta.title,
        recall: result.recall,
        quality: result.meta.quality ?? [],
        usage: result.usage,
      };
      tokens.input += result.usage.input;
      tokens.output += result.usage.output;
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(sample, null, 2) + "\n");
      console.log(
        `  ok   ${fixture.slug} #${n} — ${result.transcript.length} records, ` +
          `${Math.round((Date.now() - started) / 1000)}s, ` +
          `${result.usage.input} in / ${result.usage.output} out`,
      );
    }
  }
  /* The money is in `data/_ai-calls.jsonl`, written by the shared ledger — this
     command has no business keeping a second, differently-wrong tally of it. */
  console.log(
    `\nTokens: ${tokens.input} in, ${tokens.output} out. ` +
      `What it cost is in data/_ai-calls.jsonl.`,
  );
}

// ─────────────────────────────────────────────────────────────────── the arms

export interface ArmAnswer {
  title: string;
  byline?: string | null;
  /** Indices into the sample's transcript that this arm keeps out of the reading view. */
  setAside: number[];
}

export type Arm = (sample: Sample, pass: Pass0, fixture: Fixture) => Promise<ArmAnswer>;

/**
 * **The incumbent, frozen here rather than imported** — the counterfactual, the
 * same shape `evals/extraction/corpus.mts` uses for stock Readability. A copy of
 * `titleFrom` as it stood on 2026-09-05 before the furniture rule, and it must
 * **not** be kept in step with src: the number it produces is what everything
 * else is compared against, and an arm that follows the fix measures nothing.
 */
const incumbentLadder: Arm = async (sample, pass) => {
  const looksLikeAFilename = (s: string) =>
    /^(microsoft word|untitled|document\s*\d*|print|layout|final|draft)\b/i.test(s) ||
    /\.(docx?|pdf|indd|pages|tex)$/i.test(s) ||
    !/\s/.test(s);
  if (pass.metaTitle && !looksLikeAFilename(pass.metaTitle)) {
    return { title: pass.metaTitle, setAside: [] };
  }
  const firstPage = pass.pages[0]?.page ?? 1;
  const heading = sample.transcript
    .find((r) => r.page === firstPage && r.type === "heading1" && r.text.trim())
    ?.text.trim();
  if (heading) return { title: heading, setAside: [] };
  const line = pass.pages[0]?.text
    .split("\n")
    .find((l) => l.trim().length > 3 && !pass.furniture.has(foldLine(l)));
  if (line) return { title: line.trim(), setAside: [] };
  return { title: sample.slug, setAside: [] };
};

/** The shipped ladder, whatever it currently is — the furniture rule included. */
const shippedLadder: Arm = async (sample, pass, fixture) => ({
  title: titleFrom(sample.transcript, pass, `${fixture.slug}.pdf`),
  setAside: [],
});

/**
 * The shipped ladder **plus the front-matter pass**, with its answer cached
 * beside the records so re-scoring is free and two scoring runs compare the same
 * decisions rather than two draws from the same model.
 */
const tidyPass: Arm = async (sample, pass, fixture) => {
  const reader = openRouterFrontMatterReader();
  const at = tidyAt(fixture.slug, sample.prompt, sample.sample, reader.id);
  const items = frontMatterWindow(sample.transcript);
  let answer: FrontMatterAnswer;
  if (existsSync(at)) {
    answer = JSON.parse(await readFile(at, "utf8")) as FrontMatterAnswer;
  } else {
    answer = await reader.ask(promptFor(items));
    await writeFile(at, JSON.stringify(answer, null, 2) + "\n");
  }
  try {
    const decision = assemble(items, answer);
    return {
      title: decision.title ?? titleFrom(sample.transcript, pass, `${fixture.slug}.pdf`),
      byline: decision.byline,
      setAside: decision.setAside,
    };
  } catch {
    /* A rejected answer falls back to the ladder over the ORIGINAL records — the
       same thing `runPdfExtract` does, and it has to be, or this arm would be
       measuring a code path production never takes. */
    return { title: titleFrom(sample.transcript, pass, `${fixture.slug}.pdf`), setAside: [] };
  }
};

/**
 * **The arm that has to fail.** It sets every record in the window aside and
 * takes the ladder's title, which is exactly the shape of a tidy pass that has
 * decided the whole first page is the publisher's. If the report gives it a
 * respectable score, the report is wrong and not the arm.
 */
const overdelete: Arm = async (sample, pass, fixture) => ({
  title: titleFrom(sample.transcript, pass, `${fixture.slug}.pdf`),
  setAside: frontMatterWindow(sample.transcript).map((i) => i.index),
});

export const ARMS: Record<string, Arm> = {
  incumbent: incumbentLadder,
  ladder: shippedLadder,
  tidy: tidyPass,
  overdelete,
};

/** Which arms cost money. `score` refuses to run one of these without `--spend`. */
export const PAID_ARMS = new Set(["tidy"]);

// ─────────────────────────────────────────────────────────────── the scoring

/**
 * Fold for comparing two titles — **not** `foldLine`, which strips every digit
 * and every punctuation mark and would call `GPT-4: What changed?` and
 * `GPT-5: What changed?` the same string (GPT Sol, 2026-09-05). This one keeps
 * everything that carries meaning and normalises only what a typesetter chose:
 * the shape of a dash, the shape of a quotation mark, runs of space, and case.
 */
export const foldTitle = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[‐-―−]/gu, "-")
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

/** What a reader would actually see of this arm's output. */
function shownText(transcript: PdfRecord[], setAside: number[]): string {
  return foldTitle(
    withFrontMatterHidden(transcript, setAside)
      .filter((r) => RENDERED.has(r.type))
      .map((r) => r.text)
      .join(" "),
  );
}

export interface Verdict {
  slug: string;
  sample: number;
  arm: string;
  answer: string;
  exact: boolean;
  folded: boolean;
  /** The answer is one of the strings this fixture predicted would be stolen instead. */
  stoleFurniture: boolean;
  /** Of `fixture.furniture`, how many are no longer on the page. */
  dropped: number;
  droppedOf: number;
  /** Of `fixture.mustKeep`, how many survived. The direction that catches over-deletion. */
  kept: number;
  keptOf: number;
  /** The snippets that did not survive, named — a count alone is not actionable. */
  lost: string[];
}

export function judge(fixture: Fixture, sample: Sample, arm: string, answer: ArmAnswer): Verdict {
  const folded = foldTitle(answer.title);
  const shown = shownText(sample.transcript, answer.setAside);
  const mustKeep = fixture.mustKeep ?? [];
  const lost = mustKeep.filter((snippet) => !shown.includes(foldTitle(snippet)));
  return {
    slug: fixture.slug,
    sample: sample.sample,
    arm,
    answer: answer.title,
    exact: answer.title.trim() === fixture.title.trim(),
    folded: folded === foldTitle(fixture.title),
    stoleFurniture: fixture.furniture.some((f) => {
      const ff = foldTitle(f);
      return ff.length > 0 && (folded === ff || folded.startsWith(ff) || ff.startsWith(folded));
    }),
    dropped: fixture.furniture.filter((f) => !shown.includes(foldTitle(f))).length,
    droppedOf: fixture.furniture.length,
    kept: mustKeep.length - lost.length,
    keptOf: mustKeep.length,
    lost,
  };
}

export async function score(
  fixtures: Fixture[],
  armNames: string[],
): Promise<{ verdicts: Verdict[]; partial: string[] }> {
  const prompt = promptFingerprint();
  const verdicts: Verdict[] = [];
  const partial: string[] = [];
  for (const fixture of fixtures) {
    const { pass, whole } = await passFor(fixture);
    if (!whole) partial.push(fixture.slug);
    for (let n = 1; ; n++) {
      const at = sampleAt(fixture.slug, prompt, n);
      if (!existsSync(at)) break;
      const sample = JSON.parse(await readFile(at, "utf8")) as Sample;
      for (const name of armNames) {
        const arm = ARMS[name];
        if (!arm) throw new Error(`no such arm: ${name}. Have: ${Object.keys(ARMS).join(", ")}`);
        verdicts.push(judge(fixture, sample, name, await arm(sample, pass, fixture)));
      }
    }
  }
  return { verdicts, partial };
}

/**
 * The report. **Per document first**, because the document is the unit — an arm
 * that wins three samples on one fixture and loses one on three others has not
 * won.
 */
export function report(fixtures: Fixture[], verdicts: Verdict[], partial: string[]): string {
  const arms = [...new Set(verdicts.map((v) => v.arm))];
  const slugs = [...new Set(verdicts.map((v) => v.slug))];
  const lines: string[] = [];
  const rate = (n: number, of: number) => (of ? `${((100 * n) / of).toFixed(0)}%` : "—");

  lines.push("arm            docs-all-right    samples-right   furniture-dropped     must-keep-kept");
  for (const arm of arms) {
    const mine = verdicts.filter((v) => v.arm === arm);
    const perfect = slugs.filter((slug) => {
      const forSlug = mine.filter((v) => v.slug === slug);
      return forSlug.length > 0 && forSlug.every((v) => v.folded);
    }).length;
    const sum = (k: (v: Verdict) => number) => mine.reduce((n, v) => n + k(v), 0);
    const dropped = sum((v) => v.dropped);
    const droppedOf = sum((v) => v.droppedOf);
    const kept = sum((v) => v.kept);
    const keptOf = sum((v) => v.keptOf);
    lines.push(
      `${arm.padEnd(13)} ${`${perfect}/${slugs.length}`.padStart(7)} ${rate(perfect, slugs.length).padStart(5)}` +
        `   ${rate(mine.filter((v) => v.folded).length, mine.length).padStart(13)}` +
        `   ${`${dropped}/${droppedOf}`.padStart(9)} ${rate(dropped, droppedOf).padStart(5)}` +
        `   ${`${kept}/${keptOf}`.padStart(9)} ${rate(kept, keptOf).padStart(5)}`,
    );
  }

  /* **The attack arm, judged out loud.** A report that merely prints a bad
     number for `overdelete` and leaves the reader to notice is the same shape as
     a check nobody has ever seen fail. */
  if (arms.includes("overdelete")) {
    const attack = verdicts.filter((v) => v.arm === "overdelete");
    const keptOf = attack.reduce((n, v) => n + v.keptOf, 0);
    const kept = attack.reduce((n, v) => n + v.kept, 0);
    lines.push("");
    lines.push(
      keptOf === 0
        ? "ATTACK ARM UNTESTED — no fixture declares `mustKeep`, so over-deletion is invisible here."
        : kept === keptOf
          ? "ATTACK ARM PASSED, WHICH IS A FAILURE — hiding every front record lost nothing. " +
            "The `mustKeep` snippets are not on the front pages; fix the corpus, not the arm."
          : `attack arm correctly fails: it loses ${keptOf - kept} of ${keptOf} must-keep snippets.`,
    );
  }

  if (partial.length) {
    lines.push("");
    lines.push(
      `Reasoned with the CUT's furniture rather than the whole document's on: ${partial.join(", ")} ` +
        `(no pass0-full.json). Their numbers are about a three-page document.`,
    );
  }

  /* Paired transitions, which is the only comparison that isolates one change:
     the same sample, the same records, one thing different. */
  for (const [from, to] of [
    ["incumbent", "ladder"],
    ["ladder", "tidy"],
  ] as [string, string][]) {
    if (!arms.includes(from) || !arms.includes(to)) continue;
    const moved = (better: boolean) =>
      verdicts.filter((v) => {
        if (v.arm !== to) return false;
        const was = verdicts.find((w) => w.arm === from && w.slug === v.slug && w.sample === v.sample);
        return was ? (better ? !was.folded && v.folded : was.folded && !v.folded) : false;
      });
    const won = moved(true);
    const regressed = moved(false);
    lines.push("");
    lines.push(`${from} → ${to}: ${won.length} wrong→right, ${regressed.length} right→wrong`);
    for (const v of regressed) {
      lines.push(`  REGRESSED  ${v.slug} #${v.sample} — now ${JSON.stringify(v.answer.slice(0, 90))}`);
    }
    for (const v of won) lines.push(`  fixed      ${v.slug} #${v.sample}`);
  }

  for (const arm of arms) {
    if (arm === "overdelete") continue;
    const wrong = verdicts.filter((v) => v.arm === arm && !v.folded);
    const eaten = verdicts.filter((v) => v.arm === arm && v.lost.length);
    if (!wrong.length && !eaten.length) continue;
    lines.push("");
    lines.push(`${arm}:`);
    for (const v of wrong) {
      const fixture = fixtures.find((f) => f.slug === v.slug);
      lines.push(`  wrong title  ${v.slug} #${v.sample}`);
      lines.push(`      got:  ${JSON.stringify(v.answer.slice(0, 110))}`);
      lines.push(`      want: ${JSON.stringify((fixture?.title ?? "").slice(0, 110))}`);
    }
    for (const v of eaten) {
      lines.push(`  ATE THE ARTICLE  ${v.slug} #${v.sample}`);
      for (const snippet of v.lost) lines.push(`      lost: ${JSON.stringify(snippet.slice(0, 90))}`);
    }
  }
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────── the CLI

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const fixtures = await readFixtures(flag("only")?.split(",").filter(Boolean));

  if (command === "transcribe") {
    await transcribe(fixtures, Number(flag("samples") ?? 3));
    return;
  }
  if (command === "score") {
    const arms = flag("arms")?.split(",").filter(Boolean) ?? Object.keys(ARMS);
    const paid = arms.filter((a) => PAID_ARMS.has(a));
    if (paid.length && !argv.includes("--spend")) {
      console.error(
        `The ${paid.join(", ")} arm makes a model call for any sample it has not already got an ` +
          `answer for. Add --spend to allow it, or drop it from --arms.`,
      );
      process.exit(1);
    }
    const { verdicts, partial } = await score(fixtures, arms);
    if (!verdicts.length) {
      console.error("No samples on disk. Run `transcribe` first.");
      process.exit(1);
    }
    console.log(report(fixtures, verdicts, partial));
    const out = flag("out");
    if (out) {
      await writeFile(out, JSON.stringify({ at: new Date().toISOString(), verdicts }, null, 2) + "\n");
      console.log(`\nWritten: ${out}`);
    }
    return;
  }
  console.error(
    "Usage:\n" +
      "  npx tsx evals/pdf/titles.mts transcribe [--samples=3] [--only=slug,slug]\n" +
      "  npx tsx evals/pdf/titles.mts score [--arms=incumbent,ladder,tidy,overdelete] [--spend] [--out=file.json]",
  );
  process.exit(1);
}

/**
 * **`stageCli`, not a bare `isMain`** — the entrypoint guard, `loadEnvLocal()`
 * and a spend ledger, in one line.
 *
 * The first draft did call `loadEnvLocal()` by hand and stopped there, and the
 * first real run said so on every chunk: *"a model call was made with no spend
 * collector open — it is in no total"*. That is the exact failure
 * `src/spend-declarations.ts` already records against another eval — a command
 * that spends properly through the seam, is metered properly, and has its row
 * dropped on the floor for want of a collector. Money that is not counted reads
 * as zero, and zero is the one answer that is definitely wrong.
 */
await stageCli(import.meta.url, main);

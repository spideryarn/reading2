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
 * So each fixture carries `mustKeep` as well as `mustNotRender`, and the report
 * gives retention beside removal. And there is an `overdelete` arm that sets
 * every record aside: **the eval must fail it, in every document** — a fixture
 * that loses nothing when its whole front page is hidden is defending nothing,
 * and the report names it. An eval that cannot fail a deliberately broken arm
 * is not measuring what it claims to (docs/reusable/silent-success.md).
 *
 * ## Three golds, three jobs, and why they are three lists
 *
 * `falseTitles` is what an arm may wrongly **choose**; `mustNotRender` is what
 * must not remain **on the page**; `mustKeep` is what must **survive**. One list
 * doing two of those jobs is how the exactly-correct title on
 * `arxiv-lattice-linear-badmeta` scored as stolen furniture, and how the
 * parallel English title on `unal-biotec-bilingual-title` was must-drop and
 * must-keep at once.
 *
 * And **a gold is only a measurement where the transcription put it within
 * reach**. `judge` renders each sample once with nothing set aside and scores
 * only against that: a `mustKeep` snippet already missing there measures the
 * transcription rather than the pass, and a `mustNotRender` string already off
 * the page cannot be removed by anybody. Both are named in the report instead of
 * counted, and the raw retention is printed beside the scored one so the gap
 * cannot be forgotten. All of that is GPT Sol's second review, 2026-09-05.
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
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
  /**
   * The strings a title-picker might wrongly **choose** — scored by
   * `stoleFalseTitle`, and by nothing else.
   *
   * These need not be printed anywhere, and several are not: rung 1 of the
   * ladder reads the PDF's info dictionary, so `arxiv-lattice-linear-badmeta`'s
   * false title is a 500-character metadata run-on that appears in no record,
   * and `copernicus`'s is a running head the transcription never emits. A
   * string here makes no claim about the page.
   */
  falseTitles: string[];
  /**
   * The strings that must not remain **rendered** on the page — scored by
   * `removed`, and by nothing else.
   *
   * **This is a different list from `falseTitles` because it answers a
   * different question**, and one gold doing both jobs is how the exact correct
   * title came to be scored as stolen *and* as dropped on the same verdict
   * (GPT Sol, 2026-09-05). A masthead usually belongs in both lists; a
   * metadata-only string belongs in neither this one nor the page, and the
   * parallel English title on `unal-biotec-bilingual-title` belongs in
   * `falseTitles` and `mustKeep` — it is the article, and dropping it is damage.
   *
   * A string here that the transcription never rendered in the first place is
   * reported as inert rather than counted, per sample: see `judge`.
   */
  mustNotRender: string[];
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

/**
 * Every sample this fixture has on disk, in order.
 *
 * **`readdir` rather than counting up from 1 until a file is missing**, which is
 * what this did and which cannot tell *"nobody has bought this fixture"* from
 * *"the corpus is ten fixtures"*: the loop stopped at the first gap, recorded
 * nothing, and the report then took its document denominator from whatever had
 * produced a verdict. A checkout with five fixtures banked scored five and said
 * `5/5`. Reproduced by GPT Sol, 2026-09-05 — the shape in
 * docs/reusable/silent-success.md where a corpus is a property of the fixtures
 * and nothing reports which fixtures were exercised.
 */
async function samplesFor(slug: string, prompt: string): Promise<Sample[]> {
  const dir = path.join(CORPUS, slug);
  if (!existsSync(dir)) return [];
  const wanted = new RegExp(`^records-${prompt}-(\\d+)\\.json$`);
  const numbers = (await readdir(dir))
    .map((name) => wanted.exec(name)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  const samples: Sample[] = [];
  for (const n of numbers) {
    samples.push(JSON.parse(await readFile(sampleAt(slug, prompt, n), "utf8")) as Sample);
  }
  return samples;
}
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
  /**
   * The answer is one of the strings this fixture predicted would be taken
   * instead — **and is not the gold title**.
   *
   * That second clause is not belt-and-braces. The prefix match below is
   * symmetric, and `arxiv-lattice-linear-badmeta`'s false title *begins with*
   * the real one, so without the guard the exactly-correct answer scored as
   * stolen on the same verdict that scored it right (GPT Sol, 2026-09-05).
   */
  stoleFalseTitle: boolean;
  /** The byline this arm offered, or `null` where it offers none — the ladder arms never do. */
  bylineAnswer: string | null;
  /** `false` when the arm offered none, so read it beside `bylineAnswer` and not alone. */
  bylineRight: boolean;
  /** How many records this arm hid. Zero for both ladder arms, which is why the report says so. */
  setAside: number;
  /** Of `mustNotRender`, the ones an arm *could* remove: rendered when nothing is set aside. */
  removable: number;
  removed: number;
  /** `mustNotRender` golds already off the page before this arm ran, named. */
  inert: string[];
  /** Of the **reachable** `mustKeep`, how many survived. The direction that catches over-deletion. */
  kept: number;
  reachable: number;
  /** The reachable snippets this arm lost, named — a count alone is not actionable. */
  lost: string[];
  /** Snippets absent even with `setAside: []`. A fact about the transcription, not about the arm. */
  unreachable: string[];
  /** Retention over **every** declared snippet, reachable or not, so the gap cannot be forgotten. */
  keptRaw: number;
  keptOf: number;
}

export function judge(fixture: Fixture, sample: Sample, arm: string, answer: ArmAnswer): Verdict {
  const folded = foldTitle(answer.title);
  const right = folded === foldTitle(fixture.title);
  const shown = shownText(sample.transcript, answer.setAside);

  /* **What this sample renders when nothing is set aside** — and the whole of
     the fix for two findings, because both were the same mistake: a gold
     compared against the page without first asking whether it was ever on it.

     A `mustKeep` snippet that is already missing here is missing because the
     transcription's punctuation or line-breaking differs from the manifest's,
     not because an arm ate it — and once a gold is "lost", deleting its actual
     record cannot make retention any worse, so the eval stops being able to see
     the damage it exists to see. Symmetrically, a `mustNotRender` gold the
     transcription typed `publisher` or `cover` is off the page before any arm
     runs, and counting it as dropped hands every arm credit for work none of
     them did. Both reproduced by GPT Sol, 2026-09-05.

     Neither is fixed by loosening the match or by editing golds until they
     pass. They are scored out and **named**, which says the true thing: this
     snippet is measuring the transcription, not the pass under test. */
  const baseline = shownText(sample.transcript, []);
  const there = (snippet: string, text: string) => text.includes(foldTitle(snippet));

  const mustKeep = fixture.mustKeep ?? [];
  const unreachable = mustKeep.filter((s) => !there(s, baseline));
  const reachable = mustKeep.filter((s) => there(s, baseline));
  const lost = reachable.filter((s) => !there(s, shown));

  const inert = fixture.mustNotRender.filter((s) => !there(s, baseline));
  const removable = fixture.mustNotRender.filter((s) => there(s, baseline));

  const bylineAnswer = answer.byline?.trim() ? answer.byline.trim() : null;
  const goldByline = fixture.byline?.trim() ? fixture.byline.trim() : null;

  return {
    slug: fixture.slug,
    sample: sample.sample,
    arm,
    answer: answer.title,
    exact: answer.title.trim() === fixture.title.trim(),
    folded: right,
    stoleFalseTitle:
      !right &&
      fixture.falseTitles.some((f) => {
        const ff = foldTitle(f);
        return ff.length > 0 && (folded.startsWith(ff) || ff.startsWith(folded));
      }),
    bylineAnswer,
    bylineRight:
      goldByline === null
        ? bylineAnswer === null
        : bylineAnswer !== null && foldTitle(bylineAnswer) === foldTitle(goldByline),
    setAside: answer.setAside.length,
    removable: removable.length,
    removed: removable.filter((s) => !there(s, shown)).length,
    inert,
    kept: reachable.length - lost.length,
    reachable: reachable.length,
    lost,
    unreachable,
    keptRaw: mustKeep.filter((s) => there(s, shown)).length,
    keptOf: mustKeep.length,
  };
}

/**
 * What the sample bank on disk actually holds, fixture by fixture — including
 * the fixtures it holds **nothing** for, which is the whole reason it is a
 * return value rather than a local.
 */
export interface Bank {
  counts: { slug: string; samples: number }[];
  /** The most any one fixture has. A complete bank gives every fixture this many. */
  most: number;
}

export async function score(
  fixtures: Fixture[],
  armNames: string[],
): Promise<{ verdicts: Verdict[]; partial: string[]; bank: Bank }> {
  const prompt = promptFingerprint();
  const verdicts: Verdict[] = [];
  const partial: string[] = [];
  const counts: Bank["counts"] = [];
  for (const fixture of fixtures) {
    const samples = await samplesFor(fixture.slug, prompt);
    counts.push({ slug: fixture.slug, samples: samples.length });
    if (!samples.length) continue;
    const { pass, whole } = await passFor(fixture);
    if (!whole) partial.push(fixture.slug);
    for (const sample of samples) {
      for (const name of armNames) {
        const arm = ARMS[name];
        if (!arm) throw new Error(`no such arm: ${name}. Have: ${Object.keys(ARMS).join(", ")}`);
        verdicts.push(judge(fixture, sample, name, await arm(sample, pass, fixture)));
      }
    }
  }
  return { verdicts, partial, bank: { counts, most: Math.max(0, ...counts.map((c) => c.samples)) } };
}

/**
 * **What the bank is missing, in words.** Returned rather than printed so the
 * caller can put it first *and* last.
 *
 * **A loud warning and not a hard error**, deliberately. `score` is the thing
 * you run while the bank is still being bought, `--only` narrows the corpus on
 * purpose, and a command that refuses to say anything until all thirty samples
 * exist is a command people work around. What is not acceptable is a corpus of
 * five looking like a corpus of ten, so the warning names every fixture and is
 * printed at both ends of the report — the top for whoever reads from the top,
 * the bottom because that is what a terminal leaves on screen.
 */
export function bankNote(bank: Bank): string[] {
  const empty = bank.counts.filter((c) => c.samples === 0);
  const short = bank.counts.filter((c) => c.samples > 0 && c.samples < bank.most);
  const total = bank.counts.reduce((n, c) => n + c.samples, 0);
  if (!empty.length && !short.length) {
    return [
      `CORPUS COMPLETE — ${bank.counts.length} fixtures, ${total} samples, ${bank.most} each.`,
    ];
  }
  const lines = [
    `CORPUS INCOMPLETE — ${total} samples over ${bank.counts.length - empty.length} of ` +
      `${bank.counts.length} fixtures. Every rate below is about the fixtures that have records,` +
      ` NOT about the corpus.`,
  ];
  if (empty.length) lines.push(`  no samples at all: ${empty.map((c) => c.slug).join(", ")}`);
  if (short.length) {
    lines.push(
      `  fewer than ${bank.most}: ` +
        short.map((c) => `${c.slug} (${c.samples})`).join(", "),
    );
  }
  lines.push("  Run `transcribe` before comparing these numbers with anything.");
  return lines;
}

/**
 * Everything one arm got wrong, quoted rather than counted — a rate says an arm
 * is worse and a quotation says how. The `overdelete` arm is excluded by its
 * caller: it is *meant* to fail, and its failures are the point of it.
 *
 * The quotations run to 160 characters because several golds here are longer
 * than 110 and the difference lives in the tail: `unal-biotec-bilingual-title`'s
 * tidy answer is the Spanish title with the English one run onto the end, and
 * at 90 characters it read as correct.
 */
function failures(fixtures: Fixture[], arm: string, mine: Verdict[]): string[] {
  const wrong = mine.filter((v) => !v.folded);
  const badByline = mine.filter((v) => v.bylineAnswer !== null && !v.bylineRight);
  const eaten = mine.filter((v) => v.lost.length);
  if (!wrong.length && !badByline.length && !eaten.length) return [];
  const goldOf = (slug: string) => fixtures.find((f) => f.slug === slug);
  const lines = ["", `${arm}:`];
  for (const v of wrong) {
    lines.push(
      `  wrong title  ${v.slug} #${v.sample}`,
      `      got:  ${JSON.stringify(v.answer.slice(0, 160))}`,
      `      want: ${JSON.stringify((goldOf(v.slug)?.title ?? "").slice(0, 160))}`,
    );
  }
  for (const v of badByline) {
    lines.push(
      `  wrong byline ${v.slug} #${v.sample}`,
      `      got:  ${JSON.stringify((v.bylineAnswer ?? "").slice(0, 160))}`,
      `      want: ${JSON.stringify((goldOf(v.slug)?.byline ?? "").slice(0, 160))}`,
    );
  }
  for (const v of eaten) {
    lines.push(`  ATE THE ARTICLE  ${v.slug} #${v.sample}`);
    for (const snippet of v.lost) lines.push(`      lost: ${JSON.stringify(snippet.slice(0, 90))}`);
  }
  return lines;
}

/**
 * **The worst document for one arm, named** — what the plan promised and what an
 * average of thirty samples hides.
 *
 * Retention first, then titles, because an arm that eats the article is worse
 * than one that mislabels it. A fixture with nothing reachable sorts as perfect
 * retention rather than as zero: it is unmeasured, and `attackNote` is where
 * that gets said.
 */
function worstDocument(arm: string, mine: Verdict[], slugs: string[]): string {
  const worst = slugs
    .map((slug) => {
      const forSlug = mine.filter((v) => v.slug === slug);
      const kept = forSlug.reduce((n, v) => n + v.kept, 0);
      const reachable = forSlug.reduce((n, v) => n + v.reachable, 0);
      return { slug, kept, reachable, right: forSlug.filter((v) => v.folded).length, of: forSlug.length };
    })
    .filter((s) => s.of > 0)
    .sort(
      (a, b) =>
        (a.reachable ? a.kept / a.reachable : 1) - (b.reachable ? b.kept / b.reachable : 1) ||
        a.right / a.of - b.right / b.of,
    )[0];
  if (!worst) return `  ${arm.padEnd(12)} —`;
  const pct = worst.reachable ? `${((100 * worst.kept) / worst.reachable).toFixed(0)}%` : "—";
  return (
    `  ${arm.padEnd(12)} ${worst.slug} — kept ${worst.kept}/${worst.reachable} ${pct}, ` +
    `titles right ${worst.right}/${worst.of}`
  );
}

/**
 * **The attack arm, judged per document.**
 *
 * The old condition declared success the moment the attack lost one snippet
 * anywhere in the corpus, which proves nothing about the other nine fixtures. A
 * document that loses nothing when every one of its front records is hidden is
 * a document defending nothing, and it has to be named (GPT Sol, 2026-09-05).
 */
function attackNote(attack: Verdict[], slugs: string[]): string[] {
  const perSlug = slugs
    .map((slug) => {
      const mine = attack.filter((v) => v.slug === slug);
      return {
        slug,
        samples: mine.length,
        blind: mine.some((v) => v.lost.length === 0),
        nothingToLose: mine.every((v) => v.reachable === 0),
      };
    })
    .filter((s) => s.samples > 0);
  const blind = perSlug.filter((s) => s.blind);
  const lines = [
    "",
    `ATTACK ARM — hiding every front record must lose something in EVERY document. ` +
      `Detected in ${perSlug.length - blind.length}/${perSlug.length}.`,
  ];
  for (const s of blind) {
    lines.push(
      `  DEFENDS NOTHING  ${s.slug} — ` +
        (s.nothingToLose
          ? "no reachable `mustKeep` snippet at all, so over-deletion is invisible here."
          : "at least one sample loses nothing when every front record is hidden."),
    );
  }
  if (blind.length) lines.push("  Fix the corpus, not the arm.");
  return lines;
}

/**
 * **The golds that measure the transcription rather than the pass under test.**
 *
 * Both lists are properties of the sample bank and identical for every arm, so
 * they are read off one arm and printed once. Naming them is the whole point:
 * an unreachable gold scored silently is a check that cannot fail
 * (docs/reusable/silent-success.md).
 */
function transcriptionNotes(oneArm: Verdict[], slugs: string[]): string[] {
  const byFixture = (pick: (v: Verdict) => string[]) => {
    const out: string[] = [];
    for (const slug of slugs) {
      const mine = oneArm.filter((v) => v.slug === slug);
      const counts = new Map<string, number>();
      for (const v of mine) for (const s of pick(v)) counts.set(s, (counts.get(s) ?? 0) + 1);
      for (const [snippet, n] of counts) {
        out.push(`  ${slug} ${n}/${mine.length}  ${JSON.stringify(snippet.slice(0, 80))}`);
      }
    }
    return out;
  };
  const lines: string[] = [];
  const unreachable = byFixture((v) => v.unreachable);
  if (unreachable.length) {
    lines.push(
      "",
      "NOT IN THE TRANSCRIPTION — `mustKeep` golds absent with nothing set aside. A gold that is",
      "already lost cannot be lost again, so these are scored OUT of must-keep-kept and named here:",
      ...unreachable,
    );
  }
  const inert = byFixture((v) => v.inert);
  if (inert.length) {
    lines.push(
      "",
      "ALREADY OFF THE PAGE — `mustNotRender` golds the transcription never rendered (typed `publisher`",
      "or `cover`, or never emitted at all). No arm can be credited for removing them, and none is:",
      ...inert,
    );
  }
  return lines;
}

/**
 * The report. **Per document first**, because the document is the unit — an arm
 * that wins three samples on one fixture and loses one on three others has not
 * won.
 */
export function report(
  fixtures: Fixture[],
  verdicts: Verdict[],
  partial: string[],
  bank: Bank,
): string {
  const arms = [...new Set(verdicts.map((v) => v.arm))];
  const slugs = [...new Set(verdicts.map((v) => v.slug))];
  const lines: string[] = [...bankNote(bank), ""];
  const rate = (n: number, of: number) => (of ? `${((100 * n) / of).toFixed(0)}%` : "—");
  const cell = (n: number, of: number, w = 7) => `${`${n}/${of}`.padStart(w)} ${rate(n, of).padStart(4)}`;
  const forArm = (arm: string) => verdicts.filter((v) => v.arm === arm);
  const sum = (vs: Verdict[], k: (v: Verdict) => number) => vs.reduce((n, v) => n + k(v), 0);

  lines.push(
    "arm           docs-right    samples-right   exact  stolen   furniture-gone   must-keep-kept    byline",
  );
  for (const arm of arms) {
    const mine = forArm(arm);
    const perfect = slugs.filter((slug) => {
      const forSlug = mine.filter((v) => v.slug === slug);
      return forSlug.length > 0 && forSlug.every((v) => v.folded);
    }).length;
    /* **"No byline offered" is not "byline wrong"**, and a report that prints
       one rate cannot tell them apart: the ladder arms answer with a title and
       nothing else, and scoring them 0% would read as five wrong bylines. So
       the denominator is what the arm offered, and the count of offers is
       printed beside it. Every fixture declares a byline gold, so an arm that
       offers none has skipped the question rather than passed it. */
    const offered = mine.filter((v) => v.bylineAnswer !== null);
    lines.push(
      `${arm.padEnd(12)} ${cell(perfect, slugs.length)}  ${cell(mine.filter((v) => v.folded).length, mine.length)}` +
        `  ${rate(mine.filter((v) => v.exact).length, mine.length).padStart(5)}` +
        `  ${rate(mine.filter((v) => v.stoleFalseTitle).length, mine.length).padStart(6)}` +
        `  ${cell(sum(mine, (v) => v.removed), sum(mine, (v) => v.removable))}` +
        `  ${cell(sum(mine, (v) => v.kept), sum(mine, (v) => v.reachable))}` +
        `  ${offered.length ? cell(offered.filter((v) => v.bylineRight).length, offered.length, 5) : "  none offered"}`,
    );
  }

  /* **An arm that hides nothing cannot move either of the last two columns**,
     so `0/5` and `99/99` are arithmetic rather than results, and a reader who
     took the second for a win would be reading the eval backwards. Derived from
     the verdicts rather than from a list of arm names, so a new arm is covered
     on the day it is written. */
  const hideNothing = arms.filter((arm) => forArm(arm).every((v) => v.setAside === 0));
  if (hideNothing.length) {
    lines.push("");
    lines.push(
      `${hideNothing.join(", ")} set no record aside on any sample, so furniture-gone and ` +
        `must-keep-kept are 0% and 100% there by construction, not by merit.`,
    );
  }

  /* The raw retention, printed whether or not anything is unreachable, so that
     the difference between the two numbers is the corpus's problem in one line
     rather than something a reader has to go and derive. */
  lines.push("");
  lines.push(
    "raw must-keep retention over EVERY declared snippet (reachable or not): " +
      arms
        .map((arm) => {
          const mine = forArm(arm);
          return `${arm} ${sum(mine, (v) => v.keptRaw)}/${sum(mine, (v) => v.keptOf)}`;
        })
        .join(" · "),
  );

  lines.push("", "worst document per arm — retention first, then titles:");
  for (const arm of arms) lines.push(worstDocument(arm, forArm(arm), slugs));

  if (arms.includes("overdelete")) lines.push(...attackNote(forArm("overdelete"), slugs));
  const first = arms[0];
  if (first) lines.push(...transcriptionNotes(forArm(first), slugs));

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
      lines.push(`  REGRESSED  ${v.slug} #${v.sample} — now ${JSON.stringify(v.answer.slice(0, 160))}`);
    }
    for (const v of won) lines.push(`  fixed      ${v.slug} #${v.sample}`);
  }

  for (const arm of arms) {
    if (arm !== "overdelete") lines.push(...failures(fixtures, arm, forArm(arm)));
  }

  lines.push("");
  lines.push(...bankNote(bank));
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
    const { verdicts, partial, bank } = await score(fixtures, arms);
    if (!verdicts.length) {
      console.error("No samples on disk. Run `transcribe` first.");
      process.exit(1);
    }
    console.log(report(fixtures, verdicts, partial, bank));
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

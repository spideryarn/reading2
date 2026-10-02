/**
 * The corpus, as a committed manifest rather than a directory listing.
 *
 * Directory discovery had two failure modes GPT Sol named (REVIEW-SOL.md, 5):
 * a future `data/` directory silently joins every later run, so two runs of
 * "the corpus" can be different corpora with nothing saying so; and it swept in
 * `example` (a fixture) and two duplicate extractions of one document, so the
 * committed result had ten rows for seven documents. A manifest is a decision
 * per document, with the reason written down, and **adding the held-out set
 * later is a data change here** — new entries with `role: "heldout"`, chosen
 * by Greg, not by whoever runs the eval.
 *
 * The hash pins what was measured. `data/` is gitignored and regenerates, so
 * "the constitution" in a results file from March names bytes nothing can
 * recover; the manifest hash is checked at load and a mismatch is printed and
 * recorded rather than fatal — a re-extraction is legitimate, but it has to be
 * a visible fact about the run, and the manifest then needs a deliberate
 * update rather than drifting quietly.
 *
 * Roles:
 * - `dev` — the seven distinct documents everything so far was tuned on.
 *   Frozen as the development set (REVIEW-SOL.md, 4): the heading rule's
 *   thresholds were fitted here and must not be re-fitted to held-out results.
 * - `calibration` — flag on three stratified dev documents (long/well-headed,
 *   long/unheaded, short) for the phase-2 noise panel: incumbent x4 on each.
 * - `heldout` — none yet; Greg is choosing them.
 * - `duplicate` — scored only when named explicitly; never in an aggregate.
 * - `fixture` — `example/`: useful as a smoke target, excluded from every
 *   claim about real documents.
 */

export interface CorpusEntry {
  slug: string;
  /** Relative to the repo root. */
  dir: string;
  /** sha256 of blocks.json as measured when this entry was written. */
  sha256: string;
  role: "dev" | "heldout" | "duplicate" | "fixture";
  /**
   * Gistable body blocks of one word or less — stage 3's inline-promotion
   * artefacts, a second confound found AFTER these documents were chosen
   * (2026-08-30, the read.html postmortem). Recorded rather than re-picked:
   * the pollution is real data about real articles, and without the count a
   * later reader cannot tell an arm that handled a messy article from one
   * that got a clean one. scoreTree carries the same number on every row.
   */
  fragments: number;
  /** Part of the phase-2 noise panel (incumbent x4). Dev docs only. */
  calibration?: boolean;
  /** For duplicates: the canonical slug whose document this repeats. */
  duplicateOf?: string;
  /** Why this document is in the corpus — or out of the default run. */
  why: string;
}

export const CORPUS: readonly CorpusEntry[] = [
  {
    slug: "constitution",
    fragments: 1,
    dir: "data/constitution",
    sha256: "58dd654c87248ce4fc966ad83074b7b6cdaf6569e36ae477e09d28803afdec5f",
    role: "dev",
    calibration: true,
    why: "The longest (360 blocks) and most densely headed (36); the article that broke stage 4. Calibration: long/well-headed.",
  },
  {
    slug: "fowler-phrenology",
    fragments: 3,
    dir: "data/fowler-phrenology",
    sha256: "b9fa248d7fe9c4f141afe3fed09fc9de2706be8af7f7ebc2aa5f319f36bbcf4b",
    role: "dev",
    calibration: true,
    why: "Eight headings, all catalogue front-matter in the first ten blocks, then a 61-block headingless run — no heading rule can carve it. Calibration: long/unheaded.",
  },
  {
    slug: "noema-mythology-of-conscious-ai",
    fragments: 0,
    dir: "data/noema-mythology-of-conscious-ai",
    sha256: "2b755acf95c4a1dc6dac7b0fbcc40df6465bb2ca3da2203624caec12ab446255",
    role: "dev",
    why: "Mid-length essay with non-gistable media blocks; the label eval's second text.",
  },
  {
    slug: "revistes-ub-30977",
    fragments: 1,
    dir: "data/revistes-ub-30977",
    sha256: "63a6fbb537437fca6d6524655b7bcdde8f08f2a324af487cbd2bbc5ce21ce66c",
    role: "dev",
    why: "Short academic paper, five h1 sections. The canonical copy of the document source/source-2 duplicate.",
  },
  {
    slug: "scaling-hypothesis",
    fragments: 6,
    dir: "data/scaling-hypothesis",
    sha256: "9678ff8ed6375fdc4eabc27bb8e8d5d8b9baa121a7e2c798d85b104d5286f2db",
    role: "dev",
    why: "Over-segments on its own headings (14 h2s against the incumbent's 8 parts) and carries site furniture headings; the deference-vs-reorganise hard case.",
  },
  {
    slug: "what-if-we-had-bigger-brains-imagining-minds-beyond-ours",
    fragments: 1,
    dir: "data/what-if-we-had-bigger-brains-imagining-minds-beyond-ours",
    sha256: "34c07e328524f4d0760bd8624c29327107e1fb201206789a3b9f650416c57706",
    role: "dev",
    why: "Long essay whose h2s the incumbent follows exactly; the well-behaved long case, and the one measured ingest in the ledger.",
  },
  {
    slug: "writes",
    fragments: 0,
    dir: "data/writes",
    sha256: "b4dfb806c52ba040f839f1364777da3d56546c8a7602e2e5f566f0fc44e47ad7",
    role: "dev",
    calibration: true,
    why: "Nineteen blocks, one heading: the article too short for any structure rule. Calibration: short.",
  },
  /* ---- Ingested 2026-09-03 for the effort and cheap-model evals. ---- */
  {
    slug: "gwern-scaling-long",
    fragments: 6,
    dir: "data/gwern-scaling-long",
    sha256: "8250b24f4a5dfe456652db765e249d3d51685e7b3318e2b5d6908995b0c0ac6f",
    role: "fixture",
    why: "16,846 words, 184 blocks, 24 headings — the longest article any eval here has measured, ingested for the effort eval (evals/results/hierarchy-effort-2026-09-03.md) and reused for the cheap-model bake-off. `fixture` rather than `dev` on purpose: it arrived after the dev set was frozen, and folding it into the aggregates would silently move every earlier number. Named explicitly by both runs that use it.",
  },
  {
    slug: "openai-huggingface",
    fragments: 0,
    dir: "data/openai-huggingface",
    sha256: "88ddedfa5298e574797df2648c36b7c706052501b714f1a02175834de5e0fc95",
    role: "fixture",
    why: "4,192 words in 95 blocks with ONE heading — the case where the free author-heading tree cannot compete and the paid call has to do the whole carving alone. That is exactly the control the effort eval lacked, since its finding was that the author's headings carve better than the paid call; here there are none to carve with.",
  },
  /* ---- The held-out five, ingested 2026-08-30 (free stages 1–3 only). ----
     Chosen by GPT Sol's five structural categories BEFORE the heading rule saw
     them, approved by the team lead; the rule is judged on them exactly as it
     stands, and nothing is retuned after seeing the results — that is the
     whole value of holding them out. */
  {
    slug: "greatwork",
    fragments: 89,
    dir: "data/greatwork",
    sha256: "282a0abaa783337ba67f685793ca9bf635f5cef5c113da3594891c52b336a6c2",
    role: "heldout",
    why: "Category 1, long prose with no headings: Paul Graham's 'How to Do Great Work' — 330 blocks, one title heading, a 329-block headingless run. The typical case fowler only pathologically imitates.",
  },
  {
    slug: "meditations-on-moloch",
    fragments: 8,
    dir: "data/meditations-on-moloch",
    sha256: "27ee9412affd8770b91d7ddd0e210a9a7a05d744c65c76b3a92610c2c078701d",
    role: "heldout",
    why: "Category 2, and the ingest itself was the finding: the essay's authored roman-numeral section markers do NOT extract as headings, so a document that looks structured arrives structureless (one heading, 288-block run). Kept as that finding, per the team lead — not swapped for something tidier.",
  },
  {
    slug: "consciousness",
    fragments: 24,
    dir: "data/consciousness",
    sha256: "1305baf2f48fc7b39a993464152bf524fd9193f867103f81d662888feb759fe7",
    role: "heldout",
    why: "Category 3, dense and furniture-heavy headings: Wikipedia's Consciousness — h2–h4 throughout, 276 of 499 blocks classified supplement.",
  },
  {
    slug: "spaced-repetition",
    fragments: 18,
    dir: "data/spaced-repetition",
    sha256: "bbdadbfc0b26064e91be6e9344bb210be38f4057740bef073d113509dd9e6087",
    role: "heldout",
    why: "Category 4, genuinely deep hierarchy: gwern's 'Spaced Repetition for Efficient Learning' — h2×12 down to h5×2, plus 73 supplement endnotes and a 60-block headingless run of its own.",
  },
  {
    slug: "arxiv-2308",
    fragments: 8,
    dir: "data/arxiv-2308",
    sha256: "dbda9f7300172c5772460cb0167db15302cf1e72994d46d6bbc05c90e802a33d",
    role: "heldout",
    why: "Category 5, an academic paper: Butlin et al. 2023 (arXiv 2308.08708, native HTML), 38k words, numbered sections h2–h4. The ingest surfaced two real stage-2/3 findings this eval inherits as-is: the 251-block bibliography is NOT classified supplement, and the extracted title is a mangled label ('1Indicator Properties').",
  },
  {
    slug: "source",
    fragments: 1,
    dir: "data/source",
    sha256: "d0671bf3ea34b00293c892cfa369e7803c14d89e7047c4e27c097e8efe20c4cf",
    role: "duplicate",
    duplicateOf: "revistes-ub-30977",
    why: "A second extraction of the revistes document (identical 3,106 words); scoring it would triple-weight one document.",
  },
  {
    slug: "source-2",
    fragments: 1,
    dir: "data/source-2",
    sha256: "d69af507437380c5fb5cae0074e029dea4c476322f855f647e7d7d5c93ac1fff",
    role: "duplicate",
    duplicateOf: "revistes-ub-30977",
    why: "A third extraction of the same document, differing only in heading levels (h2 for h1).",
  },
  {
    slug: "example",
    fragments: 0,
    dir: "example",
    sha256: "7589dc3e354769e43c180802dc199e03b1b028c0fe005aed653ac3d6e0681205",
    role: "fixture",
    why: "The committed example fixture: a fine smoke target, not a real document, and in no aggregate.",
  },
];

/** The documents a default run scores: the dev set (held-out later, when Greg picks it). */
export function defaultCorpus(): CorpusEntry[] {
  return CORPUS.filter((e) => e.role === "dev" || e.role === "heldout");
}

/** The manifest entry for a directory named explicitly, if there is one. */
export function entryForDir(dir: string): CorpusEntry | undefined {
  return CORPUS.find((e) => e.dir === dir || e.slug === dir.split("/").at(-1));
}

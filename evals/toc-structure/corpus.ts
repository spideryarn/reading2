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
    dir: "data/constitution",
    sha256: "58dd654c87248ce4fc966ad83074b7b6cdaf6569e36ae477e09d28803afdec5f",
    role: "dev",
    calibration: true,
    why: "The longest (360 blocks) and most densely headed (36); the article that broke stage 4. Calibration: long/well-headed.",
  },
  {
    slug: "fowler-phrenology",
    dir: "data/fowler-phrenology",
    sha256: "b9fa248d7fe9c4f141afe3fed09fc9de2706be8af7f7ebc2aa5f319f36bbcf4b",
    role: "dev",
    calibration: true,
    why: "Eight headings, all catalogue front-matter in the first ten blocks, then a 61-block headingless run — no heading rule can carve it. Calibration: long/unheaded.",
  },
  {
    slug: "noema-mythology-of-conscious-ai",
    dir: "data/noema-mythology-of-conscious-ai",
    sha256: "2b755acf95c4a1dc6dac7b0fbcc40df6465bb2ca3da2203624caec12ab446255",
    role: "dev",
    why: "Mid-length essay with non-gistable media blocks; the label eval's second text.",
  },
  {
    slug: "revistes-ub-30977",
    dir: "data/revistes-ub-30977",
    sha256: "63a6fbb537437fca6d6524655b7bcdde8f08f2a324af487cbd2bbc5ce21ce66c",
    role: "dev",
    why: "Short academic paper, five h1 sections. The canonical copy of the document source/source-2 duplicate.",
  },
  {
    slug: "scaling-hypothesis",
    dir: "data/scaling-hypothesis",
    sha256: "9678ff8ed6375fdc4eabc27bb8e8d5d8b9baa121a7e2c798d85b104d5286f2db",
    role: "dev",
    why: "Over-segments on its own headings (14 h2s against the incumbent's 8 parts) and carries site furniture headings; the deference-vs-reorganise hard case.",
  },
  {
    slug: "what-if-we-had-bigger-brains-imagining-minds-beyond-ours",
    dir: "data/what-if-we-had-bigger-brains-imagining-minds-beyond-ours",
    sha256: "34c07e328524f4d0760bd8624c29327107e1fb201206789a3b9f650416c57706",
    role: "dev",
    why: "Long essay whose h2s the incumbent follows exactly; the well-behaved long case, and the one measured ingest in the ledger.",
  },
  {
    slug: "writes",
    dir: "data/writes",
    sha256: "b4dfb806c52ba040f839f1364777da3d56546c8a7602e2e5f566f0fc44e47ad7",
    role: "dev",
    calibration: true,
    why: "Nineteen blocks, one heading: the article too short for any structure rule. Calibration: short.",
  },
  {
    slug: "source",
    dir: "data/source",
    sha256: "d0671bf3ea34b00293c892cfa369e7803c14d89e7047c4e27c097e8efe20c4cf",
    role: "duplicate",
    duplicateOf: "revistes-ub-30977",
    why: "A second extraction of the revistes document (identical 3,106 words); scoring it would triple-weight one document.",
  },
  {
    slug: "source-2",
    dir: "data/source-2",
    sha256: "d69af507437380c5fb5cae0074e029dea4c476322f855f647e7d7d5c93ac1fff",
    role: "duplicate",
    duplicateOf: "revistes-ub-30977",
    why: "A third extraction of the same document, differing only in heading levels (h2 for h1).",
  },
  {
    slug: "example",
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

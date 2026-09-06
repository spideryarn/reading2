/**
 * The corpus, as a committed manifest rather than a directory listing — the
 * shape [`evals/hierarchy-structure/corpus.ts`](../hierarchy-structure/corpus.ts)
 * argued for, and for the same two reasons: a directory that grows joins every
 * later run with nothing saying so, and a results file naming only a slug names
 * bytes nothing can recover.
 *
 * ## Where the bytes come from, and the `Target:` line that says so
 *
 * **These are real articles out of local Postgres, not the fixture cut.** The
 * plan for this work
 * ([260905f](../../docs/plans/260905f-socratic-summaries-eval-admin-page-gating-short-selections.md)
 * § *The eval, cut down*) recorded that the local `data/` root is five
 * fixture-cut `toc/2` trees and therefore "not ready for the twenty-article
 * design". That was true of `data/`. It is not true of the database: on
 * 2026-09-05 `npm run db:export` returned **31 articles with a current
 * revision**, printing
 *
 *     Target: postgresql://postgres@127.0.0.1:54362/postgres
 *
 * — read rather than assumed, because
 * [database.md § `DATABASE_URL=… npm run db:migrate` does not do what it looks
 * like](../../docs/project/database.md) records a command reaching a database
 * other than the one on its command line and printing success either way.
 *
 * So the corpus is reproduced with one command, into a gitignored directory:
 *
 *     npm run db:export -- --out output/summaries-corpus
 *
 * **The export is byte-deterministic** — verified 2026-09-05 by exporting twice
 * to two directories and comparing sha256 of `blocks.json` and `tree.json` for
 * six slugs; all twelve matched. That is what makes the hashes below a pin
 * rather than a decoration.
 *
 * ## Why the tree is hashed as well as the blocks
 *
 * `hierarchy-structure` hashes `blocks.json` alone because the tree is its
 * *output*. Here the tree is an **input**: this eval runs the variants over a
 * fixed existing tree and asks only for wording, so a re-run against a
 * re-carved tree is a different measurement wearing the same slug. Both hashes
 * are checked at load; a mismatch is printed and recorded rather than fatal, and
 * then the manifest needs a deliberate update rather than drifting quietly.
 *
 * ## The same document under two sets of bytes
 *
 * `noema-mythology-of-conscious-ai` also exists in the committed fixture root
 * (`tests/fixtures/data-root/data/`, copied into a worktree's `data/` by
 * `npm run worktree:setup`). The two carry **identical block ids, identical
 * block text and an identical tree structure**, and differ only in JSON
 * serialisation — so the hashes differ and neither is wrong. The export is what
 * is pinned, because it is the one root the whole corpus can come from. If you
 * run against `data/` instead, expect a hash mismatch on every entry and read
 * the run's `corpusDrift` list rather than the absence of a complaint.
 *
 * ## The measurement that came free
 *
 * The plan measured the root-gist inversion — "the root gist is the longest row
 * in five articles out of five" — on the fixture cut, and flagged that as a
 * caveat. It holds on the real corpus too: of the ten documents below, **the
 * root gist is the longest median row in nine**, the exception being
 * `openai-huggingface`, where root and depth-1 tie at 27 words. Medians by
 * depth are recorded per entry, run 2026-09-05.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseJsonFrom } from "../../src/parse-json.js";
import type { Block, Tree } from "../../src/types.js";

/**
 * Where `npm run db:export -- --out …` was pointed. Gitignored (`/output/`),
 * because it is a reader's real articles and they do not belong in git.
 */
export const DEFAULT_CORPUS_ROOT = "output/summaries-corpus";

export interface CorpusEntry {
  slug: string;
  /** sha256 of `blocks.json` as exported on 2026-09-05. */
  sha256: string;
  /** sha256 of `tree.json` — an INPUT here, not an output. See the header. */
  treeSha256: string;
  /** `tree.version` when measured. `toc/5` trees already carry stored questions. */
  version: string;
  blocks: number;
  words: number;
  headings: number;
  /** Depth-1 nodes: the rows this eval writes a question for, beside the root. */
  parts: number;
  /** Stored `question` fields — the generic ones Greg disliked, where there are any. */
  storedQuestions: number;
  /** Median gist length in words at depth 0, 1, 2. The inversion, per document. */
  gistWords: readonly [number, number, number];
  role: "dev" | "calibration" | "duplicate" | "fixture" | "oversize";
  /** For duplicates: the canonical slug whose document this repeats. */
  duplicateOf?: string;
  why: string;
}

export const CORPUS: readonly CorpusEntry[] = [
  {
    slug: "noema-mythology-of-conscious-ai",
    sha256: "7f2bf54038356caa82187df1a20ea1199c063ad3859b59b11502cfb48f874c12",
    treeSha256: "53d3c7289446c31b229cd8406e7f0ea731d9988907e7e1d21612bf3ecc4e2a5e",
    version: "toc/2",
    blocks: 141,
    words: 8283,
    headings: 9,
    parts: 5,
    storedQuestions: 0,
    gistWords: [38, 22, 21],
    /* **`calibration` rather than `dev`, and it is not a preference.** The five
       negative anchors in variants.md are written against ONE node of this
       tree — `n0048`, "Consciousness & Computation" — including a fabricated
       count that is only wrong because that node has six children while its
       gist says four, and a gist-echo anchor that quotes its gist verbatim.
       Drop this document and the judge is never calibrated, so `anchors.ts`
       asserts the node still looks the way the anchors assume. */
    role: "calibration",
    why: "The five negative anchors are written against this tree's `n0048`. Mid-length essay, nine headings, the label eval's second text — and the article whose stored gists carry the meta-narration the new GISTS block bans ('The essay opens by…', 'The essay closes by urging…').",
  },
  {
    slug: "antikythera-mechanism-spya-zhxrzm",
    sha256: "256478f197af70943a3e212b472e7357b7953c99ac398cf925ad53ddd2632232",
    treeSha256: "949cc08bade48c5725534bf2a0116a5d40b9cb664aedd47a5ae25a006fe26549",
    version: "toc/5",
    blocks: 357,
    words: 14943,
    headings: 6,
    parts: 10,
    storedQuestions: 10,
    gistWords: [31, 20, 16],
    role: "dev",
    why: "The only long document with the CURRENT questions stored — ten of them, and they are the failure the plan diagnoses, in the wild: 'What physical pieces of the mechanism survive today?' (lookup), 'Was the Antikythera mechanism a unique invention?' (yes/no), 'How did the front dial track the calendar and zodiac?' (the gist, asked). An encyclopaedia article rather than an essay, so it is also the case where a presupposed question has least to presuppose.",
  },
  {
    slug: "towards-a-theory-of-bugs-the-ruliology-of-the-unexpected",
    sha256: "e85d229171c217304fce98d53849897e4dca0060aabdea6bac56d279bea1bb47",
    treeSha256: "a94e38f9e79990a45dd156886148895ede22177d614b0b5e73478e8d46e66b47",
    version: "toc/2",
    blocks: 244,
    words: 8001,
    headings: 13,
    parts: 9,
    storedQuestions: 0,
    gistWords: [49, 31, 28],
    role: "dev",
    why: "Wolfram on bugs: the WORST root gist in the corpus at 49 words, so it is where the root-brevity half of Greg's ask has the most to do. Well headed, and the argument is a taxonomy rather than a thesis — a hard case for 'presuppose where the section lands'.",
  },
  {
    slug: "scaling-hypothesis",
    sha256: "82b1213fe14f628f92b8df8056b6ff91f4bef6955c7a172b2ac8872267265931",
    treeSha256: "358fe05ae14b8cc80e45e2d35cb69c4556743a0d4756c9faf0f8100185da5fa1",
    version: "toc/2",
    blocks: 186,
    words: 16855,
    headings: 25,
    parts: 9,
    storedQuestions: 0,
    gistWords: [53, 30, 26],
    role: "dev",
    why: "The longest article in the set by words (16,855) and the densest in headings. Shared with `evals/hierarchy-structure`'s corpus, so the two evals have one document in common — deliberately, since a variant that reads well here can be checked against what that eval already knows about the tree.",
  },
  {
    slug: "openai-huggingface",
    sha256: "8a2d3372c958bafaf7fda86658171d56d203497907215afe5b707e64061be1c7",
    treeSha256: "34fb3d2145bbff2b2ac87c2885630987982d8e9b676683625521ee2e0c7a9405",
    version: "toc/2",
    blocks: 95,
    words: 4192,
    headings: 1,
    parts: 8,
    storedQuestions: 0,
    gistWords: [27, 27, 21],
    role: "dev",
    why: "ONE heading in 95 blocks, so every part title and every question is the model's own — nothing is copied from an author. It is also the one document where the root gist is NOT the longest row (27 = 27), which is the counter-example the inversion claim needs beside it.",
  },
  {
    slug: "fowler-phrenology",
    sha256: "3267df1c3bc3d56d21ff4f99a5e7fad40c2a22a5afc8d5cccb124d9451c9a5de",
    treeSha256: "3486985a80a68efbcd5303eefba7118cff3639490066a4769112538fbe3265e8",
    version: "toc/2",
    blocks: 72,
    words: 8717,
    headings: 8,
    parts: 9,
    storedQuestions: 0,
    gistWords: [20, 18, 17],
    role: "dev",
    why: "An 1840s lecture on phrenology: confident nineteenth-century prose arguing for something false. The 'simpler language' axis has real work here, and a presupposing question has to presuppose a claim the reader should not be handed as settled — which is the sharpest test of the difference between direction and endorsement.",
  },
  {
    slug: "claudes-constitution-spya-cr8bzk",
    sha256: "ad579ba230fed242256240bf844cbc67ad4814321442aadc9826229366ac1a3a",
    treeSha256: "dc40555f9b24431628683aae884251cb0af98ada4a467e3b8f1b958b2fd98395",
    version: "toc/2",
    blocks: 120,
    words: 3295,
    headings: 11,
    parts: 8,
    storedQuestions: 0,
    gistWords: [24, 18, 17],
    role: "dev",
    why: "A normative document rather than an argument — it states what should be the case, and asks nothing. The variants all assume the section is 'built to answer' a question; this is the document where that assumption is least true, and V2's TELLS branch is what it tests.",
  },
  /* -------------------------------------------------- out of the default -- */
  {
    slug: "the-mythology-of-conscious-ai-spya-rn5m0q",
    sha256: "97c9c5c0fce8ec09f77ec0cac1bfdfea6001eda934109445b7eb5ba9a5ec79a0",
    treeSha256: "c752aaf42d2553f82a992df954d8d9d38669dac0dcfe55ad9e6d7864cc122eca",
    version: "toc/5",
    blocks: 141,
    words: 8283,
    headings: 9,
    parts: 5,
    storedQuestions: 6,
    gistWords: [29, 24, 19],
    role: "duplicate",
    duplicateOf: "noema-mythology-of-conscious-ai",
    why: "The same document as the calibration article, re-ingested under toc/5 so it carries six stored questions. Scoring it would double-weight one essay. It is named here because it is the ONLY place the current prompt's questions and the anchors' article meet — useful to read by hand, never in an aggregate.",
  },
  {
    slug: "writes",
    sha256: "2a5aacf107fbcb2029f7bb61ac0650640570e79c8631fb1b54e11f124b9c50ec",
    treeSha256: "d02831b1f4606f8a09e1d8e5c046f84e3887c5cb00d80f759683b07da1db710e",
    version: "toc/2",
    blocks: 19,
    words: 561,
    headings: 1,
    parts: 4,
    storedQuestions: 0,
    gistWords: [31, 22, 17],
    role: "fixture",
    why: "Nineteen blocks: the smoke target. A four-part tree over 561 words is not an article anyone triages, so it is in no claim about reader value — it is here because a run that cannot do this one cannot do any of them, and it costs a cent.",
  },
  {
    slug: "m1-kuhn-spya-a2zrjb",
    sha256: "16a27597dda51b2ff0e4ddf7271202bdfd77c3992cd3c0193fc5b72c495af0ea",
    treeSha256: "4f5d0c275f0b2fd9eb45a504323f3c34c0215ee98f6c79561bf7255787daeafc",
    version: "toc/3",
    blocks: 2046,
    words: 152077,
    headings: 252,
    parts: 22,
    storedQuestions: 0,
    gistWords: [30, 22, 18],
    role: "oversize",
    why: "A 152,000-word book with 2,173 nodes. Recorded rather than dropped because it is a real limit: one call cannot carry it, and any variant that ships has to reach it through the deepening cascade — which has no question field at all (`EXPAND_SYSTEM`, plan § P1-5). NOTHING in this harness measures that path, and this entry is where that gap is written down.",
  },
];

/** The documents a default run scores. `calibration` is in it: the anchors live there. */
export function defaultCorpus(): CorpusEntry[] {
  return CORPUS.filter((e) => e.role === "dev" || e.role === "calibration");
}

export function entryFor(slug: string): CorpusEntry | undefined {
  return CORPUS.find((e) => e.slug === slug);
}

/** One document as this eval needs it: the blocks, the fixed tree, and whether the bytes are the pinned ones. */
export interface LoadedDocument {
  entry: CorpusEntry;
  blocks: Block[];
  tree: Tree;
  title: string;
  /** Empty when both hashes matched. One line per file that did not. */
  drift: string[];
}

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/**
 * Read one document off a corpus root and say whether it is the pinned bytes.
 *
 * **Drift is returned, never thrown and never swallowed.** A re-export is
 * legitimate — the article may genuinely have been re-ingested — but it has to
 * be a visible fact about the run, recorded in the results file beside the
 * numbers it changes. The caller decides; this only reports.
 */
export async function loadDocument(root: string, entry: CorpusEntry): Promise<LoadedDocument> {
  const dir = path.join(root, entry.slug);
  const blocksRaw = await readFile(path.join(dir, "blocks.json"));
  const treeRaw = await readFile(path.join(dir, "tree.json"));
  const drift: string[] = [];
  const gotBlocks = sha256(blocksRaw);
  const gotTree = sha256(treeRaw);
  if (gotBlocks !== entry.sha256) {
    drift.push(`${entry.slug}/blocks.json is ${gotBlocks.slice(0, 12)}…, manifest says ${entry.sha256.slice(0, 12)}…`);
  }
  if (gotTree !== entry.treeSha256) {
    drift.push(`${entry.slug}/tree.json is ${gotTree.slice(0, 12)}…, manifest says ${entry.treeSha256.slice(0, 12)}…`);
  }
  const { blocks } = parseJsonFrom<{ blocks: Block[] }>(blocksRaw.toString("utf-8"), "blocks.json");
  const tree = parseJsonFrom<Tree>(treeRaw.toString("utf-8"), "tree.json");
  const meta = await readFile(path.join(dir, "meta.json"), "utf-8").then(
    (raw) => parseJsonFrom<{ title?: string }>(raw, "meta.json"),
    () => ({ title: undefined }),
  );
  return {
    entry,
    blocks,
    tree,
    title: meta.title ?? tree.nodes[tree.rootId]?.title ?? entry.slug,
    drift,
  };
}

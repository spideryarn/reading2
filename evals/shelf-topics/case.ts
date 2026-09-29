/**
 * **One eval case: a shelf, as the arms and the judge see it.** Plan
 * docs/plans/260929c-shelf-topics-chosen-by-a-model.md § Reviews, R6.
 *
 * A case carries each article's title, gist and step-1 candidates (the
 * extractor's stored output shape), never the article text, so the same file
 * could come from any database. Synthetic cases also carry pre-labelled
 * expected-good topics and planted distractors, as keys.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ChooseArticle } from "../../src/shelf-terms/choose.js";
import { type Candidate, foldKey } from "../../src/shelf-terms/extract.js";

export interface CaseArticle {
  slug: string;
  title: string;
  /** The library entry's gist (`article_revisions.root_gist`), or null. */
  gist: string | null;
  words: number;
  textHash: string;
  skipped: string | null;
  candidates: Candidate[];
}

export interface ShelfCase {
  id: string;
  /** Where it came from: the local database, a subset of it, or written for the eval. */
  source: "local" | "subset" | "synthetic";
  description: string;
  /** What the arms and the judge are told about the reader. */
  profile: string | null;
  /** Keys (plural-folded, lowercase), for synthetic cases only. */
  labels: { good: string[]; distractors: string[] } | null;
  extractorVersion: number;
  articles: CaseArticle[];
}

export const EVAL_DIR = import.meta.dirname;
export const CASES_DIR = path.join(EVAL_DIR, "cases");
export const RESULTS_DIR = path.join(EVAL_DIR, "results");

/**
 * The order cases are reported in. `greg-like` first: Greg's own shelf is not
 * available, and this one is built to show the failure he saw on it (Greg via
 * the Overseer, 2026-09-29).
 */
export const CASE_ORDER = [
  "greg-like",
  "mind-and-machines",
  "contemplative-neuro",
  "kitchen-garden",
  "history",
  "local",
  "local-subset-a",
  "local-subset-b",
  "local-subset-c",
];

export function loadCases(): ShelfCase[] {
  const all = readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(CASES_DIR, f), "utf8")) as ShelfCase);
  const rank = (id: string) => {
    const i = CASE_ORDER.indexOf(id);
    return i < 0 ? CASE_ORDER.length : i;
  };
  return all.sort((a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : 1));
}

/** The chooser's input: the articles step 1 did not skip. */
export function chooseInput(c: ShelfCase): ChooseArticle[] {
  return c.articles
    .filter((a) => a.skipped === null)
    .map((a) => ({ slug: a.slug, words: a.words, textHash: a.textHash, candidates: a.candidates }));
}

/** A label phrase → the key the extractor would give it ("Neural Networks" → "neural network"). */
export function labelKey(phrase: string): string {
  return phrase
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => foldKey(w))
    .join(" ");
}

/* ── Arms and run files (shared by run-arms, make-pairs and summarise) ── */

/** The predeclared arms, each of which run-arms.ts runs. */
export const RUN_ARMS = ["baseline", "jev-score", "deepseek-score", "luna-score", "deepseek-order", "luna-order"] as const;
export type RunArm = (typeof RUN_ARMS)[number];
/**
 * **Added after seeing the results, not predeclared.** Jev's expected scores
 * never reach 0 (food 0.86, female 0.90 on greg-like), so the greedy still
 * took distractors to fill its slots. These re-read the SAVED Jev scores, set
 * any below the floor to 0 (not a topic), and run the same greedy. They make
 * no model call (derive-jev-floor.ts).
 */
export const DERIVED_ARMS = ["jev-floor", "jev-floor-0.75"] as const;
export type DerivedArm = (typeof DERIVED_ARMS)[number];
export const JEV_FLOORS: Record<DerivedArm, number> = { "jev-floor": 1, "jev-floor-0.75": 0.75 };
export const ARMS = [...RUN_ARMS, ...DERIVED_ARMS] as const;
export type Arm = (typeof ARMS)[number];
export const RUNS = [1, 2, 3] as const;

export interface CallRecord {
  model: string;
  answeredBy: string | null;
  provider: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  reasoningTokens: number | null;
  /** OpenRouter's `usage.cost`; 0 on a BYOK call, whose upstream figure is below. */
  costUsd: number | null;
  upstreamCostUsd: number | null;
  latencyMs: number;
}

export interface RunFile {
  case: string;
  arm: Arm;
  run: number;
  at: string;
  call: CallRecord | null;
  /** Candidates shown to the model. */
  candidates: number;
  /** Score arms: key → score; order arms: null. */
  scores: Record<string, number> | null;
  /** Ids the model left unscored, or returned that were not candidates. */
  missing: number;
  invalid: number;
  error: string | null;
  /** The top-30, best first. */
  list: { key: string; label: string; count: number; slugs: string[] }[];
}


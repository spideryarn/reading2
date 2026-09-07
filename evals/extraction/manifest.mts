/**
 * **The assertion manifest** — one per fixture, beside the HTML, saying what an
 * extraction of that page has to contain, must not contain, and must keep the
 * shape of.
 *
 *   evals/extraction/fixtures/<fixture-name>.manifest.json
 *
 * ## Why a manifest rather than a gold
 *
 * Two prior plans stopped in the same place: there is no gold, so no arm can be
 * scored — only argued about
 * ([260827ab](../../docs/plans/260827ab-readability-repair-pass.md),
 * [260830at](../../docs/plans/260830at-readability-tidy-pass.md)). A full
 * hand-labelled gold over a hundred pages is what neither could afford. A
 * manifest is the affordable half: **a named, checkable claim about a page**,
 * written once, with the reason it is there recorded beside it.
 *
 * ## Binary per fixture, and never averaged
 *
 * `checkManifest` returns a pass/fail per fixture, not a fraction, and the runner
 * reports it that way. Averaging assertions across a corpus rewards an arm that
 * satisfies every declared assertion while wrecking the 95% of the page nobody
 * declared anything about — which is exactly the arm this whole plan is trying to
 * catch. The continuous numbers live in [scorecard.mts](scorecard.mts) and each
 * one carries an exposure count saying how much of the page it saw.
 *
 * ## Every needle carries `why`
 *
 * Not decoration. 260830at's ≤6-character marker rule scored **246/246** on a
 * corpus that could not defeat it, and nobody could tell from the number that the
 * corpus contained no short article content at all. A needle whose `why` says
 * *"a genuinely two-word line of dialogue — a length rule must not delete it"* is
 * a needle whose purpose survives the person who wrote it.
 *
 * ## The integrity rule that makes the exclusions mean anything
 *
 * **A `mustNotContain` needle that does not occur in the source HTML is
 * vacuously satisfied by every arm**, including one that deletes the article.
 * That is the needle-level form of the exposure problem, and it is checked in
 * `tests/extraction-manifests.test.ts` rather than trusted: every needle on both
 * lists has to be findable in the fixture's own bytes.
 *
 * @see [scorecard.mts](scorecard.mts) — the continuous half
 * @see [fixtures/README.md](fixtures/README.md) — what each fixture is for
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/* Type-only, and the cycle is deliberate: the gate names belong to the scorecard
   that runs them, and a finding that records them must not invent a second list
   that can drift out of step with it. */
import type { GateName } from "./scorecard.mjs";

/** Where the manifests live: beside the HTML they describe. */
export const MANIFEST_DIR = path.join("evals", "extraction", "fixtures");

export const manifestPath = (fixture: string): string =>
  path.join(MANIFEST_DIR, `${fixture}.manifest.json`);

/**
 * The structural tags a floor may be declared on: `inventory.mts` § `STRUCTURE`,
 * plus `h1` and `p`, which that list deliberately does not count.
 *
 * A floor here is checked directly by `scorecard.mts`, which counts the tag on
 * the output itself rather than going through `STRUCTURE` — so the two lists
 * may differ without anything going unchecked, and `h1` and `p` floors are
 * enforced even though the probe's summary never mentions them. `STRUCTURE`
 * says what is worth *reporting* across every page; this says what a page may
 * *declare* about itself. The reasons `h1` is in one and not the other are on
 * `STRUCTURE`.
 *
 * `p` is here for one page and the exception is worth stating rather than
 * hiding. `inventory.mts` counts the things a *page* can lose; every page has
 * paragraphs, so counting them says nothing about most of them. `pg-greatwork`
 * is the page where it says everything: paulgraham.com holds a 55,000-character
 * essay in one `<td>` as 595 `<br>` in 235 runs, with **no `<p>` in the source at
 * all**, so the paragraphs are Readability's to build and an extraction that
 * hands the reader one undifferentiated block has destroyed the essay's shape
 * while keeping every word. Nothing else in this file could say so:
 * `restore-everything` did exactly that and came out with no regression on any
 * metric. See `pg-greatwork.manifest.json` § note.
 */
export const MANIFEST_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "math", "pre", "figure", "blockquote", "img", "li", "code", "p",
] as const;
export type ManifestTag = (typeof MANIFEST_TAGS)[number];

/**
 * **The shapes a length-or-character-class rule gets wrong**, named so a fixture
 * can say which one it is holding.
 *
 * Every one of these is article content a reader would notice the loss of, and
 * every one is short, symbolic or numeric enough that a "drop the small blocks"
 * policy takes it. 260830at proposed exactly such a rule and its corpus could
 * not contradict it; these are what contradict it.
 */
export const NEGATIVE_CONTROLS = [
  /** `1–0`. Two digits and a dash, and it is the result of the match. */
  "scoreline",
  /** A table cell holding only a number — the datum the table exists for. */
  "numeric-cell",
  /** A display equation alone on its own line, with no words anywhere near it. */
  "equation-line",
  /** `* * *`, `❦`, `§` — a scene break the author put there, no letters in it. */
  "scene-break",
  /** A whole article short enough that "too short to be an article" would drop it. */
  "short-article",
  /** `Update (Feb. 29):` — the author correcting themselves, dated. */
  "dated-update",
  /** `“Not one.”` — a complete line of dialogue in three words. */
  "short-dialogue",
  /** `Encoder:` — a real section heading that happens to be one word. */
  "short-heading",
] as const;
export type NegativeControl = (typeof NEGATIVE_CONTROLS)[number];

/**
 * **Which part of the source document is the piece.**
 *
 * The field GPT Sol's second review made unavoidable. He built an arm on
 * `aaronson` out of *genuine stamped source elements* — the three required
 * passages trimmed to their exact source text, five real figures, two real
 * blockquotes for the floor, and then **padding made of the comment thread**
 * until it cleared `minArticleChars: 30000`. It retained **178 characters of the
 * post, 0.542%**, scored 1.00 on every exercised metric, passed both gates and
 * every assertion, and registered no regression.
 *
 * The reason is exact: **provenance proves that text came from somewhere on the
 * page, and cannot tell the article from the 52,776-word comment thread
 * underneath it.** Every length floor counted gistable characters of *output*,
 * so anything lying around on the page could fill one.
 *
 * So a manifest names the region, and the two measures that used to count output
 * count the region instead — see [scorecard.mts](scorecard.mts) §
 * `articleReturned`. The selectors are matched against the **prepared source
 * document** (`arms.mts` § `preparedSourceHtml`), because that is the document
 * the stamps refer to.
 *
 * **A region drawn generously flatters the pipeline exactly as the ar5iv floors
 * did**, so `why` is required and each manifest's `note` records three measured
 * numbers: the region's own text, the whole source body's, and what the shipped
 * extraction returns of the region.
 */
export interface ArticleRegion {
  /** Selector(s) in the prepared source whose subtrees are the piece itself. */
  within: string[];
  /**
   * Subtrees to take back out again — boilerplate the region cannot avoid
   * enclosing, like Project Gutenberg's licence blocks inside a flat `<body>`.
   */
  except?: string[];
  /** Why this region and not a more generous one. Checkable against the note. */
  why: string;
}

export interface Needle {
  /**
   * The literal text, as the reader sees it. Matched against whitespace-collapsed
   * text, case-sensitively — a publisher's `text-transform` is CSS, not text, and
   * folding case would let `NOTES` satisfy a needle written for `Notes`.
   */
  text: string;
  /** Why this string is on this list. Read by the next person; see the header. */
  why: string;
  /** Which shape of short/symbolic article content this needle is protecting. */
  negativeControl?: NegativeControl;
}

/**
 * **What a run may say about an arm, and it is not a verdict on the article.**
 *
 * Until 2026-09-05 the runner wrote `acceptable` / `damaged` / `improved` into
 * each manifest, and § B called those a *blinded* better/same/worse judgement.
 * They were neither blinded nor a judgement: they were derived automatically
 * from the same card they were meant to audit, which is circular, and GPT Sol
 * showed what that buys. An arm returning three copied strings — 0.55% of
 * `aaronson` — satisfied every declared assertion, and the runner wrote
 * **`acceptable`** into the manifest and would have handed that word to stage C.
 *
 * The manifest tier does not know whether an article survived. It knows whether
 * the strings somebody wrote down are still there. So that is all this says, and
 * a reader who wants "is this a good extraction" has to go and look, which is the
 * honest position rather than a gap.
 *
 * The alternative was to keep the label and add exceptions for each way it can be
 * fooled. The floor-masking exception already in the tree is the argument against:
 * it was written for a case that no longer reproduces, it is still there, and the
 * class it belongs to is not closed.
 */
export interface ArmFinding {
  /** Every declared assertion still holds. `null` when the manifest declared none. */
  assertionsHeld: boolean | null;
  /**
   * **Each gate on its own, because the summary of them was false.**
   *
   * This was one field, `gatesPassed`, documented as *"both hard gates passed"*
   * — and `findingFor` computed it by discarding the abstentions and asking
   * whether the rest passed. On `pmc-article`, whose order gate abstains for
   * want of a second stamped node, that recorded `true` for "both gates passed"
   * when only one had been asked. GPT Sol, 2026-09-05. A record of two things
   * cannot be one boolean; it is two, and either may be `null`.
   */
  gates: Record<GateName, boolean | null>;
  /**
   * Metrics and gates on which this arm did **worse than the shipped one**, by
   * name. A comparison, not a grade: an empty list means "nothing this card can
   * see got worse", which is a much smaller claim than "acceptable".
   */
  regressions: string[];
  /**
   * Characters of the **declared article region** this arm returned, by stamp —
   * `null` where the region or the provenance to resolve it was missing. See
   * `ArticleRegion`: until 2026-09-05 this counted every gistable character of
   * output, and an arm padded with the comment thread scored 30,052 of them.
   */
  articleChars: number | null;
  /** Every gistable character of output, region or not. The size of the thing returned. */
  gistableChars: number;
  /** `articleChars` over the region's own text. `null` for the same reasons. */
  articleRecall: number | null;
}

export interface StructureFloor {
  /** The extraction must keep at least this many. */
  atLeast?: number;
  /**
   * Exactly this many — **which is also an upper bound**, and that is the point.
   * `atLeast` alone cannot fail an arm that drags in the whole page, so a fixture
   * whose table count is known says `exactly` and catches both directions.
   */
  exactly?: number;
}

export interface AssertionManifest {
  /** The `name` in [corpus.mts](corpus.mts)'s `CORPUS` / `EXTRA_FIXTURES`. */
  fixture: string;
  /** The HTML file, relative to `fixtures/`. Checked against corpus.mts. */
  file: string;
  /** One sentence: what this page is here to prove, in this manifest's terms. */
  note: string;
  mustContain: Needle[];
  mustNotContain: Needle[];
  structure?: Partial<Record<ManifestTag, StructureFloor>>;
  /**
   * The byline exactly as it should come out, or `null` for "this page has none
   * and inventing one is a failure". Absent means "not asserted here".
   */
  byline?: string | null;
  /** The title exactly as it should come out. Absent means not asserted. */
  title?: string;
  /**
   * No single block may be longer than this. The giant-block failure —
   * `whitman.html`'s 67,890-character node, `hn_dropbox.html`'s 23,038.
   */
  maxBlockChars?: number;
  /**
   * **Which part of the source document is the piece.** Required by
   * `minArticleChars`, because that floor is a floor on *this*. See
   * `ArticleRegion`.
   */
  articleRegion?: ArticleRegion;
  /**
   * **Not a floor on every block** — that would fail on the negative controls
   * this file exists to protect. It is the floor on the *article*: the
   * characters of the declared `articleRegion` the extraction gave back, by
   * stamp, must reach this.
   *
   * **It used to count every gistable character of output**, and the difference
   * is not a detail: an arm that deleted 99.458% of GPT Sol's `aaronson` post
   * and refilled the space with the comment thread underneath it cleared a floor
   * of 30,000 with 30,052 characters, of which 178 were the post.
   *
   * **The unit changed with the measure**, so no floor here survives from before
   * 2026-09-05: these are characters of own text with **whitespace removed**,
   * and the old ones were block text with its spaces. Copying a number across
   * would have been the ar5iv mistake in a new costume — a floor written against
   * one measure is not valid under another. Each `note` carries the arithmetic.
   * `scorecard.mts` § `ArticleMeasure`.
   */
  minArticleChars?: number;
  /** No gistable block may consist only of punctuation and symbols. */
  noPunctuationOnlyBlocks?: boolean;
  /**
   * **The assertion is that stage 2 refuses this page.**
   *
   * A bot wall, a login page, a cookie interstitial: `readArticle` returns
   * something that looks like an article and is not, and every instrument here
   * used to record that as a clean pass because the manifest could not say
   * otherwise. `medium-about` and `pmc-article` were committed **without
   * manifests** for exactly that reason, and the plan called it a deferral.
   *
   * It is not a deferral — deciding what *production* does about a bot wall can
   * wait, but scoring "this is not an article" cannot, because it is the worst
   * silent success in the trawl. A manifest with this set asserts refusal and
   * nothing else; `mustContain` must be empty, because there is no article whose
   * text could be required.
   */
  notAnArticle?: boolean;
  /**
   * **What the last run found, per arm.** Not a verdict on the article — see
   * `ArmFinding`, and the label that used to live here.
   */
  findings?: Record<string, ArmFinding>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * **Every key has to be one we know**, and this is the check GPT Sol's review
 * found missing on 2026-09-05: `mustContian`, `maxBlockChar` and a needle field
 * `negativeContorl` all parsed, and each left a manifest asserting less than its
 * author wrote. Applied at every level of the file, not just the top.
 */
function onlyKnownKeys(obj: Record<string, unknown>, known: readonly string[], where: string): void {
  const unknown = Object.keys(obj).filter((k) => !known.includes(k));
  if (unknown.length) {
    throw new Error(
      `${where}: unknown key(s) ${unknown.map((k) => JSON.stringify(k)).join(", ")} — ` +
        `a misspelt key asserts nothing. Known: ${known.join(", ")}`,
    );
  }
}

/**
 * A count, and it has to be a real one. `atLeast: -1` is satisfied by an empty
 * document while reading like an assertion; `1.5` and `NaN` are satisfied by
 * nothing and no count can ever equal them.
 */
function wholeCount(v: unknown, where: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new Error(`${where}: expected a non-negative whole number, got ${JSON.stringify(v)}`);
  }
  return v;
}

const NEEDLE_KEYS = ["text", "why", "negativeControl"] as const;

function needlesOf(raw: unknown, where: string): Needle[] {
  if (!Array.isArray(raw)) throw new Error(`${where}: expected an array`);
  return raw.map((n, i) => {
    if (!isRecord(n)) throw new Error(`${where}[${i}]: expected an object`);
    onlyKnownKeys(n, NEEDLE_KEYS, `${where}[${i}]`);
    const { text, why, negativeControl } = n;
    if (typeof text !== "string" || !text.trim()) {
      throw new Error(`${where}[${i}].text: expected a non-empty string`);
    }
    if (typeof why !== "string" || !why.trim()) {
      /* Enforced, not encouraged. A needle with no reason is a needle nobody can
         maintain, and the corpus that scored 246/246 was full of them. */
      throw new Error(`${where}[${i}].why: every needle must say why it is here`);
    }
    if (negativeControl !== undefined) {
      if (!NEGATIVE_CONTROLS.includes(negativeControl as NegativeControl)) {
        throw new Error(`${where}[${i}].negativeControl: unknown kind ${JSON.stringify(negativeControl)}`);
      }
    }
    return { text, why, ...(negativeControl ? { negativeControl: negativeControl as NegativeControl } : {}) };
  });
}

/** Every key `parseManifest` understands. Anything else is a typo. See `onlyKnownKeys`. */
export const MANIFEST_KEYS = [
  "fixture", "file", "note", "mustContain", "mustNotContain", "structure",
  "byline", "title", "maxBlockChars", "articleRegion", "minArticleChars",
  "noPunctuationOnlyBlocks", "notAnArticle", "findings",
] as const;

/** An array of non-empty CSS selectors, and nothing looser. */
function selectorsOf(raw: unknown, where: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${where}: expected a non-empty array of selectors`);
  }
  return raw.map((s, i) => {
    if (typeof s !== "string" || !s.trim()) {
      throw new Error(`${where}[${i}]: expected a non-empty selector string`);
    }
    return s;
  });
}

/**
 * Parse and **validate** — a hand-edited JSON file is a hand-edited JSON file,
 * and a cast would let a typo'd key sit there asserting nothing. Every failure
 * below is a shape a person can actually produce, and three of them are shapes
 * that were sitting in the corpus unnoticed until 2026-09-05.
 */
export function parseManifest(raw: unknown, where: string): AssertionManifest {
  if (!isRecord(raw)) throw new Error(`${where}: expected an object`);
  onlyKnownKeys(raw, MANIFEST_KEYS, where);
  for (const key of ["fixture", "file", "note"]) {
    if (typeof raw[key] !== "string" || !(raw[key] as string).trim()) {
      throw new Error(`${where}.${key}: expected a non-empty string`);
    }
  }
  const m: AssertionManifest = {
    fixture: raw["fixture"] as string,
    file: raw["file"] as string,
    note: raw["note"] as string,
    mustContain: needlesOf(raw["mustContain"] ?? [], `${where}.mustContain`),
    mustNotContain: needlesOf(raw["mustNotContain"] ?? [], `${where}.mustNotContain`),
  };

  const structure = raw["structure"];
  if (structure !== undefined) {
    if (!isRecord(structure)) throw new Error(`${where}.structure: expected an object`);
    const out: Partial<Record<ManifestTag, StructureFloor>> = {};
    for (const [tag, floor] of Object.entries(structure)) {
      if (!MANIFEST_TAGS.includes(tag as ManifestTag)) {
        throw new Error(`${where}.structure.${tag}: not a tag this manifest can count`);
      }
      if (!isRecord(floor)) throw new Error(`${where}.structure.${tag}: expected an object`);
      onlyKnownKeys(floor, ["atLeast", "exactly"], `${where}.structure.${tag}`);
      const { atLeast, exactly } = floor;
      if (atLeast === undefined && exactly === undefined) {
        throw new Error(`${where}.structure.${tag}: declares neither atLeast nor exactly`);
      }
      out[tag as ManifestTag] = {
        ...(atLeast === undefined
          ? {}
          : { atLeast: wholeCount(atLeast, `${where}.structure.${tag}.atLeast`) }),
        ...(exactly === undefined
          ? {}
          : { exactly: wholeCount(exactly, `${where}.structure.${tag}.exactly`) }),
      };
    }
    m.structure = out;
  }

  if ("byline" in raw) {
    const b = raw["byline"];
    if (b !== null && typeof b !== "string") throw new Error(`${where}.byline: expected a string or null`);
    m.byline = b as string | null;
  }
  for (const key of ["title"] as const) {
    if (key in raw) {
      if (typeof raw[key] !== "string") throw new Error(`${where}.${key}: expected a string`);
      m[key] = raw[key] as string;
    }
  }
  if ("articleRegion" in raw) {
    const region = raw["articleRegion"];
    if (!isRecord(region)) throw new Error(`${where}.articleRegion: expected an object`);
    onlyKnownKeys(region, ["within", "except", "why"], `${where}.articleRegion`);
    if (typeof region["why"] !== "string" || !region["why"].trim()) {
      /* Enforced for the same reason a needle's `why` is: a region is a
         judgement, and a generous one flatters the pipeline exactly as the
         ar5iv floors did. The next person has to be able to argue with it. */
      throw new Error(`${where}.articleRegion.why: a region is a judgement and must say why`);
    }
    m.articleRegion = {
      within: selectorsOf(region["within"], `${where}.articleRegion.within`),
      ...(region["except"] === undefined
        ? {}
        : { except: selectorsOf(region["except"], `${where}.articleRegion.except`) }),
      why: region["why"],
    };
  }
  for (const key of ["maxBlockChars", "minArticleChars"] as const) {
    if (key in raw) m[key] = wholeCount(raw[key], `${where}.${key}`);
  }
  if (m.minArticleChars !== undefined && m.articleRegion === undefined) {
    /* **The floor and the measure travel together, or neither means anything.**
       `minArticleChars` counts the characters of the declared region that came
       back. Without a region there is nothing to count, and the old behaviour —
       counting every gistable character of output — is what let a collage of
       comment-thread paragraphs clear a floor written for the post. */
    throw new Error(
      `${where}.minArticleChars: a floor on the article needs an articleRegion to measure — ` +
        "declare one, or drop the floor",
    );
  }
  if ("noPunctuationOnlyBlocks" in raw) {
    if (typeof raw["noPunctuationOnlyBlocks"] !== "boolean") {
      throw new Error(`${where}.noPunctuationOnlyBlocks: expected a boolean`);
    }
    m.noPunctuationOnlyBlocks = raw["noPunctuationOnlyBlocks"] as boolean;
  }
  if ("notAnArticle" in raw) {
    if (typeof raw["notAnArticle"] !== "boolean") {
      throw new Error(`${where}.notAnArticle: expected a boolean`);
    }
    if (raw["notAnArticle"] === true && m.mustContain.length) {
      throw new Error(
        `${where}.notAnArticle: a page that is not an article has no required text — ` +
          `drop the ${m.mustContain.length} mustContain needle(s) or drop the claim`,
      );
    }
    if (raw["notAnArticle"] === true && m.articleRegion) {
      throw new Error(
        `${where}.articleRegion: this page is not an article, so no part of it is the article`,
      );
    }
    m.notAnArticle = raw["notAnArticle"];
  }
  if ("findings" in raw) {
    const findings = raw["findings"];
    if (!isRecord(findings)) throw new Error(`${where}.findings: expected an object`);
    const out: Record<string, ArmFinding> = {};
    for (const [arm, f] of Object.entries(findings)) {
      if (!isRecord(f)) throw new Error(`${where}.findings.${arm}: expected an object`);
      onlyKnownKeys(
        f,
        ["assertionsHeld", "gates", "regressions", "articleChars", "gistableChars", "articleRecall"],
        `${where}.findings.${arm}`,
      );
      const tri = (v: unknown, k: string): boolean | null => {
        if (v === null || typeof v === "boolean") return v as boolean | null;
        throw new Error(`${where}.findings.${arm}.${k}: expected true, false or null`);
      };
      const regressions = f["regressions"];
      if (!Array.isArray(regressions) || regressions.some((r) => typeof r !== "string")) {
        throw new Error(`${where}.findings.${arm}.regressions: expected an array of strings`);
      }
      const gates = f["gates"];
      if (!isRecord(gates)) throw new Error(`${where}.findings.${arm}.gates: expected an object`);
      onlyKnownKeys(gates, ["attribution", "sourceOrder"], `${where}.findings.${arm}.gates`);
      const fraction = (v: unknown, k: string): number | null => {
        if (v === null) return null;
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
          throw new Error(`${where}.findings.${arm}.${k}: expected a number in 0..1 or null`);
        }
        return v;
      };
      out[arm] = {
        assertionsHeld: tri(f["assertionsHeld"], "assertionsHeld"),
        gates: {
          attribution: tri(gates["attribution"], "gates.attribution"),
          sourceOrder: tri(gates["sourceOrder"], "gates.sourceOrder"),
        },
        regressions: regressions as string[],
        articleChars:
          f["articleChars"] === null
            ? null
            : wholeCount(f["articleChars"], `${where}.findings.${arm}.articleChars`),
        gistableChars: wholeCount(f["gistableChars"], `${where}.findings.${arm}.gistableChars`),
        articleRecall: fraction(f["articleRecall"], "articleRecall"),
      };
    }
    m.findings = out;
  }
  return m;
}

export async function loadManifest(fixture: string): Promise<AssertionManifest | null> {
  const p = manifestPath(fixture);
  if (!existsSync(p)) return null;
  return parseManifest(JSON.parse(await readFile(p, "utf-8")), path.basename(p));
}

/**
 * Write the findings back, **merging** rather than replacing — a run scores one
 * set of arms and must not delete what another run recorded. The rest of the file
 * is hand-written and is never rewritten from code.
 */
export async function recordFindings(
  fixture: string,
  findings: Record<string, ArmFinding>,
): Promise<void> {
  const p = manifestPath(fixture);
  const raw = JSON.parse(await readFile(p, "utf-8")) as Record<string, unknown>;
  const existing = isRecord(raw["findings"]) ? (raw["findings"] as Record<string, unknown>) : {};
  raw["findings"] = { ...existing, ...findings };
  await writeFile(p, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
}

/**
 * **A referee's own criterion, and what came back when it was run over the
 * paper** — the stored shape, and the validation that decides what is allowed
 * to become one.
 *
 * Stage 2 of docs/plans/260831an-referee-mode-for-peer-reviewers.md. Nothing here
 * calls a model, touches a database or reads a file: it is the half that can be
 * tested with a fixture, and it is where the rules live.
 *
 * ## Why this is not `search_runs` with a column added
 *
 * The plan's first draft said `search_runs` "has the right shape already", and
 * GPT Sol's review (finding 6) showed it does not: no criterion kind, no poles,
 * no citations, and — the one that would have broken first —
 * **`SearchHit.confidence` is a 0–100 match strength whose validator clamps
 * negatives to zero** (`validateHits`, src/search.ts). A signed valence routed
 * through that field does not arrive wrong; it arrives as `0`, which reads as
 * *"the model is not sure"*, and every negative judgement the referee asked for
 * is silently gone. Nothing errors and nothing looks odd.
 *
 * So there are two numbers here and they are never the same field:
 *
 * - **`confidence`** — 0–100. *How sure the model is that this passage bears on
 *   the criterion at all.* A match strength, exactly as `SearchHit.confidence`,
 *   in the same unit, clamped the same way.
 * - **`valence`** — −100…+100, on `diverging` results only. *Which way the
 *   passage cuts*, in the referee's own two poles. Signed, and clamped by
 *   `clampValence`, which is a different function from `clampConfidence` for
 *   exactly one reason: so that no future edit can route one through the other.
 *
 * If you ever find yourself writing `valence` into a confidence field, or
 * reusing one clamp for both, that is this comment's whole subject.
 *
 * ## The anchor is the same contract as everything else
 *
 * `blockId` + `quote`, with `start` as a disambiguator and never as the anchor —
 * docs/project/block-ids.md. `validateResults` re-finds every quote with
 * `findQuote` (src/quote-match.ts), which is **the same function the browser
 * uses to decide which characters to wash**, so a result that survives here is
 * one the reading view can definitely draw. `validateHits` explains at length
 * why that agreement matters; the reasoning is identical and is not repeated.
 *
 * ## Parse tolerantly, validate strictly, count what you dropped, never rescale
 *
 * Borrowed wholesale from src/search.ts, including the part that looks like a
 * bug and is not: a confidence of `1` or less is **counted, not rescaled**.
 * Rescaling is a guess about which unit the model meant, and a confident guess
 * that is wrong paints the whole article at the wrong intensity with nothing at
 * all to see. See `Dropped.subOne` there for the version of this that has
 * already cost somebody a day.
 */

import { findQuote } from "./quote-match.js";
import type { Block, BlockId, Citation } from "./types.js";
import { isWebUrl } from "./urls.js";

/* ------------------------------------------------------------------ kinds -- */

/**
 * What sort of question the referee is asking.
 *
 * The three differ in what a *result* carries, which is why this is a
 * discriminator and not a flag: `diverging` adds a signed valence and
 * `literature` adds citations, and neither can be bolted onto the other without
 * making every field optional and every reader of the type guess.
 */
export const REFEREE_CRITERION_KINDS = [
  /** A saved search in referee clothing: "find me the passages that bear on this". */
  "single",
  /** A criterion with a good end and a bad end. Greg's ask, 2026-08-31. */
  "diverging",
  /** The one that goes to the web, and must come back with sources or not at all. */
  "literature",
] as const;

export type RefereeCriterionKind = (typeof REFEREE_CRITERION_KINDS)[number];

export function isRefereeCriterionKind(value: unknown): value is RefereeCriterionKind {
  return typeof value === "string" && (REFEREE_CRITERION_KINDS as readonly string[]).includes(value);
}

/**
 * What the two ends of a `diverging` criterion mean, **in the referee's own
 * words**.
 *
 * Not "good" and "bad": the model is told what this particular referee counts
 * as each end, because *"the controls are adequate"* and *"the controls are
 * pre-registered"* are different questions and only one of them is theirs.
 *
 * `against` is the −100 end and `forr`… no. `against` is −100, `favour` is
 * +100, and the panel prints those words rather than a colour —
 * docs/project/colour-scales.md is blunt that colour may never be the only
 * carrier of a direction.
 */
export interface RefereePoles {
  /** What the −100 end means. Printed as "counts against". */
  against: string;
  /** What the +100 end means. Printed as "counts for". */
  favour: string;
}

/**
 * **Which diverging ramp this criterion is drawn with** — `styles/colourscales.css`
 * has both, built and tested, and this is their first user.
 *
 * - `rg` — `--div-rg-*`, red ↔ green. **The default**, and it is a default with
 *   a condition attached rather than a free choice.
 * - `br` — `--div-*`, blue ↔ red, which
 *   [colour-scales.md](../docs/project/colour-scales.md) calls "the one to use"
 *   because red–green confusion is what colour blindness overwhelmingly is.
 *
 * **Why the default is nevertheless `rg`, and why nobody should "fix" it.** That
 * same page permits red ↔ green under one stated condition: *use it where the
 * reader already knows which end is which from something other than the colour —
 * a printed number, a label, a position — so the hue is a shortcut rather than
 * the message.* Referee mode meets that condition by construction: every row
 * prints the rank, the signed number, the direction in words ("counts for" /
 * "counts against") and the referee's own mark beside the model's, in the
 * visible text and in the `aria-label`. The colour is never the only carrier,
 * and it is never the first one. Greg asked for red ↔ green three times.
 *
 * If the panel ever stops printing the direction in words, this default stops
 * being permitted and has to move to `br`. That is the condition, written down
 * where the column is, so the two cannot drift apart quietly.
 */
export const DIVERGING_SCALES = ["rg", "br"] as const;
export type DivergingScale = (typeof DIVERGING_SCALES)[number];

export const DEFAULT_DIVERGING_SCALE: DivergingScale = "rg";

export function isDivergingScale(value: unknown): value is DivergingScale {
  return typeof value === "string" && (DIVERGING_SCALES as readonly string[]).includes(value);
}

/**
 * Everything about a criterion that is not its prose — the typed `config` Sol's
 * finding 6 asked for, as a discriminated union rather than a bag of optionals.
 *
 * `single` and `literature` carry nothing extra *today*. They are still spelled
 * out as members rather than collapsed into "not diverging", because the moment
 * one of them grows a field, a union has a place to put it and a boolean does
 * not (docs/project/typechecking.md § let the types catch it).
 */
export type RefereeCriterionConfig =
  | { kind: "single" }
  | { kind: "diverging"; poles: RefereePoles; scale: DivergingScale }
  | { kind: "literature" };

/* ---------------------------------------------------------------- results -- */

/** Where in the piece a result points. Id first, text second, offsets never. */
interface Anchored {
  blockId: BlockId;
  /** The words as they appear in the block — never as the model retyped them. */
  quote: string;
  /** Where `quote` sat in `block.text`. A disambiguator, never the anchor. */
  start?: number;
}

interface Judged extends Anchored {
  /**
   * **How sure the model is that this passage bears on the criterion — 0–100,
   * integer, one unit everywhere.**
   *
   * The same field, the same unit and the same rule as `SearchHit.confidence`
   * (src/types.ts), whose comment records the bug this convention exists to
   * prevent: a version of this app documented the field as 0–1 and read it as
   * 0–100, with an undocumented conversion somewhere in between.
   *
   * **It is not, and must never become, a judgement about the paper.** It says
   * "this passage is relevant", not "this passage is good". The judgement, where
   * the referee asked for one, is `valence` on a `DivergingResult`, and the two
   * are different fields on purpose — see this file's header.
   */
  confidence: number;
  /** One line on why this passage bears on the criterion. Shown under the quote. */
  reasoning: string;
}

/** "This passage bears on your criterion." Nothing more is claimed. */
export interface SingleResult extends Judged {
  kind: "single";
}

/** The same, plus which way it cuts. */
export interface DivergingResult extends Judged {
  kind: "diverging";
  /**
   * **Which way this passage cuts, −100…+100, integer, and signed.**
   *
   * −100 is the referee's `poles.against` end, +100 is `poles.favour`, and **0
   * is a real answer** meaning neither — which is why the diverging colour scale
   * is pivoted at zero rather than at the data's midpoint
   * (docs/project/colour-scales.md).
   *
   * **This is not `confidence` and may never travel through it.** `validateHits`
   * in src/search.ts clamps a negative confidence to zero, so a valence of −80
   * sent down that road arrives as 0 — "no strong feeling" — and the referee is
   * shown the opposite of what the model said, with nothing red anywhere. That
   * failure is the reason this type exists at all, and `clampValence` is a
   * separate function from `clampConfidence` so that the mistake has to be typed
   * out deliberately.
   *
   * It is also **never painted into the prose stripe**. The renderer's two
   * channels are strength and identity (src/web/annotate.ts), and repainting the
   * stripe by valence throws provenance away: two negative criteria over one
   * phrase both go red and the reader cannot tell which said what. Valence lives
   * in the panel row and the block gutter, in words as well as in colour. Sol's
   * finding 7.
   */
  valence: number;
}

/** The same, plus where on the web it was checked. */
export interface LiteratureResult extends Judged {
  kind: "literature";
  /**
   * **At least one**, always. A literature check with no source link is
   * unverifiable, and the mode's own rule is that every row is something the
   * referee can go and look at. `validateResults` drops an uncited result
   * rather than storing one, and counts it — so "the model answered and none of
   * it was checkable" is a visible fact rather than an empty panel.
   *
   * Every URL has passed `isWebUrl` before it gets here, the same gate model
   * output crosses everywhere else it becomes an `href` (src/urls.ts).
   */
  citations: Citation[];
  /**
   * How many web searches the provider ran for this criterion. **`0` is a real
   * answer** — it means the model answered from what it already had — and it is
   * required rather than optional for exactly that reason, following
   * `glossary_lookups.searches`.
   */
  searches: number;
}

/**
 * One passage a criterion turned up.
 *
 * Discriminated by `kind`, which repeats the criterion's own kind. That
 * repetition is deliberate: a result handed to a component on its own is still
 * a complete thing, and TypeScript can narrow it without the parent in scope.
 * `validateResults` is what keeps the two in step — it stamps the kind rather
 * than reading it from the model's reply, so a model that answers with the
 * wrong one cannot create a row that lies about itself.
 */
export type RefereeResult = SingleResult | DivergingResult | LiteratureResult;

/* -------------------------------------------------------------- the clamps -- */

/**
 * A 0–100 match strength, rounded and bounded.
 *
 * **Negatives become 0**, which is correct for a match strength and catastrophic
 * for a valence. That asymmetry is the whole reason this and `clampValence` are
 * two functions rather than one with a flag.
 */
export function clampConfidence(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

/**
 * A −100…+100 signed judgement, rounded and bounded.
 *
 * **Negatives survive.** If this function ever starts agreeing with
 * `clampConfidence` about what to do with −80, the feature it exists for is
 * gone and nothing will say so. `tests/referee-criteria.test.ts` holds it here.
 */
export function clampValence(value: number): number {
  return Math.round(Math.min(100, Math.max(-100, value)));
}

/* ----------------------------------------------------------- what was lost -- */

/** What validation threw away, so a log line and a panel can say it out loud. */
export interface DroppedResults {
  /** Results naming a block this article does not have. */
  unknownIds: number;
  /** Results whose quote is not in the block they named. */
  unquoted: number;
  /** Confidences outside 0–100 that had to be clamped. */
  clampedConfidence: number;
  /** Valences outside −100…+100 that had to be clamped. */
  clampedValence: number;
  /**
   * Confidences of 1 or less — the unit-drift alarm, counted and never
   * rescaled. `Dropped.subOne` in src/search.ts is the same field and carries
   * the full argument.
   */
  subOneConfidence: number;
  /**
   * Valences with a magnitude of 1 or less **and not zero** — the same alarm on
   * the other scale. Zero is excluded because zero is a real, meaningful answer
   * here ("neither end"), so counting it would make the alarm fire on the most
   * ordinary result there is.
   */
  subOneValence: number;
  /**
   * Literature results with no usable citation. Dropped, because the plan
   * forbids showing one, and counted, because "answered but unverifiable" and
   * "found nothing" are different facts that must not render the same.
   */
  uncited: number;
  /** Results beyond `MAX_RESULTS`. Counted so a cap is never silent. */
  truncated: number;
}

function noneDropped(): DroppedResults {
  return {
    unknownIds: 0,
    unquoted: 0,
    clampedConfidence: 0,
    clampedValence: 0,
    subOneConfidence: 0,
    subOneValence: 0,
    uncited: 0,
    truncated: 0,
  };
}

/** As many passages as a panel can be read down. `MAX_HITS` in src/search.ts is the same number. */
export const MAX_RESULTS = 20;

/** More than a person will follow, and enough that a real answer is never trimmed. */
export const MAX_CITATIONS = 8;

/* ---------------------------------------------------------- the validator -- */

/**
 * Thrown when the reply is not the shape a reply has to be.
 *
 * The top-level shape is **asserted, not defaulted**, for the reason
 * `validateHits` gives at length: an unreadable reply quietly becoming `[]` is
 * stored as the legitimate, meaningful answer *"nothing in this article bears
 * on your criterion"*, and that is the one failure a referee could not possibly
 * diagnose. docs/reusable/silent-success.md.
 *
 * A bare `Error` with a `cause`, rather than a reader-facing message, because
 * this module is deliberately free of everything: the route that calls it owns
 * the sentence the reader sees (src/messages.ts).
 */
export class UnreadableResults extends Error {
  constructor(cause: string) {
    super("The model's answer could not be read as a list of results.", { cause });
    this.name = "UnreadableResults";
  }
}

/**
 * The results worth keeping, and an account of what was thrown away.
 *
 * `kind` is the **criterion's** kind and is stamped onto every result, rather
 * than read from the model's reply — a model that answers `"kind":"diverging"`
 * to a `single` criterion must not be able to mint a row whose shape nothing
 * downstream expects.
 *
 * The order of the checks matters in one place, and it is the same place it
 * matters in `validateHits`: the quote is checked against `block.text` with
 * `findQuote` before anything else is believed, so a result that survives here
 * is one the reading view can draw.
 */
export function validateResults(
  raw: unknown,
  kind: RefereeCriterionKind,
  blocks: Block[],
): { results: RefereeResult[]; dropped: DroppedResults } {
  const list = (raw as { results?: unknown } | null | undefined)?.results;
  if (!Array.isArray(list)) throw new UnreadableResults("results-not-an-array");

  const dropped = noneDropped();
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const results: RefereeResult[] = [];

  for (const item of list) {
    const row = (item ?? {}) as Record<string, unknown>;
    const { blockId, quote, confidence, reasoning } = row;
    if (typeof blockId !== "string" || typeof quote !== "string") continue;

    const block = byId.get(blockId);
    if (!block) {
      dropped.unknownIds++;
      continue;
    }
    /* The default pass, matching `validateHits`. src/quote-match.ts § `passes`
       records that both of these should arguably use `"spaced"`, because both
       store a quotation, and that changing them is a separate landing with its
       own artefacts to migrate. Copying the current behaviour keeps the two
       call sites one decision rather than one and a half. */
    const span = findQuote(block.text, quote);
    if (!span) {
      dropped.unquoted++;
      continue;
    }

    const rawConfidence =
      typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 50;
    if (rawConfidence <= 1) dropped.subOneConfidence++;
    const bounded = clampConfidence(rawConfidence);
    if (bounded !== Math.round(rawConfidence)) dropped.clampedConfidence++;

    const anchored = {
      blockId,
      // The article's words, not the model's retyping — the guarantee this
      // validation exists to give. `validateHits` says why in full.
      quote: block.text.slice(span.start, span.end),
      confidence: bounded,
      reasoning: typeof reasoning === "string" ? reasoning.trim() : "",
      start: span.start,
    };

    if (kind === "single") {
      results.push({ kind, ...anchored });
      continue;
    }

    if (kind === "diverging") {
      const rawValence =
        typeof row["valence"] === "number" && Number.isFinite(row["valence"])
          ? (row["valence"] as number)
          : 0;
      if (rawValence !== 0 && Math.abs(rawValence) <= 1) dropped.subOneValence++;
      const valence = clampValence(rawValence);
      if (valence !== Math.round(rawValence)) dropped.clampedValence++;
      results.push({ kind, ...anchored, valence });
      continue;
    }

    const citations = readCitations(row["citations"]);
    if (citations.length === 0) {
      dropped.uncited++;
      continue;
    }
    const rawSearches = row["searches"];
    const searches =
      typeof rawSearches === "number" && Number.isFinite(rawSearches) && rawSearches >= 0
        ? Math.round(rawSearches)
        : 0;
    results.push({ kind, ...anchored, citations, searches });
  }

  if (results.length > MAX_RESULTS) {
    dropped.truncated = results.length - MAX_RESULTS;
    results.length = MAX_RESULTS;
  }
  return { results, dropped };
}

/**
 * The citations that are worth storing.
 *
 * `isWebUrl` is the same gate every other piece of model output crosses on its
 * way to an `href` (src/urls.ts), and it is applied **here**, before storage,
 * so the panel is not the last line of defence. A missing or empty title is
 * dropped rather than stored blank, following `Citation` (src/types.ts), where
 * the field is optional precisely because the provider does not always send one.
 */
export function readCitations(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return [];
  const out: Citation[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const { url, title } = (item ?? {}) as Record<string, unknown>;
    if (typeof url !== "string" || !isWebUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const trimmed = typeof title === "string" ? title.trim() : "";
    out.push(trimmed === "" ? { url } : { url, title: trimmed });
    if (out.length >= MAX_CITATIONS) break;
  }
  return out;
}

/* ----------------------------------------------------------- the criterion -- */

/**
 * Is this a criterion the mode can actually run?
 *
 * Two rules, and the second is the one the database also holds
 * (`referee_criteria_poles`, drizzle/0042): a `diverging` criterion without both
 * poles has no meaning for its own valence — the number would be signed against
 * nothing, and the panel could not print "counts for" or "counts against" in
 * words, which docs/project/colour-scales.md requires.
 *
 * Returns the reason rather than a boolean, so a caller can say which half is
 * missing instead of "invalid".
 */
export function criterionProblem(criterion: {
  criterion: string;
  config: RefereeCriterionConfig;
}): string | null {
  if (criterion.criterion.trim() === "") return "A criterion needs something written in it.";
  if (criterion.config.kind === "diverging") {
    const { against, favour } = criterion.config.poles;
    if (against.trim() === "" || favour.trim() === "") {
      return "A criterion with two ends needs a word for each end.";
    }
  }
  return null;
}

/**
 * The config as it goes into the row's two pole columns, and back.
 *
 * **Columns rather than a JSONB blob**, because docs/project/sql.md says the
 * default is a column and a blob has to argue for itself, and a pole is a short
 * string the database can constrain: `referee_criteria_poles` in drizzle/0042
 * makes "both or neither, and only when diverging" a fact rather than a
 * convention. The results are the JSONB, and they earn it — one model call's
 * wholesale output, replaced together, never edited one at a time, exactly as
 * `search_runs.hits`.
 */
export function configFromRow(row: {
  kind: string;
  poleAgainst: string | null;
  poleFavour: string | null;
  scale: string | null;
}): RefereeCriterionConfig | null {
  if (!isRefereeCriterionKind(row.kind)) return null;
  if (row.kind !== "diverging") return { kind: row.kind };
  if (row.poleAgainst === null || row.poleFavour === null) return null;
  return {
    kind: "diverging",
    poles: { against: row.poleAgainst, favour: row.poleFavour },
    /* A scale the database does not recognise falls back to the default rather
       than refusing the row — the same shape as `search_runs.colour`, whose
       check is deliberately looser than the palette so that a value from a
       later version is ignored instead of breaking a reader's saved work. */
    scale: isDivergingScale(row.scale) ? row.scale : DEFAULT_DIVERGING_SCALE,
  };
}

export function configToRow(config: RefereeCriterionConfig): {
  kind: RefereeCriterionKind;
  poleAgainst: string | null;
  poleFavour: string | null;
  scale: DivergingScale | null;
} {
  return config.kind === "diverging"
    ? {
        kind: "diverging",
        poleAgainst: config.poles.against,
        poleFavour: config.poles.favour,
        scale: config.scale,
      }
    : { kind: config.kind, poleAgainst: null, poleFavour: null, scale: null };
}

/* ------------------------------------------------- the referee's own mark -- */

/**
 * **The referee's own placement of a passage on a criterion's scale, and the
 * gap between it and the model's.**
 *
 * Greg, 2026-08-31: *"I'm keen to also include some kind of ranked red, green,
 * and/or red-green-spectrum, for a range of criteria defined by the user,
 * perhaps harmonising with the ability for the user to comment (perhaps
 * quantitatively) on things."*
 *
 * **Two valences, never one.** The referee's mark and the model's are stored in
 * different places entirely — theirs on `comments` (`criterion_id` + `valence`,
 * drizzle/0043), the model's on a `DivergingResult` here — and they are never
 * averaged, reconciled or shown as one number. The whole value is in the gap:
 * a passage the referee scored +70 and the model scored −40 is a disagreement
 * about the paper, and it is the most interesting row in the mode. Averaging
 * them, or letting one overwrite the other, deletes exactly the thing worth
 * looking at.
 *
 * It also cannot be used to avoid reading, which is the point Greg's opening
 * message was about: you cannot appear in the disagreement list without having
 * placed the passage yourself first.
 */
export function valenceGap(referee: number, model: number): number {
  return Math.abs(clampValence(referee) - clampValence(model));
}

/**
 * Is this a placement the database will accept?
 *
 * Mirrors `comments_valence_range` and `comments_valence_needs_criterion` in
 * drizzle/0043 — a placement with nothing to place it on is meaningless, and a
 * comment answering a criterion without a number is fine (they wrote prose and
 * did not score it).
 */
export function markProblem(mark: {
  criterionId: string | null;
  valence: number | null;
}): string | null {
  if (mark.valence === null) return null;
  if (mark.criterionId === null) return "A placement has to say which criterion it is placing.";
  if (mark.valence < -100 || mark.valence > 100) return "A placement runs from −100 to +100.";
  if (!Number.isInteger(mark.valence)) return "A placement is a whole number.";
  return null;
}

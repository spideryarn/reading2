/**
 * **The dossier's words and order, without React** — what Sources ›
 * Investigate's *Where this piece sits* says about a stored `Situate`
 * (src/types.ts), kept here so the tests can hold each rule without mounting
 * the panel. The section itself is SituateDossier.tsx. Plan
 * docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md
 * § The dossier, at the top of Investigate.
 */
import {
  MAX_LENS_CHARS,
  SITUATE_FINDING_KINDS,
  type Situate,
  type SituateAngle,
  type SituateFinding,
  type SituateFindingKind,
  type SituateKind,
  type SituateQueryGroup,
  type SituateQueryOutcome,
  type SituateSearched,
} from "../types.js";

/** The section's heading. */
export const SITUATE_HEAD = "Where this piece sits";
/** Before it has run: what a press does, in one sentence. */
export const SITUATE_WHAT =
  "Searches the web and the papers that cite this piece, then marks the passages that later work challenges, supports or has moved on from.";
/** The button that starts it, and the one that starts it again. */
export const SITUATE_RUN = "Search the literature";
export const SITUATE_AGAIN = "Search again";
/**
 * **What leaves, said before the press** (plan § Privacy, GPT Sol's S4). The
 * piece's own words go to a search engine, which none of Investigate's other
 * presses does before the reader has typed or picked a question.
 */
export const SITUATE_DISCLOSURE =
  "Pressing it sends this piece through OpenRouter to an AI, which writes short searches from its text. Those searches go through OpenRouter to Exa, a web search engine; its DOI or title goes to OpenAlex to find papers that cite it. The article, results and what you wrote about yourself or why you are reading then go through OpenRouter to the AI that writes the dossier.";
/** While the job runs. */
export const SITUATE_WORKING = "This takes a few minutes. You can keep reading; the findings appear here when it is done.";
/** The stale banner's words. */
export const SITUATE_STALE =
  "The article has changed since this search ran, so some of these may be about something the piece no longer says.";
/** `outcome: "nothing-found"`: what the searches did, never "all clear". */
export const SITUATE_NOTHING_FOUND =
  "The searches ran and found nothing about this piece that could be checked against its text, so there is nothing to show. That does not mean nobody has written about it.";
/** At the foot of *What was searched*. */
export const SITUATE_ABSENCE =
  "Finding nothing is not the same as there being nothing: a search engine misses a lot, and the newest work is often not indexed yet.";
/** The two names of a finding's chat button and its mark. */
export const ASK_FINDING_IN_CHAT = "Ask about this finding in chat";
export const OPEN_FINDING_CHAT = "Open the chat about this finding";
/** The second heading: the model's questions, above Investigate's fixed ones. */
export const SITUATE_QUESTIONS_HEAD = "Suggested for this piece";
/** A source's toggle, closed and open: the checked quote is one press away. */
export const SITUATE_SOURCE_SAYS = "What it says";

/** Each kind's label, readable, in the reader's order. A `?` where the finding is a question for the reader to weigh. */
export const SITUATE_FINDING_LABEL: Record<SituateFindingKind, string> = {
  challenged: "Challenged",
  citation: "Citation?",
  since: "Since",
  missing: "Not cited?",
  reception: "Reception",
  supported: "Supported",
};

/** What each kind means, for the group heading's tooltip. */
export const SITUATE_FINDING_TIP: Record<SituateFindingKind, string> = {
  challenged: "Later work that disputes or fails to reproduce what this passage says.",
  citation: "A work cited here whose own abstract does not appear to say what the passage uses it for.",
  since: "Work published after the piece that changes or adds to the picture.",
  missing: "Relevant work the piece does not cite.",
  reception: "How others have responded to the piece itself.",
  supported: "Later work that bears this passage out.",
};

const KIND_NOUN: Record<SituateKind, string> = {
  empirical: "A study",
  theory: "A theoretical piece",
  review: "A review",
  position: "A position piece",
  news: "A news piece",
  other: "A piece",
};

const ANGLE_WORDS: Record<SituateAngle, string> = {
  since: "what has happened since",
  now: "where it sits now",
};

/**
 * **The dossier's first line**: what the planner judged the piece to be, when,
 * and so what the search looked for — *A review from 2023: what has happened
 * since*. A year the planner could not tell is left out rather than guessed.
 */
export function situateHeadLine(situate: Pick<Situate, "kind" | "year" | "angle">): string {
  const noun = KIND_NOUN[situate.kind] ?? KIND_NOUN.other;
  const when = typeof situate.year === "number" && Number.isFinite(situate.year) ? ` from ${situate.year}` : "";
  return `${noun}${when}: ${ANGLE_WORDS[situate.angle] ?? ANGLE_WORDS.now}`;
}

export interface FindingGroup {
  kind: SituateFindingKind;
  label: string;
  findings: SituateFinding[];
}

/**
 * **The findings, grouped by kind in the order a reader most needs them**
 * (`SITUATE_FINDING_KINDS`), each group in the stored order, which is
 * strongest first. An empty kind has no group: a heading over nothing would
 * read as a finding. A kind the client does not know is left out.
 */
export function groupFindings(findings: readonly SituateFinding[]): FindingGroup[] {
  return SITUATE_FINDING_KINDS.map((kind) => ({
    kind,
    label: SITUATE_FINDING_LABEL[kind],
    findings: findings.filter((f) => f.kind === kind),
  })).filter((g) => g.findings.length > 0);
}

/** `Challenged · 3`: a group heading with its count. */
export function groupHeading(group: Pick<FindingGroup, "label" | "findings">): string {
  return `${group.label} · ${group.findings.length}`;
}

function clip(text: string, max: number): string {
  const words = text.replace(/\s+/g, " ").trim();
  if (words.length <= max) return words;
  return `${words.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

const LENS_OPEN = "About “";
const LENS_MID = "”, a search of the literature found: ";
const LENS_CLOSE = " How strong is that, and what else bears on it?";
const LENS_QUOTE_MAX = 160;

/**
 * **What *Ask in chat* on a finding asks**, which is also the lens its chat
 * stores (`{ mode: "reception", lens }`), so it is listed under *Your
 * questions* and found again by `threadForOrigin`. The passage, the note and a
 * question, the note cut to fit `MAX_LENS_CHARS` so the question at the end
 * survives. Already trimmed and within the cap, so Reader.tsx § `lensInChat`,
 * which trims and cuts, stores exactly these characters and the mark finds it.
 */
export function findingLens(finding: Pick<SituateFinding, "quote" | "note">): string {
  const quote = clip(finding.quote, LENS_QUOTE_MAX);
  const room = MAX_LENS_CHARS - LENS_OPEN.length - quote.length - LENS_MID.length - LENS_CLOSE.length;
  const note = clip(finding.note, room);
  return `${LENS_OPEN}${quote}${LENS_MID}${note}${LENS_CLOSE}`.trim();
}

export const SITUATE_GROUP_LABEL: Record<SituateQueryGroup, string> = {
  piece: "the piece",
  claim: "a claim",
  citation: "a citation",
  missing: "an omission",
};

export const SITUATE_OUTCOME_LABEL: Record<SituateQueryOutcome, string> = {
  found: "found pages",
  empty: "found nothing",
  "no-search": "did not search",
  failed: "failed",
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * **The fold's summary line**: *16 searches (15 ran), 76 pages, 40 later
 * papers*. "Ran" counts the searches that searched — found pages or found
 * nothing — so a failed or unproven one is not counted as having looked.
 */
export function searchedLine(searched: SituateSearched): string {
  const queries = searched.queries.length;
  const ran = searched.queries.filter((q) => q.outcome === "found" || q.outcome === "empty").length;
  const parts = [`${plural(queries, "search", "searches")}${ran === queries ? "" : ` (${ran} ran)`}`];
  parts.push(plural(searched.pages, "page", "pages"));
  parts.push(plural(searched.citers, "later paper", "later papers"));
  if (searched.cited > 0) parts.push(plural(searched.cited, "cited abstract", "cited abstracts"));
  return parts.join(", ");
}

/** Why no later papers were read, when none were. */
export const SITUATE_CITERS_SKIPPED: Record<NonNullable<SituateSearched["citersSkipped"]>, string> = {
  "no-identity": "No later papers were read: the piece has no DOI or title OpenAlex could find it by.",
  unconfirmed: "No later papers were read: OpenAlex’s record could not be confirmed as this piece.",
  "not-indexed": "No later papers were read: OpenAlex does not list this piece.",
  unavailable: "No later papers were read: OpenAlex did not answer.",
};

/** The host of a source's address, for its link: `www.nature.com` → `nature.com`. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

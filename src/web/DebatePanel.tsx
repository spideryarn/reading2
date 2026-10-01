/**
 * The debate, in the band between the spine and the prose — the fourteenth
 * mode, and the only one whose content is **not in the article at all**.
 *
 * Greg, 2026-09-05, asking for it:
 *
 * > Let's add a new mode … that gathers from the wider web about the article,
 * > e.g. reviews, critiques, etc (ideally from authoritative sources). … Provide
 * > citation/linking, with rich tooltips (e.g. with excerpts).
 *
 * Everything else in this band is derived from the piece. This goes out to the
 * open web and comes back with what other people have written — replies to this
 * piece, and the argument around the claims it makes. Full design in
 * docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md.
 *
 * ## The one thing to understand before reading any of it
 *
 * **The web search never comes back empty.** Stage 0 asked for pages responding
 * to an invented blog post at a domain that does not exist; three searches ran
 * and nine annotations came back, every one a real, correctly-cited page about
 * sourdough starters, and not one of them a response to anything. So *"nothing
 * found"* is not a state the wire produces — it is a state **we manufacture, by
 * refusing rows** (src/debate.ts).
 *
 * That is why this panel is mostly sentences. Four rows look exactly the same
 * whether the stage refused six or refused none, so nearly everything here that
 * is not a row is a disclosure: what the search returned, what survived, what
 * the quotations were checked against, and **which** of the two empty answers
 * this is.
 *
 * ## One list, in the order the reader picks
 *
 * Two separately metered searches run — one for pages replying to this piece,
 * one for the argument around what it claims — and until 2026-09-06 the panel
 * drew them as two headed groups. **That split was our epistemics, not the
 * reader's question.** On Cargo Cult Science it produced two headings, two
 * blurbs, an empty-state paragraph and two foot lines stacked over *zero rows*,
 * followed by the three rows that were the actual product.
 *
 * Since 2026-09-29 (SPIDERYARN-READING2-5P) the reader picks the order —
 * `?debateby=`, Glossary's sort bar — and the rules live in
 * [`debate-order.ts`](debate-order.ts): *by claim* groups the rows under the
 * claim in the piece each one answers, in article order, with the rows about
 * this piece first; *stance* is one flat list, most critical first;
 * *prioritised* and *date* arrive with stage 2's data. **No order is by
 * identification level**, because the chip on the row already says it.
 *
 * **A heading is a claim we stand behind**, which is why the only headings are
 * *About this piece* and the article's own words for a claim — located in its
 * block before the row was kept. Grouping by `relation`, or by stance, would
 * put the model's reading of a stranger's page in a heading; so stance is an
 * order and never a grouping, and the model's readings stay inside rows.
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md § 1,
 * docs/plans/260929h-debate-mode-clearer-sources-and-orders.md.
 *
 * ## What a row says, top to bottom
 *
 *  1. **The work: its title**, the headline and the link out; with no title,
 *     the address. Under it the site — Greg asked for *"ideally from
 *     authoritative sources"* and there is no honest way to rank authority
 *     (any list we maintain is wrong per domain, and on an ML paper the
 *     sharpest critique is routinely a pseudonymous blog), so the one
 *     authority signal a reader can judge stays on every row. The title and
 *     the site are the wire's, never the model's.
 *  2. **The model's reading, one line, labelled *AI***: `relation` and `lean`.
 *     It is what a reader decides with, so it comes before the quotation
 *     rather than after it; its paragraph (`applies`, `limits`) is behind
 *     `more`, inside a fence labelled *AI interpretation*. Nothing in the
 *     returned evidence verifies any of it, and drawing it like the quotation
 *     would claim it is as checkable (the plan's § Attribution, rule 5).
 *  3. **The quotation**, characters located in that page's own extract by the
 *     spaced matcher and stored as the *haystack's* spelling rather than the
 *     model's. It is the reader's one-action check.
 *
 * `more` holds everything else the ⓘ hover card used to: the full title and
 * quotation, the AI's paragraph, the address, a direct row's witness, what the
 * quotation was checked against, and the way out. A button with
 * `aria-expanded`, so a tap and a keyboard get what a pointer gets — the card
 * was a portalled dialog a keyboard reader tabbed past (the plan's F12).
 *
 * ## The lean is a direction with an icon, never a score
 *
 * Greg: *"Maybe we could also apply a positive/negative icon and red/green
 * colour scheme, but without a score, but it is useful to be able to see at a
 * glance where the critiques vs praise are"*. So: no percentage, no bar, no
 * number anywhere. A *"62% negative"* line hands the reader a verdict on a piece
 * they are in the middle of reading, which is the summary-shaped failure
 * docs/project/vision.md exists to refuse.
 *
 * And `neither` and `cannot-tell` are drawn **as calmly as the other two** — same
 * chip, same size, same words, a quiet colour rather than a warning one. A model
 * that cannot tell whether a page agrees should say so and be believed; the
 * closest thing in this app to that problem is docs/project/timeline.md's rule
 * about an undated row.
 *
 * ## The visitor's half, since 2026-09-29
 *
 * `DebateAccess` has two arms. The visitor's waited for the contract its rows
 * must not bypass — `publicCitationUrl` re-judging every URL at the boundary,
 * where a refusal drops the whole row — which a GPT Sol review (F23) refused to
 * have built after the panel. Stage 4 built it (src/public/dto.ts §
 * `publicDebate`, plan 260929c), and a visitor's panel draws the stored rows
 * with no job, no verb and no read: nothing on it can start a search.
 */
import { useId, useMemo, useState } from "react";
import {
  ChevronDown,
  CircleHelp,
  Equal,
  ExternalLink,
  Globe,
  type LucideIcon,
  RotateCcw,
  Star,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import {
  DEBATE_CLAIMS_FOLLOW,
  DEBATE_CLAIMS_NONE,
  DEBATE_EXTRACTS_ONLY,
  DEBATE_ORDER_BY_CLAIM,
  DEBATE_ORDER_DATE,
  DEBATE_ORDER_PRIORITISED,
  DEBATE_ORDER_STANCE,
  DEBATE_RESPONSES_NONE,
  DEBATE_CLAIMS_NONE_SHARED,
  DEBATE_RESPONSES_NONE_SHARED,
  DEBATE_UNDATED,
  DEBATE_THREADS_FAILED,
  DEBATE_UNJUDGED,
  debateClaimsUnverified,
  debateResponsesUnverified,
  debateWithheldOnSharedLink,
  debateWorkFieldsNote,
} from "../messages.js";
import {
  type BlockId,
  type Debate,
  type DebateBears,
  type DebateCounts,
  type DebateKeySource,
  type DebateLean,
  type IdentificationLevel,
  distinctSources,
  identificationLevel,
  identifiesOf,
  lossesOf,
  readStoredLean,
} from "../types.js";
import { BlockRef } from "./BlockRef.js";
import {
  DEBATE_LEVEL_DEFAULT,
  IDENTIFICATION_STOPS,
  visibleDirect,
} from "./debate-levels.js";
import {
  type DebateGroup,
  type DebateOrder,
  RELEVANCE_DEFAULT,
  RELEVANCE_STOPS,
  debateOrderOptions,
  effectiveDebateOrder,
  orderDebateRows,
  readAuthors,
  readBears,
  readPublishedYear,
  readWorkTitle,
  visibleClaims,
} from "./debate-order.js";
import {
  inThread,
  KEY_ROLE_LABEL,
  keyByRow,
  selectedThread,
  shownInThread,
  type Thread,
  threadsOf,
} from "./debate-threads.js";
import { readStoredSynthesis } from "../debate-synthesis.js";
import { hiddenNote, type ThresholdNoun, type ThresholdResult } from "./threshold.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { Tooltip } from "./Tooltip.js";
import { useRenderCount } from "./perf.js";
import type { UseDebate } from "./useDebate.js";
import type {
  PublicClaimDebateRow,
  PublicDebate,
  PublicDirectDebateRow,
  PublicIdentificationSignal,
} from "../public-types.js";

/**
 * **A row as this panel draws it** — the owner's stored row and a visitor's
 * public one alike. The public types are the narrower shape (a `linked`
 * signal's address may be gone, `lean` is always in the current vocabulary),
 * and every owner's `DirectDebateRow` and `ClaimDebateRow` is one of these, so
 * the owner's path is unchanged. Since 2026-09-29, plan 260929c stage 4.
 */
type DirectRow = PublicDirectDebateRow;
type ClaimRow = PublicClaimDebateRow;

/** Either search's row, so one component can draw both. */
type DebateRow = DirectRow | ClaimRow;

/**
 * **Which of the two searches a sentence is about**, in the reader's terms
 * rather than ours.
 *
 * The headings used to carry this and there are no headings any more, so every
 * foot line has to name its own search. Not *"group one"* and not *"the direct
 * pass"*: a reader has never heard of either.
 */
const SEARCH_NAME: Record<"direct" | "claims", string> = {
  direct: "The search for replies to this piece",
  claims: "The search for answers to what it claims",
};

/**
 * **What the bar is holding back, in one word** — and it is deliberately not
 * *pages*.
 *
 * Three counts can be on this screen at once (`DebatePanel` § `pages`), and two
 * of them are already page counts: the head's *pages behind the rows on screen*,
 * and the searches' *pages returned*. A third noun for a third fact would be a
 * panel with three numbers all called pages, so this one uses the word the
 * lead sentence already uses for what a direct row **is** — a page that
 * *responds* to this piece — and counts rows rather than pages, which is also
 * what it is hiding.
 *
 * docs/project/copy.md records the app already carrying *"two nouns for the same
 * thing, and nobody has decided which"* on the waiting copy, and calls that
 * half unsettled. This is not the place to add a third.
 */
const RESPONSE: ThresholdNoun = { one: "response", many: "responses" };

/**
 * **What the relevance bar is holding back**: claim rows, called by what they
 * are — answers to what the piece claims — and not *responses*, which is the
 * identification bar's word for rows about the piece itself. Two bars over
 * disjoint rows, so two nouns (the plan's F7).
 */
const ANSWER: ThresholdNoun = { one: "answer to its claims", many: "answers to its claims" };

/**
 * **The relevance bar's words**, and the AI line's: the name of the stop, never
 * a number (`debate-levels.ts`'s argument for `?name=`). On the bar it reads as
 * a rule — *"bears partly · 3 of 5"*, at least partly — and on a row as the
 * judgment.
 */
const BEARS_LABEL: Record<DebateBears, string> = {
  directly: "bears directly",
  partly: "bears partly",
  loosely: "bears loosely",
};

/**
 * **A module constant rather than a fresh `[]`**, because the memo that applies
 * the bar keys on it by identity. `NO_QUOTES` in App.tsx is the same call.
 */
const NO_DIRECT: readonly DirectRow[] = [];
/** …and the same for the claim rows, which the order memos key on. */
const NO_CLAIMS: readonly ClaimRow[] = [];

/** The rows that answer a claim the article makes. */
function claimOf(row: DebateRow): ClaimRow | null {
  return "claimQuote" in row ? row : null;
}

/**
 * The rows that name this article in their own extract — the ones that carry
 * `identifies`, and therefore the ones with a level to put on a chip.
 */
function directOf(row: DebateRow): DirectRow | null {
  return "articleReferenceQuote" in row ? row : null;
}

/** The witness that a page names this article, for the row's `more`. */
function referenceOf(row: DebateRow): string | null {
  return directOf(row)?.articleReferenceQuote ?? null;
}

/**
 * **How each lean is drawn, and the record is total.**
 *
 * Four rows because there are four values, and a `Record<DebateLean, …>` so
 * a fifth cannot be added without somebody deciding what it looks like. The
 * *label* is what a reader actually reads — the icon is the glance and the word
 * is the meaning, so a colour-blind reader and a screen reader both get the
 * whole of it.
 *
 * **`tone` is a direction, not a position on a scale.** It resolves to two
 * colours off `--div-rg-*` (docs/project/colour-scales.md, the diverging red↔green
 * scale Greg asked for) plus one quiet grey, and it never reaches for the
 * scale's *middle* step: `--div-rg-4` is the centre of a ramp, and drawing
 * `neither` there would say *zero on a scale we do not compute*. `neither` and
 * `cannot-tell` are two different facts — *it takes a side and it is neither* against
 * *we could not tell* — with two icons and two sentences, and one calm colour,
 * because neither of them is a failure.
 *
 * **The target of the lean is the row's own**, which is why the labels do not
 * name it: the article itself on a direct row, the `claimQuote` on a claim row.
 * The row says which — the identification chip on a direct row, and on a claim
 * row its *On "…"* line or, in *by claim*, the heading it sits under. Sol's F19 —
 * without a stated target "leans-for" could mean a friendly register, agreement
 * with one claim, or praise for the whole piece.
 *
 * **The keys are agreement words and the labels are unchanged**, which is the
 * whole shape of the 2026-09-08 repair: what the reader sees is exactly what
 * they saw before, and what the *model* is asked for no longer invites it to
 * report a passage's polarity toward its own subject. src/types.ts §
 * `DebateLean`.
 */
export const LEAN_APPEARANCE: Record<
  DebateLean,
  { icon: LucideIcon; label: string; tone: "for" | "against" | "quiet" }
> = {
  "leans-for": { icon: ThumbsUp, label: "Supportive", tone: "for" },
  "leans-against": { icon: ThumbsDown, label: "Critical", tone: "against" },
  neither: { icon: Equal, label: "Neither for nor against", tone: "quiet" },
  "cannot-tell": { icon: CircleHelp, label: "Could not tell", tone: "quiet" },
};

/**
 * **What the model offered, against what survived** — or nothing when nothing
 * was lost.
 *
 * The ✧ line Quotes draws, for the same reason and with the same discipline: a
 * list quietly shorter than the model produced is the shape of failure
 * docs/reusable/silent-success.md keeps catching, and a log line does not give
 * the reader anything.
 *
 * **The reasons are not named one by one**, unlike Quotes, and that is a
 * decision rather than laziness. Seven of the eight — `uncited`, `selfSource`,
 * `unverifiedSource`, `directnessUnverified`, `claimNotInBlock`,
 * `unknownBlockId`, `malformed` — are all the same fact to a reader: *we could
 * not check this, so we did not show it*. Spelling them out would turn an honest
 * disclosure into a changelog of our own rules, which is exactly what
 * `discardedNote` next door refuses for its three editorial counters.
 *
 * **The eighth is `sourceIsCopy`, and it needs its own clause because that
 * sentence is false of it.** A mirror of the article *was* checked, and checked
 * successfully — it links the piece, it quotes it exactly, every counter reads
 * clean — and it was refused for being the article rather than a reply to it
 * (src/shingles.ts § `isCopy`). Folding it into *"could not be checked"* tells
 * the reader we failed at something we did not fail at, and hides the one loss
 * on this panel that is a judgment about the page rather than about our reach.
 * Added 2026-09-06 with the counter itself; docs/project/copy.md rule 1.
 *
 * **The cap gets a clause of its own** for the same shape of reason. A row past
 * `MAX_DIRECT_ROWS` was not refused — nothing was wrong with it, the list simply
 * stopped — so folding it in with *"could not be checked"* would tell the reader
 * something false about a row that may have been perfectly good. But it is still
 * a loss they have a stake in: a cap that stopped silently would make position a
 * ranking in a feature built to have none.
 *
 * **`which` names the search**, because the headings that used to are gone.
 *
 * **It says *kept*, not *shown*, and that changed on 2026-09-06 with the
 * identification bar.** This sentence is arithmetic about the run —
 * `reportedRows` against `keptRows`, and the gap accounted for — and the reader
 * now has a control that decides what is *shown*. *"3 are shown"* over a list of
 * two would be the count-disagrees-with-the-list failure
 * ([`threshold.ts`](threshold.ts)) arriving through the one sentence on this
 * panel whose job is to be trustworthy about counts. What the bar is holding
 * back is said by `hiddenNote`, in the reader's own terms, beside the control
 * that did it.
 */
export function keptNote(counts: DebateCounts, which: "direct" | "claims"): string | null {
  const lost = counts.reportedRows - counts.keptRows;
  if (lost <= 0) return null;
  /* `Math.max` because these are numbers off a stored artefact and this is a
     panel, not an invariant: a negative here would print "-2 could not be
     checked", which is worse than saying nothing about a count that cannot
     happen. */
  const copies = Math.max(0, Math.min(lossesOf(counts.lost).sourceIsCopy, lost - counts.omittedOverCap));
  const refused = Math.max(0, lost - counts.omittedOverCap - copies);
  const clauses: string[] = [];
  if (refused > 0) {
    clauses.push(
      `${refused} could not be checked against the page ${refused === 1 ? "it cites" : "they cite"}`,
    );
  }
  if (copies > 0) {
    clauses.push(
      `${copies} turned out to be ${copies === 1 ? "a copy" : "copies"} of this article ` +
        `rather than ${copies === 1 ? "a reply" : "replies"} to it`,
    );
  }
  if (counts.omittedOverCap > 0) {
    clauses.push(
      `${counts.omittedOverCap}${clauses.length > 0 ? " more" : ""} ` +
        `${counts.omittedOverCap === 1 ? "was" : "were"} past the limit on this list`,
    );
  }
  return (
    `${SEARCH_NAME[which]} offered ${counts.reportedRows} of these; ` +
    `${countWord(counts.keptRows)} ${counts.keptRows === 1 ? "was" : "were"} kept — ` +
    `${andList(clauses)}.`
  );
}

/**
 * *"a, and b"* for two and *"a, b, and c"* for three.
 *
 * There were only ever two clauses until `sourceIsCopy` arrived, and
 * `join(", and ")` was right for two and reads as a stutter for three.
 */
function andList(parts: readonly string[]): string {
  const last = parts[parts.length - 1];
  if (parts.length <= 1 || last === undefined) return parts.join("");
  return `${parts.slice(0, -1).join(", ")}, and ${last}`;
}

/**
 * `0` written as **none**, and every other number as itself.
 *
 * The foot lines below reach zero often — the direct search keeping nothing is
 * this mode's second-commonest output — and *"0 are shown"* is the register of a
 * dashboard rather than of a sentence. The digits stay everywhere else, because
 * a reader comparing two counts in one line wants to compare figures.
 */
function countWord(n: number): string {
  return n === 0 ? "none" : String(n);
}

/**
 * **What the search returned, against what got into the answer** — or nothing
 * when the two agree.
 *
 * This is the counter a model can walk straight past with every other one
 * reading clean, and it is Sol's F13. Annotations arrive **independently of what
 * the model says**: Stage 0's probe answered with the single word `DONE` and Exa
 * still returned ten source annotations. So a model handed evidence from ten
 * pages can report three rows, have all three validate, and `reportedRows ===
 * keptRows === 3` with no loss sentence anywhere — while seven pages never
 * entered the answer at all.
 *
 * **It counts pages, not rows.** Rows are deliberately not deduplicated by URL —
 * one review can answer two different claims, and two rows about one page is a
 * real answer — so a row count here would fire on a truth.
 *
 * **`rows` is what is on screen, which since 2026-09-06 is not always the whole
 * group.** The sentence ends *"contribute to the rows shown"*, so the direct
 * pass is handed the rows the identification bar left rather than everything the
 * run kept. A reader who raises the bar sees this number fall, and it is still
 * true; leaving it on the unfiltered list would make the words false while the
 * figure looked right.
 */
export function sourcesNote(
  counts: DebateCounts,
  rows: readonly { url: string }[],
  which: "direct" | "claims",
): string | null {
  const contributing = distinctSources(rows);
  if (contributing === counts.returnedSources) return null;
  return (
    `${SEARCH_NAME[which]} returned evidence from ${counts.returnedSources} ` +
    `${counts.returnedSources === 1 ? "page" : "pages"}; ${countWord(contributing)} ` +
    `${contributing === 1 ? "contributes" : "contribute"} to the rows shown.`
  );
}

/**
 * **The provenance under the one list**, and the reason it is four sentences
 * rather than two.
 *
 * The two foot lines used to sit under their own group, where the heading said
 * which search they were counting. One list, no headings — so the question is
 * where the numbers go, and there are only two answers. **Summing the two
 * searches into one pair of sentences is the tempting one and it is wrong**, on
 * a fact rather than on taste: `returnedSources` is *unique admissible URLs per
 * pass*, while `distinctSources` dedupes across the whole list, so one page
 * returned by both searches counts twice on the left and once on the right, and
 * the sentence fires on a truth. There is no cross-pass source count stored to
 * fix that with, and inventing one would be arithmetic over two numbers we did
 * not measure together.
 *
 * So: **both searches keep their own numbers, and every sentence names its own
 * search** (`SEARCH_NAME`). They sit once, under the last row, because that is
 * where they were — provenance you read after a list, not a control above it.
 * Direct before claims, matching the order of the rows.
 *
 * **Losing one of these is the single unacceptable outcome**
 * (docs/reusable/silent-success.md): between them these four sentences carry
 * every counter this panel has — what the search returned against what
 * contributed, what the model offered against what survived, and each of the
 * three kinds of loss inside that gap. `keptNote` fires on
 * `reportedRows - keptRows` rather than on a sum of reasons, so a **new** loss
 * reason reaches the reader through the total on the day it is added, even if
 * nobody writes it a clause. What checks that is not the compiler: it is
 * tests/debate-panel.test.tsx § *"puts every loss reason there is into a
 * sentence the reader gets"*, which walks every field of `DebateLosses` and
 * fails on one the sentence cannot account for.
 */
function footLines(debate: {
  direct: { rows: readonly { url: string }[]; counts: DebateCounts };
  claims: { rows: readonly { url: string }[]; counts: DebateCounts };
}): string[] {
  return [
    keptNote(debate.direct.counts, "direct"),
    sourcesNote(debate.direct.counts, debate.direct.rows, "direct"),
    keptNote(debate.claims.counts, "claims"),
    sourcesNote(debate.claims.counts, debate.claims.rows, "claims"),
  ].filter((line): line is string => line !== null);
}

/**
 * Which of the two a debate on this panel is. The public one is the only one
 * with a boundary count on its groups; the owner's has the stored `counts`.
 */
function isShared(debate: Debate | PublicDebate): debate is PublicDebate {
  return "sourceNotPublishable" in debate.direct;
}

/**
 * **A visitor's lead sentence** — `leadNote`'s shape, without the count.
 *
 * The owner's sentence tells *nothing came back* from *nothing could be
 * checked* off `returnedSources`, which does not cross; so a visitor's empty
 * search gets the sentence true of both. **And a group emptied by the public
 * boundary gets no lead at all**: the search *did* keep something there, and
 * saying it kept nothing would be false — the foot line says what was withheld.
 */
export function sharedLeadNote(debate: PublicDebate): string | null {
  const noDirect = debate.direct.rows.length === 0 && debate.direct.sourceNotPublishable === 0;
  const noClaims = debate.claims.rows.length === 0 && debate.claims.sourceNotPublishable === 0;
  const parts: string[] = [];
  if (noDirect) parts.push(DEBATE_RESPONSES_NONE_SHARED);
  if (noClaims) parts.push(DEBATE_CLAIMS_NONE_SHARED);
  else if (noDirect && debate.claims.rows.length > 0) parts.push(DEBATE_CLAIMS_FOLLOW);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * **A visitor's foot line: what the shared link left out, per search** — the
 * boundary's own count (src/public/dto.ts § `publicDebate`), never the
 * artefact's. 260905f § What is counted: a shorter list must say so.
 */
export function withheldLines(debate: PublicDebate): string[] {
  const lines: string[] = [];
  if (debate.direct.sourceNotPublishable > 0) {
    lines.push(debateWithheldOnSharedLink(SEARCH_NAME.direct, debate.direct.sourceNotPublishable));
  }
  if (debate.claims.sourceNotPublishable > 0) {
    lines.push(debateWithheldOnSharedLink(SEARCH_NAME.claims, debate.claims.sourceNotPublishable));
  }
  return lines;
}

/**
 * **When the search ran, as a date.**
 *
 * Exported so a test can assert the panel's own spelling rather than pinning
 * `en-GB` — the browser's locale decides the word order and a test that hardcodes
 * one is testing the box it runs on.
 *
 * The string is unchanged if it does not parse. That cannot happen from
 * `src/debate.ts`, which writes `new Date().toISOString()`, but this is the only
 * function that reads the artefact's date characters and an odd string beats
 * `Invalid Date`.
 */
export function searchedOn(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * **The site a row came from**, on the line under the row's title — or the
 * row's headline's stand-in when the search gave no title (`addressOf`).
 *
 * `www.` goes, because it is four characters of nothing on the one string this
 * panel asks the reader to judge. A URL that will not parse is shown whole —
 * it cannot happen, since every stored URL came out of `isWebUrl`, but the
 * fallback is a string rather than a throw inside a list.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * **A row's headline when the search gave it no title**: the address without
 * its scheme, which says more about what the page is than the host alone
 * (`arxiv.org/pdf/1809.10635` against `arxiv.org`). The site line under it is
 * then left off, because it would repeat the headline's first word.
 */
export function addressOf(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

/**
 * **The head's count: excerpts, and the pages they come from when that
 * differs** — the plan's F13.
 *
 * Rows are deliberately not deduplicated by URL (one review can answer two
 * claims), so a bare *"6 pages"* over six rows from five pages undercounted the
 * list and a bare row count would overstate the web's reach. So both, when they
 * differ: *"6 excerpts from 5 pages"*; one number when they agree. An excerpt
 * is what a row is — a quotation from a page — which is also why the word is
 * not *sources*.
 */
export function headCount(rows: readonly { url: string }[]): string {
  const n = rows.length;
  const pages = distinctSources(rows);
  const excerpts = `${n} ${n === 1 ? "excerpt" : "excerpts"}`;
  return pages === n ? excerpts : `${excerpts} from ${pages} ${pages === 1 ? "page" : "pages"}`;
}

/**
 * **What the order on screen is, in a sentence** — one per order, after
 * *"Searched on …"*. `messages.ts` § `DEBATE_ORDER_BY_CLAIM` has the argument.
 * A `Record`, so a fifth order cannot arrive without a sentence.
 */
const ORDER_SENTENCE: Record<DebateOrder, string> = {
  prioritised: DEBATE_ORDER_PRIORITISED,
  claim: DEBATE_ORDER_BY_CLAIM,
  date: DEBATE_ORDER_DATE,
  stance: DEBATE_ORDER_STANCE,
};

/** The order bar's words — Glossary's register, short and lower-case. */
const ORDER_OPTION: Record<DebateOrder, { label: string; title: string }> = {
  prioritised: {
    label: "prioritised",
    title:
      "Rows about this piece first, then the AI's judgment of how directly each bears on its claim — the relevance bar below decides how many",
  },
  claim: {
    label: "by claim",
    title: "Under the claim in the piece each page answers, in the order the piece makes them",
  },
  date: { label: "date", title: "Oldest first, by the year the AI read off each page" },
  stance: { label: "stance", title: "Most critical first — the AI's reading of each page" },
};

/**
 * **Where the lead sentence goes, now that it is not always at the top.**
 *
 * The plan (§ Smaller fixes, F10) moves the negative result out of the way of
 * the rows it is not about — but *what* it says and *when* are `leadNote`'s and
 * `sharedLeadNote`'s, unchanged. Only the place moves, and the place follows
 * from the words:
 *
 *  - **`alone`** — no rows on screen, so it is the answer, at the top.
 *  - **`before`** — it ends *"What follows takes up what it argues"*
 *    (`DEBATE_CLAIMS_FOLLOW`), which is a hand-over to the rows below it and is
 *    false anywhere else. In *by claim* it is the body of the *About this
 *    piece* group, which is where a reader looks for replies to the piece.
 *  - **`after`** — anything else is a finding about a search whose rows are not
 *    on screen, said after the list and before the foot lines.
 */
export function leadPlacement(lead: string, rowsOnScreen: number): "alone" | "before" | "after" {
  if (rowsOnScreen === 0) return "alone";
  return lead.endsWith(DEBATE_CLAIMS_FOLLOW) ? "before" : "after";
}

/**
 * **What one search says when it kept no rows**, and it is two sentences rather
 * than one.
 *
 * Collapsing them is the single thing most worth getting right in this panel
 * (docs/reusable/silent-success.md). *The search came back with no pages* and
 * *the search came back with pages we could not verify* are different facts
 * about the world, and the second is the common one: every quotation is checked
 * against the extract the **search engine** chose, which ran 236–4,945
 * characters in the Stage 0 measurements, so a real and apt quotation outside
 * that slice loses its row (Sol's F18).
 *
 * **The predicate is `returnedSources`, not a loss counter**, and that is a
 * refinement of the plan rather than a departure from it. Its § 2 table names
 * `unverifiedSource` for the middle row; `returnedSources` — added by the same
 * review, for F13 — is the field that actually answers *did the search come back
 * with anything to look at*, and it stays right in the case a loss counter gets
 * wrong: a model handed six pages that reports **no rows at all** loses nothing
 * to any counter, and would be told the search found nothing. That would be
 * false.
 *
 * The third empty state is not here: a failed pass writes no artefact at all, so
 * there is no search to be empty. The panel shows the ordinary job-failure state
 * with its retry, which is what `JobProgress` already draws.
 *
 * **A fourth is coming and is deliberately not here either**: every row hidden
 * by the identification threshold, which is Stage P3's `hiddenNote`. That is a
 * fact about the reader's own setting rather than about the search, so it does
 * not belong in a sentence whose subject is what came back.
 */
export function emptyGroupNote(counts: DebateCounts, group: "direct" | "claims"): string {
  if (counts.returnedSources === 0) {
    return group === "direct" ? DEBATE_RESPONSES_NONE : DEBATE_CLAIMS_NONE;
  }
  return group === "direct"
    ? debateResponsesUnverified(counts.returnedSources)
    : debateClaimsUnverified(counts.returnedSources);
}

/**
 * **The one sentence at the top of the one list** — or nothing, when both
 * searches kept something and there is no negative result to report.
 *
 * Up to two clauses, because there are two searches and either can come back
 * with nothing. The direct one leads, because *"no page responds to this piece
 * by name"* is the finding a reader of a famous article is most likely to be
 * surprised by, and because what follows it is the answer to *"then what am I
 * looking at?"* — `DEBATE_CLAIMS_FOLLOW`, appended only when there is in fact
 * something below to look at.
 *
 * **Both are said when both are empty.** They are two searches and two facts,
 * and dropping the second because the first already sounds negative is how a
 * panel comes to say less than it knows.
 */
export function leadNote(debate: {
  direct: { rows: readonly unknown[]; counts: DebateCounts };
  claims: { rows: readonly unknown[]; counts: DebateCounts };
}, claimsFollow = debate.claims.rows.length > 0): string | null {
  const noDirect = debate.direct.rows.length === 0;
  const noClaims = debate.claims.rows.length === 0;
  const parts: string[] = [];
  if (noDirect) parts.push(emptyGroupNote(debate.direct.counts, "direct"));
  if (noClaims) parts.push(emptyGroupNote(debate.claims.counts, "claims"));
  else if (noDirect && claimsFollow) parts.push(DEBATE_CLAIMS_FOLLOW);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * **What a row's chip says**, and it is the name of a fact rather than a grade.
 *
 * `identificationLevel` is a lookup over a fixed strength order, never a sum
 * (src/types.ts), and these three words are that lookup made readable. They say
 * *this piece* rather than *this article* only because the panel's own sentences
 * do; nothing turns on it.
 *
 * **All three are drawn identically.** They are ordered — a link is stronger
 * evidence than a title — but a chip that got redder as the evidence got weaker
 * would be a scale, and a scale over one fact is the composite this feature
 * refused: docs/project/quotes.md, and the plan's § 2. The order lives in the
 * threshold, where the reader sets it themselves.
 */
const IDENTIFICATION_LABEL: Record<IdentificationLevel, string> = {
  linked: "Links this piece",
  quoted: "Quotes this piece",
  named: "Names this piece",
};

/**
 * **The same three facts as the words on the bar** — the weakest chip a reader
 * is still willing to see.
 *
 * Lower case and shorter than the chip's, because the chip labels a row and this
 * labels a *setting*: *"quotes it · 2 of 3"* reads as a rule the reader has set,
 * where *"Quotes this piece"* on the slider would read as a description of
 * something on screen. Same verbs in the same order, so the setting and the
 * chips it governs are obviously the same vocabulary.
 *
 * **Words and not digits**, which is the whole shape of this control: Quotes'
 * *"the stops are the data, not a grid"* applies with a vengeance when the data
 * is three named facts rather than a scale. A `1`, `2`, `3` here would be the
 * score this feature refused, drawn as a slider.
 */
const STOP_LABEL: Record<IdentificationLevel, string> = {
  linked: "links it",
  quoted: "quotes it",
  named: "names it",
};

/**
 * **Every signal this row earned, as sentences** — the tooltip Greg asked for
 * by name, 2026-09-06: *"a tooltip for each showing the reasons"*.
 *
 * It is **the evidence itself and not a gloss on it**: the address that matched,
 * the article's own words found in that page's extract, the title or byline it
 * named. A reader can check every line of it against the page behind the link,
 * which is the whole reason the level is a name and not a number.
 *
 * **The `quoted` signal's block id is deliberately left out.** It is a location
 * in *our* article, and this card cannot be pointed into — `Tooltip` sets
 * `handleClose: null`, so nothing in here can be clicked — which would make it
 * an identifier the reader can neither follow nor use. The quotation is the
 * evidence; the id is machinery.
 *
 * A string list rather than markup so a test can read what a reader reads.
 */
export function identificationEvidence(row: DirectRow): string[] {
  return identifiesOf(row).map(describeSignal);
}

function describeSignal(signal: PublicIdentificationSignal): string {
  switch (signal.kind) {
    case "linked":
      /* No address on a visitor's signal the public boundary refused — the
         article's own address, with a credential, a private host or a query
         in it (src/public/dto.ts § `publicDebate`). The fact stays; the
         address, which `publicMeta` also leaves off the masthead, does not. */
      return signal.url === undefined
        ? "Links this article's address"
        : `Links this article's address — ${signal.url}`;
    case "quoted":
      /* Two ratios rather than one, because they answer different questions and
         the second is the one that catches a mirror: how much of the article
         turns up here, and how much of what came back is the article's words
         (src/shingles.ts § `isCopy`). Neither is combined with the other, and
         neither is combined with anything else. */
      return (
        `Quotes this article — “${signal.quote}”. ` +
        `${share(signal.coverage)} of the article's phrasings turn up in this page's extract, ` +
        `and ${share(signal.density)} of that extract is the article's own words.`
      );
    case "named":
      return (
        `Names this article by ${signal.by === "title-and-byline" ? "title and byline" : "title"} ` +
        `— “${signal.witness}”`
      );
    default: {
      const unreachable: never = signal;
      return unreachable;
    }
  }
}

/**
 * A 0–1 ratio as a percentage, with **`under 1%` rather than `0%`** at the
 * bottom.
 *
 * The floor fires on a single 8-word window, so a real hit on a long article
 * rounds to zero — and *"0% of the article turns up here"* under a chip that
 * says the page quotes it reads as a contradiction, or as a bug.
 */
function share(ratio: number): string {
  if (!(ratio > 0)) return "0%";
  const pct = ratio * 100;
  return pct < 1 ? "under 1%" : `${Math.round(pct)}%`;
}

/**
 * **The owner's half of this panel** — the read's status, the job that spends,
 * and the verbs.
 *
 * GlossaryPanel.tsx § GlossaryOwner has the argument for one panel with its data
 * injected rather than two panels for one list.
 */
export type DebateOwner = UseDebate;

/**
 * **Who is reading, and what they get — one prop, so the two cannot disagree.**
 *
 * Two arms since 2026-09-29, when Stage 4 built the public contract the
 * visitor's arm waited for (plan 260929c). `owner?: never` is load-bearing
 * rather than tidy — without it the union catches only a fresh object literal
 * at the call site. GlossaryPanel.tsx § GlossaryAccess is the full argument.
 */
export type DebateAccess =
  | { kind: "owner"; owner: DebateOwner }
  /* **The visitor's arm, since 2026-09-29** (plan 260929c stage 4): the stored
     debate off the public payload and nothing else — no read status (it came
     with the page), no job, no verb, so nothing on a visitor's panel can start
     a search. */
  | { kind: "visitor"; debate: PublicDebate; owner?: never };

interface Props {
  access: DebateAccess;
  /**
   * Go to the block a claim row's claim is in.
   *
   * **Marks in the prose are deliberately not in v1** — they are the first
   * thing to add, and they want a resolver into `search-hits.ts`'s `Found`
   * currency. A *jump* is not a mark: a row that quotes the article's own words
   * and names the block they are in has to offer the reader the way there, or it
   * is asking them to search for a sentence it is already holding.
   */
  onJump(id: BlockId): void;
  /**
   * Where the reader has put the identification bar, or `null` for *hasn't
   * touched it* — `?name=`, resolved here to `DEBATE_LEVEL_DEFAULT`.
   *
   * Null rather than a defaulted level, for the reason every sibling threshold
   * gives (docs/project/url-state.md): the constant lives in one file, and *set
   * to the default* stays distinguishable from *never set*, which is what the
   * reset button is drawn from.
   */
  level: IdentificationLevel | null;
  onLevel(level: IdentificationLevel | null): void;
  /**
   * The order the reader asked for — `?debateby=`, whose parser defaults to
   * `prioritised`. What is drawn is `effectiveDebateOrder` of it, which can
   * differ (debate-order.ts).
   */
  order: DebateOrder;
  onOrder(order: DebateOrder): void;
  /**
   * **Each block's position in the article**, for *by claim*'s article order.
   * Not in the artefact — the article's blocks are — so `Reader` builds it
   * once and hands it to both bands (the plan's F8). A block missing from it
   * keeps the search's order.
   */
  blockOrder: ReadonlyMap<BlockId, number>;
  /**
   * Where the reader has put the relevance bar — `?bears=`, or `null` for
   * *hasn't touched it*, resolved here to `RELEVANCE_DEFAULT` (`loosely`, which
   * hides nothing). Applies only while *prioritised* is the order drawn.
   */
  relevance: DebateBears | null;
  onRelevance(level: DebateBears | null): void;
  /**
   * The year the article gives for itself (`Meta.publishedAt`), for *date*'s
   * marker — or `null`, and then there is no marker. A visitor's meta does not
   * carry it, so a visitor gets none.
   */
  articleYear: number | null;
  /**
   * Which thread narrows the list — `?debatethread=`, a theme id or `key`, or
   * `null` for none (debate-threads.ts). A visitor's debate carries the
   * synthesis since 2026-10-01 unless the public boundary withheld a row
   * (src/public/dto.ts § `publicSynthesis`), and then there is nothing to name.
   */
  thread: string | null;
  onThread(thread: string | null): void;
}

export function DebatePanel({
  access,
  onJump,
  level: chosenLevel,
  onLevel,
  order: requestedOrder,
  onOrder,
  blockOrder,
  relevance: chosenRelevance,
  onRelevance,
  articleYear,
  thread: threadParam,
  onThread,
}: Props) {
  useRenderCount("DebatePanel");
  /* `null` for a visitor, and every owner-only thing below is behind it. */
  const owner = access.kind === "owner" ? access.owner : null;
  const debate = access.kind === "owner" ? access.owner.debate : access.debate;
  /* A visitor's debate arrived with the page, so it is ready by construction. */
  const ready = debate !== null && (owner === null || owner.status === "ready");
  const level = chosenLevel ?? DEBATE_LEVEL_DEFAULT;
  /**
   * **The bar, applied once**, and every number on this panel is read out of
   * this one result: the rows in the list, the *N of M* beside the slider, the
   * count in the head, and the foot line saying what is held back. That is
   * `threshold.ts`'s whole argument, and it is why there is no second filter
   * anywhere below.
   *
   * **Only the direct rows go through it.** Claim rows carry no identification
   * level — they answer something the article argues, whether or not their
   * author has ever heard of it — so they are not hidden by the bar, not in its
   * `N of M`, and not in what it says it is holding back.
   */
  const directRows: readonly DirectRow[] = debate?.direct.rows ?? NO_DIRECT;
  const claimRows: readonly ClaimRow[] = debate?.claims.rows ?? NO_CLAIMS;
  const barred = useMemo(() => visibleDirect(directRows, level), [directRows, level]);

  /**
   * **Which order is drawn, which are offered, and the list in that order.**
   *
   * The identification bar runs first, and both questions are asked of the
   * direct rows it left plus every claim row. Otherwise the panel can offer an
   * order whose only distinguishing row is no longer on screen. Relevance runs
   * later because it belongs to one order; the list itself is both bars' rows.
   */
  const order = useMemo(
    () => effectiveDebateOrder(barred.visible, claimRows, requestedOrder, blockOrder, articleYear),
    [barred, claimRows, requestedOrder, blockOrder, articleYear],
  );
  const orders = useMemo(
    () => debateOrderOptions(barred.visible, claimRows, blockOrder, articleYear),
    [barred, claimRows, blockOrder, articleYear],
  );

  /**
   * **The relevance bar, applied once — claim rows only, and only in
   * *prioritised*** (the plan's F6, F7). *Prioritised* is drawn only when some
   * claim row carries `bears` (`effectiveDebateOrder`), so that is also the
   * condition for the bar. In every other order the claim rows pass untouched,
   * as a result with nothing hidden, so everything below reads one shape.
   */
  const relevance = chosenRelevance ?? RELEVANCE_DEFAULT;
  const relevant = order === "prioritised";
  const barredClaims = useMemo(
    (): ThresholdResult<ClaimRow> =>
      relevant
        ? visibleClaims(claimRows, relevance)
        : { visible: [...claimRows], hiddenCount: 0, unscoredCount: 0 },
    [relevant, claimRows, relevance],
  );
  /**
   * **The threads, and the one the address names** — plan 260930j. The owner's
   * stored synthesis read through `readStoredSynthesis`, never directly: JSONB
   * comes back unchecked. A visitor's is read the same way, against the rows
   * they were sent — the public DTO has already re-settled it against exactly
   * those (plan 261001b), so this second reading agrees with it, and one reader
   * serves both arms.
   *
   * **The third narrowing, after both bars.** Each button's count is its rows
   * the bars left (`shownInThread`), and the list below is those rows only.
   */
  const synthesis = useMemo(
    () => (debate !== null ? readStoredSynthesis(debate) : null),
    [debate],
  );
  const threads = useMemo(() => threadsOf(synthesis), [synthesis]);
  const keyRows = useMemo(() => keyByRow(synthesis), [synthesis]);
  const thread = selectedThread(threads, threadParam);
  const barredVisible = useMemo(
    (): DebateRow[] => [...barred.visible, ...barredClaims.visible],
    [barred, barredClaims],
  );
  const threadDirect = useMemo(() => inThread(barred.visible, thread), [barred, thread]);
  const threadClaims = useMemo(() => inThread(barredClaims.visible, thread), [barredClaims, thread]);

  /* **The final visible list**, each search's rows through its own bar and
     then the thread. The head count, the lead's placement and the foot's page
     counts all read this (the plan's F10) — `sourcesNote` counts the pages
     behind *the rows shown*, and a thread decides which those are as much as a
     bar does (GPT Sol's review of 260930j, F6). */
  const rows = useMemo(
    (): DebateRow[] => [...threadDirect, ...threadClaims],
    [threadDirect, threadClaims],
  );
  const groups = useMemo(
    () => orderDebateRows(threadDirect, threadClaims, order, blockOrder, articleYear),
    [threadDirect, threadClaims, order, blockOrder, articleYear],
  );

  /* The two kinds of sentence that are not rows: what came back with nothing
     (the lead), and what each search lost (the foot). Both are derived from the
     stored counts, so both are memoised on the artefact.

     **The foot is handed the rows the bars and the thread left**, not the
     artefact's whole groups: its second sentence counts the pages that
     *contribute to the rows shown*, and those decide which they are
     (`sourcesNote`). The lead
     is handed the artefact untouched, because its subject is what the search
     came back with — a group emptied by the reader's own threshold is not a
     search that found nothing, and `hiddenNote` already says which it is. That
     is also why no order, and no group in *by claim*, ever gets a search-empty
     sentence of its own: the lead is the only one, and where it goes is
     `leadPlacement`. */
  const lead = useMemo(() => {
    if (debate === null) return null;
    return isShared(debate)
      ? sharedLeadNote(debate)
      : leadNote(debate, barredClaims.visible.length > 0);
  }, [debate, barredClaims.visible.length]);
  const placement = lead === null ? null : leadPlacement(lead, rows.length);
  const foot = useMemo(() => {
    if (debate === null) return [];
    /* A visitor's foot is what the public boundary withheld, and only that:
       the stored counts behind the owner's four sentences do not cross
       (src/public-types.ts § `PublicDebateGroup`). */
    if (isShared(debate)) return withheldLines(debate);
    return footLines({
      direct: { rows: threadDirect, counts: debate.direct.counts },
      claims: { rows: threadClaims, counts: debate.claims.counts },
    });
  }, [debate, threadDirect, threadClaims]);

  /**
   * @param again beside a debate that is already there, so the run is forced.
   *   The empty state's button is not: it has to make the identical, unforced
   *   request the automatic run makes, or the two carry different `work_key`s
   *   and the reader pays for two web searches. useDebate.ts § `ensure`.
   */
  const run = (label: string, again = false) =>
    owner === null ? null : (
    <JobProgress
      job={owner.job}
      starting={owner.starting}
      failed={owner.failed}
      stalled={owner.stalled}
      onRun={() => (again ? owner.regenerate() : owner.ensure())}
      onCancel={owner.cancel}
      label={label}
      step="debate"
      icon={<Globe size={13} />}
      runningLabel="Searching…"
    />
  );

  return (
    <ModeSurface
      label="Debate"
      feature="gloss dbt"
      /* **The one header that cannot come out empty** — the globe and the
          `<h2>` are unconditional and only the count is gated — which is what
          makes Debate the control for the five bands whose headers do empty
          out. A fragment all the same, so the shape here reads the same as
          theirs rather than looking like a second pattern. */
      head={
        <>
          <Globe size={14} className="band-head-icon" />
          <h2>Debate</h2>
          {/* **The rows on screen, so it moves with the bar** — a head reading
              *"7 excerpts"* over four rows would be the disagreement
              `threshold.ts` refuses one line lower down. `headCount` says why
              it is excerpts *and* pages. It is one of three counts a reader can
              see at once, and they are three different facts in three places:
              **what is on screen** here, **responses the bar is holding back**
              at the slider, and **pages each search returned** in the lead and
              the foot lines, each naming its own search. */}
          {debate && <span className="gloss-count">{headCount(rows)}</span>}
        </>
      }
      /* No standing redo button under the list any more. Greg, 2026-09-29
          (SPIDERYARN-READING2-53): *"Same goes for any other modes that still
          have a "redo this processing" button - let's just rely on the
          Metadata mode for that."* Metadata's *Re-run AI processing* has a row
          for this mode; the button inside the stale banner stays, as a
          repair the page is prompting rather than a standing redo.
          docs/plans/260929b-one-place-to-re-run-ai-processing.md.

          Keep the footer only while a current search's job is starting,
          running or failed. It remains the mode's one surface for progress,
          Stop, a stall warning and the failure sentence. Not on a stale
          search, whose banner carries the job; an outdated one has no banner
          (plan 260929c), so its job shows here. */
      foot={
        debate &&
        owner !== null &&
        owner.status === "ready" &&
        !owner.stale &&
        (owner.job || owner.starting || owner.failed) ? (
          <div className="dbt-again">{run("Search again", true)}</div>
        ) : null
      }
    >

      {owner?.error && <p className="gloss-error">{owner.error}</p>}

      {owner?.status === "loading" && (
        <p className="gloss-quiet">Looking for what the web says…</p>
      )}

      {owner?.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has asked the web about this one yet.</p>
          {/* The price, before the button rather than after it. Two model
              calls that each go out to the open web is the dearest press in
              this bar, and a reader is entitled to know that at the moment they
              decide. docs/project/copy.md. */}
          <p className="gloss-hint">
            Two searches of the open web — one for replies to this piece, one for the argument
            around what it claims. It takes half a minute, costs real money, and most pieces turn
            out to have no reception at all. Searched once and kept.
          </p>
          {run("Search the web")}
        </div>
      )}

      {debate && ready && (
        <>
          {/* Stale wins when both are true, for the reason every sibling panel
              gives: it is the one that can make a row false rather than merely
              dated, and two banners stacked is a wall.

              **Neither of these is about the age of the search.** That is
              `searchedAt`, said below in its own words, and a year-old search
              on an unchanged article is not stale — it is dated, which is a
              thing a reader can weigh for themselves. src/types.ts §
              `Debate.searchedAt`. */}
          {owner?.stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                The article has changed since this search ran, so some of these may be answering
                something the piece no longer says.
              </p>
              {run("Search again", true)}
            </div>
          ) : null}
          {/* No banner for an outdated search (older prompt, same article) —
              Greg, 2026-09-29 (SPIDERYARN-READING2-55): *"it's not worth
              bugging the user about it."* Re-running is in Metadata. Plan
              260929c. */}

          {/* **The order bar, first**, where Glossary's is: a control on the
              list. Only when at least two orders would draw different lists
              (debate-order.ts § `debateOrderOptions`) — one button, or two that
              give the same list, is a control that visibly does nothing. */}
          {orders.length > 0 && <OrderBar options={orders} order={order} onOrder={onOrder} />}

          {/* **Two of the three disclosures at the top, and the third at the
              foot**, because they are needed at different moments and all three
              together were an eight-line wall over the first row in a 288px
              band (measured in a browser, 2026-09-05).

              *When it was asked* and *what the order is* both govern how you
              read the list, so they have to arrive before it: a reader looking
              at a list assumes its order carries a claim, and by the time they
              reach a foot line they have already read it that way. One line,
              since 2026-09-29 — the negative result that used to sit here too
              moved to where it is true (`leadPlacement`). *What the quotation
              was checked against* is a question you ask **of a quotation**, so
              it is under the list and inside every row's `more` — at the point
              of use, twice, rather than in front of everybody before there is
              anything to apply it to. */}
          <p className="dbt-frame">
            <span className="dbt-searched">Searched on {searchedOn(debate.searchedAt)}.</span>{" "}
            {ORDER_SENTENCE[order]}
          </p>

          {/* **The bar, above the list and outside the scroller**, where every
              other threshold in this app sits: it is a control on the list, not
              provenance to read after it.

              Only when there is something for it to be about. A slider over a
              group with no rows in it would be a control that cannot change
              anything, and — worse — a foot line saying *"nothing is hidden by
              this threshold"* under an empty list, which is true and reads as an
              explanation of the emptiness. `leadNote` owns that sentence. */}
          {debate.direct.rows.length > 0 && (
            <NameBar
              barred={barred}
              level={level}
              moved={chosenLevel !== null}
              onLevel={onLevel}
            />
          )}

          {/* The relevance bar under it, over the claim rows, in *prioritised*
              only — a number that meant nothing in the other orders would be
              furniture. */}
          {relevant && (
            <RelevanceBar
              barred={barredClaims}
              level={relevance}
              moved={chosenRelevance !== null}
              onLevel={onRelevance}
            />
          )}

          <div className="dbt-scroll">
            {/* **The negative result, said where it is true** (`leadPlacement`).
                With no rows it is the whole answer — on a famous piece with no
                reception it has to read as a finding. When it hands over to the
                rows (*"What follows…"*) it comes before them: in *by claim* as
                the body of the *About this piece* group, otherwise as a line
                above the list. Anything else goes after the list. */}
            <Lead text={lead} placement={placement} order={order} at="top" />

            {/* **The threads, above the rows and inside the scroller** — they
                are a reading of the list, so they scroll with it rather than
                pinning over it like the bars. Plan 260930j. */}
            {threads.length > 0 && (
              <Threads
                threads={threads}
                selected={thread}
                visible={barredVisible}
                shown={rows}
                onThread={onThread}
              />
            )}
            {/* **A failed synthesis says so**, quietly, rather than vanishing —
                otherwise *asked and failed* looks exactly like *searched before
                threads existed* and like *nothing shared* (GPT Sol's review of
                260930j, F1). The rows are unaffected, and the line says that
                too. `too-few` and an older debate draw nothing: there, nothing
                was asked. */}
            {synthesis?.kind === "failed" && <p className="dbt-thread-failed">{DEBATE_THREADS_FAILED}</p>}

            {rows.length > 0 && (
              <DebateList groups={groups} order={order} onJump={onJump} keyRows={keyRows} />
            )}

            <Lead text={lead} placement={placement} order={order} at="after" />

            {/* Both searches' numbers, once, under the last row. `footLines`
                has the argument for four sentences rather than two. */}
            {foot.length > 0 && (
              <div className="dbt-foot">
                {foot.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}

            {/* Inside the scroller, so it sits under the last row rather than
                pinned above the button — it is provenance to read after the
                list, not a control. */}
            <p className="dbt-verified">{DEBATE_EXTRACTS_ONLY}</p>
          </div>

        </>
      )}

    </ModeSurface>
  );
}

/**
 * **Debate's two categorical thresholds, drawn by one component** — the
 * identification bar (`?name=`, rows about this piece) and, since 2026-09-29,
 * the relevance bar (`?bears=`, claim rows, *prioritised* only). They own
 * disjoint rows, so each `N of M` counts only its own (the plan's F7).
 *
 * Everything here is Quotes' `BarSlider` and the glossary's `GateSlider` with
 * the *stops* changed, and their four properties are kept for the same reasons:
 * the setting is on screen in words, the count is on screen (`2 of 3`, the thing
 * the reader is actually aiming at), every stop is a different rule, and it says
 * how many it is holding back in **every** state including none
 * ([`hiddenNote`](threshold.ts)).
 *
 * Two things differ from its three siblings, and both follow from the fact
 * underneath being **named rather than measured**:
 *
 *  - **The track is an index into three fixed words**, not into scores this list
 *    contains. So a stop can be inert on a given article — nothing here links
 *    the piece, say, and the last two stops then show the same list — where
 *    `barStops` guarantees each adjacent pair differs. That is the right trade:
 *    a word in a link means the same thing on every article
 *    (debate-levels.ts § `IDENTIFICATION_STOPS`).
 *  - **The URL carries the word**, so there is nothing to snap and no
 *    `snapToStop` here. `?bar=0.63` against a track of real scores was a bug
 *    that needed a whole function; `?name=quoted` is a stop or it is nothing.
 */
function StopBar<L extends string>({
  id,
  kind,
  label,
  barred,
  level,
  stops,
  words,
  defaultLevel,
  noun,
  title,
  judgedOnly = false,
  moved,
  onLevel,
}: {
  /** The range input's id, which the `<label>` points at. */
  id: string;
  /** A class beside `.dbt-bar`, so the two bars can be told apart. */
  kind: string;
  label: string;
  /**
   * **The pass the panel already made**, rather than the rows to make it over
   * again.
   *
   * `threshold.ts`'s whole argument is that the visible list, the `N of M`, the
   * hidden count and the foot line come out of **one** result: *a count that
   * disagrees with the list under it is this feature's worst failure*. Handing
   * this component the rows and letting it re-apply the rule would have been
   * two passes agreeing only because they were handed the same array — true
   * today, and a prop away from not being.
   */
  barred: ThresholdResult<unknown>;
  level: L;
  /** The stops, weakest first — left shows everything. */
  stops: readonly L[];
  /** Each stop's words on the bar. */
  words: Record<L, string>;
  defaultLevel: L;
  noun: ThresholdNoun;
  title: string;
  /** Leave rows with no judgment out of the bar's N of M. They remain visible. */
  judgedOnly?: boolean;
  moved: boolean;
  onLevel(level: L | null): void;
}) {
  const visibleCount = barred.visible.length - (judgedOnly ? barred.unscoredCount : 0);
  const total = visibleCount + barred.hiddenCount;
  const count = `${visibleCount} of ${total}${judgedOnly ? " judged" : ""}`;
  /* The note is about the list, so it counts every row the bar governs — an
     unjudged row is still drawn, and "All 2 are hidden" over it was false (GPT
     Sol's R2). Only the count above may narrow to the judged ones. */
  const note = hiddenNote(barred.hiddenCount, barred.visible.length + barred.hiddenCount, noun);

  return (
    <div className={`dbt-bar ${kind}`}>
      <div className="dbt-bar-row">
        <label className="dbt-bar-label" htmlFor={id}>
          {label}
        </label>
        <span className="dbt-bar-value">
          {words[level]} · {count}
        </span>
        {/* Only once there is something to undo, exactly as next door: a reset
            that is always there invites you into a state you are already in. */}
        {moved && (
          <button
            type="button"
            className="dbt-bar-reset"
            title={`Back to “${words[defaultLevel]}”`}
            aria-label={`Reset the bar to “${words[defaultLevel]}”`}
            onClick={() => onLevel(null)}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>
      <input
        id={id}
        className="dbt-bar-range"
        type="range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={Math.max(0, stops.indexOf(level))}
        title={title}
        /* The thumb's position is a number nobody can hear, and here it is not
           even a number — so this is the word and the count, which between them
           are the whole of what the control does. */
        aria-valuetext={`${words[level]}, showing ${count} ${noun.many}`}
        onChange={(e) => onLevel(stops[Number.parseInt(e.target.value, 10)] ?? defaultLevel)}
      />
      {/* Always, never conditionally: present wherever the slider is, absent
          wherever it is not. A line that is sometimes missing for a *different*
          reason teaches the reader nothing — and a bar that has hidden every row
          looks exactly like a search that found none. */}
      <p className="dbt-bar-note">{note}</p>
    </div>
  );
}

/**
 * **How firmly a page has to identify this article to stay on the list** —
 * the threshold Greg asked for on 2026-09-06, over rows about this piece.
 * Claim rows carry no level, are never hidden by this, and are in neither
 * number it prints.
 */
function NameBar({
  barred,
  level,
  moved,
  onLevel,
}: {
  barred: ThresholdResult<DirectRow>;
  level: IdentificationLevel;
  moved: boolean;
  onLevel(level: IdentificationLevel | null): void;
}) {
  return (
    <StopBar
      id="dbt-bar"
      kind="dbt-name"
      label="identification"
      barred={barred}
      level={level}
      stops={IDENTIFICATION_STOPS}
      words={STOP_LABEL}
      defaultLevel={DEBATE_LEVEL_DEFAULT}
      noun={RESPONSE}
      title="How firmly a page has to identify this article to stay on the list: it names the title, it quotes the article's own words, or it links to its address. Left shows every page the search kept, right only the ones that link it. Rows answering what the article claims are not affected."
      moved={moved}
      onLevel={onLevel}
    />
  );
}

/**
 * **How directly a claim row has to bear on its claim to stay on the list** —
 * the *thresholding* Greg asked for with *prioritised*, over claim rows only.
 * The words are the AI's judgment (`bears`), and the default hides nothing
 * (`RELEVANCE_DEFAULT`, the plan's F5). A row the AI did not judge is never
 * hidden: it is always on the list, under its own line, and is left out of the
 * bar's N of M so it does not look as though it cleared a judgment it lacks.
 */
function RelevanceBar({
  barred,
  level,
  moved,
  onLevel,
}: {
  barred: ThresholdResult<ClaimRow>;
  level: DebateBears;
  moved: boolean;
  onLevel(level: DebateBears | null): void;
}) {
  return (
    <StopBar
      id="dbt-rel-bar"
      kind="dbt-rel"
      label="relevance"
      barred={barred}
      level={level}
      stops={RELEVANCE_STOPS}
      words={BEARS_LABEL}
      defaultLevel={RELEVANCE_DEFAULT}
      noun={ANSWER}
      title="How directly the AI judged a page bears on the claim it answers: loosely, partly or directly. Left shows every answer, right only the ones it judged to bear directly. Rows the AI did not judge are never hidden, and rows about this piece are not affected."
      judgedOnly
      moved={moved}
      onLevel={onLevel}
    />
  );
}

/**
 * **The lead sentence, drawn at one of its two places** — or nothing, when it
 * belongs at the other. `leadPlacement` decides; this only draws. `at="top"`
 * takes *alone* and *before*, and *before* in *by claim* is the body of an
 * *About this piece* group — there is no row about this piece to head, only the
 * finding that there is none.
 */
function Lead({
  text,
  placement,
  order,
  at,
}: {
  text: string | null;
  placement: "alone" | "before" | "after" | null;
  order: DebateOrder;
  at: "top" | "after";
}) {
  if (text === null || placement === null) return null;
  if (at === "after") {
    return placement === "after" ? <p className="gloss-quiet dbt-empty dbt-after">{text}</p> : null;
  }
  if (placement === "after") return null;
  if (placement === "before" && order === "claim") {
    return (
      <section className="dbt-group">
        <h3 className="dbt-group-head">About this piece</h3>
        <p className="gloss-quiet dbt-empty">{text}</p>
      </section>
    );
  }
  return <p className="gloss-quiet dbt-empty">{text}</p>;
}

/**
 * **The order buttons** — Glossary's `SortBar`, with its classes: `.dbt` is
 * `.gloss` with a class beside it, so the look comes free and the two bars
 * cannot drift apart. `aria-pressed` on the order actually drawn, which is
 * `effectiveDebateOrder`'s answer rather than the URL's.
 */
function OrderBar({
  options,
  order,
  onOrder,
}: {
  options: readonly DebateOrder[];
  order: DebateOrder;
  onOrder(order: DebateOrder): void;
}) {
  return (
    <div className="gloss-sort">
      {/* biome-ignore lint/a11y/useSemanticElements: toggle buttons that order a
          list, not form controls — GlossaryPanel.tsx § SortBar says why. */}
      <div className="gloss-sort-group" role="group" aria-label="Order the sources by">
        {options.map((key) => (
          <button
            key={key}
            type="button"
            className={`gloss-sort-btn${order === key ? " on" : ""}`}
            aria-pressed={order === key}
            title={ORDER_OPTION[key].title}
            onClick={() => onOrder(key)}
          >
            {ORDER_OPTION[key].label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * **The threads box**: the key sources and the themes the sources share, each
 * a button that narrows the list to its rows — plan 260930j, Greg's *"highlight
 * key themes from other people and commentary … and key nodes"*.
 *
 * `aria-pressed` toggle buttons in a group, the order bar's shape. One at a
 * time: pressing the pressed one clears it, as does *show all*. A thread the
 * bars have emptied is disabled and says why, rather than offering a press that
 * empties the list.
 *
 * Every string here is the model's, drawn as text; the heading says whose.
 */
function Threads({
  threads,
  selected,
  visible,
  shown,
  onThread,
}: {
  threads: readonly Thread[];
  selected: Thread | null;
  /** The rows both bars left, before the thread — what each count is out of. */
  visible: readonly { id: string }[];
  /** The rows on screen after the thread. */
  shown: readonly { url: string }[];
  onThread(thread: string | null): void;
}) {
  return (
    <section className="dbt-threads" aria-label="Threads across these sources">
      <h3 className="dbt-threads-head">
        <span className="dbt-ai-tag" title="The AI's reading of the sources below — nothing in what the search returned checks it">
          AI
        </span>
        Threads across these sources
      </h3>
      {/* biome-ignore lint/a11y/useSemanticElements: toggle buttons that filter a
          list, not form controls — the order bar's reason. */}
      <div className="dbt-thread-list" role="group" aria-label="Show only the sources on">
        {threads.map((t) => {
          const count = shownInThread(t, visible);
          const on = selected?.id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={`dbt-thread${on ? " on" : ""}${t.kind === "key" ? " dbt-thread-key" : ""}`}
              aria-pressed={on}
              disabled={count === 0 && !on}
              title={
                count === 0
                  ? "The bars above are hiding every source on this"
                  : on
                    ? "Show every source again"
                    : "Show only these sources"
              }
              onClick={() => onThread(on ? null : t.id)}
            >
              <span className="dbt-thread-label">
                {t.kind === "key" && <Star size={12} aria-hidden="true" className="dbt-key-star" />}
                {t.label}
                <span className="dbt-thread-count">{count}</span>
              </span>
              {t.gist && <span className="dbt-thread-gist">{t.gist}</span>}
            </button>
          );
        })}
      </div>
      {/* In the head count's own words (`headCount`: excerpts, and pages when
          they differ), so the two cannot disagree. When the bars have hidden
          every row of the chosen thread, it says so in the open rather than in
          a tooltip a finger cannot reach (Sol's F7). */}
      {selected && (
        <p className="dbt-thread-showing">
          {shown.length === 0
            ? "The bars above are hiding every source on this thread"
            : `Showing ${headCount(shown)} ${selected.kind === "key" ? "picked as key" : `on “${selected.label}”`}`}
          {" · "}
          <button type="button" className="dbt-thread-all" onClick={() => onThread(null)}>
            show all
          </button>
        </p>
      )}
    </section>
  );
}

/**
 * **The list, in whichever order is drawn.** *By claim* is one headed section
 * per group — *About this piece*, then each claim in the article's own words
 * with the way to it. The other orders are flat, with at most two quiet lines
 * inside them that say what is **missing** rather than what a page thinks —
 * *not judged for relevance*, *no year found* — and *date*'s marker at the
 * article's own year.
 *
 * A claim row's *On "…"* line is left off under a claim heading, because the
 * heading already says it: the repeated *Answering* blocks were half of what
 * made the old list look like duplicates.
 */
function DebateList({
  groups,
  order,
  onJump,
  keyRows,
}: {
  groups: readonly DebateGroup<DirectRow, ClaimRow>[];
  order: DebateOrder;
  onJump(id: BlockId): void;
  /** Each key source's reason, by row id — empty for a visitor or an older debate. */
  keyRows: ReadonlyMap<string, DebateKeySource>;
}) {
  const grouped = order === "claim";
  const list = (rows: readonly DebateRow[]) => (
    <ol className="dbt-list">
      {rows.map((row) => (
        <Row key={row.id} row={row} showClaim={!grouped} onJump={onJump} keySource={keyRows.get(row.id)} />
      ))}
    </ol>
  );
  return (
    <>
      {groups.map((group, i) => {
        /* Index keys are right here: the groups are rebuilt as a whole on every
           change, and two `flat` groups can sit either side of a marker. */
        const key = `${group.kind}-${i}`;
        switch (group.kind) {
          case "flat":
            return <div key={key}>{list(group.rows)}</div>;
          case "piece":
            return (
              <section key={key} className="dbt-group">
                <h3 className="dbt-group-head">About this piece</h3>
                {list(group.rows)}
              </section>
            );
          case "claim":
            return (
              <section key={key} className="dbt-group">
                {/* The article's own words, located in the block the id names —
                    a heading we can stand behind, which a `relation` or a stance
                    heading would not be. File header § One list. */}
                <h3 className="dbt-group-head dbt-group-claim">
                  <span className="dbt-claim-label">On</span>{" "}
                  <span className="dbt-group-quote">“{group.claimQuote}”</span>{" "}
                  <BlockRef id={group.blockId} onJump={onJump} />
                </h3>
                {list(group.rows)}
              </section>
            );
          case "unjudged":
          case "undated":
            return (
              <section key={key} className="dbt-group">
                <p className="dbt-gap">{group.kind === "unjudged" ? DEBATE_UNJUDGED : DEBATE_UNDATED}</p>
                {list(group.rows)}
              </section>
            );
          case "marker":
            /* *"This piece, 2022"* and nothing more: the rows under it are that
               year or later, and a same-year row is not *after* it — a year
               cannot order two things inside itself (the plan's F1). */
            return (
              <p key={key} className="dbt-marker">
                This piece, {group.year}
              </p>
            );
          default: {
            const unreachable: never = group;
            return unreachable;
          }
        }
      })}
    </>
  );
}

/**
 * **The chip on a row about this piece**: how it identifies the article, with
 * every signal it earned in a tooltip.
 *
 * Claim rows have no chip since 2026-09-29. Their *On what it claims* pill said
 * the same thing on every row, and what it stood for — *this answers a claim,
 * not the piece* — is said by the claim itself, on the row or as its heading.
 * The chip stays because it has evidence behind it: *this page is about this
 * piece* and *this page argues about the same thing* are different kinds of
 * relevance, and the chip is the one of the two that needed proving.
 */
function IdentificationChip({ row }: { row: DirectRow }) {
  const level = identificationLevel(row);
  const evidence = identificationEvidence(row);
  return (
    <Tooltip
      placement="bottom"
      keepSide
      className="dbt-mark-card"
      content={
        <>
          <span className="dbt-mark-card-head">How this page identifies the article</span>
          <ul className="dbt-mark-card-list">
            {evidence.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      }
    >
      {/* A real button, so it is a tab stop and `useFocus` gives a keyboard
          reader the same card a pointer gets. It does nothing on press —
          `cursor: help` says so: this is a reveal, not a control. */}
      <button type="button" className={`dbt-mark dbt-mark-${level}`}>
        {IDENTIFICATION_LABEL[level]}
      </button>
    </Tooltip>
  );
}

/**
 * **Is the search engine's title cut short?** Its own ellipsis, three dots or
 * one — *"Memory Sources Associated with REM and NREM Dream Reports ..."*.
 */
function isCutShort(title: string): boolean {
  return /(\.\.\.|…)\s*$/.test(title);
}

/**
 * **What a row says the work is** — its headline, and the byline under it —
 * with where each part came from.
 *
 * **The engine's title wins whenever it is whole**, because it is the wire's
 * and not the model's. `workTitle` — the AI's reading of the page, found in its
 * extract — stands in only where the engine gave none or cut it short, and then
 * `titleIsAI` says so. With neither, the headline is the address.
 *
 * Authors and year are always the AI's reading (the plan's F2): the words are
 * on the page, which does not prove they are *this* page's byline.
 */
export function rowWork(row: DebateRow): {
  headline: string;
  titleIsAI: boolean;
  headlineIsAddress: boolean;
  authors: string[];
  year: number | null;
} {
  const engine = row.title?.trim() ? row.title : null;
  const work = readWorkTitle(row);
  const useWork = work !== null && (engine === null || isCutShort(engine));
  const headline = useWork ? work : (engine ?? addressOf(row.url));
  return {
    headline,
    titleIsAI: useWork,
    headlineIsAddress: !useWork && engine === null,
    authors: readAuthors(row),
    year: readPublishedYear(row),
  };
}

/**
 * **The authors on the byline**: all of them up to three, and past three the
 * first two and *et al.* — the full list is in `more`.
 */
export function bylineAuthors(authors: readonly string[]): string {
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 2).join(", ")} et al.`;
}

/**
 * **One source**, in the order the file header gives: what the work is, the
 * AI's reading of it, the claim it answers, the quotation — and `more`.
 *
 * @param showClaim whether to draw a claim row's *On "…"* line; false under a
 *   *by claim* heading, which already says it.
 */
function Row({
  row,
  showClaim,
  onJump,
  keySource,
}: {
  row: DebateRow;
  showClaim: boolean;
  onJump(id: BlockId): void;
  /** Set when the AI picked this row as a key source (plan 260930j). */
  keySource: DebateKeySource | undefined;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  /* **`readStoredLean`, never `row.lean`.** This row may have come off JSONB
     written before the vocabulary changed, where the field is called `valence`
     and spelled `positive`; the type does not describe that and nothing
     revalidates it on the way out of the database. Indexing the table with it
     directly gives `undefined` and the next line crashes the panel — Sol's F68,
     and `lossesOf`'s story in src/types.ts is the same mistake already made
     once. */
  const look = LEAN_APPEARANCE[readStoredLean(row)];
  const Icon = look.icon;
  const claim = claimOf(row);
  const direct = directOf(row);
  const bears = readBears(row);
  const work = rowWork(row);
  const byline = [
    work.authors.length > 0 ? bylineAuthors(work.authors) : null,
    work.year === null ? null : String(work.year),
  ].filter((part): part is string => part !== null);
  return (
    <li className={`dbt-item${open ? " open" : ""}${keySource ? " key" : ""}`}>
      {/* **A key source says so first, and why** — above the title, because it
          is the reason a reader would look at this row before the others.
          Labelled AI like the reading below it: nothing checks the pick.
          Plan 260930j. */}
      {keySource && (
        <p className="dbt-key-line">
          <span className="dbt-ai-tag" title="The AI's pick — nothing in what the search returned checks it">
            AI
          </span>
          <Star size={12} aria-hidden="true" className="dbt-key-star" />
          <span className="dbt-key-label">Key source · {KEY_ROLE_LABEL[keySource.role]}</span>
          <span className="dbt-key-why">{keySource.why}</span>
        </p>
      )}
      {/* **The work is the headline**, and it is the link out — a real `<a href>`
          so the browser's own affordances work (the status bar, a middle
          click). `noreferrer` as well as `noopener`: this is a stranger's page
          and the address of the article being read is not its business.
          Clamped to two lines by CSS alone, so the whole title is still in the
          accessibility tree; `more` unclamps it. */}
      <a className="dbt-title" href={row.url} target="_blank" rel="noreferrer noopener" title={row.url}>
        {work.headline}
        <ExternalLink size={11} aria-hidden="true" />
      </a>

      {/* The small line under the title: *authors · year · site*. The authors
          and year are the AI's reading of the page, so they are drawn quieter
          than the site and say so on hover — the site is the wire's, and it
          stays because it is the one authority signal a reader can judge. Left
          off when the headline is already the address. */}
      {(byline.length > 0 || !work.headlineIsAddress || direct) && (
        <p className="dbt-meta">
          {byline.length > 0 && (
            <span className="dbt-byline" title="As the AI read it off the page — found in the page's extract, not checked as its byline">
              {byline.join(" · ")}
            </span>
          )}
          {byline.length > 0 && !work.headlineIsAddress && (
            <span aria-hidden="true" className="dbt-dot">
              ·
            </span>
          )}
          {!work.headlineIsAddress && <span className="dbt-site">{hostOf(row.url)}</span>}
          {direct && <IdentificationChip row={direct} />}
        </p>
      )}

      {/* **The AI's reading, one line and labelled.** Up here because it is what
          a reader decides with; the paragraph behind it is in `more`, inside
          the fence. Separate words, not merged: *"qualifies · Could not tell"*
          is an honest pair of answers rather than a contradiction. `bears`
          leads when the AI gave one — it is what *prioritised* orders by. */}
      <p className="dbt-ai-line">
        <span className="dbt-ai-tag" title="The AI's reading of this page — nothing in what the search returned checks it">
          AI
        </span>
        {bears && (
          <>
            <span className="dbt-bears">{BEARS_LABEL[bears]}</span>
            <span aria-hidden="true" className="dbt-dot">
              ·
            </span>
          </>
        )}
        <span className="dbt-relation">{row.relation}</span>
        <span aria-hidden="true" className="dbt-dot">
          ·
        </span>
        <span className={`dbt-lean dbt-lean-${look.tone}`}>
          <Icon size={12} aria-hidden="true" />
          {look.label}
        </span>
      </p>

      {/* A claim row outside *by claim*: the article's own words for the claim it
          answers, located in the named block, and the way to it. One line; the
          heading carries it in *by claim*. */}
      {claim && showClaim && (
        <p className="dbt-claim">
          <span className="dbt-claim-label">On</span>
          <span className="dbt-claim-text">“{claim.claimQuote}”</span>
          <BlockRef id={claim.blockId} onJump={onJump} />
        </p>
      )}

      {/* Characters we located in that page's own extract. A `<blockquote>`
          because that is what it is, and rendered as text: this is a slice of a
          stranger's page and nothing here may ever become markup. Three lines
          until `more`. */}
      <blockquote className="dbt-quote">“{row.sourceQuote}”</blockquote>

      <button
        type="button"
        className="dbt-more"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((was) => !was)}
      >
        {/* The name says *which* source — a list of twelve buttons all called
            "more" is no list to a screen reader — and still starts with the
            word on screen, so a voice-control reader can say what they see. */}
        {open ? "less" : "more"}
        <span className="tw:sr-only"> about “{work.headline}”</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      <RowDetail id={detailId} row={row} work={work} hidden={!open} />
    </li>
  );
}

/**
 * **What `more` opens**: everything the ⓘ card held, in the row rather than
 * over it — every author, and whose reading the title, authors and year are;
 * the AI's paragraph inside its fence; the page's full address; a direct row's
 * witness that this page names *this* article; what the quotation was checked
 * against; and the way out. The full title and quotation are the row's own,
 * unclamped (`.dbt-item.open` in debate.css), rather than drawn a second time.
 *
 * Rendered closed with `hidden` rather than not at all, so `aria-controls`
 * always names an element that exists.
 *
 * Every string here is text. The excerpt is a slice of a stranger's page: a
 * `dangerouslySetInnerHTML` added later to highlight the matched span would be
 * an injection, and nothing else in this file would catch it.
 */
function RowDetail({
  id,
  row,
  work,
  hidden,
}: {
  id: string;
  row: DebateRow;
  work: ReturnType<typeof rowWork>;
  hidden: boolean;
}) {
  const reference = referenceOf(row);
  /* Only the parts actually drawn as the AI's: an engine title that won is the
     wire's, and calling it the AI's reading would be false (F2). */
  const aiParts = [
    work.titleIsAI ? "title" : null,
    work.authors.length > 0 ? "authors" : null,
    work.year === null ? null : "year",
  ].filter((part): part is string => part !== null);
  return (
    <div id={id} className="dbt-detail" hidden={hidden}>
      {work.authors.length > 0 && <p className="dbt-authors">By {work.authors.join(", ")}</p>}
      {aiParts.length > 0 && <p className="dbt-note dbt-work-note">{debateWorkFieldsNote(aiParts)}</p>}
      {/* **The fence.** Everything outside it is either the wire's or the
          article's; everything inside it is a model's reading of a stranger's
          page, and nothing in the returned evidence verifies any of it. */}
      <div className="dbt-ai">
        <p className="dbt-ai-label">AI interpretation</p>
        <p className="dbt-applies">{row.applies}</p>
        {/* Optional, and that is a correction the plan records: requiring it on
            every row manufactures caveats, so the prompt is told to omit a row
            rather than invent a limitation. */}
        {row.limits && <p className="dbt-limits">{row.limits}</p>}
      </div>
      {/* The full address, which the row shows only the host of. */}
      <p className="dbt-url">{row.url}</p>
      {/* A direct row's whole claim is that this page is about this piece, and
          this is the witness for it: words from the source's own extract in
          which it names the article. A row without one cannot exist in that
          group.

          **This sentence became true on 2026-09-05** (Sol's F24). Until then the
          stage only checked that the words were somewhere in the extract, so a
          genuine quotation about something else was printed under "It names
          this article". `namesArticle` (src/debate.ts) is what makes the claim:
          the witness has to carry the article's address, its title, or a short
          title with the byline. */}
      {reference && <p className="dbt-ref">It names this article: “{reference}”</p>}
      <p className="dbt-note">{DEBATE_EXTRACTS_ONLY}</p>
      <a className="dbt-out" href={row.url} target="_blank" rel="noreferrer noopener">
        Read it on {hostOf(row.url)}
        <ExternalLink size={11} aria-hidden="true" />
      </a>
    </div>
  );
}

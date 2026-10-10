/**
 * Reception and claims, in the band between the spine and the prose — the fourteenth
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
 * refusing rows** (src/reception.ts).
 *
 * That is why this panel is mostly sentences. Four rows look exactly the same
 * whether the stage refused six or refused none, so nearly everything here that
 * is not a row is a disclosure: what the search returned, what survived, what
 * the quotations were checked against, and **which** of the two empty answers
 * this is.
 *
 * ## Two sub-modes; only Reception is searched now
 *
 * Until `debate/7`, two separately metered searches ran — one for pages about
 * this piece, one for the argument around what it claims. Until 2026-09-06 the panel drew them
 * as two headed groups stacked in one band, which on Cargo Cult Science put two
 * headings, two blurbs and two foot lines over *zero rows*. From then until
 * 2026-10-03 it drew them as **one list**, under up to four controls at once.
 * Greg, on a paper the open web has not discussed (spya-caue42):
 *
 * > I don't quite understand what debate mode is doing. The UI is confusing. …
 * > it seems to have found some interesting stuff about the RNA and C. elegans
 * > study … But A, that's very specific. It's one claim. And B, it doesn't tell
 * > me anything about how the paper has been received more generally.
 *
 * So the two groups became two **sub-modes**, `?debate=`, on one segmented
 * control: **Reception**, what others have written about the piece itself,
 * and **Claims**, what an earlier search found about the claims it makes.
 * Since `debate/7` only Reception is searched; each control still applies to
 * everything on screen.
 * docs/plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md.
 *
 * **Since 2026-10-09 they are two of Sources' three sub-modes**
 * (`?sources=`), after Bibliography, which is the Citations panel. This
 * panel draws Reception or Claims under the chip row the mode hands it as
 * `head` (SourcesMode.tsx § `SourcesViews`), and the chips' numbers and
 * this panel's lists come out of the same selectors (sources-counts.ts).
 * The panel keeps its stored name until the deep rename
 * (docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md § Stage 3).
 *
 *  - **Reception** draws the rows that link or quote the piece, then the ones
 *    that only name it under a heading saying so ([`reception-levels.ts`](reception-levels.ts)
 *    — a slider hid those until 2026-10-03, and with them the citing papers the
 *    search was changed to find). `?receptionby=` orders within each group. It
 *    ends with *Cited by* for the owner (below), and for a visitor with one
 *    link out, a Scholar search for who cites the piece.
 *  - **Claims** is always grouped by claim, in article order, most directly
 *    bearing first within a claim ([`reception-order.ts`](reception-order.ts)). The
 *    relevance bar (`?bears=`) is its one control.
 *
 * **Since `debate/7` (2026-10-08) the press searches for Reception only**, and
 * a debate stored since says `claims: {pass: "not-run"}` (src/types.ts §
 * `ReceptionClaims`): Claims then says no claims search ran, never that one found
 * nothing. An older debate's claim rows are drawn as before, under *Claims the
 * earlier search chose*. The reader picks the claims to check instead —
 * docs/plans/261008i-debate-claims-picked-by-the-reader.md.
 *
 * ## Cited by, at the end of Reception, for the owner
 *
 * Since 2026-10-04 Reception ends with the papers that cite the piece, from
 * OpenAlex (`CitedBy` below, src/citation-index.ts). It is **not part of the
 * stored Reception**: no model made it, it costs nothing, and it has its own read
 * (src/web/useCiters.ts). So it is drawn whenever Reception is on screen —
 * before the paid search has run as well — and nothing in it can start that
 * search. It does not move Reception's count, which stays the web search's
 * rows: a list we have not read is a different kind of thing. A visitor gets
 * the Scholar link alone.
 * docs/plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md.
 *
 * **A heading is a claim we stand behind**, which is why the only headings are
 * the article's own words for a claim — located in its block before the row was
 * kept — and *Names this piece by its title only*, which is what was checked.
 * Grouping by `relation`, or by stance, would put the model's reading of a
 * stranger's page in a heading; so stance is an order and never a grouping,
 * a claim's heading carries no for/against tally, and the model's readings stay
 * inside rows.
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
 * quotation, the AI's paragraph, the address, a direct row's witness, and the
 * way out. A button with
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
 * `ReceptionAndClaimsAccess` has two arms. The visitor's waited for the contract its rows
 * must not bypass — `publicCitationUrl` re-judging every URL at the boundary,
 * where a refusal drops the whole row — which a GPT Sol review (F23) refused to
 * have built after the panel. Stage 4 built it (src/public/dto.ts §
 * `publicReception`, plan 260929c), and a visitor's panel draws the stored rows
 * with no job, no verb and no read: nothing on it can start a search.
 */
import { type ReactNode, useId, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  CircleHelp,
  Equal,
  ExternalLink,
  Globe,
  LoaderCircle,
  MessagesSquare,
  type LucideIcon,
  RotateCcw,
  Star,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CITERS_ABOUT,
  CITERS_HEADING,
  CITERS_LOADING,
  CITERS_NOT_INDEXED,
  CITERS_NO_DOI,
  CITERS_TOO_LARGE,
  CITERS_UNAVAILABLE,
  CITERS_UNCONFIRMED,
  citedTimes,
  citersLines,
  RECEPTION_BEFORE_SEARCH,
  SOURCES_CLAIM_CHECK_FOUND_NOTHING,
  SOURCES_CLAIM_CHECK_NOT_ANSWERED,
  SOURCES_CLAIM_CHECK_OWN_LABEL,
  SOURCES_CLAIM_CHECK_PENDING,
  SOURCES_CLAIM_CHECK_TIP,
  SOURCES_CLAIM_CHECK_EARLIER,
  SOURCES_CLAIM_CHECK_YOUR_CLAIM,
  SOURCES_CLAIM_CHECK_DIG_FURTHER_TIP,
  SOURCES_CLAIMS_EARLIER,
  SOURCES_CLAIMS_NONE,
  SOURCES_CLAIMS_LIST_AGAIN,
  SOURCES_CLAIMS_LIST_AI,
  SOURCES_CLAIMS_LIST_EMPTY,
  SOURCES_CLAIMS_LIST_LOADING,
  SOURCES_CLAIMS_LIST_NONE,
  SOURCES_CLAIMS_LIST_NONE_SHARED,
  SOURCES_CLAIMS_LIST_RUN,
  SOURCES_CLAIMS_LIST_STALE,
  SOURCES_CLAIMS_NOT_SEARCHED_SHARED,
  RECEPTION_EXTRACTS_ONLY,
  RECEPTION_RESPONSES_NONE,
  SOURCES_CLAIMS_NONE_SHARED,
  RECEPTION_RESPONSES_NONE_SHARED,
  RECEPTION_TITLE_ONLY,
  SOURCES_CLAIMS_UNJUDGED,
  RECEPTION_UNDATED,
  RECEPTION_THREADS_FAILED,
  sourcesClaimsHandoff,
  sourcesClaimsUnverified,
  sourcesClaimsNoneSuggested,
  receptionResponsesUnverified,
  receptionResponsesNoneSuggested,
  receptionWithheldOnSharedLink,
  receptionRegistryNote,
  receptionWorkFieldsNote,
} from "../messages.js";
import {
  type BlockId,
  type Citer,
  type CitersResult,
  type ClaimOrigin,
  type Reception,
  type SourcesClaimsBears,
  type SourcesClaimCheckRow,
  type ReceptionClaimsNotRun,
  type ReceptionCounts,
  type ReceptionKeySource,
  type ReceptionLean,
  type IdentificationLevel,
  type ListedClaim,
  MAX_CHECK_TARGETS,
  MAX_LENS_CHARS,
  MAX_OWN_CLAIM_CHARS,
  type RegistrySource,
  type ThreadSummary,
  distinctSources,
  identificationLevel,
  identifiesOf,
  lossesOf,
  readStoredLean,
} from "../types.js";
import { BlockRef } from "./BlockRef.js";
import { Excerpt } from "./Excerpt.js"; // quotes drawn from the block's markup (plan 261009k)
import { isImeComposing } from "./key-chord.js";
import { receptionSections } from "./reception-levels.js";
import {
  type ClaimGroup,
  type ReceptionGroup,
  type ReceptionOrder,
  RELEVANCE_DEFAULT,
  RELEVANCE_STOPS,
  effectiveReceptionOrder,
  groupByClaim,
  orderReceptionRows,
  readAuthors,
  readBears,
  readPublishedYear,
  readRowRegistry,
  readWorkTitle,
  receptionOrderOptions,
} from "./reception-order.js";
import { registryAuthorName } from "../registry-work.js";
import { scholarUrl } from "../scholar-search.js";
import { citerUrl } from "../citer-link.js";
import { KEY_ROLE_LABEL, keyByRow, shownInThread, type Thread, threadsOf } from "./reception-threads.js";
import { readStoredSynthesis } from "../reception-synthesis.js";
import type { ReceptionAndClaimsView } from "./params.js";
import { SOURCES_SUB_MODES } from "./sub-modes.js";
import { claimsSelection, listedClaims, receptionSelection } from "./sources-counts.js";
import { MODE_LABEL } from "../title-text.js";
import { hiddenNote, type ThresholdNoun, type ThresholdResult } from "./threshold.js";
import { JobProgress } from "./JobProgress.js";
import { AboutMade } from "./BandAbout.js";
import { OrderGroup } from "./OrderGroup.js";
import { ModeSurface } from "./ModeSurface.js";
import { ReadError } from "./ReadError.js";
import { RewriteWaiting } from "./RewriteWaiting.js";
import { TipNote, Tooltip } from "./Tooltip.js";
import { type CitedInParagraph, workShortName, worksCitedIn } from "./cited-in-paragraph.js";
import { lensThreads, threadForOrigin } from "./useChatAnchors.js";
import { OriginChatMark } from "./OriginChat.js";
import { claimFocusKey, type ItemFocus, useLandOnItem } from "./item-focus.js";
import { useRenderCount } from "./perf.js";
import type { UseReception } from "./useReception.js";
import type { UseSourcesClaims } from "./useSourcesClaims.js";
import type { UseSourcesClaimChecks } from "./useSourcesClaimChecks.js";
import { anyPending, type CheckGroup, type ClaimFindings, drawChecks } from "./sources-claim-checks.js";
import type { UseCiters } from "./useCiters.js";
import { dayOf } from "./relative-time.js";
import type {
  PublicClaimReceptionRow,
  PublicReception,
  PublicSourcesClaimList,
  PublicDirectReceptionRow,
  PublicIdentificationSignal,
} from "../public-types.js";
import { BandWaiting } from "./BandWaiting.js";
import { StaleNotice } from "./StaleNotice.js";
import { useStaleNotice } from "./useStaleNotices.js";

/**
 * **A row as this panel draws it** — the owner's stored row and a visitor's
 * public one alike. The public types are the narrower shape (a `linked`
 * signal's address may be gone, `lean` is always in the current vocabulary),
 * and every owner's `DirectReceptionRow` and `ClaimReceptionRow` is one of these, so
 * the owner's path is unchanged. Since 2026-09-29, plan 260929c stage 4.
 */
type DirectRow = PublicDirectReceptionRow;
type ClaimRow = PublicClaimReceptionRow;

/** Either search's row, so one component can draw both. */
type ReceptionRow = DirectRow | ClaimRow;

/**
 * **Any row `Row` draws** — a search's, or a reader's check's. A check's row
 * for a typed claim has no block and no claim quote (`OwnClaimReceptionRow`),
 * and nothing `Row` reads needs either.
 */
type DrawnRow = ReceptionRow | SourcesClaimCheckRow;

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

/** Reception's line for a visitor when no search is stored: the owner's empty state, without the button. */
export const RECEPTION_NONE_SHARED = "Nobody has asked the web about this one yet.";

/** The two of Sources' sub-modes this panel draws, in chip order. */
const RECEPTION_AND_CLAIMS_VIEWS: readonly ReceptionAndClaimsView[] = ["reception", "claims"];

/** The search behind each sub-mode — the artefact's own key for its group. */
const SEARCH_OF: Record<ReceptionAndClaimsView, "direct" | "claims"> = { reception: "direct", claims: "claims" };

/**
 * **What the relevance bar is holding back**: claim rows, called by what they
 * are — answers to what the piece claims. Not *pages*: the head's count and the
 * searches' are both page counts already, and a third number called pages for a
 * third fact is how a panel comes to disagree with itself.
 */
const ANSWER: ThresholdNoun = { one: "answer to its claims", many: "answers to its claims" };

/**
 * **The relevance bar's words**, and the AI line's: the name of the stop, never
 * a number — three named stops of one model judgment, and a number would read
 * as a measurement. On the bar it reads as a rule — *"bears partly · 3 of 5"*,
 * at least partly — and on a row as the judgment.
 */
const BEARS_LABEL: Record<SourcesClaimsBears, string> = {
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

/**
 * The rows that name this article in their own extract — the ones that carry
 * `identifies`, and therefore the ones with a level to put on a chip.
 */
function directOf(row: DrawnRow): DirectRow | null {
  return "articleReferenceQuote" in row ? row : null;
}

/** The witness that a page names this article, for the row's `more`. */
function referenceOf(row: DrawnRow): string | null {
  return directOf(row)?.articleReferenceQuote ?? null;
}

/**
 * **How each lean is drawn, and the record is total.**
 *
 * Four rows because there are four values, and a `Record<ReceptionLean, …>` so
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
 * row the claim heading it sits under. Sol's F19 —
 * without a stated target "leans-for" could mean a friendly register, agreement
 * with one claim, or praise for the whole piece.
 *
 * **The keys are agreement words and the labels are unchanged**, which is the
 * whole shape of the 2026-09-08 repair: what the reader sees is exactly what
 * they saw before, and what the *model* is asked for no longer invites it to
 * report a passage's polarity toward its own subject. src/types.ts §
 * `ReceptionLean`.
 */
export const LEAN_APPEARANCE: Record<
  ReceptionLean,
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
 * **It says *kept*, not *shown*, and that changed on 2026-09-06 with the first
 * threshold bar.** This sentence is arithmetic about the run —
 * `reportedRows` against `keptRows`, and the gap accounted for — and the reader
 * now has a control that decides what is *shown*. *"3 are shown"* over a list of
 * two would be the count-disagrees-with-the-list failure
 * ([`threshold.ts`](threshold.ts)) arriving through the one sentence on this
 * panel whose job is to be trustworthy about counts. What the bar is holding
 * back is said by `hiddenNote`, in the reader's own terms, beside the control
 * that did it.
 */
export function keptNote(counts: ReceptionCounts, which: "direct" | "claims"): string | null {
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
 *  search is handed the rows its sub-mode shows rather than everything the
 * run kept. A reader who raises the relevance bar sees this number fall, and it is still
 * true; leaving it on the unfiltered list would make the words false while the
 * figure looked right.
 */
export function sourcesNote(
  counts: ReceptionCounts,
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
 * tests/reception-and-claims-panel.test.tsx § *"puts every loss reason there is into a
 * sentence the reader gets"*, which walks every field of `ReceptionLosses` and
 * fails on one the sentence cannot account for.
 */
function footLines(reception: {
  direct: { rows: readonly { url: string }[]; counts: ReceptionCounts };
  /* `null` when the claims search did not run (`debate/7` on): there are no
     counts to say anything about, and the (i) says that instead. */
  claims: { rows: readonly { url: string }[]; counts: ReceptionCounts } | null;
}): string[] {
  return [
    keptNote(reception.direct.counts, "direct"),
    sourcesNote(reception.direct.counts, reception.direct.rows, "direct"),
    reception.claims && keptNote(reception.claims.counts, "claims"),
    reception.claims && sourcesNote(reception.claims.counts, reception.claims.rows, "claims"),
  ].filter((line): line is string => typeof line === "string");
}

/**
 * **Did this group's search not run?** Only the claims group can say so, and
 * only on a debate searched at `debate/7` or later (src/types.ts §
 * `ReceptionClaims`); absent `pass` is a search that ran. Generic so either arm's
 * group, owner's or visitor's, narrows to the searched member afterwards.
 */
function notRun<G extends object>(group: G | ReceptionClaimsNotRun): group is ReceptionClaimsNotRun {
  return (group as { pass?: unknown }).pass === "not-run";
}

/**
 * Which of the two a debate on this panel is. The public one is the only one
 * with a boundary count on its groups; the owner's has the stored `counts`.
 */
function isShared(reception: Reception | PublicReception): reception is PublicReception {
  return "sourceNotPublishable" in reception.direct;
}

/**
 * **A visitor's foot line: what the shared link left out, per search** — the
 * boundary's own count (src/public/dto.ts § `publicReception`), never the
 * artefact's. 260905f § What is counted: a shorter list must say so.
 */
export function withheldLines(reception: PublicReception): string[] {
  return (["direct", "claims"] as const)
    .map((which) => withheldNote(reception, which))
    .filter((line): line is string => line !== null);
}

/** One search's withheld sentence, or nothing when the boundary withheld none. */
function withheldNote(reception: PublicReception, which: "direct" | "claims"): string | null {
  const group = reception[which];
  /* A claims search that did not run withheld nothing. */
  if (notRun(group)) return null;
  const n = group.sourceNotPublishable;
  return n > 0 ? receptionWithheldOnSharedLink(SEARCH_NAME[which], n) : null;
}

/**
 * **What a sub-mode says when its search stored no row for this reader** — or
 * nothing, when it stored one. Each sub-mode says its own search's sentence and
 * only its own; the other's is a press away, in its own sub-mode.
 *
 * Every distinction the one mixed list made is kept, per sub-mode (GPT Sol's
 * F1 on plan 261003o), because they are different facts about the world:
 *
 *  - **owner, nothing returned** against **owner, pages returned and none
 *    could be checked** — `emptyGroupNote`, off `returnedSources`;
 *  - **visitor, the search kept nothing** — one sentence true of both of the
 *    above, because the count that tells them apart does not cross
 *    (src/public-types.ts § `PublicReceptionGroup`);
 *  - **visitor, rows withheld at the public boundary** — the search *did*
 *    keep something, so saying it kept nothing would be false. The sentence is
 *    the foot's own (`withheldLines`), said here as well because an empty
 *    screen that explains itself only inside the (i) reads as broken.
 *
 * **A list the reader's own bar or thread emptied is not here**, and must not
 * be: that is a fact about a setting, not about the search, and the bar's note
 * and the thread's line already say which (`StopBar`, `Threads`). The caller
 * asks this of the **stored** rows.
 */
export function emptyNote(reception: Reception | PublicReception, which: "direct" | "claims"): string | null {
  if (reception[which].rows.length > 0) return null;
  /* **No search ran, so none found nothing** — a debate searched at
     `debate/7` or later, whose press looked for Reception only (src/types.ts §
     `ReceptionClaims`). Asked first in each arm: the other sentences are about a
     search. */
  /* **Since the claims list (plan 261008i stage 2) a not-run group says
     nothing here**: Claims draws the list, or the list's own empty state, and
     the (i) says once that this search did not look into the claims
     (`SOURCES_CLAIMS_NOT_SEARCHED_SHARED`). */
  if (notRun(reception[which])) return null;
  if (!isShared(reception)) {
    const group = reception[which];
    return notRun(group) ? null : emptyGroupNote(group.counts, which);
  }
  return (
    withheldNote(reception, which) ??
    (which === "direct" ? RECEPTION_RESPONSES_NONE_SHARED : SOURCES_CLAIMS_NONE_SHARED)
  );
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
 * Reception's order bar's words — Glossary's register, short and lower-case. A
 * `Record`, so a fourth order cannot arrive without them.
 *
 * `prioritised` reads *as found*: the word in the address is from when this
 * order sorted claim rows by the AI's judgment, and Reception's rows carry
 * none. **The sentence that said what the order was, on a line over the list,
 * went on 2026-10-03** (plan 261003o, step 8): the pressed button says it, and
 * these titles say whose reading an order rests on.
 */
const ORDER_OPTION: Record<ReceptionOrder, { label: string; title: string }> = {
  prioritised: { label: "as found", title: "In the order the search found them" },
  date: { label: "date", title: "Oldest first, by the year the AI read off each page; pages with no year come last" },
  stance: { label: "stance", title: "Most critical first — the AI's reading of each page" },
};

/**
 * **What one search says when it kept no rows**, and it is three sentences
 * rather than one: no pages came back; pages came back and the AI put none
 * forward; the AI put some forward and none survived our checks (plan 261010n).
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
 * **A fourth is deliberately not here either**: every row hidden by the
 * relevance bar, which is `hiddenNote`'s. That is a fact about the reader's own
 * setting rather than about the search, so it does not belong in a sentence
 * whose subject is what came back.
 */
export function emptyGroupNote(counts: ReceptionCounts, group: "direct" | "claims"): string {
  if (counts.returnedSources === 0) {
    return group === "direct" ? RECEPTION_RESPONSES_NONE : SOURCES_CLAIMS_NONE;
  }
  /* **The AI put nothing forward**: nothing was checked, so this must not say a
     check failed. Until plan 261010n it shared the next case's sentence, and
     Greg could not tell what it meant (spya-qtk3q2). */
  if (counts.reportedRows === 0) {
    return group === "direct"
      ? receptionResponsesNoneSuggested(counts.returnedSources)
      : sourcesClaimsNoneSuggested(counts.returnedSources);
  }
  return group === "direct"
    ? receptionResponsesUnverified(counts.returnedSources, counts.reportedRows)
    : sourcesClaimsUnverified(counts.returnedSources, counts.reportedRows);
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
 * refused: docs/project/quotes.md, and the plan's § 2. The order shows in the
 * layout instead: the *names* rows sit under their own heading
 * (reception-levels.ts).
 */
const IDENTIFICATION_LABEL: Record<IdentificationLevel, string> = {
  linked: "Links this piece",
  quoted: "Quotes this piece",
  named: "Names this piece",
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
         in it (src/public/dto.ts § `publicReception`). The fact stays; the
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
export type ReceptionOwner = UseReception;

/**
 * **Who is reading, and what they get — one prop, so the two cannot disagree.**
 *
 * Two arms since 2026-09-29, when Stage 4 built the public contract the
 * visitor's arm waited for (plan 260929c). `owner?: never` is load-bearing
 * rather than tidy — without it the union catches only a fresh object literal
 * at the call site. GlossaryPanel.tsx § GlossaryAccess is the full argument.
 */
export type ReceptionAndClaimsAccess =
  /* `citers` is the owner's second read, Reception's *Cited by*
     (src/web/useCiters.ts). Beside `owner` rather than on it, because it is
     not the stored Reception's and has no job: it can be on screen with no Reception
     at all. A visitor has none (plan 261004h). */
  /* `claimChats` is the owner's too (plan 261005i): a visitor has no chat, so
     their arm has no handler to be handed and the claims draw neither the
     button nor the mark. Required here, so `Reader` cannot leave it out and
     still type-check. */
  /* `claimList` is the owner's third read, Claims' list of the article's
     claims (src/web/useSourcesClaims.ts, plan 261008i § 2). Its own hook, read,
     job and press, independent of whether a Reception search is stored. */
  /* `checks` is the owner's fourth read: the claims the reader picked and the
     web search each press bought (src/web/useSourcesClaimChecks.ts, plan 261008i
     § 3). Owner-only — a check may hold the reader's own typed claim — so a
     visitor's arm has none. */
  | {
      kind: "owner";
      owner: ReceptionOwner;
      claimList: UseSourcesClaims;
      checks: UseSourcesClaimChecks;
      citers: UseCiters;
      claimChats: ReceptionAndClaimsChats;
    }
  /* **The visitor's arm, since 2026-09-29** (plan 260929c stage 4): the stored
     debate off the public payload and nothing else — no read status (it came
     with the page), no job, no verb, so nothing on a visitor's panel can start
     a search. **And the claims list since 2026-10-08**, read-only: either may
     be absent, never both (Reader.tsx mounts this band only when one is
     there). */
  | {
      kind: "visitor";
      reception: PublicReception | null;
      claimList: PublicSourcesClaimList | null;
      owner?: never;
    };

/**
 * **A claim's chat: starting one, and the way back to one already started.**
 * Plan docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md.
 *
 * Called a *chat* throughout, never a thread: `?receptionthread=` and
 * reception-threads.ts already use that word here for a synthesis theme.
 *
 * Nothing is stored on the claim. The conversation records the claim it was
 * started from (`ClaimOrigin`: the block and the words), and the mark is found
 * by matching the claim against `summaries` — the reading view's list, which
 * `Reader` owns and keeps current.
 *
 * **And an angle's chat, since the same day** (`onLens`, plan 261005k, A):
 * the box at the top of the panel starts one, and *Your angles* under it is
 * the way back, found in the same `summaries` (`lensThreads`).
 */
export interface ReceptionAndClaimsChats {
  summaries: readonly ThreadSummary[];
  /** Start a fresh chat about this claim. Goes to Chat and sends the question: one press, one model call (plan 261006j). */
  onCheck(origin: ClaimOrigin): void;
  /**
   * Start a fresh chat that looks at the debate from this angle, the reader's
   * own words. Goes to Chat and sends the question, as `onCheck` does, so
   * the press is what starts the web search.
   */
  onLens(lens: string): void;
  /** Open a conversation already started from a claim or an angle, beside Sources. */
  onOpen(threadId: string): void;
}

/** The button on a claim's heading: its tooltip and its accessible name. */
export const SOURCES_CLAIM_CHECK_CLAIM = "Check this claim in chat";
/** The mark on a claim a chat was started from. */
export const SOURCES_CLAIMS_OPEN_CLAIM_CHAT = "Open the chat about this claim";

/** The angle box: its accessible name, and (with an ellipsis) its placeholder. */
export const RECEPTION_LENS_LABEL = "Look at the debate from an angle";
/** The box's button. The words Glossary's handoff to Chat already uses. */
export const RECEPTION_LENS_SEND = "Ask in chat";
/** The button's tooltip: where a press goes, and that it asks at once. */
export const RECEPTION_LENS_TIP =
  "Opens Chat and asks what others say on this straight away, with a web search.";
/** The heading over the chats started from an angle. */
export const RECEPTION_ANGLES_HEAD = "Your angles";
/** A line of *Your angles*: its accessible name. */
export const RECEPTION_OPEN_ANGLE_CHAT = "Open the chat about this angle";
/** How many of them are on screen before *Show all*. */
export const RECEPTION_ANGLES_SHOWN = 3;

interface Props {
  access: ReceptionAndClaimsAccess;
  /**
   * **Sources' chip row**, drawn as this band's header (SourcesMode.tsx
   * § `SourcesViews`). The mode's, not this panel's, so Bibliography's panel
   * draws the same row and switching sub-mode does not move it.
   */
  head: ReactNode;
  /**
   * Go to the block a claim's passage is in.
   *
   * **Marks in the prose are deliberately not in v1** — they are the first
   * thing to add, and they want a resolver into `search-hits.ts`'s `Found`
   * currency. A *jump* is not a mark: a heading that quotes the article's own
   * words and names the block they are in has to offer the reader the way
   * there, or it is asking them to search for a sentence it is already holding.
   */
  onJump(id: BlockId): void;
  /**
   * Which of Sources' sub-modes this panel draws — Reception or Claims,
   * from `?sources=` (Bibliography is the other panel's).
   */
  view: ReceptionAndClaimsView;
  /** Move to the other sub-mode: the empty Reception's way on to Claims. */
  onView(view: ReceptionAndClaimsView): void;
  /**
   * The order the reader asked for in Reception — `?receptionby=`, whose parser
   * defaults to `prioritised` (*as found*). What is drawn is
   * `effectiveReceptionOrder` of it, which can differ (reception-order.ts). Claims
   * ignores it.
   */
  order: ReceptionOrder;
  onOrder(order: ReceptionOrder): void;
  /**
   * **Each block's position in the article**, for Claims' article order. Not
   * in the artefact — the article's blocks are — so `Reader` builds it once and
   * hands it to both bands (260929h's F8). A block missing from it keeps the
   * search's order.
   */
  blockOrder: ReadonlyMap<BlockId, number>;
  /**
   * Where the reader has put Claims' relevance bar — `?bears=`, or `null` for
   * *hasn't touched it*, resolved here to `RELEVANCE_DEFAULT` (`loosely`, which
   * hides nothing). Null rather than a defaulted level, so the constant lives
   * in one file and *set to the default* stays distinguishable from *never
   * set*, which is what the reset button is drawn from.
   */
  relevance: SourcesClaimsBears | null;
  onRelevance(level: SourcesClaimsBears | null): void;
  /**
   * The year the article gives for itself (`Meta.publishedAt`), for *date*'s
   * marker — or `null`, and then there is no marker. A visitor's meta does not
   * carry it, so a visitor gets none.
   */
  articleYear: number | null;
  /**
   * Which thread narrows the list — `?receptionthread=`, a theme id or `key`, or
   * `null` for none (reception-threads.ts). A visitor's Reception payload carries the
   * synthesis since 2026-10-01 unless the public boundary withheld a row
   * (src/public/dto.ts § `publicSynthesis`), and then there is nothing to name.
   */
  thread: string | null;
  onThread(thread: string | null): void;
  /**
   * The article's own title, for Reception's *Who cites it: search Google
   * Scholar* — or `null`, and then there is no link: a search for nothing is
   * not a search. The owner's and a visitor's meta both carry it.
   */
  articleTitle: string | null;
  /**
   * **One claim to bring into view in Claims, once** — a chat's way back to
   * the claim it was started from (src/web/item-focus.ts; plan 261009k,
   * stage 2). Its id is `claimFocusKey` of the claim's block and words. The
   * caller has already opened Claims and cleared `?bears=` and
   * `?receptionthread=`, which could hide it; this scrolls its row into view
   * and unfolds an older search's claim. It does not jump the prose: on a
   * phone the band covers it, and the row's own block link does that (the
   * plan's F4). A claim no list has is handed back, and Claims shows its list.
   */
  focus?: ItemFocus | null | undefined;
  onFocusTaken?: ((focus: ItemFocus) => void) | undefined;
  /**
   * **Bibliography's works, for Claims' *Cited in this paragraph*** (plan
   * 261009l § C1; src/web/cited-in-paragraph.ts): under each listed claim, the
   * works the article cites in that claim's paragraph, each opening its
   * Bibliography row. `null` with no Bibliography, and then there is no line.
   */
  citedIn?: CitedInParagraph | null | undefined;
}

export function ReceptionAndClaimsPanel({
  access,
  head,
  onJump,
  view,
  onView,
  order: requestedOrder,
  onOrder,
  blockOrder,
  relevance: chosenRelevance,
  onRelevance,
  articleYear,
  thread: threadParam,
  onThread,
  articleTitle,
  focus = null,
  onFocusTaken,
  citedIn = null,
}: Props) {
  useRenderCount("ReceptionAndClaimsPanel");
  /* `null` for a visitor, and every owner-only thing below is behind it. */
  const owner = access.kind === "owner" ? access.owner : null;
  const reception = access.kind === "owner" ? access.owner.reception : access.reception;
  /* A visitor's Reception arrived with the page, so it is ready by construction. */
  const ready = reception !== null && (owner === null || owner.status === "ready");
  /* Reception's stale banner's × (plan 261010a): this search, by its clock. */
  const staleNotice = useStaleNotice({
    slug: owner?.slug ?? null,
    mode: "reception",
    identities: owner?.stale ? (owner.reception?.searchedAt ?? null) : null,
  });
  const directRows: readonly DirectRow[] = reception?.direct.rows ?? NO_DIRECT;
  const claimRows: readonly ClaimRow[] = reception?.claims.rows ?? NO_CLAIMS;

  /**
   * **The threads** — plan 260930j. The owner's stored synthesis read through
   * `readStoredSynthesis`, never directly: JSONB comes back unchecked. A
   * visitor's is read the same way, against the rows they were sent — the
   * public DTO has already re-settled it against exactly those (plan 261001b),
   * so this second reading agrees with it, and one reader serves both arms.
   *
   * **Each sub-mode is asked separately which of them it offers and which one
   * the address selects** (`threadsWithin`): a thread with no stored row in a
   * sub-mode is not offered there and narrows nothing there.
   *
   * **The selections are sources-counts.ts's**, the same functions the
   * chip row counts with, so the number on a chip and the list under it are
   * one derivation (GPT Sol's F4 on plan 261009l).
   */
  const synthesis = useMemo(
    () => (reception !== null ? readStoredSynthesis(reception) : null),
    [reception],
  );
  /* `threadsOf(readStoredSynthesis(…))` is `receptionThreads`, which the chip
     row counts with (sources-counts.ts). */
  const threads = useMemo(() => threadsOf(synthesis), [synthesis]);
  const keyRows = useMemo(() => keyByRow(synthesis), [synthesis]);

  /**
   * **Reception: the rows about this piece, in two groups, every one on
   * screen.** No bar: the identification slider that stood here hid the
   * title-only rows by default, and those are the citing papers
   * (reception-levels.ts).
   *
   * Which order is drawn and which are offered are asked of the groups the
   * **thread left on screen**: an order whose distinction depended on rows
   * outside the thread would be an inert button over this list.
   */
  const selected = useMemo(
    () => receptionSelection(reception, threads, threadParam),
    [reception, threads, threadParam],
  );
  const receptionThreads = selected.threads;
  const receptionThread = selected.thread;
  const receptionShown = selected.shown;
  const sections = useMemo(() => receptionSections(receptionShown), [receptionShown]);
  const shownSections = useMemo(() => [sections.confirmed, sections.titleOnly], [sections]);
  const order = useMemo(
    () => effectiveReceptionOrder(shownSections, requestedOrder, articleYear),
    [shownSections, requestedOrder, articleYear],
  );
  const orders = useMemo(
    () => receptionOrderOptions(shownSections, articleYear),
    [shownSections, articleYear],
  );
  const confirmed = useMemo(
    () => orderReceptionRows(sections.confirmed, order, articleYear),
    [sections, order, articleYear],
  );
  const titleOnly = useMemo(
    () => orderReceptionRows(sections.titleOnly, order, articleYear),
    [sections, order, articleYear],
  );

  /**
   * **Claims: the relevance bar, applied once, then the thread, then the
   * grouping.** The list, the bar's *N of M*, each claim's count, the chip's
   * count and the foot's page count are all read out of this one pass —
   * `threshold.ts`'s whole argument, and why there is no second filter below.
   *
   * The bar is **drawn** only when some claim row carries the AI's `bears`
   * (every search before `debate/3` has none) — and then always, whatever the
   * rows' levels: two `partly` rows are both hidden by `?bears=directly`, and a
   * reader who arrives on that link needs the bar to see why the list is empty
   * and its reset to get out (GPT Sol's F2 on plan 261003o). With no judged row
   * the pass hides nothing, because an unjudged row always survives.
   */
  const relevance = chosenRelevance ?? RELEVANCE_DEFAULT;
  const judged = useMemo(() => claimRows.some((row) => readBears(row) !== null), [claimRows]);
  const claimSelection = useMemo(
    () => claimsSelection(reception, threads, chosenRelevance, threadParam),
    [reception, threads, chosenRelevance, threadParam],
  );
  const barredClaims = claimSelection.barred;
  const claimThreads = claimSelection.threads;
  const claimThread = claimSelection.thread;
  const claimsShown = claimSelection.shown;
  const claimGroups = useMemo(() => groupByClaim(claimsShown, blockOrder), [claimsShown, blockOrder]);

  /**
   * **Claims' list of the article's claims** (plan 261008i § 2) — the owner's
   * once its read is `ready`, a visitor's off the payload, else `null`. The
   * chip's count is the list's length when there is one: the list is what
   * Claims is now, and the legacy rows under it are an older search's. With no
   * list, the count is those legacy rows, as before (`claimsCount`,
   * sources-counts.ts).
   */
  const listOwner = access.kind === "owner" ? access.claimList : null;
  const listed: readonly ListedClaim[] | null = listedClaims(
    access.kind === "owner"
      ? { kind: "owner", status: access.claimList.status, claimList: access.claimList.claimList }
      : { kind: "visitor", claimList: access.claimList },
  );

  /* **Land on the focused claim** (src/web/item-focus.ts), in either of
     Claims' lists: the listed claims, and an older search's claim groups.
     Ready once both reads have answered, so a claim in the slower one is not
     dropped by the faster. Every claim either list holds is drawn: the
     filters that could hide an older one were cleared by the way back. */
  const surface = useRef<HTMLElement>(null);
  const focusKnown =
    focus !== null &&
    ((listed?.some((c) => claimFocusKey(c) === focus.id) ?? false) ||
      claimGroups.some((g) => claimFocusKey({ blockId: g.blockId, quote: g.claimQuote }) === focus.id));
  useLandOnItem({
    focus,
    ready:
      view === "claims" &&
      (listOwner === null || listOwner.status !== "loading") &&
      (owner === null || owner.status !== "loading"),
    known: focusKnown,
    drawn: focusKnown,
    scope: surface,
    attribute: "data-claim-key",
    onTaken: onFocusTaken,
    onLand: (row) => {
      if (row instanceof HTMLDetailsElement) row.open = true;
    },
  });

  /* **The rows on screen**: the sub-mode's own, through its bar and its thread.
     The head count in the (i) reads this. */
  const rows: readonly ReceptionRow[] = view === "reception" ? receptionShown : claimsShown;

  /* **What this sub-mode's search came back with, when that was nothing** —
     asked of the stored rows, so a list the reader's own bar or thread emptied
     never gets a search-empty sentence (`emptyNote`). And the way on, when
     Reception has nothing and Claims has something: on a paper nobody has
     written about, the claims are the whole of what was found. */
  const empty = reception === null ? null : emptyNote(reception, SEARCH_OF[view]);
  const handoff = view === "reception" && directRows.length === 0 && claimRows.length > 0;

  /* **Each search's losses**, for the (i) — both searches', whichever sub-mode
     is open, because provenance is about the run rather than the screen. Each
     is handed the rows its own sub-mode shows: `sourcesNote` counts the pages
     that *contribute to the rows shown*, and a bar or a thread decides which
     those are (GPT Sol's review of 260930j, F6). */
  const foot = useMemo(() => {
    if (reception === null) return [];
    /* A visitor's foot is what the public boundary withheld, and only that:
       the stored counts behind the owner's four sentences do not cross
       (src/public-types.ts § `PublicReceptionGroup`). */
    if (isShared(reception)) return withheldLines(reception);
    const claims = reception.claims;
    return footLines({
      direct: { rows: receptionShown, counts: reception.direct.counts },
      claims: notRun(claims) ? null : { rows: claimsShown, counts: claims.counts },
    });
  }, [reception, receptionShown, claimsShown]);
  /* **This debate's press did not search for claims** (`debate/7` on). The
     (i) says so for both arms, where the claims search's own sentences would
     otherwise be; a debate stored before then shows its claim rows under
     their own heading instead (`SOURCES_CLAIMS_EARLIER`). */
  const claimsNotRun = reception !== null && notRun(reception.claims);

  /**
   * @param again beside a debate that is already there, so the run is forced.
   *   The empty state's button is not: it has to make the identical, unforced
   *   request the automatic run makes, or the two carry different `work_key`s
   *   and the reader pays for two Reception searches. useReception.ts § `ensure`.
   */
  /* A forced run has finished and its result is not here yet: the forced
     button gives way to a read, never to a second paid run — IdeasPanel.tsx §
     `run` is the sibling. rewrite-hold.ts. */
  const waiting = owner !== null && owner.rewriting && !owner.job && !owner.starting && !owner.failed;
  const run = (label: string, again = false) =>
    owner === null ? null : again && waiting && !owner.error ? (
    <RewriteWaiting line="The new search hasn't loaded yet." onRead={owner.refresh} className="tw:m-0" />
    ) : (
    <JobProgress
      job={owner.job}
      starting={owner.starting}
      failed={owner.failed}
      stalled={owner.stalled}
      onRun={() => (again ? owner.regenerate() : owner.ensure())}
      /* With `error` set the retry is `ReadError`'s; the button stays held. */
      runDisabled={again && owner.rewriting}
      onCancel={owner.cancel}
      label={label}
      step="reception"
      icon={<Globe size={13} />}
      runningLabel="Searching…"
    />
  );

  /* **What the band's (i) adds after the mode's own words** — moved there on
     2026-10-01 (spya-ucu35y, plan 261001m): the count, the foot lines that
     were under the last row, the extracts-only sentence, and when the search
     ran. Since 2026-10-03 also what each sub-mode is, which docs/project/mode.md
     keeps off the panel (no description line under a control). The count is
     **the rows on screen**, so it moves with the sub-mode, the bar and the
     thread; `headCount` says why it is excerpts *and* pages. It and the foot
     lines are different facts: **what is on screen**, and **pages each search
     returned**, each naming its own search. A visitor's debate keeps
     `searchedAt` and nothing else of provenance (src/public-types.ts). */
  const made = owner?.reception ?? null;
  /* The owner's *Cited by* is on screen with or without a stored search, so
     where it comes from and what is sent is said in both. */
  const aboutCiters = owner !== null ? <p>{CITERS_ABOUT}</p> : null;
  const about =
    reception && ready ? (
      <>
        <p>{headCount(rows)} on screen.</p>
        {RECEPTION_AND_CLAIMS_VIEWS.map((v) => (
          <p key={v}>
            {SOURCES_SUB_MODES[v].label}: {SOURCES_SUB_MODES[v].description}.
          </p>
        ))}
        {foot.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {claimsNotRun && <p>{SOURCES_CLAIMS_NOT_SEARCHED_SHARED}</p>}
        <p>{RECEPTION_EXTRACTS_ONLY}</p>
        {aboutCiters}
        <AboutMade
          verb="Searched"
          generator={made?.generator}
          version={made?.version}
          generatedAt={reception.searchedAt}
          elapsedMs={made?.elapsedMs}
        />
      </>
    ) : (
      aboutCiters
    );

  /* The sub-mode on screen's threads, the one selected there, and the rows its
     counts are out of: Claims' are the rows its bar left, Reception's every
     stored row, since nothing there hides one. */
  const viewThreads = view === "reception" ? receptionThreads : claimThreads;
  const viewThread = view === "reception" ? receptionThread : claimThread;
  const beforeThread: readonly ReceptionRow[] = view === "reception" ? directRows : barredClaims.visible;
  const scholar = articleTitle?.trim() ? scholarUrl(articleTitle.trim()) : null;

  /**
   * **The owner's *Cited by***, or null. On screen with Reception, whether or
   * not a search is stored. Built once and placed in one of two spots below,
   * at the end of Reception's list or under the not-searched-yet states, which
   * cannot both be drawn.
   */
  const citedBy =
    access.kind === "owner" && view === "reception" ? (
      <CitedBy citers={access.citers} scholar={scholar} />
    ) : null;

  return (
    <ModeSurface
      ref={surface}
      label={MODE_LABEL.sources}
      feature="gloss rcp sources"
      mode="sources"
      about={about}
      /* **Sources' chip row, the one header that cannot come out
          empty** (plan 261008i § 5, GPT Sol's F9): Claims has its own list
          and must be reachable before any search is, while one loads and when
          one failed. Each chip's count is its own list's
          (sources-counts.ts), so the number and the list under it cannot
          disagree. It was the globe and an `<h2>Debate</h2>` until
          2026-10-09, with Reception | Claims as the body's first row; the
          mode's name is the Dock's to say (docs/project/mode.md § The client). */
      head={head}
      /* No standing redo button under the list any more. Greg, 2026-09-29
          (SPIDERYARN-READING2-53): *"Same goes for any other modes that still
          have a "redo this processing" button - let's just rely on the
          Metadata mode for that."* Metadata's *AI processing* has a row
          for this mode; the button inside the stale banner stays, as a
          repair the page is prompting rather than a standing redo.
          docs/plans/260929b-one-place-to-re-run-ai-processing.md.

          Keep the footer only while a current search's job is starting,
          running or failed. It remains the mode's one surface for progress,
          Stop, a stall warning and the failure sentence. Not on a stale
          search, whose banner carries the job; an outdated one has no banner
          (plan 260929c), so its job shows here. **While the banner shows,
          not while stale** (plan 261010a, GPT Sol's finding 4): a dismissed
          banner carries no job. */
      foot={
        reception &&
        owner !== null &&
        (view === "reception" || !claimsNotRun) &&
        owner.status === "ready" &&
        staleNotice.showing.length === 0 &&
        (owner.job || owner.starting || owner.failed || (waiting && !owner.error)) ? (
          <div className="rcp-again">{run("Search again", true)}</div>
        ) : null
      }
    >

      {/* **The angle box and *Your angles*, first and unconditional for the
          owner**: before any search is stored, while one is loading, on a
          stale one. An angle is a chat and needs no stored Reception (GPT Sol's
          review of plan 261005k, answer 2). A visitor has no chat and gets
          neither. */}
      {access.kind === "owner" && <Angles chats={access.claimChats} />}

      {view === "reception" && owner?.error && <ReadError error={owner.error} onRetry={owner.retryRead} />}

      {view === "reception" && owner?.status === "loading" && (
        <BandWaiting className="gloss-quiet">Looking for what the web says…</BandWaiting>
      )}

      {view === "claims" &&
        (listOwner !== null ? (
          <OwnerListedClaims
            list={listOwner}
            checks={access.kind === "owner" ? access.checks : null}
            onJump={onJump}
            chats={access.kind === "owner" ? access.claimChats : null}
            citedIn={citedIn}
          />
        ) : (
          <div className="rcp-listed-wrap">
            {listed === null ? (
              <p className="gloss-quiet rcp-listed-none">{SOURCES_CLAIMS_LIST_NONE_SHARED}</p>
            ) : listed.length === 0 ? (
              <p className="gloss-quiet rcp-listed-none">{SOURCES_CLAIMS_LIST_EMPTY}</p>
            ) : (
              <ListedClaims claims={listed} onJump={onJump} chats={null} citedIn={citedIn} />
            )}
          </div>
        ))}

      {view === "reception" && owner?.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has asked the web about this one yet.</p>
          {/* The price, before the button rather than after it. A model call
              that goes out to the open web is the dearest press in this bar,
              and a reader is entitled to know that at the moment they decide —
              and what it searches for: Reception only since `debate/7`, the
              claims being the reader's to pick. docs/project/copy.md. */}
          <p className="gloss-hint">{RECEPTION_BEFORE_SEARCH}</p>
          {run("Search the web")}
        </div>
      )}

      {/* **A visitor on Reception with no search stored**: Sources opened
          on another sub-mode's artefact (visitor.ts § POLICY, `any-artefact`),
          so this one says it has nothing rather than drawing a blank band.
          GPT Sol's F3 on plan 261009l. */}
      {view === "reception" && access.kind === "visitor" && reception === null && (
        <p className="gloss-quiet rcp-none-shared">{RECEPTION_NONE_SHARED}</p>
      )}

      {/* **Before a search is stored: Cited by, on its own.** Outside the
          `debate && ready` block on purpose (GPT Sol's F8): the list is free and
          is the fastest answer to "has anyone cited this", so it must not wait
          for a paid search, and it is not a control that starts one. */}
      {!(reception && ready) && citedBy && <div className="rcp-scroll">{citedBy}</div>}

      {/* **In Claims, only for an older search's rows**: a debate searched since
          `debate/7` has none, and its stale banner is about Reception. */}
      {reception && ready && (view === "reception" || !claimsNotRun) && (
        <>
          {/* Stale wins when both are true, for the reason every sibling panel
              gives: it is the one that can make a row false rather than merely
              dated, and two banners stacked is a wall.

              **Neither of these is about the age of the search.** That is
              `searchedAt`, said below in its own words, and a year-old search
              on an unchanged article is not stale — it is dated, which is a
              thing a reader can weigh for themselves. src/types.ts §
              `Debate.searchedAt`. */}
          <StaleNotice notice={staleNotice} action={run("Search again", true)}>
            The article has changed since this search ran, so some of these may be answering
            something the piece no longer says.
          </StaleNotice>
          {/* No banner for an outdated search (older prompt, same article) —
              Greg, 2026-09-29 (SPIDERYARN-READING2-55): *"it's not worth
              bugging the user about it."* Re-running is in Metadata. Plan
              260929c. */}

          {/* **Reception's order bar**, where Glossary's is: a control on the
              list. Only when at least two orders would draw different lists
              (reception-order.ts § `receptionOrderOptions`) — one button, or two
              that give the same list, is a control that visibly does nothing.
              Claims has none: it is always grouped by claim. */}
          {view === "reception" && orders.length > 0 && (
            <OrderBar options={orders} order={order} onOrder={onOrder} />
          )}

          {/* **Claims' relevance bar, above the list and outside the
              scroller**, where every other threshold in this app sits: it is a
              control on the list, not provenance to read after it. */}
          {view === "claims" && judged && (
            <RelevanceBar
              barred={barredClaims}
              level={relevance}
              moved={chosenRelevance !== null}
              onLevel={onRelevance}
            />
          )}

          <div className="rcp-scroll">
            {/* **The negative result**, which on a famous piece with no
                reception has to read as a finding — and, under Reception's,
                the way to what the other search did find. */}
            {empty !== null && <p className="gloss-quiet rcp-empty">{empty}</p>}
            {handoff && (
              <button type="button" className="rcp-handoff" onClick={() => {
                /* The button promises every stored source. Normal segment
                   presses preserve narrowing; this explicit handoff shows all. */
                onRelevance(null);
                onThread(null);
                onView("claims");
              }}>
                {sourcesClaimsHandoff(claimRows.length)}
              </button>
            )}

            {/* **The threads, above the rows and inside the scroller** — they
                are a reading of the list, so they scroll with it rather than
                pinning over it like the bar. Plan 260930j. */}
            {viewThreads.length > 0 && (
              <Threads
                threads={viewThreads}
                selected={viewThread}
                visible={beforeThread}
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
            {synthesis?.kind === "failed" && <p className="rcp-thread-failed">{RECEPTION_THREADS_FAILED}</p>}

            {view === "reception" ? (
              <>
                <ReceptionList confirmed={confirmed} titleOnly={titleOnly} keyRows={keyRows} />
                {/* **Who cites it.** A paper that cites the piece and says
                    something about it is reception, and the search looks for
                    those. The owner then gets the list itself, from OpenAlex
                    (`citedBy`, which ends with the Scholar link). A visitor
                    gets no list in v1, so for them it is still one link out —
                    a search by title, never a guessed address (plan 261003f's
                    rule for author links) — and it is there when Reception
                    kept nothing, which is when it is most use. `noreferrer`
                    like every other link out. */}
                {citedBy ??
                  (scholar !== null && (
                    <a className="rcp-scholar" href={scholar} target="_blank" rel="noreferrer noopener">
                      Who cites it: search Google Scholar
                      <ExternalLink size={11} aria-hidden="true" />
                    </a>
                  ))}
              </>
            ) : (
              <>
                {/* **An older search's claims, under their own heading** — a
                    debate stored before `debate/7`, whose press picked three or
                    four claims by itself. Asked of the stored rows, so the
                    heading stays when the bar or a thread hides them all. A
                    debate searched since has none, and its empty sentence is
                    above. */}
                {!claimsNotRun && claimRows.length > 0 && (
                  <h3 className="rcp-group-head">{SOURCES_CLAIMS_EARLIER}</h3>
                )}
                <ClaimsList
                  groups={claimGroups}
                  onJump={onJump}
                  keyRows={keyRows}
                  chats={access.kind === "owner" ? access.claimChats : null}
                  citedIn={citedIn}
                />
              </>
            )}

            {/* Both searches' numbers (`footLines`) and the extracts-only
                sentence were here, under the last row, until 2026-10-01; they
                are in the band's (i) now (spya-ucu35y). */}
          </div>

        </>
      )}

    </ModeSurface>
  );
}

/**
 * **Look at the debate from an angle** — the owner's box at the top of the
 * panel, and *Your angles* under it.
 * Plan docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md, A.
 *
 * ```
 *  [ Look at the debate from an angle…        ] [💬 Ask in chat]
 *  YOUR ANGLES
 *   💬 “replication attempts”                               2
 *   💬 “how it relates to Smith 2019”                       1
 * ```
 *
 * **The box starts a chat; it does not steer the stored search.** Enter or
 * the button hands the words to `Reader`, which opens Chat on a fresh
 * conversation and sends the question (plan 261006j). So this component starts
 * no job and has no waiting state: the answer arrives in Chat, which the
 * reader is by then looking at. Why a chat and not a steered search is in
 * docs/project/reception.md § Look at the debate from an angle.
 *
 * **The list is the way back**, one line per chat started from an angle,
 * newest first, found in the reading view's thread summaries (`lensThreads`).
 * A line opens its chat beside Sources, as a claim's mark does. The newest
 * `RECEPTION_ANGLES_SHOWN` and then *Show all*, so a reader with many does not
 * have to scroll past them to reach the debate on a phone.
 *
 * The box and its row are Glossary's *Look up a term* (`.gloss-ask`), which
 * this band already shares the `gloss` feature with: the same field, the
 * reader's face from voices.css, and the same room left for the band's (i).
 * No sentence under the box (docs/project/mode.md): what a press does is the
 * button's tooltip.
 */
function Angles({ chats }: { chats: ReceptionAndClaimsChats }) {
  const [lens, setLens] = useState("");
  const [all, setAll] = useState(false);
  const angles = useMemo(() => lensThreads(chats.summaries), [chats.summaries]);
  const shown = all ? angles : angles.slice(0, RECEPTION_ANGLES_SHOWN);
  const words = lens.trim();
  return (
    <div className="gloss-ask rcp-lens">
      <form
        className="gloss-ask-row rcp-lens-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (words === "") return;
          chats.onLens(words);
          /* The words have become the fresh chat's first question. */
          setLens("");
        }}
      >
        {/* `maxLength` is the server's cap, counted here before trimming, so
            the box can only refuse what the route would refuse or a little
            more: the harmless direction (GlossaryPanel.tsx § `AskATerm`). */}
        <input
          className="gloss-ask-input"
          type="text"
          /* Enter submits this form and goes to Chat. */
          enterKeyHint="go"
          value={lens}
          maxLength={MAX_LENS_CHARS}
          placeholder={`${RECEPTION_LENS_LABEL}…`}
          aria-label={RECEPTION_LENS_LABEL}
          onChange={(e) => setLens(e.target.value)}
          onKeyDown={(e) => {
            /* Accepting an IME candidate is not a request to open Chat.
               Cancel implicit submission, including engines that report 229
               instead of isComposing; an ordinary Enter still uses the form. */
            if (e.key === "Enter" && isImeComposing(e)) e.preventDefault();
          }}
        />
        <button type="submit" className="gloss-btn rcp-lens-send" disabled={words === ""} title={RECEPTION_LENS_TIP}>
          <MessagesSquare size={12} aria-hidden="true" />
          {RECEPTION_LENS_SEND}
        </button>
      </form>
      {angles.length > 0 && (
        <div className="rcp-angles">
          <h3 className="rcp-group-head rcp-angles-head">{RECEPTION_ANGLES_HEAD}</h3>
          <ul className="rcp-angles-list">
            {shown.map((chat) => (
              <li key={chat.id}>
                <button
                  type="button"
                  className="rcp-angle"
                  aria-label={`${RECEPTION_OPEN_ANGLE_CHAT}: ${chat.origin.lens}`}
                  title={angleChatTip(chat.turns)}
                  onClick={() => chats.onOpen(chat.id)}
                >
                  <MessagesSquare size={12} aria-hidden="true" />
                  {/* What the reader typed, so in the reader's face
                      (docs/project/fonts.md). The quotation marks are ours. */}
                  <span className="rcp-angle-quoted">
                    “<span className="rcp-angle-words voice-reader">{chat.origin.lens}</span>”
                  </span>
                  <span className="rcp-angle-count">{chat.turns}</span>
                </button>
              </li>
            ))}
          </ul>
          {!all && angles.length > RECEPTION_ANGLES_SHOWN && (
            <button type="button" className="rcp-more rcp-angles-more" onClick={() => setAll(true)}>
              Show all {angles.length}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A line's tooltip: what a press does, and what the number is. */
function angleChatTip(turns: number): string {
  return `${RECEPTION_OPEN_ANGLE_CHAT}. ${turns} ${turns === 1 ? "question" : "questions"} so far.`;
}

/** How many citing papers are on screen before *Show all*. */
const CITERS_SHOWN = 10;

/**
 * **Cited by** — the papers that cite the piece, as OpenAlex lists them, most
 * cited first. The owner's, at the end of Reception.
 *
 * ```
 *  CITED BY
 *  39 papers cite this piece, by OpenAlex's count on 4 Oct 2026. Most cited first.
 *  We have not read what any of them says about it.
 *   The Multiscale Wisdom of the Body: … ↗
 *   Michael G. Levin · BioEssays · 2024 · review · cited 34 times
 *   …ten of them, then [ Show all 39 ]
 *  Also: search Google Scholar ↗
 * ```
 *
 * **A list, and no reading of it.** Nothing here says what a citing paper
 * thinks of the piece, and the sentence under the count says so: OpenAlex has
 * no citing sentence, and no model was asked. No sort and no filter.
 *
 * **A title is the citing authors' words and a stranger's string**: drawn as
 * text in the app's face, as the rows above draw a page's title
 * (docs/project/fonts.md leaves third-party text there), and its link is built
 * by `citerUrl` from the DOI or the OpenAlex id, never taken from the answer.
 *
 * **Every outcome has a sentence**, so a missing list is never a blank, and
 * the Scholar link stays under all of them: it is the way on when we have
 * nothing, and a second opinion when we have something.
 */
function CitedBy({ citers, scholar }: { citers: UseCiters; scholar: string | null }) {
  const headId = useId();
  return (
    <section className="rcp-group rcp-citers" aria-labelledby={headId}>
      <h3 id={headId} className="rcp-group-head">
        {CITERS_HEADING}
      </h3>
      {citers.result === null ? (
        <p className="rcp-citers-note" role="status">
          <LoaderCircle size={13} className="cmt-spinner" aria-hidden="true" /> {CITERS_LOADING}
        </p>
      ) : (
        <CitersAnswer result={citers.result} onRetry={citers.retry} />
      )}
      {scholar !== null && (
        <a className="rcp-scholar" href={scholar} target="_blank" rel="noreferrer noopener">
          Also: search Google Scholar
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      )}
    </section>
  );
}

/** One outcome of the lookup, as its sentence or its list. The `never` makes a new outcome a type error here. */
function CitersAnswer({ result, onRetry }: { result: CitersResult; onRetry(): void }) {
  switch (result.kind) {
    case "no-doi":
      return <p className="rcp-citers-note">{CITERS_NO_DOI}</p>;
    case "not-indexed":
      return <p className="rcp-citers-note">{CITERS_NOT_INDEXED}</p>;
    case "unconfirmed":
      return <p className="rcp-citers-note">{CITERS_UNCONFIRMED}</p>;
    case "too-large":
      return <p className="rcp-citers-note">{CITERS_TOO_LARGE}</p>;
    case "unavailable":
      return (
        <div className="rcp-citers-retry">
          <p className="rcp-citers-note">{CITERS_UNAVAILABLE}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      );
    case "found":
      return <CitersList found={result} />;
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

function CitersList({ found }: { found: Extract<CitersResult, { kind: "found" }> }) {
  const [all, setAll] = useState(false);
  const listed = found.citers.length;
  const shown = all ? found.citers : found.citers.slice(0, CITERS_SHOWN);
  return (
    <>
      <p className="rcp-citers-note">
        {citersLines({ ...found, listed }, dayOf(found.fetchedAt)).join(" ")}
      </p>
      {listed > 0 && (
        <ul className="rcp-citers-list">
          {shown.map((citer) => (
            <CiterRow key={citer.openalexId} citer={citer} />
          ))}
        </ul>
      )}
      {!all && listed > CITERS_SHOWN && (
        <button type="button" className="rcp-more rcp-citers-all" onClick={() => setAll(true)}>
          Show all {listed}
        </button>
      )}
    </>
  );
}

function CiterRow({ citer }: { citer: Citer }) {
  const url = citerUrl(citer);
  /* `article` is what nearly every row is, so only the other kinds are said. */
  const kind = citer.kind !== undefined && citer.kind !== "article" ? citer.kind : null;
  const facts = [
    citer.authors.length > 0 ? bylineAuthors(citer.authors) : null,
    citer.venue ?? null,
    citer.year ?? null,
    kind,
    citedTimes(citer.citedByCount),
  ].filter((fact) => fact !== null);
  return (
    <li className="rcp-citer">
      {url !== null ? (
        <a className="rcp-citer-title" href={url} target="_blank" rel="noreferrer noopener">
          {citer.title}
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      ) : (
        <span className="rcp-citer-title">{citer.title}</span>
      )}
      <p className="rcp-meta">{facts.join(" · ")}</p>
    </li>
  );
}

/**
 * **Claims' categorical threshold** — the relevance bar (`?bears=`), over
 * Claims' rows. Until 2026-10-03 this drew a second one too, the
 * identification bar over the rows about the piece; reception-levels.ts says why
 * that became two headed groups instead.
 *
 * Everything here is Quotes' `BarSlider` and the glossary's `GateSlider` with
 * the *stops* changed, and three of their four properties are kept for the
 * same reasons: the setting is on screen in words, the count is on screen
 * (`2 of 3`, the thing the reader is actually aiming at), and every stop is a
 * different rule. **The fourth changed on 2026-10-03**: this one says how many
 * it is holding back only when it is holding something back
 * ([`hiddenNote`](threshold.ts)). *"Nothing is hidden by this threshold."* was
 * one of four standing notes over one list (plan 261003o, step 8).
 *
 * Two things differ from its three siblings, and both follow from the fact
 * underneath being **named rather than measured**:
 *
 *  - **The track is an index into three fixed words**, not into scores this list
 *    contains. So a stop can be inert on a given article — nothing here bears
 *    only loosely, say, and the first two stops then show the same list — where
 *    `barStops` guarantees each adjacent pair differs. That is the right trade:
 *    a word in a link means the same thing on every article.
 *  - **The URL carries the word**, so there is nothing to snap and no
 *    `snapToStop` here. `?bar=0.63` against a track of real scores was a bug
 *    that needed a whole function; `?bears=partly` is a stop or it is nothing.
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
  /** A class beside `.gloss-gate`, naming which bar this is. */
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
    <div className={`gloss-gate ${kind}`}>
      <div className="gloss-gate-row">
        <label className="gloss-gate-label" htmlFor={id}>
          {label}
        </label>
        <span className="gloss-gate-value in-words">
          {words[level]} · {count}
        </span>
        {/* Only once there is something to undo, exactly as next door: a reset
            that is always there invites you into a state you are already in. */}
        {moved && (
          <button
            type="button"
            className="gloss-gate-reset"
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
        className="gloss-gate-range"
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
      {/* **Only when it is hiding something** — and then always, because a bar
          that has hidden every row looks exactly like a search that found
          none, and this sentence is what tells the two apart. */}
      {barred.hiddenCount > 0 && <p className="gloss-gate-note">{note}</p>}
    </div>
  );
}

/**
 * **How directly a claim row has to bear on its claim to stay on the list** —
 * the *thresholding* Greg asked for on 2026-09-29, over Claims' rows. The
 * words are the AI's judgment (`bears`), and the default hides nothing
 * (`RELEVANCE_DEFAULT`, 260929h's F5). A row the AI did not judge is never
 * hidden: it is always on the list, last under its claim, and is left out of
 * the bar's N of M so it does not look as though it cleared a judgment it lacks.
 */
function RelevanceBar({
  barred,
  level,
  moved,
  onLevel,
}: {
  barred: ThresholdResult<ClaimRow>;
  level: SourcesClaimsBears;
  moved: boolean;
  onLevel(level: SourcesClaimsBears | null): void;
}) {
  return (
    <StopBar
      id="rcp-rel-bar"
      kind="rcp-rel"
      label="relevance"
      barred={barred}
      level={level}
      stops={RELEVANCE_STOPS}
      words={BEARS_LABEL}
      defaultLevel={RELEVANCE_DEFAULT}
      noun={ANSWER}
      title="How directly the AI judged a page bears on the claim it answers: loosely, partly or directly. Left shows every answer, right only the ones it judged to bear directly. Rows the AI did not judge are never hidden."
      judgedOnly
      moved={moved}
      onLevel={onLevel}
    />
  );
}

/**
 * **Reception's order buttons** — Glossary's `SortBar`, with its classes:
 * `.rcp` is `.gloss` with a class beside it, so the look comes free and the two
 * bars cannot drift apart. `aria-pressed` on the order actually drawn, which is
 * `effectiveReceptionOrder`'s answer rather than the URL's.
 */
function OrderBar({
  options,
  order,
  onOrder,
}: {
  options: readonly ReceptionOrder[];
  order: ReceptionOrder;
  onOrder(order: ReceptionOrder): void;
}) {
  return (
    <div className="gloss-sort">
      <OrderGroup label="Order the sources by" selected={order}>
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
      </OrderGroup>
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
  /** The rows the bar left, before the thread — what each count is out of. */
  visible: readonly { id: string }[];
  /** The rows on screen after the thread. */
  shown: readonly { url: string }[];
  onThread(thread: string | null): void;
}) {
  return (
    <section className="rcp-threads" aria-label="Threads across these sources">
      <h3 className="rcp-threads-head">
        <span className="rcp-ai-tag" title="The AI's reading of the sources below — nothing in what the search returned checks it">
          AI
        </span>
        Threads across these sources
      </h3>
      {/* biome-ignore lint/a11y/useSemanticElements: toggle buttons that filter a
          list, not form controls — the order bar's reason. */}
      <div className="rcp-thread-list" role="group" aria-label="Show only the sources on">
        {threads.map((t) => {
          const count = shownInThread(t, visible);
          const on = selected?.id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={`rcp-thread${on ? " on" : ""}${t.kind === "key" ? " rcp-thread-key" : ""}`}
              aria-pressed={on}
              disabled={count === 0 && !on}
              title={
                count === 0
                  ? "The relevance bar is hiding every source on this"
                  : on
                    ? "Show every source again"
                    : "Show only these sources"
              }
              onClick={() => onThread(on ? null : t.id)}
            >
              <span className="rcp-thread-label">
                {t.kind === "key" && <Star size={12} aria-hidden="true" className="rcp-key-star" />}
                <span className="rcp-thread-name">{t.label}</span>
                <span className="rcp-thread-count">{count}</span>
              </span>
              {t.gist && <span className="rcp-thread-gist">{t.gist}</span>}
            </button>
          );
        })}
      </div>
      {/* In the head count's own words (`headCount`: excerpts, and pages when
          they differ), so the two cannot disagree. When the bars have hidden
          every row of the chosen thread, it says so in the open rather than in
          a tooltip a finger cannot reach (Sol's F7). */}
      {selected && (
        <p className="rcp-thread-showing">
          {shown.length === 0
            ? "The relevance bar is hiding every source on this thread"
            : `Showing ${headCount(shown)} ${selected.kind === "key" ? "picked as key" : `on “${selected.label}”`}`}
          {" · "}
          <button type="button" className="rcp-thread-all" onClick={() => onThread(null)}>
            show all
          </button>
        </p>
      )}
    </section>
  );
}

/** The rows of one list, each drawn by `Row`. */
function Rows({
  rows,
  keyRows,
}: {
  rows: readonly DrawnRow[];
  /** Each key source's reason, by row id — empty for an older debate. */
  keyRows: ReadonlyMap<string, ReceptionKeySource>;
}) {
  return (
    <ol className="rcp-list">
      {rows.map((row) => (
        <Row key={row.id} row={row} keySource={keyRows.get(row.id)} />
      ))}
    </ol>
  );
}

/**
 * **One of Reception's two groups, in the order drawn.** *As found* and
 * *stance* are flat. *Date* has at most one quiet line inside it, which says
 * what is **missing** rather than what a page thinks — *no year found* — and
 * its marker at the article's own year.
 */
function ReceptionGroups({
  groups,
  keyRows,
}: {
  groups: readonly ReceptionGroup<DirectRow>[];
  keyRows: ReadonlyMap<string, ReceptionKeySource>;
}) {
  return (
    <>
      {groups.map((group, i) => {
        /* Index keys are right here: the groups are rebuilt as a whole on every
           change, and two `flat` groups can sit either side of a marker. */
        const key = `${group.kind}-${i}`;
        switch (group.kind) {
          case "flat":
            return (
              <div key={key}>
                <Rows rows={group.rows} keyRows={keyRows} />
              </div>
            );
          case "undated":
            return (
              <section key={key} className="rcp-group">
                <p className="rcp-gap">{RECEPTION_UNDATED}</p>
                <Rows rows={group.rows} keyRows={keyRows} />
              </section>
            );
          case "marker":
            /* *"This piece, 2022"* and nothing more: the rows under it are that
               year or later, and a same-year row is not *after* it — a year
               cannot order two things inside itself (260929h's F1). */
            return (
              <p key={key} className="rcp-marker">
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
 * **Reception's list: the pages that link or quote this piece, then the ones
 * that only name it, under a heading that says so.**
 *
 * The first group has no heading: it is what the sub-mode is. **The second
 * always has one**, including when it is the only group — a page that names
 * the title may be about a different document that shares it (the decoy in
 * reception-levels.ts), and as the first row of a plain list it would read as
 * reception. Under its heading it is on screen and flagged; so is the citing
 * paper and the published reply, which look exactly the same to us.
 */
function ReceptionList({
  confirmed,
  titleOnly,
  keyRows,
}: {
  confirmed: readonly ReceptionGroup<DirectRow>[];
  titleOnly: readonly ReceptionGroup<DirectRow>[];
  keyRows: ReadonlyMap<string, ReceptionKeySource>;
}) {
  return (
    <>
      <ReceptionGroups groups={confirmed} keyRows={keyRows} />
      {titleOnly.length > 0 && (
        <section className="rcp-group rcp-title-only">
          <h3 className="rcp-group-head">{RECEPTION_TITLE_ONLY}</h3>
          <ReceptionGroups groups={titleOnly} keyRows={keyRows} />
        </section>
      )}
    </>
  );
}

/**
 * **Claims' list: one group per claim, in article order** — Greg's *"a thread
 * … for each claim, and then papers that have sort of evaluated the claim"*,
 * from data the search already stored.
 *
 * Each is a native `<details>`, **open**: every claim's sources are on screen
 * on arrival, and a reader checking one claim can fold the others away. Its
 * summary is the article's own words, located in the block the id names — a
 * heading we can stand behind, which a `relation` or a stance heading would
 * not be (file header § Two sub-modes) — then the way to that passage, and how
 * many rows are under it. **No for/against tally**: it would put the model's
 * reading of each page into a headline in our voice (GPT Sol's F9).
 *
 * The rows carry no *On "…"* line of their own, because the heading says it:
 * the repeated *Answering* blocks were half of what made the old list look
 * like duplicates.
 *
 * **The owner's heading also starts a chat about the claim, and shows the way
 * back to one** (`chats`; `null` for a visitor, who gets neither). The button
 * wears Chat's icon from the bar, because it takes the reader into Chat
 * (docs/project/icons.md). The mark is the shared `OriginChatMark`
 * (OriginChat.tsx); it sits on a line of its own under the claim, so the
 * latest answer's opening has room.
 */
function ClaimsList({
  groups,
  onJump,
  keyRows,
  chats,
  citedIn,
}: {
  groups: readonly ClaimGroup<ClaimRow>[];
  onJump(id: BlockId): void;
  keyRows: ReadonlyMap<string, ReceptionKeySource>;
  chats: ReceptionAndClaimsChats | null;
  citedIn: CitedInParagraph | null;
}) {
  return (
    <>
      {groups.map((group) => {
        /* The claim's identity is `(blockId, claimQuote)` — reception-order.ts —
           and that pair is the whole of what its chat remembers. */
        const origin: ClaimOrigin = { mode: "sources-claims", blockId: group.blockId, quote: group.claimQuote };
        const chat = chats ? threadForOrigin(chats.summaries, origin) : undefined;
        return (
          <details
            key={`${group.blockId} ${group.claimQuote}`}
            className="rcp-group rcp-claim-group"
            data-claim-key={claimFocusKey(origin)}
            open
          >
            <summary className="rcp-group-head rcp-group-claim">
              <span className="rcp-group-quote">“{group.claimQuote}”</span>
              <BlockRef id={group.blockId} onJump={onJump} />
              {chats && (
                <Tooltip placement="top" content={<TipNote>{SOURCES_CLAIM_CHECK_CLAIM}</TipNote>}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="rcp-claim-check tw:pointer-coarse:size-10"
                    aria-label={SOURCES_CLAIM_CHECK_CLAIM}
                    /* A button in a `<summary>`: the press is ours, and must
                       not also fold the claim. */
                    onClick={(e) => {
                      e.preventDefault();
                      chats.onCheck(origin);
                    }}
                  >
                    <MessagesSquare size={12} aria-hidden="true" />
                  </Button>
                </Tooltip>
              )}
              <span
                className="rcp-group-count"
                title={`${group.rows.length} ${group.rows.length === 1 ? "source" : "sources"} on this claim`}
              >
                {group.rows.length}
              </span>
              {/* The shared mark (OriginChat.tsx), which Glossary's entries and
                  Bibliography's rows draw too. Its press does not fold the claim. */}
              {chats && chat && (
                <OriginChatMark
                  chat={chat}
                  label={SOURCES_CLAIMS_OPEN_CLAIM_CHAT}
                  className="rcp-claim-chat"
                  onOpen={chats.onOpen}
                />
              )}
            </summary>
            <CitedHere blockId={group.blockId} citedIn={citedIn} />
            <Rows rows={group.rows} keyRows={keyRows} />
          </details>
        );
      })}
    </>
  );
}

/**
 * **The owner's Claims list, in each of its states** — plan 261008i § 2, § 3
 * and § 5. The list's states are the read's and the job's, as every artefact
 * panel's are (FaqPanel.tsx is the sibling):
 *
 *  - **loading** — the GET is in flight;
 *  - **error** — the GET failed; `ReadError`'s *Try again* sends only a GET;
 *  - **none** — nobody has pressed Claims here: *List its claims*, the same
 *    unforced request a press makes (useSourcesClaims.ts § `ensure`); while it
 *    runs, `JobProgress` draws the progress, and a failed run its sentence and
 *    *Retry*;
 *  - **done** — the list; **done-empty** — a sentence;
 *  - **stale** — the list, **read-only** (no chat button, no tick boxes, no
 *    box, no Check, no Dig further), under a banner with *List again*.
 *
 * ## Checking, on a current list (§ 3)
 *
 * ```
 *  ☐ "memories … survive metamorphosis"   [jump] [chat]
 *     Memories can outlast the brain … · In the AI's words
 *  ☑ "RNA from trained animals …"         [jump] [chat] [Dig further]
 *     row, row, row
 *  [ Check a claim of your own…                       ]
 *  [ Check 1 claim ]
 *  Your claim: "RNA can carry a memory between animals"   [Dig further]
 *     row, row
 * ```
 *
 * A tick box per claim, the box, and **Check**, which is off with nothing
 * picked, with more than `MAX_CHECK_TARGETS`, with a typed claim over the
 * limit, and while a check is out — this tab's, from the press until its
 * answer has been read (`UseSourcesClaimChecks.sending`), or another tab's
 * (`anyPending`). Each claim's rows are every finished check's for it, an
 * address once (sources-claim-checks.ts). *Dig further* is one search for one claim
 * that a finished check has looked at. The two sentences for a claim with
 * nothing to read are different on purpose: *found nothing* is what the
 * search said; *did not answer* is the model leaving the claim out.
 */
function OwnerListedClaims({
  list,
  checks,
  onJump,
  chats,
  citedIn,
}: {
  list: UseSourcesClaims;
  /** The owner's checks; `null` only where the type cannot see the owner. */
  checks: UseSourcesClaimChecks | null;
  onJump(id: BlockId): void;
  chats: ReceptionAndClaimsChats | null;
  citedIn: CitedInParagraph | null;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [own, setOwn] = useState("");
  const waiting = list.rewriting && !list.job && !list.starting && !list.failed;
  const run = (label: string, again = false) =>
    again && waiting && !list.error ? (
      <RewriteWaiting line="The new list hasn't loaded yet." onRead={list.refresh} className="tw:m-0" />
    ) : (
      <JobProgress
        job={list.job}
        starting={list.starting}
        failed={list.failed}
        stalled={list.stalled}
        onRun={() => (again ? list.regenerate() : list.ensure())}
        runDisabled={again && list.rewriting}
        onCancel={list.cancel}
        label={label}
        step="sources-claims"
        icon={<MessagesSquare size={13} />}
        runningLabel="Listing…"
      />
    );
  const claims = list.status === "ready" ? (list.claimList?.claims ?? []) : null;
  /* The stale banner's × (plan 261010a): this list, by its clock. Checking
     stays off on a stale list either way — the server refuses it — so the ×
     hides a sentence, not a control. */
  const staleNotice = useStaleNotice({
    slug: list.slug,
    mode: "sources-claims",
    identities: list.stale ? (list.claimList?.generatedAt ?? null) : null,
  });
  /* A job started elsewhere — Metadata, another tab — while no banner carries
     it: a current list, or a stale one whose banner was sent away (plan
     261010a, GPT Sol's finding 4). */
  const showJob =
    claims !== null &&
    staleNotice.showing.length === 0 &&
    (list.job || list.starting || list.failed || (waiting && !list.error));

  /* Where each check is drawn — from its stored targets, so a list made
     again, or a changed article, hides nothing that was paid for (E5). */
  const drawn = useMemo(() => drawChecks(checks === null ? [] : checks.checks, list.claimList), [checks, list.claimList]);
  /* Until the checks have been read, nobody knows whether one is out, so
     Check waits: the server would refuse a second one anyway, but only after
     the reader had pressed. */
  const searching = checks !== null && (checks.sending || anyPending(checks.checks));
  /* A history read holds the controls too, but it is free and must not wear the
     spinner or sentence that say a paid web search is running. */
  const busy = checks !== null && (searching || checks.status !== "ready");
  const picking = checks !== null && claims !== null && !list.stale;
  /* Only ticks on claims still in the list count: a list made again has new ids. */
  const ids = claims === null ? [] : claims.filter((c) => ticked.has(c.id)).map((c) => c.id);
  const words = own.trim();
  const picked = ids.length + (words === "" ? 0 : 1);
  const canCheck = picking && !busy && picked > 0 && picked <= MAX_CHECK_TARGETS && words.length <= MAX_OWN_CLAIM_CHARS;

  const press = async () => {
    if (checks === null || !canCheck) return;
    const stored = await checks.check({ claimIds: ids, ...(words === "" ? {} : { own: words }) });
    /* What was picked has become a check; on a refusal it stays, to press again. */
    if (stored) {
      setTicked(new Set());
      setOwn("");
    }
  };
  const dig = (claimId: string) => {
    if (checks === null || busy) return;
    void checks.check({ digFurther: claimId });
  };
  const findings = (claimId: string) => drawn.listed.get(claimId) ?? null;
  const onDig = picking && !busy ? dig : null;

  return (
    <div className="rcp-listed-wrap">
      {list.error && <ReadError error={list.error} onRetry={list.retryRead} />}
      {list.status === "loading" && <BandWaiting className="gloss-quiet">{SOURCES_CLAIMS_LIST_LOADING}</BandWaiting>}
      {list.status === "none" && (
        <div className="gloss-empty">
          <p className="gloss-hint">{SOURCES_CLAIMS_LIST_NONE}</p>
          {run(SOURCES_CLAIMS_LIST_RUN)}
        </div>
      )}
      {claims !== null && (
        <>
          <StaleNotice notice={staleNotice} action={run(SOURCES_CLAIMS_LIST_AGAIN, true)}>
            {SOURCES_CLAIMS_LIST_STALE}
          </StaleNotice>
          {claims.length === 0 ? (
            <p className="gloss-quiet rcp-listed-none">{SOURCES_CLAIMS_LIST_EMPTY}</p>
          ) : (
            <ListedClaims
              claims={claims}
              onJump={onJump}
              chats={list.stale ? null : chats}
              pick={
                picking
                  ? {
                      ticked,
                      disabled: busy,
                      onTick: (id, on) =>
                        setTicked((was) => {
                          const next = new Set(was);
                          if (on) next.add(id);
                          else next.delete(id);
                          return next;
                        }),
                    }
                  : null
              }
              findings={findings}
              onDig={onDig}
              citedIn={citedIn}
            />
          )}
          {/* Checked claims the list no longer names: their own groups, from
              what each check stored, still dug into. */}
          {drawn.unlisted.map((group) => (
            <CheckedClaim key={group.key} group={group} onJump={onJump} onDig={onDig} />
          ))}
          {picking && (
            <form
              className="gloss-ask rcp-check"
              onSubmit={(e) => {
                e.preventDefault();
                void press();
              }}
            >
              <div className="gloss-ask-row rcp-check-row">
                {/* `maxLength` is the route's cap, counted before trimming —
                    the harmless direction (`Angles` above). */}
                <input
                  className="gloss-ask-input"
                  type="text"
                  enterKeyHint="go"
                  value={own}
                  maxLength={MAX_OWN_CLAIM_CHARS}
                  placeholder={`${SOURCES_CLAIM_CHECK_OWN_LABEL}…`}
                  aria-label={SOURCES_CLAIM_CHECK_OWN_LABEL}
                  disabled={busy}
                  onChange={(e) => setOwn(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && isImeComposing(e)) e.preventDefault();
                  }}
                />
                <button type="submit" className="gloss-btn rcp-check-send" disabled={!canCheck} title={SOURCES_CLAIM_CHECK_TIP}>
                  {searching ? <LoaderCircle size={12} className="spin" aria-hidden="true" /> : <Globe size={12} aria-hidden="true" />}
                  {checkLabel(picked)}
                </button>
              </div>
              {searching && <p className="gloss-quiet rcp-check-pending">{SOURCES_CLAIM_CHECK_PENDING}</p>}
              {checks?.pressError && <p className="rcp-check-error">{checks.pressError}</p>}
              {/* The checks' own read failed. Quieter than the list's
                  `ReadError`: the list above is still right, only what was
                  checked is missing. */}
              {checks?.status === "error" && checks.error && (
                <p className="gloss-quiet rcp-check-error">
                  {checks.error}{" "}
                  <button type="button" className="gloss-btn" onClick={() => void checks.refresh()}>
                    Try again
                  </button>
                </p>
              )}
            </form>
          )}
          {drawn.own.map((group) => (
            <CheckedClaim key={group.key} group={group} onJump={onJump} onDig={onDig} />
          ))}
          {/* Checks against an earlier version of the article: kept, because
              they were paid for, but read-only — their anchors were that
              version's, so no Dig further and no box. */}
          {drawn.earlier.length > 0 && (
            <section className="rcp-check-earlier">
              <p className="gloss-quiet rcp-check-earlier-head">{SOURCES_CLAIM_CHECK_EARLIER}</p>
              {drawn.earlier.map((group) => (
                <CheckedClaim key={group.key} group={group} onJump={onJump} />
              ))}
            </section>
          )}
          {showJob && <div className="rcp-again">{run(SOURCES_CLAIMS_LIST_AGAIN, true)}</div>}
        </>
      )}
    </div>
  );
}

/** Check's label: how many claims one press would search. */
export function checkLabel(picked: number): string {
  if (picked === 0) return "Check";
  return `Check ${picked} ${picked === 1 ? "claim" : "claims"}`;
}

/** The tick boxes' state, handed down by the owner's list on a current one. */
interface ClaimPick {
  ticked: ReadonlySet<string>;
  /** A check is out: the boxes hold still until it lands. */
  disabled: boolean;
  onTick(id: string, on: boolean): void;
}

/** Nothing here is a key source: the synthesis is Reception's, not the checks'. */
const NO_KEY_SOURCES: ReadonlyMap<string, ReceptionKeySource> = new Map();

/** *Dig further* on a claim a finished check has looked at, or nothing. */
function DigFurther({
  claimId,
  findings,
  onDig,
}: {
  claimId: string;
  findings: ClaimFindings | null;
  /** `null` on a stale list, while a check is out, and for a visitor. */
  onDig: ((claimId: string) => void) | null;
}) {
  if (findings === null || !findings.canDig) return null;
  return (
    <button
      type="button"
      className="gloss-btn rcp-dig"
      disabled={onDig === null}
      title={SOURCES_CLAIM_CHECK_DIG_FURTHER_TIP}
      onClick={() => onDig?.(claimId)}
    >
      Dig further
    </button>
  );
}

/**
 * **One checked claim drawn as its own group** — a typed claim as *Your
 * claim*, or a listed claim the current list no longer names, headed by the
 * quote and statement its check stored, with the jump to its block. Without
 * `onDig` it is read-only: the earlier-version group.
 */
function CheckedClaim({
  group,
  onJump,
  onDig,
}: {
  group: CheckGroup;
  onJump(id: BlockId): void;
  /** `undefined` for a read-only group; `null` while Dig further is held. */
  onDig?: ((claimId: string) => void) | null;
}) {
  const { head } = group;
  return (
    <section
      className={`rcp-group ${head.kind === "own" ? "rcp-own-claim" : "rcp-checked-claim"}`}
      data-claim={group.claimId}
    >
      <p className="rcp-group-claim rcp-listed-head">
        {head.kind === "own" ? (
          <>
            <span className="rcp-own-label">{SOURCES_CLAIM_CHECK_YOUR_CLAIM}: </span>
            {/* The reader's words in the reader's face (docs/project/fonts.md). */}
            <span className="rcp-group-quote">
              “<span className="voice-reader">{head.text}</span>”
            </span>
          </>
        ) : (
          <>
            <span className="rcp-group-quote">“<Excerpt blockId={head.blockId} words={head.quote} />”</span>
            <BlockRef id={head.blockId} onJump={onJump} />
          </>
        )}
        {onDig !== undefined && <DigFurther claimId={group.claimId} findings={group.findings} onDig={onDig} />}
      </p>
      {head.kind === "listed" && (
        <p className="rcp-listed-statement">
          <span className="voice-ai">{head.statement}</span>
          <span className="rcp-listed-ai"> · {SOURCES_CLAIMS_LIST_AI}</span>
        </p>
      )}
      <CheckFindings findings={group.findings} />
    </section>
  );
}

/** What the checks found under one claim, and the sentence when there is nothing to read. */
function CheckFindings({ findings }: { findings: ClaimFindings | null }) {
  if (findings === null) return null;
  return (
    <div className="rcp-check-found">
      {findings.rows.length > 0 && <Rows rows={findings.rows} keyRows={NO_KEY_SOURCES} />}
      {findings.line === "found-nothing" && <p className="gloss-quiet rcp-check-line">{SOURCES_CLAIM_CHECK_FOUND_NOTHING}</p>}
      {findings.line === "not-answered" && <p className="gloss-quiet rcp-check-line">{SOURCES_CLAIM_CHECK_NOT_ANSWERED}</p>}
      {findings.pending && (
        <BandWaiting className="gloss-quiet rcp-check-line">{SOURCES_CLAIM_CHECK_PENDING}</BandWaiting>
      )}
      {findings.error !== null && <p className="rcp-check-error">{findings.error}</p>}
    </div>
  );
}

/**
 * **The listed claims, owner's or visitor's**: the article's quote with a jump
 * to its block, as an older search's claim headings have (`ClaimsList`), and
 * under it the model's one line, labelled as the AI's words — the quote is
 * the article's, checked against its block; the statement is not.
 *
 * `chats` is the owner's on a current list, and `null` for a visitor and on a
 * stale list: *Check this claim in chat* takes the claim's block and quote,
 * which a listed claim has (`ClaimOrigin`), so the same chat and the same mark
 * serve both kinds of claim.
 *
 * `pick`, `findings` and `onDig` are the owner's checks (`OwnerListedClaims`):
 * a tick box in the first column, the claim's checked rows under it, and Dig
 * further. A visitor passes none, so a visitor's list has no box and no rows
 * from any check.
 */
function ListedClaims({
  claims,
  onJump,
  chats,
  pick = null,
  findings = () => null,
  onDig = null,
  citedIn = null,
}: {
  claims: readonly ListedClaim[];
  onJump(id: BlockId): void;
  chats: ReceptionAndClaimsChats | null;
  pick?: ClaimPick | null;
  findings?: (claimId: string) => ClaimFindings | null;
  onDig?: ((claimId: string) => void) | null;
  citedIn?: CitedInParagraph | null;
}) {
  return (
    <ol className="rcp-listed">
      {claims.map((claim) => {
        const origin: ClaimOrigin = { mode: "sources-claims", blockId: claim.blockId, quote: claim.quote };
        const chat = chats ? threadForOrigin(chats.summaries, origin) : undefined;
        const found = findings(claim.id);
        return (
          <li key={claim.id} className="rcp-listed-claim" data-claim={claim.id} data-claim-key={claimFocusKey(origin)}>
            {/* The first column: the owner's tick box on a current list. */}
            {pick !== null ? (
              <span className="rcp-listed-pick">
                <input
                  type="checkbox"
                  className="rcp-listed-tick"
                  aria-label={`Check this claim: ${claim.statement}`}
                  checked={pick.ticked.has(claim.id)}
                  disabled={pick.disabled}
                  onChange={(e) => pick.onTick(claim.id, e.target.checked)}
                />
              </span>
            ) : (
              <span className="rcp-listed-pick" aria-hidden="true" />
            )}
            <div className="rcp-listed-body">
              <p className="rcp-group-claim rcp-listed-head">
                <span className="rcp-group-quote">“<Excerpt blockId={claim.blockId} words={claim.quote} />”</span>
                <BlockRef id={claim.blockId} onJump={onJump} />
                {chats && (
                  <Tooltip placement="top" content={<TipNote>{SOURCES_CLAIM_CHECK_CLAIM}</TipNote>}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="rcp-claim-check tw:pointer-coarse:size-10"
                      aria-label={SOURCES_CLAIM_CHECK_CLAIM}
                      onClick={() => chats.onCheck(origin)}
                    >
                      <MessagesSquare size={12} aria-hidden="true" />
                    </Button>
                  </Tooltip>
                )}
                {chats && chat && (
                  <OriginChatMark
                    chat={chat}
                    label={SOURCES_CLAIMS_OPEN_CLAIM_CHAT}
                    className="rcp-claim-chat"
                    onOpen={chats.onOpen}
                  />
                )}
                <DigFurther claimId={claim.id} findings={found} onDig={onDig} />
              </p>
              {/* The model's words in the model's face (fonts.md, voices.css §
                  `.voice-ai`), and the label in ours. */}
              <p className="rcp-listed-statement">
                <span className="voice-ai">{claim.statement}</span>
                <span className="rcp-listed-ai"> · {SOURCES_CLAIMS_LIST_AI}</span>
              </p>
              <CitedHere blockId={claim.blockId} citedIn={citedIn} />
              <CheckFindings findings={found} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The heading of C1's line. It says the works share a paragraph, and nothing about support. */
export const CITED_IN_PARAGRAPH = "Cited in this paragraph";

/**
 * **Cited in this paragraph** — the works the article cites in a claim's
 * paragraph, under the claim (plan 261009l § C1; the join and its limits are
 * src/web/cited-in-paragraph.ts). Each name opens the work's Bibliography row,
 * where its link and any reading are. Nothing is drawn when the paragraph
 * cites nothing, or when there is no Bibliography: a heading over nothing
 * would read as a finding.
 */
function CitedHere({ blockId, citedIn }: { blockId: BlockId; citedIn: CitedInParagraph | null }) {
  if (citedIn === null) return null;
  const works = worksCitedIn(blockId, citedIn.works);
  if (works.length === 0) return null;
  return (
    <p className="rcp-cited-here">
      <span className="rcp-cited-here-head">{CITED_IN_PARAGRAPH}: </span>
      {works.map((work, i) => (
        <span key={work.id}>
          {i > 0 && <span className="rcp-cited-here-sep" aria-hidden="true"> · </span>}
          <Tooltip placement="top" content={<TipNote>{`${work.title}. Open it in Bibliography.`}</TipNote>}>
            <button type="button" className="rcp-cited-work" onClick={() => citedIn.onOpen(work.id)}>
              {workShortName(work)}
            </button>
          </Tooltip>
        </span>
      ))}
    </p>
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
      className="rcp-mark-card"
      content={
        <>
          <span className="rcp-mark-card-head">How this page identifies the article</span>
          <ul className="rcp-mark-card-list">
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
      <button type="button" className={`rcp-mark rcp-mark-${level}`}>
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
 * Authors and year are the AI's reading (the plan's F2) — the words are on the
 * page, which does not prove they are *this* page's byline — **unless the row
 * carries a registry record** (plan 261001a stage 6): the address carried a
 * DOI or arXiv id, and the registry's title for it agrees with the engine's.
 * Then the record's authors and year win, and `registry` names where they came
 * from; a cut-short engine title gives way to the record's whole one too.
 */
export function rowWork(row: DrawnRow): {
  headline: string;
  titleIsAI: boolean;
  headlineIsAddress: boolean;
  authors: string[];
  year: number | null;
  /** Set when the authors and year (and maybe the headline) are the registry's. */
  registry: RegistrySource | null;
  /** Exactly which displayed fields came from `registry`. */
  registryFields: ("full title" | "authors" | "year")[];
} {
  const engine = row.title?.trim() ? row.title : null;
  const record = readRowRegistry(row);
  const work = readWorkTitle(row);
  const cut = engine !== null && isCutShort(engine);
  const useRecord = record !== null && cut;
  const useWork = !useRecord && work !== null && (engine === null || cut);
  const headline = useRecord ? record.title : useWork ? work : (engine ?? addressOf(row.url));
  if (record !== null) {
    const registryFields: ("full title" | "authors" | "year")[] = [];
    if (useRecord) registryFields.push("full title");
    const extractedAuthors = readAuthors(row);
    const authors = record.authors.length > 0 ? record.authors.map(registryAuthorName) : extractedAuthors;
    if (record.authors.length > 0) registryFields.push("authors");
    const extractedYear = readPublishedYear(row);
    const year = record.year ?? extractedYear;
    if (record.year !== undefined) registryFields.push("year");
    return {
      headline,
      titleIsAI: false,
      headlineIsAddress: false,
      authors,
      year,
      registry: registryFields.length > 0 ? record.source : null,
      registryFields,
    };
  }
  return {
    headline,
    titleIsAI: useWork,
    headlineIsAddress: !useWork && engine === null,
    authors: readAuthors(row),
    year: readPublishedYear(row),
    registry: null,
    registryFields: [],
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
 * AI's reading of it, the quotation — and `more`. A claim row says nothing of
 * the claim it answers: it is always under that claim's heading (`ClaimsList`).
 */
function Row({
  row,
  keySource,
}: {
  row: DrawnRow;
  /** Set when the AI picked this row as a key source (plan 260930j). */
  keySource: ReceptionKeySource | undefined;
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
  const direct = directOf(row);
  const bears = readBears(row);
  const work = rowWork(row);
  const byline = [
    work.authors.length > 0 ? bylineAuthors(work.authors) : null,
    work.year === null ? null : String(work.year),
  ].filter((part): part is string => part !== null);
  const registryBylineFields = work.registryFields.filter(
    (field): field is "authors" | "year" => field === "authors" || field === "year",
  );
  const aiBylineFields = [
    work.authors.length > 0 && !work.registryFields.includes("authors") ? "authors" : null,
    work.year !== null && !work.registryFields.includes("year") ? "year" : null,
  ].filter((field): field is "authors" | "year" => field !== null);
  const aiBylineNote =
    aiBylineFields.length === 0
      ? null
      : registryBylineFields.length === 0
        ? "As the AI read it off the page — found in the page's extract, not checked as its byline"
        : receptionWorkFieldsNote(aiBylineFields);
  return (
    <li className={`rcp-item${open ? " open" : ""}${keySource ? " key" : ""}`}>
      {/* **A key source says so first, and why** — above the title, because it
          is the reason a reader would look at this row before the others.
          Labelled AI like the reading below it: nothing checks the pick.
          Plan 260930j. */}
      {keySource && (
        <p className="rcp-key-line">
          <span className="rcp-ai-tag" title="The AI's pick — nothing in what the search returned checks it">
            AI
          </span>
          <Star size={12} aria-hidden="true" className="rcp-key-star" />
          <span className="rcp-key-label">Key source · {KEY_ROLE_LABEL[keySource.role]}</span>
          <span className="rcp-key-why">{keySource.why}</span>
        </p>
      )}
      {/* **The work is the headline**, and it is the link out — a real `<a href>`
          so the browser's own affordances work (the status bar, a middle
          click). `noreferrer` as well as `noopener`: this is a stranger's page
          and the address of the article being read is not its business.
          Clamped to two lines by CSS alone, so the whole title is still in the
          accessibility tree; `more` unclamps it. */}
      {/* `rcp-title-ai` only when the headline is the model's reading of the
          page; a registry's or search engine's title, or the address, stays UI. */}
      <a
        className={work.titleIsAI ? "rcp-title rcp-title-ai" : "rcp-title"}
        href={row.url}
        target="_blank"
        rel="noreferrer noopener"
        title={row.url}
      >
        {work.headline}
        <ExternalLink size={11} aria-hidden="true" />
      </a>

      {/* The small line under the title: *authors · year · site*. The authors
          and year are the AI's reading of the page, so they are drawn quieter
          than the site and say so on hover — the site is the wire's, and it
          stays because it is the one authority signal a reader can judge. Left
          off when the headline is already the address. */}
      {(byline.length > 0 || !work.headlineIsAddress || direct) && (
        <p className="rcp-meta">
          {byline.length > 0 && (
            <span
              className="rcp-byline"
              title={[
                work.registry !== null && registryBylineFields.length > 0
                  ? receptionRegistryNote(work.registry, registryBylineFields)
                  : null,
                aiBylineNote,
              ].filter((note): note is string => note !== null).join(" ")}
            >
              {byline.join(" · ")}
              {work.registry !== null && registryBylineFields.length > 0 && (
                <span className="tw:sr-only"> — {receptionRegistryNote(work.registry, registryBylineFields)}</span>
              )}
            </span>
          )}
          {byline.length > 0 && !work.headlineIsAddress && (
            <span aria-hidden="true" className="rcp-dot">
              ·
            </span>
          )}
          {!work.headlineIsAddress && <span className="rcp-site">{hostOf(row.url)}</span>}
          {direct && <IdentificationChip row={direct} />}
        </p>
      )}

      {/* **The AI's reading, one line and labelled.** Up here because it is what
          a reader decides with; the paragraph behind it is in `more`, inside
          the fence. Separate words, not merged: *"qualifies · Could not tell"*
          is an honest pair of answers rather than a contradiction. `bears`
          leads when the AI gave one — it is what a claim's rows are ordered by. */}
      <p className="rcp-ai-line">
        <span className="rcp-ai-tag" title="The AI's reading of this page — nothing in what the search returned checks it">
          AI
        </span>
        {(bears !== null || direct === null) && (
          <>
            <span className="rcp-bears">{bears === null ? SOURCES_CLAIMS_UNJUDGED : BEARS_LABEL[bears]}</span>
            <span aria-hidden="true" className="rcp-dot">
              ·
            </span>
          </>
        )}
        <span className="rcp-relation">{row.relation}</span>
        <span aria-hidden="true" className="rcp-dot">
          ·
        </span>
        <span className={`rcp-lean rcp-lean-${look.tone}`}>
          <Icon size={12} aria-hidden="true" />
          {look.label}
        </span>
      </p>

      {/* Characters we located in that page's own extract. A `<blockquote>`
          because that is what it is, and rendered as text: this is a slice of a
          stranger's page and nothing here may ever become markup. Three lines
          until `more`. */}
      <blockquote className="rcp-quote">“{row.sourceQuote}”</blockquote>

      <button
        type="button"
        className="rcp-more"
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
 * witness that this page names *this* article; and the way out. The full
 * title and quotation are the row's own,
 * unclamped (`.rcp-item.open` in reception.css), rather than drawn a second time.
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
  row: DrawnRow;
  work: ReturnType<typeof rowWork>;
  hidden: boolean;
}) {
  const reference = referenceOf(row);
  /* Only the parts actually drawn as the AI's: an engine title that won is the
     wire's, and calling it the AI's reading would be false (F2). */
  const aiParts = [
    work.titleIsAI ? "title" : null,
    work.authors.length > 0 && !work.registryFields.includes("authors") ? "authors" : null,
    work.year !== null && !work.registryFields.includes("year") ? "year" : null,
  ].filter((part): part is string => part !== null);
  return (
    <div id={id} className="rcp-detail" hidden={hidden}>
      {work.authors.length > 0 && <p className="rcp-authors">By {work.authors.join(", ")}</p>}
      {aiParts.length > 0 && <p className="rcp-note rcp-work-note">{receptionWorkFieldsNote(aiParts)}</p>}
      {work.registry !== null && (
        <p className="rcp-note rcp-work-note">{receptionRegistryNote(work.registry, work.registryFields)}</p>
      )}
      {/* **The fence.** Everything outside it is either the wire's or the
          article's; everything inside it is a model's reading of a stranger's
          page, and nothing in the returned evidence verifies any of it. */}
      <div className="rcp-ai">
        <p className="rcp-ai-label">AI interpretation</p>
        <p className="rcp-applies">{row.applies}</p>
        {/* Optional, and that is a correction the plan records: requiring it on
            every row manufactures caveats, so the prompt is told to omit a row
            rather than invent a limitation. */}
        {row.limits && <p className="rcp-limits">{row.limits}</p>}
      </div>
      {/* The full address, which the row shows only the host of. */}
      <p className="rcp-url">{row.url}</p>
      {/* A direct row's whole claim is that this page is about this piece, and
          this is the witness for it: words from the source's own extract in
          which it names the article. A row without one cannot exist in that
          group.

          **This sentence became true on 2026-09-05** (Sol's F24). Until then the
          stage only checked that the words were somewhere in the extract, so a
          genuine quotation about something else was printed under "It names
          this article". `namesArticle` (src/reception.ts) is what makes the claim:
          the witness has to carry the article's address, its title, or a short
          title with the byline. */}
      {reference && <p className="rcp-ref">It names this article: “{reference}”</p>}
      {/* What the quotation was checked against was said here, on every row,
          until 2026-10-03; it is said once, in the band's (i) (plan 261003o,
          step 8). */}
      <a className="rcp-out" href={row.url} target="_blank" rel="noreferrer noopener">
        Read it on {hostOf(row.url)}
        <ExternalLink size={11} aria-hidden="true" />
      </a>
    </div>
  );
}

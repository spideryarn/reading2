/**
 * **Citations' *Investigate*, on the client** — the button, the answer as it
 * streams, the kept answer, and the sentence that says what was read.
 * docs/plans/260930a-citations-investigate-one-work-on-demand.md § UI; the
 * server is src/citation-investigate.ts and the hook half is
 * src/web/useCitations.ts § `investigate`.
 *
 * Its own file rather than more of CitationsPanel.tsx because it is one
 * self-contained thing on a row: the panel passes it the row and the hook's
 * state for that row, and draws nothing of it itself. Owner-only, and not on
 * the hover card (ProseHoverCard.tsx § CiteCard draws `readNoteOf` and stops).
 *
 * ## What was read is said by code, never by the model (5G's rule)
 *
 * `investigationProvenance` composes the plan's sentence from the stored
 * record's counts and hosts, which are code's account of what the call
 * returned (src/citation-investigate.ts § provenance). **There is no profile
 * clause.** The plan's sentence has *[and your profile and purpose]*, and the
 * stored record does not say whether a profile went into the call — only that
 * the context hash covered it — so the sentence says *used this article* and
 * no more, rather than guess.
 */
import { ChevronDown, ChevronUp, ExternalLink, Microscope } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CitationInvestigation, CitationLookup, InvestigateStage } from "../types.js";
import { hostOf, isWebUrl } from "../urls.js";
import { ControlTip, Tooltip } from "./Tooltip.js";
import { useTapReveal } from "./useTapReveal.js";

/* ------------------------------------------------------------- the copy -- */

/** Over a kept answer, collapsed or not: whose words these are, and from what. */
export const INVESTIGATION_LABEL = "the AI's reading of web search extracts";

/** While the press's first step looks for the work's own page (plan 260930d). */
export const INVESTIGATE_FINDING = "Finding the work…";

/** Under the button until the first words land. The words are the progress after that. */
export const INVESTIGATE_WAIT =
  "It searches the web and then writes, which can take up to a minute. If it finishes, the answer is kept on this row even if you leave.";

/** Sol Q-4: a failed *Investigate again* replaced nothing, and says so. */
export const INVESTIGATE_PREVIOUS_KEPT = "The new investigation was not kept; the previous one is still shown.";

/** Plan 260930d P-4: the first step found and kept a page, and the reading after it failed. */
export const INVESTIGATE_LOOKUP_KEPT = "The longer investigation failed; the quick check was kept.";

/* ------------------------------------------------ what was read, in words -- */

export type InvestigationProvenanceInput = Pick<
  CitationInvestigation,
  "sources" | "extractsRead" | "longestExtractWords" | "matchedHost"
>;

/** The distinct hosts of the sources that are web addresses, in the order they came. */
function sourceHosts(sources: readonly { url: string }[]): string[] {
  const hosts: string[] = [];
  for (const s of sources) {
    if (!isWebUrl(s.url)) continue;
    const host = hostOf(s.url);
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/**
 * **The plan's *what was read* sentence, from the stored fields only** —
 * § What was read and § Which result is the work, word for word apart from the
 * number agreement for a single result and the missing profile clause (the
 * file's header says why).
 *
 * N is `extractsRead`, the results with a non-empty extract; the hosts are the
 * kept `sources`, which are those same results after the URL filter, so a
 * source dropped there leaves the count and loses its host.
 *
 * **The identity line has three answers** (plan 260930d P-4):
 *
 * - the first check's page was among this answer's own extracts
 *   (`matchedHost` non-null, which only the server can say);
 * - the first check matched a page, but this search did not return it —
 *   `matchedHost` is null and the row's `lookup` is one that identified a page
 *   (`assessed` or `unreadable`, as `matchedPageOf` in
 *   src/citation-investigate-context.ts decides). **Read from the row, not
 *   stored**: an investigation attaches only while its fingerprint matches,
 *   and the fingerprint covers the matched page, so an attached answer was
 *   written with a match exactly when the row's lookup is one of those two;
 * - otherwise, nothing was confirmed to be the work.
 */
export function investigationProvenance(
  inv: InvestigationProvenanceInput,
  lookup?: Pick<CitationLookup, "state" | "host"> | null,
): string {
  const one = inv.extractsRead === 1;
  const hosts = sourceHosts(inv.sources);
  const where = hosts.length > 0 ? ` (${hosts.join(", ")})` : "";
  const words = `about ${inv.longestExtractWords} ${inv.longestExtractWords === 1 ? "word" : "words"}`;
  const returned = one
    ? `Web search returned an extract for one result${where}, ${words}.`
    : `Web search returned extracts for ${inv.extractsRead} results${where}, the longest ${words}.`;
  const [them, it] = one ? ["that extract", "it"] : ["those extracts", "them"];
  const firstCheckHost = lookup?.state === "assessed" || lookup?.state === "unreadable" ? lookup.host : null;
  const identity =
    inv.matchedHost !== null
      ? `One result (${inv.matchedHost}) was matched to the work by the first check.`
      : firstCheckHost !== null
        ? `The first check matched a page on ${firstCheckHost}; this search's own results did not include it.`
        : "We could not confirm that any result is this work itself.";
  return [
    returned,
    "We did not fetch any page ourselves; an extract may be an abstract or part of a paper's text.",
    `The AI was asked to base what it says about the work on ${them}, and used this article to relate ${it}.`,
    `It was instructed not to quote ${it}.`,
    identity,
  ].join(" ");
}

/* ------------------------------------------------------ the answer's parts -- */

/**
 * The leads the prompt tells the model to open each part with
 * (src/citation-investigate.ts § INVESTIGATE_SYSTEM, *WHAT TO WRITE*).
 * Recognised, not required: a part without one is drawn as plain text.
 */
const LEADS = ["does it back the claim?", "how else it bears on this article", "for you"];

/** A line as a lead, with markdown emphasis, a heading mark or a colon taken off — or null. */
function asLead(line: string): string | null {
  const bare = line
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^[*_]+|[*_]+$/g, "")
    .replace(/:$/, "")
    .trim();
  return LEADS.includes(bare.toLowerCase()) ? bare : null;
}

export interface InvestigationPart {
  lead: string | null;
  text: string;
}

/**
 * **The answer as its parts** — paragraphs split on blank lines, each part's
 * lead taken off its first line, and a lead standing on its own joined to the
 * paragraph after it. The collapsed view draws the first part; the expanded
 * view draws them all. Plain text throughout: nothing here becomes markup.
 */
export function investigationParts(answer: string): InvestigationPart[] {
  const blocks = answer
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b !== "");
  const parts: InvestigationPart[] = [];
  let pending: string | null = null;
  for (const block of blocks) {
    const [first = "", ...rest] = block.split("\n");
    const lead = asLead(first);
    const text = (lead === null ? block : rest.join("\n")).trim();
    if (lead !== null && text === "") {
      if (pending !== null) parts.push({ lead: pending, text: "" });
      pending = lead;
      continue;
    }
    parts.push({ lead: lead ?? pending, text });
    pending = null;
  }
  if (pending !== null) parts.push({ lead: pending, text: "" });
  return parts;
}

/* ------------------------------------------------- which state a row is in -- */

/** A failed run, as the hook keeps it: its sentence, and what was stored when it was pressed. */
export interface InvestigateFailureHere {
  message: string;
  /** The stored investigation's `at` when the press was made, or null for none. */
  previousAt: string | null;
  /** The press's first step stored a page before the failure (plan 260930d P-4). */
  lookupKept: boolean;
}

/**
 * **What the row draws**, decided in one place so no two of these can be on
 * screen together — in particular, never a cut-off answer beside an error.
 */
export type InvestigationView =
  | { kind: "none" }
  /** Pressed, and the first step is looking for the work's own page (plan 260930d). */
  | { kind: "finding" }
  /** Pressed, and no words yet. */
  | { kind: "waiting" }
  /** Words arriving: the stream so far, never drawn as kept. */
  | { kind: "arriving"; text: string }
  /**
   * The error sentence **in place of** whatever had streamed; `previous` is
   * what is still stored and attached after the re-read, and `lookupKept`
   * says the first step's page was kept (P-4).
   */
  | { kind: "failed"; message: string; previous: CitationInvestigation | null; lookupKept: boolean }
  | { kind: "kept"; investigation: CitationInvestigation };

export function investigationViewOf(
  stored: CitationInvestigation | undefined,
  here: {
    running: boolean;
    stage?: InvestigateStage | null;
    draft: string | null;
    failed: InvestigateFailureHere | null;
  },
): InvestigationView {
  if (here.running) {
    if (here.draft) return { kind: "arriving", text: here.draft };
    return here.stage === "finding" ? { kind: "finding" } : { kind: "waiting" };
  }
  if (here.failed !== null) {
    /* The error does not prove nothing was kept (a save can succeed and the
       frame after it be lost), and the hook re-reads the list after a failure.
       A stored answer newer than the one there at the press is that answer:
       draw it, not the failure. */
    if (stored !== undefined && stored.at !== here.failed.previousAt) return { kind: "kept", investigation: stored };
    return { kind: "failed", message: here.failed.message, previous: stored ?? null, lookupKept: here.failed.lookupKept };
  }
  return stored === undefined ? { kind: "none" } : { kind: "kept", investigation: stored };
}

/* ------------------------------------------------------------ the button -- */

/**
 * ***Investigate***, on every owner row — the one button since plan 260930d,
 * which merged *Look it up* into it as its first step. `aria-disabled` and a
 * guard in the handler, not `disabled`: the card saying what a press costs
 * must stay readable in the state where the button will not go (a `disabled`
 * button emits no pointer or focus events, so Floating UI never opens it —
 * CriteriaPanel.tsx § Run this criterion made the same call).
 */
export function InvestigateButton({
  id,
  again,
  running,
  busy,
  onInvestigate,
}: {
  id: string;
  /** The row has a kept answer, so a press replaces it (if it finishes). */
  again: boolean;
  /** This row's run is out. */
  running: boolean;
  /** Any row's run is out — one at a time, as the server's allowance is. */
  busy: boolean;
  onInvestigate(id: string): void;
}) {
  const label = again ? "Investigate again" : "Investigate";
  /* A finger's first tap opens the card, its second presses — a press costs
     money, and the card is what says so (useTapReveal.ts). */
  const reveal = useTapReveal(!busy);
  return (
    <Tooltip
      placement="bottom"
      keepSide
      className="tip-soon"
      open={reveal.open}
      onOpenChange={reveal.onOpenChange}
      content={
        <ControlTip
          head={label}
          /* Each clause bounded by what the code does (plan 260930d): the
             first step is *Look it up* (src/citation-find.ts), skipped when
             the row already has a current reading — "unless it has already";
             "passages code found" is `verifyQuote`; no search count is
             promised (the provider's); what is read is extracts — neither
             step fetches a page; the profile part is the prompt's *For you*,
             only with a profile; both are stored per row. */
          what="First it searches the web for this work's own page, unless it has already, and checks that page's search extract against what the article uses it for, quoting only passages code found in it. Then it writes a longer reading of how the work bears on this article — and on you, if you have written a profile or why you're reading this one."
          how="It costs money. It reads search results' extracts, which may be an abstract or part of a paper; it never fetches the paper itself. On a row with only a Scholar search, the page it finds becomes the link; a link the article gave never changes. Both results are kept on this row; a new reading replaces the old one only if it finishes."
          tap={reveal.tap}
        />
      }
    >
      <button
        type="button"
        className="gloss-btn cite-investigate"
        aria-disabled={busy}
        onPointerDown={reveal.onPointerDown}
        onPointerCancel={reveal.onPointerCancel}
        onClick={(e) => {
          if (!reveal.commit(e)) return;
          if (busy) return;
          onInvestigate(id);
        }}
      >
        <Microscope size={11} aria-hidden="true" />
        {running ? "Investigating…" : label}
      </button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------- the block -- */

/**
 * Everything *Investigate* draws under a row: the wait, the words arriving,
 * the failure, or the kept answer. Nothing for `none`.
 */
export function InvestigationBlock({
  id,
  view,
  busy,
  lookup,
  onInvestigate,
}: {
  id: string;
  view: InvestigationView;
  busy: boolean;
  /** The row's current lookup, drawn by the row itself — here only for the identity line. */
  lookup: CitationLookup | undefined;
  onInvestigate(id: string): void;
}) {
  /* Open a fresh answer that has just streamed in, rather than folding away
     what the reader was reading; a stored one on arrival starts folded. */
  const [open, setOpen] = useState(false);
  const was = useRef(view.kind);
  useEffect(() => {
    if (view.kind === "kept" && was.current === "arriving") setOpen(true);
    was.current = view.kind;
  }, [view.kind]);

  const again = (
    <button
      type="button"
      className="cite-inv-again"
      aria-disabled={busy}
      onClick={() => {
        if (busy) return;
        onInvestigate(id);
      }}
    >
      Investigate again
    </button>
  );

  switch (view.kind) {
    case "none":
      return null;
    case "finding":
      return (
        <p className="cite-inv-wait" role="status">
          {INVESTIGATE_FINDING}
        </p>
      );
    case "waiting":
      return (
        <p className="cite-inv-wait" role="status">
          {INVESTIGATE_WAIT}
        </p>
      );
    case "arriving":
      return (
        <div className="cite-inv" aria-live="polite">
          <p className="cite-lookup-label">arriving…</p>
          <p className="cite-inv-draft">{view.text}</p>
        </div>
      );
    case "failed":
      return (
        <div className="cite-inv">
          <p className="cite-inv-error" role="status">
            {view.message} {again}
          </p>
          {/* P-4: the quick check landed before the failure; the row above
              already shows it, from the re-read. */}
          {view.lookupKept && <p className="cite-inv-previous">{INVESTIGATE_LOOKUP_KEPT}</p>}
          {/* Only an investigation that still attaches after the re-read —
              the first step's new match can detach the earlier one. */}
          {view.previous && (
            <>
              <p className="cite-inv-previous">{INVESTIGATE_PREVIOUS_KEPT}</p>
              <Kept
                investigation={view.previous}
                open={open}
                onToggle={() => setOpen((o) => !o)}
                again={again}
                lookup={lookup}
              />
            </>
          )}
        </div>
      );
    case "kept":
      return (
        <div className="cite-inv">
          <Kept
            investigation={view.investigation}
            open={open}
            onToggle={() => setOpen((o) => !o)}
            again={again}
            lookup={lookup}
          />
        </div>
      );
    default: {
      const unhandled: never = view;
      return unhandled;
    }
  }
}

/**
 * **A kept answer.** Folded: the label and the first part, with a toggle, so
 * the list stays a list. Open: every part, what was read, the sources, the
 * date and *Investigate again*.
 */
function Kept({
  investigation,
  open,
  onToggle,
  again,
  lookup,
}: {
  investigation: CitationInvestigation;
  open: boolean;
  onToggle(): void;
  again: React.ReactNode;
  lookup: CitationLookup | undefined;
}) {
  const parts = investigationParts(investigation.answer);
  const shown = open ? parts : parts.slice(0, 1);
  const sources = investigation.sources.filter((s) => isWebUrl(s.url));
  return (
    <>
      <p className="cite-lookup-label">{INVESTIGATION_LABEL}:</p>
      {shown.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed answer, never reordered
        <div key={i} className={`cite-inv-part${open ? "" : " folded"}`}>
          {part.lead && <p className="cite-inv-lead">{part.lead}</p>}
          {part.text && <p className="cite-inv-text">{part.text}</p>}
        </div>
      ))}
      <button type="button" className="cite-inv-toggle" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronUp size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
        {open ? "Show less" : "Read all, and what it read"}
      </button>
      {open && (
        <>
          <p className="cite-inv-prov">{investigationProvenance(investigation, lookup)}</p>
          {sources.length > 0 && (
            <ul className="cite-inv-sources">
              {sources.map((s) => (
                <li key={s.url}>
                  {/* Out of the app, so a new tab — docs/project/links.md. */}
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={10} aria-hidden="true" />
                    {hostOf(s.url)}
                  </a>
                  {s.title && <span className="cite-inv-source-title"> — {s.title}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="cite-inv-foot">
            Investigated {new Date(investigation.at).toLocaleDateString()} · {again}
          </p>
        </>
      )}
    </>
  );
}

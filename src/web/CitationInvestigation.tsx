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
import type { CitationInvestigation } from "../types.js";
import { hostOf, isWebUrl } from "../urls.js";
import { ControlTip, Tooltip } from "./Tooltip.js";

/* ------------------------------------------------------------- the copy -- */

/** Over a kept answer, collapsed or not: whose words these are, and from what. */
export const INVESTIGATION_LABEL = "the AI's reading of web search extracts";

/** Under the button until the first words land. The words are the progress after that. */
export const INVESTIGATE_WAIT =
  "It searches the web and then writes, which can take up to a minute. If it finishes, the answer is kept on this row even if you leave.";

/** Sol Q-4: a failed *Investigate again* replaced nothing, and says so. */
export const INVESTIGATE_PREVIOUS_KEPT = "The new investigation was not kept; the previous one is still shown.";

/**
 * Beside a kept answer on a row nobody has looked up. *Look it up* is the
 * other half of the plan (verbatim evidence, checked by code), and it is a
 * separate charge, so this offers it and does not run it. A row that has a
 * lookup already shows its reading above, so this line is not drawn there.
 */
export const INVESTIGATE_OFFER_LOOKUP =
  "Not looked up yet: Look it up, above, checks one matching page's extract against what the article uses it for, and shows only passages code found in it.";

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
 * source dropped there leaves the count and loses its host. The identity line
 * credits *Look it up* only when the server found its page among this answer's
 * own extracts (`matchedHost` non-null).
 */
export function investigationProvenance(inv: InvestigationProvenanceInput): string {
  const one = inv.extractsRead === 1;
  const hosts = sourceHosts(inv.sources);
  const where = hosts.length > 0 ? ` (${hosts.join(", ")})` : "";
  const words = `about ${inv.longestExtractWords} ${inv.longestExtractWords === 1 ? "word" : "words"}`;
  const returned = one
    ? `Web search returned an extract for one result${where}, ${words}.`
    : `Web search returned extracts for ${inv.extractsRead} results${where}, the longest ${words}.`;
  const [them, it] = one ? ["that extract", "it"] : ["those extracts", "them"];
  const identity =
    inv.matchedHost !== null
      ? `One result (${inv.matchedHost}) was matched to the work by Look it up.`
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
}

/**
 * **What the row draws**, decided in one place so no two of these can be on
 * screen together — in particular, never a cut-off answer beside an error.
 */
export type InvestigationView =
  | { kind: "none" }
  /** Pressed, and no words yet. */
  | { kind: "waiting" }
  /** Words arriving: the stream so far, never drawn as kept. */
  | { kind: "arriving"; text: string }
  /** The error sentence **in place of** whatever had streamed; `previous` is what is still stored. */
  | { kind: "failed"; message: string; previous: CitationInvestigation | null }
  | { kind: "kept"; investigation: CitationInvestigation };

export function investigationViewOf(
  stored: CitationInvestigation | undefined,
  here: { running: boolean; draft: string | null; failed: InvestigateFailureHere | null },
): InvestigationView {
  if (here.running) return here.draft ? { kind: "arriving", text: here.draft } : { kind: "waiting" };
  if (here.failed !== null) {
    /* The error does not prove nothing was kept (a save can succeed and the
       frame after it be lost), and the hook re-reads the list after a failure.
       A stored answer newer than the one there at the press is that answer:
       draw it, not the failure. */
    if (stored !== undefined && stored.at !== here.failed.previousAt) return { kind: "kept", investigation: stored };
    return { kind: "failed", message: here.failed.message, previous: stored ?? null };
  }
  return stored === undefined ? { kind: "none" } : { kind: "kept", investigation: stored };
}

/* ------------------------------------------------------------ the button -- */

/**
 * ***Investigate***, beside *Look it up* on every owner row. `aria-disabled`
 * and a guard in the handler, not `disabled`, for *Look it up*'s reason: the
 * card saying what a press costs must stay readable in the state where the
 * button will not go (CitationsPanel.tsx § the Look it up button).
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
  return (
    <Tooltip
      placement="bottom"
      keepSide
      className="tip-soon"
      content={
        <ControlTip
          head={label}
          /* Each clause bounded by what the code does: the search is the
             provider's (no count promised), what is read is extracts
             (src/citation-investigate.ts never fetches a page), the profile
             part is the prompt's *For you*, only with a profile. */
          what="Searches the web for this work and writes a short reading of how it bears on this article — and on you, if you have written a profile or why you're reading this one."
          how="It costs money. It reads search results' extracts, which may be an abstract or part of a paper; it does not fetch the page itself, and is told not to quote the extracts. The answer is kept on this row; a new one replaces it only if it finishes."
        />
      }
    >
      <button
        type="button"
        className="gloss-btn cite-investigate"
        aria-disabled={busy}
        onClick={() => {
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
  hasLookup,
  onInvestigate,
}: {
  id: string;
  view: InvestigationView;
  busy: boolean;
  /** The row carries a *Look it up* reading, drawn by the row itself. */
  hasLookup: boolean;
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
          {view.previous && (
            <>
              <p className="cite-inv-previous">{INVESTIGATE_PREVIOUS_KEPT}</p>
              <Kept
                investigation={view.previous}
                open={open}
                onToggle={() => setOpen((o) => !o)}
                again={again}
                hasLookup={hasLookup}
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
            hasLookup={hasLookup}
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
 * date and *Investigate again*, and the offer of *Look it up* on a row that has
 * none.
 */
function Kept({
  investigation,
  open,
  onToggle,
  again,
  hasLookup,
}: {
  investigation: CitationInvestigation;
  open: boolean;
  onToggle(): void;
  again: React.ReactNode;
  hasLookup: boolean;
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
          <p className="cite-inv-prov">{investigationProvenance(investigation)}</p>
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
          {!hasLookup && <p className="cite-inv-offer">{INVESTIGATE_OFFER_LOOKUP}</p>}
        </>
      )}
    </>
  );
}

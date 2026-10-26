/**
 * **Sources' two experiments: Guess first and Evidence first** — plan
 * docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md
 * § Stage 4 (GPT Sol's F12 and F13). Two ways of meeting the literature
 * search's findings before reading the model's verdict on them, so the reader
 * does the central step and the model is the second opinion:
 *
 * ```
 *  ┌ Where it sits │ Bibliography │ Links ┐  Where it sits › Guess first
 *  │ What do you think critics, supporters and later work said about this?
 *  │   “Ignition is a step-function …”  k3m9qt
 *  │   “The report is a reference point …”  q7w2dn
 *  │ [ Reveal what the search found ]
 *
 *  ┌ … ┐  Where it sits › Evidence first
 *  │   The piece: “Ignition is a step-function …”  k3m9qt
 *  │   Nature: “the 2025 collaboration found little ignition …”
 *  │   Does it support, challenge or update the passage?  [Supports] [Challenges] [Updates]
 *  │   [ Reveal the search's reading ]
 * ```
 *
 * **Small and honest, on purpose**: left-field ideas for Greg to play with,
 * not finished features. Both are behind the experimental switch and reached
 * only from *Where it sits*' tools row (params.ts § `SOURCES_EXPERIMENTS`).
 *
 * **Free, and they start nothing.** Each reads the stored dossier through
 * `useSituateRead` — the read half alone, which has no press to call — and
 * with none stored says so and points at *Search the literature*, a plain
 * move to *Where it sits* that starts nothing either.
 *
 * **Nothing the reader does leaves the component.** Guess first asks for no
 * typing at all: the prediction is in the reader's head. Evidence first's
 * choice and every *Reveal* are `useState` here, never the address, never
 * storage, never a request, and forgotten on leaving (F12).
 *
 * **Whose words**: the passage is the article's (`Excerpt`, the author's
 * face), a source's quote a stranger's page's characters (left in the UI
 * face, as the dossier draws it), and the note the model's (`voice-ai`) —
 * docs/project/fonts.md. Every one is a React child, never markup.
 */
import { Eye, EyeOff } from "lucide-react";
import { type ReactNode, useState } from "react";
import { MODE_LABEL } from "../title-text.js";
import type { BlockId, SituateFinding } from "../types.js";
import { isWebUrl } from "../urls.js";
import { BandWaiting } from "./BandWaiting.js";
import { BlockRef } from "./BlockRef.js";
import { Excerpt } from "./Excerpt.js";
import { ModeSurface } from "./ModeSurface.js";
import { OrderGroup } from "./OrderGroup.js";
import type { SourcesExperiment, SourcesView } from "./params.js";
import { ReadError } from "./ReadError.js";
import { SourceRow } from "./SituateDossier.js";
import {
  SITUATE_FINDING_LABEL,
  SITUATE_FINDING_TIP,
  SITUATE_RUN,
  SITUATE_STALE,
  sourceHost,
} from "./situate-dossier.js";
import { SOURCES_SUB_MODES } from "./sub-modes.js";
import type { SituateRead } from "./useSituate.js";

/** What the experiments read of the dossier: the read half alone, so there is nothing here that could start a run. */
export type ExperimentRead = Pick<SituateRead, "status" | "situate" | "stale" | "error" | "retryRead">;

/** With no dossier stored: what is missing, and where it is made. */
export const EXPERIMENT_NO_DOSSIER =
  "This needs a search of the literature, and nobody has run one for this piece yet. It is made on Where it sits, and costs a press there.";
/** The way there: a move, never the search itself. */
export const EXPERIMENT_GO_SEARCH = `Go to ${SITUATE_RUN}`;
/** A dossier with nothing to play with. */
export const EXPERIMENT_NO_FINDINGS =
  "The search of the literature found nothing it could check against this piece's passages, so there is nothing to try this on.";
/** Under the head of both: that nothing is kept. */
export const EXPERIMENT_KEPT = "An experiment. Nothing you choose here is saved or sent.";

/* ---- Guess first ---- */

export const GUESS_PROMPT =
  "Before you see what the search of the literature found: what do you think critics, supporters and later work said about each of these passages? Take a moment to predict, in your head.";
export const GUESS_REVEAL = "Reveal what the search found";
export const GUESS_HIDE = "Hide it again";

/* ---- Evidence first ---- */

export const EVIDENCE_PROMPT =
  "Each passage is beside what a source says. Decide for yourself whether the source supports it, challenges it or updates it, then see how the search read it.";
export const EVIDENCE_THE_PIECE = "The piece";
export const EVIDENCE_YOUR_READING = "Your reading of this source";
export const EVIDENCE_REVEAL = "Reveal the search's reading";
/** The reader's three answers. The search's own kinds are six, so no answer is marked right or wrong. */
export const EVIDENCE_CHOICES = ["supports", "challenges", "updates"] as const;
export type EvidenceChoice = (typeof EVIDENCE_CHOICES)[number];
export const EVIDENCE_CHOICE_LABEL: Record<EvidenceChoice, string> = {
  supports: "Supports",
  challenges: "Challenges",
  updates: "Updates",
};
export const EVIDENCE_SEARCH_READ = "The search read it as";

/**
 * **One experiment's band**: the head with its crumb, the dossier's read
 * states, and the experiment's body once there are findings.
 */
export function SourcesExperimentPanel({
  experiment,
  head,
  read,
  onJump,
  onView,
}: {
  experiment: SourcesExperiment;
  /** The chip row with *Where it sits* lit, and the crumb back (SourcesMode.tsx). */
  head: ReactNode;
  read: ExperimentRead;
  onJump(id: BlockId): void;
  /** A plain move: *Where it sits*, for the search. Arms nothing. */
  onView(view: SourcesView): void;
}) {
  const words = SOURCES_SUB_MODES[experiment];
  const made = read.status === "ready" ? read.situate : null;
  const findings = made?.outcome === "read" ? made.findings : [];
  let body: ReactNode;
  if (read.error) body = <ReadError error={read.error} onRetry={read.retryRead} />;
  else if (read.status === "loading") body = <BandWaiting className="gloss-quiet">Looking for a search of the literature…</BandWaiting>;
  else if (made === null) body = <NoDossier onGo={() => onView("where")} />;
  else if (findings.length === 0) body = <p className="rcp-empty experiment-none">{EXPERIMENT_NO_FINDINGS}</p>;
  else if (experiment === "guess-first") body = <GuessFirst findings={findings} onJump={onJump} />;
  else body = <EvidenceFirst findings={findings} onJump={onJump} />;
  return (
    <ModeSurface
      label={MODE_LABEL.sources}
      feature={`gloss sources experiment ${experiment}`}
      mode="sources"
      about={
        <>
          <p>
            {words.label}: {words.description}.
          </p>
          <p>{EXPERIMENT_ABOUT}</p>
        </>
      }
      head={head}
    >
      <div className="tl-scroll where-scroll experiment-scroll">
        <p className="gloss-quiet experiment-kept">{EXPERIMENT_KEPT}</p>
        {made !== null && read.stale && <p className="gloss-quiet experiment-stale">{SITUATE_STALE}</p>}
        {body}
      </div>
    </ModeSurface>
  );
}

/** The (i)'s second paragraph, for both. */
export const EXPERIMENT_ABOUT =
  "Both experiments use the search of the literature already stored for this piece, cost nothing and start nothing. They are behind the experimental features switch, and may change or go.";

function NoDossier({ onGo }: { onGo(): void }) {
  return (
    <div className="experiment-no-dossier">
      <p className="gloss-hint">{EXPERIMENT_NO_DOSSIER}</p>
      <button type="button" className="rcp-more experiment-go" onClick={onGo}>
        {EXPERIMENT_GO_SEARCH}
      </button>
    </div>
  );
}

/** The article's passage, with its jump: what both experiments start every finding from. */
function Passage({ finding, onJump }: { finding: SituateFinding; onJump(id: BlockId): void }) {
  return (
    <p className="situate-finding-head">
      <span className="rcp-group-quote situate-quote">
        “<Excerpt blockId={finding.blockId} words={finding.quote} />”
      </span>
      <BlockRef id={finding.blockId} onJump={onJump} />
    </p>
  );
}

/** What the search made of a finding: its kind, what the kind means, and the model's note. */
function SearchReading({ finding }: { finding: SituateFinding }) {
  return (
    <div className="experiment-reading">
      <p className="experiment-kind" data-situate-kind={finding.kind}>
        {EVIDENCE_SEARCH_READ} <strong>{SITUATE_FINDING_LABEL[finding.kind]}</strong>:{" "}
        <span className="gloss-quiet">{SITUATE_FINDING_TIP[finding.kind]}</span>
      </p>
      <p className="situate-note voice-ai">
        {finding.note}
        {finding.strength === "suggestive" && <span className="situate-strength"> · suggestive</span>}
      </p>
    </div>
  );
}

/**
 * ***Guess first*** — every finding's passage with its kind, note and sources
 * left out of the page until *Reveal*, in the dossier's stored order
 * (strongest first), never grouped by kind, which would give the answer
 * away. One reveal for all of them: the pause is to predict the whole
 * picture, then compare.
 */
function GuessFirst({ findings, onJump }: { findings: readonly SituateFinding[]; onJump(id: BlockId): void }) {
  const [shown, setShown] = useState(false);
  return (
    <section className="where-section experiment-guess" aria-label={SOURCES_SUB_MODES["guess-first"].label}>
      <p className="gloss-hint experiment-prompt">{GUESS_PROMPT}</p>
      <ul className="situate-findings">
        {findings.map((finding) => (
          <li key={finding.id} className="situate-finding" data-finding={finding.id}>
            <Passage finding={finding} onJump={onJump} />
            {shown && (
              <>
                <SearchReading finding={finding} />
                <ul className="situate-sources">
                  {finding.sources.map((source) => (
                    <SourceRow key={source.url} source={source} />
                  ))}
                </ul>
              </>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="rcp-more experiment-reveal"
        aria-pressed={shown}
        onClick={() => setShown((was) => !was)}
      >
        {shown ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
        {shown ? GUESS_HIDE : GUESS_REVEAL}
      </button>
    </section>
  );
}

/**
 * ***Evidence first*** — each finding as the article's passage beside the
 * checked quote of each source it rests on, the kind and the note left out
 * until that finding's *Reveal*. The reader may choose an answer first; the
 * choice is this component's state alone, and locked once revealed, so the
 * comparison stays honest. No answer is scored: the search's six kinds do not
 * map onto three words, and a mark would claim more than the model knows.
 */
function EvidenceFirst({ findings, onJump }: { findings: readonly SituateFinding[]; onJump(id: BlockId): void }) {
  return (
    <section className="where-section experiment-evidence" aria-label={SOURCES_SUB_MODES["evidence-first"].label}>
      <p className="gloss-hint experiment-prompt">{EVIDENCE_PROMPT}</p>
      <ul className="situate-findings">
        {findings.map((finding) => (
          <EvidenceRow key={finding.id} finding={finding} onJump={onJump} />
        ))}
      </ul>
    </section>
  );
}

function EvidenceRow({ finding, onJump }: { finding: SituateFinding; onJump(id: BlockId): void }) {
  const [choice, setChoice] = useState<EvidenceChoice | null>(null);
  const [shown, setShown] = useState(false);
  return (
    <li className="situate-finding experiment-evidence-row" data-finding={finding.id}>
      <p className="experiment-side">{EVIDENCE_THE_PIECE}</p>
      <Passage finding={finding} onJump={onJump} />
      <ul className="situate-sources experiment-source-quotes">
        {finding.sources.map((source) => {
          const title = source.title.trim() || sourceHost(source.url);
          /* The active sink re-checks the scheme, as SituateDossier's row does. */
          const href = isWebUrl(source.url) ? source.url : null;
          return (
            <li key={source.url} className="situate-source">
              <p className="experiment-side">
                {href !== null ? (
                  <a className="situate-source-link" href={href} target="_blank" rel="noreferrer noopener" data-tip={href}>
                    {title}
                    <span className="situate-source-host"> · {sourceHost(href)}</span>
                  </a>
                ) : (
                  title
                )}
              </p>
              <blockquote className="rcp-quote situate-source-quote">“{source.quote}”</blockquote>
            </li>
          );
        })}
      </ul>
      <OrderGroup label={EVIDENCE_YOUR_READING} selected={choice ?? ""}>
        {EVIDENCE_CHOICES.map((key) => (
          <button
            key={key}
            type="button"
            className={`gloss-sort-btn${choice === key ? " on" : ""}`}
            aria-pressed={choice === key}
            disabled={shown}
            onClick={() => setChoice(key)}
          >
            {EVIDENCE_CHOICE_LABEL[key]}
          </button>
        ))}
      </OrderGroup>
      {shown ? (
        <SearchReading finding={finding} />
      ) : (
        <button type="button" className="rcp-more experiment-reveal" onClick={() => setShown(true)}>
          <Eye size={13} aria-hidden="true" />
          {EVIDENCE_REVEAL}
        </button>
      )}
    </li>
  );
}

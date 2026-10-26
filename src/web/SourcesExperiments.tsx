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
 *  │   “Ignition is a step-function …”
 *  │   [Challenged│Supported│Added to since│Something else]  [ Reveal ]
 *  │   You guessed Supported · the search found Challenged: …
 *  │ [ Reveal them all ]
 *
 *  ┌ … ┐  Where it sits › Evidence first
 *  │   The piece: “Ignition is a step-function …”
 *  │   Nature: “the 2025 collaboration found little ignition …”
 *  │   [Supports it│Challenges it│Adds to it]  [ Reveal the search's reading ]
 *  │   You said Challenges it; the search read it as Challenged: …
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
 * **Something to commit to, in both** (a persona review, 2026-10-26: with
 * nothing to choose, readers skipped straight to *Reveal*). Guess first asks
 * for a guess per passage from a few plain words mapped onto the dossier's own
 * kinds; Evidence first for a reading of each source. Each is the house's
 * part-switcher (`.summ-views`, mode-band.css) as a radio group, so the
 * choice shows as chosen, and is locked once that passage is revealed so the
 * comparison stays honest. **Neither is scored**: the search's six kinds do
 * not map one-to-one onto the reader's words, so the reveal puts the two side
 * by side in plain words and marks nothing right or wrong.
 *
 * **Nothing the reader does leaves the component.** Every guess, choice and
 * *Reveal* is `useState` here, never the address, never storage, never a
 * request, and forgotten on leaving (F12).
 *
 * **Whose words**: the passage is the article's (`FindingPassage`, the
 * author's face, and the link to it), a source's quote a stranger's page's
 * characters (left in the UI face, as the dossier draws it), and the note the
 * model's (`voice-ai`) — docs/project/fonts.md. Every one is a React child,
 * never markup.
 */
import { Eye, EyeOff } from "lucide-react";
import { type ReactNode, useState } from "react";
import { MODE_LABEL } from "../title-text.js";
import type { BlockId, SituateFinding, SituateFindingKind } from "../types.js";
import { isWebUrl } from "../urls.js";
import { BandWaiting } from "./BandWaiting.js";
import { Button } from "./components/ui/button.js";
import { ModeSurface } from "./ModeSurface.js";
import type { SourcesExperiment, SourcesView } from "./params.js";
import { ReadError } from "./ReadError.js";
import { FindingPassage, SourceRow } from "./SituateDossier.js";
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
  "Before you see what the search of the literature found: what do you think critics, supporters and later work said about each of these passages? Pick a guess for each, then reveal what the search found.";
/** One passage's reveal, and the one for every passage at the foot. */
export const GUESS_REVEAL = "Reveal";
export const GUESS_REVEAL_ALL = "Reveal them all";
export const GUESS_HIDE_ALL = "Hide them all again";
export const GUESS_YOURS = "Your guess";
/**
 * **The reader's guesses, mapped onto the dossier's kinds** (`SituateFindingKind`):
 * the three a reader can predict from a passage, in plain words, and one for
 * the rest (*Citation?*, *Not cited?*, *Reception*), which ask about the
 * piece's citing rather than what later work found.
 */
export const GUESS_CHOICES = ["challenged", "supported", "since", "other"] as const;
export type GuessChoice = (typeof GUESS_CHOICES)[number];
export const GUESS_CHOICE_LABEL: Record<GuessChoice, string> = {
  challenged: "Challenged",
  supported: "Supported",
  since: "Added to since",
  other: "Something else",
};
/** Which guess a kind falls under: the map the choices stand on, exhaustive over the kinds. */
export const GUESS_OF_KIND: Record<SituateFindingKind, GuessChoice> = {
  challenged: "challenged",
  supported: "supported",
  since: "since",
  citation: "other",
  missing: "other",
  reception: "other",
};

/** *You guessed Supported · the search found Challenged*, or with no guess, only the search's half. */
export function guessLine(guess: GuessChoice | null, kind: SituateFindingKind): string {
  const found = `the search found ${SITUATE_FINDING_LABEL[kind]}`;
  return guess === null ? `${found[0]?.toUpperCase()}${found.slice(1)}` : `You guessed ${GUESS_CHOICE_LABEL[guess]} · ${found}`;
}

/* ---- Evidence first ---- */

export const EVIDENCE_PROMPT =
  "Each passage is beside what a source says. Decide for yourself whether the source supports the passage, challenges it or adds to it, then see how the search read it.";
export const EVIDENCE_THE_PIECE = "The piece";
export const EVIDENCE_YOUR_READING = "Your reading of this source";
export const EVIDENCE_REVEAL = "Reveal the search's reading";
/** The reader's three answers. The search's own kinds are six, so no answer is marked right or wrong. */
export const EVIDENCE_CHOICES = ["supports", "challenges", "adds"] as const;
export type EvidenceChoice = (typeof EVIDENCE_CHOICES)[number];
/**
 * In words that need no gloss. The third was *Updates* until 2026-10-26, which
 * a persona review found unclear; *Adds to it* is the dossier's own *Since*
 * in the reader's words (`SITUATE_FINDING_TIP.since`: work that changes or
 * adds to the picture).
 */
export const EVIDENCE_CHOICE_LABEL: Record<EvidenceChoice, string> = {
  supports: "Supports it",
  challenges: "Challenges it",
  adds: "Adds to it",
};

/** *You said Challenges it; the search read it as Challenged*, or with no choice, only the search's half. */
export function evidenceLine(choice: EvidenceChoice | null, kind: SituateFindingKind): string {
  const read = `the search read it as ${SITUATE_FINDING_LABEL[kind]}`;
  return choice === null ? `${read[0]?.toUpperCase()}${read.slice(1)}` : `You said ${EVIDENCE_CHOICE_LABEL[choice]}; ${read}`;
}

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

/** The article's passage, which is the link to it: what both experiments start every finding from. */
function Passage({ finding, onJump }: { finding: SituateFinding; onJump(id: BlockId): void }) {
  return (
    <p className="situate-finding-head">
      <FindingPassage finding={finding} onJump={onJump} />
    </p>
  );
}

/**
 * **The reader's choice, as the house's part-switcher** (`.summ-views` /
 * `.summ-view-btn`, mode-band.css): joined, with the chosen part raised, as a
 * radio group. Disabled once its passage is revealed, so the choice cannot be
 * changed after seeing the answer.
 */
function ChoiceBar<K extends string>({
  label,
  keys,
  labels,
  chosen,
  locked,
  onChoose,
}: {
  label: string;
  keys: readonly K[];
  labels: Record<K, string>;
  chosen: K | null;
  locked: boolean;
  onChoose(key: K): void;
}) {
  return (
    <div className="summ-views experiment-choices" role="radiogroup" aria-label={label}>
      {keys.map((key) => (
        // biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s, as Sources' own chips (SourcesMode.tsx § SourcesViews) draw it
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={chosen === key}
          tabIndex={0}
          className={`summ-view-btn${chosen === key ? " on" : ""}`}
          disabled={locked}
          onClick={() => onChoose(key)}
        >
          {labels[key]}
        </button>
      ))}
    </div>
  );
}

/** A reveal: a real button (shadcn `Button`, outline, small), with the eye. */
function RevealButton({ label, onReveal }: { label: string; onReveal(): void }) {
  return (
    <Button type="button" variant="outline" size="sm" className="experiment-reveal" onClick={onReveal}>
      <Eye size={13} aria-hidden="true" />
      {label}
    </Button>
  );
}

/**
 * What the search made of a finding: the reader's answer beside the search's
 * kind (`line`), what the kind means, and the model's note.
 */
function SearchReading({ finding, line }: { finding: SituateFinding; line: string }) {
  return (
    <div className="experiment-reading">
      <p className="experiment-kind" data-situate-kind={finding.kind}>
        <strong>{line}</strong>: <span className="gloss-quiet">{SITUATE_FINDING_TIP[finding.kind]}</span>
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
 * left out of the page until that passage's *Reveal*, or *Reveal them all*,
 * in the dossier's stored order (strongest first), never grouped by kind,
 * which would give the answer away. Each passage takes a guess first.
 */
function GuessFirst({ findings, onJump }: { findings: readonly SituateFinding[]; onJump(id: BlockId): void }) {
  const [guesses, setGuesses] = useState<Readonly<Record<string, GuessChoice>>>({});
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const allShown = findings.every((f) => shown.has(f.id));
  return (
    <section className="where-section experiment-guess" aria-label={SOURCES_SUB_MODES["guess-first"].label}>
      <p className="gloss-hint experiment-prompt">{GUESS_PROMPT}</p>
      <ul className="situate-findings">
        {findings.map((finding) => {
          const open = shown.has(finding.id);
          const guess = guesses[finding.id] ?? null;
          return (
            <li key={finding.id} className="situate-finding experiment-guess-row" data-finding={finding.id}>
              <Passage finding={finding} onJump={onJump} />
              <div className="experiment-answer">
                <ChoiceBar
                  label={GUESS_YOURS}
                  keys={GUESS_CHOICES}
                  labels={GUESS_CHOICE_LABEL}
                  chosen={guess}
                  locked={open}
                  onChoose={(key) => setGuesses((was) => ({ ...was, [finding.id]: key }))}
                />
                {!open && <RevealButton label={GUESS_REVEAL} onReveal={() => setShown((was) => new Set([...was, finding.id]))} />}
              </div>
              {open && (
                <>
                  <SearchReading finding={finding} line={guessLine(guess, finding.kind)} />
                  <ul className="situate-sources">
                    {finding.sources.map((source) => (
                      <SourceRow key={source.url} source={source} />
                    ))}
                  </ul>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="experiment-reveal experiment-reveal-all"
        aria-pressed={allShown}
        onClick={() => setShown(allShown ? new Set() : new Set(findings.map((f) => f.id)))}
      >
        {allShown ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
        {allShown ? GUESS_HIDE_ALL : GUESS_REVEAL_ALL}
      </Button>
    </section>
  );
}

/**
 * ***Evidence first*** — each finding as the article's passage beside the
 * checked quote of each source it rests on, the kind and the note left out
 * until that finding's *Reveal*. The reader may choose an answer first; the
 * choice is this component's state alone, and locked once revealed.
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
      <div className="experiment-answer">
        <ChoiceBar
          label={EVIDENCE_YOUR_READING}
          keys={EVIDENCE_CHOICES}
          labels={EVIDENCE_CHOICE_LABEL}
          chosen={choice}
          locked={shown}
          onChoose={setChoice}
        />
        {!shown && <RevealButton label={EVIDENCE_REVEAL} onReveal={() => setShown(true)} />}
      </div>
      {shown && <SearchReading finding={finding} line={evidenceLine(choice, finding.kind)} />}
    </li>
  );
}

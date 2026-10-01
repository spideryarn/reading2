/**
 * **Simple** — Summary's plain-words sub-mode: a few short paragraphs in
 * everyday words saying what the piece is about, why it matters and its key
 * ideas, each followed by the passages it rests on.
 * docs/plans/260930i-simple-summaries-eli15-sub-mode.md,
 * docs/project/summaries.md § Simple — a plain-words orientation.
 *
 * Drawn inside the Summary band, below the one row of controls
 * (SummaryMode.tsx § `SummaryControls`), so there is no `ModeSurface` here —
 * this is the body. Two levels, `simple` and `fuller`, one artefact: the panel
 * draws whichever the row has chosen.
 *
 * Two things keep it an orientation rather than a replacement for reading,
 * and the file must go on doing both:
 *
 * - **every paragraph is a door** — its ids are drawn with the same `BlockRef`
 *   chips the gists use, hover shows the passage, a click goes there;
 * - **plain text**, never markdown — model output is not HTML (security.md).
 *
 * **What it is lives on the pills, not under the paragraphs.** There was a foot
 * here — *"Written by AI in plain words to help you get your bearings…"* —
 * until Greg, 2026-09-30 (SPIDERYARN-READING2-7B): *"we don't want these mode
 * descriptions - they waste space."* Each pill's card says it now, and
 * docs/project/mode.md has the rule.
 */
import { RotateCw, TriangleAlert, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BlockId, SimpleLevel, SimpleParagraph } from "../types.js";
import type { PublicSimpleSummary } from "../public-types.js";
import type { UseSimple } from "./useSimple.js";
import { BlockRef } from "./BlockRef.js";
import { JobProgress } from "./JobProgress.js";
import { TooltipGroup } from "./Tooltip.js";
import { useRenderCount } from "./perf.js";

/** A visitor on a public article whose owner never asked for one. */
export const SIMPLE_NONE_VISITOR = "Nobody has made a plain-words version of this piece yet.";

/** The owner's empty state, before the press has started anything. */
export const SIMPLE_NONE_OWNER = "Nobody has asked for a plain-words version of this piece yet.";

/**
 * **Who is reading, and the paragraphs they get — one prop.** The owner's arm
 * is the whole `useSimple` read with its job and verbs; the visitor's is the
 * stored paragraphs off the public payload, or `null` for none, and nothing
 * else — no read state, no job, no verb, so a visitor's view has nothing to
 * press that could ask the model. `owner?: never` for `FaqAccess`'s reason.
 */
export type SimpleAccess =
  | { kind: "owner"; owner: UseSimple }
  | { kind: "visitor"; simple: PublicSimpleSummary | null; owner?: never };

export function SimplePanel({
  access,
  level,
  onJump,
}: {
  access: SimpleAccess;
  /** Which of the three levels the row has chosen. */
  level: SimpleLevel;
  onJump(id: BlockId): void;
}) {
  useRenderCount("SimplePanel");
  const owner = access.kind === "owner" ? access.owner : null;
  const paragraphs =
    access.kind === "owner" ? access.owner.simple?.levels[level] : access.simple?.levels[level];
  /* A visitor's paragraphs arrived with the page, so they are ready by construction. */
  const ready = paragraphs !== undefined && (owner === null || owner.status === "ready");
  /* The button beside paragraphs already there: while a job runs or after one
     failed, and — since the paragraphs are written for the reader — once the
     reader has changed their profile, so *Write it again* picks up the new one
     (the quiz's rule; the badge in the row says why, in its card). */
  const showJob =
    owner !== null && ready && !owner.stale && (owner.job || owner.starting || owner.failed || owner.profileChanged);

  /**
   * @param again whether this is the button beside paragraphs already there.
   *   The empty state's button must be `ensure` — the identical, unforced
   *   request the automatic run makes — or it buys a second model call.
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
        step="simple"
        icon={<Sprout size={13} />}
        runningLabel="Writing it in plain words…"
      />
    );

  return (
    <div className="summ-scroll simple-scroll">
      {owner?.error && (
        <div className="simple-read-error">
          <p className="gloss-error" role="alert">
            {owner.error}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void owner.retryRead()}>
            <RotateCw size={13} />
            Try again
          </Button>
        </div>
      )}
      {owner?.status === "loading" && <p className="summ-quiet">Looking for the plain-words version…</p>}
      {owner?.status === "none" && (
        <div className="gloss-empty">
          <p>{SIMPLE_NONE_OWNER}</p>
          <p className="gloss-hint">
            All three levels are written together, usually in under half a minute. Written once and kept —
            you will not be asked again unless the article changes.
          </p>
          {run("Write it")}
        </div>
      )}
      {access.kind === "visitor" && access.simple === null && <p className="summ-quiet">{SIMPLE_NONE_VISITOR}</p>}
      {ready && (
        <>
          {/* Stale: the article moved, so a door may open on the wrong room.
              Outdated (an older prompt, same article) is deliberately silent —
              Greg, 2026-09-29, SPIDERYARN-READING2-55. */}
          {owner?.stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                This describes an older version of the article.
              </p>
              {run("Write it again", true)}
            </div>
          ) : null}
          <TooltipGroup delay={{ open: 350, close: 120 }} timeoutMs={500}>
            <div className="simple-paras">
              {/* Keyed on the words: the list is replaced whole on a re-run and
                  never reordered, and two identical paragraphs would be a
                  write-time bug rather than a state to draw. */}
              {paragraphs.map((p) => (
                <Paragraph key={p.text} paragraph={p} onJump={onJump} />
              ))}
            </div>
          </TooltipGroup>
          {showJob && <div className="simple-job">{run("Write it again", true)}</div>}
        </>
      )}
    </div>
  );
}

/** One paragraph, as text, and then its doors. */
function Paragraph({ paragraph, onJump }: { paragraph: SimpleParagraph; onJump(id: BlockId): void }) {
  return (
    <div className="simple-para">
      <p className="simple-text">{paragraph.text}</p>
      <div className="simple-refs">
        {paragraph.ids.map((id) => (
          <BlockRef key={id} id={id} onJump={onJump} />
        ))}
      </div>
    </div>
  );
}

/**
 * **Simple** — Summary's plain-words sub-mode: a few short paragraphs in
 * everyday words saying what the piece is about, why it matters and its key
 * ideas, each followed by the passages it rests on.
 * docs/plans/260930i-simple-summaries-eli15-sub-mode.md,
 * docs/project/summaries.md § Simple.
 *
 * Drawn inside the Summary band, below the Gists | Simple switch
 * (SummaryPanel.tsx), so there is no `ModeSurface` here — this is the body.
 *
 * Three things keep it an orientation rather than a replacement for reading,
 * and the file must go on doing all three:
 *
 * - **every paragraph is a door** — its ids are drawn with the same `BlockRef`
 *   chips the gists use, hover shows the passage, a click goes there;
 * - **it says what it is**, in the foot (`SIMPLE_FOOT`);
 * - **plain text**, never markdown — model output is not HTML (security.md).
 */
import { RotateCw, TriangleAlert, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BlockId, SimpleParagraph } from "../types.js";
import type { PublicSimpleSummary } from "../public-types.js";
import type { UseSimple } from "./useSimple.js";
import { BlockRef } from "./BlockRef.js";
import { JobProgress } from "./JobProgress.js";
import { TooltipGroup } from "./Tooltip.js";
import { useRenderCount } from "./perf.js";

/** The one line under the paragraphs, for owner and visitor alike. */
export const SIMPLE_FOOT =
  "Written by AI in plain words to help you get your bearings. The article says it better, and each paragraph links to where.";

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

export function SimplePanel({ access, onJump }: { access: SimpleAccess; onJump(id: BlockId): void }) {
  useRenderCount("SimplePanel");
  const owner = access.kind === "owner" ? access.owner : null;
  const paragraphs = access.kind === "owner" ? access.owner.simple?.paragraphs : access.simple?.paragraphs;
  /* A visitor's paragraphs arrived with the page, so they are ready by construction. */
  const ready = paragraphs !== undefined && (owner === null || owner.status === "ready");
  const showJob = owner !== null && ready && !owner.stale && (owner.job || owner.starting || owner.failed);

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
            One model pass over the article, about ten seconds. Written once and kept — you will not be
            asked again unless the article changes.
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
          <p className="simple-foot">{SIMPLE_FOOT}</p>
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

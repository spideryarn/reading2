/**
 * **The banner that says an artefact describes an older version of the
 * article, with the × that sends it away** — one component for every mode
 * (docs/project/controls.md § Controls that do the same job look the same).
 * docs/plans/261010a-dismiss-older-version-notices.md (Greg, 2026-10-09,
 * `spya-mutgym`): *"in each case make sure there is a way for me to dismiss
 * them if I don't want to rerun it."*
 *
 * `StaleNotice` takes what `useStaleNotice` returns (useStaleNotices.ts) and
 * draws nothing once the notice is dismissed. `DismissibleNotice` is the
 * markup alone, for a notice whose dismissal is somebody else's — Skim's
 * profile notice (plan 261009i), which is the same banner with its own words
 * and its own store.
 *
 * The markup: the ⚠, the sentence, the × at the end of the sentence's line
 * (`close-x`, so it is every other close cross's size — tests/close-cross.test.ts),
 * a line saying why a failed × did not stick, and the panel's own run button
 * below, as `action`. `className` is the box: `gloss-stale` for most,
 * `quotes-stale`, `srch-stale` or `clm-stale` where a mode has its own.
 *
 * tests/stale-notice-guard.test.ts fails a stale banner drawn anywhere else.
 */
import type { ReactNode } from "react";
import { TriangleAlert, X } from "lucide-react";
import { Tooltip } from "./Tooltip.js";
import type { StaleNoticeState } from "./useStaleNotices.js";

/** The ×'s tooltip and accessible name, on every stale notice. */
export const STALE_NOTICE_TOOLTIP = "Keep this as it is, and stop saying so until it is made again.";
export const STALE_NOTICE_LABEL = "Dismiss this notice";

export function DismissibleNotice({
  className = "gloss-stale",
  children,
  onDismiss,
  tooltip,
  label,
  failed,
  action,
  mode,
}: {
  className?: string;
  /** The sentence. */
  children: ReactNode;
  onDismiss: () => void;
  tooltip: string;
  label: string;
  /** Why the last × did not stick, said inside the banner, which is back by then. */
  failed: string | null;
  /** The panel's run button, or a further line, below the sentence. */
  action?: ReactNode;
  /** For tests and the browser's inspector: which mode's notice this is. */
  mode?: string;
}) {
  return (
    <div className={className} data-stale-notice={mode}>
      <p>
        <TriangleAlert size={13} />
        <span className="notice-words">{children}</span>
        <Tooltip content={<p>{tooltip}</p>} placement="bottom">
          <button type="button" className="notice-close close-x" aria-label={label} onClick={onDismiss}>
            <X aria-hidden="true" />
          </button>
        </Tooltip>
      </p>
      {failed && <p className="notice-failed">Could not hide this: {failed}</p>}
      {action}
    </div>
  );
}

/** The stale banner for one mode, or nothing once it is dismissed or not stale. */
export function StaleNotice({
  notice,
  className,
  children,
  action,
}: {
  notice: StaleNoticeState;
  className?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  if (notice.showing.length === 0) return null;
  return (
    <DismissibleNotice
      {...(className === undefined ? {} : { className })}
      onDismiss={notice.dismiss}
      tooltip={STALE_NOTICE_TOOLTIP}
      label={STALE_NOTICE_LABEL}
      failed={notice.failed}
      action={action}
      mode={notice.mode}
    >
      {children}
    </DismissibleNotice>
  );
}

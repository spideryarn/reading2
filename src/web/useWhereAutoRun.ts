/**
 * **A press that lands on Sources › *Where it sits* asks for what it is
 * missing** — the works the piece cites (Bibliography, for *What it builds on*) and
 * the search of the literature (`situate`), behind one token,
 * `sources-where` (auto-run-targets.ts § `CompositeAutoRunTarget`). Plan
 * docs/plans/261026g-where-it-sits-made-clear-runs-itself-and-reaches-the-margin.md
 * § Stage 4, with GPT Sol's F1 on it: one press, one owner, one automatic try.
 *
 * > when I open that submode, I want it to automatically start running rather
 * > than requiring me to open the submode and then click.
 * >
 * > — Greg, 2026-10-26 (spya-mfuz6g)
 *
 * His cost rule (q-vg2b69, 2026-10-25) puts the ~$0.30 search "upon user
 * request"; the press that opens the sub-mode is taken as that request, and
 * only the press: `useAutoRun` spends a token a control minted, so a pasted
 * link, a reload, Back and Forward, a last-view restore, a margin's *Open in
 * Sources* and a chat's way back start nothing (activation.ts § Why a mount
 * is not a click).
 *
 * Once both reads have answered it asks for whichever is missing, in one job:
 * Bibliography before the search (`precededBy`), so the search can read the
 * works the piece cites. **A stored dossier, stale
 * or outdated included, is never re-run here** — *Search again* is the
 * dossier's own button — and the step's own allowance still applies.
 */
import { type ArtefactStatus, useAutoRun } from "./useAutoRun.js";

/** What this needs of each hook: its read's answer, its unforced run, and a second read after a failed one. */
export interface WhereRunnable {
  status: ArtefactStatus;
  ensure(): Promise<void>;
  retryRead(): Promise<void>;
}
/** The search's own: it can ask for the works cited first, in the same job. */
export interface WhereSearch extends Omit<WhereRunnable, "ensure"> {
  ensure(options?: { withBibliography?: boolean }): Promise<void>;
}

/**
 * **The two reads as one answer**, for `useAutoRun`: wait while either is
 * loading, read again while either failed, and say *none* when either is
 * missing — the one state in which the press is spent on a run.
 */
export function whereStatus(bibliography: ArtefactStatus, situate: ArtefactStatus): ArtefactStatus {
  if (bibliography === "loading" || situate === "loading") return "loading";
  if (bibliography === "error" || situate === "error") return "error";
  if (bibliography === "none" || situate === "none") return "none";
  return "ready";
}

/** Returns whether this mount started a run automatically. */
export function useWhereAutoRun(slug: string, bibliography: WhereRunnable, situate: WhereSearch): boolean {
  return useAutoRun(
    slug,
    "sources-where",
    whereStatus(bibliography.status, situate.status),
    async () => {
      /* One request: the search with the works cited before it when both
         are missing, else whichever one is. */
      if (situate.status === "none") await situate.ensure({ withBibliography: bibliography.status === "none" });
      else if (bibliography.status === "none") await bibliography.ensure();
    },
    async () => {
      if (bibliography.status === "error") await bibliography.retryRead();
      if (situate.status === "error") await situate.retryRead();
    },
  );
}

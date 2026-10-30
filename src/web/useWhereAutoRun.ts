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
 *
 * **The margin's press is the second door to the same search** (since
 * 2026-10-29, plan 261029h): `useMarginLiteratureAutoRun` below, the same
 * request with its own token and its own owner, and the same rule that a
 * search already under way, from either door, is waited on rather than asked
 * for again.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { pendingActivation, subscribeActivations } from "./activation.js";
import type { AutoRunTarget } from "./auto-run-targets.js";
import { jobEngine } from "./jobEngine.js";
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
  /** The job searching for this article, whichever door started it (`useSituate`). */
  job: unknown;
  /** This door's POST is not in the queue yet. */
  starting: boolean;
}

/**
 * **A search already under way is not an answer yet**, at either door. The
 * margin's press and *Where it sits*' are two tokens with two owners, so each
 * has its own automatic try; without this, the margin's
 * `[bibliography, situate]` job publishing the works cited first lets *Where
 * it sits* read Bibliography `ready`, the search still `none`, and post a
 * second job, `[situate]` (GPT Sol's MARGIN-1 on plan 261029h). Held at
 * `loading`, the press waits; when the job lands the dossier reads `ready` and
 * the press is retired unspent. A job that fails leaves `none` again, and a
 * press still waiting may then try.
 */
function searching(situate: WhereSearch): boolean {
  return situate.job !== null || situate.starting;
}

/**
 * **Judge an automatic search against a job list newer than its press.** The
 * margin deliberately subscribes quietly, and even *Where it sits* can be up
 * to eight seconds behind another tab. `situate.job === null` in that snapshot
 * therefore does not yet mean nobody is searching. Both doors wait for a list
 * asked for after their token was minted, then `useStepJob`'s ordinary queue
 * selection answers whether one is active.
 *
 * Register before `poke`: a list already in flight was asked before the press
 * and is followed by another. StrictMode's cleanup removes its first waiter;
 * the second setup asks again and is the one allowed to release the token.
 * `find-more-handoff.ts` uses the same engine seam for the same cross-tab race.
 * Exported for the sources digest's press (useSourcesDigest.ts), the same
 * rule for a third door to a dear run.
 */
const FRESH_QUEUE_CEILING_MS = 10_000;

export function useFreshQueueForActivation(slug: string, target: AutoRunTarget, enabled = true): boolean {
  const read = useCallback(() => pendingActivation(slug, target), [slug, target]);
  const nonce = useSyncExternalStore(subscribeActivations, read, read);
  const activation = nonce === null ? null : `${slug}\u0000${target}\u0000${nonce}`;
  const [freshFor, setFreshFor] = useState<string | null>(null);

  useEffect(() => {
    if (activation === null || !enabled) return;
    /* An engine with no session polls nothing, so no fresh list is coming:
       its snapshot is all there is to judge by. */
    if (jobEngine.reader() === null) {
      setFreshFor(activation);
      return;
    }
    let live = true;
    const stop = jobEngine.afterFreshList(() => {
      if (live) setFreshFor(activation);
    });
    /* An unavailable queue must not hold an invisible margin press for the
       rest of the mount. After the same ceiling Find more gives its hand-off,
       honour the explicit press against the last snapshot; enqueue's durable
       work key remains the final same-request dedupe. */
    const ceiling = setTimeout(() => {
      if (live) setFreshFor(activation);
    }, FRESH_QUEUE_CEILING_MS);
    jobEngine.poke();
    return () => {
      live = false;
      clearTimeout(ceiling);
      stop();
    };
  }, [activation, enabled]);

  return activation === null || !enabled || freshFor === activation;
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
  const freshQueue = useFreshQueueForActivation(slug, "sources-where");
  return useAutoRun(
    slug,
    "sources-where",
    !freshQueue || searching(situate) ? "loading" : whereStatus(bibliography.status, situate.status),
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

/**
 * **The margin's press: the search, and the works cited only as its
 * prelude.** The press that turns the margin on (activation.ts § Marginalia's
 * row, Greg's answer to q-sxfwqq) asks for the search where none is stored.
 * Unlike *Where it sits*, a stored dossier is the whole answer: Bibliography
 * missing beside it buys nothing here, because the margin's press is for the
 * findings. With the search missing, Bibliography's read must have answered
 * — `none` puts it first in the same job, `ready` leaves it out, and `error`
 * is read again rather than guessed at, since a search run without the works
 * cited is stored and not re-run (GPT Sol's MARGIN-2 on plan 261029h).
 */
export function marginLiteratureStatus(bibliography: ArtefactStatus, situate: ArtefactStatus): ArtefactStatus {
  if (situate !== "none") return situate;
  if (bibliography === "loading" || bibliography === "error") return bibliography;
  return "none";
}

/**
 * Returns whether this mount started a run automatically. `enabled` is the
 * margin's notes being on screen: a press on a window too narrow for them is
 * dropped, not kept for a later widening.
 */
export function useMarginLiteratureAutoRun(
  slug: string,
  bibliography: Omit<WhereRunnable, "ensure">,
  situate: WhereSearch,
  enabled: boolean,
): boolean {
  const freshQueue = useFreshQueueForActivation(slug, "margin-literature", enabled);
  return useAutoRun(
    slug,
    "margin-literature",
    !freshQueue || searching(situate) ? "loading" : marginLiteratureStatus(bibliography.status, situate.status),
    () => situate.ensure({ withBibliography: bibliography.status === "none" }),
    async () => {
      if (situate.status === "error") await situate.retryRead();
      else if (bibliography.status === "error") await bibliography.retryRead();
    },
    enabled,
  );
}

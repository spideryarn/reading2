/**
 * **What the Hidden text Opus check answers with** — the shapes, and nothing
 * that can do anything.
 *
 * Declarations only, on the model of
 * [`src/referee-mirror-types.ts`](referee-mirror-types.ts) and for the same
 * reason: the server builds these values
 * ([`src/referee-hidden-check.ts`](referee-hidden-check.ts) — the prompt, the
 * call and the validator), and the browser draws them
 * ([`src/web/SourceScanNotice.tsx`](web/SourceScanNotice.tsx), through
 * [`src/web/useHiddenCheck.ts`](web/useHiddenCheck.ts)). The server module
 * reaches `node:crypto`, the log and the gateway, so nothing under `src/web/`
 * may import it — tests/client-imports.test.ts.
 *
 * **An opinion beside a row, never a filter.** Nothing here is read by the
 * code that orders, groups, counts or marks the scan's findings. Plan
 * docs/plans/261007l-hidden-text-an-opus-check-the-reader-asks-for-over-the-flagged-fragments-only.md
 * § The security property.
 */
import type { CheckedInputs } from "./scan-groups.js";

/**
 * Opus's opinion of one row, as one of two literals. The words a referee reads
 * for each are the app's (`VERDICT_WORDS` in src/web/SourceScanNotice.tsx),
 * never the model's.
 */
export type HiddenVerdict = "probably-harmless" | "worth-a-look";

/** One accepted judgment, bound to the inputs it was made from. */
export interface HiddenJudgment {
  /** What was sent of the row. The panel shows this judgment only beside a row equal to it. */
  row: CheckedInputs;
  verdict: HiddenVerdict;
  /** The model's reason: whitespace collapsed, at most 200 characters, never empty. */
  reason: string;
}

/** A finished check — the `done` frame of `POST /api/referee/hidden-check/:slug`. */
export interface HiddenCheckResult {
  judgments: HiddenJudgment[];
  /** Rows considered (sent, and not sent for the budget) minus rows with an accepted judgment. */
  unanswered: number;
  /** Rows not sent because the input budget was spent. Counted in `unanswered` too. */
  notSent: number;
  /** The model that answered, as the gateway reported it. */
  model: string;
}

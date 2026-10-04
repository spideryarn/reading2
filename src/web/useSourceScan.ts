/**
 * **The deterministic injection scan, fetched beside the Referee band.**
 *
 * Rule 5 of Referee mode is that the scan runs *before the model, not by it*
 * (docs/project/referee-mode.md). This hook is the referee's end of it:
 * `GET /api/referee/scan/:slug`, once per article, on mount.
 *
 * ## Three decisions, and none of them is cosmetic
 *
 * **It is the band's, not a sub-mode's.** A hidden instruction is a fact about
 * the document, and it bears on Criteria, Claims, Mirror and Candidates alike.
 * So `RefereeBand` holds it and every sub-mode is drawn underneath the answer.
 *
 * **It never blocks the band.** The scan takes hundreds of milliseconds on a
 * short paper and about nine seconds on a 1.3 MB one, so the band opens at once
 * and the notice fills in when the answer lands. A referee waiting on a spinner
 * before they can type a criterion would be a worse trade than the one this
 * whole feature is making.
 *
 * **The state is a union, and the `ready` arm holds `SourceScan` itself** —
 * declared once, in src/injection-scan-types.ts, and imported by the server
 * too. `findings` exists only on that type's examined arm, so nothing in this
 * client can reach a count of findings without first saying whether anything was
 * looked at. That is the objection GPT Sol raised against the first version of
 * the scan (docs/plans/260831an-referee-mode-code-review-sol.md, finding 2), and
 * it is answered by the type rather than by a convention.
 *
 * There is no retry and no refetch. The answer is a pure function of bytes that
 * are already stored, so a second request would return the same thing; a failure
 * is a transport failure, and reloading the page is the whole repair.
 *
 * **But the read has an end.** `apiFetch` has no deadline of its own, so until
 * 2026-10-04 a request that never answered left the notice saying it was
 * checking the document for ever. The read now goes through `openingRead`
 * (lib/opening-read.ts) — race, then abort — with its own deadline and its own
 * sentence, `SCAN_TIMED_OUT`, which says what the paragraph above says: reload
 * and it asks again. tests/source-scan-read-has-a-deadline.test.tsx.
 */
import { useEffect, useState } from "react";

import type { SourceScan } from "../injection-scan-types.js";
import { SCAN_TIMED_OUT } from "../messages.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { openingRead } from "./lib/opening-read.js";

/**
 * How long the band waits for the scan before saying it did not finish.
 *
 * Not the saved lists' fifteen seconds (`OPENING_READ_DEADLINE_MS`): a scan is
 * about nine on a 1.3 MB paper, before a cold start, and giving up on an answer
 * that was coming would put a false "did not finish" where a finding should be.
 * A minute is several times the slowest honest answer and still an end.
 */
export const SOURCE_SCAN_DEADLINE_MS = 60_000;

/**
 * What the notice has to draw, as four arms it must all handle.
 *
 * `no-source` is separate from `ready` deliberately. An article that kept no
 * source document was never handed to the scanner at all, so it has no
 * `SourceScan` — and folding it into one would mean inventing a `reason` the
 * scanner cannot produce, which is a state the type would then permit
 * everywhere.
 */
export type SourceScanState =
  | { state: "loading" }
  | { state: "failed"; error: string }
  | { state: "no-source" }
  | { state: "ready"; scan: SourceScan };

export function useSourceScan(slug: string): SourceScanState {
  const [state, setState] = useState<SourceScanState>({ state: "loading" });

  useEffect(() => {
    let live = true;
    setState({ state: "loading" });
    const read = openingRead<{ scan?: SourceScan | null; error?: string }>(
      `/api/referee/scan/${encodeURIComponent(slug)}`,
      { deadlineMs: SOURCE_SCAN_DEADLINE_MS, timedOut: SCAN_TIMED_OUT.message },
    );
    read.body
      .then((body) => {
        if (!live) return;
        if (body.error) {
          setState({ state: "failed", error: body.error });
          return;
        }
        /* `scan` absent and `scan: null` are the same answer — this article kept
           no source document — and both have to be caught here, because a
           `undefined` reaching the notice would narrow to nothing and draw an
           empty box that reads as a clean bill. */
        setState(
          body.scan ? { state: "ready", scan: body.scan } : { state: "no-source" },
        );
      })
      .catch((e: Error) => {
        if (!live) return;
        setState({ state: "failed", error: describeFetchFailure(e) });
      });
    return () => {
      /* `live` first: the abort below rejects the read, and that rejection is
         this effect's own doing rather than a failure to show anybody. */
      live = false;
      read.abandon();
    };
  }, [slug]);

  return state;
}

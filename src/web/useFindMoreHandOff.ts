/**
 * **A band's take of the command bar's *Find more*** — the consumer of
 * find-more-handoff.ts, shared by the two bands that have the button
 * (GlossaryPanel.tsx, QuotesPanel.tsx). Plan 261004k, Stage 2.
 *
 * The bar's row left a press and opened this band. Once the band's read has
 * settled **and a job list asked for after the press has been applied**, the
 * press is **taken — and then made only if a fresh Find more is what the band
 * is offering at that moment** (`offered`: find-more.ts §
 * `glossaryFindMoreOffered`, `quotesFindMoreOffered`). `press` is the function
 * the band's own button calls, so there is one request and it is the button's.
 *
 * ## Not taken on a job list older than the press
 *
 * `offered` says no run is out, and says it from the tab's job list. That
 * list being *loaded* is not enough — it may predate a run another tab has
 * since started — so the press is not `ready` until the list the press itself
 * asked for has landed (find-more-handoff.ts § a job list newer than the
 * press). By then the band has re-rendered on that list, and `offered` is
 * about now. No such list in ten seconds, and the press is nobody's.
 *
 * ## Taken first, whatever the answer
 *
 * The reading view draws the row only while the list can be added to, but a
 * run can start, or fail, or a read land, between the row and the band. If the
 * press were merely *not made* and left waiting, it would fire by itself
 * seconds later when the job finished — a paid run nobody is looking at
 * (GPT Sol's F6 on the plan). So an ineligible band consumes it: the reader is
 * on the band, which shows what it offers instead — the running job, a Retry,
 * *Write a new list* with its sentence, the ceiling's line.
 *
 * ## Not taken while the read is out
 *
 * `settled` is the read having an answer. Until then nobody knows whether
 * there is a list, so the press waits — up to the hand-off's own ten seconds,
 * after which it is nobody's.
 *
 * ## On a timer, and read through a ref
 *
 * `<StrictMode>` runs an effect, its cleanup and the effect again on mount.
 * The first run's timer is cleared by its cleanup, so only the second takes;
 * the take is atomic besides (glossary-ask-handoff.ts met this first).
 * `offered` and `press` are read at the take rather than captured by the
 * effect: both change on every render of the band, and an effect that re-ran
 * with them would be re-armed by a poll.
 *
 * tests/find-more-from-the-command-bar.test.tsx.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { FindMoreMode } from "./find-more.js";
import { readyFindMore, subscribeFindMore, takeFindMore } from "./find-more-handoff.js";

export function useFindMoreHandOff({
  slug,
  mode,
  settled,
  offered,
  press,
}: {
  /** The article the band is the owner's band of, or `null` for a visitor — who is never handed a press. */
  slug: string | null;
  mode: FindMoreMode;
  /** The band's read has an answer: a list, no list, or a failure. */
  settled: boolean;
  /** A fresh Find more is what the band offers now. */
  offered: boolean;
  /** What the band's own Find more button calls. */
  press(): void;
}): void {
  const read = useCallback(() => (slug === null ? null : readyFindMore(slug, mode)), [slug, mode]);
  const nonce = useSyncExternalStore(subscribeFindMore, read, read);
  const now = useRef({ offered, press });
  now.current = { offered, press };
  useEffect(() => {
    if (slug === null || nonce === null || !settled) return;
    const timer = setTimeout(() => {
      if (!takeFindMore(slug, mode, nonce)) return;
      if (now.current.offered) now.current.press();
    }, 0);
    return () => clearTimeout(timer);
  }, [slug, mode, nonce, settled]);
}

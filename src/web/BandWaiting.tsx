import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useSlow } from "./useSlow.js";

/**
 * **A band's wait**: nothing for 600ms, then a 13px `LoaderCircle` and the
 * sentence naming what it waits for. The one loading line, so every mode's
 * wait looks and behaves the same — docs/project/loading-spinner.md, plan
 * 261007h § F1. It began as `ChatListLoading` in ChatPanel.tsx.
 *
 * Mount it only while the caller is waiting; unmount it the moment the wait
 * ends. A wait that ends inside the 600ms then never shows at all.
 *
 * **The container is there from the first paint, empty.** `role="status"`,
 * because the words arrive 600ms after the band does, and a live region that
 * is mounted already filled announces nothing; polite, so the reader is told
 * when they next pause. GPT Sol, 2026-08-27. It carries the caller's class, so
 * the caller's padding holds the line's place across those 600ms and the band
 * does not jump when the sentence lands; `.band-waiting` (mode-band.css) adds
 * the row and one line's height, at no specificity, so a caller's own rule wins.
 *
 * **Only waits.** A sentence that says nothing has been made yet ("Nobody has
 * read the chronology out of this one yet") is the page, not a wait, and is
 * drawn at once without this.
 */
export function BandWaiting({
  children,
  className,
  as: Tag = "p",
  spinnerClassName = "cmt-spinner",
  delayMs,
}: {
  /** The sentence, ellipsis included: what the band is waiting for. */
  children: ReactNode;
  /** The caller's own class for the line's padding and type — `gloss-quiet`, … */
  className?: string;
  /** `div` where the caller's class was written for one (its margins differ). */
  as?: "p" | "div";
  /** Search's spinner is in its own hue (`srch-spin`); everyone else's is the house one. */
  spinnerClassName?: string;
  /**
   * `0` to draw the line at once. Two kinds of caller: /design, to show it
   * without waiting; and a line that answers a press the reader just made
   * (Referee's "Reading the paper…" once a run starts) — the exception
   * loading-spinner.md makes for a chat turn already sent, because a press
   * followed by 600ms of nothing reads as a press that did nothing. A wait
   * for a read leaves it.
   */
  delayMs?: number;
}) {
  const slow = useSlow(true, delayMs);
  return (
    <Tag className={className ? `band-waiting ${className}` : "band-waiting"} role="status">
      {slow && (
        <>
          <LoaderCircle className={spinnerClassName} size={13} aria-hidden="true" />
          <span>{children}</span>
        </>
      )}
    </Tag>
  );
}

/**
 * **What you are reading, at the top, while you scroll back** — Greg,
 * 2026-10-28 (`spya-ga6m76`):
 *
 * > When I scroll in one direction, it shows the bottom bar, like when I'm on
 * > an iPad. That's great. I think it might be useful if it also perhaps showed
 * > a bunch of stuff about the article at the top, like the title and author
 * > and publication date and maybe any other metadata you think would be
 * > useful, how much we read. It could just be useful as a reminder.
 * >
 * > And then when I scroll in the opposite direction, it would disappear just
 * > like the bottom bar does.
 *
 * Two lines: the title, and the masthead's facts line as plain words — who,
 * where, when, how long, and the owner's read-so-far pie. **It is a reminder,
 * not a second masthead**: nothing in it is a link or a button, it is `inert`
 * and `aria-hidden` (the masthead already says all of it to a screen reader),
 * and it reserves no room, so nothing under it moves when it comes or goes.
 *
 * **When it shows is all CSS** (narrow-window.css § a small device): where the
 * bottom bar slides, on `data-scrolled-back` (scroll.ts § `watchBarVisibility`,
 * which a reader's scroll back sets and reading on or any jump of ours clears),
 * and only once the masthead is off screen — `data-masthead-gone`, from the
 * observer below, since at the top the masthead itself is the reminder. Reader
 * mounts it only while no band is open.
 *
 * docs/plans/261029d-a-reminder-bar-at-the-top-and-add-a-selection-to-the-glossary.md
 */
import { type ReactElement, useEffect, useMemo, useState } from "react";
import type { Article } from "../types.js";
import { mastheadFactsAsWords } from "./Masthead.js";
import { READ_BAND_PIE, type ReadBand } from "./read-filter.js";
import { PieGlyph } from "./SharePie.js";
import { articleStats } from "./stats.js";
import { articleTitleVoice, withVoice } from "./voice.js";

export function ReminderBar({ article, readBand }: { article: Article; readBand?: ReadBand | undefined }): ReactElement {
  const stats = useMemo(() => articleStats(article), [article]);
  const facts = useMemo(
    () => mastheadFactsAsWords(article.meta, stats.minutes).ordered,
    [article.meta, stats.minutes],
  );
  const mastheadGone = useMastheadGone();
  return (
    <div className="reminder-bar" aria-hidden="true" inert data-masthead-gone={mastheadGone ? "" : undefined}>
      {/* The title in its own voice, as the masthead draws it (fonts.md). */}
      <p className={withVoice("reminder-title", articleTitleVoice(article.titleOverridden))}>{article.meta.title}</p>
      <p className="reminder-facts">
        <span className="reminder-facts-text">{facts.join(" · ")}</span>
        {readBand !== undefined && readBand !== "none" && (
          <span className="reminder-pie">
            <PieGlyph share={READ_BAND_PIE[readBand]} />
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * **Has the masthead scrolled off the top?** An observer on `.masthead`, which
 * `Reader` renders before this, so it is in the document by this effect. With
 * no observer (jsdom, an old engine) it answers `false` and the bar never
 * shows, which is the safe direction: the masthead is still there to read.
 */
function useMastheadGone(): boolean {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const masthead = document.querySelector(".reader .masthead");
    if (!masthead || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setGone(!last.isIntersecting && last.boundingClientRect.bottom <= 0);
    });
    observer.observe(masthead);
    return () => observer.disconnect();
  }, []);
  return gone;
}

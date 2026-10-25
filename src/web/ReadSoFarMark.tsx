/**
 * **How much of the piece you have read, coarsely, beside the masthead's
 * read time** — Greg, 2026-10-25 (`spya-e5477u`):
 *
 * > At the top of the article, could you somehow give a quick visual
 * > indication of roughly how much of it has been read? […] sort of try and
 * > broadly estimate: have I finished the article? It could be a pie chart or
 * > something like that […] So, yeah, it can be a coarse estimate, basically,
 * > is what I'm saying.
 *
 * `SharePie`, handed the band's whole quarter rather than the exact share
 * (read-filter.ts § `READ_BAND_PIE`). That is the one deliberate exception to
 * the pie's exact-share rule, and it is not a stretched slice: the card and
 * the button's name say the band in words, and the band is what is drawn. A
 * percentage is what Greg asked not to see.
 *
 * Owner only, and only once the reading time has answered: `Reader` passes a
 * band or nothing (§ `readBandFor`). "none" draws nothing, because an empty
 * circle reads as a radio button.
 * docs/plans/261025j-how-much-of-the-article-you-have-read-at-the-top.md.
 */
import type { ReactElement } from "react";
import { READ_BAND_PIE, type ReadBand } from "./read-filter.js";
import { SharePie } from "./SharePie.js";

const BAND_WORDS: Readonly<Record<Exclude<ReadBand, "none">, string>> = {
  started: "started",
  half: "about half",
  most: "most of it",
  finished: "finished",
};

export const READ_SO_FAR_HOW =
  "A rough guide, from how long each passage has been on your screen. You don't need to read every passage for this to say finished. Folded front and back matter, and the notes, don't count.";

export function ReadSoFarMark({ band }: { band: ReadBand | undefined }): ReactElement | null {
  if (band === undefined || band === "none") return null;
  return (
    <SharePie
      className="read-so-far"
      share={READ_BAND_PIE[band]}
      label={`Read so far: ${BAND_WORDS[band]}`}
      detail={READ_SO_FAR_HOW}
    />
  );
}

/**
 * **A face for each voice, on while the reading view is open and the
 * Experimental switch is on.**
 *
 * Sets `data-voices` on `<html>`, which is the only thing
 * `src/web/styles/voices.css` matches on — the author's words in a serif, the
 * model's in IBM Plex Mono, the reader's in Arial. Greg's v1 and its typeface
 * follow-up: docs/plans/261001d-typeface-per-voice.md and
 * docs/plans/261002b-a-nicer-ai-typeface-and-the-voices-trawl.md.
 *
 * **On `<html>` rather than on the reader's own root** because some of what it
 * restyles is not inside that root: tooltips, hover cards and dialogs are
 * portalled to `<body>`.
 *
 * **Called from `Reader`, not from `App`**, because `Reader` already reads the
 * switch and `App` deliberately does not: subscribing there would make every
 * signed-in page ask `GET /api/reader` (App.tsx § nothing here wakes it). The
 * last enabled reading view's cleanup takes the attribute away, so the
 * shelf and `/profile` keep their faces whatever the switch says, without one
 * of two coexisting readers turning it off underneath the other.
 */
import { useEffect } from "react";

export const VOICES_ATTRIBUTE = "data-voices";

/**
 * More than one reading view can be mounted during a transition or by an
 * embedding test. The attribute belongs to all enabled readers together: one
 * reader leaving must not turn the faces off underneath another one.
 */
let enabledReaders = 0;

export function useVoiceFaces(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    enabledReaders += 1;
    root.setAttribute(VOICES_ATTRIBUTE, "");
    return () => {
      enabledReaders -= 1;
      if (enabledReaders === 0) root.removeAttribute(VOICES_ATTRIBUTE);
    };
  }, [on]);
}

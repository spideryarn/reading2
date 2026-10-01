/**
 * **A face for each voice, on while the reading view is open and the
 * Experimental switch is on.**
 *
 * Sets `data-voices` on `<html>`, which is the only thing
 * `src/web/styles/voices.css` matches on — the author's words in a serif, the
 * model's in Courier, the reader's in Arial. Greg's v1, 2026-10-01:
 * docs/plans/261001d-typeface-per-voice.md.
 *
 * **On `<html>` rather than on the reader's own root** because some of what it
 * restyles is not inside that root: tooltips, hover cards and dialogs are
 * portalled to `<body>`.
 *
 * **Called from `Reader`, not from `App`**, because `Reader` already reads the
 * switch and `App` deliberately does not: subscribing there would make every
 * signed-in page ask `GET /api/reader` (App.tsx § nothing here wakes it). The
 * cleanup takes the attribute away when the reading view unmounts, so the
 * shelf and `/profile` keep their faces whatever the switch says.
 */
import { useEffect } from "react";

export const VOICES_ATTRIBUTE = "data-voices";

export function useVoiceFaces(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    root.setAttribute(VOICES_ATTRIBUTE, "");
    return () => root.removeAttribute(VOICES_ATTRIBUTE);
  }, [on]);
}

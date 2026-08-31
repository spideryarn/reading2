/**
 * **The reader's ten middle-band modes, named once, in a module that imports
 * nothing.**
 *
 * This vocabulary was in src/web/params.ts, which is where it is used and where
 * its history is. It moved here on 2026-08-30 because a **second** reader of it
 * appeared on the far side of the client/server line: a shared `/read/<slug>`
 * is served by a serverless function that composes the `<title>`, and that title
 * carries the mode. Nothing that function reaches may import anything under
 * `src/web/` (tests/public-imports.test.ts), so the list had to come out.
 *
 * `params.ts` re-exports all three names, so every existing importer is
 * unchanged and this file is not something a component needs to know about.
 *
 * See src/title-text.ts for the labels these get in a title, and
 * docs/project/reading-view-overview.md for what each mode is.
 */

export const MODES = [
  /* Renamed from `toc` on 2026-08-29, at Greg's request: the reader sees
     "Hierarchy" and the code now says the same word. It also ends a collision
     that had lasted as long as the list — `toc` was simultaneously this mode and
     the *pipeline step* that builds tree.json (src/pipeline.ts § STEP_ORDER), so
     one word meant two things in one repo. The step keeps the name; the mode
     gives it up. docs/plans/defer-arc-and-rename-hierarchy.md § 3. */
  "hierarchy",
  "chat",
  "glossary",
  "search",
  "summary",
  "diagram",
  "ideas",
  /* Review is the seventh, 2026-08-27, and the first mode whose content comes
     from the reader rather than from the article: they say what they took from
     it and the model helps them find where that comes apart. It cost this list
     one word, like the five before it. docs/plans/review-mode.md.

     There is deliberately no `?stance=` beside `?thread=` below. The stance
     governs the next answer and changes nothing on screen, which is the rule
     this file keeps — the closest existing thing is chat's profile checkbox,
     which is component state for the same reason. */
  "review",
  /* The eighth, 2026-08-28: the whole document as one nested list that never
     scrolls and expands around where the reader is. It costs this list one
     word like the six before it, and it is the first mode that is a second
     answer to a question an existing surface already answers — the gist
     columns' context panels — rather than a new question. That is deliberate
     and temporary: Greg asked for it as an eighth mode "for now, so that it
     doesn't mess with what we have, and so that I can go back and forth to
     compare". docs/plans/outline-mode.md § Where it sits, and what happens if
     it wins. */
  "outline",
  /* The tenth, 2026-08-31: the lines worth keeping, in the article's own words.
     It costs this list one word like the eight before it, and it is the first
     mode whose content is *the article itself* — every other one shows the
     reader something a model wrote about the piece, where this one shows the
     piece, chosen. docs/project/quotes.md. */
  "quotes",
] as const;
export type Mode = (typeof MODES)[number];

/**
 * The mode a reader lands in, named once.
 *
 * Two places need it — `modeParam`'s fallback below, and `withMode` in
 * src/web/Dock.tsx, which omits the parameter when it is writing this value. A
 * literal in both would be two copies of one decision, and the copy that drifts
 * is the one that puts a redundant `?mode=` back into every URL.
 */
export const DEFAULT_MODE: Mode = "hierarchy";

/**
 * **Is this string one of the modes?** — the guard the server needs and the
 * client already had inside `modeParam`.
 *
 * An unrecognised value is not an error anywhere: `modeParam` parses it to the
 * default so that a link from a future version, or a pre-2026-08-29 `?mode=toc`
 * link, degrades to the article rather than to an error page. The server does
 * the same with this, which is the point of it being one function — a second
 * spelling of "is this a mode" on the server would be a second answer, and the
 * looser one would be the one nobody read.
 */
export function isMode(value: string | null | undefined): value is Mode {
  return value !== null && value !== undefined && (MODES as readonly string[]).includes(value);
}

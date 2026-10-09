/**
 * **"Which mode when"**: one line per mode saying when to reach for it, and
 * the table that draws them.
 *
 * These stay in TypeScript when the rest of Help's words are Markdown
 * (src/web/help/pages/), because `MODE_WHEN` is a `Record<Mode, …>`: a new
 * mode without a row is a type error, which a Markdown table could not be.
 * The page that shows the table says `{{modes-table}}` where it goes
 * (help-markdown.tsx § The tokens). Until 2026-10-07 both lived in
 * help-modes.tsx.
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md
 * § The Markdown, and how it becomes a page.
 */
import { MODE_CATALOG } from "../../mode-catalog.js";
import { MODES, type Mode } from "../../modes.js";
import { MODE_LABEL } from "../../title-text.js";
import { helpHref, modeAnchor } from "./help-anchors.js";
import { PageLink } from "./help-parts.js";

/**
 * **"Reach for it when…"**, one line per mode, for the table in "Which mode
 * when". Total over `Mode`, so the table can never be missing a mode.
 *
 * Plain strings, not nodes: the text form of the table reads them too
 * (help-markdown.tsx § expandHelpTokens).
 */
export const MODE_WHEN: Record<Mode, string> = {
  plain: "you want the article and nothing else, or a way out of any other mode",
  chat: "you have a question of your own",
  glossary: "the piece uses words in a way you do not quite follow",
  search: "you are looking for a passage, by its words or by what it says",
  referee: "you have been asked to peer-review it",
  summary: "you need to decide whether this is worth reading at all, or want it as a thread to share",
  diagram: "you think better from a picture of the argument",
  ideas: "you want to know what the piece takes for granted, and what it adds",
  learn: "you have finished and want to test what you took from it",
  quotes: "you want the lines worth keeping, in the piece’s own words",
  timeline: "the piece tells a story in time and you have lost track of the order",
  sources: "you want what the piece leans on, with links, or what other people have said about it",
  structure: "you want to see how the piece is built, and where you are in it",
  faq: "you want the questions a careful reader would ask, and where the piece answers them",
  skim: "you want to go round a paper more than once, a little deeper each time",
  marginalia: "you want a few quiet notes beside the text while you read",
};

const CELL = "tw:border-b tw:border-rule tw:py-1.5 tw:align-top tw:text-left";

/**
 * **The "Which mode when" table**, every mode in `MODES` order. Two columns
 * that wrap rather than scroll: on a 390px phone the name column takes only
 * its longest word, and the experimental marker sits under the name rather
 * than beside it so it does not widen that column. A mode's name is a link
 * to its page.
 */
export function ModesTable() {
  return (
    <table className="tw:w-full tw:border-collapse tw:text-sm">
      <thead>
        <tr>
          <th scope="col" className={`${CELL} tw:pr-3 tw:font-semibold tw:text-foreground`}>
            Mode
          </th>
          <th scope="col" className={`${CELL} tw:font-semibold tw:text-foreground`}>
            Reach for it when…
          </th>
        </tr>
      </thead>
      <tbody>
        {MODES.map((m) => (
          <tr key={m}>
            <th scope="row" className={`${CELL} tw:pr-3 tw:font-normal`}>
              <PageLink href={helpHref(modeAnchor(m))}>{MODE_LABEL[m]}</PageLink>
              {MODE_CATALOG[m].experimental && (
                <span className="tw:block tw:text-xs tw:text-ink-faint">experimental</span>
              )}
            </th>
            <td className={`${CELL} tw:break-words`}>{MODE_WHEN[m]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

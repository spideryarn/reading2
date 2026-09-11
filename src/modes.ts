/**
 * **The reader's middle-band modes, named once, in a module that imports
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
  /* **The article and nothing else** — no band, and no gist columns either.
     The twelfth to arrive, 2026-08-31, and the only one that is not numbered
     below, because it is first in the list: it is the default, and it is the way
     *out* of every other mode, which is the job Greg asked it to do:

     > a (default?) mode that's empty, i.e. where the middle columns are closed
     > … that can be the first (and largest?) icon in the bottom-bar, to make it
     > easy for the user to use that to get out of a mode to the text
     >
     > — Greg, 2026-08-31

     It is a mode rather than a `?cols=none` preset for one reason: the dock is a
     radiogroup, and a button in it that is not a mode has no checked state to
     show, so the reader could not see where they were. That is the same trade
     this list already made for `hierarchy`, whose own button is what makes the
     radiogroup honest (src/web/Dock.tsx).

     docs/plans/plain-mode-and-the-way-out.md. */
  "plain",
  /* Renamed from `toc` on 2026-08-29, at Greg's request: the reader sees
     "Hierarchy" and the code now says the same word. It also ends a collision
     that had lasted as long as the list — `toc` was simultaneously this mode and
     the *pipeline step* that builds tree.json (src/step-order.ts § STEP_ORDER), so
     one word meant two things in one repo. The step keeps the name; the mode
     gives it up. docs/plans/260829f-defer-arc-and-rename-hierarchy.md § 3.

     Superseded on 2026-08-31: Greg reversed the second half, and the pipeline
     step is being renamed `toc` → `hierarchy` too, so the UI, the code and the
     database all say one word. The collision is gone rather than resolved in
     the mode's favour. docs/plans/260831ak-rename-the-toc-step-to-hierarchy-everywhere.md. */
  "hierarchy",
  "chat",
  "glossary",
  "search",
  /* The thirteenth, 2026-08-31: the mode for somebody who has been **asked to
     peer-review** the piece — their own criteria run over it, what the piece
     promises against where it delivers, and the model reading their review
     rather than the paper.
     docs/plans/260831an-referee-mode-for-peer-reviewers.md.

     **`referee` and not `reviewer`, because `review` was already in this list**
     further down (since renamed `remember`), and it is a different thing:
     there the reader says what
     they took from a piece they have read for themselves. A `reviewer` mode
     beside a `review` mode is one word meaning two things, which is the exact
     collision `toc`/`hierarchy` above cost this repo a rename to get out of.
     `referee` is also what journals call the person, so the word is the plainer
     one as well as the free one. The plan § The name is `referee`, not
     `reviewer` records that Greg had not seen it: since 2026-09-02 the button's
     word is **one** string, `MODE_LABEL.referee` in src/title-text.ts, if he
     wants "Reviewer" there instead. It was three until then — `MODES_UI` in
     src/web/Dock.tsx and `COSTS` in src/web/visitor.ts each held their own copy,
     and the controls bar in App.tsx said the raw mode id — so a rename here
     would have left the dock, the visitor's sentence or the bar behind.

     It sits **after Search** because it is Search's kind of thing — a pass over
     the piece looking for passages — rather than a restatement of it. Its
     sub-modes are their own vocabulary, in src/web/referee-views.ts. */
  "referee",
  "summary",
  "diagram",
  "ideas",
  /* The seventh, 2026-08-27, and the first mode whose content comes from the
     reader rather than from the article: they say what they took from it and
     the model helps them find where that comes apart. It cost this list one
     word, like the five before it. docs/plans/260827ah-review-mode.md.

     There is deliberately no `?stance=` beside `?thread=` below. The stance
     governs the next answer and changes nothing on screen, which is the rule
     this file keeps — the closest existing thing is chat's profile checkbox,
     which is component state for the same reason.

     Renamed `review` → `remember` on 2026-09-01, at Greg's request, and the
     reason is worth keeping straight because it is *not* the reason he gave.
     He asked for the rename because he wanted the word free for a peer-review
     mode; that mode then arrived as **Referee** rather than Reviewer (see
     above), so the collision he feared never happened. The rename went ahead
     anyway on the weaker but real case: *Review* still reads ambiguously
     sitting beside a tool whose whole subject is peer review; *Remember* names
     what the product is *for* — vision.md's "internalise and interrogate" —
     where *Review* named only the mechanism; and it works as an umbrella over
     the two sub-modes that now live under it, Recall and Quiz.

     The cost, named rather than hidden: *Remember* can suggest saved memories
     or spaced repetition, and this mode does neither. Its description
     (`MODE_CATALOG` in src/mode-catalog.ts, and a `blurb` on a `MODES_UI` row
     in src/web/Dock.tsx until 2026-09-07) carries the weight of correcting
     that, so it has to stay accurate.
     docs/plans/260901d-rename-review-mode-to-remember-mode-everywhere.md. */
  "remember",
  /* **`outline` was the eighth, 2026-08-28 to 2026-09-10, and it is not a mode
     any more** — the whole document as one nested list that never scrolls. It
     became `structure`'s narrow face: where the band is too narrow for
     Structure's two columns, Structure draws Outline's list instead, and the
     word left this vocabulary. `?mode=outline` still works, through
     `RETIRED_MODES` below. Greg, 2026-09-08: "if the page is wide, show the
     current Structure 2-column mode. If it's narrower, show the current Outline
     mode. And get rid of Outline mode altogether."
     docs/plans/260910g-structure-mode-subsumes-outline.md. */
  /* The tenth, 2026-08-31: the lines worth keeping, in the article's own words.
     It costs this list one word like the eight before it, and it is the first
     mode whose content is *the article itself* — every other one shows the
     reader something a model wrote about the piece, where this one shows the
     piece, chosen. docs/project/quotes.md. */
  "quotes",
  /* The eleventh, 2026-08-31: when the piece says these things happened, in the
     order it says they happened, with the article's own hedges kept. It costs
     this list one word like the nine before it.

     In the bar it sits **after Ideas and before Search** — Greg's placement,
     and the bar's order is his rather than this list's, which is only a
     vocabulary. It belongs with Glossary and Ideas as a third "here is one
     dimension of this piece pulled out", and it is further from the article's
     own words than either.

     It is also the first mode whose content is mostly about **how sure the
     article is**: ten of the test article's twenty-six rows carry no date at
     all, and drawing those like the dated ones would throw away the only thing
     the piece actually said. docs/plans/260831i-timeline-mode.md. */
  "timeline",
  /* The fourteenth, 2026-09-05, and the first whose content is **not in the
     article at all**: it goes out to the open web and comes back with what
     other people have written — replies to this piece, and the argument around
     the claims it makes. It costs this list one word like the eleven before it.

     **`debate` and not `critiques` or `reception`**, which is Greg's pick and
     the reason is that both obvious names promise something false on most of
     the shelf: *reception* presumes the piece was noticed, *critiques* presumes
     the response was hostile — so either reads wrong over a corroboration or the
     author's own later correction, two of the most useful rows this mode can
     produce.

     `responses` was the runner-up and was refused on the code, for the reason
     this list has now refused a name twice: `Response`, `respond()`, HTTP
     responses and chat answers are all over `src/`, and one word meaning two
     things is the collision `toc` → `hierarchy` above cost this repo a rename to
     escape.
     docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md. */
  "debate",
  /* The fifteenth, 2026-09-07, and the only one so far that is an *instrument*
     rather than an addition: two linked columns over the same tree Hierarchy
     and Outline already draw — every part on the left, the current part's
     sections on the right — so that the three can be flipped between on one
     article and compared.

     It costs this list one word like the twelve before it, and it is the second
     mode (after `outline`) that is another answer to a question an existing
     surface already answers. That is the point of it rather than a cost of it.

     **It is behind the Experimental Features switch, and the two halves of that
     are one decision.** docs/plans/260903b-one-structure-mode-hierarchy-and-outline-merged.md
     proposed *merging* Hierarchy and Outline into this; asked on 2026-09-06
     which of four things to do, Greg chose to add it as a third and hide it:

     > I don't know if Structure will be better, so let's build it as a third,
     > and that way I can flip back and forth to compare. It'll be in the
     > "Experimental Features" section.

     So an ordinary reader's bar is unchanged, which is what makes a fourteenth
     visible mode not the thing being added here. Whether Structure eventually
     replaces either of the other two is the later decision this one exists to
     inform; the merge is deferred, not rejected.

     **`structure` and not `map` or `contents`**: Map collides with Diagram,
     Contents sounds authored, and Outline already names the flattened
     rendering. GPT Sol's pick, and Greg's decision 9 in 260903b.
     docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md.

     **Superseded on 2026-09-10: the comparison was run and it answered.**
     Greg liked the two columns and not the stacked pair a narrow band got, so
     Structure kept its columns where there is room, took Outline's list where
     there is not, and came out from behind the switch in Outline's place.
     Hierarchy stays. docs/plans/260910g-structure-mode-subsumes-outline.md. */
  "structure",
  /* 2026-09-11: every work the piece cites, each with a link out, ranked the
     way Glossary is — asked for through the Feedback button (SPIDERYARN-READING2-2Y).
     The link is derived by code from the article, never written by the model,
     which is the one safety property; behind the experimental switch and
     owner-only for v1. **`citations` and not `references` or `sources`**:
     the step and the column were already `citations` in stage 1, and
     `references`/`sources` are aliases in `MODE_CATALOG`. The name does share
     a word with chat's web citations (src/web/citations.ts, `Citation` in
     src/types.ts) — which is why the stored type is `CitedWork`.
     docs/plans/260911g-citations-mode.md, docs/project/citations.md. */
  "citations",
] as const;
export type Mode = (typeof MODES)[number];

/**
 * The mode a reader lands in, named once.
 *
 * Two places need it — `modeParam`'s fallback below, and `withMode` in
 * src/web/Dock.tsx, which omits the parameter when it is writing this value. A
 * literal in both would be two copies of one decision, and the copy that drifts
 * is the one that puts a redundant `?mode=` back into every URL.
 *
 * **`plain` since 2026-08-31**, and it was `hierarchy` before that. Greg's call:
 * you land on the article, and reach for a mode when you want one. What it cost
 * is written up in docs/plans/plain-mode-and-the-way-out.md § Plain as the
 * default — chiefly that `?mode=hierarchy` now appears in copied URLs where
 * nothing appeared before, and that the pre-rename `?mode=toc` links which used
 * to survive on the unknown-value rule no longer land where they meant. Greg,
 * asked directly, said not to preserve them: *"we're in alpha and have no users
 * yet"*.
 */
export const DEFAULT_MODE: Mode = "plain";

/**
 * **Is this string one of the modes?** — the guard the server needs and the
 * client already had inside `modeParam`.
 *
 * An unrecognised value is not an error anywhere: `modeParam` parses it to the
 * default so that a link from a future version — or from a past one, naming a
 * mode since renamed — degrades to the article rather than to an error page. The
 * server does the same with this, which is the point of it being one function —
 * a second spelling of "is this a mode" on the server would be a second answer,
 * and the looser one would be the one nobody read.
 *
 * **It is a safety net and no longer a promise about any particular old link.**
 * It used to carry the pre-2026-08-29 `?mode=toc` links, which worked because
 * the default happened to be the view `toc` named; moving the default to `plain`
 * ended that, deliberately (see `DEFAULT_MODE`).
 */
export function isMode(value: string | null | undefined): value is Mode {
  return value !== null && value !== undefined && (MODES as readonly string[]).includes(value);
}

/**
 * **Modes that left the vocabulary, and the one each became.**
 *
 * Unlike the `toc` links `isMode` above no longer promises anything about, these
 * are links real readers have: `?mode=outline` was on every reader's bar for
 * twelve days, and a bookmark or a shared link naming it should open the mode
 * that now holds it rather than degrading to the article.
 */
export const RETIRED_MODES: Readonly<Record<string, Mode>> = {
  outline: "structure",
};

/**
 * **What a `?mode=` value means**: a mode, a retired mode's successor, or null
 * for anything else (the caller supplies the default).
 *
 * The one function both sides call — `modeParam` in src/web/params.ts, which
 * decides the view, and `readMode` in src/read-address.ts, which puts the mode in
 * a shared link's tab title — so `?mode=outline` cannot open Structure while
 * the tab says the article.
 */
export function modeFromParam(value: string | null | undefined): Mode | null {
  if (isMode(value)) return value;
  if (value === null || value === undefined) return null;
  return Object.hasOwn(RETIRED_MODES, value) ? (RETIRED_MODES[value] ?? null) : null;
}

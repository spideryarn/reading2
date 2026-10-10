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
  /* **`hierarchy` was the first mode, and it is not a mode any more** — the
     gist columns beside the prose, one per level of the tree. It was `toc`
     until 2026-08-29, renamed to end a collision with the pipeline step of that
     name. Retired 2026-09-29 — Greg (SPIDERYARN-READING2-4B): "Remove the
     Hierarchy mode altogether. I think the Structure mode is
     better/sufficient." `?mode=hierarchy` opens Structure, through
     `RETIRED_MODES` below. The pipeline step kept the name until 2026-10-02,
     when it became `structure` too (plan 261002b).
     docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md. */
  "chat",
  "glossary",
  "search",
  /* The thirteenth, 2026-08-31: the mode for somebody who has been **asked to
     peer-review** the piece — their own criteria run over it, what the piece
     promises against where it delivers, and the model reading their review
     rather than the paper.
     docs/plans/260831an-referee-mode-for-peer-reviewers.md.

     **`referee` and not `reviewer`, because `review` was already in this list**
     further down (renamed `remember`, and `learn` since 2026-10-06), and it is a different thing:
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

     There was deliberately no `?stance=` beside `?thread=` when Recall had four
     voices: it governed only the next answer, not a shareable screen. Recall has
     had one adaptive voice since 2026-10-02, so the control is gone too.

     Renamed `review` → `remember` on 2026-09-01, at Greg's request, and the
     reason is worth keeping straight because it is *not* the reason he gave.
     He asked for the rename because he wanted the word free for a peer-review
     mode; that mode then arrived as **Referee** rather than Reviewer (see
     above), so the collision he feared never happened. The rename went ahead
     anyway on the weaker but real case: *Review* still reads ambiguously
     sitting beside a tool whose whole subject is peer review; *Remember*
     named what the product was *for* — vision.md's "internalise and
     interrogate" — where *Review* named only the mechanism.

     Renamed for the reader to **Learn** on 2026-10-05, and the identifier
     followed on 2026-10-06 (`remember` until then; `?mode=remember` still
     opens it, through `RETIRED_MODES` below). It is the umbrella over Recall, Tutorial, Explore and
     Quiz. The catalogue description now distinguishes that whole from a
     course or flashcards. The rename plans hold the reasons and costs:
     docs/plans/260901d-rename-review-mode-to-remember-mode-everywhere.md,
     docs/plans/261005l-remember-becomes-learn-and-explore-covers-critiques.md and
     docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md. */
  "learn",
  /* **`outline` was the eighth, 2026-08-28 to 2026-09-10, and it is not a mode
     any more** — the whole document as one nested list that never scrolled (it may
     since 2026-10-03, plan 261003k). It
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
  /* **`debate` was the fourteenth, 2026-09-05 to 2026-10-09**, and it is not a
     mode any more: what the web says about the piece is Sources'
     Reception and Claims now (`?mode=debate` still opens it, through
     `RETIRED_MODES` below). Why it was called `debate` rather than
     `reception` or `critiques` is in the plan that made it,
     docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md; the
     step, the column and the routes keep the word until the deep rename
     (docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md § Stage 3). */
  /* **Sources, 2026-10-09** — what this piece cites, and what others say
     about it: three sub-modes (`?sources=`), Bibliography (the Citations
     mode until that day), Reception and Claims (the Debate mode's two). Out
     of the experimental switch on the day it was made. Greg (spya-vcvxu5):
     "let's move this out of experimental, this combined mode … Maybe peer
     review, because that, I think, incorporates the idea that it's both
     internal and external to the article".

     **Called Peer review (`peer-review`) until later that day**, when the
     clash with Referee, the mode for somebody *doing* a peer review, was
     put to Greg (docs/user-feedback/questions/q-xf2xvb.md): "B Sources.
     Rename comprehensively, eg including docs, code, database etc" (reply
     spya-egmn6r). `?mode=peer-review` still opens it, through
     `RETIRED_MODES` below.
     docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md,
     docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md,
     docs/project/sources.md. */
  "sources",
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
     Hierarchy stayed, until 2026-09-29. docs/plans/260910g-structure-mode-subsumes-outline.md. */
  "structure",
  /* **`citations` was here from 2026-09-11 to 2026-10-09** — every work the
     piece cites, each with a link out. It is Sources' Bibliography now,
     and `?mode=citations` opens it there, through `RETIRED_MODES` below. The
     step and the column keep the word (stored as `CitedWork`, because chat's
     web citations share it). docs/plans/260911g-citations-mode.md,
     docs/project/bibliography.md. */
  /* 2026-09-16: the questions a careful reader would put to this piece while
     reading it, each answered by passages of the piece itself — never a
     written answer. Asked for through the Feedback button (SPIDERYARN-READING2-3A);
     behind the experimental switch. Its stored output is public, while making
     it remains owner-only. Not Quiz, where the article asks the reader; not
     Ideas, which are propositions nobody asks.
     docs/plans/260916d-faq-mode.md, docs/project/faq.md. */
  "faq",
  /* 2026-09-28: a route through the article's own Quotes, walked at three
     depths — a handful of stops, then a dozen, then most of them — in an order a
     model chose for this reader rather than the paper's. The stops are the
     quotes; the mode adds only an order, a depth and a short role line. Behind
     the experimental switch. Its stored output is public, while planning it
     remains owner-only.
     docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md,
     docs/project/skim.md. */
  "skim",
  /* `tweets` stood here from 2026-09-29 to 2026-10-03 — the article as a
     numbered thread. It is Summary's Thread view now (`?summary=thread`), and
     the word is in `RETIRED_MODES` below.
     docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md. */
  /* **Marginalia, 2026-10-01** (called Annotations until later that day) — the
     first mode drawn to the RIGHT of the prose: notes level with the blocks
     they belong to, scrolling with the page, and no left band at all. Greg
     (SPIDERYARN-READING2-7K): "left-hand-column (if displayed) would be stuff
     that's unanchored to the text, middle column for the text itself, and
     right-hand-column (if displayed) for annotations anchored to the blocks".
     Behind the experimental switch.
     docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md;
     the rename is
     docs/plans/261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md. */
  "marginalia",
] as const;
export type Mode = (typeof MODES)[number];

/**
 * **A mode that owns the left band** — every mode but Marginalia, which since
 * 2026-10-01 is a switch of its own (`?margin=1`) rather than a value of
 * `?mode=`, so its column can sit beside a band.
 * docs/plans/261001i-annotations-column-beside-a-band-mode.md.
 *
 * `marginalia` stays in `MODES` because the catalog, the Dock's button, the
 * command bar and the experimental switch are keyed on it; what it may not be
 * is the *state* — `?mode=` parses to this type, so a press on Marginalia
 * cannot be written into it without the compiler asking which you meant.
 */
export type BandMode = Exclude<Mode, "marginalia">;

/** Whether a mode is one that owns the band — the narrowing for `BandMode`. */
export function isBandMode(mode: Mode): mode is BandMode {
  return mode !== "marginalia";
}

/**
 * **Whether a `?mode=` value asks for Marginalia's column** — `marginalia`, or
 * `annotations`, the mode's word until 2026-10-01, which old links and
 * remembered last views still carry. Either one means `?margin=1`, never a band.
 *
 * Named exactly, not "any mode that is not a band", so that a future second
 * non-band control cannot silently turn into the margin. The four places that
 * translate the word — `marginInSearch` (src/web/params.ts), the Reader's
 * arrival rewrite, the Dock's link builder and `rememberableSearch`
 * (src/web/last-view.ts) — all ask this, so the two spellings cannot drift.
 * Not `RETIRED_MODES`, which maps only to band modes: docs/project/mode.md §
 * Retiring a mode;
 * docs/plans/261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md.
 */
export function isMarginaliaModeWord(value: string | null | undefined): boolean {
  return value === "marginalia" || value === "annotations";
}

/** Every value `?mode=` can hold — `MODES` less Marginalia. */
export const BAND_MODES: readonly BandMode[] = MODES.filter(isBandMode);

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
export const DEFAULT_MODE: BandMode = "plain";

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
export const RETIRED_MODES: Readonly<Record<string, BandMode>> = {
  outline: "structure",
  /* The gist columns, retired 2026-09-29; Structure draws the same tree.
     docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md. */
  hierarchy: "structure",
  /* `trajectory` was the mode's name until 2026-10-01, when it became Skim
     (docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md). */
  trajectory: "skim",
  /* The thread, a mode of its own from 2026-09-29 to 2026-10-03, is Summary's
     Thread view. **This row alone opens Summary at Brief**: the word has to
     become `?mode=summary&summary=thread`, which is `liftLegacyTweets` in
     src/web/router.ts, on boot, on a client navigation and on Back. This row
     is what the frame before that rewrite, the tab title and a feedback
     report's mode read.
     docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md. */
  tweets: "summary",
  /* `remember` was this mode's id until 2026-10-06, a day after the reader's
     word for it became Learn. The one alias that rename kept: `?remember=<view>`
     and `?chatfrom=remember` were let go. A conversation mode, so
     src/web/last-view.ts § `NEEDS_AN_EXPLICIT_PRESS` asks about the mode this
     word means rather than the word.
     docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md. */
  remember: "learn",
  /* Citations and Debate, two modes until 2026-10-09, are Sources' three
     sub-modes. **These rows alone open Sources at Bibliography**: Debate's
     word has to become `?mode=sources&sources=reception` (or
     `claims`), which is `liftLegacySources` in src/web/router.ts,
     on boot, on a client navigation, on Back and on a restored last view, as
     `tweets` is lifted. These rows are what the frame before that rewrite, the
     tab title, `/help/mode-citations` and a feedback report's mode read.
     docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md. */
  citations: "sources",
  debate: "sources",
  /* **Sources was called Peer review until 2026-10-09** (`?mode=peer-review`,
     `?peer-review=<sub-mode>`), renamed for its clash with Referee. Its
     sub-mode word is lifted with it by `liftLegacySources`, for the reason
     above. docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md. */
  "peer-review": "sources",
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
export function modeFromParam(value: string | null | undefined): BandMode | null {
  /* `marginalia` is not a band (`BandMode`): a `?mode=marginalia` link — or an
     old `?mode=annotations` one, which is not a mode word at all any more —
     names Plain here, and the client turns the notes on for it
     (`isMarginaliaModeWord`, read by `marginInSearch` in src/web/params.ts). */
  if (isMode(value)) return isBandMode(value) ? value : null;
  if (value === null || value === undefined) return null;
  return Object.hasOwn(RETIRED_MODES, value) ? (RETIRED_MODES[value] ?? null) : null;
}

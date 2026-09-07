/**
 * The summary panel — a **mode**, in the band between the spine and the prose.
 *
 * Greg, 2026-08-26:
 *
 * > Add functionality for hierarchical Summary, taking inspiration from
 * > docs/project/original-version/ … When active, it should replace the middle
 * > sections of the UI (i.e. right of the spine, left of the doc).
 *
 * and, when asked which of the two things the previous version left behind was
 * meant — a nested outline of what we already have, or their length ladder:
 *
 * > Follow the approach the old-version took.
 *
 * Their approach was a **named length ladder**, and it was built here and then
 * taken out again on 2026-08-31. Greg: *"I think we can get rid of the Length
 * functionality. I think for now just keeping 'Gist' only is sufficient."*
 * What is left is the half that was never paid for — the **tree**, with the
 * one-sentence gist stage 4 already writes onto every internal node — and one
 * control, Depth, which is how many of those rows you want. See
 * docs/plans/260831s-gist-only-summaries.md for what went and why.
 *
 * ```
 *  ┌── spine ──┬────── SUMMARY (this panel) ──────┬──── the article ────┐
 *  │           │  SUMMARY                         │                     │
 *  │  ▇▇▇▇▇▇▇  │  Depth   article · parts · secs  │  Being You opens    │
 *  │  ▇▇▇▇     │ ──────────────────────────────── │  with a story about │
 *  │  ▇▇▇      │  Consciousness is what it is     │  waking from        │
 *  │  ▇▇▇▇▇▇   │  like to be a living body.       │  anaesthesia…       │
 *  │  ▇▇       │                                  │                     │
 *  │  ▇▇▇▇     │  ▾ 1  What feeling is for   18¶  │  Every paragraph    │
 *  │  ▇▇▇      │      Perception is a controlled  │  stays exactly      │
 *  │  ▇▇▇▇▇    │      hallucination, not a…      │  where it was.      │
 *  │  ▇▇       │    ▸ 1.1 The body as a model  6¶ │                     │
 *  │           │  ▸ 2  The hard problem      +4  │  Clicking a title   │
 *  │           │                                  │  scrolls it here.   │
 *  └───────────┴──────────────────────────────────┴─────────────────────┘
 * ```
 *
 * ## Three ways to be hidden, and they are not the same variable
 *
 * The one design note worth copying verbatim from their structure panel:
 * *"too deep to show" and "I closed this" are different states and should not
 * share a variable.* So `deep` is a cut-off that removes a whole level, `closed`
 * is a set the reader put nodes into, and they compose. A node hidden by the
 * cut-off does not un-close itself when the cut-off moves.
 *
 * There is a third, added 2026-08-27, and it is the same note applied once
 * more. Greg:
 *
 * > when it has collapsed more granular levels, the only way to see the more
 * > granular levels is to switch articles -> parts -> sections. Could we make
 * > it easier to see them for this part of the doc (e.g. click `+N sections`
 * > to expand those, and click the parent again to collapse)?
 *
 * So `opened` is the set the reader opened *past* the cut-off, by pressing the
 * `+N sections` badge on a node the cut-off was hiding. It is a per-node
 * override and it leaves the Depth buttons exactly where they are — which was
 * the objection to letting that badge be pressed at all, and the objection is
 * answered by making the override its own variable rather than by moving the
 * cut-off. The one rule all three feed is `showsChildren` in tree.ts, which is
 * where they are written down once for both the panel and the follow.
 *
 * The root was the one row where that badge stayed a dead fact, because it
 * draws no title row and so has no twist to undo an override with. Greg,
 * 2026-08-31: *"in Article sub-mode, I can't click on `+N parts` to expand"*.
 * So the root's badge is a control too, and it is its own twist — it flips to
 * `−N parts` once the parts are open. That collapse clears the override and
 * never writes the root into `closed`, which would otherwise outlive the Depth
 * buttons and leave `parts` drawing an empty outline; see `clearOverride`.
 *
 * ## Nothing here is generated on demand
 *
 * Every line of prose in this panel is a **gist**, written by stage 4 as part
 * of building the tree (src/hierarchy.ts). So this panel costs nothing, is never
 * empty on an article that has a tree, and has no run button, no job, no
 * staleness and no reader-profile provenance — the three things a panel that
 * spends has to carry, and the reason `GlossaryPanel` and `IdeasPanel` are
 * three times the size of this one.
 */
import { type MouseEvent, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { BlockId } from "../types.js";
import { BlockRange } from "./BlockRef.js";
import { ModeSurface } from "./ModeSurface.js";
import { TooltipGroup } from "./Tooltip.js";
import { MAX_SUMMARY_DEPTH } from "./params.js";
import { FOLLOW_ATTR, useFollow } from "./follow.js";
import { currentEntryId, showsChildren, type SummaryNode } from "./tree.js";
import { useRenderCount } from "./perf.js";

interface Props {
  /** The tree, nested and numbered. Null if the tree is unusable. */
  root: SummaryNode | null;
  deep: number;
  onDeep(deep: number): void;
  /** Where the reader is, as a row index into `blocks`. Null above the first section. */
  atRow: number | null;
  /** Jump the article to a block, exactly as a gist cell does. */
  onJump(id: BlockId): void;
}

const DEPTH_LABELS = ["article", "parts", "sections"];

export function SummaryPanel({ root, deep, onDeep, atRow, onJump }: Props) {
  useRenderCount("SummaryPanel");
  /**
   * Which sections the reader has closed.
   *
   * In memory rather than in the URL, and params.ts § summary mode carries the
   * argument: the only way to write this down is a list of node ids, node ids
   * are positional, and a re-run of `npm run hierarchy` renumbers them — so a shared
   * link would open a set of sections that are no longer the ones you opened.
   * The depth is the stable half, and the depth is what the URL carries.
   */
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * And which the reader has opened past the depth cut-off — see the header.
   *
   * Kept apart from `closed` rather than folded into one tri-state map because
   * they answer different questions and the cut-off moves underneath both: a
   * node can be shut at `sections` and, at `parts`, be shut *and* below the
   * cut-off, and only two sets can say which of those the reader chose.
   */
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * Flip one node's children, from what is on screen rather than from which
   * variable is holding them there.
   *
   * `showing` is what `Entry` has drawn and `beyond` is whether the cut-off
   * alone would hide these children. Deriving the new state from the first
   * rather than from the sets is what keeps the twist and the `+N` badge
   * honest when both a close and an override are set: a reader who opens a
   * part past the cut-off, raises Depth, closes it there and drops Depth back
   * would otherwise find the badge doing nothing at all.
   *
   * Collapsing always clears the override, so the two sets never both hold the
   * same id and `closed` never has to be checked against `opened` — the
   * precedence in `showsChildren` is a belt on top of that.
   */
  const toggle = (id: string, showing: boolean, beyond: boolean) => {
    setClosed((prev) => (showing ? withId(prev, id) : withoutId(prev, id)));
    setOpened((prev) => (showing ? withoutId(prev, id) : beyond ? withId(prev, id) : prev));
  };

  /**
   * Take an override off again, and **do not write the node into `closed`** —
   * the root's collapse, and the reason it is not simply `toggle`.
   *
   * Everywhere else a collapse means "shut this, and keep it shut when the
   * cut-off moves", which is what `closed` is for. On the root that sentence is
   * a trap: `closed` beats the cut-off, so a shut root would still be shut at
   * `parts`, and the Depth button that says `parts` would draw an empty
   * outline. The root is offered a collapse only while the override is the one
   * thing holding its children open, so clearing the override is the whole of
   * it.
   */
  const clearOverride = (id: string) => setOpened((prev) => withoutId(prev, id));

  /**
   * The one row the reader is actually on, and the row the panel follows.
   *
   * Computed here rather than decided by each `Entry`, because two things need
   * the same answer — the class that marks it and the scroll that finds it —
   * and a rule written twice is a rule that will disagree with itself. It lives
   * in tree.ts beside the shape it walks; see the note there on why "deepest"
   * means *deepest drawn* and not simply deepest.
   */
  const current = root ? currentEntryId(root, atRow, deep, closed, opened) : null;

  /* Follow the reader, without taking the scroll off them: the panel moves when
     `current` changes and the row is not already comfortably visible, and never
     otherwise. The four extras are re-run triggers rather than reasons to move —
     each reflows the list without necessarily changing which row is current, and
     a re-run with the row in view moves nothing. `root` is the one that is easy
     to leave out and was: it changes when the article's tree is rebuilt, which
     reflows every row below and can push the current one off the bottom without
     any id changing. follow.ts has the argument. */
  const scroll = useRef<HTMLDivElement>(null);
  useFollow(scroll, current, [deep, closed, opened, root]);

  return (
    <ModeSurface label="Summary" feature="summ">
      {/* **No `head`, so there is no title row at all.** It said the mode's own
          name, which the Dock at the foot of the page is already saying — Greg,
          2026-09-05: *"I think we can rely on the bottom bar to tell us what
          mode we're in, so for example 'Summary' mode doesn't need to say
          `Summary` at the top, nor o any other modes."* Nothing else was in the
          row, so the row went with it and the band starts at its content. The
          surface's `label` above is what names the region, and always was — the
          `<h2>` was never carrying that.
          docs/plans/260905d-declutter-the-reading-view-top-bars.md § Stage 5. */}

      <div className="summ-controls">
        {/* Their structure panel's one control, and the one thing it proved:
            a single depth cut-off over a whole document is usable. */}
        <fieldset className="summ-row">
          <legend className="summ-label">Depth</legend>
          {DEPTH_LABELS.map((label, d) => (
            <button
              key={label}
              type="button"
              className={`summ-pill${d === deep ? " on" : ""}`}
              aria-pressed={d === deep}
              disabled={d > MAX_SUMMARY_DEPTH}
              title={
                d === 0
                  ? "The whole article, and nothing under it"
                  : `Down to the ${label}`
              }
              onClick={() => onDeep(d)}
            >
              {label}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="summ-scroll" ref={scroll}>
        {/* **Nothing to outline, which is not the same as nothing to read.**
            `tree-invariants.ts` permits a root that is a leaf — one block, and
            no gist, because a summary must never stand where the real prose
            could — so a one-passage article arrives here with a perfectly good
            tree and nothing this panel can draw from it. The same holds for a
            provisional heading tree whose gists were never written.

            Without this the reader got the heading, the Depth pills and a blank
            band: no title row on the root, no range, no missing-summary line
            and no `+N` badge, because there are no children to have one. GPT
            Sol's review of the built code, 2026-08-31. It matters more since
            the mode stopped being gated — a visitor used to be told nobody had
            built a summary, and now opens the band unconditionally
            (src/web/visitor.ts).

            A separate sentence from the one below, and deliberately: *no usable
            tree* reports a fault, and this tree is fine. */}
        {root && !root.gist && root.children.length === 0 ? (
          <p className="summ-quiet">This article has no parts, so there is nothing to outline.</p>
        ) : root ? (
          /* One group for the whole outline, so running the pointer down a
             column of block ids shows each card immediately rather than
             waiting out the open delay again at every one. Chat's answers do
             the same — Tooltip.tsx. */
          <TooltipGroup delay={{ open: 350, close: 120 }} timeoutMs={500}>
            <ol className="summ-list">
              <Entry
                entry={root}
                deep={deep}
                closed={closed}
                opened={opened}
                onToggle={toggle}
                atRow={atRow}
                current={current}
                onJump={onJump}
                onClearOverride={clearOverride}
                root
              />
            </ol>
          </TooltipGroup>
        ) : (
          <p className="summ-quiet">This article has no usable tree to summarise.</p>
        )}
      </div>
    </ModeSurface>
  );
}

/**
 * One node and, unless it is closed or too deep, the ones under it.
 *
 * The root renders without a title row — it *is* the article, and the masthead
 * two inches to the right already says its name. What it contributes is the
 * article's own gist, which is the one summary the previous version actually
 * shipped.
 *
 * ## The whole entry is the click target
 *
 * Greg, 2026-08-26: *"make it easier to click a section in the summary (right
 * now you have to click the section-title)"*. He is right, and the title was a
 * bad target for a reason worth writing down: it is one line of 0.82rem text
 * whose width is whatever the heading happens to be, so a two-word section is a
 * two-centimetre target inside a panel four times that wide. Everything else in
 * the row — the number, the paragraph count, the summary itself, the whitespace
 * — looked exactly as pressable and did nothing.
 *
 * So the click lives on `.summ-body`, which is the header, the summary and the
 * range together, and it does what the gist cells in TableView already do with
 * a whole `<td>`. Two things keep that honest:
 *
 *  - **The keyboard target is still a real button.** The title is unchanged;
 *    tab still reaches it and Enter still jumps. The div adds mouse area, not a
 *    second way to operate the panel, which is why its `biome-ignore` below is
 *    a statement rather than a shrug.
 *  - **Anything that is itself pressable wins.** The handler bows out when the
 *    click landed on a button or a link, so the twist opens a section without
 *    also scrolling the article, and a block id goes to its own paragraph
 *    rather than to the top of the section it is in.
 */
function Entry({
  entry,
  deep,
  closed,
  opened,
  onToggle,
  atRow,
  current,
  onJump,
  onClearOverride,
  root = false,
}: {
  entry: SummaryNode;
  deep: number;
  closed: ReadonlySet<string>;
  opened: ReadonlySet<string>;
  onToggle(id: string, showing: boolean, beyond: boolean): void;
  atRow: number | null;
  /** The one entry the reader is on — see SummaryPanel § current. */
  current: string | null;
  onJump(id: BlockId): void;
  /**
   * Undo this node's `+N` override. Passed to the root and to nothing else:
   * every other row collapses from its twist, and the root has none.
   */
  onClearOverride?(id: string): void;
  root?: boolean;
}) {
  /* The three ways to be hidden, kept apart on purpose — see the file header.
     `beyond` is the cut-off, `closed` is the reader shutting it, `opened` is
     the reader opening it past the cut-off. None of them changes another, and
     `showsChildren` in tree.ts is the one place they are combined, because the
     follow has to reach the same answer and a rule written twice will
     eventually disagree with itself. */
  const beyond = entry.node.depth >= deep;
  const openable = entry.children.length > 0;
  const showChildren = showsChildren(entry, deep, closed, opened);
  const hidden = openable && !showChildren ? entry.children.length : 0;

  /* The `+N` badge hands the keyboard to the twist as it unmounts — see its
     `onClick`. Two refs rather than a query, because a selector would have to
     know this row apart from its children's rows. */
  const twistRef = useRef<HTMLButtonElement>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);

  /* Where the reader is. An ancestor of the current section counts as "here"
     too, because at depth 1 the part you are inside is the honest answer to
     "where am I" — marking only the deepest visible node would leave the panel
     with nothing lit whenever the cut-off is above it.

     Except the root, which covers the whole article and is therefore "here"
     the entire time the reader is anywhere. Marking it would put a permanent
     highlight down the left of the whole outline, which is a light that is
     always on and so tells you nothing. */
  const here = !root && atRow !== null && atRow >= entry.startRow && atRow <= entry.endRow;

  /* And the one row of that chain the reader is *in*, rather than merely under.
     Two marks rather than one because they answer different questions: `here`
     draws the path down to the reader, which is what makes a shallow cut-off
     honest, and `now` says which single row the summary beside the reading line
     belongs to. One mark strong enough to find at a glance, on four nested
     rows, is four marks and no answer. */
  const now = entry.node.id === current;

  /** A click anywhere in the entry that nothing else has already claimed. */
  const jumpFromBody = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, a")) return;
    onJump(entry.node.range[0]);
  };

  return (
    <li
      className={`summ-entry d${entry.node.depth}${here ? " here" : ""}${now ? " now" : ""}${
        entry.supplement ? " supplement" : ""
      }`}
    >
      {/* Both of these are the same statement, and it is the one in the header:
          the keyboard path is the real `.summ-title` button inside this div,
          which is unchanged and still focusable. This handler only widens the
          MOUSE target to the whole entry — it adds no way to operate the panel
          that was not already there. A `role="button"` would be worse than
          nothing: it would claim to be one control while containing three, and
          it would take the twist out of the tab order.
          biome-ignore lint/a11y/useKeyWithClickEvents: as above
          biome-ignore lint/a11y/noStaticElementInteractions: as above */}
      <div
        className="summ-body"
        onClick={jumpFromBody}
        /* How the panel's scroller finds this row, and **it is on the body
           rather than on the `<li>` above**. That is not a detail: an open
           `<li>` contains its whole descendant `<ol>`, so its rectangle is the
           height of the entire subtree — and "is the current row in view"
           measured against that is a question about the section's children.
           A part whose own two lines are sitting in the middle of the panel
           would read as out of view because a dozen sections under it run off
           the bottom, and the panel would scroll for no reason the reader
           could see. Caught by GPT Sol's review, 2026-08-26.

           An attribute rather than the `now` class, so that restyling the mark
           cannot quietly break the scrolling — follow.ts § FOLLOW_ATTR. */
        {...{ [FOLLOW_ATTR]: entry.node.id }}
      >
        {!root && (
          <div className="summ-title-row">
            {/* Enabled whenever there is anything under this, including when
                the Depth cut-off is what is hiding it — that is the whole of
                Greg's "click the parent again to collapse", and its opposite:
                the twist is now the way to open one part's sections without
                moving Depth for the whole article. */}
            <button
              type="button"
              ref={twistRef}
              className={`summ-twist${openable ? "" : " leaf"}${showChildren ? " open" : ""}`}
              aria-expanded={openable ? showChildren : undefined}
              aria-label={showChildren ? `Close ${entry.node.title}` : `Open ${entry.node.title}`}
              disabled={!openable}
              onClick={() => onToggle(entry.node.id, showChildren, beyond)}
            >
              <ChevronRight size={12} />
            </button>
            <button
              type="button"
              className="summ-title"
              title="Go to this section in the article"
              onClick={() => onJump(entry.node.range[0])}
            >
              {/* The apparatus wears no number: it is not part N of the
                  argument, and numbering it was how "Notes" became part 3.
                  src/web/tree.ts § buildSummaryTree. */}
              {!entry.supplement && <span className="summ-number">{entry.number}</span>}
              {entry.node.title}
            </button>
            {/* "How much is under this" — the gap their "+N hidden" badge filled
                and our gist columns still cannot: a section holding forty
                paragraphs and one holding three look identical in an L2 cell.
                See docs/project/original-version/structure-panel.md. */}
            <span className="summ-size" title={`${entry.blocks} paragraphs in this section`}>
              {cap(entry.blocks)}¶
            </span>
          </div>
        )}

        {/* **The question INSTEAD of the claim, where there is one.**
            SPIDERYARN-READING2-24, Greg 2026-09-05, having read the first
            version on a real article: *"I quite like some of these new Socratic
            questions in the summary mode, but the intent wasn't that we would
            show both the gist and the Socratic question, the intent was that we
            would show only the Socratic question when we have one."*

            That reverses what the block below this one used to argue, and the
            argument is left standing further down rather than deleted, because
            it was right about the questions it was written for. A question that
            merely restated the gist could not carry a row alone; one that names
            its topic, presupposes where the section lands and says how big the
            answer is can. Which of those we generate is the prompt's business
            (src/hierarchy.ts § QUESTIONS), and it is being chosen by
            evals/summaries — the render is the same either way.

            **A fallback, not a fault.** `question ?? gist` is the whole rule:
            every article whose hierarchy predates 2026-09-05 has no question,
            and there is nothing wrong with those rows. Only a row with neither
            says so. */}
        {entry.question ? (
          <p className="summ-question">{entry.question}</p>
        ) : entry.gist ? (
          <p className="summ-text">{entry.gist}</p>
        ) : (
          /* **Nor is the apparatus missing a summary.** A supplement node has
             no gist on purpose — the notes are shown as written and never
             summarised (src/supplement.ts) — so "No summary for this section"
             reports our own promise as a fault, on the one row where it is
             working correctly. */
          !root && !entry.supplement && (
            <p className="summ-text missing">No summary for this section.</p>
          )
        )}

        {/* **This is where the question used to draw a SECOND time**, under the
            gist, from 1V that morning until 24 that evening. The argument for
            that is worth keeping, because it was not wrong — it was scoped:

            > *"A bit more"* is the whole brief, and it is why this is a second
            > line rather than a rewritten gist. A panel of nothing but questions
            > fails the first thing vision.md asks of this feature — *scan before
            > you commit* — because a reader deciding whether to descend needs to
            > know what the section says.

            True of a question that restates its gist, which is what the first
            prompt asked for in as many words (*"the question this node's text
            answers and its gist does NOT"*), so the only honest output was a
            bare why. It stops being true once the question carries its topic and
            its direction. **The render did not need to be clever about which
            kind it has**; the prompt decides, and the fallback above covers the
            rest.

            **Root and parts only** is still enforced in `questionFor` rather
            than merely asked for: one question per section on a fifty-section
            article is noise, and at the default `deep=1` these are the only rows
            drawn anyway. Note what that means now the question is the primary
            line — a depth-1 node built by the deepening cascade has no question
            at all, because `EXPAND_SYSTEM` has no such field, so it falls back
            to its gist and the panel can mix the two forms at one depth. That
            was invisible while the question was a faint second line.
            docs/plans/260905f § P1-5. */}

        {/* Where this section starts and ends, as two ids you can press.
            The same pair a gist cell carries in TableView, and here for the
            same two reasons: it is the address of the section, and it is the
            one place ids appear at the `gist` rung — which is the default, and
            the rung on every article nobody has paid a model call for. */}
        {!root && <BlockRange className="summ-range" range={entry.node.range} onJump={onJump} />}
      </div>

      {hidden > 0 && (
        <button
          type="button"
          className="summ-more"
          /* A control since 2026-08-27, and on every row — the root included
             since 2026-08-31. It writes this one node into `opened`, the Depth
             buttons stay where the reader put them, and every other part stays
             shut. See the file header for Greg's ask.

             **The root was the exception until Greg pressed it.** The
             reasoning for making it a dead fact was sound as far as it went:
             the root draws no title row, so it has no twist, and an override
             written there could never be taken off again — the `article`
             button would stop meaning "the whole article, and nothing under
             it" for the rest of the session (GPT Sol's review, 2026-08-27).
             What that argued for was a way to undo it, and instead it argued
             the press away. Greg, 2026-08-31: *"in Article sub-mode, I can't
             click on `+N parts` to expand"*.

             So the root now gets the twist it was missing, in the only place
             it has: this badge, which flips to `−N parts` once the parts are
             open. See `Collapse` below, and the header on why that press must
             not go through `closed`. */
          onClick={() => {
            /* Move the keyboard along with the state. This button is about to
               unmount — its job is done the moment the children are open — and
               a focused button that disappears drops focus onto `document.body`,
               which loses a screen-reader's place in the outline entirely. The
               twist is where the reader should land: it stays mounted, it now
               reads "Close <title>", and it is the control that undoes this.

               Only when the badge actually had focus. Not a keyboard-only
               guard: Chrome focuses a button on mousedown, so a real mouse
               press takes this path too, and should — the reader was on the
               badge, the badge is gone, the twist is where they now are. No
               ring paints there, because `:focus-visible` is false for a
               mouse-originated focus; the browser draws that line better than
               we can. What the check prevents is dragging focus off something
               the reader was actually using.

               The root keeps the focus instead, because its badge does not
               unmount: it becomes the collapse. */
            const takeFocus = !root && document.activeElement === badgeRef.current;
            onToggle(entry.node.id, false, beyond);
            if (takeFocus) twistRef.current?.focus();
          }}
          ref={badgeRef}
          /* Named for the one node it opens. "+3 sections" is what the eye
             needs, beside a title it can see; it is also what a screen reader's
             button list shows, where four of them in a row are four
             indistinguishable controls. Same review. */
          aria-label={`Open the ${hidden} ${childLabel(entry.node.depth, hidden)} of ${
            entry.node.title
          }`}
          title={
            beyond
              ? `Open just this one's ${childLabel(entry.node.depth, hidden)} — Depth stays on ${
                  DEPTH_LABELS[deep] ?? "where it is"
                }`
              : "Open these"
          }
        >
          +{cap(hidden)} {childLabel(entry.node.depth, hidden)}
        </button>
      )}

      {/* And the other half of the root's twist. It appears only while the
          override is the one thing holding these open — at `parts` the Depth
          button above is the honest control and this would be a second, worse
          one — which is also what makes clearing the override the whole of the
          collapse. SummaryPanel § clearOverride has the trap it avoids. */}
      {root && onClearOverride && showChildren && beyond && (
        <button
          type="button"
          className="summ-more"
          onClick={() => onClearOverride(entry.node.id)}
          aria-label={`Close the ${entry.children.length} ${childLabel(
            entry.node.depth,
            entry.children.length,
          )} of ${entry.node.title}`}
          title={`Back to the article on its own — Depth stays on ${
            DEPTH_LABELS[deep] ?? "where it is"
          }`}
        >
          −{cap(entry.children.length)} {childLabel(entry.node.depth, entry.children.length)}
        </button>
      )}

      {showChildren && (
        <ol className="summ-children">
          {entry.children.map((child) => (
            <Entry
              key={child.node.id}
              entry={child}
              deep={deep}
              closed={closed}
              opened={opened}
              onToggle={onToggle}
              atRow={atRow}
              current={current}
              onJump={onJump}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

/**
 * `99+` past two digits — theirs, verbatim, and for the reason their reviewer
 * gave: a three-digit badge is a number nobody reads and a column nobody
 * planned for.
 */
function cap(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/**
 * What the things under a node at this depth are called — `parts` under the
 * article, `sections` under a part.
 *
 * The badge said "sections" at every depth until 2026-08-27, which was wrong on
 * the article row and, more to the point, wrong in the one place the reader
 * needs the badge and the Depth buttons to be talking about the same thing:
 * the badge now opens what the buttons name, so it had better use their word.
 */
function childLabel(depth: number, n: number): string {
  const plural = DEPTH_LABELS[depth + 1] ?? "sections";
  return n === 1 ? plural.replace(/s$/, "") : plural;
}

/** A set with `id` in it, and the same set back when it already was. */
function withId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return set.has(id) ? set : new Set(set).add(id);
}

/** A set without `id`, and the same set back when it was not in it. */
function withoutId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}

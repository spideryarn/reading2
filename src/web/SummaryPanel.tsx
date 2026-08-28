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
 * So this is their approach, and their approach is a **named length ladder**.
 * What is hierarchical about it is where the ladder is wired: theirs generated
 * nine granularities of the whole document and showed one hardcoded rung in one
 * heading tooltip — *"Nine granularities generated, one shown where it mattered
 * most. Nobody ever wired the ladder to the place a reader actually meets it"*
 * (docs/project/original-version/summaries.md). Here the article, every part
 * and every section carries the same three rungs, and one control moves all of
 * them at once.
 *
 * ```
 *  ┌── spine ──┬────── SUMMARY (this panel) ──────┬──── the article ────┐
 *  │           │  SUMMARY                         │                     │
 *  │  ▇▇▇▇▇▇▇  │  Length  gist · short · long     │  Being You opens    │
 *  │  ▇▇▇▇     │  Depth   parts · sections        │  with a story about │
 *  │  ▇▇▇      │ ──────────────────────────────── │  waking from        │
 *  │  ▇▇▇▇▇▇   │  Consciousness is what it is     │  anaesthesia…       │
 *  │  ▇▇       │  like to be a living body.       │                     │
 *  │  ▇▇▇▇     │                                  │  Every paragraph    │
 *  │  ▇▇▇      │  ▾ 1  What feeling is for   18¶  │  stays exactly      │
 *  │  ▇▇▇▇▇    │      Perception is a controlled  │  where it was.      │
 *  │  ▇▇       │      hallucination, not a…      │                     │
 *  │           │    ▸ 1.1 The body as a model  6¶ │  Clicking a title   │
 *  │           │  ▸ 2  The hard problem      +4  │  scrolls it here.   │
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
 * The root is the one row where that badge stays a fact, because it draws no
 * title row and so has no twist to undo an override with — see the badge
 * itself for why that is the right answer rather than a missing feature.
 *
 * ## What is on screen and not generated
 *
 * The shortest rung is the **gist**, which stage 4 already wrote onto every
 * internal node. So this panel is useful on an article nobody has paid a model
 * call for, and the button below is an upgrade rather than a precondition. That
 * is also why an entry says which rung it is actually showing when it could not
 * give you the one you asked for: a partly-written artefact must not read as a
 * complete one (src/summarise.ts § partial salvage).
 */
import { type MouseEvent, useRef, useState } from "react";
import { ChevronRight, Compass, Layers, RotateCcw, TriangleAlert } from "lucide-react";
import type { BlockId, Job } from "../types.js";
import { BlockRange } from "./BlockRef.js";
import { CitedText } from "./Cited.js";
import { TooltipGroup } from "./Tooltip.js";
import type { Rung } from "./params.js";
import { MAX_SUMMARY_DEPTH, RUNGS } from "./params.js";
import { FOLLOW_ATTR, useFollow } from "./follow.js";
import { currentEntryId, rungText, showsChildren, type SummaryNode } from "./tree.js";
import type { UseSummaries } from "./useSummaries.js";
import { JobProgress } from "./JobProgress.js";
import { UseProfile, WrittenForYou } from "./WrittenForYou.js";
import { useRenderCount } from "./perf.js";

interface Props extends UseSummaries {
  /** The tree, joined to whatever summaries exist. Null if the tree is unusable. */
  root: SummaryNode | null;
  /**
   * Every block this article has, id to plain text.
   *
   * Two jobs, both belonging to the citations in the summary prose: it is the
   * "does this id exist" check, and it is what a chip's hover card shows. Same
   * map chat is handed, for the same reason (src/web/Cited.tsx).
   */
  blocks: Map<string, string>;
  rung: Rung;
  onRung(rung: Rung): void;
  deep: number;
  onDeep(deep: number): void;
  /** Where the reader is, as a row index into `blocks`. Null above the first section. */
  atRow: number | null;
  /** Jump the article to a block, exactly as a gist cell does. */
  onJump(id: BlockId): void;
}

/** What each rung is called where the reader meets it, and what it promises. */
const RUNG_LABELS: Record<Rung, { label: string; blurb: string }> = {
  gist: { label: "gist", blurb: "One sentence each — the tree's own, and always there" },
  short: { label: "short", blurb: "A few sentences each" },
  long: {
    label: "long",
    blurb: "A paragraph for a section, a couple for a part, about a page for the article",
  },
};

const DEPTH_LABELS = ["article", "parts", "sections"];

export function SummaryPanel({
  status,
  summaries,
  stale,
  profiled,
  profileChanged,
  hasProfile,
  error,
  job,
  failed,
  write,
  cancel,
  root,
  blocks,
  rung,
  onRung,
  deep,
  onDeep,
  atRow,
  onJump,
}: Props) {
  useRenderCount("SummaryPanel");
  /**
   * Which sections the reader has closed.
   *
   * In memory rather than in the URL, and params.ts § summary mode carries the
   * argument: the only way to write this down is a list of node ids, node ids
   * are positional, and a re-run of `npm run toc` renumbers them — so a shared
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
     to leave out and was: it changes when the summaries finish loading or a
     rewrite lands, which can turn every one-sentence gist into a paragraph and
     push the current row off the bottom without any id changing. follow.ts has
     the argument. */
  const scroll = useRef<HTMLDivElement>(null);
  useFollow(scroll, current, [rung, deep, closed, opened, root]);

  /**
   * What the reader wants these summaries to lean towards.
   *
   * `null` means "the reader has not touched the box", which is a different
   * state from "the reader emptied it" — so the effective value below can fall
   * through to whatever the artefact was written with, and a reader who clears
   * the box still gets an unsteered rewrite. One variable for the two would
   * make clearing it impossible: the artefact's note would keep reappearing.
   */
  /* Seeded from what the artefact on screen was written with, so nothing has to
     remember the reader's last choice between visits — the file does. */
  const [withProfile, setWithProfile] = useState(() => (summaries ? profiled : true));
  const [steer, setSteer] = useState<string | null>(null);
  const guidance = steer ?? summaries?.guidance ?? "";

  /* Whether the two longer rungs exist at all. Not `status === "ready"`: an
     artefact can be present and still have holes in it, and what decides
     whether the ladder is worth offering is whether anything on the tree
     actually carries a longer rung. */
  const hasLadder = summaries !== null && summaries.entries.length > 0;

  return (
    <aside className="mode-band summ" aria-label="Summary">
      <div className="summ-head">
        <Layers size={14} className="summ-head-icon" />
        <h2>Summary</h2>
        {/* Provenance, on the head line. A label rather than a control for the
            reason src/web/WrittenForYou.tsx gives. */}
        {summaries && <WrittenForYou written={profiled} changed={profileChanged} />}
      </div>

      <div className="summ-controls">
        {/* The ladder. Named, not numbered — which is the whole finding this
            feature rests on, and the reason these are words rather than a
            slider with three notches. */}
        {/* A real `<fieldset>` and `<legend>`, not a div with `role="group"`.
            The legend is the group's accessible name for free, and it puts the
            word "Length" and the buttons in one relationship rather than two
            things that happen to sit next to each other. What makes it usable
            is that `.summ-row` is `display: flex`: a legend only gets its odd
            notched-into-the-border rendering while the fieldset is a block
            box, and inside a flex container it is an ordinary flex item. */}
        <fieldset className="summ-row">
          <legend className="summ-label">Length</legend>
          {RUNGS.map((r) => (
            <button
              key={r}
              type="button"
              className={`summ-pill${r === rung ? " on" : ""}`}
              aria-pressed={r === rung}
              // Offered even before the artefact exists, and disabled rather
              // than hidden: a control that appears once you have paid for it
              // gives no clue that paying is what the button below is for.
              disabled={r !== "gist" && !hasLadder}
              title={
                r !== "gist" && !hasLadder
                  ? `${RUNG_LABELS[r].blurb} — not written for this article yet`
                  : RUNG_LABELS[r].blurb
              }
              onClick={() => onRung(r)}
            >
              {RUNG_LABELS[r].label}
            </button>
          ))}
        </fieldset>

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

      {error && <p className="summ-error">{error}</p>}

      {stale && (
        <div className="summ-stale">
          <p>
            <TriangleAlert size={13} />
            These summaries describe an older version of the article.
          </p>
          {/* The box is here too, and not only in the foot below: the foot is
              hidden while the summaries are stale, so without this the one
              article most likely to be rewritten is the one you cannot steer. */}
          <Steer value={guidance} onChange={setSteer} disabled={job !== null} />
          {/* Beside the steer and the button, because all three describe the
              same forthcoming run. Two boxes about intent and one checkbox
              about whose intent — the profile is durable and about the reader,
              the steer is about this rewrite, and SYSTEM states that the steer
              wins where they pull different ways.
              docs/project/reader-profile.md. */}
          <UseProfile
            checked={withProfile}
            onChange={setWithProfile}
            hasProfile={hasProfile}
            disabled={job !== null}
          />
          {/* No `force` needed: the step's own freshness check already knows
              this artefact is out of date, so an ordinary run rewrites it. */}
          <Progress
            job={job}
            failed={failed}
            onRun={() => write(false, guidance, withProfile)}
            onCancel={cancel}
            label="Rewrite them"
          />
        </div>
      )}

      <div className="summ-scroll" ref={scroll}>
        {root ? (
          /* One group for the whole outline, so running the pointer down a
             column of block ids shows each card immediately rather than
             waiting out the open delay again at every one. Chat's answers do
             the same — Tooltip.tsx. */
          <TooltipGroup delay={{ open: 350, close: 120 }} timeoutMs={500}>
            <ol className="summ-list">
              <Entry
                entry={root}
                rung={rung}
                deep={deep}
                closed={closed}
                opened={opened}
                onToggle={toggle}
                atRow={atRow}
                current={current}
                onJump={onJump}
                blocks={blocks}
                root
              />
            </ol>
          </TooltipGroup>
        ) : (
          <p className="summ-quiet">This article has no usable tree to summarise.</p>
        )}
      </div>

      {/* The offer, at the bottom rather than in place of the outline: there is
          always something to read here, so this is never an empty state. */}
      {status !== "loading" && !stale && (
        <div className="summ-foot">
          {status === "none" ? (
            <>
              <p className="summ-hint">
                Only the one-sentence gists so far. Writing the longer two rungs is a few model
                calls over the whole article and takes a minute or two — done once and kept.
              </p>
              <Steer value={guidance} onChange={setSteer} disabled={job !== null} />
          {/* Beside the steer and the button, because all three describe the
              same forthcoming run. Two boxes about intent and one checkbox
              about whose intent — the profile is durable and about the reader,
              the steer is about this rewrite, and SYSTEM states that the steer
              wins where they pull different ways.
              docs/project/reader-profile.md. */}
          <UseProfile
            checked={withProfile}
            onChange={setWithProfile}
            hasProfile={hasProfile}
            disabled={job !== null}
          />
              <Progress
                job={job}
                failed={failed}
                onRun={() => write(false, guidance, withProfile)}
                onCancel={cancel}
                label="Write the summaries"
              />
            </>
          ) : (
            hasLadder && (
              <>
                {/* Written down rather than smoothed over. A section that got
                    nothing back falls all the way to its gist, which looks
                    exactly like a section the model had less to say about — the
                    number is what tells the two apart.

                    Note what `missing` counts, precisely: sections with **no
                    entry at all**, not sections that got a `short` and no
                    `long`. Those are marked individually on the row instead,
                    which is the more useful place for a fact about one row. */}
                {summaries.missing > 0 && (
                  <p className="summ-hint">
                    {summaries.missing} {summaries.missing === 1 ? "section" : "sections"} got
                    nothing back and fall back to their one-sentence gist.
                  </p>
                )}
                <Steer value={guidance} onChange={setSteer} disabled={job !== null} />
          {/* Beside the steer and the button, because all three describe the
              same forthcoming run. Two boxes about intent and one checkbox
              about whose intent — the profile is durable and about the reader,
              the steer is about this rewrite, and SYSTEM states that the steer
              wins where they pull different ways.
              docs/project/reader-profile.md. */}
          <UseProfile
            checked={withProfile}
            onChange={setWithProfile}
            hasProfile={hasProfile}
            disabled={job !== null}
          />
                <Progress
                  job={job}
                  failed={failed}
                  // Forced: the step believes this artefact is current, and it
                  // is right — the reader is asking for it anyway. Which is
                  // also why the steer does not go anywhere near
                  // `summariesAreCurrent`: a note about what you are reading
                  // for is not a reason for the *next* ordinary run to decide
                  // the artefact has gone stale.
                  onRun={() => write(true, guidance)}
                  onCancel={cancel}
                  label="Write them again"
                  icon="redo"
                />
              </>
            )
          )}
        </div>
      )}
    </aside>
  );
}

/**
 * One node and, unless it is closed or too deep, the ones under it.
 *
 * The root renders without a title row — it *is* the article, and the masthead
 * two inches to the right already says its name. What it contributes is the
 * top-level summary, which is the one the previous version actually shipped.
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
  rung,
  deep,
  closed,
  opened,
  onToggle,
  atRow,
  current,
  onJump,
  blocks,
  root = false,
}: {
  entry: SummaryNode;
  rung: Rung;
  deep: number;
  closed: ReadonlySet<string>;
  opened: ReadonlySet<string>;
  onToggle(id: string, showing: boolean, beyond: boolean): void;
  atRow: number | null;
  /** The one entry the reader is on — see SummaryPanel § current. */
  current: string | null;
  onJump(id: BlockId): void;
  blocks: Map<string, string>;
  root?: boolean;
}) {
  const shown = rungText(entry, rung);
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
    <li className={`summ-entry d${entry.node.depth}${here ? " here" : ""}${now ? " now" : ""}`}>
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
              <span className="summ-number">{entry.number}</span>
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

        {shown ? (
          <p className={`summ-text${shown.rung !== rung ? " fell-back" : ""}`}>
            {/* The rung actually shown, when it is not the one asked for. Silent
                fallback is what makes a half-written artefact read as a whole
                one. */}
            {shown.rung !== rung && (
              <span className="summ-rung-tag" title={`No ${rung} summary for this one`}>
                {shown.rung}
              </span>
            )}
            {/* The block ids the model cited, as chips you can press, with the
                paragraph itself on hover. A summary is a door into the passage
                and this is the handle — same component chat draws its
                citations with (Cited.tsx), so the two cannot mean different
                things. A `gist` carries none: it is written by stage 4, which
                knows nothing about this, and the text simply comes through
                unchanged. */}
            <CitedText text={shown.text} blocks={blocks} onJump={onJump} />
          </p>
        ) : (
          !root && <p className="summ-text missing">No summary for this section.</p>
        )}

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
          /* A control since 2026-08-27, and on every row but the root. It used
             to be a fact whenever the cut-off was what hid these — pressing it
             would have had to overrule the Depth buttons above. It does not
             overrule them: it writes this one node into `opened`, the Depth
             buttons stay where the reader put them, and every other part stays
             shut. See the file header for Greg's ask.

             **The root is the exception, and it has to be.** It draws no title
             row, so it has no twist, so an override written there could never
             be taken off again — the `article` button would stop meaning "the
             whole article, and nothing under it" for the rest of the session,
             with no control anywhere on screen to put it back. Found by GPT
             Sol's review, 2026-08-27.

             That is not a special case grudgingly carved out, either. What the
             badge is *for* is picking one node out of several without moving
             the cut-off for the rest. At the root there are no others: the only
             thing it could do is exactly what the `parts` button one inch above
             it does, reversibly. So on the root it goes back to being a fact,
             pointing at the control that does the job. */
          disabled={root}
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
               the reader was actually using. */
            const takeFocus = document.activeElement === badgeRef.current;
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
            root
              ? `Press ${DEPTH_LABELS[entry.node.depth + 1] ?? "a deeper level"} above to see these`
              : beyond
                ? `Open just this one's ${childLabel(entry.node.depth, hidden)} — Depth stays on ${
                    DEPTH_LABELS[deep] ?? "where it is"
                  }`
                : "Open these"
          }
        >
          +{cap(hidden)} {childLabel(entry.node.depth, hidden)}
        </button>
      )}

      {showChildren && (
        <ol className="summ-children">
          {entry.children.map((child) => (
            <Entry
              key={child.node.id}
              entry={child}
              rung={rung}
              deep={deep}
              closed={closed}
              opened={opened}
              onToggle={onToggle}
              atRow={atRow}
              current={current}
              onJump={onJump}
              blocks={blocks}
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

/**
 * The box you steer a rewrite with.
 *
 * Greg, 2026-08-26:
 *
 * > for the "Write them again", add an input-textbox so the user can give
 * > guidance to steer the summary generation - this should be added to the
 * > prompt and tweak the output that gets generated, but make sure the LLM
 * > doesn't overweight this and give a really distorted summary, i.e. we want
 * > to stay faithful to the text.
 *
 * **The second half of that sentence is the whole design problem**, and almost
 * none of the answer is in this file. A note like *"I care about the economics"*
 * asks the model to choose what to put first; the failure it invites is the
 * model quietly reporting an article as being about economics because that is
 * what it was asked about. The rules that hold it to emphasis — never a claim,
 * never the proportions, never a line saying the section does not cover it —
 * live in the constant half of the prompt, in src/summarise.ts § IF THE READER
 * ASKS FOR SOMETHING IN PARTICULAR. They are in `SYSTEM` rather than beside the
 * note itself so that the constraint cannot be edited by the thing it
 * constrains.
 *
 * What this file contributes is the two honest bits:
 *
 *  - **The box shows what the summaries on screen were written with**, because
 *    it is seeded from the artefact. A steered summary that looks like an
 *    ordinary one is one the reader cannot weigh, and the note is the only
 *    thing that explains why a section reads the way it does.
 *  - **Emptying it is a real answer.** Clear the box and the rewrite is
 *    unsteered — see the `steer ?? summaries?.guidance` note above, which is
 *    why that is two variables and not one.
 *
 * Collapsed until it has something to say, so the ordinary case is one line of
 * chrome. `maxLength` matches `MAX_GUIDANCE_CHARS` in src/routes.ts, which
 * refuses rather than truncates — a shortened instruction is one the reader
 * believes they gave and did not.
 */
const MAX_GUIDANCE = 600;

function Steer({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange(next: string): void;
  disabled: boolean;
}) {
  // Open if there is anything to show. `useState` initialiser, not an effect:
  // this is the state's starting value, and re-opening the box every time the
  // job poll returns would fight a reader who had just closed it.
  const [open, setOpen] = useState(() => value !== "");

  if (!open) {
    return (
      <button type="button" className="summ-steer-open" onClick={() => setOpen(true)}>
        <Compass size={12} />
        Steer these summaries…
      </button>
    );
  }

  return (
    <div className="summ-steer">
      <label className="summ-steer-label" htmlFor="summ-steer-box">
        What are you reading this for?
      </label>
      <textarea
        id="summ-steer-box"
        className="summ-steer-box"
        rows={2}
        maxLength={MAX_GUIDANCE}
        disabled={disabled}
        placeholder="e.g. I care about the evidence, not the history"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="summ-steer-note">
        Changes what each summary puts first. It never changes what the article
        says — a section that has nothing on this is summarised as it would have
        been anyway.
      </p>
    </div>
  );
}

/**
 * The summary panel's run button. `icon` is the one thing that varies here:
 * "write these" and "write them again" are the same action with different
 * intent, and the glyph is what says which.
 */
function Progress({
  icon = "write",
  ...props
}: {
  job: Job | null;
  failed: string | null;
  onRun(): Promise<void>;
  onCancel(id: string): void;
  label: string;
  icon?: "write" | "redo";
}) {
  return (
    <JobProgress
      {...props}
      step="summary"
      icon={icon === "redo" ? <RotateCcw size={13} /> : <Layers size={13} />}
      runningLabel="Writing…"
    />
  );
}

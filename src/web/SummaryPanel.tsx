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
 * ## Two ways to be hidden, and they are not the same variable
 *
 * The one design note worth copying verbatim from their structure panel:
 * *"too deep to show" and "I closed this" are different states and should not
 * share a variable.* So `deep` is a cut-off that removes a whole level, `closed`
 * is a set the reader put nodes into, and they compose. A node hidden by the
 * cut-off does not un-close itself when the cut-off moves.
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
import { type MouseEvent, useState } from "react";
import { ChevronRight, Compass, Layers, Loader2, RotateCcw, TriangleAlert, X } from "lucide-react";
import type { BlockId, Job } from "../types.js";
import { BlockRange } from "./BlockRef.js";
import { CitedText } from "./Cited.js";
import { TooltipGroup } from "./Tooltip.js";
import type { Rung } from "./params.js";
import { MAX_SUMMARY_DEPTH, RUNGS } from "./params.js";
import { rungText, type SummaryNode } from "./tree.js";
import type { UseSummaries } from "./useSummaries.js";

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
  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  /**
   * What the reader wants these summaries to lean towards.
   *
   * `null` means "the reader has not touched the box", which is a different
   * state from "the reader emptied it" — so the effective value below can fall
   * through to whatever the artefact was written with, and a reader who clears
   * the box still gets an unsteered rewrite. One variable for the two would
   * make clearing it impossible: the artefact's note would keep reappearing.
   */
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
          {/* No `force` needed: the step's own freshness check already knows
              this artefact is out of date, so an ordinary run rewrites it. */}
          <Progress
            job={job}
            failed={failed}
            onRun={() => write(false, guidance)}
            onCancel={cancel}
            label="Rewrite them"
          />
        </div>
      )}

      <div className="summ-scroll">
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
                onToggle={toggle}
                atRow={atRow}
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
              <Progress
                job={job}
                failed={failed}
                onRun={() => write(false, guidance)}
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
  onToggle,
  atRow,
  onJump,
  blocks,
  root = false,
}: {
  entry: SummaryNode;
  rung: Rung;
  deep: number;
  closed: ReadonlySet<string>;
  onToggle(id: string): void;
  atRow: number | null;
  onJump(id: BlockId): void;
  blocks: Map<string, string>;
  root?: boolean;
}) {
  const shown = rungText(entry, rung);
  const shut = closed.has(entry.node.id);
  /* The two ways to be hidden, kept apart on purpose — see the file header.
     `tooDeep` is the cut-off; `shut` is the reader. Either hides the children,
     and neither changes the other. */
  const tooDeep = entry.node.depth >= deep;
  const openable = entry.children.length > 0 && !tooDeep;
  const showChildren = openable && !shut;
  const hidden = entry.children.length > 0 && !showChildren ? entry.children.length : 0;

  /* Where the reader is. An ancestor of the current section counts as "here"
     too, because at depth 1 the part you are inside is the honest answer to
     "where am I" — marking only the deepest visible node would leave the panel
     with nothing lit whenever the cut-off is above it.

     Except the root, which covers the whole article and is therefore "here"
     the entire time the reader is anywhere. Marking it would put a permanent
     highlight down the left of the whole outline, which is a light that is
     always on and so tells you nothing. */
  const here = !root && atRow !== null && atRow >= entry.startRow && atRow <= entry.endRow;

  /** A click anywhere in the entry that nothing else has already claimed. */
  const jumpFromBody = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, a")) return;
    onJump(entry.node.range[0]);
  };

  return (
    <li className={`summ-entry d${entry.node.depth}${here ? " here" : ""}`}>
      {/* Both of these are the same statement, and it is the one in the header:
          the keyboard path is the real `.summ-title` button inside this div,
          which is unchanged and still focusable. This handler only widens the
          MOUSE target to the whole entry — it adds no way to operate the panel
          that was not already there. A `role="button"` would be worse than
          nothing: it would claim to be one control while containing three, and
          it would take the twist out of the tab order.
          biome-ignore lint/a11y/useKeyWithClickEvents: as above
          biome-ignore lint/a11y/noStaticElementInteractions: as above */}
      <div className="summ-body" onClick={jumpFromBody}>
        {!root && (
          <div className="summ-title-row">
            <button
              type="button"
              className={`summ-twist${openable ? "" : " leaf"}${shut ? "" : " open"}`}
              aria-expanded={openable ? !shut : undefined}
              aria-label={shut ? `Open ${entry.node.title}` : `Close ${entry.node.title}`}
              disabled={!openable}
              onClick={() => onToggle(entry.node.id)}
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
          // Only ever openable when the reader is the one who closed it. When
          // the cut-off is what hid them the badge is a fact, not a control —
          // pressing it would silently overrule the Depth buttons above.
          disabled={!openable}
          onClick={() => openable && onToggle(entry.node.id)}
          title={
            openable
              ? "Open these"
              : `Raise the depth to ${DEPTH_LABELS[entry.node.depth + 1] ?? "more"} to see these`
          }
        >
          +{cap(hidden)} {hidden === 1 ? "section" : "sections"}
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
              onToggle={onToggle}
              atRow={atRow}
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
 * The button, or the job that button started.
 *
 * The same component the glossary panel has, and the same reasoning: a run may
 * have been started in another tab or from the CLI, so this shows whatever the
 * queue is actually doing rather than what this session remembers clicking.
 */
function Progress({
  job,
  failed,
  onRun,
  onCancel,
  label,
  icon = "write",
}: {
  job: Job | null;
  failed: string | null;
  onRun(): Promise<void>;
  onCancel(id: string): void;
  label: string;
  icon?: "write" | "redo";
}) {
  if (job) {
    const step = job.steps.find((s) => s.name === "summary");
    return (
      <div className="summ-running">
        <Loader2 size={13} className="summ-spin" />
        <span>{job.status === "queued" ? "Waiting for the queue…" : (step?.label ?? "Writing…")}</span>
        {step?.detail && <span className="summ-detail-live">{step.detail}</span>}
        <button
          type="button"
          className="summ-btn"
          title="Stop this job"
          disabled={job.cancelling === true}
          onClick={() => onCancel(job.id)}
        >
          <X size={12} />
          {job.cancelling ? "Stopping…" : "Stop"}
        </button>
      </div>
    );
  }
  return (
    <>
      {/* `() => void onRun()` and not `onRun`: React hands a click handler a
          MouseEvent, and a function whose first parameter is optional would
          take that event as its argument. The thread page was bitten by exactly
          this, and `write(force?)` has exactly that shape. */}
      <button type="button" className="summ-btn primary" onClick={() => void onRun()}>
        {icon === "redo" ? <RotateCcw size={12} /> : <Layers size={12} />}
        {label}
      </button>
      {failed && <p className="summ-error">{failed}</p>}
    </>
  );
}

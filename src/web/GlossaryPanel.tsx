/**
 * The glossary panel — a **mode**, in the band between the spine and the prose.
 *
 * Greg, 2026-08-25, on where a mode goes, said of chat and named this feature
 * in the same breath:
 *
 * > I'm thinking that this might be a common pattern, that when we switch into
 * > a mode (e.g. Chat, Glossary, etc) we'll want to keep the spine and article,
 * > but reuse the middle sections.
 *
 * and then, when this was built:
 *
 * > When active, it should replace the middle sections of the UI (i.e. right of
 * > the spine, left of the doc).
 *
 * So this is the third implementation of the slot ChatPanel.tsx describes, and
 * it needed no new layout arithmetic at all — `fitView({ modeBand: true })` in
 * layout.ts already knew about the slot rather than about chat.
 *
 * ## The one thing this deliberately does not do
 *
 * **Mark up the prose on its own initiative.** The version this was borrowed
 * from put a dotted underline and a small book icon on every term, inline, on
 * every article, always. That is the prose acquiring marks the author did not
 * write, at the model's suggestion rather than the reader's — a small violation
 * of [principle 5](../../docs/project/vision.md#principles), and the thing our
 * own review of their feature said to drop
 * (docs/project/original-version/glossary.md § What we'd do differently).
 *
 * What happens instead: **selecting a term underlines its occurrences**, and
 * only while it is selected. Greg's call, 2026-08-25, choosing that over "jump
 * only" — the underline is reader-initiated, so the principle holds, and it
 * answers the question the list otherwise raises on every entry, which is
 * *where does this piece actually use that*.
 *
 * ## The scores, and the condition attached to them
 *
 * `difficulty` and `centrality` are the model's judgment of how hard a term is
 * and how much of the argument rests on it. Our review of their version said to
 * drop both, on the grounds that ranking terms for the reader is the model
 * doing the reader's prioritising. Greg kept them, with a condition: **never
 * sort by them silently.**
 *
 * On **2026-08-26** he overrode the first half of that condition and kept the
 * second. The default order is now `prioritised`, which is a ranking nobody
 * asked for — so everything here is about making it not a silent one:
 *
 * - it uses the two scores for **one decision only**, which of two groups an
 *   entry is in, because a product of two noisy 0–1 scores groups well and
 *   ranks badly;
 * - **inside a group the order is first use**, the reader's own order through
 *   the piece, so the model has chosen nothing there;
 * - the divider **names the rule** that promoted the group above it;
 * - **both numbers are on every row**, and never the product, which is our
 *   arithmetic rather than the model's judgment;
 * - **the one number in the rule is the reader's**, on a slider in the panel
 *   with its value and its effect beside it — the last thing here that was a
 *   judgment made on the reader's behalf, and now the thing they set;
 * - when there is nothing to gate at all, the whole of it **falls back to first
 *   use** and the control is not offered.
 *
 * The four designs this was chosen from, and the two things it is a bet on, are
 * in docs/plans/glossary-prioritised-order.md.
 */
import { useState } from "react";
import {
  BookA,
  ExternalLink,
  Globe,
  Info,
  LoaderCircle,
  RotateCcw,
  Search,
  TriangleAlert,
} from "lucide-react";
import type { BlockId, Glossary, GlossaryEntry, Job } from "../types.js";
import type { TermSort } from "./params.js";
import { BlockRef } from "./BlockRef.js";
import { Tooltip } from "./Tooltip.js";
import { isWebUrl } from "../urls.js";
import type { UseGlossary } from "./useGlossary.js";
import { JobProgress } from "./JobProgress.js";

interface Props extends UseGlossary {
  /** The selected term, from `?term=`. Null is a list nobody has picked from. */
  termId: string | null;
  onTerm(id: string | null): void;
  sort: TermSort;
  onSort(sort: TermSort): void;
  /**
   * Where the reader has put the threshold, or null for "hasn't touched it" —
   * which is `PRIORITY_GATE`. The distinction is kept all the way from the URL
   * (`gateParam` in params.ts) so that the default stays one number in one file.
   */
  gate: number | null;
  onGate(gate: number | null): void;
  /* Straight through from `useGlossary`. The panel owns none of this state —
     the hook does — because a lookup outlives the row that started it: the
     reader can select another term while one runs. */
  look(id: string): Promise<void>;
  looking: string | null;
  lookFailed: string | null;
  /** Jump the article to a block, exactly as a gist cell does. */
  onJump(id: BlockId): void;
}

export function GlossaryPanel({
  status,
  glossary,
  stale,
  outdated,
  error,
  job,
  failed,
  find,
  more,
  reset,
  cancel,
  termId,
  onTerm,
  sort,
  onSort,
  gate: chosenGate,
  onGate,
  onJump,
  look,
  looking,
  lookFailed,
}: Props) {
  /* `effectiveSort` and not `sort`: `prioritised` is the default, so it arrives
     on glossaries whose scores cannot support it, and everything below — the
     groups, the SortBar's pressed state, the numbers on each row — has to agree
     about what order the list is actually in. One call, one answer, passed
     down. */
  const all = glossary?.entries ?? [];
  const gate = chosenGate ?? PRIORITY_GATE;
  const order = effectiveSort(all, sort);
  const groups = glossary ? groupEntries(all, order, gate) : [];

  return (
    <aside className="mode-band gloss" aria-label="Glossary">
      <div className="gloss-head">
        <BookA size={14} className="gloss-head-icon" />
        <h2>Glossary</h2>
        {glossary && (
          <span className="gloss-count">
            {glossary.entries.length} {glossary.entries.length === 1 ? "term" : "terms"}
          </span>
        )}
      </div>

      {/* Sorting is only a question once there is a list, and each option is
          only offered once the model actually returned what it needs — an older
          glossary may have no scores at all, and offering a sort that would
          silently do nothing is worse than not offering it. `SortBar` returns
          nothing when fewer than two survive that. */}
      {glossary && glossary.entries.length > 1 && (
        <SortBar entries={all} sort={order} onSort={onSort} />
      )}

      {/* Only in the order it belongs to. It is the one control here that sets
          a number rather than picking from a list, and a number that means
          nothing in the other three orders would just be furniture. */}
      {glossary && order === "prioritised" && (
        <GateSlider entries={all} gate={gate} moved={chosenGate !== null} onGate={onGate} />
      )}

      {error && <p className="gloss-error">{error}</p>}

      {status === "loading" && <p className="gloss-quiet">Looking for a glossary…</p>}

      {status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has found the terms for this one yet.</p>
          <p className="gloss-hint">
            One model call over the whole article, and it takes tens of seconds. Found once and
            kept — you will not be asked again unless the article changes.
          </p>
          <Progress job={job} failed={failed} onRun={find} onCancel={cancel} label="Find the terms" />
        </div>
      )}

      {status === "ready" && glossary && (
        <>
          {/* The article has moved and the list has not. Said plainly, at the
              top, because every entry below it is now a claim about a version
              of the piece that no longer exists — and the occurrences in
              particular will point at blocks that may not be there. The button
              needs no `force`: the step's own freshness check already knows
              this glossary is out of date, so an ordinary run rewrites it. */}
          {/* Two different facts, and they were nearly one. `stale` is *the
              article moved underneath these terms* — every entry below is a
              claim about a piece that no longer exists, and the occurrences in
              particular will point at blocks that may not be there.

              `outdated` is *the article is the same and we would write these
              differently now*, which is what bumping `PROMPT_VERSION` means.
              It got its own flag because it was briefly nobody's: `isStale`
              compares source hashes and nothing else, so the `glossary/2`
              rewrite marked exactly zero glossaries as anything, and the panel
              went on showing pre-rewrite entries with no banner and no offer.

              Stale wins when both are true — it is the one that makes the
              occurrence links wrong, and two banners stacked is a wall. */}
          {stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These terms describe an older version of the article.
              </p>
              <Progress
                job={job}
                failed={failed}
                onRun={find}
                onCancel={cancel}
                label="Find them again"
              />
            </div>
          ) : outdated ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These were written before entries said where each half came from. Finding them
                again splits each one into what the article means and what the model knows.
              </p>
              <Progress
                job={job}
                failed={failed}
                onRun={find}
                onCancel={cancel}
                label="Find them again"
              />
            </div>
          ) : null}

          {/* A `div` rather than the `ol` it used to be, because it is the
              scroller and there may now be two lists inside it. Each group
              keeps its own `ol`; a heading is not a list item and putting one
              inside an `ol` to draw a divider would be a lie about the
              structure for the sake of a line of CSS. */}
          <div className="gloss-list">
            {groups.map((group) => (
              <section key={group.key} className="gloss-group">
                {/* The rule that promoted this group, named. A threshold with
                    no visible divider is the "silent" in "never sort by them
                    silently" — see the § docstring at the top of this file. */}
                {group.label && (
                  <h3 className="gloss-group-head" title={group.title}>
                    {group.label}
                    <span className="gloss-group-count">{group.entries.length}</span>
                  </h3>
                )}
                <ol className="gloss-group-list">
                  {group.entries.map((entry) => (
                    <Term
                      key={entry.id}
                      entry={entry}
                      selected={entry.id === termId}
                      /* Whichever scores the list is ordered by are shown on
                         every row. An order the reader chose but cannot see the
                         basis of is the thing the objection to these scores was
                         actually about — and a default order they did not
                         choose needs it more, not less. */
                      showScore={order}
                      look={look}
                      looking={looking === entry.id}
                      lookBusy={looking !== null}
                      lookFailed={looking === null && entry.id === termId ? lookFailed : null}
                      onSelect={() => {
                        // Pressing the selected term again clears it, which is
                        // what takes the underlines back out of the prose.
                        // There is no other affordance for that, and a
                        // selection you cannot cancel is a mode inside a mode.
                        if (entry.id === termId) return onTerm(null);
                        onTerm(entry.id);
                        const first = entry.blocks[0];
                        if (first) onJump(first);
                      }}
                      onJump={onJump}
                    />
                  ))}
                </ol>
              </section>
            ))}
          </div>

          <Foot
            glossary={glossary}
            job={job}
            failed={failed}
            onMore={more}
            onReset={reset}
            onCancel={cancel}
          />
        </>
      )}
    </aside>
  );
}

/**
 * The list in one flat order — document, one of the two scores, or prioritised.
 *
 * Descending on both scores, because "hardest first" and "most central first"
 * are the questions people actually have — nobody opens a glossary looking for
 * the easiest word in it. A missing score sorts last rather than as zero: an
 * entry the model declined to score is not an entry it scored as trivial, and
 * treating the two the same is the small lie that makes a sort untrustworthy.
 *
 * `prioritised` is the groups below, flattened, so the two can never disagree
 * about what order the list is in.
 *
 * Pure and exported, because it is the only part of this file with a right
 * answer — see the `sortEntries` block of tests/glossary.test.ts.
 */
export function sortEntries(
  entries: GlossaryEntry[],
  sort: TermSort,
  gate = PRIORITY_GATE,
): GlossaryEntry[] {
  if (sort === "document") return entries;
  if (sort === "prioritised") return groupEntries(entries, sort, gate).flatMap((g) => g.entries);
  const value = (entry: GlossaryEntry): number | undefined =>
    sort === "difficulty" ? entry.difficulty : entry.centrality;
  return [...entries]
    .map((entry, i) => ({ entry, i, score: value(entry) }))
    .sort((a, b) => {
      if (a.score === undefined && b.score === undefined) return a.i - b.i;
      if (a.score === undefined) return 1;
      if (b.score === undefined) return -1;
      // The index tie-break keeps document order inside a group of equal
      // scores, so the list does not reshuffle for no visible reason.
      return b.score === a.score ? a.i - b.i : b.score - a.score;
    })
    .map((x) => x.entry);
}

/* ------------------------------------------------------------ prioritised --
   The default order, added 2026-08-26 at Greg's request:

   > let's add a "Prioritised" order (that should be the default) that somehow
   > takes into account importance, centrality, and order.

   and given a bar the reader can move, later the same day:

   > Add a small threshold-slider to the Glossary UI (set to a sensible default)

   The whole design is in docs/plans/glossary-prioritised-order.md. The four
   things worth having in front of you while reading this code:

   1. **The two scores multiply, they do not add.** What the reader wants
      ordered is the cost of *not* knowing a term, which is "how likely it is to
      stop me" times "how much of the argument stops with it". A sum gets both
      ends wrong: a very central, very easy word ("attention", in a piece about
      attention) scores high and needs no priority, and a very hard, very
      peripheral one scores high and is exactly the distraction a priority list
      exists to keep off the top.

   2. **A product of two noisy 0–1 model scores groups well and ranks badly.**
      Models emit clumped scores, so a continuous composite invents distinctions
      that are not in the data. So the product decides one thing — in, or out —
      and inside a group the order is first use, which is the reader's own order
      and not a judgment at all.

   3. **The one number in it is the reader's to set.** `PRIORITY_GATE` was
      always described in this file as a guess with no feedback loop behind it.
      The slider is the feedback loop: the guess is now a starting position
      rather than a verdict, it is on screen with its own value beside it, and
      moving it is one drag.

   4. **It is self-cancelling, and the slider narrowed where.** When the gate
      does not divide the list, no divider is drawn and no group is labelled —
      the list is plainly in first-use order. What it no longer does is drop out
      of prioritised order altogether; see `effectiveSort` for why the slider
      reverses that argument. */

/**
 * The gate's **starting** position: `difficulty × centrality`, both required.
 *
 * `0.30` is about `0.6 × 0.5` — the model called it more than half load-bearing
 * *and* more than half likely to stop you. On the one real glossary we have it
 * promotes two terms of eight, which is the size of top group this is aiming at.
 *
 * An **absolute** starting point rather than a relative "top third",
 * deliberately, and the reason is what each does when it is wrong. If the
 * model's scores run hot or cold, an absolute gate degenerates to one group —
 * that is, to plain first-use order, which is what this list did before. A
 * relative gate would promote exactly a third whatever the scores said, which is
 * inventing a ranking that is not in the data and putting a label over it.
 *
 * It is a default rather than a constant now: `?gate=` overrides it, and the
 * parameter deliberately has no default of its own so that "absent" keeps
 * meaning *nobody has touched this*. See `gateParam` in params.ts.
 */
export const PRIORITY_GATE = 0.3;

/**
 * How far the slider moves in one step, and therefore how precise `?gate=` gets.
 *
 * `0.01` because the whole usable range is short — a product of two scores the
 * model rarely puts above 0.8 apiece lands under 0.7 — so a coarser step would
 * skip past the boundary the reader is hunting for. Two decimal places is also
 * exactly what `gateParam` serializes, so what you drag to is what the URL says.
 */
export const GATE_STEP = 0.01;

/** `difficulty × centrality`, or nothing at all if either is missing. */
export function priorityOf(entry: GlossaryEntry): number | undefined {
  if (entry.difficulty === undefined || entry.centrality === undefined) return undefined;
  return entry.difficulty * entry.centrality;
}

/** How many entries clear a given bar. The number under the reader's hand. */
export function countAbove(entries: GlossaryEntry[], gate: number): number {
  let n = 0;
  for (const entry of entries) {
    const p = priorityOf(entry);
    if (p !== undefined && p >= gate) n += 1;
  }
  return n;
}

/**
 * Can this glossary be prioritised **at all** — is there anything to gate?
 *
 * One entry with both scores and something to compare it against. Note what
 * this is *not*: it is not "does the current gate divide the list", which is
 * `splitsOnPriority` and is a question about one position of the bar rather
 * than about the glossary. Offering the order is the first question; drawing a
 * divider is the second.
 */
export function canPrioritise(entries: GlossaryEntry[]): boolean {
  return entries.length > 1 && entries.some((e) => priorityOf(e) !== undefined);
}

/**
 * The right-hand end of the slider: the largest product this glossary actually
 * contains.
 *
 * Derived from the data rather than fixed at 1.00, because a fixed track would
 * be mostly dead. Real products cluster low — two scores of 0.7 make 0.49 — so
 * on a 0–1 track the top two thirds would promote nothing and every glossary
 * would be adjusted in the same narrow strip at the left. Ending the track at
 * the top term's own score means both ends mean something: hard left promotes
 * everything, hard right promotes exactly the costliest term.
 *
 * Rounded **down** to the step, not up. Floating-point products overshoot —
 * `0.8 × 0.8` is `0.6400000000000001` — and a maximum a whisker above the top
 * term's score is a right-hand end that promotes nothing, which is the one
 * value that end must not have.
 *
 * `gate` is folded in so that a `?gate=` beyond this glossary's range still has
 * somewhere to sit on the track rather than pinning the thumb at a number it
 * does not hold.
 */
export function gateMax(entries: GlossaryEntry[], gate: number): number {
  let top = 0;
  for (const entry of entries) {
    const p = priorityOf(entry);
    if (p !== undefined && p > top) top = p;
  }
  return Math.max(Math.floor(top / GATE_STEP) * GATE_STEP, gate, GATE_STEP);
}

/**
 * Does the gate actually divide this glossary in two?
 *
 * Not "are there scores" — **are there entries on both sides**. A two-group
 * list where every entry is in one of the groups is first-use order wearing a
 * label that claims a judgment was made, so when this is false the panel draws
 * one unheaded group and says so in words (`gateNote`).
 */
export function splitsOnPriority(entries: GlossaryEntry[], gate = PRIORITY_GATE): boolean {
  const above = countAbove(entries, gate);
  return above > 0 && above < entries.length;
}

/**
 * The order actually in force, which is not always the one in the URL.
 *
 * `?sort=prioritised` is the default, so it arrives on glossaries with no
 * scores at all — nothing to gate, no slider worth showing, and a label that
 * would claim a judgment nothing supports. Those fall back to `document`, and
 * `SortBar` does not offer the control. An old glossary behaves exactly as it
 * did before this order existed.
 *
 * **What no longer falls back, as of the slider (2026-08-26):** a glossary that
 * has scores but whose *current* gate does not divide it. That used to collapse
 * to `document` too. The slider reverses the argument, in both directions:
 *
 * - it would strand the reader. Drag the bar past the top term and the mode
 *   would cancel itself, taking the slider with it, and there would be no way
 *   back to the thing you were adjusting.
 * - it would hide the mechanism at the one moment the mechanism is the answer.
 *   An undivided list here is not silent: the bar is on screen with its number
 *   and its count, `gateNote` says in words that nothing (or everything)
 *   cleared it, and no divider claims otherwise. That is the opposite of the
 *   thing the condition on these scores was written against.
 */
export function effectiveSort(entries: GlossaryEntry[], sort: TermSort): TermSort {
  if (sort !== "prioritised") return sort;
  return canPrioritise(entries) ? "prioritised" : "document";
}

/**
 * What to say when the bar divides nothing, and nothing when it does.
 *
 * A control that visibly does nothing is the failure this codebase keeps
 * writing down (docs/reusable/silent-success.md). Drag the bar to the floor and
 * the two groups merge into one, which looks exactly like a broken slider
 * unless something says otherwise. This is that something.
 */
export function gateNote(entries: GlossaryEntry[], gate = PRIORITY_GATE): string | null {
  if (entries.length === 0 || splitsOnPriority(entries, gate)) return null;
  return countAbove(entries, gate) > 0
    ? "Every term clears this bar, so they are all in first-use order."
    : "No term clears this bar, so they are all in first-use order.";
}

/** A run of terms under one heading. `label: null` is the whole list, unheaded. */
export interface TermGroup {
  key: string;
  label: string | null;
  title?: string;
  entries: GlossaryEntry[];
}

/**
 * The list as the panel renders it: one group, or two with a divider.
 *
 * Every sort but `prioritised` is a single unheaded group, so the DOM for them
 * is what it always was. `prioritised` is two, **each in first-use order** —
 * which is where the third thing Greg asked for, first appearance, actually
 * lives. It is a stronger form of having it as a weight in a formula, and it
 * needs no explaining.
 *
 * An entry missing either score cannot clear the gate and lands in the lower
 * group. That is not scoring it as zero — nothing here compares it to anything
 * — it is the same rule the other sorts follow, which is that an entry the
 * model declined to score is not one it scored as trivial.
 */
export function groupEntries(
  entries: GlossaryEntry[],
  sort: TermSort,
  gate = PRIORITY_GATE,
): TermGroup[] {
  const one = (list: GlossaryEntry[]): TermGroup[] => [
    { key: "all", label: null, entries: list },
  ];
  if (sort !== "prioritised") return one(sortEntries(entries, sort));
  if (!splitsOnPriority(entries, gate)) return one(entries);

  const top: GlossaryEntry[] = [];
  const rest: GlossaryEntry[] = [];
  for (const entry of entries) {
    const p = priorityOf(entry);
    (p !== undefined && p >= gate ? top : rest).push(entry);
  }
  return [
    {
      key: "top",
      label: "worth knowing first",
      title: `The model called these both load-bearing and not obvious — centrality × difficulty of ${gate.toFixed(2)} or more, which is where the threshold above is set. In first-use order, like the rest.`,
      entries: top,
    },
    {
      key: "rest",
      label: "the rest",
      title: "Everything else this piece uses in a non-obvious way, in first-use order.",
      entries: rest,
    },
  ];
}

/** One number to put on a row, with the name of what it is. */
export interface RowScore {
  key: "difficulty" | "centrality";
  value: number;
}

/**
 * The numbers to put on a row: none, one, or both.
 *
 * **A function rather than a ternary at the call site, because the ternary was
 * wrong** and wrong in the one way this feature cannot afford. It read
 * `showScore === "difficulty" ? entry.difficulty : entry.centrality`, so a
 * `showScore` of `null` — the list in document order — fell through to the
 * `centrality` branch and printed the model's ranking beside every term in a
 * list that was not ranked by it.
 *
 * That is precisely the thing the condition on keeping these scores forbids:
 * the objection was never to the numbers existing, it was to the model's
 * prioritising arriving unasked. Found in the browser rather than by a test,
 * which is why there is now a test.
 *
 * The rule it keeps, now that a composite is involved: **a row shows exactly
 * the numbers its position was decided on, and shows none if its position could
 * not be decided on them.** So `prioritised` shows both — never the product,
 * which is our arithmetic dressed up as the model's judgment and a number the
 * reader can neither interpret nor check — and an entry missing either score
 * shows neither, which is what "this one could not be gated" looks like.
 */
export function rowScores(entry: GlossaryEntry, sort: TermSort | null): RowScore[] {
  const d = entry.difficulty;
  const c = entry.centrality;
  if (sort === "difficulty") return d === undefined ? [] : [{ key: "difficulty", value: d }];
  if (sort === "centrality") return c === undefined ? [] : [{ key: "centrality", value: c }];
  if (sort === "prioritised") {
    if (d === undefined || c === undefined) return [];
    return [
      { key: "difficulty", value: d },
      { key: "centrality", value: c },
    ];
  }
  return [];
}

/* ------------------------------------------------------- what an entry says --
   Rewritten 2026-08-26. Greg, looking at the entry for a person the article
   quotes once:

   > it's pretty weak! It adds almost nothing to the user's knowledge of Leslie
   > Lamport, nor does it add any useful explanatory gloss to help understand
   > the article itself. […] And "Goes beyond what the article says" is
   > vague/confusing - either be clearer, or indicate in the glossary entry
   > itself clearly […] which bits are/not from the article.

   Both halves of that have the same answer, and it is a field split rather
   than a better badge. See docs/plans/glossary-entries-worth-reading.md. */

/** One labelled section of an open entry. The label IS the provenance. */
export interface ProseSection {
  key: "senseHere" | "background";
  label: string;
  text: string;
}

export interface EntryProse {
  /** The one line a closed row shows. Empty only for an entry we would not store. */
  lead: string;
  /** The open row, labelled. Empty for an entry written before `glossary/2`. */
  sections: ProseSection[];
  /** True when this entry has the old single blended field and renders the old way. */
  legacy: boolean;
}

/**
 * What to put on a row, and under which label.
 *
 * **The lead is `senseHere` if there is one and `background` if there is not**,
 * and that single line is what makes the design self-correcting. The model is
 * told to leave `senseHere` out rather than restate a page the reader is
 * looking at — so for a person simply quoted it writes background only, and the
 * informative sentence is the one that reaches the closed row. The panel never
 * has to know what kind of term it is looking at.
 *
 * **Old entries render exactly as they did.** `glossary/1` wrote one `gloss`
 * that blended what the article means with what the model knows, and there is
 * no honest way to label a blend — putting it under "in this piece" would
 * attribute the model's own knowledge to the article, which is the one
 * direction of error this whole change exists to prevent. So it stays
 * unlabelled, keeps its `detail` and its warning badge, and stops being a
 * problem the moment somebody presses "Find them again" — which the panel is
 * already offering, because bumping the prompt version made every old glossary
 * read as stale.
 */
export function entryProse(entry: GlossaryEntry): EntryProse {
  const sections: ProseSection[] = [];
  if (entry.senseHere) {
    sections.push({ key: "senseHere", label: "in this piece", text: entry.senseHere });
  }
  if (entry.background) {
    sections.push({ key: "background", label: "background", text: entry.background });
  }
  if (sections.length === 0) {
    return { lead: entry.gloss ?? "", sections: [], legacy: true };
  }
  return { lead: sections[0]!.text, sections, legacy: false };
}

/** Which sorts this particular glossary can actually offer. */
function SortBar({
  entries,
  sort,
  onSort,
}: {
  entries: GlossaryEntry[];
  sort: TermSort;
  onSort(sort: TermSort): void;
}) {
  const options: { key: TermSort; label: string; title: string }[] = [
    /* Offered when this glossary has anything to gate — the same rule the two
       score sorts below follow, which is that a control that would visibly do
       nothing is worse than one that isn't there.

       It used to be the stricter `splitsOnPriority`, i.e. offered only when the
       *default* bar happened to divide this particular list. The slider made
       that wrong twice over: a list the default does not divide is now one drag
       away from being divided, so refusing to offer the order would be hiding
       the fix along with the problem — and the option would appear and vanish
       under the reader's hand as they dragged. See `effectiveSort`. */
    ...(canPrioritise(entries)
      ? [
          {
            key: "prioritised" as const,
            label: "prioritised",
            title:
              "The hard and load-bearing terms first, then the rest — each in the order the article introduces them",
          },
        ]
      : []),
    {
      key: "document",
      label: "first use",
      title: "In the order the article introduces them",
    },
    ...(entries.some((e) => e.difficulty !== undefined)
      ? [
          {
            key: "difficulty" as const,
            label: "hardest",
            title: "The model's judgment of how likely each term is to stop a reader",
          },
        ]
      : []),
    ...(entries.some((e) => e.centrality !== undefined)
      ? [
          {
            key: "centrality" as const,
            label: "most central",
            title: "The model's judgment of how much of the argument rests on each term",
          },
        ]
      : []),
  ];
  if (options.length < 2) return null;

  return (
    /* biome-ignore lint/a11y/useSemanticElements: <fieldset> is for form
       controls and wants a <legend>; these are three toggle buttons that
       change how a list is ordered, and `role="group"` with an accessible name
       is exactly what ARIA has for that. */
    <div className="gloss-sort" role="group" aria-label="Order the terms by">
      <span className="gloss-sort-label">order</span>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`gloss-sort-btn${sort === option.key ? " on" : ""}`}
          aria-pressed={sort === option.key}
          title={option.title}
          onClick={() => onSort(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The bar itself, with the reader's hand on it.
 *
 * Greg, 2026-08-26: *"Add a small threshold-slider to the Glossary UI (set to a
 * sensible default)"*. The sensible default is `PRIORITY_GATE`, and everything
 * else here is about the slider not being a mystery dial:
 *
 * - **the number is on screen**, because `0.42` is meaningless as a thumb
 *   position and meaningful as a product of two scores the rows also show;
 * - **the count is on screen**, `2 of 8`, which is the thing the reader
 *   actually cares about and the only feedback that survives a drag that does
 *   not happen to move anybody;
 * - **the track ends where the data does** (`gateMax`), so no part of it is
 *   dead and both ends mean something;
 * - **it says when it has divided nothing** (`gateNote`), which is the
 *   silent-success failure this codebase keeps catching itself in;
 * - **it can be put back**, without the reader having to remember 0.30.
 *
 * A native `<input type="range">` rather than anything built: it is draggable,
 * arrow-key steppable, announced by screen readers and touch-friendly for free,
 * and `accent-color` is the whole of the styling it needs.
 */
function GateSlider({
  entries,
  gate,
  moved,
  onGate,
}: {
  entries: GlossaryEntry[];
  gate: number;
  moved: boolean;
  onGate(gate: number | null): void;
}) {
  const promoted = countAbove(entries, gate);
  const note = gateNote(entries, gate);
  const count = `${promoted} of ${entries.length}`;

  return (
    <div className="gloss-gate">
      <div className="gloss-gate-row">
        <label className="gloss-gate-label" htmlFor="gloss-gate">
          threshold
        </label>
        <span className="gloss-gate-value">
          {gate.toFixed(2)} · {count}
        </span>
        {/* Only once there is something to undo. A reset that is always there
            is a permanent invitation to a state you are already in. */}
        {moved && (
          <button
            type="button"
            className="gloss-gate-reset"
            title={`Back to ${PRIORITY_GATE.toFixed(2)}`}
            aria-label={`Reset the threshold to ${PRIORITY_GATE.toFixed(2)}`}
            onClick={() => onGate(null)}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>
      <input
        id="gloss-gate"
        className="gloss-gate-range"
        type="range"
        min={0}
        max={gateMax(entries, gate)}
        step={GATE_STEP}
        value={gate}
        title="How high the bar is for the top group: the model's difficulty × its centrality. Left promotes more terms, right fewer."
        /* The thumb's position is a number nobody can hear. This is what makes
           it audible, and it is the count rather than the product because the
           count is what the reader is aiming at. */
        aria-valuetext={`${gate.toFixed(2)}, promoting ${count} terms`}
        onChange={(e) => onGate(Number.parseFloat(e.target.value))}
      />
      {note && <p className="gloss-gate-note">{note}</p>}
    </div>
  );
}

/**
 * One term. Closed it is a name and a line; open it is everything we have.
 *
 * The whole entry is a button rather than a name-sized one, because the target
 * in an 18rem band wants to be as big as it can be, and there is nothing else
 * inside a closed row to click.
 */
function Term({
  entry,
  selected,
  showScore,
  look,
  looking,
  lookBusy,
  lookFailed,
  onSelect,
  onJump,
}: {
  entry: GlossaryEntry;
  selected: boolean;
  showScore: TermSort | null;
  look(id: string): Promise<void>;
  /** A lookup is running for *this* term. */
  looking: boolean;
  /** A lookup is running for some term — one at a time, so every button waits. */
  lookBusy: boolean;
  lookFailed: string | null;
  onSelect(): void;
  onJump(id: BlockId): void;
}) {
  const scores = rowScores(entry, showScore);
  const prose = entryProse(entry);

  return (
    <li className={`gloss-term${selected ? " on" : ""}`}>
      <button
        type="button"
        className="gloss-term-btn"
        aria-expanded={selected}
        onClick={onSelect}
      >
        <span className="gloss-term-head">
          <span className="gloss-name">{entry.name}</span>
          {/* Not shown for `term`, which is the default and says nothing. The
              chip earns its space when it tells you this is a person or a book
              rather than a piece of vocabulary. */}
          {entry.kind !== "term" && entry.kind !== "other" && (
            <span className="gloss-kind">{entry.kind}</span>
          )}
          {/* One number under `hardest` or `most central`, both under
              `prioritised`, none in first-use order. Never the product: that is
              our arithmetic, not the model's judgment, and a number the reader
              can neither interpret nor check is the thing the condition on
              keeping these scores was written against. */}
          {scores.length > 0 && (
            <span
              className="gloss-score"
              title={scores.map((s) => `${s.key}: ${s.value.toFixed(2)}`).join(" · ")}
            >
              {scores.map((s) => (
                <span key={s.key} className="gloss-score-part">
                  <span className="gloss-score-key">{s.key[0]}</span>
                  {s.value.toFixed(2)}
                </span>
              ))}
            </span>
          )}
        </span>
        {/* Hidden while the entry is open, because the open state shows the
            same words again with a label on them. One line closed, the labelled
            structure open — no sentence appears twice, and the label does the
            provenance work rather than a badge underneath it. */}
        {!selected && <span className="gloss-gloss">{prose.lead}</span>}
      </button>

      {selected && (
        <div className="gloss-open">
          {/* Labelled sections, and the label is the whole provenance story:
              everything under "in this piece" is from the article, everything
              under "background" is the model's own knowledge. That is the
              answer to "which bits are/not from the article" — all of this one,
              none of that one — and it needs no marks inside the prose, which
              would mean markup in a stored string and a restricted renderer to
              show it. See the plan doc for why inline marking was rejected. */}
          {prose.sections.map((section) => (
            <div key={section.key} className={`gloss-part gloss-part-${section.key}`}>
              <p className="gloss-part-label">
                {section.label}
                {section.key === "background" && (
                  <Tooltip
                    content="The article doesn't say this — it's what the model knows about the term. Nothing here has been checked against a source."
                    placement="top"
                  >
                    <span
                      className="gloss-part-hint"
                      /* The same call CommentDialog's search badge makes, and for the
                         same reason: without it the only way to read this caption is
                         to hover it, so removing the tabIndex would take accessibility
                         away rather than add it. */
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the tooltip
                      tabIndex={0}
                      role="note"
                      aria-label="Where this section comes from"
                    >
                      <Info size={10} />
                    </span>
                  </Tooltip>
                )}
              </p>
              <p className="gloss-part-text">{section.text}</p>
              {/* The canonical link lives INSIDE the background section, because
                  checking the background is the only thing it is for. It is the
                  model's guess at a page rather than a source it visited — the
                  glossary call does not search — which is what the tooltip
                  says. */}
              {section.key === "background" && entry.url && (
                /* `rel="noreferrer"` as well as `noopener`: the article's own
                   URL is a reading history, and a model-supplied link should not
                   be handed ours as a referrer. The scheme was checked
                   server-side — `safeUrl` in src/glossary.ts — because a
                   `javascript:` href here would be a script injection with a
                   very short path. */
                <p className="gloss-link">
                  <Tooltip content={`Where to check this: ${entry.url}`} placement="top">
                    <a href={entry.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={11} />
                      {hostOf(entry.url)}
                    </a>
                  </Tooltip>
                </p>
              )}
            </div>
          ))}

          {/* What the web said, kept apart from what the model remembered. The
              two are never merged: a reader who cannot tell the checked answer
              from the recalled one has lost the thing the labels above exist to
              give them. */}
          <Looked
            entry={entry}
            look={look}
            looking={looking}
            busy={lookBusy}
            failed={lookFailed}
          />

          {entry.aliases.length > 0 && (
            <p className="gloss-aliases">also: {entry.aliases.join(", ")}</p>
          )}

          {/* Everything from here to the occurrence list is `glossary/1` only —
              one blended field, its paragraph, its badge and its bare link. Kept
              rendering rather than migrated, because a blend cannot be labelled
              honestly. `entryProse` says why. */}
          {prose.legacy && entry.detail && <p className="gloss-detail">{entry.detail}</p>}

          {prose.legacy && entry.fromOutside && (
            <p className="gloss-outside">
              <TriangleAlert size={11} />
              Goes beyond what the article says.
            </p>
          )}

          {prose.legacy && entry.url && (
            <p className="gloss-link">
              <a href={entry.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={11} />
                {hostOf(entry.url)}
              </a>
            </p>
          )}

          {/* Where the piece actually uses it. An empty list is not hidden: it
              means the model named a term this article does not use in those
              words, which is worth seeing rather than smoothing over. */}
          {entry.blocks.length > 0 ? (
            <p className="gloss-where">
              <span className="gloss-where-label">
                {entry.blocks.length === 1 ? "used in" : `used in ${entry.blocks.length} places`}
              </span>
              {entry.blocks.map((id) => (
                <BlockRef key={id} id={id} onJump={onJump} />
              ))}
            </p>
          ) : (
            <p className="gloss-nowhere">
              These exact words do not appear in the article. The definition may still be right;
              the term was named rather than quoted.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The web's answer for one term, or the button that asks for it.
 *
 * Greg, 2026-08-26: *"provide web citations (e.g. clickable links with
 * hover-tooltips for sources) if we're using the web"* — the conditional is
 * doing real work in that sentence, and this component is where the condition
 * becomes visible. The batch call that writes an entry **does not** search; its
 * `background` is the model's memory and its `url` is a guess at a canonical
 * page. So until somebody presses this, the honest thing to show is a button
 * rather than a badge claiming a check nobody ran.
 *
 * ## Three things it says that a simpler version would not
 *
 * **`searches: 0` is drawn, not hidden.** The model decides per call whether to
 * look anything up, so an answer with no searches is a real outcome — *I
 * already knew this* — and it is indistinguishable from a broken tool unless
 * something says which. Same call CommentDialog's search badge makes, and the
 * reason its comment gives: the absence of a search is a fact about the answer.
 *
 * **Sources are host names with the title in the tooltip.** The band is 18rem.
 * A page title is the useful thing to read and the wrong thing to lay out, so
 * the host is on the line and the title is one hover away — which is exactly
 * what was asked for, and it is `Tooltip.tsx` doing it rather than a `title=`
 * attribute, so it works on focus too.
 *
 * **The date is there.** An answer from the web is an answer about the web on
 * one day, and a lookup from a month ago is a different object from one from a
 * minute ago.
 */
function Looked({
  entry,
  look,
  looking,
  busy,
  failed,
}: {
  entry: GlossaryEntry;
  look(id: string): Promise<void>;
  looking: boolean;
  busy: boolean;
  failed: string | null;
}) {
  const lookup = entry.lookup;

  if (!lookup) {
    return (
      <div className="gloss-look">
        <button
          type="button"
          className="gloss-btn"
          /* Disabled while any lookup runs, not just this one. Each is a model
             call somebody pays for, and a panel that fires five because five
             rows were clicked spends money on a mis-click. */
          disabled={busy}
          title="One model call, with a web search if it decides it needs one. Kept afterwards."
          onClick={() => void look(entry.id)}
        >
          {looking ? <LoaderCircle size={12} className="cmt-spinner" /> : <Globe size={12} />}
          {looking ? "Checking…" : "Check the web"}
        </button>
        {/* The wait needs saying, not just spinning through. This call sends the
            whole article and may run a web search on top, so it can sit for the
            better part of a minute — long enough that a bare spinner reads as
            stuck. The search panel already had this and this did not, which is
            the only reason they differed.

            "Up to a minute", not "a few seconds", which is what this said for
            about an hour. The comment directly above already said "the better
            part of a minute" — so the code and the copy disagreed in the same
            screenful, and the copy was the optimistic one. Under-promising a
            wait is the version that makes a reader think it has hung.

            Both sentences earn their place: the first says why it is slow, so
            the wait is expected rather than suspicious; the second says the
            reader can leave, which is the thing that actually makes waiting
            bearable and is true — the answer is stored against the entry, not
            held in this component. Same promise the search panel makes.

            Unlike chat and explain, no words arrive while this runs: the answer
            appears whole. Making it stream is worth doing and is written up in
            docs/plans/streaming-the-slow-two.md — it needs a storage seam that
            was being rebuilt on the day this was written. */}
        {looking && (
          <p className="gloss-look-wait">
            The whole piece goes to the model, and it may search the web as well, so this can take
            up to a minute. You can carry on reading — the answer is saved against this term either
            way.
          </p>
        )}
        {failed && <p className="gloss-error">{failed}</p>}
      </div>
    );
  }

  const sources = lookup.citations.filter((c) => isWebUrl(c.url));

  return (
    <div className="gloss-look on">
      {/* **"checked" only when something was actually checked.** The model
          decides per call whether to search, so a lookup can come back with
          `searches: 0` — a real answer, and a memory one. Heading that
          "checked" and admitting otherwise in a tooltip is a provenance claim
          the reader has to hover to disprove, which is the same shape as the
          warning badge this panel spent a rewrite removing. Found in review. */}
      <p className="gloss-part-label">
        {lookup.searches > 0 ? "checked" : "asked, not checked"}
        <Tooltip
          content={
            lookup.searches > 0 ? (
              <>
                <strong>Searched the web.</strong> {lookup.searches}{" "}
                {lookup.searches === 1 ? "search" : "searches"} on{" "}
                {new Date(lookup.at).toLocaleDateString()}, by {lookup.model}. The sources below are
                what it cited.
              </>
            ) : (
              <>
                <strong>No web search.</strong> {lookup.model} judged it already knew, on{" "}
                {new Date(lookup.at).toLocaleDateString()}. It decides per question, so this is a
                choice rather than a setting — and it means this answer is memory too.
              </>
            )
          }
          placement="top"
        >
          <span
            className={`gloss-globe ${lookup.searches > 0 ? "on" : "off"}`}
            /* The same call the comment dialog's badge makes: focus is what
               makes the tooltip reachable without a mouse, and without it the
               only way to learn whether this answer was checked is to hover. */
            // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the tooltip
            tabIndex={0}
            role="img"
            aria-label={
              lookup.searches > 0
                ? `Searched the web ${lookup.searches} times`
                : "Answered without searching the web"
            }
          >
            <Globe size={11} />
          </span>
        </Tooltip>
      </p>
      <p className="gloss-part-text">{lookup.answer}</p>

      {sources.length > 0 && (
        <ul className="gloss-sources">
          {sources.map((c) => (
            <li key={c.url}>
              {/* The title in the tooltip and the host on the line. `rel` carries
                  `noreferrer` as well as `noopener` for the reason the canonical
                  link above does: the article's own URL is a reading history. */}
              <Tooltip content={c.title ?? c.url} placement="top">
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={10} />
                  {hostOf(c.url)}
                </a>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The two things you can do to a finished list, and where it came from.
 *
 * **"Find more terms" and "Start again" are genuinely different operations**,
 * which is why they are two buttons and not one with a modifier. Running the
 * step again appends (src/glossary.ts § `generateGlossary`), so there has to be
 * a separate way to say "this list is wrong" — and it deletes before it
 * regenerates, which is destructive, which is why it asks first.
 *
 * The confirm is the same shape as the thread page's rewrite: not a dialog, it
 * blocks nothing, and it says what the click costs before it is spent.
 */
function Foot({
  glossary,
  job,
  failed,
  onMore,
  onReset,
  onCancel,
}: {
  glossary: Glossary;
  job: Job | null;
  failed: string | null;
  onMore(): Promise<void>;
  onReset(): Promise<void>;
  onCancel(id: string): void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (job) {
    return (
      <div className="gloss-foot">
        <Progress job={job} failed={null} onRun={onMore} onCancel={onCancel} label="Find more" />
      </div>
    );
  }

  return (
    <div className="gloss-foot">
      {asking ? (
        <div className="gloss-confirm">
          <p>Throw these {glossary.entries.length} away and start over?</p>
          <button
            type="button"
            className="gloss-btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onReset();
              setBusy(false);
              setAsking(false);
            }}
          >
            {busy ? "Starting…" : "Start again"}
          </button>
          <button
            type="button"
            className="gloss-btn"
            disabled={busy}
            onClick={() => setAsking(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="gloss-actions">
          <button
            type="button"
            className="gloss-btn"
            title="Another model call, told what it has already found, looking for the quieter terms"
            onClick={() => void onMore()}
          >
            <Search size={12} />
            Find more
          </button>
          <button
            type="button"
            className="gloss-btn"
            title="Throw this list away and find a new one"
            onClick={() => setAsking(true)}
          >
            <RotateCcw size={12} />
            Start again
          </button>
        </div>
      )}

      {failed && <p className="gloss-error">{failed}</p>}

      {/* Provenance, quietly. `passes` is the number worth showing that nothing
          else would: a list that took three calls to build is a different
          object from one that took one, and it is the only way to see that
          "Find more" did anything. */}
      <p className="gloss-provenance">
        {glossary.generator} · {glossary.version} ·{" "}
        {glossary.passes === 1 ? "one pass" : `${glossary.passes} passes`}
      </p>
    </div>
  );
}

/**
 * The glossary's run button. Everything but the three constants below is in
 * `JobProgress`, which the summary panel and the thread page share.
 */
function Progress(props: {
  job: Job | null;
  failed: string | null;
  onRun(): Promise<void>;
  onCancel(id: string): void;
  label: string;
}) {
  return (
    <JobProgress {...props} step="glossary" icon={<Search size={13} />} runningLabel="Finding…" />
  );
}

/** `en.wikipedia.org`, so a link says where it goes without spending a line on it. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

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
 * - when the gate does not actually divide the list, all of this **falls back
 *   to first use** and the control is not offered.
 *
 * The four designs this was chosen from, and the two things it is a bet on, are
 * in docs/plans/glossary-prioritised-order.md.
 */
import { useState } from "react";
import {
  BookA,
  ExternalLink,
  Loader2,
  RotateCcw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import type { BlockId, Glossary, GlossaryEntry, Job } from "../types.js";
import type { TermSort } from "./params.js";
import { BlockRef } from "./BlockRef.js";
import type { UseGlossary } from "./useGlossary.js";

interface Props extends UseGlossary {
  /** The selected term, from `?term=`. Null is a list nobody has picked from. */
  termId: string | null;
  onTerm(id: string | null): void;
  sort: TermSort;
  onSort(sort: TermSort): void;
  /** Jump the article to a block, exactly as a gist cell does. */
  onJump(id: BlockId): void;
}

export function GlossaryPanel({
  status,
  glossary,
  stale,
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
  onJump,
}: Props) {
  /* `effectiveSort` and not `sort`: `prioritised` is the default, so it arrives
     on glossaries whose scores cannot support it, and everything below — the
     groups, the SortBar's pressed state, the numbers on each row — has to agree
     about what order the list is actually in. One call, one answer, passed
     down. */
  const all = glossary?.entries ?? [];
  const order = effectiveSort(all, sort);
  const groups = glossary ? groupEntries(all, order) : [];

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
          {stale && (
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
          )}

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
export function sortEntries(entries: GlossaryEntry[], sort: TermSort): GlossaryEntry[] {
  if (sort === "document") return entries;
  if (sort === "prioritised") return groupEntries(entries, sort).flatMap((g) => g.entries);
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

   The whole design is in docs/plans/glossary-prioritised-order.md. The three
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

   3. **It is self-cancelling.** When the gate does not actually divide the list
      it falls back to document order and the control is not offered, so an old
      glossary with no scores behaves exactly as it did before. */

/**
 * The gate: `difficulty × centrality`, both required.
 *
 * `0.30` is about `0.6 × 0.5` — the model called it more than half load-bearing
 * *and* more than half likely to stop you. It is a guess with no feedback loop
 * behind it, and it is one exported constant so it can be moved once we have
 * looked at real glossaries.
 *
 * An **absolute** gate rather than a relative "top third", deliberately, and
 * the reason is what each does when it is wrong. If the model's scores run hot
 * or cold, the absolute gate degenerates to one group — that is, to plain
 * first-use order, which is what this list did yesterday. A relative gate would
 * promote exactly a third whatever the scores said, which is inventing a
 * ranking that is not in the data and putting a label over it.
 */
export const PRIORITY_GATE = 0.3;

/** `difficulty × centrality`, or nothing at all if either is missing. */
export function priorityOf(entry: GlossaryEntry): number | undefined {
  if (entry.difficulty === undefined || entry.centrality === undefined) return undefined;
  return entry.difficulty * entry.centrality;
}

/**
 * Does the gate actually divide this glossary in two?
 *
 * Not "are there scores" — **are there entries on both sides**. SortBar already
 * refuses to offer a sort that would silently do nothing, and this is that rule
 * one step further on: a "prioritised" order over a list where everything (or
 * nothing) clears the gate is first-use order wearing a label that claims a
 * judgment was made.
 */
export function splitsOnPriority(entries: GlossaryEntry[]): boolean {
  let above = false;
  let below = false;
  for (const entry of entries) {
    const p = priorityOf(entry);
    if (p !== undefined && p >= PRIORITY_GATE) above = true;
    else below = true;
    if (above && below) return true;
  }
  return false;
}

/**
 * The order actually in force, which is not always the one in the URL.
 *
 * `?sort=prioritised` is the default and therefore arrives on lists that cannot
 * support it. Rather than let the panel show a selected control that does
 * nothing, everything downstream — the list, the SortBar's pressed state, the
 * numbers on each row — is driven by this instead of by the raw parameter.
 */
export function effectiveSort(entries: GlossaryEntry[], sort: TermSort): TermSort {
  if (sort !== "prioritised") return sort;
  return splitsOnPriority(entries) ? "prioritised" : "document";
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
export function groupEntries(entries: GlossaryEntry[], sort: TermSort): TermGroup[] {
  const one = (list: GlossaryEntry[]): TermGroup[] => [
    { key: "all", label: null, entries: list },
  ];
  if (sort !== "prioritised") return one(sortEntries(entries, sort));
  if (!splitsOnPriority(entries)) return one(entries);

  const top: GlossaryEntry[] = [];
  const rest: GlossaryEntry[] = [];
  for (const entry of entries) {
    const p = priorityOf(entry);
    (p !== undefined && p >= PRIORITY_GATE ? top : rest).push(entry);
  }
  return [
    {
      key: "top",
      label: "worth knowing first",
      title: `The model called these both load-bearing and not obvious — centrality × difficulty of ${PRIORITY_GATE.toFixed(2)} or more. In first-use order, like the rest.`,
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
    /* Offered only when the gate actually divides this list. Same rule the two
       score sorts below follow — a control that would visibly do nothing is
       worse than one that isn't there — and here it does a second job: it is
       what stops the *default* claiming a judgment was made about a glossary
       whose scores could not support one. */
    ...(splitsOnPriority(entries)
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
  onSelect,
  onJump,
}: {
  entry: GlossaryEntry;
  selected: boolean;
  showScore: TermSort | null;
  onSelect(): void;
  onJump(id: BlockId): void;
}) {
  const scores = rowScores(entry, showScore);

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
        <span className="gloss-gloss">{entry.gloss}</span>
      </button>

      {selected && (
        <div className="gloss-open">
          {entry.aliases.length > 0 && (
            <p className="gloss-aliases">also: {entry.aliases.join(", ")}</p>
          )}

          {entry.detail && <p className="gloss-detail">{entry.detail}</p>}

          {/* The model saying it went past the article, said out loud rather
              than left in the prose to be noticed. Borrowed from the best line
              in their prompt — see src/glossary.ts § SYSTEM. */}
          {entry.fromOutside && (
            <p className="gloss-outside">
              <TriangleAlert size={11} />
              Goes beyond what the article says.
            </p>
          )}

          {entry.url && (
            /* `rel="noreferrer"` as well as `noopener`: the article's own URL is
               a reading history, and a model-supplied link should not be handed
               ours as a referrer. The scheme was checked server-side —
               `safeUrl` in src/glossary.ts — because a `javascript:` href here
               would be a script injection with a very short path. */
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
 * The button, or the running job in its place.
 *
 * The step's own `label` and `detail` come off the server, so the text here is
 * the same text the add box shows — "Step 1 of 1" would tell you neither what
 * is slow nor what is about to fail. Same component shape as the thread page's,
 * and for the same reasons.
 */
function Progress({
  job,
  failed,
  onRun,
  onCancel,
  label,
}: {
  job: Job | null;
  failed: string | null;
  onRun(): Promise<void>;
  onCancel(id: string): void;
  label: string;
}) {
  if (job) {
    const step = job.steps.find((s) => s.name === "glossary");
    return (
      <div className="gloss-running">
        <Loader2 size={13} className="gloss-spin" />
        <span>{job.status === "queued" ? "Waiting for the queue…" : (step?.label ?? "Finding…")}</span>
        {step?.detail && <span className="gloss-detail-live">{step.detail}</span>}
        <button
          type="button"
          className="gloss-btn"
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
          take that event as its argument. The thread page was bitten by
          exactly this. */}
      <button type="button" className="gloss-btn primary" onClick={() => void onRun()}>
        <Search size={12} />
        {label}
      </button>
      {failed && <p className="gloss-error">{failed}</p>}
    </>
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

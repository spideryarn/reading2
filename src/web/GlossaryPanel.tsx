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
 * sort by them silently.** So the list arrives in document order, the sort is a
 * control you press, and the number you sorted by is shown on every row — an
 * order nobody can see the basis of is the thing that was actually objected to.
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
  const entries = glossary ? sortEntries(glossary.entries, sort) : [];

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

      {/* Sorting is only a question once there is a list, and only once the
          model actually returned the scores — an older glossary may have none,
          and offering a sort that would silently do nothing is worse than not
          offering it. */}
      {glossary && glossary.entries.length > 1 && (
        <SortBar entries={glossary.entries} sort={sort} onSort={onSort} />
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

          <ol className="gloss-list">
            {entries.map((entry) => (
              <Term
                key={entry.id}
                entry={entry}
                selected={entry.id === termId}
                /* Whichever score the list is ordered by is shown on every row.
                   An order the reader chose but cannot see the basis of is the
                   thing the objection to these scores was actually about. */
                showScore={sort === "document" ? null : sort}
                onSelect={() => {
                  // Pressing the selected term again clears it, which is what
                  // takes the underlines back out of the prose. There is no
                  // other affordance for that, and a selection you cannot
                  // cancel is a mode inside a mode.
                  if (entry.id === termId) return onTerm(null);
                  onTerm(entry.id);
                  const first = entry.blocks[0];
                  if (first) onJump(first);
                }}
                onJump={onJump}
              />
            ))}
          </ol>

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
 * Document order, or one of the model's two scores.
 *
 * Descending on both scores, because "hardest first" and "most central first"
 * are the questions people actually have — nobody opens a glossary looking for
 * the easiest word in it. A missing score sorts last rather than as zero: an
 * entry the model declined to score is not an entry it scored as trivial, and
 * treating the two the same is the small lie that makes a sort untrustworthy.
 *
 * Pure and exported, because it is the only part of this file with a right
 * answer — see tests/glossary-panel.test.ts.
 */
export function sortEntries(entries: GlossaryEntry[], sort: TermSort): GlossaryEntry[] {
  if (sort === "document") return entries;
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

/**
 * The number to put on a row, or nothing.
 *
 * **A function rather than a ternary at the call site, because the ternary was
 * wrong** and wrong in the one way this feature cannot afford. It read
 * `showScore === "difficulty" ? entry.difficulty : entry.centrality`, so a
 * `showScore` of `null` — the list in document order, the default — fell
 * through to the `centrality` branch and printed the model's ranking beside
 * every term in a list that was not ranked by it.
 *
 * That is precisely the thing the condition on keeping these scores forbids:
 * the objection was never to the numbers existing, it was to the model's
 * prioritising arriving unasked. Found in the browser rather than by a test,
 * which is why there is now a test.
 */
export function scoreShown(entry: GlossaryEntry, showScore: TermSort | null): number | undefined {
  if (showScore === "difficulty") return entry.difficulty;
  if (showScore === "centrality") return entry.centrality;
  return undefined;
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
  showScore: "difficulty" | "centrality" | null;
  onSelect(): void;
  onJump(id: BlockId): void;
}) {
  const score = scoreShown(entry, showScore);

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
          {score !== undefined && (
            <span className="gloss-score" title={`${showScore}: ${score.toFixed(2)}`}>
              {score.toFixed(2)}
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

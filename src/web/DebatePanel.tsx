/**
 * The debate, in the band between the spine and the prose — the fourteenth
 * mode, and the only one whose content is **not in the article at all**.
 *
 * Greg, 2026-09-05, asking for it:
 *
 * > Let's add a new mode … that gathers from the wider web about the article,
 * > e.g. reviews, critiques, etc (ideally from authoritative sources). … Provide
 * > citation/linking, with rich tooltips (e.g. with excerpts).
 *
 * Everything else in this band is derived from the piece. This goes out to the
 * open web and comes back with what other people have written — replies to this
 * piece, and the argument around the claims it makes. Full design in
 * docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md.
 *
 * ## The one thing to understand before reading any of it
 *
 * **The web search never comes back empty.** Stage 0 asked for pages responding
 * to an invented blog post at a domain that does not exist; three searches ran
 * and nine annotations came back, every one a real, correctly-cited page about
 * sourdough starters, and not one of them a response to anything. So *"nothing
 * found"* is not a state the wire produces — it is a state **we manufacture, by
 * refusing rows** (src/debate.ts).
 *
 * That is why this panel is mostly sentences. Four rows look exactly the same
 * whether the stage refused six or refused none, so nearly everything here that
 * is not a row is a disclosure: what the search returned, what survived, what
 * the quotations were checked against, and **which** of the two empty answers
 * this is.
 *
 * ## The three things a row keeps apart
 *
 *  1. **The host**, first and largest. Greg asked for *"ideally from
 *     authoritative sources"* and there is no honest way to rank authority: any
 *     list we maintain is wrong per domain, and on an ML paper the sharpest
 *     critique is routinely a pseudonymous blog. So the one authority signal a
 *     reader can judge for themselves leads the row, and the panel says the
 *     order carries no claim (`DEBATE_NO_RANKING`).
 *  2. **The quotation**, which is characters located in that page's own extract
 *     by the spaced matcher and stored as the *haystack's* spelling rather than
 *     the model's. It is the reader's one-action check.
 *  3. **The model's reading**, fenced off under *AI interpretation*.
 *     `relation`, `valence` and `applies` are what a model made of a stranger's
 *     page, and nothing in the returned evidence verifies any of them. Drawing
 *     them like the quotation would claim the first is as checkable as the
 *     second (the plan's § Attribution, rule 5).
 *
 * ## Valence is a direction with an icon, never a score
 *
 * Greg: *"Maybe we could also apply a positive/negative icon and red/green
 * colour scheme, but without a score, but it is useful to be able to see at a
 * glance where the critiques vs praise are"*. So: no percentage, no bar, no
 * number anywhere. A *"62% negative"* line hands the reader a verdict on a piece
 * they are in the middle of reading, which is the summary-shaped failure
 * docs/project/vision.md exists to refuse.
 *
 * And `neutral` and `unknown` are drawn **as calmly as the other two** — same
 * chip, same size, same words, a quiet colour rather than a warning one. A model
 * that cannot tell whether a page agrees should say so and be believed; the
 * closest thing in this app to that problem is docs/project/timeline.md's rule
 * about an undated row.
 *
 * ## Owner-only, on purpose, and only until Stage 4
 *
 * `DebateAccess` has one arm. The visitor's half waits for the contract its rows
 * must not bypass — `publicCitationUrl` re-judging every URL at the boundary,
 * where a refusal drops the whole row — which is Stage 4. A GPT Sol review
 * (F23) refused building the two together, because a "green" visitor panel would
 * then have been written against a sanitisation boundary that did not exist.
 */
import { useCallback, useMemo } from "react";
import {
  CircleHelp,
  Equal,
  ExternalLink,
  Globe,
  Info,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { FloatingArrow, FloatingPortal } from "@floating-ui/react";
import {
  DEBATE_CLAIMS_NONE,
  DEBATE_CLAIMS_UNVERIFIED,
  DEBATE_EXTRACTS_ONLY,
  DEBATE_NO_RANKING,
  DEBATE_RESPONSES_NONE,
  DEBATE_RESPONSES_UNVERIFIED,
} from "../messages.js";
import {
  type BlockId,
  type ClaimDebateRow,
  type DebateCounts,
  type DebateGroup,
  type DebateValence,
  type DirectDebateRow,
  distinctSources,
} from "../types.js";
import { BlockRef } from "./BlockRef.js";
import { JobProgress } from "./JobProgress.js";
import { useHoverCard } from "./useHoverCard.js";
import { useRenderCount } from "./perf.js";
import type { UseDebate } from "./useDebate.js";

/** Either group's row, so one component can draw both. */
type DebateRow = DirectDebateRow | ClaimDebateRow;

/** Group two's rows are the ones that answer a claim the article makes. */
function claimOf(row: DebateRow): ClaimDebateRow | null {
  return "claimQuote" in row ? row : null;
}

/** Group one's rows are the ones that name this article in their own extract. */
function referenceOf(row: DebateRow): string | null {
  return "articleReferenceQuote" in row ? row.articleReferenceQuote : null;
}

/**
 * **How each valence is drawn, and the record is total.**
 *
 * Four rows because there are four values, and a `Record<DebateValence, …>` so
 * a fifth cannot be added without somebody deciding what it looks like. The
 * *label* is what a reader actually reads — the icon is the glance and the word
 * is the meaning, so a colour-blind reader and a screen reader both get the
 * whole of it.
 *
 * **`tone` is a direction, not a position on a scale.** It resolves to two
 * colours off `--div-rg-*` (docs/project/colour-scales.md, the diverging red↔green
 * scale Greg asked for) plus one quiet grey, and it never reaches for the
 * scale's *middle* step: `--div-rg-4` is the centre of a ramp, and drawing
 * `neutral` there would say *zero on a scale we do not compute*. `neutral` and
 * `unknown` are two different facts — *it takes a side and it is neither* against
 * *we could not tell* — with two icons and two sentences, and one calm colour,
 * because neither of them is a failure.
 *
 * **The target of the valence is the row's own**, which is why the labels do not
 * name it: the article itself in group one, the `claimQuote` in group two. The
 * group heading says which, and the AI-interpretation block spells it out. Sol's
 * F19 — without a stated target "positive" could mean a friendly register,
 * agreement with one claim, or praise for the whole piece.
 */
export const VALENCE_APPEARANCE: Record<
  DebateValence,
  { icon: typeof Info; label: string; tone: "for" | "against" | "quiet" }
> = {
  positive: { icon: ThumbsUp, label: "Supportive", tone: "for" },
  negative: { icon: ThumbsDown, label: "Critical", tone: "against" },
  neutral: { icon: Equal, label: "Neither for nor against", tone: "quiet" },
  unknown: { icon: CircleHelp, label: "Could not tell", tone: "quiet" },
};

/**
 * **What the model offered, against what survived** — or nothing when nothing
 * was lost.
 *
 * The ✧ line Quotes draws, for the same reason and with the same discipline: a
 * list quietly shorter than the model produced is the shape of failure
 * docs/reusable/silent-success.md keeps catching, and a log line does not give
 * the reader anything.
 *
 * **The reasons are not named one by one**, unlike Quotes, and that is a
 * decision rather than laziness. Six of the seven — `uncited`, `selfSource`,
 * `unverifiedSource`, `directnessUnverified`, `claimNotInBlock`,
 * `unknownBlockId` — are all the same fact to a reader: *we could not check
 * this, so we did not show it*. Spelling them out would turn an honest
 * disclosure into a changelog of our own rules, which is exactly what
 * `discardedNote` next door refuses for its three editorial counters.
 *
 * **The cap gets a clause of its own**, and that is the one distinction worth
 * drawing here. A row past `MAX_DIRECT_ROWS` was not refused — nothing was
 * wrong with it, the list simply stopped — so folding it in with *"could not be
 * checked"* would tell the reader something false about a row that may have been
 * perfectly good. But it is still a loss they have a stake in: a cap that
 * stopped silently would make position a ranking in a feature built to have
 * none.
 */
export function keptNote(counts: DebateCounts): string | null {
  const lost = counts.reportedRows - counts.keptRows;
  if (lost <= 0) return null;
  /* `Math.max` because these are three numbers off a stored artefact and this is
     a panel, not an invariant: a negative here would print "-2 could not be
     checked", which is worse than saying nothing about a count that cannot
     happen. */
  const refused = Math.max(0, lost - counts.omittedOverCap);
  const clauses: string[] = [];
  if (refused > 0) {
    clauses.push(
      `${refused} could not be checked against the page ${refused === 1 ? "it cites" : "they cite"}`,
    );
  }
  if (counts.omittedOverCap > 0) {
    clauses.push(
      `${counts.omittedOverCap}${clauses.length > 0 ? " more" : ""} ` +
        `${counts.omittedOverCap === 1 ? "was" : "were"} past the limit on this list`,
    );
  }
  return (
    `The search offered ${counts.reportedRows} of these; ${countWord(counts.keptRows)} ` +
    `${counts.keptRows === 1 ? "is" : "are"} shown — ${clauses.join(", and ")}.`
  );
}

/**
 * `0` written as **none**, and every other number as itself.
 *
 * Both foot lines below reach zero often — group one keeping nothing is this
 * mode's second-commonest output — and *"0 are shown"* is the register of a
 * dashboard rather than of a sentence. The digits stay everywhere else, because
 * a reader comparing two counts in one line wants to compare figures.
 */
function countWord(n: number): string {
  return n === 0 ? "none" : String(n);
}

/**
 * **What the search returned, against what got into the answer** — or nothing
 * when the two agree.
 *
 * This is the counter a model can walk straight past with every other one
 * reading clean, and it is Sol's F13. Annotations arrive **independently of what
 * the model says**: Stage 0's probe answered with the single word `DONE` and Exa
 * still returned ten source annotations. So a model handed evidence from ten
 * pages can report three rows, have all three validate, and `reportedRows ===
 * keptRows === 3` with no loss sentence anywhere — while seven pages never
 * entered the answer at all.
 *
 * **It counts pages, not rows.** Rows are deliberately not deduplicated by URL —
 * one review can answer two different claims, and two rows about one page is a
 * real answer — so a row count here would fire on a truth.
 */
export function sourcesNote(
  counts: DebateCounts,
  rows: readonly { url: string }[],
): string | null {
  const contributing = distinctSources(rows);
  if (contributing === counts.returnedSources) return null;
  return (
    `The search returned evidence from ${counts.returnedSources} ` +
    `${counts.returnedSources === 1 ? "page" : "pages"}; ${countWord(contributing)} ` +
    `${contributing === 1 ? "contributes" : "contribute"} to the rows shown.`
  );
}

/**
 * **When the search ran, as a date.**
 *
 * Exported so a test can assert the panel's own spelling rather than pinning
 * `en-GB` — the browser's locale decides the word order and a test that hardcodes
 * one is testing the box it runs on.
 *
 * The string is unchanged if it does not parse. That cannot happen from
 * `src/debate.ts`, which writes `new Date().toISOString()`, but this is the only
 * function that reads the artefact's date characters and an odd string beats
 * `Invalid Date`.
 */
export function searchedOn(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * **The site a row came from**, which is the row's own headline.
 *
 * `www.` goes, because it is four characters of nothing on the one string this
 * panel asks the reader to judge. A URL that will not parse is shown whole —
 * it cannot happen, since every stored URL came out of `isWebUrl`, but the
 * fallback is a string rather than a throw inside a list.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * **What one group says when it has no rows**, and it is two sentences rather
 * than one.
 *
 * Collapsing them is the single thing most worth getting right in this panel
 * (docs/reusable/silent-success.md). *The search came back with no pages* and
 * *the search came back with pages we could not verify* are different facts
 * about the world, and the second is the common one: every quotation is checked
 * against the extract the **search engine** chose, which ran 236–4,945
 * characters in the Stage 0 measurements, so a real and apt quotation outside
 * that slice loses its row (Sol's F18).
 *
 * **The predicate is `returnedSources`, not a loss counter**, and that is a
 * refinement of the plan rather than a departure from it. Its § 2 table names
 * `unverifiedSource` for the middle row; `returnedSources` — added by the same
 * review, for F13 — is the field that actually answers *did the search come back
 * with anything to look at*, and it stays right in the case a loss counter gets
 * wrong: a model handed six pages that reports **no rows at all** loses nothing
 * to any counter, and would be told the search found nothing. That would be
 * false.
 *
 * The third empty state is not here: a failed pass writes no artefact at all, so
 * there is no group to be empty. The panel shows the ordinary job-failure state
 * with its retry, which is what `JobProgress` already draws.
 */
export function emptyGroupNote(
  counts: DebateCounts,
  group: "direct" | "claims",
): string {
  if (counts.returnedSources === 0) {
    return group === "direct" ? DEBATE_RESPONSES_NONE : DEBATE_CLAIMS_NONE;
  }
  return group === "direct" ? DEBATE_RESPONSES_UNVERIFIED : DEBATE_CLAIMS_UNVERIFIED;
}

/**
 * **The owner's half of this panel** — the read's status, the job that spends,
 * and the verbs.
 *
 * GlossaryPanel.tsx § GlossaryOwner has the argument for one panel with its data
 * injected rather than two panels for one list.
 */
export type DebateOwner = UseDebate;

/**
 * **Who is reading, and what they get — one prop, so the two cannot disagree.**
 *
 * One arm today. It is a union rather than a bare `owner` prop because the
 * second arm is already designed and deliberately deferred: Stage 4 adds
 * `{ kind: "visitor"; debate: PublicDebate; owner?: never }`, and `owner?: never`
 * is load-bearing there rather than tidy — without it the union catches only a
 * fresh object literal at the call site. GlossaryPanel.tsx § GlossaryAccess is
 * the full argument.
 */
export type DebateAccess = { kind: "owner"; owner: DebateOwner };

interface Props {
  access: DebateAccess;
  /**
   * Go to the block a group-two row's claim is in.
   *
   * **Marks in the prose are deliberately not in v1** — they are the first
   * thing to add, and they want a resolver into `search-hits.ts`'s `Found`
   * currency. A *jump* is not a mark: a row that quotes the article's own words
   * and names the block they are in has to offer the reader the way there, or it
   * is asking them to search for a sentence it is already holding.
   */
  onJump(id: BlockId): void;
}

export function DebatePanel({ access, onJump }: Props) {
  useRenderCount("DebatePanel");
  const owner = access.owner;
  const debate = owner.debate;
  const rows = useMemo(
    () => [...(debate?.direct.rows ?? []), ...(debate?.claims.rows ?? [])],
    [debate],
  );
  /**
   * **Pages, not rows**, and the two really do differ here: rows are
   * deliberately not deduplicated by URL, because one review can answer two
   * different claims and two rows about one page is a real answer. So a head
   * count of `rows.length` labelled *sources* would overstate how many places
   * this came from — the one number on this panel that a reader would take as a
   * measure of how much the web had to say. The counts beside the two group
   * headings are row counts, and are called that by sitting on a list.
   */
  const pages = distinctSources(rows);

  /**
   * The ⓘ card's contents, looked up from whatever the pointer is on.
   *
   * `useHoverCard` rather than `Tooltip`, and the difference is not a
   * preference: `Tooltip` sets `handleClose: null` on purpose — *"every card
   * here is read, not clicked"* — so the pointer cannot travel into it and a
   * link inside one is unreachable. This card carries a link out to a stranger's
   * page, which is the whole reason it exists. `useHoverCard` is the machinery
   * under `ProseHoverCard`, which the plan named for exactly this property; the
   * component itself is a page-level singleton bound to injected prose HTML and
   * is not reusable here.
   *
   * Called on every `pointerover` that hits the selector, so it is a Map lookup
   * and nothing else.
   */
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const read = useCallback(
    (el: HTMLElement): DebateRow | null => {
      const id = el.closest<HTMLElement>(".dbt-info")?.getAttribute("data-row");
      return (id && byId.get(id)) || null;
    },
    [byId],
  );
  const card = useHoverCard<DebateRow>({
    selector: ".dbt-info",
    /* The scroller survives its own re-render, which is the requirement — a
       row's `<li>` does not when the list is replaced by a re-run, and the
       observer would then be watching a detached node. useHoverCard.ts § host. */
    host: ".dbt-scroll",
    read,
    /* The trigger is a real `<button>` and therefore already a tab stop, so a
       reader moving through the list by keyboard lands on one whether we listen
       or not. Opening the card their pointer would have got is the whole of what
       parity costs here. */
    focusable: true,
    /* And a finger opens it, because the button does nothing else: this is not
       a link being taken over, it is a control whose only job is to reveal. */
    tapSelector: ".dbt-info",
  });

  /**
   * @param again beside a debate that is already there, so the run is forced.
   *   The empty state's button is not: it has to make the identical, unforced
   *   request the automatic run makes, or the two carry different `work_key`s
   *   and the reader pays for two web searches. useDebate.ts § `ensure`.
   */
  const run = (label: string, again = false) => (
    <JobProgress
      job={owner.job}
      starting={owner.starting}
      failed={owner.failed}
      stalled={owner.stalled}
      onRun={() => (again ? owner.regenerate() : owner.ensure())}
      onCancel={owner.cancel}
      label={label}
      step="debate"
      icon={<Globe size={13} />}
      runningLabel="Searching…"
    />
  );

  return (
    <aside className="mode-band gloss dbt" aria-label="Debate">
      <div className="band-head">
        <Globe size={14} className="band-head-icon" />
        <h2>Debate</h2>
        {debate && (
          <span className="gloss-count">
            {pages} {pages === 1 ? "page" : "pages"}
          </span>
        )}
      </div>

      {owner.error && <p className="gloss-error">{owner.error}</p>}

      {owner.status === "loading" && (
        <p className="gloss-quiet">Looking for what the web says…</p>
      )}

      {owner.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has asked the web about this one yet.</p>
          {/* The price, before the button rather than after it. Two model
              calls that each go out to the open web is the dearest press in
              this bar, and a reader is entitled to know that at the moment they
              decide. docs/project/copy.md. */}
          <p className="gloss-hint">
            Two searches of the open web — one for replies to this piece, one for the argument
            around what it claims. It takes half a minute, costs real money, and most pieces turn
            out to have no reception at all. Searched once and kept.
          </p>
          {run("Search the web")}
        </div>
      )}

      {debate && owner.status === "ready" && (
        <>
          {/* Stale wins when both are true, for the reason every sibling panel
              gives: it is the one that can make a row false rather than merely
              dated, and two banners stacked is a wall.

              **Neither of these is about the age of the search.** That is
              `searchedAt`, said below in its own words, and a year-old search
              on an unchanged article is not stale — it is dated, which is a
              thing a reader can weigh for themselves. src/types.ts §
              `Debate.searchedAt`. */}
          {owner.stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                The article has changed since this search ran, so some of these may be answering
                something the piece no longer says.
              </p>
              {run("Search again", true)}
            </div>
          ) : owner.outdated ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                This was searched by an older version of the prompt.
              </p>
              {run("Search again", true)}
            </div>
          ) : null}

          {/* **Two of the three disclosures at the top, and the third at the
              foot**, because they are needed at different moments and all three
              together were an eight-line wall over the first row in a 288px
              band (measured in a browser, 2026-09-05).

              *When it was asked* and *the order means nothing* both govern how
              you read the list, so they have to arrive before it: a reader
              looking at a list assumes its order carries a claim, and by the
              time they reach a foot line they have already read it that way.
              *What the quotation was checked against* is a question you ask
              **of a quotation**, so it is under the lists and on every ⓘ card —
              at the point of use, twice, rather than in front of everybody
              before there is anything to apply it to. */}
          <p className="dbt-frame">
            <span className="dbt-searched">Searched on {searchedOn(debate.searchedAt)}.</span>{" "}
            {DEBATE_NO_RANKING}
          </p>

          <div className="dbt-scroll">
            <Group
              heading="About this piece"
              blurb="Pages that name this article — its title, its address, or its title and byline — in their own words."
              group={debate.direct}
              which="direct"
              onJump={onJump}
            />
            <Group
              heading="About what it claims"
              blurb="Pages answering something the piece argues, whether or not they have ever heard of it."
              group={debate.claims}
              which="claims"
              onJump={onJump}
            />
            {/* Inside the scroller, so it sits under the last row rather than
                pinned above the button — it is provenance to read after the
                list, not a control. */}
            <p className="dbt-verified">{DEBATE_EXTRACTS_ONLY}</p>
          </div>

          {/* Below the lists: this is what you reach for after reading them and
              wanting a fresher answer, not before. Offered even when both
              groups are empty, and that is the difference from Timeline's
              equivalent — an empty timeline is a fact about the article, which
              running it again cannot change, while an empty debate is a fact
              about *one search on one day*, which is exactly what running it
              again does change. */}
          {!owner.stale && !owner.outdated && (
            <div className="dbt-again">{run("Search again", true)}</div>
          )}
        </>
      )}

      {card.shown && (
        <FloatingPortal>
          {/* `dialog` rather than `tooltip`: WAI's tooltip pattern says outright
              that a tooltip takes no focus and holds no focusable controls, and
              this one holds the link out. ProseHoverCard.tsx made the same call
              on the same review. */}
          <div {...card.anchorProps} role="dialog" aria-label="The passage this row cites">
            <div className="tooltip dbt-card">
              <Excerpt row={card.shown.data} />
              <FloatingArrow
                ref={card.arrowRef}
                context={card.context}
                className="tooltip-arrow"
                width={12}
                height={6}
                tipRadius={1}
                fill="var(--surface-raised)"
                stroke="var(--rule-strong)"
                strokeWidth={1}
              />
            </div>
          </div>
        </FloatingPortal>
      )}
    </aside>
  );
}

/**
 * One group — its heading, its rows or its one sentence, and its two foot lines.
 *
 * **The heading is drawn over an empty group**, unlike Timeline's, and that is
 * the point rather than an oversight: *"this search found nothing"* is a real
 * answer to a real question, and the question is in the heading. Dropping the
 * heading would leave a bare sentence with nothing saying which of the two
 * searches it is about — and group one being empty is this mode's commonest
 * correct output.
 */
function Group({
  heading,
  blurb,
  group,
  which,
  onJump,
}: {
  heading: string;
  blurb: string;
  group: DebateGroup<DirectDebateRow> | DebateGroup<ClaimDebateRow>;
  which: "direct" | "claims";
  onJump(id: BlockId): void;
}) {
  const rows: DebateRow[] = group.rows;
  const kept = keptNote(group.counts);
  const sources = sourcesNote(group.counts, rows);
  return (
    <section className="dbt-group">
      <h3>
        {heading}
        <span className="gloss-count">{rows.length}</span>
      </h3>
      <p className="dbt-blurb">{blurb}</p>

      {rows.length === 0 ? (
        <p className="gloss-quiet dbt-empty">{emptyGroupNote(group.counts, which)}</p>
      ) : (
        <ol className="dbt-list">
          {rows.map((row) => (
            <Row key={row.id} row={row} onJump={onJump} />
          ))}
        </ol>
      )}

      {/* Two different facts, and a group can say both: what the model offered
          against what survived, and what the search returned against what got
          into the answer. The second is the one nothing else would ever
          mention. */}
      {(kept || sources) && (
        <div className="dbt-foot">
          {kept && <p>{kept}</p>}
          {sources && <p>{sources}</p>}
        </div>
      )}
    </section>
  );
}

/** One source, and the three things a row keeps apart. See the file header. */
function Row({ row, onJump }: { row: DebateRow; onJump(id: BlockId): void }) {
  const look = VALENCE_APPEARANCE[row.valence];
  const Icon = look.icon;
  const claim = claimOf(row);
  return (
    <li className="dbt-item">
      <div className="dbt-row">
        {/* **The host is the row**, and it is a real `<a href>` so the browser's
            own affordances work — the status bar shows where it goes, and a
            middle-click opens it. `noreferrer` as well as `noopener`: this is a
            stranger's page and the address of the article being read is not its
            business. */}
        <a
          className="dbt-host"
          href={row.url}
          target="_blank"
          rel="noreferrer noopener"
          title={row.url}
        >
          {hostOf(row.url)}
          <ExternalLink size={11} aria-hidden="true" />
        </a>
        {/* The card is a hover and a tap, so the button's own press does
            nothing — `useHoverCard` opens it. `type="button"` all the same, or
            it submits any form it ever lands inside. */}
        <button
          type="button"
          className="dbt-info"
          data-row={row.id}
          aria-label="Show the passage this row cites"
        >
          <Info size={13} aria-hidden="true" />
        </button>
      </div>

      {/* The search result's own title, never the model's — the wire's, or
          nothing. */}
      {row.title && <p className="dbt-title">{row.title}</p>}

      {/* Characters we located in that page's own extract. A `<blockquote>`
          because that is what it is, and rendered as text: this is a slice of a
          stranger's page and nothing here may ever become markup. */}
      <blockquote className="dbt-quote">“{row.sourceQuote}”</blockquote>

      {/* Group two only: the article's own words for the claim being answered,
          located in the named block, and the way to it. */}
      {claim && (
        <p className="dbt-claim">
          <span className="dbt-claim-label">Answering</span> “{claim.claimQuote}”{" "}
          <BlockRef id={claim.blockId} onJump={onJump} />
        </p>
      )}

      {/* **The fence.** Everything above this is either the wire's or the
          article's; everything inside it is a model's reading of a stranger's
          page, and nothing in the returned evidence verifies any of it. */}
      <div className="dbt-ai">
        <p className="dbt-ai-label">AI interpretation</p>
        <p className="dbt-ai-fields">
          <span className="dbt-relation">{row.relation}</span>
          <span className={`dbt-valence dbt-valence-${look.tone}`}>
            <Icon size={12} aria-hidden="true" />
            {look.label}
          </span>
        </p>
        <p className="dbt-applies">{row.applies}</p>
        {/* Optional, and that is a correction the plan records: requiring it on
            every row manufactures caveats, so the prompt is told to omit a row
            rather than invent a limitation. */}
        {row.limits && <p className="dbt-limits">{row.limits}</p>}
      </div>
    </li>
  );
}

/**
 * The ⓘ card: the passage, what it was found in, and the way out to the page.
 *
 * What it adds over the row is the evidence the row cannot carry without
 * becoming unscannable — the page's full address, group one's witness that this
 * page names *this* article, and the sentence saying what the quotation was
 * checked against.
 *
 * Every string here is text. The excerpt is a slice of a stranger's page: a
 * `dangerouslySetInnerHTML` added later to highlight the matched span would be
 * an injection, and nothing else in this file would catch it.
 */
function Excerpt({ row }: { row: DebateRow }) {
  const reference = referenceOf(row);
  return (
    <div className="dbt-card-body">
      {row.title && <p className="dbt-card-title">{row.title}</p>}
      <p className="dbt-card-url">{row.url}</p>
      <blockquote className="dbt-card-quote">“{row.sourceQuote}”</blockquote>
      {/* Group one's whole claim is that this page is about this piece, and this
          is the witness for it: words from the source's own extract in which it
          names the article. A row without one cannot exist in that group.

          **This sentence became true on 2026-09-05** (Sol's F24). Until then the
          stage only checked that the words were somewhere in the extract, so a
          genuine quotation about something else was printed under "It names this
          article". `namesArticle` (src/debate.ts) is what makes the claim: the
          witness has to carry the article's address, its title, or a short title
          with the byline. */}
      {reference && (
        <p className="dbt-card-ref">
          It names this article: “{reference}”
        </p>
      )}
      <p className="dbt-card-note">{DEBATE_EXTRACTS_ONLY}</p>
      <a className="dbt-card-out" href={row.url} target="_blank" rel="noreferrer noopener">
        Read it on {hostOf(row.url)}
        <ExternalLink size={11} aria-hidden="true" />
      </a>
    </div>
  );
}

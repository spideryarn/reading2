/**
 * **Sources › Where it sits** — the owner's default since 2026-10-25: what
 * came after the piece, what it leans on, and the literature search, with
 * Sources' four tools under them. Plan
 * docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md
 * (decisions 1, 5, 7, 8 and 10, and § The simpler option), acting on Greg's
 * answer to q-vg2b69:
 *
 * > if there's something we can do for free, great, let's do that
 * > proactively. If there's something that's going to cost money, only do
 * > that when we open the sources mode. If it's going to cost a lot of money,
 * > like per citation or something, then maybe we only do that when the user
 * > requests something
 * >
 * > — Greg, 2026-10-25
 *
 * ```
 *  ┌ Where it sits │ Bibliography 17 │ Links 4 ┐                              (i)
 *  │ A piece from 1998: what has been said since       ← no dossier yet
 *  │ SEARCH OF THE LITERATURE  [ Search the literature ]  …what leaves
 *  │ AFTER IT                    ← OpenAlex's citers, most cited first
 *  │   Whatever next? · Clark · 2013 · cited 4,210 times  …  [ Show all 40 ]
 *  │ BEFORE IT                   ← Bibliography's works it leans on most
 *  │   Kirsh & Maglio 1994 · Putnam 1975 · Burge 1979 …
 *  │ Tools: Pages about it · Check a claim · Close to it, not cited · Ask your own question
 * ```
 *
 * **What it costs to open: nothing paid.** *After it* is the free OpenAlex
 * read Reception's *Cited by* already made (`useCiters`), *Before it* is
 * Bibliography, made on import and armed by a press here if missing
 * (activation.ts § `activationForSources`), and the dossier is the stored
 * one. *Search the literature*, the dearest press in Sources, is the
 * dossier's own button and nothing else (SituateDossier.tsx).
 *
 * **Lists first until you ask; after that, the dossier first** (decision 1,
 * B+). The two lists are ordered by the piece's age when its year is known:
 * an older piece has had time to be answered, so what came after leads; a
 * recent one has not, so what it leans on leads (`whereOrder`). With no year,
 * side by side.
 *
 * **The tools are plain links**, each setting `?sources=` and arming nothing
 * (plan § The simpler option; GPT Sol's F5): Reception, Claims, Not cited and
 * Investigate keep their panels, their addresses and their own buttons, and
 * each carries *Where it sits › its name* in its head, the first word the
 * way back (`ToolBack`). With the experimental switch on, *Experiments*
 * follows them: Guess first and Evidence first (plan 261025h, Stage 4;
 * SourcesExperiments.tsx), plain links too.
 *
 * **Owner only.** A visitor's band has no *Where it sits* and reads the bare
 * address as Bibliography (params.ts § `visitorSourcesView`): the citers have
 * no public projection yet (GPT Sol's F3).
 */
import { LoaderCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
import { CITERS_ABOUT, CITERS_LOADING } from "../messages.js";
import { MODE_LABEL } from "../title-text.js";
import type { BlockId, CitedWork } from "../types.js";
import { shortTitle, workShortName } from "./cited-in-paragraph.js";
import { investigateWorks } from "./InvestigatePanel.js";
import type { ItemFocus } from "./item-focus.js";
import { ModeSurface } from "./ModeSurface.js";
import { OrderGroup } from "./OrderGroup.js";
import { SOURCES_EXPERIMENTS, type SourcesChip, type SourcesExperiment, type SourcesView } from "./params.js";
import { CitersAnswer } from "./ReceptionAndClaimsPanel.js";
import { type SituateChats, SituateDossier } from "./SituateDossier.js";
import { SOURCES_SUB_MODES } from "./sub-modes.js";
import type { UseCiters } from "./useCiters.js";
import type { UseSituate } from "./useSituate.js";

/** The four addresses that are tools inside *Where it sits* rather than chips (params.ts § `chipOf`). */
export type SourcesTool = Exclude<SourcesView, SourcesChip | SourcesExperiment>;
/** What a crumb back to *Where it sits* can stand on: a tool, or one of the two experiments. */
export type WhereChild = SourcesTool | SourcesExperiment;

/** The tools row's order: what others wrote, the piece's own claims, what it leaves out, your own question. */
export const SOURCES_TOOLS: readonly SourcesTool[] = ["reception", "claims", "not-cited", "investigate"];

/**
 * **What each tool is called in the row**, in words that say what it does
 * rather than the sub-mode's name, which a reader meets only once inside
 * (Reception, Claims, Not cited, Investigate, sub-modes.ts).
 */
export const SOURCES_TOOL_LABEL: Readonly<Record<SourcesTool, string>> = {
  reception: "Pages about it",
  claims: "Check a claim",
  "not-cited": "Close to it, not cited",
  investigate: "Ask your own question",
};

/**
 * **The experiments' row**, after the tools, drawn only with the experimental
 * switch on (plan 261025h, Stage 4): their own lead-in, so a reader can tell
 * a finished tool from something to play with. Their labels are their names.
 */
export const WHERE_EXPERIMENTS_HEAD = "Experiments";
export const SOURCES_EXPERIMENT_LABEL: Readonly<Record<SourcesExperiment, string>> = {
  "guess-first": SOURCES_SUB_MODES["guess-first"].label,
  "evidence-first": SOURCES_SUB_MODES["evidence-first"].label,
};

/** What a crumb names the page it stands on. */
function whereChildLabel(child: WhereChild): string {
  return (SOURCES_EXPERIMENTS as readonly WhereChild[]).includes(child)
    ? SOURCES_EXPERIMENT_LABEL[child as SourcesExperiment]
    : SOURCES_TOOL_LABEL[child as SourcesTool];
}

/** *After it*'s two views (plan 261025h, decision 10): every citer, or those about the work's keyword. */
export const WHERE_AFTER_ALL = "Most cited";
export const WHERE_AFTER_VIEWS = "Which papers that cite it";
/** The second view's label: OpenAlex's keyword, in quotes. */
export function whereAboutLabel(keyword: string): string {
  return `About “${keyword}”`;
}
export const WHERE_ABOUT_TIP =
  "Only the papers citing it whose title or abstract mentions OpenAlex's own keyword for this piece. Asked from OpenAlex when you press it; no AI.";
export const WHERE_ABOUT_LOADING = "Asking OpenAlex for the papers about it…";
/** The server answered the plain list instead: the keyword view could not be read. */
export const WHERE_ABOUT_FELL_BACK = "OpenAlex's papers about it could not be listed just now, so these are all the papers that cite it.";

/** The crumb's way back, in its tooltip. */
export const WHERE_BACK_TIP = "Back to Where it sits";

/** The tools row's lead-in. */
export const WHERE_TOOLS_HEAD = "Tools";
/** The two lists' headings, and the line under each. */
export const WHERE_AFTER_HEAD = "After it";
export const WHERE_AFTER_WHAT = "Papers that cite it, most cited first";
export const WHERE_BEFORE_HEAD = "Before it";
export const WHERE_BEFORE_WHAT = "The works it leans on most";
/** How many of each list are on screen before *Show all* (After) or the way into Bibliography (Before). */
export const WHERE_AFTER_SHOWN = 5;
export const WHERE_BEFORE_SHOWN = 5;
/** *Before it*'s states with no rows. */
export const WHERE_BEFORE_LOADING = "Looking for the works it cites…";
export const WHERE_BEFORE_LISTING = "Listing the works it cites…";
export const WHERE_BEFORE_NONE = "The works this piece cites have not been listed yet.";
export const WHERE_BEFORE_EMPTY = "No works cited were found in this piece.";
export const WHERE_BEFORE_UNRATED = "None of the works it cites has been rated for how much the piece leans on it yet.";
/** *Before it*'s way to the whole list. */
export const WHERE_BEFORE_ALL = "All of them in Bibliography";
/** A row of *Before it*: what a press does. */
export const WHERE_BEFORE_OPEN = "Open in Bibliography";

/**
 * **How old a piece is before what came after it leads**: older than this
 * many years. A rule of thumb, not a measurement: a year or two is about how
 * long the first citing papers take to appear.
 */
export const WHERE_OLD_AFTER_YEARS = 2;

/** The year now, for the head line and the order. A function so a test can say which year it is. */
export type ThisYear = () => number;
const thisYear: ThisYear = () => new Date().getUTCFullYear();

/**
 * **The head line**, from the piece's year: *A piece from 1998: what has been
 * said since*, or for a recent one *…: where it sits now*. With no year, a
 * neutral line rather than a guess. "Piece" because Sources is for any
 * article, not only papers.
 */
export function whereHeadLine(year: number | null, now: number): string {
  if (year === null) return "What has been said about this piece, and what it builds on";
  return now - year > WHERE_OLD_AFTER_YEARS
    ? `A piece from ${year}: what has been said since`
    : `A piece from ${year}: where it sits now`;
}

/** **Which list leads**: *After it* for an older piece, *Before it* for a recent one, side by side with no year. */
export type WhereOrder = "after-first" | "before-first" | "side-by-side";
export function whereOrder(year: number | null, now: number): WhereOrder {
  if (year === null) return "side-by-side";
  return now - year > WHERE_OLD_AFTER_YEARS ? "after-first" : "before-first";
}

/** What *Before it* is handed: Bibliography's state, enough to say why there are no rows. */
export interface WhereBefore {
  status: "loading" | "none" | "ready" | "error";
  works: readonly CitedWork[] | null;
  /** Bibliography's job is running (armed by *Where it sits*' press, or the import's). */
  listing: boolean;
}

export function WhereItSitsPanel({
  head,
  situate,
  citers,
  before,
  articleYear,
  chats,
  onJump,
  onOpenWork,
  onView,
  toolCounts = {},
  findingFocus = null,
  onFindingFocusTaken,
  experiments = false,
  now = thisYear,
}: {
  /** Sources' chip row (SourcesMode.tsx § `SourcesViews`), drawn as this band's header. */
  head: ReactNode;
  /** The literature search: its stored dossier, its job and its press (useSituate.ts). */
  situate: UseSituate;
  /** OpenAlex's citers, Reception's *Cited by* read (useCiters.ts). */
  citers: UseCiters;
  before: WhereBefore;
  /** The piece's year from its metadata, or `null`. The dossier's own year stands in when this has none. */
  articleYear: number | null;
  /** A finding's chat (SituateDossier.tsx § `SituateChats`). */
  chats: SituateChats;
  onJump(id: BlockId): void;
  /** Open Bibliography on one work (Reader.tsx § `openBibliographyWork`). */
  onOpenWork(workId: string): void;
  /** Go to another sub-mode: a tool, or Bibliography. A plain move: it arms nothing. */
  onView(view: SourcesView): void;
  /** A tool's number beside its link, when it has one worth saying (sources-counts.ts). */
  toolCounts?: Partial<Record<SourcesTool, number>>;
  /** One finding to bring into view, once — a margin line's *Open in Sources*, or its chat's way back. */
  findingFocus?: ItemFocus | null;
  onFindingFocusTaken?: ((focus: ItemFocus) => void) | undefined;
  /** The experimental switch: draw the experiments' links after the tools (plan 261025h, Stage 4). */
  experiments?: boolean;
  now?: ThisYear;
}) {
  const made = situate.status === "ready" ? situate.situate : null;
  const year = articleYear ?? (typeof made?.year === "number" ? made.year : null);
  const nowYear = now();
  const order = whereOrder(year, nowYear);
  const after = (
    <section key="after" className="where-section where-after" aria-labelledby="where-after-head">
      <h3 id="where-after-head" className="rcp-group-head where-head">
        {WHERE_AFTER_HEAD}
      </h3>
      <p className="gloss-quiet where-what">{WHERE_AFTER_WHAT}</p>
      <AfterIt citers={citers} />
    </section>
  );
  const beforeList = (
    <section key="before" className="where-section where-before" aria-labelledby="where-before-head">
      <h3 id="where-before-head" className="rcp-group-head where-head">
        {WHERE_BEFORE_HEAD}
      </h3>
      <p className="gloss-quiet where-what">{WHERE_BEFORE_WHAT}</p>
      <BeforeIt before={before} onOpenWork={onOpenWork} onAll={() => onView("bibliography")} />
    </section>
  );
  return (
    <ModeSurface
      label={MODE_LABEL.sources}
      feature="gloss where sources"
      mode="sources"
      about={
        <>
          <p>{WHERE_ABOUT}</p>
          <p>{CITERS_ABOUT}</p>
        </>
      }
      head={head}
    >
      <div className="tl-scroll where-scroll">
        {/* The dossier's own head line says what the planner made of the
            piece once it has run; before then, this one says what the band
            is looking at (plan § Stage 2). Never both. */}
        {made === null && <p className="where-headline">{whereHeadLine(year, nowYear)}</p>}
        <SituateDossier
          owner={situate}
          chats={chats}
          onJump={onJump}
          focus={findingFocus}
          onFocusTaken={onFindingFocusTaken}
        />
        <div className={`where-lists where-lists-${order}`} data-where-order={order}>
          {order === "before-first" ? [beforeList, after] : [after, beforeList]}
        </div>
        <nav className="where-tools" aria-label={`${SOURCES_SUB_MODES.where.label}: ${WHERE_TOOLS_HEAD.toLowerCase()}`}>
          <span className="where-tools-head">{WHERE_TOOLS_HEAD}:</span>
          {SOURCES_TOOLS.map((tool) => {
            const n = toolCounts[tool];
            return (
              <button
                key={tool}
                type="button"
                className="where-tool"
                data-tool={tool}
                data-tip={`${SOURCES_SUB_MODES[tool].description}.`}
                onClick={() => onView(tool)}
              >
                {SOURCES_TOOL_LABEL[tool]}
                {n !== undefined && n > 0 && <span className="rcp-view-count">{n}</span>}
              </button>
            );
          })}
          {/* Behind the experimental switch, and nowhere else: no chip, no
              command-bar row (params.ts § `SOURCES_EXPERIMENTS`). Plain moves,
              arming nothing, as the tools are. */}
          {experiments && (
            <span className="where-experiments">
              <span className="where-tools-head">{WHERE_EXPERIMENTS_HEAD}:</span>
              {SOURCES_EXPERIMENTS.map((experiment) => (
                <button
                  key={experiment}
                  type="button"
                  className="where-tool"
                  data-tool={experiment}
                  data-tip={`${SOURCES_SUB_MODES[experiment].description}.`}
                  onClick={() => onView(experiment)}
                >
                  {SOURCES_EXPERIMENT_LABEL[experiment]}
                </button>
              ))}
            </span>
          )}
        </nav>
      </div>
    </ModeSurface>
  );
}

/** The (i)'s first paragraph: what the band is made of, and what costs what. */
export const WHERE_ABOUT =
  "After it and Before it cost nothing and use no AI: the papers that cite this piece, from OpenAlex, and the works Bibliography rates the piece as leaning on most. Search the literature is the one press here that pays for an AI: it runs only when you press it. The tools below each open their own view, and nothing starts until you press a button there.";

/**
 * ***Before it*** — Bibliography's works the piece leans on most, a press
 * each opening its row there. The ranking is Investigate's (`investigateWorks`):
 * by the model's `relevance`, a work with no rating left out.
 */
function BeforeIt({
  before,
  onOpenWork,
  onAll,
}: {
  before: WhereBefore;
  onOpenWork(workId: string): void;
  onAll(): void;
}) {
  if (before.works === null) {
    const line = before.listing
      ? WHERE_BEFORE_LISTING
      : before.status === "loading"
        ? WHERE_BEFORE_LOADING
        : WHERE_BEFORE_NONE;
    return <p className="gloss-quiet where-before-none">{line}</p>;
  }
  if (before.works.length === 0) return <p className="gloss-quiet where-before-none">{WHERE_BEFORE_EMPTY}</p>;
  const shown = investigateWorks(before.works, WHERE_BEFORE_SHOWN);
  return (
    <>
      {shown.length === 0 ? (
        <p className="gloss-quiet where-before-none">{WHERE_BEFORE_UNRATED}</p>
      ) : (
        <ul className="where-before-list">
          {shown.map((work) => {
            const byline = workShortName({
              title: "",
              ...(work.authors !== undefined ? { authors: work.authors } : {}),
              ...(work.year !== undefined ? { year: work.year } : {}),
            }).trim();
            return (
              <li key={work.id} data-citation-id={work.id}>
                <button
                  type="button"
                  className="where-work"
                  data-tip={WHERE_BEFORE_OPEN}
                  aria-label={`${WHERE_BEFORE_OPEN}: ${work.title.trim()}`}
                  onClick={() => onOpenWork(work.id)}
                >
                  {/* The article's own reference words, so the author's face
                      (docs/project/fonts.md), as Investigate draws them. */}
                  <span className="where-work-title voice-author">{shortTitle(work.title.trim())}</span>
                  {byline !== "" && <span className="where-work-by">{byline}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="rcp-more where-before-all" onClick={onAll}>
        {WHERE_BEFORE_ALL} ({before.works.length})
      </button>
    </>
  );
}

/**
 * ***Where it sits › Pages about it***, in a tool's head beside the chip row:
 * the four tools are not chips, so this is how a reader inside one knows where
 * they are, and *Where it sits* is the way back (plan § The simpler option,
 * which calls it *← Where it sits*). A crumb in words rather than an arrow and
 * words, which the house has retired for a way back (tests/back-link.test.tsx).
 * A plain move, arming nothing. The two experiments carry the same crumb.
 */
export function ToolBack({ tool, onBack }: { tool: WhereChild; onBack(): void }) {
  return (
    <span className="where-crumb">
      <button type="button" className="where-back" data-tip={WHERE_BACK_TIP} onClick={onBack}>
        {SOURCES_SUB_MODES.where.label}
      </button>
      <span className="where-crumb-tool" aria-current="page">
        {whereChildLabel(tool)}
      </span>
    </span>
  );
}

/**
 * ***After it*** — OpenAlex's citers, and for a much-cited piece a second
 * view beside *Most cited*: *About "extended mind"*, the citers whose title or
 * abstract mentions OpenAlex's own keyword for the work (plan 261025h,
 * decision 10, GPT Sol's F15). A reader's choice, never an automatic filter:
 * the list starts unfiltered, and the keyword view is asked of OpenAlex on
 * the press that chooses it (`askTopic`), never on open (S1-F5).
 *
 * **Which view is on is this panel's state, not the address.** A link
 * carrying it would have to either fetch the keyword view on arrival, which
 * the press-only rule forbids, or name a view it is not showing; it is
 * *Show all*'s kind of choice, a fold in one list, and leaving *Where it
 * sits* puts it back to *Most cited*. sources.md § Where it sits.
 *
 * The count beside the label is there only once OpenAlex's keyword list has
 * been fetched once (the server's `#topic` row, or this press's answer).
 */
function AfterIt({ citers }: { citers: UseCiters }) {
  const [about, setAbout] = useState(false);
  const plain = citers.result;
  if (plain === null) {
    return (
      <p className="rcp-citers-note" role="status">
        <LoaderCircle size={13} className="cmt-spinner" aria-hidden="true" /> {CITERS_LOADING}
      </p>
    );
  }
  const topic = plain.kind === "found" ? plain.topic : undefined;
  if (topic === undefined) return <CitersAnswer result={plain} onRetry={citers.retry} shown={WHERE_AFTER_SHOWN} />;
  const asked = citers.topic;
  const filtered = asked?.kind === "found" && asked.filteredBy !== undefined ? asked : null;
  const count = filtered?.topic?.count ?? topic.count;
  const label = whereAboutLabel(topic.keyword);
  return (
    <>
      <OrderGroup label={WHERE_AFTER_VIEWS} selected={about ? "about" : "all"}>
        <button
          type="button"
          className={`gloss-sort-btn${about ? "" : " on"}`}
          aria-pressed={!about}
          onClick={() => setAbout(false)}
        >
          {WHERE_AFTER_ALL}
        </button>
        <button
          type="button"
          className={`gloss-sort-btn where-about${about ? " on" : ""}`}
          aria-pressed={about}
          aria-label={count === undefined ? label : `${label}, ${count} papers`}
          data-tip={WHERE_ABOUT_TIP}
          onClick={() => {
            setAbout(true);
            citers.askTopic();
          }}
        >
          {/* OpenAlex's keyword: a stranger's words, drawn as text. */}
          {label}
          {count !== undefined && <span className="rcp-view-count">{count.toLocaleString("en-GB")}</span>}
        </button>
      </OrderGroup>
      {!about ? (
        <CitersAnswer key="all" result={plain} onRetry={citers.retry} shown={WHERE_AFTER_SHOWN} />
      ) : asked === null || asked === undefined ? (
        <p className="rcp-citers-note" role="status">
          <LoaderCircle size={13} className="cmt-spinner" aria-hidden="true" /> {WHERE_ABOUT_LOADING}
        </p>
      ) : filtered !== null ? (
        <CitersAnswer key="about" result={filtered} onRetry={citers.retryTopic} shown={WHERE_AFTER_SHOWN} />
      ) : asked.kind === "found" ? (
        <>
          <p className="rcp-citers-note where-about-fell-back">{WHERE_ABOUT_FELL_BACK}</p>
          <CitersAnswer key="all" result={plain} onRetry={citers.retry} shown={WHERE_AFTER_SHOWN} />
        </>
      ) : (
        <CitersAnswer key="about" result={asked} onRetry={citers.retryTopic} shown={WHERE_AFTER_SHOWN} />
      )}
    </>
  );
}

/**
 * The timeline, in the band between the spine and the prose — the eleventh mode.
 *
 * It answers ***when does the piece say these things happened***, which is not
 * the same question as *when did they happen*. The distinction is the whole
 * mode: every row is the article's own claim about time, kept at the strength
 * the article made it.
 *
 * ## v1 writes the words, and that is not merely the cheap version
 *
 * Greg deferred the drawn notation on 2026-08-31 — *"it's fine to defer the
 * fancy UI stuff till later"* — so there are no marks, no glyph legend and no
 * bar. The date column says `at or before 12 May`, `1 May – 31 May`, the
 * article's own *"another month later"*, or `—`.
 *
 * Which is **also the accessible version**. The deferred notation needed every
 * glyph `aria-hidden`, a spoken sentence per row, and the marks drawn as SVG so
 * they did not depend on the reader's fonts. Plain words need none of that:
 * they are already the sentence. Anyone adding the marks later is adding an
 * enhancement over this, not replacing it.
 * docs/plans/260831i-timeline-mode.md § Appendix: the visual design, deferred.
 *
 * ## The four states are the design, and collapsing any two loses the article
 *
 * `dating` is a discriminated union with four members and they draw four
 * different rows. This is not defensive completeness — **ten of the twenty-six
 * rows on the test article carry no date**, so the undated cases are the common
 * ones:
 *
 * | `dating.kind` | the date column |
 * |---|---|
 * | `dated` | the interval, in words |
 * | `words` | **the article's own phrase, quoted** — *"another month later"* |
 * | `untimed` | `—`. The piece gives no time at all |
 * | `rejected` | a short label, differing by `reason` |
 *
 * The pair most easily collapsed is `words` and `untimed`, and collapsing them
 * is the one mistake that throws away something the article actually said: a
 * piece that wrote *"another month later"* has dated the event as far as it
 * ever will, and a blank there claims it said nothing.
 *
 * `rejected` is the third outcome the review insisted on, and it never occurs
 * on an article that has a publication date — which is why it is easy to get
 * wrong and why the preview page fabricates one. On a **frameless** article,
 * which is most of the shelf until every piece has been re-extracted, it is the
 * *only* dated state there is.
 *
 * ## What this panel does NOT own
 *
 * The marks in the prose. `TimelineBand` in App.tsx resolves the selected
 * event into `Found[]` and pushes it up, for the same reason `IdeasBand` does —
 * the panel and the prose have to be showing the same set, and resolution can
 * drop an occurrence whose block a re-extraction removed.
 *
 * It also paints no lane down the spine. That is on the deferred list with the
 * marks, deliberately, so the first version is one thing.
 */
import { Clock, TriangleAlert } from "lucide-react";
import type { BlockId, Dating, Timeline, TimelineEvent, TimelineModality, When } from "../types.js";
import type { PublicTimeline } from "../public-types.js";
import type { UseTimeline } from "./useTimeline.js";
import type { Found } from "./search-hits.js";
import { BlockNav, nudgeTo } from "./BlockNav.js";
import { BlockRef } from "./BlockRef.js";
import {
  DATE_REJECTED_SHORT,
  DATE_REJECTED_WHY,
  TIMELINE_NO_CHRONOLOGY,
  TIMELINE_THIN,
} from "../messages.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { ReadError } from "./ReadError.js";
import { AboutMade } from "./BandAbout.js";
import { useRenderCount } from "./perf.js";

/**
 * **How few events before this stops calling itself a timeline.**
 *
 * Three, and the reasoning rather than the number is the point: one or two
 * dated things is an article that mentions a date, and three in sequence is a
 * chronology. Below the threshold the rows still show — the reader asked and
 * there is something to show them — but the panel says the piece is not really
 * telling a story in time, because two rows presented *as a timeline* is the
 * panel overclaiming and the reader cannot tell from the rows alone.
 *
 * A constant with its reasoning beside it rather than a `< 3` inline, which is
 * what docs/plans/260831i-timeline-mode.md § Most articles are not chronological asks
 * for.
 */
export const A_CHRONOLOGY = 3;

/**
 * The month names, indexed from 1 so the ISO string's own numbering works.
 *
 * Short forms, because this sits in a column about twenty characters wide and
 * "September" alone would wrap every row it appears in.
 *
 * **Not `toLocaleDateString`, and that is the one trap this file has to avoid.**
 * Anything that goes through the platform `Date` constructor picks up a
 * timezone: `new Date("2026-05-12")` is midnight **UTC**, so west of Greenwich
 * it formats as 11 May. Every date here is an ISO string, split on its hyphens
 * and read as integers, and never becomes a `Date`.
 * docs/plans/260831i-timeline-mode.md § The traps, item 3.
 */
const MONTHS = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * One ISO day as the reader sees it — `12 May`, or `12 May 2026`.
 *
 * `withYear` is decided once for the whole panel rather than per row, by
 * `oneYear` below: a list that is all in 2026 says so once at the top and
 * spends no column width repeating it, and a list that spans years carries the
 * year on every row because there the year is the content.
 *
 * Returns the string unchanged if it is not a day-precision ISO date. That
 * cannot happen from `src/timeline-time.ts`, which builds every one of these by
 * integer arithmetic — but this is the only function that reads the artefact's
 * date characters, and showing an odd string is better than showing `NaN`.
 */
export function formatDay(iso: string, withYear: boolean): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, year, month, day] = m as unknown as [string, string, string, string];
  const name = MONTHS[Number(month)] ?? month;
  return `${Number(day)} ${name}${withYear ? ` ${year}` : ""}`;
}

/**
 * **The interval, said in words.** The whole of the deferred notation, as a
 * sentence fragment that fits in the date column.
 *
 * The five shapes, and each is a different claim about the evidence:
 *
 * | the interval | the words |
 * |---|---|
 * | both ends, equal | `26 May` |
 * | both ends, `extended` | `13 Jul – 19 Jul` — the event **lasted** this long |
 * | both ends, `instant` | `between 13 Jul and 19 Jul` — it happened once, in there |
 * | only `latest` | `at or before 12 May` |
 * | only `earliest` | `at or after 14 Jul` |
 *
 * The third row is the one worth stopping on. A range on an `instant` event is
 * *uncertainty about when*, and a range on an `extended` one is *a duration* —
 * the same two dates meaning two different things, which is exactly why
 * `extent` survived the cut when `basis` and `granularity` did not. Drawing
 * them identically would tell the reader that "during May" and "we are not sure
 * which day in May" are the same claim.
 *
 * "at or before" rather than "by", spelled out: **"by 12 May" is what five of
 * the test article's twenty-four expressions say, and a reader skimming a
 * column reads "by 12 May" as "on 12 May"**. The extra two words are the entire
 * difference between a bound and a point, and this column exists to carry it.
 */
export function whenWords(when: When, withYear: boolean): string {
  const { earliest, latest } = when;
  if (earliest !== null && latest !== null) {
    if (earliest === latest) return formatDay(earliest, withYear);
    return when.extent === "extended"
      ? `${formatDay(earliest, withYear)} – ${formatDay(latest, withYear)}`
      : `between ${formatDay(earliest, withYear)} and ${formatDay(latest, withYear)}`;
  }
  if (latest !== null) return `at or before ${formatDay(latest, withYear)}`;
  if (earliest !== null) return `at or after ${formatDay(earliest, withYear)}`;
  /* Unreachable from the parser, which refuses rather than returning a `When`
     with no bounds at all — but `dating.kind === "dated"` is the artefact's
     claim and this is a file that reads artefacts off a disk. An open interval
     genuinely says nothing, and saying nothing is what the dash means. */
  return NO_DATE;
}

/** What an `untimed` row puts where a date would be. */
const NO_DATE = "—";

/**
 * **The date column for any of the four states**, as `{ text, tone }`.
 *
 * `tone` is what the stylesheet branches on, and it exists because the four are
 * not four shades of the same thing: a date is a fact, the article's own words
 * are a quotation, a dash is an absence, and a rejection is us failing. Giving
 * them one class and letting the text carry the difference would put *"dated —
 * but which year?"* in the same face as *"26 May"*, which reads as a very odd
 * date rather than as a note about one.
 */
export function datingWords(
  dating: Dating,
  withYear: boolean,
): { text: string; tone: "dated" | "words" | "none" | "rejected" } {
  switch (dating.kind) {
    case "dated":
      return { text: whenWords(dating.when, withYear), tone: "dated" };
    case "words":
      /* **The article's words, in quotation marks, and we compute nothing.**
         "Another month later" is displayed as "another month later" — Greg's
         call. We know where the event sits in the sequence and nothing more,
         and the quotation marks are what say whose sentence this is. */
      return { text: `“${dating.phrase}”`, tone: "words" };
    case "untimed":
      return { text: NO_DATE, tone: "none" };
    case "rejected":
      /* **Only the year is missing, so the article's words are still the
         date** — "On July 7" tells the reader the day, where "dated — but
         which year?" hid it. Greg, 2026-10-04 (spya-fyjac4): *"sometimes it
         even says in the … description that there's a date, but it's somehow
         not showing the dates above."* Quoted and in the article's tone, like
         `words`, because we have computed nothing; the head of the list and
         the open row say that the year is what is missing. The other two
         rejections name a date we refused to use, so theirs stay out. */
      if (dating.reason === "noYearFrame" && dating.phrase !== null) {
        return { text: `“${dating.phrase}”`, tone: "words" };
      }
      return { text: DATE_REJECTED_SHORT[dating.reason], tone: "rejected" };
  }
}

/**
 * **Every year the dated rows mention.**
 *
 * One year in the set and the rows drop it, because a column repeating "2026"
 * twenty-six times is spending its width on the one thing that is the same
 * everywhere; the head says it once instead. Two or more and every row carries
 * it, because at that point the year is the content and a bare "12 May" is
 * ambiguous in a way the reader cannot detect.
 *
 * Both ends of the interval are counted, so a range that crosses New Year turns
 * the years on for the whole panel rather than showing one end with a year and
 * the other without.
 */
export function yearsOf(events: TimelineEvent[]): Set<string> {
  const years = new Set<string>();
  for (const e of events) {
    if (e.dating.kind !== "dated") continue;
    for (const end of [e.dating.when.earliest, e.dating.when.latest]) {
      if (end !== null) years.add(end.slice(0, 4));
    }
  }
  return years;
}

/**
 * **What the head of the list has to say about years**, as three facts.
 *
 * `fromPublished` and `fromPiece` are the two places a year we supplied can
 * come from (`When.yearFrom`, src/types.ts); `yearless` is a row that shows the
 * article's day and month with no year, because we had nowhere to take one
 * from. Each gets its own sentence, said once above the list.
 */
export function yearNotes(events: TimelineEvent[]): {
  fromPublished: boolean;
  fromPiece: boolean;
  yearless: boolean;
} {
  const filled = events.flatMap((e) =>
    e.dating.kind === "dated" && e.dating.when.yearFilled ? [e.dating.when] : [],
  );
  return {
    fromPublished: filled.some((w) => w.yearFrom === undefined),
    fromPiece: filled.some((w) => w.yearFrom === "piece"),
    yearless: events.some((e) => e.dating.kind === "rejected" && e.dating.reason === "noYearFrame"),
  };
}

/**
 * The groups, in the order they are drawn.
 *
 * **A display partition, not a re-sort.** Within each group the artefact's own
 * order is untouched, which is the thing that must not change — the sequence is
 * the model's reading of the story and the dates move nothing. What this adds
 * is that the two non-`happened` groups cannot interleave on screen: the stage
 * sorts predictions and hypotheticals into one partition *after* everything
 * that happened, so on a well-formed artefact this reorders precisely nothing,
 * and on a malformed one it stops a heading being drawn over rows it does not
 * describe.
 *
 * **Hypothetical before predicted**, which is the one non-obvious bit of this
 * order: a hypothetical here is usually a counterfactual about the *past* —
 * the test article's is "at some point after July 12", something that nearly
 * happened — so it belongs next to the history rather than out past the
 * forecasts. That is measured rather than assumed: `src/timeline.ts` resolves
 * `hypothetical` **backwards** for exactly this reason.
 *
 * The same shape as `GROUPS` in IdeasPanel.tsx, and a heading is never drawn
 * over an empty group.
 */
const GROUPS: { modality: TimelineModality; heading: string | null; blurb: string | null }[] = [
  { modality: "happened", heading: null, blurb: null },
  {
    modality: "hypothetical",
    heading: "What might have happened",
    blurb: "The piece raises these without saying they did.",
  },
  {
    modality: "predicted",
    heading: "What the piece expects",
    blurb: "Written about the future, from where the piece stands.",
  },
];

/**
 * **The owner's half of this panel** — the read's status, the job that reads
 * the chronology, and the verbs that spend.
 *
 * Absent for a visitor. GlossaryPanel.tsx § GlossaryOwner has the argument for
 * one panel with its data injected rather than two panels for one list.
 */
export type TimelineOwner = UseTimeline;

/**
 * **Who is reading, and the events they get — one prop, so the two cannot
 * disagree.**
 *
 * The same shape as `QuotesAccess`, down to `owner?: never`, which is
 * load-bearing rather than tidy: without it the union catches only a fresh
 * object literal at the call site, so the same object built in a variable first
 * would typecheck with an owner hook riding inside a visitor's arm.
 * GlossaryPanel.tsx § GlossaryAccess is the full argument.
 *
 * **This replaced a required `owner: UseTimeline` on 2026-09-04**, when
 * timeline became an artefact a shared link carries. The comment that stood
 * here said there was no visitor half and that making the mode shareable
 * "wants a general answer for every mode, not a fifth hand-written table" —
 * and the general answer turned out to be the one the quotes and the glossary
 * already had. docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 1.
 */
export type TimelineAccess =
  | { kind: "owner"; owner: TimelineOwner }
  | { kind: "visitor"; timeline: PublicTimeline; owner?: never };

interface Props {
  access: TimelineAccess;
  /** Which event is open, from `?event=`. */
  eventId: string | null;
  onEvent(id: string | null): void;
  /** The selected event's occurrences, resolved — the same array the prose marks. */
  found: Found[];
  /** Which occurrence the reader last landed on, by `Found.key`. */
  openKey: string | null;
  onOpenKey(key: string | null): void;
  onJump(id: BlockId): void;
}

export function TimelinePanel({
  access,
  eventId,
  onEvent,
  found,
  openKey,
  onOpenKey,
  onJump,
}: Props) {
  useRenderCount("TimelinePanel");
  /* **A visitor has no owner half at all**, rather than a stubbed one: there is
     no request in flight to have a status, nothing to retry, and no job to
     start. Every read below is guarded on this being non-null, which is what
     makes "a visitor cannot start a model call from this panel" a fact about
     the types rather than a promise in a comment. */
  const owner = access.kind === "owner" ? access.owner : null;
  const timeline: Timeline | PublicTimeline | null =
    access.kind === "owner" ? access.owner.timeline : access.timeline;
  const events = timeline?.events ?? [];
  const years = yearsOf(events);
  /* One year across the whole list, so the rows drop it and the head says it
     once. See `yearsOf`. */
  const { fromPublished, fromPiece, yearless } = yearNotes(events);
  /* A row with no year beside a row whose year we dropped would read as two
     rows with no year, so the dropping stops when any row is year-less. */
  const withYear = years.size !== 1 || yearless;

  /**
   * @param again beside a timeline that is already there, so the run is forced.
   *   The empty state's button is not: it has to make the identical, unforced
   *   request the automatic run makes, or the two carry different `work_key`s
   *   and the reader pays twice. useTimeline.ts § `ensure`.
   */
  const run = (label: string, again = false) =>
    owner === null ? null : (
    <JobProgress
      job={owner.job}
      starting={owner.starting}
      failed={owner.failed}
      stalled={owner.stalled}
      onRun={() => (again ? owner.regenerate() : owner.ensure())}
      onCancel={owner.cancel}
      label={label}
      step="timeline"
      icon={<Clock size={13} />}
      runningLabel="Reading…"
    />
  );

  /* What the band's (i) adds after the mode's own words: how many events, how
     many of them carry a date, and who read them out. Greg, 2026-10-01
     (spya-ucu35y): *"how many X (of y) … what model was used"*; plan 261001m.
     **Only the count and the provenance move** (GPT Sol's plan review, P1):
     the year line and the thin-timeline note stay in the band, because the
     rows are read through them. The provenance is the owner's artefact's — a
     visitor's carries none (src/public-types.ts). */
  const made = owner?.timeline ?? null;
  const dated = events.filter((e) => e.dating.kind === "dated").length;
  const about = timeline ? (
    <>
      <p>
        {events.length === 1 ? "One event" : `${events.length} events`}
        {events.length > 0 ? `, ${dated} of them with a date.` : "."}
      </p>
      {made && (
        <AboutMade
          generator={made.generator}
          version={made.version}
          generatedAt={made.generatedAt}
          elapsedMs={made.elapsedMs}
        />
      )}
    </>
  ) : null;

  return (
    <ModeSurface
      label="Timeline"
      feature="gloss timeline"
      mode="timeline"
      about={about}
      /* **An empty row, kept on purpose for now.** The mode's name went on
          2026-09-05 — the Dock says it (§ Stage 5 of
          docs/plans/260905d-declutter-the-reading-view-top-bars.md) — and the
          event count, its only child, on 2026-10-01 to the band's (i) (plan
          261001m). It was a fragment so the row did not vanish while the
          events were coming; it stays one so the (i) has a row to sit in
          rather than lying over whichever of the band's many first rows
          (loading, empty, stale, the year line) is drawn. Dropping it would
          mean padding each of those clear of the (i) instead. */
      // biome-ignore lint/complexity/noUselessFragments: an empty fragment is the point — a head that is not null keeps its row, and the note above says why
      head={<></>}
      /* No standing redo button under the list any more. Greg, 2026-09-29
          (SPIDERYARN-READING2-53): *"Same goes for any other modes that still
          have a "redo this processing" button - let's just rely on the
          Metadata mode for that."* Metadata's *AI processing* has a row
          for this mode; the button inside the stale banner stays, as a
          repair the page is prompting rather than a standing redo.
          docs/plans/260929b-one-place-to-re-run-ai-processing.md.

          Keep the footer only for an in-flight or failed job on a current
          timeline. Without it, a run started from Metadata disappears from
          this mode along with its Stop control and any eventual failure. Not
          on a stale timeline, whose banner carries the job; an outdated one
          has no banner (plan 260929c), so its job shows here. */
      foot={
        timeline &&
        owner?.status === "ready" &&
        !owner.stale &&
        (owner.job || owner.starting || owner.failed) ? (
          <div className="tl-again">{run("Read it again", true)}</div>
        ) : null
      }
    >

      {owner?.error && <ReadError error={owner.error} onRetry={owner.retryRead} />}

      {owner?.status === "loading" && <p className="gloss-quiet">Looking for the timeline…</p>}

      {owner?.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has read the chronology out of this one yet.</p>
          <p className="gloss-hint">
            One model call over the whole article, and it takes tens of seconds. Read once and
            kept — you will not be asked again unless the article changes.
          </p>
          {run("Read the timeline")}
        </div>
      )}

      {/* **A visitor's arm has no status to be ready**, and that is the whole
          of the difference: their timeline arrived inside the page's own
          payload, so there is nothing to be loading, nothing to have failed and
          nothing to ask for. src/web/reader-capability.ts § what "visitor"
          means. */}
      {timeline && (owner === null || owner.status === "ready") && (
        <>
          {/* Stale wins when both are true, and for the same reason as next
              door: it is the one that makes the passages wrong, and two
              banners stacked is a wall.

              **"the article" here includes its publication date**, which is
              true of no other artefact. This stage's fingerprint is blocks,
              tree *and* `publishedAt`, because nineteen of the test article's
              twenty-four temporal expressions are year-less — so a publisher
              re-dating a post changes almost every row here and not one word
              anywhere else. src/timeline.ts § inputFingerprint. */}
          {owner?.stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                This describes an older version of the article.
              </p>
              {run("Read it again", true)}
            </div>
          ) : null}
          {/* No banner for an outdated timeline (older prompt, same article) —
              Greg, 2026-09-29 (SPIDERYARN-READING2-55): *"it's not worth
              bugging the user about it."* Re-running is in Metadata. Plan
              260929c. */}

          {/* **The piece has no chronology, and that is a real answer** —
              not an error, and with no retry offered, because running it
              again would find the same nothing and cost another model call. */}
          {events.length === 0 && <p className="gloss-quiet">{TIMELINE_NO_CHRONOLOGY}</p>}

          {events.length > 0 && events.length < A_CHRONOLOGY && (
            <p className="gloss-quiet tl-thin">{TIMELINE_THIN}</p>
          )}

          {/* Said once at the top rather than on every row. The second sentence
              is the honest provenance for a piece like the test article, where
              the year appears exactly once in twenty-four expressions and every
              other row's year is ours. */}
          {events.length > 0 && (!withYear || fromPublished || fromPiece || yearless) && (
            <p className="tl-frame">
              {!withYear && `Everything dated here is in ${[...years][0]}. `}
              {fromPublished && "Some dates use a year taken from when the piece was published. "}
              {/* An assumption, said as one. src/timeline-time.ts § `pieceYear`. */}
              {fromPiece &&
                "Some dates use an assumed year: the only year the piece states beside a month. "}
              {yearless &&
                "Some dates here have no year. We have kept the piece’s own words where we could find them."}
            </p>
          )}

          {/* **The scroller.** `.mode-band` is a fixed flex column from the
              controls bar to the dock, so every band puts a
              `flex: 1; min-height: 0; overflow-y: auto` child inside it. Without
              one, twenty-six rows on a 700px window put the last dozen below the
              bottom of the band with no way to reach any of them — and it looks
              perfectly fine on a tall window, which is how the ideas panel next
              door shipped without it. */}
          <div className="tl-scroll">
            {GROUPS.map(({ modality, heading, blurb }) => {
              const mine = events.filter((e) => e.modality === modality);
              /* No heading over nothing, and no empty section: a piece really
                 can predict nothing, and an empty labelled section says "we
                 looked" in the most expensive place on the screen. */
              if (mine.length === 0) return null;
              return (
                <section key={modality} className="tl-group">
                  {heading && (
                    <h3>
                      {heading}
                      <span className="gloss-count">{mine.length}</span>
                    </h3>
                  )}
                  {blurb && <p className="tl-blurb">{blurb}</p>}
                  <ol className="tl-list">
                    {mine.map((event) => (
                      <EventRow
                        key={event.id}
                        event={event}
                        withYear={withYear}
                        open={event.id === eventId}
                        onSelect={() => {
                          /* Pressing the open one clears it, which is the only
                             way to take the marks back out — a selection you
                             cannot cancel is a mode inside a mode. Every other
                             list in this band does exactly this. */
                          if (event.id === eventId) return onEvent(null);
                          onEvent(event.id);
                          /* **The jump lives in `TimelineBand`, not here**, and
                             it is forced rather than chosen — `IdeasPanel` has
                             the long version. Selecting jumps to the first
                             occurrence, but it has to be the first *resolved*
                             one, and this panel only holds the resolved
                             passages of the event that is already selected. The
                             stored list can name a block a re-extraction
                             removed, so jumping from here would sometimes do
                             nothing at all and the page would sit still. */
                        }}
                        found={event.id === eventId ? found : []}
                        openKey={openKey}
                        onOpenKey={onOpenKey}
                        onJump={onJump}
                      />
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        </>
      )}
    </ModeSurface>
  );
}

function EventRow({
  event,
  withYear,
  open,
  onSelect,
  found,
  openKey,
  onOpenKey,
  onJump,
}: {
  event: TimelineEvent;
  withYear: boolean;
  open: boolean;
  onSelect(): void;
  found: Found[];
  openKey: string | null;
  onOpenKey(key: string | null): void;
  onJump(id: BlockId): void;
}) {
  const { text, tone } = datingWords(event.dating, withYear);
  return (
    <li className={`tl-item${open ? " open" : ""}`}>
      <button type="button" className="tl-row" onClick={onSelect} aria-expanded={open}>
        {/* **Stacked, not two columns.** The band is 288px at its narrowest
            (`MODE_MIN` in layout.ts), and "at or before 12 May" beside a
            ten-word label in that width gives both of them about nine
            characters a line. The date leads because the list is a chronology
            and that is what the reader is scanning down. */}
        <span className={`tl-when tl-when-${tone}`}>
          {/* An em dash is silence to a screen reader, so the one row whose
              whole content is an em dash needs the sentence saying so. The
              other three tones read out as themselves. */}
          {tone === "none" ? (
            <>
              <span aria-hidden="true">{text}</span>
              <span className="sr-only">The piece gives no time for this.</span>
            </>
          ) : (
            text
          )}
        </span>
        <span className="tl-label">{event.label}</span>
      </button>

      {open && <EventDetail event={event} found={found} openKey={openKey} onOpenKey={onOpenKey} onJump={onJump} />}
    </li>
  );
}

/**
 * The open row: **how the piece dates it**, and **where it says so**.
 *
 * Both are about evidence rather than about the event, which is the whole
 * defence of this mode against being a summary. A row is a handle; everything
 * that makes it worth trusting is one press away and in the article's own
 * words.
 */
function EventDetail({
  event,
  found,
  openKey,
  onOpenKey,
  onJump,
}: {
  event: TimelineEvent;
  found: Found[];
  openKey: string | null;
  onOpenKey(key: string | null): void;
  onJump(id: BlockId): void;
}) {
  const { dating } = event;
  return (
    <div className="tl-detail">
      {/* `gloss-part-senseHere` is reused rather than re-declared, and not to
          save two rules: the solid rule down the left IS the provenance mark
          for "this comes from the article", and the glossary and the ideas both
          already use it that way. A third panel drawing the same distinction a
          third way would teach the reader it means three things. */}
      <div className="gloss-part gloss-part-senseHere">
        <p className="gloss-part-label">How the piece dates it</p>
        {dating.kind === "dated" && (
          <>
            <p className="gloss-part-text">
              {/* The article's own characters (src/timeline.ts), so the author's face. */}
              <span className="tl-phrase">“{dating.when.phrase}”</span>
            </p>
            {/* Said on the open row rather than in the column, because on a
                piece like the test article it is true of seventeen rows out of
                eighteen and a note repeated seventeen times is noise. What it
                buys on the row the reader has actually opened is the one fact
                the date column cannot carry: the year is not the article's. */}
            {dating.when.yearFilled && (
              <p className="gloss-part-hint">
                {dating.when.yearFrom === "piece"
                  ? "Where this date gives no year, we have assumed the only year the piece states beside a month."
                  : "Where this date gives no year, we take it from when the piece was published."}
              </p>
            )}
          </>
        )}
        {dating.kind === "words" && (
          <p className="gloss-part-text">
            <span className="tl-phrase">“{dating.phrase}”</span> — the article's own words, and all it says. We do not work out a
            date from them.
          </p>
        )}
        {dating.kind === "untimed" && (
          <p className="gloss-part-text">
            The piece puts no time on this at all. It is here because of where it comes in the
            story.
          </p>
        )}
        {dating.kind === "rejected" && (
          <>
            {dating.phrase !== null && (
              <p className="gloss-part-text">
                <span className="tl-phrase">“{dating.phrase}”</span>
              </p>
            )}
            <p className="gloss-part-hint">{DATE_REJECTED_WHY[dating.reason]}</p>
          </>
        )}
      </div>

      <div className="tl-where">
        <p className="gloss-part-label">
          Where the piece says so
          {/* `found.length`, and never the stored count. A counter that
              disagrees with the rows under it is the panel telling the reader
              two things — after a re-extraction some occurrences no longer find
              their block, and the stored number would say "2" over one row. */}
          <span className="gloss-count">{found.length}</span>
          {/* Almost always one occurrence — 26 of 26 on the test article — so
              `BlockNav` draws nothing at all here most of the time. It is
              wired up because an event mentioned twice really does happen: the
              article recounts the same three months once per civilisation. */}
          <BlockNav
            targets={found.map((f) => ({ id: f.key, blockId: f.blockId }))}
            currentId={openKey}
            onGo={(key, blockId) => {
              onOpenKey(key);
              /* `nudgeTo`, not `onJump` — stepping between neighbours leaves
                 the reader alone when the next one is already in front of
                 them. Pressing a passage below always jumps, because that is
                 arriving somewhere rather than moving along. */
              nudgeTo(blockId, onJump);
            }}
            noun="passage"
          />
        </p>

        <ol className="tl-occurrences">
          {found.map((f) => (
            <li key={f.key} className={f.key === openKey ? "open" : undefined}>
              <button
                type="button"
                onClick={() => {
                  onOpenKey(f.key);
                  onJump(f.blockId);
                }}
              >
                <span className={`tl-quote${f.whole ? " tl-quote-moved" : ""}`}>
                  {f.whole ? "whole paragraph — the exact words have moved" : f.short}
                </span>
              </button>
              <BlockRef id={f.blockId} onJump={onJump} />
            </li>
          ))}
        </ol>

        {/* Stored but unresolvable. Saying so is the difference between "the
            article changed under this" and "the model claimed more than it
            found", and the reader can only tell if we tell them. */}
        {found.length < event.occurrences.length && (
          <p className="gloss-hint">
            {event.occurrences.length - found.length} more{" "}
            {event.occurrences.length - found.length === 1 ? "passage is" : "passages are"} no
            longer in the article.
          </p>
        )}
      </div>
    </div>
  );
}

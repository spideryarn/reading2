/**
 * The Deploys tab: what shipped to production, newest first, and how stale the
 * record of it is.
 *
 * ## The header is the honest half
 *
 * The list is easy; the header is where this panel could lie. The record it
 * draws (`src/web/changelog-versions.ndjson`) is written by a job Greg runs by
 * hand, so **a deploy can have happened hours before it appears here**, and a
 * page that showed only the list would present a stale record as the current
 * state of production with nothing saying otherwise. So the first thing on the
 * page is when the record was last written, where this checkout's cached main
 * actually is, and how far apart those two are. **Cached, and not "production's
 * tip"** — that phrase was in this comment after the rendered line had already
 * been qualified, which is how a corrected fact survives in the copy nobody
 * re-read. Sol's P3.
 *
 * ## The sentence this panel must not get wrong
 *
 * `commitsSince` is the non-merge distance from the newest recorded deploy to
 * this checkout's cached `origin/main`. **It is not undeployed work, and it is
 * not shipped work either.**
 *
 * This comment said *everything on `main` has shipped or is shipping, because
 * `main` is written only by `npm run deploy`* until 2026-09-09, and that is
 * false: `deploy.ts` pushes to `main` and only *then* waits for Vercel, so a
 * build that failed or timed out leaves `main` advanced with nothing serving
 * from it. The number therefore mixes three things — deploys not yet written up,
 * a tip not yet deployed, and pushes whose build never succeeded.
 *
 * So the copy below says the literal thing and names what it cannot tell. **If
 * you are tempted to tighten it into something punchier, read routes-deploys.ts
 * § The claim in the header first** — there is a token-free way to do better,
 * and shortening the sentence is not it.
 *
 * ## Every kind of nothing, kept apart
 *
 * Four arms out of `deploys-client.ts` and each draws differently, because an
 * empty list reads as *nothing has ever been deployed* — the page's standing
 * rule (docs/project/fleet-dashboard-modes.md § Absence is stated, never drawn),
 * sharpened here by the fact that every failure has a reassuring wrong answer to
 * fall back to.
 */
import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Explain, type Tip } from "./Tooltip";
import {
  FIRST_PAGE,
  MAX_LIMIT,
  MORE_PAGE,
  OPEN_ZONE_LABELS,
  ago,
  agoFrom,
  commitUrl,
  deployDays,
  deployGist,
  deployWhenIn,
  deployWhen,
  groupedEntries,
  httpDeploysApi,
  ROW_ZONE,
  shortSha,
  type DeployDay,
  type DeployGist,
  type DeploysApi,
  type DeploysView,
} from "./deploys-client";
import { Button, Card, Mono, Pill, SectionHeading } from "./ui";
import type { DeployVersion } from "../../wire";

/** What the panel is doing, plus whatever it last heard. */
type State = { kind: "loading" } | DeploysView;

const RECORD_TIP: Tip = {
  head: "The deploy record",
  what: "Every production deploy that has been written up, newest first, with the changelog entries a reader would have noticed.",
  how: "It is a committed file, not a live call to Vercel — this box has no token — so it lags until somebody runs the changelog job. The line above says by how much.",
};

const BEHIND_TIP: Tip = {
  head: "Commits after the last recorded deploy",
  what: "Non-merge commits between the newest deploy in the record and this checkout\u2019s cached tip of main.",
  how: "Not a count of work awaiting release: main is advanced by a deploy attempt before its build is known to have succeeded, so any of them may already have shipped \u2014 all, none, or some. Telling which needs the live build stamp or Vercel.",
};

/** A sha, linked into the repository. */
function Sha({ sha }: { sha: string }): ReactNode {
  return (
    <a
      href={commitUrl(sha)}
      target="_blank"
      rel="noreferrer noopener"
      className="tw:font-mono tw:text-[12px] tw:text-ink-faint tw:underline tw:decoration-dotted tw:underline-offset-2 tw:hover:text-ink"
    >
      {shortSha(sha)}
    </a>
  );
}

/**
 * The freshness header.
 *
 * **Every line here is allowed to say "we could not tell".** The alternative —
 * omitting a line whose reading failed — leaves a header that looks complete and
 * is quietly missing the one fact that was wrong.
 */
function Freshness({
  view,
  nowMs,
  arrivedAtMs,
}: {
  view: Extract<DeploysView, { kind: "deploys" }>;
  nowMs: number;
  /** The browser's clock at the moment this payload landed. See `skewed` below. */
  arrivedAtMs: number;
}): ReactNode {
  /* **Ages are measured against the SERVER's clock, corrected by the skew this
     browser has drifted since the answer arrived.**

     Every timestamp here was stamped by the box; `nowMs` is the phone's. On a
     device whose clock is a few minutes out, subtracting one from the other
     changes every "ago" on the page — and this panel's whole subject is how
     stale things are, so a device-skew error reads as a stale record. The
     payload carries `servedAtMs` for exactly this and it was going unused.
     GPT Sol, 2026-09-09. `skewed` keeps ticking, because an age that only moves
     when data arrives freezes at the moment it matters. */
  const skewed = view.servedAtMs + (nowMs - arrivedAtMs);
  const generatedAgo = ago(view.lastGeneratedAt, skewed);
  /* Same reason as the cards': three `Intl` formatters, once a second, for a
     string that cannot change. */
  const generatedWhen = useMemo(
    () => (view.lastGeneratedAt === null ? null : deployWhen(view.lastGeneratedAt)),
    [view.lastGeneratedAt],
  );
  const mainRef = view.git.main;

  return (
    <Card className="tw:px-3 tw:py-2.5 tw:text-[13px] tw:text-ink-soft">
      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
        <span className="tw:font-semibold tw:text-ink">The record</span>
        {view.lastGeneratedAt === null ? (
          <span>says nothing about when it was written.</span>
        ) : (
          <span>
            was last written {view.newestLineRead ? "" : "at least "}
            {generatedAgo ?? "at a time this page cannot read"}
            <span className="tw:text-ink-faint"> ({generatedWhen ?? view.lastGeneratedAt})</span>, and
            holds {view.total} {view.total === 1 ? "deploy" : "deploys"}.
          </span>
        )}
      </div>

      <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
        {/* **"main is at", not "Production is at".** The second is the claim the
            route's own comment says cannot be made from here: `deploy.ts` pushes
            and then waits, so the tip of main is where a deploy *attempt* got
            to, not what is serving. GPT Sol's P1 finding 2. */}
        <span className="tw:font-semibold tw:text-ink">main</span>
        {mainRef.kind === "ref" ? (
          <span>
            is at <Sha sha={mainRef.sha} />, committed {ago(mainRef.committedAt, skewed) ?? "at an unreadable time"}
            {/* **The age of the VIEW, not of the commit** — a ref nobody has
                updated in a week looks exactly like a week with no deploys
                unless this says which it is. **Labelled as exactly what it
                measures**, after GPT Sol's P1 finding 2 and a measurement on
                this box: `FETCH_HEAD`'s mtime
                does advance on a no-op fetch — so it says when we last ASKED,
                not when the ref last moved — but it names whatever was last
                fetched, so it does not prove `origin/main` itself was
                refreshed. It bounds the staleness; it does not measure it. */}
            {mainRef.lastFetchAtMs === null ? (
              <span className="tw:text-ink-faint"> — a cached view; this checkout has no record of fetching</span>
            ) : (
              <span className="tw:text-ink-faint">
                {" "}
                — a cached view; this checkout last fetched something{" "}
                {agoFrom(mainRef.lastFetchAtMs, skewed) ?? "at an unreadable time"}
              </span>
            )}
          </span>
        ) : (
          <span className="tw:text-unknown-ink">could not be read: {mainRef.why}</span>
        )}
      </div>

      {/* **Four arms, and only ONE of them is an alarm.** This drew a rollback
          warning for any non-ancestor until 2026-09-09 — including the
          commonest benign case, a cached ref older than the record, which is
          what you get whenever the changelog job has run since this checkout
          last fetched. An alarm that fires on the normal state is an alarm
          nobody reads. wire.ts § AncestryReading. */}
      <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
        {view.git.ancestry.kind === "ancestor" ? (
          <span className="tw:text-ink-faint">The newest recorded deploy is in this checkout&rsquo;s history of main.</span>
        ) : view.git.ancestry.kind === "record-ahead" ? (
          /* **"Usually", because ancestry alone does not prove why.** The same
             graph is produced by a stale checkout (much the commonest), by a
             deploy from an unpushed branch, and by main having been rolled back
             to the cached commit. This said "Nothing is wrong" for an hour and
             that did not follow from the evidence — GPT Sol's F2. */
          <span className="tw:text-ink-faint">
            The newest recorded deploy is ahead of this checkout&rsquo;s cached main, so no distance can be measured.
            Usually that just means nobody has fetched here since it shipped.
          </span>
        ) : view.git.ancestry.kind === "diverged" ? (
          <span className="tw:font-semibold tw:text-alarm-ink">
            The newest recorded deploy is not in this checkout&rsquo;s history of main at all, and main is not in its
            history either — a rollback, or a deploy from a working directory.
          </span>
        ) : (
          <span className="tw:text-unknown-ink">
            How the newest recorded deploy sits against main could not be checked: {view.git.ancestry.why}
          </span>
        )}
      </div>

      <div className="tw:mt-1.5">
        {view.git.commitsSince.kind === "count" ? (
          <Explain tip={BEHIND_TIP}>
            <span>
              <span className="tw:font-semibold tw:text-ink">{view.git.commitsSince.commits}</span> later non-merge
              commits in this checkout&rsquo;s cached <span className="tw:font-mono">origin/main</span>.{" "}
              <span className="tw:text-ink-faint">
                Some may already have deployed and not been written up yet. This view cannot tell which.
              </span>
            </span>
          </Explain>
        ) : view.git.commitsSince.kind === "not-comparable" ? (
          /* Deliberately NOT a number. `rev-list A..B` on divergent histories is
             a set difference that reads like a distance. */
          <span className="tw:text-ink-faint">
            No distance from the newest recorded deploy to main can be measured: {view.git.commitsSince.why}
          </span>
        ) : (
          <span className="tw:text-unknown-ink">
            How far the record is behind main could not be measured: {view.git.commitsSince.why}
          </span>
        )}
      </div>

      {/* **The newest line specifically.** A corrupt line anywhere costs a
          deploy; a corrupt LAST line also means everything above is measured
          from the wrong place, because the record is append-only and its last
          line is its newest deploy. The route refuses to measure at all in that
          case, and this is where the page says why. GPT Sol's P1 finding 4. */}
      {/* **`=== false`, not `!`.** The client's parser defaults a missing
          `newestLineRead` to true, but that only covers the HTTP path — a
          payload reaching this component any other way (an older server, a
          caller handing it a view) would have `undefined` here, which is falsy,
          and the page would announce a corrupt record because of a version
          skew. An alarm must be raised by evidence, not by absence. */}
      {view.newestLineRead === false && view.recordLines > 0 ? (
        <div className="tw:mt-1.5 tw:font-semibold tw:text-alarm-ink">
          The record&rsquo;s newest line could not be read, so the newest deploy is unknown and nothing above is
          measured against it.
        </div>
      ) : null}

      {/* A line of the record that would not parse is a deploy missing from the
          list. Counted and shown, never swallowed — otherwise the list is
          quietly short and looks complete. */}
      {view.unreadable.length > 0 ? (
        <div className="tw:mt-1.5 tw:text-alarm-ink">
          {view.unreadable.length} of {view.recordLines} lines in the record could not be read, so that many deploys are
          missing from this list: {view.unreadable.join("; ")}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The gist on a closed row: what this deploy shipped, in one clause.
 *
 * **Three arms, and they are the same three the open card draws at length.** A
 * collapsed view is a new chance to say *nothing changed* over a deploy whose
 * changelog could not be READ, which is the exact collapse 260909b's review
 * spent a round pulling apart — so the branch is on `gist.kind` rather than on
 * "are there any entries", and the unreadable arm keeps its own colour.
 */
function Gist({ gist }: { gist: DeployGist }): ReactNode {
  return (
    <span className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-1.5">
      {gist.kind === "unreadable" ? (
        /* **Not an early return.** This arm returned before reaching the
           unreadable count below, so a deploy whose entries were ALL malformed
           closed to a bare "could not be read" and only said how many when you
           opened it — while the helper's own comment claimed the count rode on
           every arm. GPT Sol's P2. The arm that has lost the most is the one
           that was saying the least. */
        <span className="tw:text-[13px] tw:text-unknown-ink">what changed could not be read</span>
      ) : gist.kind === "quiet" ? (
        <span className="tw:text-[13px] tw:text-ink-faint">Nothing a reader would notice</span>
      ) : (
        <>
          <span className="tw:text-[13px] tw:text-ink">{gist.title}</span>
          {gist.more > 0 ? <span className="tw:text-[12px] tw:text-ink-faint">+{gist.more} more</span> : null}
        </>
      )}
      {/* **A short list presented as a whole one is the collapsed view's own
          way of lying.** The open card says how many entries would not parse;
          without this the row above it quietly does not. */}
      {gist.unreadable > 0 ? (
        <span className="tw:text-[12px] tw:text-unknown-ink">+{gist.unreadable} unreadable</span>
      ) : null}
    </span>
  );
}

/**
 * One deploy — **closed**, and one line of it.
 *
 * A normal deploy card was 950–1000 px tall, so learning that a *second* deploy
 * existed meant scrolling past the whole write-up of the first (measured on the
 * live tab at 1280×900, 2026-09-09: ten deploys made a 6066 px page, and 8824 px
 * at 390). The record is not less honest for being closed; it was unreadable for
 * being open.
 *
 * **Uncontrolled `<details>`, deliberately.** This page re-renders once a second
 * off `useNow`, and an `open` prop recomputed on every tick would shut every row
 * the reader had opened. Open-ness is DOM state, and `register` is how the
 * table of contents reaches it.
 *
 * The pattern — a bare `<details>` with a `<summary>` you can read closed — is
 * `SessionDetail.tsx`'s ("Rename", "Where it is"), reused as a vocabulary rather
 * than as a component: that summary is one faint word and this one is a whole
 * row, so anything general enough for both would be a `ReactNode` and a
 * `className`, which is not a component.
 */
function DeployRow({
  version,
  nowMs,
  register,
}: {
  version: DeployVersion;
  nowMs: number;
  register: (id: string, el: HTMLDetailsElement | null) => void;
}): ReactNode {
  const groups = useMemo(() => groupedEntries(version), [version]);
  const gist = useMemo(() => deployGist(version), [version]);
  /* **Memoised because this page re-renders once a second and the answer never
     changes.** `zonedLine` builds three `Intl.DateTimeFormat` instances per
     call; GPT Sol measured the un-memoised version at 46–64 ms per render for
     70 deploys and 110–126 ms for 200 — every second, on a phone. The absolute
     time of a deploy that already happened is the most immutable value on the
     page. Sol's F4. The one-zone reading below is the same argument again. */
  const when = useMemo(() => deployWhen(version.version), [version.version]);
  const local = useMemo(() => deployWhenIn(version.version), [version.version]);

  /* **A stable ref callback.** An inline `ref={(el) => register(id, el)}` is a
     new function on every render, and React answers a changed ref by calling
     the old one with `null` and the new one with the element — so this page,
     which re-renders once a second, was detaching and re-registering every row
     twice a second for nothing. 200 rows is 800 map operations a second to
     arrive back where it started. GPT Sol, round 2; `register` is itself
     `useCallback([])`, so this is stable for the life of the row. */
  const attach = useCallback(
    (el: HTMLDetailsElement | null) => register(version.deploymentId, el),
    [register, version.deploymentId],
  );

  return (
    <Card className="tw:px-3 tw:py-1.5">
      {/* **`scroll-mt` belongs on the element `scrollIntoView` is called on**,
          which is this `<details>` and not the card around it. It was on the
          card for the first draft, and a browser pass caught what that looks
          like: the jump works, the right row opens, and the "Release 73" line
          you aimed at sits behind the 62 px sticky masthead, so you land in the
          middle of the body with no heading to tell you where you are. A scroll
          offset on an ancestor does nothing at all — `scroll-margin` is read
          off the target. */}
      {/* `deploy-row` carries the scroll offset as well as the marker rules —
          tailwind.css § deploy-row says why it is arithmetic on `--safe-top`
          rather than a fixed `scroll-mt-20`. */}
      <details className="deploy-row tw:group" ref={attach}>
        {/* **The row is the flex container, not a box inside it.** The first
            draft kept the native `list-item` marker and put an `inline-flex`
            span beside it, and at 390 px that span is an atomic box too wide
            for what the marker leaves, so it dropped to the next line and the
            triangle sat alone above the row. `list-none` plus our own chevron
            (the product's changelog page, tailwind.css § deploy-row) makes the
            marker a flex item like any other, and the row wraps field by field
            instead of all at once. */}
        <summary className="tw:flex tw:cursor-pointer tw:list-none tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-0.5 tw:rounded-md tw:px-1 tw:py-1">
          <ChevronRight
            size={14}
            className="tw:mt-0.5 tw:shrink-0 tw:self-start tw:text-ink-faint tw:transition-transform tw:group-open:rotate-90"
            aria-hidden="true"
          />
          <span className="tw:font-semibold tw:text-ink">Release {version.release}</span>
          {/* The clock time carries its zone every time it is drawn. The date
              is not here — it is the heading this row sits under, and
              repeating it ten times is what made the old card's second line
              unscannable. */}
          <span className="tw:text-[12px] tw:text-ink-soft">
            {local === null ? "at a time this page cannot read" : `${local.time} ${local.label}`}
          </span>
          <span className="tw:text-[12px] tw:text-ink-faint">{ago(version.version, nowMs) ?? "age unknown"}</span>
          {/* Plain text, not a link: an anchor inside a `<summary>` both
              follows and toggles, and it is a poor tap target on a phone. The
              linked sha is in the body, where it always was. */}
          <span className="tw:font-mono tw:text-[12px] tw:text-ink-faint">{shortSha(version.sha)}</span>
          {/* **Null is not zero.** A line that has forgotten what it shipped
              has not shipped nothing, and drawing "0 commits" would be a
              number somebody could act on. */}
          <span className="tw:text-[12px] tw:text-ink-faint">
            {version.commitCount === null
              ? "commit count not recorded"
              : `${version.commitCount} ${version.commitCount === 1 ? "commit" : "commits"}`}
          </span>
          {/* **The pill only when it says something the gist does not.** The
              record's `invisible` flag and a gist of *nothing a reader would
              notice* are the same fact, and a browser pass showed them side
              by side on every quiet deploy — twice the ink for one claim, on
              the rows that deserve the least of it. Kept for the case where
              they DISAGREE: a line that calls itself quiet and then carries
              entries is a contradiction in the record, and the pill is the
              only place on the row that would say so. */}
          {version.invisible && gist.kind !== "quiet" ? <Pill tone="idle">quiet</Pill> : null}
          <Gist gist={gist} />
        </summary>

        <div className="tw:mt-1 tw:border-l tw:border-rule tw:pt-1 tw:pb-1 tw:pl-3">
          <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1 tw:text-[12px] tw:text-ink-faint">
            {/* Every zone the box shows, which is the canonical line — the
                closed row's single labelled time is a reading of the same
                instant through the same code, not a second opinion. */}
            <span>{when ?? version.version}</span>
            <span aria-hidden="true">·</span>
            <Sha sha={version.sha} />
            {version.previousSha !== null ? (
              <>
                <span aria-hidden="true">·</span>
                {/* The range, so what this deploy covers is visible rather than
                    implied. */}
                <span>
                  since <Sha sha={version.previousSha} />
                </span>
              </>
            ) : null}
          </div>

          {!version.changelogReadable ? (
            /* **"We could not read what changed" is NOT "nothing changed".** The two
               look identical on a card and mean opposite things: one is the common
               quiet deploy, the other is a headline feature rendered as an empty
               box. GPT Sol's P1 finding 3, 2026-09-09. */
            <p className="tw:mt-2 tw:text-[13px] tw:text-unknown-ink">
              What changed here could not be read from the record
              {version.unreadableEntries > 0
                ? ` — ${version.unreadableEntries} ${version.unreadableEntries === 1 ? "entry" : "entries"} would not parse`
                : ""}
              . This is not a quiet deploy; it is a gap in the changelog.
            </p>
          ) : groups.length === 0 ? (
            /* **NOT an empty card.** Most deploys are quiet — 19 of the 20 in one
               42-hour stretch — and that is expected rather than a fault, so it is
               said in words rather than left as a gap somebody has to interpret. */
            <p className="tw:mt-2 tw:text-[13px] tw:text-ink-faint">Nothing a reader would notice.</p>
          ) : (
            groups.map((group) => (
              <div key={group.section} className="tw:mt-2.5">
                <h3 className="tw:text-[11px] tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
                  {group.label}
                </h3>
                <ul className="tw:mt-1 tw:flex tw:flex-col tw:gap-2">
                  {group.entries.map((entry) => (
                    /* Keyed by the title within its section rather than by index:
                       these are drawn from a file that can gain a line above them,
                       and an index key would then re-use one entry's DOM for
                       another's text. */
                    <li key={`${group.section}-${entry.title}`} className="tw:text-[13px]">
                      <span className="tw:font-medium tw:text-ink">{entry.title}</span>
                      <p className="tw:mt-0.5 tw:text-ink-soft">{entry.body}</p>
                      <div className="tw:mt-0.5 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2">
                        {entry.where !== null ? <Mono>{entry.where}</Mono> : null}
                        {entry.commits.map((sha) => (
                          <Sha key={sha} sha={sha} />
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}

          {/* Some entries read, some not. The list above is real and short, and
              saying by how much is the difference between a partial list and a
              list. */}
          {version.changelogReadable && version.unreadableEntries > 0 ? (
            <p className="tw:mt-2 tw:text-[12px] tw:text-unknown-ink">
              {version.unreadableEntries} further {version.unreadableEntries === 1 ? "entry" : "entries"} on this
              deploy could not be read, so this list is short.
            </p>
          ) : null}
        </div>
      </details>
    </Card>
  );
}

/**
 * The table of contents: every deploy in the window, one press away.
 *
 * **Buttons, not anchors, and that is not a style preference.** This page keeps
 * its mode in the URL fragment, and `mode.ts`'s `parseHash` falls back to
 * `sessions` for any name it does not recognise — so an `<a href="#deploy-74">`
 * would not scroll to a deploy, it would throw the reader onto the Sessions tab
 * and lose the whole panel. `tests/fleet-web.test.tsx` refuses any `href`
 * starting `#` inside this panel.
 *
 * **Grouped by day rather than a flat list**, which is the literal reading of
 * the brief and would have been the list a second time: with every deploy
 * collapsed to one line, a row-per-deploy index directly above a row-per-deploy
 * list doubles the page to say nothing new. A day is the question a person
 * actually arrives with, it stays a handful of rows when "show more" takes the
 * window to seventy, and each deploy is still individually reachable.
 */
function Contents({
  days,
  onJump,
}: {
  days: DeployDay[];
  onJump: (deploymentId: string) => void;
}): ReactNode {
  return (
    /* **A `<nav>` with the day groups named, because this IS navigation.** A
       screen-reader reader tabbing the buttons heard "Jump to release 74",
       "Jump to release 73" and so on with none of the day structure a sighted
       reader gets for free — the dates were unassociated `<span>`s beside them.
       `role="group"` plus `aria-labelledby` puts each day back on its own
       buttons. GPT Sol's P3, round 2. */
    <nav aria-labelledby="deploys-contents">
      <Card className="tw:px-3 tw:py-2.5">
        <h3
          id="deploys-contents"
          className="tw:text-[11px] tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase"
        >
          Jump to a release
        </h3>
        {/* **The zone is stated once here, and named on every row and heading
            besides.** The list of zones comes from `DISPLAY_ZONES` rather than
            being retyped, so the sentence cannot outlive the list it
            describes. */}
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
          Times and days below are {ROW_ZONE.label}, the zone the record itself is in. Open a deploy to see it in{" "}
          {andList(OPEN_ZONE_LABELS)}.
        </p>
        {days.map((day) => (
          <div
            key={day.key}
            role="group"
            aria-labelledby={`deploys-contents-${day.key}`}
            className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1"
          >
            <span id={`deploys-contents-${day.key}`} className="tw:text-[12px] tw:text-ink-soft">
              {day.label}
            </span>
            {day.versions.map((version) => (
              <Button
                key={version.deploymentId}
                onClick={() => onJump(version.deploymentId)}
                aria-label={`Jump to release ${version.release}`}
                className="tw:font-mono"
              >
                {version.release}
              </Button>
            ))}
          </div>
        ))}
      </Card>
    </nav>
  );
}

/** `a, b and c`. Prose, so the sentence above reads as one. */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The window: its contents, its day headings, and its rows.
 *
 * Its own component because the panel above it is a chain of *which nothing is
 * this* arms, and the list is the one arm that has a shape. Keeping the two
 * apart is also what keeps either of them readable — `DeploysPanel` was over
 * biome's complexity ceiling with this inlined.
 */
function DeployList({
  versions,
  nowMs,
}: {
  versions: DeployVersion[];
  nowMs: number;
}): ReactNode {
  /* **One constant, not a reading**, so a row's clock and the heading above it
     cannot be measured in different zones — and so nothing here has to be
     memoised against a value that could change under a tab left open for
     hours. deploys-client.ts § ROW_ZONE has the argument, and it is a reversal:
     this detected the device's zone until GPT Sol's P1. */
  const days = useMemo(() => deployDays(versions), [versions]);

  /**
   * The rows, by deployment id, so the contents can reach one.
   *
   * **A ref rather than state**, because open-ness lives in the DOM: see
   * `DeployRow`. Nothing here re-renders when a row opens, which is the point —
   * this page redraws once a second anyway.
   */
  const rows = useRef(new Map<string, HTMLDetailsElement>());

  const register = useCallback((id: string, el: HTMLDetailsElement | null): void => {
    if (el === null) rows.current.delete(id);
    else rows.current.set(id, el);
  }, []);

  const jump = useCallback((id: string): void => {
    const el = rows.current.get(id);
    if (el === undefined) return;
    el.open = true;
    /* **Move focus, or the jump is a visual effect only.** Scrolling moves the
       viewport and nothing else: a keyboard or screen-reader reader is still
       standing on the contents button, and their next Tab goes to the next
       index entry rather than into the release they just asked for. GPT Sol's
       P2. `preventScroll` because the scroll below is the one that knows where
       to stop — focus's own scrolling ignores `scroll-margin`. */
    const summary = el.querySelector("summary");
    if (summary !== null && typeof summary.focus === "function") summary.focus({ preventScroll: true });
    /* **Guarded, because jsdom does not implement it** — an unguarded call
       throws in every test that presses a contents button, which would make
       those tests a statement about jsdom rather than about the page.

       **No `behavior`**, so the stylesheet decides. An explicit `"smooth"` is a
       direct request for animation that
       `@media (prefers-reduced-motion: reduce)`'s `scroll-behavior: auto` does
       not override — and after "show more" this can travel thousands of pixels.
       GPT Sol's P3. */
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
  }, []);

  return (
    <>
      {/* One deploy needs no index of itself. */}
      {versions.length > 1 ? <Contents days={days} onJump={jump} /> : null}

      <div className="tw:flex tw:flex-col tw:gap-2">
        {days.map((day) => (
          /* `data-day` so a test can say "these releases, under that heading"
             rather than guessing which `<h3>` is a day — the contents above and
             every changelog section inside an open row are `<h3>`s too, and a
             test that cannot tell them apart reads a release number out of the
             wrong element. */
          <div key={day.key} data-day={day.key} className="tw:flex tw:flex-col tw:gap-1.5">
            {/* **The zone on the heading too**, not only in the contents at the
                top of the page: a day heading eight releases down is read on
                its own, and a bare date is a claim about somebody's calendar.
                The unreadable-instant heading is its own sentence and does not
                take one. */}
            <h3 className="tw:px-1 tw:pt-1 tw:text-[11px] tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
              {day.key === "" ? day.label : `${day.label} · ${ROW_ZONE.label}`}
            </h3>
            {day.versions.map((version) => (
              <DeployRow
                key={version.deploymentId}
                version={version}
                register={register}
                nowMs={nowMs}
              />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

export function DeploysPanel({
  api = httpDeploysApi,
  now,
  refreshNonce = 0,
}: {
  /** Injectable, so a test drives the panel through the seam rather than stubbing `fetch`. */
  api?: DeploysApi;
  /** The page's clock, so every age on screen is anchored to the same tick. */
  now: number;
  /**
   * Bumped when somebody presses Refresh.
   *
   * **This panel does not poll.** The record changes when a person runs the
   * changelog job, which is hours apart, so a timer would be spending the box's
   * time to re-read an unchanged file. What it must do instead is answer the
   * Refresh button — which presents itself as the page's, and did nothing here
   * until this existed. App.tsx § refreshEverything.
   */
  refreshNonce?: number;
}): ReactNode {
  const [state, setState] = useState<State>({ kind: "loading" });
  /* Stamped when the payload lands rather than read at render time: the gap
     between the two is what `skewed` is correcting for. */
  const [arrivedAtMs, setArrivedAtMs] = useState<number>(() => Date.now());
  const [limit, setLimit] = useState<number>(FIRST_PAGE);
  /* The panel's own view of "now" is the page's, but a fetch must not be
     re-issued every time it ticks — hence `limit` in the dependency list and
     `now` deliberately out of it. */
  const nowRef = useRef(now);
  nowRef.current = now;

  /* `refreshNonce` is in the dependency list for its effect on identity alone —
     it is never read in the body. That IS the mechanism: pressing Refresh
     changes it, which re-runs the effect, which re-fetches. Biome sees an
     unnecessary dependency, which is exactly what it is and exactly what is
     wanted. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce is the refresh signal — re-running when it changes is the point.
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void api.fetch(limit, controller.signal).then((view) => {
      if (!live) return;
      setArrivedAtMs(Date.now());
      setState(view);
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [api, limit, refreshNonce]);

  /* **Adds a page rather than setting one.** `setLimit(MORE_PAGE)` jumped to 60
     and then did nothing on every later press — with 74 deploys the button
     stayed visible offering 14 more and delivering none. The fake API returned
     one row whatever the limit, so no test could see it. GPT Sol, 2026-09-09. */
  const showMore = useCallback(() => setLimit((n) => Math.min(n + MORE_PAGE, MAX_LIMIT)), []);

  const more = useMemo(
    () => (state.kind === "deploys" ? state.total - state.versions.length : 0),
    [state],
  );

  return (
    <section className="tw:flex tw:flex-col tw:gap-2">
      <SectionHeading>
        <Explain tip={RECORD_TIP}>Deploys</Explain>
      </SectionHeading>

      {state.kind === "loading" ? (
        /* Not a claim about anything — and it says so rather than showing an
           empty list that would read as "no deploys". */
        <Card className="tw:px-3 tw:py-2.5 tw:text-[13px] tw:text-ink-soft">Reading the deploy record…</Card>
      ) : state.kind === "unreadable" ? (
        /* THE SERVER could not look, in the server's voice. */
        <Card className="tw:px-3 tw:py-2.5 tw:text-[13px]">
          <span className="tw:font-semibold tw:text-alarm-ink">The deploy record could not be read.</span>{" "}
          <span className="tw:text-ink-soft">{state.why}</span>
          <p className="tw:mt-1 tw:text-ink-faint">
            This is not a statement about production — it is a statement about this dashboard.
          </p>
        </Card>
      ) : state.kind === "no-answer" ? (
        /* THIS BROWSER never got an answer, in OUR voice. The phone's own
           network trouble must not appear wearing the server's. */
        <Card className="tw:px-3 tw:py-2.5 tw:text-[13px]">
          <span className="tw:font-semibold tw:text-unknown-ink">This page did not get an answer from the box.</span>{" "}
          <span className="tw:text-ink-soft">{state.why}</span>
        </Card>
      ) : (
        <>
          <Freshness view={state} nowMs={now} arrivedAtMs={arrivedAtMs} />

          {state.versions.length === 0 ? (
            /* We READ the record and it is empty — a different claim from
               either failure above, and it names which. */
            <Card className="tw:px-3 tw:py-2.5 tw:text-[13px] tw:text-ink-soft">
              The record was read and holds no deploys at all. It has {state.recordLines} lines.
            </Card>
          ) : (
            <DeployList
              versions={state.versions}
              /* The same corrected clock the header uses, so a deploy's age and
                 the record's age cannot disagree by the device's drift. */
              nowMs={state.servedAtMs + (now - arrivedAtMs)}
            />
          )}

          {/* **The button disappears at the ceiling rather than sitting there
              doing nothing.** `showMore` cannot raise the limit past `MAX_LIMIT`,
              so past that point a visible button is a control that lies. Not
              reachable today at 74 deploys; at ~11 deploys a day it is next
              year's problem, and next year's problem drawn as a working button
              is worse than one drawn as a sentence. Sol's F5. */}
          {more > 0 && state.limit < MAX_LIMIT ? (
            <div className="tw:flex tw:justify-center tw:py-1">
              <Button onClick={showMore}>
                Show more ({more} older {more === 1 ? "deploy" : "deploys"})
              </Button>
            </div>
          ) : more > 0 ? (
            <p className="tw:py-1 tw:text-center tw:text-[12px] tw:text-ink-faint">
              Showing the newest {MAX_LIMIT}. {more} older {more === 1 ? "deploy is" : "deploys are"} in the record and
              not on this page.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

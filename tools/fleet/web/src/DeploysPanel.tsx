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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Explain, type Tip } from "./Tooltip";
import {
  FIRST_PAGE,
  MAX_LIMIT,
  MORE_PAGE,
  ago,
  agoFrom,
  commitUrl,
  deployWhen,
  groupedEntries,
  httpDeploysApi,
  shortSha,
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

/** One deploy. */
function DeployCard({ version, nowMs }: { version: DeployVersion; nowMs: number }): ReactNode {
  const groups = useMemo(() => groupedEntries(version), [version]);
  /* **Memoised because this page re-renders once a second and the answer never
     changes.** `zonedLine` builds three `Intl.DateTimeFormat` instances per
     call; GPT Sol measured the un-memoised version at 46–64 ms per render for
     70 deploys and 110–126 ms for 200 — every second, on a phone. The absolute
     time of a deploy that already happened is the most immutable value on the
     page. Sol's F4. */
  const when = useMemo(() => deployWhen(version.version), [version.version]);

  return (
    <Card className="tw:px-3 tw:py-2.5">
      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
        <span className="tw:font-semibold tw:text-ink">Release {version.release}</span>
        <span className="tw:text-[13px] tw:text-ink-soft">{ago(version.version, nowMs) ?? "at an unreadable time"}</span>
        {version.invisible ? <Pill tone="idle">quiet</Pill> : null}
      </div>

      <div className="tw:mt-1 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1 tw:text-[12px] tw:text-ink-faint">
        <span>{when ?? version.version}</span>
        <span aria-hidden="true">·</span>
        <Sha sha={version.sha} />
        {/* **Null is not zero.** A line that has forgotten what it shipped has
            not shipped nothing, and drawing "0 commits" would be a number
            somebody could act on. */}
        <span aria-hidden="true">·</span>
        <span>
          {version.commitCount === null
            ? "commit count not recorded"
            : `${version.commitCount} ${version.commitCount === 1 ? "commit" : "commits"}`}
        </span>
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
          {version.unreadableEntries} further {version.unreadableEntries === 1 ? "entry" : "entries"} on this deploy
          could not be read, so this list is short.
        </p>
      ) : null}
    </Card>
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
            <div className="tw:flex tw:flex-col tw:gap-2">
              {state.versions.map((version) => (
                <DeployCard
                  key={version.deploymentId}
                  version={version}
                  /* The same corrected clock the header uses, so a deploy's age
                     and the record's age cannot disagree by the device's drift. */
                  nowMs={state.servedAtMs + (now - arrivedAtMs)}
                />
              ))}
            </div>
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

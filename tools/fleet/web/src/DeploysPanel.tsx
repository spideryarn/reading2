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
 * page is when the record was last written, where production's tip actually is,
 * and how far apart those two are.
 *
 * ## The sentence this panel must not get wrong
 *
 * `commitsSince` is the non-merge distance from the newest recorded deploy to
 * `origin/main`. **It is not undeployed work.** Everything on `main` has shipped
 * or is shipping — `main` is written only by `npm run deploy` — so the number
 * lumps together deploys the changelog job has not written up yet and a tip that
 * has not been deployed. Nothing on this box can separate those without a Vercel
 * token. The copy below says the weaker true thing and names what it cannot
 * tell; if you are tempted to tighten it into something punchier, read
 * routes-deploys.ts § The claim in the header first.
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
  MORE_PAGE,
  ago,
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
  head: "Commits no recorded deploy accounts for",
  what: "Non-merge commits between the newest deploy in the record and the current tip of main.",
  how: "Not a count of undeployed work: main is only ever written by a deploy, so these are a mix of deploys not yet written up and a tip not yet deployed. Telling those apart needs Vercel.",
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
function Freshness({ view, nowMs }: { view: Extract<DeploysView, { kind: "deploys" }>; nowMs: number }): ReactNode {
  const generatedAgo = ago(view.lastGeneratedAt, nowMs);
  const mainRef = view.main;

  return (
    <Card className="tw:px-3 tw:py-2.5 tw:text-[13px] tw:text-ink-soft">
      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
        <span className="tw:font-semibold tw:text-ink">The record</span>
        {view.lastGeneratedAt === null ? (
          <span>says nothing about when it was written.</span>
        ) : (
          <span>
            was last written {generatedAgo ?? "at a time this page cannot read"}
            <span className="tw:text-ink-faint"> ({deployWhen(view.lastGeneratedAt) ?? view.lastGeneratedAt})</span>, and
            holds {view.total} {view.total === 1 ? "deploy" : "deploys"}.
          </span>
        )}
      </div>

      <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
        <span className="tw:font-semibold tw:text-ink">Production</span>
        {mainRef.kind === "ref" ? (
          <span>
            is at <Sha sha={mainRef.sha} />, committed {ago(mainRef.committedAt, nowMs) ?? "at an unreadable time"}
            {/* **The age of the VIEW, not of the commit.** The dashboard never
                fetches, so a ref nobody has updated in a week looks exactly like
                a week with no deploys unless this says which it is. */}
            {mainRef.lastFetchAtMs === null ? (
              <span className="tw:text-ink-faint"> — this checkout's view of it, last refreshed at an unknown time</span>
            ) : (
              <span className="tw:text-ink-faint">
                {" "}
                — as this checkout last heard it {ago(new Date(mainRef.lastFetchAtMs).toISOString(), nowMs) ?? ""}
              </span>
            )}
          </span>
        ) : (
          <span className="tw:text-unknown-ink">could not be read: {mainRef.why}</span>
        )}
      </div>

      {/* Ancestry: three arms, and `not-ancestor` is the one worth a colour.
          It means the newest recorded deploy is not on main at all — a rollback,
          or a deploy from somebody's working directory — which changelog.md
          says to check per version precisely because it breaks the ranges
          silently. */}
      <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
        {view.ancestry.kind === "ancestor" ? (
          <span className="tw:text-ink-faint">The newest recorded deploy is on main.</span>
        ) : view.ancestry.kind === "not-ancestor" ? (
          <span className="tw:font-semibold tw:text-alarm-ink">
            The newest recorded deploy is not on main — a rollback, or a deploy from a working directory.
          </span>
        ) : (
          <span className="tw:text-unknown-ink">
            Whether the newest recorded deploy is on main could not be checked: {view.ancestry.why}
          </span>
        )}
      </div>

      <div className="tw:mt-1.5">
        {view.commitsSince.kind === "count" ? (
          <Explain tip={BEHIND_TIP}>
            <span>
              <span className="tw:font-semibold tw:text-ink">{view.commitsSince.commits}</span> commits on main that no
              recorded deploy accounts for.{" "}
              <span className="tw:text-ink-faint">
                Some shipped in deploys the changelog job has not written up yet; some may not be deployed. This page
                cannot tell which apart without Vercel.
              </span>
            </span>
          </Explain>
        ) : (
          <span className="tw:text-unknown-ink">
            How far the record is behind main could not be measured: {view.commitsSince.why}
          </span>
        )}
      </div>

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
  const groups = groupedEntries(version);
  const when = deployWhen(version.version);

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

      {groups.length === 0 ? (
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
              {group.entries.map((entry, i) => (
                <li key={`${group.section}-${i}`} className="tw:text-[13px]">
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
    </Card>
  );
}

export function DeploysPanel({
  api = httpDeploysApi(),
  now,
}: {
  /** Injectable, so a test drives the panel through the seam rather than stubbing `fetch`. */
  api?: DeploysApi;
  /** The page's clock, so every age on screen is anchored to the same tick. */
  now: number;
}): ReactNode {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [limit, setLimit] = useState<number>(FIRST_PAGE);
  /* The panel's own view of "now" is the page's, but a fetch must not be
     re-issued every time it ticks — hence `limit` in the dependency list and
     `now` deliberately out of it. */
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void api.fetch(limit, controller.signal).then((view) => {
      if (live) setState(view);
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [api, limit]);

  const showMore = useCallback(() => setLimit(MORE_PAGE), []);

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
          <Freshness view={state} nowMs={now} />

          {state.versions.length === 0 ? (
            /* We READ the record and it is empty — a different claim from
               either failure above, and it names which. */
            <Card className="tw:px-3 tw:py-2.5 tw:text-[13px] tw:text-ink-soft">
              The record was read and holds no deploys at all. It has {state.recordLines} lines.
            </Card>
          ) : (
            <div className="tw:flex tw:flex-col tw:gap-2">
              {state.versions.map((version) => (
                <DeployCard key={version.deploymentId} version={version} nowMs={now} />
              ))}
            </div>
          )}

          {more > 0 ? (
            <div className="tw:flex tw:justify-center tw:py-1">
              <Button onClick={showMore}>
                Show more ({more} older {more === 1 ? "deploy" : "deploys"})
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

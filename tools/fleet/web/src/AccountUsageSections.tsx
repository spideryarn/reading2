/**
 * **WHICH SUBSCRIPTION STILL HAS ROOM?** — one section per Claude and Codex
 * account-subscription on the box.
 *
 * Greg, 2026-09-10:
 *
 * > The Usage Limits page should have sections for each Claude and Codex
 * > account-subscription, summarising 5d and weekly X% used and when they
 * > reset.
 *
 * and, on 2026-09-09, the two rules this file follows to the letter:
 *
 * > actually I think it is better to always & only say X% used (and leave it to
 * > the user that 100-X% is remaining)
 *
 * > Create separate sections with clear headings for Claude vs Codex […] Hide
 * > the less important stuff in a default-collapsed section (e.g. I have no
 * > idea what NIMBUS_QUILL is!?)
 *
 * Plan 260910c. The data is `tools/overseer/account-usage.ts`, through the
 * Overseer's checkpoint; this file draws it and derives nothing but ages.
 *
 * ## `5d` IS READ AS THE FIVE-HOUR WINDOW
 *
 * Both providers have exactly two windows anyone cares about and in both they
 * are a five-hour one and a weekly one — Claude's are `five_hour` and
 * `seven_day`, Codex's are `primary` and `secondary`, which are POSITIONS and
 * are named by their duration. There is no five-day window in either API. Every
 * window the reading carries is drawn anyway, so the reading is safe either way:
 * the two headline ones are promoted and everything else is collapsed.
 *
 * ## THE RENDERERS ARE `UsagePanel`'S, IMPORTED RATHER THAN REWRITTEN
 *
 * `WindowStatCard` and `CodexBucketSection` already know how to draw a window,
 * and — the part that matters — `windowStat` **re-derives expiry against the
 * browser's clock**, not against the moment of collection. A five-hour window
 * can reset between the checkpoint being written and the page being looked at,
 * and a second renderer here would have inherited the collection-time answer and
 * drawn a percentage for a window that no longer exists. GPT Sol's P1 on this
 * plan, and the reason there is no window-drawing code in this file at all.
 *
 * ## WHAT THIS FILE REFUSES
 *
 *  - **To draw a number for an `unknown` reading.** There is no percentage on
 *    that arm to draw; it says what stopped it instead.
 *  - **To let a short list read as a complete one.** `problems` is drawn
 *    loudly, above the sections, because a registry that would not parse costs
 *    the page every registered account while the ambient ones draw perfectly.
 *  - **To age a section by the pass.** Every section carries its own `takenAt`
 *    and is aged by it; the readings are independent calls and one can be
 *    fifteen minutes older than its neighbour.
 */
import type { ReactNode } from "react";

import { Explain } from "./Tooltip";
import type { AccountUsageSection, AccountUsageView, ClockSkew, UsageWindowCard } from "./types";
import { ago, CodexBucketSection, CodexResetCreditsCard, WindowStatCard } from "./UsagePanel";
import { Card, cx, Pill, StatCard } from "./ui";

/**
 * How old a per-account reading may be before its age is worth pointing at.
 *
 * The pass runs every 300 seconds, so this is four missed passes — the same
 * number `UsagePanel` uses, and generous for the same reason: a restart or a
 * busy box must not put a warning on a healthy section. It never suppresses
 * anything; the age is printed either way, and past this it is printed loudly.
 */
const READING_STALE_MS = 20 * 60_000;

/**
 * The two windows that get promoted to the top of a Claude section.
 *
 * Everything else — the rotating codename windows Anthropic adds and removes
 * without notice — goes in the collapsed block below, by name. **Filtered out
 * rather than hidden would be wrong**: rule 6 of the eight in
 * docs/project/usage-history.md is that an unrecognised window is a named row,
 * and a window nobody can explain is still a limit that can stop work.
 */
const HEADLINE_WINDOWS = new Set(["five_hour", "seven_day"]);

/** What a Claude window is called on screen. The raw name for anything else. */
function windowLabel(name: string): string {
  if (name === "five_hour") return "5 hours";
  if (name === "seven_day") return "7 days";
  return name;
}

/** The one Codex bucket that is about the whole subscription rather than one model. */
function isGeneralBucket(limitId: string): boolean {
  return limitId === "codex";
}

function SectionHeading({ section, asOf, skew }: { section: AccountUsageSection; asOf: number; skew: ClockSkew }): ReactNode {
  /* THE SECTION'S OWN CLOCK. Not the pass's: these are independent calls and
     one account can answer fifteen minutes before its neighbour does. */
  const reading = ago(section.takenAt, asOf, skew);
  const stale = reading.ms !== null && reading.ms > READING_STALE_MS;
  const name = section.displayEmail ?? section.name;
  return (
    <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-2">
      <h3 className="tw:text-lead tw:font-semibold">{name}</h3>
      {section.displayEmail === null ? null : (
        <span className="tw:text-label tw:text-ink-faint">{section.name}</span>
      )}
      <Pill tone="idle">{section.role}</Pill>
      {section.origin === "ambient" ? (
        <Explain
          tip={{
            head: "The login this box falls back to",
            what: "The account a process gets when nothing routes it at a registered one — the account the Overseer itself runs on.",
            how: "It cannot be added to the account registry, so nothing pins its identity: what you see is whatever the provider answered. Every other section here was checked against a recorded account id before it was drawn.",
          }}
        >
          <Pill tone="unknown">ambient</Pill>
        </Explain>
      ) : null}
      <span className={cx("tw:text-label", stale ? "tw:font-medium tw:text-alarm-ink" : "tw:text-ink-faint")}>
        read {reading.text}
      </span>
    </div>
  );
}

/**
 * One Claude account: the five-hour and weekly windows, then everything else.
 *
 * The extras are a `<details>` rather than a filter — see `HEADLINE_WINDOWS`.
 */
function ClaudeSection({ section, asOf, skew }: { section: Extract<AccountUsageSection, { family: "claude" }>; asOf: number; skew: ClockSkew }): ReactNode {
  if (section.reading.kind === "unknown") {
    return (
      <div className="tw:mt-3">
        <StatCard
          label="Headroom"
          value={{ kind: "absent", state: "unknown", why: section.reading.why }}
          tone="unknown"
        />
      </div>
    );
  }
  const windows = section.reading.windows;
  const headline = windows.filter((window) => HEADLINE_WINDOWS.has(window.window));
  const rest = windows.filter((window) => !HEADLINE_WINDOWS.has(window.window));
  const labelled = (window: UsageWindowCard): UsageWindowCard => ({ ...window, window: windowLabel(window.window) });
  return (
    <div className="tw:mt-2">
      {headline.length === 0 ? (
        <StatCard
          label="Headroom"
          value={{
            kind: "absent",
            state: "unknown",
            why:
              windows.length === 0
                ? "this account reported no windows at all"
                : "this account reported no five-hour or weekly window; what it did report is below",
          }}
          tone="unknown"
        />
      ) : (
        <div className="tw:grid tw:grid-cols-2 tw:gap-2">
          {headline.map((window) => (
            <WindowStatCard key={window.window} window={labelled(window)} asOf={asOf} skew={skew} />
          ))}
        </div>
      )}
      {rest.length === 0 ? null : (
        <details className="tw:mt-2">
          <summary className="tw:cursor-pointer tw:text-label tw:text-ink-faint">
            {rest.length} other window{rest.length === 1 ? "" : "s"} on this account — rotating limits Anthropic
            adds and removes without notice
          </summary>
          <div className="tw:mt-2 tw:grid tw:grid-cols-2 tw:gap-2">
            {rest.map((window) => (
              <WindowStatCard key={window.window} window={window} asOf={asOf} skew={skew} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** One Codex account: the general bucket, then any model-specific ones, collapsed. */
function CodexSection({ section, asOf, skew }: { section: Extract<AccountUsageSection, { family: "codex" }>; asOf: number; skew: ClockSkew }): ReactNode {
  if (section.reading.kind === "unknown") {
    return (
      <div className="tw:mt-3">
        <StatCard
          label="General headroom"
          value={{ kind: "absent", state: "unknown", why: section.reading.why }}
          tone="unknown"
        />
      </div>
    );
  }
  const buckets = section.reading.buckets;
  const general = buckets.filter((bucket) => isGeneralBucket(bucket.limitId));
  const specific = buckets.filter((bucket) => !isGeneralBucket(bucket.limitId));
  return (
    <div className="tw:mt-1">
      {general.length === 0 ? (
        <StatCard
          label="General headroom"
          value={{
            kind: "absent",
            state: "unknown",
            why: "this account reported no general subscription bucket, only model-specific ones",
          }}
          tone="unknown"
        />
      ) : (
        general.map((bucket) => (
          <CodexBucketSection key={bucket.limitId} bucket={bucket} general asOf={asOf} skew={skew} />
        ))
      )}
      {specific.length === 0 ? null : (
        <details className="tw:mt-2">
          <summary className="tw:cursor-pointer tw:text-label tw:text-ink-faint">
            {specific.length} model-specific limit{specific.length === 1 ? "" : "s"} on this account
          </summary>
          {specific.map((bucket) => (
            <CodexBucketSection key={bucket.limitId} bucket={bucket} general={false} asOf={asOf} skew={skew} />
          ))}
        </details>
      )}
      <div className="tw:mt-3">
        <CodexResetCreditsCard resetCredits={section.reading.resetCredits} />
      </div>
    </div>
  );
}

function SectionReading({ section, asOf, skew }: { section: AccountUsageSection; asOf: number; skew: ClockSkew }): ReactNode {
  if (ago(section.takenAt, asOf, skew).ms === null) {
    return (
      <div className="tw:mt-3">
        <StatCard
          label="Headroom"
          value={{
            kind: "absent",
            state: "unavailable",
            why: "the reading instant is in the future or cannot be compared with this page’s clock",
          }}
          tone="unknown"
        />
      </div>
    );
  }
  return section.family === "claude" ? (
    <ClaudeSection section={section} asOf={asOf} skew={skew} />
  ) : (
    <CodexSection section={section} asOf={asOf} skew={skew} />
  );
}

function FamilyBlock({
  heading,
  sections,
  asOf,
  skew,
}: {
  heading: string;
  sections: readonly AccountUsageSection[];
  asOf: number;
  skew: ClockSkew;
}): ReactNode {
  return (
    <Card className="tw:mb-3 tw:p-4">
      <h2 className="tw:text-lead tw:font-semibold">{heading}</h2>
      {sections.length === 0 ? (
        /* **NOT AN EMPTY BLOCK.** A family heading with nothing under it reads
           as "this box has no Codex subscriptions", which is a claim. The pass
           either found none or could not look, and only it knows which. */
        <p className="tw:mt-2 tw:text-ink-faint">
          No {heading.toLowerCase()} were read on the last pass. That is not the same as there being none — see the
          reading above.
        </p>
      ) : (
        sections.map((section) => (
          <section key={`${section.family}/${section.name}`} className="tw:mt-4 tw:first:mt-2">
            <SectionHeading section={section} asOf={asOf} skew={skew} />
            <SectionReading section={section} asOf={asOf} skew={skew} />
          </section>
        ))
      )}
    </Card>
  );
}

/**
 * The whole set of sections, or the honest reason there are none.
 *
 * **Every non-published arm gets its own sentence**, and specifically
 * `no-reading` and `reading-unreadable` are not folded together: *no pass has
 * run* is ordinary and means nothing is broken, while *a reading is there and
 * this page cannot read it* is a producer and a consumer that have come apart,
 * and telling somebody nothing is wrong in the second case sends them away from
 * the thing that is.
 */
export function AccountUsageSections({
  view,
  asOf,
  skew,
}: {
  view: AccountUsageView;
  asOf: number;
  skew: ClockSkew;
}): ReactNode {
  if (view.kind === "published") {
    const claude = view.accounts.filter((section) => section.family === "claude");
    const codex = view.accounts.filter((section) => section.family === "codex");
    return (
      <>
        {view.problems.length === 0 ? null : (
          /* LOUD, AND ABOVE THE SECTIONS. A registry that would not parse costs
             the page every registered account while the ambient ones draw
             perfectly — so without this the page says "this box has one Claude
             subscription" with nothing to contradict it. */
          <Card className="tw:mb-3 tw:p-4">
            <h2 className="tw:text-lead tw:font-semibold tw:text-alarm-ink">
              This list may be incomplete
            </h2>
            <ul className="tw:mt-2 tw:list-disc tw:pl-5">
              {view.problems.map((problem) => (
                <li key={problem} className="tw:text-ink-faint">{problem}</li>
              ))}
            </ul>
          </Card>
        )}
        <FamilyBlock heading="Claude subscriptions" sections={claude} asOf={asOf} skew={skew} />
        <FamilyBlock heading="Codex subscriptions" sections={codex} asOf={asOf} skew={skew} />
      </>
    );
  }

  const why =
    view.kind === "not-asked"
      ? "This server did not look for per-account readings. That is not a claim that this box has one subscription — nothing here has checked."
      : view.kind === "checkpoint-absent"
        ? "The Overseer has written no checkpoint, so nothing has read any account-subscription yet."
        : view.kind === "checkpoint-unreadable"
          ? `The Overseer's checkpoint could not be read: ${view.why}`
          : view.kind === "unsupported-schema"
            ? `The Overseer's checkpoint is version ${view.saw} and this page reads version ${view.known}, so its fields may have moved.`
            : view.kind === "no-reading"
              ? `${view.why} Nothing is wrong with the file.`
              : view.kind === "reading-unreadable"
                ? `${view.why} The producer and this page have come apart — something is wrong, unlike the case above.`
                : view.why;

  return (
    <Card className="tw:mb-3 tw:p-4">
      <h2 className="tw:text-lead tw:font-semibold">There is no per-account reading.</h2>
      <p className="tw:mt-2 tw:text-ink-faint">{why}</p>
    </Card>
  );
}

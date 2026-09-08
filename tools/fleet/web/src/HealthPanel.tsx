/**
 * Box health, rendered without knowing what it is.
 *
 * **THE COLLECTOR IS NOT OURS.** `tools/fleet/health.ts` was written in
 * parallel with this file by another agent, so the `health` field on the
 * payload is typed `unknown` in types.ts and this panel draws whatever arrives
 * — objects, arrays, numbers, strings, nothing. That is not a placeholder for a
 * schema-aware panel; it is the honest version of a panel whose schema belongs
 * to somebody else, and it means a reading the collector adds tomorrow appears
 * here without anybody editing this file. Exactly ONE field is read by name and
 * lifted to the top — see `Verdict` below, and the argument there for why the
 * second one should be resisted.
 *
 * **Absence is stated, never drawn as emptiness.** `health: null` means the
 * server had nothing to give, and this says so with the reason it is most
 * likely to be — because a blank panel and a healthy box look identical, and
 * the whole tool is built around not letting those two be confused.
 */
import type { ReactNode } from "react";

import { Card, Pill, cx, toneClasses } from "./ui";
import type { Tone } from "./view";

/**
 * How deep to draw, and how much.
 *
 * Both are guards rather than layout: this renders a payload nobody has
 * specified, and a deeply nested or enormous one would otherwise lock the
 * browser on a phone. Hitting either limit SAYS SO on the page rather than
 * trailing off, so a truncated view can never be mistaken for a complete one.
 */
const MAX_DEPTH = 6;
const MAX_ITEMS = 200;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A leaf, drawn in the mono face so numbers and ids line up. */
function Leaf({ value }: { value: unknown }): ReactNode {
  if (value === null) return <span className="tw:font-mono tw:text-[12px] tw:text-ink-faint">null</span>;
  if (typeof value === "boolean") {
    return (
      <span className={cx("tw:font-mono tw:text-[12px]", value ? "tw:text-work-ink" : "tw:text-ink-soft")}>
        {value ? "true" : "false"}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="tw:font-mono tw:text-[12px] tw:text-ink">{String(value)}</span>;
  }
  if (typeof value === "string") {
    // No quotes: these are values a person reads, not a JSON dump. React
    // escapes it, which is the reason this whole client exists.
    return <span className="tw:text-[13px] tw:break-words tw:text-ink">{value}</span>;
  }
  return <span className="tw:font-mono tw:text-[12px] tw:text-ink-faint">{typeof value}</span>;
}

/** Any value at all, at a depth. */
function Value({ value, depth }: { value: unknown; depth: number }): ReactNode {
  if (depth > MAX_DEPTH) {
    return (
      <span className="tw:text-[12px] tw:text-unknown-ink">
        …nested deeper than this page will draw
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="tw:text-[12px] tw:text-ink-faint">empty list</span>;
    const shown = value.slice(0, MAX_ITEMS);
    return (
      <ol className="tw:mt-1 tw:space-y-1 tw:border-l tw:border-rule tw:pl-3">
        {shown.map((item, index) => (
          <li key={index}>
            <Value value={item} depth={depth + 1} />
          </li>
        ))}
        {value.length > shown.length ? (
          <li className="tw:text-[12px] tw:text-unknown-ink">
            …and {value.length - shown.length} more not drawn
          </li>
        ) : null}
      </ol>
    );
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className="tw:text-[12px] tw:text-ink-faint">empty</span>;
    const shown = entries.slice(0, MAX_ITEMS);
    return (
      <dl className={cx("tw:space-y-1", depth > 0 && "tw:mt-1 tw:border-l tw:border-rule tw:pl-3")}>
        {shown.map(([key, item]) => (
          <div key={key} className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2">
            <dt className="tw:font-mono tw:text-[12px] tw:text-ink-faint">{key}</dt>
            <dd className="tw:min-w-0 tw:flex-1">
              <Value value={item} depth={depth + 1} />
            </dd>
          </div>
        ))}
        {entries.length > shown.length ? (
          <div className="tw:text-[12px] tw:text-unknown-ink">
            …and {entries.length - shown.length} more not drawn
          </div>
        ) : null}
      </dl>
    );
  }

  return <Leaf value={value} />;
}

/**
 * The one field this panel reads by name: `verdict`.
 *
 * `tools/fleet/health.ts` computes `{ level, reasons }` and its own header says
 * why `unknown` is a fourth level beside ok/strained/critical — *a missing
 * reading must never collapse into looking healthy*. That is the same argument
 * the session statuses make, so it gets the same treatment here: its own line,
 * in the tone the rest of the tool already uses for that meaning.
 *
 * **Lifting it is not inventing a schema.** Everything else stays generic
 * below, and this returns null the moment the shape is not what it expects — so
 * a collector that renames the field loses a banner rather than a page, and the
 * field still appears in the generic view underneath. Read the whole panel
 * before adding a second of these: one headline is a summary, six is a schema,
 * and a schema written here goes stale where nobody is looking.
 */
const LEVEL_TONE: Record<string, Tone> = {
  ok: "work",
  strained: "needs",
  critical: "needs",
  unknown: "unknown",
};

function Verdict({ health }: { health: unknown }): ReactNode {
  if (!isRecord(health)) return null;
  const verdict = health["verdict"];
  if (!isRecord(verdict)) return null;
  const level = verdict["level"];
  if (typeof level !== "string") return null;
  const tone = LEVEL_TONE[level] ?? "unknown";
  const reasons = Array.isArray(verdict["reasons"])
    ? verdict["reasons"].filter((r): r is string => typeof r === "string")
    : [];
  return (
    <Card
      className={cx(
        "tw:mb-3 tw:border-l-4 tw:p-4",
        toneClasses(tone).edge,
        tone === "needs" && "tw:bg-needs-wash",
      )}
    >
      <div className="tw:flex tw:items-center tw:gap-2">
        <Pill tone={tone}>{level}</Pill>
        <span className="tw:text-[13px] tw:text-ink-faint">the box, as it reports itself</span>
      </div>
      {reasons.length > 0 ? (
        <ul className="tw:mt-2 tw:space-y-1 tw:text-[13px] tw:text-ink-soft">
          {reasons.map((reason, index) => (
            <li key={`${index}-${reason}`} className="tw:break-words">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

export function HealthPanel({ health }: { health: unknown }): ReactNode {
  if (health === null || health === undefined) {
    return (
      <Card className="tw:border-l-4 tw:border-l-unknown tw:p-4">
        <h2 className="tw:font-medium">No box health data.</h2>
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
          The server sent <code className="tw:font-mono">health: null</code>, which means it had
          nothing to give — not that the box is well. The collector is
          <code className="tw:font-mono"> tools/fleet/health.ts</code>, and it is being written
          separately from this page.
        </p>
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-faint">
          Until it lands, load average and memory are what the box reports to whoever is logged into
          it. This page will draw whatever shape the collector chooses without needing a change here.
        </p>
      </Card>
    );
  }

  return (
    <div>
      <Verdict health={health} />
      <Card className="tw:p-4">
        <p className="tw:mb-3 tw:text-[11px] tw:tracking-widest tw:text-ink-faint tw:uppercase">
          As the server sent it
        </p>
        <Value value={health} depth={0} />
      </Card>
    </div>
  );
}

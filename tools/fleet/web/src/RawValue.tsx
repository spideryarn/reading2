/**
 * Drawing a payload nobody here has a schema for.
 *
 * Lifted out of HealthPanel.tsx unchanged on 2026-09-08, because a second
 * caller arrived: a box action's **dry run** answers *what would you kill*, and
 * the shape of that answer belongs to `tools/fleet/routes-actions.ts` the same
 * way the health reading belongs to `health.ts`. Two generic renderers would be
 * two places for a phone to lock up on a deeply nested object, so there is one.
 *
 * The guards are the reason it is worth sharing rather than re-typing. Both
 * limits SAY SO on the page when they bite, so a truncated view can never be
 * mistaken for a complete one — which matters more on a kill list than on a
 * health dump: *these are the seventeen processes* and *these are the first two
 * hundred of them* are different sentences, and only one of them is safe to
 * press Confirm under.
 */
import type { ReactNode } from "react";

import { cx } from "./ui";

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
export function RawValue({ value, depth }: { value: unknown; depth: number }): ReactNode {
  if (depth > MAX_DEPTH) {
    return <span className="tw:text-[12px] tw:text-unknown-ink">…nested deeper than this page will draw</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="tw:text-[12px] tw:text-ink-faint">empty list</span>;
    const shown = value.slice(0, MAX_ITEMS);
    return (
      <ol className="tw:mt-1 tw:space-y-1 tw:border-l tw:border-rule tw:pl-3">
        {shown.map((item, index) => (
          <li key={index}>
            <RawValue value={item} depth={depth + 1} />
          </li>
        ))}
        {value.length > shown.length ? (
          <li className="tw:text-[12px] tw:text-unknown-ink">…and {value.length - shown.length} more not drawn</li>
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
              <RawValue value={item} depth={depth + 1} />
            </dd>
          </div>
        ))}
        {entries.length > shown.length ? (
          <div className="tw:text-[12px] tw:text-unknown-ink">…and {entries.length - shown.length} more not drawn</div>
        ) : null}
      </dl>
    );
  }

  return <Leaf value={value} />;
}

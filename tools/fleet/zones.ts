/**
 * **ONE INSTANT, THREE CLOCKS** — every instant this box shows a person, said
 * in UTC, London and Athens. The usage card and `scripts/overseer.ts` are the
 * first consumers; the Deploys tab is the second.
 *
 * > include timezone because I'm bouncing between London/Athens
 * >
 * > — Greg, 2026-09-08
 *
 * That is the whole requirement and this is the whole implementation. There is
 * no setting, no detection of where he is, and no "local time": a page rendered
 * on the box and a page rendered on a phone in Athens would disagree about what
 * "local" means, and the one thing a reset time may not be is ambiguous. All
 * three are labelled and all three are always shown, so whichever he is in is
 * on screen without anybody having told the tool anything.
 *
 * **THE DATE IS NOT DECORATION.** A five-hour window resetting at 23:40 UTC is
 * 02:40 in Athens *the next day*, and a bare `02:40 Athens` beside `23:40 UTC`
 * reads as three hours in the PAST — the reader concludes the limit has already
 * cleared. So a zone whose calendar date differs from UTC's carries `(+1d)` or
 * `(−1d)`, which is the smallest thing that cannot be misread.
 *
 * **A LEAF WITH NO IMPORTS, deliberately**, because it is used from three
 * places that cannot share a Node module: the fleet server, the browser bundle
 * (`tools/fleet/web/` may import a leaf under `tools/fleet/` — `overseer-claim.ts`
 * is the precedent) and `scripts/overseer.ts`. `Intl` is in all three.
 *
 * **Every function returns `null` rather than throwing on an unreadable
 * instant.** The callers are a card that must not blank the page and a CLI
 * line that must not take down `overseer status`; an unparseable timestamp is a
 * thing to say, not a thing to crash on.
 */

/** A list of zones to render an instant in, each with the label that goes on screen. */
export type Zones = readonly { readonly zone: string; readonly label: string }[];

/**
 * **THE ZONES THIS BOX RENDERS IN**, in reading order.
 *
 * UTC first because it is the one the underlying data is in — `resets_at` and
 * `collectedAt` are both ISO — so a reader comparing the page against a raw
 * file or a log line has the identical string in front of them, and the two
 * civil times are the convenience beside it.
 *
 * **Named `DISPLAY_ZONES` rather than `USAGE_ZONES`, which is what it was
 * called for about an hour.** The usage card created it, but a deploy time is
 * the same wall-clock question for the same person in the same two cities, and
 * a shared formatter named after its first consumer is a misnomer that gets
 * more expensive with every later one. Renamed on 2026-09-09 while the file was
 * still unlanded and had three references.
 *
 * **A second consumer should pass its own list rather than edit this one.**
 * That is what the `zones` parameter is for: this constant is Greg's *"I'm
 * bouncing between London/Athens"* and changing it changes the usage card and
 * `overseer status` too.
 */
export const DISPLAY_ZONES: Zones = [
  { zone: "UTC", label: "UTC" },
  { zone: "Europe/London", label: "London" },
  { zone: "Europe/Athens", label: "Athens" },
];

/** One instant as one zone reads it. */
export type ZonedReading = {
  /** IANA name, e.g. `Europe/Athens`. */
  zone: string;
  /** What goes on screen beside the time, e.g. `Athens`. */
  label: string;
  /** `YYYY-MM-DD` in that zone. */
  date: string;
  /** `HH:mm` in that zone, 24-hour. */
  time: string;
  /**
   * This zone's calendar date minus UTC's, in whole days: `0`, `1` or `-1`.
   *
   * The reason the date is carried at all — see the header. Computed from the
   * two calendar dates rather than from an offset, so it is right across a DST
   * transition without anybody having to reason about one.
   */
  dayOffset: number;
};

/**
 * The three readings of an instant, or `null` if it is not one.
 *
 * `iso` is anything `Date` accepts; production hands it strings that came out
 * of `toISOString()` or `new Date(ms).toISOString()`.
 *
 * **`zones` is a parameter with the product's answer as its default**, so this
 * stays a formatter rather than a formatter with a product decision welded into
 * it — and so the `(−1d)` branch is reachable from a test. London and Athens
 * are both ahead of UTC all year, so nothing this box renders can ever produce
 * a negative offset; a branch no test can reach is one nobody can trust, and
 * deleting it instead would print a zone a day BEHIND as if it were the same
 * day the moment the list changes.
 */
export function zonedReadings(iso: string, zones: Zones = DISPLAY_ZONES): ZonedReading[] | null {
  const at = new Date(iso);
  const ms = at.getTime();
  if (!Number.isFinite(ms)) return null;
  const utcDay = dayNumber(calendar(at, "UTC"));
  if (utcDay === null) return null;
  const out: ZonedReading[] = [];
  for (const { zone, label } of zones) {
    const parts = calendar(at, zone);
    if (parts === null) return null;
    const day = dayNumber(parts);
    if (day === null) return null;
    out.push({
      zone,
      label,
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
      dayOffset: day - utcDay,
    });
  }
  return out;
}

/**
 * The one-line form: `2026-09-08 23:40 UTC · 00:40 London (+1d) · 02:40 Athens (+1d)`.
 *
 * The date is printed once, on the UTC reading, because that is the one the
 * other two are offset FROM; repeating it three times is noise on a line a
 * reader skims. `null` for an instant that cannot be read, so a caller can say
 * so in its own words rather than printing `Invalid Date`.
 */
export function zonedLine(iso: string, zones: Zones = DISPLAY_ZONES): string | null {
  const readings = zonedReadings(iso, zones);
  if (readings === null) return null;
  return readings
    .map((r, index) => `${index === 0 ? `${r.date} ` : ""}${r.time} ${r.label}${offsetSuffix(r.dayOffset)}`)
    .join(" · ");
}

/**
 * **LONDON FIRST** — the list the schedule preview prints in, both in `overseer
 * status` and on the Overseer tab (plan 260910e § D1). A second list rather
 * than an edit to `DISPLAY_ZONES`, as that constant's comment asks.
 */
export const LONDON_FIRST: Zones = [
  { zone: "Europe/London", label: "London" },
  { zone: "UTC", label: "UTC" },
  { zone: "Europe/Athens", label: "Athens" },
];

/**
 * The one-line form with **every day mark taken against the FIRST zone**, which
 * is the date actually printed — for a list that does not start with UTC.
 *
 * `zonedLine` prints the first zone's date and marks every zone against UTC's,
 * which is right when UTC is first and a misreading otherwise: with London
 * first, 23:30 UTC would print `2026-09-11 00:30 London (+1d)` — London's own
 * date, and then a `+1d` that reads as the day after it. Found by plan 260910e's
 * Stage 2 in the CLI, and moved here so the CLI and the browser print one way.
 */
export function zonedLineAgainstFirst(iso: string, zones: Zones): string | null {
  const readings = zonedReadings(iso, zones);
  const first = readings?.[0];
  if (readings === null || first === undefined) return null;
  return readings
    .map((r, index) => `${index === 0 ? `${r.date} ` : ""}${r.time} ${r.label}${offsetSuffix(r.dayOffset - first.dayOffset)}`)
    .join(" · ");
}

/** `zonedLineAgainstFirst` over `LONDON_FIRST`: `2026-09-11 00:30 London · 23:30 UTC (−1d) · 02:30 Athens`. */
export function londonFirstLine(iso: string): string | null {
  return zonedLineAgainstFirst(iso, LONDON_FIRST);
}

/** `(+1d)`, `(−1d)`, or nothing at all on the ordinary day. A true minus sign; it is prose, not a field. */
function offsetSuffix(dayOffset: number): string {
  if (dayOffset === 0) return "";
  return dayOffset > 0 ? ` (+${dayOffset}d)` : ` (−${Math.abs(dayOffset)}d)`;
}

type Calendar = { year: string; month: string; day: string; hour: string; minute: string };

/**
 * The zone's own calendar fields, via `formatToParts`.
 *
 * **Parts rather than a formatted string**, because the order and separators of
 * a formatted date are the locale's business and this needs the numbers. `en-GB`
 * is named anyway so the *parts* are Gregorian and Latin-digit whatever the host
 * default is — a box set to `ar-SA` would otherwise hand back Hijri years.
 *
 * `hourCycle: "h23"` rather than `hour12: false`, which in several ICU versions
 * yields `24` for midnight.
 */
function calendar(at: Date, zone: string): Calendar | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    /* An ICU without this zone, or a host whose Intl refuses it. The caller
       says "at a time this page cannot read" rather than drawing a wrong one. */
    return null;
  }
  const found = new Map<string, string>();
  for (const part of parts) found.set(part.type, part.value);
  const year = found.get("year");
  const month = found.get("month");
  const day = found.get("day");
  const hour = found.get("hour");
  const minute = found.get("minute");
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined) {
    return null;
  }
  return { year, month, day, hour, minute };
}

/**
 * A calendar date as a whole number of days, so two of them can be subtracted.
 *
 * `Date.UTC` of the zone's own y/m/d — NOT of the instant — which is what makes
 * the difference a comparison of CALENDAR DATES and not of offsets. A DST jump
 * moves the clock and not the date, so it cannot reach this number.
 */
function dayNumber(parts: Calendar | null): number | null {
  if (parts === null) return null;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const ms = Date.UTC(year, month - 1, day);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

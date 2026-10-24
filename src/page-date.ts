/**
 * **A web page's publication day when its markup states none** — read off the
 * line printed under its title, or else off its address. No model, and every
 * accepted day is copied from the page or its URL rather than invented.
 *
 * Stage 2's first source is Readability's `publishedTime`, which comes from
 * `article:published_time` or JSON-LD `datePublished` (src/extract.ts §
 * `publicationDate`). Plenty of blogs declare neither and print the date under
 * the title and in the path instead: `mariozechner.at/posts/2025-11-02-…/`,
 * with `<p>2025-11-02</p>` under its `<h1>` (report spya-gapqbt, plan 261024a).
 *
 * **The two are not equally good evidence, so they go in at different
 * places.** The dateline is the page's own printed claim, like the meta tag,
 * and stage 2 puts it in `Meta.publishedAt`. The address is the weakest
 * source: a path can be a filing scheme, or name the day of an event the piece
 * is about. So it is handed back beside `meta` and applied by
 * `withAddressDay` only after the registry has had its turn, and only when
 * that left neither a day nor a year (src/pipeline.ts, the `extract` step).
 *
 * Both give a calendar day, `YYYY-MM-DD`, or nothing. Month names are read
 * here into numbers, never by `Date.parse`, which would read
 * `"November 2, 2025"` in the server's zone. A day must exist, fall in the
 * web's lifetime (`MIN_YEAR` on), and not be after the fetch: a refused day is
 * no date, which is honest, rather than a nearby one.
 */
import { realIsoDay } from "./bibliographic.js";
import { openingRecordElement, type OpeningRecord } from "./front-matter-authors.js";
import type { Meta } from "./types.js";

/** Before this, a "date" on a web page is a date in the piece, not the day it was put up. */
const MIN_YEAR = 1990;

/** How many records after the heading a dateline may sit. */
const DATELINE_WINDOW = 3;

/** Containers used for ordinary title furniture, not captions, lists, tables or headings. */
const DATELINE_ELEMENTS = new Set(["P", "DIV", "HEADER", "SECTION", "ARTICLE"]);

/** What may come before the date on its line, and nothing else may. */
const PREFIX = /^(?:(?:first\s+)?(?:published|posted)(?:\s+on)?:?\s+)?/iu;

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};
const MONTH = `(${Object.keys(MONTHS).join("|")})\\.?`;
const ORD = "(?:st|nd|rd|th)?";

/** Each the whole line, after its prefix: year, month number, day. */
const DATE_FORMS: { re: RegExp; parts: (m: RegExpExecArray) => [string, number, string] }[] = [
  /* 2025-11-02 */
  { re: /^(\d{4})-(\d{2})-(\d{2})$/u, parts: (m) => [m[1]!, Number(m[2]), m[3]!] },
  /* 2 November 2025, 2nd Nov 2025, 2 Nov, 2025 */
  { re: new RegExp(`^(\\d{1,2})${ORD}\\s+${MONTH},?\\s+(\\d{4})$`, "iu"), parts: (m) => [m[3]!, MONTHS[m[2]!.toLowerCase()]!, m[1]!] },
  /* November 2, 2025, Nov 2 2025 */
  { re: new RegExp(`^${MONTH}\\s+(\\d{1,2})${ORD},?\\s+(\\d{4})$`, "iu"), parts: (m) => [m[3]!, MONTHS[m[1]!.toLowerCase()]!, m[2]!] },
];

/** `y`, `m`, `d` as a real day in range, or nothing. */
function day(y: string, m: number, d: string, fetchedAt: string): string | undefined {
  const iso = realIsoDay(`${y}-${String(m).padStart(2, "0")}-${d.padStart(2, "0")}`);
  if (iso === undefined || Number(y) < MIN_YEAR) return undefined;
  /* A day after the fetch is not when it was published. Compared as days, and
     against the latest calendar day anywhere on earth, so a piece dated today
     in a zone ahead of UTC is still today. */
  const ceiling = latestLocalDay(fetchedAt);
  return ceiling !== undefined && iso <= ceiling ? iso : undefined;
}

/** The latest day any inhabited time zone can call today at an ISO instant (UTC+14). */
function latestLocalDay(instant: string): string | undefined {
  const t = Date.parse(instant);
  return Number.isNaN(t) ? undefined : new Date(t + 14 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

/**
 * **The day printed on the line under the title**, when there is one.
 *
 * Only when the opening starts at the page's main heading (`headed`, from
 * `openingHeading` in src/front-matter-authors.ts). A page with no `<h1>` is
 * read from the top of its body, where a bare date is as likely to be the
 * site's header as the piece's. The heading record itself is skipped: a title
 * such as `May 2, 2025` is not evidence that the piece was published that day.
 * Then the first `DATELINE_WINDOW` records under it are considered, and a
 * record counts only when the whole of it is a date, with at most a
 * `Published` or `Posted on` in front. Captions, lists, tables and headings do
 * not count. `Conference | November 2, 2025` and `Updated 2 November 2025`
 * are not datelines; neither is a sentence.
 */
export function datelineDay(opening: readonly OpeningRecord[], headed: boolean, fetchedAt: string): string | undefined {
  if (!headed) return undefined;
  for (const record of opening.slice(1, DATELINE_WINDOW + 1)) {
    const element = openingRecordElement(record);
    if (element !== undefined && !DATELINE_ELEMENTS.has(element)) continue;
    const bare = record.text.trim().replace(PREFIX, "");
    for (const form of DATE_FORMS) {
      const m = form.re.exec(bare);
      if (!m) continue;
      const found = day(...form.parts(m), fetchedAt);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * **The day in the page's address**: three path segments `/2025/11/02/`, or a
 * whole segment `2025-11-02` / conventional `2025-11-02-slug`. Percent escapes
 * inside a segment are decoded first. The first dated segment decides, valid
 * or not. The query string and fragment are never read: `?date=…` is a filter,
 * not a publication.
 */
export function addressDay(url: string | null | undefined, fetchedAt: string): string | undefined {
  if (!url) return undefined;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    /* A whole date segment or the conventional `YYYY-MM-DD-slug`. Requiring
       the hyphen boundary keeps `2024-03-14th-anniversary` from looking like a
       date-prefixed slug. */
    const dashed = /^(\d{4})-(\d{2})-(\d{2})(?:$|-)/u.exec(s);
    if (dashed) return day(dashed[1]!, Number(dashed[2]), dashed[3]!, fetchedAt);
    const [m, d] = [segments[i + 1], segments[i + 2]];
    if (/^\d{4}$/u.test(s) && m !== undefined && d !== undefined && /^\d{1,2}$/u.test(m) && /^\d{1,2}$/u.test(d)) {
      return day(s, Number(m), d, fetchedAt);
    }
  }
  return undefined;
}

/**
 * `meta` with the address's day as `publishedAt`, **only when it has neither a
 * day nor a year** — after the page's markup, its dateline and the registry,
 * every one of which is better evidence. An article has a day or a year,
 * never both (`Meta.publishedYear`).
 */
export function withAddressDay(meta: Meta, day: string | undefined): Meta {
  if (day === undefined || meta.publishedAt !== undefined || meta.publishedYear !== undefined) return meta;
  return { ...meta, publishedAt: day };
}

/**
 * **A web note as the owner may be shown it, and when a stored answer still
 * stands** — the pure half of src/citation-web-note.ts, apart so the owner's
 * `loadBibliography` (src/store/pg.ts) and the press's own free refusals ask
 * the same questions without importing a model call. Plan 261018o stage 2
 * (docs/plans/261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md),
 * as amended by its review's R4 and R8.
 *
 * **Never in the public DTO** (src/public/dto.ts): a web note is shown to the
 * article's owner only, because the press that made it was theirs and the page
 * is a stranger's (tests/public-dto.test.ts pins that it is dropped). Not in
 * chat in v1 either: chat reads the abstract notes only.
 */

import { BLURB_MAX_CHARS, BLURB_MAX_SENTENCES, BLURB_QUOTE_MAX_CHARS, type IdentityRow, rowIdentity } from "./citation-blurbs-identity.js";
import type { Bibliography, CitationBlurbSentence, CitedWork, CitedWorkWebNote } from "./types.js";
import { hasCredentials, hostOf, isWebUrl } from "./urls.js";
import { REGISTRY_NEGATIVE_TTL_MS } from "./work-id.js";

/**
 * **The prompt and the schema it answers in.** Stored on each row; it does not
 * hide a note (as for the abstract notes, a new prompt keeps a checked note on
 * screen), but it says which prompt wrote it.
 */
export const CITATION_WEB_NOTE_PROMPT_VERSION = "citation-web-note/2";

/**
 * **The checks a web note must pass to be shown**: the identity rule (R1), the
 * article-copy refusal, the quote and length rules and the check call's
 * prompt. Bump it when any of them changes: every stored note and negative is
 * then detached and the next press asks again.
 *
 * `/2` tightened the DOI-in-a-page rule (GPT Sol's review #1 on stage 2);
 * `/3` dropped that rule altogether (its #2): a page is the work's own only
 * at the DOI resolver or arXiv's own page. A note or a *none* stored under
 * either earlier rule may rest on a page the rule now refuses, so neither is
 * shown or trusted.
 */
export const CITATION_WEB_NOTE_VALIDATION_VERSION = "citation-web-note-checks/3";

/** The page's own title, as stored and as shown. */
export const WEB_NOTE_TITLE_CAP = 300;
/** A page's address longer than this is not one we show. */
export const WEB_NOTE_URL_CAP = 2_000;
/**
 * **A completed *none* stands for a week** (R4) — the registry negatives'
 * lifetime, for their reason: a page that was not there may be there later,
 * and a press inside the week would only buy the same answer.
 */
export const WEB_NOTE_NEGATIVE_TTL_MS = REGISTRY_NEGATIVE_TTL_MS;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Stored for this row and checked under today's rules: the two things every use below needs first. */
function belongsTo(e: Record<string, unknown>, row: IdentityRow): boolean {
  return (
    e.validationVersion === CITATION_WEB_NOTE_VALIDATION_VERSION &&
    typeof e.identity === "string" &&
    e.identity === rowIdentity(row)
  );
}

/**
 * **The one read guard** (R8): a stored web note as the owner may be shown
 * it, or null. Shown only when every one of these holds:
 *
 * - `state` is `note`;
 * - its `identity` equals `rowIdentity` recomputed from the row **as the list
 *   stores it** — a list made again that changed the work takes it down;
 * - its `validationVersion` is today's;
 * - one or two sentences, each a non-empty text and quote within the abstract
 *   notes' caps, the whole within `BLURB_MAX_CHARS`;
 * - `url` an http(s) address with no user name or password in it, at most
 *   `WEB_NOTE_URL_CAP`; **`host` recomputed from it**, never the stored one;
 * - `readAt` a moment that parses, written back as ISO.
 *
 * Every field is rebuilt rather than passed through, because a row's JSONB
 * arrives unchecked. The title is capped, and dropped when empty. No model,
 * no versions and no search count leave here. The caller decides whether an
 * abstract note wins (it always does: `attachWebNotes` below).
 */
export function shownWebNote(stored: unknown, row: IdentityRow): CitedWorkWebNote | null {
  const e = record(stored);
  if (e === null || e.state !== "note" || !belongsTo(e, row)) return null;

  if (!Array.isArray(e.sentences) || e.sentences.length === 0 || e.sentences.length > BLURB_MAX_SENTENCES) return null;
  const sentences: CitationBlurbSentence[] = [];
  for (const raw of e.sentences as unknown[]) {
    const s = record(raw);
    const text = typeof s?.text === "string" ? s.text.trim() : "";
    const quote = typeof s?.quote === "string" ? s.quote.trim() : "";
    if (text === "" || quote === "" || text.length > BLURB_MAX_CHARS || quote.length > BLURB_QUOTE_MAX_CHARS) return null;
    sentences.push({ text, quote });
  }
  if (sentences.reduce((n, s) => n + s.text.length, 0) + (sentences.length - 1) > BLURB_MAX_CHARS) return null;

  const url = typeof e.url === "string" ? e.url : "";
  if (url === "" || url.length > WEB_NOTE_URL_CAP || !isWebUrl(url) || hasCredentials(url)) return null;
  const host = hostOf(url);
  if (host === "") return null;
  const readAt = typeof e.readAt === "string" ? Date.parse(e.readAt) : Number.NaN;
  if (!Number.isFinite(readAt)) return null;
  const title = typeof e.title === "string" ? e.title.trim().slice(0, WEB_NOTE_TITLE_CAP) : "";
  return { sentences, url, host, ...(title !== "" ? { title } : {}), readAt: new Date(readAt).toISOString() };
}

/**
 * **A completed *none* this row was given under a week ago, under today's
 * checks** — the press's free refusal (409 `searched`). An unreadable
 * `checkedAt` is old: asking again is the safe way to be wrong.
 */
export function searchedRecently(stored: unknown, row: IdentityRow, now: number): boolean {
  const e = record(stored);
  if (e === null || e.state !== "none" || !belongsTo(e, row)) return false;
  const checkedAt = typeof e.checkedAt === "string" ? Date.parse(e.checkedAt) : Number.NaN;
  return Number.isFinite(checkedAt) && now - checkedAt < WEB_NOTE_NEGATIVE_TTL_MS;
}

/**
 * **Put each web note onto its row, at the owner's read** — `loadBibliography`
 * (src/store/pg.ts), after `attachBlurbs`. `stored` is `citation_web_notes`
 * by entry id, unread; `asStored` is the list as the revision stores it, the
 * rows the identity is recomputed from (`attachBlurbs` has why). **A row with
 * an abstract note never shows a web note**: the abstract is the author's own
 * words, and a page is somebody's. A row that already carries a `webNote`
 * (nothing writes one into the list, but JSONB is unchecked) loses it unless
 * the table gives it one.
 */
export function attachWebNotes(
  shown: Bibliography,
  stored: ReadonlyMap<string, unknown>,
  asStored: readonly CitedWork[],
): Bibliography {
  const byId = new Map(asStored.map((row) => [row.id, row]));
  let changed = false;
  const works = shown.citations.map((work) => {
    const row = byId.get(work.id);
    const note = work.blurb !== undefined || row === undefined ? null : shownWebNote(stored.get(work.id), row);
    if (note === null) {
      if (!("webNote" in work)) return work;
      changed = true;
      const { webNote: _dropped, ...rest } = work;
      return rest;
    }
    changed = true;
    return { ...work, webNote: note };
  });
  return changed ? { ...shown, citations: works } : shown;
}

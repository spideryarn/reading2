/**
 * **The command bar proposing a short list from why you are reading** — the
 * shapes, the caps and the reading of the answers. Plan 261005k, Stage 2 (B).
 *
 * Pure: no React, no browser API, no gateway, and no import but
 * src/command-pick.ts and src/types.ts. The browser imports it for the request and for
 * re-reading the reply (src/web/command-suggest-client.ts), the server for
 * everything (src/command-suggest-call.ts) and the eval for its checks
 * (evals/command-suggest/run.ts), so what was measured and what is sent are
 * one copy. **The prompt is not here**: it carries the shared plain-words
 * section, which the browser has no business bundling, so it lives with the
 * call.
 *
 * **Three rules a caller can lean on:**
 *
 *  1. A suggested mode is a key the request sent, and nothing else. Whether
 *     that key is a mode at all is the server's check
 *     (src/command-suggest-call.ts § `suggestableOptions`) and then the bar's
 *     again; this module holds an answer to the keys it was given.
 *  2. The words of a search and of the lens are a model's, written from what
 *     the reader told us about themselves. They are capped here and shown as
 *     proposals; nothing in this file runs anything.
 *  3. An answer that kept nothing is `nothing`, never an empty list drawn
 *     under a heading.
 */
import { MAX_KEYS, MAX_KEY_TEXT, type PickKey, sameKey } from "./command-pick.js";
import { MAX_LENS_CHARS } from "./types.js";

/* ------------------------------------------------------------------ caps -- */

/** How many of each the list may hold. Three, two and one: a short list, read in a glance. */
export const MAX_SUGGESTED_SEARCHES = 3;
export const MAX_SUGGESTED_MODES = 2;
/**
 * **The longest search the bar will propose.** Quick search itself takes a
 * question of any ordinary length; this is a cap on a model's writing, not on
 * the reader's. A search is a few words about a topic, and a sentence-long one
 * is the model restating the reason for reading rather than searching for it.
 */
export const MAX_SUGGESTED_SEARCH_CHARS = 80;
/** The row's second line. One short sentence. */
export const MAX_SUGGESTED_WHY_CHARS = 140;
/** The lens goes into a chat origin, which refuses anything longer (src/types.ts § `MAX_LENS_CHARS`). */
export const MAX_SUGGESTED_LENS_CHARS = Math.min(200, MAX_LENS_CHARS);

/* ---------------------------------------------------------------- shapes -- */

/** What the browser posts: the keys of the rows it could show. The server loads the profile itself. */
export interface SuggestRequest {
  readonly rows: readonly PickKey[];
}

export interface SuggestedSearch {
  readonly words: string;
  readonly why: string;
}
export interface SuggestedMode {
  readonly key: PickKey;
  readonly why: string;
}
export interface SuggestedLens {
  readonly words: string;
  readonly why: string;
}

/** The list itself. At least one of the three is non-empty; `readSuggestions` returns `null` otherwise. */
export interface Suggestions {
  readonly searches: readonly SuggestedSearch[];
  readonly modes: readonly SuggestedMode[];
  readonly lens: SuggestedLens | null;
}

/**
 * **What `POST /api/command-suggest/:slug` answers with.**
 *
 * `readFrom` is a fingerprint of everything about the reader the model read
 * (`readFromHash`): the browser keeps the list under it, and drops the list
 * when what it reads back no longer matches.
 *
 * `nothing` says why, because the two reasons send the reader to different
 * places: `no-reason` means the article has no *why you're reading this*
 * (so the bar stops offering), and `no-list` means the model was asked and
 * nothing it wrote could be kept.
 */
export type SuggestAnswer =
  | ({ readonly kind: "suggestions"; readonly readFrom: string } & Suggestions)
  | { readonly kind: "nothing"; readonly why: "no-reason" | "no-rows" | "no-list" };

/* ------------------------------------------------------------- the body -- */

export type SuggestRequestParse =
  | { readonly ok: true; readonly request: SuggestRequest }
  /** Fixed prose, never a string the caller sent: it reaches a log. */
  | { readonly ok: false; readonly reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).every((k) => keys.includes(k));
const UNKNOWN_FIELD = "That request has a field this endpoint does not take";
const isKeyText = (v: unknown): v is string => typeof v === "string" && v !== "" && v.length <= MAX_KEY_TEXT;

/**
 * **The body, exactly**: `{ rows: [{ id, label }] }`. A field we do not know is
 * refused at every level, as `parsePickRequest` refuses it. There is no field
 * for a profile, a reason or a word about a row: the server's own are used.
 */
export function parseSuggestRequest(body: unknown): SuggestRequestParse {
  if (!isRecord(body)) return { ok: false, reason: "Expected a JSON object" };
  if (!onlyKeys(body, ["rows"])) return { ok: false, reason: UNKNOWN_FIELD };
  const { rows } = body;
  if (!Array.isArray(rows) || rows.length > MAX_KEYS) return { ok: false, reason: "rows must be a list of keys" };
  const keys: PickKey[] = [];
  for (const row of rows as unknown[]) {
    if (!isRecord(row)) return { ok: false, reason: "rows must be a list of keys" };
    if (!onlyKeys(row, ["id", "label"])) return { ok: false, reason: UNKNOWN_FIELD };
    const { id, label } = row;
    if (!isKeyText(id) || !isKeyText(label)) return { ok: false, reason: "a key is an id and a label" };
    keys.push({ id, label });
  }
  return { ok: true, request: { rows: keys } };
}

/* ------------------------------------------------- reading the answers -- */

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Some words, on one line, no longer than `max`. Anything else is `null`: dropped, never cut. */
function words(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const said = collapse(v);
  return said === "" || said.length > max ? null : said;
}

/**
 * **A `why`, or none.** Too long, empty or not a string is no reason given,
 * and the row is still worth drawing without its second line: the reason is a
 * courtesy, and dropping a good search over a long sentence would be a worse
 * answer.
 */
function whyOf(v: unknown): string {
  return words(v, MAX_SUGGESTED_WHY_CHARS) ?? "";
}

/** How a mode is named in the model's answer and in ours: by a key the request held. */
type KeyReader = (v: unknown) => PickKey | undefined;

/**
 * **The one reading of a list**, used on the model's answer by the server
 * (where a mode is named by id) and on the server's answer by the browser
 * (where it is named by key). Everything unknown, empty, over length or
 * repeated is dropped; the caps are applied after the drops, so a bad first
 * item does not cost a good fourth one its place.
 */
function readList(json: unknown, keyOf: KeyReader): Suggestions | null {
  if (!isRecord(json)) return null;
  const searches: SuggestedSearch[] = [];
  for (const item of Array.isArray(json.searches) ? (json.searches as unknown[]) : []) {
    if (searches.length >= MAX_SUGGESTED_SEARCHES) break;
    if (!isRecord(item)) continue;
    const said = words(item.words, MAX_SUGGESTED_SEARCH_CHARS);
    if (said === null || searches.some((s) => s.words.toLowerCase() === said.toLowerCase())) continue;
    searches.push({ words: said, why: whyOf(item.why) });
  }
  const modes: SuggestedMode[] = [];
  for (const item of Array.isArray(json.modes) ? (json.modes as unknown[]) : []) {
    if (modes.length >= MAX_SUGGESTED_MODES) break;
    if (!isRecord(item)) continue;
    const key = keyOf(item.key);
    if (key === undefined || modes.some((m) => sameKey(m.key, key))) continue;
    modes.push({ key, why: whyOf(item.why) });
  }
  let lens: SuggestedLens | null = null;
  if (isRecord(json.lens)) {
    const said = words(json.lens.words, MAX_SUGGESTED_LENS_CHARS);
    if (said !== null) lens = { words: said, why: whyOf(json.lens.why) };
  }
  if (searches.length === 0 && modes.length === 0 && lens === null) return null;
  return { searches, modes, lens };
}

/**
 * **The model's answer, held to what was offered** — the server's reading.
 * `content` is the message text: the JSON asked for, possibly with prose round
 * it. `offered` is the rows the model was shown, and a mode is named by the id
 * of one of them; an id that was not offered is dropped (F1 on the plan: an
 * Archive key under `modes` is not a mode because the model said so).
 */
export function readSuggestions(content: unknown, offered: readonly PickKey[]): Suggestions | null {
  if (typeof content !== "string") return null;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
  return readList(parsed, (id) => {
    if (typeof id !== "string") return undefined;
    const row = offered.find((r) => r.id === id);
    return row === undefined ? undefined : { id: row.id, label: row.label };
  });
}

/** What the browser's reading comes to: the answer, or `null` for a reply it cannot read at all. */
export function readSuggestAnswer(json: unknown, sent: SuggestRequest): SuggestAnswer | null {
  if (!isRecord(json)) return null;
  if (json.kind === "nothing") {
    const { why } = json;
    return why === "no-reason" || why === "no-rows" || why === "no-list" ? { kind: "nothing", why } : null;
  }
  if (json.kind !== "suggestions") return null;
  const { readFrom } = json;
  if (typeof readFrom !== "string" || readFrom === "") return null;
  /* **The same rules again, against the request this browser sent** — as
     `readPickAnswer` re-reads a pick. A key it did not send is dropped. */
  const list = readList(json, (v) =>
    isRecord(v) && typeof v.id === "string" && typeof v.label === "string"
      ? sent.rows.find((row) => sameKey(row, { id: v.id as string, label: v.label as string }))
      : undefined,
  );
  return list === null ? { kind: "nothing", why: "no-list" } : { kind: "suggestions", readFrom, ...list };
}

/* --------------------------------------------------- what the model read -- */

/**
 * **A fingerprint of what the model read about the reader**: *About you* and
 * the reason for reading, as stored. The server sends it with the list; the
 * bar computes it again from what `GET /api/reader?slug=` says and drops a
 * kept list whose fingerprint no longer matches (F3 on the plan: the model
 * read both boxes, so a change to either makes the list old).
 *
 * Both sides must hash the **stored** strings: the server normalises on the
 * way in and the route hands back what is stored, so neither trims here.
 *
 * Not a secret and not a security boundary: 53 bits of cyrb53, enough to tell
 * two profiles apart. A plain function rather than SHA-256 because the browser
 * has no synchronous one, and this must be the same arithmetic on both sides.
 */
export function readFromHash(parts: { readonly profile: string | null; readonly purpose: string | null }): string {
  const text = JSON.stringify([parts.profile ?? null, parts.purpose ?? null]);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/** Where the bar posts for an article. */
export const commandSuggestPath = (slug: string): string => `/api/command-suggest/${encodeURIComponent(slug)}`;

/* --------------------------------------------------------- reader's words -- */

/**
 * **The bar's row, the heading over the list and the lines under the box.**
 * Here rather than in CommandBar.tsx so the tests compare against the strings
 * a reader sees. No price: what a call costs is an administrator's business
 * (docs/project/cost-tracking.md).
 */
export const SUGGEST_LABEL = "Suggest what to do here";
export const SUGGEST_DESCRIPTION = "A short list from why you're reading: searches, a mode, a question for chat.";
export const SUGGEST_HEADING = "From why you're reading";
export const SUGGESTING = "Working out a short list from why you're reading…";
/** `no-list`: the model was asked and nothing could be kept. Not a failure of the service; asking again may differ. */
export const SUGGEST_NOTHING = "Nothing came back to suggest. Asking again sometimes does better.";
/** `no-reason`: read, and empty. The bar stops offering after this. */
export const SUGGEST_NO_REASON = "This article has no “why you're reading this” to work from. You can add one on its Metadata page.";
/** The lens row's label, round the model's words. */
export const lensLabel = (lens: string): string => `Ask chat what the web says about “${lens}”`;
export const LENS_DESCRIPTION = "Puts the question in Chat's box. Nothing is sent until you press Send.";

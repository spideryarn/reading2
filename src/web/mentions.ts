/**
 * **@-mentioning one of the reader's own articles in Chat** — the pure half:
 * which articles the picker offers, what the reader is typing after the `@`,
 * and what the box says once one is picked. The picker itself is
 * MentionPicker.tsx; the composer that owns it is `Composer` in ChatPanel.tsx.
 * Plan docs/plans/261012d-chat-at-mention-your-own-articles.md § 1.
 *
 * **The list is a convenience, not a guard.** The server checks every slug it
 * is sent against the reader, the open article, readability and size
 * (`admitMentions`, src/chat-mentions.ts) and refuses with a sentence the
 * reader sees. So leaving the open article and the unread papers out here is
 * only so nobody picks something that will be refused.
 *
 * **The chips, not the text, are what is sent** (Opus and Sol on the plan, F7):
 * editing one letter of an `@Title` in the box must not silently drop the
 * article. So nothing here reads the text back for mentions.
 */
import type { LibraryEntry } from "../types.js";
import { MENTIONS_MAX_PER_QUESTION } from "../chat-mention-limits.js";
import { hostOf, isWebUrl } from "../urls.js";
import { apiFetch, readJson } from "./lib/api.js";
import { snippet } from "./citations.js";

export { MENTIONS_MAX_PER_QUESTION };

/** How many rows the picker shows at once — few enough for a phone above its keyboard. */
export const MENTION_ROWS = 8;

/** The longest title the box and a chip carry before it is cut on a word. */
const SHORT_TITLE = 40;

/** One article the picker can offer. */
export interface MentionCandidate {
  slug: string;
  title: string;
  /** `LibraryEntry.titleOverridden`: whose words the title is (fonts.md). */
  titleOverridden?: boolean | undefined;
  /** The page's host, from its address. Absent for an upload. */
  site?: string | undefined;
  archived: boolean;
  /** For the order: the last open, else when it was added. */
  seen: string;
}

/** An article picked into the "Bringing in" row. */
export interface PickedMention {
  slug: string;
  title: string;
  titleOverridden?: boolean | undefined;
}

/**
 * **What the reader is asked about the articles in the "Bringing in" row** when
 * they send: the slugs, and a callback for once the server has accepted the
 * question. Rides on `SendHow` and `SendOptions` as one value so an adapter
 * between the two passes it whole rather than wiring a second callback.
 */
export interface MentionsToSend {
  slugs: readonly string[];
  /** The server began the turn, so these went with it. Data-only; may run after unmount. */
  onAccepted(): void;
}

/**
 * The shelf and the archive, as the picker offers them: not the open article,
 * not a paper read only for its abstract (`processing: "minimal"`), each slug
 * once, most recently opened first.
 */
export function mentionCandidates(
  shelf: readonly LibraryEntry[],
  archive: readonly LibraryEntry[],
  openSlug: string,
): MentionCandidate[] {
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  const take = (entry: LibraryEntry, archived: boolean) => {
    if (entry.slug === openSlug || entry.processing === "minimal" || seen.has(entry.slug)) return;
    seen.add(entry.slug);
    const site = entry.url && isWebUrl(entry.url) ? hostOf(entry.url) : "";
    out.push({
      slug: entry.slug,
      title: entry.title,
      titleOverridden: entry.titleOverridden,
      ...(site ? { site } : {}),
      archived: archived || entry.archivedAt !== undefined,
      seen: entry.lastOpenedAt ?? entry.addedAt,
    });
  };
  for (const entry of shelf) take(entry, false);
  for (const entry of archive) take(entry, true);
  /* ISO strings, so the text order is the time order. */
  return out.sort((a, b) => (a.seen < b.seen ? 1 : a.seen > b.seen ? -1 : 0));
}

/**
 * The rows for what has been typed after the `@`: titles containing it, any
 * case, not one already picked, at most `MENTION_ROWS`.
 */
export function mentionOptions(
  candidates: readonly MentionCandidate[],
  query: string,
  picked: readonly PickedMention[],
): MentionCandidate[] {
  const needle = query.trim().toLowerCase();
  const out: MentionCandidate[] = [];
  for (const c of candidates) {
    if (picked.some((p) => p.slug === c.slug)) continue;
    if (needle !== "" && !c.title.toLowerCase().includes(needle)) continue;
    out.push(c);
    if (out.length === MENTION_ROWS) break;
  }
  return out;
}

/** An `@` being typed: where it is, and what follows it up to the caret. */
export interface MentionTrigger {
  /** The index of the `@`. */
  at: number;
  query: string;
}

/** The longest run after an `@` that is still read as a search for a title. */
const QUERY_MAX = 60;

/**
 * **Is the caret inside an `@…` the reader is typing?** The `@` must start a
 * word — the start of the box, or after whitespace or an opening bracket or
 * quote — so an email address never opens the picker. What follows may hold
 * spaces (titles do) but not a line break, and is cut off at `QUERY_MAX`.
 */
export function mentionTrigger(value: string, caret: number): MentionTrigger | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const prev = at === 0 ? "" : (before[at - 1] ?? "");
  if (prev !== "" && !/[\s([{"“'‘]/.test(prev)) return null;
  const query = before.slice(at + 1);
  if (/[\r\n]/.test(query) || query.length > QUERY_MAX) return null;
  /* A space straight after the `@` is somebody writing "@ home", not a search. */
  if (/^\s/.test(query)) return null;
  return { at, query };
}

/** A title short enough for the box and a chip, cut on a word. */
export function shortTitle(title: string): string {
  return snippet(title, SHORT_TITLE);
}

/**
 * The box once an article is picked: the `@query` replaced by `@Short title `,
 * and where the caret goes.
 */
export function withMention(
  value: string,
  trigger: MentionTrigger,
  caret: number,
  title: string,
): { value: string; caret: number } {
  const insert = `@${shortTitle(title)} `;
  const after = value.slice(caret).replace(/^ /, "");
  return { value: value.slice(0, trigger.at) + insert + after, caret: trigger.at + insert.length };
}

/** Why a pick is refused, or null. One sentence, ours. */
export function pickRefusal(picked: readonly PickedMention[]): string | null {
  return picked.length >= MENTIONS_MAX_PER_QUESTION
    ? `You can bring in ${MENTIONS_MAX_PER_QUESTION} articles with one question.`
    : null;
}

interface LibraryResponse {
  articles: LibraryEntry[];
}

/**
 * `GET /api/library` and `GET /api/library?archived=1`, both owner-scoped, as
 * candidates. Asked once, when the picker first opens; a failure rejects with a
 * reader-safe message (`readJson`).
 */
export async function loadMentionCandidates(openSlug: string): Promise<MentionCandidate[]> {
  const [shelf, archive] = await Promise.all([
    apiFetch("/api/library").then((r) => readJson<LibraryResponse>(r)),
    apiFetch("/api/library?archived=1").then((r) => readJson<LibraryResponse>(r)),
  ]);
  return mentionCandidates(shelf.articles ?? [], archive.articles ?? [], openSlug);
}

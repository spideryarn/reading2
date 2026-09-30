/**
 * **The rules a Debate synthesis must keep, in one place for both sides of the
 * wire** — plan 260930j (SPIDERYARN-READING2-6M).
 *
 * Two readers apply them: `readSynthesisAnswer` (src/debate-themes.ts) to the
 * model's answer as it arrives, and `readStoredSynthesis` below to the stored
 * artefact on its way to the panel, because JSONB comes back unchecked and a
 * hand-edited or half-migrated document must not be drawn as if it were
 * honest. One function, `settleSynthesis`, so the two cannot drift. GPT Sol's
 * plan review, F4: the stored reader had re-checked row membership and nothing
 * else.
 *
 * Pure, and importable by the client (tests/client-imports.test.ts): it
 * imports `types.ts` and `ids.ts` and nothing else.
 *
 * ## What a "work" is here, and why it is not a URL
 *
 * A theme needs **two different works**, and the key sources are one per
 * work. The first measured pass grouped an arXiv preprint with its own project
 * page, and a paper with its ACL Anthology copy, as a "theme" (plan §
 * Measured; Sol's F3). So two rows are the same work when their addresses are
 * the same once the obvious aliases are removed (`www.`, a trailing slash, the
 * query, the fragment, arXiv's `abs`/`pdf` and version suffix), **or** their
 * titles are the same once case, punctuation and a trailing site name are
 * removed. It is deliberately conservative: it catches the copies we have seen,
 * and a pair it misses is two pages, which is still true.
 */
import { isSpideryarnId } from "./ids.js";
import {
  type DebateKeySource,
  type DebateSynthesis,
  type DebateTheme,
  isDebateKeyRole,
} from "./types.js";

/** At most this many themes kept, in the model's order. */
export const MAX_THEMES = 4;
/** At most this many key sources — and about one work in three, so picking stays picking. */
export const MAX_KEY_SOURCES = 3;
export const MAX_LABEL_CHARS = 80;
export const MAX_SENTENCE_CHARS = 320;

/** What the rules need of a row: which it is, and what work it is. */
export interface SynthesisRow {
  id: string;
  url: string;
  title?: string;
}

/** How many key sources this many distinct works may have. */
export function keyCap(works: number): number {
  return Math.min(MAX_KEY_SOURCES, Math.max(1, Math.floor(works / 3)));
}

/** An address with its obvious aliases removed. */
export function canonicalAddress(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const arxiv = host.endsWith("arxiv.org")
      ? /^\/(?:abs|pdf)\/([^/]+?)(?:v\d+)?(?:\.pdf)?\/?$/.exec(u.pathname)
      : null;
    if (arxiv?.[1]) return `arxiv:${arxiv[1]}`;
    return `${host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

/**
 * A title with case, punctuation and a trailing ` | Site` removed — or `null`
 * when too short to identify anything, or cut short by the search engine.
 */
export function titleKey(title: string | undefined): string | null {
  if (!title) return null;
  if (/(\.\.\.|…)\s*$/.test(title)) return null;
  const words = title
    .replace(/\s+\|[^|]*$/, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return words.length >= 12 ? words : null;
}

/**
 * **Which work each row is**, as a small integer — rows share one when their
 * addresses or their titles match, transitively.
 */
export function workIds(rows: readonly SynthesisRow[]): Map<string, number> {
  const work = new Map<string, number>();
  const byAddress = new Map<string, number>();
  const byTitle = new Map<string, number>();
  /* Union–find over at most two dozen rows. */
  const parent: number[] = [];
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    return root;
  };
  rows.forEach((row, i) => {
    parent[i] = i;
    for (const [key, index] of [
      [canonicalAddress(row.url), byAddress],
      [titleKey(row.title), byTitle],
    ] as const) {
      if (key === null) continue;
      const seen = index.get(key);
      if (seen === undefined) index.set(key, i);
      else parent[find(i)] = find(seen);
    }
  });
  rows.forEach((row, i) => {
    work.set(row.id, find(i));
  });
  return work;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed === "" || trimmed.length > max) return null;
  return trimmed;
}

/** A theme before the rules: whatever the model or the database handed over. */
export interface CandidateTheme {
  id: unknown;
  label: unknown;
  gist: unknown;
  rowIds: unknown;
}

/** A key source before the rules. */
export interface CandidateKey {
  rowId: unknown;
  role: unknown;
  why: unknown;
}

/**
 * **Every rule, applied to one candidate list** — each failure drops one item,
 * never the whole answer:
 *
 * - a theme needs a spideryarn id not already used, a label and a gist within
 *   their lengths, and row ids that are real rows (deduplicated) spanning
 *   **two different works**; at most `MAX_THEMES`;
 * - a key source needs a real row, a known role and a sentence, **one per
 *   work**, at most `keyCap` of the distinct works among the rows.
 */
export function settleSynthesis(
  themes: readonly CandidateTheme[],
  key: readonly CandidateKey[],
  rows: readonly SynthesisRow[],
): { themes: DebateTheme[]; key: DebateKeySource[] } {
  const works = workIds(rows);
  const keptThemes: DebateTheme[] = [];
  const themeIds = new Set<string>();
  for (const theme of themes) {
    if (keptThemes.length >= MAX_THEMES) break;
    if (typeof theme.id !== "string" || !isSpideryarnId(theme.id) || themeIds.has(theme.id)) continue;
    const label = text(theme.label, MAX_LABEL_CHARS);
    const gist = text(theme.gist, MAX_SENTENCE_CHARS);
    if (label === null || gist === null || !Array.isArray(theme.rowIds)) continue;
    const rowIds = [
      ...new Set(theme.rowIds.filter((id): id is string => typeof id === "string" && works.has(id))),
    ];
    if (new Set(rowIds.map((id) => works.get(id))).size < 2) continue;
    themeIds.add(theme.id);
    keptThemes.push({ id: theme.id, label, gist, rowIds });
  }

  const keptKey: DebateKeySource[] = [];
  const pickedWorks = new Set<number>();
  const limit = keyCap(new Set(works.values()).size);
  for (const source of key) {
    if (keptKey.length >= limit) break;
    const why = text(source.why, MAX_SENTENCE_CHARS);
    if (typeof source.rowId !== "string") continue;
    const work = works.get(source.rowId);
    if (work === undefined || pickedWorks.has(work)) continue;
    if (!isDebateKeyRole(source.role) || why === null) continue;
    pickedWorks.add(work);
    keptKey.push({ rowId: source.rowId, role: source.role, why });
  }
  return { themes: keptThemes, key: keptKey };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * **The stored synthesis, re-checked on the way out**, or `null` to draw
 * nothing.
 *
 * `null` for *searched before this existed* (no field) and for a shape this
 * build does not know. A `made` whose lists are not arrays is not a `made`:
 * it reads as `failed`, so the panel says the threads could not be made rather
 * than implying there were none (Sol's F2, F4). Everything else goes back
 * through `settleSynthesis` against this debate's own rows.
 */
export function readStoredSynthesis(debate: {
  synthesis?: unknown;
  direct: { rows: readonly SynthesisRow[] };
  claims: { rows: readonly SynthesisRow[] };
}): DebateSynthesis | null {
  const s = debate.synthesis;
  if (!isRecord(s)) return null;
  switch (s.kind) {
    case "failed":
      return { kind: "failed" };
    case "too-few":
      return typeof s.rows === "number" && Number.isInteger(s.rows) && s.rows >= 0
        ? { kind: "too-few", rows: s.rows }
        : null;
    case "made": {
      if (!Array.isArray(s.themes) || !Array.isArray(s.key)) return { kind: "failed" };
      const themes = s.themes.filter(isRecord).map(
        (t): CandidateTheme => ({ id: t.id, label: t.label, gist: t.gist, rowIds: t.rowIds }),
      );
      const key = s.key.filter(isRecord).map(
        (k): CandidateKey => ({ rowId: k.rowId, role: k.role, why: k.why }),
      );
      return { kind: "made", ...settleSynthesis(themes, key, [...debate.direct.rows, ...debate.claims.rows]) };
    }
    default:
      return null;
  }
}

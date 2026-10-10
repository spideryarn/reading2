/**
 * **The rules a Debate synthesis must keep, in one place for both sides of the
 * wire** — plan 260930j (SPIDERYARN-READING2-6M).
 *
 * Two readers apply them: `readSynthesisAnswer` (src/reception-themes.ts) to the
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
 * the same once the obvious aliases are removed (`www.`, a trailing slash,
 * tracking parameters, the fragment, arXiv's `abs`/`pdf` and version suffix),
 * **or** their distinctive titles are the same once case, punctuation and a
 * genuine trailing site name are removed. Semantic query parameters and ports
 * stay: either can name a different page, and a false match here silently
 * discards a theme or key source. It is deliberately conservative: a pair it
 * misses is still truthfully two pages.
 */
import { isSpideryarnId } from "./ids.js";
import {
  type ReceptionKeySource,
  type ReceptionSynthesis,
  type ReceptionTheme,
  isReceptionKeyRole,
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

const TRACKING_QUERY_KEYS = new Set(["dclid", "fbclid", "gclid", "mc_cid", "mc_eid", "msclkid"]);

/** An address with only aliases known not to identify its content removed. */
export function canonicalAddress(url: string): string | null {
  if (typeof url !== "string" || url.trim() === "") return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const arxiv = host === "arxiv.org" || host.endsWith(".arxiv.org")
      ? /^\/(?:abs|pdf)\/(.+?)\/?$/.exec(u.pathname)
      : null;
    if (arxiv?.[1]) {
      const id = arxiv[1].replace(/\.pdf$/i, "").replace(/v\d+$/i, "");
      if (id !== "") return `arxiv:${id}`;
    }
    const query = new URLSearchParams(u.search);
    for (const key of [...query.keys()]) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || TRACKING_QUERY_KEYS.has(lower)) query.delete(key);
    }
    query.sort();
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return `${host}${u.port ? `:${u.port}` : ""}${u.pathname.replace(/\/+$/, "")}${suffix}`;
  } catch {
    return null;
  }
}

function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function distinctiveTitle(title: string): string | null {
  const words = title.split(/\s+/u).filter(Boolean);
  /* Four words and thirty characters: "Active Retrieval Augmented Generation", a
     paper the first measured pass saw on arXiv and the ACL Anthology, is four.
     Short generic titles ("Introduction", "Methods") stay out. */
  return title.length >= 30 && words.length >= 4 ? title : null;
}

/** Is a final `| ...` clause presentation added by the site, rather than part of the work's title? */
function isSiteSuffix(suffix: string, url: string | undefined): boolean {
  const key = normaliseTitle(suffix).replace(/\s+/g, "");
  if (key === "projectpage") return true;
  if (!url) return false;
  try {
    const labels = new URL(url).hostname.toLowerCase().replace(/^www\./, "").split(".");
    /* `ACL Anthology` against `aclanthology.org`; a suffix need not repeat the TLD. */
    const hostName = labels.slice(0, Math.max(1, labels.length - 1)).join("").replace(/[^a-z0-9]/g, "");
    return key.length >= 4 && hostName === key;
  } catch {
    return false;
  }
}

/**
 * A distinctive title with case and punctuation removed — and a trailing
 * ` | Site` removed only when it names the row's actual site. Short generic
 * titles are not identities, and neither is one cut short by the search engine.
 */
export function titleKey(title: string | undefined, url?: string): string | null {
  if (typeof title !== "string" || title.trim() === "") return null;
  if (/(\.\.\.|…)\s*$/.test(title)) return null;
  const siteSuffix = /^(.*?)\s+\|\s*([^|]+)$/.exec(title);
  const withoutSuffix =
    siteSuffix?.[1] && siteSuffix[2] && isSiteSuffix(siteSuffix[2], url) ? siteSuffix[1] : title;
  return distinctiveTitle(normaliseTitle(withoutSuffix));
}

function addressHost(url: string): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * **Which work each row is**, as a small integer — rows share one when their
 * addresses or their titles match, transitively.
 */
export function workIds(rows: readonly SynthesisRow[]): Map<string, number> {
  const work = new Map<string, number>();
  const byAddress = new Map<string, number>();
  const byTitle = new Map<string, number[]>();
  /* Union–find over at most two dozen rows. */
  const parent: number[] = [];
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    return root;
  };
  rows.forEach((row, i) => {
    parent[i] = i;
    const address = canonicalAddress(row.url);
    if (address !== null) {
      const seen = byAddress.get(address);
      if (seen === undefined) byAddress.set(address, i);
      else parent[find(i)] = find(seen);
    }

    const title = titleKey(row.title, row.url);
    const host = addressHost(row.url);
    if (title !== null && host !== null) {
      const seen = byTitle.get(title) ?? [];
      /* Two paths on one host can be genuinely different pages with the same
         headline. Title matching exists for cross-site copies; the address
         rule above owns aliases within one site. */
      const copy = seen.find((other) => addressHost(rows[other]?.url ?? "") !== host);
      if (copy !== undefined) parent[find(i)] = find(copy);
      seen.push(i);
      byTitle.set(title, seen);
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
): { themes: ReceptionTheme[]; key: ReceptionKeySource[] } {
  const works = workIds(rows);
  const keptThemes: ReceptionTheme[] = [];
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

  const keptKey: ReceptionKeySource[] = [];
  const pickedWorks = new Set<number>();
  const limit = keyCap(new Set(works.values()).size);
  for (const source of key) {
    if (keptKey.length >= limit) break;
    const why = text(source.why, MAX_SENTENCE_CHARS);
    if (typeof source.rowId !== "string") continue;
    const work = works.get(source.rowId);
    if (work === undefined || pickedWorks.has(work)) continue;
    if (!isReceptionKeyRole(source.role) || why === null) continue;
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
export function readStoredSynthesis(reception: {
  synthesis?: unknown;
  direct: { rows: readonly SynthesisRow[] };
  claims: { rows: readonly SynthesisRow[] };
}): ReceptionSynthesis | null {
  const s = reception.synthesis;
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
      const offered = s.themes.length + s.key.length;
      const themes = s.themes.filter(isRecord).map(
        (t): CandidateTheme => ({ id: t.id, label: t.label, gist: t.gist, rowIds: t.rowIds }),
      );
      const key = s.key.filter(isRecord).map(
        (k): CandidateKey => ({ rowId: k.rowId, role: k.role, why: k.why }),
      );
      const settled = settleSynthesis(themes, key, [...reception.direct.rows, ...reception.claims.rows]);
      if (offered > 0 && settled.themes.length + settled.key.length === 0) return { kind: "failed" };
      return { kind: "made", ...settled };
    }
    default:
      return null;
  }
}

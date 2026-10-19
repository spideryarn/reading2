/**
 * **The two optional registry keys, and which optional sources they switch
 * on** — the one reader of `OPENALEX_API_KEY`, `SEMANTIC_SCHOLAR_API_KEY` and
 * `SEMANTIC_SCHOLAR_COMMERCIAL_USE`. Plan 261018o stage 1:
 * docs/plans/261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md,
 * as amended by its review (R3, R5, R10).
 *
 * **Read per call, never at import**, so a test can set and unset them and a
 * key added to the environment is seen without a restart.
 *
 * **A key never leaves this file except as a request header**
 * (`registryKeyHeaders`, which src/fetch.ts § `fetchBibliographicJson` alone
 * calls). Never in a URL — a `FetchFailure` carries its URL into logs and
 * Sentry — never in a log line, an error or a stored row. A caller names the
 * registry; it never holds the value.
 *
 * **Semantic Scholar needs its key and a second, deliberate switch** (R5): its
 * standard licence is non-commercial (api.semanticscholar.org/license, read
 * 2026-10-18) and Spideryarn charges, so a key alone does nothing until
 * `SEMANTIC_SCHOLAR_COMMERCIAL_USE=approved` says AI2 has agreed. OpenAlex is
 * CC0 and needs only its key.
 *
 * A leaf: it reads `process.env` and imports nothing.
 */

/** The registries a key may be attached for. */
export type RegistryKeyName = "openalex" | "semantic-scholar";

/** The one host each key may be sent to, exactly. */
export const REGISTRY_KEY_HOSTS: Readonly<Record<RegistryKeyName, string>> = {
  openalex: "api.openalex.org",
  "semantic-scholar": "api.semanticscholar.org",
};

/* Each read is a literal `process.env.NAME`, so the env inventory
   (tests/env-names-are-inventoried.test.ts) can see which name is read. */
function trimmed(value: string | undefined): string | null {
  const t = value?.trim();
  return t === undefined || t === "" ? null : t;
}

/** `OPENALEX_API_KEY`, trimmed, or null. */
export function openAlexKey(): string | null {
  return trimmed(process.env.OPENALEX_API_KEY);
}

/** `SEMANTIC_SCHOLAR_API_KEY`, trimmed, or null. */
export function semanticScholarKey(): string | null {
  return trimmed(process.env.SEMANTIC_SCHOLAR_API_KEY);
}

/** Whether Greg has recorded AI2's yes to Spideryarn's paid use (R5). Only the exact word counts. */
export function semanticScholarApproved(): boolean {
  return trimmed(process.env.SEMANTIC_SCHOLAR_COMMERCIAL_USE) === "approved";
}

/**
 * **The headers that carry a key, for one request** — empty unless `name`'s
 * key is set **and** `host` is exactly that registry's host, so naming the
 * wrong registry for a URL sends nothing. OpenAlex takes `Authorization:
 * Bearer`, which it treats as its `api_key` parameter
 * (help.openalex.org/api/authentication); Semantic Scholar takes `x-api-key`,
 * and only once its use is approved (`semanticScholarAllowed`).
 */
export function registryKeyHeaders(name: RegistryKeyName, host: string): Record<string, string> {
  if (host !== REGISTRY_KEY_HOSTS[name]) return {};
  if (name === "openalex") {
    const key = openAlexKey();
    return key === null ? {} : { Authorization: `Bearer ${key}` };
  }
  const key = semanticScholarKey();
  return key === null || !semanticScholarApproved() ? {} : { "x-api-key": key };
}

/**
 * **Whether any request may go to Semantic Scholar at all** — its key **and**
 * the exact approval word (R5). src/fetch.ts § `fetchBibliographicJson` asks
 * this at the one door every Semantic Scholar request goes through, before a
 * DNS lookup, so neither an anonymous request nor a keyed but unapproved one
 * can leave, whichever caller asks.
 */
export function semanticScholarAllowed(): boolean {
  return semanticScholarKey() !== null && semanticScholarApproved();
}

/**
 * **Which optional sources a citation-note run may ask** — what the keys
 * switch on, as booleans the cascade (src/citation-evidence.ts) is handed, so
 * the cascade itself never reads the environment.
 *
 * - `semanticScholar` — Semantic Scholar by DOI or arXiv id, for a work whose
 *   registry record has no abstract: its key **and** the approval switch.
 * - `openAlexKeyed` — OpenAlex's key is set: its title search may run when
 *   Crossref's found nothing, and a 403 from it is our fault, not a busy
 *   service.
 */
export interface OptionalSources {
  semanticScholar: boolean;
  openAlexKeyed: boolean;
}

/** The sources the environment switches on right now. */
export function optionalSources(): OptionalSources {
  return {
    semanticScholar: semanticScholarAllowed(),
    openAlexKeyed: openAlexKey() !== null,
  };
}

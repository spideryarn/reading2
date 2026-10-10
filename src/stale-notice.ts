/**
 * **The "older version of the article" notices a reader may send away** —
 * which modes have one, and what a dismissal may say. Shared by the server's
 * route and store (src/routes.ts, src/store/pg-stale-notices.ts) and the
 * client's hook (src/web/useStaleNotices.ts), so the list and the bounds cannot
 * drift. Imports nothing.
 *
 * Greg, 2026-10-09 (`spya-mutgym`): *"Look for all of those and in each case
 * make sure there is a way for me to dismiss them if I don't want to rerun
 * it."* docs/plans/261010a-dismiss-older-version-notices.md.
 *
 * A dismissal is about **one artefact**: its identity is the artefact's own
 * clock — the value each mode hook already gives `useRewriteHold`
 * (`generatedAt` for most, `searchedAt` for Reception, the route's
 * `generatedAt` for Skim, the Sketch's or the painting's own identity, the
 * claims run's `createdAt`), or for Search `<runId>@<finishedAt>` per saved
 * run. Making the artefact again re-stamps it, so the new one's notice is a
 * new identity and comes back if that one goes stale too.
 *
 * **Quiz is not here, on purpose**: a stale quiz refuses every mark, and its
 * banner is the only explanation of the disabled answer box (plan 261010a,
 * GPT Sol's finding 3).
 */

/** Every mode whose stale notice has an ×. The `mode` column's check is this list. */
export const STALE_NOTICE_MODES = [
  "glossary",
  "ideas",
  "faq",
  "timeline",
  "simple",
  "bibliography",
  "tweets",
  "reception",
  "sources-claims",
  "quotes",
  "skim",
  "search",
  "sketch",
  "illustrated",
  "claims",
] as const;

export type StaleNoticeMode = (typeof STALE_NOTICE_MODES)[number];

export function isStaleNoticeMode(x: unknown): x is StaleNoticeMode {
  return (STALE_NOTICE_MODES as readonly unknown[]).includes(x);
}

/**
 * **The words a mode's notice was stored under before it was renamed**, and
 * what each is now. Bibliography's was `citations`, Reception's `debate` and
 * Claims' `debate-claims` until 2026-10-09 (plan
 * docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md), renamed
 * by expand and contract: the `mode` column's check admits both until the
 * contract narrows it, rows the old code wrote keep the old word until then,
 * and they — and a request from a tab open across the deploy — are read
 * through here. Nothing writes an old word. `RETIRED_ORIGIN_MODES`
 * (src/types.ts) and `RETIRED_STEPS` (src/step-order.ts) are the siblings.
 */
export const RETIRED_STALE_NOTICE_MODES: Readonly<Record<string, StaleNoticeMode>> = {
  citations: "bibliography",
  /* Reception's and Claims' until the same plan's Stage 3. */
  debate: "reception",
  "debate-claims": "sources-claims",
};

/** A retired notice mode's successor, or the value as it came. */
export function currentStaleNoticeMode(mode: unknown): unknown {
  return typeof mode === "string" && Object.hasOwn(RETIRED_STALE_NOTICE_MODES, mode)
    ? RETIRED_STALE_NOTICE_MODES[mode]
    : mode;
}

/** At most this many identities per mode — Search's saved runs are the only mode with more than one. */
export const MAX_DISMISSED_IDENTITIES = 50;
/** And each at most this long. An ISO time is 24; Search's `<runId>@<finishedAt>` is under 40. */
export const MAX_IDENTITY_LENGTH = 120;

/**
 * **Whether `x` may be stored as an identity**: a non-empty string of at most
 * `MAX_IDENTITY_LENGTH` printable characters with no whitespace. Opaque past
 * that — the server does not check it names an artefact, because a key that
 * names nothing never matches anything and the row is the owner's own.
 * The `dismissed_for` column's check says the same.
 */
export function isStaleNoticeIdentity(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= MAX_IDENTITY_LENGTH && /^[\x21-\x7e]+$/.test(x);
}

/** `POST /api/stale-notices/:slug`: the mode's whole list, which replaces what was stored. */
export interface StaleNoticeDismissalRequest {
  mode: StaleNoticeMode;
  /** 1–`MAX_DISMISSED_IDENTITIES`, each `isStaleNoticeIdentity`. */
  identities: string[];
}

/** `GET /api/stale-notices/:slug`: what the owner has sent away, by mode. A mode with none is absent. */
export interface StaleNoticesResponse {
  dismissed: Partial<Record<StaleNoticeMode, string[]>>;
}

/**
 * Check a dismissal's body. Returns the request, or a sentence saying what is
 * wrong with it — the route's 400.
 */
export function parseStaleNoticeDismissal(body: unknown): StaleNoticeDismissalRequest | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "Expected { mode, identities }";
  }
  for (const key of Object.keys(body)) {
    if (key !== "mode" && key !== "identities") return "That request has a field this endpoint does not take";
  }
  const { mode: asked, identities } = body as { mode?: unknown; identities?: unknown };
  /* A tab open across plan 261009w's deploy still says `citations`, `debate`
     or `debate-claims`. */
  const mode = currentStaleNoticeMode(asked);
  if (!isStaleNoticeMode(mode)) return "That is not a mode whose notice can be dismissed";
  if (!Array.isArray(identities) || identities.length === 0 || identities.length > MAX_DISMISSED_IDENTITIES) {
    return `Expected between 1 and ${MAX_DISMISSED_IDENTITIES} identities`;
  }
  if (!identities.every(isStaleNoticeIdentity)) return "One of those identities is not one";
  return { mode, identities: [...new Set(identities as string[])] };
}

/**
 * **A saved search's identity for its notice**: the run and the answer it
 * holds. A run keeps its id when it is answered again (a revision, a retry),
 * so the id alone would carry a dismissal onto a new answer (GPT Sol's finding
 * 2); `finishedAt` moves on each. A run finished before 2026-10-03 has none,
 * and falls back to `createdAt`.
 */
export function searchNoticeIdentity(run: { id: string; createdAt: string; finishedAt?: string }): string {
  return `${run.id}@${run.finishedAt ?? run.createdAt}`;
}

/**
 * **An identity short enough to store, from one that may not be.** Sketch and
 * Illustrated hooks identify the picture by the whole stored value
 * (useSketch.ts § `SketchShown.drawn`) — kilobytes of JSON, including the
 * generation clock added by plan 261010a. Anything that is already a valid
 * identity passes through; anything else becomes `h` and two 53-bit string
 * hashes (cyrb53, two seeds), which is plenty to tell one picture of one
 * article from the next. `generatedAt` means even a byte-identical rerun changes
 * this hash.
 * Not a security
 * boundary: a collision would only hide one notice the reader did not dismiss.
 */
export function noticeIdentity(raw: string): string {
  if (isStaleNoticeIdentity(raw)) return raw;
  return `h${cyrb53(raw, 1).toString(36)}${cyrb53(raw, 2).toString(36)}`;
}

function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

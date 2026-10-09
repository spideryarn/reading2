/**
 * **The owner's Claims list, as a test hands it to `DebatePanel`** — a
 * `UseDebateClaims` with nobody having pressed Claims (`none`), unless a test
 * says otherwise. Shared by every test that paints the owner's Debate panel,
 * because the panel's owner arm requires the list's hook since plan 261008i
 * stage 2 (src/web/DebatePanel.tsx § `DebateAccess`).
 */
import type { DebateClaimList, ListedClaim } from "../../src/types.js";
import type { UseDebateClaims } from "../../src/web/useDebateClaims.js";
import type { UseDebateChecks } from "../../src/web/useDebateChecks.js";

export function claimListOwner(over: Partial<UseDebateClaims> = {}): UseDebateClaims {
  return {
    status: "none",
    claimList: null,
    stale: false,
    outdated: false,
    slug: "a-piece",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    retryRead: async () => {},
    ensure: async () => {},
    regenerate: async () => {},
    rewriting: false,
    refresh: async () => {},
    cancel: () => {},
    ...over,
  };
}

/** A stored list, the shape the step writes. */
export function claimListOf(claims: ListedClaim[]): DebateClaimList {
  return {
    version: "debate-claims/1",
    generator: "a-model",
    slug: "a-piece",
    sourceHash: "hash",
    claims,
    dropped: { unknownIds: 0, unquoted: 0, tooLong: 0, duplicate: 0, overCap: 0, malformed: 0 },
    generatedAt: "2026-10-08T10:00:00.000Z",
    elapsedMs: 1,
  };
}

/**
 * **The owner's claim checks, as a test hands them to `DebatePanel`** — none
 * yet and nothing out, unless a test says otherwise. Required on the owner's
 * arm since plan 261008i stage 3.
 */
export function checksOwner(over: Partial<UseDebateChecks> = {}): UseDebateChecks {
  return {
    status: "ready",
    checks: [],
    error: null,
    sending: false,
    pressError: null,
    check: async () => true,
    refresh: async () => {},
    ...over,
  };
}

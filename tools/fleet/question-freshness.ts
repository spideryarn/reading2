/**
 * The Questions composer and browser selector apply the same freshness policy
 * on opposite sides of the wire. These are runtime values, so they live in a
 * browser-safe leaf module rather than `wire.ts`, whose contract is types only.
 */
export const FLEET_STALE_CADENCES = 2.5;
export const CHECKPOINT_STALE_MS = 5 * 60_000;
export const SCAN_STALE_MS = 6 * 60_000;

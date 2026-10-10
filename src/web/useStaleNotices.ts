/**
 * **Which "older version of the article" notices the reader has sent away**,
 * and the × that sends one. docs/plans/261010a-dismiss-older-version-notices.md
 * (Greg, 2026-10-09, `spya-mutgym`): *"in each case make sure there is a way
 * for me to dismiss them if I don't want to rerun it."*
 *
 * A dismissal is about one artefact — its identity is the artefact's own
 * clock (src/stale-notice.ts) — so re-running brings the notice back for the
 * new one. Each panel calls `useStaleNotice` with its mode and, while its
 * artefact is stale, that artefact's identity; `StaleNotice.tsx` draws the
 * banner from what comes back, and the panel gates anything the banner used to
 * carry on `showing`, not on `stale` (the plan's finding 4).
 *
 * ## One cache for every panel, in this module
 *
 * Keyed by **(job-engine epoch, slug)**, the way rewrite-hold.ts fences its
 * holds: a sign-out or another account bumps `jobEngine.epoch()`, and an
 * entry made under an older epoch is never consulted again, so nothing of the
 * last reader's shows and nothing that lands for them reaches the next one. A
 * different slug is a different entry, so a completion for the article the
 * reader has left lands where nobody is looking.
 *
 * - **One GET between them.** The first panel with a stale artefact asks;
 *   the others share the request in flight. Nothing is asked while nothing is
 *   stale, so an article with no stale artefact costs no request at all. Until
 *   it answers, no banner is drawn: an already-dismissed notice must not flash
 *   for a round trip. A failed read settles the entry too, and then the real
 *   notice is shown.
 * - **The × hides at once**, and writes through a queue per mode, each write
 *   sending the mode's whole list (Search's: every run the banner counted, and
 *   the ones dismissed before), so two quick presses cannot undo each other
 *   (finding 6).
 * - **A read that began before a write never overwrites that mode**: the
 *   write's own outcome, or its read-back, is the last word there. That is
 *   useSkim's rule, made per mode.
 * - **A failed write reads again**, because it may have landed before its
 *   answer was lost, and says *"Could not hide this"* only if the read shows
 *   it did not land (261009i's rule, and `useGlossary`'s hide).
 *
 * ## A visitor
 *
 * Search's banner is the only one a visitor sees. They own nothing to store a
 * dismissal against, so theirs is held here, in memory, for the page view —
 * an entry of its own that never asks the server.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  MAX_DISMISSED_IDENTITIES,
  noticeIdentity,
  STALE_NOTICE_MODES,
  type StaleNoticeDismissalRequest,
  type StaleNoticeMode,
  type StaleNoticesResponse,
} from "../stale-notice.js";
import { jobEngine } from "./jobEngine.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

type Lists = Partial<Record<StaleNoticeMode, readonly string[]>>;

interface Entry {
  /** Session fence captured with this cache entry. */
  readonly epoch: number;
  /** Reader this entry's delayed requests belong to. */
  readonly reader: string | null;
  readonly slug: string;
  /** False for a visitor: held here only, never asked or written. */
  readonly persist: boolean;
  /** The server's word, as last read or written. */
  server: Lists;
  /** What a press made while its write is out; wins over `server`. */
  overlay: Lists;
  /** Why the last × on these identities did not stick, once a read said so. */
  failed: Partial<Record<StaleNoticeMode, { reason: string; identities: readonly string[] }>>;
  /** A GET has been asked for (answered or not). Only the first is automatic. */
  asked: boolean;
  /** The automatic GET has answered or failed. Visitors are known at once. */
  known: boolean;
  /** The automatic GET, while it is out, so every panel shares it. */
  inFlight: Promise<void> | null;
  /** The clock when each mode's latest press was made. */
  pressedAt: Partial<Record<StaleNoticeMode, number>>;
  /** The clock of the newest read or successful write applied to each mode. */
  resolvedAt: Partial<Record<StaleNoticeMode, number>>;
  /** Each mode's write queue. */
  queue: Partial<Record<StaleNoticeMode, Promise<void>>>;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
/** Bumped on every change, so `useSyncExternalStore` has a cheap snapshot. */
let version = 0;
/** Orders reads against presses. Global, so a remount cannot reset it. */
let clock = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  /* A teardown bumps the epoch and tells the engine's subscribers, not ours. */
  const quiet = jobEngine.subscribeQuietly(onChange);
  return () => {
    listeners.delete(onChange);
    quiet();
  };
}

const snapshot = () => `${jobEngine.epoch()}:${version}`;

function entryFor(slug: string, persist: boolean): Entry {
  const epoch = jobEngine.epoch();
  const key = `${epoch}\n${slug}\n${persist ? "owner" : "visitor"}`;
  let entry = entries.get(key);
  if (!entry) {
    /* Another epoch's entries are nobody's now. */
    for (const old of entries.keys()) if (!old.startsWith(`${epoch}\n`)) entries.delete(old);
    entry = {
      epoch,
      reader: jobEngine.reader(),
      slug,
      persist,
      server: {},
      overlay: {},
      failed: {},
      asked: false,
      known: !persist,
      inFlight: null,
      pressedAt: {},
      resolvedAt: {},
      queue: {},
    };
    entries.set(key, entry);
  }
  return entry;
}

function dismissedIn(entry: Entry, mode: StaleNoticeMode): readonly string[] {
  return entry.overlay[mode] ?? entry.server[mode] ?? [];
}

const url = (slug: string) => `/api/stale-notices/${encodeURIComponent(slug)}`;

/** One GET, applied to every mode no press has overtaken. False when it failed. */
async function read(
  entry: Entry,
  reconciling?: { mode: StaleNoticeMode; pressed: number },
): Promise<boolean> {
  if (entry.epoch !== jobEngine.epoch()) return false;
  const started = ++clock;
  try {
    const body = await readJson<StaleNoticesResponse>(await apiFetch(url(entry.slug), {}, entry.reader));
    if (entry.epoch !== jobEngine.epoch()) return false;
    for (const mode of STALE_NOTICE_MODES) {
      const overlay = entry.overlay[mode];
      const reconcilesThisOverlay =
        overlay !== undefined &&
        reconciling?.mode === mode &&
        entry.pressedAt[mode] === reconciling.pressed;
      if (overlay !== undefined && !reconcilesThisOverlay) continue;
      if ((entry.pressedAt[mode] ?? 0) > started || (entry.resolvedAt[mode] ?? 0) > started) continue;
      const got = body.dismissed?.[mode];
      if (Array.isArray(got)) entry.server[mode] = got;
      else delete entry.server[mode];
      entry.resolvedAt[mode] = started;
    }
    emit();
    return true;
  } catch {
    return false;
  }
}

function load(entry: Entry): void {
  if (!entry.persist || entry.asked) return;
  entry.asked = true;
  entry.inFlight = read(entry).then(() => {
    entry.inFlight = null;
    entry.known = true;
    emit();
  });
}

function dismissIn(entry: Entry, mode: StaleNoticeMode, identities: readonly string[], accumulate: boolean): void {
  if (identities.length === 0) return;
  const before = dismissedIn(entry, mode);
  const next = accumulate
    ? [...new Set([...before, ...identities])].slice(-MAX_DISMISSED_IDENTITIES)
    : [...new Set(identities)].slice(-MAX_DISMISSED_IDENTITIES);
  const pressed = ++clock;
  entry.overlay[mode] = next;
  entry.pressedAt[mode] = pressed;
  delete entry.failed[mode];
  if (!entry.persist) {
    entry.server[mode] = next;
    delete entry.overlay[mode];
    emit();
    return;
  }
  emit();
  const latest = () => entry.pressedAt[mode] === pressed;
  const write = async () => {
    if (entry.epoch !== jobEngine.epoch()) return;
    const body: StaleNoticeDismissalRequest = { mode, identities: next };
    try {
      const res = await apiFetch(url(entry.slug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, entry.reader);
      if (entry.epoch !== jobEngine.epoch()) return;
      /* A 204 has no body; anything else is a JSON sentence `readJson` throws. */
      if (!res.ok) await readJson(res);
      const stillLatest = latest();
      entry.server[mode] = next;
      entry.resolvedAt[mode] = ++clock;
      if (stillLatest) delete entry.overlay[mode];
      emit();
    } catch (err) {
      if (entry.epoch !== jobEngine.epoch()) return;
      const why = describeFetchFailure(err as Error);
      /* The write may have landed before its answer was lost: the server
         decides. A read begun now is after this press, so it is this mode's
         word — unless a later press has overtaken it, whose own outcome is. */
      const answered = await read(entry, { mode, pressed });
      if (!latest()) return;
      const stored = entry.server[mode] ?? [];
      const landed = answered && identities.every((id) => stored.includes(id));
      delete entry.overlay[mode];
      if (!landed) entry.failed[mode] = { reason: why, identities: next };
      emit();
    }
  };
  const queued = (entry.queue[mode] ?? Promise.resolve()).then(write);
  entry.queue[mode] = queued;
}

/** What one panel's banner needs. */
export interface StaleNoticeState {
  readonly mode: StaleNoticeMode;
  /**
   * The identities passed in whose notice has not been sent away — **the
   * banner shows while this is not empty**. Search counts it; every other
   * mode has one or none.
   */
  readonly showing: readonly string[];
  /** The ×: hide every identity in `showing`, now, and record it. */
  dismiss(): void;
  /** Why the last × did not stick, once a read showed it did not. */
  readonly failed: string | null;
}

/**
 * The notice for one mode on one article.
 *
 * `identities` is the artefact's identity while it is stale, and nothing
 * otherwise — `null`, an empty list, or a list for Search, one per stale run
 * the banner counts. Anything too long to store (Sketch's and Illustrated's
 * whole stored value) is shortened by `noticeIdentity`. `owner` is false for a
 * visitor, whose dismissal is held for the page view only.
 */
export function useStaleNotice({
  slug,
  mode,
  identities,
  owner = true,
}: {
  slug: string | null;
  mode: StaleNoticeMode;
  identities: string | readonly string[] | null | undefined;
  owner?: boolean;
}): StaleNoticeState {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const joined =
    identities == null ? "" : (typeof identities === "string" ? [identities] : identities).map(noticeIdentity).join("\n");
  const ids = useMemo(() => (joined === "" ? [] : joined.split("\n")), [joined]);
  const entry = slug ? entryFor(slug, owner) : null;
  const wanted = entry !== null && ids.length > 0;

  useEffect(() => {
    if (wanted && entry) load(entry);
  }, [wanted, entry]);

  const dismissed = entry ? dismissedIn(entry, mode) : [];
  const showing = entry?.known === false ? [] : ids.filter((id) => !dismissed.includes(id));
  const showingKey = showing.join("\n");
  const dismiss = useCallback(() => {
    if (!entry || showingKey === "") return;
    dismissIn(entry, mode, showingKey.split("\n"), mode === "search");
  }, [entry, mode, showingKey]);

  return {
    mode,
    showing,
    dismiss,
    failed:
      entry && showing.length > 0 && entry.failed[mode]?.identities.some((id) => showing.includes(id))
        ? entry.failed[mode].reason
        : null,
  };
}

/** Tests only: forget every entry, as a fresh page would. */
export function forgetStaleNotices(): void {
  entries.clear();
  emit();
}

/**
 * **The author gifts, and the writes** — the data layer of `/admin/vouchers`'
 * *Author gifts* (src/web/AdminAuthorGifts.tsx). Plan
 * docs/plans/261009u-author-gift-draft-voucher-from-the-add-page.md, § D10
 * and Revision 3.
 *
 * Shaped like useAdminVouchers.ts: one `GET /api/admin/author-gifts`, and
 * **every write followed by a fresh read**, so what is on screen is what the
 * server last said. A refusal comes back as the server's own sentence.
 *
 * **While a lookup is running, it reads again every few seconds** — the lookup
 * runs after the server's answer and takes tens of seconds — and stops when
 * none is, or after three minutes, whichever comes first. Nothing is pending at
 * rest, so at rest it reads nothing. A lookup unfinished for longer than the
 * server's own stale limit is *did not finish*, not pending, so a dead one
 * cannot keep the page polling.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type AdminAuthorGift,
  type AdminAuthorLookup,
  AUTHOR_LOOKUP_STALE_MINUTES,
  type AuthorGiftEnsured,
  type AuthorGiftSent,
} from "../admin-author-gifts.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { MalformedReply } from "./lib/reader-facing.js";

const PATH = "/api/admin/author-gifts";

/** How often to read while a lookup runs. */
export const AUTHOR_GIFTS_POLL_MS = 3_000;
/** How long to keep reading for one stretch of pending lookups. */
export const AUTHOR_GIFTS_POLL_LIMIT_MS = 3 * 60_000;
const STALE_MS = AUTHOR_LOOKUP_STALE_MINUTES * 60_000;

/** A lookup still running: no outcome yet, and younger than the server's stale limit. */
export function lookupPending(lookup: AdminAuthorLookup, now: number): boolean {
  if (lookup.outcome !== null) return false;
  const started = Date.parse(lookup.createdAt);
  return !Number.isFinite(started) || now - started < STALE_MS;
}

/** The draft fields and the notes; `PATCH /api/admin/author-gifts/:id` refuses anything else. */
export interface AuthorGiftPatchInput {
  readonly email?: string | null;
  readonly recipientName?: string | null;
  readonly recipientNote?: string | null;
  readonly articles?: number;
  readonly notes?: string | null;
  readonly discarded?: boolean;
}

/** What *Draft a gift* came to: a new gift (its lookup started), one that already existed, or a refusal. */
export type EnsureAnswer =
  | { readonly kind: "created"; readonly id: string }
  | { readonly kind: "existing"; readonly id: string }
  | { readonly kind: "refused"; readonly message: string };

/** What *Send* came to. */
export type SendAnswer =
  | { readonly kind: "sent"; readonly email: AuthorGiftSent["email"] }
  | { readonly kind: "refused"; readonly message: string };

export interface UseAdminAuthorGifts {
  /** `null` while the first request is in flight — not "no gifts". */
  gifts: AdminAuthorGift[] | null;
  error: string | null;
  loading: boolean;
  /** Re-reading on a timer because a lookup is running. */
  watching: boolean;
  reload: () => Promise<void>;
  /** All four never reject. */
  ensure: (slug: string) => Promise<EnsureAnswer>;
  lookUpAgain: (id: string) => Promise<string | null>;
  patch: (id: string, patch: AuthorGiftPatchInput) => Promise<string | null>;
  send: (id: string) => Promise<SendAnswer>;
}

type Written =
  | { readonly ok: true; readonly status: number; readonly body: unknown }
  | { readonly ok: false; readonly message: string };

export function useAdminAuthorGifts(): UseAdminAuthorGifts {
  const [gifts, setGifts] = useState<AdminAuthorGift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /* Bumped on every read that settles, success or not, so a failed read
     during a lookup still schedules the next one. */
  const [reads, setReads] = useState(0);
  const [watching, setWatching] = useState(false);
  /* An older read must not overwrite the one after a write (useAdminVouchers.ts). */
  const generation = useRef(0);
  const mounted = useRef(true);
  /* When this stretch of pending lookups was first seen; null when none is. */
  const pollingSince = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    return apiFetch(PATH)
      .then((r) => readJson<{ gifts?: unknown }>(r))
      .then((body) => {
        if (mine !== generation.current || !mounted.current) return;
        if (!Array.isArray(body.gifts)) throw new MalformedReply("the author gifts reply has no gifts");
        setGifts(body.gifts as AdminAuthorGift[]);
        setError(null);
      })
      .catch((e: Error) => {
        if (mine !== generation.current || !mounted.current) return;
        setError(describeFetchFailure(e));
      })
      .finally(() => {
        if (mine !== generation.current || !mounted.current) return;
        setLoading(false);
        setReads((n) => n + 1);
      });
  }, []);

  useEffect(() => void reload(), [reload]);

  /* The poll: one timer at a time, set after each read while anything is pending. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reads` is the trigger, not an input — a failed read leaves `gifts` unchanged, and the next timer must still be set.
  useEffect(() => {
    if (gifts === null) return;
    const now = Date.now();
    const pending = gifts.some((g) => g.lookups.some((l) => lookupPending(l, now)));
    if (!pending) {
      pollingSince.current = null;
      setWatching(false);
      return;
    }
    pollingSince.current ??= now;
    if (now - pollingSince.current >= AUTHOR_GIFTS_POLL_LIMIT_MS) {
      setWatching(false);
      return;
    }
    setWatching(true);
    const timer = setTimeout(() => void reload(), AUTHOR_GIFTS_POLL_MS);
    return () => clearTimeout(timer);
  }, [gifts, reads, reload]);

  const write = useCallback(
    (path: string, method: "POST" | "PATCH", body?: unknown): Promise<Written> =>
      apiFetch(path, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      })
        .then(async (r): Promise<Written> => ({ ok: true, status: r.status, body: await readJson<unknown>(r) }))
        .catch((e: Error): Written => ({ ok: false, message: describeFetchFailure(e) }))
        .then(async (written) => {
          if (mounted.current) await reload();
          return written;
        }),
    [reload],
  );

  /** A write that started a lookup gives it a fresh three minutes of watching. */
  const lookupStarted = useCallback(() => {
    pollingSince.current = null;
  }, []);

  const ensure = useCallback(
    async (slug: string): Promise<EnsureAnswer> => {
      lookupStarted();
      const written = await write(PATH, "POST", { slug, rightsConfirmed: true });
      if (!written.ok) return { kind: "refused", message: written.message };
      const answer = written.body as Partial<AuthorGiftEnsured>;
      if (typeof answer.id !== "string") return { kind: "refused", message: "The server's answer had no gift in it." };
      /* 202 with `created: true` is a new gift; 200 is one that already existed (R2-F2). */
      if (written.status === 202 && answer.created === true && typeof answer.lookupId === "string") {
        return { kind: "created", id: answer.id };
      }
      if (written.status === 200 && answer.created === false) return { kind: "existing", id: answer.id };
      return {
        kind: "refused",
        message: "The server's answer was incomplete. Refresh to check whether the author gift was made before trying again.",
      };
    },
    [write, lookupStarted],
  );

  const lookUpAgain = useCallback(
    async (id: string) => {
      lookupStarted();
      const written = await write(`${PATH}/${encodeURIComponent(id)}/lookups`, "POST");
      return written.ok ? null : written.message;
    },
    [write, lookupStarted],
  );

  const patch = useCallback(
    async (id: string, change: AuthorGiftPatchInput) => {
      const written = await write(`${PATH}/${encodeURIComponent(id)}`, "PATCH", change);
      return written.ok ? null : written.message;
    },
    [write],
  );

  const send = useCallback(
    async (id: string): Promise<SendAnswer> => {
      const written = await write(`${PATH}/${encodeURIComponent(id)}/send`, "POST");
      if (!written.ok) return { kind: "refused", message: written.message };
      const answer = written.body as Partial<AuthorGiftSent>;
      if (
        typeof answer.voucherId === "string" &&
        ((written.status === 201 && answer.email === "queued") ||
          (written.status === 200 && answer.email === "replayed"))
      ) {
        return { kind: "sent", email: answer.email };
      }
      return {
        kind: "refused",
        message: "The server's answer was incomplete. Refresh to check whether the gift was sent before trying again.",
      };
    },
    [write],
  );

  return { gifts, error, loading, watching, reload, ensure, lookUpAgain, patch, send };
}

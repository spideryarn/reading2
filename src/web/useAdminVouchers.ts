/**
 * The gift vouchers, and the two writes — the data layer of `/admin/vouchers`.
 *
 * One `GET /api/admin/vouchers`, `POST` to create, `PATCH /:id` to change one;
 * every write is followed by a fresh read, so what is on screen is always what
 * the server last said rather than an optimistic guess about it. Plan 261001m;
 * docs/project/admin.md § `/admin/vouchers`.
 *
 * Shaped like useAdminUsers.ts — one `reload`, an effect that calls it once, an
 * error that is surfaced rather than swallowed — and it adds the one thing
 * those pages never needed: a write that can be refused (a 409 on changing a
 * claimed voucher's address, a 400 on a typo), whose sentence is the server's
 * own `{ error }` through `readJson`.
 */
import { useCallback, useEffect, useState } from "react";

import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

/**
 * **One voucher as the admin route sends it.**
 *
 * A copy of `AdminVoucher` and `ClaimantUsage` in src/store/pg-vouchers.ts,
 * because that file is a server module and tests/client-imports.test.ts
 * refuses even a type import from one. The right home for both is a flat
 * module both sides may import (as `AdminUser` lives in src/admin.ts); that
 * move is a server edit and was left for the stage that owns the server.
 */
export interface AdminVoucherRow {
  readonly id: string;
  readonly email: string;
  readonly articles: number;
  readonly note: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly claimedBy: string | null;
  readonly claimedAt: string | null;
  readonly revokedAt: string | null;
  /** The claimant's current address, from the Auth service; null when it could not say. */
  readonly claimantEmail: string | null;
  /** Present only for a claimed voucher. */
  readonly claimant?:
    | {
        readonly kind: "free";
        readonly used: number;
        readonly limit: number;
        /** Further private articles — the server's `privateHeadroom`. */
        readonly remaining: number;
        readonly lapsed: boolean;
      }
    | { readonly kind: "paid"; readonly tierId: string }
    | { readonly kind: "unknown" };
}

export interface NewVoucherInput {
  readonly email: string;
  readonly articles: number;
  readonly note: string | null;
}

export interface VoucherPatchInput {
  readonly articles?: number;
  readonly note?: string | null;
  readonly email?: string;
  readonly revoked?: boolean;
}

export interface UseAdminVouchers {
  /** `null` while the first request is in flight — not "no vouchers". */
  vouchers: AdminVoucherRow[] | null;
  /** Why the last read failed, or null. */
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  /** Resolves to null on success, or the server's sentence on refusal. Never rejects. */
  create: (input: NewVoucherInput) => Promise<string | null>;
  /** As `create`. */
  update: (id: string, patch: VoucherPatchInput) => Promise<string | null>;
}

const PATH = "/api/admin/vouchers";

export function useAdminVouchers(): UseAdminVouchers {
  const [vouchers, setVouchers] = useState<AdminVoucherRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    return apiFetch(PATH)
      .then((r) => readJson<{ vouchers: AdminVoucherRow[] }>(r))
      .then((body) => {
        setVouchers(body.vouchers);
        setError(null);
      })
      .catch((e: Error) => {
        /* The old list stays, and the page says it may be stale. */
        setError(describeFetchFailure(e));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => void reload(), [reload]);

  /** One write, then a fresh read whatever happened — a refusal may mean the row moved. */
  const write = useCallback(
    (path: string, method: "POST" | "PATCH", body: unknown): Promise<string | null> =>
      apiFetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => readJson<unknown>(r))
        .then(
          () => null,
          (e: Error) => describeFetchFailure(e),
        )
        .then(async (refusal) => {
          await reload();
          return refusal;
        }),
    [reload],
  );

  const create = useCallback((input: NewVoucherInput) => write(PATH, "POST", input), [write]);
  const update = useCallback(
    (id: string, patch: VoucherPatchInput) =>
      write(`${PATH}/${encodeURIComponent(id)}`, "PATCH", patch),
    [write],
  );

  return { vouchers, error, loading, reload, create, update };
}

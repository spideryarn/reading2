/**
 * The gift vouchers, and the writes — the data layer of `/admin/vouchers`.
 *
 * One `GET /api/admin/vouchers`, `POST` to create, `PATCH /:id` to change one,
 * `POST /api/admin/voucher-emails/:id/retry` to send one of their emails again;
 * every write is followed by a fresh read, so what is on screen is always what
 * the server last said rather than an optimistic guess about it. Plan 261001m;
 * the emails are 261001p; docs/project/admin.md § `/admin/vouchers`.
 *
 * Shaped like useAdminUsers.ts — one `reload`, an effect that calls it once, an
 * error that is surfaced rather than swallowed — and it adds the one thing
 * those pages never needed: a write that can be refused (a 409 on changing a
 * claimed voucher's address, a 400 on a typo), whose sentence is the server's
 * own `{ error }` through `readJson`.
 *
 * **A write that queues an email reads twice**: straight away, and once more
 * four seconds later. The email goes after the server's response, so the first
 * read usually shows it *waiting to send*; the second usually shows how it
 * went. The Refresh button covers anything slower.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { AdminVoucher, VoucherCreated, VoucherUpdated } from "../admin-vouchers.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

/** One voucher as the admin route sends it — the shared wire shape. */
export type AdminVoucherRow = AdminVoucher;

export interface NewVoucherInput {
  readonly email: string;
  readonly articles: number;
  readonly note: string | null;
  /** The note to the recipient, put in their email. Plan 261002b. */
  readonly recipientNote: string | null;
  /** Their name: the email opens *Dear <name>,*. Plan 261007f. */
  readonly recipientName: string | null;
  /**
   * One of the administrator's own articles, by slug, for the email to link,
   * or null for none. Never its link: the server reads that. Plan 261007j.
   */
  readonly starterSlug: string | null;
}

export interface VoucherPatchInput {
  readonly articles?: number;
  readonly note?: string | null;
  readonly recipientNote?: string | null;
  readonly recipientName?: string | null;
  readonly email?: string;
  readonly revoked?: boolean;
}

/** What a create came to: made now (its email queued), already made, or refused in a sentence. */
export type CreateAnswer =
  | { readonly kind: "created"; readonly email: VoucherCreated["email"] }
  | { readonly kind: "refused"; readonly message: string };

/**
 * What a change came to: saved, or refused in a sentence. `starter` is the
 * server's word on a real change of address for a voucher with a starter
 * article — `dropped` when the new email had to go without it — and null
 * otherwise (plan 261007j, Sol's F3).
 */
export type UpdateAnswer =
  | { readonly kind: "saved"; readonly starter: NonNullable<VoucherUpdated["starter"]> | null }
  | { readonly kind: "refused"; readonly message: string };

export interface UseAdminVouchers {
  /** `null` while the first request is in flight — not "no vouchers". */
  vouchers: AdminVoucherRow[] | null;
  /** Why the last read failed, or null. */
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  /** Never rejects. */
  create: (input: NewVoucherInput) => Promise<CreateAnswer>;
  /** An unchanged pending attempt may be replayed even if its starter is no longer eligible. */
  canReplay: (input: NewVoucherInput) => boolean;
  /** Never rejects. */
  update: (id: string, patch: VoucherPatchInput) => Promise<UpdateAnswer>;
  /** Send one voucher email again, by its id. Resolves to null on success, or the server's sentence. Never rejects. */
  retry: (emailId: string) => Promise<string | null>;
}

const PATH = "/api/admin/vouchers";
const EMAILS_PATH = "/api/admin/voucher-emails";

/** Long enough for an after-response send to have usually finished. Plan 261001p. */
const SECOND_READ_MS = 4_000;

type Written = { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly message: string };

/** The `email` field of a write's answer, when it is a string — `queued`, `replayed`, `sending`. */
function emailField(body: unknown): unknown {
  return typeof body === "object" && body !== null ? (body as { email?: unknown }).email : undefined;
}

/** The `starter` field of a PATCH's answer, when it is one the page knows. */
function starterField(body: unknown): NonNullable<VoucherUpdated["starter"]> | null {
  const said = typeof body === "object" && body !== null ? (body as { starter?: unknown }).starter : undefined;
  return said === "kept" || said === "dropped" ? said : null;
}

/** The identity used both for sending again and for the form's replay exception. */
function createKey(input: NewVoucherInput): string {
  return JSON.stringify([
    input.email,
    input.articles,
    input.note,
    input.recipientNote,
    input.recipientName,
    input.starterSlug,
  ]);
}

export function useAdminVouchers(): UseAdminVouchers {
  const [vouchers, setVouchers] = useState<AdminVoucherRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /* An initial read can still be in flight when the create form writes. Its
     older answer must not overwrite the fresh read that follows the write. */
  const generation = useRef(0);
  /* **The id a create is sent under** — minted in the browser so a resubmit
     after a lost answer is the same create, which the server answers with the
     original rather than a second voucher (261001p, Sol F2). Kept with the
     exact input it was minted for: the same form sent again reuses it, a
     changed form or a success lets it go. **Every field of the input is in
     `key` below, by hand**: one left out would reuse the id for a different
     body, which the server refuses with a 409 (261007f, Sol's F5). */
  const pendingCreate = useRef<{ readonly key: string; readonly id: string } | null>(null);
  const laterReads = useRef(new Set<ReturnType<typeof setTimeout>>());
  const mounted = useRef(true);

  const reload = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    return apiFetch(PATH)
      .then((r) => readJson<{ vouchers: AdminVoucherRow[] }>(r))
      .then((body) => {
        if (mine !== generation.current) return;
        setVouchers(body.vouchers);
        setError(null);
      })
      .catch((e: Error) => {
        if (mine !== generation.current) return;
        /* The old list stays, and the page says it may be stale. */
        setError(describeFetchFailure(e));
      })
      .finally(() => {
        if (mine === generation.current) setLoading(false);
      });
  }, []);

  useEffect(() => void reload(), [reload]);

  /* The second reads die with the page. */
  useEffect(() => {
    mounted.current = true;
    const timers = laterReads.current;
    return () => {
      mounted.current = false;
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const readAgainLater = useCallback(() => {
    if (!mounted.current) return;
    const timer = setTimeout(() => {
      laterReads.current.delete(timer);
      if (mounted.current) void reload();
    }, SECOND_READ_MS);
    laterReads.current.add(timer);
  }, [reload]);

  /** One write, then a fresh read whatever happened — a refusal may mean the row moved. */
  const write = useCallback(
    (path: string, method: "POST" | "PATCH", body?: unknown): Promise<Written> =>
      apiFetch(path, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      })
        .then((r) => readJson<unknown>(r))
        .then(
          (answer): Written => ({ ok: true, body: answer }),
          (e: Error): Written => ({ ok: false, message: describeFetchFailure(e) }),
        )
        .then(async (written) => {
          if (mounted.current) await reload();
          return written;
        }),
    [reload],
  );

  const create = useCallback(
    async (input: NewVoucherInput): Promise<CreateAnswer> => {
      const key = createKey(input);
      const pending =
        pendingCreate.current?.key === key ? pendingCreate.current : { key, id: crypto.randomUUID() };
      pendingCreate.current = pending;
      const written = await write(PATH, "POST", { id: pending.id, ...input });
      if (!written.ok) return { kind: "refused", message: written.message };
      if (pendingCreate.current === pending) pendingCreate.current = null;
      const email = emailField(written.body) === "replayed" ? "replayed" : "queued";
      if (email === "queued") readAgainLater();
      return { kind: "created", email };
    },
    [write, readAgainLater],
  );

  const canReplay = useCallback((input: NewVoucherInput) => pendingCreate.current?.key === createKey(input), []);

  const update = useCallback(
    async (id: string, patch: VoucherPatchInput): Promise<UpdateAnswer> => {
      const written = await write(`${PATH}/${encodeURIComponent(id)}`, "PATCH", patch);
      if (!written.ok) return { kind: "refused", message: written.message };
      /* Only a real change of address queues an email (261001p). */
      if (emailField(written.body) === "queued") readAgainLater();
      return { kind: "saved", starter: starterField(written.body) };
    },
    [write, readAgainLater],
  );

  const retry = useCallback(
    async (emailId: string) => {
      const written = await write(`${EMAILS_PATH}/${encodeURIComponent(emailId)}/retry`, "POST");
      if (!written.ok) return written.message;
      readAgainLater();
      return null;
    },
    [write, readAgainLater],
  );

  return { vouchers, error, loading, reload, create, canReplay, update, retry };
}

/**
 * `/admin/vouchers` — gift vouchers: create one, see every one, change one.
 *
 * Greg, 2026-10-01: *"That /admin/vouchers page should show existing vouchers
 * that have been created, which have been claimed and how used, allow me to
 * edit/invalidate them, etc."* Plan 261001m; docs/project/admin.md §
 * `/admin/vouchers`; what a voucher does is docs/project/billing.md § Gift
 * vouchers.
 *
 * **The one admin page that writes**, and still not a gate: App.tsx decides
 * whether it is drawn (router.ts § `ADMIN_ONLY`) and the server's namespace
 * gate on `/api/admin/` decides whether anything happens. Every write is
 * followed by a fresh read (useAdminVouchers.ts), so the table shows what the
 * server holds rather than what this page hoped.
 *
 * A plain table rather than `DataTable`: there are few vouchers, one order
 * (newest first, the server's), and a row that turns into a form, which a
 * TanStack cell renderer would make harder to read rather than easier.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";

import { readableDate } from "../billing-plan.js";
import { Shell } from "./AdminPage.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { ADMIN_HREF } from "./router.js";
import {
  type AdminVoucherRow,
  type UseAdminVouchers,
  useAdminVouchers,
  type VoucherPatchInput,
} from "./useAdminVouchers.js";

const INPUT =
  "tw:h-8 tw:rounded-md tw:border tw:border-border tw:bg-card tw:px-2 tw:text-sm tw:text-foreground tw:outline-none tw:any-pointer-coarse:text-base tw:focus:border-highlight tw:focus:ring-2 tw:focus:ring-highlight/25";
const BUTTON =
  "tw:inline-flex tw:h-7 tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-border tw:bg-transparent tw:px-3 tw:text-xs tw:text-muted-foreground tw:hover:border-highlight/50 tw:hover:text-foreground tw:disabled:opacity-50";
const CELL = "tw:px-3 tw:py-2 tw:align-top tw:first:pl-4 tw:last:pr-4";
const HEAD = `${CELL} tw:whitespace-nowrap tw:text-left tw:text-xs tw:font-medium tw:text-muted-foreground`;

/** The default a new voucher offers: Greg's own example, *"e.g. 20 free articles"*. */
const DEFAULT_ARTICLES = 20;

function Refusal({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="tw:mb-4 tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-3 tw:text-sm tw:text-foreground"
    >
      {message}
    </p>
  );
}

/** A whole number from the box, or null when it is not one. The server checks 1–1000. */
function wholeNumber(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isInteger(n) ? n : null;
}

function CreateForm({ create }: { create: UseAdminVouchers["create"] }) {
  const [email, setEmail] = useState("");
  const [articles, setArticles] = useState(String(DEFAULT_ARTICLES));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const count = wholeNumber(articles);
    if (count === null) {
      setRefusal("Articles must be a whole number.");
      return;
    }
    setBusy(true);
    const answer = await create({ email, articles: count, note: note.trim() === "" ? null : note });
    setBusy(false);
    setRefusal(answer);
    if (answer === null) {
      setEmail("");
      setArticles(String(DEFAULT_ARTICLES));
      setNote("");
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="tw:mb-8 tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-4"
      aria-label="New gift voucher"
    >
      <h2 className="tw:m-0 tw:mb-3 tw:text-sm tw:font-medium tw:text-foreground">New voucher</h2>
      {refusal && <Refusal message={refusal} />}
      <div className="tw:flex tw:flex-wrap tw:items-end tw:gap-3">
        <label className="tw:flex tw:min-w-0 tw:flex-1 tw:basis-56 tw:flex-col tw:gap-1 tw:text-xs tw:text-muted-foreground">
          Email address
          <input
            id="voucher-new-email"
            type="email"
            required
            enterKeyHint="go"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${INPUT} tw:w-full`}
          />
        </label>
        <label className="tw:flex tw:w-24 tw:flex-col tw:gap-1 tw:text-xs tw:text-muted-foreground">
          Articles
          <input
            id="voucher-new-articles"
            type="number"
            required
            enterKeyHint="go"
            min={1}
            max={1000}
            step={1}
            value={articles}
            onChange={(e) => setArticles(e.target.value)}
            className={`${INPUT} tw:w-full`}
          />
        </label>
        <label className="tw:flex tw:min-w-0 tw:flex-1 tw:basis-56 tw:flex-col tw:gap-1 tw:text-xs tw:text-muted-foreground">
          Private note (optional — only you see it)
          <input
            id="voucher-new-note"
            type="text"
            enterKeyHint="go"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${INPUT} tw:w-full`}
          />
        </label>
        <button type="submit" disabled={busy} className={BUTTON}>
          {busy ? "Creating…" : "Create voucher"}
        </button>
      </div>
    </form>
  );
}

/** Waiting / Claimed by … on … / Revoked — the status column. */
function status(v: AdminVoucherRow): string {
  if (v.revokedAt !== null) {
    const when = readableDate(v.revokedAt);
    const claimed = v.claimedBy !== null ? ` (had been claimed by ${v.claimantEmail ?? "an account"})` : "";
    return `Revoked${when ? ` on ${when}` : ""}${claimed}`;
  }
  if (v.claimedBy === null) return "Waiting for sign-up";
  const when = v.claimedAt === null ? null : readableDate(v.claimedAt);
  return `Claimed by ${v.claimantEmail ?? "an account whose address could not be read"}${when ? ` on ${when}` : ""}`;
}

/**
 * *How used* — the claimant's current free usage, which is what the allowance
 * is. `remaining` is the server's further private articles, never
 * `limit − used`.
 */
function usage(v: AdminVoucherRow): string {
  const c = v.claimant;
  if (!c) return "—";
  switch (c.kind) {
    case "free":
      return (
        `${c.used} added; free allowance ${c.limit}; room for ${c.remaining} further private ` +
        `${c.remaining === 1 ? "article" : "articles"}${c.lapsed ? " (back on Free)" : ""}`
      );
    case "paid":
      return `On a paid plan (${c.tierId}) — the gift waits until they are on Free`;
    case "unknown":
      return "Plan unknown just now";
  }
}

function VoucherRow({ voucher, update }: { voucher: AdminVoucherRow; update: UseAdminVouchers["update"] }) {
  const [editing, setEditing] = useState(false);
  const [articles, setArticles] = useState(String(voucher.articles));
  const [note, setNote] = useState(voucher.note ?? "");
  const [email, setEmail] = useState(voucher.email);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const unclaimed = voucher.claimedBy === null;
  const revoked = voucher.revokedAt !== null;
  /* Also changes if a refresh says a waiting voucher was claimed while its
     editor was open, when the email field gives way to the article field. */
  const focusDestination = editing ? (unclaimed ? "email" : "articles") : "edit";

  /* The Edit button disappears when the fields arrive. Put focus on the first
     field rather than leaving a keyboard user on a detached element. */
  useEffect(() => {
    if (focusDestination !== "edit") firstField.current?.focus();
    else if (wasEditing.current) editButton.current?.focus();
    wasEditing.current = focusDestination !== "edit";
  }, [focusDestination]);

  async function send(patch: VoucherPatchInput): Promise<boolean> {
    setBusy(true);
    const answer = await update(voucher.id, patch);
    setBusy(false);
    setRefusal(answer);
    return answer === null;
  }

  function startEditing() {
    setArticles(String(voucher.articles));
    setNote(voucher.note ?? "");
    setEmail(voucher.email);
    setRefusal(null);
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const count = wholeNumber(articles);
    if (count === null) {
      setRefusal("Articles must be a whole number.");
      return;
    }
    /* Only what changed, so a save never sends an address for a claimed
       voucher (which the server would refuse with a 409). */
    const patch: { -readonly [K in keyof VoucherPatchInput]: VoucherPatchInput[K] } = {};
    if (count !== voucher.articles) patch.articles = count;
    const nextNote = note.trim() === "" ? null : note.trim();
    if (nextNote !== voucher.note) patch.note = nextNote;
    if (unclaimed && email.trim().toLowerCase() !== voucher.email) patch.email = email;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    if (await send(patch)) setEditing(false);
  }

  return (
    <tr className={`tw:border-b tw:border-border/60 tw:last:border-0 ${revoked ? "tw:text-muted-foreground" : ""}`}>
      <td className={`${CELL} tw:min-w-48 tw:break-all`}>
        {editing && unclaimed ? (
          <input
            ref={firstField}
            type="email"
            aria-label="Email address"
            enterKeyHint="done"
            form={`voucher-${voucher.id}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${INPUT} tw:w-56`}
          />
        ) : (
          voucher.email
        )}
      </td>
      <td className={`${CELL} tw:text-right tw:tabular-nums`}>
        {editing ? (
          <input
            ref={unclaimed ? undefined : firstField}
            type="number"
            aria-label="Articles"
            enterKeyHint="done"
            form={`voucher-${voucher.id}`}
            min={1}
            max={1000}
            step={1}
            value={articles}
            onChange={(e) => setArticles(e.target.value)}
            className={`${INPUT} tw:w-20`}
          />
        ) : (
          voucher.articles
        )}
      </td>
      <td className={`${CELL} tw:min-w-32`}>
        {editing ? (
          <input
            type="text"
            aria-label="Private note"
            enterKeyHint="done"
            form={`voucher-${voucher.id}`}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${INPUT} tw:w-48`}
          />
        ) : (
          <span className="tw:text-muted-foreground">{voucher.note ?? ""}</span>
        )}
      </td>
      <td className={`${CELL} tw:whitespace-nowrap`}>{readableDate(voucher.createdAt) ?? "—"}</td>
      <td className={`${CELL} tw:min-w-48`}>{status(voucher)}</td>
      <td className={`${CELL} tw:min-w-56`}>{usage(voucher)}</td>
      <td className={CELL}>
        {refusal && (
          <p role="alert" className="tw:m-0 tw:mb-2 tw:text-xs tw:text-destructive">
            {refusal}
          </p>
        )}
        {editing ? (
          <form
            id={`voucher-${voucher.id}`}
            onSubmit={(e) => void save(e)}
            className="tw:flex tw:flex-wrap tw:gap-2"
          >
            <button type="submit" disabled={busy} className={BUTTON}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className={BUTTON}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <button ref={editButton} type="button" disabled={busy} onClick={startEditing} className={BUTTON}>
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ revoked: !revoked })}
              className={BUTTON}
            >
              {revoked ? "Restore" : "Revoke"}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export function AdminVouchersPage() {
  useDocumentTitle(pageTitle({ kind: "admin", page: "vouchers" }));
  const { vouchers, error, loading, reload, create, update } = useAdminVouchers();

  return (
    <Shell title="Gift vouchers" back={{ href: ADMIN_HREF, label: "Back to Admin" }}>
      <p className="tw:mb-6 tw:text-sm tw:text-muted-foreground">
        A voucher adds articles to the free allowance of whoever signs in with that address, and
        counts only while they are on the Free plan.
      </p>

      <CreateForm create={create} />

      {error && <Refusal message={vouchers ? `Refresh failed, so this is the previous list. ${error}` : error} />}

      <div className="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
        <span className="tw:text-xs tw:text-muted-foreground">
          {vouchers === null ? "" : vouchers.length === 1 ? "1 voucher" : `${vouchers.length} vouchers`}
        </span>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          aria-label="Refresh the vouchers"
          title="Refresh the vouchers"
          className={BUTTON}
        >
          <RefreshCw size={12} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {vouchers === null ? null : vouchers.length === 0 ? (
        <p className="tw:text-sm tw:text-muted-foreground">No vouchers yet.</p>
      ) : (
        /* `relative` because the caption and the Actions header are `sr-only`,
           which is `position: absolute`: with no positioned ancestor they were
           laid out against the table's full width rather than clipped by this
           box, and the whole page scrolled sideways by 336px at 390. The same
           bug and fix as DataTable.tsx § the scroll box. The `min-w-*` on the
           wordy columns are what make the table scroll in here rather than
           squeezing an address to two characters a line. Plan 261001m. */
        <div className="tw:relative tw:overflow-x-auto tw:rounded-lg tw:border tw:border-border">
          <table className="tw:w-full tw:border-collapse tw:text-sm">
            <caption className="tw:sr-only">Every gift voucher, newest first</caption>
            <thead>
              <tr className="tw:border-b tw:border-border">
                <th className={HEAD}>Email</th>
                <th className={`${HEAD} tw:text-right`}>Articles</th>
                <th className={HEAD}>Note</th>
                <th className={HEAD}>Created</th>
                <th className={HEAD}>Status</th>
                <th className={HEAD}>Claimant's free usage</th>
                <th className={HEAD}>
                  <span className="tw:sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {vouchers.map((v) => (
                <VoucherRow key={v.id} voucher={v} update={update} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

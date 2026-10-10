/**
 * **The pieces `/admin/vouchers` draws twice** — once in the voucher create
 * form, once in *Author gifts* (src/web/AdminAuthorGifts.tsx, plan 261010c
 * D10) — so the two read as one page and cannot drift apart (controls.md §
 * Controls that do the same job look the same).
 *
 * - the field and button classes the page's controls share;
 * - `Refusal`, a server's sentence shown where the write was made;
 * - the administrator's own shelf, read once for both pickers
 *   (`useStarterShelf`), the articles a picker offers (`starterChoices`), and
 *   the picker's select with its Refresh (`StarterSelect`).
 *
 * The voucher form wraps `StarterSelect` in its own status line and import
 * field (AdminVouchersPage.tsx § `StarterPicker`); the author gift's form wraps
 * it in the private link's rights tick-box.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

import type { LibraryEntry } from "../types.js";
import { useJobs } from "./useJobs.js";
import { useShelf } from "./useShelf.js";

export const INPUT =
  "tw:h-8 tw:rounded-md tw:border tw:border-border tw:bg-card tw:px-2 tw:text-sm tw:text-foreground tw:outline-none tw:any-pointer-coarse:text-base tw:focus:border-highlight-text tw:focus:ring-2 tw:focus:ring-highlight-text/25";
export const BUTTON =
  "tw:inline-flex tw:h-7 tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-border tw:bg-transparent tw:px-3 tw:text-xs tw:text-muted-foreground tw:hover:border-highlight/50 tw:hover:text-foreground tw:disabled:opacity-50";
/** A sentence or two, or a page of notes, so it gets lines rather than a single box. */
export const TEXTAREA =
  "tw:min-h-16 tw:rounded-md tw:border tw:border-border tw:bg-card tw:px-2 tw:py-1.5 tw:text-sm tw:text-foreground tw:outline-none tw:any-pointer-coarse:text-base tw:focus:border-highlight-text tw:focus:ring-2 tw:focus:ring-highlight-text/25";

export function Refusal({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="tw:mb-4 tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-3 tw:text-sm tw:text-foreground"
    >
      {message}
    </p>
  );
}

/** The administrator's own shelf, as the pickers need it. */
export interface StarterShelf {
  /** Null until read, or after a read that cleared it. */
  readonly articles: readonly LibraryEntry[] | null;
  readonly error: string | null;
  /** Read again; a failure lands in `error`. */
  readonly reload: () => void;
}

/**
 * **One read of the shelf for the page**, again whenever an import this tab
 * can see finishes — the shelf page's own wiring, Library.tsx — and on Refresh.
 */
export function useStarterShelf(readerId: string): StarterShelf {
  const shelf = useShelf(readerId);
  const reloadShelf = shelf.reload;
  /* A failed read is already in `shelf.error`, which the pickers show. */
  const reload = useCallback(() => void reloadShelf().catch(() => {}), [reloadShelf]);
  useJobs("watches-queue", reload);
  return useMemo(() => ({ articles: shelf.articles, error: shelf.error, reload }), [shelf.articles, shelf.error, reload]);
}

/** What a picker offers: the shelf's articles that have been read, newest first. */
export function starterChoices(shelf: readonly LibraryEntry[] | null): LibraryEntry[] {
  return (shelf ?? [])
    .filter((a) => a.processing !== "minimal")
    .sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
}

/**
 * **Pick one of your articles**, with a Refresh beside it. `noneLabel` is the
 * empty choice's words: *None* where an article is optional, *Choose one…*
 * where it is not.
 */
export function StarterSelect({
  id,
  label,
  noneLabel,
  choices,
  slug,
  onChoose,
  reload,
  disabled = false,
}: {
  id: string;
  label: ReactNode;
  noneLabel: string;
  choices: readonly LibraryEntry[];
  slug: string;
  onChoose: (slug: string) => void;
  reload: () => void;
  /** Lock the choice while the form is sending it, so a later choice is not cleared as if it had been sent. */
  disabled?: boolean;
}) {
  return (
    <div className="tw:flex tw:flex-wrap tw:items-end tw:gap-2">
      <label className="tw:flex tw:min-w-0 tw:flex-1 tw:basis-56 tw:flex-col tw:gap-1">
        <span>{label}</span>
        <select
          id={id}
          value={slug}
          disabled={disabled}
          onChange={(e) => onChoose(e.target.value)}
          className={`${INPUT} tw:w-full tw:min-w-0`}
        >
          <option value="">{noneLabel}</option>
          {choices.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.title}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={disabled} onClick={reload} title="Read your articles again" className={BUTTON}>
        <RefreshCw size={12} />
        Refresh
      </button>
    </div>
  );
}

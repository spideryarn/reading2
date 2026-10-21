/**
 * The *Given* table's columns on `/admin/vouchers`: what it can be sorted by
 * and hidden by. **Not how its cells draw** — the row does that
 * (AdminVouchersPage.tsx § `VoucherRow`), because a row that turns into a
 * form keeps its state in the row, not in any one cell; it reaches the table
 * through `DataTable`'s `renderRow` (plan 261021i § Stage 2).
 *
 * So the row and these definitions have to agree on the ids, and
 * `VOUCHER_COLUMN_IDS` is where they do: the row's cell drawers are a
 * `Record<VoucherColumnId, …>` and so are the definitions below, so an id
 * added to the tuple and missed in either is a compile error. TanStack types
 * `column.id` as a plain `string`, which is why this is a tuple rather than a
 * `switch` with a `never` (Sol F3).
 *
 * The accessor rules are the other admin tables': **a missing value is
 * `undefined`**, so it sorts low and the page's `sinkLast` moves it to the
 * bottom whichever way the arrow points.
 */
import type { SortingFn } from "@tanstack/react-table";

import type { SortableColumn } from "./lib/DataTable.js";
import { at, localeText, numberOrMissing } from "./lib/table-sort.js";
import type { AdminVoucherRow } from "./useAdminVouchers.js";

/** Every column, in the order the table draws them. */
export const VOUCHER_COLUMN_IDS = [
  "email",
  "articles",
  "recipientNote",
  "note",
  "created",
  "status",
  "usage",
  "actions",
] as const;
export type VoucherColumnId = (typeof VOUCHER_COLUMN_IDS)[number];

export function isVoucherColumnId(id: string): id is VoucherColumnId {
  return (VOUCHER_COLUMN_IDS as readonly string[]).includes(id);
}

/** The chips: the default sort first (`ADMIN_VOUCHERS_DEFAULT_BY` in params.ts), then the rest. */
export const ADMIN_VOUCHERS_CHIP_ORDER: VoucherColumnId[] = ["created", "status", "email", "articles", "recipientNote", "note"];

/**
 * **Where a voucher stands, as a rank: revoked 0, waiting 1, claimed 2.** The
 * precedence `Status` draws by — a revoked voucher says *Revoked* whether or
 * not it was claimed, so it ranks as revoked. Its natural end is the high
 * one, claimed first and the revoked at the foot: a voucher that no longer
 * does anything is the least interesting row on the page.
 */
export function statusRank(v: Pick<AdminVoucherRow, "revokedAt" | "claimedBy">): number {
  if (v.revokedAt !== null) return 0;
  return v.claimedBy === null ? 1 : 2;
}

/**
 * Status, and **equal statuses newest first** — three values over every
 * voucher would otherwise leave each group in id order, which is no order at
 * all. Inside the `sortingFn`, so it reverses with the arrow
 * (admin-articles-columns.tsx § `byCostThenNewest` says why that is accepted).
 */
const byStatusThenNewest: SortingFn<AdminVoucherRow> = (rowA, rowB, columnId) => {
  const status = numberOrMissing<AdminVoucherRow>()(rowA, rowB, columnId);
  if (status !== 0) return status;
  const a = at(rowA.original.createdAt) ?? 0;
  const b = at(rowB.original.createdAt) ?? 0;
  return a < b ? -1 : a > b ? 1 : 0;
};

/** A note's text, or `undefined` for none, so an empty note sinks under either arrow. */
function noteOrMissing(note: string | null): string | undefined {
  return note === null || note.trim() === "" ? undefined : note;
}

const A_TO_Z: [string, string] = ["A to Z", "Z to A"];

/** One definition per id, each checked to carry its own id. */
const DEFINITIONS: { [K in VoucherColumnId]: SortableColumn<AdminVoucherRow> & { id: K } } = {
  email: {
    id: "email",
    header: "Email",
    accessorFn: (v) => v.email,
    sortDescFirst: false,
    sortingFn: localeText<AdminVoucherRow>(),
    /* Whose voucher a row is: never hidden, and held at the left (`pinFirst`). */
    enableHiding: false,
    meta: { label: "Email", hint: "Alphabetically by the address the voucher was sent to", ends: A_TO_Z },
  },
  articles: {
    id: "articles",
    header: "Articles",
    accessorFn: (v) => v.articles,
    sortDescFirst: true,
    sortingFn: numberOrMissing<AdminVoucherRow>(),
    meta: {
      label: "Articles",
      hint: "How many articles the voucher gives",
      ends: ["fewest first", "most first"],
      numeric: true,
    },
  },
  recipientNote: {
    id: "recipientNote",
    header: "Note to them",
    accessorFn: (v) => noteOrMissing(v.recipientNote),
    sortDescFirst: false,
    sortingFn: localeText<AdminVoucherRow>(),
    meta: {
      label: "Note to them",
      hint: "Alphabetically by the note in their email; vouchers with none shown last",
      ends: A_TO_Z,
    },
  },
  note: {
    id: "note",
    header: "Private note",
    accessorFn: (v) => noteOrMissing(v.note),
    sortDescFirst: false,
    sortingFn: localeText<AdminVoucherRow>(),
    meta: {
      label: "Private note",
      hint: "Alphabetically by your own note; vouchers with none shown last",
      ends: A_TO_Z,
    },
  },
  created: {
    id: "created",
    header: "Created",
    accessorFn: (v) => at(v.createdAt),
    sortDescFirst: true,
    sortingFn: numberOrMissing<AdminVoucherRow>(),
    meta: { label: "Created", hint: "When the voucher was made", ends: ["oldest first", "newest first"] },
  },
  status: {
    id: "status",
    header: "Status",
    accessorFn: statusRank,
    sortDescFirst: true,
    sortingFn: byStatusThenNewest,
    meta: {
      label: "Status",
      hint: "Claimed, then waiting for sign-up, then revoked; newest first within each",
      ends: ["revoked first", "claimed first"],
    },
  },
  usage: {
    id: "usage",
    header: "Claimant's free usage",
    /* Not sortable: a count, an allowance, a plan and a lapse, with no one
       honest number among them (Sol F5). */
    enableSorting: false as const,
    meta: {
      label: "Claimant's free usage",
      hint: "What the claimant has used of their free allowance",
      ends: ["", ""],
      noChip: true,
    },
  },
  actions: {
    id: "actions",
    header: () => <span className="tw:sr-only">Actions</span>,
    enableSorting: false as const,
    /* Never hideable: the edit form lives in this cell, and the inputs in the
       other cells reach it by `form=` — hide it and every input is orphaned. */
    enableHiding: false,
    meta: { label: "Actions", hint: "", ends: ["", ""], noChip: true },
  },
};

/** The definitions in table order. Module scope, so their identity never changes (lib/useUrlSortedTable.ts). */
export const VOUCHER_COLUMNS: SortableColumn<AdminVoucherRow>[] = VOUCHER_COLUMN_IDS.map((id) => DEFINITIONS[id]);

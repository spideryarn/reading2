/**
 * **The field and button classes the administrator's pages share, and
 * `Refusal`**, a server's sentence shown where the write was made — so every
 * admin form reads as one page (controls.md § Controls that do the same job
 * look the same).
 *
 * A leaf, importing nothing but React's JSX: it was split out of
 * admin-vouchers-parts.tsx (which re-exports it) on 2026-10-20 so that
 * `/admin/users`' *View as* (ViewAsStart.tsx; plan 261019n § Part 3) could use
 * the same controls without pulling that file's shelf and job hooks into the
 * `/admin` chunk (tests/eager-client-graph.test.ts).
 */

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

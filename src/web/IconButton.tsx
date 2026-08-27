/**
 * An icon-only button, in the one size every row of them agrees on.
 *
 * Lifted out of ShelfEntry.tsx on 2026-08-27, when the article's masthead and
 * its metadata page grew a pencil of their own (TitleEditor.tsx). It had to
 * move rather than be imported where it stood: `TitleEditor` uses it, and
 * `ShelfEntry` uses `TitleEditor`, so importing it from there would have made a
 * cycle — which `npm run check` gates on (docs/project/static-analysis.md).
 */
import type { ReactNode, Ref } from "react";

export function IconButton({
  label,
  onClick,
  children,
  disabled,
  destructive,
  ref,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  /**
   * For callers that have to put focus back on this button.
   *
   * A plain prop rather than `forwardRef`: React 19 passes `ref` through like
   * any other prop, and `forwardRef` is deprecated. TitleEditor.tsx is the one
   * caller — an editor that replaces its own trigger has to give focus back
   * when it closes, or the reader is dropped on `<body>`.
   */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      // Both, and they are not the same thing: `title` is the hover tooltip a
      // sighted reader gets, `aria-label` is the name a screen reader reads.
      // An icon-only button with neither is a button called "".
      title={label}
      aria-label={label}
      /* A fixed 28px square rather than `p-1.5` round a 14px glyph. Same
         reason as the shelf's view toggle (ShelfControls.tsx): a stated size
         is what lets controls in a row agree without anybody re-doing the
         arithmetic when an icon changes. `rounded-md` rather than `rounded`,
         because 4px was the only 4px radius on the page. */
      className={`tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:text-muted-foreground tw:transition-colors tw:disabled:opacity-50 ${
        destructive
          ? "tw:hover:bg-destructive/10 tw:hover:text-destructive"
          : "tw:hover:bg-highlight/10 tw:hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

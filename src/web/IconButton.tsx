/**
 * An icon-only button, in the one size every row of them agrees on.
 *
 * Lifted out of ShelfEntry.tsx on 2026-08-27, when the article's masthead and
 * its metadata page grew a pencil of their own (TitleEditor.tsx). It had to
 * move rather than be imported where it stood: `TitleEditor` uses it, and
 * `ShelfEntry` uses `TitleEditor`, so importing it from there would have made a
 * cycle — which `npm run check` gates on (docs/project/static-analysis.md).
 */
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

/**
 * Everything a `<button>` takes that this component does not name itself.
 *
 * **It exists so a `<Tooltip>` can wrap one of these.** `Tooltip` clones its
 * trigger and hands it the props Floating UI's interaction hooks return —
 * `onFocus`/`onBlur` from `useFocus`, `aria-describedby` from `useRole`, a key
 * handler from `useDismiss`. A component that names its props and drops the
 * rest swallows all of that, and the failure is close to invisible: `useHover`
 * binds a *native* `mouseenter` to the ref, so the card still opens under a
 * mouse and only the keyboard and the screen reader lose it.
 * docs/project/tooltips.md § Five things that are load-bearing, point 5, is the
 * same trap one step along.
 */
type PassThrough = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "onClick" | "disabled" | "title" | "aria-label" | "className" | "children"
>;

export function IconButton({
  label,
  onClick,
  children,
  disabled,
  titled = true,
  ref,
  ...rest
}: {
  label: string;
  /** Optional, because a permanently unavailable button has nothing to run. */
  onClick?: () => void;
  children: ReactNode;
  /**
   * **Unavailable — and still hoverable, focusable and named.**
   *
   * This sets `aria-disabled` and swallows the click; it does *not* set the
   * native `disabled` attribute, and that is the whole point. A natively
   * disabled `<button>` is out of the tab order and suppresses activation, and
   * browsers differ on whether it dispatches pointer events at all — so it is
   * **not a reliable tooltip trigger by any route**, and a card explaining why
   * a control is unavailable is precisely the card that must open. (Stated that
   * way on GPT Sol's correction, 2026-09-05: "dispatches no mouse events" is
   * true of some engines and not a rule.) Since 2026-09-05 the shelf draws its
   * source-URL-only buttons this way rather than deleting them
   * (ShelfEntry.tsx § `Actions`), so the explanation has to be reachable.
   *
   * The cost, and it is real: an unavailable control keeps its tab stop, so a
   * URL-less article is two dead stops on the way past. That is the trade — the
   * stop is what makes the explanation findable without a mouse.
   */
  disabled?: boolean;
  /**
   * Whether to set the native `title`. Pass `false` when a `<Tooltip>` already
   * describes this button: two tooltips on one control is the OS's slow grey
   * box racing ours, and `title` is the one that wins the wait.
   * docs/project/tooltips.md says at length why it is a regression rather than
   * a shortcut — but it stays the default, because a button with neither is a
   * button called "".
   */
  titled?: boolean;
  /**
   * For callers that have to put focus back on this button.
   *
   * A plain prop rather than `forwardRef`: React 19 passes `ref` through like
   * any other prop, and `forwardRef` is deprecated. TitleEditor.tsx is the one
   * caller — an editor that replaces its own trigger has to give focus back
   * when it closes, or the reader is dropped on `<body>`.
   */
  ref?: Ref<HTMLButtonElement>;
} & PassThrough) {
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      /* Guarded here rather than by the native attribute, per the prop's own
         note: an `aria-disabled` button is still clickable, so the refusal has
         to be in the handler.

         **And it has to stop the event, not merely decline it.** Dropping the
         handler leaves the click dispatching and bubbling, so the component was
         promising an activation-suppression it did not implement — harmless
         today, because no ancestor of either caller listens for clicks, and a
         trap for the first one that does. The shelf card is exactly where that
         would bite: its title's `::after` is stretched over the whole card
         (ShelfEntry.tsx), so an "inert" button that let a click through would
         open the article. GPT Sol, 2026-09-05. */
      onClick={
        disabled
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
            }
          : onClick
      }
      aria-disabled={disabled || undefined}
      // Both, and they are not the same thing: `title` is the hover tooltip a
      // sighted reader gets, `aria-label` is the name a screen reader reads.
      // An icon-only button with neither is a button called "".
      title={titled ? label : undefined}
      aria-label={label}
      /* A fixed 28px square rather than `p-1.5` round a 14px glyph. Same
         reason as the shelf's view toggle (ShelfControls.tsx): a stated size
         is what lets controls in a row agree without anybody re-doing the
         arithmetic when an icon changes. `rounded-md` rather than `rounded`,
         because 4px was the only 4px radius on the page. */
      /* **There is no `destructive` variant any more.** There was one, and its
         only caller was the shelf's "Delete" — which archives. When that button
         became "Archive" on 2026-09-04 the red went with the word, because red
         is this app's colour for *this cannot be undone* and every button that
         reaches this component is reversible. Dead options are how a convention
         stops meaning anything, so it was removed rather than left. */
      /* `aria-disabled:` rather than `disabled:`, matching the attribute above,
         and the hover lift is taken away with it — a control that lights up
         under the pointer is claiming it will do something. */
      className="tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:text-muted-foreground tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground tw:aria-disabled:cursor-default tw:aria-disabled:opacity-40 tw:aria-disabled:hover:bg-transparent tw:aria-disabled:hover:text-muted-foreground"
    >
      {children}
    </button>
  );
}

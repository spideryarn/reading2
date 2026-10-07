/**
 * **An article's tags on its shelf card or table row, and the way to edit
 * them** — the chips, then a small "Tag" button that opens the editor
 * (TagEditor.tsx) in a popover.
 *
 * Beside the chips rather than in the row of action buttons: the action row
 * has its own touch machinery (reveal-then-commit tips, a menu on narrow
 * screens — ShelfEntry.tsx § Actions), and a control that edits what you are
 * looking at reads better next to it. Plan
 * docs/plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md.
 *
 * `tw:relative` on the button lifts that control above the card's whole-card
 * title link (its `after:inset-0` overlay). The plain chips stay part of the
 * link's hit area rather than making dead patches on the card.
 */

import { useCallback } from "react";
import { Plus, Tag } from "lucide-react";
import { Popover } from "radix-ui";

import type { LibraryEntry } from "../types.js";
import { isImeComposing } from "./key-chord.js";
import { TagEditor } from "./TagEditor.js";
import type { Shelf } from "./useShelf.js";
import { voiceClass } from "./voice.js";

export function ShelfTags({
  entry,
  shelf,
}: {
  entry: LibraryEntry;
  shelf: Pick<Shelf, "editTags" | "tagging" | "setTagging">;
}) {
  /* On the shelf hook, not here: the table's cells remount on every tag edit
     (useShelf.ts § `tagging`). */
  const open = shelf.tagging === entry.slug;
  /* Radix's document capture listener cancels Escape to dismiss. Contain a
     composing Escape before it gets there, leaving the IME's default intact.
     A callback ref follows the portal's actual mount, which can happen after
     this component's effects. React 19 runs its returned cleanup on unmount. */
  const protectComposition = useCallback(
    (content: HTMLDivElement | null) => {
      if (!content || !open) return;
      const view = content.ownerDocument.defaultView;
      if (!view) return;
      const contain = (event: KeyboardEvent) => {
        if (
          event.key === "Escape" && isImeComposing(event) &&
          event.target instanceof Node && content.contains(event.target)
        ) {
          event.stopPropagation();
        }
      };
      view.addEventListener("keydown", contain, true);
      return () => view.removeEventListener("keydown", contain, true);
    },
    [open],
  );
  const setOpen = (next: boolean) => shelf.setTagging(next ? entry.slug : null);
  const tags = entry.tags ?? [];
  return (
    <span className="tw:inline-flex tw:flex-wrap tw:items-center tw:gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="tw:inline-flex tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-border tw:px-1.5 tw:py-0.5 tw:text-xs"
        >
          <Tag size={10} aria-hidden="true" className="tw:text-muted-foreground" />
          <span className={voiceClass("reader")}>{tag}</span>
        </span>
      ))}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={tags.length ? `Edit the tags on ${entry.title}` : `Tag ${entry.title}`}
            /* With no tags yet, shown the way the action row is: on hover or
               focus, and always where there is no hover (ShelfEntry.tsx §
               Actions). With tags, always — it is how you change them. */
            className={`tw:relative tw:inline-flex tw:h-6 tw:items-center tw:gap-0.5 tw:rounded-full tw:border tw:border-dashed tw:border-border tw:bg-transparent tw:px-1.5 tw:text-xs tw:text-muted-foreground tw:transition-[color,border-color,opacity] tw:hover:border-highlight/60 tw:hover:text-foreground tw:data-[state=open]:border-highlight/60 tw:data-[state=open]:opacity-100 ${tags.length ? "" : "tw:opacity-0 tw:group-hover:opacity-100 tw:group-focus-within:opacity-100 tw:focus-visible:opacity-100 tw:hover-none:opacity-100 tw:any-pointer-coarse:opacity-100"}`}
          >
            {tags.length ? <Tag size={11} aria-hidden="true" /> : <Plus size={11} aria-hidden="true" />}
            <span>{tags.length ? "Edit" : "Tag"}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            ref={protectComposition}
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={10}
            /* Escape with the suggestion list open closes the list only. Radix
               hears Escape on the document before the editor's own handler can
               stop it, so ask the focused box whether its list is open. */
            onEscapeKeyDown={(e) => {
              const box = document.activeElement;
              if (box?.getAttribute("role") === "combobox" && box.getAttribute("aria-expanded") === "true") {
                e.preventDefault();
              }
            }}
            /* The shelf menu's surface (ShelfEntry.tsx § ShelfActionsMenu), for
               its reasons: raised, opaque, frontmost. */
            className="tw:z-[100] tw:w-[min(22rem,calc(100vw-1.75rem))] tw:rounded-[5px] tw:border tw:border-rule-strong tw:bg-surface-raised tw:p-2 tw:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_8px_24px_-6px_rgb(0_0_0/0.65)]"
          >
            <p className="tw:mt-0 tw:mb-1.5 tw:text-xs tw:text-muted-foreground">
              Your own tags — only you see them. Filter by them above the shelf.
            </p>
            <TagEditor
              tags={tags}
              save={(change) => shelf.editTags(entry.slug, change)}
              autoFocus
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}

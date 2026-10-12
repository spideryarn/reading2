/**
 * **The list an `@` opens in Chat's box, and the "Bringing in" row above it**:
 * the reader's own articles, the shelf and the archive, most recently opened
 * first. Plan docs/plans/261012d-chat-at-mention-your-own-articles.md § 1.
 *
 * Three parts, all used by `Composer` in ChatPanel.tsx:
 *
 * - `useMentionPicker` — the state: where the caret is, whether an `@` is
 *   being typed, the list (fetched once, on the first `@`), the highlighted
 *   row and the picked articles.
 * - `MentionPicker` — only the list. The textarea is the combobox
 *   (`role="combobox"`, `aria-controls`, `aria-activedescendant`, the keys in
 *   its own `onKeyDown`), because focus never leaves the box: the shape
 *   TagEditor.tsx and CommandBar.tsx already use, copied rather than a library
 *   (the plan's § The library question; Ariakit is the named fallback).
 * - `MentionChips` — the row. **It, not the text, is what is sent**: editing
 *   one letter of an `@Title` must not silently drop an article (F7).
 *
 * The list is placed with Floating UI, above the box by preference since the
 * composer sits at the bottom of its band, in a portal so a band's `overflow`
 * cannot clip it. Rows are pressed on `pointerdown` with the default prevented,
 * so a mouse, pen or finger picks before the box can blur and keeps its caret.
 */
import { autoUpdate, flip, FloatingPortal, offset, shift, size, useFloating } from "@floating-ui/react";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { describeFetchFailure } from "./lib/describe-failure.js";
import {
  loadMentionCandidates,
  afterMentionEdit,
  type MentionCandidate,
  type MentionsToSend,
  mentionOptions,
  mentionText,
  mentionTrigger,
  type PickedMention,
  pickRefusal,
  restoredMentions,
  shortTitle,
  withMention,
  withoutMention,
} from "./mentions.js";
import { articleTitleVoice, voiceClass } from "./voice.js";

export interface MentionPickerState {
  /** The list is on screen. While it is, Enter and Tab pick and Escape closes it. */
  shown: boolean;
  listId: string;
  options: readonly MentionCandidate[];
  /** The highlighted row, or -1 when there is none to pick. */
  current: number;
  status: string | null;
  picked: readonly PickedMention[];
  /** Where the caret is, read off the box after a change, a selection, a focus. */
  track(el: HTMLTextAreaElement): void;
  /** The box lost focus: the list closes. */
  blur(): void;
  /**
   * A key in the box while the list is open — the caller has already asked
   * that it is not an input method's. Arrows move; Enter or Tab picks with
   * `onPick`; Enter with nothing to pick closes the line that says so, and
   * still does not send; Escape closes the list. True when the key was the
   * list's, and then its default is prevented and nothing else may act on it.
   */
  keyDown(e: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">, onPick: (index: number) => void): boolean;
  hover(index: number): void;
  /** Pick row `index`: the box's next text and caret, or null if nothing was picked. */
  pick(index: number, value: string, caret: number): { value: string; caret: number } | null;
  /** Move or retire remembered inserted-title ranges after a reader edit. */
  edit(before: string, after: string): void;
  /**
   * Take an article out of the row, and its `@Title ` out of the box if the
   * text is still as the pick wrote it: the box's next text and caret, or null
   * when the text stays as it is.
   */
  remove(slug: string, value: string, caret: number): { value: string; caret: number } | null;
  /** The row as a send carries it, or undefined when it is empty. */
  toSend(): MentionsToSend | undefined;
}

/**
 * The picker's state, for one composer. `enabled` is false for every kind but
 * typed Chat — the guide, Learn and the rest never open it, and send nothing.
 * `kept` is the row kept with the draft the box starts from, taken back only
 * where it still matches the words (`restoredMentions`).
 */
export function useMentionPicker(
  enabled: boolean,
  slug: string,
  value: string,
  kept: readonly PickedMention[] = [],
): MentionPickerState {
  const [picked, setPicked] = useState<PickedMention[]>(() => restoredMentions(kept, value));
  /* `null` while the box does not have focus, which is what closes the list on blur. */
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<MentionCandidate[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const asked = useRef(false);
  const listId = useId();

  const trigger = enabled && caret !== null ? mentionTrigger(value, caret) : null;
  const live = trigger !== null && trigger.at !== dismissedAt ? trigger : null;
  /* A dismissal lasts as long as its `@` does. */
  useEffect(() => {
    if (trigger === null && dismissedAt !== null) setDismissedAt(null);
  }, [trigger, dismissedAt]);
  /* Asked once, on the first `@`: most questions never mention anything. */
  useEffect(() => {
    if (live === null || asked.current) return;
    asked.current = true;
    loadMentionCandidates(slug).then(setCandidates, (e: unknown) =>
      setFailure(describeFetchFailure(e instanceof Error ? e : new Error(String(e)))),
    );
  }, [live, slug]);
  const query = live?.query ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `query` is the trigger — a new search starts at its first row
  useEffect(() => setActive(0), [query]);

  const refusal = pickRefusal(picked);
  const options = live && candidates && !refusal ? mentionOptions(candidates, live.query, picked) : [];
  const status = live === null ? null : pickerStatus(live.query, refusal, failure, candidates, options.length);
  const shown = live !== null && (options.length > 0 || status !== null);
  const current = options.length === 0 ? -1 : Math.min(active, options.length - 1);

  const pick = (index: number, text: string, at: number) => {
    const chosen = options[index];
    if (!chosen || !live || refusal) return null;
    const next = withMention(text, live, at, chosen.title);
    setPicked((p) => {
      const moved = p.map((m) => afterMentionEdit(m, text, next.value));
      return moved.some((m) => m.slug === chosen.slug)
        ? moved
        : [
            ...moved,
            {
              slug: chosen.slug,
              title: chosen.title,
              titleOverridden: chosen.titleOverridden,
              insertedAt: live.at,
            },
          ];
    });
    /* The `@` just written would read as a search for the title after it. */
    setDismissedAt(live.at);
    setCaret(next.caret);
    return next;
  };

  const remove = (slug_: string, text: string, at: number) => {
    const gone = picked.find((m) => m.slug === slug_);
    const next = gone && gone.insertedAt !== null
      ? withoutMention(text, mentionText(gone.title), at, gone.insertedAt)
      : null;
    setPicked((p) =>
      p
        .filter((m) => m.slug !== slug_)
        .map((m) => (next ? afterMentionEdit(m, text, next.value) : m)),
    );
    return next;
  };

  const edit = (before: string, after: string) => {
    setPicked((p) => p.map((m) => afterMentionEdit(m, before, after)));
  };

  const toSend = (): MentionsToSend | undefined => {
    if (!enabled || picked.length === 0) return undefined;
    const slugs = picked.map((m) => m.slug);
    /* Only those sent: one picked while the question was on its way stays. */
    const drop = () => setPicked((p) => p.filter((m) => !slugs.includes(m.slug)));
    return { slugs, onAccepted: drop, onUnconfirmed: drop };
  };

  return {
    shown,
    listId,
    options,
    current,
    status: shown ? status : null,
    picked,
    track: (el) => setCaret(el.selectionStart ?? el.value.length),
    blur: () => setCaret(null),
    keyDown(e, onPick) {
      if (!shown) return false;
      const own = (act: () => void) => {
        e.preventDefault();
        act();
        return true;
      };
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        return own(() => {
          if (options.length === 0) return;
          setActive((current + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        });
      }
      const picks = (e.key === "Enter" && !e.shiftKey) || e.key === "Tab";
      if (picks && current >= 0) return own(() => onPick(current));
      /* Nothing to pick: Enter closes the line that says so, and still does
         not send — the reader can see why. Tab moves on as it always does. */
      if ((picks && e.key === "Enter") || e.key === "Escape") {
        return own(() => {
          if (live) setDismissedAt(live.at);
        });
      }
      return false;
    },
    hover: setActive,
    pick,
    edit,
    remove,
    toSend,
  };
}

/**
 * The line the list shows in place of rows, or null: the limit, a failed
 * fetch, the fetch still out, or nothing matching. **A search with a space in
 * it and nothing matching is prose, not a search** — "@ home" never opens the
 * list, but "@Smith said" can — so it gets no line, the list lets it go, and
 * Enter sends as it always did.
 */
function pickerStatus(
  query: string,
  refusal: string | null,
  failure: string | null,
  candidates: readonly MentionCandidate[] | null,
  matches: number,
): string | null {
  if (refusal !== null) return refusal;
  if (failure !== null) return `Could not list your articles. ${failure}`;
  if (candidates === null) return "Finding your articles…";
  if (matches > 0 || /\s/.test(query)) return null;
  return "No article of yours has that in its title.";
}

export function MentionPicker({
  anchor,
  state,
  onPick,
}: {
  /** The box the list belongs to. */
  anchor: HTMLElement | null;
  state: MentionPickerState;
  onPick(index: number): void;
}) {
  const { refs, floatingStyles } = useFloating({
    open: true,
    placement: "top-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      /* As wide as the box — but no narrower than `.mention-picker`'s
         min-width, so a phone's narrow box still shows a title — and no taller
         than the room there is: on a phone, the strip between the keyboard
         and the top. */
      size({
        padding: 8,
        apply({ rects, availableHeight, elements }) {
          elements.floating.style.width = `${rects.reference.width}px`;
          elements.floating.style.maxHeight = `${Math.max(120, Math.min(availableHeight, 320))}px`;
        },
      }),
    ],
  });
  useEffect(() => {
    refs.setReference(anchor);
  }, [anchor, refs]);
  const { listId, options, current, status } = state;

  return (
    <FloatingPortal>
      <div ref={refs.setFloating} style={floatingStyles} className="mention-picker">
        {status !== null && (
          <p className="mention-picker-status" role="status">
            {status}
          </p>
        )}
        <div id={listId} role="listbox" aria-label="Your articles" className="mention-picker-list">
          {options.map((o, i) => (
            // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the box and aria-activedescendant names this option
            <div
              key={o.slug}
              id={`${listId}-o${i}`}
              role="option"
              aria-selected={i === current}
              className={`mention-picker-row${i === current ? " active" : ""}`}
              onPointerDown={(e) => {
                e.preventDefault();
                onPick(i);
              }}
              onMouseEnter={() => state.hover(i)}
            >
              <span className={`mention-picker-title ${voiceClass(articleTitleVoice(o.titleOverridden))}`}>
                {o.title}
              </span>
              {(o.site || o.archived) && (
                <span className="mention-picker-meta">
                  {[o.site, o.archived ? "archived" : null].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </FloatingPortal>
  );
}

/** The "Bringing in" row: what this question will bring into the conversation. */
export function MentionChips({
  picked,
  onRemove,
}: {
  picked: readonly PickedMention[];
  onRemove(slug: string): void;
}) {
  if (picked.length === 0) return null;
  return (
    <div className="mention-chips">
      <span className="mention-chips-label">Bringing in</span>
      {picked.map((m) => (
        <span key={m.slug} className="mention-chip">
          <span className={voiceClass(articleTitleVoice(m.titleOverridden))} title={m.title}>
            {shortTitle(m.title)}
          </span>
          <button
            type="button"
            className="mention-chip-x"
            aria-label={`Don't bring in ${m.title}`}
            onClick={() => onRemove(m.slug)}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  );
}

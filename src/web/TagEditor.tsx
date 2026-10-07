/**
 * **The reader's own tags on one article: see them, add them, remove them.**
 *
 * One component for both places that edit tags — the shelf's popover
 * (ShelfTags.tsx) and the top of the Metadata page — so the two cannot drift
 * apart in what they accept. A type-or-select combobox: typing filters the tags
 * the reader already uses (`GET /api/library/tags`, fetched the first time the
 * box is focused), and Enter or a comma adds the highlighted suggestion, or what
 * was typed. Backspace in an empty box removes the last tag.
 *
 * **No optimistic update**: the chips are whatever the server last said
 * (`tags`, from the caller), and `save` resolves to the new list. A failed write
 * therefore has nothing to roll back — the plan's § After GPT Sol's plan
 * review, 4. Plan
 * docs/plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md.
 *
 * The combobox follows the shape CommandBar.tsx already uses (an input with
 * `role="combobox"`, a `listbox` beside it, arrows and Enter on the input) —
 * no new dependency for one list.
 */

import { X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { normaliseTag, TAGS_PER_ARTICLE } from "../tags.js";
import type { TagChange } from "./article-tags.js";
import { loadReaderTags } from "./article-tags.js";
import { isImeComposing } from "./key-chord.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { voiceClass, withVoice } from "./voice.js";

/** How many suggestions the list shows at once. */
const SHOWN = 8;

type Option = { kind: "new"; tag: string } | { kind: "known"; tag: string; count: number };

/**
 * What the list offers for what has been typed — pure, so it is tested
 * without a browser (tests/tag-editor-options.test.ts).
 *
 * The typed text first, as "Add …", when it is a valid tag the reader has never
 * used; then the reader's tags containing it, most-used first; never one the
 * article already has.
 */
export function tagOptions(
  typed: string,
  have: readonly string[],
  vocabulary: readonly { tag: string; count: number }[],
): Option[] {
  const spelled = normaliseTag(typed);
  const needle = spelled.ok ? spelled.tag : typed.trim().toLowerCase();
  const known = vocabulary
    .filter((v) => !have.includes(v.tag) && v.tag.includes(needle))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1))
    .map((v): Option => ({ kind: "known", ...v }));
  const fresh =
    spelled.ok && !have.includes(spelled.tag) && !vocabulary.some((v) => v.tag === spelled.tag)
      ? [{ kind: "new", tag: spelled.tag } as const]
      : [];
  /* An exact match of something already used goes to the top of `known`, so
     Enter adds the tag the reader meant rather than a near neighbour. */
  const exact = known.findIndex((o) => o.tag === needle);
  if (exact > 0) known.unshift(...known.splice(exact, 1));
  return [...fresh, ...known].slice(0, SHOWN);
}

export function TagEditor({
  tags,
  save,
  autoFocus = false,
}: {
  /** The article's tags as the server last answered them. */
  tags: readonly string[];
  /** Write a change; resolves to the tags after, rejects on failure. */
  save: (change: TagChange) => Promise<string[]>;
  autoFocus?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  /* The highlighted row, or -1 for none. None until the reader types or uses
     the arrows, so Enter in a freshly focused empty box adds nothing they did
     not choose. */
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState<{ tag: string; count: number }[] | null>(null);
  const asked = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  /* The vocabulary once, on first focus: most visits to the Metadata page never
     touch the box, and a request for every card on the shelf would be thirty. */
  const fetchVocabulary = () => {
    if (asked.current) return;
    asked.current = true;
    loadReaderTags().then(setVocabulary, () => setVocabulary([]));
  };

  const options = useMemo(
    () => tagOptions(typed, tags, vocabulary ?? []),
    [typed, tags, vocabulary],
  );
  const shown = open && options.length > 0;
  const current = active < 0 ? -1 : Math.min(active, options.length - 1);

  async function run(change: TagChange) {
    setBusy(true);
    setProblem(null);
    try {
      const after = await save(change);
      /* Keep the suggestions honest without asking again: an added tag is now
         one the reader uses. Counts are approximate until the next fetch. */
      if (change.add) {
        setVocabulary((v) => {
          if (!v) return v;
          const next = [...v];
          for (const t of change.add ?? []) {
            const i = next.findIndex((x) => x.tag === t);
            if (i < 0) next.push({ tag: t, count: 1 });
            else next[i] = { tag: t, count: (next[i]?.count ?? 0) + 1 };
          }
          return next;
        });
      }
      return after;
    } catch (e) {
      setProblem(describeFetchFailure(e instanceof Error ? e : new Error(String(e))));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function add(raw: string) {
    const spelled = normaliseTag(raw);
    if (!spelled.ok) {
      setProblem(spelled.reason);
      return;
    }
    if (tags.includes(spelled.tag)) {
      setTyped("");
      return;
    }
    if (tags.length >= TAGS_PER_ARTICLE) {
      setProblem(`An article can carry at most ${TAGS_PER_ARTICLE} tags.`);
      return;
    }
    if ((await run({ add: [spelled.tag] })) !== null) {
      setTyped("");
      setActive(-1);
    }
  }

  function remove(tag: string) {
    void run({ remove: [tag] }).then(() => input.current?.focus());
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one keyboard protocol, kept together so its precedence is visible
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Preserve the open list's Escape ownership, including a composing key.
    if (!busy && e.key === "Escape" && shown) e.stopPropagation();
    /* Enter is how an IME accepts its current composition. Treating that same
       event as our submit would save a partial CJK tag. */
    if (isImeComposing(e)) return;
    if (busy) {
      if (e.key === "Enter" || e.key === ",") e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive(current < 0 ? (step > 0 ? 0 : options.length - 1) : (current + step + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = shown && current >= 0 ? options[current] : undefined;
      if (chosen) void add(chosen.tag);
      else if (typed.trim()) void add(typed);
    } else if (e.key === ",") {
      /* A comma cannot be in a tag, so it means "that one's done". */
      e.preventDefault();
      if (typed.trim()) void add(typed);
    } else if (e.key === "Backspace" && typed === "" && tags.length > 0) {
      e.preventDefault();
      const last = tags[tags.length - 1];
      if (last !== undefined) remove(last);
    } else if (e.key === "Escape" && shown) {
      /* Close the list, and stop there: a popover around this box closes on
         the next Escape, not on this one. */
      e.preventDefault();
      setOpen(false);
    }
  }

  const optionId = (i: number) => `${listId}-o${i}`;

  return (
    <div className="tw:relative tw:text-sm">
      <div
        className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5 tw:rounded-md tw:border tw:border-border tw:bg-background tw:px-2 tw:py-1.5 tw:focus-within:border-highlight-text"
        aria-busy={busy || undefined}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className="tw:inline-flex tw:items-center tw:gap-0.5 tw:rounded-full tw:border tw:border-border tw:bg-muted tw:py-0.5 tw:pl-2 tw:pr-0.5 tw:text-xs"
          >
            <span className={voiceClass("reader")}>{tag}</span>
            <button
              type="button"
              aria-label={`Remove the tag ${tag}`}
              disabled={busy}
              onClick={() => remove(tag)}
              className="tw:inline-flex tw:size-5 tw:items-center tw:justify-center tw:rounded-full tw:bg-transparent tw:p-0 tw:text-muted-foreground tw:hover:bg-highlight/10 tw:hover:text-foreground"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          type="text"
          role="combobox"
          /* A fixed name rather than one per article: the popover or the
             Metadata heading around the box already says whose tags these are,
             and tests/what-the-enter-key-promises.test.tsx names a box by a
             literal attribute. `done`: Enter adds the tag and stays. */
          aria-label="Add a tag"
          enterKeyHint="done"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={listId}
          aria-activedescendant={shown && current >= 0 ? optionId(current) : undefined}
          autoComplete="off"
          spellCheck={false}
          value={typed}
          placeholder={tags.length ? "Add a tag…" : "Add a tag — type, or pick one you use"}
          onFocus={() => {
            fetchVocabulary();
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setTyped(e.target.value);
            setActive(e.target.value.trim() ? 0 : -1);
            setOpen(true);
            setProblem(null);
          }}
          onKeyDown={onKeyDown}
          className={withVoice(
            "tw:min-w-[8rem] tw:flex-1 tw:border-0 tw:bg-transparent tw:p-0.5 tw:text-sm tw:text-foreground tw:outline-none",
            "reader",
          )}
        />
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label="Suggested tags"
        hidden={!shown}
        className="tw:absolute tw:left-0 tw:right-0 tw:z-[110] tw:mt-1 tw:max-h-64 tw:list-none tw:overflow-auto tw:rounded-[5px] tw:border tw:border-rule-strong tw:bg-surface-raised tw:p-1 tw:shadow-[var(--shadow-pop)]"
      >
        {options.map((o, i) => (
          // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the combobox and aria-activedescendant identifies this option
          <div
            key={`${o.kind}:${o.tag}`}
            id={optionId(i)}
            role="option"
            aria-selected={i === current}
            /* `mousedown`, not `click`: a click would blur the input first and
               the list would close under the pointer. */
            onMouseDown={(e) => {
              e.preventDefault();
              void add(o.tag);
            }}
            onMouseEnter={() => setActive(i)}
            className={`tw:flex tw:cursor-pointer tw:items-center tw:justify-between tw:gap-3 tw:rounded tw:px-2 tw:py-1 tw:text-sm ${i === current ? "tw:bg-highlight/10" : ""}`}
          >
            {o.kind === "new" ? (
              <span>
                Add “<span className={voiceClass("reader")}>{o.tag}</span>”
              </span>
            ) : (
              <>
                <span className={voiceClass("reader")}>{o.tag}</span>
                <span className="tw:text-xs tw:text-muted-foreground">{o.count}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {problem && (
        <p role="alert" className="tw:mt-1 tw:mb-0 tw:text-xs tw:text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}

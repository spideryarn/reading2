/**
 * **The public shelf's topic pills** — the row above the cards on
 * `/read/public`, and the narrowing it does.
 *
 * The same chip as a reader's own shelf (`TermChip`, ShelfTermChip.tsx), the
 * same counting and the same AND narrowing (shelf-narrow.ts), so a pill does
 * the same job the same way on both pages (controls.md § Controls that do the
 * same job look the same). What it leaves out is everything owner-scoped on
 * the reader's row: no fetch of its own — the topics come in the page's one
 * request, `GET /api/public/library` — no archive, no "More detail" view, and
 * no URL state.
 *
 * The labels were named by a model from the shared articles' titles and
 * one-line summaries, so they are drawn in the model's face, as text.
 * Plan docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md;
 * approved by Greg as "q-p5h2a7 A", 2026-10-09.
 */
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import type { PublicLibrary } from "../public-library-types.js";
import { articleTopics } from "./article-topics.js";
import { type ShelfTerm, availableTopics, topicCounts, topicMembers, withTopics, withinChosenFirst } from "./shelf-narrow.js";
import { QUIET_BUTTON, TERMS_ROW, TermChip, type TermTipScope } from "./ShelfTermChip.js";
import { TooltipGroup } from "./Tooltip.js";

/** As many pills as the reader's row shows before "All N topics" (ShelfTerms.tsx § `COLLAPSED_CHIPS`). */
const COLLAPSED = 12;


/** The wire's topics as the reader's shelf's terms: each with the slugs of its cards. */
export function publicTerms(shelf: PublicLibrary): ShelfTerm[] {
  const slugs = new Map<string, string[]>(shelf.topics.map((t) => [t.key, []]));
  for (const e of shelf.entries) for (const key of e.topics) slugs.get(key)?.push(e.slug);
  return shelf.topics.map((t) => ({
    key: t.key,
    label: t.label,
    granularity: t.granularity,
    ...(t.within ? { within: t.within } : {}),
    articles: (slugs.get(t.key) ?? []).map((slug) => ({ slug })),
  }));
}

/** The cards the chosen pills leave, in the server's order. Every chosen topic must hold: AND, as a reader's shelf. */
export function narrowPublic(shelf: PublicLibrary, terms: readonly ShelfTerm[], chosen: readonly string[]) {
  return withTopics(shelf.entries, topicMembers(terms, chosen));
}

export function PublicShelfTopics({
  shelf,
  terms,
  chosen,
  onToggle,
  onClear,
}: {
  shelf: PublicLibrary;
  terms: readonly ShelfTerm[];
  /** The chosen keys, in the order chosen. */
  chosen: readonly string[];
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  const [all, setAll] = useState(false);
  const hues = useMemo(() => articleTopics(terms).hues, [terms]);
  const inScope = useMemo(() => new Set(shelf.entries.map((e) => e.slug)), [shelf]);
  const counts = useMemo(() => topicCounts(inScope, chosen, terms), [inScope, chosen, terms]);
  if (terms.length === 0) return null;

  const count = (key: string) => counts.get(key) ?? 0;
  const on = new Set(chosen);
  const available = withinChosenFirst(availableTopics(terms, count, on), on);
  const shown = all ? available : available.filter((t, i) => i < COLLAPSED || on.has(t.key));
  const titles = new Map(shelf.entries.map((e) => [e.slug, e.title]));
  const labels = new Map(terms.map((t) => [t.key, t.label]));
  const scope: TermTipScope = {
    inScope,
    scopeWord: "on this shelf",
    titleOf: (slug) => titles.get(slug),
    labelOf: (key) => labels.get(key),
    whoseArticles: "the shared articles’",
  };

  return (
    <div data-public-topics="" className={`tw:mb-5 ${TERMS_ROW}`}>
      <span className="tw:text-xs tw:font-medium tw:text-muted-foreground">Topics</span>
      <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        {shown.map((t) => (
          <TermChip
            key={t.key}
            term={t}
            count={count(t.key)}
            on={on.has(t.key)}
            slot={hues.get(t.key) ?? 0}
            onToggle={onToggle}
            scope={scope}
          />
        ))}
      </TooltipGroup>
      {/* The reader's row's two buttons, in its order and its words (ShelfTerms.tsx). */}
      {chosen.length > 0 && (
        <button type="button" onClick={onClear} aria-label="Clear — stop narrowing by topic" className={QUIET_BUTTON}>
          Clear
        </button>
      )}
      {available.length > COLLAPSED && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className={QUIET_BUTTON}>
          All {available.length} topics
          <ChevronRight size={12} className={`tw:transition-transform ${all ? "tw:rotate-90" : ""}`} />
        </button>
      )}
    </div>
  );
}

/**
 * **What a shared link carries, what it leaves behind, and what it would carry
 * if somebody built it** — the owner's inventory, derived rather than written.
 *
 * The Access & Sharing confirmation used to say *"the whole extracted text"*
 * and one sentence about visitors, which is true and is the smallest true thing
 * we could have said. A shared link also carries the tree, the arc, the
 * glossary, the ideas, the quotes and the tweet thread — every one written by a
 * model, several of them possibly shaped by the owner's reader profile. Greg,
 * 2026-09-02:
 *
 * > Can we clarify that this will also share all the AI-generated stuff too …
 * > Better still, dynamically generate a list of what will be shared … And
 * > maybe even a list of what *won't* be shared.
 *
 * ## Why this walks `MODES` instead of listing anything
 *
 * [visitor.ts](visitor.ts) already answers *what stands between this visitor and
 * this mode*, for all fourteen, and `markedModes` already sweeps them. A second
 * list here would be a second answer to a question already decided — and the
 * copy in this repo has drifted exactly that way before, when the dock's
 * tooltip carried a sentence a few words off the band's (visitor.ts §
 * `markedModes`). So a mode added next month appears in the owner's inventory
 * whether or not whoever adds it remembers this file, and it appears on the
 * withheld side, because `visitorGap` fails closed.
 *
 * ## Three buckets, and no longer one per `VisitorGap` variant
 *
 * They lined up until 2026-09-08, when `readers-own` was retired and the union
 * dropped to two (visitor.ts). The buckets did not change and should not: they
 * are about what a *shared link carries*, which is a different question from why
 * a visitor cannot have a mode. The alignment was a coincidence worth noticing
 * and not a contract worth restoring.
 *
 * `shared` and `withheld` are the two Greg asked for. **`ifBuilt` is the third
 * and it is the honest one:** `kind: "not-built"` does not mean *this stays
 * private*, it means *there is nothing here yet*. Building a glossary
 * afterwards, on an article that is already shared, publishes it without asking
 * again — so folding these into `withheld` would be a promise broken by the
 * next button the owner presses.
 *
 * ## What is not derived, and why it is safe not to be
 *
 * The rows that are not modes are fixed prose: the article's own text, its
 * pictures and its provenance on one side; the owner's comments and notes,
 * glossary lookups, reader profile, private rename, uploaded file and the cost
 * of it all on the other; and the arc and the tweet thread, which cross like an
 * artefact but have no mode to be swept. `visitorGap` has nothing to say about
 * any of them, and each is settled in a different file — the projection in
 * [../public/dto.ts](../public/dto.ts), the reader's `select` in
 * [../store/public-reader.ts](../store/public-reader.ts), `SeeTheOriginal` in
 * [Masthead.tsx](Masthead.tsx). They are here as prose, and
 * `tests/shared-inventory.test.ts` is what holds them to the projection.
 */
import { MODE_LABEL } from "../title-text.js";
import { MODES } from "../modes.js";
import type { PublicArtefacts } from "../types.js";
import {
  ALWAYS_SHARED,
  NEVER_SHARED,
  OWNER_MODE_NOTE,
  SHARED_ARC,
  SHARED_TWEETS,
} from "../messages.js";
import { visitorGap } from "./visitor.js";

/** One line of the inventory: what it is called, and the sentence behind it. */
export interface InventoryItem {
  /**
   * A stable key for React, and for a test that wants to name a row. Mode rows
   * use the mode; the fixed rows use their own words.
   */
  key: string;
  /** What the owner is used to calling it — the Dock's word, for the modes. */
  label: string;
  /**
   * One sentence, shown on hover and to a screen reader. Never the visitor's
   * own sentence: `visitorSentence` says *"Chat is for whoever added this
   * article"*, and the person reading this dialog **is** whoever added it.
   */
  detail: string;
}

export interface SharedInventory {
  /** Goes out the moment the switch is on. */
  shared: InventoryItem[];
  /** Nobody has built one — and it would go out too, the day somebody does. */
  ifBuilt: InventoryItem[];
  /** Stays with the owner, whatever else happens. */
  withheld: InventoryItem[];
}

/**
 * The inventory for this article.
 *
 * `available` is the presence of the five artefacts, from
 * `ArticleSharing.available` — **not** from `stages[].done`, which means *ran,
 * and would not be re-run today*. The two disagree on a stale artefact, and the
 * stale one is still exactly what a visitor reads (src/types.ts §
 * `PublicArtefacts`).
 */
export function sharedInventory(available: PublicArtefacts): SharedInventory {
  const shared: InventoryItem[] = ALWAYS_SHARED.map((it) => ({ ...it }));
  const ifBuilt: InventoryItem[] = [];
  const withheld: InventoryItem[] = [];

  for (const mode of MODES) {
    /* `plain` is the article itself with no band at all, and `ALWAYS_SHARED`
       above already says so in the reader's own words. Listing it as a mode
       would be the same fact twice, under two names. */
    if (mode === "plain") continue;
    const gap = visitorGap(mode, available);
    const item: InventoryItem = {
      key: mode,
      label: MODE_LABEL[mode],
      /* **The same sentence in all three columns.** A row says what the thing
         *is*; the heading says which column it is in. Replacing this with a
         "nobody has built one" line — which one draft did — cost the not-built
         Glossary chip the only text saying what a glossary is, and with it the
         clarification that the owner's lookups are not part of it.
         src/messages.ts § the sharing inventory. */
      detail: OWNER_MODE_NOTE[mode],
    };
    if (gap === null) shared.push(item);
    else if (gap.kind === "not-built") ifBuilt.push(item);
    else withheld.push(item);
  }

  /* **The two artefacts the sweep cannot see**, because neither is a mode: the
     thread is a page beside the article, and the arc is the extra rung Outline
     draws when there is one. Both are in `PublicArtefacts`, both cross when they
     exist, and both were `available` flags with nothing reading them until GPT
     Sol found the arc on 2026-09-02. Asked by hand, and asked the same way, so
     the pair cannot drift apart. */
  for (const [has, row] of [
    ["arc", SHARED_ARC],
    ["tweets", SHARED_TWEETS],
  ] as const) {
    (available[has] ? shared : ifBuilt).push({ ...row });
  }

  withheld.push(...NEVER_SHARED.map((it) => ({ ...it })));
  return { shared, ifBuilt, withheld };
}

/**
 * **Ideas mode's controller.** The band an owner gets, the band a visitor gets,
 * and the hook underneath both: `?idea=`, the colour slots, and the resolved
 * passages the panel and the prose have to agree on.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-05, so that a reader-owned error
 * boundary can enclose the controller's own computation as well as its panel: a
 * boundary cannot catch a throw from inside the component it lives in, so the
 * controller had to become something `Reader` composes rather than something
 * `App.tsx` defines. See
 * docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md.
 */

import { useEffect, useMemo, useRef } from "react";
import { useQueryState } from "nuqs";
import type { Block, BlockId, Idea } from "../../../types.js";
import type { PublicIdeas } from "../../../public-types.js";
import { assignSlots } from "../../hit-colours.js";
import { orderFound, resolveIdea, type Found } from "../../search-hits.js";
import { ideaParam } from "../../params.js";
import { usePassageLifecycle } from "../../passage-lifecycle.js";
import { useRenderCount } from "../../perf.js";
import { useIdeas } from "../../useIdeas.js";
import { IdeasPanel } from "../../IdeasPanel.js";

/**
 * Ideas, and the fetch that belongs to it.
 *
 * A component of its own for the reason `ConversationBand` and `GlossaryBand` are:
 * `useIdeas` fetches on mount, and calling it up in `Reader` would charge every
 * reader of every article a request for a list almost none of them will open.
 *
 * What it pushes up is the **resolved** passages, not the stored occurrences.
 * The panel and the prose have to be showing the same set, and the only way to
 * guarantee that is for one of them to compute it and hand it to the other —
 * the same rule `SearchBand` follows. Resolution can drop occurrences (a block
 * the article no longer has), so a panel counting the stored list would say
 * "2 of 5" and step through three.
 *
 * **Exported for tests/passage-mode-cleanup.test.tsx**, which mounts this band,
 * `TimelineBand` and `CriteriaBand` side by side to pin the one contract all
 * three share — which since 2026-09-06 is a hook they all call rather than a
 * rule they each keep: [`usePassageLifecycle`](../../passage-lifecycle.ts).
 * `RememberBand` and `ConversationBand` are exported for the same reason.
 */
export function IdeasBand({
  slug,
  blocks,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  slug: string;
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  useRenderCount("IdeasBand");
  const ideas = useIdeas(slug);
  const band = useIdeasMode({
    ideas: ideas.ideas,
    /* The artefact's own clock, which src/ideas.ts fixes at write time so the
       palette cannot reshuffle. See `useIdeasMode`. */
    generatedAt: ideas.ideas?.generatedAt ?? "",
    blocks,
    onFound,
    openKey,
    onOpenKey,
    onJump,
  });
  return (
    <IdeasPanel
      access={{ kind: "owner", owner: ideas, ideas: ideas.ideas }}
      {...band}
      openKey={openKey}
      onOpenKey={onOpenKey}
      onJump={onJump}
    />
  );
}

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * No `useIdeas` and therefore no `useJobs`: the list came in the page's own
 * payload. See `VisitorGlossaryBand` for why this is a second band and not a
 * second panel.
 */
export function VisitorIdeasBand({
  ideas,
  blocks,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  ideas: PublicIdeas;
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  useRenderCount("VisitorIdeasBand");
  const band = useIdeasMode({
    ideas,
    /* **No clock, and it does not need one.** `generatedAt` seeds the tie-break
       `assignSlots` uses to colour the ideas in a stable order, and the index
       already breaks the tie — the artefact's timestamp is provenance the
       public projection drops on purpose (src/public/dto.ts). What matters is
       that every idea gets the same seed, which the empty string gives. */
    generatedAt: "",
    blocks,
    onFound,
    openKey,
    onOpenKey,
    onJump,
  });
  return (
    <IdeasPanel
      access={{ kind: "visitor", ideas }}
      {...band}
      openKey={openKey}
      onOpenKey={onOpenKey}
      onJump={onJump}
    />
  );
}

/**
 * Everything the ideas band does that is not a fetch: `?idea=`, the colour
 * slots, and the resolved passages it pushes up.
 *
 * What it pushes up is the **resolved** passages, not the stored occurrences.
 * The panel and the prose have to be showing the same set, and the only way to
 * guarantee that is for one of them to compute it and hand it to the other —
 * the same rule `SearchBand` follows. Resolution can drop occurrences (a block
 * the article no longer has), so a panel counting the stored list would say
 * "2 of 5" and step through three.
 */
function useIdeasMode({
  ideas,
  generatedAt,
  blocks,
  onFound,
  openKey,
  onOpenKey,
  onJump,
}: {
  ideas: { ideas: Idea[] } | null;
  generatedAt: string;
  blocks: Block[];
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
  onJump(id: BlockId): void;
}) {
  const [ideaId, setIdeaId] = useQueryState("idea", ideaParam);

  /* The palette slot, assigned over **every** idea rather than only the
     selected one, so an idea's colour does not depend on which one is open —
     the same guarantee `assignSlots` gives saved searches, and the same reason
     App.tsx calls it over all runs rather than the active ones.

     A clock for every idea, so `inCreationOrder` walks them in the order the
     artefact stores — which src/ideas.ts fixes at write time precisely so this
     cannot reshuffle. Ideas have no clock of their own; the artefact's is the
     honest stand-in, and the index breaks the tie. */
  const slots = useMemo(() => {
    const list = ideas?.ideas ?? [];
    return assignSlots(list.map((idea, i) => ({ id: idea.id, createdAt: `${generatedAt}#${i}` })));
  }, [ideas, generatedAt]);

  const selected = useMemo(
    () => ideas?.ideas.find((i) => i.id === ideaId) ?? null,
    [ideas, ideaId],
  );

  /* Document order, so the stepper's "2 of 4" counts the way the reader moves
     through the article rather than the order the model happened to list them. */
  const found = useMemo(() => {
    if (!selected) return [];
    return orderFound(
      resolveIdea(blocks, {
        id: selected.id,
        slot: slots.get(selected.id) ?? 0,
        occurrences: selected.occurrences,
      }),
      "document",
    );
  }, [selected, blocks, slots]);

  /* **The three rules every passage producer follows** — publish before paint,
     drop an open occurrence the list no longer has, and clear everything on the
     way out — in src/web/passage-lifecycle.ts rather than here, because there
     were six copies of them and each one had been got wrong once. `keyed`
     because `Reader` holds the key and hands it back down.

     What stays here is the policy this mode chose and the others did not: the
     two effects below, and `onIdea`. */
  usePassageLifecycle({ kind: "keyed", found, openKey, onFound, onOpenKey });

  /* Standing on the first passage is the state a selected idea is *in* — and it
     is the state whether the reader got there by pressing the row or by opening
     a URL that already had `?idea=` in it. The jump below only fires on a press,
     so a deep link drew three washed passages, emphasised none of them, and put
     "– / 3" in the stepper; the reader's first press of › then took them to
     passage two. Same bug the glossary had, fixed there by deriving rather than
     seeding, and it reaches this panel from the other end. Browser, 2026-08-27.

     **It opens without moving anybody.** A shared URL carries `?at=` too, and
     the reader's own position in the article beats our idea of where they
     should be looking. Only the press earns the scroll. */
  useEffect(() => {
    if (openKey === null && found.length > 0) onOpenKey(found[0]!.key);
  }, [found, openKey, onOpenKey]);

  /* Selecting an idea arrives at its first passage — and it has to be the first
     one that RESOLVED, which cannot be decided in the panel: until the
     selection changes, nothing has resolved that idea's occurrences at all.
     So the press records an intention and this effect spends it once the list
     exists.

     A ref rather than state, so spending it does not cause a render; and
     cleared before the jump rather than after, so a `found` that changes again
     while the reader is reading cannot fling them back to the top. */
  const wantsJump = useRef(false);
  useEffect(() => {
    if (!wantsJump.current || found.length === 0) return;
    wantsJump.current = false;
    const first = found[0]!;
    /* **Open it as well as go to it.** Without this the reader is standing on
       occurrence one — the page has scrolled there and the words are washed —
       while the stepper reads "– / 3", and their first press of › appears to do
       nothing because it moves them to the passage they are already looking at.
       Found in the browser, 2026-08-27; it is exactly the kind of thing that is
       invisible from the code, where "nothing selected yet" and "on the first"
       are two perfectly reasonable states that happen to look identical here. */
    onOpenKey(first.key);
    onJump(first.blockId);
  }, [found, onJump, onOpenKey]);

  return {
    ideaId,
    onIdea: (next: string | null) => {
      void setIdeaId(next);
      /* A new idea means the old occurrence is meaningless — its key names an
         idea nobody is looking at, so the stepper would read "0 / 3". */
      onOpenKey(null);
      /* Only on selecting, never on clearing: pressing the open idea again
         takes the marks away, and throwing the reader down the article as it
         does would be the opposite of what that gesture means. */
      wantsJump.current = next !== null;
    },
    found,
  };
}

/**
 * **Timeline mode's controller.** The band an owner gets, the band a visitor
 * gets, and the hook underneath both: `?event=`, and the resolved passages the
 * panel and the prose have to agree on.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established a day earlier: a mode's controller, its visitor twin and its hook
 * move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 */

import { useEffect, useMemo, useRef } from "react";
import { useQueryState } from "nuqs";
import type { Block, BlockId, TimelineEvent } from "../../../types.js";
import type { PublicTimeline } from "../../../public-types.js";
import { orderFound, resolveTimelineEvent, type Found } from "../../search-hits.js";
import { eventParam } from "../../params.js";
import { usePassageLifecycle } from "../../passage-lifecycle.js";
import { useRenderCount } from "../../perf.js";
import { useTimeline } from "../../useTimeline.js";
import { TimelinePanel } from "../../TimelinePanel.js";

/**
 * The timeline, and the fetch that belongs to it.
 *
 * A component of its own for the reason `IdeasBand` and `GlossaryBand` are:
 * `useTimeline` fetches on mount, so calling it up in `Reader` would charge
 * every reader of every article a request for a chronology almost none of them
 * will open.
 *
 * **The owner's half, and there are two.** This band owns the fetch and the
 * job — `ensure`, `regenerate`, the progress the panel draws; the visitor's is
 * `VisitorTimelineBand` below, which is the payload and nothing else. Timeline
 * was `owners-only` when this comment was first written and has been
 * `{ kind: "artefact", key: "timeline" }` in src/web/visitor.ts § POLICY since
 * 2026-09-04, so a visitor with a shared link meets a band rather than a
 * boundary. A second *band* rather than a second *panel*, for the reason
 * `VisitorGlossaryBand` gives at length: a hook cannot be called conditionally,
 * so "a visitor does not fetch" has to be a component boundary, while what a
 * reader looks at stays one `TimelinePanel` with its data injected.
 * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 1.
 *
 * ## The passage rules are `usePassageLifecycle`'s, and no longer copied here
 *
 * This block used to describe five effects of its own, a second copy of
 * `useIdeasMode`'s, and to say that **a fix to one of these belongs in all
 * three** — the copies having become three when `CriteriaPanel` grew a partial
 * one on 2026-08-31. It ended by naming the fix: a shared hook over
 * `{ found, openKey, onFound, onOpenKey, onJump }`, *"a follow-up worth doing
 * on a quiet file"*.
 *
 * That follow-up landed on 2026-09-06. The three rules the six producers
 * genuinely share live in
 * [`src/web/passage-lifecycle.ts`](../../passage-lifecycle.ts) — publish before
 * paint, drop an `openKey` that names nothing, and clear on the way out — and
 * this band calls it like the other five. Read that file for the rules and for
 * the one that had to change phase to be correct; there is nothing to keep in
 * step by hand here any more.
 *
 * What stayed local is what was never shared: standing on the first passage,
 * and spending the press's intention to jump once the list exists.
 *
 * The one real difference is that there are no colour slots. Timeline paints no
 * lane down the rail — deferred with the marks — so `resolveTimelineEvent`
 * hands every occurrence slot 0 and the prose gets the ordinary wash.
 *
 * **Exported for tests/passage-mode-cleanup.test.tsx**, which is the executable
 * form of the "a fix to one of these belongs in all three" sentence above.
 */
export function TimelineBand({
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
  useRenderCount("TimelineBand");
  const timeline = useTimeline(slug);
  const band = useTimelineMode({
    events: timeline.timeline?.events ?? NO_EVENTS,
    blocks,
    onJump,
    onFound,
    openKey,
    onOpenKey,
  });
  return <TimelinePanel access={{ kind: "owner", owner: timeline }} {...band} />;
}

/**
 * A module constant rather than a fresh `[]`, for the reason `NO_QUOTES` and
 * `NO_TERMS` are: the memo below keys on it by identity, and a new empty array
 * each render would re-resolve every occurrence while the read is still in
 * flight.
 */
const NO_EVENTS: TimelineEvent[] = [];

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * No `useTimeline` and therefore no job, no `ensure`, no `regenerate`: the
 * events came in the page's own payload. See `VisitorGlossaryBand` for why this
 * is a second band rather than a second panel — a hook cannot be called
 * conditionally, so the owner/visitor seam has to be a component boundary.
 * src/web/reader-capability.ts.
 */
export function VisitorTimelineBand({
  timeline,
  blocks,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  timeline: PublicTimeline;
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  useRenderCount("VisitorTimelineBand");
  const band = useTimelineMode({
    events: timeline.events,
    blocks,
    onJump,
    onFound,
    openKey,
    onOpenKey,
  });
  return <TimelinePanel access={{ kind: "visitor", timeline }} {...band} />;
}

/**
 * **Everything the timeline band does that is not a fetch** — `?event=`, the
 * resolved occurrences it pushes up, and the four passage-mode rules the
 * comment above lists.
 *
 * Extracted on 2026-09-04 so that the owner's band and the visitor's are one
 * behaviour rather than two, which is the same split `useQuotesMode` and
 * `useIdeasMode` already have. The comment above still applies to it: a fix to
 * one of the three passage modes belongs in all three.
 */
function useTimelineMode({
  events,
  blocks,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  events: TimelineEvent[];
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  const [eventId, setEventId] = useQueryState("event", eventParam);

  const selected = useMemo(
    () => events.find((e) => e.id === eventId) ?? null,
    [events, eventId],
  );

  /* Document order, so the stepper's "2 of 3" counts the way the reader moves
     through the article rather than the order the model happened to list the
     occurrences in. */
  const found = useMemo(() => {
    if (!selected) return [];
    return orderFound(
      resolveTimelineEvent(blocks, { id: selected.id, occurrences: selected.occurrences }),
      "document",
    );
  }, [selected, blocks]);

  /* **The three rules every passage producer follows** — publish before paint,
     drop an open occurrence the list no longer has, and clear everything on the
     way out — in src/web/passage-lifecycle.ts rather than here. `keyed`, because
     `Reader` holds the key and hands it back down. The two effects below are the
     policy this mode chose and the others did not. */
  usePassageLifecycle({ kind: "keyed", found, openKey, onFound, onOpenKey });

  /* Standing on the first passage is the state a selected event is *in*, and it
     is that state whether the reader pressed the row or opened a URL that
     already had `?event=` in it — without this, a shared link washes the
     passages, emphasises none of them and puts "– / 2" in the stepper. It opens
     without moving anybody: a shared URL carries `?at=` too, and the reader's
     own position beats ours. */
  useEffect(() => {
    if (openKey === null && found.length > 0) onOpenKey(found[0]!.key);
  }, [found, openKey, onOpenKey]);

  /* Pressing a row arrives at its first passage, and it has to be the first one
     that RESOLVED — which the panel cannot decide, because until the selection
     changes nothing has resolved that event's occurrences at all. So the press
     records an intention and this spends it once the list exists. A ref rather
     than state, so spending it causes no render, and cleared before the jump so
     a later change to `found` cannot fling the reader back to the top. */
  const wantsJump = useRef(false);
  useEffect(() => {
    if (!wantsJump.current || found.length === 0) return;
    wantsJump.current = false;
    const first = found[0]!;
    onOpenKey(first.key);
    onJump(first.blockId);
  }, [found, onJump, onOpenKey]);

  return {
    eventId,
    onEvent(next: string | null) {
      void setEventId(next);
      /* A new event means the old occurrence is meaningless — its key names
         an event nobody is looking at, so the stepper would read "0 / 2". */
      onOpenKey(null);
      /* Only on selecting, never on clearing: pressing the open event again
         takes the marks away, and throwing the reader down the article as it
         does would be the opposite of what that gesture means. */
      wantsJump.current = next !== null;
    },
    found,
    openKey,
    onOpenKey,
    onJump,
  };
}

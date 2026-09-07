/**
 * **Where the reader is in the page, in both directions**: `?at=` scrolls the
 * prose, and the prose writes `?at=` back once the reader stops moving.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape the mode
 * controllers established a day earlier: a unit with its own reason to change
 * moves into a file of its own, keeping its code byte-for-byte, so `App.tsx`
 * stops knowing what is inside it. The pure half it leans on is still
 * position.ts. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { throttle, useQueryState } from "nuqs";
import type { Block, BlockId } from "../../types.js";
import { atParam } from "../params.js";
import {
  glideTarget,
  scrollToBlock,
  scrollToTop,
  stickyOffset,
  watchBarVisibility,
} from "../scroll.js";
import { positionToWrite, type Section } from "../position.js";
import { beginJump } from "../keynav.js";
import { rowsForBlockIds } from "../rows.js";

/**
 * Reading position, both ways: the URL scrolls the page, and the page writes the
 * URL once the reader stops moving. Returns the one function anything should use
 * to jump somewhere deliberately.
 *
 * `synced` is the whole trick. Scrolling writes the URL and the URL scrolls the
 * page, so without a record of the value both sides already agree on, every
 * scroll bounces off the restore effect and scrolls again. It is set by whichever
 * side moved first; the other then recognises the value as its own and does
 * nothing.
 *
 * The pure half — which block counts as "the section you are in", and why it is
 * a section rather than an offset — is in position.ts. Written by
 * spideryarn2-cd, 2026-08-25.
 */
export function useReadingPosition(sections: Section[], blocks: Block[], layoutKey: string) {
  const [at, setAt] = useQueryState("at", atParam);
  const synced = useRef<BlockId | null>(null);
  /* The article's block → row index. The spy needs it to ask which section the
     address's current value lies in, which is no longer the same question as
     what the value *is*: a jump may have put a paragraph there. One pass over
     an array the caller already holds. */
  const rowOf = useMemo(() => new Map(blocks.map((b, i) => [b.id, i])), [blocks]);

  // URL → page: first load, back/forward, pasted link.
  useEffect(() => {
    if (at === synced.current) return;
    synced.current = at;
    /* `scrollToTop`, not a bare `window.scrollTo` — Back with a glide still in
       flight would otherwise arrive at the top and be dragged forward again by
       the jump it had just undone. scroll.ts § scrollToTop. */
    if (at === null) scrollToTop();
    else scrollToBlock(at, "auto");
  }, [at]);

  // Page → URL, once the reader stops moving.
  useEffect(() => {
    /* One pass over the table, not one document scan per section — see
       rows.ts. This loop was 38.1% of all script time on a 2,046-block
       article, and the largest single reason a mode switch there cost 4.7
       seconds (Sentry SPIDERYARN-READING2-1M). */
    const rows = rowsForBlockIds(sections.map((s) => s.blockId));
    let frame = 0;
    const measure = () => {
      frame = 0;
      /* Every rule this makes is in position.ts, and it is pure so that the one
         that matters can be watched failing — an untested guard against a race
         is the shape silent-success.md is about.

         `jumpInFlight` is read out here rather than passed inline because
         arguments are evaluated before the call, so an inline version would do
         a rect read per section on every frame of a jump only to have the
         function throw the answer away. The rects are the expensive half of
         this measurement (performance.md). GPT Sol, 2026-08-30. */
      const jumpInFlight = glideTarget() !== null;
      const next = positionToWrite({
        sections,
        rowOf,
        tops: jumpInFlight
          ? []
          : rows.map((el) =>
              el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
            ),
        line: stickyOffset() + 1,
        jumpInFlight,
        atTop: window.scrollY <= stickyOffset(),
        held: synced.current,
      });
      if (next === null) return;
      synced.current = next.at;
      void setAt(next.at);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    measure(); // a column toggle reflows every row without the reader scrolling
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections, rowOf, setAt, layoutKey]);

  /* The controls bar gets out of the way while you read forwards, on a viewport
     short enough for 44px to matter — scroll.ts § watchBarVisibility, and
     styles.css § a small device for the half that decides whether it applies.

     A second scroll listener rather than a branch inside the one above, and
     deliberately: that one exists to keep `?at=` in step with the reader and
     owns React state, this one touches nothing but a `data-` attribute and
     causes no renders at all.

     They do schedule their own rAF callbacks rather than sharing one, so on a
     short viewport this is a second frame callback per scroll — said plainly
     because an earlier version of this comment claimed the pair cost one
     between them, which was simply false (GPT Sol, 2026-08-27). It is bounded:
     the watcher attaches only while the short-viewport media query matches, so
     a laptop installs no listener and pays nothing at all.

     Mounted with no dependencies because it depends on nothing — it re-reads
     the world every frame it runs. */
  useEffect(() => watchBarVisibility(), []);

  // A jump is the one scroll that pushes history: Back must not undo scrolling,
  // but flinging yourself across the article is a deliberate act. The debounce is
  // cancelled too, so a click isn't sluggish.
  //
  // `throttle(0)`, not `undefined`: nuqs resolves this option with `??`, so an
  // explicit undefined here falls straight through to atParam's
  // `debounce(POSITION_SETTLE_MS)` and cancels nothing. throttle(0) aborts the
  // pending debounce. Caught by exactOptionalPropertyTypes — see
  // docs/project/typechecking.md.
  //
  // It does **not** write the URL on the spot, which this comment used to claim.
  // nuqs's queue resets `timeMs` to its own default (50ms outside Safari) and
  // `push` only ever raises it, so `throttle(0)` cannot lower the floor: the
  // write lands within ~50ms, on a later task. Nothing here minds — the scroll
  // starts immediately and the chip is drawn from the entry, not from the
  // address — but a test that waited one tick for it was a coin toss until
  // tests/jump-history.test.ts § settled said so.
  //
  // **The push also has to say where the reader was**, so that a chip can offer
  // them the way back on a device with no Back button. That is `beginJump`
  // (keynav.ts, beside the measurement it uses; the stamp itself is
  // jump-history.ts): it measures the origin (never `?at=`, which is stale by
  // design in three separate ways), arms it, makes this one push, and scrolls.
  // The predecessor's `?at=` is rewritten by `watchHistoryWrites`, which is the
  // thing nuqs's flush eventually calls; a second `setAt` here would be
  // overwritten by this one inside nuqs's queue and would silently do nothing.
  //
  // `synced` is set **only when the jump happened** and only after the fact,
  // which is safe because nuqs defers the push to a later task: React cannot
  // have re-rendered with the new `at` before this line runs. A refused jump
  // must leave it alone, or the restore effect would stop recognising the
  // position the reader is actually standing at.
  const jumpTo = useCallback(
    (blockId: BlockId) => {
      const moved = beginJump(blocks, blockId, (id) => {
        void setAt(id, { history: "push", limitUrlUpdates: throttle(0) });
      });
      if (moved) synced.current = blockId;
    },
    [blocks, setAt],
  );

  // `at` goes out as well as `jumpTo` because it is half of the answer to
  // "where should this link land" — the other half being `?note=`, which the
  // caller has and this hook does not. See arrivalTarget in scroll.ts.
  //
  // `rowOf` goes out because `ReturnChip` asks the same question of it that the
  // spy does — which section is this block in — and a second `new Map` over
  // every block in the article, kept in step by nothing, is two indexes that
  // can disagree.
  return { at, jumpTo, rowOf };
}
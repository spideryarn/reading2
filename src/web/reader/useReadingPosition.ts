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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { throttle, useQueryState } from "nuqs";
import type { Block, BlockId } from "../../types.js";
import { atParam } from "../params.js";
import {
  abandonScroll,
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

  /**
   * **Turn the phone, and you are still reading the same section.**
   *
   * Greg, 2026-09-12 (Sentry SPIDERYARN-READING2-41): *"if I switch from
   * portrait to landscape … it takes me to other bits of the article and I sort
   * of lose my place."* Stage 3 of
   * docs/plans/260916a-back-to-where-you-were-survives-a-mode-change.md.
   *
   * A rotation keeps `window.scrollY` in **pixels** and reflows the prose to a
   * new measure, so the pixel the reader was on is now a different paragraph.
   * Nothing here used to answer that, and the one thing that noticed made it
   * worse: the spy below re-runs on every `layoutKey` change and calls
   * `measure()` immediately, so the app's response to a reflow was to *write
   * down where the reflow had left the reader* — overwriting `?at=`, the only
   * record of where they had been. The reader lost their place and the address
   * agreed with the loss.
   *
   * This is the other way round. On a layout change the **address is the truth**
   * and the page is put back under it. `?at=` is section-granular
   * (position.ts § `positionToWrite` writes only when the section changes), so
   * what is restored is the section rather than the sentence — the precision
   * this app has, and the same precision a reload gives.
   *
   * ## The three things that decide whether it acts
   *
   *  - **`layoutKey` changed and `at` did not.** When `at` changed too, the
   *    restore effect above owns the move: it is what handles Back, Forward and
   *    a pasted link, and a traversal that changes both would otherwise be two
   *    movers on one page, disagreeing the moment either changed. "Skip the
   *    first render" was the first draft of this guard and it was wrong for
   *    exactly that reason — arrival is not the only thing that effect owns.
   *    GPT Sol's fourth finding, 2026-09-16.
   *  - **`at` is not null.** Above the first section there is no section to
   *    hold, and the top of the page is where the browser's own restoration is
   *    already right.
   *  - **Nothing else may still be travelling.** `scrollToBlock` works out a
   *    destination in pixels and `glide` spends ~200ms going to that number, so
   *    a reflow mid-flight leaves it aiming at a layout that no longer exists.
   *    `abandonScroll()` first, then an instant move: there is no stale pixel
   *    left to land on. The plan's first draft *skipped* the re-anchor while a
   *    glide was in flight, which is precisely when the stale number needs
   *    overriding. GPT Sol's second finding.
   *
   *    **And `abandonScroll` is not redundant beside the move that follows it**,
   *    though it looks it: every path of `scrollToBlock` cancels an in-flight
   *    glide *except the one that matters here*, which is `if (!row) return` —
   *    a `?at=` naming a block this article no longer has, after a
   *    re-extraction. That is precisely the case where nothing else would stop
   *    the stale pixel, and the reader would be carried off to it by a layout
   *    they had just left.
   *
   * The one window this does not cover is the ~50ms between a tap and nuqs
   * flushing the jump's push, in which `?at=` still names the origin: rotate
   * inside it and the reader is put back where they started rather than where
   * they were going. Said plainly rather than defended — it is a 50ms window on
   * a gesture that takes a second, and "the jump did not happen" is recoverable
   * by tapping again.
   *
   * **`useLayoutEffect`, not `useEffect`**, so the correction happens before the
   * browser paints. A passive effect would show the reader one frame of the
   * wrong paragraph, which is a flicker they would read as the app losing their
   * place — the very complaint this answers.
   */
  const laidOut = useRef<{ layoutKey: string; at: BlockId | null } | null>(null);
  useLayoutEffect(() => {
    const was = laidOut.current;
    laidOut.current = { layoutKey, at };
    if (was === null) return; // arrival: the restore effect above owns it
    if (was.layoutKey === layoutKey) return; // nothing reflowed
    if (was.at !== at) return; // the address moved too — not ours
    if (at === null) return; // nothing to hold at the top
    abandonScroll();
    scrollToBlock(at, "auto");
  }, [layoutKey, at]);

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

  /* The controls bar gets out of the way while you read forwards — scroll.ts
     § watchBarVisibility, and shell.css § the bar that leaves while you read
     for what a hidden bar looks like.

     **At every width since 2026-09-07**, where this used to say "on a viewport
     short enough for 44px to matter". Greg asked for it on a laptop too, and the
     media query the watcher used to ask went with the gate
     (docs/plans/260907b-the-top-bar-leaves-while-you-read-at-every-width.md).
     The *dock's* half of the same switch is still narrow-only, which is the one
     thing about it that is still a small-screen fact.

     A second scroll listener rather than a branch inside the one above, and
     deliberately: that one exists to keep `?at=` in step with the reader and
     owns React state, this one touches nothing but a `data-` attribute and
     causes no renders at all.

     They do schedule their own rAF callbacks rather than sharing one, so this
     is a second frame callback per scroll — said plainly because an earlier
     version of this comment claimed the pair cost one between them, which was
     simply false (GPT Sol, 2026-08-27). What is no longer true is the sentence
     that followed it, that a laptop installs no listener and pays nothing:
     it does now, and performance.md § two things this changes prices it — the
     listener is passive, coalesced to one callback per painted frame, and its
     body is arithmetic on three numbers with no DOM read in it.

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
/**
 * "Tell me when a webfont lands", without reading `document.fonts.ready`.
 *
 * ## Why not the promise
 *
 * Three effects wanted the same thing — re-measure after a font swap, because
 * a swap changes every row's height — and all three wrote
 * `document.fonts?.ready.then(run)`. Reading that getter is not free: on a
 * 2,046-block, 47,398-node article it was **21.5% of all script time** (2,727ms
 * across four mode switches), the largest single entry in the profile once the
 * row-lookup scan was gone.
 *
 * **Only one of the three was hot, and it is worth saying which.** `Spine`'s
 * effect re-runs on `layoutKey`, so it re-read the getter on *every* mode
 * switch, and GPT Sol attributed the whole 2,727ms node to it. `useDockFit`'s
 * effect depends on a `useCallback(…, [])` and runs once; `OutlinePanel` only
 * mounts as Structure's list face. Those two are changed for consistency and
 * for the coverage below, not because they cost anything measurable — an earlier draft of this
 * claimed all three re-ran per switch, and that was simply wrong.
 * docs/plans/260905d-mode-switching-is-sluggish-on-a-very-long-article.md.
 *
 * ## And the event is more correct, not just cheaper
 *
 * `ready` is a promise for **the batch of loads in flight when you read it**. If
 * the fonts had already settled it resolves at once and never fires again — so a
 * font that starts loading later, because a mode just mounted something that
 * uses it, is missed. `loadingdone` fires for every batch, including that one.
 *
 * The one thing lost is the immediate call when fonts were *already* loaded, and
 * every caller here measures synchronously at setup anyway, so that call only
 * ever repeated work that had just been done.
 *
 * @param run called after each batch of font loads finishes
 * @returns the unsubscribe, safe to call whether or not anything was attached
 */
export function onFontsChanged(run: () => void): () => void {
  /* Absent in jsdom and in older engines — the old code guarded with `?.` for
     the same reason, and a caller must not have to care. */
  const fonts = document.fonts;
  if (!fonts?.addEventListener) return () => {};
  fonts.addEventListener("loadingdone", run);
  return () => fonts.removeEventListener("loadingdone", run);
}

/**
 * **A thread list from `GET /api/chat/<slug>`, with Tutorial read as Recall.**
 *
 * Tutorial was folded into Recall on 2026-10-20: the migration moved each
 * article's Tutorial messages into its Recall thread and renamed the rest
 * (drizzle/20261020063618_fold_tutorial_into_recall.sql), so the server never
 * sends `kind: "tutorial"` again. But a body can still say it: one this
 * browser cached before the deploy and is now serving offline
 * (src/web/lib/offline-store.ts), or one from a server instance still running
 * the old code during the deploy. Nothing on this side knows the word any
 * more, so it is read as `learn` here, once, where the list arrives.
 *
 * **With both in one list, Recall's thread wins** and the Tutorial thread is
 * left out: an article has one Recall conversation (`chat_threads_one_learn`),
 * and the band would otherwise have two to choose between. Its messages are
 * not lost — the server has them in the Recall thread, and the next fresh
 * answer shows them. GPT Sol's F5 on
 * docs/plans/261020m-recall-and-tutorial-become-one-recall.md.
 * tests/chat-retired-kinds.test.ts.
 *
 * Pure, and typed loosely on purpose: what arrives is JSON from the wire, and
 * a `kind` this build's `ThreadKind` does not include is exactly what it is for.
 */
export function withRetiredKinds<T extends { readonly kind: string }>(threads: readonly T[]): T[] {
  const hasRecall = threads.some((t) => t.kind === "learn");
  return threads.flatMap((t) => {
    if (t.kind !== "tutorial") return [t];
    return hasRecall ? [] : [{ ...t, kind: "learn" }];
  });
}

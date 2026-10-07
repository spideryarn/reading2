/**
 * Stage 2, before Readability — **a blog's comment thread is taken out whole,
 * by the name the blog engine gave its container.**
 *
 * > Probably the simplest thing to do would be to exclude them.
 * >
 * > — Greg, 2026-10-07 (`spya-eqjfgv`), on readers' comments
 *
 * Readability mostly does this already: its first pass deletes elements named
 * like comments before scoring, and on nine real posts with threads in their
 * HTML not one comment reached the article
 * ([261007k](../docs/plans/261007k-readers-comments-left-out-of-a-blog-import-on-every-pass.md)).
 * **The gap is its retry.** When the first pass finds under 500 characters it
 * parses again with that deletion off, and if every pass stays short it returns
 * *the longest* — on a short post, the thread. The reader got "5 thoughts on …"
 * and the five thoughts as the article.
 *
 * **Why a short list and not Readability's own rule.** Its rule is a substring
 * test (`comment` anywhere in a class or id), and a page whose real text lives
 * in `div.commentary` is rescued today by exactly the retry this closes; run up
 * front, that rule deletes it (GPT Sol's counter-example, plan § Reviews). So this
 * matches only **the thread containers engines generate, by exact id or whole
 * class token** — WordPress's `.comments-area`, `.comment-list` /
 * `.commentlist` (including old themes' `#commentlist`); Blogger's
 * `.comment-thread.toplevel-thread`; Disqus's `#disqus_thread` — and only what
 * those engines were measured to emit.
 * The generic `#comments` wrapper and `#respond` are deliberately absent: RFC
 * 9110 uses the former for authored prose, and the latter is an ordinary word.
 * A specific list inside a `#comments` wrapper is removed without taking the
 * wrapper — or any otherwise-unmarked post it happens to contain — with it.
 * A discussion page whose discussion *is* the content (Hacker News, Discourse,
 * GitHub, Stack Overflow, a mailing-list archive) uses none of these names.
 *
 * A specific candidate with an `<h1>`, a `<main>`, or the post body by its
 * usual names inside it is also left to Readability. That finite guard cannot
 * recognise every theme; omitting the generic outer ids is what preserves an
 * otherwise-unmarked post sharing `#comments` with a specific inner list.
 *
 * It runs beside src/furniture.ts and before `protectAuthoredStructure`, so both
 * arms of protect's fallback see the same page. Not furniture.ts itself: that
 * module's licence is controls with no block-level content, and a comment thread
 * is the opposite. Its count reaches the log in `ExtractResult.removed` under
 * `READER_COMMENTS_KEY`.
 */

/** The key this pass's count goes under in `ExtractResult.removed`, beside the furniture selectors. */
export const READER_COMMENTS_KEY = "comment-thread containers";

/**
 * Exact ids and whole class tokens — `[class~=…]`, never a substring — so that
 * `comments-link`, `comment-author`, `react-comments-container` and
 * `commentary` are not matched.
 */
const THREAD_CONTAINERS = [
  "#disqus_thread",
  "#commentlist",
  "[class~='comments-area']",
  "[class~='comment-list']",
  "[class~='commentlist']",
  "[class~='comment-thread'][class~='toplevel-thread']",
].join(", ");

/** Strong evidence that a specific candidate also holds the post itself. */
const THE_POST = "h1, main, [itemprop~='articleBody'], [class~='entry-content'], [class~='post-body'], [class~='post-content']";

/** Deletes the page's comment-thread containers; returns how many went. */
export function removeReaderComments(doc: Document): number {
  let n = 0;
  for (const el of Array.from(doc.querySelectorAll(THREAD_CONTAINERS))) {
    /* Already gone, inside a container removed a moment ago. */
    if (!el.isConnected) continue;
    if (el.tagName === "BODY" || el.tagName === "HTML") continue;
    if (el.querySelector(THE_POST) !== null) continue;
    el.remove();
    n++;
  }
  return n;
}

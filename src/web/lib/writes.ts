/**
 * **A count of the writes this page has sent**, for anything that holds a read
 * it got earlier and has to know whether it might now be wrong.
 *
 * The one reader today is the article preload (prefetch-article.ts): a payload
 * fetched under one count is not handed to the reading view under another. It
 * moves when a write is sent *and* again when it finishes, so a read issued
 * while a write was in flight is not trusted either — the server may have
 * answered it from before or after the write, and from here there is no telling
 * which.
 *
 * **Blunt on purpose.** Working out which write changes which article would be
 * a list of *affecting* routes, and that list goes silently stale the day
 * somebody adds a route to it without knowing it exists — a rename is
 * `PATCH /api/library/<slug>`, archiving and sharing are other routes again, and
 * none of them names `/api/article/`. So the list is the other way round:
 * writes known to leave every article payload as it was. If it is wrong the
 * cost is a lost preload, never a stale article.
 *
 * Both entries are writes that **leaving an article always sends**, which is the
 * reason the list exists at all: without them, the reading-time flush or the
 * open record finishing after the shelf had issued its preloads would discard
 * precisely the article the reader was about to reopen — the case in report
 * spya-j78fff. Exact, anchored shapes rather than prefixes, so that a future
 * sub-route under either does not inherit the exemption. GPT Sol's plan review,
 * docs/plans/261003d-preload-recent-shelf-articles.md.
 */

const LEAVE_ARTICLES_CURRENT: readonly { method: string; path: RegExp }[] = [
  /* Counts an open and stamps `lastOpenedAt` on the shelf row. Neither is in
     the article payload (`loadArticle`, src/store/pg.ts). */
  { method: "POST", path: /^\/api\/library\/[^/]+\/open$/ },
  /* Seconds spent on blocks, read back only by `GET /api/reading-time/<slug>`. */
  { method: "POST", path: /^\/api\/reading-time\/[^/]+$/ },
];

let count = 0;

/** The current count. Compare two readings; the value itself means nothing. */
export function writeCount(): number {
  return count;
}

/**
 * Say that a request is being sent, or has finished. A GET, or a write on the
 * list above, leaves the count where it is.
 */
export function noteRequest(input: string, method: string | undefined): void {
  const verb = (method ?? "GET").toUpperCase();
  if (verb === "GET" || verb === "HEAD") return;
  const path = input.split("?")[0] ?? input;
  if (LEAVE_ARTICLES_CURRENT.some((w) => w.method === verb && w.path.test(path))) return;
  count += 1;
}

/**
 * **The longest prefix of a list whose JSON fits a byte budget** — for a
 * response that returns whole items and has to stay under the 4.5 MB a Vercel
 * function may send.
 *
 * A count stands in for a size only while every item is small. A feedback report
 * may be 20,000 characters, which is 120 KB of JSON when every character is a
 * control character escaped to six bytes, so fifty of them can pass the
 * platform's ceiling. Plan
 * docs/plans/261007j-feedback-takes-twenty-thousand-characters-and-admin-feedback-pages-by-size.md.
 *
 * **Always at least one**, so a caller that pages on what came back always moves
 * forward; one item is bounded by its own caps, not by this. Counts the list's
 * brackets and commas, so the array as serialised is never over the budget
 * unless it is a single item.
 *
 * A prefix and never a selection: the caller says *there are more* and pages
 * from the last item returned, so nothing is skipped and nothing is cut short.
 */
export function prefixWithinBytes<T>(items: readonly T[], budget: number): T[] {
  const kept: T[] = [];
  let weight = 2; // the brackets
  for (const item of items) {
    const bytes = Buffer.byteLength(JSON.stringify(item)) + (kept.length > 0 ? 1 : 0);
    if (kept.length > 0 && weight + bytes > budget) break;
    kept.push(item);
    weight += bytes;
  }
  return kept;
}

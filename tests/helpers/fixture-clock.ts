/**
 * A clock for a daemon under test that starts at the fixtures' own instant and
 * then advances in real time.
 *
 * Why it exists: a fixture that writes a literal `collectedAt` and lets the
 * daemon read the wall clock is a test with an expiry date. `chooseUsage`
 * discards a stored report older than `LONGEST_ACTIVE_WINDOW_MS` (seven days),
 * so three tests dated 2026-09-08 and 2026-09-09 went red on their own as each
 * fixture crossed that bound, with no code change —
 * docs/plans/260924a-usage-tests-rotted-with-the-calendar.md.
 *
 * It advances rather than standing still because the daemon also times ticks
 * and passes with it; a frozen clock would be a second, unrelated change to
 * what the test exercises.
 */
export function clockFrom(iso: string): () => Date {
  const startMs = Date.parse(iso);
  if (!Number.isFinite(startMs)) throw new Error(`clockFrom: unparseable instant ${iso}`);
  const offsetMs = startMs - Date.now();
  return () => new Date(Date.now() + offsetMs);
}

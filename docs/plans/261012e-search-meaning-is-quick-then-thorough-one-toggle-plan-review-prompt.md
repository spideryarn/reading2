Review the plan docs/plans/261012e-search-meaning-is-quick-then-thorough-one-toggle.md (read-only review; do not edit files).

Context: Greg asked (quoted in the plan) to fold Search mode's three matchers (words · quick · meaning) into two (words · meaning), where meaning shows a quick result at once and replaces it with a thorough one. The auto-thorough upgrade already exists for the quick matcher: src/web/modes/search/auto-thorough.ts, wired in src/web/modes/search/SearchMode.tsx. The toggle and box are in src/web/SearchPanel.tsx (search for `matcher === "quick"` and `switchTo`). The URL param parser is src/web/params.ts (`MATCHERS`, `matchParam`, `resolveMatcher`, `asksTheServer`). Other readers of ?match=: src/web/last-view.ts, src/web/search-hrefs.ts. Docs: docs/project/search.md.

Please check:
1. Is anything in the plan wrong about how the code works today (e.g. does Enter/find on the quick matcher already start thorough immediately; does anything else compare matcher to "quick" or "meaning" that the plan misses — grep src/ and tests/)?
2. Any old URL / stored state that would break (?match=quick, ?match=meaning, last-view replays, visitor/public view, MCP, chat cards, the dock quick-search handoff in useBarHandoff, command bar "Quick search" rows)?
3. Anything about the old manual meaning path (onAsk with no session, `repeat`, `ready` needing `loaded`) that the fold breaks or leaves dead.
4. The cost framing: is the plan honest about what changes?
5. Simpler option it missed.

Write findings numbered F1.., each with severity (high/medium/low), file:line evidence, and a suggested fix. End with a one-line verdict: BUILD AS PLANNED, BUILD WITH CHANGES, or RETHINK.

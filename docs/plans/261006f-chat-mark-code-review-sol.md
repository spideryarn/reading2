# 261006f code review

**Verdict: approve with changes.** Two confirmed preview defects are fixed in the working tree,
with regressions observed failing first. The remaining finding is a measured performance risk,
reported only. No commit was made.

Reviewed commit: `41734f252f13616264801c85083bc33aa322949e`. Locations below refer to that commit,
before the fixes. IDs continue after the plan review's F1–F5.

**F6 — P1 — Flattening before stripping loses literal words and manufactures citations.**
`src/answer-opening.ts:127` (also `words` at line 89).

`[See spya-k3m9qt](https://example.com/source)` became `See`; a label containing only the id
became no preview at all. The collapsed card then displayed `1 question` despite having answer
text. Raw `withoutBlockIds` protects a markdown link's entire matched span, including its label;
after flattening, that protection is gone. A URL label containing `*` also loses an id after the
bare-URL matcher stops at the asterisk.

More seriously, `[spya-](https://example.com/source)k3m9qt is literal.` became `is literal.`:
joining nodes created an id-shaped string that was absent from any original text leaf.
``Use `spya-k3m9qt` as a key.`` became `Use as a key.`; image alt text and raw HTML
attributes suffered the same loss of literal context.

**Changed:** strip citations from ordinary text leaves before joining, protect link and reference
link labels, and preserve code, image alt text and raw HTML. Keep whitespace at leaf boundaries
and tidy only the completed line. `withoutBlockIds` delegates to the same stripping and tidying
operations in the same order, preserving its existing Live behavior. Added helper regressions and
a failing collapsed-card regression; all pass after the fix.

**F7 — P1 — The depth fallback restores markdown to a plain-word preview.**
`src/answer-opening.ts:87`.

Thirteen `> ` prefixes followed by `**Deep** answer [spya-k3m9qt].` returned
`> **Deep** answer.`. The cap copied the renderer's source-preserving fallback, which does not
satisfy the preview's transformation contract. The existing test merely required the result to
contain `deep`, so raw markdown passed.

**Changed:** replaced recursive flattening and its source fallback with an iterative stack. The
walk stops once a readable line is found. Added exact-output assertions at thirteen and 4,000
levels, observed the shallow assertion fail first, and verified both pass after the fix.

**F8 — P2 — Each summaries request parses every newest answer in full.**
`src/routes.ts:4484`, `src/answer-opening.ts:126`.

The parser still consumes the whole answer even when its opening is the short plain sentence
`Opening answer.`. The summaries route calls this synchronously for each thread. Five-sample
synthetic medians on this shared box, after the fixes:

| Answer size | Preview time |
|---|---:|
| 4,147 characters | 18 ms |
| 16,419 characters | 68 ms |
| 32,821 characters | 103 ms |
| 131,115 characters | 379 ms |
| 524,350 characters | 1,679 ms |

These are markdown-heavy synthetic answers, not production latency measurements. They establish
that answer length matters and that many threads multiply the synchronous cost. The iterative
walk avoids flattening the unused suffix, but it does not avoid parsing it.

**Reported only:** caching or persisting derived previews would need a broader lifetime and
invalidation design. Arbitrarily cutting the source before parsing would alter reference links
whose definitions occur later. Reproduce with
`node --import tsx docs/plans/261006f-chat-mark-preview-cost-probe.mjs`; the
[probe](261006f-chat-mark-preview-cost-probe.mjs) is retained as evidence.

**F9 — P3 — The doc and helper comments overstate the first-line and no-syntax guarantees.**
`docs/project/debate.md:84`, `docs/project/architecture.md:413`, `src/answer-opening.ts:111`.

The preview can skip rules, empty lines and citation-only lines, so it is not invariably the
answer's own first line. Literal code or raw HTML can legitimately retain syntax. The helper and
test comments also repeated the gutter-hover inventory already corrected by plan finding F5.

**Changed:** describe the first readable line, markdown formatting and prose citations, preserving
literal contexts. Removed the incorrect hover claim from the helper and test comments. These are
factual corrections; no quotations were added.

**Other checks:** the move of `withoutBlockIds` was unchanged in the reviewed commit, and Live's
seed behavior remains covered by its passing tests. Exporting `summarise` for a database-free
test introduces no demonstrated runtime defect; no extraction solely to hide that export is
warranted. Nested lists, reference definitions, CRLF, escapes and entities are covered. An
interrupted `**Unclosed bold` remains literal text, matching the parser; an open fence yields its
code contents. Both are covered through the collapsed card. No wider correctness defect was
established.

**Validation:** the original requested run passed 61 tests. New regressions then failed in four
helper tests and one collapsed-card case before the source fix. The fixed requested run passed
69 tests; including `tests/doc-links.test.ts` passed 85. Typechecking passed all four projects
and its 3,300-file coverage guard with `node --import tsx scripts/typecheck.ts`.
`npm run typecheck` itself could not start because the sandbox refuses the tsx CLI's IPC pipe
(`listen EPERM`); the successful command invokes the same runner directly. Scoped Biome lint and
`git diff --check` passed. Full `npm test` could not run its database setup: sandbox networking
refused Postgres at `127.0.0.1:54362`, and Docker discovery failed. This is not a full-suite green.

The root-cause check and classes are recorded in
[the postmortem](../postmortems/261006j-flattening-destroys-the-context-a-later-filter-needs.md).
Fixes and review artifacts remain uncommitted for the stage owner to inspect.

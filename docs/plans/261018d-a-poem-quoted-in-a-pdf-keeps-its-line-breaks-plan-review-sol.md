F1 — high — The diagnosis is visually right, but a bare `<br>` is not data-neutral.

Evidence: the current newline survives escaping into `block.html` ([src/pdf-read.ts:2408](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/pdf-read.ts:2408)), while `extractText` collapses both newlines and `<br>` boundaries to one space ([src/blocks.ts:296](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/blocks.ts:296)). Thus `block.text`, its carried id, and `hashBlocks` remain unchanged; `hashBlocks` reads id/text/classification, not HTML ([src/source-hash.ts:115](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/source-hash.ts:115)).

But the browser’s annotation coordinate is `block.html`’s concatenated text nodes ([src/web/annotate.ts:338](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/web/annotate.ts:338)). Replacing `a\nb` with `a<br>b` changes that string from `a\nb` to `ab`, because `<br>` contributes no text node. Selections use the same `Range.toString()` space ([src/web/selection.ts:113](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/web/selection.ts:113)), while the server validates against folded `block.text`, which contains `a b` ([src/quote-in-block.ts:81](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/quote-in-block.ts:81)). A new comment or chat selected across a verse line can therefore be rejected as “not in that block”; an existing cross-line annotation containing the old newline stops drawing. Cross-references spanning the break also disappear because they intentionally use whitespace-preserving matching ([src/web/annotate.ts:1123](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/web/annotate.ts:1123)) while their freshness fingerprint does not include HTML ([src/crossrefs-fingerprint.ts:46](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/crossrefs-fingerprint.ts:46)).

Recommendation: emit `<br>\n`, not bare `<br>`. That gives the visible break while preserving the existing newline in `textContent`, `Range.toString()`, offsets, and old anchors. Add tests for `renderedText`, selection/anchor validation, an existing cross-line comment, and a cross-reference.

F2 — medium — “Errs towards today’s behaviour” is false for false positives, and the classifier has concrete ones.

Evidence: any quote with at least half its breaks classified “free” gains visible formatting that did not exist before ([plan:46](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/docs/plans/261018d-a-poem-quoted-in-a-pdf-keeps-its-line-breaks.md:46), [plan:57](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/docs/plans/261018d-a-poem-quoted-in-a-pdf-keeps-its-line-breaks.md:57)). False-positive shapes include:

- Short dialogue or interview turns: `Alice: I disagree.\nBob: So do I.\nChair: The motion carries.` Every break is “free.”
- Two-line prose with a short first line and long second line. The test covers only the opposite shape—long first line followed by short continuation ([tests/pdf-quote-line-breaks.test.ts:74](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/tests/pdf-quote-line-breaks.test.ts:74)).
- Ordinary wrapped prose containing one anomalously long line, such as a URL or a pair of lines the model accidentally joined. Because the longest line defines the width, it raises the 85% threshold and can make most normal wrapped lines look “free.”
- Multi-paragraph prose with blank lines. Empty lines are automatically free and can tip the count over half.
- Narrow-column prose under 45 characters. The width floor makes those lines free rather than distinguishing them from uniformly short verse.

Recommendation: state that false positives are new regressions, add these negative fixtures, and make the gate more conservative—at least three breaks, substantially more than half free, and a robust width such as the second-longest line so one outlier cannot dominate. No length-only rule can perfectly distinguish verse from dialogue or short prose.

F3 — medium — Changing every quote continuation separator to `\n` is mechanically safe but not semantically safe.

Evidence: offsets remain correct because both separators occupy one character: `pieces.start` explicitly assumes one separator ([src/pdf-read.ts:1940](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/pdf-read.ts:1940)), and marker page spans subtract that same character ([src/pdf-read.ts:2354](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/pdf-read.ts:2354)). Note-marker positions therefore remain stable provided line-break conversion happens after `withMarkers`, rather than marking each line with unre-based offsets.

However, seam hyphen repair runs first and can turn page 1’s `dis` plus page 2’s `patcher and …` into page 1 ending `dispatcher` and page 2 beginning `and …` ([src/pdf-read.ts:1830](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/pdf-read.ts:1830), [src/pdf-read.ts:3732](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/pdf-read.ts:3732)). Adding a newline afterwards invents a verse break after `dispatcher`, even though that boundary was a wrapped, hyphenated physical line. The proposed seam test only splits between complete poem lines ([tests/pdf-quote-line-breaks.test.ts:90](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/tests/pdf-quote-line-breaks.test.ts:90)).

Recommendation: safest and simplest is to keep the continuation join as a space, accepting at most one missed line at a page turn. If seam preservation is required, do not add a newline across a seam repaired by `mendSeamHyphens`, and add tests covering repaired hyphens, a marker after the seam, and the three-piece empty-continuation chain.

F4 — low — The identity/fingerprint test does not test its stated claim.

Evidence: it compares only the two arrays of `text`; it neither supplies the old blocks as the carry-over baseline nor calls `hashBlocks` ([tests/pdf-quote-line-breaks.test.ts:103](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/tests/pdf-quote-line-breaks.test.ts:103)). The implementation reasoning is sound—exact keys normalize whitespace ([src/blocks.ts:914](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/blocks.ts:914)) and hashes omit HTML—but the test would stay green if id carry-over or hashing changed.

Recommendation: assert that `splitIntoBlocks(newHtml, oldBlocks)` preserves the id, and compare `hashBlocks(before)` with `hashBlocks(after)`. Also pin the rendered-text equality required by F1.

F5 — low — No additional blocker appears in maths, sanitising, or export once F1 is fixed.

Evidence: PDF transcription is explicitly restricted to `\(…\)` and `\[…\]` ([src/pdf-read.ts:470](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/pdf-read.ts:470)), and the proposed maths exclusion prevents `<br>` from splitting their text node; maths rendering scans each text node independently ([src/web/maths.ts:121](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/web/maths.ts:121)). `<br>` is not forbidden by the article sanitiser ([src/sanitize-policy.ts:299](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/sanitize-policy.ts:299)). Export faithfully carries the changed extracted/stamped HTML and block HTML ([src/store/export-bundle.ts:463](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/store/export-bundle.ts:463)); that changes export bytes as expected, without corrupting their structure.

Recommendation: retain the maths exclusion, add one sanitiser round-trip assertion, and document that exports change while text-based caches do not.

APPROVE WITH CHANGES
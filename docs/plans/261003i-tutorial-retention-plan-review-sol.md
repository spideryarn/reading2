The direction fits `vision.md`: stronger retention and links into the author’s words. I found nine changes to make before building. No P0 findings.

This was read-only. Implementation edits appeared during the review; source line numbers below refer to the original `428054781` baseline.

**PR-1 — P1: The startup instructions conflict with the new task rule.**

The plan forbids own-view questions in the first two tasks, but leaves the unread-reader starter asking “what they would expect, what they already think, why it might matter” ([src/converse.ts:904](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/converse.ts:904)). Those are precisely own-view questions.

Also, treating any short first message as evidence of not having read the article conflicts with the existing instruction to honour a narrow goal and skip basics for experts ([src/converse.ts:977](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/converse.ts:977)). “Help me understand section 4” gives little recall without establishing unreadness.

**Instead:** teach a small cited passage when recall is absent, without inferring reading history. Preserve explicit goals and profiles. Make the opening task an interpretation or application of the supplied passage, answerable without prior reading. Test both an empty-recall novice and a terse expert request.

**PR-2 — P1: “Citations … no worse” permits a known violation of the quotation contract.**

The plan concludes that the prompt already supplies quotation links, then accepts citations and quote-in-block results that are merely “no worse.” But the supplied eval contains a substantial quotation with no citation at all ([evals/results/remember-tutorial.md:71](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/evals/results/remember-tutorial.md:71)). The authoritative rule requires every quotation to carry its source block ([src/converse.ts:566](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/converse.ts:566)).

Stage 2 cannot help a quotation with no chip.

**Instead:** require zero unlinked article quotations in the evaluated new arm. Keep “no worse” for softer quality measures, but make quotation provenance an explicit gate. Strengthen the existing recency reminder only if the runs show it is needed.

**PR-3 — P2: The proposed two-article eval does not yet have two-article reader inputs.**

The existing readers name Seth’s simulation argument, biological naturalism, predictive processing and metabolic substrate ([evals/remember-tutorial.ts:45](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/evals/learn-tutorial.ts:45)). Running those unchanged against Levin measures responses to misplaced premises, rather than the intended retention behaviour.

A “long, good, opinionated account” also cannot be generic in its substantive content: correctness against the article is what supposedly triggers premature climbing to *Doubt*.

**Instead:** provide small, article-specific script sets, with accurate rich recall for each article. Reuse the reader categories and sequence. Otherwise keep the existing three readers on Noema and add a faithful reconstruction of Greg’s scenario on Entropy.

**PR-4 — P2: The measurement can reward wording changes without demonstrating better tutoring.**

The proposed own-view screen flags “Why **do you think** he needs that step?”—an existing author-focused task ([src/converse.ts:931](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/converse.ts:931)). Changing it to “Why does he need that step?” improves the count without changing its intellectual purpose.

The quotation screen must also distinguish fidelity from navigation. `findQuote` defaults to forgiving matching, which deliberately accepts differences unsuitable for verifying a quotation ([src/quote-match.ts:234](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/quote-match.ts:234)). Checking only an ellipsis’s longest piece does not establish that every quoted piece belongs to the cited block.

Finally, the plan omits the prompt hash and blind comparison required by [prompting-guide.md:199](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/docs/project/prompting-guide.md:199).

**Instead:** keep regex hits as review flags. Base the pass decision on blind, shuffled, whole-conversation comparisons and manually classified task intent. Record prompt and input identities. Verify quotations using `"spaced"` matching against `block.text`; check every nonempty ellipsis piece in order. Keep forgiving matching for drawing navigation highlights.

**PR-5 — P2: Option A does not currently support an invisible-at-rest `Found`.**

A normal `Found` with no quote stroke becomes a washed hit; null confidence becomes strength 1 ([src/web/search-hits.ts:1333](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/web/search-hits.ts:1333)). Annotation then emits `data-wash` ([src/web/annotate.ts:539](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/web/annotate.ts:539)), and CSS paints both a background and, without hue slots, a search underline ([annotations.css:373](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/web/styles/annotations.css:373), [annotations.css:645](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/web/styles/annotations.css:645)). Setting strength to zero does not remove that underline.

Publishing into the selected passage slot would also feed paragraph bars and rail projections ([Reader.tsx:1329](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/web/reader/Reader.tsx:1329)). Chat and Remember currently select no slot.

**Instead:** specify an independent transient annotation layer that contributes only navigation marks, preserving active-mode passages and existing annotations. Give it explicit clearing and overlap behaviour. A lower-level transient `Mark` is a cheaper candidate than making a citation flash impersonate a search result.

**The suspected timing hack is not presently necessary:** `aimAt` already treats missing passage marks as provisional and remeasures them after rendering ([scroll.ts:973](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/web/scroll.ts:973)). Option A’s real complexity is representation and lifecycle.

**PR-6 — P1: Digit stripping can highlight different scientific text, and does not describe the reported marker shape correctly.**

`renderedText` uses `textContent` ([src/web/annotate.ts:331](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/web/annotate.ts:331)). I confirmed:

- `<sup>2</sup>` produces `Self2 as a process`.
- `<sup>6</sup>` produces `maintained6 by agents`.
- Both miss their marker-free quotation under today’s matcher.

These digits occur between a letter and whitespace, rather than “between letters.” Broadening the regex to remove them also risks turning ordinary scientific content such as `CO2 concentration` into `CO concentration`. Removed characters additionally require mapping matched offsets back into the original text.

The repo already explains why footnote controls should be identified by nodes rather than numeric patterns ([src/blocks.ts:655](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/blocks.ts:655)).

**Instead:** ignore only identified footnote-control nodes, with an original-offset map. Preserve genuine superscripts and ordinary numbers. For unidentified markers, retain the whole-block fallback. Test both reported cases, a genuine scientific superscript, and offsets after the omitted marker.

**PR-7 — P2: A segmenter test alone misses quotations split by Markdown.**

`Cited` calls the citation segmenter separately for individual text nodes; emphasis and strong text are rendered recursively ([src/web/Cited.tsx:389](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/web/Cited.tsx:389), [src/web/Cited.tsx:498](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/web/Cited.tsx:498)).

I confirmed that `“**Self** as a process” [id]` becomes three sibling nodes. The citation’s text node contains only the quotation’s ending. Finding the last complete quotation within that node fails.

**Instead:** associate quotes and citations across the inline AST, then pass the result to rendering. Require genuine adjacency so an earlier quotation is not attached to a later paraphrase citation. Add renderer-level cases for emphasis, multiple quotes and multiple ids; specify that “last quote” intentionally highlights only one quote when several share a citation.

**PR-8 — P2: Option B describes painting, but leaves its promised centring unspecified.**

Current centring and already-visible detection resolve passage keys through `passageMarks`, which finds annotation elements ([src/web/rows.ts:104](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/web/rows.ts:104), [src/web/scroll.ts:1003](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/web/scroll.ts:1003)). A Custom Highlight creates no such marks. Adding a range painter beside `flashBlock` would therefore still centre the paragraph.

**Instead:** if B remains an implementation option, include shared range geometry for scrolling and visibility, plus integration with flash cancellation, reduced motion and pending flashes. Otherwise remove B from the approved fallback. Its actual comparison with A includes that work.

**PR-9 — P2: Stage 3’s “titles and gist” assumes a summary that does not exist.**

`ThreadSummary` contains a title, anchor, turn count and optional first line of the latest answer—no conversation gist ([src/types.ts:3743](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/types.ts:3743)). Producing gists would add model work; using `lastLine` as a gist would misrepresent its meaning.

`my_notes` does pass the tool filter: it supplies reader context absent from the prompt. The fencing concern is correctly identified. Its proposal should also reflect the existing requirement that each tool cap its output ([src/chat-tools.ts:34](/home/greg/code/spideryarn2/.claude/worktrees/fb-tutorial-2610/src/chat-tools.ts:34)).

**Instead:** describe B as capped comments/highlights plus a thread index, with bounded transcript retrieval when needed. Scope reads to the authenticated owner and current article; preserve speaker roles and source identities; fence stored content; announce truncation. C remains a reasonable recommendation with that smaller definition.

**VERDICT: build with the changes above** — depends on PR-1 through PR-8 for Stages 1–2. PR-9 changes the deferred proposal before it becomes a build plan.
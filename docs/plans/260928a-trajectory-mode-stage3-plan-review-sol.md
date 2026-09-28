## Findings

### F18 — P1 — A thread keyed only by depth cannot reliably name the previous stop

The same stop at the same depth can have different predecessors:

- A direct `?depth=2` entry starts at the route’s first stop.
- “Go round again” starts at the first stop newly added at depth 2.
- A row press can jump there from anywhere.
- Back/Forward can restore another entry path.

Evidence: the plan stores one line per stop/depth ([plan:291](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:291)), while current routing defaults to the route’s first stop ([trajectory-route.ts:78](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/trajectory-route.ts:78)) but “go round again” jumps to the first newly added stop ([trajectory-route.ts:107](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/trajectory-route.ts:107)). Arbitrary row jumps are also supported ([TrajectoryMode.tsx:304](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/modes/trajectory/TrajectoryMode.tsx:304)).

Recommendation: make the snippet context-free—one `cue` per stop, such as “Look for how rich-club membership changes the comparison.” It can still replace the role and preview the next stop. If relational text is retained, key it by an actual `{fromQuoteId,toQuoteId}` edge and show it only when that edge matches the reader’s transition.

### F19 — P1 — The card would silently present stale artefacts as current

The plan says to show every matching cluster whenever its artefact exists, but does not inspect `stale` ([plan:306](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:306)). All four reads report staleness; existing panels warn because stale occurrence links or content can describe an older article. Ideas states this explicitly ([IdeasPanel.tsx:219](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/IdeasPanel.tsx:219)); FAQ does the same ([FaqPanel.tsx:159](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/FaqPanel.tsx:159)).

Recommendation: exclude a cluster when its artefact is `stale`, or label it visibly as describing an older version. Suppressing it is the simpler scrapbook behavior. `outdated` is less serious because the source article is unchanged, but its policy should also be explicit.

### F20 — P1 — “Met at stop k” claims reading history the client does not possess

The proposed marker says a term was “met” earlier ([plan:311](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:311)). Trajectory stores route position, not visited stops; deep links and row presses can put a reader at stop 7 without seeing stops 1–6.

Recommendation: say “also used at stop k” or “earlier on this route.” Do not use “met” unless actual visited-stop state is introduced.

### F21 — P2 — The trajectory call cannot tie together the scrapbook artefacts it never sees

The plan says the same call needs nothing beyond the quotes ([plan:291](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md:291)); the current call deliberately sees quotes, tree paths, and profile but not glossary, Ideas, FAQ, or Timeline ([trajectory.ts:11](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/trajectory.ts:11)). It can create a thread through stops, but cannot knowingly tie together the disparate scrapbook elements Greg asked about ([trajectory.md:126](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/project/trajectory.md:126)).

Recommendation: describe it honestly as a route cue, not scrapbook synthesis. Do not add the optional artefacts to the call; that would braid freshness, optional generation, and regeneration together. The client’s juxtaposition can tie the scrapbook together.

### F22 — P2 — The existing Ideas, FAQ, and Timeline hooks are not read-only interfaces

A normal Trajectory activation will not generate these artefacts because `useAutoRun` tokens are target-specific. However, each proposed source hook also mounts job machinery and automatic generation:

- Ideas: [useIdeas.ts:180](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/useIdeas.ts:180)
- FAQ: [useFaq.ts:127](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/useFaq.ts:127)
- Timeline: [useTimeline.ts:156](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/useTimeline.ts:156)

Their own comments describe them as owned by their respective bands. Therefore “nothing here starts a run” is true only through current activation behavior, not through the API being used.

Recommendation: split out GET-only `useIdeasRead`, `useFaqRead`, and `useTimelineRead`, following `useGlossaryRead`. Layer jobs and `useAutoRun` only in the original modes.

### F23 — P2 — The plan misidentifies the glossary matching path

Glossary’s prose underlining does use the shared matcher, but first restricts matching to `entry.blocks` ([annotate.ts:837](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/annotate.ts:837)). Therefore using `termMarks` would retain the stored-list misses the plan wants to avoid.

The proposed direct scan is feasible. The functions are:

- `formsOf(entry)`
- `termPattern(...)`
- `termAppears(...)`

in [term-match.ts:75](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/term-match.ts:75). To match the actual prose, scan `renderedText(block.html)`, as underlining does ([annotate.ts:852](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/annotate.ts:852)).

Recommendation: name that exact recipe in the plan and test inflection, alias, plural, possessive, and Unicode-boundary cases.

### F24 — P2 — FAQ cannot link to the relevant question

Ideas, Glossary, and Timeline have `?idea=`, `?term=`, and `?event=` selections. FAQ explicitly has no URL parameter and nothing addresses a question ([FaqMode.tsx:10](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/modes/faq/FaqMode.tsx:10)). A “link into FAQ” can open the mode but cannot focus the question shown on the card.

Recommendation: for Stage 3, render the FAQ question as text with a jump to its matching passage. Adding `?question=` is possible but is extra URL, focus, scroll, and history work.

### F25 — P2 — Thread validation and output budgeting need a complete migration contract

The proposed shape says invalid lines disappear, but does not specify:

- rejecting arrays/non-objects;
- accepting only keys `"1"`, `"2"`, and `"3"`;
- rejecting a key for a depth where the stop is not visible;
- trimming and enforcing the 160-character limit per value;
- diagnostics for invalid thread lines;
- how new outputs avoid counting every intentionally absent `role` as `badRole`;
- updating the output-token calculation, currently based on one 80-character role per offered quote ([trajectory.ts:101](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/trajectory.ts:101)).

Recommendation: specify and test normalization explicitly. Keep `thread` optional for old artefacts, normalize new `role` to `null` without recording an error, add a backwards-compatible `badThread` diagnostic, and budget/test the largest permitted response.

## Data-plumbing conclusion

The client can gather all four clusters by block ID without new generation:

- Glossary is already loaded for prose underlines through `useGlossaryRead`.
- Ideas filter `idea.occurrences[].blockId`.
- FAQ filters `question.passages[].blockId`.
- Timeline filters `event.occurrences[].blockId`.

The only architectural gap is that Ideas, FAQ, and Timeline currently combine reading with job/auto-run behavior; F22’s split would make the no-generation promise structural.

## Anti-goal assessment

The trimmed stop card itself is acceptable: only the current stop expands, the section gist and quote reason are removed, and the prose remains beside or immediately behind it. That is consistent with “generated text is a door” ([vision.md:57](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/project/vision.md:57)).

The risky part is the 160-character relational thread. Keeping it imperative or interrogative and context-free avoids turning it into a miniature synthesis readers can substitute for the passage.

The simplest valuable version is the trimmed stop card plus the next stop’s existing role beneath the door. If that proves too thin, replace `role` with one context-free cue per stop—not three predecessor-dependent lines.

**Verdict: approve with changes.** The scrapbook card is sound, but the per-depth relational thread should not be built in its current form.
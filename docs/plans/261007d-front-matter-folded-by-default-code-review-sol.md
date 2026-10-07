Fixed all in-scope P1 findings, red-first. No protected files were touched and no commit was made.

## Findings

- **C1 — P1 — established — fixed.** Lead phrases were accepted too broadly, hiding prose such as title-cased subtitles or short sentences beginning with “Correspondence.” Replaced positional word counting with closed, known label prefixes. Red tests: `leaves a short sentence that starts with a lead word`, `leaves a title-cased subtitle that mentions correspondence mid-line`, and `leaves a title-cased subtitle with a lead phrase near its start`.

- **C2 — P1 — established — fixed.** `readsAsProse` missed short institution-heavy sentences, labelled authored content, and scripts without case. This hid examples such as `Harvard University Press declined.`, acknowledgements/keywords/funding, and Chinese prose containing “University.” Red tests: `leaves a short institution-dominated sentence`, `leaves labelled content that is not author detail`, and `leaves prose in a script without upper and lower case`.

- **C3 — P1 — established — fixed.** Author evidence had three unsafe paths: comma-split organisations became names; one or more known names anywhere in a title-cased deck counted as a byline; and the glued-letter allowance matched a longer surname. Author evidence now rejects organisation/job fragments and requires matched names to leave only separators and marks, unless a real footnote mark proves a partial list. Red tests: `does not turn an outlet fragment in a comma-separated byline into a name`, both `mentions … authors` subtitle tests, and the extended `finds a name with a superscript letter …` test.

- **C4 — P1 — established — fixed.** Closing an open front-matter run while `?at=` held a finer hidden block left the URL unchanged because `positionToWrite` saw the same section. A reflow or reload then reopened the run. The held address is now canonicalised through `visibleFrom` before comparison. Red test: `rewrites a front-matter position when the reader shuts the run`.

- **C5 — P1 — established — fixed.** `visibleFrom` returned a hidden block when the shut run reached the end of the article, violating the contract that a wholly hidden section is not a navigation stop. It now returns `null`, and key navigation skips that stop. Red test: `has no visible destination when the run is the end of the article`.

- **C6 — P1 — established — fixed.** The ORCID-linked widening accepted labels such as `Profile` and several whitespace-joined people as one author. It is now restricted to the observed two-word shape and rejects control labels. Red test: `a link around a name is read only when it is the person's ORCID and holds the name alone`.

- **C7 — P1 — established — fixed.** A trailing `ltx_author_before` comma was accepted without a following creator, returning an incomplete author list. Separators now require creator siblings on both sides. Red test: `a comma is accepted only between two creators`.

- **C8 — P1 — established — reported, wider/pre-existing.** Ordinary real folds have the same stale fine-grained `?at=` problem C4 fixed for front matter: folding a section while the URL names a paragraph inside it can leave that hidden ID standing, so a later restore unfolds it. This predates this change and was not widened here, so I did not fix it.

- **C9 — P2 — established — reported.** The repository cannot substantiate the claimed “0 wrong of 19 pages”: only ten page fixtures are present. In addition, `authors-2610-08392.html` says it contains only three of the real six creators, while its test describes those three as the page’s complete list. The test would pass while the other real authors were omitted.

- **C10 — P2 — established — reported.** `never puts block 0 in the run, whatever it says` is vacuous for the mutation it names: changing only the run start from block 1 to block 0 still passes because that fixture’s institution `h1` is independently rejected by the heading rule. Other tests kill the mutation, but this named test does not prove its claim.

- **C11 — P3 — established — reported.** Authoritative `?at=` prose still says ordinary scrolling always writes a section start, while this feature intentionally writes the section’s first visible block when its start is hidden. The stale wording is in [url-state.md](/var/tmp/spideryarn-worktrees/fbduh4w3-front-matter-collapse/docs/project/url-state.md:639) and [position.ts](/var/tmp/spideryarn-worktrees/fbduh4w3-front-matter-collapse/src/web/position.ts:4). I did not alter rule documentation during the review.

No additional defect was found in marginalia: hidden notes leave layout, reopening relays them out, and previously shifted notes are cleared. Store behavior across open/shut runs, real folds, the masthead echo, article-key changes, re-extraction, and unmount was otherwise consistent. Structure focus, spine behavior, restoration, and shared links remained correct after the first-visible-block rewrite.

The plan’s remaining named Title Case institution false positive remains accepted. The “0 hidden prose” figure is only a result for its measured corpus, not a future-safety guarantee; the unlisted reproducible classes found here were fixed.

Verification:

- Scoped suite: **8 files, 212 tests passed**
- Typecheck: **all 3,371 source files covered and passed**
- Biome and `git diff --check`: passed; three existing complexity notices remain informational
- Full `npm test` could not run without Postgres in this sandbox
- No commit made; unrelated concurrent documentation/screenshots were left untouched

VERDICT: ready to push
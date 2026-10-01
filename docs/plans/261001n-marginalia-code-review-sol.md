No P0 or P1 findings. The runtime rename is sound.

P2 findings:

- Fixed [command-bar.test.tsx:365](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/tests/command-bar.test.tsx:365): the previous test checked only the catalog alias. The new test proves typing “annotations” selects and opens Marginalia rather than the Comments action, which shares that alias.
- Fixed [a-broken-mode-leaves-the-article-readable.test.tsx:1538](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/tests/a-broken-mode-leaves-the-article-readable.test.tsx:1538): mounted owner and visitor coverage now includes conflicting `margin=0` parameters in both orders for both spellings.
- Fixed [marginalia-margin-param.test.ts:43](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/tests/marginalia-margin-param.test.ts:43): both spellings now explicitly prove identical server titles through `readMode` and `documentTitle`.
- Left for you, P2: [reading-view-overview.md:153](/home/greg/code/spideryarn2/.claude/worktrees/fb8e-interface-vision-and-marginalia/docs/project/reading-view-overview.md:153) says the latest press always wins below 900px. Below 612px Marginalia cannot fit alone, so its press leaves the band open and the notes hidden. I did not edit this governing entry-point doc because repo policy requires approval of its exact before/after wording. Suggested replacement: “where both do not fit but Marginalia fits alone (612–899px with the rail), whichever was pressed last wins; below 612px the notes remain hidden.”

The other named docs are accurate. No reader-facing “Annotations” remains except intentional history/compatibility text and historical changelog entries. Unrelated annotation concepts—`annotate.ts`, `annotations.css`, OpenRouter citations, and MathML—remain untouched. The visitor arrival test is adequate: its pressed Dock toggle witnesses Reader state when that visitor fixture has no drawable marginalia, while separate visitor coverage proves the column renders from public data.

Verification:

- Direct execution of the complete typecheck script: passed, all 2,557 source files covered.
- Targeted post-fix Vitest: 3 files, 149 tests passed.
- Full affected suite: 24 files and 658 tests passed. One additional test could not run because the sandbox denied its child `git` process with `spawnSync git EPERM`; its CSS-import assertion was manually checked and found only the permitted `./tailwind.css` import.
- Biome on edited files and `git diff --check`: passed.
- The literal audit found `"annotations"` comparisons only inside `isMarginaliaModeWord`; the remaining occurrences are aliases or intentional historical references.

Verdict: land after fixes
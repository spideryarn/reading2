- **C-1 — P1 — unresolved:** A DOI’s own hyphen can still be silently removed. [`numberedEntries`](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citation-reference-list.ts:141) calls [`dehyphenate`](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citation-reference-list.ts:179), making both `j.neu-\nron` interpretations become `j.neuron`. By the time [`entryIdentifiers`](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citations.ts:723) runs, the evidence is gone. The existing test at [`citations.test.ts:953`](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/tests/citations.test.ts:953) therefore cannot distinguish a typesetter-added hyphen from the DOI’s own hyphen. I could not fix this within the three-file boundary; the splitter must preserve line-break provenance or extract identifiers before dehyphenation.

- **C-2 — P1 — fixed:** The parser invented DOI continuations after `-`, `/`, or `_`, and accepted a truncated DOI before an uppercase continuation. For example, `10.1234/article- PMID` became `10.1234/article-PMID`, while `10.1234/ABC DEF` became `10.1234/ABC`. [`entryIdentifiers`](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citations.ts:731) now treats these as unreadable and keeps Scholar search. Regression coverage is at [`citations.test.ts:947`](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/tests/citations.test.ts:947).

- **C-3 — P1 — fixed:** ID inheritance could transfer stored state between works when a DOI and search row shared a current `workKey`, when an identifier-keyed old row hid an old metadata collision, or when two works swapped DOI keys. [`idsByKey`](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citations.ts:1239) now records unique old metadata ownership, and [`inheritedBy`](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citations.ts:1436) refuses inheritance when the old identifier and metadata owners disagree. Tests cover all three cases at [`citations.test.ts:985`](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/tests/citations.test.ts:985).

Verification:

- `tests/citations.test.ts`: 59 passed.
- `tests/citation-reference-list.test.ts`: 15 passed.
- Biome lint on both changed TypeScript files: passed.
- `git diff --check`: passed.
- Typecheck source projects passed, but the tests project currently has four unrelated errors in concurrent stage-3 files (`useCitations.ts` missing paper types and `citation-investigate.test.ts` missing `readPaper`).

**Verdict: not ready. C-1 remains a P1 safety-property violation requiring a change outside the authorized three files.**
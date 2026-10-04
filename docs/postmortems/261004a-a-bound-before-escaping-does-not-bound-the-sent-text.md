# A bound before escaping does not bound the sent text

Up: [postmortems.md](../project/postmortems.md) · [plan](../plans/261004a-ask-about-a-summary-paragraph-in-chat.md)

Code review of `99a1290e469be331e50314efb7b09faba1db2cc4` caught two defects in
`askAboutSummaryParagraph` before this stage landed. There is no evidence of reader impact.
Both were reproduced with failing tests before the working-tree fix, and confirmed independently
by a root-cause subagent.

The formatter capped the original paragraph at 2,000 UTF-16 units, then escaped runs of quotation
marks by adding zero-width non-joiners. Two thousand quotation marks became 3,999 units of escaped
content and a **4,077-unit draft**, above Chat's 4,000-unit limit even without a question.
The same cut split 😀 after 1,999 ASCII characters, retaining a lone high surrogate.

The classes are **a bound applied before an expanding transform** and **a text cut through a
UTF-16 surrogate pair**. The author was correctly trying to leave room for the reader's question
and prevent a paragraph from closing its quotation fence; the ordering defeated the size guard.

The original tests checked quote escaping and ASCII truncation separately. All 54 requested tests
passed over both defects. They never measured the escaped draft at the boundary or put a
supplementary character across the cut.

The narrow, lasting fix escapes first and caps the escaped content, dropping a trailing high
surrogate when truncating. The ellipsis stays visible, the paragraph cannot introduce a triple-quote
delimiter, and short paragraphs are preserved. The three requested files then passed all 57 tests.

Countermeasures, ranked by cost against value:

1. **Measure the final formatted payload with an input that expands during escaping.** Done in
   `tests/chat-handoff.test.ts`, including room for a 1,900-unit question. It failed on the candidate.
2. **Place a supplementary character across, and exactly inside, the cut boundary.** Done in the
   same file; the across-boundary case failed on the candidate.
3. **Add a shared grapheme-aware truncation system.** Rejected for this stage: keeping surrogate
   pairs whole meets the defect with a local change. Grapheme preservation is a separate choice;
   combining marks and joined emoji can still be cut between code points.

This review fixes the summary formatter only. The nearby `askAboutBlock` still cuts a surrogate
pair at its 60-unit boundary: 59 ASCII characters followed by 😀 reproduce it. That cut was added
in `a16b5ea8f3bcedda2de14c52fb9a2dc95a5ff958`, and is reported without a fix because it is outside
this stage. The evidence here does not claim that every text cut in the application is now
Unicode-safe.

Verdict: **land after fixes (made)**

### Findings

- **R1 — P3 — fixed — [docs/project/comments.md:885](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/project/comments.md:885)**  
  The signpost claimed every coloured selection comment appears in Quotes, contradicting Q8: Referee placements with `criterionId` are excluded. I added that exception.  
  Test: `quote-band-rows.test.ts` → “takes a selection with a colour, and nothing else”.

No P0–P2 findings and no unresolved wider findings.

### Q1–Q8

- **Q1:** Met. Interleaving compares blocks only; reader `start`s only order reader rows. Missing blocks, score ordering, `withYours`, and provenance—including “on or before”—are correct.
- **Q2:** Met. All `Quote[]` flows remain AI-only. Reader rows do not enter ranking, visibility, stepping, URL state, selection scrolling, or `data-quote-row`.
- **Q3:** Met. `addedAt` and `generatedAt` cross the public DTO. Existing stored Quotes already require `generatedAt`; older clients ignore the additive field, while older cached payloads without it degrade to undated provenance rather than failing.
- **Q4:** Met. Each run has one completion time. Append and inherited-ID replacement preserve both timestamps and timestamp absence. `addedAt` is not hashed, compared, or used for freshness.
- **Q5:** Met. A reader-row press synchronously clears `?quote=` and opens the comment.
- **Q6:** Met. `yours` is impossible on the visitor type, ignored even if smuggled at runtime, and derived only from owner comments.
- **Q7:** Met. Reader provenance uses `createdAt` and says “saved”; recolour time remains deliberately unrepresented.
- **Q8:** Met. Eligibility is quote + colour + no `criterionId`; note presentation and tooltip content are driven by the comment body.

Font ownership, touch/keyboard tooltip behaviour, solid colour tokens in both themes, and the Quotes documentation all match the reviewed design.

### Checks

- Requested Vitest command: **5 files, 111 tests passed**
- `node --import tsx scripts/typecheck.ts`: **passed**
- `git diff --check`: **passed**
- Full `npm test`: database setup could not connect to local Postgres/Docker, so no Postgres-backed tests ran.

Suggested Postgres follow-up: `tests/store-roundtrip.test.ts`, covering persistence/export of the quote JSON shape.

No commit was made. The pre-existing untracked review-prompt file was left untouched.
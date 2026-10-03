**P1 — blocker: The default row still exceeds the requested boundary.**  
The plan explicitly keeps an author supplied from memory and the influence bar ([plan:93](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/docs/plans/261003j-citations-say-only-what-the-bibliography-supports.md:93), [plan:108](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/docs/plans/261003j-citations-say-only-what-the-bibliography-supports.md:108)). It also misses registry enrichment: `workByLine` supplies missing authors/year from Crossref or DataCite before any reader request ([CitationsPanel.tsx:206](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/web/CitationsPanel.tsx:206)). Disclosure does not make these bibliography-supported.

I would hide influence and registry-supplied metadata on default surfaces, and omit extracted metadata that cannot be grounded in the work’s verified entry or mention. Keep the raw entry visible. Do not defer the known Sutton exception while claiming this request is complete; conservative omission is simpler than adding fuzzy matching.

**P2 — should-fix: A running answer can need `why` before the proposed predicate allows it.**  
A no-match quick check does not stop the investigation ([citation-investigate.ts:890](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/citation-investigate.ts:890)). Streaming text is drawn immediately, but `work.investigation` is populated only after `done` ([useCitations.ts:524](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/web/useCitations.ts:524), [CitationInvestigation.tsx:521](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/web/CitationInvestigation.tsx:521)). Thus an arriving “does it back the claim?” answer can have neither an assessed lookup nor a kept investigation, leaving its claim missing.

Conversely, a retry can retain a stored investigation while the rendered view replaces its answer with progress ([CitationInvestigation.tsx:353](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/web/CitationInvestigation.tsx:353)).

I would base the band’s rule on what is displayed: an assessed lookup, an arriving answer, a kept answer, or a failed run’s displayed previous answer. Add tests for these cases, especially streaming after no-match.

**P3 — should-fix: The hover card cannot safely use the same stored-state predicate.**  
`CiteCardReading` displays only an assessed lookup; it never displays an investigation ([ProseHoverCard.tsx:2028](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/web/ProseHoverCard.tsx:2028)). With a kept investigation and an unassessed or absent lookup, the proposed shared rule shows `why` without the answer that justified revealing it.

The simplest fix is to show `why` on the hover card only beside its assessed lookup. Let the band reveal it beside investigation answers.

**P4 — should-fix: “One row in 194 with an author from memory” is stronger than the measurement supports.**  
The script pools words from the **whole article**, then adds the entry, and checks tokens independently ([citations-say-less.ts:70](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/evals/citations-say-less.ts:70), [citations-say-less.ts:115](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/evals/citations-say-less.ts:115)). It cannot establish that an author, year or title belongs to this work. A wrong author appearing elsewhere passes; rearranged title words pass; an unrelated publication year passes.

I exercised `measureRow` with a Smith (1999) reference incorrectly attributed to Jones (2020). Because Jones and 2020 appeared elsewhere, both checks passed.

Report this as **one manually identified unsupported author**, not an exhaustive rate established by the script. Save the manual evidence and distinguish lexical flags from attribution checks. Likewise, the novelty pool includes reference blocks, not just citing paragraphs ([citations-say-less.ts:65](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/evals/citations-say-less.ts:65)).

**P5 — should-fix: The eval can report an empty corpus after failed reads, and does not measure “after.”**  
Every `loadCitations` exception is swallowed ([citations-say-less.ts:105](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/evals/citations-say-less.ts:105)). My database rerun was blocked by sandbox networking; all five reads failed, yet the script exited successfully with “no stored citations list.”

Also, the script counts stored `why` words; it does not render rows, apply the proposed predicate, or account for thresholds and attachments. The plan’s “measured after: 0 words” is a proposed rendering invariant, not this script’s result ([plan:78](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/docs/plans/261003j-citations-say-only-what-the-bibliography-supports.md:78)).

Catch only expected missing-list errors, fail on read failures, and retain the baseline output. Describe the after claim as verified by rendering tests once those pass. I could not independently reproduce the 194-row totals.

**P6 — note: Preserve dynamic provenance; avoid unconditional “not read” wording.**  
The plan says the not-read sentence stays on every row/card ([plan:63](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/docs/plans/261003j-citations-say-only-what-the-bibliography-supports.md:63)), but `readNoteOf` correctly changes it after assessment or reading the PDF ([CitationsPanel.tsx:555](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/web/CitationsPanel.tsx:555)). Keep that function unconditional while hiding only `why`. The entry caption’s existing “We have not looked the work up” also becomes false after lookup ([CitationsPanel.tsx:291](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/web/CitationsPanel.tsx:291)); retain its attribution clause and remove that absolute statement.

**P7 — note: Keeping stored `why` is appropriate for this first version; the surface search is complete.**  
The quick-check and investigation fingerprints include `why` ([citation-lookup.ts:162](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/citation-lookup.ts:162), [citation-investigate-context.ts:177](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/citation-investigate-context.ts:177)). Keeping it avoids unnecessary prompt changes and invalidating answers. Existing fingerprint checks exclude stale attachments; failed runs with a surviving previous answer remain legitimate reasons to display the claim.

I found no additional direct citation-`why` renderer beyond the band, prose card and Marginalia. Chat also receives it as “used for,” which the plan explicitly retains ([chat-tools.ts:1508](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/chat-tools.ts:1508)). Dropping it from Marginalia and substituting the entry is sound.

VERDICT: build after fixes
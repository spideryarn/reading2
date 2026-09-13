## Verdict: rethink

The removal itself is sound, but two established P1 transition problems mean the plan should not be built as written.

### F1 — P1: Quotes “Find more” has a non-checkbox profile dependency

Evidence:

- `HEAD:src/web/QuotesPanel.tsx:632-645` deliberately calls `regenerate(owner.profiled)`. This is not checkbox state: it makes a continuation use the existing list’s profile setting.
- [src/quotes.ts:931](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/quotes.ts:931) appends even across profile differences.
- [src/quotes.ts:1080](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/quotes.ts:1080) retains the first pass’s `profileHash`.
- `tests/quotes-find-more-panel.test.tsx:133-143` explicitly pins the recorded-profile call.
- `docs/project/quotes.md:577-590` makes this an authoritative contract.

Removing `useQuotes.regenerate(useProfile)` means Find more on a plain list appends newly profiled quotes but keeps `profileHash: null`. The resulting mixed list shows no profile badge, contradicting the plan’s claim that it becomes “written for you.”

Change: retain this narrow, non-UI `useProfile` path so Quotes Find more continues with `owner.profiled`, and add the missing plain-list/`false` regression case. If every new pass must strictly use the current profile, Quotes needs a different server/UI transition—replacement with an honest label or explicit mixed provenance—not the proposed client-only deletion.

### F2 — P1: Glossary rewrites, but does not preserve every link

Evidence:

- [src/glossary.ts:450](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/glossary.ts:450) refuses append on a profile-hash mismatch.
- [src/glossary.ts:1332](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/glossary.ts:1332) consequently enters the rewrite path.
- [src/glossary.ts:507](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/glossary.ts:507) inherits an old ID only when a newly returned name or alias matches it.
- [src/glossary.ts:764](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/glossary.ts:764) retains no old entries during a rewrite; the output is the fresh model result.

Therefore, “rewrites rather than appends” is accurate, but “the reader keeps their `?term=` links” is not. Matching terms keep their IDs; terms omitted by the profiled rewrite disappear, taking their usable links and displayed saved lookups with them. A button still labelled “Find more” can silently replace the list.

Change: decide the legacy-plain-list transition explicitly. Either preserve its recorded profile setting for Find more, or present the profiled operation as “Find them again” and disclose replacement. Amend the link claim to “links for terms returned again retain their IDs.”

### F3 — P2: The labelled profile button preserves the rows that were meant to disappear

Evidence:

- [src/web/styles/profile.css:541](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/web/styles/profile.css:541) gives the glossary profile row a full line.
- [src/web/styles/profile.css:549](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/web/styles/profile.css:549) does the same in Chat.
- [src/web/styles/mode-band.css:771](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/web/styles/mode-band.css:771) keeps it after Remember’s already-tight control row.
- [src/web/CommandBar.tsx:327](/home/greg/code/spideryarn2/.claude/worktrees/fb3b-drop-use-profile-checkbox/src/web/CommandBar.tsx:327) now provides a Profile route—an access path added after the 260830c rationale cited by the plan.

Thus Chat and Remember remain vertically the same size, and the glossary foot still spends a whole row on “Your profile.” The no-profile state is literally unchanged.

Change: do not retain `ProfileButton` universally. Remove it from Chat/Remember and current-list footers; keep `WrittenForYou` as the contextual panel trigger after generation, with Commands → Profile and Metadata as the editing paths. If it must remain before generation, integrate it into the action row and remove the full-width `.prof-row` rules.

### F4 — P2: The automatic-state plumbing is omitted from cleanup

The `automatic` fields in `UseGlossary`, `UseIdeas`, `UseQuotes`, and `UseSketch` exist to feed `<UseProfile automatic>`. Once that sentence disappears, their interface fields and `auto && …` calculations become unused, but the plan names only `hasProfile` and `withProfile` for removal.

Change: include those four `automatic` fields/calculations and their comments/tests in the inventory. Update `docs/project/ideas.md:263-264`, `docs/project/quotes.md:550-551`, and the `useAutoRun` return-value commentary as applicable.

Deleting `useHasProfile` is otherwise safe as written: its six consumers use it only for checkbox rendering. The generic server API and `sameWork` behavior should remain; Candidates’ two intentional `useProfile: false` calls are the only other production client exception I found.

Reviewed against candidate HEAD `c222c9a4`; I changed no files. Shared-worktree implementation edits appeared during the review and were excluded from the assessment.
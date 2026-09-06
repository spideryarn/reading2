Refuse as written: F1–F4 are established P1s. No P0 findings.

## Findings

**F1 — P1 — established: the policy changes “most” documents into “everything else.”**

(a) Greg’s authoritative quote says “most of the rest” is agent-facing. The next paragraph says **“Everything else”**, and the unqualified “What a doc holds” rule says to delete mechanism explanations. That contradicts both the quote and [write-tutorial.md](/home/greg/code/spideryarn2/docs/reusable/write-tutorial.md:25), and would also misclassify human-facing documents such as `CONTRIBUTING.md`.

(b) Replace lines 16–30 of [documentation-policy.md](/home/greg/code/spideryarn2/docs/reusable/documentation-policy.md:16) with:

```md
`README.md` and tutorials are the main human-facing docs, and may explain a mechanism at length.
Most internal reference docs are written for an agent that can read the code: point it to the
implementation rather than paraphrasing it. Other reader-facing documents — such as a contributor
guide — follow their reader, not their filename.

## What an agent-facing reference doc holds

**Intent and signposts. Not descriptions of code, which the code already provides.**

...

The test for a paragraph in an agent-facing reference doc is: ...
```

**F2 — P1 — established: “every doc” contradicts the repository’s dated-collection contract.**

(a) [documentation-policy.md](/home/greg/code/spideryarn2/docs/reusable/documentation-policy.md:67) tells every new doc to add a line to an entry point. `AGENTS.md` explicitly says individual plans, research notes, postmortems and tutorials are not indexed there. In another repo, the rule also assumes Spideryarn’s entry-point architecture, making the reusable policy less portable.

(b) Replace the first two bullets under “Keep it navigable” with:

```md
- **Every evergreen reference or reusable doc is reachable from one deliberate parent or index.**
  Dated collections — plans, research, postmortems and tutorials — may instead be owned at directory
  level without listing every item. Follow the repository's own indexing convention.
- **A doc may be linked from many places.** That is fine — one owner, many links.
```

**F3 — P1 — established: several facts from the old counting doc lost their only home.**

(a) The old document recorded the evidence behind the design: 261 misattributed symlink lines, seven omitted text files/400 lines, 14 binaries, an 8,629-line lockfile and 48 Drizzle snapshots. None survives in the new pair. These are historical measurements, not current configuration, but the stated invariant says a fact with one home must not disappear; the new policy itself says to retain numbers as dated examples.

(b) Add this to [counting-lines.md](/home/greg/code/spideryarn2/docs/project/counting-lines.md:30):

```md
**Evidence from the 2026-08-27 investigation:** cloc assigned the 261-line `AGENTS.md` target to its
`CLAUDE.md` symlink; it omitted seven unrecognised text files and 400 lines; and the report named 14
binary files. The 8,629-line lockfile and 48 Drizzle snapshots were the concrete reason for keeping
generated material out of the hand-written headline. These are dated observations, not current
counts.
```

**F4 — P1 — established: the remaining symlink fact now has two homes.**

(a) [count-lines-in-a-repo.md](/home/greg/code/spideryarn2/docs/reusable/count-lines-in-a-repo.md:54) and [counting-lines.md](/home/greg/code/spideryarn2/docs/project/counting-lines.md:29) both say `CLAUDE.md → AGENTS.md` was the instance that found the trap. This directly violates `AGENTS.md`’s “Give a fact one home” rule.

(b) Keep the project fact in the stub and delete this reusable parenthetical:

```md
(`CLAUDE.md` → `AGENTS.md` is the instance that found this.)
```

**F5 — P2 — established: the arithmetic “self-check” is true by construction.**

(a) The implementation defines `skipped` as every input absent from `counted` ([count-lines.ts](/home/greg/code/spideryarn2/scripts/count-lines.ts:383)). A read failure or file disappearing between `git ls-files` and `readFileSync` therefore becomes “binary”; `counted + skipped == input` still passes. The reusable note presents that identity as an independent check capable of detecting omission.

(b) Replace lines 66–73 of the reusable note with:

```md
**Finally, account for every uncounted file by name.** A plain-text fallback can rescue unrecognised
extensions. What remains must be classified as a verified binary or a named read failure. Do not
define the binary list as “everything not counted”: that makes the final file-count identity true
by construction.
```

The project stub should then acknowledge that the current script does not yet distinguish those cases.

**F6 — P2 — established: the second `AGENTS.md` edit is not purely signposting.**

(a) Repointing `claude-in-chrome.md` is signposting only. Saying the new policy is the portable authority and that the existing rules “sit on top of it” establishes precedence; under [edit-important-docs.md](/home/greg/code/spideryarn2/docs/reusable/edit-important-docs.md:29), that changes what an agent is told to do. Greg explicitly requested the policy, so this is not clearly unauthorized, but it is not merely a pointer.

(b) A genuinely signposting-only version is:

```md
A portable counterpart to these conventions is
[documentation-policy.md](docs/reusable/documentation-policy.md), including its audience guidance.
```

**F7 — P3 — established: the policy opens with an unchecked superlative.**

(a) “Confusing them is the commonest way a docs tree goes bad” has no inventory, source, date or confidence, despite the policy’s own rule against unsupported generalizations.

(b) Replace it with:

```md
Two audiences, and they need different documents.
```

## Answers to the stated doubts

- The counting split earns its keep. The reusable half contains enough independent design to justify a document; the problems are evidence placement and the circular fourth check, not the split itself.
- At 1,050 words, the policy is longer than “brief.” I would fold “Quote the human” and “Less is more” into “What an agent-facing reference doc holds,” and remove project-specific open-question and auto-memory instructions from “Keeping it true.” The core policy should remain.
- `claude-in-chrome.md` does not need a same-name stub. `browser-control.md` already serves as the project-side routing document.
- I found no other obviously reusable project doc that could move with only minimal edits. `debugging.md`, `performance.md`, typechecking, linting and static analysis contain reusable lessons, but their value depends on project-specific evidence and commands.

## Verification

`tests/doc-links.test.ts` currently reports 13/14 passing. All ownership and anchor checks passed; the sole failure is the out-of-scope plan linking to this not-yet-created review answer. The candidate paths introduced no reported broken link.

The counting script could not execute in this sandbox because its internal `git` subprocess received `EPERM`; its relevant logic was inspected directly. No files were changed.
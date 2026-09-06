# Make some docs reusable, and write a documentation policy

**Status: done, 2026-09-06.** Docs only, no code. Reviewed by GPT Sol —
[review](260906e-make-some-docs-reusable-and-write-a-documentation-policy-review-sol.md).

Greg, 2026-09-06:

> Look at the docs in `docs/project/` and consider whether any of them might be minimally tweaked to
> be reusable (i.e. usable & valuable in other repos). If so, make the minimal update and move to
> `docs/reusable/` … It would be acceptable if a doc/instruction is almost entirely reusable, but
> requires a tiny bit of project-specific configuration/overrides/specificity to move the main doc to
> `docs/reusable/` with the override-stub in `docs/project/` with appropriate signposting. Oh, and if
> we don't already have a `docs/reusable/documentation-policy.md` or similar, we should write a brief
> one (e.g. single source of truth, docs should consist primarily of signposts and documenting
> user-intent with quotes or near-quotes, etc etc). Human-readable docs are mainly `README.md` and
> `docs/tutorials/` — most of the rest is aimed at agents, who are happy to read code, and should be
> directed to that rather than provided with detailed descriptions of how things work that can get
> out of date.

## How the 85 docs were triaged

Every `docs/project/*.md` was scored by the density of project-specific terms it carries
(`spideryarn`, `reader`, `article`, `block-id`, `granularit`, `supabase`, `vercel`, `src/web`,
`src/store`, `src/db`, `hetzner`, `drizzle`, `openrouter`, `/read/`, `reading-view`), then the low
scorers were read. The command is recorded rather than the table, because the table is a fact about
one morning:

```bash
for f in docs/project/*.md; do
  n=$(wc -l < "$f"); h=$(grep -oiE '<the terms above>' "$f" | wc -l)
  printf "%-38s %6d %7d %7.2f\n" "$(basename $f)" "$n" "$h" "$(echo "scale=2; $h/$n" | bc)"
done | sort -k4 -n
```

Two docs came out clearly, and both were moved.

## What moved

**`claude-in-chrome.md` → `docs/reusable/`, whole.** It is about getting the Claude-in-Chrome
extension to talk to Claude Code — the diagnosis order, the wrong-Chrome-profile cause, the three
things not worth checking first. Zero hits on the density grep: not one sentence in it is about this
product. The only edits were to make it stand up in a repo that has no `browser-testing.md`, and to
repoint its links.

**No stub was left behind**, because [browser-control.md](../project/browser-control.md) already is
the project-side "which browser automation on which machine" fork and now links to the reusable
copy. Its `AGENTS.md` `↳` entry became a markdown link rather than a backticked name, which is what
takes it out of `tests/doc-links.test.ts`'s ownership set without deleting the signpost.

**`counting-lines.md` split.** The reusable half is
[count-lines-in-a-repo.md](../reusable/count-lines-in-a-repo.md): take the file list from
`git ls-files` rather than a hand-kept exclude list that is a second copy of `.gitignore`; categorise
by what a file is *for* rather than what language it is in; and the four ways cloc goes quiet
(symlink de-duplication dropping the real file, unrecognised extensions omitted rather than zeroed,
binaries with no lines, and the self-checking arithmetic that catches the rest). None of that is
about Spideryarn and all of it will be true of the next repo that ports the script.

The project stub keeps the commands, this repo's own category quirks and `.gitignore` names, the
`CLAUDE.md`→`AGENTS.md` symlink that found the de-duplication trap, and the dated numbers.

## What was written

[documentation-policy.md](../reusable/documentation-policy.md) — the general version of
`AGENTS.md` § *How we write docs here*, which now signposts it. Its spine is the quote above: two
audiences, and the reference tree is written for an agent that can read the code, so it should send
the reader to the code rather than paraphrase it. Then one home per fact, cite-don't-restate, quote
the human verbatim, one parent per doc, and a table of which how-to covers which kind of doc.

## The simpler options passed over, and why

- **Move nothing and only write the policy.** That was the smaller change and it loses the two docs
  that genuinely are not about this project. Rejected.
- **Move more.** `sql.md`, `typechecking.md`, `linting.md`, `static-analysis.md`, `colour-scales.md`,
  `icons.md`, `version-control.md`, `worktrees.md` and `browser-testing.md` all carry real
  transferable lessons — the gate/advisory split, "three ways to report it clean while it is red",
  Okabe–Ito on a near-black page, commit-your-own-files-by-name. Every one of them would need the
  lesson *extracted* from this repo's config and this repo's accidents, which is a rewrite rather
  than a move, and the extracted version would be weaker for losing the scar it came from. Left for
  a later pass if anyone wants them.
- **Split `postmortems.md` into a reusable `write-postmortem.md`.** A real gap — there is
  `write-planning-doc.md`, `write-tutorial.md` and `write-deep-dive-as-doc.md` but no postmortem
  equivalent. Not done, because `docs/project/postmortems.md` was created by another agent five
  minutes before this work started and was still being edited. Worth doing once it lands.

## The review, and what came of it

[GPT Sol's review](260906e-make-some-docs-reusable-and-write-a-documentation-policy-review-sol.md)
refused as written on four established P1s. All seven findings were checked and all seven applied.

| ID | Finding | Disposition |
|----|---------|-------------|
| F1 | The policy turned Greg's "most of the rest" into "**everything** else", which misclassifies `CONTRIBUTING.md` and contradicts `write-tutorial.md` | fixed — "most of the rest", plus a *classify by reader, not by directory* paragraph |
| F2 | "Every doc has exactly one parent" contradicts the dated collections, which are owned per directory and not indexed item by item — and bakes this repo's entry-point architecture into a portable doc | fixed — "every **evergreen** doc", with the dated collections named as the exception |
| F3 | Numbers from the old `counting-lines.md` (261 symlinked lines, seven unrecognised files/400 lines, 14 binaries, the lockfile and the 48 snapshots) survived in neither half | fixed — restored to the project stub as dated observations |
| F4 | The `CLAUDE.md`→`AGENTS.md` symlink instance ended up in both halves | fixed — kept in the stub, deleted from the reusable note |
| F5 | **The arithmetic self-check is true by construction.** `skipped` is defined as every listed file not in `counted`, so the identity cannot fail on an omission — an unreadable or vanished file is silently reclassified as binary | fixed, and verified in the source: `scripts/count-lines.ts` § `gather`, and `other` in `CATEGORIES` matches everything so `total.files === counted.length` always. It catches double-counting and nothing else. Both docs now say so, and the reusable note says to test each uncounted file rather than subtract |
| F6 | The `AGENTS.md` addition said the new policy is the portable authority and the house rules "sit on top of it", which establishes precedence rather than merely signposting | fixed — reworded to Sol's neutral version |
| F7 | "the commonest way a docs tree goes bad" is an unchecked superlative, which the policy's own rules forbid | fixed — "Two audiences, and they need different documents" |

Sol also judged the policy long for "brief" at ~1,050 words. Two bullets were folded rather than
whole sections cut: the substance Greg listed is all load-bearing, and the audience section is the
half he asked for most explicitly.

F5 is the finding that justifies the round. It is the house failure pattern
([silent-success.md](../reusable/silent-success.md)) inside a paragraph written to warn about the
house failure pattern, and it would have shipped as advice to copy.

## What is left, and it needs Greg

**`AGENTS.md` § *How we write docs here* now says several things twice.** Six of its ten bullets —
less is more, cite don't restate, quote Greg verbatim, every doc has a parent, kebab-case file names,
update the docs as you go, harness memory is not where knowledge lives — are the general rule, and
the general rule now has a home in `docs/reusable/documentation-policy.md`. By that file's own
one-home-per-fact rule, those bullets should shrink to a pointer plus the four that are genuinely
house-specific (the `↳` ownership convention and its test, Greg's own words as the source of intent,
where decided open questions go, and the approval rule for rule-docs).

Not done here, because `AGENTS.md` is the most load-bearing doc in the repo and
[edit-important-docs.md](../reusable/edit-important-docs.md) says a rule-doc changes one approved set
at a time with the before and after shown. This one is a proposal for Greg, not a signpost tweak.

## See also

- [documentation-policy.md](../reusable/documentation-policy.md) · [README.md](../reusable/README.md)
- [edit-important-docs.md](../reusable/edit-important-docs.md) — why the `AGENTS.md` edits here were
  limited to signposting.

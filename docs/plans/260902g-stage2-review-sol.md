Verdict: **not quite fine to commit**. The functional direction is correct and the focused tests pass, but the temporary Git repositories still depend on ambient Git state—the exact class this stage is meant to eliminate.

## Findings

1. **High — the temporary repositories are not hermetic.**

   The Git helper inherits the complete process environment and ignores command failures ([tests/statusline.test.ts:199](/Users/greg/dev/spideryarn/reading2/tests/statusline.test.ts:199)). Consequently:

   - `commit.gpgSign` can make the empty commit require signing.
   - `core.hooksPath` or `init.templateDir` can run developer-specific hooks.
   - `core.abbrev` can make the valid short SHA fewer than the seven characters required at [line 230](/Users/greg/dev/spideryarn/reading2/tests/statusline.test.ts:230).
   - Inherited `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_CONFIG_COUNT`, etc. can redirect commands away from the temporary repository. In the worst case, the test’s `git config` and empty commit could touch another checkout.
   - `renderIn` likewise lets the heredoc’s Git commands inherit those variables ([tests/statusline.test.ts:218](/Users/greg/dev/spideryarn/reading2/tests/statusline.test.ts:218)).

   `git init -b slate` removes only `init.defaultBranch`; the comment that “the environment is no longer allowed a say” is currently false ([tests/statusline.test.ts:194](/Users/greg/dev/spideryarn/reading2/tests/statusline.test.ts:194)).

   Before committing, build one sanitized environment for both the setup Git commands and `renderIn`: remove inherited `GIT_*`, `BASH_ENV`, and `ENV`; disable system/global Git config; and make the Git helper throw on every non-zero status. An explicit empty template directory would also neutralize `init.templateDir`.

   Locale does not materially affect these assertions: branch names and SHAs are ASCII, while `⑂` is read and written as UTF-8 bytes. Bash does not transcode it.

2. **Medium — the doc-link policy has no positive control, and above-repository links remain machine-dependent.**

   You are right that `l.file` is the normalized, resolved repo-relative target ([tests/doc-links.test.ts:145](/Users/greg/dev/spideryarn/reading2/tests/doc-links.test.ts:145)). The new predicate itself behaves correctly for the intended roots:

   - `../../output/x` → `output/x`: rejected.
   - `../../data/x#anchor` → `data/x`: rejected.
   - `../../data` → `data`: rejected.
   - `../../tests/fixtures/data-root/data/x` → root `tests`: allowed.
   - Forward-slash Markdown paths normalize correctly under both POSIX and Windows before splitting on `path.sep`.

   However, `../../../x` resolves to `../x`; its first segment is `..`, so [the root check](/Users/greg/dev/spideryarn/reading2/tests/doc-links.test.ts:233) does not reject it. If that external file happens to exist on one laptop, the existence test passes there and fails in a clean checkout—the same evidence-outside-the-commit class. There are no current examples, but the hole is real. Add a separate assertion banning resolved relative targets equal to `..` or beginning with `..${path.sep}`.

   Absolute `/...` and `</...>` targets are deliberately excluded before the rule. Thus `/data/x` is not banned, but under the file’s stated semantics it is not considered a repository link. Windows drive-letter absolute paths are not recognized by that existing filter, though they will generally fail the file-existence check instead of passing silently.

   The policy assertion also has no committed positive fixture: an empty `IGNORED_DATA_ROOTS`, using `l.from`, or another classifier regression could remain green. The general `allLinks.length` guard only proves that links were found. Given the project’s silent-success standard, factor the classifier into a helper and add the five cases above as a small table test.

3. **Low — two comments overclaim or misstate the history.**

   - `../../output/foo.html` plainly already contains an `output/` segment. The old predicate missed it because it matched only `data`, not because resolution was required to discover the name ([tests/doc-links.test.ts:223](/Users/greg/dev/spideryarn/reading2/tests/doc-links.test.ts:223)). Resolution is required to distinguish a top-level runtime root from nested tracked `.../data/...`.
   - The statusline defect did not originate the practice of forcing the test gate. That practice already existed because the gate omitted `output/`, as recorded at [deployment.md:196](/Users/greg/dev/spideryarn/reading2/docs/project/deployment.md:196); the statusline test landed later. It perpetuated the permanently-red gate after the corpus fix. “It is why people deployed with `--force-gate=test`” at [tests/statusline.test.ts:187](/Users/greg/dev/spideryarn/reading2/tests/statusline.test.ts:187) should be narrowed accordingly.

## Requested confirmations

The predicate replacement is correct:

- The old `/data/` raw-target regex missed every `output` link.
- It would wrongly reject any legitimate link containing `tests/fixtures/data-root/data/...`.
- Its only limited advantage was independence from the resolver and catching any textual `data/` segment, but that behavior was overbroad relative to the anchored [.gitignore roots](/Users/greg/dev/spideryarn/reading2/.gitignore:10). There is no material reason to retain it.

The mutation claim for the statusline output assertions holds:

- `short-sha-only` reddens `(slate`.
- `abbrev-ref` reddens both the expected SHA and the explicit absence of `(HEAD`.
- “never suffix” reddens the linked-worktree assertion.
- “always suffix” reddens the main-checkout absence assertion.

`toContain("(slate")` is meaningful: the dirty marker is appended after the branch inside the parentheses ([provision.sh:623](/Users/greg/dev/spideryarn/reading2/infra/hetzner/provision.sh:623)), and the worktree suffix is a separate later segment ([provision.sh:672](/Users/greg/dev/spideryarn/reading2/infra/hetzner/provision.sh:672)).

`not.toContain("(HEAD")` is not logically tautological—the output could contain both forms—but it is redundant against the four reported mutants because the preceding SHA assertion already kills the abbrev-ref mutant. I would keep it as a clear negative contract.

The SHA-format assertion has no heredoc mutant that reddens it; it is a fixture-setup guard. So the literal claim that *every assertion* is covered by those four mutants is false, though every behavioral output assertion is covered.

Focused verification: `tests/statusline.test.ts` and `tests/doc-links.test.ts` passed, 32/32. No files were changed.
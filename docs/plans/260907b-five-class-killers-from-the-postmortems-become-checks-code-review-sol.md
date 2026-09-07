Verdict: changes requested. Stages 1 and 4 are behaviorally sound, but Stage 5 is not yet safe enough for a shared gate, and Stages 2 and 3 each have a hole in the invariant they claim to enforce.

## Findings

1. **High — shortened Git conflict markers pass unnoticed.**  
   Both patterns require seven characters at [scripts/conflict-markers.ts:93](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/scripts/conflict-markers.ts:93). `conflict-marker-size` is configurable downward, as the existing documentation already says at [database.md:646](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/docs/project/database.md:646). A four- or six-character opener/closer therefore passes, including on the final unterminated line. The test covers only larger markers at [conflict-markers.test.ts:38](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/tests/conflict-markers.test.ts:38). The comments’ “because configurable” justification is backwards: the implementation handles only upward customization.

2. **High — Stage 5 does false-positive on legitimate fenced/captured content.**  
   A standard Markdown fence containing a column-zero `<<<<<<< HEAD` is reported. The supposed fence test at [conflict-markers.test.ts:92](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/tests/conflict-markers.test.ts:92) actually tests a four-space-indented line, not fenced content. If that Markdown file also contains a setext `=======` underline, [conflict-markers.ts:117](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/scripts/conflict-markers.ts:117) reports the legitimate underline as another marker once the fenced opener has triggered the file.

   The same applies to captured model output, template literals, or HTML/text payloads containing a column-zero closer or diff3 marker. Patch/diff context is normally safe because each content line has a prefix; base64 itself cannot contain `<`, `>`, or `|` and has at most two padding `=` characters. Minified JS and SVG are ordinarily safe, but embedded textual payloads are not.

   There are no such matches today: I independently scanned all 3,948 tracked paths, including 660 `evals/` paths, six `.diff`s, 21 SVGs and 63 HTML files, and found zero anchored candidates. That establishes current green, not future false-positive safety.

3. **Medium — binary detection is conventional, but does not close the claimed risk.**  
   The 8,000-byte window at [conflict-markers.ts:123](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/scripts/conflict-markers.ts:123) matches Git’s conventional first-bytes heuristic. It is not reliable binary identification. Two current PDFs—`evals/pdf/much-harder/source.pdf` and `evals/pdf/titles/copernicus-ball-lightning-title/source.pdf`—contain no NUL in that window and are scanned as text. A legitimate binary with an ASCII prefix can therefore trip the gate. Also, the entire file is read before the 8 KB check, so the heuristic saves no I/O.

4. **Medium — `scanRepository` silently treats every read failure as “nothing to inspect.”**  
   The broad catch at [conflict-markers.ts:148](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/scripts/conflict-markers.ts:148) does avoid crashing on a submodule directory or broken symlink. It also silently skips permission failures and other unexpected I/O errors, contradicting “every tracked file.” A tracked symlink is followed rather than scanning the link blob; the current `CLAUDE.md` symlink would duplicate an `AGENTS.md` finding. Expected non-regular paths should be distinguished from an unreadable ordinary file.

5. **High — Stage 2’s “every map entry is driven” test is another hand-copied list.**  
   The exact-name assertion at [billing-portal-setup.test.ts:1011](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/tests/billing-portal-setup.test.ts:1011) and the entries exercised at [billing-portal-setup.test.ts:1029](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/tests/billing-portal-setup.test.ts:1029) are two separate lists. When Stripe adds a sixth typed feature, an author can:

   - add `new_feature: () => []` to `FEATURE_DRIFT`;
   - add its name to the first expected array;
   - omit it from `it.each`.

   Typechecking and this suite then pass while the load-bearing map entry compares nothing—the exact silent-success class the test says it prevents. The driven cases need to be derived from `FEATURE_DRIFT`; the separate explicit list can remain as the independent name census.

6. **Medium — Stage 3’s claim is broader than its scanner.**  
   The source filter at [the-sanitiser-has-one-policy.test.ts:113](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/tests/the-sanitiser-has-one-policy.test.ts:113) excludes 26 tracked `.mts` and six `.mjs` files in the named roots. More importantly, scanning one line at a time means the ostensibly whitespace-tolerant expression at [the-sanitiser-has-one-policy.test.ts:65](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/tests/the-sanitiser-has-one-policy.test.ts:65) misses this valid direct call:

   ```ts
   purify.addHook
   ("afterSanitizeAttributes", handler)
   ```

   Optional-call and bracket spellings also pass. There are no present-day false positives: the only matching production lines are the two in `src/sanitize-policy.ts`. A cheap improvement is still possible without an AST: scan whole-file text and cover the repository’s actual JS/TS module extensions. Otherwise the comments should explicitly promise only the single-line direct-dot spelling.

## The stages that are correct

- **Stage 4:** The behavior delta is empty. All four refusal strings are byte-for-byte preserved, and the hierarchy reason remains after the existing tree-invariant reasons at [pg-revisions.ts:1635](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/store/pg-revisions.ts:1635) and [pg-revisions.ts:1674](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/store/pg-revisions.ts:1674). The current implementation no longer uses `hierarchyRun?.inputHash`; the `different-blocks` result carries mandatory `ranAgainst` at [artifacts.ts:653](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/store/artifacts.ts:653). Even with the former optional chain, that arm was unreachable without a run. `pg.ts` still composes it with the outer `run?.status === "done"` short-circuit at [pg.ts:2788](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/store/pg.ts:2788), so it remains equivalent to the previous status-plus-hash behavior.

- **Stage 1:** `noteUndeclaredBlocked` is correctly placed after `reader` is computed and before any mutations irrelevant to it, at [jobs.ts:1193](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/jobs.ts:1193). There is one call in the one ordinary-failure catch path, so one warning at most. Cancellation and deadline aborts cannot fire it: the explicit `!stopped` guard prevents the call, and both `STEP_STOPPED` and `INTERRUPTED` are independently `retry` at [messages.ts:266](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/messages.ts:266) and [messages.ts:939](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/messages.ts:939). Extracting `declaredFailure` preserved `readerFailureOf`’s evaluation and fallback behavior.

- **Stage 2 ordering:** Moving inactive configuration drift to the front changes presentation order, not the assertions’ meaning. It is defensible because inactivity makes every feature unreachable. `Object.values` preserves the literal’s insertion order for these non-integer keys.

- **Stage 2 unknown values:** Every currently declared Stripe feature is an object with a boolean `enabled`, so `enabled === false` is correct for known/live shapes. For an ahead-of-SDK value that is primitive, null, or merely lacks `enabled`, the code deliberately fails closed—but the message “switched on” at [stripe-setup.ts:998](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/scripts/stripe-setup.ts:998) claims more than was observed. It should say the state cannot be established. Also, `name in FEATURE_DRIFT` at line 994 includes prototype properties; own-key membership is the actual question.

- **Stage 3 positive control:** `> 200` is sane today: the exact scanner universe contains 648 files, and losing `src` would leave only 144. It is only a non-vacuity/scope-smoke control, not proof that every named root or extension was included.

## Comment/test accuracy

- [hierarchy-currency.test.ts:19](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/tests/hierarchy-currency.test.ts:19) says the publication guard lacked the status check immediately before this work, while lines 30–34 say the two implementations had agreed since 2026-08-27. The latter is correct; the former needs an explicit historical date. Similar wording appears at [pg.ts:2552](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/store/pg.ts:2552).

- The plan says the Stage 1 belt-and-braces property is pinned in the test, but [a-blocked-step-that-named-no-way-out.test.ts:108](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/tests/a-blocked-step-that-named-no-way-out.test.ts:108) never combines an undeclared blocked error with `STEP_STOPPED` or `INTERRUPTED`. The property is true; the claimed test evidence is absent.

- Hard-coded Stage 5 measurements have already gone stale after the merge: the tree now has 3,948 tracked paths and 36 files with unanchored seven-character runs, not 3,935 and 30 as stated at [check.ts:166](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/scripts/check.ts:166) and [conflict-markers.ts:42](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/scripts/conflict-markers.ts:42). Runtime already computes the count; comments should avoid a volatile exact number.

Verification: `git diff --check` passed. The targeted run produced 90 passing assertions; only the two whole-tree tests failed because this review sandbox refuses Node’s nested `spawnSync git` with `EPERM`. The database-backed Stage 1/4 regression suites could not start because Docker/Postgres access is unavailable here. No files were changed.
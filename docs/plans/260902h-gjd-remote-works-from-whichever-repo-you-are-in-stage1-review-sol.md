REFUSE TO MERGE Stage 1. Four blockers remain.

1. **Blocker — `inventory()` ignores SSH failure.** [`scripts/gjd-remote.ts:inventory()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote.ts:733>) calls unchecked SSH; [`ssh()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote.ts:312>) then discards non-zero status and stderr. Status 255 plus valid-looking `GJDROWS 0\nGJDOK` becomes `absent`, which Stage 3 would clone. `parseInventory({ok:false})` does correctly die; truncation and malformed base64 fail closed. A genuine empty/missing `~/code` intentionally becomes `absent`.

   Concrete change: inspect the subprocess result and reject every non-zero SSH status before accepting parsed stdout.

2. **Blocker — the identity producer can poison its own metadata consumer.** [`remoteSlug()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote-repo.ts:38>) accepts segments that [`isRepoValue()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote-repo.ts:73>) rejects—colon, percent, overlong or dot-only segments. `new-*` can write that slug through [`metaFlags()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote.ts:832>), succeed, then make every later `ls` refuse. A `..` repo name also makes Stage 3’s proposed clone path escape its intended child directory.

   Concrete change: make `remoteSlug()` enforce the canonical slug grammar and defensively validate all metadata immediately before `tmux new-session`.

3. **Blocker — MCP read failures become “absent”.** [`mcpOutcome()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote.ts:2392>) uses unchecked SSH plus `cat … 2>/dev/null || true`; absent, unreadable, empty, and late SSH failure all become an MCP skip, allowing `doctor` to exit zero.

   Concrete change: use a tagged, checked read; skip only confirmed `ENOENT`, and fail empty/unreadable/transport-error cases.

4. **Blocker — the built target contract omits `doctor --dir`.** [`main()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote.ts:3074>) parses only `--repo`; [`doctorTarget()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote.ts:2362>) always resolves by origin. Stage 1 explicitly marked same-origin-verified `doctor --dir` complete.

   Concrete change: accept `--dir` and route repo-doctor through the verified target resolver.

5. **Should-fix — ambient `GJD_REMOTE_REPO` is not fail-closed outside a repo.** [`namedDir()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote.ts:888>) verifies disagreement only when local identity exists. From `/tmp`, `new-*` silently accepts the ambient redirect. Explicit `--dir` should remain arbitrary; an ambient deprecated redirect should require an identity.

6. **Should-fix — `assertSameRepo()` verifies too little.** [`assertSameRepo()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote.ts:761>) checks origin but ignores `isSymlink` and `hasHead`. Thus `push-env --dir` accepts a symlink or interrupted checkout that automatic resolution blocks.

   Concrete change: require a non-symlink checkout with matching origin and valid HEAD.

7. **Should-fix — verified `GJD_REMOTE_REPO` is wrongly recorded as `unknown`.** [`targetRepo()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote.ts:815>) throws away an identity already proved by `assertSameRepo`. Record its slug; reserve `unknown` for unverified explicit `--dir`.

8. **Should-fix — inventory parsing is not fully strict.** [`decode()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote-repo.ts:415>) accepts invalid UTF-8 via replacement characters. Cross-field contradictions such as checkout+HEAD with no realpath also parse and can resolve `found`.

   Concrete change: fatal UTF-8 decoding and semantic row invariants.

9. **Should-fix — prompt output need not be a terminal.** [`promptIo()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote-prompt.ts:86>) checks input indirectly but always uses `process.stdout`; redirected output produces an invisible prompt. Input lacking `isTTY` does refuse. Ctrl-C cleanup is sound: Inquirer closes readline before the wrapper maps the error to `Cancelled`.

   Concrete change: obtain `/dev/tty` for both streams or refuse non-TTY output.

10. **Should-fix — config commands remain display-injectable and unbounded.** [`requireCommand()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote-config.ts:131>) correctly rejects empty strings, arrays/tables, CR/LF and NUL. It accepts escaped terminal-control characters and arbitrarily long commands, despite the prior review’s bounded-string requirement.

11. **Should-fix — claimed log boundaries are not enforced.** [`formatLine()`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote-log.ts:198>) spreads the entire runtime object, so extra `prompt`/`argv` properties are serialized despite the “nowhere to put them” claim. Setup records may also contain `id`, omit repo, or contain only one of attempt/outcome.

   Concrete change: serialize an explicit allowlist and use discriminated launch/setup record shapes.

12. **Should-fix — test evidence does not cover the Stage 1 wiring.** None of the five requested tests imports `scripts/gjd-remote.ts`; removing metadata flags, origin verification, the REPO column, or the inventory status check leaves them green. The claimed mutation tables are absent from both the plan Log and the requested commit messages.

   The clearest ineffective assertion is [`gjd-remote-log.test.ts:431`](</Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/tests/gjd-remote-log.test.ts:431>): it proves only that its fixture omitted `id`, not that production rejects one. Other surviving mutations include deleting checklist descriptions, breaking `promptIo(number)`, and removing checklist Ctrl-C conversion.

Symlink inventory behavior itself is acceptable: `find` does not traverse child symlinks; the inner probe dereferences only to record facts, and resolution excludes symlinks. An outside target is not accepted as a checkout. The existing “de-dup” test proves symlink exclusion, not realpath de-duplication.

The three fixes first:

1. Preserve and check the inventory SSH status.
2. Unify slug production/validation and validate metadata before session creation.
3. Make MCP reading distinguish absence from failure.

No files or remote state were changed.
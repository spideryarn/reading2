# Rename or move files

> **Provenance.** Copied 2026-08-24 from
> [`docs/instructions/RENAME_OR_MOVE.md`](https://github.com/gregdetre/gjdutils/blob/main/docs/instructions/RENAME_OR_MOVE.md)
> in gregdetre/gjdutils — see [gjdutils-instructions.md](gjdutils-instructions.md).

- Rename or move a file or files as per the user's explicit instructions.
  - If asked to propose/discuss, then don't make changes until they have been agreed with the user.
  - If things are confusing, or you see potential problems, or have a better idea, then you should
    ask questions, raise concerns, make suggestions, etc.

- If there are multiple files, use tasks and subagents (provided with rich context) to:
  - Do the rename/move
    - Prefer `git mv` rather than `mv`, where appropriate. Or if there is a special tool for doing
      the move (e.g. a syntactically-aware refactoring tool), use that.
  - Search carefully for all the places that refer to each file, and update them appropriately.
    - Be careful not to break/disrupt functionality.

- IMPORTANT: If in doubt, or you notice any issues/surprises/complications, stop and ask.

- Once you have finished, commit these changes as a single commit. In this repo, commit only your own
  files, by naming them explicitly — see the committing rules in [AGENTS.md](../../AGENTS.md).

## A rename is never one edit

Added here, not from upstream. The move itself is the easy half; everything that *names* the thing is
the other half, and none of it fails loudly.

Send a cheap subagent (Haiku, or `Explore`) to sweep the **whole repo** — code, docs, plans,
postmortems, tests, fixtures, scripts, `package.json`. Give it both the old name and the new one, and
ask it back for a list of every hit with a recommendation. Then decide each hit yourself; a sweep
proposes, it does not rename.

Look for the name, and for everything that should change *with* it:

- file names
- headings and titles
- URL paths and slugs
- variables and function names
- types
- CSS classes
- env vars
- log messages
- the signpost table in [AGENTS.md](../../AGENTS.md)

**Grep for fragments as well as for the whole name.** A `camelCase` rename and its `kebab-case` twin
do not match the same pattern, and neither matches `SCREAMING_SNAKE`. Search for the distinctive stem
on its own and read the noise, rather than searching for the exact string and getting a clean, short,
wrong answer.

## A deletion is a rename to nothing, and needs the same sweep

Deleting a file removes the thing; it does not remove the sentences that explain the codebase by
pointing at it. Those keep their confident present tense and send the next reader looking for a file
that is not there.

So run exactly the sweep above with only the old name, and rewrite every hit. Prefer **correcting**
the fact to deleting the sentence — the comment usually explains *why* some defence exists, and that
is still worth having with the right subject. Where the deleted thing was the whole reason for a
rule, say what the rule defends against now, or say plainly that the reason has gone. Past tense with
a date (*"…until it was deleted on 2026-09-01"*) is the cheapest fix that misleads nobody.

The evidence: `src/store/import.ts` was deleted cleanly on 2026-09-01, and two days later **36
references to it were still live across 28 files**.

## Process Guidelines

### Before Starting
1. **Understand the scope** — how many files are affected?
2. **Check for references** — what refers to these files?
3. **Identify risks** — what could break with this change?
4. **Plan the approach** — `git mv`, refactoring tools, or simple moves?

### During Execution
1. **Use appropriate tools**:
   - `git mv` for version-controlled files
   - IDE refactoring tools for code symbols
   - Search and replace for documentation references

2. **Search thoroughly for references**:
   - Import/require statements
   - Documentation links
   - Configuration files
   - Build scripts and manifests
   - Test files
   - Comments and README files

3. **Test incrementally** if possible:
   - Check that code still compiles
   - Run relevant tests
   - Verify documentation links

### Common Reference Patterns
- **Code**: `import './old-name'`, `require('../old-path')`
- **Documentation**: `[link](old-path.md)`, `see old-file.js`
- **Configuration**: file paths in `package.json`, `tsconfig.json`, etc.
- **Build systems**: file references in build scripts, CI configs
- **URLs**: repository links, deployment paths

### Safety Checks
- **Back up important changes** before large moves
- **Use `git status`** to review all affected files
- **Test functionality** after the move
- **Review the commit diff** before finalizing

### Complex Scenarios
For large refactoring operations:
1. Break into smaller, atomic moves when possible
2. Use subagents to handle different aspects (code vs docs vs config)
3. Consider doing a trial run or creating a branch first
4. Coordinate with other agents working the same tree if this affects shared code

Remember: it's better to ask questions and move carefully than to break working functionality.

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

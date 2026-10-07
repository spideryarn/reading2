Reviewed and fixed, without committing.

- Added a three-second timeout, size caps and buffered output. Errors stay quiet; normal hook calls exit 0.
- Fixed push detection and directory handling, including `git -C`, preceding `cd`, multiline commands, quoted text and function definitions.
- Fixed matching for renames, extensionless files, nested docs and single-doc repositories. Verified touched-doc skipping, the ten-doc cap and common-dir logging.
- Quoted the registration path and added a silent success fallback if the hook is missing.

The JSON shape is correct and leaves normal permission flow unchanged. [Claude Code documentation](https://code.claude.com/docs/en/hooks#pretooluse-decision-control)

All hook tests pass. Suppressing the hint made the positive tests fail, confirming they catch silent failure. The full hook took about **0.4 seconds** with the real docs tree.

Typechecking passed through an alternate launcher. `npm test` was blocked by sandbox access to local Postgres.

Remaining limits: `origin/dev..HEAD` remains the intended heuristic; aliases and dynamic shell constructs are unsupported. Without `timeout` or `gtimeout`, the hook stays quiet. Diagnostic `--self-test` intentionally returns nonzero on failure.
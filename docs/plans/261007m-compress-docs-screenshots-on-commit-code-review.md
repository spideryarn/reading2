Fixed the findings within the listed files. No commit made.

- **Wrong file selection:** PNGs in messages, unrelated commands, excluded staged files, and untracked files without an earlier `git add` could be rewritten. Selection now checks commit paths and index membership.
- **Wrong repository:** `git -C`, directory changes and uncertain shell syntax now skip compression quietly.
- **Symlink bypass:** Path normalization could hide symlinked parents. Those paths are now refused.
- **Incorrect re-staging:** Raw blob comparisons replace `git diff --quiet`, which can hide edits. Compression receipts and index checks preserve concurrent peer changes.
- **Long delays:** Added subprocess deadlines, a compression budget and process-group termination.
- **Sandbox/macOS issues:** Replaced the socket-creating `tsx` invocation with Node’s loader; handled symlinked cwd aliases such as macOS `/tmp`.
- **Weak tests:** Added regressions, real continuation checks, exact permission-output assertions, and failure when pngquant is missing.

Both requested commands pass: **71 hook checks** and **31 Vitest tests**. Typechecking passed through Node’s loader; lint reported two informational complexity findings.

The full suite could not start because database/Docker access is unavailable here. No actual Mac run was performed. The plan remains untouched per your scope; its behavior description and test count now need updating.
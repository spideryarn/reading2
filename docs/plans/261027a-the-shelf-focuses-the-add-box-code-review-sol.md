Review complete; no correctness defect remains.

- **Fixed:** coarse-pointer test now asserts neither add nor search input receives focus, protecting against phone-keyboard regressions.
- **Fixed:** stale historical wording in shelf comments and [library.md](/var/tmp/spideryarn-worktrees/fbnmx5ga-add-box-focus/docs/project/library.md) was clarified.
- **Not fixed—correct as written:** `UploadPicker` renders the URL input synchronously; `useEffect` runs after it is committed and laid out.
- **Not fixed—correct as written:** nuqs supplies the parsed query on the initial render; non-empty `?q=` arrivals suppress focus.
- **Not fixed—no dependency found:** shelf keyboard shortcuts and `keyboard.md`/`touch.md` do not assume search focus.
- **Not fixed—test is effective:** disabling the focus call made the first test fail; restoring it returns the suite to green.

Checks:

- Focused Vitest: **19/19 passed**
- Full typecheck wrapper logic: **passed**, all 4,045 sources covered
- Exact `npm run typecheck`: launcher hit sandbox `EPERM` creating a `tsx` IPC socket; running `node scripts/typecheck.ts` executed the same repository typecheck successfully.
- Lint: no errors; existing informational `Library` complexity warning only.
- No commit or push performed.
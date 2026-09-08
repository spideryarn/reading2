# Build-only config work runs during static analysis

Status as of 2026-09-08: **reproduced; not fixed**. Investigated during the plan-only
[product improvement audit](../plans/260908f-prioritised-spideryarn-codebase-improvements.md), with
independent subagent source/history analysis. This is a developer-tool failure, not evidence of
a broken deployed reader.

## The failure and its class

`npm run knip` at `4adcdfd6` reports a config-load error while loading `vite.api.config.ts`,
continues printing findings, and exits nonzero. The config evaluates
`readClientShell` at module load. That function finds `dea7bf69124150cea647860756d6a9a34f8c1ac3`
in `dist/build.json`, compares it with the pulled source revision, and correctly rejects the
mismatch. The failed config discovery can leave Knip's Vite/API graph incomplete. The
[command evidence](../plans/260908f-prioritised-spideryarn-codebase-improvements-evidence.md)
contains its output.

**Class: eager build-artifact evaluation at a static-analysis boundary.** A configuration module
describes a production build but also executes whenever a source-inspection tool loads it. Its
top-level side effect makes build output a prerequisite for an unrelated source audit.

The earlier [third sweep](../plans/260905b-improve-the-codebase-third-sweep.md) met the same
coupling with **missing** `dist/` in a fresh worktree. This instance has an existing but stale
build after a pull. Rebuilding before each audit hides the coupling without removing it.

## The introducing commit and the good intention

`git log -S'readClientShell'` and blame identify
`f1f381282f555e6c139184a1ba2545eaaec173d8`, 2026-08-29, “A shared link that previews, and the
guard that was written but never called.” It introduced `scripts/client-shell.ts` and the eager
read in `vite.api.config.ts` (around line 106 at the audit baseline).

The public-read function embeds the built client shell. Rejecting a missing, source or stale shell
before building the API prevents a working-looking server from serving the wrong client.
`453f37845205f3a37017ff555fdef2890083791d` improved the diagnostic later; it did not change the
evaluation boundary. **The guard is valuable. Where it runs is the problem.**

## Why the existing checks do not answer this question

Client-shell tests prove that `readClientShell` rejects bad artifacts when called. Builds normally
run client then API, with artifacts present by design. Neither proves that static source discovery
can run before a build exists. Knip is advisory; its config failure is visible, but does not stop
the other gates. Treating its subsequent findings as a complete graph would compound the failure.

## Planned fix and what would catch the class

No implementation was attempted. Plan D first inspects the installed Knip plugin/schema for a
small static-discovery configuration that preserves API entries, aliases, CSS dependencies and
root scratch discovery. If that cannot work, put shell evaluation behind the actual build
invocation, verifying how Vite and Knip evaluate that boundary. **No particular configuration or
callback fix has yet been proved to work.**

Ranked defences:

1. Run Knip in a disposable fixture/worktree with both missing and stale `dist/`; require no config
   load error, complete intended graph coverage and detection of a deliberately unused module.
   A zero-file “success” must fail the test.
2. Preserve the complementary build controls: API-only builds reject missing/stale output, and
   the normal two-pass build succeeds. This stops the obvious “fix” from weakening production.
3. Make build-only config side effects explicit in the owning doc and at the evaluation point.
   This explains the seam; it is not a substitute for the two-consumer test.

Rejected: removing stamp comparison, accepting an unknown/fallback shell, blanket-ignoring the API
entry, or claiming that a new Knip config works without checking its import/alias coverage. The
lesson is to test the consumer boundary as well as the guard: source inspection needs source;
the real build needs matching artifacts.

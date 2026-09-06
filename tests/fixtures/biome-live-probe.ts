/**
 * **A file whose only job is to be linted**, by
 * `tests/biome-config-is-live.test.ts`.
 *
 * It contains a non-null assertion, and that is deliberate: `noNonNullAssertion`
 * is a rule Biome recommends and `biome.jsonc` deliberately switches **off**
 * (83 hits, all `x!`, see docs/project/linting.md § What's turned off, and why).
 * So linting this file is silent under our config and noisy under Biome's
 * defaults, which is a difference only a live config can produce — that is the
 * question the test asks.
 *
 * ## Why a tracked file rather than one the test writes
 *
 * The first version wrote a scratch file at run time. That has to live inside
 * the checkout, because Biome resolves `biome.jsonc` by walking up from the file
 * and a copy under `/tmp` is checked against the defaults instead
 * (docs/project/linting.md § A copy outside the repo). But a file inside the
 * checkout that nothing tracks is debris in a tree a dozen agents share, and
 * `.gitignore` says twice that `git status` has to stay readable.
 *
 * Adding it to `.gitignore` looked like the answer and is exactly wrong:
 * `biome.jsonc` sets `vcs.useIgnoreFile: true`, so an ignored file is one Biome
 * **skips** — measured, `Checked 0 files … these paths were provided but
 * ignored`, exit 1. The two requirements are in direct conflict, and a tracked
 * fixture satisfies both: git knows about it, so it is not debris and Biome does
 * not skip it, and the test writes nothing at run time.
 *
 * It is imported by that test rather than merely named by path, so that deleting
 * or moving it is a compile error rather than a check that quietly starts
 * passing over nothing.
 */

/** Deliberately `number | null`, so the assertion below is not redundant. */
const value: number | null = Number.parseInt("1", 10);

/** The `x!` this fixture exists for. Do not "fix" it — the test needs it. */
export const asserted: number = value!;

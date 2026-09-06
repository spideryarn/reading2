/**
 * **`npm run lint` is only worth what `biome.jsonc` being read is worth.**
 *
 * ## The incident this is the check for
 *
 * Biome parses `//` comments only in a file named `.jsonc`. Put one in
 * `biome.json` and it **drops the rest of the config** — no error, no warning,
 * exit code unchanged, and every rule reverts to its default. It happened here:
 * the config looked right, `npm run lint` ran, and 83 warnings the config
 * switched off kept appearing. Seventh entry in docs/reusable/silent-success.md;
 * the full story is docs/project/linting.md § *The file is `biome.jsonc`, and
 * the extension is load-bearing*.
 *
 * That doc has recorded the incident, the tell **and** a detection command since
 * the day it happened, and the detection command was wired into nothing. This
 * file is the wiring, and it is the fourth codebase sweep to name it —
 * docs/plans/260906h-improve-the-codebase-fourth-sweep.md § T1.1.
 *
 * ## Measured, not assumed
 *
 * Against a scratch config setting `noExplicitAny` to `error`, over a file using
 * `any`, reading **biome's** exit code rather than a pipe's:
 *
 * | | exit | the finding |
 * |---|---|---|
 * | config present | 1 | reported as an error |
 * | config renamed away | **0** | reported as an *info*, and the command passes |
 *
 * So a lost config does not merely lose rules: it downgrades errors to advice
 * and turns the gate green. Everything lint-shaped in this repo — the import
 * cycles rule, `noFloatingPromises`, and any future path-scoped rule on the
 * sanitiser seam — is standing on that.
 *
 * ## And there is a dated reason it matters now
 *
 * `npx biome rage` already reports, against today's config: *"The use of the
 * `recommended` field has been deprecated, and will removed in the next major
 * version of Biome."* `npm run lint` prints none of that. `recommended` at
 * biome.jsonc's `linter.rules` is the field the whole rule set hangs from, so
 * the next major version is this exact failure with a delivery date on it.
 *
 * ## Why `rage`, and why the third assertion
 *
 * `biome rage` answers the question directly — it prints the config's load
 * status and the path it loaded from — where `lint` answers it only by the
 * absence of findings it might not have been looking for.
 *
 * But status and path alone would still pass over a config that loaded and
 * meant nothing, so the third assertion asks for something **only a live config
 * can produce**: `noNonNullAssertion` is deliberately `off` here (83 hits, all
 * `x!`, see linting.md § What's turned off, and why) and is on by default, so a
 * file full of `x!` is silent under our config and noisy under Biome's. That is
 * a claim about behaviour rather than about a file existing.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { asserted } from "./fixtures/biome-live-probe.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The **pinned** binary, not `npx biome`.
 *
 * `npm run lint` runs the one in `node_modules`, and `@biomejs/biome` is pinned
 * to an exact version in package.json on purpose (biome.jsonc says why: the
 * `noFloatingPromises` rule lives in `nursery` and can move between versions).
 * `npx biome` from a directory outside the repo resolves a *different* copy —
 * measured while writing this file, where it silently checked nothing and
 * exited 0 on a fixture the pinned binary reports an error for. A guard that
 * asked a different binary than the gate does would be answering a different
 * question.
 */
const BIOME = path.join(ROOT, "node_modules", ".bin", "biome");

/** Run a biome subcommand and hand back its output plus its own exit code. */
function biome(args: string[], cwd = ROOT): { out: string; code: number } {
  try {
    const out = execFileSync(BIOME, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { out, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: e.status ?? 1 };
  }
}

describe("biome.jsonc is actually being read", () => {
  it("reports the config as loaded, from the .jsonc path", () => {
    const { out } = biome(["rage"]);

    /* The positive control for this whole file: `rage` printing nothing at all
       — a renamed binary, a changed subcommand — would make every `toContain`
       below vacuous. */
    expect(out, "biome rage printed no configuration section").toContain("Biome Configuration:");

    expect(out).toMatch(/Status:\s+Loaded successfully/);
    /* The extension is the load-bearing half: `biome.json` would also load,
       and would silently drop everything after the first comment. */
    expect(out).toMatch(/Path:\s+biome\.jsonc/);
  });

  /**
   * The behavioural half. A config can load and still be the wrong one, so this
   * asks for an outcome that only our settings produce.
   */
  it("applies a rule this repo deliberately turns off", () => {
    /* The probe is **inside the repo**, because Biome resolves `biome.jsonc` by
       walking up from the file — a copy in /tmp gets the defaults, which cost a
       wrong conclusion on 2026-08-30 (linting.md § A copy outside the repo is
       checked against a different config). And it is **tracked and imported**
       rather than written here; `tests/fixtures/biome-live-probe.ts`'s own
       header says why both of those matter. `asserted` is referenced so the
       import cannot be elided: a fixture this test does not really depend on is
       one that could be deleted without anything going red. */
    expect(asserted).toBe(1);

    const probe = path.join(ROOT, "tests", "fixtures", "biome-live-probe.ts");
    const { out, code } = biome(["lint", "--max-diagnostics=none", probe]);

    /* **The two positive controls, and they are the point of this trio rather
       than decoration.** `not.toContain` is satisfied by silence, and there are
       three ways to be silent that have nothing to do with the config: biome
       crashing, biome checking zero files (which is how the saved-page stack
       overflow exited 0 having linted nothing — docs/project/linting.md § A
       saved web page killed the linter, quietly), or the rule being renamed in
       a future version. GPT Sol found this file asserting the absence without
       either guard, in a test whose whole subject is a check that passes while
       doing nothing — and the guards then immediately earned their place by
       catching the gitignore mistake described in the fixture's header. */
    expect(code, "biome did not complete cleanly, so its silence means nothing").toBe(0);
    expect(out, "biome checked no files, so its silence means nothing").toContain("Checked 1 file");

    /* `x!` is `noNonNullAssertion`, which Biome recommends and biome.jsonc
       switches off. Under our config: silent. Under the defaults: a warning. So
       this assertion fails in exactly the case the file is about. */
    expect(out, "noNonNullAssertion fired — biome.jsonc's `style` block is not being applied").not.toContain(
      "noNonNullAssertion",
    );
  });
});

/* A scratch directory only the negative control below uses. */
let scratch: string | null = null;
afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("the check can tell a live config from a missing one", () => {
  /**
   * **Proving the guard above can fail**, without touching the repo's own
   * config — renaming `biome.jsonc` in a tree a dozen agents share is not a
   * thing a test may do.
   *
   * So the same question is put to a scratch directory twice, with and without
   * a config, and the answers must differ. If they ever stop differing, the two
   * assertions above have become tautologies and this file is defending nothing.
   */
  it("sees a rule apply with a config present and not without one", () => {
    scratch = mkdtempSync(path.join(tmpdir(), "biome-live-"));
    writeFileSync(path.join(scratch, "probe.ts"), "export function f(a: any) {\n  return a;\n}\n");
    const config = path.join(scratch, "biome.jsonc");
    writeFileSync(
      config,
      JSON.stringify({
        linter: { enabled: true, rules: { suspicious: { noExplicitAny: "error" } } },
      }),
    );

    const withConfig = biome(["lint", "--max-diagnostics=none", "."], scratch);
    execFileSync("mv", [config, path.join(scratch, "biome.json.disabled")]);
    const without = biome(["lint", "--max-diagnostics=none", "."], scratch);

    /* The measurement recorded in this file's header: `error` with the config,
       and a passing command without it.

       **The exit code alone is not enough**, which GPT Sol caught: exit 1 is
       also what an *invalid* config produces, so the pair could agree while
       proving something else entirely. So the arm that fails must be shown to
       fail for the stated reason. */
    expect(withConfig.out, "exit 1 for some reason other than the rule firing").toContain(
      "noExplicitAny",
    );
    expect(withConfig.code, "a config setting a rule to error should fail the command").toBe(1);
    expect(without.code, "no config, so the rule falls back to a default warning").toBe(0);
  });
});

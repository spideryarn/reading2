/**
 * **The cap on how much of a machine one test run may take, and the trap in the
 * knob that sets it.** The reasoning, the incident and the measurements are in
 * docs/plans/260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites.md; this
 * file is what stops the three ways it can quietly stop working.
 *
 * 1. **Vitest applies `VITEST_MAX_WORKERS` to a project that asked to be
 *    serial** — it reads the variable in `resolveConfig`, after the line that
 *    turns `fileParallelism: false` into `maxWorkers: 1`. That lets an innocent
 *    "use less of the machine" flag reach into *what the suite tests*, because
 *    the private-postgres lane is serial on purpose. Pinned rather than
 *    assumed, so a vitest release that fixes it upstream turns red here: a
 *    defence whose reason has quietly expired is worse than no defence, since
 *    nobody dares delete it.
 * 2. **The cap must not eat `--maxWorkers`.** Vitest prefers a project's
 *    `maxWorkers` over the global one, so writing the cap into the shared
 *    project block silently beat the command-line flag. It lives at the root
 *    instead, and `resolves` below is the test that knows the difference.
 * 3. **An override must survive a config restart**, which watch mode does on
 *    every edit — the variable has been consumed by then.
 *
 * **No assertion here depends on what this machine's file says.** The tests
 * that resolve the real config do read it — that is what resolving means — so
 * those assert relationships (the lanes agreeing, an override winning) rather
 * than numbers, and the ones that assert a number pass an explicit file. The
 * box has a machine file and a laptop does not, and a test that is green on one
 * and red on the other gets deleted rather than believed.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { InlineConfig as ViteInlineConfig } from "vite";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { createVitest, resolveConfig } from "vitest/node";

import { MACHINE_WORKERS_FILE, resolveParallelWorkers } from "../vitest-admission.js";

const HALF_OF_THIS_MACHINE = Math.max(2, Math.floor(availableParallelism() / 2));

const scratch = mkdtempSync(join(tmpdir(), "vitest-worker-caps-"));
/** A path inside a directory that exists, with no file at it. */
const NO_MACHINE_FILE = join(scratch, "absent");

function machineFileSaying(contents: string): string {
  const path = join(scratch, `workers-${Math.random().toString(36).slice(2)}`);
  writeFileSync(path, contents, "utf8");
  return path;
}

/**
 * A fresh process, as far as the cap can tell. Nothing is remembered between
 * calls on purpose — see `resolveParallelWorkers` — so this is only the
 * environment, and these tests are not order-dependent.
 */
function asFreshProcess(override?: string): void {
  vi.stubEnv("VITEST_MAX_WORKERS", override);
}

beforeEach(() => {
  asFreshProcess();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// One per run adds up on a box that runs the suite all day.
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/* Typed as vite's `InlineConfig` and named rather than written inline:
   `configFile` is declared on `InlineConfig` while these functions ask for the
   `UserConfig` it extends, so an object literal at the call site is rejected as
   an excess property. Naming it keeps the flag without an `as`, which would
   switch off checking on everything else in the object too. */
const NO_CONFIG_FILE: ViteInlineConfig = { configFile: false };

/**
 * What vitest resolves for a project that has asked, both ways it can, to run
 * its files one at a time — reading vitest's own defaults, not this repo's.
 */
async function vitestResolvesSerialProjectTo(override: string | undefined): Promise<number> {
  asFreshProcess(override);
  const { vitestConfig } = await resolveConfig(
    { fileParallelism: false, maxWorkers: 1, watch: false },
    NO_CONFIG_FILE,
  );
  return vitestConfig.maxWorkers;
}

/**
 * The cap each lane ends up with **after vitest has resolved this repo's real
 * config** — which is the only place the two mistakes above are visible. The
 * object the config file exports says nothing about which of a project's and
 * the root's `maxWorkers` wins.
 */
async function resolvedLaneCaps(
  cliOptions: { maxWorkers?: number } = {},
): Promise<Map<string, number | undefined>> {
  const vitest = await createVitest("test", { watch: false, ...cliOptions });
  try {
    const caps = new Map<string, number | undefined>();
    for (const project of vitest.projects) {
      /* Vitest's own rule, from `resolveMaxWorkers`: a project's own number if
         it has one, otherwise the global. Written out because that precedence
         *is* the thing under test — a project-level cap shadows the global one,
         and the global is where a `--maxWorkers` flag lands. */
      caps.set(project.name, project.config.maxWorkers ?? vitest.config.maxWorkers);
    }
    return caps;
  } finally {
    await vitest.close();
  }
}

test("vitest hands VITEST_MAX_WORKERS to a project that asked to be serial", async () => {
  // The control: with nothing in the environment, asking for serial gets serial.
  expect(await vitestResolvesSerialProjectTo(undefined)).toBe(1);

  // And the trap this defence is for. If this ever comes back 1, vitest has
  // fixed the ordering and `resolveParallelWorkers` may stop deleting the
  // variable — read the comments there before deleting anything.
  expect(await vitestResolvesSerialProjectTo("4")).toBe(4);
});

test("the serial lane stays serial even when the environment says otherwise", async () => {
  // The end-to-end version of the test above: the same variable, the same
  // vitest, but this repo's config in between. This is the assertion the whole
  // deletion exists to make true.
  asFreshProcess("6");
  const caps = await resolvedLaneCaps();
  expect(caps.get("private-postgres")).toBe(1);
  expect(caps.get("unit")).toBe(6);
  expect(caps.get("shared-services")).toBe(6);
});

test("--maxWorkers still works, because the cap is not on the projects", async () => {
  // Vitest prefers a project's own maxWorkers over the global one, so a cap
  // written into the shared project block would silently swallow this flag.
  const caps = await resolvedLaneCaps({ maxWorkers: 2 });
  expect(caps.get("unit")).toBe(2);
  expect(caps.get("shared-services")).toBe(2);
  expect(caps.get("private-postgres")).toBe(1);
});

test("the parallel lanes agree, whatever this machine says", async () => {
  // Not a style point: vitest throws when two projects in one scheduling group
  // disagree about maxWorkers.
  const caps = await resolvedLaneCaps();
  expect(caps.get("unit")).toBe(caps.get("shared-services"));
  expect(caps.get("private-postgres")).toBe(1);
});

test("our config takes VITEST_MAX_WORKERS out of the environment", () => {
  asFreshProcess("3");
  resolveParallelWorkers(NO_MACHINE_FILE);
  expect(process.env.VITEST_MAX_WORKERS).toBeUndefined();
});

test("one run's override does not leak into the next vitest in this process", async () => {
  // The config consumes the variable and remembers nothing, so a second
  // instance must decide for itself. An earlier version kept the value on
  // globalThis to survive a watch restart, and this is what that cost.
  // Relative to whatever this machine would say anyway — the box has a machine
  // file and a laptop does not, and the override has to differ from both.
  const machineSays = resolveParallelWorkers();
  const override = machineSays + 1;

  asFreshProcess(String(override));
  expect((await resolvedLaneCaps()).get("unit")).toBe(override);
  asFreshProcess();
  expect((await resolvedLaneCaps()).get("unit")).toBe(machineSays);
});

test("with nothing set anywhere, half the machine and at least two", () => {
  expect(resolveParallelWorkers(NO_MACHINE_FILE)).toBe(HALF_OF_THIS_MACHINE);
  // Which is the point: less than vitest's own default.
  if (availableParallelism() > 3) {
    asFreshProcess();
    expect(resolveParallelWorkers(NO_MACHINE_FILE)).toBeLessThan(availableParallelism() - 1);
  }
});

test("a machine that says it is crowded is believed", () => {
  expect(resolveParallelWorkers(machineFileSaying("3\n"))).toBe(3);
});

test("the environment beats the machine file, so one run can opt out", () => {
  asFreshProcess("8");
  expect(resolveParallelWorkers(machineFileSaying("3\n"))).toBe(8);
});

test("an empty or absent machine file means nothing, not zero", () => {
  expect(resolveParallelWorkers(machineFileSaying("  \n"))).toBe(HALF_OF_THIS_MACHINE);
  asFreshProcess();
  expect(resolveParallelWorkers(NO_MACHINE_FILE)).toBe(HALF_OF_THIS_MACHINE);
});

test("a machine file that cannot be read is an error, not a shrug", () => {
  // A directory at the path: the machine meant to set a policy, and the policy
  // is not being applied. Only "no such file" is allowed to be silent.
  expect(() => resolveParallelWorkers(scratch)).toThrow(/could not be read/);
});

test("the machine file is looked for where provisioning writes it", () => {
  // Two files have to agree on one path, and neither can see the other: this
  // config reads it, and provision.sh creates it on a box nobody runs tests
  // against by hand. Asserting the constant alone would let a rename here pass
  // while every future box quietly took the default, so read the script.
  expect(MACHINE_WORKERS_FILE).toMatch(/[/\\]\.config[/\\]spideryarn[/\\]vitest-max-workers$/);
  const provision = readFileSync(
    fileURLToPath(new URL("../infra/hetzner/provision.sh", import.meta.url)),
    "utf8",
  );
  const relativeToHome = MACHINE_WORKERS_FILE.slice(homedir().length + 1);
  const writes = provision
    .split("\n")
    .find((line) => line.includes(`$HOME/${relativeToHome}`) && line.includes("printf"));
  expect(writes, `provision.sh should write ${relativeToHome}`).toBeDefined();
  const written = /printf '(\d+)\\n'/.exec(writes ?? "")?.[1];
  expect(written, "provision.sh should printf a worker count into it").toBeDefined();

  // And that its own verify block expects the same number. Provisioning says it
  // twice — once writing, once checking — and a check that agrees with itself
  // by construction would pass on a box configured to something nobody meant.
  const verifies = provision
    .split("\n")
    .find((line) => line.includes("check ") && line.includes("vitest-max-workers"));
  expect(verifies, "provision.sh should verify the file it wrote").toBeDefined();
  expect(/grep -qx "(\d+)"/.exec(verifies ?? "")?.[1]).toBe(written);

  // A worker count this config accepts, and a plausible one: the point of the
  // file is to ask for LESS than the machine would otherwise take.
  expect(resolveParallelWorkers(machineFileSaying(`${written}\n`))).toBe(Number(written));
  expect(Number(written)).toBeGreaterThanOrEqual(1);
  expect(Number(written)).toBeLessThanOrEqual(8);
});

test.each(["0", "-1", "2.5", "four"])("a machine file saying %o is refused", (bad) => {
  expect(() => resolveParallelWorkers(machineFileSaying(bad))).toThrow(/whole number of workers/);
});

test.each(["0", "-1", "2.5", "four"])(
  "a VITEST_MAX_WORKERS of %o is refused rather than guessed at",
  (bad) => {
    asFreshProcess(bad);
    expect(() => resolveParallelWorkers(NO_MACHINE_FILE)).toThrow(/VITEST_MAX_WORKERS/);
  },
);

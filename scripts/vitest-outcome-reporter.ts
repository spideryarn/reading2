/**
 * **Which test files failed, and whether anything failed outside them**, written
 * where `SPIDERYARN_TEST_OUTCOME_FILE` says, for a later deploy to rerun only
 * those files. docs/plans/261008h.
 *
 * A reporter rather than vitest's `json` one, because the JSON report has no
 * place for an unhandled error (measured with vitest 4.1.11: a stray throw in a
 * timer is in the text and nowhere in the JSON), and a run red only from one of
 * those has no file to rerun. It decides nothing: `testOutcomeFrom` in
 * tools/fleet/test-outcome.ts reads what it wrote.
 *
 * Four things it has to get right, each a way a short list could claim more
 * than it knows (GPT Sol on the plan, P1-5 to P1-7):
 *
 * - **Its file is its own.** The path is taken when the reporter is made and
 *   the variable deleted, before any worker or child process is started, so a
 *   vitest run inside a test cannot write a report that reads as this one's.
 * - **It is not finished at `onTestRunEnd`.** Global teardown runs after that,
 *   and `tests/setup/private-db-global.ts` can fail the run there. So the file
 *   is written `final: false` then, and rewritten `final: true` from the
 *   process's `exit` handler with the exit code and any failure that marked
 *   itself with {@link markFailureOutsideFiles}. A run killed before `exit`
 *   leaves a file that says it never finished.
 * - **It says whether it covered the whole suite**: every spec the config
 *   would collect, unfiltered, against the modules that finished, keyed by
 *   project and path, and the filters it was started with.
 * - **Nothing here throws into the run.** A reporter that broke the suite to
 *   describe it would be worse than none.
 *
 * Used two ways, because CLI `--reporter` flags replace the config's (measured):
 * `scripts/deploy.ts` names it on its command line, and `vitest.config.ts` adds
 * it when the variable is set and no flags were given (the readiness runner).
 */
import { writeFileSync } from "node:fs";
import type { Reporter, SerializedError, TestModule, TestRunEndReason, Vitest } from "vitest/node";

export const TEST_OUTCOME_FILE_ENV = "SPIDERYARN_TEST_OUTCOME_FILE";

const OUTSIDE = Symbol.for("spideryarn.test-failures-outside-files");

/**
 * **Say that the run failed somewhere no test file owns** — a global teardown,
 * say — so its outcome cannot be read as "red only in these files". Global,
 * because a global-setup module and this reporter are loaded by different
 * module runners in the one process.
 */
export function markFailureOutsideFiles(why: string): void {
  const g = globalThis as { [OUTSIDE]?: string[] };
  g[OUTSIDE] = [...(g[OUTSIDE] ?? []), why];
}

type Written = {
  schema: 2;
  final: boolean;
  reason: TestRunEndReason;
  unhandledErrors: number;
  /** The process's exit code, from its `exit` handler; null until then. */
  exitCode: number | null;
  failuresOutsideFiles: string[];
  /** What the run was narrowed by. All empty for a whole-suite run. */
  narrowed: { filters: string[]; shard: string | null; project: string[]; testNamePattern: string | null };
  /** Specs the config collects with no filter that did not finish in this run. Null when they could not be listed. */
  notRun: number | null;
  files: { project: string; path: string; state: string }[];
};

export default class OutcomeReporter implements Reporter {
  private readonly file: string | undefined;
  private ctx: Vitest | null = null;
  private written: Written | null = null;

  constructor() {
    this.file = process.env[TEST_OUTCOME_FILE_ENV] || undefined;
    delete process.env[TEST_OUTCOME_FILE_ENV];
  }

  onInit(ctx: Vitest): void {
    this.ctx = ctx;
  }

  async onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<SerializedError>,
    reason: TestRunEndReason,
  ): Promise<void> {
    if (!this.file) return;
    try {
      const files = testModules.map((m) => ({ project: m.project.name, path: this.relative(m.moduleId), state: m.state() }));
      this.written = {
        schema: 2,
        final: false,
        reason,
        unhandledErrors: unhandledErrors.length,
        exitCode: null,
        failuresOutsideFiles: [],
        narrowed: this.narrowed(),
        notRun: await this.notRun(files),
        files,
      };
      this.write();
      process.once("exit", (code) => {
        if (this.written === null) return;
        const outside = (globalThis as { [OUTSIDE]?: string[] })[OUTSIDE] ?? [];
        this.written = { ...this.written, final: true, exitCode: code, failuresOutsideFiles: [...outside] };
        this.write();
      });
    } catch {
      /* No outcome file is an outcome nobody can reuse, which is the safe one. */
    }
  }

  /** Teardown overran: whatever it was doing did not finish, so this run's report is not final. */
  onProcessTimeout(): void {
    this.written = null;
  }

  private narrowed(): Written["narrowed"] {
    const ctx = this.ctx as (Vitest & { filenamePattern?: string[] }) | null;
    const shard = ctx?.config.shard;
    const project = ctx?.config.project;
    const name = ctx?.config.testNamePattern;
    return {
      filters: [...(ctx?.filenamePattern ?? [])],
      shard: shard ? `${shard.index}/${shard.count}` : null,
      project: Array.isArray(project) ? [...project] : project ? [String(project)] : [],
      testNamePattern: name ? String(name) : null,
    };
  }

  private async notRun(files: Written["files"]): Promise<number | null> {
    if (this.ctx === null) return null;
    try {
      const all = await this.ctx.globTestSpecifications();
      const ran = new Set(files.filter((f) => f.state !== "queued" && f.state !== "pending").map((f) => `${f.project}\0${f.path}`));
      return all.filter((s) => !ran.has(`${s.project.name}\0${this.relative(s.moduleId)}`)).length;
    } catch {
      return null;
    }
  }

  private relative(moduleId: string): string {
    const root = this.ctx?.config.root ?? "";
    return moduleId.startsWith(`${root}/`) ? moduleId.slice(root.length + 1) : moduleId;
  }

  private write(): void {
    if (!this.file || this.written === null) return;
    try {
      writeFileSync(this.file, `${JSON.stringify(this.written)}\n`);
    } catch {
      /* As above. */
    }
  }
}

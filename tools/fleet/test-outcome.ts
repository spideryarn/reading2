/**
 * **What one run of the suite showed, as far as rerunning part of it goes** —
 * the judgement on what `scripts/vitest-outcome-reporter.ts` wrote. A leaf, so
 * the readiness record (tools/fleet/readiness.ts) and the deploy
 * (scripts/deploy-evidence.ts) read one definition. docs/plans/261008h.
 */

/** More failed files than this and a rerun is a full run in all but name; the deploy runs the suite. */
export const RERUN_FILES_MAX = 40;

/**
 * `red-in-files` is the claim a rerun leans on: **every** failure the run had
 * is inside the files named, so running those again and seeing them pass
 * answers for all of it. Anything that could have failed outside a file — an
 * unhandled error, a teardown, an interrupted run, a run that did not cover
 * the whole suite — is `unusable`, never a short list.
 *
 * Only the compact judgement is kept on a record: the reporter's own file
 * lists every module, ~116 KB for this suite, past the readiness store's
 * record ceiling.
 */
export type TestOutcome =
  | { kind: "pass"; files: number }
  | { kind: "red-in-files"; failed: [string, ...string[]]; files: number }
  | { kind: "unusable"; why: string };

/** One module's line in the reporter's file. */
export type OutcomeFile = { project: string; path: string; state: "passed" | "skipped" | "failed" | "pending" | "queued" };

const FILE_STATES = new Set(["passed", "skipped", "failed", "pending", "queued"]);

/**
 * The reporter's file, read and checked for being a finished run's: its own
 * verdict, every module's state, and nothing failing outside a file. What it
 * does not check is whether the run covered the whole suite — that is a
 * question about a baseline, not a rerun ({@link testOutcomeFrom}).
 */
export function readOutcomeFile(
  text: string | null,
): { ok: true; reason: "passed" | "failed"; files: OutcomeFile[]; whole: string | null } | { ok: false; why: string } {
  if (text === null) return { ok: false, why: "the run wrote no outcome file (vitest never reached the end of its run)" };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, why: "the outcome file is not JSON" };
  }
  if (typeof v !== "object" || v === null) return { ok: false, why: "the outcome file is not an object" };
  const o = v as Record<string, unknown>;
  if (o.schema !== 2) return { ok: false, why: `the outcome file's schema is ${String(o.schema)}, not 2` };
  if (o.final !== true) {
    return { ok: false, why: "the outcome file was never finalised — the run was killed, or its teardown overran, after its tests" };
  }
  const outside = o.failuresOutsideFiles;
  if (!Array.isArray(outside)) return { ok: false, why: "the outcome file does not say whether anything failed outside a file" };
  if (outside.length > 0) return { ok: false, why: `the run failed outside every test file: ${outside.map(String).join("; ")}` };
  if (!Number.isInteger(o.unhandledErrors) || (o.unhandledErrors as number) < 0) {
    return { ok: false, why: "the outcome file has no unhandled-error count" };
  }
  if (o.unhandledErrors !== 0) {
    return { ok: false, why: `vitest caught ${o.unhandledErrors} unhandled error(s), which belong to no file a rerun could repeat` };
  }
  if (!Number.isInteger(o.exitCode)) return { ok: false, why: "the outcome file has no exit code" };
  if (o.reason !== "passed" && o.reason !== "failed") {
    return { ok: false, why: `the run ended '${String(o.reason)}', not passed or failed` };
  }
  if ((o.reason === "passed") !== (o.exitCode === 0)) {
    return { ok: false, why: `the run says ${o.reason} but exited ${String(o.exitCode)} — something failed after its tests` };
  }
  if (!Array.isArray(o.files)) return { ok: false, why: "the outcome file lists no files" };
  const files: OutcomeFile[] = [];
  for (const f of o.files as unknown[]) {
    const file = f as Record<string, unknown> | null;
    if (
      typeof file?.path !== "string" ||
      typeof file.project !== "string" ||
      typeof file.state !== "string" ||
      !FILE_STATES.has(file.state)
    ) {
      return { ok: false, why: "the outcome file has a malformed file entry" };
    }
    if (!isCheckoutPath(file.path)) {
      return { ok: false, why: `the outcome file names '${file.path}', which is not a path inside the checkout` };
    }
    if (file.state === "pending" || file.state === "queued") {
      return { ok: false, why: `${file.path} never finished (${file.state})` };
    }
    files.push({ project: file.project, path: file.path, state: file.state as OutcomeFile["state"] });
  }

  /* Whether it covered everything — asked by a baseline, not by a rerun. */
  const n = o.narrowed as Record<string, unknown> | null | undefined;
  const narrowedBy = [
    ...(Array.isArray(n?.filters) && n.filters.length > 0 ? [`file filters ${n.filters.map(String).join(" ")}`] : []),
    ...(n?.shard ? [`shard ${String(n.shard)}`] : []),
    ...(Array.isArray(n?.project) && n.project.length > 0 ? [`projects ${n.project.map(String).join(" ")}`] : []),
    ...(n?.testNamePattern ? [`test names /${String(n.testNamePattern)}/`] : []),
  ];
  const whole =
    n === null || typeof n !== "object"
      ? "the outcome file does not say how the run was narrowed"
      : narrowedBy.length > 0
        ? `the run was narrowed by ${narrowedBy.join(", ")}`
        : o.notRun !== 0
          ? Number.isInteger(o.notRun)
            ? `${String(o.notRun)} test file(s) the suite collects did not run`
            : "the outcome file does not say whether every test file ran"
          : null;
  return { ok: true, reason: o.reason, files, whole };
}

/**
 * **A whole-suite run, judged**: green, red only in the files it names, or no
 * use. A run that did not cover every file the suite collects is no use as a
 * baseline, however it ended.
 */
export function testOutcomeFrom(text: string | null): TestOutcome {
  const read = readOutcomeFile(text);
  if (!read.ok) return { kind: "unusable", why: read.why };
  if (read.whole !== null) return { kind: "unusable", why: read.whole };
  const { files } = read;
  if (files.length === 0) return { kind: "unusable", why: "the run collected no test files" };
  const failed = [...new Set(files.filter((f) => f.state === "failed").map((f) => f.path))].sort();
  if (read.reason === "passed") {
    if (failed.length > 0) return { kind: "unusable", why: `the run says it passed but ${failed.length} file(s) failed` };
    if (!files.some((f) => f.state === "passed")) return { kind: "unusable", why: "no test file passed — the whole run skipped" };
    return { kind: "pass", files: files.length };
  }
  const [first, ...rest] = failed;
  if (first === undefined) return { kind: "unusable", why: "the run failed, but no file did — the failure was outside every file" };
  if (failed.length > RERUN_FILES_MAX) {
    return { kind: "unusable", why: `${failed.length} files failed — more than ${RERUN_FILES_MAX}, so rerunning them is the suite in all but name` };
  }
  return { kind: "red-in-files", failed: [first, ...rest], files: files.length };
}

/**
 * A whole-suite outcome checked against vitest's exit status as the caller saw
 * it, which must say the same; an outcome that disagrees is no use.
 */
export function agreeingWithExit(outcome: TestOutcome, exit: number | null): TestOutcome {
  if (outcome.kind === "unusable") return outcome;
  if (exit === null) return { kind: "unusable", why: "vitest has no exit status (killed?)" };
  if ((outcome.kind === "pass") !== (exit === 0)) {
    return { kind: "unusable", why: `the outcome says ${outcome.kind} but vitest exited ${exit}` };
  }
  return outcome;
}

/**
 * **Did a rerun answer for every file it was asked about?** Null when it did.
 * vitest silently ignores a filter that matches no file (measured), so a green
 * exit over fewer files than were named is not a pass; nor is a file that only
 * skipped. `exit` is vitest's own status as the caller saw it.
 */
export function rerunVerdict(requested: readonly string[], text: string | null, exit: number | null): string | null {
  const read = readOutcomeFile(text);
  if (!read.ok) return `the rerun cannot be read: ${read.why}`;
  if (exit === null) return "vitest has no exit status (killed?)";
  if ((read.reason === "passed") !== (exit === 0)) return `the rerun's outcome says ${read.reason} but vitest exited ${exit}`;
  const failed = [...new Set(read.files.filter((f) => f.state === "failed").map((f) => f.path))].sort();
  if (failed.length > 0) return `still failing: ${failed.join(" ")}`;
  const missing = requested.filter((p) => !read.files.some((f) => f.path === p));
  if (missing.length > 0) return `the rerun never ran ${missing.join(" ")}`;
  const notPassed = requested.filter((p) => read.files.some((f) => f.path === p && f.state !== "passed"));
  if (notPassed.length > 0) return `the rerun did not pass ${notPassed.join(" ")} (skipped)`;
  return null;
}

/**
 * A {@link TestOutcome} read back off a stored record, or null for anything
 * malformed — which a reader takes as "not known", the same as absent. Strict
 * the way `asPreparation` is: a list that does not hold together is no list.
 */
export function asTestOutcome(v: unknown): TestOutcome | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const files = o.files;
  if (o.kind === "pass") return Number.isInteger(files) && (files as number) > 0 ? { kind: "pass", files: files as number } : null;
  if (o.kind === "unusable") return typeof o.why === "string" && o.why !== "" ? { kind: "unusable", why: o.why } : null;
  if (o.kind !== "red-in-files" || !Number.isInteger(files) || !Array.isArray(o.failed)) return null;
  const failed = o.failed as unknown[];
  if (failed.length === 0 || failed.length > RERUN_FILES_MAX || failed.length > (files as number)) return null;
  if (!failed.every((p) => typeof p === "string" && isCheckoutPath(p))) return null;
  const [first, ...rest] = failed as string[];
  if (first === undefined || new Set(failed).size !== failed.length) return null;
  return { kind: "red-in-files", failed: [first, ...rest], files: files as number };
}

/** Relative, and inside the checkout. */
function isCheckoutPath(p: string): boolean {
  return p !== "" && !p.startsWith("/") && !p.split("/").includes("..");
}

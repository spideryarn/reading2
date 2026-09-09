/**
 * **Reading a check's own output back**: what npm said it was running, and what
 * the tool said it found.
 *
 * Shared by the wrapper (`scripts/readiness-run.ts`) and the backfill
 * (`readiness-backfill.ts`). **Neither holds the whole output** — both keep a
 * bounded head and a bounded tail and join them with {@link joinEnds}, because a
 * full `npm run check` prints megabytes. So everything here works on a
 * **fragment** and says so when it could not find what it wanted — never a
 * zero, which is a measurement.
 *
 * ## The rule these parsers exist to enforce
 *
 * **`EXIT=0` alone is not a pass.** For `test`, `typecheck` and `check` a
 * coherent terminal footer has to be there too: a nested process can die while
 * an outer wrapper exits 0, which is `docs/reusable/silent-success.md` in one
 * sentence. So the caller asks for the footer, and a run without one is `void`
 * rather than green.
 *
 * Each footer is the last thing its tool prints that is worth matching on —
 * vitest's two tally lines (it prints `Start at` and `Duration` after them),
 * `typecheck.ts`'s coverage tick, `check.ts`'s verdict sentence. **None of them
 * is a proof of SUCCESS, only of COMPLETION**: `typecheck.ts` writes its errors
 * to stderr and prints the tick anyway, so a tick coexists with failures and the
 * exit status is what decides whether it passed.
 *
 * And a footer is not guaranteed on every path — a tool that dies mid-write
 * prints none, which is the case this is for; what it cannot do is prove a run
 * finished that did not.
 */
import {
  CHECK_KINDS,
  SCRIPT_FOR_KIND,
  type CheckKind,
  type CheckStep,
  type Counts,
  type Outcome,
  type Scope,
  type TestTally,
} from "./readiness.js";

/**
 * Strip ANSI. Vitest colours everything, and a colourised `✓` will not match a
 * plain one.
 *
 * The character class is spelled with an escape rather than a literal control
 * byte: writing the byte itself produces something grep cannot see and a future
 * reader cannot tell from a space.
 */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

/* ------------------------------------------------------------------ *
 * A check the box refused to start.
 * ------------------------------------------------------------------ */

/**
 * The sentence `vitest-admission.ts` prints when no test was allowed to run.
 * Its words, rather than the outer exit status, are the evidence: `check.ts`
 * quite properly exits 1 because a gate did not run, but that status is not a
 * verdict about the tree.
 */
export function parseAdmissionRefusal(text: string): string | null {
  const line = stripAnsi(text)
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.startsWith("NO TESTS RAN AND NOTHING WAS VERIFIED —"));
  return line ?? null;
}

/**
 * Give an admission refusal precedence over the ordinary exit classification.
 * Exit 1 still belongs on the record as the observed process status, but it no
 * longer gets to say the tree failed when the output says no test ran.
 */
export function outcomeAfterAdmissionRefusal(
  fallback: { outcome: Outcome; why: string | null },
  refusalWhy: string | null,
): { outcome: Outcome; why: string | null } {
  return refusalWhy === null ? fallback : { outcome: "void", why: refusalWhy };
}

/**
 * Find an admission refusal while output streams past, including when its line
 * crosses a chunk boundary. The wrapper cannot wait and search its retained
 * head and tail: in a full `check`, Vitest runs in the middle and later noisy
 * advisories can push this one load-bearing sentence out of both windows.
 */
export function makeAdmissionRefusalCapture(): {
  push(chunk: string): void;
  why(): string | null;
} {
  let tail = "";
  let found: string | null = null;
  return {
    push(chunk) {
      if (found !== null) return;
      const joined = tail + chunk;
      found = parseAdmissionRefusal(joined);
      /* Longer than either refusal line, and bounded independently of how long
         the check runs. It exists only to bridge a line split between chunks. */
      tail = joined.slice(-512);
    },
    why: () => found,
  };
}

/**
 * The two ends of a stream, joined **without counting the middle twice.**
 *
 * Both producers here keep a bounded head and a bounded tail of something they
 * would rather not hold all of. When the whole thing is smaller than the two
 * bounds together, those two windows OVERLAP — and naively concatenating them
 * feeds every line to the parsers twice.
 *
 * That is not cosmetic. It made a typecheck of four projects report eight, and
 * `npm run check`'s summary table would have arrived with every step duplicated.
 * Measured on the wrapper's first real run, 2026-09-09, and it is exactly the
 * class of bug that survives review: the numbers looked plausible.
 *
 * `total` is the length of everything that went past, which only the producer
 * knows. When it fits, the head alone IS everything.
 *
 * **`total` MUST be in the same unit as the strings — JavaScript characters,
 * not bytes.** The backfill first passed `stat.size` and compared it against
 * `head.length`, which reintroduced the doubling for any log with multibyte
 * characters in it: vitest prints `✓` at three bytes and one character, so a
 * small green log has a byte size larger than its character length, neither
 * whole-window branch fires, and the file is concatenated with itself. The same
 * bug, wearing a unit mismatch. GPT Sol's P1.5.
 */
export function joinEnds(head: string, tail: string, totalChars: number): string {
  if (totalChars <= head.length) return head;
  if (totalChars <= tail.length) return tail;
  return `${head}\n…\n${tail}`;
}

/* ------------------------------------------------------------------ *
 * What was run.
 * ------------------------------------------------------------------ */

/**
 * npm prints two banner lines before a script's own output:
 *
 *     > spideryarn@1.0.0 test
 *     > vitest run
 *
 * The first names the script; **the second carries the arguments**, including
 * anything passed after `--`. That second line is the only thing standing
 * between this tab and its easiest lie — `npm test -- tests/one.test.ts` prints
 * the same first line as a full suite and a perfectly normal vitest summary.
 */
export type Banner = {
  kind: CheckKind;
  /** The script name npm printed, even when we map it to `other`. */
  script: string;
  /** The second line, verbatim, without its `> `. Null when npm printed only one. */
  commandLine: string | null;
};

const SCRIPT_LINE = /^>\s+\S+@\S+\s+(\S+)\s*$/;

/**
 * Vitest's own banner, for a run nobody started through npm.
 *
 *      RUN  v4.1.11 /home/greg/code/spideryarn2
 *
 * **Most test runs on this box look like this**, not like `npm test` — agents
 * type `npx vitest run tests/one.test.ts` — so refusing to classify them at all
 * would have made the backfill nearly blind, which is what the first version of
 * it did and what its own fixtures caught.
 *
 * It is recognised as a **test run whose scope is unknown**, which is exactly
 * as much as the banner supports: it could be one file or all 786, and nothing
 * in the log says which. `unknown` scope can never satisfy the readiness
 * verdict, so this adds history without adding a claim. Sol asked for precisely
 * this arm — *"these should be test-run-scope-unknown, never a readiness pass"*.
 */
const VITEST_LINE = /^\s*RUN\s+v\d+\.\d+/m;

export function parseBanner(head: string): Banner | null {
  const clean = stripAnsi(head);
  const lines = clean.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = SCRIPT_LINE.exec(lines[i] ?? "");
    if (match === null) continue;
    const script = match[1] ?? "";
    const next = (lines[i + 1] ?? "").trim();
    const commandLine = next.startsWith("> ") ? next.slice(2).trim() : null;
    const kind =
      (Object.entries(SCRIPT_FOR_KIND).find(([, name]) => name === script)?.[0] as CheckKind | undefined) ??
      "other";
    return { kind, script, commandLine };
  }
  /* Only after npm's, which is strictly more informative: a run started through
     `npm test` prints BOTH banners, and the npm one carries the arguments. */
  if (VITEST_LINE.test(clean)) return { kind: "test", script: "vitest", commandLine: null };
  return null;
}

/**
 * The command body each script runs with no arguments, so a `narrowed` run can
 * be told from a full one.
 *
 * **Read from `package.json` rather than copied here.** A copy is a second
 * source of truth that nothing keeps in step.
 *
 * What this compares is the banner against **that same file**, so it detects
 * arguments npm was given at the call site (`npm test -- one.test.ts`) and NOT a
 * narrowing written into the script itself — if the `test` script grew a path,
 * both sides would carry it and every run would still read `full`. That is a
 * real limit and there is no local evidence that would close it; what would is
 * somebody noticing the script changed.
 */
export function scopeOf(banner: Banner, scriptBodies: Readonly<Record<string, string>>): Scope {
  if (banner.commandLine === null) return "unknown";
  const body = scriptBodies[banner.script];
  if (body === undefined) return "unknown";
  return banner.commandLine.trim() === body.trim() ? "full" : "narrowed";
}

/* ------------------------------------------------------------------ *
 * The exit status.
 * ------------------------------------------------------------------ */

/**
 * The `EXIT=<n>` line `scripts/tmux-job.ts` appends, or null when there is none.
 *
 * **It has to be the LAST non-blank line, not merely the last match.** A check
 * that prints `EXIT=0` in its own output and then carries on — or hangs — would
 * otherwise be read as a completed pass while it was still running. GPT Sol's
 * P1.4. `tmux-job.ts` writes this line and nothing after it, so requiring it to
 * be terminal costs nothing and closes the hole.
 *
 * This does not stand alone: the caller also treats a file whose size changed
 * under the read as still moving, whatever it appears to end with.
 */
export function parseExitLine(text: string): number | null {
  const lines = stripAnsi(text).split("\n");
  let last = lines.length - 1;
  while (last >= 0 && (lines[last] ?? "").trim() === "") last -= 1;
  if (last < 0) return null;
  const match = /^EXIT=(-?\d+)$/.exec((lines[last] ?? "").trim());
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ *
 * Vitest.
 * ------------------------------------------------------------------ */

/**
 * `Test Files  1 failed (1)` / `Tests  1 failed | 4 passed (5)`.
 *
 * The segment before `(N)` is a `|`-separated list of `<n> <word>`, and which
 * words appear depends on what happened — a clean run prints only `passed`. So
 * the words are read rather than positional, and a total that does not appear
 * is null rather than inferred by adding up.
 */
function parseTally(line: string): TestTally | null {
  const match = /^\s*(?:Test Files|Tests)\s+(.+?)\s+\((\d+)\)\s*$/.exec(line);
  if (match === null) return null;
  const total = Number(match[2]);
  if (!Number.isFinite(total)) return null;
  const tally: TestTally = { passed: 0, failed: 0, skipped: 0, total };
  for (const part of (match[1] ?? "").split("|")) {
    const bit = /^\s*(\d+)\s+(passed|failed|skipped|todo)\s*$/.exec(part);
    if (bit === null) continue;
    const n = Number(bit[1]);
    if (bit[2] === "passed") tally.passed = n;
    else if (bit[2] === "failed") tally.failed = n;
    else tally.skipped += n;
  }
  return tally;
}

/**
 * Vitest's summary footer.
 *
 * **Its presence is the evidence, not just its numbers.** A run of the suite
 * that never reached its footer did not finish, whatever its exit status says,
 * and the caller turns a missing footer into `void`.
 */
export function parseVitest(text: string): { counts: Extract<Counts, { kind: "vitest" }>; hasFooter: boolean } {
  const lines = stripAnsi(text).split("\n");
  let files: TestTally | null = null;
  let tests: TestTally | null = null;
  for (const line of lines) {
    if (/^\s*Test Files\s/.test(line)) files = parseTally(line) ?? files;
    else if (/^\s*Tests\s/.test(line)) tests = parseTally(line) ?? tests;
  }
  /* **Both lines, not either.** A process cut between `Test Files` and `Tests`
     has not printed its whole footer, and treating half of one as proof of
     completion is the guard letting through exactly what it exists to catch. */
  return { counts: { kind: "vitest", files, tests }, hasFooter: files !== null && tests !== null };
}

/* ------------------------------------------------------------------ *
 * Typecheck.
 * ------------------------------------------------------------------ */

/**
 * `scripts/typecheck.ts`'s per-project lines and its coverage line.
 *
 * The error count is **supplementary and never the verdict**: that script
 * writes its failures to stderr and still prints its coverage tick afterwards,
 * so a tick and a failure coexist and the exit status is the only thing that
 * decides. Counting them here is for the page to show, not for anything to
 * conclude from.
 */
export function parseTypecheck(text: string): { counts: Extract<Counts, { kind: "typecheck" }>; hasFooter: boolean } {
  const clean = stripAnsi(text);
  const projects = [...clean.matchAll(/^[✓✗]\s+\S*tsconfig\S*\.json\b/gm)].length;
  const errors = [...clean.matchAll(/error TS\d+:/g)].length;
  /* **The coverage line, and only it.** One project line is not a completed
     run — that was `|| projects > 0`, which let a typecheck killed after its
     first project satisfy the completion guard.

     It is not printed on every path: `scripts/typecheck.ts` takes an early
     branch when a project resolves no files at all. That is the right way
     round — a run that skipped it has not been shown to have finished, and
     `void` is what a run we cannot vouch for should be. */
  const hasFooter = /^✓ all \d+ source files are covered by some project\s*$/m.test(clean);
  return {
    counts: { kind: "typecheck", projects: projects === 0 ? null : projects, errors },
    hasFooter,
  };
}

/* ------------------------------------------------------------------ *
 * npm run check.
 * ------------------------------------------------------------------ */

/**
 * `scripts/check.ts`'s summary table:
 *
 *     ✓ typecheck    clean
 *     ✗ test         FAILED
 *     ! complexity   126 finding(s)
 *     ! knip         has findings
 *     ✗ dupes        DID NOT RUN (exit 2)
 *
 * The mark is the only evidence of gate-ness available here, and it is partial
 * on purpose: `✗` is printed only for a failing gate and `!` only for a noisy
 * advisory, but `✓` is printed for both. See `CheckStep.gate` for why that stays
 * a tri-state instead of being defaulted either way.
 */
const CHECK_ROW = /^\s{2}([✓✗!])\s+(\S+)\s+(.+?)\s*$/;

export function parseCheckTable(text: string): { counts: Extract<Counts, { kind: "check" }>; hasFooter: boolean } {
  const clean = stripAnsi(text);
  const steps: CheckStep[] = [];
  for (const line of clean.split("\n")) {
    const match = CHECK_ROW.exec(line);
    if (match === null) continue;
    const [, mark, name, label] = match;
    if (name === undefined || label === undefined) continue;

    let verdict: CheckStep["verdict"];
    let findings: number | null = null;
    if (label === "clean") verdict = "clean";
    else if (label === "FAILED") verdict = "failed";
    else if (label.startsWith("DID NOT RUN")) verdict = "did-not-run";
    else if (label === "has findings") verdict = "findings";
    else {
      const counted = /^(\d+) finding\(s\)$/.exec(label);
      if (counted === null) continue;
      verdict = "findings";
      findings = Number(counted[1]);
    }
    steps.push({
      name,
      gate: mark === "✗" ? "gate" : mark === "!" ? "advisory" : "unknown",
      verdict,
      findings,
    });
  }
  /* The verdict sentence, not the table — `check.ts` prints the table before
     deciding, so a run killed between the two leaves a complete-looking table
     under no conclusion at all. */
  /* `--offline` says "All gates green, minus the database suites." — a real
     conclusion in different words, and one this used not to recognise. */
  const hasFooter = /^(All gates green|A gate failed\.)/m.test(clean);
  return { counts: { kind: "check", steps }, hasFooter };
}

/* ------------------------------------------------------------------ *
 * The one entry point.
 * ------------------------------------------------------------------ */

/**
 * Everything a check's output says, for the kind of check it was.
 *
 * `hasFooter` is separate from the counts because it answers a different
 * question — *did this run reach its own conclusion* — and it is the half that
 * decides whether an `EXIT=0` may be believed.
 */
export function parseOutput(kind: CheckKind, text: string): { counts: Counts; hasFooter: boolean } {
  switch (kind) {
    case "test":
      return parseVitest(text);
    case "typecheck":
      return parseTypecheck(text);
    case "check":
      return parseCheckTable(text);
    case "lint":
    case "build":
    case "other":
      /* No footer we recognise, so `hasFooter` is true rather than false: these
         are judged by exit status alone, and a `false` here would turn every
         one of them into `void`. What must not happen is the reverse — a `test`
         run getting a free pass — and that is why this is a per-kind switch and
         not a default. */
      return { counts: { kind: "none" }, hasFooter: true };
    default: {
      const never: never = kind;
      throw new Error(`unhandled check kind: ${String(never)}`);
    }
  }
}

/** The kinds whose `EXIT=0` we refuse to believe without their own footer. */
export function footerRequired(kind: CheckKind): boolean {
  return kind === "test" || kind === "check" || kind === "typecheck";
}

/** Exported for the test that pins the vocabulary against `package.json`. */
export const KNOWN_KINDS = CHECK_KINDS;

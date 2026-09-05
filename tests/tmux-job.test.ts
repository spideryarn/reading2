/**
 * The job runner that replaces the hand-typed `tmux new-session` recipe.
 *
 * These tests hold the two properties the old recipe did not have, and both are
 * the reason eight abandoned tmux sessions were sitting on the box on
 * 2026-09-05: **a unique name**, so two agents in the same minute do not
 * collide and improvise, and **a session that ends when the command does**,
 * with the exit status in the log rather than only in a pane that is gone.
 *
 * The `jobScript` half is run for real, through `sh`, because the thing under
 * test is a shell string and asserting on its text would only check that it
 * still looks the way it looked. It is the same reason
 * tests/gjd-remote-tmux-script.test.ts exists.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_UNKNOWN } from "../scripts/gjd-remote-repo.js";
import { META, METADATA_VERSION } from "../scripts/gjd-remote-tmux.js";
import { jobName, jobScript, metaArgs } from "../scripts/tmux-job.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tmux-job-"));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Run a job script through a real `sh` and hand back what the log holds. */
function runJob(command: string[], file = "run.log"): string {
  const log = path.join(dir, file);
  execFileSync("sh", ["-c", jobScript(command, log)], { stdio: "ignore" });
  return readFileSync(log, "utf8");
}

describe("jobName", () => {
  const when = new Date(2026, 8, 5, 14, 23);

  /**
   * THE COLLISION THAT CAUSED THE DRIFT. The old recipe in testing.md was
   * `-s gate`, hard-coded, so the second agent to run it got `duplicate
   * session` and made up a name — which is where `gateA` and `stage2base` came
   * from, and why `gjd-remote ls` filled up with rows nobody recognised.
   */
  it("gives two jobs in the same minute different names", () => {
    expect(jobName("/w/deepen-fat-sections", when, 9871)).not.toBe(jobName("/w/deepen-fat-sections", when, 9872));
  });

  it("leads with the directory, so a person can tell whose job it is", () => {
    expect(jobName("/home/greg/code/spideryarn2/.claude/worktrees/deepen-fat-sections", when, 9871)).toBe(
      "deepen-fat-sections-1423-9871",
    );
  });

  it("takes a stem when one is given", () => {
    expect(jobName("/w/anything", when, 12)).toBe("anything-1423-12");
    expect(jobName("/w/anything", when, 12, "evals")).toBe("evals-1423-12");
  });

  /**
   * tmux refuses `.` and `:` in a session name — they are the target
   * separators — and the rest is about not handing a shell something to read.
   */
  it("strips what tmux and a shell would refuse", () => {
    expect(jobName("/w/my.repo:v2", when, 5)).toBe("my-repo-v2-1423-5");
    expect(jobName("/w/it's a name", when, 5)).toBe("it-s-a-name-1423-5");
    expect(jobName("/w/-leading-", when, 5)).toBe("leading-1423-5");
  });

  it("still names a job whose directory has nothing usable in it", () => {
    expect(jobName("/w/!!!", when, 5)).toBe("job-1423-5");
  });

  it("keeps the name short enough to read in a column", () => {
    expect(jobName(`/w/${"x".repeat(120)}`, when, 5)).toBe(`${"x".repeat(32)}-1423-5`);
  });
});

describe("jobScript", () => {
  it("puts the command's output in the log", () => {
    expect(runJob(["printf", "hello\n"], "a.log")).toBe("hello\nEXIT=0\n");
  });

  /**
   * **THE WHOLE POINT.** A run that was killed and a run that passed are
   * indistinguishable from outside — the failure this file exists to prevent,
   * and the one measured on the box on 2026-09-03 where a SIGTERM'd `npm test`
   * was announced as exit 0. The status has to be IN THE LOG, because the pane
   * is gone by the time anybody reads it.
   */
  it("records a non-zero status rather than leaving the log looking finished", () => {
    expect(runJob(["sh", "-c", "printf 'partway\n'; exit 7"], "b.log")).toBe("partway\nEXIT=7\n");
  });

  it("records the status of a command that does not exist", () => {
    expect(runJob(["definitely-not-a-command-here"], "c.log")).toMatch(/\nEXIT=127\n$/);
  });

  it("captures stderr as well, which is where a stack trace goes", () => {
    expect(runJob(["sh", "-c", "printf 'boom\n' >&2; exit 1"], "d.log")).toBe("boom\nEXIT=1\n");
  });

  /**
   * The braces, tested by the case that needs them: without the group, the
   * redirection binds to the first command of a list and the rest of the output
   * goes to the terminal — where nobody is watching, since the pane is
   * detached.
   */
  it("redirects the whole command, not just its first word", () => {
    expect(runJob(["sh", "-c", "printf 'one\n'; printf 'two\n'"], "e.log")).toBe("one\ntwo\nEXIT=0\n");
  });

  it("passes an argument a shell would otherwise split or read", () => {
    expect(runJob(["printf", "%s\n", "two words; rm -rf /"], "f.log")).toBe("two words; rm -rf /\nEXIT=0\n");
    expect(runJob(["printf", "%s\n", "it's"], "g.log")).toBe("it's\nEXIT=0\n");
  });

  it("quotes a log path with a space in it", () => {
    expect(runJob(["printf", "x\n"], "a dir file.log")).toBe("x\nEXIT=0\n");
  });

  /**
   * **THE ONE SOL FOUND IN REVIEW, AND THE WORST OF THEM.** `{ …; }` runs in the
   * wrapper shell, so a command that IS a shell builtin takes the wrapper with
   * it and the `printf` never runs: an empty log, a clean exit, and a session
   * that disappeared exactly as it does on success. Every test above passes
   * over that version, because they all run external commands.
   */
  it("records a status even when the command is the shell builtin `exit`", () => {
    expect(runJob(["exit", "0"], "h.log")).toBe("EXIT=0\n");
    expect(runJob(["exit", "5"], "i.log")).toBe("EXIT=5\n");
  });

  it("records a status when the command execs over the shell", () => {
    expect(runJob(["exec", "printf", "gone\n"], "j.log")).toBe("gone\nEXIT=0\n");
  });

  /**
   * The property behind all of these, stated once: a log that stops without an
   * `EXIT=` line is indistinguishable from a run still in progress, and the
   * session is already gone. Whatever the command does, the line is there.
   */
  it("always ends with an EXIT line", () => {
    const cases: string[][] = [
      ["true"],
      ["false"],
      ["exit", "3"],
      ["exec", "true"],
      ["sh", "-c", "kill -TERM $$"],
      ["definitely-not-a-command-here"],
    ];
    cases.forEach((c, i) => {
      expect(runJob(c, `k${i}.log`), c.join(" ")).toMatch(/(^|\n)EXIT=\d+\n$/);
    });
  });
});

/**
 * The metadata is what stops `gjd-remote ls` saying `(unknown)` about a job.
 * These are `execve` arguments, so they must NOT be shell-quoted — a value
 * arriving with literal apostrophes round it is a row that reads `'unknown'`.
 */
describe("metaArgs", () => {
  it("sets the four variables ls reads back", () => {
    const args = metaArgs("/home/greg/code/spideryarn2", "spideryarn/reading2");
    expect(args).toContain(`${META.version}=${METADATA_VERSION}`);
    expect(args).toContain(`${META.kind}=shell`);
    expect(args).toContain(`${META.repo}=spideryarn/reading2`);
    expect(args).toContain(`${META.dir}=/home/greg/code/spideryarn2`);
  });

  it("does not shell-quote a value that is going straight to execve", () => {
    for (const a of metaArgs("/a dir", "spideryarn/reading2")) expect(a).not.toContain("'");
    expect(metaArgs("/a dir", "spideryarn/reading2")).toContain(`${META.dir}=/a dir`);
  });

  /** Outside a repo there is no slug, and `unknown` is the value `ls` parses. */
  it("says unknown rather than empty when there is no repo", () => {
    expect(metaArgs("/tmp", REPO_UNKNOWN)).toContain(`${META.repo}=${REPO_UNKNOWN}`);
  });

  it("pairs every value with its own -e", () => {
    const args = metaArgs("/x", "a/b");
    expect(args.filter((a) => a === "-e")).toHaveLength(5);
    expect(args).toHaveLength(10);
  });
});

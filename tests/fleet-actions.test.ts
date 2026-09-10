/**
 * The steering vocabulary — tools/fleet/actions.ts.
 *
 * THREE THINGS ARE UNDER TEST HERE, and only the third looks like a normal
 * unit test.
 *
 *  1. **The words are deliverable.** Every spoken action's text goes through
 *     `checkText`, the same function steer.ts will use at send time. A message
 *     with a newline in it is two messages, the first of them half a sentence,
 *     and the place to find that out is here rather than in somebody's session.
 *  2. **The union holds.** `remove worktree` and `exit` must be `enacted` and
 *     must carry no `text`, because a "sentence" that deletes a directory is
 *     the confusion this whole file exists to prevent.
 *  3. **The rules are rules.** "Safe to kill" is a named predicate over a
 *     process record, so it is tested against the shapes `ps` really prints on
 *     this box — captured live on 2026-09-08 and pasted below rather than
 *     invented, because every trap in diagnose-box-resources.md is a trap about
 *     what those strings actually look like.
 *
 * NOTHING HERE RUNS A COMMAND. `plan*` returns argv; no test executes it.
 *
 * On negative assertions: every `toBe(false)` and every "is not killed" below
 * is paired with a positive that says what the answer WAS instead. A test that
 * only asserts an absence passes when the thing it is testing has been deleted.
 */
import { describe, expect, it } from "vitest";

import {
  ACTIONS,
  actionById,
  boxActions,
  describeAction,
  hasDeletedCwd,
  isOrphanedDebugPipeBrowser,
  isUnderWorktreesDir,
  isVitestRunner,
  killVerdict,
  planKillProcesses,
  planKillSession,
  planRemoveWorktree,
  renderBroadcast,
  renderMessage,
  renderSpoken,
  SAFE_KILL_RULES,
  selectForKill,
  sessionActions,
  staggerMinutes,
  type Action,
  type BroadcastAction,
  type EnactedAction,
  type KillContext,
  type ProcRecord,
  type SpokenAction,
} from "../tools/fleet/actions.js";
import type { Speaker } from "../tools/fleet/wire.js";

/**
 * Every arm of `Speaker`, ANNOTATED rather than inferred.
 *
 * The annotation is the mechanism: `readonly Speaker[]` does not force
 * completeness on its own, so the tuple below is checked by
 * `EVERY_SPEAKER_IS_COMPLETE`, which fails to compile if an arm exists that is
 * not listed. A hand-written list of speakers is a list that silently stops
 * being exhaustive, which is exactly what happened before `dashboard` was
 * added — the loop that renders every action for every speaker was iterating
 * two of three.
 */
const EVERY_SPEAKER = ["greg", "overseer", "dashboard"] as const satisfies readonly Speaker[];

/** Compile-time proof that `EVERY_SPEAKER` names every arm, not merely valid ones. */
type EverySpeakerIsComplete = Exclude<Speaker, (typeof EVERY_SPEAKER)[number]> extends never
  ? true
  : ["EVERY_SPEAKER is missing an arm of Speaker", Exclude<Speaker, (typeof EVERY_SPEAKER)[number]>];
const EVERY_SPEAKER_IS_COMPLETE: EverySpeakerIsComplete = true;
void EVERY_SPEAKER_IS_COMPLETE;
import { checkText } from "../tools/fleet/steer.js";

const spoken = (): SpokenAction[] => ACTIONS.filter((a): a is SpokenAction => a.effect === "spoken");
const enacted = (): EnactedAction[] => ACTIONS.filter((a): a is EnactedAction => a.effect === "enacted");

function spokenNamed(id: string): SpokenAction {
  const a = actionById(id);
  if (!a || a.effect !== "spoken") throw new Error(`${id} is not a spoken action`);
  return a;
}

function enactedNamed(id: string): EnactedAction {
  const a = actionById(id);
  if (!a || a.effect !== "enacted") throw new Error(`${id} is not an enacted action`);
  return a;
}

function broadcastNamed(id: string): BroadcastAction {
  const a = actionById(id);
  if (!a || a.effect !== "broadcast") throw new Error(`${id} is not a broadcast action`);
  return a;
}

/* ---------------------------------------------------------------- *
 * The catalogue.
 * ---------------------------------------------------------------- */

describe("the catalogue", () => {
  it("has a unique id for every action, and finds each by it", () => {
    const ids = ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACTIONS) expect(actionById(a.id)).toBe(a);
  });

  it("refuses an id that is not one of ours", () => {
    // The boundary where a JSON body from a browser arrives.
    expect(actionById("rm -rf")).toBeNull();
    expect(actionById("")).toBeNull();
    // Paired positive, so this test still means something if `actionById`
    // started returning null for everything.
    expect(actionById("continue")?.id).toBe("continue");
  });

  it("carries everything Greg asked for on 2026-09-08", () => {
    const wanted = [
      "continue",
      "compact",
      "pull",
      "push",
      "remove-worktree",
      "kill-session",
      "sleep-1h",
      "sleep-3h",
      "sleep-5h",
      "sleep-10h",
      "ask-fable",
      "ask-sol",
      "kill-test-suites",
      "kill-safe-processes",
      "resource-broadcast",
    ];
    for (const id of wanted) expect(actionById(id)?.id).toBe(id);
  });

  it("splits into the session list and the box list, with nothing in both", () => {
    const session = sessionActions().map((a) => a.id);
    const box = boxActions().map((a) => a.id);
    expect(session).toContain("continue");
    expect(box).toContain("kill-test-suites");
    expect(box).toContain("resource-broadcast");
    expect(session.filter((id) => box.includes(id))).toEqual([]);
    expect(session.length + box.length).toBe(ACTIONS.length);
  });

  it("describes every effect, and the union is closed", () => {
    for (const a of ACTIONS) expect(describeAction(a).length).toBeGreaterThan(10);
    expect(describeAction(spokenNamed("continue"))).toContain("a message to one session");
    expect(describeAction(enactedNamed("remove-worktree"))).toContain("whether or not the agent cooperates");
    expect(describeAction(broadcastNamed("resource-broadcast"))).toContain("staggered");
  });
});

/* ---------------------------------------------------------------- *
 * The line between a sentence and an effect.
 * ---------------------------------------------------------------- */

describe("spoken and enacted are different kinds of thing", () => {
  it("makes removing a worktree and exiting effects, not sentences", () => {
    // The load-bearing classification in the whole file. If either of these
    // ever becomes `spoken`, a one-tap button starts *asking* an agent to
    // delete its own worktree, and the deletion silently depends on the agent
    // being alive and cooperative.
    expect(enactedNamed("remove-worktree").effect).toBe("enacted");
    expect(enactedNamed("kill-session").effect).toBe("enacted");
  });

  it("gives an enacted action no text to send, and a spoken one nothing but", () => {
    for (const a of enacted()) {
      expect(Object.hasOwn(a, "text")).toBe(false);
      // The paired positive: it has a gate instead, which is what the person
      // reads before confirming.
      expect(a.gate.length).toBeGreaterThan(40);
      expect(a.needsConfirm).toBe(true);
    }
    for (const a of spoken()) {
      expect(typeof a.text).toBe("string");
      expect(a.text.length).toBeGreaterThan(40);
    }
  });

  it("names the worktree:check trap in the removal's gate", () => {
    // Not decoration: this sentence is what stops somebody replacing the plan's
    // first step with `git worktree remove` because git status looked clean.
    const gate = enactedNamed("remove-worktree").gate;
    expect(gate).toContain("worktree:check");
    expect(gate).toContain("gitignored");
  });
});

/* ---------------------------------------------------------------- *
 * The words themselves.
 * ---------------------------------------------------------------- */

describe("every spoken message can actually be delivered", () => {
  it("passes steer.ts's own checkText, as written", () => {
    for (const a of spoken()) {
      const refusal = checkText(a.text);
      expect(refusal, `${a.id}: ${refusal?.why}`).toBeNull();
    }
  });

  it("still passes it after the speaker prefix is added, for EVERY speaker", () => {
    // The prefix is not free: it is added at delivery, and it counts towards
    // the 4000-character limit.
    //
    // EVERY_SPEAKER is annotated rather than inferred, so adding an arm to
    // `Speaker` without adding it here stops this file compiling. It used to be
    // a hand-written `["greg", "overseer"] as const`, which is a list that
    // silently stops being exhaustive — the `dashboard` arm was added on
    // 2026-09-09 and this loop would not have covered it.
    for (const a of spoken()) {
      for (const speaker of EVERY_SPEAKER) {
        const rendered = renderSpoken(a, speaker);
        expect(checkText(rendered), `${a.id}/${speaker}`).toBeNull();
      }
    }
  });

  it("gives every speaker a prefix that names it, and only Greg an unprefixed slash command", () => {
    const cont = spokenNamed("continue");
    for (const speaker of EVERY_SPEAKER) {
      // Every non-slash rendering must carry SOMETHING that attributes it. An
      // arm added with an empty prefix would otherwise deliver anonymously,
      // which is the one outcome this vocabulary exists to prevent.
      const rendered = renderSpoken(cont, speaker);
      expect(rendered.startsWith("["), `${speaker} renders unattributed`).toBe(true);
    }

    // The slash-command exception is Greg's alone, and a new arm inherits the
    // refusal rather than the exception. Checked for every speaker so that
    // adding one cannot quietly widen the hole.
    for (const speaker of EVERY_SPEAKER) {
      const out = renderMessage("/compact", speaker);
      expect(out.ok, `${speaker} and /compact`).toBe(speaker === "greg");
    }
  });

  it("says nothing is being asked, when nothing is", () => {
    // `dashboard` reports an event; the other two ask for something. If this
    // arm ever carries an instruction the prefix is false and the arm splits —
    // see `Speaker` in wire.ts. This test is what makes that a decision rather
    // than a drift.
    const out = renderMessage("a session was started from the web UI", "dashboard");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("Nobody is asking you for anything");
    expect(out.text).not.toContain("NOT Greg");
  });

  it("says who is speaking, and says when it is not Greg", () => {
    const cont = spokenNamed("continue");
    expect(renderSpoken(cont, "greg")).toContain("Greg");
    const fromOverseer = renderSpoken(cont, "overseer");
    expect(fromOverseer).toContain("NOT Greg");
    expect(fromOverseer).toContain("push back");
    // And both still carry the instruction itself.
    expect(renderSpoken(cont, "greg")).toContain(cont.text);
    expect(fromOverseer).toContain(cont.text);
  });

  it("leaves a slash command unprefixed, because a prefix would stop it running", () => {
    const compact = spokenNamed("compact");
    expect(compact.form).toBe("slash-command");
    const rendered = renderSpoken(compact, "overseer");
    expect(rendered.startsWith("/compact")).toBe(true);
    expect(rendered).toBe(compact.text);
  });

  it("tells a stopped agent what to say before it resumes", () => {
    // "Continue" alone is a weak instruction: the failure mode on this box is
    // an agent confidently continuing the wrong thing.
    const text = spokenNamed("continue").text;
    expect(text).toContain("one sentence");
    expect(text).toContain("If you are actually finished");
  });

  it("names a wait mechanism that works on this box, in every sleep action", () => {
    for (const [id, hours] of [
      ["sleep-1h", 1],
      ["sleep-3h", 3],
      ["sleep-5h", 5],
      ["sleep-10h", 10],
    ] as const) {
      const text = spokenNamed(id).text;
      expect(text).toContain(`about ${hours} hours`);
      // The three measured facts an agent will otherwise rediscover expensively:
      // the Bash cap, the OOM-killed background waiter, and the two one-shots.
      expect(text).toContain("600 seconds");
      expect(text).toContain("OOM-kills background waiters");
      expect(text).toContain("two CronCreate one-shots");
    }
  });

  it("asks for judgment rather than obedience when routing to another model", () => {
    expect(spokenNamed("ask-fable").text).toContain("use your own judgment");
    expect(spokenNamed("ask-fable").text).toContain("arbitrate");
    expect(spokenNamed("ask-sol").text).toContain("use your own judgment");
    // The trap that cost a session a stale review.
    expect(spokenNamed("ask-sol").text).toContain("fresh --output path");
  });

  it("asks the direction question, not just the progress question", () => {
    const text = spokenNamed("report-status").text;
    expect(text).toContain("why you believe that is the task you were given");
    expect(text).toContain("what you need from me");
  });
});

/* ---------------------------------------------------------------- *
 * The stagger.
 * ---------------------------------------------------------------- */

describe("the broadcast is staggered", () => {
  const action = broadcastNamed("resource-broadcast");

  it("spreads thirty-six agents across the whole window, with no two the same", () => {
    const total = 36;
    const minutes = Array.from({ length: total }, (_, i) => staggerMinutes(i, total, action.stagger));
    // The failure this exists to prevent: everybody resuming in the same
    // second. A constant return value gives a set of size 1.
    expect(new Set(minutes).size).toBe(total);
    expect(minutes[0]).toBe(action.stagger.minMinutes);
    expect(minutes[total - 1]).toBe(action.stagger.windowMinutes);
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
  });

  it("never asks anybody to pause for nothing", () => {
    for (const total of [1, 2, 7, 36, 200]) {
      for (let i = 0; i < total; i++) {
        expect(staggerMinutes(i, total, action.stagger)).toBeGreaterThanOrEqual(action.stagger.minMinutes);
        expect(staggerMinutes(i, total, action.stagger)).toBeLessThanOrEqual(action.stagger.windowMinutes);
      }
    }
  });

  it("gives a fleet of one the near end of the window, not the far end", () => {
    expect(staggerMinutes(0, 1, action.stagger)).toBe(5);
  });

  it("still spreads when there are more agents than minutes, and repeats honestly", () => {
    const total = 200;
    const minutes = Array.from({ length: total }, (_, i) => staggerMinutes(i, total, action.stagger));
    // 56 whole minutes are available between 5 and 60, so 200 agents cannot all
    // differ. What must remain true is that the spread is as wide as integers
    // allow, and that it is monotonic.
    expect(new Set(minutes).size).toBe(56);
    expect(minutes[0]).toBe(5);
    expect(minutes[total - 1]).toBe(60);
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
  });

  it("falls back to the near end for an index the caller got wrong", () => {
    expect(staggerMinutes(-1, 10, action.stagger)).toBe(5);
    expect(staggerMinutes(99, 10, action.stagger)).toBe(5);
    expect(staggerMinutes(0.5, 10, action.stagger)).toBe(5);
    // Paired positive: a well-formed index still moves.
    expect(staggerMinutes(9, 10, action.stagger)).toBe(60);
  });

  it("renders a different, deliverable sentence for each recipient", () => {
    const first = renderBroadcast(action, { index: 0, total: 36 }, "greg");
    const last = renderBroadcast(action, { index: 35, total: 36 }, "greg");
    expect(first).toContain("pause for 5 minutes");
    expect(last).toContain("pause for 60 minutes");
    expect(first).not.toBe(last);
    expect(checkText(first)).toBeNull();
    expect(checkText(last)).toBeNull();
  });

  it("tells the recipient the number is deliberate, so it does not round it", () => {
    // Thirty-six agents each rounding 37 to 40 is the stagger undone.
    const text = renderBroadcast(action, { index: 12, total: 36 }, "overseer");
    expect(text).toContain("deliberately different for every agent");
    expect(text).toContain("do not round it");
    expect(text).toContain("NOT Greg");
  });
});

/* ---------------------------------------------------------------- *
 * Plans.
 * ---------------------------------------------------------------- */

const PRIMARY = "/home/greg/code/spideryarn2";
const TREE = "/home/greg/code/spideryarn2/.claude/worktrees/fleet-dashboard-v01";

describe("planRemoveWorktree", () => {
  const action = enactedNamed("remove-worktree");

  it("pairs the directory with the branch before it does anything else", () => {
    // `dir` and `branch` arrive from the page as TWO INDEPENDENT CLAIMS, and
    // nothing downstream puts them back together: step 2 sweeps by branch and
    // step 1 checks by directory, so a stale or mis-rendered row could have the
    // check clear one tree and the sweep remove another. `worktree:sweep`
    // re-runs its own guards, but the dir↔branch pairing is verified nowhere
    // else. Found by the agent that built routes-actions.ts, reading its own
    // work for what could still fire an action nobody intended.
    const out = planRemoveWorktree(action, { dir: TREE, branch: "worktree-fleet-dashboard-v01", primaryDir: PRIMARY });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const [pair] = out.plan.steps;
    expect(pair?.argv).toEqual(["git", "-C", TREE, "rev-parse", "--abbrev-ref", "HEAD"]);
    // Run FROM the primary, ASKING ABOUT the tree — so a directory that has
    // already gone is a failed step rather than a spawn error in a cwd that
    // does not exist.
    expect(pair?.cwd).toBe(PRIMARY);
    expect(pair?.pass).toEqual({ kind: "stdout-has-line", line: "worktree-fleet-dashboard-v01" });
  });

  it("runs the check that git status cannot do, before the removal", () => {
    const out = planRemoveWorktree(action, { dir: TREE, branch: "worktree-fleet-dashboard-v01", primaryDir: PRIMARY });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.steps).toHaveLength(3);
    const [, check, remove] = out.plan.steps;
    expect(check?.argv).toEqual(["npm", "run", "worktree:check"]);
    expect(check?.cwd).toBe(TREE);
    // The step that makes this safe: a non-zero exit stops the plan, and
    // worktree:check exits non-zero for "blocked" AND for "could not look".
    // Since 2026-09-08 that includes a server still listening from inside the
    // tree, which is the case no other guard here can see.
    expect(check?.pass).toEqual({ kind: "exit-zero" });
    expect(remove?.argv).toEqual(["npm", "run", "worktree:sweep", "--", "remove", "--branch", "worktree-fleet-dashboard-v01"]);
    expect(remove?.cwd).toBe(PRIMARY);
    expect(remove?.pass).toEqual({ kind: "exit-zero" });
  });

  it("refuses the primary checkout", () => {
    const out = planRemoveWorktree(action, { dir: PRIMARY, branch: "dev", primaryDir: PRIMARY });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.rule).toBe("never-the-primary-checkout");
  });

  it("refuses a directory that is not under .claude/worktrees/", () => {
    for (const dir of ["/home/greg", "/home/greg/code/spideryarn2/src", "/"]) {
      const out = planRemoveWorktree(action, { dir, branch: "x", primaryDir: PRIMARY });
      expect(out.ok, dir).toBe(false);
      if (!out.ok) expect(out.rule === "not-a-worktree" || out.rule === "never-the-primary-checkout").toBe(true);
    }
    // Paired positive, so this is not passing because everything is refused.
    expect(planRemoveWorktree(action, { dir: TREE, branch: "x", primaryDir: PRIMARY }).ok).toBe(true);
  });

  it("refuses a relative path and a branch name that is really a flag", () => {
    expect(planRemoveWorktree(action, { dir: ".claude/worktrees/x", branch: "b", primaryDir: PRIMARY }).ok).toBe(false);
    const flag = planRemoveWorktree(action, { dir: TREE, branch: "--force", primaryDir: PRIMARY });
    expect(flag.ok).toBe(false);
    if (!flag.ok) expect(flag.rule).toBe("bad-input");
    const spaced = planRemoveWorktree(action, { dir: TREE, branch: "a b", primaryDir: PRIMARY });
    expect(spaced.ok).toBe(false);
  });

  it("refuses to be handed the wrong action", () => {
    const out = planRemoveWorktree(enactedNamed("kill-session"), { dir: TREE, branch: "b", primaryDir: PRIMARY });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toContain("kill-session");
  });

  it("knows a worktree path from a look-alike", () => {
    expect(isUnderWorktreesDir(TREE)).toBe(true);
    expect(isUnderWorktreesDir(`${TREE}/src/deep`)).toBe(true);
    expect(isUnderWorktreesDir("/home/greg/code/spideryarn2/.claude/worktrees")).toBe(false);
    expect(isUnderWorktreesDir("/home/greg/.claude/projects/x")).toBe(false);
  });
});

describe("planKillSession", () => {
  const action = enactedNamed("kill-session");

  it("binds the name to the tmux handle before it kills anything by name", () => {
    const out = planKillSession(action, { name: "arch-a5-mode-surface", sessionId: "$1643", primaryDir: PRIMARY });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const [verify, kill] = out.plan.steps;
    expect(verify?.argv).toEqual(["tmux", "list-sessions", "-F", "#{session_id} #{session_name}"]);
    // Names are reassigned when a session dies. This is the whole guard.
    expect(verify?.pass).toEqual({ kind: "stdout-has-line", line: "$1643 arch-a5-mode-surface" });
    expect(kill?.argv).toEqual(["npx", "tsx", "scripts/gjd-remote.ts", "kill", "arch-a5-mode-surface"]);
    expect(kill?.cwd).toBe(PRIMARY);
  });

  it("does not grow a second way to kill a session", () => {
    const out = planKillSession(action, { name: "x", sessionId: "$1", primaryDir: PRIMARY });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const argvs = out.plan.steps.map((s) => s.argv.join(" "));
    expect(argvs.some((a) => a.includes("gjd-remote.ts kill"))).toBe(true);
    expect(argvs.some((a) => a.includes("tmux kill-session"))).toBe(false);
  });

  it("refuses a name or handle that would not survive the command line", () => {
    for (const bad of [
      { name: "-x", sessionId: "$1" },
      { name: "has space", sessionId: "$1" },
      { name: "", sessionId: "$1" },
      { name: "ok", sessionId: "1643" },
      { name: "ok", sessionId: "%1643" },
    ]) {
      const out = planKillSession(action, { ...bad, primaryDir: PRIMARY });
      expect(out.ok, JSON.stringify(bad)).toBe(false);
      if (!out.ok) expect(out.rule).toBe("bad-input");
    }
    expect(planKillSession(action, { name: "ok", sessionId: "$1", primaryDir: PRIMARY }).ok).toBe(true);
  });
});

describe("planKillProcesses", () => {
  const action = enactedNamed("kill-test-suites");

  it("signals a list of pids, one step each, and TERM rather than KILL", () => {
    const out = planKillProcesses(action, { pids: [3811521, 3950341], cwd: PRIMARY });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.steps.map((s) => s.argv)).toEqual([
      ["kill", "-TERM", "3811521"],
      ["kill", "-TERM", "3950341"],
    ]);
    // "Already gone" is the ordinary case between the scan and the signal, and
    // must not abandon the rest of the list.
    for (const step of out.plan.steps) expect(step.pass).toEqual({ kind: "best-effort" });
  });

  it("refuses a pid that is really a process group", () => {
    // `kill -TERM -1` signals every process the user may signal, which here is
    // the whole fleet. The batch is refused rather than filtered: a caller that
    // handed us a -1 does not know what it is holding.
    const out = planKillProcesses(action, { pids: [123, -1], cwd: PRIMARY });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.rule).toBe("bad-input");
    expect(planKillProcesses(action, { pids: [123], cwd: PRIMARY }).ok).toBe(true);
  });

  it("refuses pid 1 and an empty list", () => {
    expect(planKillProcesses(action, { pids: [1], cwd: PRIMARY }).ok).toBe(false);
    const none = planKillProcesses(action, { pids: [], cwd: PRIMARY });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.rule).toBe("no-pids");
  });
});

/* ---------------------------------------------------------------- *
 * "Safe to kill", against what ps really prints on this box.
 * ---------------------------------------------------------------- */

/**
 * Every `args` string below was captured from this box on 2026-09-08 with
 * `ps -eo pid=,ppid=,rss=,etimes=,comm=,args=`. The comm values are real too,
 * including the truncations: the kernel cuts comm at 15 characters, so the
 * tmux server is `tmux: server`, a supabase postgres wrapper is
 * `.postgres-wrapp`, and the node running vitest is `node-MainThread`.
 */
function proc(over: Partial<ProcRecord>): ProcRecord {
  return {
    pid: 5000,
    ppid: 4000,
    comm: "node",
    args: "node index.js",
    cwd: "/home/greg/code/spideryarn2",
    rssKiB: 1024,
    etimeSeconds: 60,
    ...over,
  };
}

/** Self is 9000, its parent 8000, its grandparent 7000. Nothing else is kin. */
const CTX: KillContext = { selfPid: 9000, parents: new Map([[9000, 8000], [8000, 7000], [7000, 2]]) };

const VITEST_NODE = proc({
  pid: 3811521,
  ppid: 3811520,
  comm: "node-MainThread",
  args: "node /home/greg/code/spideryarn2/.claude/worktrees/glossary-order-touch/node_modules/.bin/vitest run",
  rssKiB: 577548,
  etimeSeconds: 1565,
});

const VITEST_SH = proc({ pid: 3811520, ppid: 3811486, comm: "sh", args: "sh -c vitest run", rssKiB: 1816 });

/** A live MCP server with `--browser chrome` in its arguments. Not a browser. */
const PLAYWRIGHT_MCP = proc({
  pid: 83304,
  ppid: 82167,
  comm: "npm",
  args: "npm exec @playwright/mcp@0.0.80 --headless --isolated --browser chrome --executable-path /usr/bin/google-chrome-stable",
});

describe("what may be killed, and what may never be", () => {
  it("kills a vitest runner under the test-suites policy, and nothing else", () => {
    const v = killVerdict(VITEST_NODE, "test-suites", CTX);
    expect(v.kill).toBe(true);
    if (v.kill) expect(v.rule).toBe("vitest-runner");

    // The same process is NOT killed by the safe-to-kill sweep: its worktree is
    // alive and somebody is waiting on the run. Paired with the reason, so this
    // does not pass by the predicate having vanished.
    const s = killVerdict(VITEST_NODE, "safe-to-kill", CTX);
    expect(s.kill).toBe(false);
    if (!s.kill) expect(s.refusal).toBe("no-rule-matched");
  });

  it("takes the node and leaves the sh that is waiting on it", () => {
    // Killing the `sh -c` would orphan the node; killing the node makes the sh
    // exit by itself.
    expect(isVitestRunner(VITEST_NODE)).toBe(true);
    expect(isVitestRunner(VITEST_SH)).toBe(false);
    const v = killVerdict(VITEST_SH, "test-suites", CTX);
    expect(v.kill).toBe(false);
    if (!v.kill) expect(v.refusal).toBe("no-rule-matched");
  });

  it("does not mistake vim's vitest-path argument for the executable", () => {
    expect(isVitestRunner(proc({ comm: "vim", args: "vim /repo/node_modules/.bin/vitest" }))).toBe(false);
  });

  it("does not mistake grep's vitest entry-point argument for the executable", () => {
    expect(isVitestRunner(proc({ comm: "grep", args: "grep x /repo/node_modules/vitest/vitest.mjs" }))).toBe(false);
  });

  it("does not mistake cat's vitest dist-file argument for the executable", () => {
    expect(isVitestRunner(proc({ comm: "cat", args: "cat /repo/node_modules/vitest/dist/index.js" }))).toBe(false);
  });

  it("does not mistake an unrelated node script's vitest-path argument for its executable", () => {
    expect(
      isVitestRunner(proc({ args: "node /repo/scripts/something.mjs /repo/node_modules/.bin/vitest" })),
    ).toBe(false);
  });

  it("does not look past Node's stdin script marker for a Vitest path", () => {
    expect(isVitestRunner(proc({ args: "node - /repo/node_modules/.bin/vitest" }))).toBe(false);
  });

  it("refuses vim with a vitest-path argument under the test-suites policy", () => {
    const verdict = killVerdict(
      proc({ comm: "vim", args: "vim /repo/node_modules/.bin/vitest" }),
      "test-suites",
      CTX,
    );

    expect(verdict.kill).toBe(false);
    if (!verdict.kill) expect(verdict.refusal).toBe("no-rule-matched");
  });

  it("recognises only direct or node-launched vitest executable positions", () => {
    expect(
      isVitestRunner(
        proc({
          args: "node /home/greg/code/spideryarn2/.claude/worktrees/x/node_modules/.bin/vitest run tests/a.test.ts",
        }),
      ),
    ).toBe(true);
    expect(
      isVitestRunner(
        proc({
          args: "/usr/bin/node --experimental-import-meta-resolve --require /home/greg/code/spideryarn2/.claude/worktrees/x/node_modules/vitest/suppress-warnings.cjs --conditions node --conditions development /home/greg/code/spideryarn2/.claude/worktrees/x/node_modules/vitest/dist/workers/forks.js",
        }),
      ),
    ).toBe(true);
    expect(isVitestRunner(proc({ args: "/repo/node_modules/.bin/vitest run" }))).toBe(true);
  });

  it("does not mistake a Node option value for the Vitest executable position", () => {
    const titledEval = proc({
      args: "node --title /repo/node_modules/.bin/vitest -e setInterval(()=>{},1000)",
    });

    expect(isVitestRunner(titledEval)).toBe(false);
    const verdict = killVerdict(titledEval, "test-suites", CTX);
    expect(verdict.kill).toBe(false);
    if (!verdict.kill) expect(verdict.refusal).toBe("no-rule-matched");

    expect(
      isVitestRunner(proc({ args: "node --title census /repo/node_modules/.bin/vitest --version" })),
    ).toBe(true);
  });

  it.each([
    "node --inspect /repo/node_modules/.bin/vitest run",
    "nodejs --require=x /repo/node_modules/.bin/vitest run",
    "node --require x --import y --conditions development /repo/node_modules/.bin/vitest run",
    "node -- /repo/node_modules/.bin/vitest run",
    "node /repo␣with␣space/node_modules/.bin/vitest run",
  ])("keeps the real Node-launched executable position in %s", (args) => {
    expect(isVitestRunner(proc({ args }))).toBe(true);
  });

  it("refuses an unrecognised bare Node option rather than guessing its arity", () => {
    expect(
      isVitestRunner(
        proc({ args: "node --future-option /repo/node_modules/.bin/vitest -e setInterval(()=>{},1000)" }),
      ),
    ).toBe(false);
  });

  it("does not skip a real script after an unrecognised boolean Node option", () => {
    const nonVitest = proc({
      args: "node --abort-on-uncaught-exception /repo/node_modules/typescript/lib/tsc.js /repo/node_modules/.bin/vitest",
    });

    expect(isVitestRunner(nonVitest)).toBe(false);
    const verdict = killVerdict(nonVitest, "test-suites", CTX);
    expect(verdict.kill).toBe(false);
    if (!verdict.kill) expect(verdict.refusal).toBe("no-rule-matched");
  });

  it("normalises the executable path before deciding that it is inside Vitest", () => {
    expect(
      isVitestRunner(
        proc({ args: "node /repo/node_modules/vitest/dist/../../typescript/lib/tsc.js --version" }),
      ),
    ).toBe(false);
    expect(isVitestRunner(proc({ args: "node /repo/node_modules/vitest/dist/cli.js --version" }))).toBe(true);
  });

  it("does not kill a process merely because 'vitest' appears in its arguments", () => {
    // The trap diagnose-box-resources.md names: pgrep -f matches command lines,
    // not programs. An agent editing the config, or grepping for it, is not a
    // test run.
    const editing = proc({ args: "node /home/greg/.../bin/tsx scripts/x.ts --config vitest.config.ts" });
    expect(isVitestRunner(editing)).toBe(false);
    const grepping = proc({ comm: "grep", args: "grep -rn vitest tools/fleet" });
    const v = killVerdict(grepping, "test-suites", CTX);
    expect(v.kill).toBe(false);
    if (!v.kill) expect(v.refusal).toBe("no-rule-matched");
    // And the real thing still matches, so the rule has not simply gone silent.
    expect(isVitestRunner(VITEST_NODE)).toBe(true);
  });

  it("never kills a Claude, even one whose working directory has been deleted", () => {
    // This is the ordering assertion: the refusals are checked BEFORE the
    // rules, so a process that matches `cwd-deleted` perfectly is still
    // refused for being somebody's agent.
    const orphanedAgent = proc({
      pid: 82167,
      comm: "claude",
      args: "claude --session-id 117e181a-155b-435a-b95b-e74220678d1a --name adversarial-fixtures",
      cwd: "/home/greg/code/spideryarn2/.claude/worktrees/gone (deleted)",
    });
    expect(hasDeletedCwd(orphanedAgent.cwd)).toBe(true);
    const v = killVerdict(orphanedAgent, "safe-to-kill", CTX);
    expect(v.kill).toBe(false);
    if (!v.kill) expect(v.refusal).toBe("protected-program");
  });

  it("never kills the terminal multiplexer or a database, whatever their comm was truncated to", () => {
    const tmux = proc({ comm: "tmux: server", args: "tmux new-session -d -s s-0831-1500" });
    const pg = proc({ comm: ".postgres-wrapp", args: "postgres -D /var/lib/postgresql/data" });
    for (const p of [tmux, pg]) {
      const v = killVerdict(p, "safe-to-kill", CTX);
      expect(v.kill).toBe(false);
      if (!v.kill) expect(v.refusal).toBe("protected-program");
    }
  });

  it("never kills itself or something it is running inside", () => {
    const ancestor = proc({ pid: 7000, comm: "node", args: "node tools/fleet/server.ts", cwd: "/tmp/x (deleted)" });
    const self = proc({ pid: 9000, comm: "node", args: "node tools/fleet/server.ts", cwd: "/tmp/x (deleted)" });
    for (const p of [ancestor, self]) {
      const v = killVerdict(p, "safe-to-kill", CTX);
      expect(v.kill).toBe(false);
      if (!v.kill) expect(v.refusal).toBe("self-or-ancestor");
    }
    // A stranger with the same deleted cwd IS killed, which is what makes the
    // two assertions above about kinship rather than about the cwd rule.
    const stranger = proc({ pid: 6000, cwd: "/tmp/x (deleted)" });
    expect(killVerdict(stranger, "safe-to-kill", CTX).kill).toBe(true);
  });

  it("never signals pid 1 or a process group", () => {
    for (const pid of [1, 0, -1]) {
      const v = killVerdict(proc({ pid, cwd: "/tmp/x (deleted)" }), "safe-to-kill", CTX);
      expect(v.kill, String(pid)).toBe(false);
      if (!v.kill) expect(v.refusal).toBe("pid-out-of-range");
    }
  });

  it("tells a browser nothing can reconnect to from one a session can", () => {
    const pipe = proc({ pid: 40001, ppid: 1, comm: "chrome", args: "/usr/bin/chrome --headless --remote-debugging-pipe" });
    const port = proc({ pid: 40002, ppid: 1, comm: "chrome", args: "/usr/bin/chrome --headless --remote-debugging-port=9222" });

    expect(isOrphanedDebugPipeBrowser(pipe)).toBe(true);
    const killed = killVerdict(pipe, "safe-to-kill", CTX);
    expect(killed.kill).toBe(true);
    if (killed.kill) expect(killed.rule).toBe("orphaned-debug-pipe-browser");

    // The port variant outlives its launcher ON PURPOSE and a live session can
    // reattach — on 2026-09-04 an orphaned-looking browser turned out to belong
    // to a session with 15 live processes.
    const spared = killVerdict(port, "safe-to-kill", CTX);
    expect(spared.kill).toBe(false);
    if (!spared.kill) expect(spared.refusal).toBe("no-rule-matched");
  });

  it("does not mistake an MCP server for a browser", () => {
    // 162 "chrome" processes were counted this way on 2026-09-04; the real
    // figure was 46, and killing on the first number would have broken every
    // agent's browser tooling.
    expect(PLAYWRIGHT_MCP.args).toContain("--browser chrome");
    expect(isOrphanedDebugPipeBrowser(PLAYWRIGHT_MCP)).toBe(false);
    const v = killVerdict(PLAYWRIGHT_MCP, "safe-to-kill", CTX);
    expect(v.kill).toBe(false);
    if (!v.kill) expect(v.refusal).toBe("no-rule-matched");
  });

  it("spares a chrome crashpad handler, which is not a browser", () => {
    const crashpad = proc({ pid: 40003, ppid: 1, comm: "chrome_crashpad", args: "/usr/bin/chrome_crashpad_handler --remote-debugging-pipe" });
    expect(isOrphanedDebugPipeBrowser(crashpad)).toBe(false);
    const v = killVerdict(crashpad, "safe-to-kill", CTX);
    expect(v.kill).toBe(false);
    if (!v.kill) expect(v.refusal).toBe("no-rule-matched");
  });

  it("only ever kills under a rule that has a name", () => {
    const scan = [VITEST_NODE, VITEST_SH, PLAYWRIGHT_MCP, proc({ pid: 6000, cwd: "/tmp/x (deleted)" })];
    const safe = selectForKill(scan, "safe-to-kill", CTX);
    expect(safe.map((s) => s.pid)).toEqual([6000]);
    expect(SAFE_KILL_RULES).toContain(safe[0]?.rule);

    const suites = selectForKill(scan, "test-suites", CTX);
    expect(suites.map((s) => s.pid)).toEqual([3811521]);
    expect(suites[0]?.rule).toBe("vitest-runner");
  });

  it("reads the kernel's deleted marker only at the end of the path", () => {
    expect(hasDeletedCwd("/home/greg/gone (deleted)")).toBe(true);
    // A directory a person actually named that is not deleted.
    expect(hasDeletedCwd("/home/greg/notes (deleted)/live")).toBe(false);
    expect(hasDeletedCwd("/home/greg/code")).toBe(false);
    expect(hasDeletedCwd(null)).toBe(false);
  });
});

/* ---------------------------------------------------------------- *
 * A caller cannot confuse the two kinds. This is a type test as much as a
 * runtime one: it fails to COMPILE if the union collapses.
 * ---------------------------------------------------------------- */

describe("the union is what stops a deletion being sent as a sentence", () => {
  it("makes the effect the only way to reach the text", () => {
    const deliverable: string[] = [];
    const commands: string[] = [];
    for (const action of ACTIONS as readonly Action[]) {
      switch (action.effect) {
        case "spoken":
          deliverable.push(action.text);
          break;
        case "enacted":
          // There is no `action.text` here, and adding one would be a compile
          // error rather than a silently sendable deletion.
          commands.push(action.gate);
          break;
        case "broadcast":
          deliverable.push(renderBroadcast(action, { index: 0, total: 2 }, "greg"));
          break;
      }
    }
    expect(deliverable).toHaveLength(spoken().length + 1);
    expect(commands).toHaveLength(enacted().length);
    for (const text of deliverable) expect(checkText(text)).toBeNull();
  });
});

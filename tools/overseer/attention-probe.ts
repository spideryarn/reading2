/**
 * The one thing in the attention pass that touches the machine: read tmux.
 *
 * Split out for the same reason as `work-probe.ts` — the classifier is pure over
 * captured panes and can be tested against the box's stranger days; this is a
 * thin adapter over two tmux calls and is tested against the box it is running
 * on. If it grows a decision, the decision is in the wrong file.
 *
 * ## Where the session list comes from, and the seam
 *
 * **The daemon does not use this.** Inside the daemon the sessions come from the
 * register, which is folded from the dashboard's own snapshot, because *there is
 * one collector on this box and it is not ours*
 * (docs/project/orchestrator-direction.md § Two tenses). This function exists so
 * `overseer attention` can be run against the live fleet without a healthy
 * daemon and without the dashboard — which is what an evaluation needs, since an
 * evaluation that could only run when everything else was working would be an
 * evaluation of everything else.
 *
 * `tmux list-sessions` is one call and costs nothing; the thing the direction
 * doc forbids duplicating is the ~12 seconds of grepping thirty-five
 * transcripts, which nothing here does.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { capturePane } from "../fleet/pane.js";
import type { SessionToScan } from "./attention-pass.js";

/**
 * Every live tmux session, with the pane its first window is showing.
 *
 * `#{pane_id}` on a `list-sessions` format is the session's CURRENT pane, which
 * is the one a person looking at that session would see, and is what the whole
 * pane-reading approach is about.
 */
export function listSessions(): readonly SessionToScan[] {
  const out = execFileSync("tmux", ["list-sessions", "-F", "#{session_id}\t#{session_name}\t#{pane_id}"], {
    encoding: "utf8",
    // A tmux server under load is still a tmux server; a hang here would hold a
    // tick open, and a tick that cannot end is worse than a pass that skipped.
    timeout: 10_000,
  });
  const sessions: SessionToScan[] = [];
  for (const line of out.split("\n")) {
    if (line.trim() === "") continue;
    const [sessionId, sessionName, paneId] = line.split("\t");
    if (sessionId === undefined || sessionName === undefined) continue;
    sessions.push({ sessionId, sessionName, paneId: paneId === undefined || paneId === "" ? null : paneId });
  }
  return sessions;
}

/**
 * Read one pane — `pane.ts`'s own capture, reused rather than re-derived.
 *
 * It takes the VISIBLE SCREEN and no scrollback, and for a Claude Code pane
 * there is nothing else to take: the harness draws on the terminal's alternate
 * screen, which has no scrollback at all. Measured on this box on 2026-09-08 —
 * `tmux capture-pane -p -S -80` and a bare `capture-pane -p` returned the same
 * ~25 to ~31 lines for every live Claude session. So the floor on what this
 * approach can see is the harness's, not the flag's, and asking for scrollback
 * would only have made it look as though we had tried.
 */
export { capturePane };

/**
 * The tmux server's own pid — the GENERATION these session handles belong to.
 *
 * **Half of a session's identity, and the half that makes a wait trustworthy.**
 * `$1991` is stable within one tmux server and handed out again from `$0` by the
 * next, which this repo already treats as the generation: `ObservedSnapshot`
 * carries `tmuxServerPid` and diff.ts refuses to diff two snapshots that
 * disagree on it, because they describe different worlds.
 *
 * It belongs in the attention memory's epoch for exactly that reason, on GPT
 * Sol's second round. A daemon can outlive a tmux restart — `Restart=always` is
 * on the daemon, not on tmux — and after one, `$1` names a different session
 * entirely. A per-process epoch would have kept the waits across that, and
 * published a duration measured on somebody else's question.
 *
 * `null` when tmux cannot be asked, which is honest and lands in the epoch as a
 * value that will not match a real one — so the waits are dropped, which is the
 * safe direction.
 */
export function tmuxServerGeneration(): number | null {
  try {
    const out = execFileSync("tmux", ["display-message", "-p", "#{pid}"], { encoding: "utf8", timeout: 10_000 });
    const pid = Number(out.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Save what a pass read, and read it back.
 *
 * **This is not a test convenience; it is what makes the stage's claim
 * checkable.** The stage is scored by comparing this classifier against an
 * independent model's cold read of the same panes, and a fleet of thirty agents
 * changes underneath you: a pass at 13:40 and a read at 13:55 are two different
 * fleets, and every disagreement between them would be ambiguous between *the
 * classifier was wrong* and *the box moved*. So the panes are captured ONCE, to
 * disk, and both readers are given the same bytes.
 *
 * It is also how a surprising pass gets reproduced later, which is worth more
 * than the evaluation: `--panes <dir>` re-runs a pass over a fleet that no
 * longer exists.
 *
 * One file per session, named by its tmux id, plus a `sessions.json` naming
 * them. Written verbatim — no cleaning, no stripping — so what a later reader
 * sees is what tmux said.
 */
export type CapturedFleet = { sessions: readonly SessionToScan[]; captures: ReadonlyMap<string, string> };

export function captureFleet(sessions: readonly SessionToScan[], dir: string): CapturedFleet {
  mkdirSync(dir, { recursive: true });
  const captures = new Map<string, string>();
  for (const session of sessions) {
    if (session.paneId === null) continue;
    let text: string;
    try {
      text = capturePane(session.paneId);
    } catch {
      // Skipped rather than written as "": a pane that went away between the
      // listing and the read is a session that went away, and an empty file
      // would replay as a blank pane, which is a different thing entirely.
      continue;
    }
    captures.set(session.sessionId, text);
    writeFileSync(join(dir, `${paneFileName(session.sessionId)}.txt`), text, "utf8");
  }
  writeFileSync(join(dir, "sessions.json"), `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
  return { sessions, captures };
}

export function readCapturedFleet(dir: string): CapturedFleet {
  const sessions = JSON.parse(readFileSync(join(dir, "sessions.json"), "utf8")) as SessionToScan[];
  const captures = new Map<string, string>();
  for (const session of sessions) {
    try {
      captures.set(session.sessionId, readFileSync(join(dir, `${paneFileName(session.sessionId)}.txt`), "utf8"));
    } catch {
      // The capture failed when it was taken. Replaying must reproduce that, not
      // paper over it, so the session stays in the list with nothing behind it
      // and the pass counts it as a failed capture exactly as it did live.
    }
  }
  return { sessions, captures };
}

/** tmux ids start with `$`, which is fine in a filename and unkind in a shell. */
function paneFileName(sessionId: string): string {
  return sessionId.replace(/^\$/, "s");
}

/** Nothing at module scope does anything, so importing this file costs nothing. */

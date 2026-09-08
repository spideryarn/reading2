/**
 * Delivering a keystroke to a session — tools/fleet/steer.ts.
 *
 * **THE REFUSALS ARE THE PRODUCT, so they are most of this file.** The happy
 * path is two lines of argv; everything else here is a way the box could be
 * different from the page that a person is tapping, and each one has a test
 * whose real assertion is `sentNothing`. A guard that returns a refusal object
 * and sends anyway would pass a test that only looked at `ok`.
 *
 * NOTHING HERE TOUCHES tmux. Every test drives a fake `SteerIo` built from
 * strings in the shape the real commands print, so the parsing of those strings
 * is under test too — a fake that handed back ready-made records would test
 * everything except the code that reads the box. The one thing a fake cannot
 * prove is that the strings are the shape tmux really prints, and that was
 * established live: see the module's header and the report of the throwaway
 * `wf-steer-` session.
 *
 * The dialog fixtures are the same real captures tests/fleet-pane.test.ts uses.
 * Answering a question is defined against what the parser actually produces
 * rather than against a hand-written question, because a hand-written one would
 * keep passing after the parser changed shape.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { paneSurface, parsePane, type OptionKey } from "../tools/fleet/pane.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import {
  answerQuestion,
  argvOf,
  candidatePids,
  checkText,
  describeSend,
  descendsFrom,
  isClaudeForSession,
  keysFor,
  parseParents,
  parsePanes,
  sameQuestion,
  sendMessage,
  steerableStatus,
  type SeenQuestion,
  type SteerIo,
  type SteerResult,
  type SteerTarget,
} from "../tools/fleet/steer.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/fleet-panes");
const fixture = (name: string): string => readFileSync(path.join(FIXTURES, `${name}.txt`), "utf8");

function question(name: string): SeenQuestion {
  const q = parsePane(fixture(name));
  if (q.kind !== "question") throw new Error(`${name} is not a question`);
  return q;
}

/* ---------------------------------------------------------------- *
 * A box, in the shapes the real commands print.
 * ---------------------------------------------------------------- */

const UUID = "117e181a-155b-435a-b95b-e74220678d1a";
const OTHER_UUID = "76667309-a22a-477c-af3b-4f16d1ce0cf0";

/** `%10` is ours, in session `$5`, running pid 100. `%11` belongs to somebody else. */
const PANES = ["%10|$5|100|0|0", "%11|$6|300|0|0", ""].join("\n");
/** pid 200 (our Claude) is a child of 100; pid 400 is a child of the other pane. */
const PARENTS = ["    1     0", "  100     1", "  200   100", "  300     1", "  400   300", ""].join("\n");
const PGREP = `200 claude --session-id ${UUID} --name fleet-dashboard-v01\n`;

/**
 * The default screen: a real capture of a session that is working, with its
 * input box on it.
 *
 * It was `""` until 2026-09-08, and a blank string is now a refusal — Sol's F2
 * made `sendMessage` require a positively recognised input surface, and an
 * empty capture is the absence of one. That is the point: every happy path in
 * this file now goes through a screen a real Claude Code actually drew.
 */
const AT_PROMPT = "none-working-empty-prompt";

const TARGET: SteerTarget = { paneId: "%10", sessionId: "$5", claudeSessionId: UUID, panePid: 100 };
const WORKING: FleetStatus = { kind: "working" };
const NEEDS_YOU: FleetStatus = { kind: "needs-you" };

/** argv as `/proc/<pid>/cmdline` really holds it: NUL between, NUL at the end. */
function procCmdline(...argv: string[]): string {
  return `${argv.join("\0")}\0`;
}

/**
 * `/proc` from a pgrep line, which is what the two really are on a live box.
 *
 * pgrep prints argv joined by spaces, so the only faithful default is to split
 * it back on spaces — and the fact that this round trip is LOSSY is Sol's F3 in
 * one line. A test that wants the two to disagree passes `cmdlines` explicitly,
 * which is the only way to write an argument with a space in it.
 */
function cmdlinesFromPgrep(pgrepOut: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of pgrepOut.split("\n")) {
    const m = /^(\d+) (.+)$/.exec(line.trim());
    if (!m) continue;
    out.set(Number(m[1]), procCmdline(...(m[2] ?? "").split(" ")));
  }
  return out;
}

type Box = {
  panes?: string;
  parents?: string;
  pgrep?: string;
  capture?: string;
  /** argv per pid, overriding what the pgrep line would flatten to. `null` = gone. */
  cmdlines?: Record<number, string[] | null>;
  /**
   * What `~/.claude/sessions/<pid>.json` holds, if anything. `undefined` means
   * there is no such file, which is the DEFAULT and is not a refusal — see
   * `shelledOut` in steer.ts for why that asymmetry is deliberate.
   */
  sessionState?: string;
  /** Make one of the reads fail the way an absent or angry command does. */
  throwOn?: "panes" | "parents" | "pgrep" | "capture" | "cmdline" | "send" | "sessionState";
  /** Which send call fails (0-based), and with what. */
  failSend?: { at: number; error: unknown };
};

function fakeBox(box: Box = {}): { io: SteerIo; sent: string[][] } {
  const sent: string[][] = [];
  const boom = (what: string) => {
    throw new Error(`${what}: no such thing`);
  };
  const derived = cmdlinesFromPgrep(box.pgrep ?? PGREP);
  const failSend = box.failSend ?? (box.throwOn === "send" ? { at: 0, error: new Error("send-keys: no such thing") } : null);

  const io: SteerIo = {
    listPanes: () => (box.throwOn === "panes" ? boom("tmux") : (box.panes ?? PANES)),
    processParents: () => (box.throwOn === "parents" ? boom("ps") : (box.parents ?? PARENTS)),
    claudeCandidates: () => (box.throwOn === "pgrep" ? boom("pgrep") : (box.pgrep ?? PGREP)),
    capture: () => (box.throwOn === "capture" ? boom("capture-pane") : (box.capture ?? fixture(AT_PROMPT))),
    cmdline: (pid) => {
      if (box.throwOn === "cmdline") boom("/proc");
      const override = box.cmdlines?.[pid];
      if (override !== undefined) return override === null ? null : procCmdline(...override);
      return derived.get(pid) ?? null;
    },
    claudeSessionState: () => {
      if (box.throwOn === "sessionState") boom("/home/greg/.claude/sessions");
      return box.sessionState ?? null;
    },
    sendKeys: (args) => {
      if (failSend && sent.length === failSend.at) throw failSend.error;
      sent.push([...args]);
    },
  };
  return { io, sent };
}

/**
 * Every refusal must be a refusal AND a silence. Asserting only `ok` is not
 * enough, and since 2026-09-08 neither is asserting silence: a refusal now also
 * states how much got through, and `none` is a claim that has to be made rather
 * than a field that can be left off. Sol's F17.
 */
function refused(result: SteerResult, sent: string[][], code: string): void {
  if (result.ok) throw new Error(`expected a refusal, got a send of ${JSON.stringify(result.sent)}`);
  expect(result.reason.code).toBe(code);
  expect(result.reason.why.length).toBeGreaterThan(10);
  expect(result.delivery).toBe("none");
  expect(result.sent).toEqual([]);
  expect(sent).toEqual([]);
}

/* ---------------------------------------------------------------- *
 * sendMessage: the text itself
 * ---------------------------------------------------------------- */

describe("sendMessage sends the text literally, or not at all", () => {
  it("sends the message and the Enter as two calls, with -l on the text", () => {
    const { io, sent } = fakeBox();
    const text = "keep going; then Enter — and mind the `backticks` & $HOME";
    const result = sendMessage(TARGET, text, WORKING, io);

    expect(result.ok).toBe(true);
    // THE WHOLE MESSAGE IS ONE ARGV ELEMENT, after -l and --. That is the
    // guard: tmux never sees a word of it as a key name, and there is no shell
    // to see the `;` or the `$HOME` as anything at all.
    expect(sent).toEqual([
      ["send-keys", "-t", "%10", "-l", "--", text],
      ["send-keys", "-t", "%10", "Enter"],
    ]);
    if (result.ok) expect(result.verified).toEqual({ paneId: "%10", sessionId: "$5", panePid: 100, claudePid: 200 });
  });

  /**
   * The measurement this guard exists for, from the box on 2026-09-08:
   * `tmux send-keys -t %2164 -- "C-c"` — no `-l` — killed the process in the
   * pane. A person typing "C-c" into a steering box means the two characters.
   */
  it("puts a message that is a tmux key name behind -l like any other text", () => {
    const { io, sent } = fakeBox();
    for (const dangerous of ["C-c", "Enter", "Escape", "Space", "C-d ; rm -rf /"]) {
      sent.length = 0;
      const result = sendMessage(TARGET, dangerous, WORKING, io);
      expect(result.ok).toBe(true);
      expect(sent[0]).toEqual(["send-keys", "-t", "%10", "-l", "--", dangerous]);
      // and the only bare key name we ever send is the one we chose ourselves
      expect(sent[1]).toEqual(["send-keys", "-t", "%10", "Enter"]);
    }
  });

  it("refuses an empty or whitespace-only message", () => {
    for (const text of ["", "   ", "\t", "   "]) {
      const { io, sent } = fakeBox();
      refused(sendMessage(TARGET, text, WORKING, io), sent, "bad-text");
    }
  });

  it("refuses a multi-line message, because each newline would submit it early", () => {
    const { io, sent } = fakeBox();
    refused(sendMessage(TARGET, "pull latest\nthen keep going", WORKING, io), sent, "bad-text");
  });

  it("refuses a message carrying a control character, which is a keystroke not a letter", () => {
    for (const code of [3, 9, 27, 127]) {
      const { io, sent } = fakeBox();
      refused(sendMessage(TARGET, `ok${String.fromCharCode(code)}then`, WORKING, io), sent, "bad-text");
    }
  });

  it("refuses a message too long to be steering", () => {
    const { io, sent } = fakeBox();
    refused(sendMessage(TARGET, "x".repeat(4001), WORKING, io), sent, "bad-text");
  });

  it("checkText accepts the ordinary steering sentences", () => {
    for (const text of ["keep going", "pull the latest changes", "sleep 900 then resume", "harmonise with $5"]) {
      expect(checkText(text)).toBeNull();
    }
  });
});

/* ---------------------------------------------------------------- *
 * The target: address, container, process, conversation
 * ---------------------------------------------------------------- */

describe("sendMessage refuses anything that is not the session it was promised", () => {
  it("refuses a target that is not a pane id — a session name or handle included", () => {
    for (const paneId of ["$5", "fleet-dashboard-v01", "%", "%1;kill", "10", ""]) {
      const { io, sent } = fakeBox();
      refused(sendMessage({ ...TARGET, paneId }, "keep going", WORKING, io), sent, "bad-target");
    }
  });

  it("refuses a target whose session handle or Claude id is not one", () => {
    const { io: a, sent: sa } = fakeBox();
    refused(sendMessage({ ...TARGET, sessionId: "worktree-x" }, "hi there", WORKING, a), sa, "bad-target");
    const { io: b, sent: sb } = fakeBox();
    refused(sendMessage({ ...TARGET, claudeSessionId: "not-a-uuid" }, "hi there", WORKING, b), sb, "bad-target");
    const { io: c, sent: sc } = fakeBox();
    refused(sendMessage({ ...TARGET, panePid: -1 }, "hi there", WORKING, c), sc, "bad-target");
  });

  it("refuses a pane that is no longer on the box", () => {
    const { io, sent } = fakeBox({ panes: "%11|$6|300|0|0\n" });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "pane-gone");
  });

  /** `join-pane` and `move-pane` both keep the pane id and change the session. */
  it("refuses a pane that has moved to another tmux session", () => {
    const { io, sent } = fakeBox({ panes: "%10|$99|100|0|0\n" });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "wrong-pane");
  });

  it("refuses a dead pane", () => {
    const { io, sent } = fakeBox({ panes: "%10|$5|100|1|0\n" });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "pane-gone");
  });

  /** In copy mode every character of a message is an editor command instead. */
  it("refuses a pane scrolled back into copy mode", () => {
    const { io, sent } = fakeBox({ panes: "%10|$5|100|0|1\n" });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "pane-in-copy-mode");
  });

  /** `respawn-pane` is the one way a pane's contents change under the same id. */
  it("refuses a pane whose process was replaced, when the caller said which one it saw", () => {
    const { io, sent } = fakeBox({ panes: "%10|$5|555|0|0\n", parents: "  555     1\n  200   555\n" });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "wrong-pane");
  });

  it("refuses a pane with no Claude in it — the bare shell that would EXECUTE the text", () => {
    const { io, sent } = fakeBox({ pgrep: "" });
    refused(sendMessage(TARGET, "rm the worktree when you are done", WORKING, io), sent, "no-claude-in-pane");
  });

  /**
   * The substitution the whole module exists to prevent: the conversation is
   * alive and well, in somebody else's pane.
   */
  it("refuses when the expected Claude is running, but not under this pane", () => {
    const { io, sent } = fakeBox({ pgrep: `400 claude --session-id ${UUID} --name somebody-else\n` });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "no-claude-in-pane");
  });

  /** A pane resumed into a different conversation keeps its pane id and its pid. */
  it("refuses when the pane holds a different conversation than the caller read", () => {
    const { io, sent } = fakeBox({ pgrep: `200 claude --session-id ${OTHER_UUID} --name resumed\n` });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "no-claude-in-pane");
  });

  /**
   * SOL'S F3, END TO END, and the one substitution the module could not see.
   *
   * The pane is right, the tmux session is right, the pid is right, the process
   * really is a claude and really is a child of that pane — and it is a
   * DIFFERENT CONVERSATION, started with a prompt that quotes the id of the one
   * the page was showing. pgrep flattens argv with spaces, so its line for this
   * process contains `--session-id <UUID>` and the old substring check said yes.
   *
   * The two assertions are a pair on purpose. Refusing the impostor proves
   * nothing on its own — a verifier that had stopped working entirely would
   * also refuse it — so the second half sends the same message to the same pane
   * with only the argv corrected, and watches it go.
   */
  it("refuses a claude whose argv only MENTIONS our session id, in a prompt", () => {
    const prompt = `resume from --session-id ${UUID} and carry on`;
    const flattened = `200 claude --session-id ${OTHER_UUID} ${prompt}\n`;
    expect(flattened).toContain(`--session-id ${UUID}`);

    const { io, sent } = fakeBox({
      pgrep: flattened,
      cmdlines: { 200: ["claude", "--session-id", OTHER_UUID, prompt] },
    });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "no-claude-in-pane");

    // the same pane, the same pgrep line, argv corrected: it sends
    const { io: ok, sent: sentOk } = fakeBox({
      pgrep: flattened,
      cmdlines: { 200: ["claude", "--session-id", UUID, prompt] },
    });
    const result = sendMessage(TARGET, "keep going", WORKING, ok);
    expect(result.ok).toBe(true);
    expect(sentOk).toEqual([
      ["send-keys", "-t", "%10", "-l", "--", "keep going"],
      ["send-keys", "-t", "%10", "Enter"],
    ]);
  });

  /**
   * MEASURED ON THIS BOX, 2026-09-08, and it is why the argv check cannot be
   * skipped when there is only one candidate left.
   *
   * `pgrep -a -f -- <uuid>` returns TWO pids for a live agent, because
   * gjd-remote names its job script after the conversation:
   *
   *     82167  claude --session-id 117e181a-… --name adversarial-fixtures …
   *     645023 bash /home/greg/gjd-remote/jobs/adversarial-fixtures-117e181a-….sh
   *
   * The wrapper is the Claude's PARENT, so it is a descendant of the pane and
   * the ancestry walk says yes to it — and it is a SHELL, which would EXECUTE
   * the message rather than read it. What actually rejects it is the exact-
   * argument rule: its argv is `["bash", "<path with the uuid in it>"]`, with
   * no `--session-id` argument anywhere, so it matched pgrep only through its
   * filename. The argv[0] rule is the second line and is exercised separately,
   * by the `grep --session-id <uuid>` case in the unit test below.
   *
   * The wrapper is listed first here because pgrep sorts by pid and the wrapper
   * can perfectly well be the lower one; taking the first ancestry match rather
   * than the first VERIFIED one would take that one.
   */
  it("skips the gjd-remote wrapper shell that pgrep finds under the same pane", () => {
    const wrapper = `/home/greg/gjd-remote/jobs/fleet-dashboard-${UUID}.sh`;
    const { io, sent } = fakeBox({
      pgrep: `150 bash ${wrapper}\n200 claude --session-id ${UUID} --name fleet\n`,
      parents: ["    1     0", "  100     1", "  150   100", "  200   150", ""].join("\n"),
      cmdlines: { 150: ["bash", wrapper], 200: ["claude", "--session-id", UUID, "--name", "fleet"] },
    });
    const result = sendMessage(TARGET, "rm the worktree when you are done", WORKING, io);

    expect(result.ok).toBe(true);
    // the Claude, not the shell that would have EXECUTED that sentence
    if (result.ok) expect(result.verified.claudePid).toBe(200);
    expect(sent).toHaveLength(2);
  });

  it("refuses when the only candidate under the pane is that wrapper shell", () => {
    const wrapper = `/home/greg/gjd-remote/jobs/fleet-dashboard-${UUID}.sh`;
    const { io, sent } = fakeBox({
      pgrep: `150 bash ${wrapper}\n`,
      parents: ["    1     0", "  100     1", "  150   100", ""].join("\n"),
      cmdlines: { 150: ["bash", wrapper] },
    });
    refused(sendMessage(TARGET, "rm the worktree when you are done", WORKING, io), sent, "no-claude-in-pane");
  });

  it("refuses a candidate whose /proc entry has gone, rather than assuming it", () => {
    const { io, sent } = fakeBox({ cmdlines: { 200: null } });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "no-claude-in-pane");
  });

  it("refuses when tmux or the process table cannot be asked at all", () => {
    for (const throwOn of ["panes", "parents", "pgrep", "cmdline"] as const) {
      const { io, sent } = fakeBox({ throwOn });
      refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "box-unreadable");
    }
  });

  it("refuses a listing it only half understands rather than concluding the pane is gone", () => {
    const { io, sent } = fakeBox({ panes: "%10|$5|100|0|0\nsomething tmux never printed\n" });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "box-unreadable");
    const { io: b, sent: sb } = fakeBox({ parents: "100 not-a-pid\n" });
    refused(sendMessage(TARGET, "keep going", WORKING, b), sb, "box-unreadable");
  });

  it("reports a send tmux itself refused, rather than claiming it landed", () => {
    const { io, sent } = fakeBox({ throwOn: "send" });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "send-failed");
  });
});

/* ---------------------------------------------------------------- *
 * F2: the screen we are about to type at
 * ---------------------------------------------------------------- */

describe("sendMessage will not type at a screen that is not an input box", () => {
  /**
   * SOL'S F2. The page honestly says `working`; Claude opens a numbered
   * permission dialog in the meantime; a steering message beginning with "1"
   * arrives; the dialog eats the `1` as an approval and the Enter lands in
   * whatever screen that opened. Every other guard in this module passes — the
   * pane is right, the conversation is right — because none of them looks at
   * the screen.
   */
  it("refuses a message when a permission dialog has opened under it", () => {
    const { io, sent } = fakeBox({ capture: fixture("dialog-bash-permission") });
    refused(sendMessage(TARGET, "1 is the option I want", WORKING, io), sent, "pane-is-asking");
  });

  it("refuses every dialog we have a capture of, whatever the message says", () => {
    for (const name of [
      "dialog-file-write",
      "dialog-folder-trust",
      "dialog-model-selector",
      "dialog-loop-cloud-schedule",
      "dialog-ask-user-question",
      "dialog-edit-diff",
    ]) {
      const { io, sent } = fakeBox({ capture: fixture(name) });
      refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "pane-is-asking");
    }
  });

  /**
   * "Not a dialog" is an ABSENCE, and this module has a rule about those. A
   * blank pane, a bare shell and an empty capture all parse as `none`; none of
   * them is a screen that takes free text.
   */
  it("refuses a screen with no input box, rather than accepting 'not a dialog'", () => {
    for (const capture of ["", fixture("none-blank-pane"), fixture("none-bare-shell")]) {
      const { io, sent } = fakeBox({ capture });
      refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "not-at-input");
    }
  });

  it("sends to every real screen that does have one", () => {
    for (const name of [
      "none-working-empty-prompt",
      "none-working-with-lettered-table",
      "none-idle-with-prose-numbered-list",
      "none-dialog-just-answered",
    ]) {
      const { io, sent } = fakeBox({ capture: fixture(name) });
      const result = sendMessage(TARGET, "keep going", WORKING, io);
      if (!result.ok) throw new Error(`${name}: refused with ${result.reason.code} — ${result.reason.why}`);
      expect(sent).toHaveLength(2);
    }
  });

  it("refuses when the pane cannot be captured at all", () => {
    const { io, sent } = fakeBox({ throwOn: "capture" });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "pane-gone");
  });

  /**
   * The two halves of the check are independent, and this is what says so.
   *
   * `parsePane` requires the dialog's hint line — "Esc to cancel · Tab to
   * amend" — and says `none` without it, exactly as it says `none` for a shape
   * it has never been taught. This is that dialog with the hint line removed:
   * still unmistakably a dialog on the screen, no longer one the parser will
   * name. The only thing left to refuse it is the border test, and it does.
   *
   * Without that second guard, a Claude Code build that changed its hint line
   * would silently make every mid-dialog pane steerable, and nothing here would
   * go red — every fixture in this repo is a capture of the old build.
   */
  it("refuses a dialog the parser no longer recognises, on the borders alone", () => {
    const whole = fixture("dialog-bash-permission");
    const unrecognised = whole
      .split("\n")
      .filter((l) => !/Esc to cancel/.test(l))
      .join("\n");
    expect(parsePane(whole).kind).toBe("question");
    expect(parsePane(unrecognised).kind).toBe("none");
    expect(paneSurface(unrecognised).kind).toBe("unrecognised");

    const { io, sent } = fakeBox({ capture: unrecognised });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "not-at-input");
  });

  /**
   * The `❯` in a working pane's transcript is the echo of the message Greg
   * sent, and it is above the input box, not in it. Taking the FIRST prompt
   * line would vouch for a screen that is now anything at all.
   */
  it("takes the box at the bottom, not an echo of a message in the transcript", () => {
    const whole = fixture("none-working-with-lettered-table");
    const surface = paneSurface(whole);
    expect(surface.kind).toBe("empty-input");
    if (surface.kind !== "empty-input") return;

    // the echo really is there, higher up, and really does look like a prompt
    const lines = whole.split("\n");
    const echo = lines.findIndex((l) => l.includes("❯"));
    expect(echo).toBeGreaterThanOrEqual(0);
    expect(echo).toBeLessThan(surface.promptLine);

    // and everything from the echo down to just above the box is not a surface
    expect(paneSurface(lines.slice(0, surface.promptLine).join("\n")).kind).toBe("unrecognised");
  });
});

/* ---------------------------------------------------------------- *
 * A10: a box with somebody's draft in it is not a box we may type at.
 * ---------------------------------------------------------------- */

/**
 * ASTRA'S A10, AND THE HALF STAGE v0.2e DID NOT COVER.
 *
 * A live Claude descendant does not prove an empty input box owns the
 * keystrokes. `inputSurface` establishes that a box EXISTS — a `❯` with a
 * border above it and another within four lines below — and never reads what is
 * IN it. So a message sent to a pane with a half-typed draft in its box is
 * typed onto the END of that draft, and our Enter submits the concatenation.
 *
 * **THIS IS NOT A DELIVERY BUG, IT IS AN AUTHORSHIP ONE.** Measured read-only
 * across every pane on this box on 2026-09-08: of seventeen Claude sessions
 * with a prompt on screen, thirteen were empty and three held a live draft —
 * one of them `❯ yes, shut it all down`, in a session running in auto mode.
 * Greg typed those words at a terminal, meaning them about something, and did
 * not press Enter. Our Enter would be the act, at a moment we chose, against a
 * screen we have not read. That is A9's bug — an approval bound to a sentence
 * rather than to the material — arriving through the prose door instead of the
 * dialog door.
 *
 * `none-typed-numbered-message-in-input-box.txt` is a pane with a three-line
 * draft between the two borders. It was added to prove that a numbered list a
 * PERSON typed is not a dialog, and it has been quietly documenting this defect
 * ever since — the suite above lists it under "sends to every real screen that
 * does have one", so until today the bug was not merely untested, it was
 * asserted as correct.
 *
 * Why it stayed rare rather than constant: `INPUT_BOX_LINES` is 4, so a draft
 * of five or more visual lines already pushes the closing border out of the
 * window and is refused as `not-at-input`. The guard that made this uncommon is
 * not a guard against this.
 */
describe("sendMessage will not append to a draft somebody else is still writing", () => {
  it("refuses the box that already has three lines typed into it", () => {
    const { io, sent } = fakeBox({ capture: fixture("none-typed-numbered-message-in-input-box") });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "input-not-empty");
  });

  /**
   * The one-line case, which is the shape every live draft on the box had.
   * Built by writing a draft into a capture that is otherwise known-good, so
   * the ONLY difference between this and the happy path is the text in the box
   * — a fixture that differed in two ways could pass for the wrong reason.
   */
  it("refuses a one-line draft, on a screen that is otherwise the happy path", () => {
    const empty = fixture("none-working-empty-prompt");
    const drafted = empty.replace(/❯ /, "❯ yes, shut it all down");
    expect(drafted).not.toBe(empty);

    const { io: a, sent: sa } = fakeBox({ capture: empty });
    expect(sendMessage(TARGET, "keep going", WORKING, a).ok).toBe(true);
    expect(sa).toHaveLength(2);

    const { io: b, sent: sb } = fakeBox({ capture: drafted });
    refused(sendMessage(TARGET, "keep going", WORKING, b), sb, "input-not-empty");
  });

  /**
   * The refusal must be reachable by the QUEUE as well as by a person, and it
   * must arrive on the path that puts the item back rather than the one that
   * destroys it: `queue.release` will only accept evidence minted by
   * `nothingWasSent()`, which requires delivery `none` AND nothing sent. If
   * this refusal ever grew a partial send, a queued instruction would be
   * silently dropped instead of waiting for the agent to clear its own box.
   */
  it("leaves the transport untouched, which is what the queue's put-back requires", () => {
    const { io, sent } = fakeBox({ capture: fixture("none-typed-numbered-message-in-input-box") });
    const result = sendMessage(TARGET, "keep going", WORKING, io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.delivery).toBe("none");
    expect(result.sent).toEqual([]);
    expect(sent).toEqual([]);
  });

  /**
   * The other fixture the corpus already had, and nobody had noticed either.
   * `❯ do all three` — which may be a person's reply, a suggestion the harness
   * offered, or a hint. A capture cannot tell, which is why the arm is called
   * `occupied-input` and not `drafted-input` (GPT Sol, 2026-09-08).
   */
  it("refuses the second occupied fixture too, which the suite used to send to", () => {
    const { io, sent } = fakeBox({ capture: fixture("none-working-with-prose-decisions-list") });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "input-not-empty");
  });
});

/* ---------------------------------------------------------------- *
 * A10, the other half: has this Claude shelled out?
 * ---------------------------------------------------------------- */

/**
 * **THE ONE SIGNAL ON THIS BOX THAT CAN SEE A FOREGROUND CHILD**, and the
 * reason the plan's "this cannot be built at all" was too strong — GPT Sol,
 * 2026-09-08, which pointed out that the process-group measurement disproves
 * `tpgid` rather than every foreground guard.
 *
 * The measurement stands: on `%1999`, `%2085` and `%2166`, Claude, the pane's
 * bash and any child all sit in ONE process group, so `pgrp` = `sid` = `tpgid`
 * = `pane_pid` and neither the kernel nor `#{pane_current_command}` can say who
 * is reading the tty. Claude Code's own `~/.claude/sessions/<pid>.json` can:
 * its `status` reads `shell` while a session has shelled out, and it was
 * `"status":"shell"` for pid 1471795 under pane `%2085` while this was written.
 *
 * **THE ASYMMETRY IS THE DESIGN AND THESE TESTS ARE MOSTLY ABOUT IT.** A
 * `shell` status refuses; everything else — a different status, no file,
 * unparseable JSON, a read that throws — does not. That is the opposite of this
 * module's usual bias, on purpose: it is another application's undocumented
 * private state, and a guard that refused on its absence would stop every
 * message on the box the day the format changed. It can only ADD refusals.
 */
describe("sendMessage refuses a session that says it has shelled out", () => {
  const state = (status: string): string => JSON.stringify({ pid: 200, status });

  it("refuses when Claude Code says a program of its own is in front", () => {
    const { io, sent } = fakeBox({ sessionState: state("shell") });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "not-at-input");
  });

  it("names the pid in the refusal, so it can be checked afterwards", () => {
    const { io } = fakeBox({ sessionState: state("shell") });
    const result = sendMessage(TARGET, "keep going", WORKING, io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 200 is the CLAUDE pid from the fake process table, not the pane's 100 —
    // the file is keyed by the Claude process and reading the wrong one would
    // silently never match.
    expect(result.reason.why).toContain("200");
  });

  it("sends for every other status, so this can only ever add a refusal", () => {
    for (const status of ["idle", "busy", "working", "something-invented-in-2027"]) {
      const { io, sent } = fakeBox({ sessionState: state(status) });
      const result = sendMessage(TARGET, "keep going", WORKING, io);
      if (!result.ok) throw new Error(`status ${status} refused: ${result.reason.why}`);
      expect(sent).toHaveLength(2);
    }
  });

  /**
   * **FAIL-OPEN ON ABSENCE, WHICH IS THE ONE THING THAT MUST NOT DRIFT.** A
   * Claude Code release that stops writing this file, renames the field, or
   * changes its shape must cost nothing. If somebody later "hardens" this into
   * a refusal, every message on the fleet stops the day the format moves — and
   * this is the test that should stop them.
   */
  it("sends when there is no file, unparseable JSON, no status, or a read that throws", () => {
    const cases: { what: string; box: Parameters<typeof fakeBox>[0] }[] = [
      { what: "no file at all", box: {} },
      { what: "not JSON", box: { sessionState: "<html>404</html>" } },
      { what: "JSON with no status", box: { sessionState: JSON.stringify({ pid: 200 }) } },
      { what: "a status that is not a string", box: { sessionState: JSON.stringify({ status: 3 }) } },
      { what: "a read that throws", box: { throwOn: "sessionState" } },
    ];
    for (const { what, box } of cases) {
      const { io, sent } = fakeBox(box);
      const result = sendMessage(TARGET, "keep going", WORKING, io);
      if (!result.ok) throw new Error(`${what} refused, and absence must not: ${result.reason.why}`);
      expect(sent, what).toHaveLength(2);
    }
  });

  /**
   * It is the LAST check, after the screen. A pane that fails an earlier one
   * must report the earlier reason: "it has shelled out" is a confusing thing
   * to be told about a pane that is showing a permission dialog.
   */
  it("does not pre-empt the refusals that describe the screen", () => {
    const { io, sent } = fakeBox({
      capture: fixture("dialog-bash-permission"),
      sessionState: state("shell"),
    });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "pane-is-asking");
  });
});

/* ---------------------------------------------------------------- *
 * F17: what a failed send left behind, and what it may say about it
 * ---------------------------------------------------------------- */

describe("a send that fails says how much of it arrived", () => {
  /**
   * THE EXPENSIVE ONE. The literal text goes through and the Enter does not, so
   * the message is sitting in that agent's input box unsent, and the next Enter
   * anybody presses submits it. The route used to answer this with the same 409
   * it uses for "nothing happened".
   */
  it("says partial, and which call landed, when the Enter fails after the text", () => {
    const { io, sent } = fakeBox({ failSend: { at: 1, error: new Error("tmux: no server") } });
    const result = sendMessage(TARGET, "pull latest", WORKING, io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.code).toBe("send-partial");
    expect(result.delivery).toBe("partial");
    // the text call is named as having landed, in both records
    expect(result.sent).toEqual([["send-keys", "-t", "%10", "-l", "--", "pull latest"]]);
    expect(sent).toEqual([["send-keys", "-t", "%10", "-l", "--", "pull latest"]]);
    expect(result.reason.why).toContain("input box");
  });

  it("says unknown when the first call timed out, because it may have landed", () => {
    const timeout = Object.assign(new Error("spawnSync tmux ETIMEDOUT"), { code: "ETIMEDOUT" });
    const { io, sent } = fakeBox({ failSend: { at: 0, error: timeout } });
    const result = sendMessage(TARGET, "pull latest", WORKING, io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.code).toBe("send-unknown");
    expect(result.delivery).toBe("unknown");
    expect(result.sent).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("says unknown when the child was killed, and none when tmux merely said no", () => {
    const killed = Object.assign(new Error("killed"), { signal: "SIGTERM" });
    const { io } = fakeBox({ failSend: { at: 0, error: killed } });
    const a = sendMessage(TARGET, "pull latest", WORKING, io);
    expect(a.ok === false && a.delivery).toBe("unknown");

    const refusedByTmux = Object.assign(new Error("bad"), { status: 1 });
    const { io: b } = fakeBox({ failSend: { at: 0, error: refusedByTmux } });
    const second = sendMessage(TARGET, "pull latest", WORKING, b);
    expect(second.ok === false && second.delivery).toBe("none");
    expect(second.ok === false && second.reason.code).toBe("send-failed");
  });

  /**
   * SOL'S F17, SECOND HALF, AND IT IS A PRIVACY BUG RATHER THAN A CORRECTNESS
   * ONE. Node builds a child-process error message by pasting the whole command
   * line into it, and the command line here ends with the person's message. So
   * the idiomatic `${(e as Error).message}` puts what somebody said to their
   * agent into the HTTP body and into the server log, in a module whose header
   * promises it does no such thing.
   *
   * The `not.toContain` is paired, because a refusal that had lost its sentence
   * altogether would satisfy it just as well.
   */
  it("keeps the message out of a refusal, even though node's error contains it", () => {
    const secret = "tell Anna the acquisition price is 4.2M";
    const nodeShaped = Object.assign(
      new Error(`Command failed: tmux send-keys -t %10 -l -- ${secret}\ntmux: no server running`),
      { status: 1, stderr: `tmux send-keys -t %10 -l -- ${secret}` },
    );
    const { io } = fakeBox({ failSend: { at: 0, error: nodeShaped } });
    const result = sendMessage(TARGET, secret, WORKING, io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.why).not.toContain(secret);
    expect(result.reason.why).not.toContain("acquisition");
    // and it still says something a person can act on
    expect(result.reason.why).toContain("tmux refused the send");
    expect(result.reason.why).toContain("exit status 1");
  });

  /**
   * `sent` IS the argv, so it is the message. It goes back to the client that
   * supplied it, and `describeSend` is what anything writing a log must use.
   */
  it("describeSend renders a send without its contents", () => {
    const secret = "tell Anna the acquisition price is 4.2M";
    const { io } = fakeBox();
    const result = sendMessage(TARGET, secret, WORKING, io);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const line = describeSend(result.sent);
    expect(line).not.toContain(secret);
    expect(line).not.toContain("acquisition");
    expect(line).toContain("send-keys -t %10 -l -- <39 characters>");
    expect(line).toContain("send-keys -t %10 Enter");
    // the untouched half: a key-name call has nothing to hide and is shown whole
    expect(describeSend([["send-keys", "-t", "%10", "Down", "Enter"]])).toBe("send-keys -t %10 Down Enter");
  });
});

describe("the status the caller derived is checked before anything is sent", () => {
  it("refuses every kind that is not a Claude at a prompt", () => {
    const notSteerable: FleetStatus[] = [
      { kind: "shell", busy: true },
      { kind: "shell", busy: null },
      { kind: "no-claude" },
      { kind: "waiting", secondsLeft: 300 },
      { kind: "unknown", cause: "agents-unavailable", why: "the box could not say what Claude is doing" },
    ];
    for (const status of notSteerable) {
      const { io, sent } = fakeBox();
      refused(sendMessage(TARGET, "keep going", status, io), sent, "declared-not-steerable");
      expect(steerableStatus(status)).not.toBeNull();
    }
  });

  it("allows the three that are a Claude at a prompt", () => {
    for (const status of [NEEDS_YOU, WORKING, { kind: "idle" } as const]) {
      expect(steerableStatus(status)).toBeNull();
    }
  });

  /**
   * A caller that lies about the status still gets nowhere: the live check is
   * what actually decides. This is the test that says the declared status is a
   * cheap first refusal and not the security boundary.
   */
  it("still refuses a shell that the caller has claimed is working", () => {
    const { io, sent } = fakeBox({ pgrep: "" });
    refused(sendMessage(TARGET, "keep going", WORKING, io), sent, "no-claude-in-pane");
  });
});

/* ---------------------------------------------------------------- *
 * answerQuestion
 * ---------------------------------------------------------------- */

describe("answerQuestion re-reads the dialog before it answers it", () => {
  /**
   * Every happy path below answers an `AskUserQuestion` rather than a
   * permission dialog, and that is not a stylistic choice: since 2026-09-08
   * `answerQuestion` refuses anything whose `gate` is not `conversation`, so a
   * permission fixture here would test the refusal instead of the keystrokes.
   * The refusal has its own tests further down.
   */
  it("sends the digit, and only the digit, for a numbered dialog", () => {
    const seen = question("dialog-ask-user-question");
    const { io, sent } = fakeBox({ capture: fixture("dialog-ask-user-question") });
    const result = answerQuestion(TARGET, seen, 3, NEEDS_YOU, io);

    expect(result.ok).toBe(true);
    // No Enter: a numbered Claude Code dialog acts on the digit, and a trailing
    // Enter would land in whatever screen the choice opened.
    expect(sent).toEqual([["send-keys", "-t", "%10", "-l", "--", "4"]]);
  });

  /**
   * ONE CALL, arrows and Enter together. Sol's F5: two calls left a window in
   * which anybody attached to that terminal could move the highlight, so the
   * arrows landed on one option and the Enter chose another.
   */
  /**
   * A CURSOR MENU THAT IS AN AGENT'S OWN QUESTION, WHICH CLAUDE CODE DOES NOT
   * CURRENTLY DRAW — and saying so is the point of this comment.
   *
   * Every real cursor menu in the corpus is a permission dialog (folder trust),
   * and every real `AskUserQuestion` is numbered. So since the gate landed, the
   * arrows branch of `keysFor` is unreachable through `answerQuestion` in
   * production: nothing that gets past the gate ever needs an arrow key. That
   * is a fact about today's widgets rather than a guarantee, which is why the
   * branch stays and why this capture is synthetic — it keeps the keystroke
   * mechanics tested against the day a widget changes, rather than leaving them
   * to be discovered untested then. It is the `AskUserQuestion` frame with its
   * numbers taken off, which is what such a menu would look like.
   */
  const CONVERSATION_MENU = [
    // A LINE OF TRANSCRIPT ABOVE THE BORDER, because every real capture has
    // one and this one did not. `materialAbove` now refuses a dialog whose
    // topmost rule is the FIRST line of the capture — there is no way to tell
    // the dialog's own border from a separator inside it when nothing is above
    // it — so without this the synthetic menu came back `unreadable` and the
    // gate `unknown`, and these two tests failed for a reason that had nothing
    // to do with keystrokes. Fixing the fixture rather than the guard: a
    // capture that begins at a border is not a screen tmux produces.
    "● Ran the suite; three attempts were killed by the box rather than by the code.",
    fixture("dialog-ask-user-question").split("\n").find((l) => l.startsWith("─")) ?? "",
    " ☐ How to finish",
    "",
    "│ Three attempts have been killed by box conditions rather than by the code.",
    "",
    " ❯ Run it at low concurrency",
    "   Push now on existing evidence",
    "   Keep waiting for a quiet box",
    "",
    "Enter to select · ↑/↓ to navigate · Esc to cancel",
    "",
  ].join("\n");

  function conversationMenu(): SeenQuestion {
    const q = parsePane(CONVERSATION_MENU);
    if (q.kind !== "question") throw new Error("the synthetic conversation menu must parse as a question");
    // The assertion that makes the rest of it mean anything: if this ever came
    // back `permission` or `unknown`, the two tests below would be testing the
    // gate rather than the keystrokes and would still be green.
    expect(q.gate.kind).toBe("conversation");
    expect(q.options.map((o) => o.key.via)).toEqual(["selected", "arrows", "arrows"]);
    return q;
  }

  it("sends the arrows and the Enter in a single tmux call, for a cursor menu", () => {
    const seen = conversationMenu();
    const { io, sent } = fakeBox({ capture: CONVERSATION_MENU });
    const result = answerQuestion(TARGET, seen, 1, NEEDS_YOU, io);

    expect(result.ok).toBe(true);
    expect(sent).toEqual([["send-keys", "-t", "%10", "Down", "Enter"]]);
    // and the assertion the count is really making: there is no second call to
    // race with, not merely a different argv
    expect(sent).toHaveLength(1);
  });

  it("sends Enter alone for the option the cursor is already on", () => {
    const seen = conversationMenu();
    const { io, sent } = fakeBox({ capture: CONVERSATION_MENU });
    const result = answerQuestion(TARGET, seen, 0, NEEDS_YOU, io);

    expect(result.ok).toBe(true);
    expect(sent).toEqual([["send-keys", "-t", "%10", "Enter"]]);
  });

  /**
   * THE ONE THAT MATTERS. A digit sent to a session that has stopped asking
   * does not vanish — it lands in the input box as the character "4" and waits
   * there for whatever that agent is told next.
   */
  it("refuses when the pane has stopped asking", () => {
    const seen = question("dialog-bash-permission");
    for (const now of ["none-dialog-just-answered", "none-working-empty-prompt", "none-blank-pane"]) {
      const { io, sent } = fakeBox({ capture: fixture(now) });
      refused(answerQuestion(TARGET, seen, 0, NEEDS_YOU, io), sent, "question-gone");
    }
  });

  it("refuses when the pane is asking something else now", () => {
    const seen = question("dialog-bash-permission");
    const { io, sent } = fakeBox({ capture: fixture("dialog-model-selector") });
    refused(answerQuestion(TARGET, seen, 1, NEEDS_YOU, io), sent, "question-changed");
  });

  /**
   * Same options, cursor moved: the same QUESTION with a different ANSWER,
   * because a cursor menu's keystrokes are counted from wherever the highlight
   * is. It also means something else is driving that pane right now, which is
   * the moment to stop rather than the moment to recompute the keystrokes.
   *
   * The capture is SYNTHETIC, and it is the only one in this file that is: the
   * one real cursor menu we have (folder trust) has two options, and moving its
   * highlight onto the last of them leaves nothing below it, so the parser
   * stops seeing a menu at all — the case below this one. This is that capture
   * with a third option at the same column, which is what a three-way trust
   * prompt would look like.
   */
  const CURSOR_MENU = [
    " ",
    " Pick one",
    " ❯ No, exit",
    "   Yes, I trust this folder",
    "   Yes, and do not ask again",
    "",
    " Enter to confirm · Esc to cancel",
    "",
  ];

  it("refuses when the highlight has moved under a cursor menu", () => {
    const seen = parsePane(CURSOR_MENU.join("\n"));
    if (seen.kind !== "question") throw new Error("the synthetic cursor menu must parse as a question");
    expect(seen.options.map((o) => o.key)).toEqual([
      { via: "selected" },
      { via: "arrows", key: "Down", presses: 1 },
      { via: "arrows", key: "Down", presses: 2 },
    ]);

    const moved = CURSOR_MENU.map((l) =>
      l === " ❯ No, exit" ? "   No, exit" : l === "   Yes, I trust this folder" ? " ❯ Yes, I trust this folder" : l,
    ).join("\n");
    const { io, sent } = fakeBox({ capture: moved });
    refused(answerQuestion(TARGET, seen, 2, NEEDS_YOU, io), sent, "question-changed");
  });

  /**
   * The same move on the real two-option menu takes the pane out of "asking"
   * altogether, as far as the parser is concerned. Still a refusal, still
   * silent — which is the property that matters, and the reason this is a test
   * rather than a footnote.
   */
  it("refuses when a moved highlight leaves the real trust prompt unparseable", () => {
    const seen = question("dialog-folder-trust");
    const moved = fixture("dialog-folder-trust")
      .replace(" ❯ No, exit", "   No, exit")
      .replace("   Yes, I trust this folder", " ❯ Yes, I trust this folder");
    expect(moved).not.toBe(fixture("dialog-folder-trust"));
    const { io, sent } = fakeBox({ capture: moved });
    refused(answerQuestion(TARGET, seen, 1, NEEDS_YOU, io), sent, "question-gone");
  });

  /**
   * THE ONE THE PROMPT CANNOT CATCH, and the reason `sameQuestion` compares
   * material at all.
   *
   * Two writes to the same path with different contents. `prompt` is only the
   * sentence below the dialog's last rule — "Do you want to create notes.md?" —
   * and Claude Code rules off the diff from the question, so the two dialogs
   * have a byte-identical prompt, byte-identical labels and byte-identical
   * keys. The first three assertions establish that: without them this test
   * would pass on a build where the prompt differed, and prove nothing about
   * the material at all.
   */
  it("refuses an answer aimed at a different write to the same file", () => {
    const hello = question("dialog-file-write-hello");
    const goodbye = question("dialog-file-write-goodbye");
    expect(hello.prompt).toBe(goodbye.prompt);
    expect(hello.options.map((o) => o.label)).toEqual(goodbye.options.map((o) => o.label));
    expect(hello.options.map((o) => o.key)).toEqual(goodbye.options.map((o) => o.key));
    // and the thing that does differ
    expect(hello.material).not.toEqual(goodbye.material);

    const { io, sent } = fakeBox({ capture: fixture("dialog-file-write-goodbye") });
    refused(answerQuestion(TARGET, hello, 0, NEEDS_YOU, io), sent, "question-changed");

    // The control, and it has to be a different one now that the gate exists:
    // this is a file-write dialog, so the same dialog on both sides gets PAST
    // `sameQuestion` and is stopped by the gate instead. A different code is
    // exactly what proves the refusal above was the material — if `sameQuestion`
    // had stopped believing this pair, both halves would say "question-changed".
    const { io: same, sent: sentSame } = fakeBox({ capture: fixture("dialog-file-write-hello") });
    refused(answerQuestion(TARGET, hello, 0, NEEDS_YOU, same), sentSame, "grants-permission");
  });

  /**
   * THE LINE THE WHOLE FEATURE RESTS ON, tested from the outside.
   *
   * Fable: pane text as executable UI is acceptable when execution means *a
   * user turn*, and not when it means *grant a permission*. `classifyGate` is
   * where that is decided and `tests/fleet-pane.test.ts` is where the decision
   * is tested; what these two say is that `answerQuestion` **acts on it**, and
   * acts on the fresh capture rather than on the caller's copy.
   *
   * Every permission fixture in the corpus is listed rather than one of them,
   * because the interesting failure is a classifier that gets four of five
   * right — and a single-fixture test cannot tell that apart from five of five.
   */
  it("refuses every permission dialog in the corpus, and sends nothing", () => {
    for (const name of [
      "dialog-bash-permission",
      "dialog-bash-permission-git-log",
      "dialog-edit-diff",
      "dialog-file-write",
      "dialog-folder-trust",
    ]) {
      const seen = question(name);
      const { io, sent } = fakeBox({ capture: fixture(name) });
      refused(answerQuestion(TARGET, seen, 0, NEEDS_YOU, io), sent, "grants-permission");
    }
  });

  /**
   * `unknown` is refused WITH `permission`, not allowed with a warning. The two
   * fixtures here are the harness's own menus — the model selector and a `/loop`
   * schedule — which are neither a tool approval nor an agent's question, and
   * which the classifier deliberately does not try to name. Being unable to
   * tell what a dialog is has to cost the same as knowing it is dangerous, or
   * "I could not tell" becomes the way through.
   */
  it("refuses a dialog it could not classify, exactly as if it were a permission", () => {
    for (const name of ["dialog-model-selector", "dialog-loop-cloud-schedule"]) {
      const seen = question(name);
      expect(seen.gate.kind).toBe("unknown");
      const { io, sent } = fakeBox({ capture: fixture(name) });
      refused(answerQuestion(TARGET, seen, 0, NEEDS_YOU, io), sent, "grants-permission");
    }
  });

  /**
   * THE FORGED BODY. A caller that hands over a `seen` claiming `conversation`
   * for a dialog that is a permission prompt on screen gets nowhere, because
   * the gate is computed from the capture and never read off the request. This
   * is the test that would go green on a build that trusted the client, and it
   * is the reason the check lives in `steer.ts` rather than in the route.
   */
  it("ignores a gate the caller claims, and uses the screen", () => {
    const real = question("dialog-bash-permission");
    const lying: SeenQuestion = { ...real, gate: { kind: "conversation" } };
    const { io, sent } = fakeBox({ capture: fixture("dialog-bash-permission") });
    refused(answerQuestion(TARGET, lying, 0, NEEDS_YOU, io), sent, "grants-permission");
  });

  it("refuses an option index that is not in the dialog", () => {
    const seen = question("dialog-bash-permission");
    for (const i of [-1, 4, 1.5, Number.NaN]) {
      const { io, sent } = fakeBox({ capture: fixture("dialog-bash-permission") });
      refused(answerQuestion(TARGET, seen, i, NEEDS_YOU, io), sent, "no-such-option");
    }
  });

  /**
   * `seen` arrives as a JSON body from a browser, where the `OptionKey` union is
   * a comment. A hand-written one is refused because it cannot equal what the
   * parser produces — and the keys actually sent come from the fresh parse, not
   * from the body.
   */
  it("refuses a fabricated option key that no parse could have produced", () => {
    const real = question("dialog-bash-permission");
    const forged: SeenQuestion = {
      ...real,
      options: real.options.map((o, i) =>
        i === 0 ? { ...o, key: { via: "digit", digit: "9; rm -rf" } as unknown as OptionKey } : o,
      ),
    };
    const { io, sent } = fakeBox({ capture: fixture("dialog-bash-permission") });
    refused(answerQuestion(TARGET, forged, 0, NEEDS_YOU, io), sent, "question-changed");
  });

  it("refuses when the pane cannot be captured at all", () => {
    const seen = question("dialog-bash-permission");
    const { io, sent } = fakeBox({ throwOn: "capture" });
    refused(answerQuestion(TARGET, seen, 0, NEEDS_YOU, io), sent, "pane-gone");
  });

  it("refuses a dialog in a pane that no longer holds the expected Claude", () => {
    const seen = question("dialog-bash-permission");
    const { io, sent } = fakeBox({ capture: fixture("dialog-bash-permission"), pgrep: "" });
    refused(answerQuestion(TARGET, seen, 0, NEEDS_YOU, io), sent, "no-claude-in-pane");
  });

  /**
   * SOL'S F4: THE DIALOG MUST BE READ LAST.
   *
   * It used to be read first, ahead of `verifyTarget` — which runs three
   * commands, each with a ten-second timeout. So a dialog could be answered
   * from the terminal during those seconds and the digit computed from the old
   * screen still went out.
   *
   * This is an ordering assertion, so it is made by ORDER: the fake records
   * every read as it happens, and the capture must come after all three of the
   * identity reads and immediately before the send. Asserting "a refusal
   * happens" would not distinguish the two orders at all — both refuse, on the
   * captures this file already has.
   */
  it("captures the dialog AFTER the identity checks, immediately before sending", () => {
    const seen = question("dialog-ask-user-question");
    const order: string[] = [];
    const { io, sent } = fakeBox({ capture: fixture("dialog-ask-user-question") });
    const note = <T>(what: string, read: () => T): T => {
      order.push(what);
      return read();
    };
    const watched: SteerIo = {
      listPanes: () => note("panes", () => io.listPanes()),
      processParents: () => note("parents", () => io.processParents()),
      claudeCandidates: (id) => note("pgrep", () => io.claudeCandidates(id)),
      cmdline: (pid) => note("cmdline", () => io.cmdline(pid)),
      capture: (id) => note("capture", () => io.capture(id)),
      claudeSessionState: (pid) => note("sessionState", () => io.claudeSessionState(pid)),
      sendKeys: (args) => note("send", () => io.sendKeys(args)),
    };

    const result = answerQuestion(TARGET, seen, 3, NEEDS_YOU, watched);
    expect(result.ok).toBe(true);
    expect(sent).toEqual([["send-keys", "-t", "%10", "-l", "--", "4"]]);

    expect(order).toEqual(["panes", "parents", "pgrep", "cmdline", "capture", "send"]);
    // said as the property rather than the sequence, so it survives another
    // read being added: nothing at all happens between the two
    expect(order.indexOf("send") - order.indexOf("capture")).toBe(1);
    expect(order.indexOf("capture")).toBeGreaterThan(order.indexOf("cmdline"));
  });

  /**
   * The same ordering claim from the other side. The dialog is what is on the
   * screen at the moment of the send, not what was on it before three tmux
   * commands ran — so a box whose screen changes during the identity reads must
   * refuse, and it can only do that if the capture comes after them.
   */
  it("refuses when the dialog changed while the identity checks were running", () => {
    const seen = question("dialog-bash-permission");
    let reads = 0;
    const base = fakeBox({ capture: fixture("dialog-bash-permission") });
    const sent: string[][] = [];
    const racing: SteerIo = {
      ...base.io,
      // the screen the identity reads leave behind is not the one they started
      // with: somebody answered the dialog from the terminal in between
      processParents: () => {
        reads++;
        return base.io.processParents();
      },
      capture: () => (reads > 0 ? fixture("none-dialog-just-answered") : fixture("dialog-bash-permission")),
      sendKeys: (args) => {
        sent.push([...args]);
      },
    };
    refused(answerQuestion(TARGET, seen, 0, NEEDS_YOU, racing), sent, "question-gone");
    expect(reads).toBeGreaterThan(0);
  });

  it("refuses a dialog on a row the caller itself called a shell", () => {
    const seen = question("dialog-bash-permission");
    const { io, sent } = fakeBox({ capture: fixture("dialog-bash-permission") });
    refused(answerQuestion(TARGET, seen, 0, { kind: "shell", busy: false }, io), sent, "declared-not-steerable");
  });

  it("refuses a bad target before it reads anything", () => {
    const seen = question("dialog-bash-permission");
    const { io, sent } = fakeBox({ capture: fixture("dialog-bash-permission") });
    refused(answerQuestion({ ...TARGET, paneId: "$5" }, seen, 0, NEEDS_YOU, io), sent, "bad-target");
  });
});

/* ---------------------------------------------------------------- *
 * The pieces, on their own
 * ---------------------------------------------------------------- */

describe("keysFor", () => {
  it("refuses an arrow count that could not have come from a parse", () => {
    for (const presses of [0, -1, 41, 1.5, Number.NaN]) {
      const r = keysFor("%10", { via: "arrows", key: "Down", presses });
      expect(r.ok).toBe(false);
    }
  });

  it("refuses a digit that is not a menu digit", () => {
    for (const digit of ["0", "10", "", "1 Enter"]) {
      expect(keysFor("%10", { via: "digit", digit }).ok).toBe(false);
    }
  });

  it("refuses an arrow key that is neither Down nor Up", () => {
    const r = keysFor("%10", { via: "arrows", key: "Left" as "Down", presses: 2 });
    expect(r.ok).toBe(false);
  });

  it("puts the arrows and the Enter in one call, leaving no window between them", () => {
    const r = keysFor("%10", { via: "arrows", key: "Up", presses: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.keys).toEqual([["send-keys", "-t", "%10", "Up", "Up", "Up", "Enter"]]);
      expect(r.keys).toHaveLength(1);
    }
  });

  it("still sends the digit alone, and the bare Enter alone", () => {
    const digit = keysFor("%10", { via: "digit", digit: "3" });
    expect(digit.ok && digit.keys).toEqual([["send-keys", "-t", "%10", "-l", "--", "3"]]);
    const selected = keysFor("%10", { via: "selected" });
    expect(selected.ok && selected.keys).toEqual([["send-keys", "-t", "%10", "Enter"]]);
  });
});

describe("sameQuestion", () => {
  it("is true for a dialog re-parsed from the same capture", () => {
    for (const name of ["dialog-bash-permission", "dialog-folder-trust", "dialog-model-selector"]) {
      expect(sameQuestion(question(name), question(name))).toBe(true);
    }
  });

  it("is false when the prompt, a label, the count or a key differs", () => {
    const a = question("dialog-bash-permission");
    expect(sameQuestion(a, { ...a, prompt: `${a.prompt} ` })).toBe(false);
    expect(sameQuestion(a, { ...a, options: a.options.slice(0, 3) })).toBe(false);
    expect(
      sameQuestion(a, { ...a, options: a.options.map((o, i) => (i === 2 ? { ...o, label: "No" } : o)) }),
    ).toBe(false);
    expect(
      sameQuestion(a, {
        ...a,
        options: a.options.map((o, i) => (i === 2 ? { ...o, key: { via: "selected" } as OptionKey } : o)),
      }),
    ).toBe(false);
  });
});

describe("reading the box", () => {
  it("parses the pane listing tmux actually prints", () => {
    expect(parsePanes(PANES)).toEqual([
      { paneId: "%10", sessionId: "$5", panePid: 100, dead: false, inMode: false },
      { paneId: "%11", sessionId: "$6", panePid: 300, dead: false, inMode: false },
    ]);
  });

  it("returns null for any line that is not a pane record, rather than skipping it", () => {
    for (const bad of ["%10|$5|100|0", "%10|$5|100|0|0|extra", "10|$5|100|0|0", "%10|5|100|0|0", "%10|$5|x|0|0", "%10|$5|100|2|0"]) {
      expect(parsePanes(bad)).toBeNull();
    }
  });

  it("reads the process table, and refuses one it does not recognise", () => {
    expect(parseParents(PARENTS)?.get(200)).toBe(100);
    expect(parseParents("")).toBeNull();
    expect(parseParents("200 100 extra")).toBeNull();
  });

  it("reads pids out of pgrep and forms no opinion about them", () => {
    // pgrep is a candidate FINDER since 2026-09-08 and nothing more: whether a
    // pid is our Claude is decided from /proc, on arguments rather than on a
    // rendering of them. So a grep and a claude are both candidates here, and
    // the two are told apart by `isClaudeForSession`.
    expect(candidatePids(PGREP)).toEqual([200]);
    expect(candidatePids(`900 grep -r ${UUID} logs/\n`)).toEqual([900]);
    expect(candidatePids(`200 claude --session-id ${UUID}\n900 grep ${UUID}\n`)).toEqual([200, 900]);
    expect(candidatePids("")).toEqual([]);
    expect(candidatePids("not a pgrep line\n")).toEqual([]);
  });

  it("splits /proc/<pid>/cmdline on NUL, dropping only the trailing empties", () => {
    expect(argvOf(`claude\0--session-id\0${UUID}\0`)).toEqual(["claude", "--session-id", UUID]);
    // an empty argument in the MIDDLE is a real argument, and dropping it would
    // shift a value away from its option
    expect(argvOf("claude\0--name\0\0--session-id\0x\0")).toEqual(["claude", "--name", "", "--session-id", "x"]);
    expect(argvOf("claude\0\0\0")).toEqual(["claude"]);
    expect(argvOf("")).toEqual([]);
  });

  /**
   * SOL'S F3, AS A TEST OF THE THING THAT DECIDES.
   *
   * The check this replaces asked whether the flattened command line CONTAINED
   * the string `--session-id <uuid>`, and the test that was supposed to guard
   * it offered a candidate uuid that was a PREFIX of the expected one. A prefix
   * fails a substring test for free — it proves the substring test is a
   * substring test, which was never in doubt, and it passes just as happily
   * when the code is wrong in the direction that matters.
   *
   * The direction that matters is the other one: an argv that contains those
   * bytes somewhere that is not an option. gjd-remote passes a launch prompt as
   * a positional argument, so a conversation started with a prompt that quotes
   * another conversation's id has exactly this command line — and the old check
   * would have delivered a message meant for A into B.
   *
   * Every case below is a pair: the argv that must be refused, and next to it
   * the argv that must be accepted. A test made only of `toBe(false)` is
   * satisfied by a function that has stopped saying yes to anything.
   */
  it("identifies a claude by its actual argv, not by bytes in its command line", () => {
    const real = ["claude", "--session-id", UUID, "--name", "fleet-dashboard-v01"];
    expect(isClaudeForSession(real, UUID)).toBe(true);
    expect(isClaudeForSession(["claude", `--session-id=${UUID}`], UUID)).toBe(true);

    // F3 itself: a DIFFERENT conversation whose initial prompt mentions ours.
    // pgrep would flatten this to a command line containing `--session-id
    // <UUID>`, and the ancestry walk cannot tell the two apart.
    const impostor = ["claude", "--session-id", OTHER_UUID, `read the notes at --session-id ${UUID} and continue`];
    expect(isClaudeForSession(impostor, UUID)).toBe(false);
    expect(isClaudeForSession(impostor, OTHER_UUID)).toBe(true);
    expect(impostor.join(" ")).toContain(`--session-id ${UUID}`);

    // the prompt as its own argument, with no other option in the way
    expect(isClaudeForSession(["claude", `--session-id ${UUID}`], UUID)).toBe(false);
    expect(isClaudeForSession(["claude", "--session-id", UUID], UUID)).toBe(true);

    // after a bare `--` everything is positional by definition
    expect(isClaudeForSession(["claude", "--session-id", OTHER_UUID, "--", "--session-id", UUID], UUID)).toBe(false);
    expect(isClaudeForSession(["claude", "--session-id", UUID, "--", "go on"], UUID)).toBe(true);

    // the expected uuid with something appended is a different uuid, and this
    // is the case the old prefix test was reaching for and had backwards
    expect(isClaudeForSession(["claude", "--session-id", `${UUID}9`], UUID)).toBe(false);
    expect(isClaudeForSession(["claude", "--session-id", UUID.slice(0, 8)], UUID)).toBe(false);
    expect(isClaudeForSession(["claude", "--session-id", UUID], UUID)).toBe(true);

    // two of them: we cannot know which one the CLI kept, so we refuse rather
    // than guess "the first", which would answer yes to ours-then-theirs
    expect(isClaudeForSession(["claude", "--session-id", UUID, "--session-id", OTHER_UUID], UUID)).toBe(false);
    expect(isClaudeForSession(["claude", "--session-id", OTHER_UUID, "--session-id", UUID], UUID)).toBe(false);

    // the option with no value at all
    expect(isClaudeForSession(["claude", "--session-id"], UUID)).toBe(false);

    // argv[0] must be a claude, by basename, wherever it was installed
    expect(isClaudeForSession(["grep", "--session-id", UUID], UUID)).toBe(false);
    expect(isClaudeForSession(["/home/greg/.local/bin/claude", "--session-id", UUID], UUID)).toBe(true);
    expect(isClaudeForSession([], UUID)).toBe(false);
  });

  it("walks ancestry, bounded, and survives a cycle in a table read line by line", () => {
    const parents = new Map([
      [200, 100],
      [100, 1],
      [7, 8],
      [8, 7],
    ]);
    expect(descendsFrom(200, 100, parents)).toBe(true);
    expect(descendsFrom(100, 100, parents)).toBe(true);
    expect(descendsFrom(200, 300, parents)).toBe(false);
    expect(descendsFrom(7, 100, parents)).toBe(false);
    // a chain longer than the bound is refused rather than followed forever
    const deep = new Map<number, number>();
    for (let i = 1; i <= 100; i++) deep.set(i, i + 1);
    expect(descendsFrom(1, 100, deep)).toBe(false);
  });
});

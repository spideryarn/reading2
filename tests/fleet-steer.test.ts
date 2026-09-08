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

import { parsePane, type OptionKey } from "../tools/fleet/pane.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import {
  answerQuestion,
  checkText,
  claudePidsFor,
  descendsFrom,
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

const TARGET: SteerTarget = { paneId: "%10", sessionId: "$5", claudeSessionId: UUID, panePid: 100 };
const WORKING: FleetStatus = { kind: "working" };
const NEEDS_YOU: FleetStatus = { kind: "needs-you" };

type Box = {
  panes?: string;
  parents?: string;
  pgrep?: string;
  capture?: string;
  /** Make one of the reads fail the way an absent or angry command does. */
  throwOn?: "panes" | "parents" | "pgrep" | "capture" | "send";
};

function fakeBox(box: Box = {}): { io: SteerIo; sent: string[][] } {
  const sent: string[][] = [];
  const boom = (what: string) => {
    throw new Error(`${what}: no such thing`);
  };
  const io: SteerIo = {
    listPanes: () => (box.throwOn === "panes" ? boom("tmux") : (box.panes ?? PANES)),
    processParents: () => (box.throwOn === "parents" ? boom("ps") : (box.parents ?? PARENTS)),
    claudeCandidates: () => (box.throwOn === "pgrep" ? boom("pgrep") : (box.pgrep ?? PGREP)),
    capture: () => (box.throwOn === "capture" ? boom("capture-pane") : (box.capture ?? "")),
    sendKeys: (args) => {
      if (box.throwOn === "send") boom("send-keys");
      sent.push([...args]);
    },
  };
  return { io, sent };
}

/** Every refusal must be a refusal AND a silence. Asserting only `ok` is not enough. */
function refused(result: SteerResult, sent: string[][], code: string): void {
  if (result.ok) throw new Error(`expected a refusal, got a send of ${JSON.stringify(result.sent)}`);
  expect(result.reason.code).toBe(code);
  expect(result.reason.why.length).toBeGreaterThan(10);
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

  it("refuses when tmux or the process table cannot be asked at all", () => {
    for (const throwOn of ["panes", "parents", "pgrep"] as const) {
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
    const result = sendMessage(TARGET, "keep going", WORKING, io);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("send-failed");
    expect(sent).toEqual([]);
  });
});

describe("the status the caller derived is checked before anything is sent", () => {
  it("refuses every kind that is not a Claude at a prompt", () => {
    const notSteerable: FleetStatus[] = [
      { kind: "shell", busy: true },
      { kind: "shell", busy: null },
      { kind: "no-claude" },
      { kind: "waiting", secondsLeft: 300 },
      { kind: "unknown", why: "the box could not say what Claude is doing" },
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
  it("sends the digit, and only the digit, for a numbered dialog", () => {
    const seen = question("dialog-bash-permission");
    const { io, sent } = fakeBox({ capture: fixture("dialog-bash-permission") });
    const result = answerQuestion(TARGET, seen, 3, NEEDS_YOU, io);

    expect(result.ok).toBe(true);
    // No Enter: a numbered Claude Code dialog acts on the digit, and a trailing
    // Enter would land in whatever screen the choice opened.
    expect(sent).toEqual([["send-keys", "-t", "%10", "-l", "--", "4"]]);
  });

  it("sends N arrows in one call and the Enter in another, for a cursor menu", () => {
    const seen = question("dialog-folder-trust");
    const { io, sent } = fakeBox({ capture: fixture("dialog-folder-trust") });
    const result = answerQuestion(TARGET, seen, 1, NEEDS_YOU, io);

    expect(result.ok).toBe(true);
    expect(sent).toEqual([
      ["send-keys", "-t", "%10", "Down"],
      ["send-keys", "-t", "%10", "Enter"],
    ]);
  });

  it("sends Enter alone for the option the cursor is already on", () => {
    const seen = question("dialog-folder-trust");
    const { io, sent } = fakeBox({ capture: fixture("dialog-folder-trust") });
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

  /** The identity check runs after the parse, so it still gates the send. */
  it("refuses a dialog in a pane that no longer holds the expected Claude", () => {
    const seen = question("dialog-bash-permission");
    const { io, sent } = fakeBox({ capture: fixture("dialog-bash-permission"), pgrep: "" });
    refused(answerQuestion(TARGET, seen, 0, NEEDS_YOU, io), sent, "no-claude-in-pane");
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

  it("repeats the arrow key rather than sending one call per press", () => {
    const r = keysFor("%10", { via: "arrows", key: "Up", presses: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.keys).toEqual([
        ["send-keys", "-t", "%10", "Up", "Up", "Up"],
        ["send-keys", "-t", "%10", "Enter"],
      ]);
    }
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

  it("only counts a pgrep hit that is really a claude for this conversation", () => {
    expect(claudePidsFor(PGREP, UUID)).toEqual([200]);
    // mentions the uuid but is not a claude: an agent grepping for it, say
    expect(claudePidsFor(`900 grep -r --session-id ${UUID} logs/\n`, UUID)).toEqual([]);
    // a claude, but somebody else's conversation
    expect(claudePidsFor(`900 claude --session-id ${OTHER_UUID}\n`, UUID)).toEqual([]);
    // a claude for a uuid that merely starts with ours would not match either
    expect(claudePidsFor("900 claude --session-id 117e181a\n", UUID)).toEqual([]);
    expect(claudePidsFor("", UUID)).toEqual([]);
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

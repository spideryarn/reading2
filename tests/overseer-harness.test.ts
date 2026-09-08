/**
 * Which harness is holding this pane's terminal, and what can honestly be done
 * to it?
 *
 * The trees are the same captures `tests/overseer-work.test.ts` uses - real,
 * taken off this box on 2026-09-08 - because the harness question and the work
 * question are asked of the same process table and must not drift onto two
 * fixture formats. See `tests/fixtures/overseer-process-trees/README.md`.
 *
 * WHERE A CASE IS CONSTRUCTED IT SAYS SO IN ITS NAME, and it is built by
 * editing ONE FIELD of a captured row rather than by inventing a command line.
 * That matters most for `codex`: no pane on this box has ever been a Codex
 * session (measured 2026-09-08, 22 panes, 0 of them), so the only honest way to
 * exercise that arm is to re-parent a genuinely captured `codex exec` row.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  HARNESS_CAPABILITIES,
  capabilitiesOf,
  classifyPaneHarness,
  describeHarness,
  type Harness,
  type HarnessKind,
} from "../tools/overseer/harness.js";
import { parseProcessTable, type ProcessTableReading } from "../tools/overseer/work.js";

const TREES = join(import.meta.dirname, "fixtures", "overseer-process-trees");

/** The instant every fixture is read "at", so start times are deterministic. */
const NOW_MS = Date.UTC(2026, 8, 8, 12, 0, 0);

function raw(name: string): string {
  return readFileSync(join(TREES, `${name}.txt`), "utf8");
}

function readingOfText(text: string): ProcessTableReading {
  const parsed = parseProcessTable(text, NOW_MS);
  if (!parsed.ok) throw new Error(`table did not parse: ${parsed.reason}`);
  return { read: true, rows: parsed.rows, atMs: NOW_MS };
}

function readingOf(name: string): ProcessTableReading {
  return readingOfText(raw(name));
}

/** The pane pid each captured tree is rooted at - the first pid in the file. */
const PANE = {
  "codex-review-under-pane": 3184904,
  "headless-claude-under-pane": 3184904,
  "quiet-claude-pane": 652780,
  "browser-pane": 430640,
  "shell-pane-running-tests": 1234211,
  "codex-batch-pane": 94316,
  "codex-interactive-pane": 4108994,
} as const;

/**
 * One captured row, verbatim, with its ppid replaced.
 *
 * The whole point is that the COMMAND is never retyped: a hand-written
 * `codex exec ...` would agree with whatever its author imagined, and the
 * argument order of a real one is not what anybody would guess.
 */
function reparent(fixture: string, pid: number, newPpid: number): string {
  for (const line of raw(fixture).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+(.*)$/.exec(line);
    if (m === null) continue;
    if (Number(m[1]) !== pid) continue;
    return `${m[1]} ${newPpid} ${m[3]} ${m[4]}`;
  }
  throw new Error(`pid ${pid} is not in fixture ${fixture}`);
}

describe("the harness a real captured pane is running", () => {
  test("a gjd-remote Claude pane is claude-code, and carries its session id", () => {
    const h = classifyPaneHarness(PANE["quiet-claude-pane"], readingOf("quiet-claude-pane"));
    expect(h.kind).toBe("claude-code");
    if (h.kind !== "claude-code") return;
    expect(h.claudeSessionId).toBe("404961e7-a9af-47c9-bf9e-38918ba8ffc4");
    expect(h.pid).toBe(412924);
    // Depth 1: the claude is a direct child of the pane's job shell.
    expect(h.depth).toBe(1);
  });

  test("a pane whose Claude is buried under twenty browser processes is still claude-code", () => {
    const h = classifyPaneHarness(PANE["browser-pane"], readingOf("browser-pane"));
    expect(h.kind).toBe("claude-code");
    if (h.kind !== "claude-code") return;
    expect(h.claudeSessionId).toBe("3dbdbfcb-3264-4b23-9243-1c3013826ae9");
  });

  test("a pane running the suite under `sh -c` is a shell, positively - not a fallback", () => {
    const h = classifyPaneHarness(PANE["shell-pane-running-tests"], readingOf("shell-pane-running-tests"));
    expect(h.kind).toBe("shell");
    if (h.kind !== "shell") return;
    expect(h.pid).toBe(PANE["shell-pane-running-tests"]);
    expect(h.command).toContain("vitest");
  });
});

describe("a Claude session that spawned a Codex is ONE session, not two", () => {
  /**
   * THE TEST THIS STAGE EXISTS FOR.
   *
   * `codex-review-under-pane` is a real, paid `codex exec` running EIGHT levels
   * below a Claude pane. If the harness walk went looking for the deepest or
   * the first-found harness rather than the SHALLOWEST, this pane would turn
   * into a Codex row and a Claude session would vanish from the fleet while it
   * ran a review.
   */
  test("a real codex exec at depth 8 does not make its Claude pane a Codex row", () => {
    const reading = readingOf("codex-review-under-pane");
    const h = classifyPaneHarness(PANE["codex-review-under-pane"], reading);
    expect(h.kind).toBe("claude-code");
    if (h.kind !== "claude-code") return;
    expect(h.claudeSessionId).toBe("cb936df3-428d-436f-a731-3397cf339abd");
    expect(h.depth).toBe(1);

    // And the codex really is in that tree - otherwise this test would pass on
    // a capture that had nothing to be confused by. (A zero from a working
    // instrument and a zero from a broken one are the same number.)
    if (!reading.read) throw new Error("fixture unreadable");
    expect(reading.rows.some((r) => /^codex exec(\s|$)/.test(r.command))).toBe(true);
  });

  test("a real claude --print at depth 8 does not make its Claude pane headless", () => {
    const reading = readingOf("headless-claude-under-pane");
    const h = classifyPaneHarness(PANE["headless-claude-under-pane"], reading);
    expect(h.kind).toBe("claude-code");
    if (!reading.read) throw new Error("fixture unreadable");
    expect(reading.rows.some((r) => /(^|\/)claude --print(\s|$)/.test(r.command))).toBe(true);
  });
});

describe("a Codex pane", () => {
  /**
   * POSITIVE CONTROLS for the two Codex arms. Both are REAL captures, taken
   * 2026-09-08 ~12:15 UTC while the things were genuinely running - which was
   * lucky and is worth saying plainly: seventeen minutes earlier there were no
   * Codex panes on this box at all, and the first measurement for this stage
   * recorded that as a finding. The fleet is a moving tree, and "zero today" is
   * a reading rather than a property.
   */
  test("control - a real `codex exec` pane is codex-batch, five levels under an `sh -c`", () => {
    const h = classifyPaneHarness(PANE["codex-batch-pane"], readingOf("codex-batch-pane"));
    expect(h.kind).toBe("codex-batch");
    if (h.kind !== "codex-batch") return;
    expect(h.pid).toBe(94842);
    // The pane process is `sh -c ( 'npx' 'tsx' 'scripts/run-codex.ts' … )`, so
    // the harness is five hops down. A classifier that only looked at the pane
    // row would have called this a shell and said nothing about the paid GPT
    // run occupying it.
    //
    // FIVE, not the eight the older fixture shows, and not the six this test
    // was first written with: this launch has no `timeout` wrapper and no
    // Bash-tool `bash -c` above it, because it came from `tmux-job.ts` rather
    // than from inside a session. The number was corrected to the capture. Any
    // depth limit would be a limit tuned to one person's typing.
    expect(h.depth).toBe(5);
  });

  test("control - a real bare `codex` under a login shell is codex-interactive", () => {
    const h = classifyPaneHarness(PANE["codex-interactive-pane"], readingOf("codex-interactive-pane"));
    expect(h.kind).toBe("codex-interactive");
    if (h.kind !== "codex-interactive") return;
    expect(h.pid).toBe(4184296);
    expect(h.depth).toBe(1);
  });

  test("a shell pane with a harness under it is named for the harness, not the shell", () => {
    // Both real fixtures are `sh`/`bash` panes. The rule that separates them
    // from `shell-pane-running-tests` - also an `sh -c` pane - is that a
    // harness was found in the tree at all. vitest is work; codex is a harness.
    for (const name of ["codex-batch-pane", "codex-interactive-pane"] as const) {
      expect(classifyPaneHarness(PANE[name], readingOf(name)).kind).not.toBe("shell");
    }
  });

  test("a captured `codex exec` re-parented directly under a pane is still codex-batch (constructed)", () => {
    // Depth 1 rather than 6, to show the depth is read rather than assumed.
    const paneRow = "  9001     1   1000 bash /home/greg/gjd-remote/jobs/pretend-codex.sh";
    const codexRow = reparent("codex-review-under-pane", 1370771, 9001);
    const h = classifyPaneHarness(9001, readingOfText(`${paneRow}\n${codexRow}\n`));
    expect(h.kind).toBe("codex-batch");
    if (h.kind !== "codex-batch") return;
    expect(h.pid).toBe(1370771);
    expect(h.depth).toBe(1);
  });

  test("an interactive codex carrying flags is still interactive (constructed)", () => {
    const table = "  9001     1   1000 bash -l\n  9002  9001    999 codex --model gpt-5.6-sol\n";
    const h = classifyPaneHarness(9001, readingOfText(table));
    expect(h.kind).toBe("codex-interactive");
  });

  test("`codex e` and `codex review` are batch too - both are documented non-interactive (constructed)", () => {
    for (const argv of ["codex e --model x", "codex review --model x"]) {
      const table = `  9001     1   1000 bash -l\n  9002  9001    999 ${argv}\n`;
      expect(classifyPaneHarness(9001, readingOfText(table)).kind).toBe("codex-batch");
    }
  });

  test("the /tmp fake-codex harness is never a Codex pane", () => {
    // Its argv[0] is `bash`, and shells are never peeled. So the pane is a
    // shell running a script that happens to be called `codex`.
    const orphan = raw("orphan-fake-codex").split("\n").filter((l) => l.trim() !== "");
    const first = orphan[0];
    if (first === undefined) throw new Error("orphan fixture is empty");
    const m = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+(.*)$/.exec(first);
    if (m === null) throw new Error("orphan fixture row did not parse");
    const h = classifyPaneHarness(Number(m[1]), readingOfText(orphan.join("\n")));
    expect(h.kind).toBe("shell");
  });
});

describe("an unrecognised pane is `unknown` with a why, never silently a shell", () => {
  test("a pane running something we have never seen is unknown (constructed)", () => {
    const table = "  9001     1   1000 /usr/bin/emacs -nw\n";
    const h = classifyPaneHarness(9001, readingOfText(table));
    expect(h.kind).toBe("unknown");
    if (h.kind !== "unknown") return;
    expect(h.cause).toBe("unrecognised-pane-process");
    expect(h.why).toContain("emacs");
    expect(h.why.length).toBeGreaterThan(20);
  });

  test("two different --session-id values is ambiguous, not the first one (constructed)", () => {
    const table = [
      "  9001     1   1000 bash -l",
      "  9002  9001    999 claude --session-id aaa --session-id bbb hello",
    ].join("\n");
    const h = classifyPaneHarness(9001, readingOfText(table));
    expect(h.kind).toBe("unknown");
    if (h.kind !== "unknown") return;
    expect(h.cause).toBe("ambiguous-harness");
    expect(h.why).toContain("aaa");
  });

  test("a codex subcommand we do not know is ambiguous, not assumed to be a TUI (constructed)", () => {
    const table = "  9001     1   1000 bash -l\n  9002  9001    999 codex teleport --now\n";
    const h = classifyPaneHarness(9001, readingOfText(table));
    expect(h.kind).toBe("unknown");
    if (h.kind !== "unknown") return;
    expect(h.cause).toBe("ambiguous-harness");
    expect(h.why).toContain("teleport");
  });
});

describe("a headless Claude is never declared steerable", () => {
  /**
   * THE FALSE GRANT A CROSS-FAMILY REVIEW FOUND.
   *
   * The recogniser used to anchor on the FIRST argument only, so a
   * `--session-id` in front of a `--print` matched the interactive arm and the
   * capability table then granted prose steering on a run that had stopped
   * reading its terminal. Every ordering is asserted here, because the bug was
   * an ordering the original tests never tried.
   */
  test("`--print` anywhere in the option region wins over `--session-id` (constructed)", () => {
    for (const argv of [
      "claude --session-id abc --print do the thing",
      "claude --print --session-id abc do the thing",
      "claude --session-id abc -p do the thing",
      "claude --model opus -p do the thing",
      "claude --model opus --session-id abc --print go",
    ]) {
      const table = `  9001     1   1000 bash -l\n  9002  9001    999 ${argv}\n`;
      const h = classifyPaneHarness(9001, readingOfText(table));
      expect(h.kind, argv).toBe("claude-headless");
      expect(HARNESS_CAPABILITIES[h.kind].steerWithProse.can, argv).toBe(false);
    }
  });

  test("a `--print` inside the PROMPT does not make a live session headless (constructed)", () => {
    // The other direction, and the reason the scan stops at the first bare
    // word: a prompt is free text, and agents here write about flags all day.
    const argv = "claude --session-id 404961e7-a9af-47c9-bf9e-38918ba8ffc4 Please add a --print flag to the CLI";
    const table = `  9001     1   1000 bash -l\n  9002  9001    999 ${argv}\n`;
    const h = classifyPaneHarness(9001, readingOfText(table));
    expect(h.kind).toBe("claude-code");
    if (h.kind !== "claude-code") return;
    expect(h.claudeSessionId).toBe("404961e7-a9af-47c9-bf9e-38918ba8ffc4");
  });

  test("`--session-id=abc` is read, so this reader and steer.ts do not disagree (constructed)", () => {
    const table = "  9001     1   1000 bash -l\n  9002  9001    999 claude --session-id=abc hello\n";
    const h = classifyPaneHarness(9001, readingOfText(table));
    expect(h.kind).toBe("claude-code");
    if (h.kind !== "claude-code") return;
    expect(h.claudeSessionId).toBe("abc");
  });

  test("two harnesses at the same depth is ambiguous, not a coin toss (constructed)", () => {
    const table = [
      "  9001     1   1000 bash -l",
      "  9002  9001    999 claude --session-id 404961e7-a9af-47c9-bf9e-38918ba8ffc4 hello",
      "  9003  9001    999 codex exec --model gpt-5.6-sol -- hello",
    ].join("\n");
    const h = classifyPaneHarness(9001, readingOfText(table));
    expect(h.kind).toBe("unknown");
    if (h.kind !== "unknown") return;
    expect(h.cause).toBe("ambiguous-harness");
  });

  test("a shallower harness beats a deeper one rather than being ambiguous (constructed)", () => {
    const table = [
      "  9001     1   1000 bash -l",
      "  9002  9001    999 claude --session-id 404961e7-a9af-47c9-bf9e-38918ba8ffc4 hello",
      "  9003  9002    998 codex exec --model gpt-5.6-sol -- hello",
    ].join("\n");
    expect(classifyPaneHarness(9001, readingOfText(table)).kind).toBe("claude-code");
  });
});

describe("a reading that could not be taken is not an answer about the pane", () => {
  test("no pane pid", () => {
    const h = classifyPaneHarness(null, readingOf("quiet-claude-pane"));
    expect(h.kind).toBe("unknown");
    if (h.kind !== "unknown") return;
    expect(h.cause).toBe("no-pane-pid");
    expect(h.why).toContain("pane pid");
  });

  test("an unreadable process table carries the probe's own sentence", () => {
    const h = classifyPaneHarness(9001, { read: false, why: "ps is not on PATH" });
    expect(h.kind).toBe("unknown");
    if (h.kind !== "unknown") return;
    expect(h.cause).toBe("process-table-unreadable");
    expect(h.why).toBe("ps is not on PATH");
  });

  test("a pane that is not in the table is not an empty pane", () => {
    const h = classifyPaneHarness(999999, readingOf("quiet-claude-pane"));
    expect(h.kind).toBe("unknown");
    if (h.kind !== "unknown") return;
    expect(h.cause).toBe("pane-not-in-table");
  });

  test("a table with a duplicate pid is refused rather than half-walked (constructed)", () => {
    const h = classifyPaneHarness(9001, {
      read: true,
      atMs: NOW_MS,
      rows: [
        { pid: 9001, ppid: 1, command: "bash -l", started: { known: false } },
        { pid: 9001, ppid: 1, command: "bash -l", started: { known: false } },
      ],
    });
    expect(h.kind).toBe("unknown");
    if (h.kind !== "unknown") return;
    expect(h.cause).toBe("malformed-process-table");
  });

  test("a cycle beats a shallow harness hit, rather than being outrun by it (constructed)", () => {
    // THE CASE A CROSS-FAMILY REVIEW BUILT. Selection returns as soon as one
    // level has a single hit, so a cycle elsewhere in the tree was never
    // reached and this table produced a STEERABLE `claude-code` — a capability
    // grant decided from rows that are not an ancestry. Structure is now
    // validated over the whole reachable subtree before anything is selected.
    const h = classifyPaneHarness(1, {
      read: true,
      atMs: NOW_MS,
      rows: [
        { pid: 1, ppid: 3, command: "bash -l", started: { known: false } },
        { pid: 2, ppid: 1, command: "claude --session-id abc", started: { known: false } },
        { pid: 3, ppid: 1, command: "sleep 1", started: { known: false } },
      ],
    });
    expect(h.kind).toBe("unknown");
    if (h.kind !== "unknown") return;
    expect(h.cause).toBe("malformed-process-table");
  });

  test("a self-parented pane is malformed even when it is itself a harness (constructed)", () => {
    // The depth-0 check used to answer before any walk happened at all.
    const h = classifyPaneHarness(9001, {
      read: true,
      atMs: NOW_MS,
      rows: [{ pid: 9001, ppid: 9001, command: "claude --session-id abc", started: { known: false } }],
    });
    expect(h.kind).toBe("unknown");
    if (h.kind !== "unknown") return;
    expect(h.cause).toBe("malformed-process-table");
  });

  test("an unreadable probe that gave no reason still yields a usable why (constructed)", () => {
    // `why` is the whole value of this arm, and an empty one renders as a
    // greyed-out button with no reason beside it.
    const h = classifyPaneHarness(9001, { read: false, why: "   " });
    expect(h.kind).toBe("unknown");
    if (h.kind !== "unknown") return;
    expect(h.cause).toBe("process-table-unreadable");
    expect(h.why.trim()).not.toBe("");
    expect(h.why).toContain("did not say why");
  });

  test("a walk that comes back on itself is malformed, not quiet (constructed)", () => {
    const h = classifyPaneHarness(9001, {
      read: true,
      atMs: NOW_MS,
      rows: [
        { pid: 9001, ppid: 9003, command: "bash -l", started: { known: false } },
        { pid: 9002, ppid: 9001, command: "sleep 1", started: { known: false } },
        { pid: 9003, ppid: 9002, command: "sleep 1", started: { known: false } },
      ],
    });
    expect(h.kind).toBe("unknown");
    if (h.kind !== "unknown") return;
    expect(h.cause).toBe("malformed-process-table");
  });
});

describe("the capability declaration", () => {
  const KINDS: readonly HarnessKind[] = [
    "claude-code",
    "claude-headless",
    "codex-batch",
    "codex-interactive",
    "shell",
    "unknown",
  ];

  test("every harness kind declares all three capabilities", () => {
    // A `Record` over the closed union already makes a missing entry a compile
    // error. This is the runtime half: that the table's KEYS are exactly the
    // union's arms, so a kind cannot be added to the type and quietly given the
    // capabilities of nothing.
    expect(Object.keys(HARNESS_CAPABILITIES).sort()).toEqual([...KINDS].sort());
  });

  test("every refusal says why, in a sentence a person could act on", () => {
    for (const kind of KINDS) {
      const caps = HARNESS_CAPABILITIES[kind];
      for (const [name, cap] of Object.entries(caps)) {
        if (cap.can) continue;
        expect(cap.why, `${kind}.${name}`).not.toBe("");
        // Long enough to be a reason rather than a label. "no" is not a reason.
        expect(cap.why.length, `${kind}.${name}`).toBeGreaterThan(25);
      }
    }
  });

  test("everything on this box can be watched; that is what makes the refusals honest", () => {
    for (const kind of KINDS) expect(HARNESS_CAPABILITIES[kind].watch.can, kind).toBe(true);
  });

  test("exactly one kind can be steered with prose, and it is interactive Claude", () => {
    const steerable = KINDS.filter((k) => HARNESS_CAPABILITIES[k].steerWithProse.can);
    expect(steerable).toEqual(["claude-code"]);
  });

  test("a Codex batch job cannot receive a keystroke at all, and the why says why not", () => {
    const cap = HARNESS_CAPABILITIES["codex-batch"].steerWithProse;
    expect(cap.can).toBe(false);
    if (cap.can) return;
    // The measured cause, not a shrug: subagent-cli.ts spawns with fd 0 ignored.
    expect(cap.why).toMatch(/stdin|fd 0/i);
  });

  test("an interactive Codex is refused as UNPROVEN, not as impossible", () => {
    // The distinction decides whether a later stage should try. Flattening the
    // two refusals into one sentence would say something false about one.
    const batch = HARNESS_CAPABILITIES["codex-batch"].steerWithProse;
    const interactive = HARNESS_CAPABILITIES["codex-interactive"].steerWithProse;
    expect(batch.can).toBe(false);
    expect(interactive.can).toBe(false);
    if (batch.can || interactive.can) return;
    expect(interactive.why).not.toBe(batch.why);
    expect(interactive.why).toMatch(/never|not been|no evidence|unproven/i);
  });

  test("a bare shell is refused because it would EXECUTE the text", () => {
    const cap = HARNESS_CAPABILITIES.shell.steerWithProse;
    expect(cap.can).toBe(false);
    if (cap.can) return;
    expect(cap.why).toMatch(/execut/i);
  });

  test("capabilitiesOf routes a value to its kind's row", () => {
    const h: Harness = { kind: "shell", pid: 1, command: "bash -l" };
    expect(capabilitiesOf(h)).toBe(HARNESS_CAPABILITIES.shell);
  });
});

describe("describing a harness", () => {
  const UNKNOWN: Harness = {
    kind: "unknown",
    cause: "unrecognised-pane-process",
    why: "pane 1 is running `emacs -nw`, which is no harness this knows",
  };

  test("every arm gets a sentence", () => {
    const values: readonly Harness[] = [
      { kind: "claude-code", pid: 1, depth: 1, claudeSessionId: "404961e7-a9af-47c9-bf9e-38918ba8ffc4" },
      { kind: "claude-code", pid: 1, depth: 1, claudeSessionId: null },
      { kind: "claude-headless", pid: 1, depth: 1 },
      { kind: "codex-batch", pid: 1, depth: 1 },
      { kind: "codex-interactive", pid: 1, depth: 1 },
      { kind: "shell", pid: 1, command: "bash -l" },
      UNKNOWN,
    ];
    for (const v of values) {
      const said = describeHarness(v);
      expect(said, v.kind).not.toBe("");
      expect(said.length, v.kind).toBeGreaterThan(5);
    }
  });

  test("the unknown arm's sentence carries its own why, rather than saying `unknown`", () => {
    expect(describeHarness(UNKNOWN)).toContain("emacs");
  });
});

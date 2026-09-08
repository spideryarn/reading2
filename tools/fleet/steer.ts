/**
 * v0.2 of the fleet dashboard: putting a keystroke into somebody's session.
 *
 * THIS IS THE ONLY PART OF THE DASHBOARD THAT CAN DO HARM, and it is mostly
 * guards. Everything else here reads. Direction and the measured constraints:
 * docs/project/orchestrator-direction.md § Constraints already established, and
 * docs/reusable/agent-fleet-dashboard.md § "Talking to a session", which is the
 * same story with the day it cost attached.
 *
 * WHAT IS SETTLED, AND IS NOT REOPENED HERE:
 *
 *  - **`tmux send-keys` is the channel.** It is the only one proven: `Down` then
 *    `Enter` answered a real trust dialog on 2026-09-07.
 *  - **The Claude inbox socket does not deliver from an outside process.** That
 *    claim was retracted the same day — the socket accepts the connection and
 *    returns no error whether the token is right, wrong or absent, and nothing
 *    arrives. Nothing in this file may grow a second channel on it.
 *  - **A Codex batch job cannot receive a keystroke at all.** `scripts/subagent-cli.ts`
 *    spawns them with `fd 0 = 'ignore'`, which it calls "the load-bearing
 *    anti-hang guarantee". There is no degraded mode for those; there is a
 *    refusal.
 *  - **A bare shell would EXECUTE the text.** A steering message typed at a
 *    session the page mislabelled is a command line, and `rm` is a word people
 *    write in messages.
 *
 * SO EVERY ENTRY POINT REFUSES RATHER THAN DEGRADES. Each returns
 * `{ok:true,…} | {ok:false, reason}`, never throws a refusal away, and never
 * takes the second-best action when the first is unavailable. A dashboard that
 * says "sent" and did nothing is worse than one that says "no": the reader of a
 * "sent" goes away.
 *
 * THE FAILURE THIS FILE IS DESIGNED AGAINST is not "the keystroke did not
 * arrive". It is **the right text delivered to the wrong session**. A pane
 * outlives the agent that was in it, tmux ids come round again when the server
 * restarts, `respawn-pane` reuses a pane id for a new process, and pids are
 * recycled by the kernel within days. So a target is not an address, it is an
 * address PLUS an expectation, and both halves are re-checked against live tmux
 * and the live process table in the moment before the keys go out. See
 * `verifyTarget` for what is compared and `KNOWN GAPS` at the bottom of this
 * comment for what that still cannot cover.
 *
 * NO IMPORT SIDE EFFECTS. Nothing at module scope runs a command; `realIo()` is
 * a function, and the default is built per call. Importing this file from a test
 * must not touch tmux — the same rule status.ts and page.ts are written to.
 *
 * KNOWN GAPS, stated here rather than discovered later:
 *
 *  - **A window remains between the last check and the send.** tmux has no
 *    compare-and-send, so there is no way to close it. It is milliseconds, and
 *    the realistic race is not the clock but another person or agent answering
 *    the same dialog from the terminal.
 *  - **We verify the pane, not the foreground process group.** `send-keys`
 *    delivers to the pane's tty and whichever process group is in front reads
 *    it. On this box `#{pane_current_command}` is `bash` for every Claude
 *    session — Claude Code does not put itself in its own process group — so
 *    that field cannot tell a Claude pane from a shell pane and is not used. If
 *    a verified Claude session has shelled out to something in the foreground,
 *    our text goes to that instead, and nothing here can see it.
 */
import { execFileSync } from "node:child_process";

import { capturePane, isPaneId, parsePane, type OptionKey, type PaneQuestion } from "./pane.js";
import type { FleetStatus } from "./status.js";

/** The dialog arm of `PaneQuestion`, which is the only one worth answering. */
export type SeenQuestion = Extract<PaneQuestion, { kind: "question" }>;

/**
 * Where to send, and who we believe is there.
 *
 * THREE IDENTIFIERS, NOT ONE, and each rules out a different substitution:
 *
 *  - `paneId` (`%2108`) is the ADDRESS. tmux's `-t` will happily resolve a
 *    session name instead, and a name is reassigned when a session dies — the
 *    hardest-won rule in orchestrator-direction.md. `pane.ts`'s `isPaneId` makes
 *    refusing anything else structural rather than a convention.
 *  - `sessionId` (`$1643`) is tmux's own session handle, and it is what the
 *    dashboard row is keyed by. Checking it catches a pane that has been moved
 *    between sessions (`join-pane`, `move-pane` — both keep the pane id) and
 *    catches a stale row built against a previous tmux server, where `%12` and
 *    `$9` come round again together but never in the same pairing.
 *  - `claudeSessionId` is the CONVERSATION, and it is the only one of the three
 *    that survives `gjd-remote resume`. A resumed session is the same pane and
 *    the same tmux session running a different conversation; without this field
 *    a message aimed at what somebody read ten minutes ago lands in whatever is
 *    there now. It is required for that reason, not optional with a fallback.
 *
 * `panePid` stays optional, and the dashboard row does now carry it (`FleetRow`,
 * since 2026-09-08 — tmux is asked for `#{pane_pid}` in the same listing that
 * gives us the pane handle). It catches `respawn-pane`, which keeps the pane id
 * and starts a new process, the one way a pane's contents change identity
 * without the pane id changing. It is optional rather than required because a
 * pid tmux would not tell us must degrade to "no respawn check" rather than
 * making the row unsteerable: every other guard here still applies. Supply it
 * when you have it, which is nearly always.
 */
export type SteerTarget = {
  /** tmux pane handle: `%` and digits. */
  paneId: string;
  /** tmux session handle: `$` and digits. */
  sessionId: string;
  /** The `claude --session-id` uuid expected to be running in that pane. */
  claudeSessionId: string;
  /** `#{pane_pid}` as the caller last saw it. Verified when present. */
  panePid?: number;
};

/**
 * Why we did not send.
 *
 * A code AND a sentence: the code is for a caller deciding what to do (retry
 * after a refresh, or stop), the sentence is for the person reading the page,
 * who needs to know whether the box is broken or their view is stale.
 */
export type RefusalCode =
  /** The target is not shaped like an address at all. A bug in the caller. */
  | "bad-target"
  /** The status the caller derived says this is not a Claude session at a pane. */
  | "declared-not-steerable"
  /** The message is empty, or holds bytes that are keystrokes rather than text. */
  | "bad-text"
  /** tmux or the process table could not be asked, so nothing can be believed. */
  | "box-unreadable"
  /** The pane is not there any more. */
  | "pane-gone"
  /** The pane is there and is not the one we were promised. */
  | "wrong-pane"
  /** The pane is scrolled back into copy mode, where keys are editor commands. */
  | "pane-in-copy-mode"
  /** No live `claude --session-id <expected>` under that pane. */
  | "no-claude-in-pane"
  /** The pane is no longer asking anything. */
  | "question-gone"
  /** The pane is asking something else, or asking it differently. */
  | "question-changed"
  /** The chosen option is not one of the options. */
  | "no-such-option"
  /** tmux refused the send itself. */
  | "send-failed";

export type Refusal = { code: RefusalCode; why: string };

/** What was proved true in the moment before sending. Worth logging. */
export type Verified = {
  paneId: string;
  sessionId: string;
  /** The pane's live process, which is what ancestry was walked from. */
  panePid: number;
  /** The pid of the Claude that answers to `claudeSessionId`. */
  claudePid: number;
};

/**
 * The result. `sent` is the exact argv of every tmux invocation, in order,
 * because "what did you actually press" is the first question anybody asks
 * about a session that did something surprising, and reconstructing it from
 * prose is guesswork.
 */
export type SteerResult =
  | { ok: true; verified: Verified; sent: readonly (readonly string[])[] }
  | { ok: false; reason: Refusal };

function no(code: RefusalCode, why: string): { ok: false; reason: Refusal } {
  return { ok: false, reason: { code, why } };
}

/* ------------------------------------------------------------------ *
 * Shapes. Checked at runtime because every one of these fields can
 * arrive in a JSON body from a browser, where the TypeScript type is a
 * comment.
 * ------------------------------------------------------------------ */

const SESSION_HANDLE = /^\$\d+$/;
/** Same shape gjd-remote-tmux.ts insists on before it will join to `claude agents`. */
const CLAUDE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function checkTarget(target: SteerTarget): Refusal | null {
  if (!isPaneId(target.paneId)) {
    return { code: "bad-target", why: `'${target.paneId}' is not a tmux pane id` };
  }
  if (!SESSION_HANDLE.test(target.sessionId)) {
    return { code: "bad-target", why: `'${target.sessionId}' is not a tmux session handle` };
  }
  if (!CLAUDE_UUID.test(target.claudeSessionId)) {
    return { code: "bad-target", why: "the expected Claude session id is not a session id" };
  }
  if (target.panePid !== undefined && !(Number.isSafeInteger(target.panePid) && target.panePid > 0)) {
    return { code: "bad-target", why: `'${target.panePid}' is not a pid` };
  }
  return null;
}

/**
 * Which statuses may be steered at all, from what the status pass derived.
 *
 * This is the caller's claim and it is checked FIRST because it is free and
 * because its refusal is the informative one: "that row is a shell" tells the
 * reader why the box is greyed out, where the live check would only say "no
 * Claude in that pane".
 *
 * `waiting` is refused even though it is a Claude session: it means one of our
 * own job scripts is sitting on a `sleep` and Claude is not running yet, so
 * keystrokes would go to the job script's shell. `unknown` is refused because
 * the whole point of that arm is that nobody could determine the state, and the
 * agents call failing turns EVERY Claude row unknown at once.
 *
 * The `never` is load-bearing in the same way `triageRank`'s is: an eighth
 * `SessionState` arm stops compiling here, so somebody decides whether it may be
 * typed into rather than inheriting a yes.
 */
export function steerableStatus(status: FleetStatus): Refusal | null {
  switch (status.kind) {
    case "needs-you":
    case "working":
    case "idle":
      return null;
    case "waiting":
      return { code: "declared-not-steerable", why: "it is parked on a scheduled sleep, not at a Claude prompt" };
    case "no-claude":
      return { code: "declared-not-steerable", why: "its Claude has exited" };
    case "shell":
      return { code: "declared-not-steerable", why: "it is a shell, which would EXECUTE the message" };
    case "unknown":
      return { code: "declared-not-steerable", why: `the box could not say what it is doing: ${status.why}` };
    default: {
      const never: never = status;
      return never;
    }
  }
}

function hasControlChar(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Text a person typed, checked for the things that are keystrokes rather than
 * words.
 *
 * **A newline is a submit, not a line break.** Claude Code's input box sends on
 * Enter, so a two-line message delivered literally is two messages, the first of
 * them half a sentence. Refusing is the honest answer; silently joining the
 * lines would change what the person wrote, and sending it anyway would post a
 * fragment.
 *
 * The other control characters are worse and rarer: a literal `\x03` or `\x1b`
 * in the text is Ctrl-C or Escape arriving at the far end. `-l` stops tmux
 * interpreting the NAME "C-c", which is the common case (see `sendMessage`); it
 * does nothing about the byte itself.
 */
export function checkText(text: string): Refusal | null {
  if (text.trim() === "") return { code: "bad-text", why: "the message is empty" };
  if (/[\n\r]/.test(text)) {
    return {
      code: "bad-text",
      why: "the message has more than one line, and each newline would submit it early",
    };
  }
  // C0 and DEL. Written as a code-point loop rather than a character class:
  // a control character in a SOURCE file is a byte grep cannot see and a
  // reviewer cannot read, and this repo has been bitten by writing one.
  // Tab counts: it is Claude Code's amend key, not an indent.
  if (hasControlChar(text)) {
    return { code: "bad-text", why: "the message contains a control character, which is a keystroke" };
  }
  if (text.length > 4000) {
    return { code: "bad-text", why: `the message is ${text.length} characters, and the limit is 4000` };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The box, behind an interface, so every refusal above and below can be
 * tested with fabricated strings and no tmux.
 * ------------------------------------------------------------------ */

/**
 * The five things this module needs from the machine, as RAW OUTPUT.
 *
 * Raw rather than parsed on purpose: the parsing is the part that can be wrong
 * about a live box, so it belongs on this side of the seam where a fixture can
 * drive it. A fake that returned already-parsed records would test everything
 * except the code that reads tmux.
 */
export type SteerIo = {
  /** `tmux list-panes -a -F <PANE_FIELDS>`. Throws when tmux cannot be asked. */
  listPanes(): string;
  /** The pane's visible text. Throws when the pane is gone. */
  capture(paneId: string): string;
  /** `pgrep -a -f -- "--session-id <uuid>"`, or "" when nothing matched. */
  claudeCandidates(claudeSessionId: string): string;
  /** `ps -eo pid=,ppid=`. */
  processParents(): string;
  /** Runs `tmux <args…>`. Throws when tmux refuses. */
  sendKeys(args: readonly string[]): void;
};

/**
 * The fields, in the order the parser expects.
 *
 * `list-panes -a` TAKES NO TARGET, which is the point: there is no target to get
 * wrong, and it costs one tmux invocation for the whole box rather than one per
 * pane. The same reasoning as `SESSION_FIELDS` in gjd-remote-tmux.ts, where the
 * per-target version silently printed three empty fields for two months.
 */
export const PANE_FIELDS = "#{pane_id}|#{session_id}|#{pane_pid}|#{pane_dead}|#{pane_in_mode}";

export function realIo(): SteerIo {
  const run = (args: readonly string[], cmd = "tmux"): string =>
    execFileSync(cmd, [...args], { encoding: "utf8", timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
  return {
    listPanes: () => run(["list-panes", "-a", "-F", PANE_FIELDS]),
    capture: (paneId) => capturePane(paneId),
    claudeCandidates: (claudeSessionId) => {
      try {
        // pgrep exits 1 when nothing matched, which execFileSync throws on. That
        // is "no candidates", not "could not look" — the distinction the rest of
        // this area keeps writing comments about — so it is caught HERE and
        // nowhere wider, and any other failure still propagates as unreadable.
        return run(["-a", "-f", "--", `--session-id ${claudeSessionId}`], "pgrep");
      } catch (e) {
        const status = (e as { status?: unknown }).status;
        if (status === 1) return "";
        throw e;
      }
    },
    processParents: () => run(["-eo", "pid=,ppid="], "ps"),
    sendKeys: (args) => {
      run(args);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Reading the box.
 * ------------------------------------------------------------------ */

export type PaneRecord = {
  paneId: string;
  sessionId: string;
  panePid: number;
  dead: boolean;
  inMode: boolean;
};

/**
 * `list-panes` output into records, or null if ANY line is not one.
 *
 * STRICT, for the reason `parseSessions` is strict: a listing we half-understand
 * is a listing whose absences we would reason from, and "your pane is not there"
 * is the conclusion a half-parse reaches. One malformed line fails the lot.
 */
export function parsePanes(out: string): PaneRecord[] | null {
  const records: PaneRecord[] = [];
  for (const line of out.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("|");
    if (parts.length !== 5) return null;
    const [paneId, sessionId, pid, dead, inMode] = parts as [string, string, string, string, string];
    if (!isPaneId(paneId)) return null;
    if (!SESSION_HANDLE.test(sessionId)) return null;
    if (!/^\d{1,10}$/.test(pid)) return null;
    if (dead !== "0" && dead !== "1") return null;
    if (inMode !== "0" && inMode !== "1") return null;
    records.push({ paneId, sessionId, panePid: Number(pid), dead: dead === "1", inMode: inMode === "1" });
  }
  return records;
}

/** `ps -eo pid=,ppid=` into child → parent. Null if any line is not two numbers. */
export function parseParents(out: string): Map<number, number> | null {
  const parents = new Map<number, number>();
  for (const line of out.split("\n")) {
    if (line.trim() === "") continue;
    const m = /^\s*(\d{1,10})\s+(\d{1,10})\s*$/.exec(line);
    if (!m) return null;
    parents.set(Number(m[1]), Number(m[2]));
  }
  return parents.size === 0 ? null : parents;
}

/**
 * `pgrep -a -f` output into the pids that really are a Claude for this
 * conversation.
 *
 * pgrep's pattern is a regex over the whole command line, so it can match things
 * that merely MENTION the uuid — an agent grepping for it, an editor with the
 * transcript open, this module's own report. Two narrowings, both re-done here
 * rather than trusted to pgrep:
 *
 *  - the exact substring `--session-id <uuid>` must be present, checked as a
 *    string, so a regex metacharacter cannot widen the match; and
 *  - argv[0] must be `claude`, which is what a real one looks like on this box
 *    (`claude --session-id 117e181a-… --name adversarial-fixtures`, measured
 *    2026-09-08). A wrapper with another name is refused rather than assumed,
 *    which is the wrong-way-round error to make on purpose.
 *
 * Neither of those is the guard that matters. The guard that matters is the
 * ancestry walk in `verifyTarget`: a Claude somewhere else on the box is a match
 * here and a refusal there.
 */
export function claudePidsFor(pgrepOut: string, claudeSessionId: string): number[] {
  const needle = `--session-id ${claudeSessionId}`;
  const pids: number[] = [];
  for (const line of pgrepOut.split("\n")) {
    const m = /^(\d{1,10}) (.+)$/.exec(line.trim());
    if (!m) continue;
    const cmdline = m[2] ?? "";
    if (!cmdline.includes(needle)) continue;
    const argv0 = (cmdline.split(/\s+/)[0] ?? "").split("/").pop();
    if (argv0 !== "claude") continue;
    pids.push(Number(m[1]));
  }
  return pids;
}

/**
 * Is `pid` a descendant of `ancestor` (or the same process)?
 *
 * Bounded at 32 hops and stops on a pid it has already seen, because a process
 * table read one line at a time can contain a cycle that did not exist at any
 * instant, and an unbounded walk over it hangs the request. Same bound and same
 * reason as the walk in `buildSessionScript`.
 */
export function descendsFrom(pid: number, ancestor: number, parents: ReadonlyMap<number, number>): boolean {
  let cur = pid;
  const seen = new Set<number>();
  for (let hops = 0; hops < 32; hops++) {
    if (cur === ancestor) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    const next = parents.get(cur);
    if (next === undefined || next <= 1) return false;
    cur = next;
  }
  return false;
}

/**
 * Everything above, against the live box, in the moment before we send.
 *
 * WHAT IT COMPARES, and what each one rules out:
 *
 *  1. the pane still exists → the session did not end between the page render
 *     and the tap;
 *  2. it belongs to the expected tmux session → the pane was not moved into
 *     another session, and this row is not from a previous tmux server where the
 *     same two numbers meant different things;
 *  3. it is not dead, and not in copy mode → keys will reach a program at all,
 *     rather than a corpse or the copy-mode key table, where `q` is quit and
 *     every character of a message is an editor command;
 *  4. its process is the pid we were promised, when we were promised one →
 *     `respawn-pane` did not replace the contents under the same pane id;
 *  5. a live `claude --session-id <expected uuid>` is a descendant of that
 *     pane's process → the pane still holds THIS conversation. This is the one
 *     that does the real work. It refuses a bare shell, a Codex batch job, a
 *     pane whose Claude has exited, and — the case none of the others catch — a
 *     pane that has been resumed into a DIFFERENT conversation since the caller
 *     read it.
 *
 * Together those pin address, container, process and conversation. What they
 * cannot pin is which process group is reading the tty (see the file header),
 * and the milliseconds after the last check.
 */
export function verifyTarget(target: SteerTarget, io: SteerIo): { ok: true; verified: Verified } | { ok: false; reason: Refusal } {
  const shape = checkTarget(target);
  if (shape) return { ok: false, reason: shape };

  let panes: PaneRecord[] | null;
  let parents: Map<number, number> | null;
  let candidates: number[];
  try {
    panes = parsePanes(io.listPanes());
    parents = parseParents(io.processParents());
    candidates = claudePidsFor(io.claudeCandidates(target.claudeSessionId), target.claudeSessionId);
  } catch (e) {
    return no("box-unreadable", `could not read this box's panes or processes: ${(e as Error).message}`);
  }
  if (panes === null) return no("box-unreadable", "tmux listed its panes in a shape this cannot read");
  if (parents === null) return no("box-unreadable", "the process table could not be read");

  const pane = panes.find((p) => p.paneId === target.paneId);
  if (!pane) return no("pane-gone", `pane ${target.paneId} is not on this box any more`);
  if (pane.sessionId !== target.sessionId) {
    return no(
      "wrong-pane",
      `pane ${target.paneId} is in session ${pane.sessionId} now, not ${target.sessionId}`,
    );
  }
  if (pane.dead) return no("pane-gone", `pane ${target.paneId} is dead`);
  if (pane.inMode) {
    return no("pane-in-copy-mode", `pane ${target.paneId} is scrolled back, where keys are copy-mode commands`);
  }
  if (target.panePid !== undefined && target.panePid !== pane.panePid) {
    return no(
      "wrong-pane",
      `pane ${target.paneId} is running pid ${pane.panePid} now, not ${target.panePid} — it was respawned`,
    );
  }

  const tree = parents;
  const claudePid = candidates.find((pid) => descendsFrom(pid, pane.panePid, tree));
  if (claudePid === undefined) {
    return no(
      "no-claude-in-pane",
      `no live claude for session ${target.claudeSessionId} is running under pane ${target.paneId}`,
    );
  }

  return {
    ok: true,
    verified: { paneId: pane.paneId, sessionId: pane.sessionId, panePid: pane.panePid, claudePid },
  };
}

/* ------------------------------------------------------------------ *
 * Sending.
 * ------------------------------------------------------------------ */

/**
 * The keystrokes for one parsed option.
 *
 * `digit` sends the digit and NOTHING ELSE: a numbered Claude Code dialog acts
 * on the digit immediately, and a following Enter would land in whatever screen
 * the choice opened. `arrows` sends its moves in ONE tmux call and the Enter in
 * a second, so there is no window in the middle of the movement for the cursor
 * to be moved by somebody else. `selected` sends Enter alone, which is why it is
 * its own arm rather than zero presses.
 *
 * Returns a refusal for a `presses` count that could not have come from a parse
 * — this option can arrive as JSON from a browser, where the union is a comment.
 */
export function keysFor(paneId: string, key: OptionKey): { ok: true; keys: string[][] } | { ok: false; reason: Refusal } {
  const t = ["send-keys", "-t", paneId];
  switch (key.via) {
    case "digit":
      if (!/^[1-9]$/.test(key.digit)) {
        return no("no-such-option", `'${key.digit}' is not a menu digit`);
      }
      return { ok: true, keys: [[...t, "-l", "--", key.digit]] };
    case "arrows": {
      if (key.key !== "Down" && key.key !== "Up") {
        return no("no-such-option", "an arrow option must move Down or Up");
      }
      // A parse produces presses = the distance in lines between the cursor and
      // the option, so anything past a screenful is not something we parsed.
      if (!Number.isSafeInteger(key.presses) || key.presses < 1 || key.presses > 40) {
        return no("no-such-option", `${key.presses} arrow presses is not a distance in a menu`);
      }
      return { ok: true, keys: [[...t, ...Array(key.presses).fill(key.key)], [...t, "Enter"]] };
    }
    case "selected":
      return { ok: true, keys: [[...t, "Enter"]] };
    default: {
      const never: never = key;
      return never;
    }
  }
}

/** Runs a list of tmux calls, stopping at the first that fails. */
function fire(io: SteerIo, calls: readonly string[][]): Refusal | null {
  for (const [i, call] of calls.entries()) {
    try {
      io.sendKeys(call);
    } catch (e) {
      return {
        code: "send-failed",
        why:
          i === 0
            ? `tmux refused the send: ${(e as Error).message}`
            : `tmux refused part ${i + 1} of ${calls.length}, so a PARTIAL sequence arrived: ${(e as Error).message}`,
      };
    }
  }
  return null;
}

/**
 * Free text to a session that is at a prompt.
 *
 * **`-l`, and the Enter as a separate call.** Without `-l` tmux looks the
 * argument up as a KEY NAME first, and the common steering words are key names:
 * measured on this box on 2026-09-08, `tmux send-keys -t %2164 -- "C-c"` killed
 * the process in the pane. With `-l` the same string arrives as three
 * characters. `--` then stops a message beginning with `-` being read as a flag.
 * There is no shell anywhere in this path — `execFile`, not `exec` — so a `;` or
 * a backtick in the message is only ever text.
 *
 * `declaredStatus` is what the caller's own status pass concluded. It is not
 * trusted: it is checked, and then everything it claims is checked again against
 * the live box by `verifyTarget`. It is required rather than optional so that a
 * caller cannot get a send by simply not mentioning what it knew.
 */
export function sendMessage(
  target: SteerTarget,
  text: string,
  declaredStatus: FleetStatus,
  io: SteerIo = realIo(),
): SteerResult {
  const bad = checkText(text);
  if (bad) return { ok: false, reason: bad };
  const declared = steerableStatus(declaredStatus);
  if (declared) return { ok: false, reason: declared };

  const check = verifyTarget(target, io);
  if (!check.ok) return check;

  const calls = [
    ["send-keys", "-t", target.paneId, "-l", "--", text],
    ["send-keys", "-t", target.paneId, "Enter"],
  ];
  const failed = fire(io, calls);
  if (failed) return { ok: false, reason: failed };
  return { ok: true, verified: check.verified, sent: calls };
}

/**
 * Are these the same dialog?
 *
 * Prompt, option count, every label AND every key. The keys are compared as well
 * as the labels because a cursor menu's keystrokes are relative to where the
 * cursor is: the same four options with the highlight moved one row is the same
 * QUESTION but a different ANSWER, and it means something else is driving that
 * pane right now — which is the moment to stop, not the moment to recompute.
 */
export function sameQuestion(a: SeenQuestion, b: SeenQuestion): boolean {
  if (a.prompt !== b.prompt) return false;
  if (a.options.length !== b.options.length) return false;
  return a.options.every((opt, i) => {
    const other = b.options[i];
    if (!other || other.label !== opt.label) return false;
    return JSON.stringify(other.key) === JSON.stringify(opt.key);
  });
}

/**
 * Choose one option of a dialog the caller has read.
 *
 * THE PANE IS RE-CAPTURED AND RE-PARSED HERE, and the answer is refused unless
 * it is still the same dialog. That is the whole difference between this and a
 * digit fired from a stale page: a `2` sent to a session that has stopped asking
 * does not vanish, it lands in the input box as the text "2" and sits there
 * until the next thing that agent is told, and the person who tapped it is shown
 * a success.
 *
 * **The keys sent are the ones the fresh parse produced**, not the ones in
 * `seen`. They are equal — `sameQuestion` has just insisted on it — so this
 * changes no behaviour; it means the bytes going to the pane came out of the
 * parser rather than out of an HTTP body, and nothing here has to trust a
 * hand-written `OptionKey`.
 *
 * ORDER: shape, then the caller's own status, then capture and compare, then the
 * live identity check, then send. The identity check goes LAST of the checks on
 * purpose — it is the one that must be closest to the send, because the parse in
 * front of it is the slowest thing in the sequence.
 */
export function answerQuestion(
  target: SteerTarget,
  seen: SeenQuestion,
  optionIndex: number,
  declaredStatus: FleetStatus,
  io: SteerIo = realIo(),
): SteerResult {
  const shape = checkTarget(target);
  if (shape) return { ok: false, reason: shape };
  const declared = steerableStatus(declaredStatus);
  if (declared) return { ok: false, reason: declared };
  if (!Number.isSafeInteger(optionIndex) || optionIndex < 0 || optionIndex >= seen.options.length) {
    return no("no-such-option", `there is no option ${optionIndex} in a ${seen.options.length}-option dialog`);
  }

  let capture: string;
  try {
    capture = io.capture(target.paneId);
  } catch (e) {
    return no("pane-gone", `pane ${target.paneId} could not be read: ${(e as Error).message}`);
  }
  const now = parsePane(capture);
  if (now.kind !== "question") {
    return no("question-gone", `pane ${target.paneId} is not asking anything now`);
  }
  if (!sameQuestion(seen, now)) {
    return no("question-changed", `pane ${target.paneId} is asking something else now`);
  }

  const option = now.options[optionIndex];
  if (!option) return no("no-such-option", `there is no option ${optionIndex}`);
  const keys = keysFor(target.paneId, option.key);
  if (!keys.ok) return keys;

  const check = verifyTarget(target, io);
  if (!check.ok) return check;

  const failed = fire(io, keys.keys);
  if (failed) return { ok: false, reason: failed };
  return { ok: true, verified: check.verified, sent: keys.keys };
}

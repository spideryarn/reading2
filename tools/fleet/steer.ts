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
 *    compare-and-send, so there is no way to close it. It is milliseconds — the
 *    last check in every entry point here is now the one adjacent to the send,
 *    which is what Sol's F4 was about — and the realistic race is not the clock
 *    but another person or agent answering the same dialog from the terminal.
 *  - **We verify the pane, not the foreground process group.** `send-keys`
 *    delivers to the pane's tty and whichever process group is in front reads
 *    it. On this box `#{pane_current_command}` is `bash` for every Claude
 *    session — Claude Code does not put itself in its own process group — so
 *    that field cannot tell a Claude pane from a shell pane and is not used. If
 *    a verified Claude session has shelled out to something in the foreground,
 *    our text goes to that instead, and nothing here can see it. `inputSurface`
 *    narrows this and does not close it: see its own comment.
 *  - **PANE TEXT IS NOT PROVENANCE.** Everything this file reads off a screen —
 *    the question, its material, the input box — was printed by the very
 *    process we are deciding whether to type at. An agent that prints a
 *    plausible menu, or a plausible input box, produces a capture the parser
 *    accepts. Sol's F6, and it is not fixable by tightening a parser; it is
 *    fixed by a structured source of question identity, or accepted explicitly.
 *  - **We see one screenful.** `capturePane` is `capture-pane -p` with no `-S`,
 *    so a dialog taller than the pane arrives as a fragment. `pane.ts` catches
 *    the common case — Claude Code v2.1.263 draws a dialog's outer border solid
 *    and its inner separators dashed, so a topmost DASHED rule means the
 *    capture starts mid-dialog and the material comes back `unreadable`, which
 *    `sameMaterial` refuses. **That is an observation about one build, not a
 *    promise**: if a future Claude Code draws inner separators solid, a clipped
 *    dialog starts reading as complete and NOTHING GOES RED, because every
 *    fixture here is a frozen capture of the old build. Deliberately not fixed
 *    by capturing scrollback (`-S -N`): Claude Code redraws a dialog on every
 *    frame, so history holds many partial copies of it, and `materialAbove`
 *    would bound the body at a rule belonging to an earlier frame — turning a
 *    refusal into a confident, WRONG body, which is the wrong direction to be
 *    wrong in. The right fix is a `clipped` signal out of `pane.ts` (was the
 *    material's top border the first line of the capture?), not a wider window.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  capturePane,
  cleanLines,
  grantsPermission,
  isInputPrompt,
  isPaneId,
  parsePane,
  type OptionKey,
  type PaneMaterial,
  type PaneQuestion,
} from "./pane.js";
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
  /** The pane is not showing Claude Code's input box, so free text is not text. */
  | "not-at-input"
  /** The pane is asking a question, and a message typed at one is an answer to it. */
  | "pane-is-asking"
  /** The pane is no longer asking anything. */
  | "question-gone"
  /** The pane is asking something else, or asking it differently. */
  | "question-changed"
  /**
   * Answering would grant a permission rather than take a turn in a
   * conversation, so the page will not do it. Fable's line, and the only
   * discrimination that lets any of this be switched on: pane text as
   * executable UI is acceptable when execution means *a user turn*, and not
   * when it means *grant a permission*. A forged menu can make you send a digit
   * to an agent that was already misbehaving; it cannot mint an approval.
   */
  | "grants-permission"
  /** The chosen option is not one of the options. */
  | "no-such-option"
  /** tmux refused the send, and NOTHING reached the pane. */
  | "send-failed"
  /** tmux refused partway, so SOME keystrokes reached the pane and the rest did not. */
  | "send-partial"
  /** tmux neither succeeded nor cleanly failed, so we cannot say what arrived. */
  | "send-unknown";

export type Refusal = { code: RefusalCode; why: string };

/**
 * How much of the sequence reached the pane. Sol's F17.
 *
 * **A failed send is not a non-send**, and treating the two the same is how the
 * dashboard told somebody "nothing happened" while their message sat in an
 * agent's input box waiting for the next Enter anybody pressed. The three arms
 * are the three genuinely different things a caller has to say to a person:
 *
 *  - `none` — nothing arrived. Retrying is safe.
 *  - `partial` — something arrived and the sequence did not finish. **The text
 *    may be sitting in the input box unsent.** Retrying appends to it. The only
 *    honest instruction is "go and look at the terminal".
 *  - `unknown` — the first call neither returned nor cleanly failed, which is
 *    what a timeout or a killed child looks like. tmux may have delivered
 *    before it died. Same instruction, less information.
 *
 * It is a required field on every refusal rather than an optional one so that a
 * new refusal path has to state it. `none` is the overwhelmingly common answer
 * — every check in this file refuses before anything is sent — but it is the
 * answer that must be *given*, not the one that is inherited by omission.
 */
export type Delivery = "none" | "partial" | "unknown";

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
 * A refusal, plus what it left behind.
 *
 * `sent` IS THE CALLS THAT COMPLETED, not the ones that were planned, and on a
 * refusal it is nearly always empty. Together with `delivery` it is the whole
 * answer to "is the message in their input box?", which is the question a
 * partial send raises and a bare `ok:false` cannot answer.
 *
 * **`sent` CONTAINS THE MESSAGE.** The literal-text call is
 * `send-keys -t %10 -l -- <the whole message>`, so this field is the message,
 * and this module's promise is that the message never reaches a log. It goes
 * back to the client that supplied it, which already has it. **Anything logging
 * this must log `describeSend(sent)` instead** — that is what it is for.
 */
export type SteerFailure = {
  ok: false;
  reason: Refusal;
  delivery: Delivery;
  sent: readonly (readonly string[])[];
};

/**
 * The result. `sent` is the exact argv of every tmux invocation that COMPLETED,
 * in order, because "what did you actually press" is the first question anybody
 * asks about a session that did something surprising, and reconstructing it
 * from prose is guesswork. On the `ok:true` arm that is every call; on the
 * failure arm it is the prefix that got through.
 */
export type SteerResult = { ok: true; verified: Verified; sent: readonly (readonly string[])[] } | SteerFailure;

function no(code: RefusalCode, why: string): SteerFailure {
  return { ok: false, reason: { code, why }, delivery: "none", sent: [] };
}

/** A refusal decided elsewhere — `checkText`, `steerableStatus` — as a failure. */
function refuse(reason: Refusal): SteerFailure {
  return { ok: false, reason, delivery: "none", sent: [] };
}

/**
 * One send, described without its contents, for a log line.
 *
 * The header promises that nothing here logs a word of what people say to their
 * agents, and Sol's F17 found two ways that promise was already broken: Node's
 * child-process error message contains the argv, and `sent` IS the argv. This
 * is the safe rendering — everything after `-l --` becomes a character count —
 * and it exists so that the honest thing and the convenient thing are the same
 * line of code at the call site.
 */
export function describeSend(sent: readonly (readonly string[])[]): string {
  return sent
    .map((call) => {
      const cut = call.indexOf("--");
      if (cut === -1 || !call.includes("-l")) return call.join(" ");
      const chars = call.slice(cut + 1).join(" ").length;
      return `${call.slice(0, cut + 1).join(" ")} <${chars} characters>`;
    })
    .join(" ; ");
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
 * The six things this module needs from the machine, as RAW OUTPUT.
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
  /**
   * `pgrep -a -f -- <uuid>`, or "" when nothing matched.
   *
   * A CANDIDATE FINDER AND NOTHING MORE. It is deliberately wider than the
   * question being asked — it matches anything whose command line mentions the
   * uuid at all, an agent grepping for it included — because pgrep prints argv
   * FLATTENED WITH SPACES and a flattened command line cannot be read back into
   * arguments. `cmdline` below is what decides. See `isClaudeForSession`.
   */
  claudeCandidates(claudeSessionId: string): string;
  /** `ps -eo pid=,ppid=`. */
  processParents(): string;
  /**
   * `/proc/<pid>/cmdline` verbatim: the process's argv, NUL-separated.
   *
   * `null` means the process is gone, which is a normal answer between a pgrep
   * and this read and not an error. Anything else throws, because a process
   * table we cannot read is not a process table that says no.
   */
  cmdline(pid: number): string | null;
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
        // THE PATTERN IS THE UUID ALONE, not `--session-id <uuid>`. Two reasons,
        // and both are Sol's F3. A pattern that looks like the option pair reads
        // as though it had verified the option pair, and it has not — pgrep
        // matches a regex against argv joined by spaces, where an option and its
        // value are indistinguishable from one argument containing a space. And
        // it would MISS `--session-id=<uuid>`, which is the same request. So
        // this asks the cheap, wide question and `isClaudeForSession` asks the
        // exact one. The uuid is hex and hyphens, so there is no metacharacter.
        //
        // pgrep exits 1 when nothing matched, which execFileSync throws on. That
        // is "no candidates", not "could not look" — the distinction the rest of
        // this area keeps writing comments about — so it is caught HERE and
        // nowhere wider, and any other failure still propagates as unreadable.
        return run(["-a", "-f", "--", claudeSessionId], "pgrep");
      } catch (e) {
        const status = (e as { status?: unknown }).status;
        if (status === 1) return "";
        throw e;
      }
    },
    processParents: () => run(["-eo", "pid=,ppid="], "ps"),
    cmdline: (pid) => {
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`not a pid: ${pid}`);
      try {
        return readFileSync(`/proc/${pid}/cmdline`, "utf8");
      } catch (e) {
        // The process exited between the pgrep and this read. Common, and not a
        // failure: it is simply not the Claude we are looking for any more.
        // ESRCH is what the kernel returns for a pid that is mid-teardown.
        const code = (e as { code?: unknown }).code;
        if (code === "ENOENT" || code === "ESRCH") return null;
        throw e;
      }
    },
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
 * `pgrep -a -f` output into pids, and DELIBERATELY NOTHING ELSE.
 *
 * This used to decide, and deciding here was Sol's F3. pgrep prints a command
 * line with its arguments joined by spaces, and once they are joined there is
 * no way to get them back: `claude --session-id A` and
 * `claude --session-id B "--session-id A"` are the same text with the same
 * substring in it, and the second one is a DIFFERENT CONVERSATION with the
 * first one's uuid sitting in its initial prompt. gjd-remote puts a launch
 * prompt into argv, so that is not a hypothetical shape.
 *
 * So this function reads pids and forms no opinion. The opinion is
 * `isClaudeForSession`, over real argv from `/proc`. Everything the old version
 * checked here — the substring, argv[0] — is checked there instead, on
 * arguments rather than on a rendering of them. A second, weaker copy of the
 * same test living here would only invite somebody to trust it.
 */
export function candidatePids(pgrepOut: string): number[] {
  const pids: number[] = [];
  for (const line of pgrepOut.split("\n")) {
    const m = /^(\d{1,10}) (.+)$/.exec(line.trim());
    if (!m) continue;
    pids.push(Number(m[1]));
  }
  return pids;
}

/**
 * `/proc/<pid>/cmdline` into argv.
 *
 * The file is NUL-separated with a trailing NUL, so a plain split leaves an
 * empty last element; a process that has rewritten its own argv (setproctitle)
 * can leave a run of them. Trailing empties are dropped and interior ones are
 * kept, because an empty argument in the middle is a real argument and shifting
 * the ones after it would move a value away from its option.
 *
 * A zero-length read means the process is a kernel thread or died mid-read, and
 * gives `[]` — which `isClaudeForSession` refuses, as it should.
 */
export function argvOf(cmdline: string): string[] {
  const parts = cmdline.split("\0");
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * Is this argv a live Claude for exactly this conversation?
 *
 * THE POINT IS THE WORD "ARGUMENT". The old test asked whether the flattened
 * command line CONTAINED `--session-id <uuid>`, which the initial prompt of a
 * different conversation can satisfy — Sol's F3, and the consequence is a
 * message delivered to the wrong agent, which is the exact failure this whole
 * file exists to prevent. So:
 *
 *  - argv[0]'s basename must be `claude`. That is what one looks like on this
 *    box (`claude --session-id 117e181a-… --name adversarial-fixtures`, measured
 *    2026-09-08). A wrapper under another name is refused rather than assumed.
 *  - some element must be exactly `--session-id` with the NEXT element exactly
 *    the uuid, or exactly `--session-id=<uuid>`. Exactly, not by prefix: a uuid
 *    with anything appended is a different uuid.
 *  - the search stops at a bare `--`, because everything after that is
 *    positional by definition. `claude --session-id B -- --session-id A` is a
 *    prompt that says `--session-id A`, and reading it as an option is the bug
 *    in its most literal form.
 *  - there must be EXACTLY ONE `--session-id` before that point. Two of them is
 *    a command line whose meaning depends on which one the CLI's parser keeps,
 *    and guessing "the first" would answer yes to `--session-id <ours>
 *    --session-id <theirs>`, which is a message delivered to `theirs`. We do
 *    not guess; we refuse.
 *
 * What this still cannot see: which conversation that process is *serving* now.
 * argv is fixed at exec, and `/resume` inside a running Claude changes the
 * conversation without changing a byte of it. That is a gap in the model, not
 * in this function, and it is the reason `claudeSessionId` is re-read from tmux
 * rather than trusted from the page.
 */
export function isClaudeForSession(argv: readonly string[], claudeSessionId: string): boolean {
  const argv0 = argv[0];
  if (argv0 === undefined) return false;
  if ((argv0.split("/").pop() ?? "") !== "claude") return false;

  const values: (string | undefined)[] = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || arg === "--") break;
    if (arg === "--session-id") values.push(argv[i + 1]);
    else if (arg.startsWith("--session-id=")) values.push(arg.slice("--session-id=".length));
  }
  if (values.length !== 1) return false;
  return values[0] === claudeSessionId;
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
 * ANCESTRY FIRST, THEN `/proc`, and the order is not a micro-optimisation. The
 * ancestry filter is arithmetic over a table we already have, so it costs
 * nothing and usually leaves one candidate; the argv read is a syscall per
 * candidate against a process that may exit underneath it. Doing the cheap
 * narrowing first means a box with forty agents on it reads one `cmdline`.
 *
 * Together those pin address, container, process and conversation. What they
 * cannot pin is which process group is reading the tty (see the file header),
 * and the milliseconds after the last check.
 */
export function verifyTarget(target: SteerTarget, io: SteerIo): { ok: true; verified: Verified } | SteerFailure {
  const shape = checkTarget(target);
  if (shape) return refuse(shape);

  let panes: PaneRecord[] | null;
  let parents: Map<number, number> | null;
  let candidates: number[];
  try {
    panes = parsePanes(io.listPanes());
    parents = parseParents(io.processParents());
    candidates = candidatePids(io.claudeCandidates(target.claudeSessionId));
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
  const underPane = candidates.filter((pid) => descendsFrom(pid, pane.panePid, tree));

  let claudePid: number | undefined;
  try {
    for (const pid of underPane) {
      const raw = io.cmdline(pid);
      // null is "it exited between the pgrep and now", which is a no rather
      // than a failure. Every other reason to be unable to read an argv is a
      // box we cannot believe, and is thrown.
      if (raw === null) continue;
      if (isClaudeForSession(argvOf(raw), target.claudeSessionId)) {
        claudePid = pid;
        break;
      }
    }
  } catch (e) {
    return no("box-unreadable", `a process's command line could not be read: ${(e as Error).message}`);
  }

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
 * the choice opened. `selected` sends Enter alone, which is why it is its own
 * arm rather than zero presses.
 *
 * **`arrows` SENDS ITS MOVES AND ITS ENTER IN ONE tmux CALL** — `send-keys -t %10
 * Down Down Enter` — and that is Sol's F5. It was two calls, and between them
 * was a window in which anybody attached to that terminal could move the
 * highlight: the arrows would land on one option and the Enter would choose
 * another. One call also removes the failure where the arrows are accepted and
 * the Enter is refused, leaving a menu with the cursor silently moved.
 *
 * **THIS IS NOT ATOMICITY AND MUST NOT BE READ AS IT.** tmux queues the keys
 * into the pane's input as one command, so nothing of ours interleaves; it does
 * not stop the program in the pane, or a human at the keyboard, acting between
 * the `Down` and the `Enter` being read. What went away is a window we were
 * opening ourselves. The rest of the race is in the KNOWN GAPS at the top.
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
      return { ok: true, keys: [[...t, ...Array(key.presses).fill(key.key), "Enter"]] };
    }
    case "selected":
      return { ok: true, keys: [[...t, "Enter"]] };
    default: {
      const never: never = key;
      return never;
    }
  }
}

/**
 * Everything a subprocess failure may say, with the argv taken out.
 *
 * **NEVER `e.message`, AND NEVER `e.stderr`.** Node builds a child-process error
 * message by pasting the whole command line into it, and the command line of
 * the call this module cares most about is
 * `send-keys -t %10 -l -- <the person's message>`. So the obvious, idiomatic,
 * everywhere-else-correct `${(e as Error).message}` puts the message into the
 * refusal, into the HTTP body, and into the server log — in a file whose header
 * promises it never logs a word of what people say to their agents. Sol's F17,
 * and the reason there is a function here rather than a template string.
 *
 * What survives is what a person debugging actually needs and argv never
 * appears in: the errno, the exit status, the signal. When there is none of
 * that, the honest answer is that there is none of that.
 */
function subprocessFailure(e: unknown): string {
  const err = e as { code?: unknown; status?: unknown; signal?: unknown };
  const bits: string[] = [];
  if (typeof err.code === "string" && err.code !== "") bits.push(`error ${err.code}`);
  if (typeof err.status === "number") bits.push(`exit status ${err.status}`);
  if (typeof err.signal === "string" && err.signal !== "") bits.push(`killed by ${err.signal}`);
  return bits.length > 0 ? bits.join(", ") : "no diagnostic beyond the failure itself";
}

/**
 * Might this failure have delivered anyway?
 *
 * A timeout or a killed child is the ambiguous case: `execFileSync` gives up on
 * a process it has already started, and tmux may well have queued the keys
 * before it died. An ordinary non-zero exit is not ambiguous — tmux said no.
 * The whole point of the distinction is that "we do not know" is a thing this
 * module is allowed to say, and "it failed" is not allowed to stand in for it.
 */
function mayHaveLanded(e: unknown): boolean {
  const err = e as { code?: unknown; signal?: unknown };
  if (err.code === "ETIMEDOUT") return true;
  return typeof err.signal === "string" && err.signal !== "";
}

/** What `fire` did: the calls that completed, and why it stopped if it did. */
type Fired = {
  sent: readonly (readonly string[])[];
  refusal: { reason: Refusal; delivery: Delivery } | null;
};

/**
 * Runs a list of tmux calls, stopping at the first that fails, and REPORTING
 * WHAT GOT THROUGH.
 *
 * The old version returned one refusal code for all three outcomes, and the
 * route turned all three into the same 409. That reads to a person as "nothing
 * happened", and for the middle case it is false in the most expensive
 * direction available: if the literal-text call succeeds and the Enter does
 * not, the message is sitting in that agent's input box, unsent, and the next
 * Enter anybody presses — theirs, ours, a retry from this dashboard — submits
 * it. Sol's F17.
 */
function fire(io: SteerIo, calls: readonly (readonly string[])[]): Fired {
  const sent: (readonly string[])[] = [];
  for (const [i, call] of calls.entries()) {
    try {
      io.sendKeys(call);
    } catch (e) {
      const detail = subprocessFailure(e);
      if (i > 0) {
        return {
          sent,
          refusal: {
            delivery: "partial",
            reason: {
              code: "send-partial",
              why:
                `tmux ${mayHaveLanded(e) ? "neither completed nor cleanly refused" : "refused"} call ${i + 1} of ` +
                `${calls.length}, after ${i} had already gone through (${detail}). Part of the sequence arrived` +
                `${mayHaveLanded(e) ? " and the rest cannot be accounted for" : " and the rest did not"} — anything ` +
                "typed is sitting in that session's input box unsent. Look at the terminal rather than retrying.",
            },
          },
        };
      }
      if (mayHaveLanded(e)) {
        return {
          sent,
          refusal: {
            delivery: "unknown",
            reason: {
              code: "send-unknown",
              why:
                `tmux neither completed nor cleanly refused the first call (${detail}), so it cannot be ` +
                "said whether anything reached the pane. Look at the terminal rather than retrying.",
            },
          },
        };
      }
      return {
        sent,
        refusal: {
          delivery: "none",
          reason: { code: "send-failed", why: `tmux refused the send and nothing reached the pane (${detail})` },
        },
      };
    }
    sent.push(call);
  }
  return { sent, refusal: null };
}

/**
 * How far below the prompt line the input box's lower border may be.
 *
 * The box grows with what has been typed into it: every idle and working
 * capture on this box puts the border on the very next line, and the one
 * fixture with a three-line message drafted but unsent puts it two below. Four
 * is past all of them and no further, and the tightness is doing work — with
 * the window at twenty, `dialog-ask-user-question.txt` finds a border twelve
 * lines under its cursor and reads as an input box on this test alone; at four
 * it does not, so the dialog check and the border check fail it independently.
 *
 * What a taller box costs us is a refusal for somebody who has a long draft
 * half-typed, and that is the right answer anyway: text sent into a box with a
 * draft in it is appended to the draft and submitted with it.
 */
const INPUT_BOX_LINES = 4;

/**
 * How many blank columns before a title makes a line the input box's TOP border.
 *
 * Claude Code writes the session's name into the right-hand end of that border,
 * so after `cleanLines` turns the rule characters into spaces what is left is a
 * long run of blanks and one word — `none-working-empty-prompt.txt` line 37 is
 * 110 spaces and `adversarial-fixtures-four-postmortems`. An untitled border is
 * a plain rule and needs none of this; this is only for the titled form.
 *
 * A heuristic about a rendering, and it is allowed to be one because it is the
 * THIRD of three conditions rather than the only one, and because being wrong
 * here refuses a send rather than misdirecting one.
 */
const BORDER_TITLE_INDENT = 20;

/** What we could tell about the screen we are about to type at. */
export type InputSurface = { ok: true; promptLine: number } | { ok: false; why: string };

type CleanLine = ReturnType<typeof cleanLines>[number];

/**
 * Is this the input box's top border?
 *
 * Two shapes, both measured on this box on 2026-09-08: a bare rule
 * (`none-idle-with-prose-numbered-list.txt`), and a rule with the session's name
 * written into its right-hand end (`none-working-empty-prompt.txt`, and every
 * other `working` capture we have). The second is why this is not simply
 * `rule !== "none"` — `cleanLines` only calls a line a rule when there is
 * nothing on it but decoration, and a title is not decoration.
 *
 * The title must be one word. A deeply indented line of prose or code would
 * otherwise pass, and the whole value of a border test is that transcript does
 * not look like one.
 */
function isBoxBorder(line: CleanLine | undefined): boolean {
  if (!line) return false;
  if (line.rule !== "none") return true;
  const title = line.text.slice(BORDER_TITLE_INDENT);
  if (line.text.slice(0, BORDER_TITLE_INDENT).trim() !== "") return false;
  return title.trim() !== "" && !/\s/.test(title.trim());
}

/**
 * Is Claude Code's input box on this screen?
 *
 * **THIS EXISTS BECAUSE "NOT A QUESTION" IS AN ABSENCE.** `sendMessage` used to
 * check the pane and the process and then type; it never checked what was on
 * the screen. Sol's F2 is the sequence: the page honestly shows `working`,
 * Claude opens a numbered permission dialog in the meantime, a steering message
 * beginning with "1" arrives, the dialog eats the `1` as an approval, the Enter
 * lands in whatever screen that opened, and the route returns 200. The message
 * was never delivered and something was approved in its place.
 *
 * Asking `parsePane` and accepting `none` would not fix it. `none` is what that
 * parser says about a dialog shape it has not been taught, a pane mid-redraw,
 * and a pane holding nothing at all — it is deliberately biased towards `none`,
 * which is right for its own job and exactly wrong for this one. So this asks
 * for the box POSITIVELY:
 *
 *  1. `parsePane` must say `none`. Necessary, not sufficient; it is here to
 *     catch every dialog we DO recognise, and it is the weak half.
 *  2. The last input-prompt line on the screen must sit BETWEEN THE BOX'S TWO
 *     BORDERS — one immediately above it, one within `INPUT_BOX_LINES` below.
 *     That is the strong half: a `❯` echoed into the transcript — Greg's own
 *     message, rendered with the same character — has prose above it, and
 *     eleven of the twelve dialog fixtures have no border under their cursor
 *     within the window at all.
 *  3. It must be the LAST prompt line, so a box further up the scrollback
 *     cannot vouch for a screen that has since become something else. The
 *     working captures all contain an earlier `❯`: it is the echo of the
 *     message Greg sent, and taking the first match would accept a screen that
 *     is now anything at all.
 *
 * The predicate comes from `pane.ts` rather than being written again here.
 * Two regexes for one thing drift, and the direction this one would drift in is
 * "types a message into a permission dialog".
 *
 * **HOW THIS CAN STILL BE WRONG.** It is worth being exact, because the check
 * reads stronger than it is:
 *
 *  - **The screen is not provenance.** Everything above is a reading of text
 *    printed by the process we are about to type at. A program printing a rule,
 *    a `❯`, and another rule passes — deliberately, or because it was echoing
 *    hostile input. Sol's F6, and no amount of parsing fixes it.
 *  - **A shelled-out program is invisible.** `send-keys` goes to the pane's
 *    tty, and if a verified Claude has a child in the foreground, that child
 *    reads the keys. If it has not repainted over the box, the box is still on
 *    screen and this returns ok. The check narrows the file-header gap; it does
 *    not close it.
 *  - **A pane mid-redraw is a torn screen.** Claude Code repaints on every
 *    frame, and `capture-pane` can land between the dialog being drawn and the
 *    box being erased, or vice versa. Both halves of the tear are real text.
 *  - **A resized terminal moves the borders.** A narrow pane wraps the status
 *    line and a short one scrolls the box's own top border off, which reads as
 *    "no input box" — a refusal, so the wrong answer here is the safe one.
 *  - **The border test is a reading of one Claude Code build.** `isBoxBorder`
 *    knows two shapes because two shapes were measured. A third one stops every
 *    message going out until somebody teaches it — loudly, and in the safe
 *    direction, which is the trade this whole file is written to make.
 *  - **A box with a draft in it is still a box.** This says the surface takes
 *    text; it does not say the surface is empty. Text sent to a box someone has
 *    half-typed into is appended to their draft and submitted with it. That is
 *    a real defect and it is not this function's — it wants a product decision
 *    about what to do, not a tighter predicate.
 */
export function inputSurface(capture: string): InputSurface {
  const asking = parsePane(capture);
  if (asking.kind === "question") {
    return { ok: false, why: "the pane is showing a dialog, not an input box" };
  }

  const lines = cleanLines(capture);
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isInputPrompt(lines[i]?.text ?? "")) {
      at = i;
      break;
    }
  }
  if (at === -1) return { ok: false, why: "there is no input prompt anywhere on the screen" };
  if (at === 0 || !isBoxBorder(lines[at - 1])) {
    return { ok: false, why: "the prompt line has no box border above it, so it is transcript rather than the input box" };
  }
  for (let i = at + 1; i < lines.length && i <= at + INPUT_BOX_LINES; i++) {
    if ((lines[i]?.rule ?? "none") !== "none") return { ok: true, promptLine: at };
  }
  return {
    ok: false,
    why: `the prompt line has no box border within ${INPUT_BOX_LINES} lines below it, so this is not the input box`,
  };
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
 *
 * ORDER: the text, the caller's own status, live identity, and THEN the screen.
 * The screen check is last because it is the one that must be adjacent to the
 * send — `verifyTarget` runs three commands with ten-second timeouts, and a
 * dialog that opened during those seconds is a dialog our message would answer.
 * Everything before it is either free or slow-and-stable; this one is one tmux
 * call and is about a thing that changes frame by frame.
 */
export function sendMessage(
  target: SteerTarget,
  text: string,
  declaredStatus: FleetStatus,
  io: SteerIo = realIo(),
): SteerResult {
  const bad = checkText(text);
  if (bad) return refuse(bad);
  const declared = steerableStatus(declaredStatus);
  if (declared) return refuse(declared);

  const check = verifyTarget(target, io);
  if (!check.ok) return check;

  let capture: string;
  try {
    capture = io.capture(target.paneId);
  } catch (e) {
    return no("pane-gone", `pane ${target.paneId} could not be read: ${(e as Error).message}`);
  }
  // A recognised dialog gets its own code, because it is the one refusal a
  // person can act on: the session is asking them something, and the answer is
  // to answer it rather than to type at it.
  if (parsePane(capture).kind === "question") {
    return no("pane-is-asking", `pane ${target.paneId} is asking a question, and a message typed at one would answer it`);
  }
  const surface = inputSurface(capture);
  if (!surface.ok) {
    return no("not-at-input", `pane ${target.paneId} is not showing an input box: ${surface.why}`);
  }

  const calls = [
    ["send-keys", "-t", target.paneId, "-l", "--", text],
    ["send-keys", "-t", target.paneId, "Enter"],
  ];
  const fired = fire(io, calls);
  if (fired.refusal) {
    return { ok: false, reason: fired.refusal.reason, delivery: fired.refusal.delivery, sent: fired.sent };
  }
  return { ok: true, verified: check.verified, sent: fired.sent };
}

/**
 * Are these the same dialog?
 *
 * Prompt, material, option count, every label, every consequence AND every key.
 * The keys are compared as well as the labels because a cursor menu's
 * keystrokes are relative to where the cursor is: the same four options with the
 * highlight moved one row is the same QUESTION but a different ANSWER, and it
 * means something else is driving that pane right now — which is the moment to
 * stop, not the moment to recompute.
 *
 * `material` is the addition of 2026-09-08 and it is the load-bearing half:
 * `prompt` is only the sentence below the dialog's last rule, so two writes of
 * the same path with different contents used to compare equal, and an answer
 * meant for one would have been delivered to the other.
 */
export function sameQuestion(a: SeenQuestion, b: SeenQuestion): boolean {
  if (a.prompt !== b.prompt) return false;
  if (!sameMaterial(a.material, b.material)) return false;
  if (a.options.length !== b.options.length) return false;
  return a.options.every((opt, i) => {
    const other = b.options[i];
    if (!other || other.label !== opt.label) return false;
    if (other.consequence !== opt.consequence) return false;
    return JSON.stringify(other.key) === JSON.stringify(opt.key);
  });
}

/**
 * Two materials are the same only when we READ both and they hash the same.
 *
 * `unreadable` never equals anything, INCLUDING ANOTHER `unreadable`. Two
 * screens we could not read are not evidence that they are the same screen, and
 * this function's answer is what stands between a stale page and a keystroke.
 * Failing here costs a refusal the person can retry; passing here costs an
 * approval of something nobody saw.
 */
function sameMaterial(a: PaneMaterial, b: PaneMaterial): boolean {
  switch (a.kind) {
    case "read":
      return b.kind === "read" && a.fingerprint === b.fingerprint;
    case "no-material":
      return b.kind === "no-material";
    case "unreadable":
      return false;
    default: {
      const never: never = a;
      return never;
    }
  }
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
 * ORDER: shape, the caller's own status, the live identity check, and THEN
 * capture, compare and send. **The capture is last, and that is Sol's F4.** It
 * used to come first, ahead of `verifyTarget` — which runs three commands, each
 * with a ten-second timeout. So the dialog was read, then up to thirty seconds
 * of process-table work happened, and then keys computed from a screen that old
 * were sent to whatever was on the screen now. A dialog that is answered from
 * the terminal during that window leaves the next screen to receive our digit.
 *
 * Everything between the capture and the send is now arithmetic in this
 * process: parse, compare, build argv. The window that is left is milliseconds
 * and cannot be removed — tmux has no compare-and-send.
 */
export function answerQuestion(
  target: SteerTarget,
  seen: SeenQuestion,
  optionIndex: number,
  declaredStatus: FleetStatus,
  io: SteerIo = realIo(),
): SteerResult {
  const shape = checkTarget(target);
  if (shape) return refuse(shape);
  const declared = steerableStatus(declaredStatus);
  if (declared) return refuse(declared);
  if (!Number.isSafeInteger(optionIndex) || optionIndex < 0 || optionIndex >= seen.options.length) {
    return no("no-such-option", `there is no option ${optionIndex} in a ${seen.options.length}-option dialog`);
  }

  const check = verifyTarget(target, io);
  if (!check.ok) return check;

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
  // FROM THE FRESH CAPTURE, NEVER FROM THE REQUEST BODY. The client's copy of
  // `gate` is advisory and `parseQuestion` recomputes it anyway; this one is
  // computed on the box, on the screen as it is NOW, which is the only reading
  // a forged body cannot reach.
  //
  // AFTER `sameQuestion` rather than before it, and the order is about the
  // sentence rather than the safety — both arms refuse and nothing is sent
  // either way. When the dialog on screen has been replaced, "the pane is
  // asking something else now" is the true and useful thing to say; "this would
  // grant a permission" would describe a dialog the person never saw. Once
  // `sameQuestion` has passed, `gate` is a pure function of fields it has just
  // compared, so this is a statement about the dialog they are looking at.
  //
  // `unknown` is refused alongside `permission`: that arm is conservative
  // rather than neutral, and every dialog we have not positively identified as
  // an agent's own question lands in it — the harness's own settings menus
  // included.
  if (grantsPermission(now.gate)) {
    return no("grants-permission", `answering this would grant a permission rather than take a turn: ${now.gate.why}`);
  }

  const option = now.options[optionIndex];
  if (!option) return no("no-such-option", `there is no option ${optionIndex}`);
  const keys = keysFor(target.paneId, option.key);
  if (!keys.ok) return refuse(keys.reason);

  const fired = fire(io, keys.keys);
  if (fired.refusal) {
    return { ok: false, reason: fired.refusal.reason, delivery: fired.refusal.delivery, sent: fired.sent };
  }
  return { ok: true, verified: check.verified, sent: fired.sent };
}

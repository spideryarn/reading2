/**
 * Turning what you typed into what runs on the box — the pure half of
 * `new-claude --wait` and `ssh <command>`.
 *
 * Separated from scripts/gjd-remote.ts so it can be tested without a network,
 * the same way scripts/gjd-remote-env.ts and scripts/gjd-remote-tmux.ts are.
 * That file calls main() at import time, so nothing in it can be unit-tested at
 * all; anything worth a test has to live out here.
 */

/**
 * How long `--wait` may be. A month is far longer than the box's uptime — it
 * reboots, and nothing replays a job that was sleeping when it did — so a
 * bigger number is a typo rather than a plan, and it is refused where somebody
 * is present to read why.
 */
export const MAX_WAIT_SECONDS = 30 * 24 * 60 * 60;

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

/** `2h`, `90m`, `45s`, `1d`, `1.5h`. Lower-cased and trimmed before matching. */
const DURATION = /^(\d+(?:\.\d+)?)([smhd])$/;

/**
 * The label as it is allowed to reach the box.
 *
 * `waitPreamble` interpolates it into single quotes in a shell script, so this
 * is the only thing standing between a duration and shell injection. It is
 * deliberately stricter than DURATION rather than "the same regex": this one
 * has to hold even if the parse is changed or bypassed, so it is checked again
 * at the point of use.
 */
const SAFE_LABEL = /^[0-9.]{1,12}[smhd]$/;

export type Duration =
  | { ok: true; seconds: number; label: string }
  | { ok: false; why: string };

/**
 * `--wait 2h` → 7200 seconds.
 *
 * A UNIT IS REQUIRED. `--wait 2` is refused rather than guessed: seconds and
 * hours are both entirely reasonable readings of it, they are three orders of
 * magnitude apart, and the wrong one is only discovered by the session either
 * starting immediately or not starting all day.
 *
 * Fractions are allowed but must land on a whole second — `1.5h` is 5400 and
 * fine, `0.5s` is refused rather than silently rounded, because a wait that
 * says one thing and does another is the exact shape of bug this repo keeps
 * finding.
 */
export function parseDuration(raw: string): Duration {
  const text = raw.trim().toLowerCase();
  if (text === "") return { ok: false, why: "--wait needs a duration, like 30s, 15m, 2h or 1d" };

  const m = DURATION.exec(text);
  if (!m) {
    // The bare number is the mistake worth naming, because it is the one
    // somebody will actually make.
    const bare = /^\d+(?:\.\d+)?$/.test(text);
    return {
      ok: false,
      why: bare
        ? `--wait ${text} has no unit — say ${text}s, ${text}m, ${text}h or ${text}d`
        : `'${raw}' is not a duration — say 30s, 15m, 2h or 1d`,
    };
  }

  const [, amount, unit] = m as unknown as [string, string, keyof typeof UNIT_SECONDS];
  const seconds = Number(amount) * UNIT_SECONDS[unit];

  if (!Number.isInteger(seconds)) {
    return { ok: false, why: `--wait ${text} is not a whole number of seconds` };
  }
  if (seconds < 1) return { ok: false, why: `--wait ${text} is not long enough to be worth waiting for` };
  if (seconds > MAX_WAIT_SECONDS) {
    return { ok: false, why: `--wait ${text} is longer than a month, and the box reboots long before that` };
  }
  return { ok: true, seconds, label: text };
}

/**
 * The lines the job script runs before it starts Claude.
 *
 * THIS GOES AFTER THE GUARDS, NOT BEFORE THEM. The job checks that it can enter
 * the directory and that `claude` is on its PATH; if the sleep came first, a
 * box with a broken PATH would say nothing for two hours and then end the
 * session, at the one moment nobody is watching. Both guards are cheap and both
 * fail loudly, so they run while the person who typed the command is still
 * looking at the output.
 *
 * The deadline is computed ON THE BOX, at the moment the wait starts, because
 * that is the clock the sleep is actually measured against. `date -d` is GNU
 * and the box is Ubuntu, but the fallback is there anyway: a `$(...)` that
 * fails would otherwise print `at ` with nothing after it, which reads as a
 * missing time rather than an unavailable one.
 *
 * The label is re-validated here rather than trusted. It is the only caller
 * input that reaches this string, and it lands inside single quotes in a shell
 * script — so a label containing a quote would be shell syntax, in a file
 * nobody reads before it runs.
 */
export function waitPreamble(seconds: number, label: string): string {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_WAIT_SECONDS) {
    throw new Error(`waitPreamble: ${seconds} is not a number of seconds this can wait for`);
  }
  if (!SAFE_LABEL.test(label)) {
    throw new Error(`waitPreamble: '${label}' is not a duration label`);
  }
  return [
    `at=$(date -d "+${seconds} seconds" '+%a %d %b %H:%M %Z' 2>/dev/null) || at=''`,
    `printf 'gjd-remote: waiting ${label} before starting Claude%s\\n' "\${at:+ — until $at}"`,
    `printf 'gjd-remote: nothing has run yet; gjd-remote kill to call it off\\n'`,
    `sleep ${seconds}`,
    `printf 'gjd-remote: the wait is over; starting Claude\\n'`,
  ].join("\n");
}

/**
 * The argv for `gjd-remote ssh`, with or without a command to run.
 *
 * `gjd-remote ssh 'free -g'` used to drop the command on the floor: the case
 * ignored its positionals, opened a login shell, printed the MOTD and exited 0.
 * Asking a box a question and being handed a welcome banner instead is a silent
 * success of the plainest kind — the exit code says the command ran, and it
 * never existed.
 *
 * The `-t` follows ssh's own rule rather than ours: a pty for an interactive
 * shell, none for a command, so `gjd-remote ssh 'tmux ls' | grep …` behaves
 * like every other pipe. A command that needs a terminal wants `gjd-remote ssh`
 * and typing it, or `resume`.
 *
 * Words are joined with single spaces, again like ssh, which hands the whole
 * lot to the remote shell as one string. That means quoting is the remote
 * shell's business and `gjd-remote ssh ls -la` cannot work here anyway —
 * parseArgs takes `-la` for an option of ours long before this is called — so
 * the documented form is one quoted argument.
 */
export function sshInvocation(opts: {
  host: string;
  sshOpts: string[];
  words: string[];
}): { args: string[]; interactive: boolean } {
  const command = opts.words.join(" ").trim();
  if (opts.words.length > 0 && command === "") {
    throw new Error("there is no command in that — `gjd-remote ssh` on its own opens a shell");
  }
  if (command === "") {
    return { args: ["-t", ...opts.sshOpts, opts.host], interactive: true };
  }
  return { args: [...opts.sshOpts, opts.host, command], interactive: false };
}

/**
 * What a `--wait` launch does with the terminal, once the session exists.
 *
 * **It attaches by default**, the same as a launch with no `--wait` — Greg,
 * 2026-09-04, reversing the original decision. The pane is worth sitting in
 * because it is the pane Claude will appear in: `waitPreamble` above and the
 * `claude` line are consecutive lines of one job script in one tmux pane, so an
 * attached client reads "waiting 15h", then "the wait is over", and then Claude
 * takes that same pane over. Nothing has to be re-attached for that to happen,
 * and it already worked that way for anyone who ran `resume`.
 *
 * The argument against, which was the original decision and is now overridden:
 * a tab held for fifteen hours is a tab you stop trusting, and it is a tab you
 * cannot type anything else into. The transport is less of a problem than it
 * sounds — mosh is the default and rides through a closed lid — so what
 * `--no-attach` is really for on a long wait is getting your shell back, and
 * queueing several waited jobs from one of them.
 *
 * **No terminal is not a failure here**, and that is why this is a decision
 * rather than an `if`. `attachHandover` DIES when there is no controlling
 * terminal, telling you to pass `--no-attach` — right for a session that is
 * running, wrong for one that is asleep: a cron job or another agent's
 * subprocess launching a waited job has done nothing wrong, and its session is
 * sitting on the box waiting, exactly as asked. So it says so and exits 0.
 */
export type WaitHandover = { kind: "attach" } | { kind: "stay"; why: "asked" | "no-terminal" };

export function waitHandover(o: { attach: boolean; terminal: boolean }): WaitHandover {
  if (!o.attach) return { kind: "stay", why: "asked" };
  if (!o.terminal) return { kind: "stay", why: "no-terminal" };
  return { kind: "attach" };
}

/**
 * Is there a terminal to hand `tmux attach` at all?
 *
 * **`interactiveStdin()` alone cannot answer this**, and reading it as if it
 * could was the first version of this change. It returns the descriptor the
 * attach should USE, and its `"inherit"` means only "nothing has taken stdin
 * away from me" — it never looks at whether stdin is a terminal, because until
 * now every caller was a command that would go on to die usefully if it wasn't.
 * So `gjd-remote new-claude --wait 2h -p "…" </dev/null` from a cron job or an
 * agent's subprocess came back `"inherit"`, took the attach path, and failed
 * out of `tmux attach` with a non-zero exit over a session that had been
 * created exactly as asked. Found by GPT Sol reviewing this change, 2026-09-04.
 *
 * A number is an already-opened `/dev/tty`, so it is a terminal by
 * construction. `"inherit"` is only as good as the stdin it inherits.
 */
export function haveTerminal(o: { keyboard: number | "inherit" | null; stdinIsTty: boolean }): boolean {
  if (o.keyboard === null) return false;
  if (o.keyboard === "inherit") return o.stdinIsTty;
  return true;
}

/**
 * The first positional argument, with `--` respected.
 *
 * `rest.find((a) => !a.startsWith("-"))` was what `resume` used, and it is
 * wrong in the one direction that matters here: a tmux session name may begin
 * with a hyphen, and that filter silently skips it — so `gjd-remote resume
 * -odd` ignored the argument entirely and attached to the newest session
 * instead. Sol's point. Attaching to something other than what was named is a
 * worse outcome than an error, and it looks exactly like success.
 *
 * `--` ends the options, POSIX-style, so `resume -- -odd` says what it means.
 * Everything after it is positional even if it looks like a flag.
 *
 * **Scanned left to right, not `indexOf("--")` first.** That was the first
 * version and Sol found two ways it was wrong: `resume gateA --` returned
 * `undefined` and attached to the newest session instead of `gateA`, and
 * `resume gateA -- other` returned `other`. A separator only speaks for what
 * comes after it, so a name already found before it wins.
 */
export function positionalName(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--") return argv[i + 1];
    if (!a.startsWith("-")) return a;
  }
  return undefined;
}
